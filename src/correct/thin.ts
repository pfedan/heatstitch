import { removeStitches } from '../model/edit';
import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';

/**
 * Row thinning without object information.
 *
 * Fills and satins are both sweeps: the needle runs across the shape, turns, and comes back one
 * spacing further on. Inside a run of stitches, the points where the direction turns by more than
 * 60 degrees are its turning points. Their sequence is periodic: in a satin every second turning
 * point lies on the same edge (period 2), in a fill whose rows are joined by a short connector
 * stitch every fourth one does (period 4), and a fill without connectors has period 2 again.
 *
 * Removing one period's worth of turning points removes one "cycle" (two rows of a fill, one zig
 * and one zag of a satin) and joins the remaining ends with a single short stitch, which is either
 * along the edge ("edge" removal) or across like the neighbouring rows ("cross" removal). Removing
 * every k-th cycle lowers the thread per area of that sweep by 1/k. Doing this only where the
 * density is too high is the only automatic fix that really lowers it: nudging penetrations apart
 * keeps the thread length per area the same.
 *
 * The thinning runs in the Rust core (core/src/correct/thin.rs), one call per design; the turning
 * points stay here for the TypeScript that reads stitches (structure.ts).
 */

/** Direction change (cosine) at which a stitch point becomes a turning point. */
const TURN_COS = 0.5;
/** By default at least this share of the thread removed must lie where thinning is asked for. */
export const MIN_SHARE = 0.6;

export interface ThinOptions {
  /** Share of cycles (0 to 1) to remove around record i; 0 where nothing should change. */
  needAt: (i: number) => number;
  /** Records that must never be removed (tie-in and tie-off stitches). */
  protect?: Uint8Array;
  /** Share of a removal's thread that must lie where `needAt` is positive (default MIN_SHARE). */
  minShare?: number;
  /** Count a stitch as asked for only if `needAt` is positive at both of its ends (default: either). */
  strict?: boolean;
}

export interface ThinResult {
  pattern: Pattern;
  /** Stitch records removed. */
  removed: number;
  /** Cycles (row pairs, zigzag pairs) removed. */
  cycles: number;
}

/** Turning points of the stitch run [s, e], including both ends, at turns with cosine below `turnCos`. */
export function turningPoints(p: Pattern, s: number, e: number, turnCos = TURN_COS): number[] {
  const t = [s];
  let prev = s; // last point with a distinct position
  for (let i = s + 1; i < e; i++) {
    const ix = p.x[i] - p.x[prev];
    const iy = p.y[i] - p.y[prev];
    if (!ix && !iy) continue;
    let next = i + 1;
    while (next < e && p.x[next] === p.x[i] && p.y[next] === p.y[i]) next++;
    const ox = p.x[next] - p.x[i];
    const oy = p.y[next] - p.y[i];
    if (ox || oy) {
      const cos = (ix * ox + iy * oy) / (Math.hypot(ix, iy) * Math.hypot(ox, oy));
      if (cos < turnCos) t.push(i);
    }
    prev = i;
  }
  t.push(e);
  return t;
}

/**
 * Removes cycles from periodic sweeps where `needAt` asks for it, spreading the removals evenly so
 * that a need of 0.33 removes every third cycle. Only STITCH records are removed; the first and
 * last stitch of every run stay, so jumps, trims and color changes keep their anchors.
 */
export function thinSweeps(p: Pattern, opts: ThinOptions): ThinResult {
  const need = new Float64Array(p.cmd.length);
  for (let i = 0; i < need.length; i++) need[i] = opts.needAt(i);
  const r = core().thinSweeps(p.x, p.y, p.cmd, need, opts.protect, opts.minShare ?? MIN_SHARE, !!opts.strict);
  try {
    const removed = r.a;
    return { pattern: removed ? removeStitches(p, r.takeMask()) : p, removed, cycles: r.b };
  } finally {
    r.free();
  }
}
