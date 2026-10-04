import { sewUnderlay, TravelGrid, type FillParams, type FillResult } from './fill';
import { sample, type Region } from './region';
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
  // Begin on the edge in the direction of the start point.
  const a0 = Math.atan2(start[1] - cy, start[0] - cx) / (2 * Math.PI);
  const pts: Pt[] = [];
  const total = turns;
  const point = (s: number): Pt => {
    const a = a0 + s;
    const rr = at(a) * (1 - s / total);
    return [cx + Math.cos(a * 2 * Math.PI) * rr, cy + Math.sin(a * 2 * Math.PI) * rr];
  };
  // Per turn as many needle points as fit at the stitch length, shifted from turn to turn by the
  // golden ratio of a stitch: needle points would otherwise line up into spokes or a twill.
  pts.push(point(0));
  for (let k = 0; k < total; k++) {
    const rr = mean * (1 - (k + 0.5) / total);
    const m = Math.max(3, Math.round((2 * Math.PI * rr) / p.stitch));
    const phase = (k * 0.618034) % 1;
    for (let j = 0; j < m; j++) {
      const s = k + (j + phase) / m;
      if (s > 0) pts.push(point(s));
    }
  }
  pts.push(point(total));
  const runs: Pt[][] = [];
  if (p.underlay) sewUnderlay(r, 45, p.spacing, start, new TravelGrid(r), runs);
  if (runs.length) runs[runs.length - 1].push(...pts);
  else runs.push(pts);
  return { runs, angle: 0 };
}
