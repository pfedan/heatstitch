import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addShape } from '../src/model/addShape';
import { fits, geoOf, geoUse, guessGeo, lineGeoOf } from '../src/model/geo';
import { fillToLine } from '../src/model/line';
import { sewObjects } from '../src/model/objects';
import { lineToSatin, reshapeObject } from '../src/model/reshape';
import { memoryFrom, remembered, storedOf } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import type { Form } from '../src/shape/path';
import { parsePath, rectPath } from '../src/shape/svgPath';
import { COLORS, empty, ID, options, T } from './helpers/torture';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

/** Path `k` of `f` opened, or closed again. */
const toggled = (f: Form, k = 0): Form => ({ ...f, paths: f.paths.map((x, j) => (j === k ? { ...x, closed: !x.closed } : x)) });

/** A narrow drawn area, sewn as satin over it (see addShape). */
function satinArea() {
  const p = addShape(empty, { form: parsePath(rectPath(0, 0, 40, 4, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern;
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  expect(objs[0].kind).toBe('satin');
  return { p, kinds, objs, o: objs[0], geo: geoOf(remembered(p, objs[0]))! };
}

describe('a satin over an area opened on the level Form', () => {
  it('is sewn as a line along its paths, its satin kept, and as satin again once closed', () => {
    const { p, kinds, objs, o, geo } = satinArea();
    const open = toggled(geo);
    const r = reshapeObject(p, objs, o, kinds, open, T)!;
    expect(r?.starts).toHaveLength(1);
    const m = r.memory[0];
    expect(geoUse(m)).toBe('line');
    expect(geoOf(m)).toEqual(open);
    expect(m.line?.type).toBe('run');
    expect(m.satin).toBeUndefined();
    // A drawn satin measures its settings and columns from its stitches.
    const satin = m.kept!.satinSettings!;
    expect(satin.spacing).toBeGreaterThan(0.2);
    expect(m.kept?.satin?.length).toBeGreaterThan(0);
    // Closed again: still a line (as a fill opened and closed), Wieder Satin sews it as it was.
    const line = sewObjects(r.pattern);
    const closed = reshapeObject(r.pattern, line, line[0], stitchKinds(r.pattern), geo, T)!;
    expect(geoUse(closed.memory[0])).toBe('line');
    const back = lineToSatin(closed.pattern, 0, T)!;
    expect(back?.starts).toHaveLength(1);
    const n = back.memory[0];
    expect(geoUse(n)).toBe('area');
    expect(geoOf(n)).toEqual(geo);
    expect(n.satin).toEqual(satin);
    expect(n.kept?.satinSettings).toBeUndefined();
    expect(n.kept?.line?.type).toBe('run');
    expect(sewObjects(back.pattern)[0].kind).toBe('satin');
    // Along the columns it had: the stitches a satin gets over the same outline.
    const same = reshapeObject(p, objs, o, kinds, geo, T)!;
    const now = sewObjects(back.pattern)[0];
    const ref = sewObjects(same.pattern)[0];
    expect(now.last - now.first).toBe(ref.last - ref.first);
  });

  it('is sewn as satin again over an outline changed while it was a line', () => {
    const { p, kinds, objs, o, geo } = satinArea();
    const r = reshapeObject(p, objs, o, kinds, toggled(geo), T)!;
    // Closed again a little longer.
    const longer: Form = { ...geo, paths: geo.paths.map((x) => ({ ...x, nodes: x.nodes.map((nd) => (nd.p[0] > 20 ? { ...nd, p: [nd.p[0] + 6, nd.p[1]], a: [nd.a[0] + 6, nd.a[1]], b: [nd.b[0] + 6, nd.b[1]] } : nd)) })) };
    const line = sewObjects(r.pattern);
    const closed = reshapeObject(r.pattern, line, line[0], stitchKinds(r.pattern), longer, T)!;
    const back = lineToSatin(closed.pattern, 0, T)!;
    expect(back?.starts).toHaveLength(1);
    expect(geoOf(back.memory[0])).toEqual(longer);
    expect(sewObjects(back.pattern)[0].maxX).toBeGreaterThan(o.maxX + 40);
  });

  it('keeps its satin through saving and opening', () => {
    const { p, kinds, objs, o, geo } = satinArea();
    const r = reshapeObject(p, objs, o, kinds, toggled(geo), T)!;
    const q = r.pattern;
    const back = memoryFrom(structuredClone(storedOf(q, sewObjects(q)[0])!))!;
    expect(back.kept?.satinSettings).toEqual(r.memory[0].kept!.satinSettings);
    expect(back.kept?.satin?.length).toBe(r.memory[0].kept!.satin!.length);
  });

  it('makes a satin of a file a line along the outline of its columns', () => {
    const p = load('demos/letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin' && guessGeo(p, x, kinds))!;
    const r = fillToLine(p, o.index, T)!;
    expect(r).not.toBeNull();
    const m = remembered(r.pattern, sewObjects(r.pattern)[o.index])!;
    expect(lineGeoOf(m)).toBeTruthy();
    expect(fits(lineGeoOf(m), 'fill')).toBe(true);
    expect(m.kept?.satinSettings).toBeDefined();
    expect(lineToSatin(r.pattern, o.index, T)?.starts).toHaveLength(1);
  });
});
