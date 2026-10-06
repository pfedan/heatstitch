import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recolor } from '../src/model/recolor';
import { pecColor } from '../src/parsers/pecPalette';
import { parseVp3 } from '../src/parsers/vp3';
import { BROTHER, inCatalog, nearest, search, setCatalogs, threadCode, threadNumber, type Catalog } from '../src/threads/catalog';
import { writeVp3 } from '../src/writers/vp3';
import { Shape } from './helpers/shapes';

const file = JSON.parse(new TextDecoder().decode(readFileSync(new URL('../public/threads/catalogs.json', import.meta.url))));
const all = setCatalogs(file);
const byName = (n: string): Catalog => all.find((c) => c.name === n)!;

describe('thread catalogs', () => {
  it('has Brother first and the common brands before the others', () => {
    expect(all[0].id).toBe(BROTHER);
    for (const n of ['Madeira Polyneon', 'Madeira Rayon', 'Isacord Polyester', 'Gunold Polyester', 'Gütermann Creativ Dekor', 'Sulky Rayon', 'Robison-Anton Polyester', 'Marathon Polyester'])
      expect(byName(n)?.common).toBe(true);
    const firstOther = all.findIndex((c) => !c.common);
    expect(all.slice(firstOther).every((c) => !c.common)).toBe(true);
    // Brother's numbers are only lent to the PEC palette, not a list of their own.
    expect(all.some((c) => c.id === 'brother-embroidery')).toBe(false);
  });

  it('holds sane threads: each with a color, a name and a number unique in its catalog', () => {
    for (const c of all.slice(1)) {
      expect(c.threads.length).toBeGreaterThanOrEqual(10);
      const nums = c.threads.map((t) => t.catalog);
      expect(new Set(nums).size, c.name).toBe(nums.length);
      for (const t of c.threads) {
        expect(t.brand).toBe(c.name);
        expect(t.name || t.catalog).toBeTruthy();
        for (const v of [t.r, t.g, t.b]) expect(v >= 0 && v <= 255).toBe(true);
      }
    }
  });

  it('finds a thread by its number, a full number first', () => {
    const madeira = byName('Madeira Polyneon');
    const r = search(madeira, '1610');
    expect(r[0]).toMatchObject({ catalog: '1610', name: 'Celestial Blue' });
    expect(search(madeira, '16').every((t) => t.catalog!.startsWith('16') || t.name!.toLowerCase().includes('16'))).toBe(true);
    expect(search(madeira, 'celestial').map((t) => t.catalog)).toContain('1610');
    // Leading zeros do not matter.
    expect(search(byName('Isacord Polyester'), '15')[0].catalog).toBe('0015');
  });

  it('suggests the nearest threads, an exact one at distance 0', () => {
    const madeira = byName('Madeira Polyneon');
    const t = madeira.threads[10];
    const [m] = nearest({ r: t.r, g: t.g, b: t.b }, madeira);
    expect(m.dE).toBeCloseTo(0, 5);
    const three = nearest({ r: 200, g: 30, b: 40 }, madeira, 3);
    expect(three).toHaveLength(3);
    expect(three[0].dE).toBeLessThanOrEqual(three[1].dE);
    expect(three[1].dE).toBeLessThanOrEqual(three[2].dE);
  });

  it('knows which threads belong to a catalog', () => {
    const madeira = byName('Madeira Polyneon');
    const isacord = byName('Isacord Polyester');
    expect(inCatalog({ ...madeira.threads[3] }, madeira)).toBe(madeira.threads[3]);
    expect(inCatalog({ ...madeira.threads[3] }, isacord)).toBeUndefined();
    expect(inCatalog(pecColor(5), all[0])).toBeTruthy();
    expect(inCatalog(madeira.threads[3], all[0])).toBeUndefined();
  });

  it('names maker and number, also for colors of the Brother palette', () => {
    expect(threadCode(byName('Madeira Polyneon').threads[0])).toBe('Madeira Polyneon 1610');
    const black = pecColor(20);
    expect(black.name).toBe('Black');
    expect(threadCode(black)).toBe('Brother 900');
    expect(threadNumber(black)).toBe('900');
    expect(threadCode({ r: 1, g: 2, b: 3 })).toBe('');
  });

  it('keeps maker and number of a chosen thread through VP3', () => {
    const t = byName('Madeira Polyneon').threads[0];
    const p = recolor(new Shape().to(0, 0).to(5, 0).to(10, 0).build(), 0, t);
    const back = parseVp3(writeVp3(p)).colors[0];
    expect(back).toMatchObject({ r: t.r, g: t.g, b: t.b, brand: 'Madeira Polyneon', catalog: '1610' });
  });
});
