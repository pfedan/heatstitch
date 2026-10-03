import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Bounds, type Pattern } from '../model/pattern';
import { PEC_STITCH_OFFSET } from '../parsers/pes';
import { pecIndexOf } from '../parsers/pecPalette';
import { ByteWriter, headerLabel, splitMove } from './bytes';
import { ICON_H, ICON_STRIDE, pecIcons } from './pecGraphics';

/** Largest move per PEC record and axis (12-bit long form). */
export const PEC_MAX_DELTA = 2047;
const JUMP_FLAG = 0x10;
const TRIM_FLAG = 0x20;

/** Bounds of every record (jumps included), which the headers describe. */
function extents(p: Pattern): Bounds {
  if (!p.cmd.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.x[i] < minX) minX = p.x[i];
    if (p.x[i] > maxX) maxX = p.x[i];
    if (p.y[i] < minY) minY = p.y[i];
    if (p.y[i] > maxY) maxY = p.y[i];
  }
  return { minX, minY, maxX, maxY };
}

/** Number of color blocks (one more than the color changes). */
function blockCount(p: Pattern): number {
  let n = 1;
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === COLOR_CHANGE) n++;
  return n;
}

const colorOfBlock = (p: Pattern, block: number) =>
  pecIndexOf(p.colors[block] ?? p.colors[p.colors.length - 1] ?? { r: 0, g: 0, b: 0 });

function longValue(out: ByteWriter, v: number, flag: number): void {
  const code = (v & 0xfff) | 0x8000 | (flag << 8);
  out.u8(code >> 8);
  out.u8(code);
}

/**
 * Encodes the PEC stitch stream. Unlike pyembroidery, which flags every jump as a trim, only a jump
 * that follows a TRIM carries the trim flag; a TRIM with no jump after it becomes a zero-length
 * trimmed jump. Moves longer than the 12-bit range are split (stitches into jumps plus one stitch).
 */
function encodeStitches(out: ByteWriter, p: Pattern): void {
  let cx = 0;
  let cy = 0;
  let pendingTrim = false;
  let colorTwo = true;
  const jump = (dx: number, dy: number) => {
    const flag = pendingTrim ? TRIM_FLAG : JUMP_FLAG;
    pendingTrim = false;
    longValue(out, dx, flag);
    longValue(out, dy, flag);
    cx += dx;
    cy += dy;
  };
  const flushTrim = () => {
    if (pendingTrim) jump(0, 0);
  };
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === END) break;
    if (c === TRIM) {
      pendingTrim = true;
    } else if (c === JUMP) {
      for (const [dx, dy] of splitMove(p.x[i] - cx, p.y[i] - cy, PEC_MAX_DELTA)) jump(dx, dy);
    } else if (c === STITCH) {
      flushTrim();
      const pieces = splitMove(p.x[i] - cx, p.y[i] - cy, PEC_MAX_DELTA);
      for (let k = 0; k < pieces.length - 1; k++) jump(pieces[k][0], pieces[k][1]);
      const [dx, dy] = pieces[pieces.length - 1];
      if (dx >= -63 && dx <= 62 && dy >= -63 && dy <= 62) {
        out.u8(dx & 0x7f);
        out.u8(dy & 0x7f);
      } else {
        longValue(out, dx, 0);
        longValue(out, dy, 0);
      }
      cx += dx;
      cy += dy;
    } else if (c === COLOR_CHANGE) {
      flushTrim();
      out.bytes([0xfe, 0xb0, colorTwo ? 2 : 1]);
      colorTwo = !colorTwo;
    }
  }
  flushTrim();
  out.u8(0xff);
}

/** Writes a PEC block (header, stitches, thumbnails) at the current position. */
export function writePec(out: ByteWriter, p: Pattern): void {
  const start = out.length;
  const blocks = Math.min(256, blockCount(p));
  const b = extents(p);

  out.ascii(`LA:${headerLabel(p.name, 16).padEnd(16, ' ')}\r`);
  out.fill(0x20, 12);
  out.bytes([0xff, 0x00, ICON_STRIDE, ICON_H]);
  out.fill(0x20, 12);
  out.u8(blocks - 1);
  for (let k = 0; k < blocks; k++) out.u8(colorOfBlock(p, k));
  out.fill(0x20, start + 512 - out.length);

  out.bytes([0x00, 0x00]);
  const lengthAt = out.length;
  out.u24(0);
  out.bytes([0x31, 0xff, 0xf0]);
  out.u16(b.maxX - b.minX);
  out.u16(b.maxY - b.minY);
  out.u16(0x1e0);
  out.u16(0x1b0);
  // Bytes 528 to 531 are a long-form jump. heatstitch's reader skips them, other readers
  // (pyembroidery, machines) execute it, so it must not move.
  longValue(out, 0, JUMP_FLAG);
  longValue(out, 0, JUMP_FLAG);
  if (out.length !== start + PEC_STITCH_OFFSET) throw new Error('PEC header size mismatch');
  encodeStitches(out, p);
  out.patch(lengthAt, out.length - (start + 512), 3);

  for (const icon of pecIcons(p, b, blocks)) out.bytes(icon);
}

/** pyembroidery's "CEmbOne" / "CSewSeg" PES v1 objects, which PE-Design and similar software read. */
function writeEmbObjects(out: ByteWriter, p: Pattern): void {
  const b = extents(p);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const string16 = (s: string) => {
    out.u16(s.length);
    out.ascii(s);
  };

  string16('CEmbOne');
  out.fill(0, 16); // two empty rectangles
  // Placement in a 130 x 180 mm hoop, as written by pyembroidery.
  const hoopW = 1300;
  const hoopH = 1800;
  for (const v of [1, 0, 0, 1, 350 + hoopW / 2 - width / 2, 100 + height + hoopH / 2 - height / 2]) out.f32(v);
  out.u16(1);
  out.u16(0);
  out.u16(0);
  out.u16(width);
  out.u16(height);
  out.fill(0, 8);
  const sectionsAt = out.length;
  out.u16(0);
  out.u16(0xffff);
  out.u16(0x0000);

  string16('CSewSeg');
  // Segment coordinates are relative to the lower left corner of the design.
  const ax = b.minX;
  const ay = b.maxY;
  let sections = 0;
  const colorLog: [number, number][] = [];
  let block = 0;
  let code = colorOfBlock(p, 0);
  let stitchedX = 0;
  let stitchedY = 0;
  const segment = (flag: number, pts: [number, number][]) => {
    if (sections > 0) out.u16(0x8003);
    if (!colorLog.length || colorLog[colorLog.length - 1][1] !== code) colorLog.push([sections, code]);
    out.u16(flag);
    out.u16(code);
    out.u16(pts.length);
    for (const [x, y] of pts) {
      out.u16(x - ax);
      out.u16(y - ay);
    }
    sections++;
  };
  for (let i = 0; i < p.cmd.length; ) {
    const c = p.cmd[i];
    if (c === STITCH) {
      const pts: [number, number][] = [];
      for (; i < p.cmd.length && p.cmd[i] === STITCH; i++) pts.push([p.x[i], p.y[i]]);
      [stitchedX, stitchedY] = pts[pts.length - 1];
      segment(0, pts);
    } else if (c === JUMP) {
      let j = i;
      while (j < p.cmd.length && p.cmd[j] === JUMP) j++;
      segment(1, [
        [stitchedX, stitchedY],
        [p.x[j - 1], p.y[j - 1]],
      ]);
      i = j;
    } else {
      if (c === COLOR_CHANGE) code = colorOfBlock(p, ++block);
      i++;
    }
  }
  out.u16(colorLog.length);
  for (const [section, color] of colorLog) {
    out.u16(section);
    out.u16(color);
  }
  out.patch(sectionsAt, sections, 2);
  out.u16(0x0000);
  out.u16(0x0000);
}

/**
 * Writes a PES version 1 file: the PES header with one CEmbOne/CSewSeg object (for design
 * software) followed by the PEC block (what embroidery machines read). Thread colors are PEC
 * palette slots: a color read from a PES file keeps its slot, others get the nearest one.
 */
export function writePes(p: Pattern): Uint8Array {
  const out = new ByteWriter();
  out.ascii('#PES0001');
  const pecAt = out.length;
  out.u32(0);
  const hasStitches = p.cmd.some((c) => c === STITCH);
  out.u16(1); // scale to fit
  out.u16(1); // 130 x 180 mm hoop
  out.u16(hasStitches ? 1 : 0);
  if (hasStitches) {
    out.u16(0xffff);
    out.u16(0x0000);
    writeEmbObjects(out, p);
  } else {
    out.u16(0);
    out.u16(0);
  }
  out.patch(pecAt, out.length, 4);
  writePec(out, p);
  return out.result();
}
