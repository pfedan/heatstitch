import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { sewObjects } from '../src/model/objects';
import { remembered, restitch } from '../src/model/restitch';
import { transformSewObject } from '../src/model/reshape';
import { takeOver } from '../src/model/knockout';
import { stitchKinds } from '../src/model/sequence';
import { STITCH, type Pattern } from '../src/model/pattern';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import type { Mat } from '../src/shape/path';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const red = { r: 200, g: 30, b: 30 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

/** Stitch points of the object (mm). */
const points = (p: Pattern, first: number, last: number) => {
  const out: [number, number][] = [];
  for (let i = first; i <= last; i++) if (p.cmd[i] === STITCH) out.push([p.x[i] / 10, p.y[i] / 10]);
  return out;
};

describe('drawn lines', () => {
  const form = parsePath('M0 0 L30 0 L30 20', ID);

  it('are sewn on their curves and remember them', () => {
    const a = addShape(empty, { form, kind: 'stroke', width: 0.4 }, red, null, options)!;
    const [o] = sewObjects(a.pattern);
    expect(o.kind).toBe('run');
    expect(remembered(a.pattern, o)?.path).toBeDefined();
    const pts = points(a.pattern, o.first, o.last);
    // Every penetration lies on the line (the corner is one of them).
    for (const [x, y] of pts) expect(Math.min(Math.abs(y), Math.abs(x - 30))).toBeLessThan(0.11);
    expect(pts.some(([x, y]) => Math.abs(x - 30) < 0.11 && Math.abs(y) < 0.11)).toBe(true);
  });

  it('take new stitch settings along the line itself', () => {
    const a = addShape(empty, { form, kind: 'stroke', width: 0.4 }, red, null, options)!;
    const kinds = stitchKinds(a.pattern);
    const objs = sewObjects(a.pattern, kinds);
    const before = points(a.pattern, objs[0].first, objs[0].last).length;
    const r = restitch(a.pattern, objs, [0], { kind: 'run', s: { stitch: 1, triple: false, tolerance: 0.1 } }, kinds, 7);
    const next = takeOver(r)!;
    const [o] = sewObjects(next);
    expect(points(next, o.first, o.last).length).toBeGreaterThan(before * 1.8);
    expect(remembered(next, o)?.path).toBeDefined();
  });

  it('carry their curves when scaled', () => {
    const a = addShape(empty, { form, kind: 'stroke', width: 0.4 }, red, null, options)!;
    const kinds = stitchKinds(a.pattern);
    const objs = sewObjects(a.pattern, kinds);
    const r = transformSewObject(a.pattern, objs, objs[0], kinds, [2, 0, 0, 2, 0, 0], 7)!;
    const [o] = sewObjects(r.pattern);
    const path = remembered(r.pattern, o)?.path;
    expect(path?.paths[0].nodes[2].p).toEqual([60, 40]);
    // Still on the (scaled) line, not stretched stitches.
    for (const [x, y] of points(r.pattern, o.first, o.last)) expect(Math.min(Math.abs(y), Math.abs(x - 60))).toBeLessThan(0.11);
  });
});
