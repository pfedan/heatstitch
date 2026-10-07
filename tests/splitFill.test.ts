import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import type { Pt } from '../src/digitize/skeleton';
import type { Region } from '../src/digitize/region';
import { addShape } from '../src/model/addShape';
import { rememberObjects, sewObjects } from '../src/model/objects';
import { STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { formOf, transformSewObject } from '../src/model/reshape';
import { remember, remembered, rememberedIn, restitch, type BorderSettings, type FillSettings } from '../src/model/restitch';
import { shareBorders, syncBorders } from '../src/model/border';
import { stitchesBefore } from '../src/model/transform';
import { wholeArea } from '../src/model/knockout';
import { stitchKinds } from '../src/model/sequence';
import { duplicateObjects, mirrorMatrix } from '../src/model/shapeOps';
import { canSplit, partAngles, splitArea, splitFill } from '../src/model/splitFill';
import type { Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const T = options.trimMm;
const green = { r: 60, g: 170, b: 70 };
const red = { r: 200, g: 30, b: 30 };
const dark = { r: 20, g: 60, b: 30 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

/** A green 30 x 20 mm rectangle, and a red disc beside it. */
function design(): Pattern {
  const p = addShape(empty, { form: parsePath(rectPath(0, 0, 30, 20, 0, 0), ID), kind: 'fill' }, green, null, options)!.pattern;
  return addShape(p, { form: parsePath(ellipsePath(50, 10, 6, 6), ID), kind: 'fill' }, red, 0, options)!.pattern;
}

const areaOf = (p: Pattern, o: number): Region => {
  const objs = sewObjects(p);
  return wholeArea(formOf(p, objs[o], stitchKinds(p))!)!;
};

/** Share of the pixels of `whole` that none of `parts` covers. */
function uncovered(whole: Region, parts: Region[]): number {
  let miss = 0;
  let all = 0;
  for (let y = 0; y < whole.h; y++) {
    for (let x = 0; x < whole.w; x++) {
      if (!whole.mask[y * whole.w + x]) continue;
      all++;
      const wx = x + whole.x0;
      const wy = y + whole.y0;
      const hit = parts.some((r) => {
        const i = wx - r.x0;
        const j = wy - r.y0;
        return i >= 0 && j >= 0 && i < r.w && j < r.h && r.mask[j * r.w + i];
      });
      if (!hit) miss++;
    }
  }
  return miss / all;
}

const trims = (p: Pattern) => p.cmd.reduce((n, c) => n + (c === TRIM ? 1 : 0), 0);

describe('split a fill', () => {
  it('cuts an area along a straight line into two parts that overlap a little and leave no gap', () => {
    const whole = areaOf(design(), 0);
    const s = splitArea(whole, [[[15, -2], [15, 22]]])!;
    expect(s.parts).toHaveLength(2);
    expect(s.touching).toEqual([[0, 1]]);
    const sum = s.parts.reduce((a, r) => a + r.areaMm2, 0);
    // Both halves, each reaching 0.2 mm under the other along the 20 mm cut.
    expect(sum).toBeGreaterThan(whole.areaMm2);
    expect(sum - whole.areaMm2).toBeLessThan(20 * 0.2 * 2 + 3);
    expect(uncovered(whole, s.parts)).toBe(0);
  });

  it('takes a cut that stops just short of the edge through to it, and leaves an area whole that is not cut apart', () => {
    const whole = areaOf(design(), 0);
    expect(splitArea(whole, [[[10, 1], [10, 19]]])?.parts).toHaveLength(2);
    expect(splitArea(whole, [[[10, 5], [10, 15]]])).toBeNull();
    expect(splitArea(whole, [[[40, -2], [40, 22]]])).toBeNull();
  });

  it('cuts freehand and along a path with corners', () => {
    const whole = areaOf(design(), 0);
    const wave: Pt[] = Array.from({ length: 40 }, (_, k) => [-1 + k * 0.8, 10 + 4 * Math.sin(k / 4)]);
    expect(splitArea(whole, [wave])?.parts).toHaveLength(2);
    const path: Pt[] = [[-2, 4], [12, 16], [20, 3], [32, 12]];
    const s = splitArea(whole, [path])!;
    expect(s.parts.length).toBeGreaterThanOrEqual(2);
    expect(uncovered(whole, s.parts)).toBe(0);
  });

  it('mirrors the rows of neighbouring parts at the cut', () => {
    // A cut across at 0 degrees: 45 becomes 135.
    expect(partAngles(2, [[0, 1]], 45, [[[0, 0], [10, 0]]])).toEqual([45, 135]);
    // Three stripes: the middle one differs from both outer ones.
    expect(partAngles(3, [[0, 1], [1, 2]], 45, [[[0, 0], [10, 0]]])).toEqual([45, 135, 45]);
    // A mirror close to the original turns a right angle instead.
    expect(partAngles(2, [[0, 1]], 0, [[[0, 0], [10, 0]]])).toEqual([0, 90]);
  });

  it('makes each part an object of its own, sewn one after the other in the same thread', () => {
    const p = design();
    const whole = areaOf(p, 0);
    const before = trims(p);
    const r = splitFill(p, 0, [[[15, -2], [15, 22]]], T);
    expect(r).not.toBe('whole');
    const s = r as Exclude<typeof r, 'whole' | null>;
    expect(s).not.toBeNull();
    expect(s.parts).toEqual([0, 1]);
    const objs = sewObjects(s.pattern);
    expect(objs).toHaveLength(3);
    expect(objs[0].color).toEqual(green);
    expect(objs[1].color).toEqual(green);
    expect(objs[2].color).toEqual(red);
    // Each part knows its form and has its own direction.
    const a = remembered(s.pattern, objs[0])!;
    const b = remembered(s.pattern, objs[1])!;
    expect(a.form && b.form).toBeTruthy();
    expect(a.fill!.angle).not.toBe(b.fill!.angle);
    // Together they cover the old area.
    expect(uncovered(whole, [areaOf(s.pattern, 0), areaOf(s.pattern, 1)])).toBeLessThan(0.002);
    // One trim between the two parts (objects of one thread are kept apart by trims).
    expect(trims(s.pattern)).toBe(before + 1);
  });

  it('says when a cut does not cut the fill apart, and splits only fills', () => {
    const p = design();
    expect(splitFill(p, 0, [[[10, 5], [10, 15]]], T)).toBe('whole');
    expect(canSplit(p, 0)).toBe(true);
    expect(canSplit(p, 7)).toBe(false);
  });

  it('keeps working with the parts: duplicate, mirror, split again', () => {
    const p = design();
    const s = splitFill(p, 0, [[[15, -2], [15, 22]]], T) as { pattern: Pattern; parts: number[] };
    const d = duplicateObjects(s.pattern, s.parts, T)!;
    expect(sewObjects(d.pattern)).toHaveLength(5);
    expect(mirrorMatrix('x', { minX: 0, minY: 0, maxX: 30, maxY: 20 })).toBeTruthy();
    // The left half once more, across.
    const again = splitFill(s.pattern, 0, [[[-2, 10], [17, 10]]], T) as { pattern: Pattern; parts: number[] };
    expect(again.parts).toEqual([0, 1]);
    expect(sewObjects(again.pattern)).toHaveLength(4);
  });

  it('leaves empty fills and fills from a file alone', () => {
    const q = design();
    const e = sewObjects(q)[0];
    remember(q, e, { ...remembered(q, e)!, fill: { ...remembered(q, e)!.fill!, pattern: 'none' } });
    expect(canSplit(q, 0)).toBe(false);
    remember(q, e, { ...remembered(q, e)!, fill: undefined });
    expect(canSplit(q, 0)).toBe(false);
  });

  it('gives the parts ids of their own, the first keeping the id of the fill', () => {
    const p = design();
    const before = sewObjects(p).map((o) => o.id);
    const s = splitFill(p, 0, [[[15, -2], [15, 22]]], T) as { pattern: Pattern; parts: number[] };
    const ids = sewObjects(s.pattern).map((o) => o.id);
    expect(ids[s.parts[0]]).toBe(before[0]);
    expect(new Set(ids).size).toBe(ids.length);
    // The disc beside keeps its id too.
    expect(ids[ids.length - 1]).toBe(before[1]);
  });
});

/** Object `o` with new fill settings, taken over as the app's panel does (applyRestitched). */
function withFill(p: Pattern, o: number, change: Partial<FillSettings>): Pattern {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const drop = new Set([remembered(p, objs[o])?.fill?.border?.link ?? ''].filter(Boolean));
  const r = restitch(p, objs, [o], { kind: 'fill', s: { ...remembered(p, objs[o])!.fill!, ...change } }, kinds, T);
  r.starts.forEach((a, k) => rememberObjects(r.pattern, [a], r.ends[k]));
  const now = sewObjects(r.pattern);
  const edited = now.filter((x) => {
    const n = stitchesBefore(r.pattern, x.first);
    return n >= r.starts[0] && n < r.ends[0];
  });
  if (edited.length === 1) remember(r.pattern, edited[0], r.memory[0]);
  shareBorders(r.pattern, edited);
  return syncBorders(r.pattern, T, drop);
}

const RUN: BorderSettings = { type: 'run', width: 2, length: 2.5, tolerance: 0.15 };
const SATIN: BorderSettings = { type: 'satin', width: 1.6, length: 2.5, tolerance: 0.15 };
const memOf = (p: Pattern) => sewObjects(p).map((o) => remembered(p, o));
const borderObjects = (p: Pattern) => memOf(p).flatMap((m, k) => (m?.outline ? [k] : []));

/** Stitches of object `o` (mm). */
function stitchesOf(p: Pattern, o: number): [number, number][] {
  const obj = sewObjects(p)[o];
  const out: [number, number][] = [];
  for (let i = obj.first; i <= obj.last; i++) if (p.cmd[i] === STITCH) out.push([p.x[i] / 10, p.y[i] / 10]);
  return out;
}

/** The green rectangle with a border in its own (dark) thread, cut in two along x = 15. */
function borderedHalves(border: BorderSettings = { ...RUN, color: dark }): { p: Pattern; parts: number[] } {
  const d = withFill(design(), 0, { border });
  const s = splitFill(d, 0, [[[15, -2], [15, 22]]], T) as { pattern: Pattern; parts: number[] };
  return { p: s.pattern, parts: s.parts };
}

describe('the border of a fill cut apart', () => {
  it('stays one border around all parts, never along the cut', () => {
    const { p, parts } = borderedHalves({ ...SATIN, color: dark });
    const mem = memOf(p);
    // The parts are one whole and keep the border's settings, with the same link.
    const [a, b] = parts.map((k) => mem[k]!);
    expect(a.piece).toBeTruthy();
    expect(b.piece).toBe(a.piece);
    expect(a.fill!.border).toEqual(b.fill!.border);
    expect(a.fill!.border!.link).toBeTruthy();
    // One border object, in its thread, after the parts.
    const borders = borderObjects(p);
    expect(borders).toHaveLength(1);
    expect(mem[borders[0]]!.outline).toBe(a.fill!.border!.link);
    expect(borders[0]).toBeGreaterThan(parts[1]);
    expect(sewObjects(p)[borders[0]].color).toEqual(dark);
    // Around the whole rectangle (all four sides), not along the cut at x = 15.
    const pts = stitchesOf(p, borders[0]);
    expect(pts.some(([x]) => x < 2)).toBe(true);
    expect(pts.some(([x]) => x > 28)).toBe(true);
    expect(pts.filter(([x, y]) => Math.abs(x - 15) < 1.5 && y > 3 && y < 17)).toHaveLength(0);
  });

  it('keeps a border in the fill thread as one object too', () => {
    const { p, parts } = borderedHalves({ ...RUN });
    const borders = borderObjects(p);
    expect(borders).toHaveLength(1);
    expect(sewObjects(p)[borders[0]].color).toEqual(green);
    expect(borders[0]).toBe(parts[1] + 1);
  });

  it('changes for every part when one part is given another border, and goes when one part has none', () => {
    const { p, parts } = borderedHalves();
    const q = withFill(p, parts[1], { border: { ...SATIN, color: dark, link: memOf(p)[parts[1]]!.fill!.border!.link } });
    const mem = memOf(q);
    expect(mem[parts[0]]!.fill!.border!.type).toBe('satin');
    expect(mem[parts[1]]!.fill!.border!.type).toBe('satin');
    expect(borderObjects(q)).toHaveLength(1);
    expect(mem[borderObjects(q)[0]]!.border!.type).toBe('satin');
    const off = withFill(q, parts[0], { border: undefined });
    expect(borderObjects(off)).toHaveLength(0);
    expect(memOf(off).some((m) => m?.fill?.border)).toBe(false);
    // On again at the other part: around both again.
    const on = withFill(off, parts[1], { border: { ...RUN } });
    expect(borderObjects(on)).toHaveLength(1);
    const pts = stitchesOf(on, borderObjects(on)[0]);
    expect(pts.some(([x]) => x < 2) && pts.some(([x]) => x > 28)).toBe(true);
  });

  it('follows a part that is moved away: around both pieces', () => {
    const { p, parts } = borderedHalves();
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const r = transformSewObject(p, objs, objs[parts[1]], kinds, [1, 0, 0, 1, 0, 30], T)!;
    const q = syncBorders(r.pattern, T);
    expect(memOf(q)[parts[1]]!.piece).toBe(memOf(p)[parts[0]]!.piece);
    const borders = borderObjects(q);
    expect(borders).toHaveLength(1);
    const pts = stitchesOf(q, borders[0]);
    // Around the moved half down there too, and now along the cut (it is an edge of its own).
    expect(pts.some(([, y]) => y > 45)).toBe(true);
    expect(pts.some(([x, y]) => Math.abs(x - 15) < 1 && y > 5 && y < 15)).toBe(true);
  });

  it('gives copies of the parts a whole and border of their own', () => {
    const { p, parts } = borderedHalves();
    const d = duplicateObjects(p, parts, T)!;
    const mem = memOf(d.pattern);
    const [c0, c1] = d.copies.map((k) => mem[k]!);
    expect(c0.piece).toBeTruthy();
    expect(c1.piece).toBe(c0.piece);
    expect(c0.piece).not.toBe(mem[parts[0]]!.piece);
    expect(c0.fill!.border!.link).toBe(c1.fill!.border!.link);
    expect(c0.fill!.border!.link).not.toBe(mem[parts[0]]!.fill!.border!.link);
    expect(borderObjects(d.pattern)).toHaveLength(2);
    // One part copied alone: a fill with a border of its own.
    const one = duplicateObjects(p, [parts[1]], T)!;
    const m1 = memOf(one.pattern);
    expect(m1[one.copies[0]]!.piece).not.toBe(m1[parts[0]]!.piece);
    expect(borderObjects(one.pattern)).toHaveLength(2);
  });

  it('stays in its whole when a part is cut again', () => {
    const { p, parts } = borderedHalves();
    const again = splitFill(p, parts[0], [[[-2, 10], [17, 10]]], T) as { pattern: Pattern; parts: number[] };
    const mem = memOf(again.pattern);
    const pieces = new Set(mem.filter((m) => m?.fill).map((m) => m!.piece));
    // The two quarters and the right half; the red disc is no part.
    expect(mem.filter((m) => m?.piece).length).toBe(3);
    expect(pieces.size).toBe(2);
    expect(borderObjects(again.pattern)).toHaveLength(1);
  });

  it('is stored as the first part naming the whole and the others following it by id', () => {
    const { p, parts } = borderedHalves();
    const stored = rememberedIn(p);
    const ids = sewObjects(p).map((o) => o.id);
    const first = stored.objects.find((e) => e.id === ids[parts[0]])!;
    const second = stored.objects.find((e) => e.id === ids[parts[1]])!;
    expect(first.memory!.piece).toBe(memOf(p)[parts[0]]!.piece);
    expect(second.memory!.piece).toBeUndefined();
    expect(second.memory!.of).toEqual({ id: ids[parts[0]], role: 'piece' });
  });
});
