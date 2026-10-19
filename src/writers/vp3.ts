import type { Pattern } from '../model/pattern';
import { writeWithCore } from './bytes';

/**
 * Writes a Pfaff / Husqvarna Viking VP3 file (core/src/writers/vp3.rs). VP3 has no jumps: each
 * color block starts at its first stitch, a move inside a block is a (long) stitch. Thread colors
 * are stored exactly, with brand and catalog number when known.
 */
export const writeVp3 = (p: Pattern): Uint8Array => writeWithCore('vp3', p);
