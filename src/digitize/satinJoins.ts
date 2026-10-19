import { core } from '../wasm/core';
import { flatPts, ptsOf } from './satin';
import type { Pt } from './skeleton';

/**
 * Corners and ends of a satin along a line (a drawn line, an SVG stroke), made as changes of its
 * rails before it is stitched: the stitch generator then sews the rails as they are, a stitch for
 * each pair of points (see Rails without rungs).
 *
 * A corner is a bend of CORNER_DEG or more within about half the width (a real corner, not a
 * curve; a fillet tighter than the satin is wide counts too). Without corner handling the rails
 * of a satin round a corner fold over on the inside and fan on the outside, piling stitches up at
 * the inner corner. At a corner both arms run straight to it, the inside rail ends where the inner
 * edges of both arms meet, and the stitches turn from square on the first arm to square on the
 * second over a column width on each side (as digitizers place a bisector rung with square rungs
 * a width before and after). The outside takes the corner's form (Wilcom's smart corners):
 *
 * - `miter`: the outer edges meet in a point, the turning stitch on the bisector;
 * - `cap`: the outer corner cut off square to the bisector, the stitches fanning over the cut;
 * - `round`: the outer corner rounded about the corner point, half the width out;
 * - `overlap` (lapped): no turning; the first arm runs on square past the corner until it covers
 *   it, the second starts square behind it and lies on top.
 *
 * A miter (the default) is capped where the turn is CAP_DEG or sharper (an inside angle under 20°,
 * Wilcom's "cap below" default): there it would reach about six widths out.
 *
 * Ends (SVG stroke-linecap): `flat` square across at the end of the line, `square` the same half a
 * width further on, `round` a half circle, its stitches square across the line and shorter towards
 * the tip.
 *
 * Made by the core (core/src/digitize/satin_joins.rs), a whole line per call.
 */
export type SatinCorner = 'miter' | 'cap' | 'round' | 'overlap';
export const SATIN_CORNERS: SatinCorner[] = ['miter', 'cap', 'round', 'overlap'];
export type SatinEnd = 'flat' | 'round' | 'square';
export const SATIN_ENDS: SatinEnd[] = ['flat', 'round', 'square'];

/** A bend from this many degrees is a corner (Daniel's rule: a turn of 45° or more). */
export const CORNER_DEG = 45;
/** A miter caps a corner turning this much or more: it would grow too long. */
export const CAP_DEG = 160;

type Rails = { left: Pt[]; right: Pt[] };

/** The style a corner is sewn in. */
export function cornerStyle(style: SatinCorner, turn: number): SatinCorner {
  return style === 'miter' && turn >= CAP_DEG ? 'cap' : style;
}

/**
 * Rails of a satin `w` wide centered on `line` (closed: its first point repeated at the end), with
 * its corners in `corner` and its ends in `ends` (an open line only); see the top.
 */
export function strokeRails(line: Pt[], closed: boolean, w: number, corner: SatinCorner = 'miter', ends: SatinEnd = 'flat'): Rails {
  const flat = core().strokeRails(flatPts(line), closed, w, corner, ends);
  const n = flat[0];
  return { left: ptsOf(flat, 1, n), right: ptsOf(flat, 1 + 2 * n, n) };
}
