import type { Pt } from '../digitize/skeleton';
import type { Region } from '../digitize/region';
import { distanceToSeeds } from '../image/edt';
import { regionOf } from '../shape/rasterize';
import { vectorize } from '../shape/vectorize';
import type { Form } from '../shape/path';
import { takeOver, wholeArea } from './knockout';
import { sewObjects } from './objects';
import type { Pattern } from './pattern';
import { formOf, reshapeFill } from './reshape';
import { analyze, measureFill, remembered } from './restitch';
import { stitchKinds } from './sequence';
import { duplicateObjects } from './shapeOps';

/**
 * Splitting a fill along cut lines (freehand, a path or a straight line): each part becomes an
 * object of its own, sewn right after the one before (trimmed off it, as objects of one thread are
 * kept apart), with the settings of the fill. Neighbouring
 * parts get mirrored row directions (mirrored at the cut, as the veins of a leaf), and each part
 * reaches OVERLAP_MM under its neighbours, so no fabric shows along the cut.
 */

/** Parts reach this far across the cut under their neighbours (mm). */
export const OVERLAP_MM = 0.2;
/** A cut that ends this close to the edge (inside the area) is taken through to it (mm). */
const REACH_MM = 2;
/** Pieces smaller than this (mm²) are no parts of their own; they go to their neighbour. */
const MIN_PART_MM2 = 0.5;
/** Mirrored directions closer than this to the original (degrees) are turned a right angle instead. */
const MIN_TURN = 20;

export interface SplitArea {
  /** The parts, each grown by the overlap under its neighbours. */
  parts: Region[];
  /** Which parts touch each other (by index). */
  touching: [number, number][];
}

const inside = (r: Region, [x, y]: Pt): boolean => {
  const i = Math.floor(x / r.pxMm) - r.x0;
  const j = Math.floor(y / r.pxMm) - r.y0;
  return i >= 0 && j >= 0 && i < r.w && j < r.h && !!r.mask[j * r.w + i];
};

/** The cut with ends that stop short inside the area carried on to the edge (up to REACH_MM). */
function reaching(r: Region, cut: Pt[]): Pt[] {
  if (cut.length < 2) return cut;
  const carry = (end: Pt, before: Pt): Pt => {
    if (!inside(r, end)) return end;
    const d = Math.hypot(end[0] - before[0], end[1] - before[1]);
    if (!d) return end;
    const ux = (end[0] - before[0]) / d;
    const uy = (end[1] - before[1]) / d;
    for (let t = r.pxMm; t <= REACH_MM; t += r.pxMm) {
      const q: Pt = [end[0] + ux * t, end[1] + uy * t];
      if (!inside(r, q)) return [end[0] + ux * (t + r.pxMm), end[1] + uy * (t + r.pxMm)];
    }
    return end;
  };
  const out = cut.slice();
  out[0] = carry(cut[0], cut[1]);
  out[out.length - 1] = carry(cut[cut.length - 1], cut[cut.length - 2]);
  return out;
}

/**
 * The area `r` cut along `cuts` (world mm): the parts, largest first, or null when the cuts leave
 * it in one piece.
 */
export function splitArea(r: Region, cuts: Pt[][], overlap = OVERLAP_MM): SplitArea | null {
  const { w, h, pxMm, x0, y0 } = r;
  const n = w * h;
  // The cut as a line of pixels thick enough that no part reaches across it.
  const bar = new Uint8Array(n);
  const half = 0.75;
  for (const raw of cuts) {
    const cut = reaching(r, raw).map(([x, y]) => [x / pxMm - x0 - 0.5, y / pxMm - y0 - 0.5] as Pt);
    for (let k = 1; k < cut.length; k++) {
      const [ax, ay] = cut[k - 1];
      const [bx, by] = cut[k];
      const minX = Math.max(0, Math.floor(Math.min(ax, bx) - half));
      const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + half));
      const minY = Math.max(0, Math.floor(Math.min(ay, by) - half));
      const maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by) + half));
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
          if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= half) bar[y * w + x] = 1;
        }
      }
    }
  }
  // Pieces on either side.
  const label = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!r.mask[i] || bar[i] || label[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const x = j % w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
        if (k < 0 || k >= n || !r.mask[k] || bar[k] || label[k] >= 0) continue;
        label[k] = id;
        stack.push(k);
      }
    }
    sizes.push(size);
  }
  const minPx = MIN_PART_MM2 / (pxMm * pxMm);
  const kept = sizes.map((s, id) => ({ s, id })).filter((x) => x.s >= minPx).sort((a, b) => b.s - a.s);
  if (kept.length < 2) return null;
  // Every pixel of the area (the cut and crumbs too) to its nearest part; each part grows by the overlap.
  const fields = kept.map(({ id }) => distanceToSeeds(Uint8Array.from(label, (l) => (l === id ? 1 : 0)), w, h));
  const owner = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!r.mask[i]) continue;
    let best = 0;
    for (let k = 1; k < fields.length; k++) if (fields[k][i] < fields[best][i]) best = k;
    owner[i] = best;
  }
  const reach = overlap / pxMm;
  const parts: Region[] = [];
  for (let k = 0; k < kept.length; k++) {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (r.mask[i] && (owner[i] === k || fields[k][i] <= reach)) mask[i] = 1;
    const part = regionOf(mask, x0, y0, w, h, pxMm);
    if (!part) return null;
    parts.push(part);
  }
  const touch = new Set<string>();
  for (let i = 0; i < n; i++) {
    if (owner[i] < 0) continue;
    for (const j of [i % w < w - 1 ? i + 1 : -1, i + w]) {
      if (j < 0 || j >= n || owner[j] < 0 || owner[j] === owner[i]) continue;
      const a = Math.min(owner[i], owner[j]);
      const b = Math.max(owner[i], owner[j]);
      touch.add(`${a},${b}`);
    }
  }
  return { parts, touching: [...touch].map((s) => s.split(',').map(Number) as [number, number]) };
}

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
}

/** Whether object `o` is a fill that can be split (an area sewn with a fill, not a fill sewn as a line). */
export function canSplit(p: Pattern, o: number): boolean {
  const kinds = stitchKinds(p);
  const obj = sewObjects(p, kinds)[o];
  if (!obj) return false;
  const known = remembered(p, obj);
  if (known?.asLine || known?.outline || known?.blendOf) return false;
  if (!analyze(p, obj, kinds, known).fill) return false;
  const form = formOf(p, obj, kinds);
  return !!form && !!wholeArea(form);
}

/**
 * Fill `o` split along `cuts` (world mm) into objects of their own, sewn one after the other where
 * it was. 'whole' when the cuts do not cut it apart, null when it is no fill or sewing failed.
 */
export function splitFill(p: Pattern, o: number, cuts: Pt[][], trimMm: number): Split | 'whole' | null {
  if (!canSplit(p, o)) return null;
  const kinds = stitchKinds(p);
  const obj = sewObjects(p, kinds)[o];
  const known = remembered(p, obj);
  const form = formOf(p, obj, kinds)!;
  const whole = wholeArea(form)!;
  const split = splitArea(whole, cuts);
  if (!split) return 'whole';
  const forms: Form[] = split.parts.map((r) => vectorize(r));
  if (forms.some((f) => !f.paths.length)) return null;
  const base = known?.fill?.angle ?? measureFill(p, analyze(p, obj, kinds, known)).angle;
  const angles = partAngles(forms.length, split.touching, base, cuts);
  // The fill once more for every further part, each copy right after it.
  let cur = p;
  for (let k = 1; k < forms.length; k++) {
    const d = duplicateObjects(cur, [o], trimMm, 0);
    if (!d || d.copies[0] !== o + 1) return null;
    cur = d.pattern;
  }
  // Then every copy in the shape of its part (from the last, so the ones before keep their place).
  for (let k = forms.length - 1; k >= 0; k--) {
    const ks = stitchKinds(cur);
    const objs = sewObjects(cur, ks);
    const r = reshapeFill(cur, objs, objs[o + k], ks, forms[k], trimMm, undefined, { angle: angles[k] });
    const next = r && takeOver(r);
    if (!next) return null;
    cur = next;
  }
  return { pattern: cur, parts: forms.map((_, k) => o + k) };
}
