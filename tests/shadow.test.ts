import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { syncBorders } from '../src/model/border';
import { lineSettings, resewLine } from '../src/model/line';
import { sewObjects } from '../src/model/objects';
import { STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { remembered, rememberedIn, restoreRemembered } from '../src/model/restitch';
import { deleteObjects, duplicateObject, recolorObjects } from '../src/model/shapeOps';
import { transformSewObject } from '../src/model/reshape';
import { stitchKinds } from '../src/model/sequence';
import { type Mat } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import type { LineShadow } from '../src/model/shadow';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const T = options.trimMm;
const red = { r: 200, g: 30, b: 30 };
const blue = { r: 30, g: 60, b: 200 };
const grey = { r: 64, g: 64, b: 64 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

const points = (p: Pattern, first: number, last: number) => {
  const out: [number, number][] = [];
  for (let i = first; i <= last; i++) if (p.cmd[i] === STITCH) out.push([p.x[i] / 10, p.y[i] / 10]);
  return out;
};

/** A red line (after a blue square when `before`), its shadow set in the panel. */
function shaded(shadow: Partial<LineShadow> = {}, before = false): Pattern {
  let p = empty as Pattern;
  if (before) p = addShape(p, { form: parsePath('M0 20 L10 20 L10 30 L0 30 Z', ID), kind: 'fill' }, blue, null, options)!.pattern;
  p = addShape(p, { form: parsePath('M0 0 L30 0', ID), kind: 'stroke', width: 0.4 }, red, before ? 0 : null, options)!.pattern;
  const objs = sewObjects(p);
  const o = objs[objs.length - 1];
  const st = { ...lineSettings(p, o), shadow: { color: grey, link: 's1', dir: 'se' as const, dist: 1, ...shadow } };
  const r = resewLine(p, o.index, remembered(p, o)!.path!, st, T)!;
  return syncBorders(r.pattern, T);
}

describe('shadow of a line', () => {
  it('is an object of its own thread, sewn before the line and offset', () => {
    const p = shaded();
    const objs = sewObjects(p);
    expect(objs).toHaveLength(2);
    expect(objs[0].color).toMatchObject(grey);
    expect(objs[1].color).toMatchObject(red);
    expect(remembered(p, objs[0])?.shadowOf).toBe('s1');
    for (const [x, y] of points(p, objs[0].first, objs[0].last)) {
      expect(y).toBeCloseTo(1, 1);
      expect(x).toBeGreaterThanOrEqual(0.9);
    }
    // Synced once more: nothing changes.
    expect(syncBorders(p, T)).toBe(p);
  });

  it('goes into the block before when that has its thread, and follows the line when it moves', () => {
    const p = shaded({ color: blue }, true);
    const objs = sewObjects(p);
    expect(p.colors).toHaveLength(2);
    expect(remembered(p, objs[1])?.shadowOf).toBe('s1');
    const kinds = stitchKinds(p);
    const m = transformSewObject(p, objs, objs[2], kinds, [1, 0, 0, 1, 5, 5], T)!;
    const q = syncBorders(m.pattern, T);
    const after = sewObjects(q);
    const sh = after.find((o) => remembered(q, o)?.shadowOf)!;
    expect(Math.min(...points(q, sh.first, sh.last).map((x) => x[1]))).toBeCloseTo(6, 1);
  });

  it('goes with its line, is copied as a shadow of its own, and comes back from a project', () => {
    const p = shaded();
    expect(sewObjects(deleteObjects(p, [1], T)!)).toHaveLength(0);
    const d = duplicateObject(p, 1, T)!;
    const objs = sewObjects(d.pattern);
    const shadows = objs.filter((o) => remembered(d.pattern, o)?.shadowOf);
    expect(shadows).toHaveLength(2);
    expect(new Set(shadows.map((o) => remembered(d.pattern, o)!.shadowOf)).size).toBe(2);
    const stored = JSON.parse(JSON.stringify(rememberedIn(p, sewObjects(p))));
    restoreRemembered(p, stored);
    expect(remembered(p, sewObjects(p)[1])?.line?.shadow).toMatchObject({ link: 's1', dir: 'se', dist: 1 });
  });

  it('turned off, the shadow goes; deleted alone, the line has none', () => {
    const p = shaded();
    const o = sewObjects(p)[1];
    const st = { ...lineSettings(p, o), shadow: undefined };
    const r = resewLine(p, 1, remembered(p, o)!.path!, st, T)!;
    const q = syncBorders(r.pattern, T);
    expect(sewObjects(q)).toHaveLength(1);
    const alone = deleteObjects(p, [0], T)!;
    expect(remembered(alone, sewObjects(alone)[0])?.line?.shadow).toBeUndefined();
  });

  it('takes a new thread through its line when recolored', () => {
    const p = shaded();
    const q = recolorObjects(p, [0], blue, T)!;
    const objs = sewObjects(q);
    const line = objs.find((o) => remembered(q, o)?.line?.shadow)!;
    expect(remembered(q, line)?.line?.shadow?.color).toMatchObject(blue);
    expect(objs.find((o) => remembered(q, o)?.shadowOf)?.color).toMatchObject(blue);
  });

  it('trims between echo copies when asked, and sews copies of another thread as a linked object after the line', () => {
    const a = addShape(empty, { form: parsePath('M0 0 L30 0', ID), kind: 'stroke', width: 0.4 }, red, null, options)!;
    const o = sewObjects(a.pattern)[0];
    const st = { ...lineSettings(a.pattern, o), echo: { side: 'out' as const, count: 3, gap: 3, cut: true, colors: [null, blue, blue], link: 'e1' } };
    const r = resewLine(a.pattern, 0, remembered(a.pattern, o)!.path!, st, T)!;
    const p = syncBorders(r.pattern, T);
    const objs = sewObjects(p);
    expect(objs).toHaveLength(2);
    expect(objs[0].color).toMatchObject(red);
    expect(objs[1].color).toMatchObject(blue);
    expect(remembered(p, objs[1])?.echoOf).toBe('e1:2');
    // The line with copy 1, trimmed between them; copies 2 and 3 in blue.
    let trims = 0;
    for (let i = objs[0].first; i <= objs[0].last; i++) if (p.cmd[i] === TRIM) trims++;
    const ys = (k: number) => points(p, objs[k].first, objs[k].last).map((q) => Math.round(q[1]));
    expect(new Set(ys(0))).toEqual(new Set([0, -3]));
    expect(new Set(ys(1))).toEqual(new Set([-6, -9]));
    expect(trims).toBeGreaterThan(0);
    // Deleted alone, the line leaves those copies out from now on.
    const alone = deleteObjects(p, [1], T)!;
    expect(remembered(alone, sewObjects(alone)[0])?.line?.echo?.skip).toEqual([2, 3]);
    expect(syncBorders(alone, T)).toBe(alone);
  });
});
