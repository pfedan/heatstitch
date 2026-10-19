import type { Pattern } from '../model/pattern';
import { writeWithCore } from './bytes';

/**
 * Writes a Melco EXP file (core/src/writers/exp.rs): no header, two bytes per stitch, commands
 * start with 0x80. Long stitches become jumps plus one final stitch. EXP stores no colors.
 */
export const writeExp = (p: Pattern): Uint8Array => writeWithCore('exp', p);
