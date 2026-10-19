import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

export const PEC_COLOR_COUNT_OFFSET = 48;
/**
 * Where the stitch records of a PEC block begin. Brother (and pystitch, and heatstitch) put a move
 * there first, a long-form jump to the stitches' origin; pyembroidery puts its first record there,
 * which may be anything.
 */
export const PEC_RECORDS_OFFSET = 528;
/** Where the stitches begin after Brother's opening move. */
export const PEC_STITCH_OFFSET = 532;

export function isPes(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x23 && data[1] === 0x50 && data[2] === 0x45 && data[3] === 0x53; // "#PES"
}

/** "#PEC0001": a bare PEC block as older Brother machines read it. */
export function isPec(data: Uint8Array): boolean {
  return data.length >= 8 && new TextDecoder('latin1').decode(data.subarray(0, 8)) === '#PEC0001';
}

/**
 * Reads a Brother PES file (core/src/parsers/pes.rs): the stitches from its PEC block, the real
 * thread colors and the sewing field from a PES header of versions 5 to 10.
 */
export const parsePes = (data: Uint8Array, fileName = ''): Pattern => readFormat('pes', data, fileName);

export const parsePecFile = (data: Uint8Array, fileName = ''): Pattern => readFormat('pec', data, fileName);
