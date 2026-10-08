import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { thinSweeps } from '../src/correct/thin';
import { thinByHand } from '../src/correct/thinHand';
import { objectView } from '../src/model/handEdit';
import { STITCH, type Pattern } from '../src/model/pattern';
import { parsePattern } from '../src/parsers';
import { tagShortStitches, TIE } from '../src/validation/shortStitches';
import { Shape } from './helpers/shapes';

const all = (share: number) => (p: Pattern) => ({ needAt: (i: number) => (p.cmd[i] === STITCH ? share : 0) });

/** The y (0.1 mm) of each row of a fill sewn along x: where it turns. */
function rowsAt(p: Pattern): number[] {
  const ys = new Set<number>();
  for (let i = 1; i + 1 < p.cmd.length; i++) if (p.cmd[i] === STITCH && p.y[i] === p.y[i - 1] && p.y[i] !== p.y[i + 1]) ys.add(p.y[i]);
  return [...ys].sort((a, b) => a - b);
}

const gaps = (ys: number[]) => ys.slice(1).map((y, k) => y - ys[k]);

describe('thinned out by hand', () => {
  it('spreads the rows of a fill at a wider spacing, without stripes', () => {
    const p = new Shape().fill(0, 0, 20, 10, 'h', 0.4).build();
    const r = thinByHand(p, all(0.25)(p));
    expect(r.removed).toBeGreaterThan(0);
    const before = rowsAt(p);
    const after = rowsAt(r.pattern);
    // About a quarter fewer rows, from the first to the last.
    expect(after.length / before.length).toBeGreaterThan(0.7);
    expect(after.length / before.length).toBeLessThan(0.8);
    expect(after[0]).toBe(before[0]);
    expect(Math.max(...r.pattern.y)).toBe(100);
    // Evenly spread: no gap wider than the new spacing (0.4 / 0.75 mm) and some rounding.
    expect(Math.max(...gaps(after))).toBeLessThanOrEqual(6);
    // Taking out row pairs instead (the correction's way) leaves gaps of three spacings.
    expect(Math.max(...gaps(rowsAt(thinSweeps(p, all(0.25)(p)).pattern)))).toBeGreaterThanOrEqual(12);
  });

  it('keeps the rows on the edge', () => {
    const p = new Shape().fill(0, 0, 20, 10, 'h', 0.4).build();
    const q = thinByHand(p, all(0.34)(p)).pattern;
    for (let i = 0; i < q.cmd.length; i++) if (q.cmd[i] === STITCH) expect(q.x[i] >= 0 && q.x[i] <= 200 && q.y[i] >= 0 && q.y[i] <= 100).toBe(true);
    // Each row still runs from edge to edge.
    for (const y of rowsAt(q)) {
      const xs = [];
      for (let i = 0; i < q.cmd.length; i++) if (q.y[i] === y) xs.push(q.x[i]);
      expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 200]);
    }
  });

  it('spreads the zigzags of a satin', () => {
    const p = new Shape().satin(0, 0, 20, 4, 0.4).build();
    const r = thinByHand(p, all(0.5)(p));
    const zig = (q: Pattern) => q.cmd.filter((c) => c === STITCH).length;
    expect(zig(r.pattern) / zig(p)).toBeGreaterThan(0.45);
    expect(zig(r.pattern) / zig(p)).toBeLessThan(0.6);
    // The penetrations stay on its two edges.
    for (let i = 2; i < r.pattern.cmd.length; i++) expect([0, 40]).toContain(r.pattern.y[i]);
  });

  it('gives a line longer stitches, along its path', () => {
    const p = new Shape().to(0, 0).to(1.5, 0).to(3, 0).to(4.5, 0).to(6, 0).to(7.5, 0).to(9, 0).to(10.5, 0).to(12, 0).build();
    const r = thinByHand(p, all(0.5)(p));
    expect(r.removed).toBe(4);
    expect(Array.from(r.pattern.y).every((y) => y === 0)).toBe(true);
    expect(r.pattern.x[r.pattern.x.length - 1]).toBe(120);
  });

  it('keeps the corners of a line', () => {
    const p = new Shape().to(0, 0).to(1, 0).to(2, 0).to(2, 1).to(2, 2).build();
    const q = thinByHand(p, all(0.5)(p)).pattern;
    expect(Array.from(q.x).map((x, i) => [x, q.y[i]])).toContainEqual([20, 0]);
  });

  it('thins a triple line the same on every pass', () => {
    // cat-60mm.pes, the whisker "Steppstich 10" (Creme Details): sewn there, back and there again.
    const p = parsePattern(readFileSync(new URL('../public/examples/cat-60mm.pes', import.meta.url)), 'cat-60mm.pes');
    const o = objectView(p).objects[76];
    const tags = tagShortStitches(p);
    const r = thinByHand(p, { needAt: (i) => (i >= o.first && i <= o.last ? 0.25 : 0), protect: tags.map((t) => (t === TIE ? 1 : 0)) });
    expect(r.removed).toBeGreaterThanOrEqual(6);
    // What stays are penetrations it had, each still sewn three times.
    const at = (q: Pattern, a: number, b: number) => {
      const n = new Map<string, number>();
      for (let i = a; i <= b; i++) n.set(`${q.x[i]},${q.y[i]}`, (n.get(`${q.x[i]},${q.y[i]}`) ?? 0) + 1);
      return n;
    };
    const was = at(p, o.first, o.last);
    const now = at(r.pattern, o.first, o.last - r.removed);
    for (const [k, n] of now) expect(was.get(k)).toBe(n);
  });
});
