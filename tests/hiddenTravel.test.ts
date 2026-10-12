import { describe, expect, it } from 'vitest';
import { expandRegion, sample } from '../src/digitize/region';
import { grownForm } from '../src/model/geo';
import { fillRuns, TRAVEL_REACH, type FillSettings } from '../src/model/restitch';
import { formFrom } from '../src/shape/path';
import type { Pt } from '../src/digitize/skeleton';
import { shownTravel as shownBetween } from './helpers/travel';

/** The cat of the bug report (20 mm): its outline as the app keeps it, grown 0.2 mm as its fill was. */
const CAT = [
  9.6, -5.51, 9.6, -3.81, 9.6, -8.24, 1, 4.6, -9.64, 7.3, -9.64, 4.29, -9.64, 1, 4.04, -9.09, 4.04,
  -9.4, 4.04, -8.78, 1, 4.6, -8.53, 4.29, -8.53, 5.6, -8.53, 1, 8.33, -5.51, 8.33, -8.01, 8.33,
  -3.91, 1, 6.24, -2.18, 7.46, -2.47, 6.15, -2.22, 0, 5.95, -2.29, 6.05, -2.24, 1.93, -4.47, 1,
  -2.5, -2.45, -1.52, -1.79, -3.48, -3.11, 1, -4.07, -5.36, -2.8, -4.26, -4.26, -6.39, 0, -5.07,
  -7.85, -4.67, -7.85, -5.38, -7.85, 1, -6.04, -5.82, -5.77, -6.84, -6.37, -6.59, 0, -7.07, -7.35,
  -6.79, -7.35, -7.43, -7.35, 1, -7.96, -5, -7.78, -6.09, -8.89, -4.36, 0, -9.57, -2.35, -9.57,
  -3.44, -9.57, -0.85, 1, -6.57, -0.46, -7.32, -0.49, -5.82, -0.43, 1, -4.58, 2.36, -4.89, 1.52,
  -3.89, 4.79, 0, -3.08, 8.57, -3.44, 7.19, -4, 8.57, 0, -3.83, 9.75, -4.08, 9.75, -3.43, 9.75, 1,
  -2.59, 9.75, -2.74, 9.75, -1.83, 9.75, 1, -1.47, 4.83, -1.47, 7.13, -1.47, 4.71, 1, -1.47, 4.48,
  -1.47, 4.48, -1.47, 4.48, 0, 1.88, 4.37, -0.4, 4.76, 3.24, 4.13, 1, 5.07, 6.12, 4.68, 4.84, 5.37,
  7.07, 1, 6.11, 8.61, 5.85, 7.96, 5.23, 8.61, 0, 5.51, 9.75, 5.25, 9.75, 5.95, 9.75, 1, 6.72,
  9.75, 6.51, 9.75, 7.54, 9.72, 1, 7.29, 4.14, 7.08, 5.54, 7.51, 2.74, 1, 7.17, -0.75, 8, 1.04,
  8.97, -1.74, 0
];
const cat = grownForm(formFrom([{ c: true, n: CAT, z: 1 }])!, 0.1, 0.2)!;
const START: Pt = [7.3, 3.1];

/**
 * Travel that shows (mm): stitches of 1 mm and more that run off the row direction (travel
 * between sections), as far as no row sewn after them covers them. Row ends turn within 1 mm.
 */
function shownTravel(runs: Pt[][], under: number, angle: number, spacing: number): number {
  const e: Pt = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
  const segs: { a: Pt; b: Pt; l: number; row: boolean }[] = [];
  let n = 0;
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      if (n + i < under) continue;
      const [a, b] = [run[i - 1], run[i]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push({ a, b, l, row: l > 0.8 && Math.abs((b[0] - a[0]) * e[0] + (b[1] - a[1]) * e[1]) / l > 0.9 });
    }
    n += run.length;
  }
  const off = (q: Pt, a: Pt, b: Pt) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]);
  };
  let shown = 0;
  segs.forEach((g, j) => {
    if (g.row || g.l < 1) return;
    const k = Math.ceil(g.l / 0.1);
    for (let q = 0; q < k; q++) {
      const p: Pt = [g.a[0] + ((q + 0.5) / k) * (g.b[0] - g.a[0]), g.a[1] + ((q + 0.5) / k) * (g.b[1] - g.a[1])];
      if (!segs.some((s, m) => m > j && s.row && off(p, s.a, s.b) < spacing * 0.75)) shown += g.l / k;
    }
  });
  return shown;
}

describe('wave rows', () => {
  // The fill of the bug report: Wellen, 0.7 mm high, travel a little beyond the edge as in the app (sewOne).
  const s: FillSettings = { pattern: 'waves', spacing: 0.37, spacingEnd: 1, offset: 0.25, angle: 179, stitch: 4, underlay: true, edge: 0, tolerance: 0.15, deco: { height: 0.7 } };
  const travel = expandRegion(cat, TRAVEL_REACH)!;
  const sew = (angle: number) => fillRuns(cat, { ...s, angle }, { start: START, travel })!;
  const angles = Array.from({ length: 13 }, (_, i) => 150 + i * 5);

  it('travel between sections stays hidden under rows to come, whatever the angle', () => {
    // Before: rows were chained nearest end first, and travel ran back along the outline on top
    // of sewn rows: about 23 mm on average on this cat, 12 to 44 mm from angle to angle. Now about 2.
    const shown = angles.map((a) => {
      const r = sew(a);
      return shownTravel(r.runs, r.under, a, s.spacing);
    });
    for (const x of shown) expect(x).toBeLessThan(12);
    expect(shown.reduce((a, b) => a + b, 0) / shown.length).toBeLessThan(5);
  }, 60_000);

  it('cover the whole shape, ears and tail tip too', () => {
    for (const a of [0, 45, 179]) {
      const r = sew(a);
      const top = r.runs.flat().slice(r.under);
      // Every point well inside lies within a row spacing of a needle path.
      const segs = r.runs.flatMap((run) => run.slice(1).map((q, i): [Pt, Pt] => [run[i], q]));
      let missed = 0;
      for (let y = -12.25; y < 12; y += 0.5) {
        for (let x = -12.25; x < 12; x += 0.5) {
          if (sample(cat, cat.sdf, x, y) > -0.4) continue;
          const near = segs.some(([u, v]) => {
            const [dx, dy] = [v[0] - u[0], v[1] - u[1]];
            const t = Math.max(0, Math.min(1, ((x - u[0]) * dx + (y - u[1]) * dy) / (dx * dx + dy * dy || 1)));
            return Math.hypot(u[0] + t * dx - x, u[1] + t * dy - y) < s.spacing;
          });
          if (!near) missed++;
        }
      }
      expect(top.length).toBeGreaterThan(100);
      expect(missed).toBe(0);
    }
  }, 60_000);
});

describe('travel between rows, all covering fills', () => {
  // Rows were chained nearest end first (tatami: sections in a fixed order) and travel ran back
  // along the outline on top of sewn rows: on this cat 27 to 41 mm on average per fill, depending
  // on the pattern. Now planned under rows still to come; the bound each pattern keeps on average.
  const MEAN: Record<string, number> = { tatami: 4, gradient: 6, grain: 5, rays: 10, circles: 9, swirl: 8, waves: 3 };
  const travel = expandRegion(cat, TRAVEL_REACH)!;
  const base: FillSettings = { pattern: 'tatami', spacing: 0.37, spacingEnd: 1, offset: 0.25, angle: 179, stitch: 4, underlay: true, edge: 0, tolerance: 0.15 };
  it.each(Object.keys(MEAN))('%s', (pattern) => {
    const shown = Array.from({ length: 12 }, (_, i) => {
      const s: FillSettings = { ...base, pattern: pattern as FillSettings['pattern'], angle: 150 + i * 5, spacingEnd: pattern === 'gradient' ? 0.8 : 1, deco: { height: 0.7, seed: i + 1, focus: [0.2 + 0.05 * i, 0.3 + 0.04 * i] } };
      const r = fillRuns(cat, s, { start: START, travel })!;
      return shownBetween(r.runs, r.travel ?? [], s.spacing);
    });
    for (const x of shown) expect(x).toBeLessThan(20);
    expect(shown.reduce((a, b) => a + b, 0) / shown.length).toBeLessThan(MEAN[pattern]);
  }, 60_000);
});
