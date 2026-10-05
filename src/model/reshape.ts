import type { Form, Mat } from '../shape/path';
import { FIT_TOLERANCE, READ_TOLERANCE, vectorize } from '../shape/vectorize';
import { cutKey, sewnArea } from './knockout';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import { STITCH, type Pattern } from './pattern';
import { analyze, keepShape, measureFill, measureRun, measureSatin, remembered, rememberRange, restitch, type RestitchResult, type Settings } from './restitch';
import { stitchKinds } from './sequence';
import { isRigid, stitchesBefore, transformObject, transformRemembered } from './transform';

/**
 * The fill area of an object as curves: the curves it was given here, else its area (kept or
 * read from the stitches) traced. Null for objects without a fill.
 */
export function formOf(p: Pattern, o: SewObject, kinds: Uint8Array): Form | null {
  const known = remembered(p, o);
  if (known?.form) return known.form;
  const an = analyze(p, o, kinds, known);
  if (!an.fill || !an.parts.some((pt) => pt.kind === 'fill')) return null;
  // The exact area of a design made here, or one read from the stitches (rougher).
  const exact = known && !known.read && known.region === an.fill;
  const f = vectorize(an.fill, exact ? FIT_TOLERANCE : READ_TOLERANCE);
  return f.paths.length ? f : null;
}

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
 * New stitches for a fill in a new shape `form`: its settings stay, its rows fill the new area, or
 * with `knockout` (as the object had it, unless given) the area without what later fills cover.
 */
export function reshapeFill(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, form: Form, trimMm: number, knockout?: boolean): RestitchResult | null {
  const known = keepShape(p, o, kinds);
  const cut = knockout ?? !!remembered(p, o)?.knockout;
  const area = sewnArea(p, objs, o, form, cut, known.region?.pxMm ?? 0.1);
  if (!area) return null;
  const an = analyze(p, o, kinds, remembered(p, o));
  if (!an.fill) return null;
  const s = known.fill ?? measureFill(p, an);
  const r = restitch(p, objs, [o.index], { kind: 'fill', s }, kinds, trimMm, undefined, false, undefined, new Map([[o.index, area]]));
  r.memory.forEach((m) => {
    m.form = form;
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
  const rigid = isRigid(m);
  const known = rigid ? remembered(p, o) : keepShape(p, o, kinds);
  // Settings as the object has them now (measured after scaling, the rows would be wider apart).
  const given = rigid ? null : settingsOf(p, o, kinds);
  if (!rigid && !given) return null;
  const moved = transformObject(p, o, m);
  const next = moved.pattern;
  const after = known && transformRemembered(known, m);
  // The objects stay as they were, with what this one remembers on its new stitches.
  keepGrouping(p, objs, o, next, 0);
  if (after) rememberRange(next, moved.first, moved.last, after);
  if (rigid) return { ...moved, restitched: false };
  const nk = stitchKinds(next);
  const nobjs = sewObjects(next, nk);
  const no = nobjs.find((x) => x.first === moved.first);
  if (!no) return null;
  if (!given) return null;
  const r = restitch(next, nobjs, [no.index], given, nk, trimMm);
  if (!r.starts.length) return null;
  // The scaled curves stay the shape.
  if (after?.form) r.memory.forEach((x) => (x.form = after.form));
  keepGrouping(p, objs, o, r.pattern, totalStitches(r.pattern) - totalStitches(p));
  const fresh = sewObjects(r.pattern);
  const start = r.starts[0];
  const obj = fresh.find((x) => stitchesBefore(r.pattern, x.first) === start);
  if (!obj) return null;
  rememberRange(r.pattern, obj.first, obj.last, r.memory[0]);
  return { pattern: r.pattern, first: obj.first, last: obj.last, restitched: true };
}
