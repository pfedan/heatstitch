import { describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes } from '../src/digitize/digitize';
import { lineSettings, resewLine, traceLine } from '../src/model/line';
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

describe('lines of all kinds', () => {
  const form = parsePath('M0 0 C10 -10 20 10 30 0', ID);

  it('sew a wide line as satin and keep its curve and settings', () => {
    const a = addShape(empty, { form, kind: 'stroke', width: 2 }, red, null, options)!;
    const [o] = sewObjects(a.pattern);
    expect(o.kind).toBe('satin');
    const m = remembered(a.pattern, o);
    expect(m?.path).toBeDefined();
    expect(m?.line?.type).toBe('satin');
    expect(m?.line?.width).toBe(2);
  });

  it('change between running, triple and satin stitch in place', () => {
    const a = addShape(empty, { form, kind: 'stroke', width: 0.4 }, red, null, options)!;
    const st = lineSettings(a.pattern, sewObjects(a.pattern)[0]);
    expect(st.type).toBe('run');
    const satin = resewLine(a.pattern, 0, form, { ...st, type: 'satin', width: 3 }, 7)!;
    let objs = sewObjects(satin.pattern);
    expect(objs).toHaveLength(1);
    expect(objs[0].kind).toBe('satin');
    expect(lineSettings(satin.pattern, objs[0]).width).toBe(3);
    const triple = resewLine(satin.pattern, 0, form, { ...st, type: 'triple' }, 7)!;
    objs = sewObjects(triple.pattern);
    expect(objs[0].kind).toBe('run');
    expect(lineSettings(triple.pattern, objs[0]).type).toBe('triple');
  });

  it('keep the objects around them', () => {
    const a = addShape(empty, { form: parsePath('M0 20 L30 20', ID), kind: 'stroke', width: 0.4 }, red, null, options)!;
    const b = addShape(a.pattern, { form, kind: 'stroke', width: 0.4 }, red, null, options)!;
    const c = addShape(b.pattern, { form: parsePath('M0 40 L30 40', ID), kind: 'stroke', width: 0.4 }, red, null, options)!;
    expect(sewObjects(c.pattern)).toHaveLength(3);
    const r = resewLine(c.pattern, 1, form, { type: 'satin', width: 2 }, 7)!;
    const objs = sewObjects(r.pattern);
    expect(objs.map((o) => o.kind)).toEqual(['run', 'satin', 'run']);
    expect(remembered(r.pattern, objs[0])?.path).toBeDefined();
    expect(remembered(r.pattern, objs[2])?.path).toBeDefined();
  });

  it('trace a curve through the running stitch of a file', () => {
    // A running stitch along a quarter circle and then straight on: one corner.
    const pts: [number, number][] = [];
    for (let k = 0; k <= 20; k++) pts.push([10 * Math.cos((k / 20) * (Math.PI / 2)), 10 * Math.sin((k / 20) * (Math.PI / 2))]);
    for (let k = 1; k <= 5; k++) pts.push([0, 10 + k * 2]);
    const f = traceLine(pts)!;
    expect(f.paths[0].closed).toBe(false);
    expect(f.paths[0].nodes.length).toBeLessThan(8);
    expect(f.paths[0].nodes.some((n) => Math.hypot(n.p[0], n.p[1] - 10) < 0.01 && !n.smooth)).toBe(true);
  });

  it('sews SVG strokes along their curves', () => {
    const d = digitizeShapes([{ color: 0, kind: 'stroke', form, width: 0.3 }], [red], options, { w: 0, h: 0 }, false);
    expect(d.objects[0].path).toBeDefined();
    expect(d.objects[0].line?.type).toBe('run');
  });
});
