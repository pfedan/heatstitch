import { forEachThreadSegment, STITCH, type Pattern } from '../model/pattern';
import { gaussianBlur } from './blur';

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

/** Adds `length` to every cell the segment a->b (cell units) passes, split exactly by crossing points. */
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
 * Builds the density grid. `segmentFilter` (thread metric only) receives the record index a
 * thread piece ends at and can exclude it, e.g. to measure satin thread separately.
 */
export function computeDensity(p: Pattern, opt: DensityOptions, segmentFilter?: (end: number) => boolean): DensityGrid {
  const cell = opt.cellMm;
  const sigmaCells = opt.blurMm > 0 ? opt.blurMm / cell : 0;
  const pad = Math.ceil(3 * sigmaCells) + 1;
  const b = p.bounds;
  const align = opt.alignMm ?? cell;
  const padMm = Math.ceil((pad * cell) / align - 1e-9) * align;
  const originX = Math.floor(b.minX / 10 / align) * align - padMm + (opt.shiftMm ?? 0);
  const originY = Math.floor(b.minY / 10 / align) * align - padMm + (opt.shiftMm ?? 0);
  const cols = Math.floor((b.maxX / 10 - originX) / cell) + 1 + pad;
  const rows = Math.floor((b.maxY / 10 - originY) / cell) + 1 + pad;
  let data: Float32Array = new Float32Array(cols * rows);
  const toCell = (v: number, o: number) => (v / 10 - o) / cell;

  if (opt.metric === 'thread') {
    forEachThreadSegment(p, opt.includeJumps, (x0, y0, x1, y1, end) => {
      if (segmentFilter && !segmentFilter(end)) return;
      const len = Math.hypot(x1 - x0, y1 - y0) / 10;
      if (len === 0) return;
      addSegment(data, cols, rows, toCell(x0, originX), toCell(y0, originY), toCell(x1, originX), toCell(y1, originY), len);
    });
  } else {
    for (let i = 0; i < p.cmd.length; i++) {
      if (p.cmd[i] !== STITCH) continue;
      const cx = Math.floor(toCell(p.x[i], originX));
      const cy = Math.floor(toCell(p.y[i], originY));
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) data[cy * cols + cx] += 1;
    }
  }

  const area = cell * cell;
  for (let i = 0; i < data.length; i++) data[i] /= area;
  if (sigmaCells > 0) data = gaussianBlur(data, cols, rows, sigmaCells);

  let max = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
  return { data, cols, rows, originX, originY, cellMm: cell, max };
}
