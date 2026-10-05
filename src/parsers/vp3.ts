import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM, type Pattern, type ThreadColor } from '../model/pattern';

/** "%vsm%\0" */
export function isVp3(data: Uint8Array): boolean {
  return data.length >= 6 && data[0] === 0x25 && data[1] === 0x76 && data[2] === 0x73 && data[3] === 0x6d && data[4] === 0x25;
}

/**
 * Reads a Pfaff / Husqvarna Viking VP3 file. Positions in the headers are in 0.001 mm with y up,
 * stitch deltas in 0.1 mm with y down. VP3 has no jumps: a move is a long stitch, after a trim it
 * is the first stitch at the new place. Thread colors are real RGB with brand and catalog number.
 */
export function parseVp3(data: Uint8Array, fileName = ''): Pattern {
  if (!isVp3(data)) throw new Error('VP3: missing %vsm% signature');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = 6;
  const need = (n: number) => {
    if (i + n > data.length) throw new Error('VP3: file too short');
  };
  const u8 = () => (need(1), data[i++]);
  const u16 = () => (need(2), (i += 2), view.getUint16(i - 2));
  const i32 = () => (need(4), (i += 4), view.getInt32(i - 4));
  const u32 = () => (need(4), (i += 4), view.getUint32(i - 4));
  const skipString = () => {
    const n = u16();
    need(n);
    i += n;
  };
  const string8 = () => {
    const n = u16();
    need(n);
    i += n;
    return new TextDecoder('utf-8').decode(data.subarray(i - n, i)).trim();
  };

  skipString(); // "Produced by ..."
  i += 7;
  skipString(); // settings
  i += 32;
  const centerX = i32() / 100;
  const centerY = -i32() / 100;
  i += 27;
  skipString();
  i += 24;
  skipString();
  const count = u16();

  const b = new PatternBuilder();
  let x = 0;
  let y = 0;
  const colors: ThreadColor[] = [];
  for (let k = 0; k < count; k++) {
    i += 3;
    const blockEnd = u32() + i;
    if (blockEnd > data.length) throw new Error('VP3: color block out of range');
    const sx = Math.round(i32() / 100 + centerX);
    const sy = Math.round(-i32() / 100 + centerY);
    if (k > 0) {
      b.mark(COLOR_CHANGE);
    }
    if (sx !== x || sy !== y) {
      b.add(sx - x, sy - y, JUMP);
      x = sx;
      y = sy;
    }
    const tones = u8();
    i++; // transition
    let rgb = 0;
    for (let m = 0; m < tones; m++) {
      need(3);
      rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      i += 6;
    }
    i += 2; // thread type, weight
    const catalog = string8();
    const name = string8();
    const brand = string8();
    colors.push({
      r: (rgb >> 16) & 0xff,
      g: (rgb >> 8) & 0xff,
      b: rgb & 0xff,
      ...(name ? { name } : {}),
      ...(brand ? { brand } : {}),
      ...(catalog ? { catalog } : {}),
    });
    i += 15 + 3;
    const s8 = (v: number) => (v > 0x7f ? v - 0x100 : v);
    while (i + 1 < blockEnd) {
      const b0 = data[i];
      const b1 = data[i + 1];
      i += 2;
      if (b0 !== 0x80) {
        b.add(s8(b0), s8(b1), STITCH);
        x += s8(b0);
        y += s8(b1);
      } else if (b1 === 0x01) {
        if (i + 4 > blockEnd) break;
        const dx = view.getInt16(i);
        const dy = view.getInt16(i + 2);
        i += 6; // the long stitch is followed by 0x80 0x02
        b.add(dx, dy, STITCH);
        x += dx;
        y += dy;
      } else if (b1 === 0x03) {
        b.mark(TRIM);
      }
    }
    i = blockEnd;
  }
  if (!colors.length) colors.push({ r: 0, g: 0, b: 0 });
  return b.build(fileName, 'vp3', colors);
}
