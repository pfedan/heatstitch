import { beforeAll, describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes, type ShapeInput } from '../src/digitize/digitize';
import { digitizedFile } from '../src/model/digitized';
import { sewObjects } from '../src/model/objects';
import { END } from '../src/model/pattern';
import { remembered, rememberedIn, restoreRemembered } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { encodeRecords, isRecords, parseRecords } from '../src/parsers/records';
import { writePattern } from '../src/writers';
import { decodeProject, encodeProject, projectSettings, PROJECT_VERSION } from '../src/storage/project';
import { DEFAULTS } from '../src/settings';
import { parsePath } from '../src/shape/svgPath';
import { loadOps } from '../src/shape/ops';
import type { Mat } from '../src/shape/path';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
// Colors no thread palette of a format has, one with its brand and catalog number.
const threads = [
  { r: 211, g: 41, b: 53, name: 'Ruby', brand: 'Madeira Polyneon', catalog: '1147' },
  { r: 31, g: 91, b: 181 },
];

/** A filled rectangle with a border of its own, a second fill and a line: as from an SVG. */
function design() {
  const shapes: ShapeInput[] = [
    { color: 0, kind: 'fill', form: parsePath('M2 2 H40 V30 H2 Z', ID), element: 0 },
    { color: 1, kind: 'stroke', width: 0.5, form: parsePath('M2 2 H40 V30 H2 Z', ID), element: 0 },
    { color: 1, kind: 'fill', form: parsePath('M50 2 H60 V12 H50 Z', ID), element: 1 },
    { color: 0, kind: 'stroke', width: 0.5, form: parsePath('M2 40 L60 45', ID), element: 2 },
  ];
  return digitizeShapes(shapes, threads, options, { w: 60, h: 45 }, false);
}

beforeAll(loadOps);

describe('designs made in the app', () => {
  it('keep their thread colors exactly, with brand and catalog number', () => {
    const d = design();
    const { data, pattern } = digitizedFile(d, 'leaf', options.trimMm);
    expect(isRecords(data)).toBe(true);
    expect(pattern.name).toBe('leaf');
    expect(pattern.format).toBe('pes');
    for (const t of threads) expect(pattern.colors).toContainEqual(t);
    // As a PES file the colors would be rounded to the Brother palette.
    expect(parsePattern(writePattern(d.pattern, 'pes'), 'leaf.pes').colors).not.toContainEqual(threads[0]);
  });

  it('read back from their file are the same design, objects and all', () => {
    const { data, pattern } = digitizedFile(design(), 'leaf', options.trimMm);
    const again = parsePattern(data, 'leaf.pes');
    expect(Array.from(again.x)).toEqual(Array.from(pattern.x));
    expect(Array.from(again.y)).toEqual(Array.from(pattern.y));
    expect(Array.from(again.cmd)).toEqual(Array.from(pattern.cmd));
    expect(again.colors).toEqual(pattern.colors);
    expect(again.bounds).toEqual(pattern.bounds);
    restoreRemembered(again, rememberedIn(pattern));
    const objs = sewObjects(pattern);
    expect(objs.length).toBe(4);
    expect(objs.every((o) => remembered(pattern, o))).toBe(true);
    expect(sewObjects(again).map((o) => remembered(again, o)?.geo)).toEqual(objs.map((o) => remembered(pattern, o)?.geo));
  });

  it('go into a project and come out of it unchanged', async () => {
    const { data, pattern } = digitizedFile(design(), 'leaf', options.trimMm);
    const bytes = await encodeProject({ files: [{ name: 'leaf.pes', data, acks: [], objects: rememberedIn(pattern), own: true }], active: 0, image: null, settings: projectSettings(DEFAULTS) });
    const back = (await decodeProject(bytes)).files[0];
    expect(PROJECT_VERSION).toBe(4);
    const q = parsePattern(back.data, back.name);
    expect(q.colors).toEqual(pattern.colors);
    expect(Array.from(q.cmd)).toEqual(Array.from(pattern.cmd));
  });
});

describe('heatstitch records', () => {
  it('keep every record, the end and the hoop', () => {
    const p = { ...design().pattern, hoop: { w: 100, h: 100 } };
    const cmd = new Uint8Array([...p.cmd, END]);
    const q = parseRecords(encodeRecords({ ...p, cmd, x: new Int32Array([...p.x, 0]), y: new Int32Array([...p.y, 0]) }), 'x');
    expect(Array.from(q.cmd)).toEqual(Array.from(cmd));
    expect(q.hoop).toEqual({ w: 100, h: 100 });
  });

  it('refuse damaged bytes instead of reading half a design', () => {
    const bytes = encodeRecords(design().pattern);
    expect(() => parseRecords(bytes.subarray(0, bytes.length - 3), 'x')).toThrow();
    const bad = bytes.slice();
    bad[bad.length - 1] = 9;
    expect(() => parseRecords(bad, 'x')).toThrow();
  });
});
