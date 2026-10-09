import { listOf, sewList, specOf } from './sew';
import { fillToLine, lineSettings, reshapeLineFill, resewLine } from './line';
import { followerLinks } from './border';
import { bounds, flatten, scaling, transformForm, type Form, type Mat } from '../shape/path';
import { cutKey, sewnArea } from './knockout';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import { STITCH, type Pattern } from './pattern';
import { analyze, keepShape, knownKind, measureFill, measureRun, measureSatin, railsArea, remembered, rememberRange, restitch, type FillSettings, type Rails, type RestitchResult, type Settings } from './restitch';
import type { Pt } from '../digitize/skeleton';
import type { Region } from '../digitize/region';
import { areaLoops } from '../digitize/satinSuggest';
import { cumulative, cutLinesBetween, pointAt, railsFromOutline, stripsOfAreas, stripsOfOutline, type Rung } from '../digitize/rungs';
import { rasterize } from '../shape/rasterize';
import { stitchKinds } from './sequence';
import { isRigid, mirroredEcho, scaleOf, stitchesBefore, transformObject, transformRemembered } from './transform';
import { areaOf, fits, geoOf, geoUse, lineGeoOf, outlinePaths, satinOutline, sewnAlong, withGeo } from './geo';

function totalStitches(p: Pattern): number {
  let n = 0;
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH) n++;
  return n;
}

/** Number of the first stitch of each object (counting stitch records from 0). */
function startsOf(p: Pattern, objs: SewObject[]): number[] {
  const out: number[] = [];
  let n = 0;
  let k = 0;
  for (let i = 0; i < p.cmd.length && k < objs.length; i++) {
    if (i === objs[k].first) {
      out.push(n);
      k++;
    }
    if (p.cmd[i] === STITCH) n++;
  }
  return out;
}

/**
 * Keeps the objects of `after` as they were in `before`: object `o` now has `delta` stitches
 * more, everything else the same. Without this a changed object that now touches its neighbour
 * could be taken as one with it.
 */
function keepGrouping(before: Pattern, objs: SewObject[], o: SewObject, after: Pattern, delta: number): void {
  const at = startsOf(before, objs);
  const mine = at[objs.indexOf(o)];
  rememberObjects(after, at.map((s) => (s > mine ? s + delta : s)));
}

/**
 * New stitches for a fill in a new shape `form`: its settings stay (but for `change`), its rows fill
 * the new area, or with `knockout` (as the object had it, unless given) the area without what later
 * fills cover.
 */
export function reshapeFill(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, form: Form, trimMm: number, knockout?: boolean, change?: Partial<FillSettings>): RestitchResult | null {
  if (geoUse(remembered(p, o)) === 'band') return reshapeLineFill(p, objs, o, kinds, form, trimMm);
  const known = keepShape(p, o, kinds);
  const cut = knockout ?? !!remembered(p, o)?.knockout;
  const area = sewnArea(p, objs, o, form, cut, known.region?.pxMm ?? 0.1);
  if (!area) return null;
  // Settings it remembers, else measured from its stitches (when they read as a fill).
  let fill = known.fill;
  if (!fill) {
    const an = analyze(p, o, kinds, remembered(p, o));
    if (!an.fill) return null;
    fill = measureFill(p, an);
  }
  const s = { ...fill, ...change };
  const r = restitch(p, objs, [o.index], { kind: 'fill', s }, kinds, trimMm, undefined, false, undefined, new Map([[o.index, area]]));
  r.memory.forEach((m) => {
    Object.assign(m, withGeo(m, form));
    if (cut) {
      m.knockout = true;
      m.cut = cutKey(area);
    } else {
      delete m.knockout;
      delete m.cut;
    }
  });
  if (r.starts.length) keepGrouping(p, objs, o, r.pattern, totalStitches(r.pattern) - totalStitches(p));
  return r;
}

/**
 * Which lines across a satin column guide it over a new area, tried in turn until they make strips
 * of it: every few mm (closest first), then at its quarters, then one in its middle.
 */
const ACROSS: ({ step: number } | { at: number[] })[] = [{ step: 3 }, { step: 8 }, { step: 20 }, { at: [0.25, 0.5, 0.75] }, { at: [0.5] }];

/** A line across a column drawn on beyond its rails, so it still crosses an outline that got wider. */
function reaching([a, b]: [Pt, Pt]): [Pt, Pt] {
  const d: Pt = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(d[0], d[1]) || 1;
  const more = Math.max(1, len / 2) / len;
  return [
    [a[0] - d[0] * more, a[1] - d[1] * more],
    [b[0] + d[0] * more, b[1] + d[1] * more],
  ];
}

/** Where a satin column's stitches go across it (its rungs, else its pairs of penetrations), as lines in mm, from end to end. */
function pairsOf(c: Rails): [Pt, Pt][] {
  const cl = cumulative(c.left);
  const cr = cumulative(c.right);
  const la = cl[cl.length - 1];
  const lb = cr[cr.length - 1];
  if (c.rungs?.length) return [[0, 0] as Rung, ...c.rungs, [la, lb] as Rung].map(([a, b]) => [pointAt(c.left, cl, a), pointAt(c.right, cr, b)]);
  if (c.left.length === c.right.length) return c.left.map((q, i) => [q, c.right[i]]);
  const n = Math.max(c.left.length, c.right.length);
  return Array.from({ length: n }, (_, i) => [pointAt(c.left, cl, (la * i) / (n - 1)), pointAt(c.right, cr, (lb * i) / (n - 1))]);
}

/** Some of the lines across a column (see ACROSS): `step` mm apart along it with both ends, or at shares `at` of their number. */
function acrossOf(c: Rails, how: { step: number } | { at: number[] }): [Pt, Pt][] {
  const pairs = pairsOf(c);
  if (pairs.length < 2) return [];
  if ('at' in how) return how.at.map((f) => pairs[Math.round(f * (pairs.length - 1))]);
  // Distances along the middle of the column; the first and last line a little inside its ends,
  // where the outline still goes across (right at an end it may only touch it).
  const at = [0];
  for (let i = 1; i < pairs.length; i++) at.push(at[i - 1] + Math.hypot(...sub(mid(pairs[i]), mid(pairs[i - 1]))));
  const total = at[at.length - 1];
  const inset = Math.min(0.6, total / 4);
  const first = at.findIndex((d) => d >= inset);
  let last = pairs.length - 1;
  while (last > first && at[last] > total - inset) last--;
  if (first < 0 || last <= first) return [];
  const out: [Pt, Pt][] = [pairs[first]];
  let from = at[first];
  for (let i = first + 1; i < last; i++) {
    if (at[i] - from >= how.step && at[last] - at[i] >= how.step / 2) {
      out.push(pairs[i]);
      from = at[i];
    }
  }
  out.push(pairs[last]);
  return out;
}

const sub = (a: Pt, b: Pt): [number, number] => [a[0] - b[0], a[1] - b[1]];
const mid = (x: [Pt, Pt]): Pt => [(x[0][0] + x[1][0]) / 2, (x[0][1] + x[1][1]) / 2];

/** The point of the segment from `a` to `b` nearest to `q`. */
function nearestOn(q: Pt, [a, b]: [Pt, Pt]): Pt {
  const d = sub(b, a);
  const l2 = d[0] * d[0] + d[1] * d[1];
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / l2)) : 0;
  return [a[0] + t * d[0], a[1] + t * d[1]];
}

/** Distance from point `q` to the segment from `a` to `b`. */
const nearLine = (q: Pt, seg: [Pt, Pt]): number => Math.hypot(...sub(q, nearestOn(q, seg)));

/**
 * The satin columns for `area` that keep the directions of `cols` (the satin's columns before):
 * its lines across become the lines across the new area, the cut lines between its columns stay.
 * Null when they do not make strips of the new area.
 */
export function columnsOver(geo: Form, area: Region, cols: Rails[], before: Region | null, was: Form | null = null): Rails[] | null {
  return (cols.some((c) => c.split) ? null : columnByColumn(geo, cols, was)) ?? columnsOfArea(area, cols, before);
}

/**
 * Each column of a satin of a file over its own outline (its path of `geo`, as satinOutline made
 * them, edited), so columns that overlap keep their own directions; a column whose outline is as it
 * was (`was`) stays exactly as it is. Null when the paths are no longer one (or two, for a ring)
 * per column, or one of them makes no column.
 */
function columnByColumn(geo: Form, cols: Rails[], was: Form | null): Rails[] | null {
  const counts = outlinePaths(cols);
  if (counts.includes(0) || counts.reduce((a, b) => a + b, 0) !== geo.paths.length || !geo.paths.every((x) => x.closed)) return null;
  const out: Rails[] = [];
  let k = 0;
  for (const [i, c] of cols.entries()) {
    const mine = geo.paths.slice(k, k + counts[i]);
    const same = was?.paths.length === geo.paths.length && mine.every((x, j) => JSON.stringify(x) === JSON.stringify(was.paths[k + j]));
    k += counts[i];
    if (same) {
      out.push(c);
      continue;
    }
    const made = columnOver(
      mine.map((x) => flatten(x, 0.05)),
      c,
    );
    if (!made) return null;
    out.push({ ...made, ...(c.chain !== undefined ? { chain: c.chain } : {}), ...(c.mirror ? { mirror: true } : {}) });
  }
  return out;
}

/** One column over its outline (and its hole, for a column that goes all round): its lines across as before. */
function columnOver(loops: Pt[][], c: Rails): { left: Pt[]; right: Pt[]; rungs: Rung[] } | null {
  const area = (r: Pt[]) => Math.abs(r.reduce((a, q, i) => a + q[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * q[1], 0));
  const [outer, hole] = loops.length === 2 && area(loops[1]) > area(loops[0]) ? [loops[1], loops[0]] : loops;
  // A ring is cut open where it starts and ends.
  const seam = hole ? [reaching([c.left[0], c.right[0]])] : [];
  for (const how of ACROSS) {
    const lines = acrossOf(c, how)
      .filter((l) => !seam.some((cut) => nearLine(mid(l), cut) < Math.max(2, Math.hypot(...sub(l[1], l[0])))))
      .map(reaching);
    if (!hole) {
      const rails = railsFromOutline(outer, lines);
      if (rails) return rails;
      continue;
    }
    const made = stripsOfOutline(outer, lines, seam, [hole]);
    if (made.bad < 0 && made.hole < 0 && made.strips.length === 1) return made.strips[0];
  }
  // Lines across that make no strip of it (a column of a few stitches, say): each penetration
  // moved onto the nearest edge of the new outline, so the pairs and their directions stay.
  const onto = (q: Pt): Pt => {
    let best: Pt = q;
    let bd = Infinity;
    for (const ring of loops) {
      for (let i = 0; i < ring.length; i++) {
        const seg: [Pt, Pt] = [ring[i], ring[(i + 1) % ring.length]];
        const d = nearLine(q, seg);
        if (d < bd) {
          bd = d;
          best = nearestOn(q, seg);
        }
      }
    }
    return best;
  };
  const left = c.left.map(onto);
  const right = c.right.map(onto);
  return left.length >= 2 && right.length >= 2 ? { left, right, rungs: c.rungs ?? [] } : null;
}

/**
 * The columns of the whole area along the lines across all columns before, with the cut lines
 * between them (as a fill cut into strips is made). Null when they make no strips of it.
 */
function columnsOfArea(area: Region, cols: Rails[], before: Region | null): Rails[] | null {
  const { outsides, holes } = areaLoops(area);
  if (!outsides.length || !cols.length) return null;
  const split = cols.find((c) => c.split)?.split;
  const old = before ? areaLoops(before) : null;
  // Where a column ends inside the area (at another one, or at its own start: a ring) is a cut line.
  const cuts = split?.cuts ?? (old ? cutLinesBetween(cols, old.outsides, old.holes) : []);
  for (const how of ACROSS) {
    // Not near a cut line (the ends of a ring column lie on its own): there the column ends, it does not go across.
    const lines = cols
      .flatMap((c) => acrossOf(c, how))
      .filter((l) => !cuts.some((cut) => nearLine(mid(l), cut) < Math.max(2, Math.hypot(...sub(l[1], l[0])))))
      .map(reaching);
    if (!cuts.length && !holes.length && outsides.length === 1 && cols.length === 1) {
      const rails = railsFromOutline(outsides[0], lines);
      if (rails) return [{ ...rails, ...(cols[0].mirror ? { mirror: true } : {}) }];
      continue;
    }
    const made = stripsOfAreas(outsides, lines, cuts, holes);
    if (made.bad || made.hole >= 0 || !made.areas.length) continue;
    const columns: Rails[] = made.areas.flatMap((strips, a) => strips.map((r) => ({ ...r, chain: a })));
    if (!columns.length) continue;
    if (split) columns[0].split = { outlines: outsides, holes, cuts };
    return columns;
  }
  return null;
}

/**
 * New stitches for satin `o` over the area of `geo` (its outline edited): with its own satin
 * settings, its stitches going across as before where the new area allows (else as a satin made
 * from a fill finds them). Null when nothing could be sewn.
 */
export function reshapeSatin(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, geo: Form, trimMm: number): RestitchResult | null {
  const area = rasterize(geo);
  if (!area) return null;
  const known = keepShape(p, o, kinds);
  const part = analyze(p, o, kinds, remembered(p, o)).parts.find((pt) => pt.kind === 'satin');
  const satin = known.satin ?? (part ? measureSatin(p, part, kinds) : null);
  if (!satin) return null;
  const before = remembered(p, o)?.shape ?? known.region ?? railsArea(known.columns?.flat() ?? []);
  const guide = columnsOver(geo, area, known.columns?.flat() ?? [], before, satinOutline(p, o, kinds));
  const r = restitch(p, objs, [o.index], { kind: 'satin', s: satin }, kinds, trimMm, undefined, false, guide ? new Map([[o.index, guide]]) : undefined, new Map([[o.index, area]]));
  r.memory.forEach((m) => Object.assign(m, withGeo(m, geo)));
  if (r.starts.length) keepGrouping(p, objs, o, r.pattern, totalStitches(r.pattern) - totalStitches(p));
  return r.starts.length ? r : null;
}

/**
 * Object `o` sewn anew in form `geo` (edited on the level Form), whatever it is: a line along its
 * new paths, a fill or a band in its new area, a satin over it. Its stitch type and settings stay.
 * Null when nothing could be sewn there.
 */
/**
 * Fills `which` sewn as lines along their paths (see fillToLine), as one result; the links of the
 * borders and blends in threads of their own that go with them are in `drop`. Null when none could be.
 */
export function fillsToLines(p: Pattern, which: number[], trimMm: number, geo?: Form): (RestitchResult & { drop: Set<string> }) | null {
  let cur = p;
  const done: number[] = [];
  const failed: number[] = [];
  const drop = new Set<string>();
  for (const o of which) {
    const m = remembered(cur, sewObjects(cur)[o]);
    const r = fillToLine(cur, o, trimMm, geo);
    if (!r) {
      failed.push(o);
      continue;
    }
    for (const l of followerLinks(m)) drop.add(l);
    cur = r.pattern;
    done.push(o);
  }
  if (!done.length) return null;
  const objs = sewObjects(cur);
  const sewn = done.map((o) => objs[o]);
  return {
    pattern: cur,
    starts: sewn.map((o) => stitchesBefore(cur, o.first)),
    ends: sewn.map((o) => stitchesBefore(cur, o.last + 1)),
    failed,
    regions: sewn.map(() => null),
    memory: sewn.map((o) => remembered(cur, o)!),
    drop,
  };
}

/** One object sewn anew as a line, as what restitch gives. */
function asResult(r: { pattern: Pattern; first: number; last: number } | null): RestitchResult | null {
  if (!r) return null;
  const memory = remembered(r.pattern, sewObjects(r.pattern).find((x) => x.first === r.first)!)!;
  return { pattern: r.pattern, starts: [stitchesBefore(r.pattern, r.first)], ends: [stitchesBefore(r.pattern, r.last + 1)], failed: [], regions: [null], memory: [memory] };
}

export function reshapeObject(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, geo: Form, trimMm: number): RestitchResult | null {
  const known = remembered(p, o);
  if (sewnAlong(p, o)) return asResult(resewLine(p, o.index, geo, lineSettings(p, o, kinds), trimMm));
  if (geoUse(known) === 'band') return reshapeLineFill(p, objs, o, kinds, geo, trimMm);
  // Its last closed path opened: nothing left to fill, it is sewn along its paths, its fill kept
  // to fill it again once a path is closed (see fillToLine).
  if (!fits(geo, 'fill') && (knownKind(known) ?? o.kind) === 'fill') return asResult(fillToLine(p, o.index, trimMm, geo));
  if ((knownKind(known) ?? o.kind) === 'satin') return reshapeSatin(p, objs, o, kinds, geo, trimMm);
  return reshapeFill(p, objs, o, kinds, geo, trimMm);
}

/** Why an object cannot be scaled (its parts would need different settings), or null. */
export function scaleBlocked(p: Pattern, o: SewObject, kinds: Uint8Array): 'mixed' | null {
  const an = analyze(p, o, kinds);
  const fill = an.parts.some((pt) => pt.kind === 'fill');
  const satin = an.parts.some((pt) => pt.kind === 'satin');
  return fill && satin ? 'mixed' : null;
}

/** The settings an object is sewn with: what it remembers, else measured from its stitches. */
function settingsOf(p: Pattern, o: SewObject, kinds: Uint8Array): Settings | null {
  const known = remembered(p, o);
  const an = analyze(p, o, kinds, known);
  const satinPart = an.parts.find((pt) => pt.kind === 'satin');
  const runPart = an.parts.find((pt) => pt.kind === 'run');
  if (an.fill && an.parts.some((pt) => pt.kind === 'fill')) return { kind: 'fill', s: known?.fill ?? measureFill(p, an) };
  if (satinPart) return { kind: 'satin', s: known?.satin ?? measureSatin(p, satinPart, kinds) };
  if (runPart) return { kind: 'run', s: measureRun(p, runPart) };
  return null;
}

export interface Transformed {
  pattern: Pattern;
  /** Records of the object in the new pattern. */
  first: number;
  last: number;
  /** New stitches were made (scaled), so the density has to be measured again. */
  restitched: boolean;
}

/**
 * Object `o` moved, turned, mirrored or scaled by `m` (world mm). Moving, turning and mirroring
 * take the stitches along as they are; scaling sews the object anew in its scaled shape (fill
 * area, satin rails, running path) with its own settings, so density and stitch lengths stay.
 * What the object remembers goes along. Null when scaling did not work.
 */
export function transformSewObject(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, m: Mat, trimMm: number): Transformed | null {
  const known = remembered(p, o);
  // Stitches loosed from their shape go along as they are, also scaled (the resting shape with them).
  const rigid = isRigid(m) || !!known?.free;
  // A line with its paths: scaled or mirrored, it is sewn anew along them with its settings
  // (mirrored, its stitches would go round its echo copies and satin the other way than sewing it
  // along the mirrored paths does).
  // Turned, its echo copies are laid out anew too: where a copy starts and the travel to it come
  // from choices along the turned paths (the nearest point, a pixel grid), so the turned stitches
  // can part from the copies of the turned line.
  const line = lineGeoOf(known);
  const mirrors = m[0] * m[3] - m[1] * m[2] < 0;
  const turns = m[0] !== 1 || m[1] !== 0 || m[2] !== 0 || m[3] !== 1;
  if (line && (!rigid || ((mirrors || (turns && !!known?.line?.echo)) && !known?.free))) {
    const r = resewLine(p, o.index, transformForm(line, m), mirroredEcho(lineSettings(p, o, kinds), line, m), trimMm);
    return r && { ...r, restitched: true };
  }
  // A fill along a line: filled anew along the scaled line, in a width scaled with it.
  if (geoUse(known) === 'band' && !rigid) {
    const width = known!.fill!.lineWidth! * scaleOf(m);
    const r = reshapeLineFill(p, objs, o, kinds, transformForm(geoOf(known)!, m), trimMm, width);
    const fresh = r?.starts.length ? sewObjects(r.pattern).find((x) => stitchesBefore(r.pattern, x.first) === r.starts[0]) : undefined;
    if (!r || !fresh) return null;
    rememberRange(r.pattern, fresh.first, fresh.last, r.memory[0]);
    return { pattern: r.pattern, first: fresh.first, last: fresh.last, restitched: true };
  }
  // Moved, turned or mirrored: the stitches go along in the object list, with what it remembers.
  if (rigid) {
    const list = listOf(p);
    const k = list.findIndex((e) => e.obj.index === o.index);
    list[k] = { ...list[k], map: m, memory: known ? transformRemembered(known, m) : null };
    const next = sewList(p, list, trimMm);
    const now = sewObjects(next).find((x) => x.id === o.id);
    return now ? { pattern: next, first: now.first, last: now.last, restitched: false } : null;
  }
  // Scaled: what it remembers is scaled in the object list, and it is sewn anew from that.
  const scaled = known && transformRemembered(known, m);
  if (scaled && specOf(p, o, scaled)) {
    const list = listOf(p);
    const k = list.findIndex((e) => e.obj.index === o.index);
    list[k] = { ...list[k], sew: true, memory: scaled };
    const next = sewList(p, list, trimMm);
    const now = sewObjects(next).find((x) => x.id === o.id);
    return now ? { pattern: next, first: now.first, last: now.last, restitched: true } : null;
  }
  const kept = keepShape(p, o, kinds);
  // Settings as the object has them now (measured after scaling, the rows would be wider apart).
  const given = settingsOf(p, o, kinds);
  if (!given) return null;
  const moved = transformObject(p, o, m);
  const next = moved.pattern;
  const after = kept && transformRemembered(kept, m);
  // The objects stay as they were, with what this one remembers on its new stitches.
  keepGrouping(p, objs, o, next, 0);
  if (after) rememberRange(next, moved.first, moved.last, after);
  const nk = stitchKinds(next);
  const nobjs = sewObjects(next, nk);
  const no = nobjs.find((x) => x.first === moved.first);
  if (!no) return null;
  const r = restitch(next, nobjs, [no.index], given, nk, trimMm);
  if (!r.starts.length) return null;
  // The scaled curves stay the shape.
  const scaledArea = areaOf(after);
  if (scaledArea) r.memory.forEach((x) => Object.assign(x, withGeo(x, scaledArea)));
  keepGrouping(p, objs, o, r.pattern, totalStitches(r.pattern) - totalStitches(p));
  const fresh = sewObjects(r.pattern);
  const start = r.starts[0];
  const obj = fresh.find((x) => stitchesBefore(r.pattern, x.first) === start);
  if (!obj) return null;
  rememberRange(r.pattern, obj.first, obj.last, r.memory[0]);
  return { pattern: r.pattern, first: obj.first, last: obj.last, restitched: true };
}

type Seq = (p: Pattern) => { objects: SewObject[]; kinds: Uint8Array };
const sequenceOf: Seq = (q) => {
  const kinds = stitchKinds(q);
  return { objects: sewObjects(q, kinds), kinds };
};

/** The objects `sel` moved, turned or scaled by `m` together; with the changes by hand it sewed over. */
export interface TransformedAll {
  pattern: Pattern;
  hand: number;
  restitched: boolean;
}

/** The objects `sel` (in sewing order) transformed by `m`, the last first so the ones before keep their records. */
export function transformObjects(p: Pattern, sel: number[], m: Mat, trimMm: number, seq: Seq = sequenceOf): TransformedAll | null {
  let cur = p;
  let hand = 0;
  let restitched = false;
  for (const o of [...sel].reverse()) {
    const q = seq(cur);
    const obj = q.objects[o];
    if (!obj) return null;
    hand += remembered(cur, obj)?.hand ?? 0;
    const r = transformSewObject(cur, q.objects, obj, q.kinds, m, trimMm);
    if (!r) return null;
    restitched ||= r.restitched;
    cur = r.pattern;
  }
  return { pattern: cur, hand, restitched };
}

/**
 * The objects `sel` scaled by `sx` × `sy` about (cx, cy) in mm so their stitches come out that
 * much larger, with the map that did it. Sewn anew, an object's stitches reach a little past its
 * shape (pull compensation, the edge) by as much at any size, so the factors as given would leave
 * a circle typed 60 mm wide at 59,8 mm. The first trial corrects for that margin where the shapes
 * are known; then secant steps on what came out, until the stitches have the size asked for to a
 * twentieth of a millimetre, or the closest trial. Null when the objects cannot be scaled.
 */
export function fitScaling(p: Pattern, sel: number[], sx: number, sy: number, cx: number, cy: number, trimMm: number, seq: Seq = sequenceOf): { m: Mat; done: TransformedAll } | null {
  // Width and height of the stitches in tenths of a millimetre, null when the objects changed.
  const extent = (q: Pattern): [number, number] | null => {
    const all = seq(q).objects;
    if (all.length !== seq(p).objects.length) return null;
    const objs = sel.map((o) => all[o]);
    return [Math.max(...objs.map((o) => o.maxX)) - Math.min(...objs.map((o) => o.minX)), Math.max(...objs.map((o) => o.maxY)) - Math.min(...objs.map((o) => o.minY))];
  };
  const was = extent(p);
  if (!was) return null;
  const goal = [was[0] * sx, was[1] * sy];
  // A side without extent (a straight line) stays as it is.
  const fixed = (k: number) => was[k] < 5;
  // The first guess: the shapes (or lines) grow, the margin of the stitches around them stays.
  const shapes = sel.map((o) => {
    const known = remembered(p, seq(p).objects[o]);
    return areaOf(known) ?? lineGeoOf(known);
  });
  const boxes = shapes.map((f) => f && bounds(f));
  let f = [sx, sy];
  let mid: number[] | null = null;
  if (boxes.every((b) => b)) {
    const lo = [Math.min(...boxes.map((b) => b!.minX)), Math.min(...boxes.map((b) => b!.minY))];
    const hi = [Math.max(...boxes.map((b) => b!.maxX)), Math.max(...boxes.map((b) => b!.maxY))];
    const size = [0, 1].map((k) => (hi[k] - lo[k]) * 10);
    mid = [0, 1].map((k) => (lo[k] + hi[k]) / 2);
    f = [0, 1].map((k) => {
      const g = (goal[k] - (was[k] - size[k])) / size[k];
      return fixed(k) || !(size[k] > 5) || !(g > f[k] / 2 && g < f[k] * 2) ? f[k] : g;
    });
  }
  // Stitches lie on a 0.1 mm grid: a shape even about its middle (a circle) grows by a tenth at both
  // ends at once, so its width stays even with the middle on a grid line, odd with it between two.
  // Its middle goes where the size asked for needs it, at most half a tenth to the side.
  const shift = (k: number, fk: number) => {
    if (!mid || fixed(k)) return 0;
    const c = k ? cy : cx;
    const u = (c + fk * (mid[k] - c)) * 10;
    return ((Math.round(goal[k]) % 2 === 0 ? Math.round(u) : Math.floor(u) + 0.5) - u) / 10;
  };
  // Per side: the factors tried and the sizes they gave, the size now at factor 1 among them.
  const tried: [number, number][][] = [[[1, was[0]]], [[1, was[1]]]];
  let best: { m: Mat; done: TransformedAll } | null = null;
  let miss = Infinity;
  // Each trial sews the objects anew: more while they are quick, the closest one is kept.
  const start = performance.now();
  for (let step = 0; step < 6 && (step === 0 || performance.now() - start < 1200); step++) {
    const sc = scaling(f[0], f[1], cx, cy);
    const m: Mat = [sc[0], sc[1], sc[2], sc[3], sc[4] + shift(0, f[0]), sc[5] + shift(1, f[1])];
    const done = transformObjects(p, sel, m, trimMm, seq);
    const got = done && extent(done.pattern);
    if (!done || !got) return best;
    const offs = [0, 1].map((k) => (fixed(k) ? 0 : Math.abs(got[k] - goal[k])));
    if (Math.max(...offs) < miss) {
      miss = Math.max(...offs);
      best = { m, done };
    }
    if (miss < 0.5) break;
    let moved = false;
    for (const k of [0, 1]) {
      if (fixed(k) || offs[k] < 0.5) continue;
      const pts = tried[k];
      pts.push([f[k], got[k]]);
      // Between the closest factor that came out too small and the closest too large, when there are both.
      const below = pts.filter((q) => q[1] < goal[k]).sort((u, v) => v[1] - u[1] || v[0] - u[0])[0];
      const above = pts.filter((q) => q[1] > goal[k]).sort((u, v) => u[1] - v[1] || u[0] - v[0])[0];
      let [[s0, w0], [s1, w1]] = below && above ? [below, above] : pts.slice(-2);
      // The same size twice (between two jumps): the slope from the size now instead.
      if (Math.abs(w1 - w0) < 1e-9) [s0, w0] = pts[0];
      let g = Math.abs(w1 - w0) < 1e-9 ? f[k] : Math.abs(s1 - s0) < 1e-9 ? (s1 * goal[k]) / w1 : s1 + ((goal[k] - w1) * (s1 - s0)) / (w1 - w0);
      // The size jumps as the edge falls anew: a factor tried before is halved toward the other side instead.
      if (below && above && pts.some((q) => Math.abs(q[0] - g) < 1e-9)) g = (below[0] + above[0]) / 2;
      if (g > f[k] / 2 && g < f[k] * 2 && g !== f[k]) {
        f[k] = g;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return best;
}

