import { describe, expect, it } from 'vitest';
import { pairs, ROUGH_IN, ROUGH_OUT, type Column } from '../src/digitize/satin';
import type { Pt } from '../src/digitize/skeleton';
import { satinRuns, type Rails, type SatinSettings } from '../src/model/restitch';

// A straight column 30 mm long and 4 mm wide, its rails at y = 0 and y = 4.
const n = 301;
const col: Column = {
  center: Array.from({ length: n }, (_, i): Pt => [i / 10, 2]),
  left: Array.from({ length: n }, (_, i): Pt => [i / 10, 0]),
  right: Array.from({ length: n }, (_, i): Pt => [i / 10, 4]),
  width: 4,
};
const P = { spacing: 0.4, pull: 0, splitMm: 12, short: false };
const rails = (y: number): Rails => ({ left: col.left.map(([x]): Pt => [x, y]), right: col.right.map(([x]): Pt => [x, y + 4]) });
const S: SatinSettings = { spacing: 0.4, edge: 0, short: false, underlay: false, tolerance: 0.15 };

describe('irregular satin', () => {
  it('is the plain satin at 0', () => {
    expect(pairs(col, { ...P, rough: 0, seed: 5 })).toEqual(pairs(col, P));
  });

  it('reaches up to a fifth of the width out and a tenth in on each side, times the strength', () => {
    for (const k of [0.4, 1]) {
      const ps = pairs(col, { ...P, rough: k, seed: 5 });
      const out = ps.map(([a]) => -a[1]).concat(ps.map(([, b]) => b[1] - 4));
      expect(Math.max(...out)).toBeLessThanOrEqual(ROUGH_OUT * k * 4 + 1e-9);
      expect(Math.min(...out)).toBeGreaterThanOrEqual(-ROUGH_IN * k * 4 - 1e-9);
      // It does vary, both ways, on both sides.
      expect(Math.max(...out)).toBeGreaterThan(ROUGH_OUT * k * 4 * 0.7);
      expect(Math.min(...out)).toBeLessThan(-ROUGH_IN * k * 4 * 0.5);
    }
  });

  it('varies the spacing, keeping it about the same on the whole', () => {
    const plain = pairs(col, P);
    const ps = pairs(col, { ...P, rough: 1, seed: 5 });
    const gaps = ps.slice(1).map(([a], i) => a[0] - ps[i][0][0]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.15);
    expect(Math.abs(ps.length - plain.length) / plain.length).toBeLessThan(0.1);
  });

  it('comes out the same for the same seed and another way for another', () => {
    expect(pairs(col, { ...P, rough: 0.6, seed: 5 })).toEqual(pairs(col, { ...P, rough: 0.6, seed: 5 }));
    expect(pairs(col, { ...P, rough: 0.6, seed: 6 })).not.toEqual(pairs(col, { ...P, rough: 0.6, seed: 5 }));
  });

  it('sews each column of an object its own way', () => {
    const [a, b] = satinRuns([rails(0), rails(10)], { ...S, rough: 0.8, roughSeed: 3 });
    const shape = (run: Pt[], y: number) => run.map(([x, yy]) => [x, yy - y]);
    expect(shape(b, 10)).not.toEqual(shape(a, 0));
  });

  it('keeps the underlay inside where every stitch covers it', () => {
    const k = 0.8;
    for (const under of ['contour', 'zigzag', 'both', 'center'] as const) {
      const s = { ...S, underlay: true, under, rough: k, roughSeed: 3 };
      const plain = satinRuns([rails(0)], { ...s, underlay: false })[0];
      const run = satinRuns([rails(0)], s)[0];
      const u = run.slice(0, run.length - plain.length);
      for (const [, y] of u) {
        expect(y, under).toBeGreaterThanOrEqual(ROUGH_IN * k * 4 - 1e-6);
        expect(y, under).toBeLessThanOrEqual(4 - ROUGH_IN * k * 4 + 1e-6);
      }
    }
  });

  it('leaves an E stitch as it is', () => {
    const e = { ...S, type: 'e' as const, spacing: 2.5 };
    expect(satinRuns([rails(0)], { ...e, rough: 1, roughSeed: 3 })).toEqual(satinRuns([rails(0)], e));
  });
});
