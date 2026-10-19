import { removeStitches, withRecords } from '../model/edit';
import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';
import { wantedMask } from './shorts';

/**
 * Pulls fill row ends back where a later object covers them.
 *
 * Digitizers let a fill reach only about a quarter to a third of the way under the satin border
 * that is sewn over it, and adjacent fills overlap by a fraction of a millimetre. Fills that run
 * on under the whole border (common in auto-digitized files) put a full fill layer, its row-end
 * penetrations and the border on top of each other. Shortening the covered part of each row keeps
 * the look, since the border hides the fill edge either way, and removes thread and penetrations
 * exactly where they pile up.
 *
 * The same holds for a fill whose end lies under a later fill (the "remove underlying stitches"
 * step of digitizing programs), but only where that fill is dense enough to hide the edge: real
 * designs also stack light texture fills on a base fill, and those would show the gap.
 *
 * Under a satin a row keeps 30 % of the border's width (0.4 to 1 mm), under a fill 0.6 mm; rows
 * narrower than 3 mm stay. Worked out in the Rust core (core/src/correct/pullback.rs).
 */

export interface PullbackOptions {
  /** Row ends that may move (record index). */
  wanted: (i: number) => boolean;
}

export interface PullbackResult {
  pattern: Pattern;
  /** Row ends moved. */
  moved: number;
  /** Interior row stitches dropped because they now lie beyond the row end. */
  removed: number;
}

export function pullBackFills(p: Pattern, opts: PullbackOptions): PullbackResult {
  const b = p.bounds;
  const r = core().pullBackFills(p.x, p.y, p.cmd, Float64Array.of(b.minX, b.minY, b.maxX, b.maxY), wantedMask(p.cmd.length, opts.wanted));
  try {
    const moved = r.a;
    const removed = r.b;
    if (!moved) return { pattern: p, moved: 0, removed: 0 };
    const q = withRecords(p, r.takeX(), r.takeY(), p.cmd.slice());
    return { pattern: removed ? removeStitches(q, r.takeMask()) : q, moved, removed };
  } finally {
    r.free();
  }
}
