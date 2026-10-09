import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addShape } from '../src/model/addShape';
import { geoOf, guessGeo, satinOutline } from '../src/model/geo';
import { sewObjects } from '../src/model/objects';
import { reshapeObject } from '../src/model/reshape';
import { keepShape, remembered } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { bounds, transformForm, translation, type Form } from '../src/shape/path';
import { parsePath, rectPath } from '../src/shape/svgPath';
import { COLORS, empty, ID, options, T } from './helpers/torture';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

/** The form with node `i` of path `k` moved by (dx, dy). */
function moveNode(f: Form, k: number, i: number, dx: number, dy: number): Form {
  return {
    ...f,
    paths: f.paths.map((p, j) =>
      j !== k
        ? p
        : {
            ...p,
            nodes: p.nodes.map((n, m) => (m !== i ? n : { ...n, p: [n.p[0] + dx, n.p[1] + dy], a: [n.a[0] + dx, n.a[1] + dy], b: [n.b[0] + dx, n.b[1] + dy] })),
          },
    ),
  };
}

describe('one way back from the level Form', () => {
  it('reshapes a narrow drawn area, sewn as satin, like any area', () => {
    // 40 × 4 mm: drawn as an area, addShape sews it as satin.
    const a = addShape(empty, { form: parsePath(rectPath(0, 0, 40, 4, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!;
    const p = a.pattern;
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    expect(objs).toHaveLength(1);
    expect(objs[0].kind).toBe('satin');
    const geo = guessGeo(p, objs[0], kinds)!;
    expect(geo).toBe(geoOf(remembered(p, objs[0])));
    // One end made a little wider.
    const wider = moveNode(geo, 0, 2, 0, 1);
    const r = reshapeObject(p, objs, objs[0], kinds, wider, T);
    expect(r).not.toBeNull();
    expect(r!.starts).toHaveLength(1);
    expect(geoOf(r!.memory[0])).toEqual(wider);
    expect(r!.memory[0].satin).toBeDefined();
    const now = sewObjects(r!.pattern);
    expect(now).toHaveLength(1);
    expect(now[0].maxY).toBeGreaterThan(objs[0].maxY + 5);
  });

  it('shows a satin of a file as the outline of each column, and sews it over the edited outline', () => {
    const p = load('demos/letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => satinOutline(p, x, kinds))!;
    expect(o).toBeDefined();
    const outline = guessGeo(p, o, kinds)!;
    const cols = keepShape(p, o, kinds).columns!.flat();
    // One outline per column; a column that goes all round (an O) has its hole as a second one.
    expect(outline.paths.length).toBeGreaterThanOrEqual(cols.length);
    expect(outline.paths.every((x) => x.closed)).toBe(true);
    // Few nodes: curves, not every penetration.
    expect(outline.paths[0].nodes.length).toBeLessThan(cols[0].left.length);
    // Moved as a whole by 1 mm: sewn over the moved area, as one object, its form now given.
    const moved = transformForm(outline, translation(1, 0));
    const r = reshapeObject(p, objs, o, kinds, moved, T)!;
    expect(r).not.toBeNull();
    expect(sewObjects(r.pattern).length).toBe(objs.length);
    expect(geoOf(r.memory[0])).toEqual(moved);
    expect(r.memory[0].satin).toBeDefined();
    const box = bounds(moved)!;
    const after = sewObjects(r.pattern).find((x) => x.index === o.index)!;
    expect(after.minX / 10).toBeGreaterThan(box.minX - 1);
    expect(after.maxX / 10).toBeLessThan(box.maxX + 1);
  });

  it('sews a line along its new paths', () => {
    const a = addShape(empty, { form: parsePath('M0 0 L30 0 L30 20', ID), kind: 'stroke', width: 0.3 }, COLORS[0], null, options)!;
    const p = a.pattern;
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const geo = guessGeo(p, objs[0], kinds)!;
    const longer = moveNode(geo, 0, 2, 0, 10);
    const r = reshapeObject(p, objs, objs[0], kinds, longer, T)!;
    expect(r).not.toBeNull();
    expect(geoOf(r.memory[0])).toEqual(longer);
    expect(sewObjects(r.pattern)[0].maxY / 10).toBeCloseTo(30, 0);
  });
});
