import { computeDensity } from '../density/grid';
import type { Pattern } from '../model/pattern';
import { satinMask } from './satin';
import { shortStitchCounts } from './shortStitches';
import { CAUTION, classify, CRITICAL, SHORT_STITCH_COUNT, type Level } from './thresholds';
import { findZones, type Zone } from './zones';

/** Validation always uses 1 mm cells, independent of the display settings. */
export const VALIDATION_CELL_MM = 1;
/**
 * Density is computed on 1/SUB mm sub-cells, smoothed, then averaged into 1 mm cells. 0.2 mm
 * sub-cells divide the 0.1 mm file resolution evenly, so regular row spacings do not alias.
 */
const SUB = 5;
/** Shifts the grid by half the file resolution so no stitch coordinate sits on a cell edge. */
const SHIFT_MM = -0.05;
const BLUR_MM = 0.5;
/** A cell is satin if at least this share of its thread is satin. */
const SATIN_SHARE = 0.5;

export interface ValidationResult {
  /** World position (mm) of the top-left corner of cell (0, 0). */
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  cellMm: number;
  /** Thread density per cell, mm/mm². */
  density: Float32Array;
  /** Level per cell (SAFE / CAUTION / CRITICAL). */
  level: Uint8Array;
  /** Flat [cx, cy, cx, cy, ...] cell coordinates per state. */
  caution: Int32Array;
  critical: Int32Array;
  zones: Zone[];
  maxDensity: number;
}

interface CellGrid {
  data: Float32Array;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
}

/**
 * Thread density on 1 mm cells, free of the aliasing between ~0.4 mm row spacing and the cell size:
 * computed on 0.2 mm sub-cells with a 0.5 mm Gaussian, then box-averaged. Cells start at whole
 * millimetres minus SHIFT_MM.
 */
function thread1mm(p: Pattern, filter?: (end: number) => boolean): CellGrid {
  const g = computeDensity(
    p,
    {
      metric: 'thread',
      cellMm: VALIDATION_CELL_MM / SUB,
      blurMm: BLUR_MM,
      includeJumps: false,
      alignMm: VALIDATION_CELL_MM,
      shiftMm: SHIFT_MM,
    },
    filter,
  );
  const cols = Math.ceil(g.cols / SUB);
  const rows = Math.ceil(g.rows / SUB);
  const data = new Float32Array(cols * rows);
  for (let y = 0; y < g.rows; y++) {
    const row = Math.floor(y / SUB) * cols;
    for (let x = 0; x < g.cols; x++) data[row + Math.floor(x / SUB)] += g.data[y * g.cols + x];
  }
  for (let i = 0; i < data.length; i++) data[i] /= SUB * SUB;
  return { data, cols, rows, originX: g.originX, originY: g.originY };
}

export function validatePattern(p: Pattern): ValidationResult {
  const total = thread1mm(p);
  const mask = satinMask(p);
  const satin = thread1mm(p, (end) => mask[end] === 1);
  const { cols, rows, originX, originY, data: density } = total;
  const shorts = shortStitchCounts(p, originX, originY, cols, rows);

  const level = new Uint8Array(cols * rows);
  const densityLevel = new Uint8Array(cols * rows);
  const shortFlag = new Uint8Array(cols * rows);
  const caution: number[] = [];
  const critical: number[] = [];
  let maxDensity = 0;
  for (let i = 0; i < level.length; i++) {
    const v = density[i];
    if (v > maxDensity) maxDensity = v;
    const isSatin = v > 0 && satin.data[i] >= SATIN_SHARE * v;
    let l: Level = classify(v, isSatin);
    densityLevel[i] = l;
    if (shorts[i] >= SHORT_STITCH_COUNT) {
      shortFlag[i] = 1;
      l = CRITICAL;
    }
    level[i] = l;
    const cx = i % cols;
    const cy = (i - cx) / cols;
    if (l === CAUTION) caution.push(cx, cy);
    else if (l === CRITICAL) critical.push(cx, cy);
  }

  return {
    originX,
    originY,
    cols,
    rows,
    cellMm: VALIDATION_CELL_MM,
    density,
    level,
    caution: Int32Array.from(caution),
    critical: Int32Array.from(critical),
    zones: findZones(level, density, shortFlag, densityLevel, cols, rows, originX, originY, VALIDATION_CELL_MM),
    maxDensity,
  };
}

export { CAUTION, CRITICAL, SAFE, classify, type Level } from './thresholds';
export type { Reason, Zone } from './zones';
