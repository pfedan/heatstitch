import { describe, expect, it } from 'vitest';
import { buildDemos, decoSampler, flower, lineVariants, patch, towel, type Design } from './helpers/demoProject';
import { sewObjects, type SewObject } from '../src/model/objects';
import { JUMP, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { listOf, specOf, sewDesign, sewList } from '../src/model/sew';
import { recolorObjects } from '../src/model/shapeOps';
import { transformSewObject } from '../src/model/reshape';
import { stitchKinds } from '../src/model/sequence';
import { remembered } from '../src/model/restitch';
import { CRITICAL, validatePattern } from '../src/validation/validate';

/**
 * Sewing from the object list (stage C, src/model/sew.ts) on the designs of the demo project: the
 * same design, each object that knows its shape sewn from it, no worse than the stitches it has
 * now, and the same again when sewn from the list it gives.
 */

const count = (p: Pattern, cmd: number) => p.cmd.reduce((n, c) => n + (c === cmd ? 1 : 0), 0);
const jumps = (p: Pattern) => {
  let mm = 0;
  for (let i = 1; i < p.cmd.length; i++) if (p.cmd[i] === JUMP) mm += Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;
  return mm;
};
const critical = (d: Design, p: Pattern) => validatePattern(p, d.profile).level.reduce((n, l) => n + (l === CRITICAL ? 1 : 0), 0);
const same = (a: Pattern, b: Pattern) => a.cmd.length === b.cmd.length && a.cmd.every((c, i) => c === b.cmd[i] && a.x[i] === b.x[i] && a.y[i] === b.y[i]);

describe('sewing a design from its object list', () => {
  it.each([flower, decoSampler, lineVariants, patch, towel].map((f) => [f.name, f] as const))('%s', (_, make) => {
    const d = make();
    const p = d.p;
    const objs = sewObjects(p);
    const q = sewDesign(p, d.T);
    const after = sewObjects(q);
    // The same objects, threads and order.
    expect(after.map((o) => [o.id, o.kind, o.block])).toEqual(objs.map((o) => [o.id, o.kind, o.block]));
    expect(q.colors).toEqual(p.colors);
    // Everything made here but letterings is sewn from its shape.
    const made = objs.filter((o) => specOf(p, o));
    expect(made.length).toBeGreaterThan(objs.length / 2);
    // No worse than now.
    expect(Math.abs(count(q, STITCH) - count(p, STITCH)) / count(p, STITCH)).toBeLessThan(0.02);
    expect(count(q, TRIM)).toBeLessThanOrEqual(count(p, TRIM) + 1);
    expect(jumps(q)).toBeLessThan(jumps(p) * 1.15 + 10);
    expect(critical(d, q)).toBeLessThanOrEqual(critical(d, p) + 2);
    // Sewn again from the list it gives: the same stitches.
    expect(same(sewDesign(q, d.T), q)).toBe(true);
  }, 120000);
});

/** The stitches of object `o` (0.1 mm), tie-in left out. */
const stitchesOf = (p: Pattern, o: SewObject) => {
  const out: string[] = [];
  for (let i = o.first + o.tieIn; i <= o.last; i++) if (p.cmd[i] === STITCH) out.push(`${p.x[i]},${p.y[i]}`);
  return out.join(' ');
};

describe('sewing from a list that keeps the stitches', () => {
  it.each(buildDemos().map((d) => [d.title, d] as const))('%s', (_, d) => {
    const p = d.p;
    // The list as it is gives the design as it is.
    const q = sewList(p, listOf(p), d.T);
    expect(same(q, p)).toBe(true);
    expect(sewObjects(q).map((o) => o.id)).toEqual(sewObjects(p).map((o) => o.id));
    // Without one object (deleted): the others keep their ids, threads and stitches.
    const objs = sewObjects(p);
    for (const gone of objs) {
      const r = sewList(p, listOf(p).filter((e) => e.obj.index !== gone.index), d.T);
      const left = sewObjects(r);
      const before = objs.filter((o) => o !== gone);
      expect(left.map((o) => o.id)).toEqual(before.map((o) => o.id));
      expect(left.map((o) => o.color)).toEqual(before.map((o) => o.color));
      expect(left.map((o) => stitchesOf(r, o))).toEqual(before.map((o) => stitchesOf(p, o)));
    }
  }, 120000);
});

describe('recoloring through the list', () => {
  it.each(buildDemos().map((d) => [d.title, d] as const))('%s', (_, d) => {
    const p = d.p;
    const objs = sewObjects(p);
    const color = { r: 1, g: 2, b: 3 };
    for (const o of objs) {
      if (o.color.r === color.r && o.color.g === color.g && o.color.b === color.b) continue;
      // Objects tied to others (borders, blends, shadows, echoes) take them along: not here.
      const m = remembered(p, o);
      if (m?.outline || m?.blendOf || m?.shadowOf || m?.echoOf || m?.fill?.border || m?.fill?.deco?.blend || m?.line?.shadow || m?.line?.echo) continue;
      const q = recolorObjects(p, [o.index], color, d.T);
      if (!q) continue;
      const after = sewObjects(q);
      // Every object keeps its id and its stitches (borders are sewn anew by syncBorders); the one
      // recolored is in the new thread.
      const plain = (r: Pattern, xs: SewObject[]) => xs.filter((x) => !remembered(r, x)?.outline);
      expect(plain(q, after).map((x) => x.id)).toEqual(plain(p, objs).map((x) => x.id));
      expect(plain(q, after).map((x) => stitchesOf(q, x))).toEqual(plain(p, objs).map((x) => stitchesOf(p, x)));
      expect(after[o.index].color).toMatchObject(color);
    }
  }, 120000);
});

describe('moving through the list', () => {
  it.each(buildDemos().map((d) => [d.title, d] as const))('%s', (_, d) => {
    const p = d.p;
    const objs = sewObjects(p);
    const kinds = stitchKinds(p);
    for (const o of objs) {
      const r = transformSewObject(p, objs, o, kinds, [1, 0, 0, 1, 3, -2], d.T);
      expect(r).toBeTruthy();
      const after = sewObjects(r!.pattern);
      // The same objects; the others keep their stitches, the moved one has them 3 mm right, 2 mm up.
      expect(after.map((x) => x.id)).toEqual(objs.map((x) => x.id));
      after.forEach((x, k) => {
        const want = k === o.index ? stitchesOf(p, objs[k]).split(' ').map((s) => s.split(',').map(Number)).map(([a, b]) => `${a + 30},${b - 20}`).join(' ') : stitchesOf(p, objs[k]);
        expect(stitchesOf(r!.pattern, x)).toBe(want);
      });
    }
  }, 120000);
});
