import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import { fromCore, type Region } from './region';
import { insideOf } from './rungs';
import type { Graph, Pt } from './skeleton';

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

export type BlobKind = 'dot' | 'pointed' | 'leaf' | 'drop';

export interface ShapePlan {
  kind: BlobKind;
  cuts: [Pt, Pt][];
  lines: [Pt, Pt][];
}

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

/**
 * The holes that lie in a thick place rather than between lines (the highlight in a pupil): round,
 * and the area around them at least as thick as they are wide. Thick places are found with these
 * filled, so a highlight does not turn the pupil around it into lines.
 */
export function smallHoles(g: Graph, holes: Pt[][]): Pt[][] {
  const h = flatLines(holes);
  return [...core().smallHoles(g, h.flat, h.lens)].map((k) => holes[k]);
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

/**
 * The thick places of a drawing of lines, the cut lines that part them from the lines, and what is
 * left of the lines (a graph for planStrokes). Null when there is none.
 */
export function splitBlobs(g: Graph): { blobs: Blob[]; cuts: [Pt, Pt][]; strokes: Graph } | null {
  return core().splitBlobs(g) as { blobs: Blob[]; cuts: [Pt, Pt][]; strokes: Graph } | null;
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

/** A whole area as a shape (`material`: the area's, see materialOf; the core makes its own from the outlines). */
export function wholeShape(outsides: Pt[][], holes: Pt[][], _material?: Material): Shape {
  const o = flatLines(outsides);
  const h = flatLines(holes);
  return core().wholeShape(o.flat, o.lens, h.flat, h.lens) as Shape;
}

/**
 * A thick place as a shape: the part of the area nearer to its disks than to the lines left
 * (`lines`: the centerlines of what is left, see splitBlobs), so its corners count too.
 */
export function blobShape(blob: Blob, lines: Graph, outsides: Pt[][], holes: Pt[][], _material?: Material): Shape {
  const o = flatLines(outsides);
  const h = flatLines(holes);
  return core().blobShape(blob, lines, o.flat, o.lens, h.flat, h.lens) as Shape;
}

/**
 * Cut lines and lines across for a compact shape: a dot or a pointed area (see the top), or null
 * when it fits neither within the satin limit `max` (mm). A fan is preferred unless a column
 * across keeps the stitches clearly shorter.
 */
export function planShape(s: Shape, material: Material, max: number, split = true, column = false): ShapePlan | null {
  const o = flatLines(material.outsides);
  const h = flatLines(material.holes);
  return core().planShape(s, o.flat, o.lens, h.flat, h.lens, max, split, column) as ShapePlan | null;
}
