import type { Hoop } from '../model/hoop';
import type { Pattern } from '../model/pattern';
import { writeWithCore } from './bytes';

/** Largest move per PEC record and axis (12-bit long form). */
export const PEC_MAX_DELTA = 2047;

/**
 * Writes a PES version 1 file (core/src/writers/pes.rs): the PES header with one CEmbOne/CSewSeg
 * object (for design software) followed by the PEC block (what embroidery machines read). Thread
 * colors are PEC palette slots: a color read from a PES file keeps its slot, others get the
 * nearest one.
 */
export const writePes = (p: Pattern, hoop: Hoop | null = null): Uint8Array => writeWithCore('pes', p, { hoop });

/** A bare PEC file ("#PEC0001" and the PEC block), as older Brother machines read it. */
export const writePecFile = (p: Pattern): Uint8Array => writeWithCore('pec', p);
