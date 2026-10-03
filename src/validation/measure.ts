import { computeDensity, type Metric } from '../density/grid';
import { STITCH, type Pattern } from '../model/pattern';
import { satinMask } from './satin';
import { shortStitchCounts, tagShortStitches, TIE } from './shortStitches';

/** Validation always uses 1 mm cells, independent of the display settings. */
export const VALIDATION_CELL_MM = 1;
/**
 * Values are computed on 1/SUB mm sub-cells, smoothed, then reduced to 1 mm cells. 0.2 mm
 * sub-cells divide the 0.1 mm file resolution evenly, so regular row spacings do not alias.
 */
const SUB = 5;
/** Shifts the grid by half the file resolution so no stitch coordinate sits on a cell edge. */
const SHIFT_MM = -0.05;
/**
 * Smoothing radius. Large enough to even out row spacing, 0.1 mm coordinate rounding and sparse
 * underlay rows (uniform fills read within about 7 % above their nominal density), small enough
 * to resolve 1 to 2 mm columns such as lettering.
 */
export const BLUR_MM = 0.6;
/** Penetrations closer than this (mm) to a penetration count as its neighbours. */
export const HOLE_RADIUS_MM = 1;

/** Profile-independent measurements on the 1 mm validation grid, computed once per file. */
export interface Measurement {
  /** World position (mm) of the top-left corner of cell (0, 0). */
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  cellMm: number;
  /** Peak smoothed thread density within each cell, mm/mm². */
  density: Float32Array;
  /** Share (0 to 1) of the cell's thread that belongs to satin columns. */
  satin: Float32Array;
  /** Non-exempt stitches shorter than 1 mm per cell. */
  shorts: Uint16Array;
  /**
   * Most neighbouring penetrations within HOLE_RADIUS_MM that any penetration in the cell has.
   * Holes lined up closely (dense satin edges, stacked edges, tight curves) perforate leather.
   * Tie-ins and tie-offs are excluded.
   */
  holes: Uint8Array;
}

interface SubGrid {
  data: Float32Array;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
}

function subGrid(p: Pattern, metric: Metric, filter?: (i: number) => boolean): SubGrid {
  return computeDensity(
    p,
    {
      metric,
      cellMm: VALIDATION_CELL_MM / SUB,
      blurMm: BLUR_MM,
      includeJumps: false,
      alignMm: VALIDATION_CELL_MM,
      shiftMm: SHIFT_MM,
    },
    filter,
  );
}

/** Reduces SUB x SUB blocks of sub-cells to one value: their maximum or their mean. */
function reduce(g: SubGrid, mode: 'max' | 'mean'): Float32Array {
  const cols = Math.ceil(g.cols / SUB);
  const rows = Math.ceil(g.rows / SUB);
  const out = new Float32Array(cols * rows);
  for (let y = 0; y < g.rows; y++) {
    const row = Math.floor(y / SUB) * cols;
    for (let x = 0; x < g.cols; x++) {
      const i = row + Math.floor(x / SUB);
      const v = g.data[y * g.cols + x];
      if (mode === 'max') {
        if (v > out[i]) out[i] = v;
      } else out[i] += v;
    }
  }
  if (mode === 'mean') for (let i = 0; i < out.length; i++) out[i] /= SUB * SUB;
  return out;
}

/**
 * Measures thread density, satin share, short stitches and penetrations per 1 mm cell. Taking
 * the peak instead of the mean of each cell keeps narrow columns (lettering, borders) from being
 * averaged away with their empty surroundings.
 */
export function measurePattern(p: Pattern): Measurement {
  const total = subGrid(p, 'thread');
  const mask = satinMask(p);
  const satinSub = subGrid(p, 'thread', (end) => mask[end] === 1);
  const tags = tagShortStitches(p);

  const cols = Math.ceil(total.cols / SUB);
  const rows = Math.ceil(total.rows / SUB);
  const { originX, originY } = total;
  const density = reduce(total, 'max');
  const totalMean = reduce(total, 'mean');
  const satinMean = reduce(satinSub, 'mean');
  const satin = new Float32Array(cols * rows);
  for (let i = 0; i < satin.length; i++) {
    satin[i] = totalMean[i] > 0 ? Math.min(1, satinMean[i] / totalMean[i]) : 0;
  }
  return {
    originX,
    originY,
    cols,
    rows,
    cellMm: VALIDATION_CELL_MM,
    density,
    satin,
    shorts: shortStitchCounts(p, tags, originX, originY, cols, rows),
    holes: holeNeighbours(p, tags, originX, originY, cols, rows),
  };
}

/** Per cell, the highest neighbour count (within HOLE_RADIUS_MM) of any penetration in it. */
function holeNeighbours(
  p: Pattern,
  tags: Uint8Array,
  originX: number,
  originY: number,
  cols: number,
  rows: number,
): Uint8Array {
  const r = HOLE_RADIUS_MM * 10; // 0.1 mm units
  const r2 = r * r + 1e-6;
  const idx: number[] = [];
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH && tags[i] !== TIE) idx.push(i);

  // Spatial hash with bucket size r: neighbours lie in the 3 x 3 surrounding buckets.
  const buckets = new Map<number, number[]>();
  const key = (bx: number, by: number) => bx * 1_000_003 + by;
  for (const i of idx) {
    const k = key(Math.floor(p.x[i] / r), Math.floor(p.y[i] / r));
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }

  const out = new Uint8Array(cols * rows);
  for (const i of idx) {
    const bx = Math.floor(p.x[i] / r);
    const by = Math.floor(p.y[i] / r);
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of buckets.get(key(bx + dx, by + dy)) ?? []) {
          if (j === i) continue;
          const ex = p.x[j] - p.x[i];
          const ey = p.y[j] - p.y[i];
          if (ex * ex + ey * ey <= r2) n++;
        }
      }
    }
    const cx = Math.floor(p.x[i] / 10 - originX);
    const cy = Math.floor(p.y[i] / 10 - originY);
    if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) {
      const c = cy * cols + cx;
      out[c] = Math.max(out[c], Math.min(255, n));
    }
  }
  return out;
}

/** Buffers of a measurement, for transferring it out of a worker. */
export const measurementBuffers = (m: Measurement): ArrayBuffer[] =>
  [m.density, m.satin, m.shorts, m.holes].map((a) => a.buffer as ArrayBuffer);
