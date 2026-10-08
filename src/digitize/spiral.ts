import { pathLength, pointCount, sewUnderlay, TRAVEL_STITCH, TRAVEL_TOLERANCE, TravelGrid, type FillParams, type FillResult } from './fill';
import { sample, type Region } from './region';
import { MIN_CURVE_STITCH, runStitch, TOLERANCE } from './run';
import type { Pt } from './skeleton';

/**
 * Spiral fill for round shapes: one continuous line that winds from the edge to the middle, its
 * turns one spacing apart where the shape is as wide as on average. Seen from the middle, the edge
 * has to lie in every direction exactly once (a star-shaped region); for other shapes, and shapes
 * much longer than wide, there is no spiral (null).
 */

const ANGLES = 360;
/** Radius in some direction against the mean radius beyond which the turns get too uneven. */
const MAX_RATIO = 1.8;

export function spiralFill(r: Region, p: FillParams, start: Pt): FillResult | null {
  // The middle: the point deepest inside.
  let deepest = 0;
  for (let i = 1; i < r.inside.length; i++) if (r.inside[i] > r.inside[deepest]) deepest = i;
  const cx = ((deepest % r.w) + r.x0 + 0.5) * r.pxMm;
  const cy = (Math.floor(deepest / r.w) + r.y0 + 0.5) * r.pxMm;
  const step = Math.max(0.05, r.pxMm / 2);
  const far = Math.hypot(r.w, r.h) * r.pxMm;
  const radius: number[] = [];
  for (let a = 0; a < ANGLES; a++) {
    const t = (a / ANGLES) * 2 * Math.PI;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    let d = 0;
    while (d < far && sample(r, r.sdf, cx + dx * d, cy + dy * d) < 0) d += step;
    // Further out the ray must stay outside, or the edge is not seen once.
    for (let e = d + 0.3; e < far; e += step) if (sample(r, r.sdf, cx + dx * e, cy + dy * e) < -0.1) return null;
    radius.push(d + p.pull);
  }
  const mean = radius.reduce((x, y) => x + y, 0) / ANGLES;
  if (mean < p.spacing * 1.5) return null;
  if (radius.some((x) => x > mean * MAX_RATIO || x < mean / MAX_RATIO)) return null;
  const turns = Math.max(1, Math.round(mean / p.spacing));
  const at = (a: number) => {
    const i = ((a % 1) + 1) % 1 * ANGLES;
    const i0 = Math.floor(i) % ANGLES;
    const f = i - Math.floor(i);
    return radius[i0] * (1 - f) + radius[(i0 + 1) % ANGLES] * f;
  };
  // The underlay first: the spiral begins on the edge in the direction of where it ends (of the
  // start point without one), and the needle travels there inside the shape.
  const runs: Pt[][] = [];
  const grid = new TravelGrid(p.travel ?? r, p.offRowEnds);
  const pos = p.underlay ? sewUnderlay(r, -45, p, start, grid, runs) : start;
  const under = pointCount(runs);
  const a0 = Math.atan2(pos[1] - cy, pos[0] - cx) / (2 * Math.PI);
  const pts: Pt[] = [];
  const total = turns;
  const point = (s: number): Pt => {
    const a = a0 + s;
    const rr = at(a) * (1 - s / total);
    return [cx + Math.cos(a * 2 * Math.PI) * rr, cy + Math.sin(a * 2 * Math.PI) * rr];
  };
  // Per turn as many needle points as fit at the stitch length, shifted from turn to turn by the
  // golden ratio of a stitch: needle points would otherwise line up into spokes or a twill. A
  // stitch of length L cuts a turn of radius R by L² / 8R: where the turn is tighter than the
  // tolerance allows, the stitches get shorter (measured where the edge bends most).
  const tol = p.tolerance ?? TOLERANCE;
  const narrowest = tightest(radius) * Math.min(...radius) / mean;
  pts.push(point(0));
  let prev = 0;
  for (let k = 0; k < total; k++) {
    const rr = mean * (1 - (k + 0.5) / total);
    const len = Math.min(p.stitch, Math.max(MIN_CURVE_STITCH, Math.sqrt(8 * rr * narrowest * tol)));
    const m = Math.max(3, Math.round((2 * Math.PI * rr) / len));
    const phase = (k * 0.618034) % 1;
    for (let j = 0; j < m; j++) {
      const s = k + (j + phase) / m;
      if (s <= 0) continue;
      // Where one turn hands over to the next, the shift leaves a gap of up to 1.6 stitches: halved.
      if ((s - prev) * m > 1.3) pts.push(point((prev + s) / 2));
      pts.push(point(s));
      prev = s;
    }
  }
  pts.push(point(total));
  // Travel from the underlay along the inside; where there is no way, a new run (a jump).
  const last = runs[runs.length - 1];
  const bd = Math.hypot(pts[0][0] - pos[0], pts[0][1] - pos[1]);
  const path = last && bd > 1 ? grid.path(pos, pts[0], false) : null;
  if (last && bd <= 1) last.push(...pts);
  else if (last && path && pathLength(path) < 2 * bd + 6) last.push(...runStitch(path, TRAVEL_STITCH, TRAVEL_TOLERANCE).slice(1), ...pts.slice(1));
  else runs.push(pts);
  return { runs, angle: 0, under };
}

/**
 * Smallest radius of curvature of the outline r(θ), as a share of r there: 1 for a circle, less
 * where the edge bends more tightly than a circle round the middle would (the ends of an oval).
 */
function tightest(radius: number[]): number {
  const n = radius.length;
  const h = (2 * Math.PI) / n;
  const r = (i: number) => {
    // Over a few degrees, so the steps of the traced edge do not count as bends.
    let sum = 0;
    for (let j = -3; j <= 3; j++) sum += radius[(((i + j) % n) + n) % n];
    return sum / 7;
  };
  let low = 1;
  for (let i = 0; i < n; i += 2) {
    const r0 = r(i);
    const d1 = (r(i + 4) - r(i - 4)) / (8 * h);
    const d2 = (r(i + 4) - 2 * r0 + r(i - 4)) / (16 * h * h);
    const den = Math.abs(r0 * r0 + 2 * d1 * d1 - r0 * d2);
    if (den < 1e-9 || r0 <= 0) continue;
    low = Math.min(low, (r0 * r0 + d1 * d1) ** 1.5 / den / r0);
  }
  return Math.max(0.1, low);
}
