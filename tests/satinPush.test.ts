import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { pushEnds, satinRuns, type Rails, type SatinSettings } from '../src/model/restitch';

/** A straight column from x0 to x1, its rails at y = 0 and y = w, a point every 0.5 mm. */
const bar = (x0: number, x1: number, w: number, y = 0): Rails => {
  const n = Math.round(Math.abs(x1 - x0) / 0.5);
  const at = (k: number) => x0 + ((x1 - x0) * k) / n;
  return { left: Array.from({ length: n + 1 }, (_, k): Pt => [at(k), y]), right: Array.from({ length: n + 1 }, (_, k): Pt => [at(k), y + w]) };
};

// Woven fabric: 0.1 mm fixed and 2.5 % of the width per side (see pullFor).
const AUTO: SatinSettings = { spacing: 0.4, edge: 0.1, edgeShare: 0.025, edgeAuto: true, short: true, underlay: false, tolerance: 0.15 };
const span = (run: Pt[]) => [Math.min(...run.map(([x]) => x)), Math.max(...run.map(([x]) => x))];

describe('push compensation', () => {
  it('shortens a column at both free ends by the pull it gets per side there', () => {
    const [ends] = [pushEnds([bar(0, 20, 4)], AUTO)];
    expect(ends).toHaveLength(2);
    // 0.1 + 4 * 0.025 = 0.2 mm on woven fabric at 4 mm.
    for (const e of ends) expect(e.mm).toBeCloseTo(0.2, 5);
    const [a, b] = span(satinRuns([bar(0, 20, 4)], AUTO)[0]);
    expect(a).toBeCloseTo(0.2, 2);
    expect(b).toBeCloseTo(19.8, 2);
  });

  it('grows with the width and the fabric, at most 0.5 mm', () => {
    const knit = { ...AUTO, edge: 0.175, edgeShare: 0.044 };
    const at = (w: number, s: SatinSettings) => pushEnds([bar(0, 20, w)], s)[0].mm;
    expect(at(2, AUTO)).toBeLessThan(at(6, AUTO));
    expect(at(4, knit)).toBeCloseTo(0.35, 2);
    expect(at(12, knit)).toBe(0.5);
  });

  it('leaves the column as drawn unless its pull follows the fabric, and an E stitch', () => {
    const { edgeAuto: _a, ...hand } = AUTO;
    expect(pushEnds([bar(0, 20, 4)], hand)).toEqual([]);
    expect(span(satinRuns([bar(0, 20, 4)], hand)[0])).toEqual([0, 20]);
    expect(pushEnds([bar(0, 20, 4)], { ...AUTO, type: 'e' })).toEqual([]);
    // A negative pull (a column sewn narrower) pushes nothing.
    expect(pushEnds([bar(0, 20, 4)], { ...AUTO, edge: -0.3, edgeShare: 0 })).toEqual([]);
  });

  it('keeps the ends where columns of the object meet: a miter, a joint, a chain', () => {
    // Two bars end to end at x = 20 (as on a cut line or a miter) and one standing on the first.
    const a = bar(0, 20, 4);
    const b = bar(20, 40, 4);
    const t = { left: [[10, 4], [10, 14]] as Pt[], right: [[14, 4], [14, 14]] as Pt[] };
    const ends = pushEnds([a, b, t], AUTO).map((e) => e.at);
    // Free: the far ends of the bars and the top of the stem.
    expect(ends).toEqual([[0, 2], [40, 2], [12, 14]]);
    const runs = satinRuns([{ ...a, chain: 0 }, { ...b, chain: 0 }], AUTO);
    const all = runs.flat();
    const [x0, x1] = span(all);
    expect(x0).toBeCloseTo(0.2, 2);
    expect(x1).toBeCloseTo(39.8, 2);
    // The joint stays sewn up to x = 20 from both sides.
    expect(all.some(([x]) => Math.abs(x - 20) < 1e-6)).toBe(true);
  });

  it('leaves a ring that closes on itself whole, and the cut lines between sections', () => {
    // A column round a square, its ends meeting.
    const ring: Rails = { left: [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0.01]], right: [[4, 4], [16, 4], [16, 16], [4, 16], [4, 4.01]] };
    expect(pushEnds([ring], AUTO)).toEqual([]);
    // A bar in two sections: shortened at its two ends only.
    const cut: Rails = { ...bar(0, 20, 4), cuts: [[10, 10]] };
    const run = satinRuns([cut], AUTO)[0];
    const [a, b] = span(run);
    expect(a).toBeCloseTo(0.2, 2);
    expect(b).toBeCloseTo(19.8, 2);
    expect(run.some(([x]) => Math.abs(x - 10) < 0.05)).toBe(true);
  });
});
