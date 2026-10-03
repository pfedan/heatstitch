/** Minimal DST/PES writers used only to build synthetic test fixtures. */

export type Op = { type: 'stitch' | 'jump' | 'trim' | 'color'; dx?: number; dy?: number };

/** Balanced ternary digits for weights [1,3,9,27,81]. */
function ternary(v: number): number[] {
  if (Math.abs(v) > 121) throw new Error(`DST delta out of range: ${v}`);
  const d: number[] = [];
  for (let i = 0; i < 5; i++) {
    let r = ((v % 3) + 3) % 3;
    if (r === 2) r = -1;
    d.push(r);
    v = (v - r) / 3;
  }
  return d;
}

/** dx, dy in DST orientation (y up). */
export function encodeDstRecord(dx: number, dy: number, flags: 'stitch' | 'jump' | 'color'): number[] {
  const x = ternary(dx);
  const y = ternary(dy);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0x03;
  const set = (pos: 0 | 1 | 2, plusBit: number, minusBit: number, digit: number) => {
    const bitv = digit === 1 ? 1 << plusBit : digit === -1 ? 1 << minusBit : 0;
    if (pos === 0) b0 |= bitv;
    else if (pos === 1) b1 |= bitv;
    else b2 |= bitv;
  };
  // x: 1 -> b0 bits 0/1, 3 -> b1 0/1, 9 -> b0 2/3, 27 -> b1 2/3, 81 -> b2 2/3
  set(0, 0, 1, x[0]);
  set(1, 0, 1, x[1]);
  set(0, 2, 3, x[2]);
  set(1, 2, 3, x[3]);
  set(2, 2, 3, x[4]);
  // y: 1 -> b0 7/6, 3 -> b1 7/6, 9 -> b0 5/4, 27 -> b1 5/4, 81 -> b2 5/4
  set(0, 7, 6, y[0]);
  set(1, 7, 6, y[1]);
  set(0, 5, 4, y[2]);
  set(1, 5, 4, y[3]);
  set(2, 5, 4, y[4]);
  if (flags === 'jump') b2 |= 0x80;
  if (flags === 'color') b2 |= 0xc0;
  return [b0, b1, b2];
}

/** Ops use y down (model orientation); converted to DST y up here. Trim is written as 3 zero jumps. */
export function encodeDst(ops: Op[], label = 'TEST'): Uint8Array {
  const header = `LA:${label.padEnd(16, ' ')}\rST:${String(ops.length).padStart(7, ' ')}\r`;
  const bytes: number[] = Array.from({ length: 512 }, (_, i) => (i < header.length ? header.charCodeAt(i) : 0x20));
  bytes[header.length] = 0x1a;
  for (const op of ops) {
    const dx = op.dx ?? 0;
    const dy = -(op.dy ?? 0);
    if (op.type === 'trim') {
      for (let k = 0; k < 3; k++) bytes.push(...encodeDstRecord(0, 0, 'jump'));
    } else {
      bytes.push(...encodeDstRecord(dx, dy, op.type === 'stitch' ? 'stitch' : op.type === 'jump' ? 'jump' : 'color'));
    }
  }
  bytes.push(0x00, 0x00, 0xf3);
  return Uint8Array.from(bytes);
}

function pecValue(v: number, flags: number, out: number[], forceLong: boolean): void {
  if (!forceLong && v >= -64 && v <= 63) {
    out.push(v & 0x7f);
  } else {
    if (v < -2048 || v > 2047) throw new Error(`PEC delta out of range: ${v}`);
    const code = (v & 0xfff) | 0x8000 | (flags << 8);
    out.push((code >> 8) & 0xff, code & 0xff);
  }
}

/** Ops use y down. A trim applies to the following jump. */
export function encodePes(ops: Op[], colorIndices: number[], label = 'TEST'): Uint8Array {
  const pesHeader = [...'#PES0001'].map((c) => c.charCodeAt(0));
  const pecOffset = 16;
  const head = [...pesHeader, pecOffset & 0xff, (pecOffset >> 8) & 0xff, 0, 0, 0, 0, 0, 0];

  const pec: number[] = Array.from({ length: 532 }, () => 0x20);
  const la = `LA:${label.padEnd(16, ' ')}\r`;
  for (let i = 0; i < la.length; i++) pec[i] = la.charCodeAt(i);
  pec[48] = colorIndices.length - 1;
  colorIndices.forEach((c, i) => (pec[49 + i] = c));
  pec[512] = 0;
  pec[513] = 0;
  pec[517] = 0x31;
  pec[518] = 0xff;
  pec[519] = 0xf0;

  let color = 0;
  let pendingTrim = false;
  for (const op of ops) {
    if (op.type === 'color') {
      color++;
      pec.push(0xfe, 0xb0, color % 2 ? 2 : 1);
      continue;
    }
    if (op.type === 'trim') {
      pendingTrim = true;
      continue;
    }
    const isJump = op.type === 'jump';
    const flags = pendingTrim ? 0x20 : isJump ? 0x10 : 0;
    pecValue(op.dx ?? 0, flags, pec, flags !== 0);
    pecValue(op.dy ?? 0, flags, pec, flags !== 0);
    pendingTrim = false;
  }
  pec.push(0xff);
  return Uint8Array.from([...head, ...pec]);
}
