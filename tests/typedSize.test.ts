import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { sewObjects, type SewObject } from '../src/model/objects';
import type { Pattern } from '../src/model/pattern';
import { fitScaling } from '../src/model/reshape';
import type { Mat } from '../src/shape/path';
import { ellipsePath, parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const red = { r: 200, g: 30, b: 30 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

/** Size and middle in mm of the stitches, as the Objekt card shows them. */
const box = (objs: SewObject[]) => {
  const minX = Math.min(...objs.map((o) => o.minX));
  const maxX = Math.max(...objs.map((o) => o.maxX));
  const minY = Math.min(...objs.map((o) => o.minY));
  const maxY = Math.max(...objs.map((o) => o.maxY));
  return { w: (maxX - minX) / 10, h: (maxY - minY) / 10, cx: (minX + maxX) / 20, cy: (minY + maxY) / 20 };
};

/** What the card does with a typed width (`w`) or height: scaled with the factors fitted. */
function typeSize(p: Pattern, sel: number[], w: number | null, h: number | null): Pattern {
  const b = box(sel.map((o) => sewObjects(p)[o]));
  const sx = w === null ? 1 : w / b.w;
  const sy = h === null ? 1 : h / b.h;
  return fitScaling(p, sel, sx, sy, b.cx, b.cy, options.trimMm)!.done.pattern;
}

const circle = (r: number) => addShape(empty, { form: parsePath(ellipsePath(50, 50, r, r), ID), kind: 'fill' }, red, null, options)!.pattern;

describe('typing a size', () => {
  it('gives a freshly drawn circle the width typed, larger or smaller', () => {
    for (const r of [10, 23.7, 40]) {
      const p = typeSize(circle(r), [0], 60, 60);
      const b = box(sewObjects(p));
      expect(b.w).toBeCloseTo(60, 1);
      expect(b.h).toBeCloseTo(60, 1);
      expect(b.cx).toBeCloseTo(50, 1);
    }
  });

  it('reaches an even width for a circle whose middle lies between two grid lines', () => {
    // Even about its middle, it grows by a tenth at both ends at once: 59,9 or 60,1 by the factor alone.
    const p0 = addShape(empty, { form: parsePath(ellipsePath(0.15, 0.15, 9.95, 9.95), ID), kind: 'fill' }, red, null, options)!.pattern;
    const b = box(sewObjects(typeSize(p0, [0], 60, 60)));
    expect(b.w).toBeCloseTo(60, 1);
    expect(b.h).toBeCloseTo(60, 1);
  });

  it('gives one side alone the size typed, the other staying', () => {
    const p0 = circle(15);
    const h0 = box(sewObjects(p0)).h;
    const b = box(sewObjects(typeSize(p0, [0], 45, null)));
    expect(b.w).toBeCloseTo(45, 1);
    expect(b.h).toBeCloseTo(h0, 1);
  });

  it('gives a satin line and several objects together the width typed', () => {
    const line = addShape(empty, { form: parsePath('M0 0 C10 10 20 -10 30 0', ID), kind: 'stroke', width: 3 }, red, null, options)!.pattern;
    expect(box(sewObjects(typeSize(line, [0], 50, null))).w).toBeCloseTo(50, 1);
    const two = addShape(circle(10), { form: parsePath(ellipsePath(80, 50, 5, 5), ID), kind: 'fill' }, red, 0, options)!.pattern;
    expect(box(sewObjects(typeSize(two, [0, 1], 70, null))).w).toBeCloseTo(70, 1);
  });
});
