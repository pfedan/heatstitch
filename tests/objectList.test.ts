import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addFont, type Font } from '../src/lettering/font';
import { LETTERING_DEFAULTS, type Lettering } from '../src/lettering/layout';
import { letteringObjects, placeLettering, splitLettering } from '../src/lettering/place';
import { sewLettering } from '../src/lettering/sew';
import { addShape } from '../src/model/addShape';
import { moveRecords } from '../src/model/edit';
import { keepObjects } from '../src/model/handEdit';
import { setTrims } from '../src/model/jumps';
import { sewObjects, tableOf } from '../src/model/objects';
import { reorder } from '../src/model/order';
import { STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { remember, remembered, rememberedIn, restitch, restoreRemembered, isStoredObjects } from '../src/model/restitch';
import { rememberObjects } from '../src/model/objects';
import { lineSettings, resewLine } from '../src/model/line';
import { reverseObjects } from '../src/model/reverse';
import { stitchKinds } from '../src/model/sequence';
import { transitions } from '../src/model/sequence';
import { duplicateObject } from '../src/model/shapeOps';
import { parsePattern } from '../src/parsers';
import { rectPath, ellipsePath, parsePath } from '../src/shape/svgPath';
import type { Mat } from '../src/shape/path';
import { fromStored, toStored } from '../src/storage/fileStore';
import { decodeProject, encodeProject, projectSettings, PROJECT_VERSION } from '../src/storage/project';
import { DEFAULTS } from '../src/settings';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { writePattern } from '../src/writers';

/**
 * The object list of a design version (B of the object model): fixed ids, what each object knows
 * kept with it, stored as format 2, and objects that stay what they are when what lies between
 * them changes.
 */

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const RED = { r: 200, g: 30, b: 30 };
const empty = { name: 'ol', format: 'pes', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } as unknown as Pattern;

/** Two fills of one thread made here, a little apart (a trim between them). */
function twoFills(): Pattern {
  const a = addShape(empty, { form: parsePath(rectPath(10, 10, 12, 10, 0, 0), ID), kind: 'fill' }, RED, null, options)!.pattern;
  return addShape(a, { form: parsePath(ellipsePath(32, 15, 5, 5), ID), kind: 'fill' }, RED, 0, options)!.pattern;
}

const ids = (p: Pattern) => sewObjects(p).map((o) => o.id);
const trims = (p: Pattern) => p.cmd.reduce((n, c) => n + (c === TRIM ? 1 : 0), 0);

describe('object list', () => {
  it('keeps two objects two when the trim between them is taken out', () => {
    const p = twoFills();
    const before = sewObjects(p);
    expect(before).toHaveLength(2);
    const q = setTrims(p, transitions(p), false);
    expect(trims(q)).toBeLessThan(trims(p));
    expect(ids(q)).toEqual(ids(p));
    for (const [k, o] of sewObjects(q).entries()) expect(remembered(q, o)?.form).toEqual(remembered(p, before[k])?.form);
    // And cut again: still the same two.
    const r = setTrims(q, transitions(q), true);
    expect(ids(r)).toEqual(ids(p));
  });

  it('gives each object an id it keeps when the order changes, and a copy an id of its own', () => {
    const p = twoFills();
    const [a, b] = ids(p);
    expect(a).not.toBe(b);
    const q = reorder(p, sewObjects(p), [1, 0], options.trimMm);
    expect(ids(q)).toEqual([b, a]);
    const d = duplicateObject(p, 0, options.trimMm)!;
    const all = ids(d.pattern);
    expect(new Set(all).size).toBe(3);
    expect(all).toContain(a);
    expect(all).toContain(b);
    const copy = sewObjects(d.pattern)[d.index];
    expect(copy.id).not.toBe(a);
    expect(remembered(d.pattern, copy)?.fill).toEqual(remembered(p, sewObjects(p)[0])?.fill);
  });

  it('keeps the id of an object sewn anew, as a fill, as a line and the other way round', () => {
    const p = twoFills();
    const objs = sewObjects(p, stitchKinds(p));
    const r = restitch(p, objs, [1], { kind: 'fill', s: { ...remembered(p, objs[1])!.fill!, spacing: 0.6 } }, stitchKinds(p), options.trimMm);
    // As the app takes new stitches (applyRestitched).
    rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
    remember(r.pattern, sewObjects(r.pattern)[1], r.memory[0]);
    expect(ids(r.pattern)).toEqual(ids(p));
    const t = reverseObjects(p, objs, [0], stitchKinds(p), options.trimMm);
    rememberObjects(t.pattern, [t.starts[0]], t.ends[0]);
    remember(t.pattern, sewObjects(t.pattern)[0], t.memory[0]);
    expect(ids(t.pattern)).toEqual(ids(p));
    const line = addShape(p, { form: parsePath('M50 10 C60 0 70 25 85 12', ID), kind: 'stroke', width: 3 }, RED, null, options)!.pattern;
    const lo = sewObjects(line).length - 1;
    const lobj = sewObjects(line)[lo];
    const again = resewLine(line, lo, remembered(line, lobj)!.path!, { ...lineSettings(line, lobj, stitchKinds(line)), width: 4 }, options.trimMm)!;
    expect(ids(again.pattern)).toEqual(ids(line));
  });

  it('keeps what a version knows, whatever a later version with the same stitches learns', () => {
    const p = twoFills();
    const o = sewObjects(p)[0];
    const q = reorder(p, sewObjects(p), [1, 0], options.trimMm);
    const back = reorder(q, sewObjects(q), [1, 0], options.trimMm);
    // The same stitches as `p` again: what `back` learns stays with `back`.
    const bo = sewObjects(back)[0];
    expect(bo.id).toBe(o.id);
    tableOf(back).entries[0].memory = { ...remembered(back, bo)!, knockout: true };
    expect(remembered(p, o)?.knockout).toBeUndefined();
  });

  it('stores the list as format 2 and reads it back on the stitches of the file', async () => {
    const p = twoFills();
    const stored = rememberedIn(p);
    expect(isStoredObjects(stored)).toBe(true);
    expect(stored.objects.map((e) => e.id)).toEqual(ids(p));
    const data = writePattern(p, 'pes');
    const bytes = await encodeProject({ files: [{ name: 'two.pes', data, working: toStored(p), acks: [], objects: stored }], active: 0, image: null, settings: projectSettings(DEFAULTS) });
    const back = await decodeProject(bytes);
    const q = fromStored(parsePattern(data, 'two.pes'), back.files[0].working)!;
    restoreRemembered(q, back.files[0].objects);
    expect(ids(q)).toEqual(ids(p));
    expect(sewObjects(q).map((o) => remembered(q, o)?.fill?.pattern)).toEqual(sewObjects(p).map((o) => remembered(p, o)?.fill?.pattern));
    expect(PROJECT_VERSION).toBe(2);
  });

  it('converts a project of version 1 when it is opened, and saves it as version 2', async () => {
    const file = (await decodeProject(new Uint8Array(readFileSync(new URL('./fixtures/wild-stitches.heatstitch', import.meta.url))))).files[0];
    expect(Array.isArray(file.objects)).toBe(true);
    const p = fromStored(parsePattern(file.data, file.name), file.working)!;
    restoreRemembered(p, file.objects);
    const objs = sewObjects(p);
    const known = objs.filter((o) => remembered(p, o));
    expect(known.length).toBeGreaterThan(0);
    const stored = rememberedIn(p);
    expect(isStoredObjects(stored)).toBe(true);
    // Opened again from version 2: the same objects, knowing the same.
    const again = fromStored(parsePattern(file.data, file.name), file.working)!;
    restoreRemembered(again, structuredClone(stored));
    expect(sewObjects(again).map((o) => [o.first, o.last, o.id])).toEqual(objs.map((o) => [o.first, o.last, o.id]));
    expect(sewObjects(again).map((o) => !!remembered(again, o)?.fill)).toEqual(objs.map((o) => !!remembered(p, o)?.fill));
  });

  it('looses an object from its shape when its stitches are changed by hand', () => {
    const p = twoFills();
    const o = sewObjects(p)[0];
    expect(remembered(p, o)?.free).toBeUndefined();
    let i = o.first + 5;
    while (p.cmd[i] !== STITCH) i++;
    const next = moveRecords(p, [i], 5, 5);
    const moved = keepObjects(p, next, { moved: [i] });
    const now = sewObjects(next)[moved.get(0)!];
    expect(now.id).toBe(o.id);
    expect(remembered(next, now)).toMatchObject({ free: true, hand: 1 });
    // The shape rests with it, for the way back.
    expect(remembered(next, now)?.form).toEqual(remembered(p, o)?.form);
    // The version before is as it was (undo).
    expect(remembered(p, o)?.free).toBeUndefined();
  });
});

describe('splitting a lettering', () => {
  const font = (id: string): Font => {
    const f = JSON.parse(new TextDecoder().decode(readFileSync(new URL(`../public/fonts/${id}.json`, import.meta.url)))) as Font;
    addFont(f);
    return f;
  };
  const l: Lettering = { ...LETTERING_DEFAULTS, id: 'L1', text: 'Tom', font: 'barstitch_regular', x: 0, y: 0, color: RED };

  it('makes each letter an object of its own in a new version, and the version before keeps the lettering', () => {
    const f = font(l.font);
    const placed = placeLettering(null, [], sewLettering(f, l, options.trimMm), l)!;
    const p = placed.pattern;
    expect(placed.objects).toHaveLength(1);
    const id = placed.objects[0].id;
    const r = splitLettering(p, sewObjects(p), l, sewLettering(f, l, options.trimMm))!;
    expect(r.objects).toHaveLength(3);
    expect(r.objects[0].id).toBe(id);
    expect(new Set(r.objects.map((o) => o.id)).size).toBe(3);
    expect(letteringObjects(r.pattern, sewObjects(r.pattern), l.id)).toHaveLength(0);
    // Same stitches, nothing lost.
    expect(Array.from(r.pattern.x)).toEqual(Array.from(p.x));
    // Undo is the version before: still one lettering.
    expect(letteringObjects(p, sewObjects(p), l.id)).toHaveLength(1);
  });

  it('cuts where the thread is trimmed when the stitches no longer match the lettering', () => {
    const f = font(l.font);
    const placed = placeLettering(null, [], sewLettering(f, { ...l, text: 'T o' }, options.trimMm), { ...l, text: 'T o' })!;
    const r = splitLettering(placed.pattern, sewObjects(placed.pattern), { ...l, text: 'T o' }, null)!;
    expect(r.objects.length).toBeGreaterThanOrEqual(2);
  });
});
