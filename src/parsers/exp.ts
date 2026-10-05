import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM, type Pattern } from '../model/pattern';
import { defaultColor } from './pecPalette';

const signed8 = (v: number): number => (v > 0x7f ? v - 0x100 : v);

/** Reads a Melco EXP file: two bytes per stitch, 0x80 introduces a command. EXP stores no colors. */
export function parseExp(data: Uint8Array, fileName = ''): Pattern {
  const b = new PatternBuilder();
  let blocks = 1;
  for (let i = 0; i + 1 < data.length; ) {
    const b0 = data[i];
    const b1 = data[i + 1];
    i += 2;
    if (b0 !== 0x80) {
      b.add(signed8(b0), -signed8(b1), STITCH);
      continue;
    }
    if (i + 1 >= data.length) break;
    const dx = signed8(data[i]);
    const dy = -signed8(data[i + 1]);
    i += 2;
    if (b1 === 0x80) b.mark(TRIM);
    else if (b1 === 0x02) b.add(dx, dy, STITCH);
    else if (b1 === 0x04) b.add(dx, dy, JUMP);
    else if (b1 === 0x01) {
      b.mark(COLOR_CHANGE);
      if (dx || dy) b.add(dx, dy, JUMP);
      blocks++;
    } else break;
  }
  return b.build(fileName, 'exp', Array.from({ length: blocks }, (_, k) => defaultColor(k)));
}
