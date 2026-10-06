import { describe, expect, it } from 'vitest';
import { cardView } from '../src/areas/ready/card';
import { designFigures } from '../src/areas/ready/figures';
import { extraLayers, recipeCard, RECIPES, type DesignFigures } from '../src/areas/ready/recipes';
import { BOX, layout, sheetHtml } from '../src/areas/ready/sheet';
import { de, en } from '../src/i18n/areas/ready';
import { PatternBuilder, STITCH } from '../src/model/pattern';
import { FABRICS } from '../src/validation/profiles';

const plain: DesignFigures = { stitches: 3000, perCm2: 60, largestFillCm2: 5, widthMm: 50, heightMm: 40, minLetterMm: null };

/** A square of stitches `mm` wide, in 0.1 mm. */
function square(mm: number) {
  const b = new PatternBuilder();
  for (const [dx, dy] of [[0, 0], [mm, 0], [0, mm], [-mm, 0], [0, -mm]]) b.add(dx * 10, dy * 10, STITCH);
  return b.build('square', 'dst', [{ r: 200, g: 40, b: 90 }]);
}

describe('ready: recipes', () => {
  it('has a recipe for every fabric of the app, with at most 3 tips', () => {
    for (const f of FABRICS) {
      expect(RECIPES[f.id], f.id).toBeTruthy();
      expect(RECIPES[f.id].tips.length).toBeLessThanOrEqual(3);
    }
  });

  it('adds about one tear-away layer per further 10,000 stitches, at most 2 (rule of thumb)', () => {
    expect(extraLayers(9000)).toBe(0);
    expect(extraLayers(10_001)).toBe(1);
    expect(extraLayers(23_000)).toBe(2);
    expect(extraLayers(80_000)).toBe(2);
    const c = recipeCard('woven', '40', { ...plain, stitches: 23_000 });
    expect(c.extraLayers).toBe(2);
    expect(c.hints.some((h) => h.text === 'ready.hint.layers' && h.basis === 'rule')).toBe(true);
  });

  it('takes the stronger stabilizer for dense designs, and warns on delicate fabric', () => {
    const woven = recipeCard('woven', '40', { ...plain, perCm2: 140 });
    expect(woven.stabilizer).toBe(RECIPES.woven.stabilizerDense);
    expect(woven.stronger?.text).toBe('ready.reason.dense');
    expect(recipeCard('woven', '40', plain).stabilizer).toBe(RECIPES.woven.stabilizer);
    const knit = recipeCard('knit', '40', { ...plain, largestFillCm2: 30 });
    expect(knit.hints[0]).toMatchObject({ level: 'warn', text: 'ready.hint.denseDelicate' });
  });

  it('cares for small lettering: thin thread hint, topping on pile', () => {
    expect(recipeCard('woven', '40', { ...plain, minLetterMm: 5 }).hints.map((h) => h.text)).toContain('ready.hint.smallText');
    expect(recipeCard('woven', '60', { ...plain, minLetterMm: 5 }).hints.map((h) => h.text)).not.toContain('ready.hint.smallText');
    expect(recipeCard('woven', '40', { ...plain, minLetterMm: 3 }).hints.map((h) => h.text)).toContain('ready.hint.tinyText');
    expect(recipeCard('woven', '40', { ...plain, minLetterMm: 8 }).hints).toEqual([]);
    expect(recipeCard('terry', '40', { ...plain, minLetterMm: 5 }).topping.need).toBe('always');
    expect(recipeCard('knit', '40', { ...plain, minLetterMm: 5 }).topping.text).toBe('ready.topping.forText');
  });

  it('warns about tall designs on caps and thick thread', () => {
    expect(recipeCard('cap', '40', { ...plain, heightMm: 70 }).hints.map((h) => h.text)).toContain('ready.hint.capTall');
    const thick = recipeCard('woven', '12', plain);
    expect(thick.threadNeedle?.text).toBe('ready.thread.needle12');
    expect(thick.hints.map((h) => h.text)).toContain('ready.hint.thread12');
  });

  it('leather floats and goes slow', () => {
    const c = recipeCard('leather', '40', plain);
    expect(c.hooping.method).toBe('float');
    expect(c.speed.step).toBe('slow');
  });
});

describe('ready: texts', () => {
  it('has German and English for every key and no long dashes', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    for (const s of [...Object.values(de), ...Object.values(en)]) expect(s).not.toMatch(/[–—]/);
  });

  it('names no brand and no fixed stitches per minute in its advice', () => {
    const advice = ([...Object.entries(de), ...Object.entries(en)] as [string, string][])
      .filter(([k]) => !k.startsWith('ready.sheet.'))
      .map(([, v]) => v)
      .join('\n');
    for (const brand of ['Madeira', 'Gunold', 'Sulky', 'Floriani', 'Schmetz', 'Isacord', 'Vlieseline', 'Brother', 'Janome', 'Microtex', 'Polymesh'])
      expect(advice).not.toContain(brand);
    expect(advice).not.toMatch(/\d+\s*(Stiche|stitches)\s*(pro Minute|per minute|\/\s*min)/);
  });

  it('every key a recipe names exists', () => {
    for (const r of Object.values(RECIPES)) {
      const keys = [r.stabilizer, r.stabilizerDense, r.topping, r.needle, r.thread, r.speed, r.hooping, ...r.tips].map((v) => v.text);
      if (r.needle.alt) keys.push(r.needle.alt);
      for (const k of keys) expect(de, k).toHaveProperty([k]);
    }
  });
});

describe('ready: stitch sheet', () => {
  it('measures stitches per area and size', () => {
    const f = designFigures(square(40), undefined, null);
    expect(f.stitches).toBe(5);
    expect(f.widthMm).toBe(40);
  });

  it('draws at true size in mm and fits one sheet when it can', () => {
    const p = square(60);
    const l = layout(p, { w: 100, h: 100 });
    expect(l.tiles).toHaveLength(1);
    expect(l.hoopWhole).toBe(true);
    const html = sheetHtml({ pattern: p, name: 'Test <1>', hoop: { w: 100, h: 100 }, profile: { fabric: 'woven', thread: '40' }, machine: { machineSpm: 800, trimSeconds: 3, colorSeconds: 30 }, card: cardView(recipeCard('woven', '40', plain)) });
    // The drawing's width in mm equals its viewBox width in mm: 1:1.
    const m = html.match(/<svg class="drawing" width="([\d.]+)mm" height="([\d.]+)mm" viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/);
    expect(m).toBeTruthy();
    expect(m![1]).toBe(m![3]);
    expect(m![2]).toBe(m![4]);
    expect(html).toContain('@page');
    expect(html).toContain('Test &#60;1&#62;');
  });

  it('splits a design larger than a sheet into overlapping sheets', () => {
    const l = layout(square(300), null);
    expect(l.tiles.length).toBeGreaterThan(1);
    for (const t of l.tiles) expect(t.w).toBeLessThanOrEqual(BOX.w);
    // Together they cover the whole area.
    const right = Math.max(...l.tiles.map((t) => t.x + t.w));
    expect(right).toBeGreaterThanOrEqual(l.area.x + l.area.w - 0.01);
  });
});
