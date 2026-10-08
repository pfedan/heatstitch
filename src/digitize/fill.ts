import { expandRegion, sample, signedField, type Region } from './region';
import { runStitch, simplify } from './run';
import type { Pt } from './skeleton';
import { embossPoints, motifCrossings, motifInside, type Motif } from './deco';

/**
 * Tatami fill of a region (with holes) from its signed distance field.
 *
 * - Rows are scan lines at the fill angle on a lattice anchored at the design origin, so the rows of
 *   neighbouring regions line up; inside/outside comes from the field, so holes need no extra care.
 * - Rows are grouped into sections, monotone pieces that can be sewn back and forth in one go (the
 *   boustrophedon decomposition, Choset 2000): a section ends wherever the shape splits or merges.
 * - Needle points lie on a global lattice along the rows, shifted by a quarter stitch from row to
 *   row (Ink/Stitch's default of 4 staggers), so the stitch ends do not form visible lines.
 * - Without a fixed angle, the angle with the fewest sections out of 16 is used, as in the Goldman
 *   patent; fewer sections mean fewer travels.
 * - Underlay: a sparse fill at +90 degrees (or two crossing at ±45), inset from the edge, sewn first.
 * - Between sections the needle travels inside the region on a shortest path that avoids rows sewn
 *   already, so later rows cover it (Ink/Stitch's underpath); where it would run on top of sewn rows
 *   for more than 2 mm, the needle jumps instead.
 */

export interface FillParams {
  /** Distance between neighbouring rows (mm). */
  spacing: number;
  /** Stitch length (mm). */
  stitch: number;
  /** Degrees; null chooses per region. */
  angle: number | null;
  /** Rows are lengthened at both ends by this (mm). */
  pull: number;
  underlay: boolean;
  /** Underlay as one layer across the rows (default) or two crossing layers at ±45 degrees to them. */
  underCross?: boolean;
  /** Underlay stays this far inside the edge (mm); UNDERLAY_INSET by default. */
  underInset?: number;
  /** The underlay only in this part of the area (same pixels as the area); all of it when not set. */
  underArea?: Region;
  /**
   * Underlay inset as a share of the shape's width where it is (0.1 = 10 %), in place of the inset
   * in mm when set.
   */
  underInsetShare?: number;
  /** Distance between the underlay rows (mm); three times the top spacing, at least 1.2 mm, by default. */
  underSpacing?: number;
  /**
   * Shift of the needle points from row to row, as a fraction of the stitch length: 1/4 repeats
   * every 4 rows (the usual tatami), 1/2 gives a brick pattern; 0 shifts them at random.
   */
  offset?: number;
  /**
   * Spacing on the far side of the rows (gradient fill): it changes evenly across the shape. Curved
   * rows (fieldFill) take it across their mean direction, from the side where straight rows would start.
   */
  spacingEnd?: number;
  /** The next object starts here: the fill should end near it (straight rows only). */
  end?: Pt;
  /** Where travel between sections may run; the region itself by default. */
  travel?: Region;
  /** Curved rows keep this close to their line (mm); TOLERANCE by default. */
  tolerance?: number;
  /** Straight rows put their needle points on the lines of this motif (embossing, see deco.ts). */
  emboss?: { motif: Motif; size: number; strong?: boolean };
  /**
   * Rows that fade out across the shape (`out`, dense where the rows start) or in (`in`): the
   * density falls evenly to nearly nothing, so a second color fading the other way on the same
   * area makes a color blend as dense as one fill (see blend.ts in model).
   */
  fade?: 'out' | 'in';
}

export interface FillResult {
  /** Continuous stitch runs; a jump lies between two runs. */
  runs: Pt[][];
  angle: number;
  /** The first this many points of `runs` are the underlay. */
  under?: number;
}

interface Seg {
  k: number;
  u0: number;
  u1: number;
}

type Section = Seg[];

const STAGGERS = 4;
/**
 * A fading fill ends where it thins out below this share of its density: sparser rows would lie
 * several millimetres apart, joined by long stitches across (the other thread of a blend covers
 * that end almost alone anyway).
 */
const FADE_MIN = 0.15;
const UNDERLAY_STITCH = 3;
export const UNDERLAY_INSET = 0.4;
export const TRAVEL_STITCH = 2.5;
/** Travel lies under the rows: it may cut its way's curves further than visible stitches (mm). */
export const TRAVEL_TOLERANCE = 0.4;
/** Travel may run on top of sewn rows for this long (mm); a longer way becomes a jump. */
const SEWN_CROSSING = 2;
const RAD = Math.PI / 180;

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/**
 * Rows at an angle: u runs along them, v across. Row k lies at v(k): k * spacing, or for a gradient
 * at spacings that change evenly from `spacing` to `end` across the extent set by `layout`.
 */
class Frame {
  e: Pt;
  n: Pt;
  private vs: number[] | null = null;
  private k0 = 0;
  /** Needle points on the lines of a motif (embossing). */
  emboss?: { motif: Motif; size: number; strong?: boolean };
  /** Density falling evenly across the shape (out) or rising (in); see FillParams.fade. */
  fade?: 'out' | 'in';
  constructor(
    angleDeg: number,
    public spacing: number,
    private end = spacing,
    private offset = 1 / STAGGERS,
  ) {
    const a = angleDeg * RAD;
    this.e = [Math.cos(a), Math.sin(a)];
    this.n = [-Math.sin(a), Math.cos(a)];
  }
  at(u: number, v: number): Pt {
    return [u * this.e[0] + v * this.n[0], u * this.e[1] + v * this.n[1]];
  }
  get gradient(): boolean {
    return !!this.fade || Math.abs(this.end - this.spacing) >= 1e-3;
  }
  /** Sets the extent across the rows; returns the first and last row index. */
  layout(vmin: number, vmax: number): [number, number] {
    if (!this.gradient) return [Math.ceil(vmin / this.spacing), Math.floor(vmax / this.spacing)];
    const vs: number[] = [];
    const span = Math.max(1e-6, vmax - vmin);
    if (this.fade) {
      // Density, not spacing, changes evenly: 1 / spacing at full, down to FADE_MIN of it.
      for (let v = vmin + this.spacing / 2; v <= vmax; ) {
        const t = (v - vmin) / span;
        const d = this.fade === 'out' ? 1 - t : t;
        if (d >= FADE_MIN) vs.push(v);
        v += this.spacing / Math.max(FADE_MIN, d);
      }
      this.vs = vs;
      this.k0 = 0;
      return [0, vs.length - 1];
    }
    for (let v = vmin + this.spacing / 2; v <= vmax; ) {
      vs.push(v);
      v += this.spacing + ((this.end - this.spacing) * (v - vmin)) / span;
    }
    this.vs = vs;
    this.k0 = 0;
    return [0, vs.length - 1];
  }
  v(k: number): number {
    if (!this.vs) return k * this.spacing;
    const i = k - this.k0;
    if (i < 0) return this.vs[0] + i * this.spacing;
    if (i >= this.vs.length) return this.vs[this.vs.length - 1] + (i - this.vs.length + 1) * this.end;
    return this.vs[i];
  }
  /** Needle point phase of row k (fraction of the stitch length). */
  phase(k: number): number {
    if (this.offset <= 0) {
      // Random but repeatable: a hash of the row index.
      const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    }
    const t = k * this.offset;
    return t - Math.floor(t);
  }
}

/** Row segments inside the field (value below -inset) on the frame's rows. */
function rows(r: Region, field: Float32Array, f: Frame, inset: number): Seg[][] {
  const xs = [r.x0 * r.pxMm, (r.x0 + r.w) * r.pxMm];
  const ys = [r.y0 * r.pxMm, (r.y0 + r.h) * r.pxMm];
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const u = x * f.e[0] + y * f.e[1];
      const v = x * f.n[0] + y * f.n[1];
      umin = Math.min(umin, u);
      umax = Math.max(umax, u);
      vmin = Math.min(vmin, v);
      vmax = Math.max(vmax, v);
    }
  }
  const step = r.pxMm / 2;
  const out: Seg[][] = [];
  // A gradient runs across the shape itself, not across the window around it.
  let [lo, hi] = [vmin, vmax];
  if (f.gradient) {
    [lo, hi] = [Infinity, -Infinity];
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        if (!r.mask[y * r.w + x]) continue;
        const v = (x + r.x0 + 0.5) * r.pxMm * f.n[0] + (y + r.y0 + 0.5) * r.pxMm * f.n[1];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!Number.isFinite(lo)) [lo, hi] = [vmin, vmax];
  }
  const [k0, k1] = f.layout(lo, hi);
  for (let k = k0; k <= k1; k++) {
    const v = f.v(k);
    const segs: Seg[] = [];
    let prevU = umin;
    let prev = sample(r, field, ...f.at(umin, v)) + inset;
    let start = prev < 0 ? umin : NaN;
    for (let u = umin + step; u <= umax; u += step) {
      const val = sample(r, field, ...f.at(u, v)) + inset;
      if ((prev < 0) !== (val < 0)) {
        const cross = prevU + (step * prev) / (prev - val);
        if (val < 0) start = cross;
        else {
          if (cross - start > 0.2) segs.push({ k, u0: start, u1: cross });
          start = NaN;
        }
      }
      prev = val;
      prevU = u;
    }
    if (segs.length) out.push(segs);
  }
  return out;
}

/** Groups rows into sections that can each be sewn back and forth without leaving the shape. */
function sections(r: Region, field: Float32Array, f: Frame, rowList: Seg[][]): Section[] {
  const all: Section[] = [];
  let open: Section[] = [];
  const overlaps = (a: Seg, b: Seg) => a.u0 < b.u1 && b.u0 < a.u1;
  const inside = (u: number, v: number) => sample(r, field, ...f.at(u, v)) < Math.max(f.spacing, f.v(1) - f.v(0)) / 2;
  for (const segs of rowList) {
    const k = segs[0].k;
    const live = open.filter((s) => s[s.length - 1].k === k - 1);
    const next: Section[] = [];
    for (const seg of segs) {
      const cands = live.filter((s) => overlaps(s[s.length - 1], seg));
      let joined = false;
      if (cands.length === 1) {
        const c = cands[0];
        const last = c[c.length - 1];
        const exclusive = segs.filter((o) => overlaps(last, o)).length === 1;
        const vMid = (f.v(k - 1) + f.v(k)) / 2;
        if (exclusive && inside((last.u0 + seg.u0) / 2, vMid) && inside((last.u1 + seg.u1) / 2, vMid)) {
          c.push(seg);
          next.push(c);
          joined = true;
        }
      }
      if (!joined) {
        const s = [seg];
        all.push(s);
        next.push(s);
      }
    }
    open = next;
  }
  return all;
}

/** Points of one row from u `from` to `to` (row index k for the stagger). */
function rowStitches(f: Frame, k: number, v: number, from: number, to: number, len: number): Pt[] {
  const dir = to >= from ? 1 : -1;
  const phase = f.phase(k);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const margin = Math.min(0.6, len / 4);
  const pts: number[] = [];
  for (let j = Math.ceil((lo + margin) / len - phase); (j + phase) * len <= hi - margin; j++) pts.push((j + phase) * len);
  if (f.emboss) {
    const { motif, size } = f.emboss;
    const cross = motifCrossings(motif, size, { o: f.at(0, v), e: f.e }, lo + 0.3, hi - 0.3);
    pts.splice(0, pts.length, ...embossPoints(cross, pts, len, lo, hi));
    if (f.emboss.strong) {
      const v0 = f.at(0, v);
      const inside = (u: number) => motifInside(motif, size, [v0[0] + f.e[0] * u, v0[1] + f.e[1] * u]);
      pts.splice(0, pts.length, ...shortInside(pts, inside, len, lo, hi));
    }
  }
  if (dir < 0) pts.reverse();
  return [f.at(from, v), ...pts.map((u) => f.at(u, v)), f.at(to, v)];
}

/**
 * Strong embossing: inside the motif the stitches are about half as long, so the motif shows as
 * an area of a finer, more matte texture between its grooves, whichever way its lines run. The
 * rows and their spacing stay, so the density does too.
 */
function shortInside(pts: number[], inside: (u: number) => boolean, len: number, lo: number, hi: number): number[] {
  const short = Math.max(1.5, len * 0.5);
  const out: number[] = [];
  let prev = lo;
  for (const u of [...pts, hi]) {
    const g = u - prev;
    if (g > short * 1.4 && inside((prev + u) / 2)) {
      const n = Math.round(g / short);
      for (let i = 1; i < n; i++) out.push(prev + (g * i) / n);
    }
    if (u < hi) out.push(u);
    prev = u;
  }
  return out;
}

/** Stitches of a section, entered at its first or last row and at the start or end of that row. */
function sewSection(f: Frame, s: Section, len: number, pull: number, reversed: boolean, flip: boolean): Pt[] {
  const list = reversed ? s.slice().reverse() : s;
  const out: Pt[] = [];
  list.forEach((seg, i) => {
    const fwd = (i % 2 === 0) !== flip;
    const a = fwd ? seg.u0 - pull : seg.u1 + pull;
    const b = fwd ? seg.u1 + pull : seg.u0 - pull;
    const row = rowStitches(f, seg.k, f.v(seg.k), a, b, len);
    // The step to the next row: in short stitches where the rows lie far apart (a fading fill).
    const prev = out[out.length - 1];
    const gap = prev ? dist(prev, row[0]) : 0;
    for (let i = 1, n = Math.ceil(gap / len); i < n; i++) out.push([prev[0] + ((row[0][0] - prev[0]) * i) / n, prev[1] + ((row[0][1] - prev[1]) * i) / n]);
    out.push(...row);
  });
  return out;
}

/** The four ways into a section: [reversed, flip] with the entry point. */
function entries(f: Frame, s: Section, pull: number): Entry[] {
  const first = s[0];
  const last = s[s.length - 1];
  return [
    { reversed: false, flip: false, p: f.at(first.u0 - pull, f.v(first.k)) },
    { reversed: false, flip: true, p: f.at(first.u1 + pull, f.v(first.k)) },
    { reversed: true, flip: false, p: f.at(last.u0 - pull, f.v(last.k)) },
    { reversed: true, flip: true, p: f.at(last.u1 + pull, f.v(last.k)) },
  ];
}

/** How far past its ends a sewn row covers the travel grid (mm). */
const ROW_END_COVER = 0.35;

/** Grid over the region for travel paths: passable cells and cells covered by sewn rows. */
export class TravelGrid {
  cell: number;
  gw: number;
  gh: number;
  ox: number;
  oy: number;
  depth: Float32Array;
  covered: Uint8Array;

  constructor(r: Region) {
    this.cell = Math.max(r.pxMm, 0.25);
    this.ox = r.x0 * r.pxMm;
    this.oy = r.y0 * r.pxMm;
    this.gw = Math.ceil((r.w * r.pxMm) / this.cell);
    this.gh = Math.ceil((r.h * r.pxMm) / this.cell);
    this.depth = new Float32Array(this.gw * this.gh);
    this.covered = new Uint8Array(this.gw * this.gh);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) this.depth[j * this.gw + i] = -sample(r, r.sdf, ...this.center(i, j));
    }
  }

  center(i: number, j: number): Pt {
    return [this.ox + (i + 0.5) * this.cell, this.oy + (j + 0.5) * this.cell];
  }

  index(p: Pt): number {
    const i = Math.floor((p[0] - this.ox) / this.cell);
    const j = Math.floor((p[1] - this.oy) / this.cell);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return -1;
    return j * this.gw + i;
  }

  /**
   * Marks the cells under a sewn row (and half a row spacing to each side). The row counts a little
   * past its ends too: the strip between its ends and the edge of the shape is no free way, or
   * travel would run along the outline beside the sewn rows, where it shows.
   */
  cover(a: Pt, b: Pt, halfWidth: number): void {
    const l0 = dist(a, b);
    if (l0 > 0) {
      const ext = ROW_END_COVER / l0;
      [a, b] = [
        [a[0] - (b[0] - a[0]) * ext, a[1] - (b[1] - a[1]) * ext],
        [b[0] + (b[0] - a[0]) * ext, b[1] + (b[1] - a[1]) * ext],
      ];
    }
    const l = dist(a, b);
    const n = Math.max(1, Math.ceil(l / (this.cell / 2)));
    const nx = l > 0 ? -(b[1] - a[1]) / l : 0;
    const ny = l > 0 ? (b[0] - a[0]) / l : 0;
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n;
      const y = a[1] + ((b[1] - a[1]) * k) / n;
      for (const o of [-halfWidth, 0, halfWidth]) {
        const c = this.index([x + nx * o, y + ny * o]);
        if (c >= 0) this.covered[c] = 1;
      }
    }
  }

  /** Within 1 mm of a or b: a path may leave and reach rows sewn already there. */
  private near(c: number, a: Pt, b: Pt): boolean {
    const [x, y] = this.center(c % this.gw, Math.floor(c / this.gw));
    return Math.hypot(x - a[0], y - a[1]) < 1 || Math.hypot(x - b[0], y - b[1]) < 1;
  }

  /** Nearest passable cell to p within a few cells. */
  private snap(p: Pt): number {
    const c = this.index(p);
    if (c >= 0 && this.depth[c] > 0.05) return c;
    let best = -1;
    let bd = Infinity;
    const ci = Math.floor((p[0] - this.ox) / this.cell);
    const cj = Math.floor((p[1] - this.oy) / this.cell);
    for (let dj = -4; dj <= 4; dj++) {
      for (let di = -4; di <= 4; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.gw || j >= this.gh || this.depth[j * this.gw + i] <= 0.05) continue;
        const d = di * di + dj * dj;
        if (d < bd) {
          bd = d;
          best = j * this.gw + i;
        }
      }
    }
    return best;
  }

  /**
   * Shortest inside path from a to b (Dijkstra, 8 neighbours); the cost falls towards the middle of
   * the shape, which keeps travel away from the edges. With `avoidSewn`, cells covered by rows sewn
   * already cost much more, and a path that would still lie on top of them for more than
   * SEWN_CROSSING is refused (null): a jump is cleaner than a visible travel line.
   */
  path(a: Pt, b: Pt, avoidSewn: boolean): Pt[] | null {
    const s = this.snap(a);
    const t = this.snap(b);
    if (s < 0 || t < 0) return null;
    const n = this.gw * this.gh;
    const cost = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    cost[s] = 0;
    heap.push(s, 0);
    const steps: [number, number, number][] = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ];
    while (heap.size) {
      const [c, cc] = heap.pop();
      if (c === t) break;
      if (cc > cost[c]) continue;
      const ci = c % this.gw;
      const cj = (c - ci) / this.gw;
      for (const [di, dj, len] of steps) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) continue;
        const q = j * this.gw + i;
        const d = this.depth[q];
        if (d <= 0.05) continue;
        const sewn = avoidSewn && this.covered[q] && !this.near(q, a, b);
        const w = len * (1 + 0.4 / (d + 0.1)) * (sewn ? 12 : 1);
        const nc = cc + w;
        if (nc < cost[q]) {
          cost[q] = nc;
          from[q] = c;
          heap.push(q, nc);
        }
      }
    }
    if (from[t] < 0 && s !== t) return null;
    const cells: Pt[] = [];
    let onTop = 0;
    for (let c = t; c >= 0; c = c === s ? -1 : from[c]) {
      cells.push(this.center(c % this.gw, Math.floor(c / this.gw)));
      if (avoidSewn && this.covered[c] && !this.near(c, a, b)) onTop += this.cell;
    }
    if (onTop > SEWN_CROSSING) return null;
    cells.reverse();
    return [a, ...simplify(cells, this.cell * 0.6).slice(1, -1), b];
  }
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const { k, v } = this;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { k, v } = this;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Number of sections at a coarse spacing: the score for choosing the fill angle. */
function sectionCount(r: Region, angle: number, spacing: number): number {
  const f = new Frame(angle, spacing * 2);
  return sections(r, r.sdf, f, rows(r, r.sdf, f, 0)).length;
}

/**
 * Fill angle with the fewest sections out of 16; ties prefer the diagonals, and angles within 30
 * degrees of touching regions sewn already count a little worse, so neighbours differ.
 */
export function chooseAngle(r: Region, spacing: number, neighbours: number[]): number {
  let best = 45;
  let bestScore = Infinity;
  for (let i = 0; i < 16; i++) {
    const a = i * 11.25;
    const diag = Math.min(Math.abs(a - 45), Math.abs(a - 135)) / 45;
    const near = neighbours.some((n) => {
      const d = Math.abs((((a - n) % 180) + 180) % 180);
      return Math.min(d, 180 - d) < 30;
    });
    const score = sectionCount(r, a, spacing) + 0.2 * diag + (near ? 0.6 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

type Entry = { reversed: boolean; flip: boolean; p: Pt };

/** Where a section entered this way ends. */
function exitOf(f: Frame, s: Section, e: Entry, pull: number): Pt {
  const seg = e.reversed ? s[0] : s[s.length - 1];
  const fwd = ((s.length - 1) % 2 === 0) !== e.flip;
  return f.at(fwd ? seg.u1 + pull : seg.u0 - pull, f.v(seg.k));
}

/**
 * Order of the sections: greedily the nearest entry next. With `last`, that section is kept for
 * the end. `cost` adds up the straight ways between sections and, with `end`, from the last exit
 * to there.
 */
function plan(f: Frame, secs: Section[], pull: number, start: Pt, last?: { s: Section; e: Entry }, end?: Pt): { order: { s: Section; e: Entry }[]; cost: number } {
  const todo = secs.filter((s) => s !== last?.s);
  const order: { s: Section; e: Entry }[] = [];
  let pos = start;
  let cost = 0;
  while (todo.length) {
    let bi = 0;
    let be = entries(f, todo[0], pull)[0];
    let bd = Infinity;
    todo.forEach((s, i) => {
      for (const e of entries(f, s, pull)) {
        const d = dist(pos, e.p);
        if (d < bd) {
          bd = d;
          bi = i;
          be = e;
        }
      }
    });
    const s = todo.splice(bi, 1)[0];
    order.push({ s, e: be });
    cost += bd;
    pos = exitOf(f, s, be, pull);
  }
  if (last) {
    cost += dist(pos, last.e.p);
    order.push(last);
    pos = exitOf(f, last.s, last.e, pull);
  }
  if (end) cost += dist(pos, end);
  return { order, cost };
}

/**
 * Sews the sections greedily nearest first, connected by travel paths or jumps. With `end`, the
 * section that leaves the needle nearest to it is sewn last, when that makes the ways in between
 * and on to `end` shorter.
 */
function sewAll(
  f: Frame,
  secs: Section[],
  len: number,
  pull: number,
  start: Pt,
  grid: TravelGrid,
  avoidSewn: boolean,
  runs: Pt[][],
  end?: Pt,
  outer?: TravelGrid,
): Pt {
  let best = plan(f, secs, pull, start, undefined, end);
  if (end && secs.length) {
    let close: { s: Section; e: Entry } | null = null;
    let cd = Infinity;
    for (const s of secs) {
      for (const e of entries(f, s, pull)) {
        const d = dist(exitOf(f, s, e, pull), end);
        if (d < cd) {
          cd = d;
          close = { s, e };
        }
      }
    }
    const other = close && plan(f, secs, pull, start, close, end);
    // A little shorter is not worth a different look: at least 2 mm.
    if (other && other.cost < best.cost - 2) best = other;
  }
  let pos = start;
  let cur: Pt[] | null = runs.length ? runs[runs.length - 1] : null;
  for (const { s, e } of best.order) {
    const bd = dist(pos, e.p);
    const pts = sewSection(f, s, len, pull, e.reversed, e.flip);
    // Travel to the entry: straight when close, else along the inside of the shape.
    let travel: Pt[] | null = null;
    if (cur && bd > 1) {
      // Where the grid has no way (from outside it, or between its parts), the outer one may.
      const path = grid.path(pos, pts[0], avoidSewn) ?? outer?.path(pos, pts[0], avoidSewn);
      if (path && pathLength(path) < 2 * bd + 6) travel = runStitch(path, TRAVEL_STITCH, TRAVEL_TOLERANCE);
    } else if (cur) travel = [pos, pts[0]];
    if (cur && travel) cur.push(...travel.slice(1), ...pts.slice(1));
    else {
      cur = pts;
      runs.push(cur);
    }
    for (const seg of s) grid.cover(f.at(seg.u0, f.v(seg.k)), f.at(seg.u1, f.v(seg.k)), f.spacing / 2);
    pos = pts[pts.length - 1];
  }
  return pos;
}

export const pointCount = (runs: Pt[][]) => runs.reduce((a, r) => a + r.length, 0);

export function pathLength(p: Pt[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]);
  return l;
}

/** Fill stitches for the region, starting near `start`. Null if no row fits into the region. */
export function fillRegion(r: Region, p: FillParams, start: Pt, neighbours: number[] = []): FillResult | null {
  const angle = p.angle ?? chooseAngle(r, p.spacing, neighbours);
  const f = new Frame(angle, p.spacing, p.spacingEnd ?? p.spacing, p.offset ?? 1 / STAGGERS);
  if (p.emboss) f.emboss = p.emboss;
  if (p.fade) f.fade = p.fade;
  const top = rows(r, r.sdf, f, 0);
  if (!top.length) return null;
  const runs: Pt[][] = [];
  const grid = new TravelGrid(p.travel ?? r);
  const pos = p.underlay ? sewUnderlay(r, angle, p, start, grid, runs) : start;
  const under = pointCount(runs);
  sewAll(f, sections(r, r.sdf, f, top), p.stitch, p.pull, pos, grid, true, runs, p.end);
  return { runs, angle, under };
}

/**
 * The area inside by `share` of its width (0.1: 10 %): the union of the largest circles inside it,
 * each shrunk by `share` of its diameter. A wide part loses more at its edge than a narrow one,
 * and what is left stays one piece along the middle (corners get no islands of their own).
 */
function insetByShare(r: Region, share: number): Uint8Array {
  const { w, h, pxMm } = r;
  const d = r.sdf.map((v) => Math.max(0, -v));
  const k = Math.max(0, 1 - 2 * share);
  // The largest circles: those around pixels whose circle (as far as the edge) no other circle
  // nearby holds. A circle held by another lies along a straight way to its center, as deep as
  // that way is long; 15 % short of that counts as held, for the steps of the pixel grid.
  const offs: [number, number, number][] = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if ((dx || dy) && dx * dx + dy * dy <= 16) offs.push([dx, dy, 0.85 * Math.hypot(dx, dy) * pxMm]);
  // The circle that reaches furthest past each pixel (shrunk radius less the distance to its center).
  const bx = new Float32Array(w * h);
  const by = new Float32Array(w * h);
  const br = new Float32Array(w * h).fill(-1);
  const reach = new Float32Array(w * h).fill(-Infinity);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let held = false;
      for (const [dx, dy, l] of offs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && d[ny * w + nx] >= d[i] + l) {
          held = true;
          break;
        }
      }
      if (held) continue;
      bx[i] = x;
      by[i] = y;
      br[i] = k * d[i];
      reach[i] = br[i];
    }
  }
  const take = (i: number, x: number, y: number, n: number) => {
    if (br[n] < 0) return;
    const v = br[n] - Math.hypot(x - bx[n], y - by[n]) * pxMm;
    if (v > reach[i]) {
      reach[i] = v;
      bx[i] = bx[n];
      by[i] = by[n];
      br[i] = br[n];
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!d[i]) continue;
        if (x > 0) take(i, x, y, i - 1);
        if (y > 0) {
          take(i, x, y, i - w);
          if (x > 0) take(i, x, y, i - w - 1);
          if (x < w - 1) take(i, x, y, i - w + 1);
        }
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!d[i]) continue;
        if (x < w - 1) take(i, x, y, i + 1);
        if (y < h - 1) {
          take(i, x, y, i + w);
          if (x < w - 1) take(i, x, y, i + w + 1);
          if (x > 0) take(i, x, y, i + w - 1);
        }
      }
    }
  }
  const t = d;
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = t[i] > 0 && reach[i] >= 0 ? 1 : 0;
  // Circles near the edge that are not the largest there leave specks of their own: of each piece
  // of the area, only the part around its deepest point is kept.
  const piece = new Int32Array(w * h).fill(-1);
  const mask = new Uint8Array(w * h);
  const flood = (seed: number, inside: (i: number) => boolean, mark: (i: number) => void) => {
    const stack = [seed];
    mark(seed);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (n < 0 || n >= w * h || !inside(n)) continue;
        mark(n);
        stack.push(n);
      }
    }
  };
  for (let i = 0; i < piece.length; i++) {
    if (!(t[i] > 0) || piece[i] >= 0) continue;
    let deepest = i;
    flood(i, (n) => t[n] > 0 && piece[n] < 0, (n) => {
      piece[n] = i;
      if (r.sdf[n] < r.sdf[deepest]) deepest = n;
    });
    if (raw[deepest]) flood(deepest, (n) => raw[n] === 1 && !mask[n], (n) => (mask[n] = 1));
  }
  return mask;
}

/**
 * The area the underlay keeps to: the fill's area shrunk by the inset in mm, or by `share` of its
 * width where it is (without slivers too thin to sew). Null when nothing is left.
 */
export function underlayArea(r: Region, inset: number, share?: number): Region | null {
  if (share === undefined) return expandRegion(r, -inset);
  if (share <= 0) return r;
  const mask = insetByShare(r, share);
  if (!mask.some(Boolean)) return null;
  const sdf = signedField(mask, r.w, r.h, r.pxMm);
  // Open it: shrink and grow back, which drops teeth and threads thinner than 1 mm.
  const shrunk = expandRegion({ ...r, mask, sdf, sdfBase: sdf }, -0.5);
  return shrunk && expandRegion(shrunk, 0.5);
}

/**
 * Underlay for top rows at `angle`: rows across them (or two layers crossing at ±45 degrees), three
 * times the top spacing apart (at least 1.2 mm) unless set, inside `underlayArea`; appended to
 * `runs`. Travel between its rows stays inside that area too. Returns where the needle ends.
 */
export function sewUnderlay(r: Region, angle: number, p: Pick<FillParams, 'spacing' | 'underCross' | 'underInset' | 'underInsetShare' | 'underSpacing' | 'underArea'>, start: Pt, grid: TravelGrid, runs: Pt[][]): Pt {
  const us = p.underSpacing ?? Math.max(1.2, 3 * p.spacing);
  let pos = start;
  // Only where it is wanted (not under later objects); travel still goes the whole area's way.
  const base = p.underArea && p.underArea.pxMm === r.pxMm && p.underArea.w === r.w && p.underArea.h === r.h ? p.underArea : r;
  const area = underlayArea(base, p.underInset ?? UNDERLAY_INSET, p.underInsetShare);
  if (area) {
    const inner = area === r ? grid : new TravelGrid(area);
    for (const a of p.underCross ? [angle - 45, angle + 45] : [angle + 90]) {
      const uf = new Frame(a, us);
      const under = rows(area, area.sdf, uf, 0);
      if (under.length) pos = sewAll(uf, sections(area, area.sdf, uf, under), UNDERLAY_STITCH, 0, pos, inner, false, runs, undefined, inner === grid ? undefined : grid);
    }
  }
  grid.covered.fill(0);
  return pos;
}
