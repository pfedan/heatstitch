import { describe, expect, it } from 'vitest';
import { satinRuns, swappedSides, type Rails, type SatinSettings } from '../src/model/restitch';

// A straight column 4 mm wide along x: left rail at y = 0, right rail at y = 4.
const RAILS: Rails = { left: [[0, 0], [20, 0]], right: [[0, 4], [20, 4]] };
const BASE: SatinSettings = { spacing: 0.4, edge: 0, short: false, underlay: false, tolerance: 0.05, split: 50 };

/** How far the stitches reach past each rail (mm): [left, right]. */
function reach(s: SatinSettings): [number, number] {
  const pts = satinRuns([RAILS], s).flat();
  return [-Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1])) - 4];
}

describe('satin pull compensation for each side', () => {
  it('gives each rail its own mm and share of the width', () => {
    const [l, r] = reach({ ...BASE, edge: 0.2, edgeB: 0.4, edgeShare: 0.05, edgeShareB: 0.1 });
    expect(l).toBeCloseTo(0.2 + 4 * 0.05, 2);
    expect(r).toBeCloseTo(0.4 + 4 * 0.1, 2);
  });

  it('a share alone counts for both sides', () => {
    const [l, r] = reach({ ...BASE, edge: 0.3, edgeShare: 0.05 });
    expect(l).toBeCloseTo(0.5, 2);
    expect(r).toBeCloseTo(0.5, 2);
  });

  it('walked the other way, the sides swap what they are given', () => {
    const s = swappedSides({ ...BASE, edge: 0.2, edgeB: 0.4, edgeShare: 0.05, edgeShareB: 0.1 });
    expect([s.edge, s.edgeB, s.edgeShare, s.edgeShareB]).toEqual([0.4, 0.2, 0.1, 0.05]);
  });
});
