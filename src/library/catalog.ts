/**
 * The motif library (public/library, built by tools/library/build.mjs): its sources, each with its
 * license and motifs, and the motifs themselves, loaded one category at a time. A source is one
 * kind of file: `svg` is sewn by the app when it is put in (see sew.ts); stitch files and projects
 * can join later as kinds of their own.
 */

export interface Motif {
  id: string;
  /** Category (see CATEGORY_KEYS). */
  c: string;
  /** Name and keywords, German and English. */
  de: string;
  en: string;
  tde: string[];
  ten: string[];
}

export interface Source {
  id: string;
  name: string;
  kind: 'svg';
  /** SPDX id of the motifs' license, and the line that credits their makers. */
  license: string;
  credit: string;
  url: string;
  commit?: string;
  /** Where its category files are, relative to the app. */
  base: string;
  categories: string[];
  motifs: Motif[];
}

export interface Library {
  sources: Source[];
}

const base = () => import.meta.env.BASE_URL;

let library: Promise<Library> | null = null;
const packs = new Map<string, Promise<Record<string, string>>>();

/** The sources and their motifs (loaded once; comes with the installed app). */
export function loadLibrary(): Promise<Library> {
  library ??= fetch(`${base()}library/index.json`).then((r) => {
    if (!r.ok) throw new Error(`library: ${r.status}`);
    return r.json() as Promise<Library>;
  });
  library.catch(() => (library = null));
  return library;
}

/** The files of the motifs of one category of a source, by motif id (loaded once and kept). */
export function loadPack(source: Source, category: string): Promise<Record<string, string>> {
  const key = `${source.id}/${category}`;
  let p = packs.get(key);
  if (!p) {
    p = fetch(`${base()}${source.base}${encodeURIComponent(category)}.json`).then((r) => {
      if (!r.ok) throw new Error(`motifs ${key}: ${r.status}`);
      return r.json() as Promise<Record<string, string>>;
    });
    p.catch(() => packs.delete(key));
    packs.set(key, p);
  }
  return p;
}

/** The file of one motif. */
export async function motifFile(source: Source, m: Motif): Promise<string> {
  const svg = (await loadPack(source, m.c))[m.id];
  if (!svg) throw new Error(`motif ${source.id}/${m.id} missing`);
  return svg;
}

/** Folds case and accents, so "kafer" finds "Käfer". */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * Motifs for a search, best first: every word must occur in the name or a keyword, in either
 * language. A match in the name of the language shown counts most, a whole word more than the
 * start of one, and that more than a part (German joins words: "Käfer" finds "Marienkäfer").
 */
export function searchMotifs(motifs: readonly Motif[], query: string, lang: 'de' | 'en'): Motif[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...motifs];
  const other = lang === 'de' ? 'en' : 'de';
  const scored: { m: Motif; s: number }[] = [];
  for (const m of motifs) {
    const name = fold(m[lang]);
    const tags = (lang === 'de' ? m.tde : m.ten).map(fold);
    const rest = [fold(m[other]), ...(lang === 'de' ? m.ten : m.tde).map(fold)];
    let s = 0;
    for (const w of words) {
      const best = Math.max(hit(name, w) * 3, ...tags.map((t) => hit(t, w) * 2), ...rest.map((t) => hit(t, w)));
      if (!best) {
        s = 0;
        break;
      }
      s += best;
    }
    // Shorter names first among equals: "Fuchs" before "Fuchsgesicht".
    if (s) scored.push({ m, s: s - name.length / 1000 });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.m);
}

/** 3: the whole text, 2: the start of a word in it, 1: inside a word (from 3 letters on), 0: none. */
function hit(text: string, w: string): number {
  if (text === w) return 3;
  const i = text.indexOf(w);
  if (i < 0) return 0;
  if (i === 0 || /[\s\-(:,]/.test(text[i - 1])) return 2;
  return w.length >= 3 ? 1 : 0;
}
