import { core } from '../wasm/core';
import type { Region } from './region';

/**
 * Centerlines of narrow regions, for satin columns and running stitch.
 *
 * Thinning in the order of the distance transform (as scikit-image's medial_axis): pixels are
 * removed from the outside in, only where removing them keeps the region 8-connected, and line ends
 * are kept. The result lies on the ridge of the distance field and keeps the topology (a ring stays
 * a ring). The pixel skeleton becomes a graph of nodes (ends, junctions) and branches; side branches
 * that are short against the local width (spurs from corners and outline noise) are pruned, the
 * criterion the Goldman patent and the integer medial axis pruning (Hesselink & Roerdink 2008) use.
 *
 * Thinning and the graph are computed by the Rust core (core/src/digitize/skeleton.rs); the small
 * helpers on lines (smooth, resample, ...) stay here for their callers in TypeScript.
 */

export type Pt = [number, number];

export interface Branch {
  /** Node indices at both ends (equal for a closed loop). */
  a: number;
  b: number;
  /** Centerline in image mm from node a to node b. */
  pts: Pt[];
  /** Half width (mm) at each point. */
  r: number[];
}

export interface Graph {
  nodes: { p: Pt; r: number }[];
  branches: Branch[];
}

/** One-pixel skeleton of the region mask (the mask has an empty margin), computed by the core. */
export const thin = (r: Region): Uint8Array => core().thin(r.mask, r.inside, r.w, r.h);

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

function length(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/**
 * Gaussian smoothing over `sigma` points (the points are about evenly spaced). Open polylines keep
 * their ends, and the window shrinks symmetrically towards them; a closed loop wraps around (its
 * last point repeats the first).
 */
export function smooth(pts: Pt[], sigma: number, closed: boolean): Pt[] {
  const n = closed ? pts.length - 1 : pts.length;
  if (n < 3) return pts.slice();
  const K = Math.ceil(2.5 * sigma);
  const out = pts.slice(0, n).map((p, i): Pt => {
    if (!closed && (i === 0 || i === n - 1)) return p;
    const k = closed ? K : Math.min(K, i, n - 1 - i);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let j = -k; j <= k; j++) {
      const q = pts[closed ? (((i + j) % n) + n) % n : i + j];
      const wt = Math.exp(-(j * j) / (2 * sigma * sigma));
      sx += q[0] * wt;
      sy += q[1] * wt;
      sw += wt;
    }
    return [sx / sw, sy / sw];
  });
  if (closed) out.push(out[0]);
  return out;
}

/**
 * Skeleton graph of the region in image mm: pruned and smoothed, each branch with its half width.
 * Computed by the core (core/src/digitize/skeleton.rs).
 */
export const skeleton = (area: Region): Graph => core().skeleton(area.mask, area.inside, area.w, area.h, area.x0, area.y0, area.pxMm) as Graph;

export function reverse(b: Branch): Branch {
  return { a: b.b, b: b.a, pts: b.pts.slice().reverse(), r: b.r.slice().reverse() };
}

/** Resamples a polyline (with a value per point) at even arc length steps. */
export function resample(pts: Pt[], vals: number[], step: number): { pts: Pt[]; r: number[] } {
  if (pts.length < 2) return { pts: pts.slice(), r: vals.slice() };
  const total = length(pts);
  const n = Math.max(1, Math.round(total / step));
  const out: Pt[] = [pts[0]];
  const r: number[] = [vals[0]];
  let seg = 0;
  let segStart = 0;
  let segLen = dist(pts[0], pts[1]);
  for (let k = 1; k <= n; k++) {
    const s = (k / n) * total;
    while (seg < pts.length - 2 && segStart + segLen < s) {
      segStart += segLen;
      seg++;
      segLen = dist(pts[seg], pts[seg + 1]);
    }
    const t = segLen > 0 ? Math.min(1, (s - segStart) / segLen) : 0;
    const a = pts[seg];
    const b = pts[seg + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    r.push(vals[seg] + (vals[seg + 1] - vals[seg]) * t);
  }
  return { pts: out, r };
}

export { length as polylineLength };
