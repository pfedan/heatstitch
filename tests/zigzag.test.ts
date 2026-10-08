import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects, type SewObject } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { formOf, reshapeFill, transformSewObject } from '../src/model/reshape';
import { analyze, measureFill } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { zigzagOf, type Zigzag } from '../src/model/zigzag';
import { parsePattern } from '../src/parsers';
import { scaling } from '../src/shape/path';
import { simplifyMore } from '../src/shape/simplify';

const cat = () => parsePattern(readFileSync(new URL('../public/examples/cat-60mm.pes', import.meta.url)), 'cat-60mm.pes');

/** The needle points of an object's fill rows, in runs of consecutive stitches (mm). */
function runsOf(p: Pattern, o: SewObject, kinds: Uint8Array) {
  const runs: [number, number][][] = [];
  for (const pt of analyze(p, o, kinds).parts) {
    if (pt.kind !== 'fill' || pt.border) continue;
    let run: [number, number][] = [];
    for (let i = pt.s; i <= pt.e; i++) {
      if (p.cmd[i] !== STITCH) continue;
      if (run.length && p.cmd[i - 1] !== STITCH) {
        runs.push(run);
        run = [];
      }
      run.push([p.x[i] / 10, p.y[i] / 10]);
    }
    if (run.length > 1) runs.push(run);
  }
  return runs;
}

const stitches = (p: Pattern, o: SewObject) => {
  let n = 0;
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) n++;
  return n;
};

/** The sweater of the knitting cat: rows that zigzag, their peaks lined up into chevrons. */
const SWEATER = 34;

/** The object sewn anew in a result (the one starting where the old one did). */
const anew = (p: Pattern, o: SewObject) => sewObjects(p).find((x) => x.first >= o.first - 5)!;

/** How far point `c` lies from a line of high peaks of `z`, as a share of the period. */
const along = (z: Zigzag, c: [number, number]) => {
  const t = (z.wave[0] * c[0] + z.wave[1] * c[1] - z.phase) / (2 * Math.PI);
  return ((t % 1) + 1) % 1;
};

const period = (z: Zigzag) => (2 * Math.PI) / Math.hypot(z.wave[0], z.wave[1]);

/** Same zigzag: course, height, period, and the peaks in the same places along the rows (near `c`). */
function same(a: Zigzag, b: Zigzag, c: [number, number]) {
  const turn = Math.abs(((a.angle - b.angle + 270) % 180) - 90);
  expect(turn).toBeLessThan(1);
  expect(b.height / a.height).toBeCloseTo(1, 1);
  expect(period(b) / period(a)).toBeCloseTo(1, 1);
  const off = Math.abs(along(a, c) - along(b, c));
  expect(Math.min(off, 1 - off)).toBeLessThan(0.05);
}

/** Middle of an object's stitches (mm). */
const middle = (p: Pattern, o: SewObject): [number, number] => {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = o.first; i <= o.last; i++) {
    if (p.cmd[i] !== STITCH) continue;
    x += p.x[i] / 10;
    y += p.y[i] / 10;
    n++;
  }
  return [x / n, y / n];
};

describe('fills whose rows zigzag', () => {
  it('reads the rows along their course, not along the slant of their stitches', () => {
    const p = cat();
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const z = zigzagOf(runsOf(p, objs[SWEATER], kinds))!;
    expect(z.straight).toBe(true);
    expect(z.height).toBeCloseTo(2.5, 0);
    expect(period(z)).toBeCloseTo(3.1, 0);
    const s = measureFill(p, analyze(p, objs[SWEATER], kinds));
    expect(s.pattern).toBe('follow');
    expect(Math.min(s.angle, 180 - s.angle)).toBeLessThan(3);
    expect(s.spacing).toBeGreaterThan(0.45);
    expect(s.spacing).toBeLessThan(0.6);
    // No other fill of the cat reads as zigzag.
    expect(objs.filter((o) => o.index !== SWEATER && analyze(p, o, kinds).fill && zigzagOf(runsOf(p, o, kinds)))).toEqual([]);
  });

  it('keeps the zigzag when sewn again in a new shape, and again after that', () => {
    const p = cat();
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs[SWEATER];
    const z = zigzagOf(runsOf(p, o, kinds))!;
    const r = reshapeFill(p, objs, o, kinds, simplifyMore(formOf(p, o, kinds)!)!, 2)!;
    expect(r.starts.length).toBe(1);
    const o2 = anew(r.pattern, o);
    const k2 = stitchKinds(r.pattern);
    // About as many stitches as before (they were 636 and long ones crossed the area).
    expect(Math.abs(stitches(r.pattern, o2) - stitches(p, o))).toBeLessThan(stitches(p, o) * 0.1);
    const z2 = zigzagOf(runsOf(r.pattern, o2, k2))!;
    same(z, z2, middle(p, o));
    // The slanted stitches are the stitches: none much longer (travel runs in short stitches).
    for (let i = o2.first + 1; i <= o2.last; i++)
      if (r.pattern.cmd[i] === STITCH && r.pattern.cmd[i - 1] === STITCH) expect(Math.hypot(r.pattern.x[i] - r.pattern.x[i - 1], r.pattern.y[i] - r.pattern.y[i - 1]) / 10).toBeLessThan(z.stitch * 1.3);
    // Sewn again: the same rows.
    const objs2 = sewObjects(r.pattern, k2);
    const again = reshapeFill(r.pattern, objs2, o2, k2, formOf(r.pattern, o2, k2)!, 2)!;
    same(z, zigzagOf(runsOf(again.pattern, anew(again.pattern, o2), stitchKinds(again.pattern)))!, middle(p, o));
  });

  it('keeps it mirrored', () => {
    const p = cat();
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs[SWEATER];
    const t = transformSewObject(p, objs, o, kinds, scaling(-1, 1, 15, 45), 2)!;
    const k = stitchKinds(t.pattern);
    const m = sewObjects(t.pattern, k).find((x) => x.first === t.first)!;
    const z = zigzagOf(runsOf(t.pattern, m, k))!;
    const r = reshapeFill(t.pattern, sewObjects(t.pattern, k), m, k, simplifyMore(formOf(t.pattern, m, k)!)!, 2)!;
    same(z, zigzagOf(runsOf(r.pattern, anew(r.pattern, m), stitchKinds(r.pattern)))!, middle(t.pattern, m));
  });
});
