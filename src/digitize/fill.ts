import { core } from '../wasm/core';
import type { FillOut } from '../wasm/pkg/heatstitch_core';
import { fromCore, regionIn, type Region } from './region';
import type { Pt } from './skeleton';
import type { Motif, Texture } from './deco';

/**
 * Tatami fill of a region (with holes) from its signed distance field.
 *
 * - Rows are scan lines at the fill angle on a lattice anchored at the design origin, so the rows of
 *   neighbouring regions line up; inside/outside comes from the field, so holes need no extra care.
 * - Rows are grouped into sections, monotone pieces that can be sewn back and forth in one go (the
 *   boustrophedon decomposition, Choset 2000): a section ends wherever the shape splits or merges.
 * - Needle points lie on a global lattice along the rows, shifted by a quarter stitch from row to
 *   row (Ink/Stitch's default of 4 staggers), so the stitch ends do not form visible lines.
 * - Without a fixed angle, the angle with the fewest sections out of 16 is used, as in the Goldman
 *   patent; fewer sections mean fewer travels.
 * - Underlay: a sparse fill at +90 degrees (or two crossing at ±45), inset from the edge, sewn first.
 * - Between sections the needle travels inside the region on a shortest path that avoids rows sewn
 *   already, so later rows cover it (Ink/Stitch's underpath); where it would run on top of sewn rows
 *   for more than 2 mm, the needle jumps instead.
 * - Gap rows (`gapRows`): where two sections meet, the one sewn first runs on for a row or two into
 *   the other, under its rows to come, so stretchy fabric pulled apart in between shows no gap at
 *   the join (Wilcom's segment overlap rows, Ink/Stitch's gap fill rows).
 *
 * The fills are computed by the Rust core (core/src/digitize/fill.rs and the modules beside it). The
 * travel grid, which the model layer queries point by point, and small helpers stay here too.
 */

/** How rows turn at the edge: along the outline (see turn). */
export type RowEnds = 'edge';
export const ROW_ENDS: readonly RowEnds[] = ['edge'];

export interface FillParams {
  /** Distance between neighbouring rows (mm). */
  spacing: number;
  /** Stitch length (mm). */
  stitch: number;
  /** Degrees; null chooses per region. */
  angle: number | null;
  /** Rows are lengthened at both ends by this (mm). */
  pull: number;
  underlay: boolean;
  /** Underlay as one layer across the rows (default) or two crossing layers at ±45 degrees to them. */
  underCross?: boolean;
  /** Underlay stays this far inside the edge (mm); UNDERLAY_INSET by default. */
  underInset?: number;
  /**
   * How the rows turn from one to the next at the edge (straight rows): straight across when not
   * set; 'edge' along the outline, so sparse rows draw a clean edge.
   */
  rowEnds?: RowEnds;
  /** An edge run (Kantenlauf) along the edge of the underlay before its rows (see sewEdgeRun). */
  underEdge?: boolean;
  /** The underlay only in this part of the area (same pixels as the area); all of it when not set. */
  underArea?: Region;
  /**
   * Underlay inset as a share of the shape's width where it is (0.1 = 10 %), in place of the inset
   * in mm when set.
   */
  underInsetShare?: number;
  /** Distance between the underlay rows (mm); three times the top spacing, at least 1.2 mm, by default. */
  underSpacing?: number;
  /**
   * Shift of the needle points from row to row, as a fraction of the stitch length: 1/4 repeats
   * every 4 rows (the usual tatami), 1/2 gives a brick pattern; 0 shifts them at random.
   */
  offset?: number;
  /**
   * Spacing on the far side of the rows (gradient fill): it changes evenly across the shape. Curved
   * rows (fieldFill) take it across their mean direction, from the side where straight rows would start.
   */
  spacingEnd?: number;
  /** The next object starts here: the fill should end near it (straight rows only). */
  end?: Pt;
  /** Where travel between sections may run; the region itself by default. */
  travel?: Region;
  /**
   * Travel keeps off the strips past the ends of sewn rows: an area with parts left out sews in
   * more sections, and its travel would run round the outline beside them, where it shows.
   */
  offRowEnds?: boolean;
  /**
   * Fewer trims (Schnitte sparen): where no hidden way is left between rows, travel may run a few mm
   * along the outline beside sewn row ends (ROW_END_RUN) rather than trim. Off: it trims there.
   */
  saveTrims?: boolean;
  /** The whole area this one was cut from (parts left out under what lies on top): travel there is hidden. */
  whole?: Region;
  /** Curved rows keep this close to their line (mm); TOLERANCE by default. */
  tolerance?: number;
  /** Straight rows put their needle points on the lines of this motif (embossing, see deco.ts). */
  emboss?: { motif: Motif; size: number; strong?: boolean; angle?: number };
  /** Straight rows shift their needle points into a texture (see texturePoints in deco.ts), in place of `offset`. */
  texture?: { kind: Texture; size: number };
  /**
   * Wave rows (see Frame.wave): every row is the same wave, `height` mm from crest to middle and
   * `length` mm long, sewn in sections like straight rows. Not with emboss, texture or a gradient.
   */
  wave?: { height: number; length: number };
  /**
   * Rows that fade out across the shape (`out`, dense where the rows start) or in (`in`): the
   * density falls evenly to nearly nothing, so a second color fading the other way on the same
   * area makes a color blend as dense as one fill (see blend.ts in model).
   */
  fade?: 'out' | 'in';
  /**
   * Rows a section sews on into a touching section sewn later (gap rows, see sectionJoins); 0 or
   * unset sews none. Straight rows at an even spacing only.
   */
  gapRows?: number;
}

export interface FillResult {
  /** Continuous stitch runs; a jump lies between two runs. */
  runs: Pt[][];
  angle: number;
  /** The first this many points of `runs` are the underlay. */
  under?: number;
  /**
   * Travel between rows or sections along a way (not a straight step): first and last point
   * (indices into the points of `runs` in order), from the end of one row to the start of the next.
   */
  travel?: [number, number][];
}

export const UNDERLAY_INSET = 0.4;
export const TRAVEL_STITCH = 2.5;
const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Most gap rows a section sews on into its neighbour. */
export const GAP_ROWS_MAX = 2;

/**
 * Turns up to this long (mm) share the hole of the row ends (see sewSection): the row ends left on
 * the edge then lie twice as far apart, at most 0.5 mm, which the thread (0.4 mm for 40 wt) still
 * closes. Rows further apart each reach the edge, or the fabric shows between them there (#346).
 */
export const SHARED_TURN = 0.25;

/**
 * Shortest stitch of a fill (mm) within its rows: a shorter one only sets the needle again beside
 * its last hole (rows cut short by a narrow tip, staggered points near a row's end), which punches
 * the fabric without adding to the look. Turns between rows are exempt: they are as long as the
 * rows lie apart, unless the rows lie so close that they share the hole there (SHARED_TURN).
 */
export const SHORTEST = 0.4;

/**
 * The needle points without stitches shorter than `min`: such a stitch is merged into the next
 * by leaving out its end. The first and last points stay.
 */
export function merged(pts: Pt[], min: number): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  // Slightly shorter still counts as the length: rows `min` apart turn in stitches of that length.
  const lim = min - 1e-3;
  for (let i = 1; i < pts.length - 1; i++) if (dist(out[out.length - 1], pts[i]) >= lim) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out.length > 1 && dist(out[out.length - 1], last) < lim) out.pop();
  out.push(last);
  return out;
}

export function pathLength(p: Pt[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]);
  return l;
}

/** Crosshatch: the two layers cross at this angle each side of the fill angle (degrees), at right angles to each other. */
export const CROSSHATCH_HALF = 45;

/** Stitch length of the edge run (mm): short enough to follow curves, long enough not to perforate. */
export const EDGE_RUN_STITCH = 2;

/** The settings as the core takes them: without the regions (they cross on their own) and unset values. */
export function coreParams(p: object): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined && k !== 'underArea' && k !== 'travel' && k !== 'whole') o[k] = v;
  return o;
}

/** The regions in the settings, for a core call (none where they are the area itself). */
export const coreRegions = (r: Region, p: Pick<FillParams, 'underArea' | 'travel' | 'whole'>) =>
  [p.underArea && p.underArea !== r ? regionIn(p.underArea) : undefined, p.travel && p.travel !== r ? regionIn(p.travel) : undefined, p.whole ? regionIn(p.whole) : undefined] as const;

/** Runs from a flat x, y list and the point count of each. */
export function linesOf(pts: Float64Array, lens: Uint32Array): Pt[][] {
  const out: Pt[][] = [];
  let i = 0;
  for (const n of lens) {
    const l: Pt[] = new Array(n);
    for (let k = 0; k < n; k++, i++) l[k] = [pts[2 * i], pts[2 * i + 1]];
    out.push(l);
  }
  return out;
}

/** Points from a flat x, y list. */
export function ptsOf(flat: Float64Array): Pt[] {
  const out: Pt[] = new Array(flat.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = [flat[2 * i], flat[2 * i + 1]];
  return out;
}

/** A line as a flat x, y list. */
export function flatOf(line: Pt[]): Float64Array {
  const out = new Float64Array(2 * line.length);
  line.forEach((q, i) => {
    out[2 * i] = q[0];
    out[2 * i + 1] = q[1];
  });
  return out;
}

/** The fill the core made, as a FillResult (with `curved` for the fills along a field). */
export function fillOf(o: FillOut | undefined, curved = false): FillResult | null {
  if (!o) return null;
  const runs = linesOf(o.takePts(), o.takeLens());
  const t = o.takeTravel();
  const travel: [number, number][] = [];
  for (let i = 0; i + 1 < t.length; i += 2) travel.push([t[i], t[i + 1]]);
  const res: FillResult & { curved?: boolean } = { runs, angle: o.angle, under: o.under, travel };
  if (curved) res.curved = o.curved;
  o.free();
  return res;
}

/** Fill stitches for the region, starting near `start`. Null if no row fits into the region. */
export function fillRegion(r: Region, p: FillParams, start: Pt, neighbours: number[] = []): FillResult | null {
  return fillOf(core().fillRegion(regionIn(r), coreParams(p), start[0], start[1], Float64Array.from(neighbours), ...coreRegions(r, p)));
}

/**
 * Crosshatch (Kreuzschraffur): two sparse tatami layers, `p.spacing` apart each, at the fill angle
 * ±CROSSHATCH_HALF, the second sewn on the first; a light, lacy fill the fabric shows through, as
 * the cross hatch fills of commercial software. No underlay and no pull: what is sewn shows.
 *
 * Travel is what gives a sparse fill away: between the rows it shows. So a row only covers its
 * thread (Frame.lane), and travel keeps to lines thread lies on: rows still to come, of both
 * layers while the first is sewn, which hide it, and rows sewn already, which it only doubles
 * (TravelGrid.layered). The two layers cross, so their lines form a net that reaches everywhere,
 * and the way found on the grid is laid exactly onto it (ontoLines). Such a way may be longer than
 * usual before the thread jumps, as the locks of a trim show in a light fill. The second layer
 * starts where the way from the end of the first is cheapest, so near it.
 */
export function crosshatchFill(r: Region, p: FillParams, start: Pt): FillResult | null {
  return fillOf(core().crosshatchFill(regionIn(r), coreParams(p), start[0], start[1], ...coreRegions(r, p)));
}

/**
 * Fill angle with the fewest sections out of 16; ties prefer the diagonals, and angles within 30
 * degrees of touching regions sewn already count a little worse, so neighbours differ.
 */
export function chooseAngle(r: Region, spacing: number, neighbours: number[]): number {
  return core().chooseAngle(regionIn(r), spacing, Float64Array.from(neighbours));
}

/**
 * The area the underlay keeps to: the fill's area shrunk by the inset in mm, or by `share` of its
 * width where it is (without slivers too thin to sew). Null when nothing is left.
 */
export function underlayArea(r: Region, inset: number, share?: number): Region | null {
  const a = core().underlayArea(regionIn(r), inset, share);
  if (a === null) return null;
  if (a === true) return r;
  return fromCore(a, r.label, r.pxMm);
}
