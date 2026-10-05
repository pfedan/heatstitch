import { COLOR_CHANGE, END, STITCH, TRIM, type Pattern, type ThreadColor } from '../model/pattern';
import { ByteWriter, extents } from './bytes';

/** Big-endian writer on top of the little-endian ByteWriter. */
class Be extends ByteWriter {
  u16be(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }
  u32be(v: number): void {
    this.u16be(v >>> 16);
    this.u16be(v & 0xffff);
  }
  string16(s: string): void {
    this.u16be(s.length * 2);
    for (const ch of s) this.u16be(ch.charCodeAt(0));
  }
  string8(s: string): void {
    const b = new TextEncoder().encode(s);
    this.u16be(b.length);
    this.bytes(b);
  }
  /** Reserves a 32-bit length to be filled by `close`. */
  open(): number {
    const at = this.length;
    this.u32be(0);
    return at;
  }
  /** Writes the distance from after the reserved length to here. */
  close(at: number): void {
    const v = this.length - at - 4;
    // patch() is little endian: swap the bytes.
    this.patch(at, ((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24), 4);
  }
}

const PRODUCER = 'Produced by     Software Ltd';
const hex = (c: ThreadColor) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

interface Block {
  color: ThreadColor;
  /** Stitch records (and trims) of the block. */
  from: number;
  to: number;
}

/**
 * Writes a Pfaff / Husqvarna Viking VP3 file. VP3 has no jumps: each color block starts at its
 * first stitch, a move inside a block is a (long) stitch, after a trim it is the first stitch at
 * the new place. Thread colors are stored exactly, with brand and catalog number when known.
 */
export function writeVp3(p: Pattern): Uint8Array {
  const n = p.cmd.length;
  const blocks: Block[] = [];
  let from = 0;
  for (let i = 0; i <= n; i++) {
    if (i === n || p.cmd[i] === COLOR_CHANGE || p.cmd[i] === END) {
      blocks.push({ color: p.colors[blocks.length] ?? p.colors[p.colors.length - 1] ?? { r: 0, g: 0, b: 0 }, from, to: i });
      if (i === n || p.cmd[i] === END) break;
      from = i + 1;
    }
  }
  const b = extents(p);
  // Header positions are in 0.001 mm with y up; 0.1 mm values times 100.
  const cx100 = (b.minX + b.maxX) * 50;
  const cy100 = (b.minY + b.maxY) * 50;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  let records = 0;
  for (let i = 0; i < n && p.cmd[i] !== END; i++) records++;

  const out = new Be();
  out.ascii('%vsm%');
  out.u8(0);
  out.string16(PRODUCER);
  out.bytes([0x00, 0x02, 0x00]);
  const fileAt = out.open();
  out.string16('');
  out.u32be(b.maxX * 100);
  out.u32be(-b.minY * 100);
  out.u32be(b.minX * 100);
  out.u32be(-b.maxY * 100);
  out.u32be(records);
  out.bytes([0, blocks.length & 0xff, 12, 0, 1]);

  out.bytes([0x00, 0x03, 0x00]);
  const designAt = out.open();
  out.u32be(cx100);
  out.u32be(-cy100);
  out.bytes([0, 0, 0]);
  out.u32be(-Math.round(w / 2) * 100);
  out.u32be(Math.round(w / 2) * 100);
  out.u32be(-Math.round(h / 2) * 100);
  out.u32be(Math.round(h / 2) * 100);
  out.u32be(w * 100);
  out.u32be(h * 100);
  out.string16('');
  out.bytes([0x64, 0x64]);
  out.u32be(4096);
  out.u32be(0);
  out.u32be(0);
  out.u32be(4096);
  out.ascii('xxPP');
  out.bytes([0x01, 0x00]);
  out.string16(PRODUCER);
  out.u16be(blocks.length);

  let lastX = 0;
  let lastY = 0;
  for (const block of blocks) {
    let first = -1;
    let last = -1;
    for (let i = block.from; i < block.to; i++) {
      if (p.cmd[i] !== STITCH) continue;
      if (first < 0) first = i;
      last = i;
    }
    // pyembroidery (and with it Ink/Stitch) ignores a block start with x or y exactly 0; one step
    // aside, the first stitch still lands in place.
    const sx = (first >= 0 ? p.x[first] : lastX) || 1;
    const sy = (first >= 0 ? p.y[first] : lastY) || 1;
    const ex = last >= 0 ? p.x[last] : sx;
    const ey = last >= 0 ? p.y[last] : sy;
    let x = sx;
    let y = sy;
    out.bytes([0x00, 0x05, 0x00]);
    const blockAt = out.open();
    out.u32be(sx * 100 - cx100);
    out.u32be(-(sy * 100 - cy100));
    const c = block.color;
    out.bytes([0x01, 0x00, c.r, c.g, c.b, 0x00, 0x00, 0x00, 0x05, 0x28]);
    out.string8(c.catalog ?? '');
    out.string8(c.name ?? hex(c));
    out.string8(c.brand ?? '');
    out.u32be((ex - sx) * 100);
    out.u32be(-(ey - sy) * 100);
    out.bytes([0x00, 0x01, 0x00]);
    const stitchesAt = out.open();
    out.bytes([0x0a, 0xf6, 0x00]);
    let trimmed = false;
    for (let i = block.from; i < block.to; i++) {
      const cmd = p.cmd[i];
      if (cmd === TRIM) {
        if (!trimmed) out.bytes([0x80, 0x03]);
        trimmed = true;
      } else if (cmd === STITCH) {
        const dx = p.x[i] - x;
        const dy = p.y[i] - y;
        if (Math.abs(dx) <= 127 && Math.abs(dy) <= 127) {
          out.u8(dx);
          out.u8(dy);
        } else {
          out.bytes([0x80, 0x01]);
          out.u16be(dx & 0xffff);
          out.u16be(dy & 0xffff);
          out.bytes([0x80, 0x02]);
        }
        x = p.x[i];
        y = p.y[i];
        trimmed = false;
      }
    }
    // The machine cuts before the next color only when told so.
    if (!trimmed) out.bytes([0x80, 0x03]);
    out.close(stitchesAt);
    out.u8(0);
    out.close(blockAt);
    lastX = ex;
    lastY = ey;
  }
  out.close(designAt);
  out.close(fileAt);
  return out.result();
}
