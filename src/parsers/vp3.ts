import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

/** "%vsm%\0" */
export function isVp3(data: Uint8Array): boolean {
  return data.length >= 6 && data[0] === 0x25 && data[1] === 0x76 && data[2] === 0x73 && data[3] === 0x6d && data[4] === 0x25;
}

/**
 * Reads a Pfaff / Husqvarna Viking VP3 file (core/src/parsers/vp3.rs). VP3 has no jumps: a move is
 * a long stitch, after a trim it is the first stitch at the new place. Thread colors are real RGB
 * with brand and catalog number.
 */
export const parseVp3 = (data: Uint8Array, fileName = ''): Pattern => readFormat('vp3', data, fileName);
