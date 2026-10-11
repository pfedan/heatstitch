import { describe, expect, it } from 'vitest';
import { addShape } from '../src/model/addShape';
import { sewObjects } from '../src/model/objects';
import { sameColor } from '../src/model/recolor';
import { gatherObjects, mergeLeads } from '../src/model/shapeOps';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { COLORS, ID, T, empty, options } from './helpers/torture';

/** A big square (red), a small disc (blue) and a square (green) between them in the sewing order. */
function design() {
  let p = addShape(empty, { form: parsePath(rectPath(0, 0, 30, 30, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern;
  p = addShape(p, { form: parsePath(rectPath(40, 0, 10, 10, 0, 0), ID), kind: 'fill' }, COLORS[2], null, options)!.pattern;
  return addShape(p, { form: parsePath(ellipsePath(30, 15, 6, 6), ID), kind: 'fill' }, COLORS[1], null, options)!.pattern;
}

describe('Zusammenfassen across colors', () => {
  it('takes the color with the most thread, its biggest object first, the others after it', () => {
    const p = design();
    const objs = sewObjects(p);
    expect(objs.map((o) => o.block)).toEqual([0, 1, 2]);
    expect(mergeLeads([objs[0], objs[2]])).toEqual([0, 2]);
    const g = gatherObjects(p, [0, 2], 0, T)!;
    const now = sewObjects(g.pattern);
    expect(g.which).toEqual([0, 1]);
    expect(now.map((o) => o.id)).toEqual([objs[0].id, objs[2].id, objs[1].id]);
    expect(now[0].block).toBe(now[1].block);
    expect(sameColor(now[1].color, COLORS[0])).toBe(true);
    // The square between keeps its thread, now after them.
    expect(sameColor(now[2].color, COLORS[2])).toBe(true);
    expect(now[1].stitches).toBe(objs[2].stitches);
  });

  it('with the other color as the lead: sewn where the disc is, in its thread', () => {
    const p = design();
    const objs = sewObjects(p);
    const g = gatherObjects(p, [0, 2], 2, T)!;
    const now = sewObjects(g.pattern);
    expect(now.map((o) => o.id)).toEqual([objs[1].id, objs[2].id, objs[0].id]);
    expect(g.which).toEqual([1, 2]);
    expect(sameColor(now[2].color, COLORS[1])).toBe(true);
    expect(now[1].block).toBe(now[2].block);
  });
});
