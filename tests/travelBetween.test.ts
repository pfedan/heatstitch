import { describe, expect, it } from 'vitest';
import { addLine, addShape } from '../src/model/addShape';
import { lineStitchFor } from '../src/model/line';
import type { PathStitch } from '../src/model/along';
import { sewObjects } from '../src/model/objects';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from '../src/model/pattern';
import { remembered, type FillSettings } from '../src/model/restitch';
import { deleteObjects, duplicateObjects, mirrorMatrix } from '../src/model/shapeOps';
import { setKnockout } from '../src/model/knockout';
import { transitions } from '../src/model/sequence';
import { cutJoins, freeJoins, joinedObjects, withHiddenJoins } from '../src/model/travel';
import { translation } from '../src/shape/path';
import { parsePath, rectPath } from '../src/shape/svgPath';
import { digitize, digitizeDefaults } from '../src/digitize/digitize';
import { DEFAULT_PREPARE, Preparer } from '../src/image/prepare';
import { digitizedFile } from '../src/model/digitized';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { BLUE, RED, raster } from './helpers/images';
import { boxOf, checkTravel, Doc, empty, ID, options, restitchFill, saveAndOpen, shapes, T, transform } from './helpers/torture';

const red: ThreadColor = { r: 200, g: 30, b: 30 };
const blue: ThreadColor = { r: 30, g: 60, b: 200 };
const green: ThreadColor = { r: 30, g: 160, b: 60 };
const rect = (x: number, y: number, w: number, h: number) => parsePath(rectPath(x, y, w, h, 0, 0), ID);

/** Two red squares 32 mm apart, then a blue band sewn after them across both and the gap between. */
function design(): Doc {
  const d = new Doc();
  shapes(d, addShape(empty, { form: rect(-30, -8, 14, 16), kind: 'fill' }, red, null, options)!.pattern);
  shapes(d, addShape(d.cur.p, { form: rect(16, -8, 14, 16), kind: 'fill' }, red, 0, options)!.pattern);
  shapes(d, addShape(d.cur.p, { form: rect(-34, -10, 68, 20), kind: 'fill' }, blue, null, options)!.pattern);
  return d;
}

/** How the thread goes from object k - 1 to object k: hidden travel, a trim, or a jump. */
function join(p: Pattern, k: number): 'travel' | 'trim' | 'jump' {
  const objs = sewObjects(p);
  const [a, b] = [objs[k - 1], objs[k]];
  if (remembered(p, b)?.travel) return 'travel';
  for (let i = a.last + 1; i < b.first; i++) if (p.cmd[i] === TRIM || p.cmd[i] === COLOR_CHANGE) return 'trim';
  return 'jump';
}

const fillOf = (d: Doc, k: number) => remembered(d.cur.p, d.objects[k])!.fill!;
const refill = (d: Doc, k: number, change: Partial<FillSettings>) => restitchFill(d, k, { ...fillOf(d, k), ...change }, new Set());

describe('hidden travel between objects', () => {
  it('runs under a dense fill sewn later instead of a trim', () => {
    const d = design();
    const p = d.cur.p;
    expect(join(p, 1)).toBe('travel');
    checkTravel(p);
    // A running stitch of travel length, nothing else between the squares.
    const b = d.objects[1];
    const n = remembered(p, b)!.travel!;
    for (let i = b.first; i < b.first + n; i++) expect(p.cmd[i]).toBe(STITCH);
    for (let i = d.objects[0].last + 1; i < b.first; i++) expect(p.cmd[i]).not.toBe(JUMP);
  });

  it('trims where what is sewn later would let the thread show', () => {
    // Open patterns show the fabric between their lines, a light fill between its rows.
    for (const change of [{ pattern: 'crosshatch' }, { pattern: 'meander' }, { pattern: 'motifs' }, { pattern: 'grid' }, { spacing: 1 }] as Partial<FillSettings>[]) {
      const d = design();
      expect(refill(d, 2, change)).toBe(true);
      expect(join(d.cur.p, 1), JSON.stringify(change)).toBe('trim');
      checkTravel(d.cur.p);
      // Dense again: the travel comes back.
      expect(refill(d, 2, { pattern: 'tatami', spacing: 0.4 })).toBe(true);
      expect(join(d.cur.p, 1)).toBe('travel');
    }
  });

  /**
   * The two red squares, then a blue line along their lower edge sewn as `stitch`, `width` mm wide
   * (where their rows end: a fill ends with its last row, at one side of it).
   */
  function underLine(stitch: Partial<PathStitch>, width: number): Doc {
    const d = new Doc();
    shapes(d, addShape(empty, { form: rect(-30, -8, 14, 16), kind: 'fill' }, red, null, options)!.pattern);
    shapes(d, addShape(d.cur.p, { form: rect(16, -8, 14, 16), kind: 'fill' }, red, 0, options)!.pattern);
    const st = { ...lineStitchFor(width, options.tolerance), ...stitch } as PathStitch;
    shapes(d, addLine(d.cur.p, parsePath('M-34 -7 L34 -7', ID), st, blue, null, options)!.pattern);
    return d;
  }

  it('runs under a satin 2 mm wide or wider', () => {
    const d = underLine({ type: 'satin' }, 6);
    expect(join(d.cur.p, 1)).toBe('travel');
    checkTravel(d.cur.p);
  });

  it('trims under a narrow or open satin and under a running line', () => {
    for (const [stitch, width] of [[{ type: 'satin' }, 1.5], [{ type: 'e' }, 6], [{ type: 'satin', spacing: 2 }, 6], [{ type: 'run' }, 6]] as [Partial<PathStitch>, number][]) {
      const d = underLine(stitch, width);
      expect(join(d.cur.p, 1), JSON.stringify(stitch) + width).toBe('trim');
    }
  });

  it('keeps off a part left out under an open fill on top', () => {
    const d = design();
    // A green crosshatch across the band; the band leaves out what it covers.
    shapes(d, addShape(d.cur.p, { form: rect(-4, -14, 8, 28), kind: 'fill' }, green, null, options)!.pattern);
    expect(refill(d, 3, { pattern: 'crosshatch' })).toBe(true);
    const k = setKnockout(d.cur.p, [2], true, T);
    expect(k).toBeTruthy();
    shapes(d, k!.pattern);
    expect(remembered(d.cur.p, d.objects[2])?.knockout).toBe(true);
    expect(join(d.cur.p, 1)).toBe('trim');
    checkTravel(d.cur.p);
    // A dense fill on top hides the way where the band leaves it out.
    expect(refill(d, 3, { pattern: 'tatami', spacing: 0.4 })).toBe(true);
    expect(join(d.cur.p, 1)).toBe('travel');
    checkTravel(d.cur.p);
  });

  it('follows the fill that hides it: moved away, deleted, undone', () => {
    const d = design();
    const hidden = d.cur;
    expect(transform(d, [2], translation(0, 40))).toBe(true);
    expect(join(d.cur.p, 1)).toBe('trim');
    checkTravel(d.cur.p);
    d.cur = hidden;
    expect(shapes(d, deleteObjects(d.cur.p, [2], T))).toBe(true);
    expect(join(d.cur.p, 1)).toBe('trim');
    // Undo brings back the travel with its stitches, all of it.
    d.cur = hidden;
    expect(join(d.cur.p, 1)).toBe('travel');
    checkTravel(d.cur.p);
  });

  it('holds through mirror, duplicate and save and open', async () => {
    const d = design();
    const all = () => d.objects.map((o) => o.index);
    expect(transform(d, all(), mirrorMatrix('x', boxOf(d, all())))).toBe(true);
    expect(join(d.cur.p, 1)).toBe('travel');
    checkTravel(d.cur.p);
    const mirrored = d.cur;
    // Copies go right after their originals: the squares are no longer neighbours.
    expect(shapes(d, duplicateObjects(d.cur.p, [0, 1, 2], T, 50)?.pattern)).toBe(true);
    checkTravel(d.cur.p);
    d.cur = mirrored;
    const travel = d.objects.map((o) => remembered(d.cur.p, o)?.travel ?? 0);
    const x = Array.from(d.cur.p.x);
    await saveAndOpen(d);
    expect(Array.from(d.cur.p.x)).toEqual(x);
    expect(d.objects.map((o) => remembered(d.cur.p, o)?.travel ?? 0)).toEqual(travel);
    checkTravel(d.cur.p);
  });

  it('runs under the squares of the other color in a checkerboard picture', () => {
    // Each square of one color is cut off from the next by squares of the other, sewn after it: the
    // way there bends from square to square, a straight line would mostly cross a corner.
    const img = raster(600, 400, (x, y) => ((Math.floor(x / 75) + Math.floor(y / 80)) % 2 ? RED : BLUE));
    const prep = new Preparer(img).run({ ...DEFAULT_PREPARE, widthMm: 90, maxColors: 4 });
    const o = digitizeDefaults(DEFAULT_PROFILE);
    const { pattern } = digitizedFile(digitize(prep, o, 'board'), 'board', o.trimMm);
    const objs = sewObjects(pattern);
    expect(objs.filter((x) => remembered(pattern, x)?.travel).length).toBeGreaterThanOrEqual(4);
    checkTravel(pattern);
  }, 60000);

  it('is trimmed and tied by hand, stays so, and can be hidden again', async () => {
    const d = design();
    const hidden = d.cur;
    const joins = withHiddenJoins(d.cur.p, transitions(d.cur.p));
    const way = joins.find((t) => t.hidden)!;
    expect(way).toBeTruthy();
    expect(joinedObjects(d.cur.p, [way])).toEqual([1]);
    shapes(d, cutJoins(d.cur.p, [1], T));
    expect(join(d.cur.p, 1)).toBe('trim');
    expect(remembered(d.cur.p, d.objects[1])?.cutIn).toBe(true);
    // Tied off and in around the trim, and listed as trimmed by hand.
    const cut = withHiddenJoins(d.cur.p, transitions(d.cur.p)).find((t) => joinedObjects(d.cur.p, [t])[0] === 1)!;
    expect(cut.trimmed && cut.byHand && cut.tieOff > 0 && cut.tieIn > 0).toBe(true);
    // Whatever changes after: the band sewn denser, moved a little, saved and opened.
    expect(refill(d, 2, { spacing: 0.35 })).toBe(true);
    expect(transform(d, [2], translation(1, 0))).toBe(true);
    await saveAndOpen(d);
    expect(join(d.cur.p, 1)).toBe('trim');
    expect(remembered(d.cur.p, d.objects[1])?.cutIn).toBe(true);
    checkTravel(d.cur.p);
    // Hidden again on request.
    shapes(d, freeJoins(d.cur.p, [1], T, false));
    expect(join(d.cur.p, 1)).toBe('travel');
    expect(remembered(d.cur.p, d.objects[1])?.cutIn).toBeUndefined();
    checkTravel(d.cur.p);
    // Undo goes back to the hidden way with its stitches.
    d.cur = hidden;
    expect(join(d.cur.p, 1)).toBe('travel');
  });

  it('keeps a long jump trimmed by hand from being hidden later', () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: rect(-30, -8, 14, 16), kind: 'fill' }, red, null, options)!.pattern);
    shapes(d, addShape(d.cur.p, { form: rect(16, -8, 14, 16), kind: 'fill' }, red, 0, options)!.pattern);
    expect(join(d.cur.p, 1)).toBe('trim');
    shapes(d, cutJoins(d.cur.p, [1], T));
    // A dense band sewn after both would hide the way: the trim set by hand stays.
    shapes(d, addShape(d.cur.p, { form: rect(-34, -10, 68, 20), kind: 'fill' }, blue, null, options)!.pattern);
    expect(join(d.cur.p, 1)).toBe('trim');
    // Not trimmed any more: carried, then hidden where it can be.
    shapes(d, freeJoins(d.cur.p, [1], T, true));
    expect(join(d.cur.p, 1)).toBe('travel');
  });
});
