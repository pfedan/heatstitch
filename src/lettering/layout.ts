import type { ThreadColor } from '../model/pattern';
import { apply, compose, type Mat } from '../shape/path';
import type { Pt } from '../digitize/skeleton';
import type { Font, Glyph } from './font';

/**
 * A lettering (Schriftzug): text set in an embroidery font. It stays text: whenever something
 * about it changes, its letters are set and sewn again from the font.
 */
export interface Lettering {
  /** Stable id, shared by all objects of the lettering. */
  id: string;
  text: string;
  font: string;
  /** Height of the capitals (mm). */
  height: number;
  align: Align;
  /** Added between letters and words (mm). */
  spacing: number;
  wordSpacing: number;
  /** Distance of the lines in times the font's own. */
  lineSpacing: number;
  shape: LetteringShape;
  /** Radius of the arc or circle (mm). */
  radius: number;
  /** Where the first line's baseline is anchored (mm): its start, middle or end by `align`; the top (or bottom) of an arc. */
  x: number;
  y: number;
  /** Turned by this around the anchor (degrees, clockwise). */
  angle: number;
  color: ThreadColor;
  /** Every other line sewn from right to left, when the font allows it. */
  back: boolean;
  /** Satin and fill spacing in times the font's (below 1: denser). */
  density: number;
  underlay: boolean;
  /** Letters moved or turned by hand, by their place in the text. */
  letters: LetterOverride[];
}

export type Align = 'left' | 'center' | 'right' | 'block';
export type LetteringShape = 'line' | 'arcUp' | 'arcDown' | 'circle';

export interface LetterOverride {
  /** Place in the text (code points, line breaks included). */
  at: number;
  /** The letter there, so the override can follow it when the text changes. */
  ch: string;
  dx: number;
  dy: number;
  rot: number;
}

export const LETTERING_DEFAULTS: Omit<Lettering, 'id' | 'text' | 'font' | 'x' | 'y' | 'color'> = {
  height: 10,
  align: 'left',
  spacing: 0,
  wordSpacing: 0,
  lineSpacing: 1,
  shape: 'line',
  radius: 40,
  angle: 0,
  back: true,
  density: 1,
  underlay: true,
  letters: [],
};

/** A letter in its place: the glyph and the map from font millimetres to the design's. */
export interface Placed {
  /** Place in the text (code points). */
  at: number;
  ch: string;
  line: number;
  word: number;
  glyph: Glyph | null;
  m: Mat;
  /** Sewn from right to left (every other line, when sewn back and forth). */
  back: boolean;
  /** The letter's box corners in the design (mm), also for a missing letter. */
  box: [Pt, Pt, Pt, Pt];
}

export interface Layout {
  letters: Placed[];
  /** Letters of the text the font does not have. */
  missing: string[];
  scale: number;
  /** Bounds of all letters (mm). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The letter the font shows for `ch`: in its letter case, else as written, else null. */
export function glyphFor(font: Font, ch: string): Glyph | null {
  const c = font.case === 'upper' ? ch.toUpperCase() : font.case === 'lower' ? ch.toLowerCase() : ch;
  return font.glyphs[c] ?? font.glyphs[ch] ?? null;
}

/** Characters of `text` the font has no letter for (each once, in order). */
export function missingIn(font: Font, text: string): string[] {
  const out: string[] = [];
  for (const ch of text.normalize('NFC')) {
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
    if (!glyphFor(font, ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

const rot = (deg: number, cx: number, cy: number): Mat => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};
const move = (dx: number, dy: number): Mat => [1, 0, 0, 1, dx, dy];
const scaled = (s: number): Mat => [s, 0, 0, s, 0, 0];

/**
 * Sets the text: letters along the baseline with their advances and kerning (an advance runs
 * from a letter's origin to the next one's; the first letter of a word starts at its own left
 * edge), lines below each other, aligned, then bent onto an arc or circle and turned.
 */
export function layout(font: Font, l: Lettering): Layout {
  const s = l.height / (font.cap || 1);
  const lines = l.text.normalize('NFC').replace(/\r/g, '').split('\n');
  interface Item {
    at: number;
    ch: string;
    word: number;
    glyph: Glyph | null;
    /** Origin along the line (mm of the design). */
    u: number;
    /** Left and right edge of the letter (design mm, from its origin). */
    a: number;
    b: number;
  }
  const missing = missingIn(font, l.text);
  const set: { items: Item[]; left: number; right: number; words: number }[] = [];
  let at = 0;
  const gap = font.space * s;
  for (const line of lines) {
    const items: Item[] = [];
    let pen = 0;
    let prev: string | null = null;
    let word = 0;
    let inWord = false;
    for (const ch of line) {
      if (ch === ' ' || ch === '\t') {
        pen += gap + l.wordSpacing;
        if (inWord) word++;
        inWord = false;
        prev = null;
        at++;
        continue;
      }
      const glyph = glyphFor(font, ch);
      const key = glyph && font.case === 'upper' ? ch.toUpperCase() : glyph && font.case === 'lower' ? ch.toLowerCase() : ch;
      // A letter the font lacks keeps a place the size of a narrow letter.
      const g = glyph ?? { a: font.cap * 0.55, x0: font.cap * 0.05, x1: font.cap * 0.5, y0: -font.cap, y1: 0, e: [] };
      let u: number;
      if (prev === null) u = pen - g.x0 * s;
      else u = pen - (font.kern[prev + key] ?? 0) * s + l.spacing;
      items.push({ at, ch, word, glyph, u, a: g.x0 * s, b: g.x1 * s });
      pen = u + g.a * s;
      prev = key;
      inWord = true;
      at++;
    }
    at++; // the line break
    const left = items.length ? Math.min(...items.map((it) => it.u + it.a)) : 0;
    const right = items.length ? Math.max(...items.map((it) => it.u + it.b)) : 0;
    set.push({ items, left, right, words: word + (inWord ? 1 : 0) });
  }
  // Alignment: each line against the widest one; on an arc or circle around the middle.
  const widest = Math.max(0, ...set.map((ln) => ln.right - ln.left));
  const centered = l.shape !== 'line' || l.align === 'center';
  for (const ln of set) {
    const w = ln.right - ln.left;
    let shift = -ln.left;
    if (centered) shift -= w / 2;
    else if (l.align === 'right') shift -= w;
    else if (l.align === 'block' && ln.words > 1) {
      // Block: the words of every line spread to the width of the widest.
      const extra = (widest - w) / (ln.words - 1);
      for (const it of ln.items) it.u += extra * it.word;
    }
    for (const it of ln.items) it.u += shift;
  }

  const lead = font.lead * s * l.lineSpacing;
  const anchor = compose(move(l.x, l.y), rot(l.angle, 0, 0));
  const placed: Placed[] = [];
  const overrides = new Map(l.letters.map((o) => [o.at, o]));
  set.forEach((ln, li) => {
    const back = l.back && font.rev && li % 2 === 1;
    // The circle: letters spread evenly around it, the text's middle at the top.
    let spread = 0;
    if (l.shape === 'circle' && ln.items.length > 1) {
      const R = Math.max(1, l.radius - li * lead);
      const w = ln.right - ln.left;
      spread = Math.max(0, (2 * Math.PI * R - w) / ln.items.length);
      ln.items.forEach((it, k) => (it.u += spread * (k - (ln.items.length - 1) / 2)));
    }
    for (const it of ln.items) {
      const mid = it.u + (it.a + it.b) / 2;
      let m: Mat;
      if (l.shape === 'line') m = compose(move(it.u, li * lead), scaled(s));
      else {
        const R = Math.max(1, l.shape === 'arcDown' ? l.radius + li * lead : l.radius - li * lead);
        const phi = mid / R;
        // The letter stands on the circle at its middle, turned along it.
        const deg = ((l.shape === 'arcDown' ? -phi : phi) * 180) / Math.PI;
        const base: Pt = l.shape === 'arcDown' ? [R * Math.sin(phi), -l.radius + R * Math.cos(phi)] : [R * Math.sin(phi), l.radius - R * Math.cos(phi)];
        m = compose(move(base[0], base[1]), compose(rot(deg, 0, 0), compose(move(-mid + it.u, 0), scaled(s))));
      }
      const o = overrides.get(it.at);
      if (o && o.ch === it.ch) {
        const g = it.glyph;
        const cx = g ? ((g.x0 + g.x1) / 2) : 0;
        const cy = g ? ((g.y0 + g.y1) / 2) : -font.cap / 2;
        const c = apply(m, [cx, cy]);
        m = compose(move(o.dx, o.dy), compose(rot(o.rot, c[0], c[1]), m));
      }
      m = compose(anchor, m);
      const g = it.glyph ?? { x0: font.cap * 0.05, x1: font.cap * 0.5, y0: -font.cap, y1: 0 };
      const box: [Pt, Pt, Pt, Pt] = [apply(m, [g.x0, g.y0]), apply(m, [g.x1, g.y0]), apply(m, [g.x1, g.y1]), apply(m, [g.x0, g.y1])];
      placed.push({ at: it.at, ch: it.ch, line: li, word: it.word, glyph: it.glyph, m, back, box });
    }
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    for (const [x, y] of p.box) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!placed.length) [minX, minY, maxX, maxY] = [l.x, l.y - l.height, l.x, l.y];
  return { letters: placed, missing, scale: s, minX, minY, maxX, maxY };
}

/**
 * Overrides moved with their letters when the text changes from `before` to `after`: letters
 * kept in the same order keep their override (by the longest common subsequence).
 */
export function followText(before: string, after: string, letters: LetterOverride[]): LetterOverride[] {
  if (!letters.length) return letters;
  const a = [...before];
  const b = [...after];
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const map = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) map.set(i++, j++);
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const out: LetterOverride[] = [];
  for (const o of letters) {
    const to = map.get(o.at);
    if (to !== undefined && b[to] === o.ch) out.push({ ...o, at: to });
  }
  return out;
}

