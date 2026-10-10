import { beforeAll, describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { wholeArea } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import type { Pattern } from '../src/model/pattern';
import { analyze, measureFill, objectKey, remember, remembered, restitch, type BorderSettings, type FillSettings, type RestitchResult } from '../src/model/restitch';
import { coversOver } from '../src/model/covers';
import { STITCH } from '../src/model/pattern';
import { rememberObjects } from '../src/model/objects';
import { syncBorders } from '../src/model/border';
import { stitchKinds } from '../src/model/sequence';
import { deleteObjects, duplicateObject, duplicateObjects, mirrorMatrix, recolorObjects, subtractTop, unionForm } from '../src/model/shapeOps';
import { fillsToLines, transformSewObject } from '../src/model/reshape';
import { lineToFill } from '../src/model/line';
import type { Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { guessArea } from '../src/model/geo';
import { areaOfForm, loadOps } from '../src/shape/ops';

beforeAll(loadOps);

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
  return wholeArea(guessArea(p, objs[o], stitchKinds(p))!)!.areaMm2;
};

describe('shape operations', () => {
  it('deletes objects, all of them to an empty design', () => {
    const p = design();
    const next = deleteObjects(p, [1], options.trimMm)!;
    expect(sewObjects(next)).toHaveLength(2);
    // The others keep their curves.
    expect(remembered(next, sewObjects(next)[1])?.geo).toBeTruthy();
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
    expect(remembered(d.pattern, objs[3])?.geo).toBeTruthy();
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
    const form = remembered(r.pattern, m)!.geo!;
    expect(Math.max(...form.paths[0].nodes.filter((n) => n.p[1] < 1).map((n) => n.p[0]))).toBeGreaterThan(18);
  });

  it('joins outlines into one', () => {
    const f = unionForm([parsePath(rectPath(0, 0, 10, 10, 0, 0), ID), parsePath(rectPath(5, 0, 10, 10, 0, 0), ID)])!;
    expect(f.paths).toHaveLength(1);
    // On the curves: exactly the two squares less what they share.
    expect(areaOfForm(f)).toBeCloseTo(150, 6);
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
    // The cut runs on the disc's curve: the form lost exactly half the disc.
    const objs = sewObjects(r.pattern);
    expect(400 - areaOfForm(guessArea(r.pattern, objs[0], stitchKinds(r.pattern))!)).toBeCloseTo(areaOfForm(parsePath(ellipsePath(20, 10, 6, 6), ID)) / 2, 4);
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
    expect(remembered(a, objs[2])?.geo).toBeTruthy();
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
      expect(remembered(d.pattern, objs[o + 1])?.geo).toBeTruthy();
      expect(objs[o + 1].minX - objs[o].minX).toBeCloseTo(20, -1);
    }
  });

  it('copies a fill with its border of its own thread, and a copied border is a line of its own', () => {
    const p0 = addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, red, null, options)!.pattern;
    const kinds = stitchKinds(p0);
    const objs = sewObjects(p0, kinds);
    const s = measureFill(p0, analyze(p0, objs[0], kinds));
    const r = restitch(p0, objs, [0], { kind: 'fill', s, line: { type: 'run', width: 2, color: blue, link: 'b1' } }, kinds, options.trimMm);
    rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
    remember(r.pattern, sewObjects(r.pattern)[0], r.memory[0]);
    const p = syncBorders(r.pattern, options.trimMm);
    expect(sewObjects(p)).toHaveLength(2);

    const d = duplicateObject(p, 0, options.trimMm)!;
    const after = sewObjects(d.pattern);
    expect(after).toHaveLength(4);
    expect(d.pattern.colors).toHaveLength(2);
    const fills = after.filter((o) => remembered(d.pattern, o)?.line?.link);
    const links = fills.map((o) => remembered(d.pattern, o)!.line!.link);
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

/** A fill of `p` (object `o`) sewn anew with settings `s`, as the stitch panel does. */
function sewWith(p: Pattern, o: number, settings: FillSettings & { border?: BorderSettings }, drop: string[] = []): Pattern {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const { border, ...s } = settings;
  const r = restitch(p, objs, [o], { kind: 'fill', s, line: border ?? null }, kinds, options.trimMm);
  expect(r.starts).toHaveLength(1);
  rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
  const at = sewObjects(r.pattern).find((x) => {
    let n = 0;
    for (let i = 0; i < x.first; i++) if (r.pattern.cmd[i] === STITCH) n++;
    return n === r.starts[0];
  })!;
  remember(r.pattern, at, r.memory[0]);
  return syncBorders(r.pattern, options.trimMm, new Set(drop));
}

/** The box of an object's stitches (0.1 mm). */
const box = (p: Pattern, o: number) => {
  const x = sewObjects(p)[o];
  return [x.minX, x.minY, x.maxX, x.maxY];
};

describe('duplicating several, and in place', () => {
  it('copies several objects at once, each right after its original and 2 mm beside it', () => {
    const p = design();
    const d = duplicateObjects(p, [0, 2], options.trimMm)!;
    const objs = sewObjects(d.pattern);
    expect(objs).toHaveLength(5);
    expect(d.copies).toEqual([1, 4]);
    for (const [o, c] of [[0, 1], [3, 4]]) {
      expect(objs[c].minX - objs[o].minX).toBeCloseTo(20, -1);
      expect(objs[c].minY - objs[o].minY).toBeCloseTo(20, -1);
      expect(objs[c].block).toBe(objs[o].block);
      expect(remembered(d.pattern, objs[c])?.geo).toBeTruthy();
    }
  });

  it('copies exactly in place, sewn from the other end, each remembering its own', () => {
    const p = design();
    const d = duplicateObjects(p, [1], options.trimMm, 0)!;
    expect(d.copies).toEqual([2]);
    expect(d.nudged).toBe(0);
    const objs = sewObjects(d.pattern);
    expect(objs).toHaveLength(4);
    // The same place: the same box, give or take what the other direction changes at the edge.
    box(d.pattern, 2).forEach((v, k) => expect(Math.abs(v - box(d.pattern, 1)[k])).toBeLessThanOrEqual(3));
    // Different stitches, so each has its own memory (memory is keyed by stitches).
    expect(objectKey(d.pattern, objs[2])).not.toBe(objectKey(d.pattern, objs[1]));
    expect(remembered(d.pattern, objs[2])?.geo).toBeTruthy();
    // It starts near where the original ends: no long way back.
    const end = objs[1].last;
    const start = objs[2].first;
    expect(Math.hypot(d.pattern.x[start] - d.pattern.x[end], d.pattern.y[start] - d.pattern.y[end])).toBeLessThan(60);
  });

  it('copies a line in place with its curve turned around', () => {
    const line = parsePath('M0 0 C10 10 20 -10 30 0', ID);
    const p = addShape(empty, { form: line, kind: 'stroke', width: 0 }, red, null, options)!.pattern;
    const d = duplicateObjects(p, [0], options.trimMm, 0)!;
    const objs = sewObjects(d.pattern);
    expect(objs).toHaveLength(2);
    expect(objectKey(d.pattern, objs[1])).not.toBe(objectKey(d.pattern, objs[0]));
    expect(remembered(d.pattern, objs[1])?.geo).toBeTruthy();
    box(d.pattern, 1).forEach((v, k) => expect(Math.abs(v - box(d.pattern, 0)[k])).toBeLessThanOrEqual(2));
  });

  it('copies a fill in place with its border in a thread of its own, each fill with its own border', () => {
    const p0 = design();
    const fill = remembered(p0, sewObjects(p0)[0])!.fill!;
    const p = sewWith(p0, 0, { ...fill, border: { type: 'run', width: 2, color: blue, link: 'b1' } });
    const d = duplicateObjects(p, [0], options.trimMm, 0)!;
    const objs = sewObjects(d.pattern);
    const keys = objs.map((o) => objectKey(d.pattern, o));
    expect(new Set(keys).size).toBe(keys.length);
    const links = objs.flatMap((o) => remembered(d.pattern, o)?.line?.link ?? []);
    expect(new Set(links).size).toBe(2);
    for (const l of links) expect(objs.filter((o) => remembered(d.pattern, o)?.outline === l)).toHaveLength(1);
  });

  it('copies a fill and its border selected together once: the copy gets a border of its own', () => {
    const p0 = design();
    const fill = remembered(p0, sewObjects(p0)[0])!.fill!;
    const p = sewWith(p0, 0, { ...fill, border: { type: 'run', width: 2, color: blue, link: 'b1' } });
    const border = sewObjects(p).findIndex((o) => remembered(p, o)?.outline === 'b1');
    const d = duplicateObjects(p, [0, border], options.trimMm)!;
    expect(d.copies).toHaveLength(1);
    const objs = sewObjects(d.pattern);
    expect(objs).toHaveLength(sewObjects(p).length + 2);
    expect(objs.filter((o) => remembered(d.pattern, o)?.outline)).toHaveLength(2);
  });
});

/** New stitches taken over as the app does (applyRestitched): each object remembers what it is made of. */
function take(r: RestitchResult | null, drop: ReadonlySet<string> = new Set()): Pattern {
  expect(r?.starts.length).toBeGreaterThan(0);
  r!.starts.forEach((a, k) => rememberObjects(r!.pattern, [a], r!.ends[k]));
  const objs = sewObjects(r!.pattern);
  r!.starts.forEach((a, k) => {
    const at = objs.find((x) => {
      let n = 0;
      for (let i = 0; i < x.first; i++) if (r!.pattern.cmd[i] === STITCH) n++;
      return n === a;
    })!;
    remember(r!.pattern, at, r!.memory[k]);
  });
  return syncBorders(r!.pattern, options.trimMm, drop);
}

describe('empty fill: a line along the form', () => {
  it('sews only the edge, in the fill\'s thread, and fills again as it was', () => {
    const p0 = design();
    const fill = remembered(p0, sewObjects(p0)[0])!.fill!;
    const bordered = sewWith(p0, 0, { ...fill, pattern: 'contour', border: { type: 'run', width: 2, color: blue, link: 'b1' } });
    expect(sewObjects(bordered)).toHaveLength(4);
    const before = sewObjects(bordered)[0].stitches;
    const form = remembered(bordered, sewObjects(bordered)[0])!.geo;
    const r = fillsToLines(bordered, [0], options.trimMm)!;
    expect([...r.drop]).toEqual(['b1']);
    const p = take(r, r.drop);
    const objs = sewObjects(p);
    // The border object went: the line is sewn with the border's stitch, in the fill's (red) thread.
    expect(objs).toHaveLength(3);
    expect(objs[0].color).toMatchObject(red);
    expect(objs[0].stitches).toBeLessThan(before / 4);
    const m = remembered(p, objs[0])!;
    expect(m.fill).toBeUndefined();
    expect(m.geo).toBe(form);
    expect(m.line).toMatchObject({ type: 'run', width: 2 });
    expect(m.kept?.fill?.pattern).toBe('contour');
    // Along the edge only: no stitch deep inside the square.
    for (let i = objs[0].first; i <= objs[0].last; i++) {
      if (p.cmd[i] !== STITCH) continue;
      const d = Math.min(p.x[i], p.y[i], 200 - p.x[i], 200 - p.y[i]);
      expect(d).toBeLessThan(15);
    }
    // Filled again: as it was, its line its border (in its thread now).
    const filled = take(lineToFill(p, 0, fill, options.trimMm));
    const f = remembered(filled, sewObjects(filled)[0])!;
    expect(f.fill?.pattern).toBe('contour');
    expect(f.line).toMatchObject({ type: 'run', width: 2 });
    expect(f.geo).toBe(form);
    expect(sewObjects(filled)[0].stitches).toBeGreaterThan(before / 2);
  });

  it('covers nothing for the objects below', () => {
    const p0 = design();
    // The blue disc lies on the red square: it covers part of it, as a line it covers nothing.
    const objs0 = sewObjects(p0);
    expect(coversOver(p0, objs0, objs0[0], 0.1).length).toBeGreaterThan(0);
    const p = take(fillsToLines(p0, [1], options.trimMm));
    const objs = sewObjects(p);
    expect(coversOver(p, objs, objs[0], 0.1)).toHaveLength(0);
  });

  it('copies in place with the line only', () => {
    const p0 = design();
    const p = take(fillsToLines(p0, [2], options.trimMm));
    const d = duplicateObjects(p, [2], options.trimMm, 0)!;
    const objs = sewObjects(d.pattern);
    expect(objs).toHaveLength(4);
    expect(remembered(d.pattern, objs[3])!.kept?.fill).toBeDefined();
    expect(remembered(d.pattern, objs[3])!.line).toBeDefined();
    expect(objectKey(d.pattern, objs[3])).not.toBe(objectKey(d.pattern, objs[2]));
  });
});
