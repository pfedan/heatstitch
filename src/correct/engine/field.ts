import { computeDensity } from '../../density/grid';
import { STITCH, type Pattern } from '../../model/pattern';
import { BLUR_MM, HOLE_RADIUS_MM, VALIDATION_CELL_MM } from '../../validation/measure';
import { satinMask } from '../../validation/satin';
import { SHORT, tagShortStitches, TIE } from '../../validation/shortStitches';
import { CAUTION, classifyDensity, classifyHoles, CRITICAL, SAFE, SHORT_STITCH_COUNT, type Thresholds } from '../../validation/thresholds';

/**
 * The fast measure behind the search: thread density, satin share, short stitches and
 * penetrations per 1 mm cell, the way validation measures them (measure.ts), but kept as a sum over
 * objects. The smoothing is linear, so the density of a design is the sum of the densities of its
 * objects: switching an object to another variant subtracts its old map and adds the new one,
 * without sewing or measuring the whole design again. Lower limits (gaps, fabric showing through)
 * are not additive and are checked on the real result (verify.ts).
 */

const SUB = 5;
const SUB_MM = VALIDATION_CELL_MM / SUB;
const SHIFT_MM = -0.05;
/** Margin around the design (mm) that variants may grow into. */
const MARGIN_MM = 4;

/** A map on the sub-cell lattice of the field, placed at (ox, oy) sub-cells. */
export interface SubMap {
  ox: number;
  oy: number;
  cols: number;
  rows: number;
  total: Float32Array;
  satin: Float32Array;
}

/** What one variant of an object contributes. */
export interface Contribution {
  map: SubMap;
  /** Short stitches (not ties) per cell: cell index (field) to count. */
  shorts: Map<number, number>;
  /** Penetrations (0.1 mm), ties left out: x, y pairs. */
  holes: Int32Array;
}

const options = { metric: 'thread' as const, cellMm: SUB_MM, blurMm: BLUR_MM, includeJumps: false, alignMm: VALIDATION_CELL_MM, shiftMm: SHIFT_MM };

const grown = (p: Pattern, mm: number): Pattern => ({ ...p, bounds: { minX: p.bounds.minX - mm * 10, minY: p.bounds.minY - mm * 10, maxX: p.bounds.maxX + mm * 10, maxY: p.bounds.maxY + mm * 10 } });

export class Field {
  /** Sub-cell lattice. */
  readonly ox: number;
  readonly oy: number;
  readonly scols: number;
  readonly srows: number;
  /** 1 mm cells (blocks of SUB x SUB sub-cells). */
  readonly cols: number;
  readonly rows: number;
  /** World position (mm) of the top-left corner of the lattice. */
  readonly originX: number;
  readonly originY: number;
  readonly total: Float32Array;
  readonly satin: Float32Array;
  readonly shorts: Int32Array;
  /** Level per cell now, and as the design is (the surrogate's own measure, for a fair comparison). */
  readonly level: Uint8Array;
  readonly base: Uint8Array;
  /** Penetrations per bucket (HOLE_RADIUS_MM wide), as counts of points at each position. */
  private readonly buckets = new Map<number, number[]>();
  private readonly holeR = HOLE_RADIUS_MM * 10;
  private readonly shortsLevel: number;

  constructor(
    p: Pattern,
    readonly th: Thresholds,
    stableFabric: boolean,
  ) {
    const g = computeDensity(grown(p, MARGIN_MM), options);
    const mask = satinMask(p);
    const s = computeDensity(grown(p, MARGIN_MM), options, (end) => mask[end] === 1);
    this.originX = g.originX;
    this.originY = g.originY;
    this.ox = 0;
    this.oy = 0;
    this.cols = Math.ceil(g.cols / SUB);
    this.rows = Math.ceil(g.rows / SUB);
    this.scols = this.cols * SUB;
    this.srows = this.rows * SUB;
    this.total = new Float32Array(this.scols * this.srows);
    this.satin = new Float32Array(this.scols * this.srows);
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        this.total[y * this.scols + x] = g.data[y * g.cols + x];
        this.satin[y * this.scols + x] = s.data[y * g.cols + x];
      }
    }
    this.shortsLevel = stableFabric ? CAUTION : CRITICAL;
    this.shorts = new Int32Array(this.cols * this.rows);
    const tags = tagShortStitches(p);
    for (let i = 0; i < tags.length; i++) {
      if (tags[i] === SHORT) {
        const c = this.cellAt(p.x[i], p.y[i]);
        if (c >= 0) this.shorts[c]++;
      }
    }
    if (th.holes) for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH && tags[i] !== TIE) this.addHole(p.x[i], p.y[i], 1);
    this.level = new Uint8Array(this.cols * this.rows);
    for (let c = 0; c < this.level.length; c++) this.level[c] = this.levelOf(c);
    this.base = this.level.slice();
  }

  /** Cell of a point (0.1 mm), or -1. */
  cellAt(x: number, y: number): number {
    const cx = Math.floor(x / 10 - this.originX);
    const cy = Math.floor(y / 10 - this.originY);
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows ? cy * this.cols + cx : -1;
  }

  /** World key of cell `c` (integer millimetres, as cells.ts cellKey). */
  keyOf(c: number): number {
    const cx = Math.round(this.originX + (c % this.cols));
    const cy = Math.round(this.originY + Math.floor(c / this.cols));
    return (cy + 50000) * 100000 + (cx + 50000);
  }

  /**
   * What the stitches `s` (one object or a few) contribute, on this field's lattice. With `keep`,
   * only the thread of records it marks (a stitch's record is where its segment ends); short
   * stitches and penetrations are counted only without it or for kept records.
   */
  contribution(s: Pattern, keep?: (record: number) => boolean): Contribution {
    const empty: SubMap = { ox: 0, oy: 0, cols: 0, rows: 0, total: new Float32Array(0), satin: new Float32Array(0) };
    let any = false;
    for (let i = 0; i < s.cmd.length && !any; i++) any = s.cmd[i] === STITCH;
    if (!any) return { map: empty, shorts: new Map(), holes: new Int32Array(0) };
    const g = computeDensity(s, options, keep);
    const mask = satinMask(s);
    const sat = computeDensity(s, options, (end) => mask[end] === 1 && (!keep || keep(end)));
    const ox = Math.round((g.originX - this.originX) / SUB_MM);
    const oy = Math.round((g.originY - this.originY) / SUB_MM);
    const map: SubMap = { ox, oy, cols: g.cols, rows: g.rows, total: g.data, satin: sat.data };
    const tags = tagShortStitches(s);
    const shorts = new Map<number, number>();
    const holes: number[] = [];
    for (let i = 0; i < s.cmd.length; i++) {
      if (s.cmd[i] !== STITCH || (keep && !keep(i))) continue;
      if (tags[i] === SHORT) {
        const c = this.cellAt(s.x[i], s.y[i]);
        if (c >= 0) shorts.set(c, (shorts.get(c) ?? 0) + 1);
      }
      if (this.th.holes && tags[i] !== TIE) holes.push(s.x[i], s.y[i]);
    }
    return { map, shorts, holes: Int32Array.from(holes) };
  }

  /**
   * A predicted contribution: `top` scaled by `k` (denser or looser rows) and `under` scaled by
   * `u`, or kept only where `keepUnder` (a sub-cell test) holds. Short stitches and penetrations
   * stay those of `top` and `under`.
   */
  blend(top: Contribution, under: Contribution, k: number, u: number, keepUnder?: (sx: number, sy: number) => boolean): Contribution {
    const parts = [top.map, under.map].filter((m) => m.cols);
    if (!parts.length) return top;
    const ox = Math.min(...parts.map((m) => m.ox));
    const oy = Math.min(...parts.map((m) => m.oy));
    const cols = Math.max(...parts.map((m) => m.ox + m.cols)) - ox;
    const rows = Math.max(...parts.map((m) => m.oy + m.rows)) - oy;
    const total = new Float32Array(cols * rows);
    const satin = new Float32Array(cols * rows);
    const add = (m: SubMap, f: number, test?: (sx: number, sy: number) => boolean) => {
      if (!m.cols || f === 0) return;
      for (let y = 0; y < m.rows; y++) {
        for (let x = 0; x < m.cols; x++) {
          if (test && !test(m.ox + x, m.oy + y)) continue;
          const i = (m.oy + y - oy) * cols + (m.ox + x - ox);
          total[i] += f * m.total[y * m.cols + x];
          satin[i] += f * m.satin[y * m.cols + x];
        }
      }
    };
    add(top.map, k);
    add(under.map, keepUnder ? 1 : u, keepUnder);
    const shorts = new Map(top.shorts);
    for (const [c, n] of under.shorts) shorts.set(c, (shorts.get(c) ?? 0) + n);
    const holes = new Int32Array(top.holes.length + under.holes.length);
    holes.set(top.holes);
    holes.set(under.holes, top.holes.length);
    return { map: { ox, oy, cols, rows, total, satin }, shorts, holes };
  }

  /** Cells a map touches, as a box of cells [c0, r0, c1, r1] (inclusive), clipped to the field. */
  cellsOf(m: SubMap, h?: Int32Array): [number, number, number, number] {
    let c0 = Math.floor(m.ox / SUB);
    let r0 = Math.floor(m.oy / SUB);
    let c1 = Math.floor((m.ox + m.cols - 1) / SUB);
    let r1 = Math.floor((m.oy + m.rows - 1) / SUB);
    if (h?.length) {
      // Penetrations change neighbour counts up to the hole radius around them.
      for (let k = 0; k < h.length; k += 2) {
        const cx = Math.floor(h[k] / 10 - this.originX);
        const cy = Math.floor(h[k + 1] / 10 - this.originY);
        c0 = Math.min(c0, cx - 1);
        r0 = Math.min(r0, cy - 1);
        c1 = Math.max(c1, cx + 1);
        r1 = Math.max(r1, cy + 1);
      }
    }
    return [Math.max(0, c0), Math.max(0, r0), Math.min(this.cols - 1, c1), Math.min(this.rows - 1, r1)];
  }

  /**
   * Replaces contribution `from` by `to`. Returns the cells whose level may have changed (box),
   * after their levels were recomputed; `onChange` sees each cell's old and new level.
   */
  swap(from: Contribution, to: Contribution, onChange?: (c: number, was: number, now: number) => void): void {
    this.addMap(from.map, -1);
    this.addMap(to.map, 1);
    for (const [c, n] of from.shorts) this.shorts[c] -= n;
    for (const [c, n] of to.shorts) this.shorts[c] += n;
    for (let k = 0; k < from.holes.length; k += 2) this.addHole(from.holes[k], from.holes[k + 1], -1);
    for (let k = 0; k < to.holes.length; k += 2) this.addHole(to.holes[k], to.holes[k + 1], 1);
    const a = this.cellsOf(from.map, from.holes);
    const b = this.cellsOf(to.map, to.holes);
    const box: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
    if (from.map.cols === 0) box.splice(0, 4, ...b);
    if (to.map.cols === 0) box.splice(0, 4, ...a);
    for (let r = box[1]; r <= box[3]; r++) {
      for (let c = box[0]; c <= box[2]; c++) {
        const i = r * this.cols + c;
        const was = this.level[i];
        const now = this.levelOf(i);
        if (now !== was) {
          this.level[i] = now;
          onChange?.(i, was, now);
        }
      }
    }
  }

  private addMap(m: SubMap, sign: number): void {
    for (let y = 0; y < m.rows; y++) {
      const fy = m.oy + y;
      if (fy < 0 || fy >= this.srows) continue;
      for (let x = 0; x < m.cols; x++) {
        const fx = m.ox + x;
        if (fx < 0 || fx >= this.scols) continue;
        const k = y * m.cols + x;
        this.total[fy * this.scols + fx] += sign * m.total[k];
        this.satin[fy * this.scols + fx] += sign * m.satin[k];
      }
    }
  }

  private addHole(x: number, y: number, n: number): void {
    const k = Math.floor(x / this.holeR) * 1_000_003 + Math.floor(y / this.holeR);
    const b = this.buckets.get(k);
    if (n > 0) {
      if (b) b.push(x, y);
      else this.buckets.set(k, [x, y]);
    } else if (b) {
      for (let j = 0; j < b.length; j += 2) {
        if (b[j] === x && b[j + 1] === y) {
          b.splice(j, 2);
          break;
        }
      }
    }
  }

  /** Density (peak sub-cell) and satin share of cell `c`. */
  densityOf(c: number): { peak: number; share: number } {
    const cx = c % this.cols;
    const cy = (c - cx) / this.cols;
    let peak = 0;
    let sumT = 0;
    let sumS = 0;
    for (let y = cy * SUB; y < cy * SUB + SUB; y++) {
      for (let x = cx * SUB; x < cx * SUB + SUB; x++) {
        const t = this.total[y * this.scols + x];
        if (t > peak) peak = t;
        sumT += t;
        sumS += this.satin[y * this.scols + x];
      }
    }
    return { peak, share: sumT > 1e-6 ? Math.min(1, Math.max(0, sumS / sumT)) : 0 };
  }

  /** Most neighbouring penetrations of any penetration in cell `c`. */
  private holesOf(c: number): number {
    const cx = c % this.cols;
    const cy = (c - cx) / this.cols;
    const r = this.holeR;
    const r2 = r * r + 1e-6;
    let best = 0;
    // Penetrations in the cell lie in the buckets it spans.
    const bx0 = Math.floor(((this.originX + cx) * 10) / r);
    const by0 = Math.floor(((this.originY + cy) * 10) / r);
    const bx1 = Math.floor(((this.originX + cx + 1) * 10) / r);
    const by1 = Math.floor(((this.originY + cy + 1) * 10) / r);
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = this.buckets.get(bx * 1_000_003 + by);
        if (!b) continue;
        for (let j = 0; j < b.length; j += 2) {
          const x = b[j];
          const y = b[j + 1];
          if (this.cellAt(x, y) !== c) continue;
          let n = 0;
          const kx = Math.floor(x / r);
          const ky = Math.floor(y / r);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const o = this.buckets.get((kx + dx) * 1_000_003 + ky + dy);
              if (!o) continue;
              for (let q = 0; q < o.length; q += 2) {
                const ex = o[q] - x;
                const ey = o[q + 1] - y;
                if (ex * ex + ey * ey <= r2) n++;
              }
            }
          }
          // The point itself is counted once.
          best = Math.max(best, n - 1);
        }
      }
    }
    return best;
  }

  /** Level of cell `c` by density, short stitches and penetrations (the upper limits). */
  levelOf(c: number): number {
    const { peak, share } = this.densityOf(c);
    let l = classifyDensity(peak, share, this.th);
    if (l === CRITICAL) return l;
    if (this.shorts[c] >= SHORT_STITCH_COUNT) l = Math.max(l, this.shortsLevel) as typeof l;
    if (this.th.holes && l < CRITICAL) l = Math.max(l, classifyHoles(this.holesOf(c), this.th)) as typeof l;
    return l;
  }

  /** Whether cell `c` is critical by density now / by short stitches or penetrations. */
  criticalBy(c: number, kind: 'density' | 'holes'): boolean {
    if (kind === 'density') {
      const { peak, share } = this.densityOf(c);
      return classifyDensity(peak, share, this.th) === CRITICAL;
    }
    if (this.shorts[c] >= SHORT_STITCH_COUNT && this.shortsLevel === CRITICAL) return true;
    return !!this.th.holes && classifyHoles(this.holesOf(c), this.th) === CRITICAL;
  }
}

export { SAFE, CAUTION, CRITICAL };
