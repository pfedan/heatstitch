import type { Pt } from '../digitize/skeleton';
import { core } from '../wasm/core';
import type { Form } from './path';

/**
 * Operations on forms as vectors: areas joined and cut exactly on their curves, areas grown or
 * shrunk by a distance (polygons, curves fitted again), paths cut where they cross, a fill cut apart
 * along drawn lines, and the free area around shapes. Computed by the Rust core
 * (core/src/shape/ops.rs): joining and cutting with `i_curve`, offsets with `clipper2-rust`.
 *
 * Chosen by measurement on the forms of the demo project and the SVG examples (see
 * core/src/shape/ops.rs and the pull request "Rust core stage 2"): joining is within 0.001 mm of a
 * 1 µm reference in every case, also on hard ones (a form against itself moved by 1e-7 mm or turned)
 * and keeps the nodes where they were; offsetting gives what Clipper2 in TypeScript gave before.
 */

/** The areas of the forms as one (their closed paths; each fills by its own rule). Null when empty. */
export function unionForms(forms: Form[]): Form | null {
  return core().unionForms(forms) as Form | null;
}

/** The area of `a` without the area of `b`; null when nothing is left. */
export function subtractForm(a: Form, b: Form): Form | null {
  return core().subtractForm(a, b) as Form | null;
}

/** Area enclosed by a form, exact on its curves (mm², even-odd or nonzero as the form says). */
export function areaOfForm(f: Form): number {
  return core().areaOfForm(f);
}

/**
 * The form with a node wherever its paths cross (themselves or each other), the curves split
 * exactly there so the outline stays as it was; null when nothing crosses. Touching without
 * crossing does not count.
 */
export function withCrossingNodes(f: Form): { form: Form; added: number } | null {
  return core().withCrossingNodes(f) as { form: Form; added: number } | null;
}

/** A fill cut apart: its parts (largest first, each reaching under its neighbours) and which touch. */
export interface SplitForms {
  parts: Form[];
  touching: [number, number][];
}

/** The areas both forms cover; null when none. */
export function intersectForms(a: Form, b: Form): Form | null {
  return core().intersectForms(a, b) as Form | null;
}

/** Polylines as one flat list of x, y and the point count of each. */
function flatLines(lines: Pt[][]): { flat: Float64Array; lens: Uint32Array } {
  const flat = new Float64Array(2 * lines.reduce((s, l) => s + l.length, 0));
  let i = 0;
  for (const l of lines)
    for (const [x, y] of l) {
      flat[i++] = x;
      flat[i++] = y;
    }
  return { flat, lens: Uint32Array.from(lines, (l) => l.length) };
}

/**
 * Form `f` cut along the polylines `cuts` (world mm), on its curves: the parts keep the nodes and
 * curves of `f`; along a cut each reaches `overlap` mm under its neighbour. A cut that ends inside
 * the area within `reach` mm of its edge is taken on to it. Pieces under `minPart` mm² are no part of
 * their own; they go to the nearest part. Null when the cuts leave it in one piece.
 */
export function splitForm(f: Form, cuts: Pt[][], overlap: number, minPart: number, reach: number): SplitForms | null {
  const { flat, lens } = flatLines(cuts);
  return core().splitForm(f, flat, lens, overlap, minPart, reach) as SplitForms | null;
}

/**
 * The area of `f` grown by `d` mm (shrunk when negative), round at the corners. Lines (open paths)
 * count with `lineWidth`: their band grows by `d` too. Null when nothing is left. Without `fit` the
 * result stays polygons (straight nodes 0.01 mm off the curve): for working on, without a fit's error.
 */
export function offsetForm(f: Form, d: number, lineWidth = 0, fit = true): Form | null {
  return core().offsetForm(f, d, lineWidth, fit) as Form | null;
}

/**
 * The area a thread `w` mm wide covers along every path of `f` (closed ones all round, not filled),
 * round at the ends and corners: what a line sews. Null when nothing is left; `fit` as in offsetForm.
 */
export function bandForm(f: Form, w: number, fit = true): Form | null {
  return core().bandForm(f, w, fit) as Form | null;
}

/** How a stroke of an SVG ends and turns its corners. */
export type StrokeCap = 'butt' | 'round' | 'square';
export type StrokeJoin = 'miter' | 'round' | 'bevel';

/**
 * The area a stroke `w` mm wide paints along the paths of `f`, as SVG draws it: its ends and
 * corners as given (`miter` the longest a miter may reach, as a multiple of the half width; a
 * sharper corner is cut off), closed paths all round and not filled. Null when nothing is left.
 */
export function strokeForm(f: Form, w: number, cap: StrokeCap = 'butt', join: StrokeJoin = 'miter', miter = 4): Form | null {
  return core().strokeForm(f, w, cap, join, miter) as Form | null;
}

// Filling a gap (Flächen-Werkzeug) ------------------------------------------------------------------

/** What stands in the way of a new area: an area of its own, or a line covering a band `width` mm wide. */
export interface Obstacle {
  form: Form;
  /** A line (every path, closed ones too, is a thread): its band. Otherwise the closed paths are an area. */
  line: boolean;
  width: number;
  /** Which object it stands for (its place in the list it was made from). */
  of?: number;
}

/**
 * How far the gap may reach: shapes all round (`closed`), or the convex hull of all shapes (`hull`).
 * `wrap` fills no gap: it lays the convex hull around the shapes in the clicked area, under them.
 */
export type GapMode = 'closed' | 'hull' | 'wrap';

/**
 * The gap at `at`, or why there is none: `outside` (in `closed`, the point is not shut in by shapes),
 * `covered` (on a shape, or the gap is too small to sew), `empty` (in `wrap`, no shape lies in the area).
 */
export type GapResult = { form: Form } | { none: 'outside' | 'covered' | 'empty' };

/**
 * The free area at `at` (Flächen-Werkzeug): what is left of the bound after every obstacle, grown by
 * the gap `d` mm, is taken away, and of that the part holding `at`, with its holes. The bound is a
 * box well around all shapes (`closed`: a part touching it is not shut in, so there is none) or the
 * convex hull of the shapes (`hull`: bays are bridged straight; a point outside the hull takes every
 * free part in it as one form). In `wrap` the bound is the box, and the result is the convex hull of
 * the shapes lying in the part holding `at` (its holes), grown by `d` and kept inside the part's own
 * outline: the shapes in it are covered, the ones around it are not (the shapes are not grown here,
 * so the part is the free space as it is). Planar boolean operations on the polygons, the result
 * fitted as curves.
 */
export function gapAt(obstacles: Obstacle[], at: Pt, d: number, mode: GapMode): GapResult {
  const g = core().gapFinder(obstacles, d, mode);
  try {
    return g.at(at[0], at[1]) as GapResult;
  } finally {
    g.free();
  }
}

/**
 * gapAt for many points over the same shapes (the preview while the pointer moves): the free parts
 * are worked out once, each form fitted on first use. The core frees them when the function is gone.
 */
export function gapFinder(obstacles: Obstacle[], d: number, mode: GapMode): (at: Pt) => GapResult {
  const g = core().gapFinder(obstacles, d, mode);
  return (at: Pt): GapResult => g.at(at[0], at[1]) as GapResult;
}
