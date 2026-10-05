import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Pattern } from '../model/pattern';
import { ByteWriter, splitMove } from './bytes';

/** Largest move per EXP record and axis (signed byte). */
export const EXP_MAX_DELTA = 127;

/**
 * Writes a Melco EXP file: no header, two bytes per stitch, commands start with 0x80. Long stitches
 * become jumps plus one final stitch. EXP stores no colors.
 */
export function writeExp(p: Pattern): Uint8Array {
  const out = new ByteWriter();
  let cx = 0;
  let cy = 0;
  const move = (dx: number, dy: number, ctrl: number | null) => {
    if (ctrl !== null) out.bytes([0x80, ctrl]);
    out.u8(dx);
    out.u8(-dy);
    cx += dx;
    cy += dy;
  };
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === END) break;
    if (c === STITCH) {
      const pieces = splitMove(p.x[i] - cx, p.y[i] - cy, EXP_MAX_DELTA);
      pieces.forEach(([dx, dy], k) => move(dx, dy, k < pieces.length - 1 ? 0x04 : null));
    } else if (c === JUMP) {
      for (const [dx, dy] of splitMove(p.x[i] - cx, p.y[i] - cy, EXP_MAX_DELTA)) move(dx, dy, 0x04);
    } else if (c === TRIM) {
      out.bytes([0x80, 0x80, 0x07, 0x00]);
    } else if (c === COLOR_CHANGE) {
      out.bytes([0x80, 0x01, 0x00, 0x00]);
    }
  }
  return out.result();
}
