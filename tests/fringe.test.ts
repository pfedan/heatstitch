import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { satinRuns, type Rails, type SatinSettings } from '../src/model/restitch';
import { sewAlong, type PathStitch } from '../src/model/along';

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: false, underlay: false, tolerance: 0.15 };

/** Points every 0.5 mm from a to b. */
const line = (a: Pt, b: Pt): Pt[] => {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
  return Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n] as Pt);
};

/**
 * A column 6 mm wide along x from 0 to 30: rail `left` at y 0, `right` at y 6. On screen (y down)
 * the column's left, as the fringe's side means it, is the rail at y 6, its right the one at y 0.
 */
const COLUMN: Rails = { left: line([0, 0], [30, 0]), right: line([0, 6], [30, 6]), rungs: [] };

/** How far short of each rail the needle points end (mm): one value per point, by the side it lies on. */
function depths(run: Pt[]) {
  const left: number[] = [];
  const right: number[] = [];
  for (const [, y] of run) (y < 3 ? left : right).push(y < 3 ? y : 6 - y);
  return { left, right };
}

const spread = (v: number[]) => Math.max(...v) - Math.min(...v);

describe('satin with a fringe', () => {
  it('ends each stitch a different way short of the fringed rail, the other rail stays smooth', () => {
    const { left, right } = depths(satinRuns([COLUMN], { ...SATIN, fringe: 2, fringeSide: 'right' })[0]);
    expect(Math.max(...left)).toBeLessThanOrEqual(2 + 1e-9);
    expect(spread(left)).toBeGreaterThan(1.5);
    expect(spread(right)).toBeLessThan(1e-9);
    // Neighbours differ: frayed, not wavy.
    const steps = left.slice(1).map((d, i) => Math.abs(d - left[i]));
    expect(steps.filter((d) => d < 0.2 * 2).length).toBeLessThan(steps.length * 0.1);
  });

  it('frays both sides when no side is given', () => {
    const { left, right } = depths(satinRuns([COLUMN], { ...SATIN, fringe: 1.5 })[0]);
    expect(spread(left)).toBeGreaterThan(1);
    expect(spread(right)).toBeGreaterThan(1);
  });

  it('is the same every time, and only scales with the depth', () => {
    const a = satinRuns([COLUMN], { ...SATIN, fringe: 1, fringeSide: 'left' })[0];
    expect(satinRuns([COLUMN], { ...SATIN, fringe: 1, fringeSide: 'left' })[0]).toEqual(a);
    const b = satinRuns([COLUMN], { ...SATIN, fringe: 2, fringeSide: 'left' })[0];
    expect(b.length).toBe(a.length);
    depths(a).right.forEach((d, i) => expect(depths(b).right[i]).toBeCloseTo(2 * d, 6));
  });

  it('keeps every stitch at least a third of the width long, however deep the fringe', () => {
    const run = satinRuns([COLUMN], { ...SATIN, fringe: 20 })[0];
    for (let i = 1; i < run.length; i++) expect(Math.abs(run[i][1] - run[i - 1][1])).toBeGreaterThanOrEqual(0.35 * 6 - 1e-6);
  });

  it('stays on its side when the satin is sewn back over the underlay', () => {
    for (const under of ['center', 'zigzag', 'both', 'contour'] as const) {
      const run = satinRuns([COLUMN], { ...SATIN, underlay: true, under, fringe: 2, fringeSide: 'right' })[0];
      // The satin: the last points, from where it crosses the column.
      const satin = run.slice(-60);
      const { left, right } = depths(satin);
      expect(spread(left), under).toBeGreaterThan(1);
      expect(spread(right), under).toBeLessThan(0.05);
    }
  });

  it('keeps the underlay where every stitch covers it', () => {
    const plain = satinRuns([COLUMN], { ...SATIN, underlay: true, under: 'both' })[0];
    const run = satinRuns([COLUMN], { ...SATIN, underlay: true, under: 'both', fringe: 2, fringeSide: 'right' })[0];
    // Underlay: what comes before the satin (as many points as without a fringe, less the satin).
    const satinLen = satinRuns([COLUMN], SATIN)[0].length;
    const under = run.slice(0, run.length - satinLen);
    expect(under.length).toBe(plain.length - satinLen);
    for (const [, y] of under) expect(y).toBeGreaterThanOrEqual(2 + 0.3);
  });

  it('has no fringe on an E stitch', () => {
    const e: SatinSettings = { ...SATIN, type: 'e', spacing: 2.5 };
    expect(satinRuns([COLUMN], { ...e, fringe: 2 })).toEqual(satinRuns([COLUMN], e));
  });
});

describe('a satin line with a fringe', () => {
  const LINE: PathStitch = { type: 'satin', width: 4 };
  const along: Pt[] = line([0, 10], [30, 10]);
  /** Depths of the needle points short of the edges above (y < 10, left of the line drawn to the right, y down) and below. */
  const sides = (runs: Pt[][]) => {
    const above: number[] = [];
    const below: number[] = [];
    for (const [, y] of runs[runs.length - 1].slice(-50, -2)) (y < 10 ? above : below).push(y < 10 ? y - 8 : 12 - y);
    return { above, below };
  };

  it('frays the side of the drawn line it is set to, also when the line is sewn the other way', () => {
    for (const reversed of [false, true]) {
      const { above, below } = sides(sewAlong(reversed ? along.slice().reverse() : along, false, { ...LINE, fringe: 1.5, fringeSide: 'left' }, undefined, undefined, reversed));
      expect(spread(above), `reversed ${reversed}`).toBeGreaterThan(0.8);
      expect(spread(below), `reversed ${reversed}`).toBeLessThan(0.05);
    }
  });

  it('an E stitch line has none', () => {
    const e: PathStitch = { type: 'e', width: 4 };
    expect(sewAlong(along, false, { ...e, fringe: 2 })).toEqual(sewAlong(along, false, e));
  });
});
