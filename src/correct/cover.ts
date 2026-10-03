import { COLOR_CHANGE, STITCH, type Pattern } from '../model/pattern';
import type { Run } from './structure';

/** Raster cell for coverage lookups, 0.1 mm units (0.2 mm). */
const CELL = 2;
/**
 * Coverage is the thread per area within this box half size (0.1 mm): a 0.6 x 0.6 mm window, fine
 * enough that the gap between two outlines half a millimetre apart does not read as covered.
 */
const HALF = 3;

/**
 * Thread sewn later, as seen from one run. Built by walking the runs from last to first: when a
 * run is visited, the raster holds exactly the stitching that will lie on top of it.
 */
export interface Cover {
  /**
   * Thread per area (mm/mm²) around (x, y) in 0.1 mm, of later runs in other color blocks. Later
   * runs in the same thread are left out: a second layer in the same color is a deliberate base or
   * texture layer, not cover.
   */
  all(x: number, y: number): number;
  /** Same, counting every later run, also in the same color. */
  later(x: number, y: number): number;
  /** Same, counting only later satin stitches. */
  satin(x: number, y: number): number;
  /** Length (0.1 mm) of the later satin stitch passing closest to (x, y), within 0.5 mm, or 0. */
  satinWidth(x: number, y: number): number;
}

class Raster {
  data: Float32Array;
  constructor(
    public x0: number,
    public y0: number,
    public cols: number,
    public rows: number,
  ) {
    this.data = new Float32Array(cols * rows);
  }
  addSegment(ax: number, ay: number, bx: number, by: number): void {
    const l = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(l / 0.5));
    const w = l / n / 10; // mm per sample
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const cx = Math.floor((ax + (bx - ax) * t - this.x0) / CELL);
      const cy = Math.floor((ay + (by - ay) * t - this.y0) / CELL);
      if (cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows) this.data[cy * this.cols + cx] += w;
    }
  }
  /** mm of thread per mm² in the window around (x, y). */
  density(x: number, y: number): number {
    const r = Math.round(HALF / CELL);
    const cx = Math.floor((x - this.x0) / CELL);
    const cy = Math.floor((y - this.y0) / CELL);
    let s = 0;
    for (let j = cy - r; j <= cy + r; j++) {
      if (j < 0 || j >= this.rows) continue;
      for (let i = cx - r; i <= cx + r; i++) if (i >= 0 && i < this.cols) s += this.data[j * this.cols + i];
    }
    const side = ((2 * r + 1) * CELL) / 10;
    return s / (side * side);
  }
}

/**
 * Calls `visit` for every run from the last to the first, with the coverage of everything sewn
 * after it. `satin[i]` marks satin segments (ending at record i).
 */
export function walkCovered(p: Pattern, runs: Run[], satin: Uint8Array, visit: (run: number, cover: Cover) => void): void {
  const b = p.bounds;
  const pad = 20;
  const x0 = b.minX - pad;
  const y0 = b.minY - pad;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX + 2 * pad) / CELL));
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY + 2 * pad) / CELL));
  const all = new Raster(x0, y0, cols, rows);
  const later = new Raster(x0, y0, cols, rows);
  const sat = new Raster(x0, y0, cols, rows);
  // Satin segments by 1 mm bucket for width lookups.
  const buckets = new Map<number, number[]>();
  const key = (bx: number, by: number) => bx * 1_000_003 + by;
  const cover: Cover = {
    all: (x, y) => all.density(x, y),
    later: (x, y) => later.density(x, y),
    satin: (x, y) => sat.density(x, y),
    satinWidth: (x, y) => {
      let best = 5;
      let width = 0;
      const bx = Math.floor(x / 10);
      const by = Math.floor(y / 10);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          for (const i of buckets.get(key(bx + dx, by + dy)) ?? []) {
            const ax = p.x[i - 1];
            const ay = p.y[i - 1];
            const ex = p.x[i] - ax;
            const ey = p.y[i] - ay;
            const l2 = ex * ex + ey * ey;
            const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2)) : 0;
            const d = Math.hypot(ax + t * ex - x, ay + t * ey - y);
            if (d < best) {
              best = d;
              width = Math.sqrt(l2);
            }
          }
        }
      }
      return width;
    },
  };
  // Color block of every run; runs of the current block wait until an earlier block is reached.
  const block: number[] = [];
  let b0 = 0;
  let r0 = 0;
  for (let i = 0; i < p.cmd.length && r0 < runs.length; i++) {
    if (p.cmd[i] === COLOR_CHANGE) b0++;
    if (i === runs[r0].start) block[r0++] = b0;
  }
  let pending: number[] = [];
  const flush = () => {
    for (const r of pending) {
      for (let i = runs[r].start + 1; i <= runs[r].end; i++) {
        if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) all.addSegment(p.x[i - 1], p.y[i - 1], p.x[i], p.y[i]);
      }
    }
    pending = [];
  };
  for (let r = runs.length - 1; r >= 0; r--) {
    if (pending.length && block[pending[0]] !== block[r]) flush();
    visit(r, cover);
    pending.push(r);
    const { start, end } = runs[r];
    for (let i = start + 1; i <= end; i++) {
      if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
      later.addSegment(p.x[i - 1], p.y[i - 1], p.x[i], p.y[i]);
      if (!satin[i]) continue;
      sat.addSegment(p.x[i - 1], p.y[i - 1], p.x[i], p.y[i]);
      // Register the segment in every bucket it passes through.
      const l = Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]);
      const n = Math.max(1, Math.ceil(l / 5));
      const seen = new Set<number>();
      for (let k = 0; k <= n; k++) {
        const kx = Math.floor((p.x[i - 1] + ((p.x[i] - p.x[i - 1]) * k) / n) / 10);
        const ky = Math.floor((p.y[i - 1] + ((p.y[i] - p.y[i - 1]) * k) / n) / 10);
        const kk = key(kx, ky);
        if (seen.has(kk)) continue;
        seen.add(kk);
        const list = buckets.get(kk);
        if (list) list.push(i);
        else buckets.set(kk, [i]);
      }
    }
  }
}
