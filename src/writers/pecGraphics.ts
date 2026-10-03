import { COLOR_CHANGE, STITCH, type Bounds, type Pattern } from '../model/pattern';

export const ICON_W = 48;
export const ICON_H = 38;
export const ICON_STRIDE = ICON_W / 8;

/** Sets pixel (x, y); bit order is least significant bit first, as Brother machines read it. */
function mark(g: Uint8Array, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= ICON_W || y >= ICON_H) return;
  g[y * ICON_STRIDE + (x >> 3)] |= 1 << (x & 7);
}

function line(g: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    mark(g, x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * Empty icon with a rounded frame, like the ones Brother software writes. The first row stays
 * empty: it follows the 0xFF end marker directly, and readers such as pyembroidery only stop at
 * the byte pair FF 00.
 */
function framed(): Uint8Array {
  const g = new Uint8Array(ICON_STRIDE * ICON_H);
  const r = ICON_W - 2;
  const b = ICON_H - 2;
  line(g, 4, 1, r - 3, 1);
  line(g, 4, b, r - 3, b);
  line(g, 1, 4, 1, b - 3);
  line(g, r, 4, r, b - 3);
  for (const [x, y] of [[2, 3], [3, 2]]) {
    mark(g, x, y);
    mark(g, ICON_W - 1 - x, y);
    mark(g, x, ICON_H - 1 - y);
    mark(g, ICON_W - 1 - x, ICON_H - 1 - y);
  }
  return g;
}

/**
 * The PEC thumbnails: one for the whole design, then one per color block, each 48 x 38 pixels at
 * one bit per pixel. Stitches are drawn as lines, scaled into the frame.
 */
export function pecIcons(p: Pattern, b: Bounds, blocks: number): Uint8Array[] {
  const pad = 5;
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const scale = Math.min((ICON_W - 2 * pad - 1) / w, (ICON_H - 2 * pad - 1) / h);
  const ox = ICON_W / 2 - ((b.minX + b.maxX) / 2) * scale;
  const oy = ICON_H / 2 - ((b.minY + b.maxY) / 2) * scale;
  const px = (x: number) => Math.floor(x * scale + ox);
  const py = (y: number) => Math.floor(y * scale + oy);

  const all = framed();
  const perBlock = Array.from({ length: blocks }, framed);
  let block = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === COLOR_CHANGE) block = Math.min(block + 1, blocks - 1);
    if (c !== STITCH) continue;
    const x1 = px(p.x[i]);
    const y1 = py(p.y[i]);
    const prev = i > 0 && p.cmd[i - 1] === STITCH;
    const x0 = prev ? px(p.x[i - 1]) : x1;
    const y0 = prev ? py(p.y[i - 1]) : y1;
    line(all, x0, y0, x1, y1);
    line(perBlock[block], x0, y0, x1, y1);
  }
  return [all, ...perBlock];
}
