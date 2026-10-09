import { listOf, sewList, specOf } from './sew';
import { lineSettings, reshapeLineFill, resewLine } from './line';
import { bounds, scaling, transformForm, type Form, type Mat } from '../shape/path';
import { cutKey, sewnArea } from './knockout';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import { STITCH, type Pattern } from './pattern';
import { analyze, keepShape, measureFill, measureRun, measureSatin, remembered, rememberRange, restitch, type FillSettings, type RestitchResult, type Settings } from './restitch';
import { stitchKinds } from './sequence';
import { isRigid, mirroredEcho, scaleOf, stitchesBefore, transformObject, transformRemembered } from './transform';
import { areaOf, geoOf, geoUse, lineGeoOf, withGeo } from './geo';

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
  if (remembered(p, o)?.asLine) return reshapeLineFill(p, objs, o, kinds, form, trimMm);
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
    Object.assign(m, withGeo(m, form, 'area'));
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
  // Stitches loosed from their shape go along as they are, also scaled (the resting shape with them).
  const rigid = isRigid(m) || !!remembered(p, o)?.free;
  // A line with its curves: scaled or mirrored, it is sewn anew along them with its settings
  // (mirrored, its stitches would go round its echo copies and satin the other way than sewing it
  // along the mirrored curves does).
  const line = lineGeoOf(remembered(p, o));
  const mirrors = m[0] * m[3] - m[1] * m[2] < 0;
  if (line && (!rigid || (mirrors && !remembered(p, o)?.free))) {
    const r = resewLine(p, o.index, transformForm(line, m), mirroredEcho(lineSettings(p, o, kinds), line, m), trimMm);
    return r && { ...r, restitched: true };
  }
  // A fill along a line: filled anew along the scaled line, in a width scaled with it.
  const along = remembered(p, o);
  if (geoUse(along) === 'band' && !rigid) {
    const width = (along!.fill!.lineWidth ?? along!.asLine!.line.width) * scaleOf(m);
    const r = reshapeLineFill(p, objs, o, kinds, transformForm(geoOf(along)!, m), trimMm, width);
    const fresh = r?.starts.length ? sewObjects(r.pattern).find((x) => stitchesBefore(r.pattern, x.first) === r.starts[0]) : undefined;
    if (!r || !fresh) return null;
    rememberRange(r.pattern, fresh.first, fresh.last, r.memory[0]);
    return { pattern: r.pattern, first: fresh.first, last: fresh.last, restitched: true };
  }
  // Moved, turned or mirrored: the stitches go along in the object list, with what it remembers.
  if (rigid) {
    const known = remembered(p, o);
    const list = listOf(p);
    const k = list.findIndex((e) => e.obj.index === o.index);
    list[k] = { ...list[k], map: m, memory: known ? transformRemembered(known, m) : null };
    const next = sewList(p, list, trimMm);
    const now = sewObjects(next).find((x) => x.id === o.id);
    return now ? { pattern: next, first: now.first, last: now.last, restitched: false } : null;
  }
  // Scaled: what it remembers is scaled in the object list, and it is sewn anew from that.
  const shaped = remembered(p, o);
  const scaled = shaped && transformRemembered(shaped, m);
  if (scaled && specOf(p, o, scaled)) {
    const list = listOf(p);
    const k = list.findIndex((e) => e.obj.index === o.index);
    list[k] = { ...list[k], sew: true, memory: scaled };
    const next = sewList(p, list, trimMm);
    const now = sewObjects(next).find((x) => x.id === o.id);
    return now ? { pattern: next, first: now.first, last: now.last, restitched: true } : null;
  }
  const known = keepShape(p, o, kinds);
  // Settings as the object has them now (measured after scaling, the rows would be wider apart).
  const given = settingsOf(p, o, kinds);
  if (!given) return null;
  const moved = transformObject(p, o, m);
  const next = moved.pattern;
  const after = known && transformRemembered(known, m);
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
  if (scaledArea) r.memory.forEach((x) => Object.assign(x, withGeo(x, scaledArea, 'area')));
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

