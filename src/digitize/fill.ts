import { core } from '../wasm/core';
import type { FillOut } from '../wasm/pkg/heatstitch_core';
import { fromCore, regionIn, sample, type Region } from './region';
import { simplify } from './run';
import type { Pt } from './skeleton';
import type { Motif, Texture } from './deco';

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
 * - Gap rows (`gapRows`): where two sections meet, the one sewn first runs on for a row or two into
 *   the other, under its rows to come, so stretchy fabric pulled apart in between shows no gap at
 *   the join (Wilcom's segment overlap rows, Ink/Stitch's gap fill rows).
 *
 * The fills are computed by the Rust core (core/src/digitize/fill.rs and the modules beside it). The
 * travel grid, which the model layer queries point by point, and small helpers stay here too.
 */

/** How rows turn at the edge: along the outline (see turn). */
export type RowEnds = 'edge';
export const ROW_ENDS: readonly RowEnds[] = ['edge'];

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
  /**
   * How the rows turn from one to the next at the edge (straight rows): straight across when not
   * set; 'edge' along the outline, so sparse rows draw a clean edge.
   */
  rowEnds?: RowEnds;
  /** An edge run (Kantenlauf) along the edge of the underlay before its rows (see sewEdgeRun). */
  underEdge?: boolean;
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
  /**
   * Fewer trims (Schnitte sparen): where no hidden way is left between rows, travel may run a few mm
   * along the outline beside sewn row ends (ROW_END_RUN) rather than trim. Off: it trims there.
   */
  saveTrims?: boolean;
  /** The whole area this one was cut from (parts left out under what lies on top): travel there is hidden. */
  whole?: Region;
  /** Curved rows keep this close to their line (mm); TOLERANCE by default. */
  tolerance?: number;
  /** Straight rows put their needle points on the lines of this motif (embossing, see deco.ts). */
  emboss?: { motif: Motif; size: number; strong?: boolean; angle?: number };
  /** Straight rows shift their needle points into a texture (see texturePoints in deco.ts), in place of `offset`. */
  texture?: { kind: Texture; size: number };
  /**
   * Wave rows (see Frame.wave): every row is the same wave, `height` mm from crest to middle and
   * `length` mm long, sewn in sections like straight rows. Not with emboss, texture or a gradient.
   */
  wave?: { height: number; length: number };
  /**
   * Rows that fade out across the shape (`out`, dense where the rows start) or in (`in`): the
   * density falls evenly to nearly nothing, so a second color fading the other way on the same
   * area makes a color blend as dense as one fill (see blend.ts in model).
   */
  fade?: 'out' | 'in';
  /**
   * Rows a section sews on into a touching section sewn later (gap rows, see sectionJoins); 0 or
   * unset sews none. Straight rows at an even spacing only.
   */
  gapRows?: number;
}

export interface FillResult {
  /** Continuous stitch runs; a jump lies between two runs. */
  runs: Pt[][];
  angle: number;
  /** The first this many points of `runs` are the underlay. */
  under?: number;
  /**
   * Travel between rows or sections along a way (not a straight step): first and last point
   * (indices into the points of `runs` in order), from the end of one row to the start of the next.
   */
  travel?: [number, number][];
}

/** Notes travel of `n` points about to be added to the last run of `runs` (see FillResult.travel). */
export function noteTravel(list: [number, number][], runs: Pt[][], n: number): void {
  const at = pointCount(runs) - 1;
  list.push([at, at + n - 1]);
}

export const UNDERLAY_INSET = 0.4;
export const TRAVEL_STITCH = 2.5;
/** Travel lies under the rows: it may cut its way's curves further than visible stitches (mm). */
export const TRAVEL_TOLERANCE = 0.4;
/** Travel may run on top of sewn rows for this long (mm); a longer way becomes a jump. */
const SEWN_CROSSING = 2;

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Most gap rows a section sews on into its neighbour. */
export const GAP_ROWS_MAX = 2;

/**
 * Turns up to this long (mm) share the hole of the row ends (see sewSection): the row ends left on
 * the edge then lie twice as far apart, at most 0.5 mm, which the thread (0.4 mm for 40 wt) still
 * closes. Rows further apart each reach the edge, or the fabric shows between them there (#346).
 */
export const SHARED_TURN = 0.25;

/**
 * Shortest stitch of a fill (mm) within its rows: a shorter one only sets the needle again beside
 * its last hole (rows cut short by a narrow tip, staggered points near a row's end), which punches
 * the fabric without adding to the look. Turns between rows are exempt: they are as long as the
 * rows lie apart, unless the rows lie so close that they share the hole there (SHARED_TURN).
 */
export const SHORTEST = 0.4;

/**
 * The needle points without stitches shorter than `min`: such a stitch is merged into the next
 * by leaving out its end. The first and last points stay.
 */
export function merged(pts: Pt[], min: number): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  // Slightly shorter still counts as the length: rows `min` apart turn in stitches of that length.
  const lim = min - 1e-3;
  for (let i = 1; i < pts.length - 1; i++) if (dist(out[out.length - 1], pts[i]) >= lim) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out.length > 1 && dist(out[out.length - 1], last) < lim) out.pop();
  out.push(last);
  return out;
}

/** How far past its ends a sewn row reaches the strip along the outline beside it (mm). */
const ROW_END_STRIP = 0.35;
/** How far travel may run along those strips (mm); crossing one takes a cell or two. */
const ROW_END_RUN = 4;
/** How far travel may show where rows to come are known (mm): crossing the strip at a row end (see FillParams.saveTrims). */
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
  /** How much longer than the straight way travel may be (times, plus `slack`); longer ways become jumps. */
  detour = 2;
  /** See detour (mm). */
  slack = 6;
  /**
   * Cells travel ran through already (see tread): another way there costs more, so ways that a
   * tour leads past one spot again and again (where its branches meet) spread out rather than
   * pile up thread under the rows.
   */
  trodden: Uint8Array | null = null;
  /** What a jump costs against travel when planning the order of sections (mm of travel). */
  trimCost = TRIM_COST;
  /** Where rows to come are known, travel may still run a few mm along row ends (see FillParams.saveTrims). */
  walks = false;

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
    return this.detour * d + this.slack;
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

  /** Marks the cells along a way travel took (see trodden). */
  tread(path: Pt[]): void {
    this.trodden ??= new Uint8Array(this.gw * this.gh);
    for (let i = 1; i < path.length; i++) this.stamp(path[i - 1], path[i], TREAD_HALF, (c) => (this.trodden![c] = 1));
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
    // Across the row no more than a cell apart, so sparse rows leave no stripes between them.
    const m = Math.max(2, Math.ceil((2 * halfWidth) / this.cell));
    const offs = Array.from({ length: m + 1 }, (_, i) => -halfWidth + (2 * halfWidth * i) / m);
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n;
      const y = a[1] + ((b[1] - a[1]) * k) / n;
      for (const o of offs) {
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
    const ok = (x: ReturnType<TravelGrid['walk']>) => !!x && x.onTop <= SEWN_CROSSING && x.alongEnds <= (this.ahead && (this.gone || !this.walks) ? BARE_RUN : ROW_END_RUN);
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
    return w && w.length + SHOWN_COST * w.onTop + (this.walks ? SHOWN_COST : EDGE_COST) * w.alongEnds;
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
        if (this.trodden?.[q]) w *= TRODDEN_COST;
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

/** What a step costs on a cell travel ran through already (times; see TravelGrid.trodden). */
const TRODDEN_COST = 3;
/** Half the width of the lane a way treads (mm). */
const TREAD_HALF = 0.4;

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

/** What a trim costs against travel when choosing the order of sections (mm of travel). */
const TRIM_COST = 25;
/** A search while planning looks at no more cells than this many times the longest way it may take. */
const SEARCH_SPREAD = 80;
/** What a millimetre of travel that shows costs when choosing the order of sections (mm of travel). */
const SHOWN_COST = 4;
/**
 * What a millimetre of travel along the outline beside sewn row ends costs (mm of travel): the eye
 * follows an edge, so a millimetre there costs about a trim. The order then sews parts that would
 * leave such a way (lobes, undercuts) first, from their far end, and travels on under rows to come.
 */
const EDGE_COST = 25;

export const pointCount = (runs: Pt[][]) => runs.reduce((a, r) => a + r.length, 0);

export function pathLength(p: Pt[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]);
  return l;
}

/** Crosshatch: the two layers cross at this angle each side of the fill angle (degrees), at right angles to each other. */
export const CROSSHATCH_HALF = 45;

/** Stitch length of the edge run (mm): short enough to follow curves, long enough not to perforate. */
export const EDGE_RUN_STITCH = 2;

/** The settings as the core takes them: without the regions (they cross on their own) and unset values. */
export function coreParams(p: object): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined && k !== 'underArea' && k !== 'travel' && k !== 'whole') o[k] = v;
  return o;
}

/** The regions in the settings, for a core call (none where they are the area itself). */
export const coreRegions = (r: Region, p: Pick<FillParams, 'underArea' | 'travel' | 'whole'>) =>
  [p.underArea && p.underArea !== r ? regionIn(p.underArea) : undefined, p.travel && p.travel !== r ? regionIn(p.travel) : undefined, p.whole ? regionIn(p.whole) : undefined] as const;

/** Runs from a flat x, y list and the point count of each. */
export function linesOf(pts: Float64Array, lens: Uint32Array): Pt[][] {
  const out: Pt[][] = [];
  let i = 0;
  for (const n of lens) {
    const l: Pt[] = new Array(n);
    for (let k = 0; k < n; k++, i++) l[k] = [pts[2 * i], pts[2 * i + 1]];
    out.push(l);
  }
  return out;
}

/** Points from a flat x, y list. */
export function ptsOf(flat: Float64Array): Pt[] {
  const out: Pt[] = new Array(flat.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = [flat[2 * i], flat[2 * i + 1]];
  return out;
}

/** A line as a flat x, y list. */
export function flatOf(line: Pt[]): Float64Array {
  const out = new Float64Array(2 * line.length);
  line.forEach((q, i) => {
    out[2 * i] = q[0];
    out[2 * i + 1] = q[1];
  });
  return out;
}

/** The fill the core made, as a FillResult (with `curved` for the fills along a field). */
export function fillOf(o: FillOut | undefined, curved = false): FillResult | null {
  if (!o) return null;
  const runs = linesOf(o.takePts(), o.takeLens());
  const t = o.takeTravel();
  const travel: [number, number][] = [];
  for (let i = 0; i + 1 < t.length; i += 2) travel.push([t[i], t[i + 1]]);
  const res: FillResult & { curved?: boolean } = { runs, angle: o.angle, under: o.under, travel };
  if (curved) res.curved = o.curved;
  o.free();
  return res;
}

/** Fill stitches for the region, starting near `start`. Null if no row fits into the region. */
export function fillRegion(r: Region, p: FillParams, start: Pt, neighbours: number[] = []): FillResult | null {
  return fillOf(core().fillRegion(regionIn(r), coreParams(p), start[0], start[1], Float64Array.from(neighbours), ...coreRegions(r, p)));
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
  return fillOf(core().crosshatchFill(regionIn(r), coreParams(p), start[0], start[1], ...coreRegions(r, p)));
}

/**
 * Fill angle with the fewest sections out of 16; ties prefer the diagonals, and angles within 30
 * degrees of touching regions sewn already count a little worse, so neighbours differ.
 */
export function chooseAngle(r: Region, spacing: number, neighbours: number[]): number {
  return core().chooseAngle(regionIn(r), spacing, Float64Array.from(neighbours));
}

/**
 * The area the underlay keeps to: the fill's area shrunk by the inset in mm, or by `share` of its
 * width where it is (without slivers too thin to sew). Null when nothing is left.
 */
export function underlayArea(r: Region, inset: number, share?: number): Region | null {
  const a = core().underlayArea(regionIn(r), inset, share);
  if (a === null) return null;
  if (a === true) return r;
  return fromCore(a, r.label, r.pxMm);
}
