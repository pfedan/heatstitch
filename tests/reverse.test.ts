import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { overlaps, sewObjects, type SewObject } from '../src/model/objects';
import { optimizePlan } from '../src/model/order';
import { STITCH, type Pattern } from '../src/model/pattern';
import { reverseObjects } from '../src/model/reverse';
import { recordOfStitch, stitchKinds, stitchNumbers } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { Writer } from './helpers/designs';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

type P = [number, number];
const pointsOf = (p: Pattern, o: SewObject) => {
  const out: P[] = [];
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) out.push([p.x[i], p.y[i]]);
  return out;
};
const mm = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]) / 10;

/** The object of the new pattern that starts with stitch number `start` (as restitch counts). */
function objectAt(q: Pattern, start: number): SewObject {
  const objs = sewObjects(q);
  const rec = recordOfStitch(stitchNumbers(q), start + 1);
  return objs.find((o) => o.first <= rec && rec <= o.last)!;
}

function turn(f: string, index: number) {
  const p = load(f);
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const r = reverseObjects(p, objs, [index], kinds, 3)!;
  return { p, objs, r, before: pointsOf(p, objs[index]) };
}

describe('sewing an object from the other side', () => {
  it('starts a fill where it ended and leaves everything else as it was', () => {
    const { p, objs, r, before } = turn('demos/letters.pes', 3);
    expect(r.failed).toEqual([]);
    const after = pointsOf(r.pattern, objectAt(r.pattern, r.starts[0]));
    expect(mm(after[0], before[before.length - 1])).toBeLessThan(2.5);
    expect(mm(after[0], before[0])).toBeGreaterThan(10);
    expect(sewObjects(r.pattern)).toHaveLength(objs.length);
    // The objects before it keep their stitches (a tie-off may come at a new trim).
    for (const o of objs.slice(0, 3)) {
      const was = pointsOf(p, o);
      expect(pointsOf(r.pattern, sewObjects(r.pattern)[o.index]).slice(0, was.length)).toEqual(was);
    }
  }, 30000);

  it('sews a satin column from its other end', () => {
    const { r, before } = turn('cat-60mm.pes', 30);
    expect(r.failed).toEqual([]);
    const after = pointsOf(r.pattern, objectAt(r.pattern, r.starts[0]));
    expect(mm(after[0], before[before.length - 1])).toBeLessThan(1.5);
    expect(mm(after[after.length - 1], before[0])).toBeLessThan(1.5);
  }, 30000);

  it('leaves an object with stitches outside its shape as it is', () => {
    const { p, r } = turn('cat-60mm.pes', 0);
    expect(r.failed).toEqual([0]);
    expect(r.starts).toEqual([]);
    expect(r.pattern.cmd.length).toBe(p.cmd.length);
  }, 30000);
});

describe('order with reversed objects', () => {
  /** Two lines; the second one from `from` to `to` (mm along x). */
  const lines = (from: number, to: number) => {
    const w = new Writer();
    w.start([0, 0]);
    for (let x = 2; x <= 20; x += 2) w.to([x, 0]);
    w.start([from, 0]);
    const step = from < to ? 2 : -2;
    for (let x = from + step; step > 0 ? x <= to : x >= to; x += step) w.to([x, 0]);
    return w.b.build('t', 'pes', [{ r: 0, g: 0, b: 0 }]);
  };

  it('turns an object around where that saves a trim', () => {
    // The second line starts far away and ends close to where the first one ended.
    const p = lines(60, 22);
    const objs = sewObjects(p);
    expect(objs).toHaveLength(2);
    const over = overlaps(p, objs);
    const opts = { combineColors: true, shortestWays: true, trimMm: 3 };
    expect(optimizePlan(p, objs, over, opts).flip).toEqual([]);
    const plan = optimizePlan(p, objs, over, opts, [true, true]);
    expect(plan.flip).toHaveLength(1);
    // Nothing is turned around when it saves nothing.
    const q = lines(22, 60);
    const qo = sewObjects(q);
    expect(optimizePlan(q, qo, overlaps(q, qo), opts, [true, true]).flip).toEqual([]);
  });
});
