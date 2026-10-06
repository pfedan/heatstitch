import { describe, expect, it } from 'vitest';
import { cardView } from '../src/areas/ready/card';
import { designFigures } from '../src/areas/ready/figures';
import { extraLayers, recipeCard, RECIPES, type DesignFigures } from '../src/areas/ready/recipes';
import { BOX, layout, sheetHtml } from '../src/areas/ready/sheet';
import { de, en } from '../src/i18n/areas/ready';
import { de as fabricDe, en as fabricEn } from '../src/i18n/areas/fabrics';
import { de as ampelDe, en as ampelEn } from '../src/i18n/areas/ampel';
import { RED_MIN_MM2 } from '../src/areas/ampel/standin';
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

  it('does not call an ordinary small design dense (the demo flower: about 2,800 stitches, 129 per cm²)', () => {
    const flower: DesignFigures = { stitches: 2809, perCm2: 129, largestFillCm2: 8.8, widthMm: 54, heightMm: 87, minLetterMm: null };
    for (const f of FABRICS) expect(recipeCard(f.id, '40', flower).stronger, f.id).toBeNull();
    // Narrow satin lettering measures about 200 per cm² and is not dense either.
    expect(recipeCard('woven', '40', { ...plain, perCm2: 207 }).stronger).toBeNull();
  });

  it('takes the stronger stabilizer for dense designs, and warns on delicate fabric', () => {
    const woven = recipeCard('woven', '40', { ...plain, perCm2: 270 });
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
    expect(c.speed.maxSpm).toBeLessThanOrEqual(500);
  });

  it('recommends a maximum speed: none on woven, lower on caps and delicate fabric, lower again for the design', () => {
    expect(recipeCard('woven', '40', plain).speed.maxSpm).toBeNull();
    expect(recipeCard('cap', '40', plain).speed.maxSpm).toBe(400);
    expect(recipeCard('knit', '40', plain).speed.maxSpm).toBe(600);
    const dense = recipeCard('woven', '40', { ...plain, perCm2: 270 });
    expect(dense.speed).toMatchObject({ maxSpm: 600, basis: 'rule', why: 'ready.speed.why.dense' });
    expect(recipeCard('woven', '12', plain).speed).toMatchObject({ maxSpm: 500, why: 'ready.speed.why.thick' });
    expect(recipeCard('woven', '40', { ...plain, minLetterMm: 5 }).speed.why).toBe('ready.speed.why.text');
    // Never raised: a cap stays at 400 for a dense design.
    expect(recipeCard('cap', '40', { ...plain, perCm2: 270 }).speed.maxSpm).toBe(400);
  });

  it('says when the machine is set faster than recommended', () => {
    const notes = (spm: number) => cardView(recipeCard('knit', '40', plain), spm).rows.find((r) => r.id === 'speed')!.notes.map((n) => n.text);
    expect(notes(800).some((n) => n.includes('800'))).toBe(true);
    expect(notes(500).some((n) => n.includes('500'))).toBe(false);
  });

  it('heavy woven: like woven, but a 90/14 needle', () => {
    const c = recipeCard('woven_heavy', '40', plain);
    expect(c.needle.size).toBe('90/14');
    expect(c.stabilizer.kind).toBe('tear');
    expect(recipeCard('woven_heavy', '40', { ...plain, stitches: 23_000 }).extraLayers).toBe(2);
    expect(cardView(c).summary).toContain('90/14');
  });

  it('fleece: cut-away, always topping, heavy cut-away only for many stitches', () => {
    const c = recipeCard('fleece', '40', plain);
    expect(c.stabilizer.kind).toBe('cut');
    expect(c.topping.need).toBe('always');
    expect(c.needle.text).toBe('ready.needle.ballpoint');
    expect(recipeCard('fleece', '40', { ...plain, stitches: 15_000 }).stronger).toBeNull();
    const many = recipeCard('fleece', '40', { ...plain, stitches: 25_000 });
    expect(many.stabilizer).toBe(RECIPES.fleece.stabilizerDense);
    expect(many.stabilizer.weight).toBe('heavy');
    expect(recipeCard('fleece', '40', { ...plain, minLetterMm: 5 }).topping.text).toBe('ready.topping.forText');
  });

  it('sheer: wash-away, slower, and a warning for dense designs', () => {
    const c = recipeCard('sheer', '40', plain);
    expect(c.stabilizer.kind).toBe('wash');
    expect(c.speed.maxSpm).toBe(500);
    expect(c.hints).toEqual([]);
    const dense = recipeCard('sheer', '40', { ...plain, largestFillCm2: 30 });
    expect(dense.stabilizer).toBe(RECIPES.sheer.stabilizerDense);
    expect(dense.hints[0]).toMatchObject({ level: 'warn', text: 'ready.hint.denseDelicate' });
  });
});

describe('ready: rules of thumb read as such', () => {
  it('marks every rule of thumb and disputed value, and lists the marks in the legend', () => {
    for (const f of FABRICS) {
      const v = cardView(recipeCard(f.id, '40', { ...plain, perCm2: 270, stitches: 23_000, minLetterMm: 5 }));
      const shown = [
        ...v.rows.flatMap((r) => [r.basis, ...r.notes.map((n) => n.basis)]),
        ...v.hints.map((x) => x.basis),
        v.hooping.basis,
        ...v.tips.map((x) => x.basis),
      ];
      for (const b of ['rule', 'disputed'] as const) expect(v.marks.includes(b), `${f.id} ${b}`).toBe(shown.includes(b));
    }
  });

  it('marks why the stabilizer is stronger as a rule of thumb', () => {
    const v = cardView(recipeCard('woven', '40', { ...plain, perCm2: 270 }));
    const stab = v.rows.find((r) => r.id === 'stab')!;
    expect(stab.notes[0].basis).toBe('rule');
  });

  it('marks every speed that is not from a source', () => {
    for (const f of FABRICS) {
      const v = cardView(recipeCard(f.id, '40', plain));
      const speed = v.rows.find((r) => r.id === 'speed')!;
      expect(speed.basis === undefined || ['source', 'rule', 'disputed'].includes(speed.basis), f.id).toBe(true);
      if (RECIPES[f.id].speed.basis === 'rule') expect(v.marks, f.id).toContain('rule');
    }
  });
});

describe('fabric profiles', () => {
  it('every fabric has a name and examples in German and English, a light name and a red threshold', () => {
    expect(Object.keys(fabricEn).sort()).toEqual(Object.keys(fabricDe).sort());
    for (const f of FABRICS) {
      for (const k of [`fabric.${f.id}`, `fabric.${f.id}.ex`]) {
        expect(fabricDe, k).toHaveProperty([k]);
        expect(fabricEn, k).toHaveProperty([k]);
      }
      for (const k of [`ampel.fabric.${f.id}`, `ampel.cmd.fabric.${f.id}`]) {
        expect(ampelDe, k).toHaveProperty([k]);
        expect(ampelEn, k).toHaveProperty([k]);
      }
      expect(RED_MIN_MM2[f.id], f.id).toBeGreaterThan(0);
    }
    for (const s of [...Object.values(fabricDe), ...Object.values(fabricEn)]) expect(s).not.toMatch(/[–—]/);
  });

  it('woven-like fabrics turn red from 5 mm², knit-like and delicate ones from 3 mm²', () => {
    expect(RED_MIN_MM2.woven_heavy).toBe(RED_MIN_MM2.woven);
    expect(RED_MIN_MM2.fleece).toBe(RED_MIN_MM2.knit);
    expect(RED_MIN_MM2.sheer).toBe(3);
  });
});

describe('ready: texts', () => {
  it('has German and English for every key and no long dashes', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    for (const s of [...Object.values(de), ...Object.values(en)]) expect(s).not.toMatch(/[–—]/);
  });

  it('names no brand in its advice and does not address the reader', () => {
    const advice = ([...Object.entries(de), ...Object.entries(en)] as [string, string][])
      .filter(([k]) => !k.startsWith('ready.sheet.'))
      .map(([, v]) => v)
      .join('\n');
    for (const brand of ['Madeira', 'Gunold', 'Sulky', 'Floriani', 'Schmetz', 'Isacord', 'Vlieseline', 'Brother', 'Janome', 'Microtex', 'Polymesh'])
      expect(advice).not.toContain(brand);
    // A calm, factual tone: no "du" sentences, no exclamations (the time note of the sheet aside).
    const card = ([...Object.entries(de)] as [string, string][]).filter(([k]) => k !== 'ready.sheet.timeNote').map(([, v]) => v).join('\n');
    expect(card).not.toMatch(/\b(du|dein|deine|dir|dich)\b/i);
    expect(advice).not.toContain('!');
  });

  it('every key a recipe names exists', () => {
    for (const r of Object.values(RECIPES)) {
      const keys = [r.stabilizer, r.stabilizerDense, r.topping, r.needle, r.thread, r.hooping, ...r.tips].map((v) => v.text);
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
    const html = sheetHtml({ pattern: p, name: 'Test <1>', hoop: { w: 100, h: 100 }, profile: { fabric: 'woven', thread: '40' }, spm: 800, card: cardView(recipeCard('woven', '40', plain)) });
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
