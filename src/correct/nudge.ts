import { withRecords } from '../model/edit';
import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';
import { wantedMask } from './shorts';

export interface NudgeOptions {
  /** Penetrations that may move. */
  movable: (i: number) => boolean;
  /** Penetrations closer than this (0.1 mm) push each other apart. */
  radius: number;
  /** No penetration moves further than this from where it was (0.1 mm). */
  maxShift: number;
  iterations?: number;
}

/**
 * Pushes crowded penetrations apart, by at most `maxShift`. Each movable penetration is repelled by
 * every other penetration within `radius`, more strongly the closer it is; two penetrations in the
 * same hole separate sideways to the stitch direction. This separates stacked holes (two layers
 * hitting the same spot, the classic same-hole problem) and relieves perforation at stacked edges.
 * It does not lower the thread per area; only thinning does. Relaxed in the Rust core
 * (core/src/correct/nudge.rs).
 */
export function nudgePenetrations(p: Pattern, opts: NudgeOptions): { pattern: Pattern; moved: number } {
  const r = core().nudgePenetrations(p.x, p.y, p.cmd, wantedMask(p.cmd.length, opts.movable), opts.radius, opts.maxShift, opts.iterations ?? 12);
  try {
    const moved = r.a;
    return moved ? { pattern: withRecords(p, r.takeX(), r.takeY(), p.cmd.slice()), moved } : { pattern: p, moved: 0 };
  } finally {
    r.free();
  }
}

/**
 * Penetrations that share a hole (closer than `within`, 0.1 mm) with a penetration more than four
 * stitches away in the same run, or in another run. Lock stitches and bean stitches revisit their
 * holes within a few stitches on purpose and are skipped.
 */
export function sameHoleStitches(p: Pattern, within = 2): Uint8Array {
  return core().sameHoleStitches(p.x, p.y, p.cmd, within);
}
