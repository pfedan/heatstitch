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

/** Size of the wobble a trim is sewn as when the move after it is too short to split (1/10 mm). */
const WOBBLE = 2;

/**
 * The DST_TRIM_JUMP_COUNT jumps a trim followed by the move (dx, dy) is written as: the move split
 * into as many equal jumps when each still moves, otherwise a wobble out and back that ends there.
 * None of them is zero.
 */
export function trimJumps(dx: number, dy: number): [number, number][] {
  const k = DST_TRIM_JUMP_COUNT;
  const pieces = splitMove(dx, dy, DST_MAX_DELTA);
  if (pieces.length >= k) return pieces;
  if (Math.max(Math.abs(dx), Math.abs(dy)) >= k) {
    const out: [number, number][] = [];
    for (let s = 1; s <= k; s++) {
      const px = Math.round((dx * s) / k) - Math.round((dx * (s - 1)) / k);
      const py = Math.round((dy * s) / k) - Math.round((dy * (s - 1)) / k);
      out.push([px, py]);
    }
    if (out.every(([x, y]) => x || y)) return out;
  }
  // Out, back across, and to the end; the sign keeps the last step from being zero.
  const w = dx === -WOBBLE && dy === -WOBBLE ? -WOBBLE : WOBBLE;
  return [[w, w], [-2 * w, -2 * w], [w + dx, w + dy]];
}

/**
 * Writes a Tajima DST file.
 *
 * DST has no trim command: a run of DST_TRIM_JUMP_COUNT or more jumps means "trim" (the reader
 * turns such a run into TRIM followed by the original jumps). So a TRIM is written as nothing when
 * the jump run after it is already long enough; otherwise the move after it is split into that many
 * jumps, or, when it is too short for that, sewn as a small wobble that ends where the move does
 * (pyembroidery writes +0.2, -0.4, +0.2 mm). Never as zero-length jumps: some machines ignore those
 * (Bastidor issue 64). Trims never grow on repeated saves. Untrimmed jump runs that would reach that
 * length are merged into as few records as possible so they do not turn into trims. Long stitches
 * are split into jumps plus one final stitch (no extra needle penetrations), or into equal stitches
 * when that would need enough jumps to read as a trim. A color change moves nothing (as pyembroidery
 * writes it); a jump after it follows on its own. DST stores no thread colors.
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
  /** Whether the last record written was a color change (or none was written yet). */
  let afterColor = true;
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
    afterColor = kind === 'color';
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
      const end = j < n && p.cmd[j] === JUMP ? runEnd(j) : j;
      const have = end > j ? runRecords(j, end, cx, cy) : 0;
      if (have < DST_TRIM_JUMP_COUNT) {
        const [tx, ty] = end > j ? [p.x[end - 1] - cx, p.y[end - 1] - cy] : [0, 0];
        for (const [dx, dy] of trimJumps(tx, ty)) emit(dx, dy, 'jump');
        i = end - 1;
      }
      trimmed = true;
    } else if (c === JUMP) {
      const j = runEnd(i);
      if (trimmed || runRecords(i, j, cx, cy) < DST_TRIM_JUMP_COUNT) {
        for (let k = i; k < j; k++) {
          // A jump to where the needle already is, first in the design or in a color (a design that
          // starts at the origin, a color that starts where the last one ended), is left out: some
          // machines skip zero-length jumps.
          if (afterColor && p.x[k] === cx && p.y[k] === cy) continue;
          for (const [dx, dy] of splitMove(p.x[k] - cx, p.y[k] - cy, DST_MAX_DELTA)) emit(dx, dy, 'jump');
        }
      } else {
        for (const [dx, dy] of splitMove(p.x[j - 1] - cx, p.y[j - 1] - cy, DST_MAX_DELTA)) emit(dx, dy, 'jump');
      }
      i = j - 1;
    } else if (c === COLOR_CHANGE) {
      trimmed = false;
      colorChanges++;
      emit(0, 0, 'color');
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
