import { describe, expect, it } from 'vitest';
import { addShape } from '../src/model/addShape';
import { appliqueFrom, appliquePieces, appliqueStops, cutLinesSvg, innerStops, stopsIn, tackInset } from '../src/model/applique';
import { sheetHtml } from '../src/areas/ready/sheet';
import { cardView } from '../src/areas/ready/card';
import { recipeCard } from '../src/areas/ready/recipes';
import { t } from '../src/i18n';
import { cutForms, fromApplique, setApplique, toApplique } from '../src/model/appliqueOps';
import { colorBlocks } from '../src/model/sequence';
import { colorBlockOf, numberInColor, sewObjects } from '../src/model/objects';
import { COLOR_CHANGE, STITCH, type Pattern } from '../src/model/pattern';
import { relearn, remember, remembered, restoreRemembered } from '../src/model/restitch';
import { fromStored, storedVersion, toStored } from '../src/storage/fileStore';
import { reorder } from '../src/model/order';
import { recolor } from '../src/model/recolor';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { COLORS, Doc, ID, OPS, T, checkReload, empty, options, saveAndOpen, shapes, transform, checkWellFormed, checkSewDesign, checkExport, checkAppliques, restitchFill, pointOnCloth, checkBlends, checkFollowers, checkKnockouts } from './helpers/torture';
import { objectAtPoint } from '../src/render/flow';
import { setKnockout } from '../src/model/knockout';
import { backToVersion } from '../src/model/restitch';
import { mirrorMatrix, duplicateObject } from '../src/model/shapeOps';
import { rotation, translation } from '../src/shape/path';
import { measurePattern } from '../src/validation/measure';
import { openOnPurpose } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { writePattern } from '../src/writers';
import { blendObject } from '../src/model/blend';

/** A circle of 30 mm made an appliqué, after a red square; a blue disc after it. */
function design(): Doc {
  const d = new Doc();
  shapes(d, addShape(empty, { form: parsePath(rectPath(-40, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
  shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(15, 15, 15, 15), ID), kind: 'fill' }, COLORS[0], 0, options)!.pattern);
  shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(60, 15, 6, 6), ID), kind: 'fill' }, COLORS[1], null, options)!.pattern);
  expect(shapes(d, toApplique(d.cur.p, [1], T))).toBe(true);
  return d;
}

const changes = (p: Pattern) => p.cmd.reduce((n, c) => n + (c === COLOR_CHANGE ? 1 : 0), 0);

describe('appliqué', () => {
  it('is one object sewn in three parts, the machine stopping twice in its thread', () => {
    const d = design();
    const p = d.cur.p;
    checkWellFormed(p);
    const objs = sewObjects(p);
    expect(objs).toHaveLength(3);
    const a = objs[1];
    expect(remembered(p, a)?.applique?.fabric).toBe('woven');
    expect(remembered(p, a)?.applique?.color).toEqual({ r: COLORS[0].r, g: COLORS[0].g, b: COLORS[0].b });
    // Square and appliqué in one thread: two stops inside the appliqué, one color change to blue.
    expect(changes(p)).toBe(3);
    expect(p.colors.map((c) => c.r)).toEqual([COLORS[0].r, COLORS[0].r, COLORS[0].r, COLORS[1].r]);
    expect([...appliqueStops(p)]).toEqual([
      [1, 'place'],
      [2, 'trim'],
    ]);
    // Placement on the outline (r = 15), tack-down just inside, then the cover over the edge.
    const blocks = colorBlocks(p);
    const radii = (b: number) => {
      const out: number[] = [];
      for (let i = blocks[b].first; i <= blocks[b].last; i++) if (p.cmd[i] === STITCH && i >= a.first) out.push(Math.hypot(p.x[i] / 10 - 15, p.y[i] / 10 - 15));
      return out;
    };
    const median = (v: number[]) => v.sort((x, y) => x - y)[v.length >> 1];
    expect(median(radii(0))).toBeCloseTo(15, 0);
    expect(median(radii(1))).toBeCloseTo(15 - tackInset({ edge: 'satin', width: 3 }), 0);
    const cover = radii(2);
    expect(Math.min(...cover)).toBeLessThan(14);
    expect(Math.max(...cover)).toBeGreaterThan(16);
    // Nothing is sewn inside the piece.
    expect(cover.every((r) => r > 12) && radii(1).every((r) => r > 12)).toBe(true);
  });

  it('stays together and keeps its stops when the order is optimized', () => {
    const d = design();
    const p = d.cur.p;
    const q = reorder(p, sewObjects(p), [2, 1, 0], T);
    expect(changes(q)).toBeGreaterThanOrEqual(3);
    expect(appliqueStops(q).size).toBe(2);
    checkWellFormed(q);
  });

  it('is sewn the same from its object list, and survives export', () => {
    const d = design();
    checkSewDesign(d.cur.p);
    checkExport(d.cur.p);
    const back = parsePattern(writePattern(d.cur.p, 'dst'), 'a.dst');
    expect(changes(back)).toBe(3);
  });

  it('goes along when moved, turned, mirrored, scaled and duplicated', () => {
    for (const m of [translation(10, 5), rotation(30, 15, 15), mirrorMatrix('x', { minX: 0, minY: 0, maxX: 30, maxY: 30 }), [1.5, 0, 0, 1.5, 0, 0] as const]) {
      const d = design();
      expect(transform(d, [1], [...m] as never)).toBe(true);
      const p = d.cur.p;
      checkWellFormed(p);
      const a = sewObjects(p).find((o) => remembered(p, o)?.applique);
      expect(a).toBeTruthy();
      expect(appliqueStops(p).size).toBe(2);
    }
    const d = design();
    expect(shapes(d, duplicateObject(d.cur.p, 1, T)?.pattern)).toBe(true);
    const p = d.cur.p;
    checkWellFormed(p);
    expect(sewObjects(p).filter((o) => remembered(p, o)?.applique)).toHaveLength(2);
    expect(appliqueStops(p).size).toBe(4);
  });

  it('is saved and opened with its fabric', async () => {
    const d = design();
    const p0 = d.cur.p;
    expect(shapes(d, setApplique(p0, [1], { fabric: 'felt', edge: 'e', width: 2.5 }, T))).toBe(true);
    await saveAndOpen(d);
    const p = d.cur.p;
    const a = sewObjects(p)[1];
    expect(remembered(p, a)?.applique).toMatchObject({ fabric: 'felt', edge: 'e', width: 2.5 });
    expect(appliqueStops(p).size).toBe(2);
  });

  it('stays whole after its edge was changed, undone and the page reloaded', () => {
    const d = design();
    const before = d.cur.p;
    expect(shapes(d, setApplique(before, [1], { edge: 'none' }, T))).toBe(true);
    const changed = d.cur.p;
    // Undo: the store keeps the version undone to, records and objects together.
    expect(OPS.find((o) => o.name === 'undo')!.run(d, () => 0)).toBe(true);
    expect(d.cur.p).toBe(before);
    const reload = (records: Pattern, objects: ReturnType<typeof storedVersion>['objects']) => {
      const p = fromStored(before, structuredClone(toStored(records)))!;
      restoreRemembered(p, structuredClone(objects));
      return sewObjects(p).map((o) => !!remembered(p, o)?.applique);
    };
    expect(reload(before, storedVersion(before, undefined).objects)).toEqual([false, true, false]);
    checkReload(d);
    // The objects of the version undone do not fit its stitches: the appliqué fell apart into the
    // running stitches between its stops, knowing nothing (as the store kept it before).
    expect(reload(before, storedVersion(changed, undefined).objects)).toEqual([false, false, false, false, false]);
  });

  it('can leave its edge raw: the tack-down further in, repeated or in bean stitch, kept on save', async () => {
    const d = design();
    const stitchesIn = (p: Pattern, b: number) => {
      const bl = colorBlocks(p)[b];
      const out: number[] = [];
      for (let i = bl.first; i <= bl.last; i++) if (p.cmd[i] === STITCH) out.push(Math.hypot(p.x[i] / 10 - 15, p.y[i] / 10 - 15));
      return out;
    };
    expect(shapes(d, setApplique(d.cur.p, [1], { edge: 'none' }, T))).toBe(true);
    // Placement, stop, tack-down; the change to blue after it is the stop to cut the fabric.
    expect(colorBlocks(d.cur.p)).toHaveLength(3);
    expect([...appliqueStops(d.cur.p)]).toEqual([[1, 'place']]);
    const once = stitchesIn(d.cur.p, 1);
    // RAW_INSET inside the cut edge: nothing over the outline, nothing deep inside.
    expect(once.every((r) => r > 13 && r < 14)).toBe(true);
    const [x] = appliquePieces(d.cur.p);
    expect(x.trim).toBeGreaterThan(x.last);
    expect(d.cur.p.cmd[x.trim]).toBe(COLOR_CHANGE);
    expect(shapes(d, setApplique(d.cur.p, [1], { tack: { type: 'triple', width: 0 } }, T))).toBe(true);
    const bean = stitchesIn(d.cur.p, 1);
    expect(bean.length / once.length).toBeGreaterThan(2.5);
    expect(bean.length / once.length).toBeLessThan(3.5);
    checkWellFormed(d.cur.p);
    checkAppliques(d.cur.p);
    checkExport(d.cur.p);
    await saveAndOpen(d);
    const a = sewObjects(d.cur.p)[1];
    expect(remembered(d.cur.p, a)?.applique).toMatchObject({ edge: 'none', tack: { type: 'triple' } });
    expect(stitchesIn(d.cur.p, 1).length).toBe(bean.length);
  });

  it('a raw edge before more in its thread stops after it to cut the fabric', async () => {
    const d = design();
    expect(shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(15, 45, 5, 5), ID), kind: 'fill' }, COLORS[0], 1, options)!.pattern)).toBe(true);
    expect(shapes(d, setApplique(d.cur.p, [1], { edge: 'none' }, T))).toBe(true);
    const p = d.cur.p;
    expect([...appliqueStops(p).values()]).toEqual(['place', 'trim']);
    const [x] = appliquePieces(p);
    expect(x.trim).toBeGreaterThan(x.last);
    checkAppliques(p);
    checkSewDesign(p);
    // Undone to a satin edge and back: the stop goes and comes with it.
    expect(OPS.find((o) => o.name === 'undo')!.run(d, () => 0)).toBe(true);
    expect(appliqueStops(d.cur.p).size).toBe(2);
    checkAppliques(d.cur.p);
    await saveAndOpen(d);
    checkAppliques(d.cur.p);
  });

  it('precut: no placement line, one stop before it to lay the piece on', async () => {
    const d = design();
    expect(shapes(d, setApplique(d.cur.p, [1], { place: false }, T))).toBe(true);
    let p = d.cur.p;
    const a = sewObjects(p)[1];
    expect(remembered(p, a)?.applique?.place).toBe(false);
    // The square and the appliqué in one thread: the stop between them opens its block.
    expect([...appliqueStops(p)]).toEqual([[1, 'lay']]);
    for (let i = a.first; i <= a.last; i++) expect(p.cmd[i]).not.toBe(COLOR_CHANGE);
    const [x] = appliquePieces(p);
    expect(x.place).toBe(x.trim);
    expect(x.place).toBeLessThan(x.first);
    // Nothing on the outline before the tack-down: the first stitches lie inside it.
    expect(Math.hypot(p.x[a.first + 2] / 10 - 15, p.y[a.first + 2] / 10 - 15)).toBeLessThan(14.8);
    const m = measurePattern(p, openOnPurpose(p, sewObjects(p)) ?? undefined);
    expect(m.gapsLow.reduce((s, v) => s + v, 0)).toBe(0);
    expect(t('applique.stop.lay')).not.toBe('applique.stop.lay');
    checkAppliques(p);
    checkSewDesign(p);
    // Duplicated and mirrored: each has its stop before it.
    expect(shapes(d, duplicateObject(d.cur.p, 1, T, 50)?.pattern)).toBe(true);
    const dup = sewObjects(d.cur.p).filter((o) => remembered(d.cur.p, o)?.applique).at(-1)!.index;
    expect(transform(d, [dup], mirrorMatrix('x', { minX: 50, minY: 50, maxX: 80, maxY: 80 }))).toBe(true);
    p = d.cur.p;
    expect(appliquePieces(p)).toHaveLength(2);
    checkAppliques(p);
    await saveAndOpen(d);
    expect(remembered(d.cur.p, sewObjects(d.cur.p)[1])?.applique?.place).toBe(false);
    checkAppliques(d.cur.p);
    // Back to a placement line: two stops inside, none before.
    expect(shapes(d, setApplique(d.cur.p, [1], { place: true }, T))).toBe(true);
    expect(remembered(d.cur.p, sewObjects(d.cur.p)[1])?.applique?.place).toBeUndefined();
    checkAppliques(d.cur.p);
  });

  it('reads a running edge stored before as a raw edge with that tack-down', () => {
    const color = { r: 1, g: 2, b: 3 };
    expect(appliqueFrom({ edge: 'run', run: { type: 'triple', width: 0, repeat: 2 }, width: 3, fabric: 'felt', color })).toEqual({ tack: { type: 'triple', width: 0, length: 2, repeat: 2 }, edge: 'none', width: 3, fabric: 'felt', color });
    expect(appliqueFrom({ edge: 'run', width: 3, fabric: 'felt', color })).toEqual({ edge: 'none', width: 3, fabric: 'felt', color });
    expect(appliqueFrom({ edge: 'satin', place: true, tack: { type: 'run', width: 0, length: 2 }, width: 3, fabric: 'felt', color })).toEqual({ edge: 'satin', width: 3, fabric: 'felt', color });
  });

  it('touching ones share their edge: the earlier sews no satin where the later covers it', async () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(ellipsePath(15, 15, 15, 15), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(44, 15, 15, 15), ID), kind: 'fill' }, COLORS[1], null, options)!.pattern);
    expect(shapes(d, toApplique(d.cur.p, [0, 1], T))).toBe(true);
    /** Stitches of the first appliqué's cover within 3 mm of where the circles meet (29.5, 15). */
    const atJoint = (p: Pattern) => {
      const a = sewObjects(p)[0];
      const trim = stopsIn(p, a.first, a.last)[1];
      let n = 0;
      for (let i = trim; i <= a.last; i++) if (p.cmd[i] === STITCH && Math.hypot(p.x[i] / 10 - 29.5, p.y[i] / 10 - 15) < 3) n++;
      return n;
    };
    const covered = (p: Pattern) => !!remembered(p, sewObjects(p)[0])?.cut;
    expect(covered(d.cur.p)).toBe(true);
    expect(atJoint(d.cur.p)).toBe(0);
    expect(remembered(d.cur.p, sewObjects(d.cur.p)[1])?.cut).toBeUndefined();
    checkAppliques(d.cur.p);
    checkKnockouts(d.cur.p);
    const shared = d.cur.p;
    // Moved apart: the first gets its whole edge back; undone, shared again.
    expect(transform(d, [1], translation(20, 0))).toBe(true);
    expect(covered(d.cur.p)).toBe(false);
    expect(atJoint(d.cur.p)).toBeGreaterThan(0);
    checkKnockouts(d.cur.p);
    expect(OPS.find((o) => o.name === 'undo')!.run(d, () => 0)).toBe(true);
    expect(d.cur.p).toBe(shared);
    expect(atJoint(d.cur.p)).toBe(0);
    // The later one with a raw edge hides nothing: the earlier sews its whole satin.
    expect(shapes(d, setApplique(d.cur.p, [1], { edge: 'none' }, T))).toBe(true);
    expect(covered(d.cur.p)).toBe(false);
    checkKnockouts(d.cur.p);
    expect(shapes(d, setApplique(d.cur.p, [1], { edge: 'satin' }, T))).toBe(true);
    expect(covered(d.cur.p)).toBe(true);
    // Duplicated and mirrored, saved and opened: computed again, as sewn.
    expect(shapes(d, duplicateObject(d.cur.p, 0, T, 80)?.pattern)).toBe(true);
    const dup = sewObjects(d.cur.p).find((o) => d.cur.p.x[o.first] > 700)!.index;
    expect(transform(d, [dup], mirrorMatrix('x', { minX: 80, minY: 80, maxX: 110, maxY: 110 }))).toBe(true);
    expect(covered(d.cur.p)).toBe(true);
    checkKnockouts(d.cur.p);
    checkAppliques(d.cur.p);
    await saveAndOpen(d);
    expect(covered(d.cur.p)).toBe(true);
    checkKnockouts(d.cur.p);
    checkReload(d);
  });

  it('a recolor takes the stops along, and back to a fill it is sewn as before', () => {
    const d = design();
    const q = recolor(d.cur.p, 0, { r: 1, g: 2, b: 3 });
    expect(q.colors.slice(0, 3).every((c) => c.r === 1)).toBe(true);
    const f = remembered(d.cur.p, sewObjects(d.cur.p)[0])!.fill!;
    expect(shapes(d, fromApplique(d.cur.p, [1], f, T))).toBe(true);
    expect(changes(d.cur.p)).toBe(1);
    expect(remembered(d.cur.p, sewObjects(d.cur.p)[1])?.fill).toBeTruthy();
  });

  it('back to a fill with no fill kept and no angle given, it is sewn as a fill, its stops gone', () => {
    // As an appliqué made of a satin's area keeps no fill: the rows get a direction of their own,
    // else nothing could be sewn and its stitches kept the stops of the appliqué it no longer is.
    const d = design();
    const a = sewObjects(d.cur.p)[1];
    const { kept: _k, ...m } = remembered(d.cur.p, a)!;
    const p = relearn(d.cur.p, (v) => remember(v, a, m));
    const f = { ...remembered(p, sewObjects(p)[0])!.fill!, angle: NaN };
    const q = fromApplique(p, [1], f, T)!;
    expect(q).toBeTruthy();
    expect(changes(q)).toBe(1);
    expect(Number.isFinite(remembered(q, sewObjects(q)[1])?.fill?.angle)).toBe(true);
    expect(sewObjects(q).map((o) => o.block)).toEqual([0, 0, 1]);
    checkSewDesign(q);
  });

  it('back to a fill when the fill it kept followed rows that are gone: straight rows in its angle', async () => {
    // As a fill made from a picture with curved rows (pattern 'follow') made an appliqué: its old
    // rows are gone, so going back used to fail and the appliqué could not become a fill again.
    for (const kept of [{ pattern: 'follow' as const }, { pattern: 'follow' as const, gradient: true }, { pattern: 'guided' as const }]) {
      const d = design();
      const a = sewObjects(d.cur.p)[1];
      const m = remembered(d.cur.p, a)!;
      const fill = { ...m.kept!.fill!, angle: 27, ...kept };
      const p = relearn(d.cur.p, (v) => remember(v, a, { ...m, kept: { ...m.kept, fill } }));
      expect(shapes(d, fromApplique(p, [1], remembered(p, sewObjects(p)[0])!.fill!, T)), kept.pattern).toBe(true);
      const back = remembered(d.cur.p, sewObjects(d.cur.p)[1])!;
      expect(back.applique).toBeUndefined();
      expect(back.fill).toMatchObject({ pattern: kept.gradient ? 'gradient' : 'tatami', angle: 27 });
      expect(changes(d.cur.p)).toBe(1);
      checkSewDesign(d.cur.p);
      checkAppliques(d.cur.p);
      await saveAndOpen(d);
      expect(remembered(d.cur.p, sewObjects(d.cur.p)[1])?.fill?.pattern).toBe(back.fill!.pattern);
    }
  });

  it('a blended fill made an appliqué and a fill again is one thread: its second thread went', async () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(ellipsePath(15, 15, 15, 15), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    expect(shapes(d, blendObject(d.cur.p, 0, COLORS[1], T))).toBe(true);
    expect(shapes(d, toApplique(d.cur.p, [0], T))).toBe(true);
    expect(sewObjects(d.cur.p)).toHaveLength(1);
    expect(shapes(d, fromApplique(d.cur.p, [0], remembered(d.cur.p, sewObjects(d.cur.p)[0])!.kept!.fill!, T))).toBe(true);
    expect(sewObjects(d.cur.p)).toHaveLength(1);
    expect(remembered(d.cur.p, sewObjects(d.cur.p)[0])?.fill?.deco?.blend).toBeUndefined();
    checkBlends(d.cur.p);
    checkFollowers(d.cur.p);
    await saveAndOpen(d);
  });

  it('counts as covered: no gaps reported inside the piece', () => {
    const d = design();
    const p = d.cur.p;
    const m = measurePattern(p, openOnPurpose(p, sewObjects(p)) ?? undefined);
    expect(m.gapsLow.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('shows its piece of fabric from the first stop, cut at the second', () => {
    const d = design();
    const p = d.cur.p;
    const [x] = appliquePieces(p);
    expect(x.fabric).toBe('woven');
    expect(p.cmd[x.place]).toBe(COLOR_CHANGE);
    expect(p.cmd[x.trim]).toBe(COLOR_CHANGE);
    expect(x.first < x.place && x.place < x.trim && x.trim < x.last).toBe(true);
    expect(x.form.paths.every((path) => path.closed)).toBe(true);
  });

  it('is picked by a click on its fabric, not only on its edge; threads on top win', async () => {
    /** The object a click at (x, y) mm picks with the whole design shown (reach 0.3 mm, as zoomed in). */
    const pick = (p: Pattern, x: number, y: number, limit = p.cmd.length - 1) => {
      const at = new Int32Array(p.cmd.length).fill(-1);
      for (const o of sewObjects(p)) at.fill(o.index, o.first, o.last + 1);
      return objectAtPoint(p, at, x * 10, y * 10, 3, limit, undefined);
    };
    /** Every piece of fabric picks its own appliqué on its cloth (2.5 mm in: past its edge, beside the disc). */
    const ownCloth = (p: Pattern) => {
      const pieces = appliquePieces(p);
      expect(pieces.length).toBeGreaterThan(0);
      for (const x of pieces) {
        const at = pointOnCloth(x, 2.5)!;
        expect(sewObjects(p)[pick(p, ...at)]?.first, `cloth at ${at}`).toBe(x.first);
      }
    };
    const d = design();
    let p = d.cur.p;
    // The middle of the circle: no stitch within reach, only the cloth.
    expect(pick(p, 15, 15)).toBe(1);
    expect(pick(p, 15, 0)).toBe(1);
    expect(pick(p, 45, 15)).toBe(-1);
    // Not laid on yet: nothing there. Laid on, not cut yet: the rough piece, 6 mm of room around.
    const [x] = appliquePieces(p);
    expect(pick(p, 15, 15, x.place - 1)).toBe(-1);
    expect(pick(p, 33, 15, x.place)).toBe(1);
    expect(pick(p, 33, 15)).toBe(-1);
    // A disc sewn on top of it is found on its own stitches, the cloth around it still picks the appliqué.
    expect(shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(15, 15, 4, 4), ID), kind: 'fill' }, COLORS[1], null, options)!.pattern)).toBe(true);
    p = d.cur.p;
    expect(sewObjects(p)[pick(p, 15, 15)].first).toBeGreaterThan(x.last);
    expect(pick(p, 15, 6)).toBe(1);
    checkAppliques(p);

    // Duplicated, mirrored, left out under the disc, undone, saved and opened: each finds its own cloth.
    expect(shapes(d, duplicateObject(d.cur.p, 1, T, 50)?.pattern)).toBe(true);
    ownCloth(d.cur.p);
    const dup = sewObjects(d.cur.p).filter((o) => remembered(d.cur.p, o)?.applique).at(-1)!.index;
    expect(transform(d, [dup], mirrorMatrix('x', { minX: 50, minY: 50, maxX: 80, maxY: 80 }))).toBe(true);
    ownCloth(d.cur.p);
    checkAppliques(d.cur.p);
    // A fill sewn before it, under its cloth: hidden there, left out or not, the cloth picks the appliqué.
    expect(shapes(d, addShape(d.cur.p, { form: parsePath(rectPath(-2, 2, 34, 26, 0, 0), ID), kind: 'fill' }, COLORS[0], 0, options)!.pattern)).toBe(true);
    const under = sewObjects(d.cur.p).findIndex((o) => !remembered(d.cur.p, o)?.applique && o.first < appliquePieces(d.cur.p)[0].first && o.index > 0);
    expect(under).toBe(1);
    const k = setKnockout(d.cur.p, [under], true, T);
    expect(k).toBeTruthy();
    d.commit(k!.pattern);
    expect(remembered(d.cur.p, sewObjects(d.cur.p)[under])?.knockout).toBe(true);
    ownCloth(d.cur.p);
    // Undone, the fill is sewn there again, but under the cloth: the cloth still picks the appliqué.
    const at = pointOnCloth(appliquePieces(d.cur.p)[0], 2.5)!;
    const prev = d.undo.pop()!;
    const now = d.cur;
    d.redo.push(now);
    d.cur = prev;
    backToVersion(prev.p);
    expect(pick(d.cur.p, ...at)).toBe(2);
    ownCloth(d.cur.p);
    checkAppliques(d.cur.p);
    d.redo.pop();
    d.undo.push(prev);
    d.cur = now;
    backToVersion(now.p);
    ownCloth(d.cur.p);
    await saveAndOpen(d);
    ownCloth(d.cur.p);
    checkAppliques(d.cur.p);
  });

  it('a second one laid on over the edge of the first covers it, and both are numbered in their thread', () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(ellipsePath(15, 15, 15, 15), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    expect(shapes(d, toApplique(d.cur.p, [0], T))).toBe(true);
    shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(36, 15, 10, 10), ID), kind: 'fill' }, COLORS[0], 0, options)!.pattern);
    expect(shapes(d, toApplique(d.cur.p, [1], T))).toBe(true);
    const p = d.cur.p;
    checkAppliques(p);
    const objs = sewObjects(p);
    const [a, b] = appliquePieces(p);
    expect(b.place).toBeGreaterThan(a.last);
    // On the edge of the first, inside the second: the second's cloth lies over the first's satin.
    const at = new Int32Array(p.cmd.length).fill(-1);
    for (const o of objs) at.fill(o.index, o.first, o.last + 1);
    expect(objectAtPoint(p, at, 300, 150, 3, p.cmd.length - 1)).toBe(1);
    // Before it is laid on, the first's edge is what is there.
    expect(objectAtPoint(p, at, 300, 150, 3, b.place - 1)).toBe(0);
    // One thread: Applikation 1 and 2, though the stops of the first open new blocks.
    const inner = innerStops(p);
    const appliques = new Set([0, 1]);
    expect(objs[1].block).toBeGreaterThan(objs[0].block);
    expect(objs.map((o) => numberInColor(objs, o, inner, appliques))).toEqual([1, 2]);
    expect(colorBlockOf(objs[1].block, inner)).toBe(objs[0].block);
  });

  it('a border put after a fill before it goes after its edge, not between its parts', () => {
    // The square before the appliqué gets a border in another thread: it goes after the color's run.
    const d = design();
    expect(restitchFill(d, 0, remembered(d.cur.p, d.objects[0])!.fill!, new Set(), { type: 'run', width: 2, length: 2.5, tolerance: 0.15, link: 'b1', color: COLORS[2] })).toBe(true);
    const p = d.cur.p;
    checkAppliques(p);
    const a = sewObjects(p).find((o) => remembered(p, o)?.applique)!;
    const border = sewObjects(p).find((o) => remembered(p, o)?.outline === 'b1')!;
    expect(border.first).toBeGreaterThan(a.last);
  });

  it('names its stops on the stitch sheet and keeps them out of the list of threads to change', () => {
    const d = design();
    const p = d.cur.p;
    const html = sheetHtml({ pattern: p, name: 'A', hoop: null, profile: { fabric: 'woven', thread: '40' }, machine: { machineSpm: 800, trimSeconds: 3, colorSeconds: 30 }, card: cardView(recipeCard('woven', '40', { stitches: 3000, perCm2: 60, largestFillCm2: 5, widthMm: 50, heightMm: 40, minLetterMm: null })) });
    const rows = html.match(/<tr class="stop">/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(html.indexOf(t('applique.stop.place'))).toBeLessThan(html.indexOf(t('applique.stop.trim')));
    expect(innerStops(p)).toEqual(new Set([1, 2]));
  });

  it('gives its cutting template as an SVG at true size', () => {
    const d = design();
    const svg = cutLinesSvg(cutForms(d.cur.p))!;
    expect(svg).toContain('width="34mm"');
    expect(svg).toContain('viewBox="0 0 34 34"');
    expect(svg.match(/<path/g)).toHaveLength(1);
  });
});
