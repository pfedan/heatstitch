import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { wholeArea } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import type { Pattern } from '../src/model/pattern';
import { analyze, measureFill, remember, remembered, restitch } from '../src/model/restitch';
import { rememberObjects } from '../src/model/objects';
import { syncBorders } from '../src/model/border';
import { formOf } from '../src/model/reshape';
import { stitchKinds } from '../src/model/sequence';
import { deleteObjects, duplicateObject, mirrorMatrix, recolorObjects, subtractTop, unionForm } from '../src/model/shapeOps';
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
  it('deletes objects, all of them to an empty design', () => {
    const p = design();
    const next = deleteObjects(p, [1], options.trimMm)!;
    expect(sewObjects(next)).toHaveLength(2);
    // The others keep their curves.
    expect(remembered(next, sewObjects(next)[1])?.form).toBeTruthy();
    const empty = deleteObjects(p, [0, 1, 2], options.trimMm)!;
    expect(empty.cmd).toHaveLength(0);
    expect(sewObjects(empty)).toHaveLength(0);
    expect(deleteObjects(p, [7], options.trimMm)).toBeNull();
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

  it('gives one object another thread, at its place', () => {
    const p = design();
    // The last red disc in yellow: a color of its own, still sewn last.
    const yellow = { r: 240, g: 200, b: 30 };
    const a = recolorObjects(p, [2], yellow, options.trimMm)!;
    let objs = sewObjects(a);
    expect(objs).toHaveLength(3);
    expect(objs[2].color).toEqual(yellow);
    expect(objs[0].color).toEqual(red);
    expect(remembered(a, objs[2])?.form).toBeTruthy();
    // In blue, next to the blue disc: sewn along in its thread.
    const b = recolorObjects(p, [2], blue, options.trimMm)!;
    objs = sewObjects(b);
    expect(b.colors).toHaveLength(2);
    expect(objs[2].block).toBe(objs[1].block);
    // A whole block just changes its thread.
    const c = recolorObjects(p, [1], yellow, options.trimMm)!;
    expect(c.colors[1]).toEqual(yellow);
    expect(c.cmd).toBe(p.cmd);
  });
});

describe('duplicating', () => {
  it('copies a satin line sewn last as an object of its own', () => {
    const line = (y: number) => parsePath(`M0 ${y} C10 ${y + 10} 20 ${y - 10} 30 ${y}`, ID);
    let p = addShape(empty, { form: line(0), kind: 'stroke', width: 3 }, red, null, options)!.pattern;
    p = addShape(p, { form: line(10), kind: 'stroke', width: 3 }, red, 0, options)!.pattern;
    for (const o of [0, 1]) {
      const d = duplicateObject(p, o, options.trimMm)!;
      const objs = sewObjects(d.pattern);
      expect(objs).toHaveLength(3);
      expect(objs[o + 1].kind).toBe('satin');
      expect(remembered(d.pattern, objs[o + 1])?.path).toBeTruthy();
      expect(objs[o + 1].minX - objs[o].minX).toBeCloseTo(20, -1);
    }
  });

  it('copies a fill with its border of its own thread, and a copied border is a line of its own', () => {
    const p0 = addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, red, null, options)!.pattern;
    const kinds = stitchKinds(p0);
    const objs = sewObjects(p0, kinds);
    const s = { ...measureFill(p0, analyze(p0, objs[0], kinds)), border: { type: 'run' as const, width: 2, color: blue, link: 'b1' } };
    const r = restitch(p0, objs, [0], { kind: 'fill', s }, kinds, options.trimMm);
    rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
    remember(r.pattern, sewObjects(r.pattern)[0], r.memory[0]);
    const p = syncBorders(r.pattern, options.trimMm);
    expect(sewObjects(p)).toHaveLength(2);

    const d = duplicateObject(p, 0, options.trimMm)!;
    const after = sewObjects(d.pattern);
    expect(after).toHaveLength(4);
    expect(d.pattern.colors).toHaveLength(2);
    const fills = after.filter((o) => remembered(d.pattern, o)?.fill?.border?.link);
    const links = fills.map((o) => remembered(d.pattern, o)!.fill!.border!.link);
    expect(new Set(links).size).toBe(2);
    // Each fill has its border, the copy's beside the copy.
    for (const [k, link] of links.entries()) {
      const border = after.find((o) => remembered(d.pattern, o)?.outline === link)!;
      expect(border.color).toMatchObject(blue);
      expect(Math.abs(border.minX - fills[k].minX)).toBeLessThan(15);
    }

    const b = duplicateObject(p, 1, options.trimMm)!;
    const bo = sewObjects(b.pattern);
    expect(bo).toHaveLength(3);
    expect(bo.filter((o) => remembered(b.pattern, o)?.outline === 'b1')).toHaveLength(1);
    expect(remembered(b.pattern, bo[b.index])?.outline).toBeUndefined();
  });
});
