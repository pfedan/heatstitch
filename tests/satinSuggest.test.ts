import { describe, expect, it } from 'vitest';
import { buildRegion, type Region } from '../src/digitize/region';
import { chordOf, stripsOfAreas } from '../src/digitize/rungs';
import { areaLoops, suggestSatin } from '../src/digitize/satinSuggest';
import type { Pt } from '../src/digitize/skeleton';
import { satinRuns, type SatinSettings } from '../src/model/restitch';

const PX = 0.1;
const W = 600;

/** A region from a test on pixel centers (mm), in a 60 × 60 mm window. */
function region(inside: (x: number, y: number) => boolean): Region {
  const comp = new Int32Array(W * W);
  let [minX, minY, maxX, maxY] = [W, W, 0, 0];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside((x + 0.5) * PX, (y + 0.5) * PX)) continue;
      comp[y * W + x] = 1;
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  return buildRegion(comp, new Uint8Array(W * W), W, 1, 1, { minX, minY, maxX, maxY }, W, PX, 0, () => false);
}

/** Within `w`/2 of the segment from a to b. */
const near = (a: Pt, b: Pt, w: number) => (x: number, y: number) => {
  const v: Pt = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * v[0] + (y - a[1]) * v[1]) / (v[0] * v[0] + v[1] * v[1])));
  return Math.hypot(x - a[0] - v[0] * t, y - a[1] - v[1] * t) < w / 2;
};
const any =
  (...fs: ((x: number, y: number) => boolean)[]) =>
  (x: number, y: number) =>
    fs.some((f) => f(x, y));

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: true, underlay: true, tolerance: 0.15 };
const mid = ([a, b]: [Pt, Pt]): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** The suggestion's columns, as the satin tool makes them. */
function columns(r: Region) {
  const s = suggestSatin(r)!;
  const { outsides, holes } = areaLoops(r);
  const made = stripsOfAreas(outsides, s.lines, s.cuts, holes);
  return { s, made, strips: made.areas.flat() };
}

describe('Vorschlagen: satin for a drawing of lines', () => {
  it('runs the bar of a T through and ends the stem on its edge', () => {
    // Bar 40 mm long along y = 10, stem down from its middle; both 2 mm wide.
    const { s, strips } = columns(region(any(near([10, 10], [50, 10], 2), near([30, 10], [30, 40], 2))));
    expect(s.kind).toBe('strokes');
    expect(s.ok).toBe(true);
    expect(s.cuts.length).toBe(1);
    // The cut lies along the lower edge of the bar, across the stem.
    const [x, y] = mid(s.cuts[0]);
    expect(Math.abs(x - 30)).toBeLessThan(0.6);
    expect(Math.abs(y - 11)).toBeLessThan(0.6);
    expect(strips.length).toBe(2);
  });

  it('opens a ring once', () => {
    const ring = (x: number, y: number) => Math.abs(Math.hypot(x - 30, y - 30) - 15) < 1;
    const { s, strips } = columns(region(ring));
    expect(s.ok).toBe(true);
    expect(s.cuts.length).toBe(1);
    expect(strips.length).toBe(1);
  });

  it('keeps a short spur on its column, with a line across along it', () => {
    // A toe mark 2.5 mm long off a bar 2 mm wide.
    const { s, strips } = columns(region(any(near([10, 10], [50, 10], 2), near([30, 10], [30, 13.5], 1.6))));
    expect(s.ok).toBe(true);
    expect(s.cuts).toEqual([]);
    expect(strips.length).toBe(1);
    // A line from the tip of the spur, about upright.
    expect(s.lines.some(([a, b]) => Math.abs(a[0] - 30) < 0.5 && Math.abs(b[0] - 30) < 0.5 && a[1] > 12)).toBe(true);
  });

  it('cuts both arms of a crossing line', () => {
    const { s, strips } = columns(region(any(near([10, 26], [50, 34], 2), near([28, 10], [32, 50], 2))));
    expect(s.ok).toBe(true);
    expect(s.cuts.length).toBe(2);
    expect(strips.length).toBe(3);
  });

  it('fans the lines across round a sharp corner', () => {
    const { s } = columns(region(any(near([10, 10], [40, 10], 2), near([40, 10], [40, 40], 2))));
    expect(s.ok).toBe(true);
    // One along the bisector of the corner (from the inner to the outer corner, slanted).
    const slanted = s.lines.filter(([a, b]) => {
      const d = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * (180 / Math.PI)) % 90;
      return d > 30 && d < 60 && Math.hypot(mid([a, b])[0] - 40, mid([a, b])[1] - 10) < 1.5;
    });
    expect(slanted.length).toBe(1);
  });

  it('gives a dot apart from the lines a line across', () => {
    const { s, strips } = columns(region(any(near([10, 10], [50, 10], 2), (x, y) => Math.hypot(x - 30, y - 20) < 0.8)));
    expect(s.ok).toBe(true);
    expect(strips.length).toBe(2);
  });

  it('finds where a cut line through a corner of the outline meets it', () => {
    // Cut lines run from corner to corner of the outline, through its points: at any slant both
    // ends are found (rounding must not miss the corner on both edges that meet there).
    const ring: Pt[] = [];
    for (let k = 0; k <= 40; k++) ring.push([k * 0.37, 0.13 * Math.sin(k * 1.7)]);
    for (let k = 40; k >= 0; k--) ring.push([k * 0.37, 2.1 + 0.11 * Math.cos(k * 1.3)]);
    ring.push(ring[0]);
    let missed = 0;
    for (let k = 3; k < 38; k++) {
      const p = ring[k];
      const q = ring[81 - k + 1];
      const d: Pt = [q[0] - p[0], q[1] - p[1]];
      const l = Math.hypot(d[0], d[1]);
      if (!chordOf(ring, [p[0] - (d[0] / l) * 0.3, p[1] - (d[1] / l) * 0.3], [q[0] + (d[0] / l) * 0.3, q[1] + (d[1] / l) * 0.3])) missed++;
    }
    expect(missed).toBe(0);
  });

  it('suggests nothing for a wide area', () => {
    const s = suggestSatin(region((x, y) => Math.hypot(x - 30, y - 30) < 15))!;
    expect(s.kind).toBe('wide');
    expect(s.cuts).toEqual([]);
    expect(s.lines).toEqual([]);
  });

  it('sews the columns as satin covering the lines', () => {
    const { strips } = columns(region(any(near([10, 10], [50, 10], 2), near([30, 10], [30, 40], 2))));
    const runs = satinRuns(strips.map((x) => ({ ...x, chain: 0 })), SATIN);
    expect(runs.length).toBe(1);
    // Every stitch end lies on the T (with the pull compensation's few tenths).
    const onT = any(near([10, 10], [50, 10], 2.6), near([30, 10], [30, 40], 2.6));
    for (const q of runs[0]) expect(onT(q[0], q[1]), `${q}`).toBe(true);
  });
});
