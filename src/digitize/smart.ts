import type { Components } from '../image/labels';
import type { Orientation } from '../image/orientation';
import { sample, type Region } from './region';
import type { Graph, Pt } from './skeleton';

/**
 * The Smart style of the Bild assistant: each area of the image gets the technique that suits it,
 * as a digitizer would choose, instead of one style for all.
 *
 * - Strokes stay satin, thin lines running stitch, grass tufts satin blades on a filled base (as
 *   in every style).
 * - Small round areas (a dot, an eye, a berry) are satin across their length: one smooth column
 *   instead of a few short tatami rows.
 * - Areas with clear structure of their own in the image (fur, hair, feathers, wood) are filled
 *   with rows that follow it.
 * - Everything else, large calm areas above all, is filled with straight rows: calm, even, and
 *   as a hobby machine sews it best.
 *
 * Each area can be set by hand to another technique (DigitizeOptions.areas), by a key that stays
 * the same while only stitch settings change.
 */

/** What an area becomes: straight rows, rows that follow the image, or satin. */
export type Technique = 'flat' | 'dynamic' | 'satin';
export const TECHNIQUES: readonly Technique[] = ['flat', 'dynamic', 'satin'];

/** Why Smart chose what it chose for an area (shown in the list of areas). */
export type Reason = 'calm' | 'structure' | 'round' | 'stroke' | 'line' | 'blades';

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
}

/** The groups of the areas, in the order of their letters. */
export function groupAreas(areas: readonly AreaInfo[], set: Readonly<Record<string, Technique>> = {}): AreaGroup[] {
  const out = new Map<string, AreaGroup>();
  for (const a of areas) {
    const k = groupOf(a);
    let g = out.get(k);
    if (!g) out.set(k, (g = { letter: a.letter, label: a.label, reason: a.reason, keys: [], areaMm2: 0, auto: a.auto, fixed: null }));
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
 * their own (a dot inside a ring).
 */
export function areaPixels(comps: Components, w: number, h: number, areas: readonly Pick<AreaInfo, 'key'>[], keys: readonly string[]): Uint8Array {
  const out = new Uint8Array(w * h);
  const all = new Set(areas.map((a) => a.key));
  const take = new Set<number>();
  for (const key of keys) {
    const b = boxOf(key);
    if (!b) continue;
    comps.label.forEach((l, c) => {
      if (l !== b.label || comps.minX[c] < b.minX || comps.minY[c] < b.minY || comps.maxX[c] > b.maxX || comps.maxY[c] > b.maxY) return;
      const own = areaKey(l, comps.minX[c], comps.minY[c], comps.maxX[c], comps.maxY[c]);
      if (own === key || !all.has(own)) take.add(c);
    });
  }
  for (let i = 0; i < w * h; i++) if (take.has(comps.comp[i])) out[i] = 1;
  return out;
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

/** The image's own structure counts this far inside an area (mm): its edges are those of other areas. */
const INSET_MM = 2;
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
 * the area's edge. Zero without orientation.
 */
export function structure(r: Region, orient: Orientation | undefined): number {
  if (!orient) return 0;
  const inset = INSET_MM / r.pxMm;
  let sum = 0;
  let n = 0;
  let sumAll = 0;
  let nAll = 0;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x;
      if (!r.mask[i]) continue;
      const gx = x + r.x0;
      const gy = y + r.y0;
      if (gx < 0 || gy < 0 || gx >= orient.width || gy >= orient.height) continue;
      const k = gy * orient.width + gx;
      const m = Math.hypot(orient.c[k], orient.s[k]);
      sumAll += m;
      nAll++;
      if (r.inside[i] < inset) continue;
      sum += m;
      n++;
    }
  }
  // A narrow area has no inside: then all of it.
  return n >= 20 ? sum / n : nAll ? sumAll / nAll : 0;
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
 * anywhere, or larger than ROUND_MAX_MM2 (set by hand: other limits).
 */
export function acrossGraph(r: Region, satinMax: number, maxWidth = ROUND_MAX_WIDTH, maxArea = ROUND_MAX_MM2): Graph | null {
  if (r.areaMm2 > maxArea || widest(r) > Math.min(satinMax, maxWidth)) return null;
  // Centroid and second moments of the pixels.
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.mask[y * r.w + x]) (n++, (sx += x), (sy += y));
  if (n < 4) return null;
  const cx = sx / n;
  const cy = sy / n;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (!r.mask[y * r.w + x]) continue;
      xx += (x - cx) ** 2;
      xy += (x - cx) * (y - cy);
      yy += (y - cy) ** 2;
    }
  }
  const a = 0.5 * Math.atan2(2 * xy, xx - yy);
  const d: Pt = [Math.cos(a), Math.sin(a)];
  const c: Pt = [(cx + r.x0 + 0.5) * r.pxMm, (cy + r.y0 + 0.5) * r.pxMm];
  // Along the axis both ways from the centroid, as long as it is inside.
  const step = Math.max(0.2, r.pxMm);
  const inside = (t: number) => sample(r, r.sdfBase, c[0] + d[0] * t, c[1] + d[1] * t) < 0;
  if (!inside(0)) return null;
  let t0 = 0;
  let t1 = 0;
  while (inside(t0 - step)) t0 -= step;
  while (inside(t1 + step)) t1 += step;
  // The ends stay a little inside: the column is extended into its free ends (satin.ts).
  const ends = Math.min(0.3, (t1 - t0) / 4);
  t0 += ends;
  t1 -= ends;
  if (t1 - t0 < step * 2) return null;
  const pts: Pt[] = [];
  const rad: number[] = [];
  // Half the chord across at each point (not the distance to the nearest edge, which near the
  // ends of a round area is much shorter): the rails are found within it (satin.ts).
  const half = (p: Pt, side: number) => {
    let u = 0;
    while (u < satinMax && sample(r, r.sdfBase, p[0] - d[1] * side * (u + step / 2), p[1] + d[0] * side * (u + step / 2)) < 0) u += step / 2;
    return u;
  };
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    const p: Pt = [c[0] + d[0] * t, c[1] + d[1] * t];
    pts.push(p);
    rad.push(Math.max(0.1, half(p, 1), half(p, -1)));
  }
  return { nodes: [{ p: pts[0], r: rad[0] }, { p: pts[pts.length - 1], r: rad[rad.length - 1] }], branches: [{ a: 0, b: 1, pts, r: rad }] };
}
