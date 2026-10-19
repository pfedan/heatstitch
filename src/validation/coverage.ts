import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';

/**
 * The lower limits a design has to keep, next to the upper ones (density, short stitches,
 * perforation): fabric that shows through, gaps that open where the thread pulls the fabric, and
 * stitches long enough to snag. Measured profile-independently like the rest (see measure.ts); the
 * profile picks the limit when the cells are classified.
 */

/**
 * How far rows and satin stitches pull in at each end, as a share of their length and at most
 * `cap` mm: on stable fabric (woven, caps, leather) and on stretchy or soft fabric (knits, terry,
 * light fabrics). Typical pull compensation in digitizing guides: 0.1 to 0.3 mm on woven fabric,
 * 0.3 to 0.5 mm on knits. The core measures with the same values (PULL_LOW, PULL_HIGH in
 * core/src/validation/coverage.rs).
 */
export const PULL = {
  low: { share: 0.015, cap: 0.25 },
  high: { share: 0.03, cap: 0.45 },
} as const;
export type PullLevel = keyof typeof PULL;

export interface CoverageMeasure {
  /** Mean thread density of cells well inside stitched area (everything within 2 mm stitched), else 0. */
  cover: Float32Array;
  /** Gap pixels (0.01 mm² each) per cell after pull: on stable and on stretchy fabric. */
  gapsLow: Uint8Array;
  gapsHigh: Uint8Array;
  /** Longest stitch ending in each cell (0.1 mm). */
  longest: Uint16Array;
}

/**
 * In `skip`: a record of the placement line of an appliqué. The fabric laid on inside it covers the
 * ground, as thread does: no gap opens on it (its inside has no stitches on purpose).
 */
export const PATCH = 2;

/**
 * Lower-limit measurements on the 1 mm grid at (originX, originY), computed by the Rust core
 * (core/src/validation/coverage.rs, with the stitch kinds of kinds.rs). `mean` is the mean thread
 * density per cell; records with `skip` set do not count for fabric showing through (fills that are
 * open on purpose, such as gradients).
 */
export function measureCoverage(
  p: Pattern,
  mean: Float32Array,
  originX: number,
  originY: number,
  cols: number,
  rows: number,
  skip?: Uint8Array,
  gaps = true,
): CoverageMeasure {
  const r = core().measureCoverage(p.x, p.y, p.cmd, mean, originX, originY, cols, rows, skip, gaps);
  try {
    return { cover: r.takeCover(), gapsLow: r.takeGapsLow(), gapsHigh: r.takeGapsHigh(), longest: r.takeLongest() };
  } finally {
    r.free();
  }
}
