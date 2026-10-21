import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

/**
 * Reads a Pfaff / Husqvarna Viking VP3 file (core/src/parsers/vp3.rs). VP3 has no jumps: a move is
 * a long stitch, after a trim it is the first stitch at the new place. Thread colors are real RGB
 * with brand and catalog number.
 */
export const parseVp3 = (data: Uint8Array, fileName = ''): Pattern => readFormat('vp3', data, fileName);
