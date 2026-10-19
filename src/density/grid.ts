import { STITCH, type Pattern } from '../model/pattern';
import { core } from '../wasm/core';

export type Metric = 'thread' | 'penetrations';

export interface DensityOptions {
  metric: Metric;
  /** Cell edge length in mm. */
  cellMm: number;
  /** Gaussian sigma in mm, 0 disables smoothing. */
  blurMm: number;
  /** Count untrimmed jump threads as thread (thread metric only). */
  includeJumps: boolean;
  /** Snap the grid origin to multiples of this (mm); defaults to the cell size. */
  alignMm?: number;
  /** Added to the snapped origin (mm), e.g. to keep 0.1 mm stitch coordinates off cell edges. */
  shiftMm?: number;
}

export interface DensityGrid {
  /** Row-major values: mm thread per mm² or penetrations per mm². */
  data: Float32Array;
  cols: number;
  rows: number;
  /** World position (mm, y down) of the top-left corner of cell (0,0). */
  originX: number;
  originY: number;
  cellMm: number;
  max: number;
}

/**
 * Adds `length` to every cell the segment a->b (cell units) passes, split exactly by crossing points.
 * The grid itself is built in Rust; this per-segment helper stays for callers that add one piece.
 */
export function addSegment(
  data: Float32Array,
  cols: number,
  rows: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  length: number,
): void {
  let cx = Math.floor(ax);
  let cy = Math.floor(ay);
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx > 0 ? (cx + 1 - ax) / dx : dx < 0 ? (cx - ax) / dx : Infinity;
  let tMaxY = dy > 0 ? (cy + 1 - ay) / dy : dy < 0 ? (cy - ay) / dy : Infinity;
  let t = 0;
  // Upper bound on visited cells guards against float edge cases.
  let guard = Math.abs(Math.floor(bx) - cx) + Math.abs(Math.floor(by) - cy) + 2;
  while (guard-- > 0) {
    const tNext = Math.min(tMaxX, tMaxY, 1);
    if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) data[cy * cols + cx] += (tNext - t) * length;
    if (tNext >= 1) return;
    t = tNext;
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
  }
}

/**
 * Builds the density grid, in the Rust core (core/src/density/grid.rs). `filter` receives a record
 * index and can exclude it: for the thread metric the record a thread piece ends at (e.g. to
 * measure satin thread separately), for penetrations the stitch record itself. It is asked once per
 * stitch record here, so the core gets the design in one call.
 */
export function computeDensity(p: Pattern, opt: DensityOptions, filter?: (index: number) => boolean): DensityGrid {
  let keep: Uint8Array | undefined;
  if (filter) {
    keep = new Uint8Array(p.cmd.length);
    for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH && filter(i)) keep[i] = 1;
  }
  const b = p.bounds;
  const r = core().computeDensity(p.x, p.y, p.cmd, Float64Array.of(b.minX, b.minY, b.maxX, b.maxY), opt, keep);
  try {
    return { data: r.takeData(), cols: r.cols, rows: r.rows, originX: r.originX, originY: r.originY, cellMm: opt.cellMm, max: r.max };
  } finally {
    r.free();
  }
}
