import { borderStitches, openStitches, type PathStitch } from './along';
import type { Pt } from '../digitize/skeleton';
import { expandRegion, type Region } from '../digitize/region';
import { apply, type Form, type Mat } from '../shape/path';
import { coversFrom, type Cover } from './covers';
import { tidyKept, withRecords } from './edit';
import { wholeOf } from './knockout';
import { lineStitches } from './line';
import { joinedUncut, setObjects, sewObjects, stitchKey, tableOf, trimmedBetween, type ObjectKind, type PlacedEntry, type SewObject } from './objects';
import { COLOR_CHANGE, END, JUMP, nextVersion, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { tieIn, tieOff } from './jumps';
import { blockKeys } from './order';
import { blockIndex } from './sequence';
import { appliqueRuns, stopBefore, type AppliqueSettings } from './applique';
import { borderOf, fillRuns, knownKind, TRAVEL_REACH, lockAt, remember, remembered, satinRuns, trimBefore, type FillSettings, type Rails, type Remembered, type SatinSettings } from './restitch';
import { bandArea, fillArea, formKey, geoOf, geoUse, openOf } from './geo';

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
  | { kind: 'applique'; area: Region; applique: AppliqueSettings };

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
    return area ? { kind: 'applique', area, applique: m.applique } : null;
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

/** The stitches of an object sewn from `spec` along `way`, and how many of them are underlay. */
export function sewOne(spec: Spec, way: Way): { runs: Pt[][]; under: number } | null {
  const ok = (runs: Pt[][], under = 0) => {
    const out = runs.filter((r) => r.length > 1);
    return out.length ? { runs: out, under } : null;
  };
  switch (spec.kind) {
    case 'line':
      return ok(lineStitches(spec.path, spec.line));
    case 'satin':
      return ok(spec.columns.flatMap((rails) => satinRuns(rails, spec.satin)));
    case 'applique':
      return ok(appliqueRuns(spec.area, spec.applique, way.from));
    case 'border': {
      const whole = wholeOf(spec.area, spec.memory);
      const runs = borderStitches(spec.area, spec.border, way.from, whole);
      const end = runs[runs.length - 1];
      return ok(spec.open ? [...runs, ...openStitches(spec.open, spec.border, end ? end[end.length - 1] : way.from, spec.area, whole)] : runs);
    }
    case 'fill': {
      // Travel may run where it is hidden: across the whole area where shapes on top left parts
      // out (knockout), and a little beyond the edge where the rows end (as far as travel along
      // an old thread may, TRAVEL_REACH).
      const travel = expandRegion(wholeOf(spec.area, spec.memory) ?? spec.area, TRAVEL_REACH) ?? undefined;
      const f = fillRuns(spec.area, spec.fill, { start: way.from, end: way.to, travel, covers: way.covers });
      return f ? ok(f.runs, f.under) : null;
    }
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
  return `${way.from[0]},${way.from[1]};${way.to?.[0]},${way.to?.[1]};${(way.covers ?? []).map((c) => `${idOf(c.region)}:${c.overlap}`).join(',')}`;
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
function objectRecords(runs: Pt[][], under: number, trimMm: number, out: Rec[]): number {
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
      push(at(run[0], JUMP));
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

/** What an object sewn anew remembers: the same, without what counted its old stitches. */
function memoryAfter(m: Remembered, kind: ObjectKind, stitches: number, under: number): Remembered {
  // Sewn as it was: the same memory (what was sewn from it is kept with it, see sewCached).
  const same = m.parts?.length === 1 && m.parts[0].kind === kind && m.parts[0].end === stitches && !m.parts[0].border && (m.under ?? 0) === under && m.underFrom === undefined;
  if (same) return m;
  const out: Remembered = { ...m };
  delete out.parts;
  delete out.under;
  delete out.underFrom;
  delete out.borderAt;
  out.parts = [{ kind, end: stitches }];
  if (under > 0) out.under = under;
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
  const cutAfter = (o: SewObject) => !tiesOff || o.index === all.length - 1 || trimmedBetween(p, o, all[o.index + 1]);
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
  list.forEach((e, k) => {
    const o = e.obj;
    const prev = list[k - 1]?.obj;
    const spec = specs[k];
    const mark = out.length;
    // How the thread comes here: as in `p` between neighbours there, else anew.
    const asBefore = !!prev && o.index === prev.index + 1 && o.block === blockOf[prev.last] && list[k - 1].thread === e.thread && !fresh?.has(o.index) && !fresh?.has(prev.index);
    // A change of thread between neighbours as in `p` stays as it was there.
    const colorAsBefore =
      !!prev && o.index === prev.index + 1 && o.block === blockOf[prev.last] + 1 && list[k - 1].thread !== e.thread && !fresh?.has(o.index) && !fresh?.has(prev.index) && !apart?.has(k);
    let cut = false;
    // The records that lead to it come from `p` as they are.
    let led = false;
    if (!prev) {
      if (!spec && o.index === 0) {
        let lead = o.first;
        while (e.map && lead > 0 && p.cmd[lead - 1] === JUMP) lead--;
        copy(0, lead);
        if (lead < o.first) jumpsTo(k, o.first - lead);
        led = true;
      }
    } else if ((asBefore || colorAsBefore) && keptAt(k - 1) && !spec) {
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
      const asWent = !asBefore && !whole && keptAt(k - 1) && !spec && joinedUncut(p, prev, o);
      cut = color || apart?.has(k) || (asBefore ? trimmedBetween(p, prev, o) : !asWent && (far || !!whole || linked(p, prev) || linked(p, o)));
      if (cut) {
        const end = out[out.length - 1];
        if (keptAt(k - 1) && !prev.tieOff && !cutAfter(prev)) tiedOff(k - 1, prev);
        out.push({ ...end, cmd: TRIM });
        if (color) {
          out.push({ ...end, cmd: COLOR_CHANGE });
          colors.push(e.color);
        }
      }
    }
    count(mark);
    const first = stitches;
    starts?.push(first);
    const sewnFrom = out.length;
    const next = list[k + 1];
    // Straight rows end near where the next object starts, when that is known before it is sewn:
    // it keeps its stitches, or it is a line or satin (they start where their shape starts).
    const nextSpec = next && specs[k + 1];
    const fixedStart = next && (!nextSpec || nextSpec.kind === 'line' || nextSpec.kind === 'satin');
    if (fixedStart && nextSpec && !ahead.has(k + 1)) ahead.set(k + 1, sewCached(known[k + 1]!, nextSpec, { from: [0, 0] }));
    const nextAt = next && recOf(k + 1, next.obj.first);
    const to = !fixedStart ? undefined : nextSpec ? ahead.get(k + 1)?.runs[0][0] : ([nextAt!.x / 10, nextAt!.y / 10] as Pt);
    const later = list.slice(k + 1).map((x) => x.obj);
    const covers = spec?.kind === 'fill' && spec.fill.underlay && spec.fill.underCover ? coversFrom(p, later, o, spec.area.pxMm, spec.memory.overlapShare) : undefined;
    // The first object starts nearest to the origin: taken from its stitches, the start would
    // creep along its edge each time it is sewn again (they are rounded to 0.1 mm).
    const way: Way = { from: here ?? [0, 0], ...(to ? { to } : {}), ...(covers?.length ? { covers } : {}) };
    const sewn = !spec ? null : ahead.has(k) ? ahead.get(k)! : sewCached(known[k]!, spec, way);
    const m = known[k];
    let memory = m;
    if (sewn && spec) {
      const under = objectRecords(sewn.runs, sewn.under, trimMm, out);
      count(sewnFrom);
      stopsFrom(sewnFrom, e.color);
      memory = memoryAfter(m!, spec.kind === 'applique' ? 'satin' : o.kind, stitches - first, under);
      // The new memory gives the same stitches the same way.
      if (memory !== m) keepSewn(memory, wayKey(spec, way), sewn);
    } else {
      tied = false;
      // Kept as it is: after its neighbour in `p` with the jumps that led to it there, else
      // jumped to (and tied in after a trim, or as a new first object).
      let lead = o.first;
      while (asBefore && lead > 0 && p.cmd[lead - 1] === JUMP) lead--;
      if (led) lead = o.first;
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
