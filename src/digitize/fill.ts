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
  /**
   * Travel keeps off the strips past the ends of sewn rows: an area with parts left out sews in
   * more sections, and its travel would run round the outline beside them, where it shows.
   */
  offRowEnds?: boolean;
  /** The whole area this one was cut from (parts left out under what lies on top): travel there is hidden. */
  whole?: Region;
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
/** How far the step between two sparse rows may cut outside the outline (mm). */
const SPARSE_SLACK = 0.25;

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
  /**
   * Sparse rows (crosshatch): the half width each row covers for travel, its thread only. Dense
   * rows cover the ground between them, half a spacing to each side.
   */
  lane?: number;
  /** Sparse rows: travel laid onto the lines thread lies on (see crosshatchFill), not cut across them. */
  onLines?: (path: Pt[]) => Pt[];
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
  /** The half width a row covers (see lane). */
  get half(): number {
    return this.lane ?? this.spacing / 2;
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
  // The step from row to row may cut a corner by half a row; sparse rows lie far apart, and their
  // steps keep near the outline instead.
  const slack = f.lane !== undefined ? SPARSE_SLACK : Math.max(f.spacing, f.v(1) - f.v(0)) / 2;
  const inside = (u: number, v: number) => sample(r, field, ...f.at(u, v)) < slack;
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

/** How far past its ends a sewn row reaches the strip along the outline beside it (mm). */
const ROW_END_STRIP = 0.35;
/** How far travel may run along those strips (mm); crossing one takes a cell or two. */
const ROW_END_RUN = 4;
/** How far travel may show where rows to come are known (mm): crossing the strip at a row end. */
const BARE_RUN = 1.5;

/** Grid over the region for travel paths: passable cells and cells covered by sewn rows. */
export class TravelGrid {
  cell: number;
  gw: number;
  gh: number;
  ox: number;
  oy: number;
  depth: Float32Array;
  covered: Uint8Array;
  /** Cells just past the ends of sewn rows (with `offRowEnds`): travel may cross them, not run along them. */
  rowEnds: Uint8Array;
  offRowEnds: boolean;
  /**
   * With `ahead` set (see expect): how many rows still to come cover each cell. Travel there is
   * hidden, as in the parts left out (`gone`); anywhere else not sewn it shows, like beside row ends.
   */
  ahead: Uint16Array | null = null;
  gone: Uint8Array | null = null;
  /**
   * Sparse rows crossing (crosshatch): a sewn row is a way for travel like a row still to come,
   * along it travel only doubles its thread (see crosshatchFill). Its cells join `gone`, never
   * `covered`.
   */
  layered = false;
  /** How much longer than the straight way travel may be (times, plus 6 mm); longer ways become jumps. */
  detour = 2;
  /** What a jump costs against travel when planning the order of sections (mm of travel). */
  trimCost = TRIM_COST;

  constructor(r: Region, offRowEnds = false, cut?: { whole: Region; area: Region }) {
    this.offRowEnds = offRowEnds;
    this.cell = Math.max(r.pxMm, 0.25);
    this.ox = r.x0 * r.pxMm;
    this.oy = r.y0 * r.pxMm;
    this.gw = Math.ceil((r.w * r.pxMm) / this.cell);
    this.gh = Math.ceil((r.h * r.pxMm) / this.cell);
    this.depth = new Float32Array(this.gw * this.gh);
    this.covered = new Uint8Array(this.gw * this.gh);
    this.rowEnds = new Uint8Array(this.gw * this.gh);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) this.depth[j * this.gw + i] = -sample(r, r.sdf, ...this.center(i, j));
    }
    if (cut) {
      this.gone = new Uint8Array(this.gw * this.gh);
      for (let j = 0; j < this.gh; j++) {
        for (let i = 0; i < this.gw; i++) {
          const q = this.center(i, j);
          if (sample(cut.whole, cut.whole.sdf, ...q) < 0 && sample(cut.area, cut.area.sdf, ...q) > 0) this.gone[j * this.gw + i] = 1;
        }
      }
    }
  }

  /** The longest way travel may take between two points `d` apart. */
  way(d: number): number {
    return this.detour * d + 6;
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

  /** Marks the cells under a sewn row (and half a row spacing to each side), and the strips past its ends. */
  cover(a: Pt, b: Pt, halfWidth: number): void {
    this.apply(this.footprint(a, b, halfWidth));
  }

  /** The cells a sewn row covers (see cover), worked out once for planning, which covers sections again and again. */
  footprint(a: Pt, b: Pt, halfWidth: number): { under: number[]; ends: number[] } {
    const under: number[] = [];
    const ends: number[] = [];
    const l = dist(a, b);
    const nx = l > 0 ? -(b[1] - a[1]) / l : 0;
    const ny = l > 0 ? (b[0] - a[0]) / l : 0;
    if (l > 0 && this.offRowEnds) {
      const ux = (b[0] - a[0]) / l;
      const uy = (b[1] - a[1]) / l;
      const m = Math.ceil(ROW_END_STRIP / (this.cell / 2));
      for (let k = 1; k <= m; k++) {
        const t = (ROW_END_STRIP * k) / m;
        for (const o of [-halfWidth, 0, halfWidth]) {
          for (const [ex, ey] of [[a[0] - ux * t, a[1] - uy * t], [b[0] + ux * t, b[1] + uy * t]]) {
            const c = this.index([ex + nx * o, ey + ny * o]);
            if (c >= 0) ends.push(c);
          }
        }
      }
    }
    this.stamp(a, b, halfWidth, (c) => under.push(c));
    return { under, ends };
  }

  /** Marks a footprint sewn: covered, one row less to come, strips past the row ends. */
  apply(fp: { under: number[]; ends: number[] }): void {
    const { covered, ahead, gone, rowEnds, layered } = this;
    for (const c of fp.ends) rowEnds[c] = 1;
    for (const c of fp.under) {
      if (ahead && ahead[c] > 0) ahead[c]--;
      if (layered && gone) gone[c] = 1;
      else covered[c] = 1;
    }
  }

  /** Counts the cells under a row still to come (see ahead). */
  expect(a: Pt, b: Pt, halfWidth: number): void {
    this.ahead ??= new Uint16Array(this.gw * this.gh);
    this.stamp(a, b, halfWidth, (c) => this.ahead![c]++);
  }

  private seen: Uint32Array | null = null;
  private marks = 0;
  /** Calls `fn` once for each cell under the row from a to b. */
  private stamp(a: Pt, b: Pt, halfWidth: number, fn: (c: number) => void): void {
    const l = dist(a, b);
    const n = Math.max(1, Math.ceil(l / (this.cell / 2)));
    const nx = l > 0 ? -(b[1] - a[1]) / l : 0;
    const ny = l > 0 ? (b[0] - a[0]) / l : 0;
    this.seen ??= new Uint32Array(this.gw * this.gh);
    const mark = ++this.marks;
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n;
      const y = a[1] + ((b[1] - a[1]) * k) / n;
      for (const o of [-halfWidth, 0, halfWidth]) {
        const c = this.index([x + nx * o, y + ny * o]);
        if (c >= 0 && this.seen[c] !== mark) {
          this.seen[c] = mark;
          fn(c);
        }
      }
    }
  }

  /** A cell where travel shows: neither sewn on top of nor hidden by rows to come or a part left out. */
  private bare(c: number): boolean {
    return this.ahead ? !this.covered[c] && !this.ahead[c] && !this.gone?.[c] : !!this.rowEnds[c] && !this.covered[c];
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
   * Shortest inside path from a to b (A*, 8 neighbours); the cost falls towards the middle of the
   * shape, which keeps travel away from the edges. With `avoidSewn`, cells covered by rows sewn
   * already cost much more, and a path that would still lie on top of them for more than
   * SEWN_CROSSING is refused (null): a jump is cleaner than a visible travel line.
   */
  path(a: Pt, b: Pt, avoidSewn: boolean): Pt[] | null {
    const w = this.route(a, b, avoidSewn);
    return w && [a, ...simplify(w.cells, this.cell * 0.6).slice(1, -1), b];
  }

  /**
   * The way from a to b as path takes it, or null. Where rows to come are known, a way hidden all
   * along comes first; only without one may it cross sewn rows or run beside row ends a little.
   */
  private route(a: Pt, b: Pt, avoidSewn: boolean, limit = Infinity): { cells: Pt[]; length: number; onTop: number; alongEnds: number } | null {
    const s = this.snap(a);
    const t = this.snap(b);
    if (s < 0 || t < 0) return null;
    const ok = (x: ReturnType<TravelGrid['walk']>) => !!x && x.onTop <= SEWN_CROSSING && x.alongEnds <= (this.ahead ? BARE_RUN : ROW_END_RUN);
    if (avoidSewn && this.ahead) {
      const w = this.walk(this.search(s, a, b, true, t, true, limit), s, t, a, b, true);
      if (w && ok(w) && w.length < this.way(dist(a, b))) return w;
    }
    const w = this.walk(this.search(s, a, b, avoidSewn, t, false, limit), s, t, a, b, avoidSewn);
    return w && ok(w) ? w : null;
  }

  /** The cells a hidden way reaches from a (leaving a within 1 mm any way): see reaches. */
  flood(a: Pt): Uint8Array {
    const { gw, gh, covered, ahead, gone } = this;
    const seen = new Uint8Array(gw * gh);
    const stack: number[] = [];
    const shows = (q: number) => !!covered[q] || (!!ahead && !ahead[q] && !gone?.[q]);
    const r = Math.ceil(1 / this.cell);
    const ci = Math.floor((a[0] - this.ox) / this.cell);
    const cj = Math.floor((a[1] - this.oy) / this.cell);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
        const q = j * gw + i;
        if (this.depth[q] > 0.05 && dist(this.center(i, j), a) < 1) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    while (stack.length) {
      const c = stack.pop()!;
      const i0 = c % gw;
      const j0 = (c - i0) / gw;
      for (let k = 0; k < 8; k++) {
        const i = i0 + STEP_I[k];
        const j = j0 + STEP_J[k];
        if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
        const q = j * gw + i;
        if (seen[q] || this.depth[q] <= 0.05 || shows(q)) continue;
        if (k >= 4 && shows(j0 * gw + i) && shows(j * gw + i0)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    return seen;
  }

  /** Whether a flood (see flood) gets within 1 mm of b. */
  reaches(seen: Uint8Array, b: Pt): boolean {
    const r = Math.ceil(1 / this.cell);
    const ci = Math.floor((b[0] - this.ox) / this.cell);
    const cj = Math.floor((b[1] - this.oy) / this.cell);
    for (let j = Math.max(0, cj - r); j <= Math.min(this.gh - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(this.gw - 1, ci + r); i++) {
        if (seen[j * this.gw + i] && dist(this.center(i, j), b) < 1) return true;
      }
    }
    return false;
  }

  /** Whether the straight way from a to b stays inside, off sewn rows and hidden all along. */
  clear(a: Pt, b: Pt): boolean {
    const l = dist(a, b);
    const n = Math.ceil(l / (this.cell / 2));
    for (let k = 1; k < n; k++) {
      const p: Pt = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      const c = this.index(p);
      if (c < 0 || this.depth[c] <= 0.05) return false;
      if (dist(p, a) < 1 || dist(p, b) < 1) continue;
      if (this.covered[c] || this.bare(c)) return false;
    }
    return true;
  }

  /**
   * How much the way from a to b costs (see path): its length, and more for each millimetre of it
   * that shows (on sewn rows, beside row ends); null where only a jump gets there.
   */
  length(a: Pt, b: Pt): number | null {
    // Planning asks often: a search that has to look far and wide counts as no way.
    const w = this.route(a, b, true, (SEARCH_SPREAD * this.way(dist(a, b))) / this.cell);
    return w && w.length + SHOWN_COST * (w.onTop + w.alongEnds);
  }

  /** A* from cell s to t (Dijkstra everywhere with t < 0), at most `limit` cells: the predecessor of each cell. */
  private search(s: number, a: Pt, b: Pt | null, avoidSewn: boolean, t: number, hiddenOnly = false, limit = Infinity): Int32Array {
    const { cost, from, done, touched } = this.buffers();
    const heap = new MinHeap();
    const base = this.weights();
    const { gw, gh, cell, ox, oy, covered, ahead, gone } = this;
    // Where rows to come are known, only ways short enough to take (see sewAll): inside an ellipse round a and b.
    const reach = ahead && b ? this.way(dist(a, b)) + 2 * cell : 0;
    // Towards t, the straight distance left is a lower bound of the cost (A*).
    const toT = t >= 0;
    const tx = toT ? ox + ((t % gw) + 0.5) * cell : 0;
    const ty = toT ? oy + (Math.floor(t / gw) + 0.5) * cell : 0;
    const bb = b ?? a;
    // On sewn rows, or where rows to come are known, where it would show (see bare); not within
    // 1 mm of a or b, where the way leaves and reaches rows.
    const shows = (i: number, j: number) => {
      const q = j * gw + i;
      if (!covered[q] && !(ahead && !ahead[q] && !gone?.[q])) return false;
      const x = ox + (i + 0.5) * cell;
      const y = oy + (j + 0.5) * cell;
      return (x - a[0]) ** 2 + (y - a[1]) ** 2 >= 1 && (x - bb[0]) ** 2 + (y - bb[1]) ** 2 >= 1;
    };
    cost[s] = 0;
    touched.push(s);
    heap.push(s, 0);
    let popped = 0;
    while (heap.size) {
      const c = heap.pop();
      if (c === t || ++popped > limit) break;
      if (done[c]) continue;
      done[c] = 1;
      const ci = c % gw;
      const cj = (c - ci) / gw;
      const cc = cost[c];
      for (let k = 0; k < 8; k++) {
        const i = ci + STEP_I[k];
        const j = cj + STEP_J[k];
        if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
        const q = j * gw + i;
        const w0 = base[q];
        if (w0 === 0 || done[q]) continue;
        let w = STEP_LEN[k] * w0;
        const x = ox + (i + 0.5) * cell;
        const y = oy + (j + 0.5) * cell;
        if (reach && Math.sqrt((x - a[0]) ** 2 + (y - a[1]) ** 2) + Math.sqrt((x - bb[0]) ** 2 + (y - bb[1]) ** 2) > reach) continue;
        // On sewn rows, or where rows to come are known, where it would show (see bare).
        if (avoidSewn && shows(i, j)) {
          if (hiddenOnly) continue;
          w *= covered[q] ? 12 : 4;
        }
        // Hidden only, not diagonally between two cells where it would show (between sewn rows).
        if (hiddenOnly && k >= 4 && shows(ci + STEP_I[k], cj) && shows(ci, cj + STEP_J[k])) continue;
        const nc = cc + w;
        if (nc < cost[q]) {
          if (cost[q] === Infinity) touched.push(q);
          cost[q] = nc;
          from[q] = c;
          heap.push(q, toT ? nc + Math.sqrt((x - tx) ** 2 + (y - ty) ** 2) : nc);
        }
      }
    }
    return from;
  }

  private w0: Float32Array | null = null;
  /** The cost of a step into each cell: higher towards the edges, 0 where travel cannot go. */
  private bufs: { cost: Float64Array; from: Int32Array; done: Uint8Array; touched: number[] } | null = null;
  /** The arrays a search works in, set back where the last search touched them (searches run often, mostly over few cells). */
  private buffers() {
    if (!this.bufs) {
      const n = this.gw * this.gh;
      this.bufs = { cost: new Float64Array(n).fill(Infinity), from: new Int32Array(n).fill(-1), done: new Uint8Array(n), touched: [] };
    }
    const { cost, from, done, touched } = this.bufs;
    for (const q of touched) {
      cost[q] = Infinity;
      from[q] = -1;
      done[q] = 0;
    }
    touched.length = 0;
    return this.bufs;
  }

  private weights(): Float32Array {
    if (!this.w0) {
      this.w0 = new Float32Array(this.depth.length);
      for (let q = 0; q < this.depth.length; q++) {
        const d = this.depth[q];
        this.w0[q] = d <= 0.05 ? 0 : 1 + 0.4 / (d + 0.1);
      }
    }
    return this.w0;
  }

  /** The cells of the tree's path from s to t, its length, and how much of it lies on sewn rows or along their ends. */
  private walk(from: Int32Array, s: number, t: number, a: Pt, b: Pt, avoidSewn: boolean): { cells: Pt[]; length: number; onTop: number; alongEnds: number } | null {
    if (from[t] < 0 && s !== t) return null;
    const cells: Pt[] = [];
    let onTop = 0;
    let alongEnds = 0;
    for (let c = t; c >= 0; c = c === s ? -1 : from[c]) {
      cells.push(this.center(c % this.gw, Math.floor(c / this.gw)));
      if (!avoidSewn || this.near(c, a, b)) continue;
      if (this.covered[c]) onTop += this.cell;
      else if (this.bare(c)) alongEnds += this.cell;
    }
    cells.reverse();
    let length = 0;
    for (let i = 1; i < cells.length; i++) length += dist(cells[i - 1], cells[i]);
    return { cells, length, onTop, alongEnds };
  }
}

const STEP_I = [1, -1, 0, 0, 1, 1, -1, -1];
const STEP_J = [0, 0, 1, -1, 1, -1, 1, -1];
const STEP_LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

class MinHeap {
  private k = new Int32Array(256);
  private v = new Float64Array(256);
  size = 0;
  push(key: number, val: number): void {
    if (this.size === this.k.length) {
      const k = new Int32Array(this.size * 2);
      const v = new Float64Array(this.size * 2);
      k.set(this.k);
      v.set(this.v);
      this.k = k;
      this.v = v;
    }
    const { k, v } = this;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= val) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  /** The key with the smallest value, taken off the heap. */
  pop(): number {
    const { k, v } = this;
    const top = k[0];
    const n = --this.size;
    const lk = k[n];
    const lv = v[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const m = l + 1 < n && v[l + 1] < v[l] ? l + 1 : l;
      if (v[m] >= lv) break;
      k[i] = k[m];
      v[i] = v[m];
      i = m;
    }
    k[i] = lk;
    v[i] = lv;
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

/** What a trim costs against travel when choosing the order of sections (mm of travel). */
const TRIM_COST = 25;
/** How many of the cheapest next steps get a look one step further. */
const LOOKAHEAD = 3;
/** How many of the nearest ways on are tried at each step; farther ones would mostly be jumps anyway. */
const TRIES = 8;
/** A search while planning looks at no more cells than this many times the longest way it may take. */
const SEARCH_SPREAD = 80;
/** What a millimetre of travel that shows costs when choosing the order of sections (mm of travel). */
const SHOWN_COST = 4;
/** Ending this close to where the next object starts costs only the distance (mm). */
const END_NEAR = 3;

/**
 * What ending away from `end` (where the next object starts) costs when choosing the order: more
 * than a few millimetres off, as much as a trim, so the next object keeps its start.
 */
const endCost = (p: Pt, end: Pt) => {
  const d = dist(p, end);
  return d > END_NEAR ? d + TRIM_COST : d;
};

/**
 * What planning the order of sections on `grid` needs: the grid's state kept and put back, a
 * section marked sewn, and what the way from one point to another costs: its length when hidden
 * enough (and not much of a detour, as sewAll takes it), else a trim.
 */
function planning(f: Frame, grid: TravelGrid) {
  // Sewn rows of layered rows are ways (see TravelGrid.layered): `gone` changes too.
  const keep = (): [Uint8Array, Uint8Array, Uint16Array | undefined, Uint8Array | undefined] => [grid.covered.slice(), grid.rowEnds.slice(), grid.ahead?.slice(), grid.layered ? grid.gone?.slice() : undefined];
  const back = (k: ReturnType<typeof keep>) => {
    grid.covered.set(k[0]);
    grid.rowEnds.set(k[1]);
    if (k[2]) grid.ahead!.set(k[2]);
    if (k[3]) grid.gone!.set(k[3]);
  };
  const prints = new Map<Section, { under: number[]; ends: number[] }[]>();
  const cover = (s: Section) => {
    let fp = prints.get(s);
    if (!fp) prints.set(s, (fp = s.map((seg) => grid.footprint(f.at(seg.u0, f.v(seg.k)), f.at(seg.u1, f.v(seg.k)), f.half))));
    for (const p of fp) grid.apply(p);
  };
  const stepCost = (from: Pt, to: Pt) => {
    const d = dist(from, to);
    if (d <= 1 || grid.clear(from, to)) return d;
    const l = grid.length(from, to);
    return l != null && l < grid.way(d) ? l : grid.trimCost + d;
  };
  return { keep, back, cover, stepCost };
}

/**
 * Order of the sections on the travel grid: the next section is the one reached by the shortest
 * hidden way (under rows still to come), entered at the end that leaves a hidden way on, too; a
 * section only reached by a jump costs TRIM_COST. The grid is left as it was.
 */
function planOnGrid(f: Frame, secs: Section[], pull: number, start: Pt, grid: TravelGrid, last?: { s: Section; e: Entry }, end?: Pt): { order: { s: Section; e: Entry }[]; cost: number } {
  const { keep, back, cover, stepCost } = planning(f, grid);
  const kept = keep();
  type Cand = { i: number; e: Entry; d: number; c: number };
  // The `n` cheapest ways from `from` into the sections in `todo` (but `skip`): nearest first, as
  // no way is shorter than the straight line.
  const cheapest = (from: Pt, todo: Section[], n: number, skip = -1): Cand[] => {
    const all: Cand[] = [];
    todo.forEach((s, i) => {
      if (i !== skip) for (const e of entries(f, s, pull)) all.push({ i, e, d: dist(from, e.p), c: Infinity });
    });
    all.sort((x, y) => x.d - y.d);
    const best: Cand[] = [];
    for (const c of all.slice(0, TRIES)) {
      if (best.length >= n && c.d >= best[n - 1].c) break;
      c.c = stepCost(from, c.e.p);
      best.push(c);
      best.sort((x, y) => x.c - y.c);
    }
    return best.slice(0, n);
  };
  const todo = secs.filter((s) => s !== last?.s);
  const order: { s: Section; e: Entry }[] = [];
  let pos = start;
  let cost = 0;
  while (todo.length) {
    const cands = cheapest(pos, todo, LOOKAHEAD);
    let best = cands[0];
    if (cands.length > 1) {
      // One step further: where the section leaves the needle, and how hidden the way on is.
      let bs = Infinity;
      const saved = keep();
      for (const c of cands) {
        if (c.c >= bs) break;
        const s = todo[c.i];
        cover(s);
        const out = exitOf(f, s, c.e, pull);
        const next = todo.length > 1 ? cheapest(out, todo, 1, c.i)[0].c : last ? stepCost(out, last.e.p) : end ? endCost(out, end) : 0;
        if (c.c + next < bs) {
          bs = c.c + next;
          best = c;
        }
        back(saved);
      }
    }
    const s = todo.splice(best.i, 1)[0];
    order.push({ s, e: best.e });
    cost += best.c;
    cover(s);
    pos = exitOf(f, s, best.e, pull);
  }
  if (last) {
    cost += stepCost(pos, last.e.p);
    order.push(last);
    pos = exitOf(f, last.s, last.e, pull);
  }
  if (end) cost += endCost(pos, end);
  back(kept);
  return { order, cost };
}

/**
 * Up to this many sections, the order is searched more widely: BEAM plans side by side. On random
 * fills with parts left out, 8 plans for up to 8 sections left 16 trims in 72 fills, 16 for up to 16
 * left 8 (at about 150 ms a fill), 32 left 3 but took 250 ms: too slow for every edit.
 */
const BEAM_SECTIONS = 16;
const BEAM = 16;

/**
 * Order of a few sections on the travel grid (see planOnGrid), searched more widely: step by step
 * the BEAM cheapest plans so far each go on into every section left at each of its ends, and the
 * cheapest of them go on. With `end`, the way there counts too.
 */
function beamPlan(f: Frame, secs: Section[], pull: number, start: Pt, grid: TravelGrid, end?: Pt): { order: { s: Section; e: Entry }[]; cost: number } {
  const { keep, back, cover, stepCost } = planning(f, grid);
  type Plan = { order: { s: Section; e: Entry }[]; cost: number; pos: Pt; state: ReturnType<typeof keep> };
  const kept = keep();
  let beam: Plan[] = [{ order: [], cost: 0, pos: start, state: kept }];
  for (let depth = 0; depth < secs.length; depth++) {
    // Every way on, cheapest first by the straight line (no way is shorter); the actual cost is
    // worked out only while it may still get into the beam.
    const next: { from: Plan; s: Section; e: Entry; lb: number; cost: number }[] = [];
    const lastStep = depth === secs.length - 1;
    for (const b of beam) {
      for (const s of secs) {
        if (b.order.some((o) => o.s === s)) continue;
        for (const e of entries(f, s, pull)) {
          const tail = end && lastStep ? endCost(exitOf(f, s, e, pull), end) : 0;
          next.push({ from: b, s, e, lb: b.cost + dist(b.pos, e.p) + tail, cost: Infinity });
        }
      }
    }
    next.sort((x, y) => x.lb - y.lb);
    const costed: typeof next = [];
    let at: Plan | null = null;
    // Twice as many as go on are worked out, and those that leave sections out of hidden reach rank lower.
    const wide = 2 * BEAM;
    for (const n of next.slice(0, BEAM * TRIES)) {
      if (costed.length >= wide && n.lb >= costed[wide - 1].cost) break;
      if (at !== n.from) back((at = n.from).state);
      n.cost = n.lb + stepCost(n.from.pos, n.e.p) - dist(n.from.pos, n.e.p);
      costed.push(n);
      costed.sort((x, y) => x.cost - y.cost);
    }
    const plans = costed.slice(0, wide).map((n) => {
      back(n.from.state);
      cover(n.s);
      const order = [...n.from.order, { s: n.s, e: n.e }];
      const pos = exitOf(f, n.s, n.e, pull);
      // Sections left that no hidden way reaches any more will each need a trim.
      let stranded = 0;
      if (!lastStep) {
        const seen = grid.flood(pos);
        for (const o of secs) if (!order.some((x) => x.s === o) && !entries(f, o, pull).some((e) => grid.reaches(seen, e.p))) stranded++;
      }
      return { order, cost: n.cost, pos, state: keep(), rank: n.cost + grid.trimCost * stranded };
    });
    plans.sort((x, y) => x.rank - y.rank);
    // One plan for each set of sections sewn so far: the beam does not fill with one set in different orders.
    const sets = new Set<string>();
    beam = plans
      .filter((x) => {
        const key = x.order.map((o) => secs.indexOf(o.s)).sort((a, b) => a - b).join();
        return !sets.has(key) && !!sets.add(key);
      })
      .slice(0, BEAM);
  }
  back(kept);
  return { order: beam[0].order, cost: beam[0].cost };
}

/**
 * Sews the sections greedily nearest first, connected by travel paths or jumps. With `end`, the
 * section that leaves the needle nearest to it is sewn last, when that makes the ways in between
 * and on to `end` shorter. Where parts are left out (the grid knows them), the order and the ends
 * the sections are entered at are planned on the grid instead (beamPlan, planOnGrid).
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
  // Where parts are left out, the order and ends of the sections are planned on the grid, so travel
  // keeps under rows still to come (and the parts left out) rather than beside the outline.
  const smart = avoidSewn && !!grid.gone;
  if (smart) for (const s of secs) for (const seg of s) grid.expect(f.at(seg.u0, f.v(seg.k)), f.at(seg.u1, f.v(seg.k)), f.half);
  const planner = (l?: { s: Section; e: Entry }) => (smart ? planOnGrid(f, secs, pull, start, grid, l, end) : plan(f, secs, pull, start, l, end));
  let best = smart && secs.length <= BEAM_SECTIONS ? beamPlan(f, secs, pull, start, grid, end) : planner(undefined);
  if (end && secs.length && !(smart && secs.length <= BEAM_SECTIONS)) {
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
    const other = close && planner(close);
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
      if (path && pathLength(path) < grid.way(bd)) travel = f.onLines ? runStitch(f.onLines(path), TRAVEL_STITCH, LINE_TOLERANCE) : runStitch(path, TRAVEL_STITCH, TRAVEL_TOLERANCE);
    } else if (cur) travel = [pos, pts[0]];
    if (cur && travel) cur.push(...travel.slice(1), ...pts.slice(1));
    else {
      cur = pts;
      runs.push(cur);
    }
    for (const seg of s) grid.cover(f.at(seg.u0, f.v(seg.k)), f.at(seg.u1, f.v(seg.k)), f.half);
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
  const grid = new TravelGrid(p.travel ?? r, p.offRowEnds, p.whole ? { whole: p.whole, area: r } : undefined);
  const pos = p.underlay ? sewUnderlay(r, angle, p, start, grid, runs) : start;
  const under = pointCount(runs);
  sewAll(f, sections(r, r.sdf, f, top), p.stitch, p.pull, pos, grid, true, runs, p.end);
  return { runs, angle, under };
}

/** Crosshatch: the two layers cross at this angle each side of the fill angle (degrees), at right angles to each other. */
export const CROSSHATCH_HALF = 45;
/**
 * Crosshatch: the half width of the thread a sparse row covers for travel, in cells of the travel
 * grid: enough for its cells to join side by side at any angle, so travel can follow it.
 */
const CROSSHATCH_LANE = 0.8;
/** Crosshatch: travel along its net may take this many times the straight way (see TravelGrid.detour). */
const CROSSHATCH_DETOUR = 5;
/** Crosshatch: what a jump costs when planning (mm of travel); its locks show in a light fill. */
const CROSSHATCH_TRIM = 60;
/** Travel laid onto a line of thread is taken this far from a point to the line (mm). */
const ONTO_LINE = 0.45;
/** Travel along lines of thread keeps this close to them (mm): it hides under the thread. */
const LINE_TOLERANCE = 0.05;

/**
 * A travel path laid onto the rows of two crossing lattices (each row k at v = k * spacing): each
 * point near a row onto it, near two onto where they cross. Between two points not on one row the
 * path turns at crossings: from a row of one lattice straight onto a row of the other, or between
 * two rows of one lattice along the row of the other nearest its middle. A corner outside the
 * area `r` is left out. The grid finds the way only to its cells, and cuts corners near its ends.
 */
function ontoLines(frames: Frame[], r: Region): (path: Pt[]) => Pt[] {
  type On = { q: Pt; on: (number | null)[] };
  const cross = (k0: number, k1: number): Pt => {
    // q·n0 = k0·s0 and q·n1 = k1·s1.
    const [a, b] = frames;
    const det = a.n[0] * b.n[1] - a.n[1] * b.n[0];
    const va = k0 * a.spacing;
    const vb = k1 * b.spacing;
    return [(va * b.n[1] - vb * a.n[1]) / det, (a.n[0] * vb - b.n[0] * va) / det];
  };
  const rowsAt = (q: Pt, near: number) =>
    frames.map((f) => {
      const v = q[0] * f.n[0] + q[1] * f.n[1];
      const k = Math.round(v / f.spacing);
      return Math.abs(v - k * f.spacing) <= near ? k : null;
    });
  const inside = (q: Pt) => sample(r, r.sdf, q[0], q[1]) < 0;
  const snap = (q: Pt): On => {
    const on = rowsAt(q, ONTO_LINE);
    const i = on.findIndex((k) => k !== null);
    if (i < 0) return { q, on };
    const f = frames[i];
    const d = q[0] * f.n[0] + q[1] * f.n[1] - on[i]! * f.spacing;
    const at: Pt = on[0] !== null && on[1] !== null ? cross(on[0], on[1]) : [q[0] - d * f.n[0], q[1] - d * f.n[1]];
    // Near the outline a row may end before the point: it stays where the grid had it.
    return inside(at) ? { q: at, on } : { q, on: [null, null] };
  };
  // The ways round the corners between p and q, best first.
  const corners = (p: On, q: On): Pt[][] => {
    for (let i = 0; i < 2; i++) if (p.on[i] !== null && p.on[i] === q.on[i]) return [];
    const ways: Pt[][] = [];
    for (let i = 0; i < 2; i++) {
      const j = 1 - i;
      const pi = p.on[i];
      const qj = q.on[j];
      if (pi !== null && qj !== null) ways.push([i === 0 ? cross(pi, qj) : cross(qj, pi)]);
    }
    for (let i = 0; i < 2; i++) {
      const pi = p.on[i];
      const qi = q.on[i];
      if (pi === null || qi === null || pi === qi) continue;
      // Two rows of one lattice: across along the other's row nearest the middle.
      const f = frames[1 - i];
      const mid: Pt = [(p.q[0] + q.q[0]) / 2, (p.q[1] + q.q[1]) / 2];
      const m = Math.round((mid[0] * f.n[0] + mid[1] * f.n[1]) / f.spacing);
      ways.push(i === 0 ? [cross(pi, m), cross(qi, m)] : [cross(m, pi), cross(m, qi)]);
    }
    return ways;
  };
  return (path) => {
    // The ends are where rows start and end: they stay, on their row.
    const pts: On[] = path.map((q, i) => (i === 0 || i === path.length - 1 ? { q, on: rowsAt(q, 0.05) } : snap(q)));
    const out: Pt[] = [pts[0].q];
    for (let i = 1; i < pts.length; i++) {
      const c = corners(pts[i - 1], pts[i]).find((w) => w.every(inside));
      if (c) out.push(...c);
      out.push(pts[i].q);
    }
    return out;
  };
}

/**
 * Crosshatch (Kreuzschraffur): two sparse tatami layers, `p.spacing` apart each, at the fill angle
 * ±CROSSHATCH_HALF, the second sewn on the first; a light, lacy fill the fabric shows through, as
 * the cross hatch fills of commercial software. No underlay and no pull: what is sewn shows.
 *
 * Travel is what gives a sparse fill away: between the rows it shows. So a row only covers its
 * thread (Frame.lane), and travel keeps to lines thread lies on: rows still to come, of both
 * layers while the first is sewn, which hide it, and rows sewn already, which it only doubles
 * (TravelGrid.layered). The two layers cross, so their lines form a net that reaches everywhere,
 * and the way found on the grid is laid exactly onto it (ontoLines). Such a way may be longer than
 * usual before the thread jumps, as the locks of a trim show in a light fill. The second layer
 * starts where the way from the end of the first is cheapest, so near it.
 */
export function crosshatchFill(r: Region, p: FillParams, start: Pt): FillResult | null {
  const angle = p.angle ?? 0;
  const grid = new TravelGrid(p.travel ?? r, p.offRowEnds, p.whole ? { whole: p.whole, area: r } : undefined);
  grid.gone ??= new Uint8Array(grid.gw * grid.gh);
  // A jump in a light fill leaves two locks that show; travel along the net does not.
  grid.detour = CROSSHATCH_DETOUR;
  grid.trimCost = CROSSHATCH_TRIM;
  grid.layered = true;
  const lane = CROSSHATCH_LANE * grid.cell;
  const layers = [angle - CROSSHATCH_HALF, angle + CROSSHATCH_HALF].map((a) => {
    const f = new Frame(a, p.spacing, p.spacing, p.offset ?? 1 / STAGGERS);
    f.lane = lane;
    const top = rows(r, r.sdf, f, 0);
    return { f, secs: top.length ? sections(r, r.sdf, f, top) : [] };
  });
  if (!layers.some((l) => l.secs.length)) return null;
  const lines = (l: (typeof layers)[number], fn: (a: Pt, b: Pt) => void) => {
    for (const s of l.secs) for (const seg of s) fn(l.f.at(seg.u0, l.f.v(seg.k)), l.f.at(seg.u1, l.f.v(seg.k)));
  };
  const [one, two] = layers;
  one.f.onLines = two.f.onLines = ontoLines([one.f, two.f], r);
  // The first layer's travel may also hide under the second layer's rows (sewAll counts its own).
  lines(two, (a, b) => grid.expect(a, b, lane));
  const runs: Pt[][] = [];
  const pos = sewAll(one.f, one.secs, p.stitch, 0, start, grid, true, runs);
  // Its own rows still to come are counted anew (the first layer's are a way already, see layered).
  grid.ahead?.fill(0);
  sewAll(two.f, two.secs, p.stitch, 0, pos, grid, true, runs, p.end);
  return { runs, angle, under: 0 };
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
    const inner = area === r ? grid : new TravelGrid(area, grid.offRowEnds);
    for (const a of p.underCross ? [angle - 45, angle + 45] : [angle + 90]) {
      const uf = new Frame(a, us);
      const under = rows(area, area.sdf, uf, 0);
      if (under.length) pos = sewAll(uf, sections(area, area.sdf, uf, under), UNDERLAY_STITCH, 0, pos, inner, false, runs, undefined, inner === grid ? undefined : grid);
    }
  }
  grid.covered.fill(0);
  grid.rowEnds.fill(0);
  return pos;
}
