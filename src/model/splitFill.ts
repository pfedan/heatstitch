import type { Pt } from '../digitize/skeleton';
import { splitForm } from '../shape/ops';
import type { FillSettings } from './restitch';
import { newLink, syncBorders } from './border';
import { takeOver, wholeArea } from './knockout';
import { sewObjects } from './objects';
import type { Pattern } from './pattern';
import { reshapeFill } from './reshape';
import { analyze, borderOf, remember, remembered, withLine } from './restitch';
import { stitchKinds } from './sequence';
import { addShape } from './addShape';
import { digitizeDefaults } from '../digitize/digitize';
import { DEFAULT_PROFILE } from '../validation/profiles';
import { fits, geoUse, guessArea } from './geo';

/**
 * Splitting a fill along cut lines (freehand, a path or a straight line): each part becomes an
 * object of its own, sewn right after the one before (trimmed off it, as objects of one thread are
 * kept apart), with the settings of the fill. Neighbouring
 * parts get mirrored row directions (mirrored at the cut, as the veins of a leaf), and each part
 * reaches OVERLAP_MM under its neighbours, so no fabric shows along the cut. The parts stay one
 * whole (Remembered.piece): a border of the fill stays one border around them all, never along the
 * cut (see syncOwnBorders). A fill with a color blend is not cut.
 */

/** Parts reach this far across the cut under their neighbours (mm). */
export const OVERLAP_MM = 0.2;
/** A cut that ends this close to the edge (inside the area) is taken through to it (mm). */
const REACH_MM = 2;
/** Pieces smaller than this (mm²) are no parts of their own; they go to their neighbour. */
const MIN_PART_MM2 = 0.5;
/** Mirrored directions closer than this to the original (degrees) are turned a right angle instead. */
const MIN_TURN = 20;

/** Direction of a cut from its first to its last point, degrees 0 to 180. */
function cutAngle(cut: Pt[]): number {
  const a = cut[0];
  const b = cut[cut.length - 1];
  return (((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 180 + 180) % 180;
}

/**
 * Row directions for the parts: the first keeps `base`, a part touching one of the other kind gets
 * `base` mirrored at the (main) cut, so the rows meet at the cut like the veins of a leaf.
 */
export function partAngles(count: number, touching: [number, number][], base: number, cuts: Pt[][]): number[] {
  const along = cuts.length ? cutAngle(cuts.reduce((a, b) => (pathLength(b) > pathLength(a) ? b : a))) : 0;
  let other = (((2 * along - base) % 180) + 180) % 180;
  const diff = Math.abs(other - base) % 180;
  if (Math.min(diff, 180 - diff) < MIN_TURN) other = (base + 90) % 180;
  // Two colors over the parts that touch, from the largest.
  const side = new Array<number>(count).fill(-1);
  for (let s = 0; s < count; s++) {
    if (side[s] >= 0) continue;
    side[s] = 0;
    const queue = [s];
    while (queue.length) {
      const a = queue.shift()!;
      for (const [x, y] of touching) {
        const b = x === a ? y : y === a ? x : -1;
        if (b < 0 || side[b] >= 0) continue;
        side[b] = 1 - side[a];
        queue.push(b);
      }
    }
  }
  return side.map((k) => Math.round(k ? other : base) % 180);
}

const pathLength = (pts: Pt[]) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

export interface Split {
  pattern: Pattern;
  /** The parts, as objects of `pattern`, in sewing order. */
  parts: number[];
  /** How many parts were too small for the fill's pattern and got plain rows. */
  plain: number;
}

/**
 * Whether object `o` is a fill that can be split: an area sewn with a fill whose settings Heatstitch
 * knows (drawn, converted or changed here; fills of a stitch file as it came are not yet), not a
 * fill sewn as a line, one with a color blend or one loosed from its shape.
 */
export function canSplit(p: Pattern, o: number): boolean {
  const kinds = stitchKinds(p);
  const obj = sewObjects(p, kinds)[o];
  if (!obj) return false;
  const known = remembered(p, obj);
  // Loosed from its shape (changed by hand): its stitches are not sewn anew, so not cut apart either.
  if (!known?.fill || known.free || geoUse(known) === 'band' || known.outline || known.blendOf || known.fill.deco?.blend) return false;
  if (!analyze(p, obj, kinds, known).fill) return false;
  const form = guessArea(p, obj, kinds);
  return fits(form, 'fill') && !!wholeArea(form!);
}

/**
 * Fill `o` split along `cuts` (world mm) into objects of their own, sewn one after the other where
 * it was. 'whole' when the cuts do not cut it apart, null when it is no fill or sewing failed. Needs
 * loadOps (the cut runs on the curves).
 */
export function splitFill(p: Pattern, o: number, cuts: Pt[][], trimMm: number): Split | 'whole' | null {
  if (!canSplit(p, o)) return null;
  const kinds = stitchKinds(p);
  const obj = sewObjects(p, kinds)[o];
  const known = remembered(p, obj);
  const form = guessArea(p, obj, kinds)!;
  // Cut on the curves: the parts keep the outline of the fill as it was.
  const split = splitForm(form, cuts, OVERLAP_MM, MIN_PART_MM2, REACH_MM);
  if (!split) return 'whole';
  const forms = split.parts;
  const base = known!.fill!.angle;
  const angles = partAngles(forms.length, split.touching, base, cuts);
  // The border waits until all parts are there (sewn now, it would run along the cut too).
  const border = borderOf(known);
  const change = (k: number): Partial<FillSettings> => ({ angle: angles[k] });
  // Every further part a new fill right after the fill (the last first, so they come in order), in
  // its shape; then each sewn with the fill's settings, and the fill itself in the shape of the
  // first part (from the last, so the ones before keep their place).
  let cur = p;
  const options = { ...digitizeDefaults(DEFAULT_PROFILE), trimMm };
  for (let k = forms.length - 1; k >= 1; k--) {
    const a = addShape(cur, { form: forms[k], kind: 'fill' }, obj.color, o, options);
    if (!a) return null;
    cur = a.pattern;
    // It is a fill with the fill's settings (also when, small, its stitches would read as a line),
    // and leaves out what lies on top of it as the fill did.
    const part = sewObjects(cur)[o + 1];
    const leaveOut = known!.knockout ? { knockout: true, ...(known!.overlapShare !== undefined ? { overlapShare: known!.overlapShare } : {}) } : {};
    remember(cur, part, { ...remembered(cur, part), region: remembered(cur, part)?.region ?? null, fill: { ...known!.fill!, ...change(k) }, ...leaveOut });
  }
  if (sewObjects(cur).length !== sewObjects(p).length + forms.length - 1) return null;
  let plain = 0;
  for (let k = forms.length - 1; k >= 0; k--) {
    const ks = stitchKinds(cur);
    const objs = sewObjects(cur, ks);
    const settings = { ...known!.fill!, ...change(k) };
    const r = reshapeFill(cur, objs, objs[o + k], ks, forms[k], trimMm, undefined, settings);
    let next = r && takeOver(r);
    // A part too small or too narrow for the fill's pattern (an open grid, a maze) gets plain rows.
    if (!next && settings.pattern !== 'tatami') {
      const { deco: _d, ...rest } = settings;
      const t = reshapeFill(cur, objs, objs[o + k], ks, forms[k], trimMm, undefined, { ...rest, pattern: 'tatami' });
      next = t && takeOver(t);
      if (next) plain++;
    }
    if (!next) return null;
    cur = next;
  }
  // The first part is the fill as it goes on: it keeps its id. All parts are one whole (a part cut
  // again stays in its whole) and keep the fill's border: one around them all, where it was.
  const piece = known!.piece ?? newLink();
  const objs = sewObjects(cur);
  for (let k = 0; k < forms.length; k++) {
    const m = remembered(cur, objs[o + k]);
    if (!m?.fill) return null;
    remember(cur, objs[o + k], withLine({ ...m, ...(k ? {} : { id: obj.id }), piece }, border && { ...border }));
  }
  cur = syncBorders(cur, trimMm);
  return { pattern: cur, parts: forms.map((_, k) => o + k), plain };
}
