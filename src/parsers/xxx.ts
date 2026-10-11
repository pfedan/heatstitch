import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM, type Pattern, type ThreadColor } from '../model/pattern';
import { defaultColor } from './pecPalette';

/** The stitches of an XXX file start here, after the 256-byte header. */
export const XXX_STITCH_START = 0x100;

const signed8 = (v: number): number => (v > 0x7f ? v - 0x100 : v);
const signed16 = (v: number): number => (v > 0x7fff ? v - 0x10000 : v);

/**
 * Reads a Singer XXX file (Compucon, Singer Futura and later Singer machines). Two bytes per stitch;
 * 0x7F introduces a four-byte command (01 jump, 03 cut plus an optional move, 08 or 0A..17 color
 * change, 7F or 18 end), 0x7D a long stitch with 16-bit deltas. After the end come the thread
 * colors as RGB. Follows pystitch/pyembroidery's XxxReader (MIT), except that 0x7D is read as the
 * stitch pyembroidery's own writer means by it, not as a jump.
 */
export function parseXxx(data: Uint8Array, fileName = ''): Pattern {
  if (data.length < XXX_STITCH_START) throw new Error('XXX: file too short');
  const count = data[0x27] | (data[0x28] << 8);
  const b = new PatternBuilder();
  let blocks = 1;
  let i = XXX_STITCH_START;
  let ended = false;
  while (i + 1 < data.length) {
    const b1 = data[i];
    if (b1 === 0x7d || b1 === 0x7e) {
      if (i + 4 >= data.length) break;
      const dx = signed16(data[i + 1] | (data[i + 2] << 8));
      const dy = -signed16(data[i + 3] | (data[i + 4] << 8));
      i += 5;
      b.add(dx, dy, b1 === 0x7d ? STITCH : JUMP);
      continue;
    }
    const b2 = data[i + 1];
    i += 2;
    if (b1 !== 0x7f) {
      b.add(signed8(b1), -signed8(b2), STITCH);
      continue;
    }
    if (i + 1 >= data.length) break;
    const dx = signed8(data[i]);
    const dy = -signed8(data[i + 1]);
    i += 2;
    if (b2 === 0x01) b.add(dx, dy, JUMP);
    else if (b2 === 0x03) {
      b.mark(TRIM);
      if (dx || dy) b.add(dx, dy, JUMP);
    } else if (b2 === 0x08 || (b2 >= 0x0a && b2 <= 0x17)) {
      b.mark(COLOR_CHANGE);
      if (dx || dy) b.add(dx, dy, JUMP);
      blocks++;
    } else if (b2 === 0x7f || b2 === 0x18) {
      ended = true;
      break;
    }
    // Other commands are unknown; pyembroidery skips them too.
  }

  // Two bytes after the end record, then one 00 RR GG BB entry per thread.
  const palette: ThreadColor[] = [];
  for (let k = 0, at = i + 2; ended && k < count && at + 3 < data.length; k++, at += 4) {
    palette.push({ r: data[at + 1], g: data[at + 2], b: data[at + 3] });
  }
  const colors = Array.from({ length: blocks }, (_, k) => palette[k] ?? defaultColor(k));
  return b.build(fileName, 'xxx', colors);
}
