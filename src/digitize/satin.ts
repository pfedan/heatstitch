import { sample, type Region } from './region';
import { runStitch } from './run';
import type { Branch, Pt } from './skeleton';

/**
 * Satin columns along a centerline. The rails are found by casting rays from the centerline along
 * its normal to the region's boundary (the "stroke normals" of the Goldman patent), so they follow
 * the real edges even where the column is asymmetric. Stitch placement follows Ink/Stitch's satin
 * column (re-implemented, not ported):
 *
 * - pairs are spaced so the rail that moves more advances by `spacing`, measured perpendicular to
 *   the previous stitch; on curves the inner side gets denser,
 * - which the short-stitch rule relieves: a penetration closer than 0.25 mm to the last full one on
 *   the same rail is moved 15 % of the width towards the other rail,
 * - pull compensation widens every pair outwards from its middle,
 * - stitches longer than the split length are divided evenly.
 */

export interface SatinParams {
  /** Distance between penetrations on the same side (mm). */
  spacing: number;
  /** Added to each side (mm). */
  pull: number;
  /** Longer stitches are split (mm). */
  splitMm: number;
}

export interface Column {
  /** Centerline from end a to end b, extended into free ends. */
  center: Pt[];
  left: Pt[];
  right: Pt[];
  /** Median width (mm). */
  width: number;
}

const SHORT_DIST = 0.25;
const SHORT_INSET = 0.15;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const norm = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Tangent at index i, over a window of a few points. */
function tangent(pts: Pt[], i: number): Pt {
  const k = 3;
  const a = pts[Math.max(0, i - k)];
  const b = pts[Math.min(pts.length - 1, i + k)];
  return norm(sub(b, a));
}

/**
 * Extends the centerline past a free end until it leaves the region: a medial axis stops about one
 * radius short of a round end, and further short of a tapering tip.
 */
function extend(r: Region, pts: Pt[], radius: number, atStart: boolean): Pt[] {
  if (pts.length < 2) return [];
  const t = atStart ? tangent(pts, 0) : tangent(pts, pts.length - 1);
  const dir: Pt = atStart ? [-t[0], -t[1]] : t;
  const from = atStart ? pts[0] : pts[pts.length - 1];
  const out: Pt[] = [];
  for (let s = 0.1; s <= 3 * radius + 1; s += 0.1) {
    const p: Pt = [from[0] + dir[0] * s, from[1] + dir[1] * s];
    if (sample(r, r.sdfBase, p[0], p[1]) > -0.05) break;
    out.push(p);
  }
  return atStart ? out.reverse() : out;
}

/** Distance along `dir` from p to the region boundary, or -1 if none within `max`. */
function cast(r: Region, p: Pt, dir: Pt, max: number): number {
  const step = Math.min(0.05, r.pxMm / 2);
  let prev = sample(r, r.sdfBase, p[0], p[1]);
  if (prev >= 0) return 0;
  for (let t = step; t <= max; t += step) {
    const f = sample(r, r.sdfBase, p[0] + dir[0] * t, p[1] + dir[1] * t);
    if (f >= 0) return t - step + (step * -prev) / (f - prev);
    prev = f;
  }
  return -1;
}

/** Rails of a branch, from node a to node b; `freeA`/`freeB` extend the column into free ends. */
export function column(r: Region, br: Branch, freeA: boolean, freeB: boolean): Column {
  const head = freeA ? extend(r, br.pts, br.r[0], true) : [];
  const tail = freeB ? extend(r, br.pts, br.r[br.r.length - 1], false) : [];
  const center = [...head, ...br.pts, ...tail];
  const radius = [...head.map(() => br.r[0]), ...br.r, ...tail.map(() => br.r[br.r.length - 1])];
  const hl: number[] = [];
  const hr: number[] = [];
  for (let i = 0; i < center.length; i++) {
    const t = tangent(center, i);
    const n: Pt = [-t[1], t[0]];
    const rad = radius[i];
    const max = Math.max(0.6, 1.6 * rad + 0.2);
    for (const [side, out] of [[1, hl], [-1, hr]] as const) {
      let d = cast(r, center[i], [n[0] * side, n[1] * side], max);
      // Rays that miss or run far into a junction fall back to the inscribed radius.
      if (d < 0 || d > 1.6 * rad + 0.2) d = rad;
      out.push(Math.max(0, d));
    }
  }
  const sm = (v: number[]) => v.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(v.length - 1, i + 2); j++) {
      s += v[j];
      c++;
    }
    return s / c;
  });
  const L = sm(hl);
  const R = sm(hr);
  const left: Pt[] = [];
  const right: Pt[] = [];
  const widths: number[] = [];
  for (let i = 0; i < center.length; i++) {
    const t = tangent(center, i);
    const n: Pt = [-t[1], t[0]];
    left.push([center[i][0] + n[0] * L[i], center[i][1] + n[1] * L[i]]);
    right.push([center[i][0] - n[0] * R[i], center[i][1] - n[1] * R[i]]);
    widths.push(L[i] + R[i]);
  }
  widths.sort((a, b) => a - b);
  return { center, left, right, width: widths[widths.length >> 1] ?? 0 };
}

/** Junctions at the column's ends that other columns cover already: the column stops this far from them. */
export interface ColumnEnds {
  from: Pt;
  fromTrim: number;
  to: Pt;
  toTrim: number;
}

/** Stitch pairs (left, right) along the column, in its direction. */
export function pairs(c: Column, p: SatinParams, ends?: ColumnEnds): [Pt, Pt][] {
  const n = c.center.length;
  if (n < 2) return [];
  const out: [Pt, Pt][] = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    const w = dist(c.left[i], c.right[i]);
    if (w < 0.3) continue;
    if (ends && (dist(c.center[i], ends.from) < ends.fromTrim || dist(c.center[i], ends.to) < ends.toTrim)) continue;
    if (last >= 0) {
      const d = norm(sub(c.right[last], c.left[last]));
      const perp = (a: Pt, b: Pt) => Math.abs((b[0] - a[0]) * d[1] - (b[1] - a[1]) * d[0]);
      const adv = Math.max(perp(c.left[last], c.left[i]), perp(c.right[last], c.right[i]));
      if (adv < p.spacing && i < n - 1) continue;
      if (adv < 0.1) continue;
    }
    out.push([c.left[i], c.right[i]]);
    last = i;
  }
  // Pull compensation: each pair widened outwards from its middle.
  const comp = out.map(([a, b]): [Pt, Pt] => {
    const u = norm(sub(a, b));
    return [[a[0] + u[0] * p.pull, a[1] + u[1] * p.pull], [b[0] - u[0] * p.pull, b[1] - u[1] * p.pull]];
  });
  // Short stitches on the inside of curves.
  for (const side of [0, 1] as const) {
    let ref = comp.length ? comp[0][side] : null;
    for (let i = 1; i < comp.length; i++) {
      const q = comp[i][side];
      if (ref && dist(q, ref) < SHORT_DIST) comp[i][side] = lerp(q, comp[i][1 - side], SHORT_INSET);
      else ref = q;
    }
  }
  return comp;
}

/** Splits a stitch from a to b into equal parts no longer than `max`; returns the points after a. */
function split(a: Pt, b: Pt, max: number): Pt[] {
  const n = Math.max(1, Math.ceil(dist(a, b) / max));
  const out: Pt[] = [];
  for (let k = 1; k <= n; k++) out.push(lerp(a, b, k / n));
  return out;
}

/** Needle points of the satin: left, right, left, right ... along the pairs. */
export function satinStitches(ps: [Pt, Pt][], p: SatinParams): Pt[] {
  const out: Pt[] = [];
  for (const [a, b] of ps) {
    if (!out.length) out.push(a);
    else out.push(...split(out[out.length - 1], a, p.splitMm));
    out.push(...split(a, b, p.splitMm));
  }
  return out;
}

/**
 * Underlay sewn on the way out along the column (the satin follows on the way back): a center walk
 * for columns up to 4 mm, a zigzag inset 0.4 mm from both rails with 3 mm between penetrations on
 * the same side for wider ones (Wilcom and Ink/Stitch use these by width).
 */
export function underlay(c: Column): Pt[] {
  if (c.width <= 4) return runStitch(c.center, 2.5);
  const out: Pt[] = [];
  let lastS = -Infinity;
  let s = 0;
  let side = 0;
  for (let i = 0; i < c.center.length; i++) {
    if (i > 0) s += dist(c.center[i - 1], c.center[i]);
    if (s - lastS < 1.5 && i < c.center.length - 1) continue;
    const a = c.left[i];
    const b = c.right[i];
    const w = dist(a, b);
    const inset = Math.min(0.4, w / 4) / Math.max(w, 1e-6);
    out.push(side === 0 ? lerp(a, b, inset) : lerp(b, a, inset));
    side = 1 - side;
    lastS = s;
  }
  return out;
}
