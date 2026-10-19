import type { Pattern } from '../model/pattern';
import { writeWithCore } from './bytes';

/** Largest move per DST record and axis (balanced ternary with weights 1 to 81). */
export const DST_MAX_DELTA = 121;

/**
 * Writes a Tajima DST file (core/src/writers/dst.rs). DST has no trim command: a run of three or
 * more jumps means "trim", so a TRIM becomes such a run (never zero-length jumps), and untrimmed
 * runs that would reach that length are merged. DST stores no thread colors.
 */
export const writeDst = (p: Pattern): Uint8Array => writeWithCore('dst', p);
