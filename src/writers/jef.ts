import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Pattern } from '../model/pattern';
import { jefIndexOf } from '../parsers/jefPalette';
import type { Hoop } from '../model/hoop';
import { ByteWriter, extents, splitMove } from './bytes';

/** Largest move per JEF record and axis (signed byte). */
export const JEF_MAX_DELTA = 127;

/** Janome hoop codes. */
const HOOP_110X110 = 0;
const HOOP_50X50 = 1;
const HOOP_140X200 = 2;
const HOOP_126X110 = 3;
const HOOP_200X200 = 4;

/** Smallest standard Janome hoop the design fits (0.1 mm), as pyembroidery picks it. */
export function jefHoop(width: number, height: number): number {
  if (width < 500 && height < 500) return HOOP_50X50;
  if (width < 1260 && height < 1100) return HOOP_126X110;
  if (width < 1400 && height < 2000) return HOOP_140X200;
  if (width < 2000 && height < 2000) return HOOP_200X200;
  return HOOP_110X110;
}

/** Janome code of a chosen sewing field (mm), or null when Janome has no such hoop. */
export function jefHoopCode(hoop: Hoop): number | null {
  const codes: Record<string, number> = {
    '50x50': HOOP_50X50,
    '100x100': HOOP_110X110,
    '110x110': HOOP_110X110,
    '126x110': HOOP_126X110,
    '140x200': HOOP_140X200,
    '200x200': HOOP_200X200,
  };
  return codes[`${hoop.w}x${hoop.h}`] ?? null;
}

/** Janome palette slot per color block; neighbors that would land on the same slot get the next nearest. */
function palette(p: Pattern, blocks: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < blocks; k++) {
    const c = p.colors[k] ?? p.colors[p.colors.length - 1] ?? { r: 0, g: 0, b: 0 };
    let index = jefIndexOf(c);
    const prev = k > 0 ? (p.colors[k - 1] ?? c) : null;
    if (prev && index === out[k - 1] && (prev.r !== c.r || prev.g !== c.g || prev.b !== c.b)) index = jefIndexOf(c, index);
    out.push(index);
  }
  return out;
}

const stamp = (d: Date) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((v, k) => String(v).padStart(k ? 2 : 4, '0'))
    .join('');

/**
 * Writes a Janome JEF file. JEF has no trim command: machines (and pyembroidery) cut before a move
 * longer than 3 mm, so a TRIM is not written. Long stitches are split into equal stitches, since
 * long jumps would read as cuts; after a cut the way to the next stitch is jumps. Colors are rounded to the Janome palette.
 */
export function writeJef(p: Pattern, date = new Date(), hoop: Hoop | null = null): Uint8Array {
  const recs = new ByteWriter();
  let points = 1; // the end command
  let blocks = 1;
  let cx = 0;
  let cy = 0;
  const rec = (dx: number, dy: number, ctrl: number | null) => {
    if (ctrl !== null) {
      recs.bytes([0x80, ctrl]);
      points++;
    }
    recs.u8(dx);
    recs.u8(-dy);
    points++;
    cx += dx;
    cy += dy;
  };
  let trimmed = false;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === END) break;
    if (c === STITCH) {
      // After a cut the way there may be jumps; otherwise they would read as a cut.
      const pieces = splitMove(p.x[i] - cx, p.y[i] - cy, JEF_MAX_DELTA);
      pieces.forEach(([dx, dy], k) => rec(dx, dy, trimmed && k < pieces.length - 1 ? 0x02 : null));
      trimmed = false;
    } else if (c === TRIM) {
      trimmed = true;
    } else if (c === JUMP) {
      for (const [dx, dy] of splitMove(p.x[i] - cx, p.y[i] - cy, JEF_MAX_DELTA)) rec(dx, dy, 0x02);
    } else if (c === COLOR_CHANGE) {
      rec(0, 0, 0x01);
      blocks++;
      trimmed = true;
    }
  }
  recs.bytes([0x80, 0x10]);

  const b = extents(p);
  const halfW = Math.round((b.maxX - b.minX) / 2);
  const halfH = Math.round((b.maxY - b.minY) / 2);
  const out = new ByteWriter();
  out.u32(0x74 + blocks * 8);
  out.u32(0x14);
  out.ascii(stamp(date));
  out.u8(0);
  out.u8(0);
  out.u32(blocks);
  out.u32(points);
  out.u32((hoop && jefHoopCode(hoop)) ?? jefHoop(b.maxX - b.minX, b.maxY - b.minY));
  for (const v of [halfW, halfH, halfW, halfH]) out.u32(v);
  // Distance to the edges of the 110 x 110, 50 x 50, 140 x 200 and custom hoops (-1 when it does not fit).
  // The custom slot holds the chosen sewing field.
  const custom = hoop ? [hoop.w * 5, hoop.h * 5] : [700, 1000];
  for (const [hw, hh] of [[550, 550], [250, 250], [700, 1000], custom]) {
    const ex = hw - halfW;
    const ey = hh - halfH;
    for (const v of Math.min(ex, ey) >= 0 ? [ex, ey, ex, ey] : [-1, -1, -1, -1]) out.u32(v);
  }
  for (const index of palette(p, blocks)) out.u32(index);
  for (let k = 0; k < blocks; k++) out.u32(0x0d);
  out.bytes(recs.result());
  return out.result();
}
