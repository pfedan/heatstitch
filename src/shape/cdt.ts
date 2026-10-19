import { core } from '../wasm/core';

/**
 * Constrained Delaunay triangulation of closed outlines (outsides and holes), for the medial axis
 * (see digitize/medial.ts).
 *
 * Points are inserted one by one and the triangulation kept Delaunay by Lawson flips; the outline
 * segments are then forced in by flipping the edges they cross (Sloan 1993) and the Delaunay
 * property restored around them, never flipping a segment. The triangles inside are those reached
 * from outside across an odd number of segments (even-odd, as areaLoops reads outsides and holes).
 *
 * The predicates are exact: coordinates are snapped to a grid of 0.0001 mm, small enough to change
 * nothing visible and coarse enough that orientation is exact in doubles; the in-circle test is
 * filtered in doubles (Shewchuk's error bound) and decided in exact integers when the filter is unsure.
 */

export type Pt = [number, number];

export interface Triangulation {
  /** The points as snapped (mm); duplicates of an earlier point are left out (see `index`). */
  points: Pt[];
  /** Per input point (outlines one after the other), its index in `points`. */
  index: number[];
  /** Three point indices per triangle, counterclockwise (y up) or clockwise on screen (y down). */
  tris: number[];
  /** Per half-edge (3 per triangle, edge k of triangle t from tris[3t+k] to the next): the twin half-edge, or -1. */
  twin: number[];
  /** Per half-edge: whether it is an outline segment. */
  fixed: boolean[];
}

/** Lines as one flat x, y list and the point count of each, as the core takes them. */
export function flatLines(lines: Pt[][]): { flat: Float64Array; lens: Uint32Array } {
  const lens = Uint32Array.from(lines, (l) => l.length);
  const flat = new Float64Array(2 * lens.reduce((s, n) => s + n, 0));
  let i = 0;
  for (const l of lines) {
    for (const p of l) {
      flat[i++] = p[0];
      flat[i++] = p[1];
    }
  }
  return { flat, lens };
}

/**
 * The triangles inside closed outlines `loops` (each a list of points, closing on itself). Nothing
 * for less than three points. Self-crossing outlines are triangulated as far as they go; a segment
 * through another point is split there. Computed by the core (core/src/shape/cdt.rs).
 */
export function triangulate(loops: Pt[][]): Triangulation {
  const { flat, lens } = flatLines(loops);
  return core().triangulate(flat, lens) as Triangulation;
}
