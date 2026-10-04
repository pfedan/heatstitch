import type { Pt } from './skeleton';

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Douglas-Peucker simplification with tolerance `tol` (mm). */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const l = Math.hypot(dx, dy);
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = l > 0 ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / l : dist(pts[i], pts[a]);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Point at arc length s along the polyline. */
function at(pts: Pt[], cum: number[], s: number): Pt {
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const l = cum[i] - cum[i - 1];
  const t = l > 0 ? (s - cum[i - 1]) / l : 0;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
}

/**
 * Running stitch along a polyline: corners sharper than 45 degrees get a needle point, and between
 * them the stitches are of equal length, at most `len` (like Ink/Stitch's even running stitch).
 * Returns the needle points including both ends.
 */
export function runStitch(pts: Pt[], len: number, tol = 0.1): Pt[] {
  const s = simplify(pts, tol);
  if (s.length < 2) return s;
  // Split at sharp corners.
  const pieces: Pt[][] = [[s[0]]];
  for (let i = 1; i < s.length; i++) {
    pieces[pieces.length - 1].push(s[i]);
    if (i < s.length - 1) {
      const a = [s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]];
      const b = [s[i + 1][0] - s[i][0], s[i + 1][1] - s[i][1]];
      const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1);
      if (cos < Math.SQRT1_2) pieces.push([s[i]]);
    }
  }
  const out: Pt[] = [s[0]];
  for (const piece of pieces) {
    const cum = [0];
    for (let i = 1; i < piece.length; i++) cum.push(cum[i - 1] + dist(piece[i - 1], piece[i]));
    const total = cum[cum.length - 1];
    if (total < 0.05) continue;
    const n = Math.max(1, Math.ceil(total / len - 1e-9));
    for (let k = 1; k <= n; k++) out.push(at(piece, cum, (k / n) * total));
  }
  return out;
}
