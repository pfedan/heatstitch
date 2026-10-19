import type { Pattern } from '../model/pattern';
import { writeWithCore } from './bytes';

/**
 * Largest jump per record and axis (0.1 mm). The format allows more, but a Singer Superb EM200
 * loses the excess of longer jumps and the design drifts; factory designs stay within about 8 mm.
 */
export const XXX_MAX_JUMP = 80;
/** Largest stitch per record and axis. From 124 on a stitch needs the 16-bit 0x7D record, which older firmwares do not know. */
export const XXX_MAX_STITCH = 123;

/**
 * Writes a Singer XXX file (core/src/writers/xxx.rs): a 256-byte header, two bytes per stitch,
 * then the thread colors as RGB. Long stitches and jumps become equal pieces within what the
 * machines follow; the long 0x7D record is never written.
 */
export const writeXxx = (p: Pattern): Uint8Array => writeWithCore('xxx', p);
