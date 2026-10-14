import { describe, expect, it } from 'vitest';
import { triangulate, type Pt } from '../src/shape/cdt';

const area = (t: ReturnType<typeof triangulate>) => {
  let a = 0;
  for (let i = 0; i < t.tris.length; i += 3) {
    const [p, q, r] = [t.points[t.tris[i]], t.points[t.tris[i + 1]], t.points[t.tris[i + 2]]];
    a += ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
  }
  return a;
};
const ring = (cx: number, cy: number, r: number, n: number, turn = 1): Pt[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((turn * 2 * Math.PI * i) / n), cy + r * Math.sin((turn * 2 * Math.PI * i) / n)] as Pt);
/** Points along a polygon's edges every `step`. */
const sampled = (poly: Pt[], step: number): Pt[] =>
  poly.flatMap((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    return Array.from({ length: k }, (_, j) => [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k] as Pt);
  });

/** Whether no point of the triangulation lies inside the circle of a triangle it can see across an unfixed edge. */
function locallyDelaunay(t: ReturnType<typeof triangulate>): boolean {
  const P = t.points;
  for (let e = 0; e < t.tris.length; e++) {
    const f = t.twin[e];
    if (f < 0 || t.fixed[e]) continue;
    const base = e - (e % 3);
    const [a, b, c] = [P[t.tris[base]], P[t.tris[base + 1]], P[t.tris[base + 2]]];
    const d = P[t.tris[f - (f % 3) + ((f % 3) + 2) % 3]];
    const m = [a, b, c].map((p) => [p[0] - d[0], p[1] - d[1], (p[0] - d[0]) ** 2 + (p[1] - d[1]) ** 2]);
    const det = m[0][2] * (m[1][0] * m[2][1] - m[2][0] * m[1][1]) + m[1][2] * (m[2][0] * m[0][1] - m[0][0] * m[2][1]) + m[2][2] * (m[0][0] * m[1][1] - m[1][0] * m[0][1]);
    if (det > 1e-9) return false;
  }
  return true;
}

describe('constrained Delaunay triangulation', () => {
  it('fills a square with a hole and nothing else', () => {
    const t = triangulate([sampled([[0, 0], [10, 0], [10, 10], [0, 10]], 0.5), ring(5, 5, 2, 40)]);
    const hole = (40 / 2) * 2 * 2 * Math.sin((2 * Math.PI) / 40);
    expect(Math.abs(area(t))).toBeCloseTo(100 - hole, 2);
    expect(locallyDelaunay(t)).toBe(true);
  });

  it('keeps every outline segment, also of a thin, sharp star', () => {
    const star: Pt[] = Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 2 : 19;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    const pts = sampled(star, 0.2);
    const t = triangulate([pts]);
    expect(t.fixed.filter(Boolean).length).toBe(pts.length);
    let a = 0;
    for (let i = 0; i < star.length; i++) a += (star[i][0] * star[(i + 1) % 10][1] - star[(i + 1) % 10][0] * star[i][1]) / 2;
    expect(Math.abs(area(t))).toBeCloseTo(Math.abs(a), 2);
    expect(locallyDelaunay(t)).toBe(true);
  });

  it('handles points on a circle and many collinear points', () => {
    const t = triangulate([ring(0, 0, 5, 200)]);
    expect(t.tris.length / 3).toBe(198);
    const box = triangulate([sampled([[0, 0], [30, 0], [30, 1], [0, 1]], 0.1)]);
    expect(Math.abs(area(box))).toBeCloseTo(30, 2);
  });

  it('reads nested outlines even-odd', () => {
    const t = triangulate([ring(0, 0, 10, 60), ring(0, 0, 6, 60, -1), ring(0, 0, 3, 60)]);
    const ringArea = (r: number) => 30 * r * r * Math.sin((2 * Math.PI) / 60);
    expect(Math.abs(area(t))).toBeCloseTo(ringArea(10) - ringArea(6) + ringArea(3), 2);
  });
});
