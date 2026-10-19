import { SATIN_CENTER_MAX, SATIN_CONTOUR_MAX, SATIN_CROSS_STRETCH, SATIN_UNDER_MIN, SATIN_ZIGZAG_MAX } from '../material/rules';
import { core } from '../wasm/core';
import type { Region } from './region';
import { TOLERANCE } from './run';
import type { Branch, Pt } from './skeleton';

/**
 * Satin columns along a centerline. The rails are found by casting rays from the centerline along
 * its normal to the region's boundary (the "stroke normals" of the Goldman patent), so they follow
 * the real edges even where the column is asymmetric. Stitch placement follows Ink/Stitch's satin
 * column (re-implemented, not ported):
 *
 * - pairs are spaced so the rail that moves more advances by `spacing`, measured perpendicular to
 *   the previous stitch; on curves the inner side gets denser,
 * - which the short-stitch rule relieves: a penetration too close to the last full one on the same
 *   rail is moved in towards the other rail, 15 % and 30 % of the width by turns (see SHORT_DIST),
 * - pull compensation widens every pair outwards from its middle,
 * - stitches longer than the split length are divided evenly.
 *
 * Computed by the core (core/src/digitize/satin.rs), a whole column per call.
 */

export interface SatinParams {
  /** Distance between penetrations on the same side (mm). */
  spacing: number;
  /** Added to each side (mm). */
  pull: number;
  /** Longer stitches are split (mm). */
  splitMm: number;
  /** Short stitches on the inside of curves (default on). */
  short?: boolean;
  /** Added to the right side instead of `pull` (mm); the sides can differ. */
  pullB?: number;
  /** Added to each side in proportion to the column's width there (0.1 = 10 %). */
  pullShare?: number;
  /** Added to the right side instead of `pullShare`; the sides can differ. */
  pullShareB?: number;
  /** Split stitches staggered from stitch to stitch, so the split points do not line up into a groove. */
  stagger?: boolean;
  /** Spacing at each point of the column instead of `spacing` (see spacingAlong in restitch). */
  spacingAt?: number[];
  /** Fringe on the left side: each stitch ends up to this much short of the rail (mm), see fringe. */
  fringe?: number;
  /** Fringe on the right side (mm). */
  fringeB?: number;
  /** The second pair this far after the first (mm) instead of `spacing`: the pattern starts later (an echo copy's phase). */
  lead?: number;
  /** Irregular satin (fur, grass, a hand-sewn look), 0 to 1: see roughen. */
  rough?: number;
  /** Which irregular satin: the same seed gives the same stitches every time. */
  seed?: number;
}

export interface Column {
  /** Centerline from end a to end b, extended into free ends. */
  center: Pt[];
  left: Pt[];
  right: Pt[];
  /** Median width (mm). */
  width: number;
}

/** Points as one flat x, y list, as the core takes them. */
export function flatPts(pts: Pt[]): Float64Array {
  const out = new Float64Array(2 * pts.length);
  for (let i = 0; i < pts.length; i++) {
    out[2 * i] = pts[i][0];
    out[2 * i + 1] = pts[i][1];
  }
  return out;
}

/** Points from a flat x, y list, from index `from` for `n` points. */
export function ptsOf(flat: ArrayLike<number>, from = 0, n = (flat.length - from) >> 1): Pt[] {
  const out: Pt[] = new Array(n);
  for (let k = 0, i = from; k < n; k++, i += 2) out[k] = [flat[i], flat[i + 1]];
  return out;
}

/** A column as the core takes it: the width, then center, left and right rail (x, y pairs each). */
export function colFlat(c: Column): Float64Array {
  const n = c.center.length;
  const out = new Float64Array(1 + 6 * n);
  out[0] = c.width;
  [c.center, c.left, c.right].forEach((rail, k) => {
    for (let i = 0; i < n; i++) {
      out[1 + 2 * (n * k + i)] = rail[i][0];
      out[2 + 2 * (n * k + i)] = rail[i][1];
    }
  });
  return out;
}

/** A column from the core (see colFlat). */
export function colOf(flat: Float64Array): Column {
  const n = (flat.length - 1) / 6;
  return { width: flat[0], center: ptsOf(flat, 1, n), left: ptsOf(flat, 1 + 2 * n, n), right: ptsOf(flat, 1 + 4 * n, n) };
}

/** Pairs as a flat list (left x, y, right x, y per pair) and back. */
const pairsFlat = (ps: [Pt, Pt][]): Float64Array => {
  const out = new Float64Array(4 * ps.length);
  ps.forEach(([a, b], i) => out.set([a[0], a[1], b[0], b[1]], 4 * i));
  return out;
};
export const pairsOf = (flat: Float64Array): [Pt, Pt][] => {
  const out: [Pt, Pt][] = new Array(flat.length >> 2);
  for (let k = 0; k < out.length; k++) out[k] = [[flat[4 * k], flat[4 * k + 1]], [flat[4 * k + 2], flat[4 * k + 3]]];
  return out;
};

/** Rails of a branch, from node a to node b; `freeA`/`freeB` extend the column into free ends. */
export function column(r: Region, br: Branch, freeA: boolean, freeB: boolean): Column {
  return colOf(core().satinColumn(r.sdfBase, r.x0, r.y0, r.w, r.h, r.pxMm, flatPts(br.pts), Float64Array.from(br.r), freeA, freeB));
}

/** Junctions at the column's ends that other columns cover already: the column stops this far from them. */
export interface ColumnEnds {
  from: Pt;
  fromTrim: number;
  to: Pt;
  toTrim: number;
}

/** Stitch pairs (left, right) along the column, in its direction. */
export function pairs(c: Column, p: SatinParams, ends?: ColumnEnds): [Pt, Pt][] {
  return pairsOf(core().satinPairs(colFlat(c), p, ends ?? null));
}

/** Irregular satin: each needle point reaches up to ROUGH_OUT of the width beyond its rail or up to ROUGH_IN short of it (see core/src/digitize/satin.rs). */
export const ROUGH_OUT = 0.2;
export const ROUGH_IN = 0.1;

/** The column with its rails drawn in by the fringe (left `a`, right `b` mm): where the satin covers on every stitch. */
export function fringedColumn(c: Column, a: number, b: number): Column {
  if (!a && !b) return c;
  return { ...c, ...colOf(core().fringedColumn(colFlat(c), a, b)), width: c.width };
}

/** Needle points of the satin: left, right, left, right ... along the pairs. */
export function satinStitches(ps: [Pt, Pt][], p: SatinParams): Pt[] {
  return ptsOf(core().satinStitches(pairsFlat(ps), p));
}

/**
 * Needle points of an E stitch (blanket stitch, for appliqué edges): a running stitch along the
 * left rail, at each pair a stitch across to the right rail and back on the same holes.
 */
export function eStitches(ps: [Pt, Pt][], p: SatinParams): Pt[] {
  return ptsOf(core().eStitches(pairsFlat(ps), p));
}

/** Kinds of satin underlay: by the column's width, along the middle, along both rails, zigzag, rails and zigzag. */
export type UnderlayKind = 'auto' | 'center' | 'contour' | 'zigzag' | 'both';

/**
 * Tiers of the automatic underlay, from narrow to wide (see SATIN_UNDER_MIN): none, a walk along
 * the middle, an edge run inside both rails, edge run and one zigzag, edge run and a crossed
 * (double) zigzag.
 */
export type UnderTier = 'none' | 'center' | 'contour' | 'zigzag' | 'cross';

/** The tier of a column `w` mm wide; `stretch`: on stretchy fabric, crossed from SATIN_CROSS_STRETCH. */
export function underTier(w: number, stretch = false): UnderTier {
  if (w < SATIN_UNDER_MIN) return 'none';
  if (w < SATIN_CENTER_MAX) return 'center';
  if (stretch && w >= SATIN_CROSS_STRETCH) return 'cross';
  if (w < SATIN_CONTOUR_MAX) return 'contour';
  return w < SATIN_ZIGZAG_MAX ? 'zigzag' : 'cross';
}

/**
 * How far the contour and zigzag underlay keep inside the rails: `mm` from each rail, or `share`
 * of the width there (0.1 = 10 %) in place of it. 0.4 mm (at most a fourth of the width) when
 * neither is set; the zigzag's half of it.
 */
export interface UnderInset {
  mm?: number;
  share?: number;
}

/**
 * Underlay sewn on the way out along the column, ending at its far end (the satin follows on the
 * way back), by width in tiers (see underTier), stretch by stretch where the width changes along
 * the column. An edge run comes back to where it started, so in this one-way form it is followed by
 * a walk out along the middle; a zigzag is sewn out only. The center walk keeps within `tol` of the
 * centerline, so it stays under the satin in tight curves. The image conversion walks its columns
 * this way; objects get underlayOf, whose zigzag goes out and back.
 */
export function underlay(c: Column, tol = TOLERANCE, ins?: UnderInset, stretch = false): Pt[] {
  return ptsOf(core().satinUnderlay(colFlat(c), tol, ins ?? null, stretch));
}

/**
 * The underlay of `kind` for the column, and whether it ends at the column's far end (then the
 * satin comes back over it) or back where it started (then the satin goes out over it). A zigzag
 * is sewn out and back, so it ends where it started; `oneWay` (a column that has to come home, in
 * a chain) sews it out only, so it ends at the far end and needs no run out along the middle on
 * top (more thread where columns meet). `stretch`: Auto on stretchy fabric (see underTier).
 */
export function underlayOf(c: Column, kind: UnderlayKind, tol = TOLERANCE, ins?: UnderInset, oneWay = false, stretch = false): { pts: Pt[]; atEnd: boolean } {
  const flat = core().satinUnderlayOf(colFlat(c), kind, tol, ins ?? null, oneWay, stretch);
  return { pts: ptsOf(flat, 1), atEnd: flat[0] === 1 };
}
