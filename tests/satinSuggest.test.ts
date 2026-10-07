import { describe, expect, it } from 'vitest';
import { buildRegion, type Region } from '../src/digitize/region';
import { stripsOfAreas } from '../src/digitize/rungs';
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

/** The longest stitch of the suggestion sewn as satin (mm). */
function longest(r: Region): number {
  const { strips } = columns(r);
  const runs = satinRuns(strips.map((x) => ({ ...x, chain: 0 })), SATIN);
  let m = 0;
  for (const run of runs) for (let i = 1; i < run.length; i++) m = Math.max(m, Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
  return m;
}
const disk = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) < r;
const triangle = (a: Pt, b: Pt, c: Pt) => (x: number, y: number) => {
  const s = (p: Pt, q: Pt) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const [u, v, w] = [s(a, b), s(b, c), s(c, a)];
  return (u >= 0 && v >= 0 && w >= 0) || (u <= 0 && v <= 0 && w <= 0);
};

describe('Vorschlagen: dots and pointed areas', () => {
  it('sews a small dot as one column across', () => {
    const { s, strips } = columns(region(disk(30, 30, 2.5)));
    expect(s.kind).toBe('dot');
    expect(s.ok).toBe(true);
    expect(s.cuts).toEqual([]);
    expect(strips.length).toBe(1);
  });

  it('cuts a larger dot in two halves, no stitch longer than the half', () => {
    const r = region(disk(30, 30, 5));
    const { s, strips } = columns(r);
    expect(s.kind).toBe('dot');
    expect(s.ok).toBe(true);
    expect(s.cuts.length).toBe(1);
    expect(strips.length).toBe(2);
    expect(longest(r)).toBeLessThan(5.8);
  });

  it('cuts a pupil through its highlight', () => {
    // A 9 mm dot with a highlight off its middle.
    const r = region((x, y) => disk(30, 30, 4.5)(x, y) && !disk(31.5, 28.5, 1)(x, y));
    const { s, strips } = columns(r);
    expect(s.kind).toBe('dot');
    expect(s.ok).toBe(true);
    // From the edge into the highlight and on out the other side.
    expect(s.cuts.length).toBe(2);
    expect(strips.length).toBe(2);
    expect(longest(r)).toBeLessThan(5.8);
  });

  it('fans the lines across a triangle out from its tip', () => {
    // Wider than tall, pointing down: the stitches run from the tip to the top edge.
    const tip: Pt = [30, 34];
    const { s, strips } = columns(region(triangle([26, 30], [34, 30], tip)));
    expect(s.kind).toBe('pointed');
    expect(s.ok).toBe(true);
    expect(strips.length).toBe(1);
    expect(s.lines.length).toBeGreaterThanOrEqual(3);
    // Every line passes close to the tip.
    for (const [a, b] of s.lines) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - tip[1]) - (b[1] - a[1]) * (a[0] - tip[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
      expect(d).toBeLessThan(0.6);
    }
  });

  it('runs a tall narrow triangle as one column, no fan', () => {
    const { s, strips } = columns(region(triangle([28, 25], [32, 25], [30, 37])));
    expect(s.kind).not.toBe('pointed');
    expect(s.ok).toBe(true);
    expect(strips.length).toBe(1);
  });

  it('cuts a heart from its notch to its tip', () => {
    const heart = (x: number, y: number) => {
      const [X, Y] = [(x - 30) / 3.5, -(y - 30) / 3.5];
      return (X * X + Y * Y - 1) ** 3 - X * X * Y ** 3 < 0;
    };
    const { s, strips } = columns(region(heart));
    expect(s.kind).toBe('pointed');
    expect(s.ok).toBe(true);
    expect(s.cuts.length).toBe(1);
    expect(strips.length).toBe(2);
    // About upright through the middle.
    const [a, b] = s.cuts[0];
    expect(Math.abs(a[0] - 30)).toBeLessThan(0.6);
    expect(Math.abs(b[0] - 30)).toBeLessThan(0.6);
  });
});

describe('Vorschlagen: thick places in a drawing of lines', () => {
  it('cuts a nose off the mouth and fans it out from its tip', () => {
    // A triangle pointing down with the mouth hanging from its tip: a short stem, then two lines.
    const r = region(any(triangle([26, 26], [34, 26], [30, 30.5]), near([30, 30], [30, 32], 1.2), near([30, 32], [26.5, 35], 1.2), near([30, 32], [33.5, 35], 1.2)));
    const { s, strips } = columns(r);
    expect(s.ok).toBe(true);
    // The nose, the stem and the two lines of the mouth (the stem runs through into one of them).
    expect(strips.length).toBe(3);
    // A cut across the stem just below the nose.
    expect(s.cuts.some((c) => Math.abs(mid(c)[0] - 30) < 0.5 && mid(c)[1] > 29.6 && mid(c)[1] < 31.2)).toBe(true);
    // Lines fanning in the nose: from below its middle up to its top edge, slanted both ways.
    const fan = s.lines.filter(([a, b]) => Math.min(a[1], b[1]) < 26.6 && Math.max(a[1], b[1]) > 29);
    expect(fan.length).toBeGreaterThanOrEqual(3);
    expect(fan.some(([a, b]) => (b[0] - a[0]) * (b[1] - a[1]) > 0)).toBe(true);
    expect(fan.some(([a, b]) => (b[0] - a[0]) * (b[1] - a[1]) < 0)).toBe(true);
  });

  it('parts the pupil from the ring of an eye and cuts it through its highlight', () => {
    // A ring round a green crescent, the pupil filling the rest and merging with the ring on the
    // left, a highlight in the pupil (as Kitty's eyes).
    const eye = (x: number, y: number) =>
      disk(30, 30, 4.7)(x, y) && !(disk(30, 30, 3.8)(x, y) && !disk(29, 30, 3.2)(x, y)) && !disk(28, 28.6, 0.9)(x, y);
    const r = region(eye);
    const { s, strips } = columns(r);
    expect(s.ok).toBe(true);
    // The ring is a column of its own, the pupil two halves: the cut runs through the highlight,
    // clear of the cuts that part the ring.
    expect(strips.length).toBe(3);
    expect(s.cuts.length).toBe(4);
    expect(longest(r)).toBeLessThan(6);
  });
});

describe('Vorschlagen: mirrored', () => {
  it('plans a mirrored nose and eye the same way', () => {
    const nose = any(triangle([26, 26], [34, 26], [30, 30.5]), near([30, 30], [30, 32], 1.2), near([30, 32], [26.5, 35], 1.2), near([30, 32], [33.5, 35], 1.2));
    const eye = (x: number, y: number) =>
      disk(30, 30, 4.7)(x, y) && !(disk(30, 30, 3.8)(x, y) && !disk(29, 30, 3.2)(x, y)) && !disk(28, 28.6, 0.9)(x, y);
    for (const f of [nose, eye]) {
      const a = columns(region(f));
      const b = columns(region((x, y) => f(60 - x, y)));
      expect(b.s.ok).toBe(true);
      expect([b.s.cuts.length, b.strips.length]).toEqual([a.s.cuts.length, a.strips.length]);
    }
  });
});
