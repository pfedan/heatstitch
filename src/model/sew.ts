import type { PathStitch } from './along';
import type { Pt } from '../digitize/skeleton';
import { regionIn, type Region } from '../digitize/region';
import { apply, type Form, type Mat } from '../shape/path';
import { coversFrom, type Cover } from './covers';
import { tidyKept, withRecords } from './edit';
import { cutKey, wholeOf } from './knockout';
import { joinedUncut, setObjects, sewObjects, stitchKey, tableOf, trimmedBetween, type ObjectKind, type PlacedEntry, type SewObject } from './objects';
import { COLOR_CHANGE, END, JUMP, nextVersion, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { tieIn, tieOff } from './jumps';
import { tagShortStitches, TIE_MAX } from '../validation/shortStitches';
import { blockKeys } from './order';
import { blockIndex } from './sequence';
import { stopBefore, stopsAround, type AppliqueSettings } from './applique';
import { sharedArea } from './appliqueShare';
import { borderOf, knownKind, lockAt, railsIn, remember, remembered, takeRuns, trimBefore, type FillSettings, type Rails, type Remembered, type SatinSettings } from './restitch';
import { bandArea, fillArea, formKey, geoOf, geoUse, openOf } from './geo';
import { exitToward, hiddenAlong, hiddenWay, hidingOf, travelOf, withTravel, type Hiding } from './travel';
import { TRAVEL_STITCH } from '../digitize/fill';
import { core } from '../wasm/core';

/**
 * Sewing from the object list (stage C of the object model): what an object is (its shape and
 * how it is stitched) gives its stitches, and the list in order gives the design. sewOne sews one
 * object from what it remembers, sewDesign the whole design. Objects that cannot be sewn from what
 * they remember (stitches set by hand, read from a foreign file, letterings for now) keep the
 * stitches they have.
 */

/** What an object is sewn from: its shape and how it is stitched. */
export type Spec =
  | { kind: 'line'; path: Form; line: PathStitch }
  | { kind: 'fill'; area: Region; fill: FillSettings; memory: Remembered }
  | { kind: 'satin'; columns: Rails[][]; satin: SatinSettings }
  | { kind: 'border'; area: Region; border: PathStitch; memory: Remembered; open: Form | null }
  | { kind: 'applique'; area: Region; applique: AppliqueSettings; shared: Region | null };

/** Where an object is sewn from and to. */
export interface Way {
  /** Where the thread is when the object starts (its stitches start near here). */
  from: Pt;
  /** Where the next object starts, if known: straight fill rows end near it. */
  to?: Pt;
  /** What objects sewn later cover of it (see coversOver): no underlay under it. */
  covers?: Cover[];
}

/** All parts of what it remembers are of one kind (or it does not tell). */
function oneKind(m: Remembered, kind: ObjectKind): boolean {
  return !m.parts || m.parts.every((pt) => pt.kind === kind && !pt.border);
}

/**
 * What object `o` of `p` is sewn from, or null when it can only keep its stitches: loosed from its
 * shape, read from stitches, a lettering, a fill that follows its old rows, of more than one kind,
 * or the border around the parts of a fill cut apart. `m`: what it remembers, when not as in `p`.
 */
export function specOf(p: Pattern, o: SewObject, m: Remembered | null | undefined = remembered(p, o)): Spec | null {
  if (!m || m.free || m.hand || m.read || m.lettering || m.borderAt !== undefined) return null;
  if (m.applique) {
    const area = m.region ?? fillArea(m);
    return area ? { kind: 'applique', area, applique: m.applique, shared: sharedArea(p, sewObjects(p), o, m) } : null;
  }
  const kind = knownKind(m) ?? o.kind;
  if (kind !== o.kind) return null;
  if (m.outline && m.border && m.region) {
    // The border around the parts of a fill cut apart (and its lines along the cuts) is sewn from
    // the parts together: kept as it is until the parts are sewn from the list as one whole.
    const entries = tableOf(p).entries;
    if (entries.some((e) => e.memory?.piece && borderOf(e.memory)?.link === m.outline)) return null;
    // Along its fill's open paths too, as they were when it was sewn.
    const open = openOf(entries.find((e) => borderOf(e.memory)?.link === m.outline)?.memory);
    if ((open ? formKey(open) : undefined) !== m.along) return null;
    return { kind: 'border', area: m.region, border: m.border, memory: m, open };
  }
  const use = geoUse(m);
  if (use === 'line' && m.line) return { kind: 'line', path: geoOf(m)!, line: m.line };
  if (kind === 'fill' && m.fill && m.fill.pattern !== 'follow' && oneKind(m, 'fill')) {
    const area = use === 'band' ? bandArea(geoOf(m)!, m.fill) : (m.region ?? (use === 'area' ? fillArea(m) : null));
    if (!area) return null;
    return { kind: 'fill', area, fill: m.fill, memory: m };
  }
  if (kind === 'satin' && m.satin && m.columns?.length && oneKind(m, 'satin')) return { kind: 'satin', columns: m.columns, satin: m.satin };
  return null;
}

/**
 * The stitches of an object sewn from `spec` along `way`, and how many of them are underlay. Sewn
 * by the core in one call (core/src/model/sew.rs); the whole area an area was cut from (wholeOf)
 * is looked up here and given with it.
 */
export function sewOne(spec: Spec, way: Way): { runs: Pt[][]; under: number } | null {
  let plain: object;
  let area: Region | undefined;
  let whole: Region | null | undefined;
  let kept: Region | null | undefined;
  let covers: Cover[] = [];
  switch (spec.kind) {
    case 'line':
      plain = { kind: 'line', path: spec.path, line: spec.line };
      break;
    case 'satin':
      plain = { kind: 'satin', columns: spec.columns.map((rails) => rails.map(railsIn)), satin: spec.satin };
      break;
    case 'applique':
      plain = { kind: 'applique', applique: spec.applique };
      area = spec.area;
      whole = spec.shared;
      break;
    case 'border':
      plain = { kind: 'border', border: spec.border, open: spec.open ?? undefined };
      area = spec.area;
      whole = wholeOf(spec.area, spec.memory);
      break;
    case 'fill': {
      area = spec.area;
      whole = wholeOf(spec.area);
      // Travel may run across the whole area as the object remembers it (see core sew_one).
      kept = wholeOf(spec.area, spec.memory);
      plain = { kind: 'fill', fill: spec.fill, keptSame: kept === whole };
      covers = way.covers ?? [];
      break;
    }
  }
  const out = core().sewOne(plain, area && regionIn(area), whole ? regionIn(whole) : undefined, kept && kept !== whole ? regionIn(kept) : undefined, covers.map((c) => regionIn(c.region)), Float64Array.from(covers, (c) => c.overlap), way.from[0], way.from[1], way.to && Float64Array.from(way.to));
  if (!out) return null;
  try {
    const under = out.under;
    const { runs, flags } = takeRuns(out);
    runs.forEach((r, k) => flags[k] & 2 && stopBefore.add(r));
    return { runs, under };
  } finally {
    out.free();
  }
}

type Sewn = { runs: Pt[][]; under: number } | null;

/** What was sewn from a memory, by way (see sewCached): the last few ways only. */
const sewnFrom = new WeakMap<Remembered, Map<string, Sewn>>();
const KEPT_WAYS = 4;
const regionIds = new WeakMap<object, number>();
let nextRegion = 1;
const idOf = (o: object) => {
  let n = regionIds.get(o);
  if (!n) regionIds.set(o, (n = nextRegion++));
  return n;
};

/**
 * sewOne for object memory `m`, kept with it: an object whose memory and way stay the same is
 * not sewn again (its memory is not changed in place: a change makes a new one).
 */
function wayKey(spec: Spec, way: Way): string {
  // A line or a satin is sewn the same from wherever the thread comes.
  if (spec.kind === 'line' || spec.kind === 'satin') return '';
  const shared = spec.kind === 'applique' ? `;${cutKey(spec.shared)}` : '';
  return `${way.from[0]},${way.from[1]};${way.to?.[0]},${way.to?.[1]};${(way.covers ?? []).map((c) => `${idOf(c.region)}:${c.overlap}`).join(',')}${shared}`;
}

/** Keeps `sewn` as what memory `m` gives along `way`. */
function keepSewn(m: Remembered, key: string, sewn: Sewn): void {
  let kept = sewnFrom.get(m);
  if (!kept) sewnFrom.set(m, (kept = new Map()));
  kept.set(key, sewn);
  if (kept.size > KEPT_WAYS) kept.delete(kept.keys().next().value!);
}

function sewCached(m: Remembered, spec: Spec, way: Way): Sewn {
  const key = wayKey(spec, way);
  const kept = sewnFrom.get(m);
  if (kept?.has(key)) return kept.get(key)!;
  const out = sewOne(spec, way);
  keepSewn(m, key, out);
  return out;
}

interface Rec {
  x: number;
  y: number;
  cmd: number;
}

const at = (q: Pt, cmd: number): Rec => ({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd });

/**
 * The records of one object from its runs, as an object sewn anew is sewn: locked at its start
 * and end, a trim between runs further apart than `trimMm` (or marked to be trimmed), a jump
 * between the others. `under`: points of the runs that are underlay; returns how many stitches
 * of the object are (lock included), as Remembered.under counts them.
 */
function objectRecords(runs: Pt[][], under: number, trimMm: number, out: Rec[], joined = false): number {
  let last: Pt | null = null;
  let stitches = 0;
  let underStitches = 0;
  let fed = 0;
  const push = (r: Rec) => {
    out.push(r);
    if (r.cmd === STITCH) stitches++;
  };
  const point = (q: Pt) => {
    if (last && Math.hypot(last[0] - q[0], last[1] - q[1]) < 0.05) return;
    push(at(q, STITCH));
    last = q;
  };
  runs.forEach((run, k) => {
    if (!k) {
      // Come by hidden travel, the thread is there already.
      if (!joined) push(at(run[0], JUMP));
      for (const r of lockAt(run, false)) push(r);
      last = run[0];
    } else {
      const d = Math.hypot(run[0][0] - last![0], run[0][1] - last![1]);
      const stop = stopBefore.has(run);
      if (d > trimMm || trimBefore.has(run) || stop) {
        for (const r of lockAt(runs[k - 1], true)) push(r);
        push({ ...out[out.length - 1], cmd: TRIM });
        // A stop in the same thread (an appliqué's fabric laid on or cut off): the color block it opens is the caller's.
        if (stop) push({ ...out[out.length - 1], cmd: COLOR_CHANGE });
        push(at(run[0], JUMP));
        for (const r of lockAt(run, false)) push(r);
        last = run[0];
      } else if (d > 1) {
        push(at(run[0], JUMP));
        point(run[0]);
      } else point(run[0]);
    }
    if (fed + 1 === under) underStitches = stitches;
    for (let j = 1; j < run.length; j++) {
      point(run[j]);
      if (fed + j + 1 === under) underStitches = stitches;
    }
    fed += run.length;
  });
  for (const r of lockAt(runs[runs.length - 1], true)) push(r);
  return underStitches;
}

/**
 * What an object sewn anew remembers: the same, without what counted its old stitches. `travel`:
 * how many of its stitches are hidden travel to it, before what it sews (see travel.ts).
 */
function memoryAfter(m: Remembered, kind: ObjectKind, stitches: number, under: number, travel = 0): Remembered {
  // Sewn as it was: the same memory (what was sewn from it is kept with it, see sewCached).
  const same = m.parts?.length === 1 && m.parts[0].kind === kind && m.parts[0].end === stitches && !m.parts[0].border && (m.under ?? 0) === under && (m.underFrom ?? 0) === (under > 0 ? travel : 0) && travelOf(m) === travel;
  if (same) return m;
  const out: Remembered = { ...m };
  delete out.parts;
  delete out.under;
  delete out.underFrom;
  delete out.borderAt;
  delete out.travel;
  out.parts = [{ kind, end: stitches }];
  if (under > 0) out.under = under;
  if (travel > 0) {
    out.travel = travel;
    if (under > 0) out.underFrom = travel;
  }
  return out;
}

/** One object in the list a design is sewn from. */
export interface Entry {
  /** The object in the design the list was taken from: its stitches and what it remembers. */
  obj: SewObject;
  color: ThreadColor;
  /** Its thread: neighbours with the same thread are sewn in one color block (see blockKeys). */
  thread: string;
  /** Sewn anew from what it remembers (when it can be); else it keeps its stitches. */
  sew?: boolean;
  /** Kept stitches moved, turned or mirrored by this map (world mm), the way in laid anew. */
  map?: Mat;
  /** What it remembers from now on (null: nothing; else what it remembers in `p`); sewn anew, it is sewn from this. */
  memory?: Remembered | null;
}

/** The object list of `p` as it is sewn now: every object keeps its stitches. */
export function listOf(p: Pattern): Entry[] {
  const objs = sewObjects(p);
  const keys = blockKeys(p, objs.length ? objs[objs.length - 1].block + 1 : 0);
  return objs.map((obj) => ({ obj, color: obj.color, thread: keys[obj.block] }));
}

/** Tied to another object (a border, a blend's second thread, a shadow, an echo copy). */
/** Is the thread cut after the last object `o` of `p` (none: a design without stitches, cut)? */
function endsCut(p: Pattern, o: SewObject | undefined): boolean {
  if (!o) return true;
  for (let i = o.last + 1; i < p.cmd.length; i++) if (p.cmd[i] === TRIM) return true;
  return false;
}

function linked(p: Pattern, o: SewObject): boolean {
  const m = remembered(p, o);
  return !!(m?.outline || m?.blendOf || m?.shadowOf || m?.echoOf);
}

/**
 * The design `p` sewn from its object list: each object that can be is sewn from what it
 * remembers (sewOne), starting where the one before ended; the others keep their stitches. Colors,
 * order, the trims between objects and the object ids stay as they are. A new version of `p`.
 */
export function sewDesign(p: Pattern, trimMm: number): Pattern {
  return sewList(p, listOf(p).map((e) => ({ ...e, sew: true })), trimMm);
}

/**
 * The design sewn from `list` (objects of `p`, in the order they are sewn): entries marked `sew`
 * are sewn from what they remember where they can be (sewOne), starting where the one before ended;
 * the others keep their stitches. Between neighbours as in `p`, the thread goes as it went; new
 * neighbours are joined by a jump, or locked and trimmed when further apart than `trimMm` or tied
 * to another object; a change of thread trims and stops for the color. A new version of `p` with
 * the list as its objects (same ids); an empty design for an empty list.
 */
export interface ListOptions {
  /** Objects (by index in `p`) whose ways in and out are made anew, also to and from their neighbours in `p`. */
  fresh?: ReadonlySet<number>;
  /** Places in the list where the object is trimmed off the one before in the same thread, never joined to it. */
  apart?: ReadonlySet<number>;
  /** Every object stays one of its own: new neighbours in one thread are trimmed apart, never joined by a jump. */
  whole?: boolean;
  /** Filled with the number of the first stitch of each entry. */
  starts?: number[];
}

export function sewList(p: Pattern, list: Entry[], trimMm: number, opts: ListOptions = {}): Pattern {
  const { fresh, apart, whole, starts } = opts;
  const table = tableOf(p);
  if (!list.length) return nextVersion(p, { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });
  const out: Rec[] = [];
  const placed: PlacedEntry[] = [];
  const colors: ThreadColor[] = [list[0].color];
  let stitches = 0;
  let here: Pt | null = null;
  // What each entry remembers from now on.
  const known = list.map((e) => (e.memory === undefined ? remembered(p, e.obj) : (e.memory ?? undefined)));
  const specs = list.map((e, k) => (e.sew ? specOf(p, e.obj, known[k]) : null));
  // Lines and satins sewn ahead (where they start does not depend on the object before).
  const ahead = new Map<number, Sewn>();
  let counted = 0;
  const count = (from: number) => {
    for (let k = Math.max(from, counted); k < out.length; k++) if (out[k].cmd === STITCH) stitches++;
    counted = out.length;
  };
  const copy = (a: number, b: number) => {
    for (let i = a; i < b; i++) out.push({ x: p.x[i], y: p.y[i], cmd: p.cmd[i] });
  };
  /** Record `r` of entry `k`'s stitches where it goes (moved by its map). */
  const mapped = (k: number, r: Rec): Rec => {
    const m = list[k].map;
    if (!m) return r;
    const [x, y] = apply(m, [r.x / 10, r.y / 10]);
    return { x: Math.round(x * 10), y: Math.round(y * 10), cmd: r.cmd };
  };
  const recOf = (k: number, i: number): Rec => mapped(k, { x: p.x[i], y: p.y[i], cmd: p.cmd[i] });
  const copyOwn = (k: number, a: number, b: number) => {
    for (let i = a; i < b; i++) out.push(recOf(k, i));
  };
  /** `n` jumps (at least one) from where the thread is to the start of entry `k`, in even steps. */
  const jumpsTo = (k: number, n: number) => {
    const from = out[out.length - 1];
    const to = recOf(k, list[k].obj.first);
    const steps = Math.max(1, n);
    for (let j = 1; j <= steps; j++) out.push(from ? { x: Math.round(from.x + ((to.x - from.x) * j) / steps), y: Math.round(from.y + ((to.y - from.y) * j) / steps), cmd: JUMP } : { ...to, cmd: JUMP });
  };
  const keptAt = (k: number) => !specs[k];
  /** Stops inside an object (an appliqué) from record `a` of `out` on: each opens a block in its thread. */
  const stopsFrom = (a: number, color: ThreadColor) => {
    for (let i = a; i < out.length; i++) if (out[i].cmd === COLOR_CHANGE) colors.push(color);
  };
  // The block each record of `p` is sewn in: an object with stops inside ends in a later block than it starts.
  const blockOf = blockIndex(p);
  const used = new Set<number>();
  let nextId = Math.max(table.next || 1, ...list.map((e) => e.obj.id + 1));
  // Kept objects cut off there in `p` already (as files from elsewhere often are, without a tie):
  // a cut there gives them no tie they did not have.
  const all = sewObjects(p);
  // A file without tie-offs (or tie-ins) gets none either.
  const tiesIn = all.some((x) => x.tieIn);
  const tiesOff = all.some((x) => x.tieOff);
  const cutBefore = (o: SewObject) => !tiesIn || o.index === 0 || trimmedBetween(p, all[o.index - 1], o);
  // Before hidden travel an object has its tie-off, though it does not read as one (no jump follows it).
  const cutAfter = (o: SewObject) => !tiesOff || o.index === all.length - 1 || trimmedBetween(p, o, all[o.index + 1]) || !!travelOf(remembered(p, all[o.index + 1]));
  // Kept objects that got a tie-in or tie-off of their own (too small to have one).
  const grown = new Set<number>();
  let tied = false;
  /** A tie-off for kept object `o` (entry `k`), sewn as part of it. */
  const tiedOff = (k: number, o: SewObject) => {
    const recs = tieOff(p, o.last).map((r) => mapped(k, r));
    out.push(...recs);
    const n = recs.filter((r) => r.cmd === STITCH).length;
    placed[k].last += n;
    stitches += n;
    counted = out.length;
    grown.add(k);
  };
  // What hides travel sewn before each entry (see travel.ts), worked out when asked.
  const hides: (Hiding | null | undefined)[] = [];
  const hidingFrom = (k: number): Hiding[] => {
    const out: Hiding[] = [];
    for (let j = k; j < list.length; j++) {
      // Kept stitches moved: what it remembers may not be where they are now.
      if (hides[j] === undefined) hides[j] = list[j].map ? null : hidingOf(known[j]);
      if (hides[j]) out.push(hides[j]!);
    }
    return out;
  };
  const mm = (r: Rec): Pt => [r.x / 10, r.y / 10];
  /** Whether the travel kept object `o` (entry k) starts with in `p` still leads from the object before to it hidden. */
  const stillHidden = (k: number, o: SewObject, n: number): boolean => {
    const prev = list[k - 1].obj;
    for (let i = prev.last + 1; i < o.first; i++) if (p.cmd[i] === TRIM || p.cmd[i] === COLOR_CHANGE) return false;
    const pts = [mm(recOf(k - 1, prev.last))];
    for (let i = o.first; i <= o.first + n; i++) {
      if (p.cmd[i] !== STITCH) return false;
      pts.push(mm(recOf(k, i)));
    }
    return Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) <= TRAVEL_STITCH + 0.3 && hiddenAlong(pts, hidingFrom(k));
  };
  let tags: Uint8Array | null = null;
  const tagsOf = () => (tags ??= tagShortStitches(p));
  list = list.slice();
  list.forEach((e, k) => {
    let o = e.obj;
    const prev = list[k - 1]?.obj;
    const spec = specs[k];
    const mark = out.length;
    // An appliqué's piece cut before is laid on before it, a raw edge cut after it: the machine
    // stops between them and their neighbours in the same thread (see stopsAround).
    const stop = !!prev && (stopsAround(known[k]?.applique).before || stopsAround(known[k - 1]?.applique).after);
    // How the thread comes here: as in `p` between neighbours there, else anew.
    const asBefore = !stop && !!prev && o.index === prev.index + 1 && o.block === blockOf[prev.last] && list[k - 1].thread === e.thread && !fresh?.has(o.index) && !fresh?.has(prev.index);
    // A change of thread between neighbours as in `p` stays as it was there.
    const colorAsBefore =
      !!prev && o.index === prev.index + 1 && o.block === blockOf[prev.last] + 1 && list[k - 1].thread !== e.thread && !fresh?.has(o.index) && !fresh?.has(prev.index) && !apart?.has(k);
    // Hidden travel it came by in `p`: kept with its stitches only from the same object as before,
    // as long as what is sewn after it still hides it; else it goes, and the way here is made anew.
    const via = travelOf(known[k]);
    let anew = false;
    if (via && !spec) {
      if (!(asBefore && keptAt(k - 1) && !e.map && stillHidden(k, o, via))) {
        anew = true;
        // Its own stitches start after the travel, with the tie-in they were sewn with (after
        // travel the short stitches of a lock do not read as a tie: no jump leads to them).
        const body = o.first + via;
        let ties = 0;
        while (ties < TIE_MAX && body + ties + 1 <= o.last && tagsOf()[body + ties + 1]) ties++;
        o = { ...o, first: body, tieIn: ties };
        list[k] = { ...e, obj: o };
        known[k] = withTravel(known[k]!, 0);
      }
    }
    let cut = false;
    // The records that lead to it come from `p` as they are.
    let led = false;
    // The stitches of hidden travel to it, between the end of the object before and its start.
    let travel: Pt[] | null = null;
    // Straight rows end near where the next object starts, when that is known before it is sewn:
    // it keeps its stitches, or it is a line or satin (they start where their shape starts).
    const next = list[k + 1];
    const nextSpec = next && specs[k + 1];
    const fixedStart = next && (!nextSpec || nextSpec.kind === 'line' || nextSpec.kind === 'satin');
    if (fixedStart && nextSpec && !ahead.has(k + 1)) ahead.set(k + 1, sewCached(known[k + 1]!, nextSpec, { from: [0, 0] }));
    const nextAt = next && recOf(k + 1, next.obj.first);
    let to = !fixedStart ? undefined : nextSpec ? ahead.get(k + 1)?.runs[0][0] : ([nextAt!.x / 10, nextAt!.y / 10] as Pt);
    // A fill followed by a fill in its thread: its rows end where a hidden way to the next one can start.
    if (!to && spec?.kind === 'fill' && nextSpec?.kind === 'fill' && next.thread === e.thread && !apart?.has(k + 1) && !linked(p, o) && !linked(p, next.obj)) to = exitToward(spec.area, nextSpec.area, hidingFrom(k + 1)) ?? undefined;
    const later = list.slice(k + 1).map((x) => x.obj);
    const covers = spec?.kind === 'fill' && spec.fill.underlay && spec.fill.underCover ? coversFrom(p, later, o, spec.area.pxMm, spec.memory.overlapShare) : undefined;
    // The first object starts nearest to the origin: taken from its stitches, the start would
    // creep along its edge each time it is sewn again (they are rounded to 0.1 mm).
    const way: Way = { from: here ?? [0, 0], ...(to ? { to } : {}), ...(covers?.length ? { covers } : {}) };
    const sewn = !spec ? null : ahead.has(k) ? ahead.get(k)! : sewCached(known[k]!, spec, way);
    if (!prev) {
      if (!spec && o.index === 0) {
        let lead = o.first;
        while (e.map && lead > 0 && p.cmd[lead - 1] === JUMP) lead--;
        copy(0, lead);
        if (lead < o.first) jumpsTo(k, o.first - lead);
        led = true;
      }
    } else if ((asBefore || colorAsBefore) && keptAt(k - 1) && !spec && !anew) {
      if (colorAsBefore) colors.push(e.color);
      if (e.map) {
        // Moved: what lies between them stays, the jumps to it go to where it is now.
        let lead = o.first;
        while (lead > prev.last + 1 && p.cmd[lead - 1] === JUMP) lead--;
        copy(prev.last + 1, lead);
        jumpsTo(k, o.first - lead);
      } else copy(prev.last + 1, o.first);
      led = true;
    }
    else {
      const color = list[k - 1].thread !== e.thread;
      const [a, b] = [recOf(k - 1, prev.last), recOf(k, o.first)];
      const far = Math.hypot(b.x - a.x, b.y - a.y) / 10 > trimMm;
      // Objects without a tie that the thread went between untrimmed in `p` (what lay between them
      // gone, or sewn the other way round) stay joined so: a cut would give them ties.
      const asWent = !asBefore && !whole && keptAt(k - 1) && !spec && !via && joinedUncut(p, prev, o);
      // Joined by hidden travel in `p`: trimmed now where it is too far for a jump.
      // Trimmed from the one before by hand: it stays so (see travel.ts).
      cut = color || stop || apart?.has(k) || !!known[k]?.cutIn || (asBefore && !via ? trimmedBetween(p, prev, o) : !asWent && (far || !!whole || linked(p, prev) || linked(p, o)));
      // In place of a jump (also one the thread went by before), or of a trim for its length (never
      // one that keeps them apart for another reason): hidden travel, where fills sewn later cover
      // a way there.
      const start = sewn ? sewn.runs[0][0] : mm(recOf(k, o.first));
      const there: Pt = [Math.round(start[0] * 10) / 10, Math.round(start[1] * 10) / 10];
      // Too far for a jump, measured to where it starts now (its start in `p` may lie elsewhere),
      // so the next sewing finds the same.
      const gap = here ? Math.hypot(there[0] - here[0], there[1] - here[1]) : 0;
      if (here && known[k] && !known[k]!.cutIn && !color && !stop && !apart?.has(k) && (!cut || gap > trimMm) && !linked(p, prev) && !linked(p, o) && gap > 1) {
        travel = hiddenWay(here, there, hidingFrom(k));
        if (travel) cut = false;
      }
      if (cut) {
        const end = out[out.length - 1];
        if (keptAt(k - 1) && !prev.tieOff && !cutAfter(prev)) tiedOff(k - 1, prev);
        out.push({ ...end, cmd: TRIM });
        if (color || stop) {
          out.push({ ...end, cmd: COLOR_CHANGE });
          colors.push(e.color);
        }
      }
    }
    count(mark);
    const first = stitches;
    starts?.push(first);
    const sewnFrom = out.length;
    if (travel) for (const q of travel) out.push(at(q, STITCH));
    const m = known[k];
    let memory = m;
    if (sewn && spec) {
      const under = objectRecords(sewn.runs, sewn.under, trimMm, out, !!travel);
      count(sewnFrom);
      stopsFrom(sewnFrom, e.color);
      memory = memoryAfter(m!, spec.kind === 'applique' ? 'satin' : o.kind, stitches - first, under, travel?.length ?? 0);
      // An appliqué remembers which edges it shares, to see when the pieces beside it changed.
      if (spec.kind === 'applique' && (memory.cut ?? '') !== cutKey(spec.shared)) {
        const { cut: _c, ...rest } = memory;
        memory = spec.shared ? { ...rest, cut: cutKey(spec.shared) } : rest;
      }
      // The new memory gives the same stitches the same way.
      if (memory !== m) keepSewn(memory, wayKey(spec, way), sewn);
    } else {
      tied = false;
      // Kept as it is: after its neighbour in `p` with the jumps that led to it there, else
      // jumped to (and tied in after a trim, or as a new first object), or come to by travel.
      let lead = o.first;
      while (asBefore && !anew && lead > 0 && p.cmd[lead - 1] === JUMP) lead--;
      if (led || travel) lead = o.first;
      else if (e.map && k > 0) {
        jumpsTo(k, o.first - lead);
        lead = o.first;
      } else if (lead === o.first) out.push({ ...recOf(k, o.first), cmd: JUMP });
      if (lead < o.first) copy(lead, o.first);
      copyOwn(k, o.first, o.first + 1);
      if ((cut || (!prev && !led)) && !o.tieIn && !cutBefore(o)) {
        out.push(...tieIn(p, o.first).map((r) => mapped(k, r)));
        tied = true;
      }
      copyOwn(k, o.first + 1, o.last + 1);
      count(sewnFrom);
      stopsFrom(sewnFrom, e.color);
      if (travel && m) memory = withTravel(m, travel.length);
    }
    const last = out.findLastIndex((r) => r.cmd === STITCH);
    here = [out[last].x / 10, out[last].y / 10];
    // An object listed again is a copy: an id of its own, knowing what its original knows.
    const id = used.has(o.id) ? nextId++ : o.id;
    used.add(id);
    placed.push({ id, first, last: stitches - 1, key: '', at: [0, 0], ...(memory ? { memory: memory.id === id ? memory : { ...memory, id } } : {}) });
    if (tied) grown.add(placed.length - 1);
  });
  // Cut at the end, as every design made here is; a file from elsewhere that ends without a cut
  // (the machine or the hand cuts there anyway) ends so whatever comes last.
  const lastObj = list[list.length - 1].obj;
  if (keptAt(list.length - 1) && lastObj.index === all.length - 1) copy(lastObj.last + 1, p.cmd.length);
  else if (!endsCut(p, all[all.length - 1])) out.push({ ...out[out.length - 1], cmd: END });
  else {
    if (keptAt(list.length - 1) && !lastObj.tieOff && !cutAfter(lastObj)) tiedOff(list.length - 1, lastObj);
    out.push({ ...out[out.length - 1], cmd: TRIM }, { ...out[out.length - 1], cmd: END });
  }
  const raw = withRecords(p, Int32Array.from(out, (r) => r.x), Int32Array.from(out, (r) => r.y), Uint8Array.from(out, (r) => r.cmd), colors);
  const q = tidyKept(raw).pattern;
  // Keys and first stitches on the new stitches, so the list is found where it is.
  const records: number[] = [];
  for (let i = 0; i < q.cmd.length; i++) if (q.cmd[i] === STITCH) records.push(i);
  for (const e of placed) {
    e.key = stitchKey(q, records[e.first], records[e.last]);
    e.at = [q.x[records[e.first]], q.y[records[e.first]]];
  }
  setObjects(q, placed, nextId);
  // A tie-off or tie-in added to a kept object gives it more stitches: the parts it was sewn in no
  // longer fit, and the next edit tells them apart anew.
  if (grown.size) {
    const objs = sewObjects(q);
    for (const k of grown) {
      const o = objs.find((x) => x.id === placed[k].id);
      const m = o && remembered(q, o);
      if (o && m?.parts) remember(q, o, { ...m, parts: undefined });
    }
  }
  return q;
}
