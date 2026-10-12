import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchMotifs, type Library, type Motif } from '../src/library/catalog';
import { sized } from '../src/library/sew';
import { de, en } from '../src/i18n/areas/library';

const root = new URL('../public/', import.meta.url).pathname;
const library = JSON.parse(readFileSync(`${root}library/index.json`, 'utf8')) as Library;
const excluded = JSON.parse(readFileSync(new URL('../tools/library/excluded.json', import.meta.url), 'utf8')) as { source: string; id: string }[];

describe('motif library', () => {
  it('has a file for every motif, and no file without one', () => {
    for (const s of library.sources) {
      const ids = new Set<string>();
      for (const c of s.categories) {
        const pack = JSON.parse(readFileSync(`${root}${s.base}${c}.json`, 'utf8')) as Record<string, string>;
        const listed = s.motifs.filter((m) => m.c === c).map((m) => m.id);
        expect(Object.keys(pack).sort(), `${s.id}/${c}`).toEqual(listed.sort());
        for (const [id, svg] of Object.entries(pack)) {
          expect(svg, `${s.id}/${id}`).toMatch(/^<svg\b[^>]*viewBox=/);
          ids.add(id);
        }
      }
      expect(ids.size, `${s.id}: one file per motif`).toBe(s.motifs.length);
    }
  });

  it('names its license and credit, and every motif in both languages', () => {
    expect(existsSync(`${root}library/LICENSE.md`)).toBe(true);
    for (const s of library.sources) {
      expect(['CC-BY-4.0', 'CC0-1.0', 'OFL-1.1', 'MIT']).toContain(s.license);
      expect(s.credit.length).toBeGreaterThan(5);
      for (const m of s.motifs) {
        expect(m.de.trim(), m.id).not.toBe('');
        expect(m.en.trim(), m.id).not.toBe('');
      }
      // A chip and a name for every category.
      for (const c of s.categories) expect(de[`library.cat.${c}` as keyof typeof de], c).toBeTruthy();
    }
  });

  it('leaves out the motifs that did not pass Prüfen', () => {
    for (const e of excluded) {
      const s = library.sources.find((x) => x.id === e.source)!;
      expect(s.motifs.some((m) => m.id === e.id), `${e.source}/${e.id}`).toBe(false);
    }
  });

  it('has the same texts in English as in German', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });
});

describe('searchMotifs', () => {
  const motif = (id: string, de: string, en: string, tde: string[] = [], ten: string[] = []): Motif => ({ id, c: 'animals', de, en, tde, ten });
  const all = [motif('a', 'Fuchsgesicht', 'fox face'), motif('b', 'Fuchs', 'fox'), motif('c', 'Marienkäfer', 'lady beetle', ['Käfer']), motif('d', 'Katze', 'cat', ['Haustier'], ['pet'])];
  const ids = (q: string, lang: 'de' | 'en' = 'de') => searchMotifs(all, q, lang).map((m) => m.id);

  it('finds by name, shorter names first', () => expect(ids('fuchs')).toEqual(['b', 'a']));
  it('folds case and umlauts', () => expect(ids('KAFER')).toEqual(['c']));
  it('finds parts of German compound words', () => expect(ids('käfer')).toEqual(['c']));
  it('finds by keyword and in the other language', () => {
    expect(ids('haustier')).toEqual(['d']);
    expect(ids('cat')).toEqual(['d']);
    expect(ids('pet', 'en')).toEqual(['d']);
  });
  it('needs every word', () => expect(ids('fuchs katze')).toEqual([]));
  it('shows all for an empty search', () => expect(ids('  ')).toHaveLength(4));
});

describe('sized', () => {
  it('gives the file a size in mm by its viewBox', () => {
    const s = sized('<svg xmlns="http://www.w3.org/2000/svg" width="36" viewBox="0 0 36 18"><path d="M0 0h1"/></svg>', 60);
    expect(s).toMatch(/^<svg width="60mm" height="30mm" xmlns/);
    expect(s).not.toMatch(/width="36"/);
  });
});
