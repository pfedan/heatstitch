import { removeStitches, withRecords } from '../model/edit';
import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';

/**
 * Thinning out by hand (Ausdünnen in the stitch editor): fewer stitches where they are selected,
 * the shape staying covered as before.
 *
 * Rows (of a fill) and zigzags (of a satin) are sweeps: passes back and forth, one spacing apart.
 * They are made looser the way any digitizing program does it, by sewing them at a wider spacing:
 * the passes are laid anew, evenly spread between the first and the last selected one. Each new
 * pass lies between two neighbouring old ones that run the same way (blended along their length),
 * so its ends stay on the edge the old ends trace and its penetrations follow theirs. Taking out
 * whole passes instead (as the correction does where it only has to lower the density) would leave
 * a stripe of three spacings for every pair.
 *
 * A line (running stitch) is made looser by longer stitches: every so many of its penetrations are
 * taken out, evenly spread, where the line stays within 0.2 mm without it and the stitch
 * does not grow beyond 5 mm. Lines that go back over themselves (triple and bean stitch) stay.
 *
 * Laid anew in the Rust core (core/src/correct/thin_hand.rs), one call per design.
 */

export interface HandThinOptions {
  /** Share (0 to 1) of the stitches to take out around record i; 0 where nothing should change. */
  needAt: (i: number) => number;
  /** Records that must never be removed or moved (tie-in and tie-off stitches). */
  protect?: Uint8Array;
}

export interface HandThinResult {
  pattern: Pattern;
  /** Stitch records removed. */
  removed: number;
  /** 1 for each record of the input that was removed. */
  mask: Uint8Array;
}

export function thinByHand(p: Pattern, opts: HandThinOptions): HandThinResult {
  const need = new Float64Array(p.cmd.length);
  for (let i = 0; i < need.length; i++) need[i] = opts.needAt(i);
  const r = core().thinByHand(p.x, p.y, p.cmd, need, opts.protect);
  try {
    const removed = r.a;
    const mask = r.takeMask();
    if (!removed) return { pattern: p, removed: 0, mask };
    return { pattern: removeStitches(withRecords(p, r.takeX(), r.takeY(), p.cmd.slice()), mask), removed, mask };
  } finally {
    r.free();
  }
}
