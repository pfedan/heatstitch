import type { Pt } from '../digitize/skeleton';
import { cumulative, pointAt } from '../digitize/rungs';
import { flatten, type Form } from './path';

/** Satin width a line can be given by dragging its band (mm). */
export const BAND_MIN = 0.8;
export const BAND_MAX = 20;

/** The path as points about `step` mm apart (straight pieces too, so that corners keep their sides' normals). */
function sampled(p: Form['paths'][number], step: number): Pt[] {
  const pts = flatten(p, step);
  const out: Pt[] = pts.length ? [pts[0]] : [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Unit normal (to the left of the direction of travel) of the polyline at point i. */
function normal(pts: Pt[], i: number): Pt {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

/**
 * How far the band's middle lies to the left of a path: a border `offset` mm outside the edge of an
 * area (left or right by the way the path runs round), 0 for a line.
 */
function shiftOf(pts: Pt[], closed: boolean, offset: number): number {
  if (!closed || !offset) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  // Running one way round, the left side is inside; the other way, outside.
  return a > 0 ? -offset : offset;
}

/**
 * The two edges of a band `w` mm wide along each path: a line sewn as satin, or the satin border of
 * an area lying `offset` mm outside its edge.
 */
export function bandEdges(f: Form, w: number, offset = 0): Pt[][] {
  const out: Pt[][] = [];
  for (const p of f.paths) {
    const pts = sampled(p, 0.2);
    if (pts.length < 2) continue;
    const c = shiftOf(pts, p.closed, offset);
    if (p.closed) pts.push(pts[1] ?? pts[0]);
    for (const side of [1, -1]) {
      out.push(
        pts.map((q, i) => {
          const n = normal(pts, i);
          const d = c + (side * w) / 2;
          return [q[0] + n[0] * d, q[1] + n[1] * d];
        }),
      );
    }
  }
  return out;
}

/**
 * Where the width grip sits: halfway along the first path, on its left edge (outer edge when it is
 * closed). `mid` is the band's middle there and `n` the direction across it, to measure a dragged
 * width from.
 */
export function bandGrip(f: Form, w: number, offset = 0): { at: Pt; mid: Pt; n: Pt } | null {
  const p = f.paths[0];
  if (!p) return null;
  const pts = sampled(p, 0.1);
  if (pts.length < 2) return null;
  const c = shiftOf(pts, p.closed, offset);
  const cum = cumulative(pts);
  const at = gripAlong(p, pts, cum);
  const on = pointAt(pts, cum, at);
  let i = cum.findIndex((v) => v >= at);
  if (i < 0) i = pts.length - 1;
  const n = normal(pts, i);
  const mid: Pt = [on[0] + n[0] * c, on[1] + n[1] * c];
  // Round a closed path the grip sits on the outer edge, off the nodes of an area's outline.
  const side = p.closed ? shiftOf(pts, true, 1) : 1;
  return { at: [mid[0] + (side * n[0] * w) / 2, mid[1] + (side * n[1] * w) / 2], mid, n };
}

/**
 * Where along the path (mm) the grip sits: halfway along its longest stretch from node to node, so
 * it never lies on a node and hides it (a line bent in its middle has a node halfway); of stretches
 * alike, the one nearest halfway along the whole path.
 */
function gripAlong(p: Form['paths'][number], pts: Pt[], cum: number[]): number {
  const total = cum[cum.length - 1];
  const half = total / 2;
  // Each node's place along the path: the nearest sample, in order.
  const marks: number[] = [];
  let from = 0;
  for (const nd of p.nodes) {
    let best = from;
    let bd = Infinity;
    for (let k = from; k < pts.length; k++) {
      const d = Math.hypot(pts[k][0] - nd.p[0], pts[k][1] - nd.p[1]);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    marks.push(cum[best]);
    from = best;
  }
  if (!p.closed || marks[marks.length - 1] < total - 1e-6) marks.push(total);
  if (marks[0] > 1e-6) marks.unshift(0);
  let at = half;
  let longest = -1;
  for (let k = 1; k < marks.length; k++) {
    const len = marks[k] - marks[k - 1];
    const mid = (marks[k] + marks[k - 1]) / 2;
    if (len > longest + 1e-6 || (Math.abs(len - longest) <= 1e-6 && Math.abs(mid - half) < Math.abs(at - half))) {
      longest = len;
      at = mid;
    }
  }
  return at;
}

/** The width a drag of the grip to `q` gives: twice its distance across the line, rounded to 0.1 mm. */
export function draggedWidth(g: { mid: Pt; n: Pt }, q: Pt): number {
  const d = Math.abs((q[0] - g.mid[0]) * g.n[0] + (q[1] - g.mid[1]) * g.n[1]);
  return Math.min(BAND_MAX, Math.max(BAND_MIN, Math.round(20 * d) / 10));
}
