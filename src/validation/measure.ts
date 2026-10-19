import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';

/**
 * The constants of the measurement, as the core uses them (core/src/validation/measure.rs); the
 * correction engine builds its fast measure on the same grid (core/src/correct/engine/field.rs). Values are
 * computed on 0.2 mm sub-cells, smoothed, then reduced to 1 mm cells: 0.2 mm divides the 0.1 mm
 * file resolution evenly, so regular row spacings do not alias.
 */

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
  /** Mean thread density of cells well inside stitched area (0 elsewhere), for fabric showing through. */
  cover: Float32Array;
  /** Gap pixels (0.01 mm² each) per cell once the thread has pulled in, on stable and on stretchy fabric. */
  gapsLow: Uint8Array;
  gapsHigh: Uint8Array;
  /** Longest stitch with an end in the cell (0.1 mm). */
  longest: Uint16Array;
}

/**
 * Measures thread density, satin share, short stitches and penetrations per 1 mm cell, and the
 * lower limits (coverage.ts), in one call to the Rust core (core/src/validation/measure.rs). Taking
 * the peak instead of the mean of each cell keeps narrow columns (lettering, borders) from being
 * averaged away with their empty surroundings.
 */
export function measurePattern(p: Pattern, skipCover?: Uint8Array, gaps = true): Measurement {
  const b = p.bounds;
  const r = core().measurePattern(p.x, p.y, p.cmd, Float64Array.of(b.minX, b.minY, b.maxX, b.maxY), skipCover, gaps);
  try {
    return {
      originX: r.originX,
      originY: r.originY,
      cols: r.cols,
      rows: r.rows,
      cellMm: r.cellMm,
      density: r.takeDensity(),
      satin: r.takeSatin(),
      shorts: r.takeShorts(),
      holes: r.takeHoles(),
      cover: r.takeCover(),
      gapsLow: r.takeGapsLow(),
      gapsHigh: r.takeGapsHigh(),
      longest: r.takeLongest(),
    };
  } finally {
    r.free();
  }
}

/** Buffers of a measurement, for transferring it out of a worker. */
export const measurementBuffers = (m: Measurement): ArrayBuffer[] =>
  [m.density, m.satin, m.shorts, m.holes, m.cover, m.gapsLow, m.gapsHigh, m.longest].map((a) => a.buffer as ArrayBuffer);
