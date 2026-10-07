import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { backToVersion, keepVersion, rememberObjects, sewObjects, type ObjectKind, type SewObject } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { analyze, isGuessed, remember, remembered, rememberedIn, restitch, restoreRemembered, type RestitchResult, DECO_PATTERNS, OPEN_PATTERNS, type FillPattern, type FillSettings, type SatinSettings, type Settings } from '../src/model/restitch';
import { reverseObjects } from '../src/model/reverse';
import { transformSewObject } from '../src/model/reshape';
import { duplicateObject, mirrorMatrix } from '../src/model/shapeOps';
import { fromStored, toStored } from '../src/storage/fileStore';
import { writePattern } from '../src/writers';
import { decodeProject, encodeProject, projectSettings } from '../src/storage/project';
import { DEFAULTS } from '../src/settings';
import { stitchKinds } from '../src/model/sequence';
import type { Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { parsePattern } from '../src/parsers';
import { readFileSync } from 'node:fs';

/**
 * Objects made here know what they are. Whatever their stitches look like after a change (an E
 * stitch reads as running stitch, an open pattern does not close into an area, a spiral winds like
 * a line), changing their stitch type and changing it back must give the same object again: the
 * same kind, the same area, the same satin rails. Nothing may be guessed again from the stitches.
 */

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const T = options.trimMm;
const RED = { r: 200, g: 30, b: 30 };
const empty = { name: 'rt', format: 'dst', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } as unknown as Pattern;

const FILL: FillSettings = { pattern: 'tatami', spacing: 0.4, spacingEnd: 1, offset: 0.25, angle: 30, stitch: 4, underlay: true, edge: 0, tolerance: 0.15 };
const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: true, underlay: true, tolerance: 0.15 };
const FRINGED: SatinSettings = { ...SATIN, fringe: 1.5, fringeSide: 'right' };

interface At {
  p: Pattern;
  o: number;
}

/** The one object of the design. */
const only = (p: Pattern): SewObject => {
  const objs = sewObjects(p, stitchKinds(p));
  expect(objs, 'still one object').toHaveLength(1);
  return objs[0];
};

/** Takes the new stitches as the app does (applyRestitched): the object keeps what it is made of. */
function take(r: RestitchResult): At {
  expect(r.failed, 'sewn').toEqual([]);
  expect(r.starts, 'sewn').toHaveLength(1);
  rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
  const q = r.pattern;
  const now = sewObjects(q, stitchKinds(q));
  let n = 0;
  let o = -1;
  for (let i = 0; i < q.cmd.length && o < 0; i++) if (q.cmd[i] === STITCH && ++n === r.starts[0] + 1) o = now.findIndex((y) => y.first <= i && y.last >= i);
  remember(q, now[o], r.memory[0]);
  return { p: q, o };
}

/** Sews the object anew with `s` as the stitch panel does; `from` changes its kind. */
function sew(x: At, s: Settings, from?: ObjectKind): At {
  const kinds = stitchKinds(x.p);
  return take(restitch(x.p, sewObjects(x.p, kinds), [x.o], s, kinds, T, from));
}

/** Sewn from the other end. */
function turn(x: At): At {
  const kinds = stitchKinds(x.p);
  return take(reverseObjects(x.p, sewObjects(x.p, kinds), [x.o], kinds, T));
}

/** Mirrored left to right, as the app's mirror button does. */
function mirror(x: At): At {
  const kinds = stitchKinds(x.p);
  const objs = sewObjects(x.p, kinds);
  const o = objs[x.o];
  const m = mirrorMatrix('x', { minX: o.minX / 10, minY: o.minY / 10, maxX: o.maxX / 10, maxY: o.maxY / 10 });
  const r = transformSewObject(x.p, objs, o, kinds, m, T);
  expect(r, 'mirrored').toBeTruthy();
  return { p: r!.pattern, o: x.o };
}

/** Saved with the project and opened on a fresh page (only what the project file keeps). */
async function saveAndOpen(x: At): Promise<At> {
  const data = writePattern(x.p, 'dst');
  const bytes = await encodeProject({
    files: [{ name: 'rt.dst', data, working: toStored(x.p), acks: [], objects: rememberedIn(x.p, sewObjects(x.p)) }],
    active: 0,
    image: null,
    settings: projectSettings(structuredClone(DEFAULTS)),
  });
  const back = await decodeProject(bytes);
  const p = fromStored(parsePattern(data, 'rt.dst'), back.files[0].working);
  expect(p, 'opens').toBeTruthy();
  restoreRemembered(p!, back.files[0].objects);
  return { p: p!, o: x.o };
}

/** What the object is, as far as the next edit goes: its kind, area and rails. */
function what(x: At) {
  const o = sewObjects(x.p, stitchKinds(x.p))[x.o];
  const r = remembered(x.p, o);
  expect(r, 'remembers what it is').toBeTruthy();
  expect(isGuessed(x.p, o), 'not guessed').toBe(false);
  return {
    kind: o.kind,
    area: r!.region ? Math.round(r!.region.areaMm2 * 10) / 10 : null,
    columns: r!.columns ? JSON.stringify(r!.columns.map((c) => c.map((k) => [k.left.length, k.right.length, k.rungs?.length ?? 0]))) : null,
    // The parts it was sewn in, taken as they are (not told apart again by how the stitches look).
    parts: r!.parts && analyze(x.p, o, stitchKinds(x.p)).parts.map((pt) => pt.kind + (pt.border ? '+border' : '')).join(' '),
  };
}

function fillObject(round: boolean): At {
  const form = parsePath(round ? ellipsePath(20, 20, 9, 6) : rectPath(10, 10, 18, 12, 0, 0), ID);
  const a = addShape(empty, { form, kind: 'fill' }, RED, null, options);
  expect(a).toBeTruthy();
  const x = { p: a!.pattern, o: 0 };
  only(x.p);
  return sew(x, { kind: 'fill', s: FILL });
}

function satinObject(): At {
  const a = addShape(empty, { form: parsePath('M10 10 C20 0 30 25 45 12', ID), kind: 'stroke', width: 3 }, RED, null, options);
  expect(a).toBeTruthy();
  return { p: a!.pattern, o: 0 };
}

const PATTERNS: FillPattern[] = ['gradient', 'contour', 'spiral', ...DECO_PATTERNS, ...OPEN_PATTERNS];

describe('own objects keep what they are through a change and back', () => {
  for (const round of [false, true]) {
    for (const pattern of PATTERNS) {
      it(`${round ? 'oval' : 'square'} fill: tatami, ${pattern}, tatami`, () => {
        const a = fillObject(round);
        const before = what(a);
        const b = sew(a, { kind: 'fill', s: { ...FILL, pattern } });
        expect(what(b).kind, `kind as ${pattern}`).toBe('fill');
        expect(what(b).area, `area as ${pattern}`).toBe(before.area);
        expect(what(sew(b, { kind: 'fill', s: FILL }))).toEqual(before);
      });
    }

    it(`${round ? 'oval' : 'square'} fill: mirrored twice, saved and opened`, async () => {
      const a = fillObject(round);
      const twice = mirror(mirror(a));
      // Mirrored, the area comes from its curves (the sewn one from the rows); either way a fill.
      const before = what(twice);
      expect({ ...before, area: null }).toEqual({ ...what(a), area: null });
      expect(what(await saveAndOpen(twice))).toEqual(before);
      // The first version keeps what it knew (it once took what the mirrored copy learned).
      expect(what(a).area).toBe(what(fillObject(round)).area);
    });

    it(`${round ? 'oval' : 'square'} fill: turned twice`, () => {
      const a = fillObject(round);
      expect(what(turn(turn(a)))).toEqual(what(a));
    });
  }

  it('curved rows with a gradient keep it through undo, duplicate, mirror and save', async () => {
    const a = fillObject(false);
    keepVersion(a.p);
    // Rows bowed like a bowl along a guide line, 0.35 mm apart at the top to 1 mm at the bottom.
    const bowl = Array.from({ length: 11 }, (_, i): [number, number] => {
      const t = Math.PI * (0.15 + (0.7 * i) / 10);
      return [19 - 10 * Math.cos(t), 8 + 12 * Math.sin(t)];
    });
    const S: FillSettings = { ...FILL, pattern: 'guided', guides: [bowl], spacing: 0.35, spacingEnd: 1, gradient: true };
    const fillOf = (x: At) => remembered(x.p, sewObjects(x.p, stitchKinds(x.p))[x.o])!.fill!;
    const b = sew(a, { kind: 'fill', s: S });
    const kept = (x: At, why: string) => expect({ ...fillOf(x), guides: undefined, angle: undefined }, why).toMatchObject({ pattern: 'guided', spacing: 0.35, spacingEnd: 1, gradient: true });
    kept(b, 'sewn');
    // Fewer rows than at 0.35 mm throughout: the gradient was sewn.
    const even = sew(a, { kind: 'fill', s: { ...S, gradient: undefined } });
    expect(b.p.cmd.length).toBeLessThan(even.p.cmd.length * 0.85);
    keepVersion(b.p);
    // Undo and redo.
    backToVersion(a.p);
    expect(fillOf(a).pattern).toBe('tatami');
    backToVersion(b.p);
    kept(b, 'redone');
    kept(mirror(mirror(b)), 'mirrored twice');
    const d = duplicateObject(b.p, b.o, T)!;
    expect(d, 'duplicated').toBeTruthy();
    kept({ p: d.pattern, o: d.index }, 'copy');
    kept(await saveAndOpen(b), 'saved and opened');
    // Switched off, it stays off through saving.
    const off = await saveAndOpen(sew(b, { kind: 'fill', s: { ...S, gradient: undefined } }));
    expect(fillOf(off).gradient).toBeUndefined();
  });

  it('satin line: E stitch and back', () => {
    const a = sew(satinObject(), { kind: 'satin', s: SATIN });
    const b = sew(a, { kind: 'satin', s: { ...SATIN, type: 'e', spacing: 2.5 } });
    expect(what(b)).toEqual(what(a));
    expect(what(sew(b, { kind: 'satin', s: SATIN }))).toEqual(what(a));
  });

  it('satin line: wide spacing and back', () => {
    const a = sew(satinObject(), { kind: 'satin', s: SATIN });
    const b = sew(a, { kind: 'satin', s: { ...SATIN, spacing: 1.5, underlay: false } });
    expect(what(b)).toEqual(what(a));
    expect(what(sew(b, { kind: 'satin', s: SATIN }))).toEqual(what(a));
  });

  it('small spiral stays a fill', async () => {
    const a = addShape(empty, { form: parsePath(ellipsePath(10, 10, 1.4, 1.4), ID), kind: 'fill' }, RED, null, options);
    const x = sew({ p: a!.pattern, o: 0 }, { kind: 'fill', s: { ...FILL, pattern: 'spiral' } });
    expect(what(x).kind).toBe('fill');
    expect(what(await saveAndOpen(x)).kind).toBe('fill');
  });

  it('running line: triple and back', () => {
    const a = addShape(empty, { form: parsePath('M10 10 C20 0 30 25 45 12', ID), kind: 'stroke', width: 0 }, RED, null, options);
    const x = { p: a!.pattern, o: 0 };
    const b = sew(x, { kind: 'run', s: { stitch: 2.5, triple: true, tolerance: 0.15 } });
    expect(what(b).kind).toBe('run');
    expect(what(sew(b, { kind: 'run', s: { stitch: 2.5, triple: false, tolerance: 0.15 } })).kind).toBe('run');
  });

  it('satin line: turned twice', () => {
    const a = sew(satinObject(), { kind: 'satin', s: SATIN });
    expect(what(turn(turn(a)))).toEqual(what(a));
  });

  it('satin line: E stitch, turned twice', () => {
    const a = sew(satinObject(), { kind: 'satin', s: { ...SATIN, type: 'e', spacing: 2.5 } });
    expect(what(turn(turn(a)))).toEqual(what(a));
  });

  // Satin columns read once from a file, then sewn here: from then on they are known.
  const letters = parsePattern(readFileSync(new URL('../public/examples/demos/letters.pes', import.meta.url)), 'letters.pes');
  const satins = sewObjects(letters, stitchKinds(letters))
    .filter((o) => o.kind === 'satin')
    .slice(0, 4)
    .map((o) => o.index);
  const column = (o: number): At => {
    return sew({ p: letters, o }, { kind: 'satin', s: SATIN });
  };
  for (const o of satins) {
    it(`satin column ${o}: E stitch and back`, () => {
      const a = column(o);
      const b = sew(a, { kind: 'satin', s: { ...SATIN, type: 'e', spacing: 2.5 } });
      expect(what(b)).toEqual(what(a));
      expect(what(sew(b, { kind: 'satin', s: SATIN }))).toEqual(what(a));
    });
    it(`satin column ${o}: wide spacing and back`, () => {
      const a = column(o);
      const b = sew(a, { kind: 'satin', s: { ...SATIN, spacing: 1.5, underlay: false } });
      expect(what(b)).toEqual(what(a));
      expect(what(sew(b, { kind: 'satin', s: SATIN }))).toEqual(what(a));
    });
    it(`satin column ${o}: E stitch, mirrored twice, saved and opened`, async () => {
      const a = sew(column(o), { kind: 'satin', s: { ...SATIN, type: 'e', spacing: 2.5 } });
      expect(what(await saveAndOpen(mirror(mirror(a))))).toEqual(what(a));
    });
    it(`satin column ${o}: fringe, mirrored twice, saved and opened`, async () => {
      const a = sew(column(o), { kind: 'satin', s: FRINGED });
      const ys = (x: At) => {
        const k = sewObjects(x.p, stitchKinds(x.p))[x.o];
        return Array.from(x.p.y.subarray(k.first, k.last + 1)).join();
      };
      expect(ys(a), 'frayed').not.toBe(ys(column(o)));
      // Opened again: the very same stitches, and sewn anew the very same fringe.
      const opened = await saveAndOpen(a);
      expect(ys(opened)).toBe(ys(a));
      expect(ys(sew(opened, { kind: 'satin', s: FRINGED }))).toBe(ys(a));
      const b = await saveAndOpen(mirror(mirror(a)));
      expect(what(b)).toEqual(what(a));
      expect(remembered(b.p, sewObjects(b.p, stitchKinds(b.p))[b.o])?.satin).toMatchObject({ fringe: 1.5, fringeSide: 'right' });
      expect(what(sew(a, { kind: 'satin', s: SATIN }))).toEqual(what(column(o)));
    });
    it(`satin column ${o}: turned twice`, () => {
      const a = column(o);
      expect(what(turn(turn(a)))).toEqual(what(a));
    });
    it(`satin column ${o}: fill and back`, () => {
      const a = column(o);
      const b = sew(a, { kind: 'fill', s: FILL }, 'satin');
      expect(what(b).kind).toBe('fill');
      expect(what(sew(b, { kind: 'satin', s: SATIN }, 'fill'))).toEqual(what(a));
    });
  }
});
