import type { Pt } from '../digitize/skeleton';
import { cumulative, pointAt } from '../digitize/rungs';
import { flatten, type Form } from './path';

/** Satin width a line can be given by dragging its band (mm). */
export const BAND_MIN = 0.8;
export const BAND_MAX = 20;

/** Unit normal (to the left of the direction of travel) of the polyline at point i. */
function normal(pts: Pt[], i: number): Pt {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

/** The two edges of a line sewn as satin `w` mm wide: for each path its left and its right edge. */
export function bandEdges(f: Form, w: number): Pt[][] {
  const out: Pt[][] = [];
  for (const p of f.paths) {
    const pts = flatten(p, 0.2);
    if (pts.length < 2) continue;
    if (p.closed) pts.push(pts[1] ?? pts[0]);
    for (const side of [1, -1]) {
      out.push(
        pts.map((q, i) => {
          const n = normal(pts, i);
          return [q[0] + (side * n[0] * w) / 2, q[1] + (side * n[1] * w) / 2];
        }),
      );
    }
  }
  return out;
}

/**
 * Where the width grip sits: halfway along the first path, on its left edge. `mid` is the point on
 * the line and `n` the direction across it, to measure a dragged width from.
 */
export function bandGrip(f: Form, w: number): { at: Pt; mid: Pt; n: Pt } | null {
  const p = f.paths[0];
  if (!p) return null;
  const pts = flatten(p, 0.1);
  if (pts.length < 2) return null;
  const cum = cumulative(pts);
  const half = cum[cum.length - 1] / 2;
  const mid = pointAt(pts, cum, half);
  let i = cum.findIndex((c) => c >= half);
  if (i < 0) i = pts.length - 1;
  const n = normal(pts, i);
  return { at: [mid[0] + (n[0] * w) / 2, mid[1] + (n[1] * w) / 2], mid, n };
}

/** The width a drag of the grip to `q` gives: twice its distance across the line, rounded to 0.1 mm. */
export function draggedWidth(g: { mid: Pt; n: Pt }, q: Pt): number {
  const d = Math.abs((q[0] - g.mid[0]) * g.n[0] + (q[1] - g.mid[1]) * g.n[1]);
  return Math.min(BAND_MAX, Math.max(BAND_MIN, Math.round(20 * d) / 10));
}
