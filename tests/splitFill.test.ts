import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import type { Pt } from '../src/digitize/skeleton';
import type { Region } from '../src/digitize/region';
import { addShape } from '../src/model/addShape';
import { sewObjects, type SewObject } from '../src/model/objects';
import { syncBorders } from '../src/model/border';
import { STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { formOf } from '../src/model/reshape';
import { remember, remembered, restitch, type FillSettings } from '../src/model/restitch';
import { takeOver, wholeArea } from '../src/model/knockout';
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

/** The border objects of `p`. */
const borders = (p: Pattern) => sewObjects(p).filter((o) => remembered(p, o)?.outline);

/** Stitches of object `o` on the cut at x = 15 mm, away from the rectangle's edges. */
function nearCut(p: Pattern, o: SewObject): number {
  let n = 0;
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH && Math.abs(p.x[i] / 10 - 15) < 1 && p.y[i] / 10 > 3 && p.y[i] / 10 < 17) n++;
  return n;
}

const spanX = (p: Pattern, o: SewObject) => {
  const xs: number[] = [];
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) xs.push(p.x[i] / 10);
  return Math.max(...xs) - Math.min(...xs);
};

/** The border of fill `o` set as the stitch panel sets it: new stitches, then the borders follow. */
function setBorder(p: Pattern, o: number, border: FillSettings['border']): Pattern {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const fill = remembered(p, objs[o])!.fill!;
  const link = fill.border?.link;
  const r = takeOver(restitch(p, objs, [o], { kind: 'fill', s: { ...fill, border: border && { ...border, link } } }, kinds, T))!;
  return syncBorders(r, T, link ? new Set([link]) : new Set());
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

  it('keeps one border around all parts, not along the cut, and leaves empty fills and fills from a file alone', () => {
    const d = design();
    const kinds = stitchKinds(d);
    const objs = sewObjects(d, kinds);
    const fill = remembered(d, objs[0])!.fill!;
    const p = syncBorders(takeOver(restitch(d, objs, [0], { kind: 'fill', s: { ...fill, border: { type: 'run', width: 2, length: 2.5, tolerance: 0.15 } } }, kinds, T))!, T);
    expect(borders(p)).toHaveLength(1);
    const s = splitFill(p, 0, [[[15, -2], [15, 22]]], T) as { pattern: Pattern; parts: number[] };
    const ids = s.parts.map((k) => sewObjects(s.pattern)[k].id);
    const links = s.parts.map((k) => remembered(s.pattern, sewObjects(s.pattern)[k])?.fill?.border?.link);
    expect(links[0]).toBeTruthy();
    expect(links[1]).toBe(links[0]);
    for (const k of s.parts) expect(remembered(s.pattern, sewObjects(s.pattern)[k])?.fill?.pieces).toEqual(ids);
    // One border, around the whole rectangle and not along the cut.
    const b = borders(s.pattern);
    expect(b).toHaveLength(1);
    expect(nearCut(s.pattern, b[0])).toBe(0);
    expect(spanX(s.pattern, b[0])).toBeGreaterThan(28);
    const q = design();
    const e = sewObjects(q)[0];
    remember(q, e, { ...remembered(q, e)!, fill: { ...remembered(q, e)!.fill!, pattern: 'none' } });
    expect(canSplit(q, 0)).toBe(false);
    remember(q, e, { ...remembered(q, e)!, fill: undefined });
    expect(canSplit(q, 0)).toBe(false);
  });

  it('turns the border of all parts on and off from one part', () => {
    const s = splitFill(design(), 0, [[[15, -2], [15, 22]]], T) as { pattern: Pattern; parts: number[] };
    expect(borders(s.pattern)).toHaveLength(0);
    // A satin border set on the second part only: all parts have it, sewn once around them.
    const on = setBorder(s.pattern, 1, { type: 'satin', width: 2, length: 2.5, tolerance: 0.15 });
    const fills = (p: Pattern) => sewObjects(p).filter((o) => remembered(p, o)?.fill?.pieces);
    expect(fills(on).map((o) => remembered(on, o)?.fill?.border?.type)).toEqual(['satin', 'satin']);
    const b = borders(on);
    expect(b).toHaveLength(1);
    expect(nearCut(on, b[0])).toBe(0);
    // Off on the first part: off for all.
    const off = setBorder(on, 0, undefined);
    expect(fills(off).map((o) => remembered(off, o)?.fill?.border)).toEqual([undefined, undefined]);
    expect(borders(off)).toHaveLength(0);
  });

  it('gives copies of the parts a border of their own', () => {
    const s = splitFill(design(), 0, [[[15, -2], [15, 22]]], T) as { pattern: Pattern; parts: number[] };
    const on = setBorder(s.pattern, 0, { type: 'run', width: 2, length: 2.5, tolerance: 0.15 });
    const d = duplicateObjects(on, [0, 1], T)!;
    const b = borders(d.pattern);
    expect(b).toHaveLength(2);
    expect(new Set(b.map((o) => remembered(d.pattern, o)?.outline)).size).toBe(2);
    // One copied part alone is a fill with a border of its own, all around it.
    const one = duplicateObjects(on, [1], T)!;
    const copy = sewObjects(one.pattern).find((o) => remembered(one.pattern, o)?.fill && !remembered(one.pattern, o)?.fill?.pieces);
    expect(copy && copy.id).toBeTruthy();
    expect(borders(one.pattern)).toHaveLength(2);
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
