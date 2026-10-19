import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';

/** Minimum number of consecutive zigzag segments to call a run satin. */
export const SATIN_MIN_RUN = 4;
const MIN_LEN = 10; // 1.0 mm in 0.1 mm units

/**
 * Marks satin segments: mask[i] = 1 if the stitch segment ending at record i belongs to a run of
 * at least SATIN_MIN_RUN consecutive stitch-to-stitch segments that zigzag back and forth with
 * similar lengths (a column stitch). `minLen` (0.1 mm) lowers the shortest segment that counts, to
 * also find narrow zigzag columns. Computed by the Rust core (core/src/validation/satin.rs), which
 * keeps the length and angle limits.
 */
export const satinMask = (p: Pattern, minLen = MIN_LEN): Uint8Array => core().satinMask(p.x, p.y, p.cmd, minLen);

/**
 * Marks E stitches (blanket stitch, sewn along appliqué edges): a stitch across, the stitch back
 * into the same hole and a step on along the edge, square to it, at least three times in a row.
 * They cover an edge like a satin column, so they count as one.
 */
export const eStitchMask = (p: Pattern): Uint8Array => core().eStitchMask(p.x, p.y, p.cmd);
