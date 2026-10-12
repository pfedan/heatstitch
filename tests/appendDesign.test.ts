import { describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { appendDesign } from '../src/model/appendDesign';
import { digitizedFile } from '../src/model/digitized';
import { overlapsIn, setKnockout } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import { remembered } from '../src/model/restitch';
import { borderedSquare } from './helpers/torture';
import { JUMP } from '../src/model/pattern';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import type { Mat } from '../src/shape/path';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = { ...digitizeDefaults(DEFAULT_PROFILE), trimMm: 2 };
const red = { r: 200, g: 30, b: 30 };
const yellow = { r: 240, g: 200, b: 40 };
const black = { r: 20, g: 20, b: 20 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

/** A small motif as the library makes one: a yellow face with two black eyes, left out under them. */
function motif() {
  const shapes = [
    { color: 0, kind: 'fill' as const, form: parsePath(ellipsePath(0, 0, 15, 15), ID) },
    { color: 1, kind: 'fill' as const, form: parsePath(ellipsePath(-5, -3, 3, 3), ID) },
    { color: 1, kind: 'fill' as const, form: parsePath(ellipsePath(5, -3, 3, 3), ID) },
  ];
  const d = digitizeShapes(shapes, [yellow, black], options, { w: 30, h: 30 }, false, 'face');
  const { pattern } = digitizedFile(d, 'face', options.trimMm);
  return setKnockout(pattern, overlapsIn(pattern), true, options.trimMm)?.pattern ?? pattern;
}

describe('appendDesign', () => {
  it('sews a motif after the objects of a design, each object whole and knowing its form', () => {
    const p = addShape(empty, { form: parsePath(rectPath(-60, -10, 20, 20, 0, 0), ID), kind: 'fill' }, red, null, options)!.pattern;
    const add = motif();
    const objsAdd = sewObjects(add);
    expect(objsAdd.length).toBe(3);
    const r = appendDesign(p, add, 40, 5, options.trimMm)!;
    expect(r).not.toBeNull();
    const objs = sewObjects(r.pattern);
    expect(objs.length).toBe(4);
    expect(r.objects).toEqual([1, 2, 3]);
    // The two eyes share one black thread.
    expect(objs[2].block).toBe(objs[3].block);
    expect(r.pattern.colors.length).toBe(3);
    // Its middle at 40 / 5 mm: stitches and form alike.
    const face = objs[1];
    expect((face.minX + face.maxX) / 20).toBeCloseTo(40, 0);
    expect((face.minY + face.maxY) / 20).toBeCloseTo(5, 0);
    const geo = remembered(r.pattern, face)?.geo;
    expect(geo).toBeDefined();
    const xs = geo!.paths[0].nodes.map((n) => n.p[0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(40, 0);
    // Leaving out stays on.
    expect(remembered(r.pattern, face)?.knockout).toBe(true);
    // The object of the design before stays as it was.
    expect(objs[0].color).toEqual(expect.objectContaining(red));
  });

  it('gives each copied object an id of the design it goes into', () => {
    const p = addShape(empty, { form: parsePath(rectPath(-60, -10, 20, 20, 0, 0), ID), kind: 'fill' }, red, null, options)!.pattern;
    const r = appendDesign(p, motif(), 0, 0, options.trimMm)!;
    const ids = sewObjects(r.pattern).map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leads to each object by a jump, never by one long stitch', () => {
    const p = addShape(empty, { form: parsePath(rectPath(-60, -10, 20, 20, 0, 0), ID), kind: 'fill' }, red, null, options)!.pattern;
    const r = appendDesign(p, motif(), 40, 5, options.trimMm)!;
    for (const o of sewObjects(r.pattern)) expect(r.pattern.cmd[o.first - 1], `before object ${o.index}`).toBe(JUMP);
  });

  it('ties the copies of a design put in twice to each other, never to the first', () => {
    // A square with its border in a thread of its own.
    const p = borderedSquare().cur.p;
    const both = appendDesign(p, p, 60, 10, options.trimMm)!.pattern;
    const mem = sewObjects(both).map((o) => remembered(both, o)!);
    const links = mem.filter((m) => m.fill && m.line?.link).map((m) => m.line!.link!);
    const outlines = mem.filter((m) => m.outline).map((m) => m.outline!);
    expect(links).toHaveLength(2);
    expect(new Set(links).size).toBe(2);
    expect(outlines.sort()).toEqual(links.sort());
  });
});
