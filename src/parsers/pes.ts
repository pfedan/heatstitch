import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM, type Pattern, type ThreadColor } from '../model/pattern';
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

/** "#PEC0001": a bare PEC block as older Brother machines read it. */
export function isPec(data: Uint8Array): boolean {
  return data.length >= 8 && new TextDecoder('latin1').decode(data.subarray(0, 8)) === '#PEC0001';
}

export function parsePes(data: Uint8Array, fileName = ''): Pattern {
  if (!isPes(data) || data.length < 12) throw new Error('PES: missing #PES signature');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pec = view.getUint32(8, true);
  if (pec + PEC_STITCH_OFFSET > data.length) throw new Error('PES: PEC section out of range');
  const p = parsePec(data, pec, fileName);
  let chart: ThreadColor[] = [];
  try {
    chart = readPesThreads(data);
  } catch {
    // An unusual header only costs the real thread colors; the PEC palette stays.
  }
  if (chart.length) p.colors = applyChart(p.colors, chart);
  return p;
}

export function parsePecFile(data: Uint8Array, fileName = ''): Pattern {
  if (!isPec(data) || 8 + PEC_STITCH_OFFSET > data.length) throw new Error('PEC: missing #PEC0001 signature');
  return { ...parsePec(data, 8, fileName), format: 'pec' };
}

/**
 * The thread list of a PES header (versions 5 to 10, as pyembroidery reads them): real RGB, name,
 * brand and catalog number. Headers with programmable fills, motifs or feather patterns are skipped.
 */
export function readPesThreads(data: Uint8Array): ThreadColor[] {
  const version = new TextDecoder('latin1').decode(data.subarray(4, 8));
  // Bytes skipped before and after the image file name, per version.
  const layout: Record<string, [number, number, number]> = {
    '0050': [0, 24, 24],
    '0055': [0, 24, 24],
    '0056': [0, 24, 24],
    '0060': [0, 36, 24],
    '0070': [0, 36, 24],
    '0080': [0, 38, 26],
    '0090': [14, 30, 34],
    '0100': [14, 38, 34],
  };
  const l = layout[version];
  if (!l) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = 16;
  const need = (n: number) => {
    if (i + n > data.length) throw new Error('PES: header too short');
  };
  const string = () => {
    need(1);
    const n = data[i++];
    need(n);
    i += n;
    return new TextDecoder('latin1').decode(data.subarray(i - n, i)).trim();
  };
  for (let k = 0; k < 5; k++) string(); // name, category, author, keywords, comments
  if (l[0]) {
    i += l[0];
    string(); // hoop name
  }
  i += l[1];
  string(); // image file
  i += l[2];
  need(8);
  for (let k = 0; k < 3; k++) {
    if (view.getUint16(i, true) !== 0) return []; // programmable fills, motifs, feather patterns
    i += 2;
  }
  const count = view.getUint16(i, true);
  i += 2;
  const threads: ThreadColor[] = [];
  for (let k = 0; k < count; k++) {
    const catalog = string();
    need(3);
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    i += 3 + 5;
    const name = string();
    const brand = string();
    string(); // chart
    threads.push({ r, g, b, ...(name ? { name } : {}), ...(brand ? { brand } : {}), ...(catalog ? { catalog } : {}) });
  }
  return threads;
}

/**
 * Puts the header threads on the PEC color blocks, keeping each block's PEC slot for saving: one to
 * one when there are enough, otherwise one header thread per distinct PEC slot in order (how
 * PE-Design assigns them).
 */
function applyChart(colors: ThreadColor[], chart: ThreadColor[]): ThreadColor[] {
  if (chart.length >= colors.length) return colors.map((c, k) => ({ ...chart[k], pecIndex: c.pecIndex }));
  const bySlot = new Map<number, ThreadColor>();
  const rest = [...chart];
  return colors.map((c) => {
    const slot = c.pecIndex ?? 0;
    let t = bySlot.get(slot);
    if (!t) {
      t = rest.length ? { ...rest.shift()!, pecIndex: slot } : c;
      bySlot.set(slot, t);
    }
    return { ...t };
  });
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
