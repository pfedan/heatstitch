import { describe, expect, it } from 'vitest';
import { decoSampler, flower, lineVariants, patch, towel, type Design } from './helpers/demoProject';
import { sewObjects } from '../src/model/objects';
import { JUMP, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { specOf, sewDesign } from '../src/model/sew';
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
