import type { Orientation } from '../image/orientation';
import { fillRegion, pathLength, sewUnderlay, TRAVEL_STITCH, TravelGrid, type FillParams, type FillResult } from './fill';
import { coverage, peakDensity } from './measure';
import { sample, type Region } from './region';
import { runStitch, simplify } from './run';
import type { Graph, Pt } from './skeleton';

/**
 * Fill whose stitch direction follows the image: fur, hair, petals, the strokes of a drawing.
 *
 * 1. Direction field: the structure tensor of the image (src/image/orientation.ts) where the image
 *    has structure, and the direction of the region's centerline where it is flat (a long shape is
 *    filled along its length), averaged as doubled angles and smoothed.
 * 2. Nearly the same direction everywhere: straight tatami rows in exactly that direction.
 * 3. Otherwise curved rows: evenly spaced streamlines of the field (Jobard & Lefer, "Creating
 *    evenly-spaced streamlines of arbitrary density", 1997). Each row is traced along the field
 *    (a line field: the direction keeps its sense from step to step, so turning points of the field
 *    need no care); new rows start one spacing beside existing ones, and a row ends where it comes
 *    closer than half a spacing to another, so rows neither pile up nor leave gaps wider than about
 *    1.5 spacings. Rows are sewn back and forth, each continuing at the nearest row end, with travel
 *    under unsewn rows between groups.
 * 4. The rows are measured before they are sewn: where they crowd (more than 2.2 times the nominal
 *    density) or leave gaps, the straight fill is used instead.
 */

export interface FlowResult extends FillResult {
  /** Rows follow a curved field (not straight). */
  curved: boolean;
}

/** Grid cell (mm); larger regions get coarser cells, so the grid stays near 45 000 cells. */
const CELL_MIN = 0.2;
const CELLS = 45000;
/** The field reaches this far outside the region, so rows end cleanly at its edge (mm). */
const MARGIN = 0.6;
/** Weight of the shape's own direction against pronounced image structure (about 1). */
const SHAPE_WEIGHT = 0.35;
/** The image's structure counts from this far inside the region (mm). */
const IMAGE_INSET = 1.2;
/** Smoothing of the field (mm). */
const SMOOTH_MM = 1.5;
/** Mean resultant length of the field above which rows stay straight. */
const UNIFORM = 0.93;
/** Below this mean field strength there is no direction to follow. */
const WEAK = 0.05;
/**
 * Curved rows denser than this many times the nominal 1 / spacing somewhere are not used (with
 * underlay that stays under the caution limit of the density check).
 */
const FLOW_PEAK = 2.2;
const FLOW_COVER = 0.95;
const STAGGERS = 4;

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

class Grid {
  cell: number;
  gw: number;
  gh: number;
  ox: number;
  oy: number;
  /** Cells of the field's domain (the region and a margin around it). */
  dom: Uint8Array;
  sdf: Float32Array;

  constructor(r: Region) {
    this.cell = Math.max(CELL_MIN, Math.sqrt((r.w * r.h * r.pxMm * r.pxMm) / CELLS));
    this.ox = r.x0 * r.pxMm;
    this.oy = r.y0 * r.pxMm;
    this.gw = Math.ceil((r.w * r.pxMm) / this.cell);
    this.gh = Math.ceil((r.h * r.pxMm) / this.cell);
    this.dom = new Uint8Array(this.gw * this.gh);
    this.sdf = new Float32Array(this.gw * this.gh);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const k = j * this.gw + i;
        this.sdf[k] = sample(r, r.sdf, ...this.center(i, j));
        if (this.sdf[k] < MARGIN) this.dom[k] = 1;
      }
    }
  }

  center(i: number, j: number): Pt {
    return [this.ox + (i + 0.5) * this.cell, this.oy + (j + 0.5) * this.cell];
  }

  index(p: Pt): number {
    const i = Math.floor((p[0] - this.ox) / this.cell);
    const j = Math.floor((p[1] - this.oy) / this.cell);
    return i < 0 || j < 0 || i >= this.gw || j >= this.gh ? -1 : j * this.gw + i;
  }
}

/** Box blur of a field over the domain only (three passes, about a Gaussian). */
function blurDomain(f: Float32Array, g: Grid, r: number): Float32Array {
  const { gw, gh, dom } = g;
  let v = Float32Array.from(f, (x, i) => (dom[i] ? x : 0));
  let wgt = Float32Array.from(dom);
  const pass = (a: Float32Array) => {
    const t = new Float32Array(a.length);
    const o = new Float32Array(a.length);
    for (let j = 0; j < gh; j++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += i >= 0 && i < gw ? a[j * gw + i] : 0;
      for (let i = 0; i < gw; i++) {
        t[j * gw + i] = acc;
        if (i + r + 1 < gw) acc += a[j * gw + i + r + 1];
        if (i - r >= 0) acc -= a[j * gw + i - r];
      }
    }
    for (let i = 0; i < gw; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += j >= 0 && j < gh ? t[j * gw + i] : 0;
      for (let j = 0; j < gh; j++) {
        o[j * gw + i] = acc;
        if (j + r + 1 < gh) acc += t[(j + r + 1) * gw + i];
        if (j - r >= 0) acc -= t[(j - r) * gw + i];
      }
    }
    return o;
  };
  for (let p = 0; p < 3; p++) {
    v = pass(v);
    wgt = pass(wgt);
  }
  return v.map((x, i) => (wgt[i] > 0 ? x / wgt[i] : 0));
}

/** Direction field as doubled-angle vectors (c, s) per cell. */
function field(r: Region, g: Grid, graph: Graph | null, orient: Orientation): { c: Float32Array; s: Float32Array } {
  const n = g.gw * g.gh;
  const c = new Float32Array(n);
  const s = new Float32Array(n);
  // The image's structure inside the region. Near its edge the tensor sees the region's own
  // outline, which is not structure to follow (the shape's direction below covers the shape), so
  // it counts only from IMAGE_INSET inside, fully a millimetre further in.
  for (let j = 0; j < g.gh; j++) {
    for (let i = 0; i < g.gw; i++) {
      const k = j * g.gw + i;
      const w = Math.min(1, Math.max(0, -g.sdf[k] - IMAGE_INSET));
      if (!g.dom[k] || w <= 0) continue;
      const [x, y] = g.center(i, j);
      const px = Math.min(orient.width - 1, Math.max(0, Math.floor(x / r.pxMm)));
      const py = Math.min(orient.height - 1, Math.max(0, Math.floor(y / r.pxMm)));
      c[k] = w * orient.c[py * orient.width + px];
      s[k] = w * orient.s[py * orient.width + px];
    }
  }
  // The shape's direction: the tangent of the nearest centerline, spread out from it.
  if (graph?.branches.length) {
    const sc = new Float32Array(n);
    const ss = new Float32Array(n);
    const seen = new Uint8Array(n);
    let queue: number[] = [];
    for (const b of graph.branches) {
      // Only a branch that is long against its width says which way the shape runs: none for a
      // compact shape, fully from three widths on.
      const width = 2 * (b.r.reduce((x, y) => x + y, 0) / b.r.length);
      const wgt = Math.min(1, Math.max(0, (pathLength(b.pts) / Math.max(width, 1e-6) - 1) / 2));
      if (wgt <= 0) continue;
      for (let q = 0; q < b.pts.length; q++) {
        const a = b.pts[Math.max(0, q - 3)];
        const e = b.pts[Math.min(b.pts.length - 1, q + 3)];
        const t = Math.atan2(e[1] - a[1], e[0] - a[0]);
        const k = g.index(b.pts[q]);
        if (k < 0 || !g.dom[k] || seen[k]) continue;
        seen[k] = 1;
        sc[k] = wgt * Math.cos(2 * t);
        ss[k] = wgt * Math.sin(2 * t);
        queue.push(k);
      }
    }
    while (queue.length) {
      const next: number[] = [];
      for (const k of queue) {
        const i = k % g.gw;
        for (const q of [i > 0 ? k - 1 : -1, i < g.gw - 1 ? k + 1 : -1, k - g.gw, k + g.gw]) {
          if (q < 0 || q >= n || seen[q] || !g.dom[q]) continue;
          seen[q] = 1;
          sc[q] = sc[k];
          ss[q] = ss[k];
          next.push(q);
        }
      }
      queue = next;
    }
    for (let k = 0; k < n; k++) {
      c[k] += SHAPE_WEIGHT * sc[k];
      s[k] += SHAPE_WEIGHT * ss[k];
    }
  }
  const rad = Math.max(1, Math.round(SMOOTH_MM / g.cell / 1.7));
  return { c: blurDomain(c, g, rad), s: blurDomain(s, g, rad) };
}

/** Unit direction of the field at p (bilinear in the doubled angles), or null where it has none. */
function directionAt(g: Grid, c: Float32Array, s: Float32Array, p: Pt): Pt | null {
  const fx = (p[0] - g.ox) / g.cell - 0.5;
  const fy = (p[1] - g.oy) / g.cell - 0.5;
  const i = Math.max(0, Math.min(g.gw - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(g.gh - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - i));
  const ty = Math.max(0, Math.min(1, fy - j));
  const k = j * g.gw + i;
  const lerp2 = (f: Float32Array) =>
    (f[k] * (1 - tx) + f[k + 1] * tx) * (1 - ty) + (f[k + g.gw] * (1 - tx) + f[k + g.gw + 1] * tx) * ty;
  const cc = lerp2(c);
  const ss = lerp2(s);
  if (Math.hypot(cc, ss) < 1e-6) return null;
  const t = Math.atan2(ss, cc) / 2;
  return [Math.cos(t), Math.sin(t)];
}

/** Points of committed rows in buckets, for the distance tests. */
class Occupancy {
  private buckets = new Map<number, Pt[]>();
  constructor(private size: number) {}
  private key(x: number, y: number): number {
    return Math.floor(x / this.size) * 1000003 + Math.floor(y / this.size);
  }
  add(p: Pt): void {
    const k = this.key(p[0], p[1]);
    const l = this.buckets.get(k);
    if (l) l.push(p);
    else this.buckets.set(k, [p]);
  }
  /** Whether a point lies within d (at most the bucket size) of p. */
  near(p: Pt, d: number): boolean {
    const bx = Math.floor(p[0] / this.size);
    const by = Math.floor(p[1] / this.size);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const q of this.buckets.get((bx + dx) * 1000003 + by + dy) ?? []) if (dist(p, q) < d) return true;
      }
    }
    return false;
  }
}

/** Integration step along a row (mm). */
const STEP = 0.1;
/** Below this length a traced row is not kept (mm). */
const MIN_ROW = 1;

/**
 * Evenly spaced streamlines of the field over the region, one row spacing apart (see above).
 */
function streamlines(r: Region, g: Grid, c: Float32Array, s: Float32Array, spacing: number): Pt[][] {
  const dSep = spacing;
  const dTest = 0.5 * spacing;
  const occ = new Occupancy(dSep);
  const inside = (p: Pt) => sample(r, r.sdf, p[0], p[1]) < 0;
  const maxSteps = Math.ceil((4 * Math.hypot(r.w, r.h) * r.pxMm) / STEP);

  /** One direction from the seed; own points count once they are three spacings behind. */
  const trace = (seed: Pt, d0: Pt): Pt[] => {
    const pts: Pt[] = [seed];
    const own = new Occupancy(dSep);
    const lag = Math.ceil((3 * spacing) / STEP);
    let p = seed;
    let prev = d0;
    for (let n = 0; n < maxSteps; n++) {
      let d = directionAt(g, c, s, p) ?? prev;
      if (d[0] * prev[0] + d[1] * prev[1] < 0) d = [-d[0], -d[1]];
      const mid: Pt = [p[0] + (d[0] * STEP) / 2, p[1] + (d[1] * STEP) / 2];
      let d2 = directionAt(g, c, s, mid) ?? d;
      if (d2[0] * d[0] + d2[1] * d[1] < 0) d2 = [-d2[0], -d2[1]];
      const q: Pt = [p[0] + d2[0] * STEP, p[1] + d2[1] * STEP];
      const fq = sample(r, r.sdf, q[0], q[1]);
      if (fq >= 0) {
        // Ends at the edge of the region, at the crossing.
        const fp = sample(r, r.sdf, p[0], p[1]);
        const t = fp / (fp - fq);
        pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        break;
      }
      if (occ.near(q, dTest) || own.near(q, dTest)) break;
      pts.push(q);
      if (pts.length > lag) own.add(pts[pts.length - 1 - lag]);
      p = q;
      prev = d2;
    }
    return pts;
  };

  const lines: Pt[][] = [];
  const commit = (line: Pt[]) => {
    lines.push(line);
    for (const p of line) occ.add(p);
  };
  /** The row through a seed, traced both ways; null if too short. */
  const through = (seed: Pt): Pt[] | null => {
    if (!inside(seed) || occ.near(seed, dSep * 0.99)) return null;
    const d = directionAt(g, c, s, seed) ?? [1, 0];
    const fwd = trace(seed, d);
    const back = trace(seed, [-d[0], -d[1]]);
    const line = [...back.reverse(), ...fwd.slice(1)];
    return pathLength(line) >= MIN_ROW ? line : null;
  };
  const grow = (queue: Pt[][]) => {
    while (queue.length) {
      const line = queue.shift()!;
      let acc = 0;
      for (let i = 1; i < line.length; i++) {
        acc += dist(line[i - 1], line[i]);
        if (acc < dSep / 2) continue;
        acc = 0;
        const a = line[Math.max(0, i - 2)];
        const b = line[Math.min(line.length - 1, i + 2)];
        const l = dist(a, b) || 1;
        const nrm: Pt = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
        for (const side of [1, -1]) {
          const seed: Pt = [line[i][0] + nrm[0] * dSep * side, line[i][1] + nrm[1] * dSep * side];
          const next = through(seed);
          if (next) {
            commit(next);
            queue.push(next);
          }
        }
      }
    }
  };
  // Start at the deepest point, then fill whatever the rows did not reach (other lobes of the shape).
  let deepest = 0;
  for (let i = 1; i < r.inside.length; i++) if (r.inside[i] > r.inside[deepest]) deepest = i;
  const first = through([(deepest % r.w + r.x0 + 0.5) * r.pxMm, (Math.floor(deepest / r.w) + r.y0 + 0.5) * r.pxMm]);
  if (first) {
    commit(first);
    grow([first]);
  }
  for (let j = 0; j < g.gh; j++) {
    for (let i = 0; i < g.gw; i++) {
      if (g.sdf[j * g.gw + i] > -spacing / 2) continue;
      const line = through(g.center(i, j));
      if (!line) continue;
      commit(line);
      grow([line]);
    }
  }
  return lines;
}

interface Piece {
  /** Position in sewing order, for the stagger. */
  k: number;
  pts: Pt[];
}

/** Lengthens a row at both ends along its direction (pull compensation). */
function lengthen(pts: Pt[], d: number): Pt[] {
  if (d <= 0 || pts.length < 2) return pts;
  const ext = (a: Pt, b: Pt): Pt => {
    const l = dist(a, b) || 1;
    return [a[0] + ((a[0] - b[0]) / l) * d, a[1] + ((a[1] - b[1]) / l) * d];
  };
  return [ext(pts[0], pts[Math.min(2, pts.length - 1)]), ...pts.slice(1, -1), ext(pts[pts.length - 1], pts[Math.max(0, pts.length - 3)])];
}

/**
 * Stitches along a row: needle points every `len` of arc length, shifted by a quarter stitch from
 * level to level (stagger). Where the row bends between two of them by more than 0.15 mm, a
 * straight stitch would cut the curve, so that stretch gets shorter stitches.
 */
function rowStitches(p: Piece, len: number): Pt[] {
  const pts = p.pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const at = (s: number): Pt => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const phase = ((((p.k % STAGGERS) + STAGGERS) % STAGGERS) / STAGGERS) * len;
  const margin = Math.min(0.6, len / 4);
  const marks = [0];
  for (let s = phase; s < total - margin; s += len) if (s >= margin) marks.push(s);
  marks.push(total);
  const out: Pt[] = [pts[0]];
  for (let m = 1; m < marks.length; m++) {
    const s0 = marks[m - 1];
    const s1 = marks[m];
    const a = at(s0);
    const b = at(s1);
    const l = dist(a, b) || 1;
    let bend = 0;
    for (let i = 0; i < pts.length; i++) {
      if (cum[i] <= s0 || cum[i] >= s1) continue;
      bend = Math.max(bend, Math.abs((pts[i][0] - a[0]) * (b[1] - a[1]) - (pts[i][1] - a[1]) * (b[0] - a[0])) / l);
    }
    const parts = bend > 0.15 ? Math.ceil((s1 - s0) / (len / 2)) : 1;
    for (let q = 1; q <= parts; q++) out.push(at(s0 + ((s1 - s0) * q) / parts));
  }
  return out;
}

/**
 * Fill following the image's direction; null when the region has no direction to follow (the
 * caller fills it straight at the usual angle) or curved rows fail the checks.
 */
export function flowFill(r: Region, graph: Graph | null, orient: Orientation, p: FillParams, start: Pt): FlowResult | null {
  const g = new Grid(r);
  const { c, s } = field(r, g, graph, orient);
  let sc = 0;
  let ss = 0;
  let sm = 0;
  let cells = 0;
  for (let k = 0; k < c.length; k++) {
    if (!g.dom[k] || g.sdf[k] >= 0) continue;
    sc += c[k];
    ss += s[k];
    sm += Math.hypot(c[k], s[k]);
    cells++;
  }
  if (!cells || sm / cells < WEAK) return null;
  const mean = (Math.atan2(ss, sc) / 2) * (180 / Math.PI);
  if (Math.hypot(sc, ss) / sm > UNIFORM) {
    const res = fillRegion(r, { ...p, angle: mean }, start);
    return res && { ...res, curved: false };
  }

  // Curved rows.
  const rows = streamlines(r, g, c, s, p.spacing).map((line) => lengthen(simplify(line, 0.02), p.pull));
  if (!rows.length) return null;
  // The rows must not crowd or leave gaps; checked before anything is sewn.
  if (peakDensity(rows) > FLOW_PEAK / p.spacing || coverage(r, rows, p.spacing * 0.75) < FLOW_COVER) return null;

  const runs: Pt[][] = [];
  const grid = new TravelGrid(r);
  let pos = p.underlay ? sewUnderlay(r, mean + 90, p.spacing, start, grid, runs) : start;
  let cur: Pt[] | null = runs.length ? runs[runs.length - 1] : null;
  const todo = rows.slice();
  const reach = 2.5 * p.spacing + 0.3;
  let count = 0;
  /** Takes row i out of the list, oriented to start at the given end. */
  const take = (i: number, fromEnd: boolean): Pt[] => {
    const row = todo.splice(i, 1)[0];
    return fromEnd ? row.slice().reverse() : row;
  };
  while (todo.length) {
    // The nearest row end, then row after row while the next one starts close by.
    let bi = 0;
    let rev = false;
    let bd = Infinity;
    todo.forEach((row, i) => {
      for (const end of [false, true]) {
        const d = dist(pos, end ? row[row.length - 1] : row[0]);
        if (d < bd) {
          bd = d;
          bi = i;
          rev = end;
        }
      }
    });
    const group: Pt[][] = [take(bi, rev)];
    for (;;) {
      const last = group[group.length - 1];
      const e = last[last.length - 1];
      let ni = -1;
      let nrev = false;
      let nd = reach;
      todo.forEach((row, i) => {
        for (const end of [false, true]) {
          const q = end ? row[row.length - 1] : row[0];
          const d = dist(e, q);
          if (d >= nd) continue;
          const mid: Pt = [(e[0] + q[0]) / 2, (e[1] + q[1]) / 2];
          if (sample(r, r.sdf, mid[0], mid[1]) >= p.spacing / 2) continue;
          nd = d;
          ni = i;
          nrev = end;
        }
      });
      if (ni < 0) break;
      group.push(take(ni, nrev));
    }
    const pts: Pt[] = [];
    for (const row of group) pts.push(...rowStitches({ k: count++, pts: row }, p.stitch));
    let travel: Pt[] | null = null;
    if (cur && bd > 1) {
      const path = grid.path(pos, pts[0], true);
      if (path && pathLength(path) < 2 * bd + 6) travel = runStitch(path, TRAVEL_STITCH);
    } else if (cur) travel = [pos, pts[0]];
    if (cur && travel) cur.push(...travel.slice(1), ...pts.slice(1));
    else {
      cur = pts;
      runs.push(cur);
    }
    for (const row of group) for (let i = 1; i < row.length; i++) grid.cover(row[i - 1], row[i], p.spacing / 2);
    pos = pts[pts.length - 1];
  }

  return { runs, angle: mean, curved: true };
}
