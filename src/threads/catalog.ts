import { deltaE2000, rgbToLab, type Lab } from '../image/color';
import type { ThreadColor } from '../model/pattern';
import { pecThreads } from '../parsers/pecPalette';
import { STORAGE_NS } from '../storage/namespace';

/**
 * Thread catalogs: the colors one maker sells in one thread line, by number. Brother (the PEC
 * palette PES files store) is built in; the others come from public/threads/catalogs.json, loaded
 * the first time a list is opened.
 */
export interface Catalog {
  id: string;
  /** Maker and line, as on the spool ("Madeira Polyneon"). */
  name: string;
  /** Shown at the top of the list. */
  common?: boolean;
  threads: ThreadColor[];
}

/** The file as written by tools/threads/convert.mjs: per thread hex color, number and name. */
interface CatalogFile {
  source: string;
  license: string;
  catalogs: { id: string; name: string; common?: boolean; threads: [string, string, string][] }[];
}

export const BROTHER = 'brother';
/** Brother's numbers for the PEC colors; not a list of its own. */
const BROTHER_NUMBERS = 'brother-embroidery';

const fromFile = (c: CatalogFile['catalogs'][number]): Catalog => ({
  id: c.id,
  name: c.name,
  ...(c.common ? { common: true } : {}),
  threads: c.threads.map(([hex, number, name]) => ({
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    name,
    brand: c.name,
    ...(number ? { catalog: number } : {}),
  })),
});

let numbers = new Map<string, string>();
let loaded: Catalog[] | null = null;
let loading: Promise<Catalog[]> | null = null;

/** Takes the catalogs of a parsed catalogs.json (also for tests, without fetching). */
export function setCatalogs(file: CatalogFile): Catalog[] {
  const all = file.catalogs.map(fromFile);
  const brother = all.find((c) => c.id === BROTHER_NUMBERS);
  numbers = new Map((brother?.threads ?? []).map((t) => [t.name!.toLowerCase(), t.catalog ?? '']));
  loaded = [brotherCatalog(), ...all.filter((c) => c !== brother)];
  return loaded;
}

/** All catalogs, Brother first, then the common ones, then the others by name. */
export function loadCatalogs(): Promise<Catalog[]> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= fetch(`${import.meta.env.BASE_URL}threads/catalogs.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`threads: ${r.status}`);
      return r.json() as Promise<CatalogFile>;
    })
    .then(setCatalogs);
  loading.catch(() => (loading = null));
  return loading;
}

/** The catalogs once loaded, otherwise only Brother. */
export const catalogsNow = (): Catalog[] => loaded ?? [brotherCatalog()];

/** Brother's number for a color of the PEC palette (when the numbers are loaded). */
const brotherNumber = (name: string | undefined) => (name ? numbers.get(name.toLowerCase()) || undefined : undefined);

/**
 * The Brother palette as a catalog. Its colors stay PEC colors (with their slot), so PES files
 * keep saving them exactly.
 */
export function brotherCatalog(): Catalog {
  return { id: BROTHER, name: 'Brother', common: true, threads: pecThreads() };
}

/** Maker and number of a thread, as far as known ("Madeira Polyneon 1610"), or ''. */
export function threadCode(c: ThreadColor): string {
  if (c.brand || c.catalog) return [c.brand, c.catalog].filter(Boolean).join(' ');
  if (c.pecIndex !== undefined) {
    const n = brotherNumber(c.name);
    return n ? `Brother ${n}` : '';
  }
  return '';
}

/** The number alone, for the picker, where the catalog is already chosen. */
export function threadNumber(c: ThreadColor): string {
  return c.catalog ?? (c.pecIndex !== undefined ? (brotherNumber(c.name) ?? '') : '');
}

const labs = new WeakMap<ThreadColor, Lab>();
const labOf = (c: ThreadColor): Lab => {
  let l = labs.get(c);
  if (!l) labs.set(c, (l = rgbToLab(c.r, c.g, c.b)));
  return l;
};

export interface Match {
  thread: ThreadColor;
  /** CIEDE2000 difference to the color asked for. */
  dE: number;
}

/** The `n` threads of the catalog nearest to the color, closest first. */
export function nearest(c: ThreadColor, cat: Catalog, n = 1): Match[] {
  const lab = rgbToLab(c.r, c.g, c.b);
  const best: Match[] = [];
  for (const t of cat.threads) {
    const dE = deltaE2000(lab, labOf(t));
    if (best.length < n || dE < best[best.length - 1].dE) {
      best.push({ thread: t, dE });
      best.sort((a, b) => a.dE - b.dE);
      if (best.length > n) best.pop();
    }
  }
  return best;
}

/** The thread itself when it is one of this catalog (same number, or same color and name). */
export function inCatalog(c: ThreadColor, cat: Catalog): ThreadColor | undefined {
  if (cat.id === BROTHER) {
    if (c.brand && c.brand !== 'Brother') return undefined;
    // PES 5+ files store their own color for a palette thread: the name tells which one it is.
    if (c.pecIndex !== undefined && c.name) {
      const named = cat.threads.find((t) => t.name === c.name);
      if (named) return named;
    }
    return cat.threads.find((t) => t.r === c.r && t.g === c.g && t.b === c.b && (!c.name || t.name === c.name));
  }
  if (c.brand !== cat.name) return undefined;
  return cat.threads.find((t) => (c.catalog ? t.catalog === c.catalog : t.name === c.name));
}

/**
 * Threads matching what was typed: numbers from their start ("16" finds 1610 and 1622, a number
 * typed in full comes first), names by any word.
 */
export function search(cat: Catalog, query: string): ThreadColor[] {
  const q = query.trim().toLowerCase();
  if (!q) return cat.threads;
  const exact: ThreadColor[] = [];
  const start: ThreadColor[] = [];
  const named: ThreadColor[] = [];
  for (const t of cat.threads) {
    const num = threadNumber(t).toLowerCase();
    const bare = num.replace(/^0+(?=.)/, '');
    if (num && (num === q || bare === q.replace(/^0+(?=.)/, ''))) exact.push(t);
    else if (num && (num.startsWith(q) || bare.startsWith(q))) start.push(t);
    else if ((t.name ?? '').toLowerCase().includes(q)) named.push(t);
  }
  return [...exact, ...start, ...named];
}

/** How close a match is, in words: below 1 the eye sees no difference, from about 6 it is another shade. */
export type Closeness = 'same' | 'close' | 'near' | 'far';
export const closeness = (dE: number): Closeness => (dE < 1 ? 'same' : dE < 3 ? 'close' : dE < 6 ? 'near' : 'far');

const KEY = `${STORAGE_NS}.threadCatalog`;
let chosen: string | null = null;

/** The catalog last chosen in a color list (the same for every list). */
export function chosenCatalog(): string {
  try {
    chosen ??= localStorage.getItem(KEY);
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
  return chosen || BROTHER;
}

export function chooseCatalog(id: string): void {
  chosen = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // As above.
  }
}
