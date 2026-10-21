import type { Components } from '../image/labels';
import type { Orientation } from '../image/orientation';
import { core } from '../wasm/core';
import { regionIn, type Region } from './region';
import type { Graph, Pt } from './skeleton';

/**
 * The Smart style of the Bild assistant: each area of the image gets the technique that suits it,
 * as a digitizer would choose, instead of one style for all.
 *
 * - Strokes stay satin, thin lines running stitch (as in every style).
 * - Small round areas (a dot, an eye, a berry) are satin across their length: one smooth column
 *   instead of a few short tatami rows.
 * - Shapes a digitizer cuts into satin columns (a star, a grass tuft, a frame, a block letter, a
 *   leaf, a drop, a crescent) are satin in sections (see satinSuggest).
 * - Areas with clear structure of their own in the image (fur, hair, feathers, wood) are filled
 *   with rows that follow it.
 * - Everything else, large calm areas above all, is filled with straight rows: calm, even, and
 *   as a hobby machine sews it best.
 *
 * Each area can be set by hand to another technique (DigitizeOptions.areas), by a key that stays
 * the same while only stitch settings change.
 */

/** What an area becomes: straight rows, rows that follow the image, satin, or satin in sections (see satinSuggest). */
export type Technique = 'flat' | 'dynamic' | 'satin' | 'sections';
export const TECHNIQUES: readonly Technique[] = ['flat', 'dynamic', 'satin', 'sections'];

/** Why Smart chose what it chose for an area (shown in the list of areas). */
export type Reason = 'calm' | 'structure' | 'round' | 'stroke' | 'line' | 'shape';

/** An area of the image as the assistant sewed it. */
export interface AreaInfo {
  /** Stays the same while only stitch settings change (see areaKey). */
  key: string;
  /** A, B, C … of its group (groupOf): by color as sewn, then by kind. */
  letter: string;
  /** Its name: the letter, numbered in a group of several (C1, C2, …). */
  name: string;
  /** Palette index. */
  label: number;
  areaMm2: number;
  /** Where the letter goes: well inside the area (image mm). */
  at: Pt;
  /** How it was sewn in the end. */
  technique: Technique | 'run';
  /** What Smart would choose, and why. */
  auto: Technique | 'run';
  reason: Reason;
  /** Set by hand. */
  fixed: boolean;
  /** The techniques it can be set to (satin in sections only for a drawing of lines or a shape cut into columns). */
  offers?: Technique[];
}

/** The key of an area: its color and its bounding box in image pixels. */
export const areaKey = (label: number, minX: number, minY: number, maxX: number, maxY: number) => `${label}:${minX},${minY},${maxX},${maxY}`;

/** The color and bounding box an area key names, or null. */
export function boxOf(key: string): { label: number; minX: number; minY: number; maxX: number; maxY: number } | null {
  const m = /^(\d+):(\d+),(\d+),(\d+),(\d+)$/.exec(key);
  return m ? { label: +m[1], minX: +m[2], minY: +m[3], maxX: +m[4], maxY: +m[5] } : null;
}

/**
 * The group of an area: its color and why Smart chose what it chose. A group is listed and set as
 * one (all the small dots of one color, say), so the list stays short however many areas there are.
 */
export const groupOf = (a: Pick<AreaInfo, 'label' | 'reason'>) => `${a.label}|${a.reason}`;

/** An area group as listed: its letter, color, how many areas and how they are sewn. */
export interface AreaGroup {
  letter: string;
  label: number;
  reason: Reason;
  keys: string[];
  areaMm2: number;
  /** What Smart chooses for them. */
  auto: Technique | 'run';
  /** Set by hand for all of them; 'mixed' when only for some, or differently. */
  fixed: Technique | 'mixed' | null;
  /** The techniques all of them can be set to. */
  offers: Technique[];
}

/** The groups of the areas, in the order of their letters. */
export function groupAreas(areas: readonly AreaInfo[], set: Readonly<Record<string, Technique>> = {}): AreaGroup[] {
  const out = new Map<string, AreaGroup>();
  for (const a of areas) {
    const k = groupOf(a);
    let g = out.get(k);
    const offers = a.offers ?? TECHNIQUES.filter((x) => x !== 'sections');
    if (!g) out.set(k, (g = { letter: a.letter, label: a.label, reason: a.reason, keys: [], areaMm2: 0, auto: a.auto, fixed: null, offers }));
    else g.offers = g.offers.filter((x) => offers.includes(x));
    g.keys.push(a.key);
    g.areaMm2 += a.areaMm2;
  }
  for (const g of out.values()) {
    const ts = new Set(g.keys.map((k) => set[k] ?? null));
    g.fixed = ts.size === 1 ? [...ts][0] : 'mixed';
    g.areaMm2 = Math.round(g.areaMm2 * 10) / 10;
  }
  return [...out.values()];
}

/** The groups under their thread color, colors as sewn (the order of the first letter of each). */
export function groupsByColor(groups: readonly AreaGroup[]): { label: number; groups: AreaGroup[] }[] {
  const out = new Map<number, AreaGroup[]>();
  for (const g of groups) out.set(g.label, [...(out.get(g.label) ?? []), g]);
  return [...out].map(([label, gs]) => ({ label, groups: gs }));
}

/**
 * The pixels of some areas (1 inside), to show them on the stage: the pieces of the area's color
 * inside its box (several when a later detail cut it apart), without pieces that are areas of
 * their own (a dot inside a ring). Computed by the core (core/src/digitize/smart.rs).
 */
export function areaPixels(comps: Components, w: number, h: number, areas: readonly Pick<AreaInfo, 'key'>[], keys: readonly string[]): Uint8Array {
  const flat = (ks: readonly string[]) =>
    Uint32Array.from(
      ks.flatMap((k) => {
        const b = boxOf(k);
        return b ? [b.label, b.minX, b.minY, b.maxX, b.maxY] : [];
      }),
    );
  const boxes = new Uint32Array(4 * comps.label.length);
  comps.label.forEach((_, c) => boxes.set([comps.minX[c], comps.minY[c], comps.maxX[c], comps.maxY[c]], 4 * c));
  return core().areaPixels(comps.comp, Uint16Array.from(comps.label), boxes, w, h, flat(areas.map((a) => a.key)), flat(keys));
}

/** Techniques set by hand as stored: only known techniques survive. */
export function readAreas(v: unknown): Record<string, Technique> {
  const out: Record<string, Technique> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) if (TECHNIQUES.includes(t as Technique)) out[k] = t as Technique;
  return out;
}

/** A, B, …, Z, AA, AB, … */
export function letterOf(k: number): string {
  let s = '';
  let n = k + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Mean coherence of the image's direction inside an area from which its rows follow it. */
export const STRUCTURE = 0.3;
/** Areas smaller than this (mm²) are filled straight: too small for rows to show a direction. */
export const STRUCTURE_MIN_MM2 = 150;
/** Largest area (mm²) sewn as satin across. */
export const ROUND_MAX_MM2 = 60;
/**
 * Widest a round area sewn as satin across may be (mm): wider dots get long, loose stitches that
 * catch and shine unevenly, and look calmer filled (judged on realistic renderings).
 */
export const ROUND_MAX_WIDTH = 4.5;

/**
 * How clearly the image has a direction of its own inside the area: the mean coherence of the
 * structure tensor (0 flat or without direction, 1 everywhere one clear line direction), away from
 * the area's edge (2 mm in: its edges are those of other areas). Zero without orientation.
 * Computed by the core (core/src/digitize/smart.rs).
 */
export function structure(r: Region, orient: Orientation | undefined): number {
  if (!orient) return 0;
  // Only the image window the region covers crosses (see flowFill).
  const { width, height } = orient;
  const cx0 = Math.min(width - 1, Math.max(0, r.x0));
  const cy0 = Math.min(height - 1, Math.max(0, r.y0));
  const cx1 = Math.max(cx0 + 1, Math.min(width, r.x0 + r.w));
  const cy1 = Math.max(cy0 + 1, Math.min(height, r.y0 + r.h));
  const cw = cx1 - cx0;
  const c = new Float32Array(cw * (cy1 - cy0));
  const s = new Float32Array(c.length);
  for (let y = cy0; y < cy1; y++) {
    c.set(orient.c.subarray(y * width + cx0, y * width + cx1), (y - cy0) * cw);
    s.set(orient.s.subarray(y * width + cx0, y * width + cx1), (y - cy0) * cw);
  }
  return core().areaStructure(regionIn(r), c, s, cx0, cy0, cw, width, height);
}

/** Widest inscribed circle of the area (mm). */
export const widest = (r: Region) => {
  let m = 0;
  for (const v of r.inside) if (v > m) m = v;
  return 2 * m * r.pxMm;
};

/**
 * A single satin column across the area along its longest axis (its stitches cross it the short
 * way), or null when the area is no small blob: wider than `satinMax` or ROUND_MAX_WIDTH
 * anywhere, or larger than ROUND_MAX_MM2 (set by hand: other limits). Computed by the core
 * (core/src/digitize/smart.rs).
 */
export function acrossGraph(r: Region, satinMax: number, maxWidth = ROUND_MAX_WIDTH, maxArea = ROUND_MAX_MM2): Graph | null {
  // Most areas are no small blob: those need not cross.
  if (r.areaMm2 > maxArea || widest(r) > Math.min(satinMax, maxWidth)) return null;
  return core().acrossGraph(regionIn(r), satinMax, maxWidth, maxArea) as Graph | null;
}
