import type { Region } from '../digitize/region';
import { regionOf } from '../shape/rasterize';
import { STITCH, type Pattern } from './pattern';

/**
 * Fills read from their rows. A fill is sewn back and forth: the needle runs along a row, turns
 * (sharply, or with a short step across) and runs back beside it. Rows that lie side by side at an
 * even distance are one patch of fill, whatever that distance is; its area is the strips between
 * neighbouring rows, and the distances from row to row tell an even fill from a gradient. Closing
 * the stitches into an area (traceRegion) only works for rows close together; this also reads
 * the open ones (gradients, light fills).
 */

type Pt = [number, number];

export interface Row {
  pts: Pt[];
  /** Length along the row (mm). */
  len: number;
  /** From its first to its last point, of length 1. */
  dir: Pt;
}

export interface RowPatch {
  rows: Row[];
  /** Distance of each row from the one before (mm); one fewer than rows. */
  gaps: number[];
}

/** A step across at a turn is at most this long (mm). */
const TURN = 2.2;
/** Rows shorter than this are steps at a turn, not rows (mm). */
const MIN_ROW = 1.6;
/** Neighbouring rows of a fill lie this far apart at least and at most (mm). */
const MIN_GAP = 0.12;
const MAX_GAP = 2;
/** Neighbouring gaps of one fill differ by this factor at most. */
const EVEN = 2.2;
/** Rows of a fill bow less than this (largest distance from their chord, by their length). */
const MAX_BOW = 0.14;
/** A patch has this many rows at least. */
const MIN_ROWS = 4;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const unit = (a: Pt, b: Pt): Pt => {
  const l = dist(a, b) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};

/** The stitch points from record a to b, as runs without a jump or trim between them (mm). */
function runsOf(p: Pattern, a: number, b: number): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] | null = null;
  for (let i = a; i <= b; i++) {
    if (p.cmd[i] !== STITCH) {
      run = null;
      continue;
    }
    if (!run || (i > a && p.cmd[i - 1] !== STITCH)) out.push((run = []));
    const q: Pt = [p.x[i] / 10, p.y[i] / 10];
    if (!run.length || dist(run[run.length - 1], q) >= 0.05) run.push(q);
  }
  return out;
}

/** A run of stitch points split where the needle turns back. */
export function rowsOf(pts: Pt[]): Row[] {
  const cuts = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = unit(pts[i - 1], pts[i]);
    const b = unit(pts[i], pts[i + 1]);
    if (dot(a, b) < -0.5) {
      cuts.push(i);
      continue;
    }
    // A short step across, then back the other way.
    if (i < pts.length - 2 && dist(pts[i], pts[i + 1]) < TURN && Math.abs(dot(a, b)) < 0.8 && dot(a, unit(pts[i + 1], pts[i + 2])) < -0.75) {
      cuts.push(i, i + 1);
      i++;
    }
  }
  cuts.push(pts.length - 1);
  const rows: Row[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    if (cuts[k + 1] <= cuts[k]) continue;
    const rp = pts.slice(cuts[k], cuts[k + 1] + 1);
    let len = 0;
    for (let j = 1; j < rp.length; j++) len += dist(rp[j - 1], rp[j]);
    rows.push({ pts: rp, len, dir: unit(rp[0], rp[rp.length - 1]) });
  }
  return rows;
}

function distToLine(q: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const vx = line[i][0] - ax;
    const vy = line[i][1] - ay;
    const t = Math.max(0, Math.min(1, ((q[0] - ax) * vx + (q[1] - ay) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(q[0] - ax - t * vx, q[1] - ay - t * vy));
  }
  return best;
}

const bowOf = (r: Row) => {
  const chord = [r.pts[0], r.pts[r.pts.length - 1]];
  let m = 0;
  for (const q of r.pts) m = Math.max(m, distToLine(q, chord));
  return m / (r.len || 1);
};

/**
 * How far row b lies from row a (median over b's points where both rows run side by side), and
 * how much of the shorter one lies beside the other.
 */
function besides(a: Row, b: Row): { gap: number; overlap: number } {
  const along = (r: Row) => r.pts.map((q) => dot(q, a.dir));
  const ua = along(a);
  const ub = along(b);
  const lo = Math.max(Math.min(...ua), Math.min(...ub));
  const hi = Math.min(Math.max(...ua), Math.max(...ub));
  const shorter = Math.min(Math.max(...ua) - Math.min(...ua), Math.max(...ub) - Math.min(...ub)) || 1;
  const ds: number[] = [];
  b.pts.forEach((q, k) => {
    if (ub[k] > lo && ub[k] < hi) ds.push(distToLine(q, a.pts));
  });
  if (!ds.length) for (const q of b.pts) ds.push(distToLine(q, a.pts));
  ds.sort((x, y) => x - y);
  return { gap: ds[Math.floor(ds.length / 2)], overlap: (hi - lo) / shorter };
}

/** The patches of fill among the stitches from record a to record b, in sewing order. */
export function rowPatches(p: Pattern, a: number, b: number): RowPatch[] {
  const out: RowPatch[] = [];
  for (const run of runsOf(p, a, b)) {
    const rows = rowsOf(run).filter((r) => r.len >= MIN_ROW);
    // gap[k]: row k runs back beside row k - 1 at this distance (0 when it does not).
    const gap = rows.map(() => 0);
    for (let k = 1; k < rows.length; k++) {
      const r0 = rows[k - 1];
      const r1 = rows[k];
      if (dot(r0.dir, r1.dir) > -0.5 || bowOf(r1) > MAX_BOW || (k === 1 && bowOf(r0) > MAX_BOW)) continue;
      const g = besides(r0, r1);
      if (g.gap >= MIN_GAP && g.gap <= MAX_GAP && g.overlap > 0.3 && Math.min(r0.len, r1.len) >= 3 * g.gap) gap[k] = g.gap;
    }
    // Rows of one fill lie at an even distance: a jump in it ends the patch.
    for (let k = 2; k < rows.length; k++) if (gap[k] && gap[k - 1] && (gap[k] > gap[k - 1] * EVEN || gap[k] * EVEN < gap[k - 1])) gap[k] = 0;
    for (let k = 0; k < rows.length; ) {
      let e = k;
      while (e + 1 < rows.length && gap[e + 1]) e++;
      if (e - k + 1 >= MIN_ROWS) out.push({ rows: rows.slice(k, e + 1), gaps: gap.slice(k + 1, e + 1) });
      k = e + 1;
    }
  }
  return out;
}

const median = (v: number[]) => {
  const s = v.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** The typical distance between the rows of a patch (mm). */
export const patchSpacing = (pt: RowPatch): number => median(pt.gaps);

/** The area of the patches: the strips between neighbouring rows, on a grid of `pxMm`. */
export function patchArea(patches: RowPatch[], pxMm: number): Region | null {
  const polys: Pt[][] = [];
  for (const pt of patches) for (let k = 1; k < pt.rows.length; k++) polys.push([...pt.rows[k - 1].pts, ...pt.rows[k].pts]);
  if (!polys.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pl of polys) {
    for (const [x, y] of pl) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const M = 6;
  const x0 = Math.floor(minX / pxMm) - M;
  const y0 = Math.floor(minY / pxMm) - M;
  const w = Math.ceil(maxX / pxMm) + M - x0;
  const h = Math.ceil(maxY / pxMm) + M - y0;
  const mask = new Uint8Array(w * h);
  // Each strip on its own (even-odd), so strips that overlap add up instead of cancelling.
  for (const pl of polys) {
    const q = pl.map(([x, y]) => [x / pxMm - x0 - 0.5, y / pxMm - y0 - 0.5]);
    let ylo = Infinity;
    let yhi = -Infinity;
    for (const [, y] of q) {
      ylo = Math.min(ylo, y);
      yhi = Math.max(yhi, y);
    }
    for (let y = Math.max(0, Math.ceil(ylo)); y <= Math.min(h - 1, Math.floor(yhi)); y++) {
      const xs: number[] = [];
      for (let i = 0; i < q.length; i++) {
        const [ax, ay] = q[i];
        const [bx, by] = q[(i + 1) % q.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((u, v) => u - v);
      for (let i = 0; i + 1 < xs.length; i += 2) mask.fill(1, y * w + Math.max(0, Math.ceil(xs[i])), y * w + Math.min(w - 1, Math.floor(xs[i + 1])) + 1);
    }
  }
  return regionOf(mask, x0, y0, w, h, pxMm);
}

/**
 * Spacing across a fill whose rows run at `angle` (degrees): where the rows start and where they
 * end, as the gradient fill has them (`spacing` on the side the frame of the rows starts from, see
 * Frame in digitize/fill.ts), or null when it does not change enough to be a gradient.
 */
export function gradientOf(patches: RowPatch[], angle: number): { spacing: number; spacingEnd: number } | null {
  // The largest patch decides; others of the same fill are pieces of it.
  const pt = patches.reduce<RowPatch | null>((best, x) => (!best || x.rows.length > best.rows.length ? x : best), null);
  if (!pt || pt.gaps.length < 6) return null;
  const q = Math.max(2, Math.floor(pt.gaps.length / 4));
  const first = median(pt.gaps.slice(0, q));
  const last = median(pt.gaps.slice(-q));
  if (Math.max(first, last) < Math.min(first, last) * GRADIENT) return null;
  // The rows' frame runs across them along n = (-sin, cos): the side with the smaller v is its start.
  const a = (angle * Math.PI) / 180;
  const v = (r: Row) => {
    const m = r.pts[Math.floor(r.pts.length / 2)];
    return -m[0] * Math.sin(a) + m[1] * Math.cos(a);
  };
  const forward = v(pt.rows[0]) <= v(pt.rows[pt.rows.length - 1]);
  const round = (x: number) => Math.round(x * 100) / 100;
  return forward ? { spacing: round(first), spacingEnd: round(last) } : { spacing: round(last), spacingEnd: round(first) };
}

/** Spacing changes by this factor at least across a gradient. */
const GRADIENT = 1.35;
