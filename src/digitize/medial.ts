import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import type { Branch, Graph, Pt } from './skeleton';

/**
 * The medial axis of an area on its vector outline, for satin over a whole area (see satinInner).
 *
 * The discrete Voronoi skeleton of Ogniewicz and Ilg (1992), the method StrokeStyles (Berio et al.,
 * ACM TOG 2022) builds on: the outline is sampled densely, its constrained Delaunay triangulation
 * (shape/cdt) gives the Voronoi diagram of the samples inside the area (a vertex at each
 * triangle's circumcenter, an edge across each inner triangle edge), and of the Voronoi edges only
 * those are kept whose two samples lie far apart along the outline compared to straight across:
 * the chord residual, outline distance minus chord, at least RESIDUAL. That drops the hairs every
 * sample would grow and keeps the axis connected, with one loop round each hole.
 *
 * Each kept edge has its chord: the line between the two samples it is equidistant from, where
 * the largest circle inside the area touches the outline (a rib). Along an arm the ribs are the
 * directions a satin across it takes.
 *
 * Then end branches that hardly reach beyond the circle of the junction they hang from (the
 * corners of a rectangle) are pruned, iteratively (a scale axis criterion, see PROTRUDE), and
 * junctions within each other's circles are joined into one (the middle of a star).
 *
 * Computed by the Rust core (core/src/digitize/medial.rs, with the triangulation in shape/cdt.rs).
 */

export interface AxisBranch extends Branch {
  /** The rib at each step from pts[i] to pts[i + 1]: where the circles there touch the outline. */
  ribs: [Pt, Pt][];
  /** The triangle of each point (its circumcenter). */
  tris: number[];
}

export interface AxisNode {
  p: Pt;
  r: number;
  /** The triangles the node stands for: one, or a junction joined from several (a hub). */
  tris: number[];
  /** Ends of branches pruned here (corners beside the axis): where a bend is mitered to. */
  tips: Pt[];
}

export interface Axis extends Graph {
  nodes: AxisNode[];
  branches: AxisBranch[];
  /** The triangulation's points and triangles (three point indices each), for the area of a hub. */
  points: Pt[];
  tris: number[];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The medial axis of the area inside `outsides` and outside `holes` (closed lines in mm), computed by the core. */
export function medialAxis(outsides: Pt[][], holes: Pt[][] = []): Axis {
  const { flat, lens } = flatLines([...outsides, ...holes]);
  return core().medialAxis(flat, lens, outsides.length) as Axis;
}

/** A bend at least this sharp (degrees) between two sides is mitered. */
export const BEND_DEG = 45;

/** The direction a branch leaves node n in, over about the node's radius. */
export function leaving(b: AxisBranch, n: number, r: number): Pt {
  const pts = b.a === n ? b.pts : b.pts.slice().reverse();
  const reachMm = Math.max(r, 0.5);
  let q = pts[pts.length - 1];
  for (let i = 1; i < pts.length; i++) {
    if (dist(pts[i], pts[0]) >= reachMm) {
      q = pts[i];
      break;
    }
  }
  const l = dist(q, pts[0]) || 1;
  return [(q[0] - pts[0][0]) / l, (q[1] - pts[0][1]) / l];
}

export function reversed(b: AxisBranch): AxisBranch {
  return { a: b.b, b: b.a, pts: b.pts.slice().reverse(), r: b.r.slice().reverse(), ribs: b.ribs.slice().reverse().map(([x, y]) => [y, x]), tris: b.tris.slice().reverse() };
}
