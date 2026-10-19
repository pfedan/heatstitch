import { removeStitches } from '../model/edit';
import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';

/**
 * Stitches without movement and chains of tiny stitches, found in the Rust core
 * (core/src/correct/shorts.rs) in one call per design; `wanted` is asked once per record.
 */

/** 1 for every record `wanted` asks for: what the core gets instead of the question. */
export function wantedMask(n: number, wanted: (i: number) => boolean): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (wanted(i)) out[i] = 1;
  return out;
}

/** The records of `p` without those the core marked, and how many it marked. */
function removed(p: Pattern, r: { a: number; takeMask(): Uint8Array; free(): void }): { pattern: Pattern; removed: number } {
  try {
    const count = r.a;
    return { pattern: count ? removeStitches(p, r.takeMask()) : p, removed: count };
  } finally {
    r.free();
  }
}

/**
 * Removes stitches that do not move (same position as the stitch before). They add a second
 * penetration into the same hole and nothing else, so removing them never changes the stitch-out.
 */
export function removeZeroLength(p: Pattern, wanted: (i: number) => boolean = () => true): { pattern: Pattern; removed: number } {
  return removed(p, core().removeZeroLength(p.x, p.y, p.cmd, wantedMask(p.cmd.length, wanted)));
}

/**
 * Merges chains of short stitches (the ones the short-stitch rule counts, tie stitches excluded)
 * where `wanted(i)` is set: a stitch point is dropped while the stitch from the last kept point
 * stays shorter than SHORT_STITCH_MM, every dropped point stays within 0.3 mm of the new stitch,
 * and the new stitch stays below 7 mm. Tight curves of running stitch get coarser but keep their
 * shape; narrow zigzag columns are left alone (their points deviate too far) and are thinned
 * instead.
 */
export function mergeShortStitches(p: Pattern, wanted: (i: number) => boolean): { pattern: Pattern; removed: number } {
  return removed(p, core().mergeShortStitches(p.x, p.y, p.cmd, wantedMask(p.cmd.length, wanted)));
}
