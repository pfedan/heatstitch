import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM, type Pattern } from '../model/pattern';
import { pecColor } from './pecPalette';

export const PEC_COLOR_COUNT_OFFSET = 48;
export const PEC_STITCH_OFFSET = 532;

const signed12 = (v: number): number => {
  v &= 0xfff;
  return v > 0x7ff ? v - 0x1000 : v;
};
const signed7 = (v: number): number => (v > 0x3f ? v - 0x80 : v);

export function isPes(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x23 && data[1] === 0x50 && data[2] === 0x45 && data[3] === 0x53; // "#PES"
}

export function parsePes(data: Uint8Array, fileName = ''): Pattern {
  if (!isPes(data) || data.length < 12) throw new Error('PES: missing #PES signature');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pec = view.getUint32(8, true);
  if (pec + PEC_STITCH_OFFSET > data.length) throw new Error('PES: PEC section out of range');
  return parsePec(data, pec, fileName);
}

/** Parses a PEC block starting at `pec` (the "LA:" label). */
export function parsePec(data: Uint8Array, pec: number, fileName = ''): Pattern {
  const label = new TextDecoder('latin1').decode(data.subarray(pec + 3, pec + 19)).trim();
  const colorCount = data[pec + PEC_COLOR_COUNT_OFFSET] + 1;
  const colors = [];
  for (let i = 0; i < colorCount; i++) colors.push(pecColor(data[pec + PEC_COLOR_COUNT_OFFSET + 1 + i]));

  const b = new PatternBuilder();
  let i = pec + PEC_STITCH_OFFSET;
  const next = (): number => (i < data.length ? data[i++] : 0xff);
  let blocks = 1;

  while (i < data.length) {
    const v1 = next();
    if (v1 === 0xff) break;
    let v2 = next();
    if (v1 === 0xfe && v2 === 0xb0) {
      next(); // color index byte, unused
      b.mark(COLOR_CHANGE);
      blocks++;
      continue;
    }
    let jump = false;
    let trim = false;
    let dx: number;
    if (v1 & 0x80) {
      if (v1 & 0x20) trim = true;
      if (v1 & 0x10) jump = true;
      dx = signed12((v1 << 8) | v2);
      v2 = next();
    } else {
      dx = signed7(v1);
    }
    let dy: number;
    if (v2 & 0x80) {
      if (v2 & 0x20) trim = true;
      if (v2 & 0x10) jump = true;
      dy = signed12((v2 << 8) | next());
    } else {
      dy = signed7(v2);
    }
    if (trim) {
      b.mark(TRIM);
      b.add(dx, dy, JUMP);
    } else if (jump) {
      b.add(dx, dy, JUMP);
    } else {
      b.add(dx, dy, STITCH);
    }
  }

  while (colors.length < blocks) colors.push(pecColor(0));
  return b.build(label || fileName, 'pes', colors);
}
