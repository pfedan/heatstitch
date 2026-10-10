import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Pattern } from '../model/pattern';
import { ByteWriter, extents, splitMove } from './bytes';

/**
 * Largest jump per record and axis (0.1 mm). The format allows more, but a Singer Superb EM200
 * loses the excess of longer jumps and the design drifts; factory designs stay within about 8 mm.
 */
export const XXX_MAX_JUMP = 80;
/** Largest stitch per record and axis. From 124 on a stitch needs the 16-bit 0x7D record, which older firmwares do not know. */
export const XXX_MAX_STITCH = 123;

/**
 * Writes a Singer XXX file, after pystitch/pyembroidery's XxxWriter (MIT): a 256-byte header, two
 * bytes per stitch, 7F 01 jump, 7F 03 cut, 7F 08 color change, 7F 7F 02 14 end, then the thread
 * colors as RGB. Unlike pyembroidery it never writes the long 0x7D record: long stitches become
 * equal stitches and long jumps equal jumps within what the machines follow. After a cut the way
 * to the next stitch is jumps.
 */
export function writeXxx(p: Pattern): Uint8Array {
  const recs = new ByteWriter();
  let records = 0;
  let blocks = 1;
  let cx = 0;
  let cy = 0;
  const stitch = (dx: number, dy: number) => {
    recs.bytes([dx, -dy]);
    records++;
    cx += dx;
    cy += dy;
  };
  const command = (code: number, dx = 0, dy = 0) => {
    recs.bytes([0x7f, code, dx, -dy]);
    records++;
    cx += dx;
    cy += dy;
  };
  // Nothing is sewn yet: the way to the first stitch is jumps, not a stitch from the origin.
  let cut = true;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === END) break;
    const dx = p.x[i] - cx;
    const dy = p.y[i] - cy;
    if (c === STITCH) {
      if (cut && Math.max(Math.abs(dx), Math.abs(dy)) > XXX_MAX_STITCH) {
        const pieces = splitMove(dx, dy, XXX_MAX_JUMP);
        pieces.forEach(([x, y], k) => (k < pieces.length - 1 ? command(0x01, x, y) : stitch(x, y)));
      } else {
        for (const [x, y] of splitMove(dx, dy, XXX_MAX_STITCH)) stitch(x, y);
      }
      cut = false;
    } else if (c === JUMP) {
      for (const [x, y] of splitMove(dx, dy, XXX_MAX_JUMP)) command(0x01, x, y);
    } else if (c === TRIM) {
      command(0x03);
      cut = true;
    } else if (c === COLOR_CHANGE) {
      command(0x08);
      blocks++;
      cut = true;
    }
  }

  const b = extents(p);
  const out = new ByteWriter();
  out.fill(0, 0x17);
  out.u32(records);
  out.fill(0, 0x0c);
  out.u32(blocks);
  out.u16(0);
  out.u16(b.maxX - b.minX);
  out.u16(b.maxY - b.minY);
  out.u16(cx);
  out.u16(-cy);
  out.u16(-b.minX);
  out.u16(b.maxY);
  out.fill(0, 0x42 + 4 + 0x73);
  out.u16(0x20);
  out.fill(0, 8);
  out.u32(0x100 + recs.length); // end of the stitches
  out.bytes(recs.result());
  out.bytes([0x7f, 0x7f, 0x02, 0x14, 0x00, 0x00]);
  for (let k = 0; k < blocks; k++) {
    const t = p.colors[k] ?? p.colors[p.colors.length - 1] ?? { r: 0, g: 0, b: 0 };
    out.bytes([0, t.r, t.g, t.b]);
  }
  out.fill(0, 4 * Math.max(0, 21 - blocks));
  out.u32(0xffffff00);
  out.bytes([0x00, 0x01]);
  return out.result();
}
