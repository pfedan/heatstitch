import { describe, expect, it } from 'vitest';
import { addShape } from '../src/model/addShape';
import { appliquePieces, appliqueStops, cutLinesSvg, innerStops, tackInset } from '../src/model/applique';
import { sheetHtml } from '../src/areas/ready/sheet';
import { cardView } from '../src/areas/ready/card';
import { recipeCard } from '../src/areas/ready/recipes';
import { t } from '../src/i18n';
import { cutForms, fromApplique, setApplique, toApplique } from '../src/model/appliqueOps';
import { colorBlocks } from '../src/model/sequence';
import { sewObjects } from '../src/model/objects';
import { COLOR_CHANGE, STITCH, type Pattern } from '../src/model/pattern';
import { remembered } from '../src/model/restitch';
import { reorder } from '../src/model/order';
import { recolor } from '../src/model/recolor';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { COLORS, Doc, ID, T, empty, options, saveAndOpen, shapes, transform, checkWellFormed, checkSewDesign, checkExport, checkAppliques, restitchFill } from './helpers/torture';
import { mirrorMatrix, duplicateObject } from '../src/model/shapeOps';
import { rotation, translation } from '../src/shape/path';
import { measurePattern } from '../src/validation/measure';
import { openOnPurpose } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { writePattern } from '../src/writers';

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
    expect(median(radii(1))).toBeCloseTo(15 - tackInset(3), 0);
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

  it('a recolor takes the stops along, and back to a fill it is sewn as before', () => {
    const d = design();
    const q = recolor(d.cur.p, 0, { r: 1, g: 2, b: 3 });
    expect(q.colors.slice(0, 3).every((c) => c.r === 1)).toBe(true);
    const f = remembered(d.cur.p, sewObjects(d.cur.p)[0])!.fill!;
    expect(shapes(d, fromApplique(d.cur.p, [1], f, T))).toBe(true);
    expect(changes(d.cur.p)).toBe(1);
    expect(remembered(d.cur.p, sewObjects(d.cur.p)[1])?.fill).toBeTruthy();
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
