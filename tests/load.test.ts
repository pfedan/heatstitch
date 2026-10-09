import { afterAll, describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes, type ShapeInput } from '../src/digitize/digitize';
import { syncBorders } from '../src/model/border';
import { refreshKnockouts, setKnockout, takeOver } from '../src/model/knockout';
import { rememberObjects, sewObjects } from '../src/model/objects';
import type { Pattern, ThreadColor } from '../src/model/pattern';
import { transformSewObject } from '../src/model/reshape';
import { backToVersion, keepVersion, remembered, rememberedIn, rememberShapes, restitch, restoreRemembered, type StoredObjects } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { translation, type Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { fromStored, toStored } from '../src/storage/fileStore';
import { decodeProject, encodeProject, projectSettings } from '../src/storage/project';
import { DEFAULTS } from '../src/settings';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { validatePattern } from '../src/validation/validate';
import { writePattern } from '../src/writers';

/**
 * The load test: a design of 120 objects (100 fills that overlap their neighbours and leave out
 * what lies on top, 20 lines) and the common operations on it, each within a time budget. A change
 * that makes one of them much slower fails CI instead of being found by someone with a big design.
 *
 * Runs only with LOAD set, alone, so other test files do not share the machine and blur the times:
 * `LOAD=1 npx vitest run tests/load.test.ts`. The budgets leave room for a slower CI machine, a
 * few times what a laptop needs; checking and following what is left out stays below what it took
 * before it was made quick (#78). LOAD_FACTOR scales them all for a slower machine (e.g. 2).
 */

const on = !!process.env.LOAD;
const FACTOR = Number(process.env.LOAD_FACTOR ?? 1);

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const T = options.trimMm;
const COLORS: ThreadColor[] = [
  { r: 200, g: 30, b: 30 },
  { r: 30, g: 60, b: 200 },
  { r: 30, g: 160, b: 60 },
  { r: 230, g: 190, b: 40 },
];
const ROWS = 10;
const COLS = 12;

/** A grid of shapes 8 mm apart and up to 10 mm wide, so each fill reaches under its neighbours. */
function grid(): ShapeInput[] {
  const out: ShapeInput[] = [];
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      const k = row * COLS + col;
      const x = col * 8;
      const y = row * 8;
      const color = k % COLORS.length;
      if (k % 6 === 5) out.push({ color, kind: 'stroke', width: 1.5, form: parsePath(`M${x} ${y + 2} L${x + 9} ${y + 7} L${x + 2} ${y + 9}`, ID) });
      else out.push({ color, kind: 'fill', form: parsePath(k % 2 ? rectPath(x, y, 10, 9, 0, 0) : ellipsePath(x + 5, y + 5, 5, 4.5), ID) });
    }
  return out;
}

/** Measured times, printed as a table at the end. */
const times: { what: string; ms: number; budget: number }[] = [];

/** Runs `f`, which must finish within `budget` ms (times LOAD_FACTOR). */
async function within<X>(what: string, budget: number, f: () => X | Promise<X>): Promise<X> {
  const t = performance.now();
  const x = await f();
  const ms = Math.round(performance.now() - t);
  times.push({ what, ms, budget: budget * FACTOR });
  expect(ms, `${what}: ${ms} ms, budget ${budget * FACTOR} ms`).toBeLessThan(budget * FACTOR);
  return x;
}

const knowledge = (p: Pattern): StoredObjects => rememberedIn(p, sewObjects(p));

describe.skipIf(!on)('load test: 120 objects', () => {
  /** The design as it is after each step (each kept as a version, as the app does). */
  let p: Pattern;
  let fills: number[] = [];
  /** The version before any fill left anything out, to undo back to. */
  let whole: Pattern;

  afterAll(() => {
    if (times.length) console.table(times);
  });

  it('builds the design from shapes, as an SVG is taken over', async () => {
    const shapes = grid();
    const d = await within('SVG mit 120 Formen sticken', 6000, () => digitizeShapes(shapes, COLORS, options, { w: 100, h: 90 }, false, 'load'));
    // As addDigitized: through the file format, then the objects remember what they are.
    p = parsePattern(writePattern(d.pattern, 'pes'), 'load.pes');
    rememberObjects(p, d.starts);
    const objs = sewObjects(p);
    rememberShapes(p, objs, d.starts, d.objects.map((o) => o.shape), d.objects);
    keepVersion(p);
    expect(objs.length).toBe(ROWS * COLS);
    expect(objs.every((o) => remembered(p, o))).toBe(true);
    fills = objs.filter((o) => remembered(p, o)?.geo).map((o) => o.index);
    expect(fills.length).toBe(100);
    whole = p;
  });

  it('leaves out what lies on top, for all fills at once', async () => {
    const k = await within('Aussparen für 100 Füllungen an', 20_000, () => setKnockout(p, fills, true, T));
    expect(k?.changed).toBe(fills.length);
    p = k!.pattern;
    keepVersion(p);
  }, 60_000);

  it('finds nothing to sew anew when nothing changed', async () => {
    expect(await within('Aussparungen prüfen, nichts geändert', 1500, () => refreshKnockouts(p, T))).toBeNull();
  });

  it('checks the density', async () => {
    await within('Dichteprüfung', 3000, () => validatePattern(p, DEFAULT_PROFILE));
  });

  it('moves one object; only the fills it lies on are sewn anew', async () => {
    const before = p;
    const next = await within('Objekt verschieben, Aussparungen nachziehen', 2500, () => {
      const kinds = stitchKinds(p);
      const objs = sewObjects(p, kinds);
      const r = transformSewObject(p, objs, objs[fills[50]], kinds, translation(3, 2), T);
      const s = syncBorders(r!.pattern, T);
      keepVersion(s);
      const k = refreshKnockouts(s, T);
      return { pattern: k?.pattern ?? s, changed: k?.changed ?? [] };
    });
    // Its neighbours sewn before it at most: the row above and the one to its left.
    expect(next.changed.length).toBeGreaterThan(0);
    expect(next.changed.length).toBeLessThanOrEqual(6);
    p = next.pattern;
    keepVersion(p);
    expect(p).not.toBe(before);
  });

  it('sews one fill anew with other settings', async () => {
    p = await within('Füllung mit neuem Winkel neu sticken', 3000, () => {
      const kinds = stitchKinds(p);
      const objs = sewObjects(p, kinds);
      const o = fills[30];
      const fill = remembered(p, objs[o])!.fill!;
      const r = restitch(p, objs, [o], { kind: 'fill', s: { ...fill, angle: (fill.angle ?? 0) + 30 } }, kinds, T);
      const q = takeOver(r)!;
      keepVersion(q);
      const k = refreshKnockouts(q, T);
      return k?.pattern ?? q;
    });
    keepVersion(p);
  });

  it('undoes and redoes with what each version knew', async () => {
    const now = p;
    const known = knowledge(now);
    const first = await within('Rückgängig und Wiederholen', 1000, () => {
      backToVersion(whole);
      const back = knowledge(whole);
      backToVersion(now);
      return back;
    });
    expect(first.objects.every((e) => !e.memory?.knockout)).toBe(true);
    expect(knowledge(now)).toEqual(known);
  });

  it('saves the project and opens it again whole', async () => {
    const data = writePattern(p, 'pes');
    const original = parsePattern(data, 'load.pes');
    const known = knowledge(p);
    const bytes = await within('Projekt speichern', 2000, () =>
      encodeProject({ files: [{ name: 'load.pes', data, working: toStored(p), acks: [], objects: known }], active: 0, image: null, settings: projectSettings(structuredClone(DEFAULTS)) }),
    );
    const q = await within('Projekt öffnen', 2000, async () => {
      const back = await decodeProject(bytes);
      const q = fromStored(original, back.files[0].working)!;
      restoreRemembered(q, back.files[0].objects);
      return q;
    });
    expect(knowledge(q)).toEqual(known);
    // Opened again, nothing needs sewing anew.
    expect(refreshKnockouts(q, T)).toBeNull();
  });

  it('opens the stitch file alone and recognizes its objects', async () => {
    const data = writePattern(p, 'pes');
    const objs = await within('PES ohne Projekt öffnen', 1500, () => {
      const q = parsePattern(data, 'load.pes');
      return sewObjects(q, stitchKinds(q));
    });
    expect(objs.length).toBeGreaterThanOrEqual(ROWS * COLS);
  });

  it('saves in every format', async () => {
    for (const f of ['pes', 'dst', 'jef', 'exp', 'vp3', 'pec'] as const) await within(`Als ${f.toUpperCase()} speichern`, 1000, () => writePattern(p, f));
  });
});
