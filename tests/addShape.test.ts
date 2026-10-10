import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { sewObjects } from '../src/model/objects';
import { remembered } from '../src/model/restitch';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import type { Mat } from '../src/shape/path';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const red = { r: 200, g: 30, b: 30 };
const blue = { r: 30, g: 60, b: 200 };

describe('addShape', () => {
  it('starts a design from nothing and adds after an object in its thread', () => {
    const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;
    const a = addShape(empty, { form: parsePath(rectPath(-10, -10, 20, 20, 0, 0), ID), kind: 'fill' }, red, null, options)!;
    expect(a).not.toBeNull();
    expect(sewObjects(a.pattern)).toHaveLength(1);
    const b = addShape(a.pattern, { form: parsePath(ellipsePath(25, 0, 6, 6), ID), kind: 'fill' }, blue, null, options)!;
    let objs = sewObjects(b.pattern);
    expect(objs).toHaveLength(2);
    expect(b.pattern.colors).toHaveLength(2);
    // A third shape after the first object, in its red thread: still two colors.
    const c = addShape(b.pattern, { form: parsePath(ellipsePath(-25, 0, 5, 5), ID), kind: 'fill' }, red, 0, options)!;
    objs = sewObjects(c.pattern);
    expect(objs).toHaveLength(3);
    expect(c.pattern.colors).toHaveLength(2);
    expect(objs[1].block).toBe(0);
    // The new one keeps its curves.
    expect(remembered(c.pattern, objs[1])?.geo?.paths[0].nodes).toHaveLength(4);
  });

  it('sews a line as running stitch', () => {
    const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;
    const a = addShape(empty, { form: parsePath('M0 0 C10 -10 20 10 30 0', ID), kind: 'stroke', width: 0.4 }, red, null, options)!;
    expect(sewObjects(a.pattern)[0].kind).toBe('run');
  });
});
