import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addRung, columnFromRungs, cornerRungs, cumulative, railsFromOutline, reversedRungs, rungFromLine, seedRungs, tidyRungs, type Rung } from '../src/digitize/rungs';
import { eStitches, pairs, satinStitches, underlayOf } from '../src/digitize/satin';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { analyze, columnOf, keepShape, measureSatin, remember, remembered, rememberedIn, restitch, reversedRails, type Rails } from '../src/model/restitch';
import { SATIN, stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

/** A straight rail from (x0, y) to (x1, y) with a point every mm. */
const line = (x0: number, x1: number, y: number): Pt[] => Array.from({ length: Math.round(Math.abs(x1 - x0)) + 1 }, (_, i) => [x0 + Math.sign(x1 - x0) * i, y] as Pt);
const angle = (a: Pt, b: Pt) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;

describe('rungs', () => {
  it('pairs the rails at the same share of their length between rungs', () => {
    // Left rail 10 mm, right rail 20 mm: without rungs the stitches slant all along.
    const left = line(0, 10, 0);
    const right = line(0, 20, 4);
    const plain = columnFromRungs(left, right, []);
    const mid = plain.left.length >> 1;
    expect(plain.left[mid][0]).toBeCloseTo(5, 1);
    expect(plain.right[mid][0]).toBeCloseTo(10, 1);
    // A rung at (5, 5) holds the first half straight.
    const col = columnFromRungs(left, right, [[5, 5]]);
    const k = col.left.findIndex((p) => p[0] >= 2.5);
    expect(col.right[k][0]).toBeCloseTo(col.left[k][0], 1);
  });

  it('drops rungs that cross another or lie on an end', () => {
    expect(tidyRungs([[5, 5], [3, 7], [9.95, 2]], 10, 10)).toEqual([[3, 7]]);
    expect(addRung([[3, 3]], [4, 2], 10, 10)).toBeNull();
    expect(addRung([[3, 3]], [6, 6], 10, 10)).toEqual([[3, 3], [6, 6]]);
  });

  it('finds a rung where a line drawn across meets both rails', () => {
    const r = rungFromLine(line(0, 10, 0), line(0, 10, 4), [3, -0.5], [4, 4.5]);
    expect(r![0]).toBeCloseTo(3.1, 1);
    expect(r![1]).toBeCloseTo(3.9, 1);
    expect(rungFromLine(line(0, 10, 0), line(0, 10, 4), [3, 1], [4, 2])).not.toBeNull();
    expect(rungFromLine(line(0, 10, 0), line(0, 10, 4), [-3, 1], [-1, 2])).toBeNull();
  });

  it('seeds rungs that keep the directions the stitches have', () => {
    // Stitches straight across, then slanted, then straight again.
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i <= 30; i++) {
      left.push([i, 0]);
      right.push([i + (i > 10 && i < 20 ? 2 : 0), 4]);
    }
    const seeds = seedRungs(left, right);
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    const col = columnFromRungs(left, right, seeds);
    // Directions follow the original within a few degrees at every original pair.
    for (let i = 1; i < 30; i++) {
      const k = col.left.findIndex((p) => p[0] >= i - 1e-6);
      const want = angle(left[i], right[i]);
      expect(Math.abs(angle(col.left[k], col.right[k]) - want)).toBeLessThan(15);
    }
    // Straight stitches need no rungs.
    expect(seedRungs(line(0, 20, 0), line(0, 20, 3))).toEqual([]);
  });

  it('puts rungs on a corner so the stitches fan around it', () => {
    // An L: 20 mm east, then 20 mm north (y up is negative), 4 mm wide. Inner rail on the north side.
    const inner: Pt[] = [...line(0, 18, -2), ...Array.from({ length: 18 }, (_, i) => [18, -3 - i] as Pt)];
    const outer: Pt[] = [...line(0, 22, 2), ...Array.from({ length: 22 }, (_, i) => [22, 1 - i] as Pt)];
    const rungs = cornerRungs(inner, outer, []);
    expect(rungs.length).toBeGreaterThanOrEqual(2);
    // One rung runs from the inner corner to the outer corner.
    const ci = cumulative(inner);
    const co = cumulative(outer);
    expect(rungs.some(([a, b]) => Math.abs(a - ci[18]) < 1 && Math.abs(b - co[22]) < 1.5)).toBe(true);
    const col = columnFromRungs(inner, outer, rungs);
    // On the straight legs the stitches stay square to the rails.
    const k = col.left.findIndex((p) => p[0] >= 5);
    expect(Math.abs(angle(col.left[k], col.right[k]) - 90)).toBeLessThan(8);
  });

  it('turns with the rails when they are walked from the other end', () => {
    const rungs: Rung[] = [[2, 3], [6, 8]];
    expect(reversedRungs(rungs, 10, 12)).toEqual([[4, 4], [9, 8]]);
    const r: Rails = { left: line(0, 10, 0), right: line(0, 12, 4), rungs };
    const back = reversedRails(reversedRails(r));
    expect(back.rungs).toEqual(rungs);
  });

  it('cuts a shape into a strip with rungs drawn across it', () => {
    // A 30 × 6 mm bar, counter-clockwise, with rungs at x = 8 and x = 22.
    const loop: Pt[] = [[0, 0], [30, 0], [30, 6], [0, 6]];
    const r = railsFromOutline(loop, [
      [[8, -1], [8, 7]],
      [[22, 7], [22, -1]],
    ])!;
    expect(r).not.toBeNull();
    expect(r.rungs).toHaveLength(2);
    const col = columnFromRungs(r.left, r.right, r.rungs);
    // Between the rungs the stitches go straight across the bar.
    const k = col.left.findIndex((p) => p[0] >= 15 && p[1] < 1);
    const j = k >= 0 ? k : col.right.findIndex((p) => p[0] >= 15 && p[1] < 1);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(Math.abs(col.left[j][0] - col.right[j][0])).toBeLessThan(0.3);
    expect(col.width).toBeGreaterThan(5);
    // A rung that does not cross the shape gives no strip.
    expect(railsFromOutline(loop, [[[8, -1], [8, 7]], [[40, -1], [40, 7]]])).toBeNull();
  });
});

describe('satin stitches', () => {
  const col = columnOf({ left: line(0, 20, 0), right: line(0, 20, 14) });

  it('staggers the split points of wide columns', () => {
    const ps = pairs(col, { spacing: 0.5, pull: 0, splitMm: 7 });
    const even = satinStitches(ps, { spacing: 0.5, pull: 0, splitMm: 7 });
    const staggered = satinStitches(ps, { spacing: 0.5, pull: 0, splitMm: 7, stagger: true });
    const ys = (pts: Pt[]) => new Set(pts.filter((p) => p[1] > 0.5 && p[1] < 13.5).map((p) => Math.round(p[1] * 2)));
    // Even splits all lie on one line; staggered ones spread across the column.
    expect(ys(even).size).toBeLessThanOrEqual(3);
    expect(ys(staggered).size).toBeGreaterThan(4);
    for (let i = 1; i < staggered.length; i++) expect(Math.hypot(staggered[i][0] - staggered[i - 1][0], staggered[i][1] - staggered[i - 1][1])).toBeLessThanOrEqual(7.01);
  });

  it('widens each side on its own and by a share of the width', () => {
    const narrow = columnOf({ left: line(0, 10, 0), right: line(0, 10, 4) });
    const [a, b] = pairs(narrow, { spacing: 0.5, pull: 0.2, pullB: 0, pullShare: 0.1, splitMm: 12 })[3];
    expect(a[1]).toBeCloseTo(-0.6, 5);
    expect(b[1]).toBeCloseTo(4.4, 5);
  });

  it('sews an E stitch along the left rail, across and back on the same holes', () => {
    const narrow = columnOf({ left: line(0, 10, 0), right: line(0, 10, 3) });
    const pts = eStitches(pairs(narrow, { spacing: 2, pull: 0, splitMm: 12 }), { spacing: 2, pull: 0, splitMm: 12 });
    expect(pts.slice(0, 4)).toEqual([[0, 0], [0, 3], [0, 0], pts[3]]);
    expect(pts[3][1]).toBe(0);
    expect(pts[3][0]).toBeGreaterThan(1.5);
  });

  it('has a contour underlay that comes back to the start', () => {
    const u = underlayOf(columnOf({ left: line(0, 10, 0), right: line(0, 10, 4) }), 'contour');
    expect(u.atEnd).toBe(false);
    expect(Math.hypot(u.pts[0][0] - u.pts[u.pts.length - 1][0], u.pts[0][1] - u.pts[u.pts.length - 1][1])).toBeLessThan(4.1);
    expect(underlayOf(columnOf({ left: line(0, 10, 0), right: line(0, 10, 4) }), 'both').atEnd).toBe(true);
  });
});

/** A pattern from stitch points (0.1 mm), the first one a jump. */
function patternOf(pts: Pt[]): Pattern {
  const x = Int32Array.from(pts, (p) => Math.round(p[0] * 10));
  const y = Int32Array.from(pts, (p) => Math.round(p[1] * 10));
  const cmd = Uint8Array.from(pts, () => STITCH);
  return { x, y, cmd, colors: [{ r: 200, g: 0, b: 0 }], name: 'e', format: 'dst' } as unknown as Pattern;
}

describe('rungs and new stitches', () => {
  it('keeps rungs with the satin and stores them in the project', () => {
    const p = load('demos/letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin')!;
    const shape = keepShape(p, o, kinds);
    expect(shape.columns?.length).toBeGreaterThan(0);
    const columns = shape.columns!.map((part) => part.map((c) => ({ ...c, rungs: seedRungs(c.left, c.right) })));
    remember(p, o, { ...shape, columns, read: false });
    const pt = analyze(p, o, kinds).parts.find((x) => x.kind === 'satin')!;
    const r = restitch(p, objs, [o.index], { kind: 'satin', s: measureSatin(p, pt, kinds) }, kinds, 7);
    expect(r.starts).toHaveLength(1);
    expect(r.memory[0].columns?.[0][0].rungs).toEqual(columns[0][0].rungs);
    const nk = stitchKinds(r.pattern);
    const no = sewObjects(r.pattern, nk);
    const again = no.find((x) => x.first >= o.first && x.kind === 'satin')!;
    remember(r.pattern, again, r.memory[0]);
    const stored = rememberedIn(r.pattern, no).find((s) => s.columns);
    expect(stored?.columns?.[0][0].rungs?.length).toBe(columns[0][0].rungs!.length * 2);
    expect(remembered(r.pattern, again)?.columns?.[0][0].rungs).toBeDefined();
  });

  it('recognizes an E stitch as satin and reads its rails back', () => {
    const narrow = columnOf({ left: line(0, 30, 0), right: line(0, 30, 3) });
    const sp = { spacing: 2.5, pull: 0, splitMm: 12 };
    const p = patternOf(eStitches(pairs(narrow, sp), sp));
    const kinds = stitchKinds(p);
    let satin = 0;
    for (let i = 1; i < p.cmd.length; i++) if (kinds[i] === SATIN) satin++;
    expect(satin).toBeGreaterThan(p.cmd.length * 0.8);
    const o = sewObjects(p, kinds)[0];
    expect(o.kind).toBe('satin');
    const pt = analyze(p, o, kinds).parts.find((x) => x.kind === 'satin')!;
    const m = measureSatin(p, pt, kinds);
    expect(m.type).toBe('e');
    expect(m.spacing).toBeCloseTo(2.5, 0);
  });
});

describe('satin along rungs drawn across a shape', () => {
  it('needs the shape to end soon after the first and the last rung', () => {
    // An L-shaped area: rungs only across the foot leave the long leg beyond the last one.
    const loop: Pt[] = [[0, 0], [30, 0], [30, 6], [6, 6], [6, 30], [0, 30]];
    expect(railsFromOutline(loop, [[[20, -1], [20, 7]], [[26, -1], [26, 7]]])).toBeNull();
    // Rungs at both ends of the L and one across its corner give a strip that turns.
    const r = railsFromOutline(loop, [
      [[-1, 25], [7, 25]],
      [[-1, -1], [7, 7]],
      [[25, -1], [25, 7]],
    ]);
    expect(r).not.toBeNull();
    expect(r!.rungs).toHaveLength(3);
  });
});
