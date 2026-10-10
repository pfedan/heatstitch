import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, type Pattern } from '../model/pattern';
import { sewColor } from './sewPalette';

/** The stitches of a SEW file start at this fixed offset, after the header. */
export const SEW_STITCH_START = 0x1d78;

const signed8 = (v: number): number => (v > 0x7f ? v - 0x100 : v);

/**
 * Reads a Janome SEW file, the older sibling of JEF: a count and palette indices at the start, two
 * bytes per stitch from 0x1D78, 0x80 introduces a command. SEW has no trim; like pyembroidery,
 * which this follows (pystitch/pyembroidery SewReader, MIT), no cuts are guessed from long moves.
 */
export function parseSew(data: Uint8Array, fileName = ''): Pattern {
  if (data.length < SEW_STITCH_START) throw new Error('SEW: file too short');
  const count = data[0] | (data[1] << 8);
  const palette = Array.from({ length: Math.min(count, (SEW_STITCH_START - 2) >> 1) }, (_, k) => sewColor(data[2 + 2 * k] | (data[3 + 2 * k] << 8)));

  const b = new PatternBuilder();
  let blocks = 1;
  for (let i = SEW_STITCH_START; i + 1 < data.length; ) {
    const b0 = data[i];
    const control = data[i + 1];
    i += 2;
    if (b0 !== 0x80) {
      b.add(signed8(b0), -signed8(control), STITCH);
      continue;
    }
    if (i + 1 >= data.length) break;
    const dx = signed8(data[i]);
    const dy = -signed8(data[i + 1]);
    i += 2;
    if (control & 1) {
      b.mark(COLOR_CHANGE);
      if (dx || dy) b.add(dx, dy, JUMP);
      blocks++;
    } else if (control === 0x02 || control === 0x04) b.add(dx, dy, JUMP);
    else if (control === 0x10) b.add(dx, dy, STITCH);
    else break;
  }
  const colors = Array.from({ length: blocks }, (_, k) => palette[k] ?? palette[palette.length - 1] ?? sewColor(1));
  return b.build(fileName, 'sew', colors);
}
