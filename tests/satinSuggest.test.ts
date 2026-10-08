import { describe, expect, it } from 'vitest';
import { buildRegion, type Region } from '../src/digitize/region';
import { chordOf, inside, stripsOfAreas } from '../src/digitize/rungs';
import { areaLoops, covers, suggestSatin } from '../src/digitize/satinSuggest';
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

  it('squares a line across the bar where the stem of a T joins it', () => {
    // Where the stem's cut makes its side, the bar's stitches would otherwise fan toward it.
    const { s } = columns(region(any(near([10, 10], [50, 10], 3), near([22, 10], [22, 40], 3))));
    expect(s.ok).toBe(true);
    expect(s.lines.some((l) => Math.abs(mid(l)[0] - 22) < 0.5 && Math.abs(l[0][0] - l[1][0]) < 0.3 && Math.abs(mid(l)[1] - 10) < 1)).toBe(true);
  });

  it('keeps all four arms of an upright cross', () => {
    // Even pixel widths, straight up: thinned row by row the upper arm used to be lost.
    const { s, strips } = columns(region(any(near([30, 5], [30, 50], 4), near([8, 20], [52, 20], 4))));
    expect(s.ok).toBe(true);
    expect(s.cuts.length).toBe(2);
    expect(strips.length).toBe(3);
  });

  it('sees past pinholes in a line', () => {
    // A raw threshold of a speckled scan: single pixels missing all along the bar.
    const bar = near([10, 20], [50, 20], 3);
    const { s, strips } = columns(region((x, y) => bar(x, y) && !(Math.round(x * 10) % 7 === 3 && Math.round(y * 10) % 5 === 1)));
    expect(s.ok).toBe(true);
    expect(s.cuts).toEqual([]);
    expect(strips.length).toBe(1);
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

  it('cuts a loop on a stem off as a ring of its own', () => {
    // A ring (radius 6, 2 mm wide) with a stem down from its bottom, a lollipop.
    const ring = (x: number, y: number) => Math.abs(Math.hypot(x - 30, y - 20) - 6) < 1;
    const { s, strips } = columns(region(any(ring, near([30, 26], [30, 45], 2))));
    expect(s.ok).toBe(true);
    // One cut ends the stem at the ring, one opens the ring.
    expect(s.cuts.length).toBe(2);
    expect(strips.length).toBe(2);
  });

  it('cuts a loop with two lines below it off at both its ends', () => {
    // A ring as above, two legs going down left and right from its bottom (a 人 with a loop on top).
    const ring = (x: number, y: number) => Math.abs(Math.hypot(x - 30, y - 20) - 6) < 1;
    const { s } = columns(region(any(ring, near([30, 26], [18, 45], 2), near([30, 26], [42, 45], 2))));
    expect(s.ok).toBe(true);
  });

  it('runs one of two lines crossing at a slant through', () => {
    // Two lines crossing at about 30° (the skeleton makes two forks a little apart).
    const { s, strips } = columns(region(any(near([8, 24], [52, 36], 2), near([8, 36], [52, 24], 2))));
    expect(s.ok).toBe(true);
    expect(s.cuts.length).toBe(2);
    expect(strips.length).toBe(3);
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

const star = (cx: number, cy: number, R: number, r: number, n = 5): Pt[] =>
  Array.from({ length: 2 * n }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    return [cx + (i % 2 ? r : R) * Math.cos(a), cy + (i % 2 ? r : R) * Math.sin(a)] as Pt;
  });
const polygon = (p: Pt[]) => (x: number, y: number) => inside(p, [x, y]);
const box = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
/** A leaf L long and W wide along the x axis turned by `ang`: two circular arcs meeting in its tips. */
const leaf = (cx: number, cy: number, L: number, W: number, ang = 0) => {
  const R = (L * L) / 4 / W + W / 4;
  const d = R - W / 2;
  return (x: number, y: number) => {
    const u = (x - cx) * Math.cos(ang) + (y - cy) * Math.sin(ang);
    const v = -(x - cx) * Math.sin(ang) + (y - cy) * Math.cos(ang);
    return Math.hypot(u, v - d) < R && Math.hypot(u, v + d) < R;
  };
};
const frame = (x: number, y: number) => box(20, 22, 40, 38)(x, y) && !box(22.5, 24.5, 37.5, 35.5)(x, y);
const blockE = any(box(23, 20, 27.5, 40), box(23, 20, 35, 24), box(23, 28, 33, 32), box(23, 36, 35, 40));
const angle = ([a, b]: [Pt, Pt], [c, d]: [Pt, Pt]) => {
  const u = [b[0] - a[0], b[1] - a[1]];
  const v = [d[0] - c[0], d[1] - c[1]];
  return (Math.acos(Math.abs(u[0] * v[0] + u[1] * v[1]) / Math.hypot(u[0], u[1]) / Math.hypot(v[0], v[1])) * 180) / Math.PI;
};

describe('Vorschlagen: spikes, frames, leaves and crescents', () => {
  it('cuts the points of a star off at their bases, each sewn from its base to its tip', () => {
    const r = region(polygon(star(30, 30, 8, 3.5)));
    const { s, strips } = columns(r);
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('spikes');
    // Five points and the middle.
    expect(s.cuts.length).toBe(5);
    expect(strips.length).toBe(6);
    // Each cut lies across the base of a point: about 3.5 mm from the middle, between two notches.
    for (const c of s.cuts) expect(Math.hypot(mid(c)[0] - 30, mid(c)[1] - 30)).toBeLessThan(3.4);
    expect(longest(r)).toBeLessThan(7);
  });

  it('keeps the stitches of a star within a lower satin limit', () => {
    const r = region(polygon(star(30, 30, 9, 4.5, 8)));
    const s = suggestSatin(r, undefined, 4.5)!;
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('spikes');
    // The middle is too wide for one column at 4.5 mm: cut in two halves.
    expect(s.cuts.length).toBe(9);
  });

  it('cuts a frame on the miter at its four corners', () => {
    const r = region(frame);
    const { s, strips } = columns(r);
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('frame');
    expect(s.cuts.length).toBe(4);
    expect(strips.length).toBe(4);
    // Each cut runs from an outer corner to the inner one: on the diagonal, 45° to the sides.
    const corners: Pt[] = [[21.25, 23.25], [38.75, 23.25], [21.25, 36.75], [38.75, 36.75]];
    for (const c of corners) expect(s.cuts.some((k) => Math.hypot(mid(k)[0] - c[0], mid(k)[1] - c[1]) < 0.6 && Math.abs(angle(k, [[0, 0], [1, 0]]) - 45) < 8)).toBe(true);
    // Stitches across the sides, not along them.
    expect(longest(r)).toBeLessThan(3.6);
  });

  it('cuts a block letter on the miter at its corners and ends the middle bar on the stem', () => {
    const { s, strips } = columns(region(blockE));
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('frame');
    expect(strips.length).toBe(4);
    // The middle bar ends on the stem: a cut along the stem's edge.
    expect(s.cuts.some((c) => Math.abs(mid(c)[0] - 27.5) < 0.3 && angle(c, [[0, 0], [0, 1]]) < 5)).toBe(true);
  });

  it('cuts a wide leaf along its vein, the stitches slanting toward its tip', () => {
    const r = region(leaf(30, 30, 18, 10, 0.4));
    const { s, strips } = columns(r);
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('leaf');
    expect(s.cuts.length).toBe(1);
    expect(strips.length).toBe(2);
    // The vein runs along the leaf, the lines across slant at about 60° to it.
    expect(angle(s.cuts[0], [[0, 0], [Math.cos(0.4), Math.sin(0.4)]])).toBeLessThan(5);
    for (const l of s.lines) expect(Math.abs(angle(l, s.cuts[0]) - 60)).toBeLessThan(5);
    expect(longest(r)).toBeLessThan(7);
  });

  it('sews a narrow leaf as one column and finds a drop', () => {
    expect(columns(region(leaf(30, 30, 16, 6))).s.kind).toBe('leaf');
    const drop: Pt[] = Array.from({ length: 120 }, (_, i) => {
      const t = (i / 120) * 2 * Math.PI;
      return [30 + 6.3 * Math.sin(t) * Math.sin(t / 2), 30 - 7 * Math.cos(t)];
    });
    const r = region(polygon(drop));
    const { s } = columns(r);
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('drop');
    expect(longest(r)).toBeLessThan(7);
  });

  it('sews a crescent as one column turning with it', () => {
    const { s, strips } = columns(region((x, y) => disk(30, 30, 7)(x, y) && !disk(32.5, 29, 6.2)(x, y)));
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('crescent');
    expect(strips.length).toBe(1);
  });

  it('plans a mirrored star, frame and leaf the same way', () => {
    for (const f of [polygon(star(30, 30, 8, 3.5)), blockE, leaf(30, 30, 18, 10, 0.4)]) {
      const a = columns(region(f));
      const b = columns(region((x, y) => f(60 - x, y)));
      expect(b.s.ok).toBe(true);
      expect([b.s.kind, b.s.cuts.length, b.strips.length]).toEqual([a.s.kind, a.s.cuts.length, a.strips.length]);
    }
  });

  it('miters a ring with round outer corners from the corners of its hole', () => {
    // A brush-drawn box: 20 × 12 mm with corners round by 3 mm, a sharp 14 × 6 mm hole.
    const box = (x: number, y: number) => {
      const [dx, dy] = [Math.max(0, Math.abs(x - 30) - 7), Math.max(0, Math.abs(y - 30) - 3)];
      return Math.hypot(dx, dy) < 3;
    };
    const { s, strips } = columns(region((x, y) => box(x, y) && !(Math.abs(x - 30) < 7 && Math.abs(y - 30) < 3)));
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('frame');
    expect(s.cuts.length).toBe(4);
    expect(strips.length).toBe(4);
  });

  it('sews a wide fan as a column when asked', () => {
    // A quarter of a disc: the fan from its corner would pile up there.
    const r = region((x, y) => x > 30 && y > 30 && Math.hypot(x - 30, y - 30) < 5);
    expect(suggestSatin(r)!.kind).toBe('pointed');
    const s = suggestSatin(r, undefined, 7, true)!;
    expect(s.ok).toBe(true);
    expect(s.kind).not.toBe('pointed');
  });

  it('sews a crossing through when asked, not as a thick place', () => {
    // Two 3 mm strokes crossing: no part of the plan is a shape of its own.
    const r = region(any(near([15, 30], [45, 30], 3), near([30, 15], [30, 45], 3)));
    const s = suggestSatin(r, undefined, 7, false, false)!;
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('strokes');
  });
});

describe('Vorschlagen: no column across a hole', () => {
  // A square hole 10 mm wide in a frame 2 mm wide.
  const hole: Pt[] = [[12, 12], [22, 12], [22, 22], [12, 22], [12, 12]];
  it('takes a column round the hole as it is', () => {
    // Along the top of the frame, above the hole.
    expect(covers([{ left: [[10, 10], [24, 10]], right: [[10, 12], [24, 12]], rungs: [] }], [hole])).toBe(false);
  });

  it('says when a column runs across the hole, its rails the frame either side', () => {
    // Rails on the top and the bottom of the frame: its stitches would cover the hole.
    expect(covers([{ left: [[10, 11], [24, 11]], right: [[10, 23], [24, 23]], rungs: [] }], [hole])).toBe(true);
  });
});
