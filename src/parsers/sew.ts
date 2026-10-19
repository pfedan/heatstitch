import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

/** The stitches of a SEW file start at this fixed offset, after the header. */
export const SEW_STITCH_START = 0x1d78;

/**
 * Reads a Janome SEW file, the older sibling of JEF (core/src/parsers/sew.rs). SEW has no trim;
 * like pyembroidery, no cuts are guessed from long moves.
 */
export const parseSew = (data: Uint8Array, fileName = ''): Pattern => readFormat('sew', data, fileName);
