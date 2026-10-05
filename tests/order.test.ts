import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { overlaps, sewObjects } from '../src/model/objects';
import { moveStats, optimizeOrder, reorder, violations } from '../src/model/order';
import { COLOR_CHANGE, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { parsePattern } from '../src/parsers';
import { recordOfStitch, stitchNumbers } from '../src/model/sequence';
import { Writer } from './helpers/designs';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
const FILES = ['cat-60mm.pes', 'demos/confetti.pes', 'demos/letters.pes', 'demos/overlap.pes', 'demos/sun.dst', 'demos/leather-patch.dst'];

/** Every stitch of the pattern with its thread color, as sorted strings (where and in what color). */
function stitchesByColor(p: Pattern): string[] {
  const out: string[] = [];
  let block = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.cmd[i] === COLOR_CHANGE) block++;
    if (p.cmd[i] !== STITCH) continue;
    const c = p.colors[block] ?? p.colors[p.colors.length - 1];
    out.push(`${c.r},${c.g},${c.b} ${p.x[i]} ${p.y[i]}`);
  }
  return out.sort();
}

/** A square of running stitch (mm), `n` stitches per side. */
function square(w: Writer, x: number, y: number, s: number): void {
  w.start([x, y]);
  for (const [px, py] of [
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
    [x, y],
  ]) w.to([px, py]);
}

describe('objects', () => {
  it('splits the stitches at every move and finds what lies on what', () => {
    const w = new Writer();
    square(w, 0, 0, 10);
    square(w, 30, 0, 10);
    w.color();
    square(w, 5, 5, 10); // crosses the first square
    const p = w.b.build('t', 'pes', [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 0, b: 255 },
    ]);
    const objs = sewObjects(p);
    expect(objs.map((o) => o.block)).toEqual([0, 0, 1]);
    const over = overlaps(p, objs);
    expect(over[2]).toEqual([0]);
    expect(over[1]).toEqual([]);
  });
});

describe('sewing order', () => {
  it('sews a moved object in the thread of the color it is dropped into', () => {
    const red = { r: 255, g: 0, b: 0 };
    const blue = { r: 0, g: 0, b: 255 };
    const w = new Writer();
    square(w, 0, 0, 10);
    square(w, 30, 0, 10);
    w.color();
    square(w, 60, 0, 10);
    const p = w.b.build('t', 'pes', [red, blue]);
    const objs = sewObjects(p);
    // The second red square goes into the blue block, after the blue square.
    const into = reorder(p, objs, [0, 2, 1], 3, undefined, { into: new Map([[1, 1]]) });
    expect(into.colors).toEqual([red, blue]);
    const blueStitches = stitchesByColor(into).filter((s) => s.startsWith('0,0,255'));
    expect(blueStitches.some((s) => s.endsWith(' 300 0'))).toBe(true);
    // Without taking the thread it is sewn there in its own: a third block.
    const own = reorder(p, objs, [0, 2, 1], 3);
    expect(own.colors).toEqual([red, blue, red]);
    // Taking the thread in place, without moving: the object leaves its color.
    const inPlace = reorder(p, objs, [0, 1, 2], 3, undefined, { into: new Map([[1, 1]]) });
    expect(inPlace.colors).toEqual([red, blue]);
    expect(moveStats(inPlace).colorChanges).toBe(1);
    expect(stitchesByColor(inPlace).filter((s) => s.startsWith('0,0,255')).length).toBeGreaterThan(stitchesByColor(p).filter((s) => s.startsWith('0,0,255')).length);
  });

  it('combines colors where nothing lies in between, and keeps layering', () => {
    const red = { r: 255, g: 0, b: 0 };
    const blue = { r: 0, g: 0, b: 255 };
    const w = new Writer();
    square(w, 0, 0, 10);
    w.color();
    square(w, 50, 0, 10); // blue, apart from everything
    w.color();
    square(w, 0, 30, 10); // red again, could join the first red
    w.color();
    square(w, 2, 2, 6); // blue on top of the first red square: has to stay after it
    const p = w.b.build('t', 'pes', [red, blue, red, blue]);
    const objs = sewObjects(p);
    const over = overlaps(p, objs);
    const order = optimizeOrder(p, objs, over, { combineColors: true, shortestWays: true, trimMm: 3 });
    expect(violations(order, over)).toEqual([]);
    const q = reorder(p, objs, order, 3);
    expect(q.colors).toHaveLength(2);
    expect(moveStats(q).colorChanges).toBe(1);
    const after = new Set(stitchesByColor(q));
    expect(stitchesByColor(p).every((s) => after.has(s))).toBe(true);
  });

  it('keeps a stop between two blocks of the same color', () => {
    const red = { r: 255, g: 0, b: 0 };
    const w = new Writer();
    square(w, 0, 0, 10);
    w.color();
    square(w, 30, 0, 10);
    const p = w.b.build('t', 'pes', [red, red]);
    const objs = sewObjects(p);
    const order = optimizeOrder(p, objs, overlaps(p, objs), { combineColors: true, shortestWays: true, trimMm: 3 });
    expect(order).toEqual([0, 1]);
  });

  it('trims new long moves with ties', () => {
    const red = { r: 255, g: 0, b: 0 };
    const w = new Writer();
    square(w, 0, 0, 10);
    square(w, 40, 0, 10);
    square(w, 15, 0, 10);
    const p = w.b.build('t', 'pes', [red]);
    const objs = sewObjects(p);
    const q = reorder(p, objs, [0, 2, 1], 3);
    const trims = q.cmd.reduce((n, c) => n + (c === TRIM ? 1 : 0), 0);
    expect(trims).toBeGreaterThanOrEqual(2);
    expect(sewObjects(q)).toHaveLength(3);
  });

  it('moves an object out of its color into a color of its own', () => {
    const p = load('cat-60mm.pes');
    const objs = sewObjects(p);
    // A Tangerine fill sewn after Dark Brown, even though Dark Brown lies on it (a forced move).
    const darkBrown = objs.filter((o) => o.block === 5).at(-1)!.index;
    const order = objs.map((o) => o.index).filter((i) => i !== 2);
    order.splice(order.indexOf(darkBrown) + 1, 0, 2);
    expect(violations(order, overlaps(p, objs)).length).toBeGreaterThan(0);
    const q = reorder(p, objs, order, 3);
    const after = new Set(stitchesByColor(q));
    expect(stitchesByColor(p).every((s) => after.has(s))).toBe(true);
    const moved = sewObjects(q).filter((o) => o.block === 6);
    expect(moved).toHaveLength(1);
    expect(moved[0].color.name).toBe(objs[2].color.name);
    expect(q.colors.length).toBe(p.colors.length + 1);
  });

  it.each(FILES)('never breaks layering or loses stitches: %s', (f) => {
    const p = load(f);
    const objs = sewObjects(p);
    const over = overlaps(p, objs);
    for (const o of [
      { combineColors: true, shortestWays: true },
      { combineColors: false, shortestWays: true },
      { combineColors: true, shortestWays: false },
    ]) {
      const order = optimizeOrder(p, objs, over, { ...o, trimMm: 3 });
      expect(violations(order, over)).toEqual([]);
      const q = reorder(p, objs, order, 3);
      // Tie stitches may be added at new trims; everything that was sewn is still sewn in its color.
      const before = stitchesByColor(p);
      const after = new Set(stitchesByColor(q));
      expect(before.every((s) => after.has(s))).toBe(true);
      // Objects sewn now without a trim between them count as one.
      const starts: number[] = [];
      reorder(p, objs, order, 3, starts);
      const qo = sewObjects(q);
      expect(qo.length).toBeLessThanOrEqual(objs.length);
      expect(starts).toHaveLength(objs.length);
      const nums = stitchNumbers(q);
      order.forEach((o, k) => {
        const r = recordOfStitch(nums, starts[k] + 1);
        expect([q.x[r], q.y[r]]).toEqual([p.x[objs[o].first], p.y[objs[o].first]]);
      });
      const a = moveStats(p);
      const b = moveStats(q);
      expect(b.colorChanges * 1000 + b.trims * 40 + b.travelMm).toBeLessThanOrEqual(a.colorChanges * 1000 + a.trims * 40 + a.travelMm + 1);
    }
  });
});
