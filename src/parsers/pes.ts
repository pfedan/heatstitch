import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

/**
 * Reads a Brother PES file (core/src/parsers/pes.rs): the stitches from its PEC block, the real
 * thread colors and the sewing field from a PES header of versions 5 to 10.
 */
export const parsePes = (data: Uint8Array, fileName = ''): Pattern => readFormat('pes', data, fileName);
