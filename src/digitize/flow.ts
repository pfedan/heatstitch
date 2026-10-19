import type { Orientation } from '../image/orientation';
import { core } from '../wasm/core';
import type { FieldOut } from '../wasm/pkg/heatstitch_core';
import { coreParams, coreRegions, fillOf, flatOf, type FillParams, type FillResult } from './fill';
import { regionIn, type Region } from './region';
import type { Graph, Pt } from './skeleton';

/**
 * Fill whose stitch direction follows the image: fur, hair, petals, the strokes of a drawing.
 *
 * 1. Direction field: the structure tensor of the image (src/image/orientation.ts) where the image
 *    has structure, and the direction of the region's centerline where it is flat (a long shape is
 *    filled along its length), averaged as doubled angles and smoothed.
 * 2. Nearly the same direction everywhere: straight tatami rows in exactly that direction.
 * 3. Otherwise curved rows: evenly spaced streamlines of the field (Jobard & Lefer, "Creating
 *    evenly-spaced streamlines of arbitrary density", 1997). Each row is traced along the field
 *    (a line field: the direction keeps its sense from step to step, so turning points of the field
 *    need no care); new rows start one spacing beside existing ones, and a row ends where it comes
 *    closer than half a spacing to another, so rows neither pile up nor leave gaps wider than about
 *    1.5 spacings. Rows are sewn back and forth, each continuing at the nearest row end, with travel
 *    under unsewn rows between groups.
 * 4. The rows are measured before they are sewn: where they crowd (more than 2.2 times the nominal
 *    density) or leave gaps, the straight fill is used instead.
 *
 * Computed by the Rust core (core/src/digitize/flow.rs); the fields cross as their doubled angles
 * per cell, the fills as their stitches.
 */

export interface FlowResult extends FillResult {
  /** Rows follow a curved field (not straight). */
  curved: boolean;
}

/** Grid cell (mm); larger regions get coarser cells, so the grid stays near 45 000 cells. */
const CELL_MIN = 0.2;
const CELLS = 45000;
const FLOW_PEAK = 2.2;
const FLOW_COVER = 0.95;

/** The cells of a direction field over a region (made by the core for that region). */
export interface Grid {
  cell: number;
  gw: number;
  gh: number;
  ox: number;
  oy: number;
}

/** A direction field over a region, as doubled-angle vectors per cell of its grid. */
export interface DirField {
  g: Grid;
  c: Float32Array;
  s: Float32Array;
}

/** A field the core made. */
export function fieldOf(o: FieldOut): DirField {
  const f = { g: { cell: o.cell, gw: o.gw, gh: o.gh, ox: o.ox, oy: o.oy }, c: o.takeC(), s: o.takeS() };
  o.free();
  return f;
}

/**
 * Fill following the image's direction; null when the region has no direction to follow (the
 * caller fills it straight at the usual angle) or curved rows fail the checks.
 */
export function flowFill(r: Region, graph: Graph | null, orient: Orientation, p: FillParams, start: Pt): FlowResult | null {
  // Only the image window the region's grid looks at crosses (see Grid in flow.rs).
  const { width, height } = orient;
  const cell = Math.max(CELL_MIN, Math.sqrt((r.w * r.h * r.pxMm * r.pxMm) / CELLS));
  const pad = Math.ceil(cell / r.pxMm) + 2;
  const cx0 = Math.min(width - 1, Math.max(0, r.x0));
  const cy0 = Math.min(height - 1, Math.max(0, r.y0));
  const cx1 = Math.max(cx0 + 1, Math.min(width, r.x0 + r.w + pad));
  const cy1 = Math.max(cy0 + 1, Math.min(height, r.y0 + r.h + pad));
  const cw = cx1 - cx0;
  const c = new Float32Array(cw * (cy1 - cy0));
  const s = new Float32Array(c.length);
  for (let y = cy0; y < cy1; y++) {
    c.set(orient.c.subarray(y * width + cx0, y * width + cx1), (y - cy0) * cw);
    s.set(orient.s.subarray(y * width + cx0, y * width + cx1), (y - cy0) * cw);
  }
  const res = core().flowFill(regionIn(r), graph, c, s, cx0, cy0, cw, width, height, coreParams(p), start[0], start[1], ...coreRegions(r, p));
  return fillOf(res, true) as FlowResult | null;
}

/**
 * Field of rows that run along the outline (contour fill): at every cell the direction across the
 * gradient of the distance to the edge, so rows form rings inside the shape.
 */
export const contourField = (r: Region): DirField => fieldOf(core().contourField(regionIn(r)));

/**
 * Field of the directions of given stitches (rows as sewn), spread over the whole region: keeps
 * the look of curved rows when they are sewn anew at another spacing.
 */
export function stitchField(r: Region, lines: [Pt, Pt][]): DirField {
  const flat = new Float64Array(4 * lines.length);
  lines.forEach(([a, b], i) => flat.set([a[0], a[1], b[0], b[1]], 4 * i));
  return fieldOf(core().stitchField(regionIn(r), flat));
}

/**
 * Field of guide lines drawn on a fill (Ink/Stitch's guided fill): every cell takes the direction
 * of the nearest point of each guide, weighted by the inverse square of its distance, so one guide
 * gives rows parallel to it and several guides blend from one to the next.
 */
export function guideField(r: Region, guides: Pt[][]): DirField {
  const flat = new Float64Array(2 * guides.reduce((n, l) => n + l.length, 0));
  let i = 0;
  for (const l of guides) {
    flat.set(flatOf(l), i);
    i += 2 * l.length;
  }
  return fieldOf(core().guideField(regionIn(r), flat, Uint32Array.from(guides, (l) => l.length)));
}

/**
 * Fill along a direction field: straight tatami rows when the field has nearly one direction
 * (unless `curvedOnly`), else curved rows; null when there is no direction or the rows fail the
 * checks. `peak` is the highest density allowed anywhere, in times the nominal 1 / spacing. The
 * field must have been made for `r` (its grid `g` is the region's).
 */
export function fieldFill(
  r: Region,
  g: Grid,
  f: { c: Float32Array; s: Float32Array },
  p: FillParams,
  start: Pt,
  curvedOnly = false,
  peak = FLOW_PEAK,
  cover = FLOW_COVER,
): FlowResult | null {
  void g;
  const res = core().fieldFill(regionIn(r), f.c, f.s, coreParams(p), start[0], start[1], curvedOnly, peak, cover, ...coreRegions(r, p));
  return fillOf(res, true) as FlowResult | null;
}

/**
 * Contour fill as rings at even distances inside the edge (Ink/Stitch's contour fill): the level
 * lines of the area's distance field, the first half a spacing inside the edge (moved out by
 * `pull`), each next one a spacing further in. Every ring is exactly one spacing from its
 * neighbours all round, so the rows neither crowd nor open up, also in narrow and bent shapes.
 * Each ring passes on to the next over a few millimetres, without a step (see rings.ts).
 */
export function contourFill(r: Region, p: FillParams, start: Pt): FillResult | null {
  return fillOf(core().contourFill(regionIn(r), coreParams(p), start[0], start[1], ...coreRegions(r, p)));
}
