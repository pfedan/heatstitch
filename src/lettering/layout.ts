import type { ThreadColor } from '../model/pattern';
import type { Mat } from '../shape/path';
import type { Pt } from '../digitize/skeleton';
import { core } from '../wasm/core';
import { inCore, type Font, type Glyph } from './font';

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

/** The settings of `l` the core sets and sews from, the text in NFC. */
export function letteringIn(l: Lettering): object {
  return {
    text: l.text.normalize('NFC'),
    height: l.height,
    align: l.align,
    spacing: l.spacing,
    wordSpacing: l.wordSpacing,
    lineSpacing: l.lineSpacing,
    shape: l.shape,
    radius: l.radius,
    x: l.x,
    y: l.y,
    angle: l.angle,
    back: !!l.back,
    density: l.density,
    underlay: !!l.underlay,
    letters: l.letters ?? [],
  };
}

/** A layout as the core gives it: each letter names its glyph by key. */
interface LayoutOut {
  letters: { at: number; ch: string; line: number; word: number; key?: string | null; m: Mat; back: boolean; box: [Pt, Pt, Pt, Pt] }[];
  missing: string[];
  scale: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The core's layout with the font's own glyph objects (the preview draws from them). */
export function layoutFrom(font: Font, o: LayoutOut): Layout {
  return {
    letters: o.letters.map((p) => ({ at: p.at, ch: p.ch, line: p.line, word: p.word, glyph: p.key != null ? font.glyphs[p.key] : null, m: p.m, back: p.back, box: p.box })),
    missing: o.missing,
    scale: o.scale,
    minX: o.minX,
    minY: o.minY,
    maxX: o.maxX,
    maxY: o.maxY,
  };
}

/**
 * Sets the text: letters along the baseline with their advances and kerning (an advance runs
 * from a letter's origin to the next one's; the first letter of a word starts at its own left
 * edge), lines below each other, aligned, then bent onto an arc or circle and turned. In the Rust
 * core (core/src/lettering/layout.rs).
 */
export function layout(font: Font, l: Lettering): Layout {
  return layoutFrom(font, core().letteringLayout(inCore(font), letteringIn(l)) as LayoutOut);
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

