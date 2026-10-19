import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import { fromCore, type Region } from './region';
import { insideOf } from './rungs';
import type { Pt } from './skeleton';

/**
 * Compact shapes for "Vorschlagen" (see satinSuggest): areas that are no line but are sewn as satin
 * the way a digitizer would, each by its own planner. They are found on their own (a fill that is
 * a dot or a triangle) and inside a drawing of lines (the nose on the mouth, the pupil on the ring
 * of the eye: a thick place the lines run into). There they are cut off where the line starts and
 * planned apart from the lines.
 *
 * - `dot`: a round area. Up to the satin limit one column across; wider (up to DOT_MAX) cut in two
 *   halves along its long axis (through a hole in it, as the highlight in a pupil), each sewn
 *   square to the cut, so no stitch is longer than the half.
 * - `pointed`: an area with corners (a triangle, a nose). The lines across fan out from the corner
 *   that keeps the stitches shortest to the edge opposite it.
 * - `leaf` and `drop`: a long round area pointed at both ends or at one. Sewn as a dot is (one
 *   column, or halves cut along its middle as the vein of a leaf); the halves of a leaf slant
 *   toward its tip, as the veins do.
 *
 * Planned by the core (core/src/digitize/satin_shapes.rs), a whole area or shape per call.
 */

/** Widest round area cut into two halves (mm). */
export const DOT_MAX = 12;

/** Whether a point lies on the area, with the outlines it was made of (the core works from those). */
export type Material = ((q: Pt) => boolean) & { outsides: Pt[][]; holes: Pt[][] };

/** Whether a point lies on the area: inside one of its outsides and in none of its holes. */
export function materialOf(outsides: Pt[][], holes: Pt[][]): Material {
  const outs = outsides.map(insideOf);
  const ins = holes.map(insideOf);
  return Object.assign((q: Pt) => outs.some((f) => f(q)) && !ins.some((f) => f(q)), { outsides, holes });
}

/** The area with these holes filled. */
export function filled(area: Region, holes: Pt[][]): Region {
  const h = flatLines(holes);
  return fromCore(core().filledRegion(area.mask, area.w, area.h, area.x0, area.y0, area.pxMm, h.flat, h.lens), 1, area.pxMm);
}

/** A thick place inside a drawing of lines: the disks of its centerline and where lines leave it. */
export interface Blob {
  disks: { p: Pt; r: number }[];
  /** Where a line leaves it: the point on the line's centerline, its direction there and half width. */
  attach: { p: Pt; t: Pt; r: number }[];
}

/** The shape to plan: points of it on a grid, and the stretches of the outline around it. */
export interface Shape {
  samples: Pt[];
  /** Outline points of the shape, as stretches in order (for its corners). */
  outline: Pt[][];
  /** Holes lying inside the shape. */
  holes: Pt[][];
  /** Where lines leave it (see Blob). */
  attach: { p: Pt; t: Pt; r: number }[];
}
