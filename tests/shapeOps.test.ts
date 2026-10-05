import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { wholeArea } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import type { Pattern } from '../src/model/pattern';
import { remembered } from '../src/model/restitch';
import { formOf } from '../src/model/reshape';
import { stitchKinds } from '../src/model/sequence';
import { deleteObjects, duplicateObject, mirrorMatrix, subtractTop, unionForm } from '../src/model/shapeOps';
import { transformSewObject } from '../src/model/reshape';
import type { Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const red = { r: 200, g: 30, b: 30 };
const blue = { r: 30, g: 60, b: 200 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

/** A red square, a blue disc over its right edge, and a red disc away from both. */
function design(): Pattern {
  let p = addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, red, null, options)!.pattern;
  p = addShape(p, { form: parsePath(ellipsePath(20, 10, 6, 6), ID), kind: 'fill' }, blue, 0, options)!.pattern;
  return addShape(p, { form: parsePath(ellipsePath(45, 10, 5, 5), ID), kind: 'fill' }, red, 1, options)!.pattern;
}

const area = (p: Pattern, o: number) => {
  const objs = sewObjects(p);
  return wholeArea(formOf(p, objs[o], stitchKinds(p))!)!.areaMm2;
};

describe('shape operations', () => {
  it('deletes objects, never all of them', () => {
    const p = design();
    const next = deleteObjects(p, [1], options.trimMm)!;
    expect(sewObjects(next)).toHaveLength(2);
    // The others keep their curves.
    expect(remembered(next, sewObjects(next)[1])?.form).toBeTruthy();
    expect(deleteObjects(p, [0, 1, 2], options.trimMm)).toBeNull();
    // The last one too (the ones before stay as they are).
    expect(sewObjects(deleteObjects(p, [2], options.trimMm)!)).toHaveLength(2);
  });

  it('duplicates an object beside the original, with its curves', () => {
    const p = design();
    const d = duplicateObject(p, 2, options.trimMm)!;
    const objs = sewObjects(d.pattern);
    expect(objs).toHaveLength(4);
    expect(d.index).toBe(3);
    expect(objs[3].minX - objs[2].minX).toBeCloseTo(20, -1);
    expect(remembered(d.pattern, objs[3])?.form).toBeTruthy();
    expect(objs[3].block).toBe(objs[2].block);
  });

  it('mirrors around the middle, the shape staying where it was', () => {
    const p = addShape(empty, { form: parsePath('M0 0 L20 0 L0 10 Z', ID), kind: 'fill' }, red, null, options)!.pattern;
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs[0];
    const box = { minX: o.minX / 10, minY: o.minY / 10, maxX: o.maxX / 10, maxY: o.maxY / 10 };
    const r = transformSewObject(p, objs, o, kinds, mirrorMatrix('x', box), options.trimMm)!;
    const m = sewObjects(r.pattern)[0];
    expect(m.minX).toBeCloseTo(o.minX, -1);
    expect(m.maxX).toBeCloseTo(o.maxX, -1);
    // The wide side of the triangle is on the right now.
    const form = remembered(r.pattern, m)!.form!;
    expect(Math.max(...form.paths[0].nodes.filter((n) => n.p[1] < 1).map((n) => n.p[0]))).toBeGreaterThan(18);
  });

  it('joins outlines into one', () => {
    const f = unionForm([parsePath(rectPath(0, 0, 10, 10, 0, 0), ID), parsePath(rectPath(5, 0, 10, 10, 0, 0), ID)])!;
    expect(f.paths).toHaveLength(1);
    expect(wholeArea(f)!.areaMm2).toBeCloseTo(150, -1);
  });

  it('cuts the shape on top out of the others and drops it', () => {
    const p = design();
    const before = area(p, 0);
    // The blue disc (sewn second) is on top of the square.
    const r = subtractTop(p, [0, 1], options.trimMm)!;
    expect(r).not.toBeNull();
    expect(sewObjects(r.pattern)).toHaveLength(2);
    expect(r.cut).toEqual([0]);
    // Half the disc came out of the square.
    expect(before - area(r.pattern, 0)).toBeCloseTo((Math.PI * 36) / 2, -1);
    // Nothing to cut: no change.
    expect(subtractTop(p, [0, 2], options.trimMm)).toBeNull();
  });
});
