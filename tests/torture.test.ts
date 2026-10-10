import { describe, expect, it } from 'vitest';
import { addShape } from '../src/model/addShape';
import { syncBorders } from '../src/model/border';
import { partOf } from '../src/model/shadow';
import { resewLine } from '../src/model/line';
import { setKnockout } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import { END, STITCH, type Pattern } from '../src/model/pattern';
import { sameColor } from '../src/model/recolor';
import { backToVersion, lockAt, remember, remembered, withShortLocks } from '../src/model/restitch';
import { deleteObjects, duplicateObject, duplicateObjects, mirrorMatrix, recolorObjects, subtractTop } from '../src/model/shapeOps';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { loadOps } from '../src/shape/ops';
import { CHAINS, FIRST_SEED, ID, options, T, COLORS, empty, knowledge, Doc, shapes, transform, boxOf, saveAndOpen, checkWellFormed, checkAllKnown, checkPartsFit, checkBorders, checkObjectList, checkKeys, checkKnockouts, checkCrosshatch, checkExport, checkSewDesign, checkFollowers, checkEchoes, chain, borderedSquare, borderOf, restitchFill, squareOf, type Version } from './helpers/torture';
import { analyze, measureFill } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { writePattern } from '../src/writers';

describe('torture test', () => {
  const seeds = Array.from({ length: CHAINS }, (_, k) => FIRST_SEED + k);
  it.each(seeds)('chain %i keeps the design consistent', async (seed) => {
    await chain(seed);
    // Some chains build large designs (a contour filled as the ground, scaled up, left out under
    // others, a contour around a lettering): slower runners need more than the 30 s default.
  }, 120_000);
});

describe('found by the torture test', () => {
  it('cutting out of a fill takes its border in a thread of its own along', async () => {
    await loadOps();
    const d = borderedSquare();
    // A disc over the square's edge, in the square's thread and in the border's.
    for (const color of [COLORS[0], COLORS[1]]) {
      const p = addShape(d.cur.p, { form: parsePath(ellipsePath(18, 10, 5, 5), ID), kind: 'fill' }, color, null, options)!.pattern;
      const c = subtractTop(p, [0, sewObjects(p).length - 1], T)!;
      expect(c.cut).toEqual([0]);
      checkFollowers(c.pattern);
    }
  });

  it('deleting a border leaves its fill without one, and undo brings both back', () => {
    const d = borderedSquare();
    const before = d.cur;
    expect(borderOf(d)).toBeGreaterThan(0);
    shapes(d, deleteObjects(d.cur.p, [borderOf(d)], T));
    expect(borderOf(d)).toBe(-1);
    expect(d.objects.every((o) => !remembered(d.cur.p, o)?.line)).toBe(true);
    checkBorders(d.cur.p);
    // The square's stitches did not change, yet the version before still knows its border.
    backToVersion(before.p);
    expect(knowledge(before.p)).toEqual(before.known);
    expect(squareOf({ cur: before, objects: sewObjects(before.p) } as unknown as Doc)).toBeTruthy();
  });

  it('deleting a fill takes its border along', () => {
    const d = borderedSquare();
    shapes(d, deleteObjects(d.cur.p, [squareOf(d)!.index], T));
    expect(borderOf(d)).toBe(-1);
    expect(d.objects).toHaveLength(1);
  });

  it('a border neither cuts nor is cut', () => {
    const d = borderedSquare();
    expect(subtractTop(d.cur.p, [0, borderOf(d)], T)).toBeNull();
    checkBorders(d.cur.p);
  });

  it('a short lock differs from the usual one, also where the first stitch is shorter than a lock', () => {
    // Sewn anew, a fill may come out with the very stitches of its copy in place (a fill whose
    // border was taken off): then it is sewn with short locks, which must tell it apart.
    for (const first of [0.35, 0.42, 0.6, 2]) {
      const run: [number, number][] = [[10, 10], [10 + first, 10], [15, 10]];
      for (const atEnd of [false, true]) expect(withShortLocks(() => lockAt(run, atEnd))).not.toEqual(lockAt(run, atEnd));
    }
  });

  it('a copy in place of an echo changed by hand is a line of its own, loosed from its curve', () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath('M5 5 L40 20 L10 40', ID), kind: 'stroke', width: 2 }, COLORS[0], null, options)!.pattern);
    const m = remembered(d.cur.p, d.objects[0])!;
    const echo = { side: 'both' as const, count: 2, gap: 5, colors: [COLORS[1], null], link: 'e1' };
    shapes(d, syncBorders(resewLine(d.cur.p, 0, m.geo!, { ...m.line!, echo }, T)!.pattern, T));
    const part = d.objects.findIndex((o) => partOf(remembered(d.cur.p, o)));
    expect(part).toBeGreaterThan(0);
    // One of its stitches moved 1 mm by hand, as the stitch editor does.
    const q = { ...d.cur.p, x: d.cur.p.x.slice() };
    const o = d.objects[part];
    const i = o.first + Math.floor((o.last - o.first) / 2);
    q.x[i] += 10;
    remember(q, sewObjects(q)[part], { ...remembered(d.cur.p, o)!, hand: 1 });
    d.commit(q);
    checkEchoes(d.cur.p);
    shapes(d, duplicateObjects(d.cur.p, [part], T, 0)?.pattern);
    const copies = d.objects.filter((x) => !partOf(remembered(d.cur.p, x)) && remembered(d.cur.p, x)?.hand);
    expect(copies).toHaveLength(1);
    expect(remembered(d.cur.p, copies[0])?.free).toBe(true);
    checkEchoes(d.cur.p);
    checkKeys(d.cur.p);
  });

  it('recoloring a border gives its fill that border thread', () => {
    const d = borderedSquare();
    shapes(d, recolorObjects(d.cur.p, [borderOf(d)], COLORS[2], T));
    expect(sameColor(squareOf(d)!.color, COLORS[0])).toBe(true);
    expect(sameColor(remembered(d.cur.p, squareOf(d)!)!.line!.color, COLORS[2])).toBe(true);
    checkBorders(d.cur.p);
  });
});

/** All the invariants the chains check, at once. */
const checkAll = (d: Doc) => {
  const p = d.cur.p;
  checkWellFormed(p);
  expect(knowledge(p), 'knowledge as stored with this version').toEqual(d.cur.known);
  checkAllKnown(p);
  checkKeys(p);
  checkObjectList(p);
  checkPartsFit(p);
  checkKnockouts(p);
  checkCrosshatch(p);
  checkExport(p);
  checkSewDesign(p);
};

/** Back to the version before and forward again, as undo and redo do: all or nothing. */
function undoRedo(d: Doc, check: () => void): void {
  const prev = d.undo.pop()!;
  const now = d.cur;
  d.redo.push(now);
  d.cur = prev;
  backToVersion(prev.p);
  checkAll(d);
  const next = d.redo.pop()!;
  d.undo.push(prev);
  d.cur = next;
  backToVersion(next.p);
  checkAll(d);
  check();
}

describe('a crosshatch fill', () => {
  /** What the crosshatch fills are, in their order: pattern, spacing of the layers, angle. */
  const hatches = (d: Doc) =>
    sewObjects(d.cur.p)
      .map((o) => remembered(d.cur.p, o)?.fill)
      .filter((f) => f?.pattern === 'crosshatch')
      .map((f) => `${f!.deco?.size ?? '-'}@${Math.round(f!.angle)}`);

  it('keeps it through duplicate, mirror, knockout, undo, redo, save and open, and is read back from the file', async () => {
    await loadOps();
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 30, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    const fill = remembered(d.cur.p, d.objects[0])!.fill!;
    // As the pattern tile Kreuzschraffur, with layers 2 mm apart and turned to 20 degrees.
    expect(restitchFill(d, 0, { ...fill, pattern: 'crosshatch', angle: 20, deco: { size: 2 } }, new Set())).toBe(true);
    checkAll(d);
    expect(hatches(d)).toEqual(['2@20']);
    undoRedo(d, () => expect(hatches(d)).toEqual(['2@20']));

    expect(shapes(d, duplicateObject(d.cur.p, 0, T)?.pattern)).toBe(true);
    checkAll(d);
    expect(hatches(d)).toEqual(['2@20', '2@20']);
    // Mirrored, its direction is mirrored: the layers swap.
    expect(transform(d, [1], mirrorMatrix('x', boxOf(d, [1])))).toBe(true);
    checkAll(d);
    expect(hatches(d)).toEqual(['2@20', '2@160']);
    // A disc on top, the crosshatch under it left out.
    expect(shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(15, 10, 6, 6), ID), kind: 'fill' }, COLORS[1], null, options)?.pattern)).toBe(true);
    const k = setKnockout(d.cur.p, [0], true, T);
    expect(k).toBeTruthy();
    d.commit(k!.pattern);
    checkAll(d);
    expect(remembered(d.cur.p, d.objects[0])?.knockout).toBe(true);
    expect(hatches(d)).toEqual(['2@20', '2@160']);
    undoRedo(d, () => expect(hatches(d)).toEqual(['2@20', '2@160']));
    const before = d.cur;

    await saveAndOpen(d);
    checkAll(d);
    expect(hatches(d)).toEqual(hatches({ cur: before } as Doc));
    expect(Array.from(d.cur.p.x)).toEqual(Array.from(before.p.x));

    // Read from an embroidery file with nothing else known: still a crosshatch, as it was.
    const file = parsePattern(writePattern(d.cur.p, 'pes'), 'hatch.pes');
    const kinds = stitchKinds(file);
    const objs = sewObjects(file, kinds);
    const read = objs.filter((o) => o.kind === 'fill').map((o) => measureFill(file, analyze(file, o, kinds, undefined)));
    // Its angle or one a right angle off: the same net, only the layers sewn the other way round.
    expect(read.filter((s) => s.pattern === 'crosshatch').map((s) => `${s.deco?.size}@${s.angle % 90}`)).toEqual(['2@20', '2@70']);
  });
});

describe('a satin with a fringe', () => {
  /** The fringes of the satin objects, in their order. */
  const fringes = (d: { cur: Version }) => sewObjects(d.cur.p).map((o) => remembered(d.cur.p, o)?.line).filter((x) => x?.type === 'satin').map((x) => `${x!.fringe}${x!.fringeSide ?? ''}`);

  it('keeps it through duplicate, mirror, knockout, undo, redo and save and open', async () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath('M5 20 C20 5 35 35 50 20', ID), kind: 'stroke', width: 4 }, COLORS[0], null, options)!.pattern);
    // As the line panel's Fransen slider: the satin line sewn anew with a fringe.
    const m = remembered(d.cur.p, d.objects[0])!;
    expect(m.line?.type, 'a satin line').toBe('satin');
    const plain = Array.from(d.cur.p.y);
    const r = resewLine(d.cur.p, 0, m.geo!, { ...m.line!, fringe: 1.5, fringeSide: 'left' }, T)!;
    expect(Array.from(r.pattern.y), 'other stitches').not.toEqual(plain);
    expect(shapes(d, r.pattern)).toBe(true);
    checkAll(d);
    const fringed = d.cur;
    expect(fringes(d)).toEqual(['1.5left']);

    expect(shapes(d, duplicateObject(d.cur.p, 0, T)?.pattern)).toBe(true);
    checkAll(d);
    expect(fringes(d)).toEqual(['1.5left', '1.5left']);
    expect(transform(d, [1], mirrorMatrix('x', boxOf(d, [1])))).toBe(true);
    checkAll(d);
    expect(fringes(d)).toEqual(['1.5left', '1.5left']);
    // A fill on top that leaves itself out of the satins under it.
    expect(shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(28, 20, 6, 6), ID), kind: 'fill' }, COLORS[1], null, options)?.pattern)).toBe(true);
    const top = d.objects.findIndex((o) => remembered(d.cur.p, o)?.fill);
    const k = setKnockout(d.cur.p, [top], true, T);
    expect(k).toBeTruthy();
    d.commit(k!.pattern);
    checkAll(d);
    expect(fringes(d).every((f) => f === '1.5left'), 'cut satins keep the fringe').toBe(true);
    const cut = d.cur;

    await saveAndOpen(d);
    checkAll(d);
    expect(fringes(d)).toEqual(fringes({ cur: cut }));
    expect(Array.from(d.cur.p.x)).toEqual(Array.from(cut.p.x));

    // Back to the first fringed version and forward again: all or nothing (see undoRedo).
    d.undo = [fringed];
    d.redo = [];
    d.cur = cut;
    const prev = d.undo.pop()!;
    d.redo.push(d.cur);
    d.cur = prev;
    backToVersion(prev.p);
    checkAll(d);
    expect(fringes(d)).toEqual(['1.5left']);
    const next = d.redo.pop()!;
    d.cur = next;
    backToVersion(next.p);
    checkAll(d);
    expect(fringes(d)).toEqual(fringes({ cur: cut }));
  });
});

describe('versions keep what they knew', () => {
  /** A pattern of one stitch at (i, i): something else to remember. */
  const other = (i: number): Pattern => ({ ...empty, x: Int32Array.of(i, i), y: Int32Array.of(i, i), cmd: Uint8Array.of(STITCH, END), colors: [COLORS[0]] });

  it('a version forgets nothing, however much other versions learn meanwhile', () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    const first = d.cur;
    // A long session: far more objects remembered than the old memory held (400).
    for (let i = 1; i <= 1000; i++) {
      const q = other(i);
      remember(q, sewObjects(q)[0], { region: null });
    }
    expect(remembered(first.p, sewObjects(first.p)[0])?.geo).toBeTruthy();
    expect(knowledge(first.p)).toEqual(first.known);
  });

  it('a later version with the same stitches does not change what an earlier one knows', () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    const first = d.cur;
    const o = sewObjects(first.p)[0];
    const m = remembered(first.p, o)!;
    // Same stitches, other settings (as a setting changed without new stitches).
    const same = { ...first.p };
    remember(same, o, { ...m, lock: true });
    d.commit(same);
    expect(remembered(first.p, o)?.lock).toBeUndefined();
    expect(remembered(same, o)?.lock).toBe(true);
    // The same object in both: the same id.
    expect(sewObjects(same)[0].id).toBe(o.id);
  });
});
