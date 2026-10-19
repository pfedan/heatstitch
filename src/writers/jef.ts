import { core } from '../wasm/core';
import type { Pattern } from '../model/pattern';
import type { Hoop } from '../model/hoop';
import { writeWithCore } from './bytes';

/** Largest move per JEF record and axis (signed byte). */
export const JEF_MAX_DELTA = 127;

/** Janome code of a chosen sewing field (mm), or null when Janome has no such hoop. */
export function jefHoopCode(hoop: Hoop): number | null {
  const code = core().jefHoopCode(hoop.w, hoop.h);
  return code < 0 ? null : code;
}

/** The date as JEF stores it, in local time: YYYYMMDDhhmmss. */
const stamp = (d: Date) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((v, k) => String(v).padStart(k ? 2 : 4, '0'))
    .join('');

/**
 * Writes a Janome JEF file (core/src/writers/jef.rs). JEF has no trim command: a cut is written as
 * three zero-length jumps, so a zero-length jump is never written for anything else. Long stitches
 * are split into equal stitches; after a cut the way to the next stitch is jumps. Colors are
 * rounded to the Janome palette.
 */
export const writeJef = (p: Pattern, date = new Date(), hoop: Hoop | null = null): Uint8Array => writeWithCore('jef', p, { hoop, stamp: stamp(date) });
