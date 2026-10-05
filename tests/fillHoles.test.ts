import { describe, expect, it } from 'vitest';
import { stripsOfOutline } from '../src/digitize/rungs';
import type { Pt } from '../src/digitize/skeleton';
import { satinRuns, type SatinSettings } from '../src/model/restitch';

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: false, underlay: true, tolerance: 0.15 };

/** Points every ~0.5 mm along the corners given. */
function poly(...corners: Pt[]): Pt[] {
  const out: Pt[] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const [a, b] = [corners[i - 1], corners[i]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
const square = (x0: number, y0: number, x1: number, y1: number) => poly([x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]);
const len = (r: Pt[]) => r.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0), 0);

/** No satin stitch may cross a hole. */
const overHole = (run: Pt[], hole: [number, number, number, number]) => {
  const [x0, y0, x1, y1] = hole;
  return run.some((q, i) => i > 0 && [0.25, 0.5, 0.75].some((t) => {
    const x = run[i - 1][0] + (q[0] - run[i - 1][0]) * t;
    const y = run[i - 1][1] + (q[1] - run[i - 1][1]) * t;
    return x > x0 + 0.3 && x < x1 - 0.3 && y > y0 + 0.3 && y < y1 - 0.3;
  }));
};

describe('fills with holes cut into columns', () => {
  const O = square(0, 0, 20, 20);
  const H = square(5, 5, 15, 15);

  it('says which hole has no cut line into it', () => {
    const r = stripsOfOutline(O, [[[10, 21], [10, 14]]], [], [H]);
    expect(r.hole).toBe(0);
  });

  it('opens an o with one cut line: one column round it, the hole left free', () => {
    const r = stripsOfOutline(O, [[[10, 21], [10, 14]], [[14, 10], [21, 10]], [[10, -1], [10, 6]]], [[[-1, 10], [6, 10]]], [H]);
    expect(r.hole).toBe(-1);
    expect(r.bad).toBe(-1);
    expect(r.strips.length).toBe(1);
    const s = r.strips[0];
    // Round the outside and round the hole: 80 mm against 40 mm.
    expect(Math.max(len(s.left), len(s.right)) / Math.min(len(s.left), len(s.right))).toBeLessThan(2.05);
    const run = satinRuns([{ ...s, chain: 0 }], SATIN)[0];
    expect(overHole(run, [5, 5, 15, 15])).toBe(false);
  });

  it('opens an 8 with two holes, the parts each a column, both holes left free', () => {
    const outer = square(0, 0, 20, 40);
    const h1 = square(5, 5, 15, 15);
    const h2 = square(5, 25, 15, 35);
    const cuts: [Pt, Pt][] = [
      [[-1, 10], [6, 10]],
      [[14, 30], [21, 30]],
      [[-1, 20], [21, 20]],
    ];
    const lines: [Pt, Pt][] = [
      [[10, -1], [10, 6]],
      [[14, 10], [21, 10]],
      [[10, 14], [10, 19]],
      [[10, 21], [10, 26]],
      [[-1, 30], [6, 30]],
      [[10, 34], [10, 41]],
    ];
    const r = stripsOfOutline(outer, lines, cuts, [h1, h2]);
    expect(r.hole).toBe(-1);
    expect(r.bad).toBe(-1);
    expect(r.strips.length).toBe(2);
    const run = satinRuns(r.strips.map((s) => ({ ...s, chain: 0 })), SATIN)[0];
    expect(overHole(run, [5, 5, 15, 15])).toBe(false);
    expect(overHole(run, [5, 25, 15, 35])).toBe(false);
  });
});
