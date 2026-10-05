import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { asideFrom, asideOf, dropAside, inheritAside, sewAgain, setAside, setAsideRole, storeAside, withAside } from '../src/model/aside';
import { sewObjects } from '../src/model/objects';
import type { Pattern } from '../src/model/pattern';
import { remembered } from '../src/model/restitch';
import type { Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { backgroundOf } from '../src/ui/imageMode';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const red = { r: 200, g: 30, b: 30 };
const blue = { r: 30, g: 60, b: 200 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

function design(): Pattern {
  let p = addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, red, null, options)!.pattern;
  p = addShape(p, { form: parsePath(ellipsePath(35, 10, 6, 6), ID), kind: 'fill' }, blue, 0, options)!.pattern;
  return addShape(p, { form: parsePath('M0 30 C10 25 20 35 30 30', ID), kind: 'stroke', width: 0.4 }, red, 1, options)!.pattern;
}

describe('shapes aside', () => {
  it('keeps an object aside with its stitches and sews it again where it was', () => {
    const p = design();
    const objs = sewObjects(p);
    const disc = objs[1];
    const next = setAside(p, [1], 'off', options.trimMm)!;
    expect(sewObjects(next)).toHaveLength(2);
    const [a] = asideOf(next);
    expect(a.role).toBe('off');
    expect(a.kind).toBe('fill');
    expect(a.form?.paths[0].nodes).toHaveLength(4);
    expect(a.after).toBe(0);
    // The version before has none: undo brings the object back.
    expect(asideOf(p)).toHaveLength(0);
    const back = sewAgain(next, a.id, options)!;
    const nobjs = sewObjects(back.pattern);
    expect(nobjs).toHaveLength(3);
    expect(nobjs[1].stitches).toBe(disc.stitches);
    expect(nobjs[1].color).toEqual(disc.color);
    expect(remembered(back.pattern, nobjs[1])?.form).toBeTruthy();
    expect(asideOf(back.pattern)).toHaveLength(0);
  });

  it('keeps lines as guides, switches roles and drops them', () => {
    const p = design();
    const next = setAside(p, [2], 'guide', options.trimMm)!;
    const [a] = asideOf(next);
    expect(a.role).toBe('guide');
    expect(a.form?.paths[0].closed).toBe(false);
    const off = setAsideRole(next, a.id, 'off')!;
    expect(asideOf(off)[0].role).toBe('off');
    expect(sewObjects(off)).toHaveLength(2);
    expect(asideOf(dropAside(off, a.id)!)).toHaveLength(0);
    // Never all of them.
    expect(setAside(p, [0, 1, 2], 'off', options.trimMm)).toBeNull();
  });

  it('goes along to the next version, and is stored and read back', () => {
    const p = design();
    const next = setAside(p, [1], 'off', options.trimMm)!;
    const copy = { ...next };
    inheritAside(next, copy);
    expect(asideOf(copy)).toBe(asideOf(next));
    const read = asideFrom(JSON.parse(JSON.stringify(storeAside(asideOf(next)))));
    expect(read).toHaveLength(1);
    expect(read[0].records).toEqual(asideOf(next)[0].records);
    expect(read[0].form?.paths[0].nodes).toHaveLength(4);
    expect(asideFrom([{ id: 1 }, null, 'x'])).toEqual([]);
    // A shape known only by its curves is sewn anew from them.
    const formOnly = withAside(p, [{ id: 9, role: 'off', kind: 'fill', color: blue, after: -1, form: parsePath(rectPath(50, 0, 10, 10, 0, 0), ID) }]);
    const sewn = sewAgain(formOnly, 9, options)!;
    expect(sewObjects(sewn.pattern)).toHaveLength(4);
    expect(sewObjects(sewn.pattern)[0].minX).toBeGreaterThan(450);
  });

  it('finds a background rectangle behind a design', () => {
    const rect = { color: 0, kind: 'fill' as const, form: parsePath(rectPath(0, 0, 50, 40, 0, 0), ID) };
    const disc = { color: 1, kind: 'fill' as const, form: parsePath(ellipsePath(25, 20, 10, 10), ID) };
    expect(backgroundOf([rect, disc])).toBe(0);
    expect(backgroundOf([disc, rect])).toBe(-1);
    expect(backgroundOf([{ ...disc, form: parsePath(ellipsePath(25, 20, 30, 30), ID) }, disc])).toBe(-1);
    expect(backgroundOf([rect])).toBe(-1);
  });
});
