import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { fillToLine, lineToFill } from '../src/model/line';
import { addShape } from '../src/model/addShape';
import { rememberObjects, sewObjects } from '../src/model/objects';
import { remember, remembered, rememberedIn, restitch, restoreRemembered, type FillSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { STITCH, type Pattern } from '../src/model/pattern';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import type { Mat } from '../src/shape/path';
import { guessArea } from '../src/model/geo';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const red = { r: 200, g: 30, b: 30 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;
const fs: FillSettings = { pattern: 'tatami', spacing: 0.4, spacingEnd: 0.8, offset: 0.25, angle: NaN, stitch: 4, underlay: true, edge: 0, tolerance: 0.15 };

const take = (r: NonNullable<ReturnType<typeof lineToFill>>) => {
  rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
  const o = sewObjects(r.pattern)[0];
  remember(r.pattern, o, r.memory[0]);
  return { q: r.pattern, o, m: remembered(r.pattern, o)! };
};

const stitchesIn = (p: Pattern, first: number, last: number, test: (x: number, y: number) => boolean) => {
  let n = 0;
  for (let i = first; i <= last; i++) if (p.cmd[i] === STITCH && test(p.x[i] / 10, p.y[i] / 10)) n++;
  return n;
};

describe('a closed line filled inside', () => {
  for (const [name, width] of [
    ['running stitch', 0.4],
    ['satin', 3],
  ] as const) {
    it(`a ${name} line: the area in it filled, the line its border`, () => {
      const form = parsePath('M0 0 L30 0 L30 20 L0 20 Z', ID);
      const p = addShape(empty, { form, kind: 'stroke', width }, red, null, options)!.pattern;
      const line = remembered(p, sewObjects(p)[0])!.line!;
      const a = take(lineToFill(p, 0, fs, options.trimMm, 'area')!);
      expect(a.o.kind).toBe('fill');
      // The line is the outline of the fill, and still sewn along it as its border.
      expect(a.m.geo).toEqual(form);
      expect(guessArea(a.q, a.o, stitchKinds(a.q))).toEqual(form);
      // The line's stitch is kept to switch back.
      expect(a.m.line).toBeUndefined();
      expect(a.m.kept?.line).toEqual(line);
      expect(a.m.fill?.border).toMatchObject({ type: line.type, width: line.width });
      expect(a.m.region!.areaMm2).toBeGreaterThan(560);
      expect(a.m.region!.areaMm2).toBeLessThan(640);
      // Stitches inside, not only on the edge.
      expect(stitchesIn(a.q, a.o.first, a.o.last, (x, y) => x > 5 && x < 25 && y > 5 && y < 15)).toBeGreaterThan(20);
      // Kept with the project.
      const stored = structuredClone(rememberedIn(a.q, [a.o]));
      restoreRemembered(a.q, stored);
      expect(remembered(a.q, a.o)?.geo).toEqual(form);
    });
  }

  it('the border can go: a plain fill in the line', () => {
    const form = parsePath('M0 0 L30 0 L15 25 Z', ID);
    const p = addShape(empty, { form, kind: 'stroke', width: 0.4 }, red, null, options)!.pattern;
    const a = take(lineToFill(p, 0, fs, options.trimMm, 'area')!);
    const kinds = stitchKinds(a.q);
    const { border: _b, ...plain } = a.m.fill!;
    const b = take(restitch(a.q, sewObjects(a.q, kinds), [0], { kind: 'fill', s: plain }, kinds, options.trimMm));
    expect(b.m.fill?.border).toBeUndefined();
    expect(b.m.geo).toEqual(form);
  });

  it('a line again and a fill again: the same form, the same fill, the same line', () => {
    const form = parsePath('M0 0 L30 0 L15 25 Z', ID);
    const p = addShape(empty, { form, kind: 'stroke', width: 2 }, red, null, options)!.pattern;
    const line = remembered(p, sewObjects(p)[0])!.line!;
    const a = take(lineToFill(p, 0, { ...fs, pattern: 'contour' }, options.trimMm)!);
    const back = fillToLine(a.q, 0, options.trimMm)!;
    const b = remembered(back.pattern, sewObjects(back.pattern)[0])!;
    expect(b.geo).toEqual(form);
    expect(b.line).toEqual(line);
    expect(b.fill).toBeUndefined();
    expect(b.kept?.fill?.pattern).toBe('contour');
    // Filled again (with other settings offered): as it was.
    const c = take(lineToFill(back.pattern, 0, fs, options.trimMm)!);
    expect(c.m.geo).toEqual(form);
    expect(c.m.fill).toEqual(a.m.fill);
    expect(c.m.kept?.fill).toBeUndefined();
    expect(c.m.kept?.line).toEqual(line);
  });

  it('an open line is not filled', () => {
    const p = addShape(empty, { form: parsePath('M0 0 L30 0 L30 20', ID), kind: 'stroke', width: 0.4 }, red, null, options)!.pattern;
    expect(lineToFill(p, 0, fs, options.trimMm, 'area')).toBeNull();
  });
});
