/**
 * Embroidery fonts: letters that are already digitized (satin columns with their rails and rungs,
 * running stitch, fills), made from the Ink/Stitch font library by tools/fonts/convert.mjs. All
 * lengths are millimetres at the height the font was digitized for, y down, the baseline at 0.
 */

/** Satin column: rails as flat x, y lists, rungs as flat pairs of distances along them. */
export interface SatinEl {
  k: 's';
  l: number[];
  r: number[];
  g: number[];
  /** spacing, pull per side, underlay, pull as share of the width, split length, E stitch */
  /**
   * Pull compensation as Ink/Stitch means it, for each side: `pc` mm and `ps` share of the width
   * (0.1 = 10 %); `pcb` and `psb` for the second rail when it differs.
   */
  p: { sp: number; pc: number; u: 'none' | 'center' | 'contour' | 'zigzag' | 'both'; ps?: number; pcb?: number; psb?: number; sl?: number; e?: 1 };
}

/** Running stitch along a path (flat x, y list); manual: the points are the stitches. */
export interface RunEl {
  k: 'r';
  d: number[];
  p: { len: number; tr?: 1; m?: 1 };
}

/** Fill of an area (closed loops as flat lists, even-odd). */
export interface FillEl {
  k: 'f';
  d: number[][];
  /** row spacing, stitch length, angle (degrees), underlay, stagger (fraction), expand */
  p: { sp: number; len: number; a: number; u: 0 | 1; o?: number; ex?: number };
}

export type GlyphEl = SatinEl | RunEl | FillEl;

export interface Glyph {
  /** Advance to the next letter. */
  a: number;
  /** Extent of its stitches. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Elements in sewing order. */
  e: GlyphEl[];
}

export interface Font {
  v: 1;
  id: string;
  name: string;
  /** Height of the capitals (of the tallest lowercase letters in a font without capitals). */
  cap: number;
  caps: boolean;
  /** Distance from line to line. */
  lead: number;
  /** Width of a space. */
  space: number;
  /** Text is shown in this case only. */
  case?: 'upper' | 'lower';
  /** Scale range the font was made for. */
  min: number;
  max: number;
  glyphs: Record<string, Glyph>;
  /** Kerning by pair of letters: subtracted from the advance. */
  kern: Record<string, number>;
  /** Lines may be sewn back and forth. */
  rev: boolean;
}

export type FontStyle = 'sans' | 'serif' | 'script' | 'display';

/** A font in the list, before it is loaded. */
export interface FontEntry {
  id: string;
  name: string;
  style: FontStyle;
  small?: boolean;
  script?: boolean;
  cap: number;
  /** Heights of the capitals it looks good at (mm). */
  good: [number, number];
  license: string;
  source?: string;
  /** Every letter it has. */
  chars: string;
  cases: 'Aa' | 'A' | 'a';
  kb: number;
}

export interface Catalog {
  source: string;
  commit: string;
  fonts: FontEntry[];
}

const base = () => import.meta.env.BASE_URL;

let catalog: Promise<Catalog> | null = null;
const fonts = new Map<string, Promise<Font>>();
const loaded = new Map<string, Font>();

/** The list of fonts (loaded once). */
export function loadCatalog(): Promise<Catalog> {
  catalog ??= fetch(`${base()}fonts/index.json`).then((r) => {
    if (!r.ok) throw new Error(`fonts: ${r.status}`);
    return r.json() as Promise<Catalog>;
  });
  catalog.catch(() => (catalog = null));
  return catalog;
}

/** A font, loaded once and kept. */
export function loadFont(id: string): Promise<Font> {
  let f = fonts.get(id);
  if (!f) {
    f = fetch(`${base()}fonts/${encodeURIComponent(id)}.json`).then(async (r) => {
      if (!r.ok) throw new Error(`font ${id}: ${r.status}`);
      const font = (await r.json()) as Font;
      loaded.set(id, font);
      return font;
    });
    f.catch(() => fonts.delete(id));
    fonts.set(id, f);
  }
  return f;
}

/** A font that is loaded already, or undefined. */
export const fontNow = (id: string): Font | undefined => loaded.get(id);

/** Makes a font known without loading it (tests, and fonts read some other way). */
export function addFont(font: Font): void {
  loaded.set(font.id, font);
  fonts.set(font.id, Promise.resolve(font));
}
