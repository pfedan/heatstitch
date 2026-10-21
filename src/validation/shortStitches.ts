import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';

/** Record ends a short stitch that counts towards the cluster rule. */
export const SHORT = 1;
/** Record ends a short stitch of a tie-in or tie-off run (exempt from the checks). */
export const TIE = 2;

/** Lock stitches are a handful of stitches; longer runs of short stitches are real stitching. */
export const TIE_MAX = 6;

/**
 * Tags every stitch record whose incoming stitch is shorter than SHORT_STITCH_MM. Up to TIE_MAX
 * short stitches directly after the first stitch of a block (after a jump, trim, color change or
 * the design start: tie-in) or directly before its last stitch (tie-off) are ties. So is a lock
 * where the thread goes on without a jump (around hidden travel between objects, see
 * model/travel.ts): a few short stitches back and forth that end where they began. Computed by the
 * Rust core (core/src/validation/short_stitches.rs), with SHORT_STITCH_MM of thresholds.ts.
 */
export const tagShortStitches = (p: Pattern): Uint8Array => core().tagShortStitches(p.x, p.y, p.cmd);
