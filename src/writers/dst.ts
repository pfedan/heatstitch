import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Pattern } from '../model/pattern';
import { DST_HEADER_SIZE, DST_TRIM_JUMP_COUNT } from '../parsers/dst';
import { ByteWriter, headerLabel, splitMove } from './bytes';

/** Largest move per DST record and axis (balanced ternary with weights 1 to 81). */
export const DST_MAX_DELTA = 121;

/** Balanced ternary digits for weights [1, 3, 9, 27, 81]. */
function ternary(v: number): number[] {
  if (Math.abs(v) > DST_MAX_DELTA) throw new Error(`DST delta out of range: ${v}`);
  const d: number[] = [];
  for (let i = 0; i < 5; i++) {
    let r = ((v % 3) + 3) % 3;
    if (r === 2) r = -1;
    d.push(r);
    v = (v - r) / 3;
  }
  return d;
}

/** Encodes one record; dx, dy in DST orientation (y up). */
export function encodeDstRecord(dx: number, dy: number, kind: 'stitch' | 'jump' | 'color'): [number, number, number] {
  const x = ternary(dx);
  const y = ternary(dy);
  const b = [0, 0, 0x03];
  const set = (byte: number, plusBit: number, minusBit: number, digit: number) => {
    if (digit === 1) b[byte] |= 1 << plusBit;
    else if (digit === -1) b[byte] |= 1 << minusBit;
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
  if (kind === 'jump') b[2] |= 0x80;
  if (kind === 'color') b[2] |= 0xc0;
  return [b[0], b[1], b[2]];
}

/**
 * Writes a Tajima DST file.
 *
 * DST has no trim command: a run of DST_TRIM_JUMP_COUNT or more jumps means "trim" (the reader
 * turns such a run into TRIM followed by the original jumps). So a TRIM is written as nothing when
 * the jump run after it is already long enough, and padded with zero jumps otherwise; trims never
 * grow on repeated saves. Untrimmed jump runs that would reach that length are merged into as few
 * records as possible so they do not turn into trims. Long stitches are split into jumps plus one
 * final stitch (no extra needle penetrations), or into equal stitches when that would need enough
 * jumps to read as a trim. A color change carries the move of a directly following jump, as the
 * reader expects. DST stores no thread colors.
 */
export function writeDst(p: Pattern): Uint8Array {
  const n = p.cmd.length;
  const recs: number[] = [];
  let cx = 0;
  let cy = 0;
  let records = 0;
  /** Consecutive jump records just written. */
  let streak = 0;
  let colorChanges = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  const emit = (dx: number, dy: number, kind: 'stitch' | 'jump' | 'color') => {
    recs.push(...encodeDstRecord(dx, -dy, kind));
    cx += dx;
    cy += dy;
    records++;
    streak = kind === 'jump' ? streak + 1 : 0;
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  };

  /** End (exclusive) of the jump run starting at i. */
  const runEnd = (i: number) => {
    let j = i;
    while (j < n && p.cmd[j] === JUMP) j++;
    return j;
  };
  /** Records a trimmed jump run [i, j) produces when every jump is kept as its own record(s). */
  const runRecords = (i: number, j: number, fromX: number, fromY: number) => {
    let count = 0;
    let px = fromX;
    let py = fromY;
    for (let k = i; k < j; k++) {
      count += splitMove(p.x[k] - px, p.y[k] - py, DST_MAX_DELTA).length;
      px = p.x[k];
      py = p.y[k];
    }
    return count;
  };

  let trimmed = false;
  for (let i = 0; i < n; i++) {
    const c = p.cmd[i];
    if (c === END) break;
    if (c === STITCH) {
      const pieces = splitMove(p.x[i] - cx, p.y[i] - cy, DST_MAX_DELTA);
      const viaJumps = trimmed || streak + pieces.length - 1 < DST_TRIM_JUMP_COUNT;
      trimmed = false;
      pieces.forEach(([dx, dy], k) => emit(dx, dy, k < pieces.length - 1 && viaJumps ? 'jump' : 'stitch'));
    } else if (c === TRIM) {
      if (trimmed) continue; // repeated trim
      let j = i + 1;
      while (j < n && p.cmd[j] === TRIM) j++;
      const have = j < n && p.cmd[j] === JUMP ? runRecords(j, runEnd(j), cx, cy) : 0;
      for (let k = have; k < DST_TRIM_JUMP_COUNT; k++) emit(0, 0, 'jump');
      trimmed = true;
    } else if (c === JUMP) {
      const j = runEnd(i);
      if (trimmed || runRecords(i, j, cx, cy) < DST_TRIM_JUMP_COUNT) {
        for (let k = i; k < j; k++) {
          for (const [dx, dy] of splitMove(p.x[k] - cx, p.y[k] - cy, DST_MAX_DELTA)) emit(dx, dy, 'jump');
        }
      } else {
        for (const [dx, dy] of splitMove(p.x[j - 1] - cx, p.y[j - 1] - cy, DST_MAX_DELTA)) emit(dx, dy, 'jump');
      }
      i = j - 1;
    } else if (c === COLOR_CHANGE) {
      trimmed = false;
      colorChanges++;
      const next = i + 1;
      const dx = next < n && p.cmd[next] === JUMP ? p.x[next] - cx : 0;
      const dy = next < n && p.cmd[next] === JUMP ? p.y[next] - cy : 0;
      if ((dx || dy) && Math.abs(dx) <= DST_MAX_DELTA && Math.abs(dy) <= DST_MAX_DELTA) {
        emit(dx, dy, 'color');
        i = next;
      } else {
        emit(0, 0, 'color');
      }
    }
  }

  const out = new ByteWriter();
  const sign = (v: number) => (v < 0 ? '-' : '+') + String(Math.abs(v)).padStart(5, ' ');
  const header =
    `LA:${headerLabel(p.name, 16).padEnd(16, ' ')}\r` +
    `ST:${String(records).padStart(7, ' ')}\r` +
    `CO:${String(colorChanges).padStart(3, ' ')}\r` +
    // Extents from the start point; DST y points up.
    `+X:${String(maxX).padStart(5, ' ')}\r` +
    `-X:${String(-minX).padStart(5, ' ')}\r` +
    `+Y:${String(-minY).padStart(5, ' ')}\r` +
    `-Y:${String(maxY).padStart(5, ' ')}\r` +
    `AX:${sign(cx)}\r` +
    `AY:${sign(-cy)}\r` +
    `MX:+    0\r` +
    `MY:+    0\r` +
    `PD:******\r`;
  out.ascii(header);
  out.u8(0x1a);
  out.fill(0x20, DST_HEADER_SIZE - out.length);
  out.bytes(recs);
  out.bytes([0x00, 0x00, 0xf3]);
  return out.result();
}
