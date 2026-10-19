import { describe, expect, it } from 'vitest';
import { addShape } from '../src/model/addShape';
import { syncBorders } from '../src/model/border';
import { partOf } from '../src/model/shadow';
import { resewLine } from '../src/model/line';
import { setKnockout } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import { END, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { sameColor } from '../src/model/recolor';
import { backToVersion, lockAt, remember, remembered, restitch, withShortLocks, type SatinSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { isRedwork } from '../src/model/along';
import { currentSettings } from '../src/correct/plan';
import { deleteObjects, duplicateObject, duplicateObjects, mirrorMatrix, recolorObjects, subtractTop } from '../src/model/shapeOps';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { loadOps } from '../src/shape/ops';
import { contourAt, gapReader } from '../src/model/contour';
import { flatten, type Form } from '../src/shape/path';
import { ID, options, T, COLORS, empty, knowledge, Doc, shapes, transform, boxOf, saveAndOpen, checkWellFormed, checkAllKnown, checkPartsFit, checkBorders, checkObjectList, checkKeys, checkKnockouts, checkAreas, checkCrosshatch, checkExport, checkSewDesign, checkFollowers, checkEchoes, checkRedwork, chain, borderedSquare, borderOf, restitchFill, squareOf, took, type Version } from './helpers/torture';
import { motifStitches } from '../src/digitize/motif';
import type { Pt } from '../src/digitize/skeleton';
import { analyze, measureFill } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { writePattern } from '../src/writers';

// What the torture test found, and features taken through duplicate, mirror, knockout, undo and save
// and open; the regular chains are in torture.test.ts and tortureChains.test.ts. A file of its own so
// it runs beside the chains instead of after them.
describe('found by the torture test', () => {
  // Pasted into a design over a fill fading into a second thread and leaving out what lies on
  // top: what was left of its area gave the second thread nothing to sew, and it stayed where the
  // area had been.
  it('a second thread with nothing left to fade in on is taken out', async () => {
    await chain(141, undefined, { knit: true, motif: true, motifShare: 0.5, motifOp: 'paste from another design' });
  }, 120_000);

  // A meander on a leaf put into the design again, leaving out what lies on top: at its new place
  // no cell of the meander's grid fit the leaf, so it could be sewn neither on what was left nor
  // whole, and kept the area it had before.
  it('a meander on a narrow shape is sewn wherever the shape lies', async () => {
    await chain(210, undefined, { knit: true, motif: true });
  }, 120_000);

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

  // Seed 211: the cutter's shadow, sewn before the cut fill, went with the cutter, and the cut fill
  // was named by an index off by one. Here the border of a covered fill does the same.
  it('cutting out names the cut fill, also when parts of what goes lie before it', async () => {
    await loadOps();
    const d = borderedSquare();
    // A fill after the square's border, and on top a fill covering the square and part of it.
    let p = addShape(d.cur.p, { form: parsePath(rectPath(30, 30, 20, 10, 0, 0), ID), kind: 'fill' }, COLORS[2], null, options)!.pattern;
    p = addShape(p, { form: parsePath(rectPath(-1, -1, 40, 35, 0, 0), ID), kind: 'fill' }, COLORS[2], null, options)!.pattern;
    const objs = sewObjects(p);
    const lower = objs.at(-2)!;
    const c = subtractTop(p, [squareOf(d)!.index, lower.index, objs.length - 1], T)!;
    expect(c.covered).toBe(1);
    expect(c.cut.map((o) => sewObjects(c.pattern)[o]?.id)).toEqual([lower.id]);
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

  it('a copy in place of a line, both sewn as redwork, still remembers its own', () => {
    // A ring as redwork runs there and back: sewn from the other end it has the very same
    // stitches, so only the short locks tell the copy apart.
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(ellipsePath(10, 20, 9, 10), ID), kind: 'stroke', width: 0 }, COLORS[0], null, options)!.pattern);
    shapes(d, duplicateObjects(d.cur.p, [0], T, 0)?.pattern);
    shapes(d, recolorObjects(d.cur.p, [1], COLORS[1], T));
    expect(d.objects).toHaveLength(2);
    // Both sewn along the very same form, as in the chain that found it.
    const form = remembered(d.cur.p, d.objects[0])!.geo!;
    for (const k of [0, 1]) {
      const m = remembered(d.cur.p, d.objects[k])!;
      expect(shapes(d, resewLine(d.cur.p, k, form, { ...m.line!, redwork: true }, T)!.pattern)).toBe(true);
      checkKeys(d.cur.p);
    }
    expect(d.objects.map((o) => isRedwork(remembered(d.cur.p, o)!.line!))).toEqual([true, true]);
  });

  it('recoloring a border gives its fill that border thread', () => {
    const d = borderedSquare();
    shapes(d, recolorObjects(d.cur.p, [borderOf(d)], COLORS[2], T));
    expect(sameColor(squareOf(d)!.color, COLORS[0])).toBe(true);
    expect(sameColor(remembered(d.cur.p, squareOf(d)!)!.line!.color, COLORS[2])).toBe(true);
    checkBorders(d.cur.p);
  });

  it('a chevron goes from one piece to the next over the corner, not across its inside', () => {
    // Two sharp corners, a chevron figure each piece: the step between them cut the corner.
    const line: Pt[] = [[12.9, 41.3], [6.8, 45.7], [0.7, 41.3], [7.8, 36.1]];
    const off = ([x, y]: Pt) =>
      Math.min(
        ...line.slice(1).map((b, i) => {
          const a = line[i];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
          return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
        }),
      );
    for (const side of [1, -1] as const) {
      const pts = motifStitches(line, false, 'chevron', 2.3, 6.6, side);
      expect(Math.max(...pts.map(off))).toBeLessThan(2.3 / 2 + 0.01);
    }
  });

  it('a fill leaving out what lies on top, mirrored onto the same pixels, is sewn anew on what is left', () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(rectPath(10, 10, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    // A disc over one corner only: the square's stitches mirrored along leave out the other corner.
    shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(28, 12, 5, 5), ID), kind: 'fill' }, COLORS[1], null, options)!.pattern);
    shapes(d, setKnockout(d.cur.p, [0], true, T)!.pattern);
    const left = remembered(d.cur.p, d.objects[0])!.region!.areaMm2;
    // Mirrored about its middle, the square covers the very pixels it did, so the same is left of it.
    expect(transform(d, [0], [-1, 0, 0, 1, 40, 0])).toBe(true);
    expect(remembered(d.cur.p, d.objects[0])!.region!.areaMm2).toBeCloseTo(left, 6);
    checkAreas(d.cur.p);
    checkKnockouts(d.cur.p);
  });

  it('a contour around a jagged outline keeps its distance all along', async () => {
    await loadOps();
    // The outline of a lettering read from its stitches, cut down (seed 251): on the 0.1 mm grid,
    // its offset has no corner over a long way and the fit splits it many times, mostly near an end.
    const pts: Pt[] = [
      [25.3, 15.9], [25.7, 16.1], [26.1, 16.2], [27.9, 17.2], [28.3, 17.4], [28.6, 17.6], [34.3, 27.8], [17.5, 39.6], [18.5, 39.9],
      [22.7, 40], [23.4, 39.9], [23.8, 39.8], [24.4, 39.6], [24.8, 39.5], [25.4, 39.3], [25.7, 39.1], [26, 39], [26.4, 38.8],
      [26.7, 38.6], [27.2, 38.3], [27.8, 37.9], [28.3, 37.4], [28.6, 37.2], [29.8, 35.8], [31.8, 31.8], [33.2, 33.9], [29.4, 39.2],
      [27.7, 40.4], [27.3, 40.5], [25.8, 41.3], [25, 41.5], [24.3, 41.8], [23.5, 41.9], [23, 42], [22.6, 42.1], [22.2, 42.1],
      [21.8, 42.2], [20.6, 42.2], [20.1, 42.1], [14.2, 40.2], [13.6, 39.7], [11.2, 37.5], [10.9, 37.2], [10.6, 36.8], [10.2, 36.2],
      [10, 35.8], [9.8, 35.5], [9.5, 35.1], [9.4, 34.7], [9.2, 34.4], [7.9, 29.6],
    ];
    const source: Form = { paths: [{ closed: true, nodes: pts.map((p) => ({ p, a: p, b: p, smooth: false })) }], nonzero: true };
    const read = gapReader(source);
    const off = contourAt(source, 0.8)!.paths.flatMap((x) => flatten(x, 0.1)).map((q) => Math.abs(read(q) - 0.8));
    expect(Math.max(...off)).toBeLessThan(0.05);
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

describe('a line as redwork', () => {
  const checkAll = (d: Doc) => {
    const p = d.cur.p;
    checkWellFormed(p);
    expect(knowledge(p), 'knowledge as stored with this version').toEqual(d.cur.known);
    checkAllKnown(p);
    checkKeys(p);
    checkObjectList(p);
    checkPartsFit(p);
    checkEchoes(p);
    checkRedwork(p);
    checkExport(p);
    checkSewDesign(p);
  };
  /** Which objects are sewn as redwork, in their order. */
  const reds = (d: { cur: Version }) => sewObjects(d.cur.p).map((o) => !!remembered(d.cur.p, o)?.line?.redwork);
  /** Trims inside each object. */
  const trims = (d: { cur: Version }) => sewObjects(d.cur.p).map((o) => d.cur.p.cmd.slice(o.first, o.last).filter((c) => c === TRIM).length);

  it('keeps it through duplicate, mirror, knockout, undo, redo and save and open', async () => {
    await loadOps();
    const d = new Doc();
    // A star of three strokes and a ring through them, apart from each other only where they cross.
    const form = parsePath(`M0 0 L30 30 M0 30 L30 0 M15 0 L15 30 ${ellipsePath(15, 15, 8, 8)}`, ID);
    shapes(d, addShape(empty, { form, kind: 'stroke', width: 0 }, COLORS[0], null, options)!.pattern);
    const m = remembered(d.cur.p, d.objects[0])!;
    expect(m.line?.type, 'a running stitch line').toBe('run');
    const path = d.cur;
    // As the line panel's switch: the line sewn anew as redwork.
    expect(shapes(d, resewLine(d.cur.p, 0, m.geo!, { ...m.line!, redwork: true }, T)!.pattern)).toBe(true);
    checkAll(d);
    expect(reds(d)).toEqual([true]);
    expect(trims(d)).toEqual([0]);
    const red = d.cur;

    expect(shapes(d, duplicateObjects(d.cur.p, [0], T)?.pattern)).toBe(true);
    checkAll(d);
    expect(reds(d)).toEqual([true, true]);
    expect(transform(d, [1], mirrorMatrix('x', boxOf(d, [1])))).toBe(true);
    checkAll(d);
    expect(reds(d)).toEqual([true, true]);
    expect(trims(d)).toEqual([0, 0]);
    // A fill on top that leaves itself out of what lies under it: lines are not cut.
    expect(shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(15, 15, 5, 5), ID), kind: 'fill' }, COLORS[1], null, options)?.pattern)).toBe(true);
    const top = d.objects.findIndex((o) => remembered(d.cur.p, o)?.fill);
    const k = setKnockout(d.cur.p, [top], true, T);
    if (k) d.commit(k.pattern);
    checkAll(d);
    expect(reds(d).filter(Boolean)).toHaveLength(2);
    const last = d.cur;

    await saveAndOpen(d);
    checkAll(d);
    expect(reds(d)).toEqual(reds({ cur: last }));
    expect(Array.from(d.cur.p.x)).toEqual(Array.from(last.p.x));

    // Back to the line sewn path by path and forward again: all or nothing.
    d.undo = [path];
    d.redo = [];
    d.cur = red;
    const prev = d.undo.pop()!;
    d.redo.push(d.cur);
    d.cur = prev;
    backToVersion(prev.p);
    checkAll(d);
    expect(reds(d)).toEqual([false]);
    expect(trims(d)[0]).toBeGreaterThan(0);
    const next = d.redo.pop()!;
    d.cur = next;
    backToVersion(next.p);
    checkAll(d);
    expect(reds(d)).toEqual([true]);
    expect(trims(d)).toEqual([0]);
  });
});

describe('a narrow drawn area sewn as satin', () => {
  /** The objects that leave out what lies on top, and the kind each is sewn as. */
  const state = (d: { cur: Version }) => sewObjects(d.cur.p).map((o) => `${o.kind}${remembered(d.cur.p, o)?.knockout ? ':ko' : ''}`);
  /** Stitches of object `index` inside the box (mm), which an object on top covers. */
  const inside = (d: { cur: Version }, index: number, [x0, y0, x1, y1]: number[]) => {
    const o = sewObjects(d.cur.p)[index];
    let n = 0;
    for (let i = o.first; i <= o.last; i++) {
      const [x, y] = [d.cur.p.x[i] / 10, d.cur.p.y[i] / 10];
      if (d.cur.p.cmd[i] === STITCH && x > x0 && x < x1 && y > y0 && y < y1) n++;
    }
    return n;
  };

  it('leaves out what lies on top, through duplicate, mirror, undo, redo and save and open', async () => {
    await loadOps();
    const d = new Doc();
    // A strip 5 mm high: narrow enough that the drawn area is sewn as one satin column.
    shapes(d, addShape(empty, { form: parsePath(rectPath(0, 20, 60, 5, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    expect(state(d)).toEqual(['satin']);
    shapes(d, addShape(d.cur.p, { form: parsePath(rectPath(25, 15, 10, 15, 0, 0), ID), kind: 'fill' }, COLORS[1], null, options)!.pattern);
    const box = [26, 16, 34, 29];
    expect(inside(d, 0, box)).toBeGreaterThan(0);
    // Offered by the app (it has a drawn area), so leaving out must do something.
    const k = setKnockout(d.cur.p, [0], true, T);
    expect(k, 'the satin is left out under the square').toBeTruthy();
    d.commit(k!.pattern);
    checkAll(d);
    expect(state(d)[0]).toBe('satin:ko');
    expect(inside(d, 0, box), 'no stitches of the strip under the square').toBe(0);
    undoRedo(d, () => expect(state(d)[0]).toBe('satin:ko'));

    // The square moved away: the strip follows and is whole again.
    expect(transform(d, [1], [1, 0, 0, 1, 0, 20])).toBe(true);
    checkAll(d);
    expect(inside(d, 0, box)).toBeGreaterThan(0);
    expect(transform(d, [1], [1, 0, 0, 1, 0, -20])).toBe(true);
    checkAll(d);
    expect(inside(d, 0, box)).toBe(0);

    expect(shapes(d, duplicateObject(d.cur.p, 0, T)?.pattern)).toBe(true);
    checkAll(d);
    expect(transform(d, [d.objects.length - 1], mirrorMatrix('x', boxOf(d, [d.objects.length - 1])))).toBe(true);
    checkAll(d);
    const before = d.cur;
    await saveAndOpen(d);
    checkAll(d);
    expect(state(d)).toEqual(state({ cur: before }));
    expect(Array.from(d.cur.p.x)).toEqual(Array.from(before.p.x));

    // Off again: sewn whole as the satin it was.
    const off = setKnockout(d.cur.p, [0], false, T);
    expect(off).toBeTruthy();
    d.commit(off!.pattern);
    checkAll(d);
    expect(state(d)[0]).toBe('satin');
    expect(inside(d, 0, box)).toBeGreaterThan(0);
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

describe('an irregular satin', () => {
  const checkAll = (d: Doc) => {
    const p = d.cur.p;
    checkWellFormed(p);
    expect(knowledge(p), 'knowledge as stored with this version').toEqual(d.cur.known);
    checkAllKnown(p);
    checkKeys(p);
    checkObjectList(p);
    checkPartsFit(p);
    checkKnockouts(p);
    checkExport(p);
    checkSewDesign(p);
  };
  /** The irregular settings of the satin objects, in their order. */
  const rough = (d: { cur: Version }) => sewObjects(d.cur.p).map((o) => remembered(d.cur.p, o)?.satin).filter((s) => s).map((s) => `${s!.rough}/${s!.roughSeed}`);
  /** The stitches of object k, from its first stitch. */
  const shape = (p: Pattern, k: number) => {
    const o = sewObjects(p)[k];
    const pts: number[][] = [];
    for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) pts.push([p.x[i] - p.x[o.first], p.y[i] - p.y[o.first]]);
    return pts;
  };

  it('keeps its seed and its stitches through duplicate, mirror, undo and save and open', async () => {
    const d = new Doc();
    // A bar 4 mm wide: drawn, it is sewn as satin.
    shapes(d, addShape(empty, { form: parsePath(rectPath(5, 10, 30, 4, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    expect(d.objects[0].kind, 'a satin').toBe('satin');
    const plain = d.cur;
    // As the stitch card's Unregelmäßig slider: sewn anew with a seed picked once.
    const cur = currentSettings(d.cur.p, d.objects[0], stitchKinds(d.cur.p))!;
    expect(cur.kind).toBe('satin');
    const res = restitch(d.cur.p, d.objects, [0], { kind: 'satin', s: { ...(cur.s as SatinSettings), rough: 0.6, roughSeed: 4242 } }, stitchKinds(d.cur.p), T);
    expect(took(d, res)).toBe(true);
    checkAll(d);
    expect(rough(d)).toEqual(['0.6/4242']);
    const sewn = shape(d.cur.p, 0);
    expect(sewn).not.toEqual(shape(plain.p, 0));
    const irregular = d.cur;

    // A copy: the same seed, the same stitches (moved).
    expect(shapes(d, duplicateObject(d.cur.p, 0, T)?.pattern)).toBe(true);
    checkAll(d);
    expect(rough(d)).toEqual(['0.6/4242', '0.6/4242']);
    expect(shape(d.cur.p, 1)).toEqual(sewn);
    // Mirrored: still the seed.
    expect(transform(d, [1], mirrorMatrix('x', boxOf(d, [1])))).toBe(true);
    checkAll(d);
    expect(rough(d)).toEqual(['0.6/4242', '0.6/4242']);
    const mirrored = d.cur;

    await saveAndOpen(d);
    checkAll(d);
    expect(rough(d)).toEqual(['0.6/4242', '0.6/4242']);
    expect(Array.from(d.cur.p.x)).toEqual(Array.from(mirrored.p.x));
    // Sewn anew after opening (as any change does): the very same stitches.
    const again = restitch(d.cur.p, d.objects, [0], { kind: 'satin', s: remembered(d.cur.p, d.objects[0])!.satin! }, stitchKinds(d.cur.p), T);
    expect(took(d, again)).toBe(true);
    expect(shape(d.cur.p, 0)).toEqual(sewn);

    // Back to before it was irregular and forward again: all or nothing.
    d.undo = [plain];
    d.redo = [];
    d.cur = irregular;
    const prev = d.undo.pop()!;
    d.redo.push(d.cur);
    d.cur = prev;
    backToVersion(prev.p);
    checkAll(d);
    expect(rough(d), 'not irregular').toEqual([]);
    const next = d.redo.pop()!;
    d.cur = next;
    backToVersion(next.p);
    checkAll(d);
    expect(rough(d)).toEqual(['0.6/4242']);
  });
});
