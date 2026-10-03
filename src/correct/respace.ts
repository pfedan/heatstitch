import { computeBounds, STITCH, type Pattern } from '../model/pattern';
import { tidy } from '../model/edit';
import { satinMask } from '../validation/satin';
import { stitchRuns } from './structure';
import { turningPoints } from './thin';

/**
 * Re-spaces fill rows evenly at a wider spacing.
 *
 * Lowering the density of a fill is a matter of row spacing: a fill at 0.4 mm has 2.5 mm thread per
 * mm², at 0.5 mm 2.0. Dropping single rows (what the first version did) leaves stripes of double
 * spacing that show on the fabric. Instead the sweep is rebuilt: the row ends of the original are
 * the outline of the shape on either side, new rows are laid between them at even spacing, and the
 * stitches inside each row follow the stitch length and stagger of the original rows. The first and
 * last stitch stay where they are, so the sweep connects to the rest of the design as before.
 */

/** Shortest pass that counts as a row (0.1 mm). */
const ROW_MIN = 10;
/** Longest connector between two rows (0.1 mm). */
const CONNECTOR_MAX = 25;
/** Rows of a sweep are at most this far apart (0.1 mm). */
const SPACING_MAX = 10;
const ANTI_COS = -0.9;
/** A sweep needs this many rows to be rebuilt. */
const MIN_ROWS = 6;
/** Re-spacing by less than this factor is not worth it. */
const MIN_GAIN = 1.05;
/** Sweeps with shorter rows (median, 0.1 mm) are narrow details and keep their spacing. */
const MIN_WIDTH = 30;

interface Row {
  /** Record indices of the row's first and last stitch. */
  a: number;
  b: number;
}

export interface Sweep {
  rows: Row[];
}

const dist = (p: Pattern, a: number, b: number) => Math.hypot(p.x[b] - p.x[a], p.y[b] - p.y[a]);

/** Fill sweeps of one run: sequences of antiparallel rows, directly joined or via a short connector. */
export function fillSweeps(p: Pattern, start: number, end: number, mask: Uint8Array): Sweep[] {
  const t = turningPoints(p, start, end);
  const sweeps: Sweep[] = [];
  const isRow = (k: number) => {
    if (k + 1 >= t.length || dist(p, t[k], t[k + 1]) < ROW_MIN) return false;
    for (let i = t[k] + 1; i <= t[k + 1]; i++) if (!mask[i]) return true;
    return false;
  };
  const unit = (r: Row) => {
    const l = dist(p, r.a, r.b) || 1;
    return [(p.x[r.b] - p.x[r.a]) / l, (p.y[r.b] - p.y[r.a]) / l];
  };
  const follows = (r: Row, s: Row) => {
    const u = unit(r);
    const w = unit(s);
    if (u[0] * w[0] + u[1] * w[1] > ANTI_COS) return false;
    // Offset of the next row's middle from this row's line. Row ends are unreliable: where the
    // connector is too short to register as a turn, a row starts on the previous row's end.
    const mx = (p.x[s.a] + p.x[s.b]) / 2 - p.x[r.a];
    const my = (p.y[s.a] + p.y[s.b]) / 2 - p.y[r.a];
    const off = Math.abs(mx * u[1] - my * u[0]);
    return off > 0 && off <= SPACING_MAX;
  };
  let cur: Row[] = [];
  const flush = () => {
    if (cur.length >= MIN_ROWS) sweeps.push({ rows: cur });
    cur = [];
  };
  let k = 0;
  while (k + 1 < t.length) {
    if (!isRow(k)) {
      flush();
      k++;
      continue;
    }
    const row = { a: t[k], b: t[k + 1] };
    if (cur.length && !follows(cur[cur.length - 1], row)) flush();
    cur.push(row);
    // Next row: directly, or after one short connector.
    if (isRow(k + 1)) k += 1;
    else if (k + 2 < t.length && dist(p, t[k + 1], t[k + 2]) <= CONNECTOR_MAX && isRow(k + 2)) k += 2;
    else {
      flush();
      k += 1;
    }
  }
  flush();
  return sweeps;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Linear interpolation along a chain of (v, x, y) points sorted by v. */
function along(chain: [number, number, number][], v: number): [number, number] {
  if (v <= chain[0][0]) return [chain[0][1], chain[0][2]];
  for (let i = 1; i < chain.length; i++) {
    if (v <= chain[i][0]) {
      const [v0, x0, y0] = chain[i - 1];
      const [v1, x1, y1] = chain[i];
      const f = v1 > v0 ? (v - v0) / (v1 - v0) : 0;
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
    }
  }
  const l = chain[chain.length - 1];
  return [l[1], l[2]];
}

/**
 * New stitch points replacing records rows[0].a .. rows[last].b, with the row spacing widened so
 * the density drops by `need` (0 to 1) but stays at most `maxSpacing` (0.1 mm). Null when the sweep
 * is not regular enough to rebuild or the gain would be too small.
 */
export function rebuildSweep(
  p: Pattern,
  sw: Sweep,
  need: number,
  maxSpacing: number,
): { points: [number, number][]; before: number; after: number } | null {
  const rows = sw.rows;
  const r0 = rows[0];
  if (median(rows.map((r) => dist(p, r.a, r.b))) < MIN_WIDTH) return null;
  // Row direction from the longest row; short rows near tips are dominated by their ends.
  const ref = rows.reduce((best, r) => (dist(p, r.a, r.b) > dist(p, best.a, best.b) ? r : best));
  const l0 = dist(p, ref.a, ref.b);
  const ux = (p.x[ref.b] - p.x[ref.a]) / l0;
  const uy = (p.y[ref.b] - p.y[ref.a]) / l0;
  const nx = -uy;
  const ny = ux;
  const U = (i: number) => p.x[i] * ux + p.y[i] * uy;
  const V = (i: number) => p.x[i] * nx + p.y[i] * ny;
  // Each row's offset is the median over its stitches: the inner stitches lie exactly on the row,
  // an end can belong to an absorbed connector.
  const vs = rows.map((r) => {
    const v: number[] = [];
    for (let i = Math.min(r.a, r.b); i <= Math.max(r.a, r.b); i++) v.push(V(i));
    return v.length > 2 ? median(v) : (V(r.a) + V(r.b)) / 2;
  });
  const sign = Math.sign(vs[vs.length - 1] - vs[0]);
  if (!sign) return null;
  const gaps: number[] = [];
  for (let j = 1; j < vs.length; j++) {
    const g = (vs[j] - vs[j - 1]) * sign;
    if (g <= 0) return null;
    gaps.push(g);
  }
  const s = median(gaps);
  const spacing = Math.min(maxSpacing, s / Math.max(0.05, 1 - need));
  if (spacing < s * MIN_GAIN) return null;
  if (gaps.some((g) => g > 2 * s)) return null; // already uneven: leave it

  // Outline chains: row ends on the low-u and on the high-u side, sorted by v.
  const low: [number, number, number][] = [];
  const high: [number, number, number][] = [];
  const lens: number[] = [];
  const ends: number[] = [];
  for (const r of rows) {
    const [lo, hi] = U(r.a) < U(r.b) ? [r.a, r.b] : [r.b, r.a];
    low.push([V(lo) * sign, p.x[lo], p.y[lo]]);
    high.push([V(hi) * sign, p.x[hi], p.y[hi]]);
    const step = r.b > r.a ? 1 : -1;
    for (let i = r.a + step; i !== r.b + step; i += step) lens.push(dist(p, i - step, i));
    if (Math.abs(r.b - r.a) > 1) ends.push(dist(p, r.a, r.a + step), dist(p, r.b, r.b - step));
  }
  low.sort((a, b) => a[0] - b[0]);
  high.sort((a, b) => a[0] - b[0]);
  const interior = lens.filter((l) => l > 0);
  const L = Math.max(...interior) > 15 ? median(interior.filter((l) => l > 15)) : 0; // row stitch length
  const gapEnd = Math.min(15, Math.max(3, median(ends) * 0.5 || 5));

  const m = rows.length - 1;
  const vFirst = V(r0.a) * sign;
  const last = rows[m];
  const vLast = V(last.b) * sign;
  let M = Math.round((vLast - vFirst) / spacing);
  if ((M - m) % 2) M += M + 1 <= m ? 1 : -1; // same parity: the last row ends on the same side
  if (M >= m || M < 2) return null;

  const points: [number, number][] = [];
  for (let k = 0; k <= M; k++) {
    const v = vFirst + ((vLast - vFirst) * k) / M;
    const orig = rows[Math.min(k, m)];
    const fwd = U(orig.b) > U(orig.a); // same direction as the original row k
    const a = k === 0 ? [p.x[r0.a], p.y[r0.a]] : along(fwd ? low : high, v);
    const b = k === M ? [p.x[last.b], p.y[last.b]] : along(fwd ? high : low, v);
    points.push([a[0], a[1]]);
    if (L) {
      // Stagger of the original row k: u position of its first inner stitch, modulo L.
      const step = orig.b > orig.a ? 1 : -1;
      const phase = Math.abs(orig.b - orig.a) > 1 ? ((U(orig.a + step) % L) + L) % L : 0;
      const ua = a[0] * ux + a[1] * uy;
      const ub = b[0] * ux + b[1] * uy;
      const lo = Math.min(ua, ub) + gapEnd;
      const hi = Math.max(ua, ub) - gapEnd;
      const inner: number[] = [];
      for (let u = Math.ceil((lo - phase) / L) * L + phase; u < hi; u += L) inner.push(u);
      if (ua > ub) inner.reverse();
      for (const u of inner) {
        const f = (u - ua) / (ub - ua);
        points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      }
    }
    points.push([b[0], b[1]]);
  }
  return { points, before: s, after: (vLast - vFirst) / M };
}

export interface RespaceOptions {
  /** Share (0 to 1) by which the density around record i should drop; 0 where nothing should change. */
  needAt: (i: number) => number;
  /** Widest row spacing allowed (0.1 mm), from the material's recommended range. */
  maxSpacing: number;
  /** Share of a sweep's rows that must be asked to change before the whole sweep is re-spaced. */
  minShare?: number;
}

export interface RespaceResult {
  pattern: Pattern;
  sweeps: number;
  /** Rows removed in total (the remaining rows are spread evenly). */
  rows: number;
}

export function respaceFills(p: Pattern, opts: RespaceOptions): RespaceResult {
  const mask = satinMask(p);
  const edits: { from: number; to: number; points: [number, number][]; removed: number }[] = [];
  for (const r of stitchRuns(p)) {
    if (r.end - r.start < 8) continue;
    for (const sw of fillSweeps(p, r.start, r.end, mask)) {
      let asked = 0;
      let need = 0;
      for (const row of sw.rows) {
        const n = Math.max(opts.needAt(row.a), opts.needAt(row.b));
        if (n > 0) {
          asked++;
          need += n;
        }
      }
      if (!asked || asked < (opts.minShare ?? 0.25) * sw.rows.length) continue;
      const rebuilt = rebuildSweep(p, sw, need / asked, opts.maxSpacing);
      if (!rebuilt) continue;
      const removed = sw.rows.length - 1 - Math.round(((sw.rows.length - 1) * rebuilt.before) / rebuilt.after);
      edits.push({ from: sw.rows[0].a, to: sw.rows[sw.rows.length - 1].b, points: rebuilt.points, removed: Math.max(0, removed) });
    }
  }
  if (!edits.length) return { pattern: p, sweeps: 0, rows: 0 };
  return { pattern: splice(p, edits), sweeps: edits.length, rows: edits.reduce((a, e) => a + e.removed, 0) };
}

/** Replaces record ranges [from, to] by new stitch points; ranges must not overlap. */
function splice(p: Pattern, edits: { from: number; to: number; points: [number, number][] }[]): Pattern {
  edits.sort((a, b) => a.from - b.from);
  const xs: number[] = [];
  const ys: number[] = [];
  const cs: number[] = [];
  let i = 0;
  for (const e of edits) {
    for (; i < e.from; i++) {
      xs.push(p.x[i]);
      ys.push(p.y[i]);
      cs.push(p.cmd[i]);
    }
    for (const [x, y] of e.points) {
      xs.push(Math.round(x));
      ys.push(Math.round(y));
      cs.push(STITCH);
    }
    i = e.to + 1;
  }
  for (; i < p.cmd.length; i++) {
    xs.push(p.x[i]);
    ys.push(p.y[i]);
    cs.push(p.cmd[i]);
  }
  const x = Int32Array.from(xs);
  const y = Int32Array.from(ys);
  const cmd = Uint8Array.from(cs);
  return tidy({ ...p, x, y, cmd, bounds: computeBounds(x, y, cmd) });
}

/** Resamples a polyline at `n` points evenly spaced by arc length (first and last kept). */
function resample(pts: [number, number][], n: number): [number, number][] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const out: [number, number][] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = n > 1 ? (total * k) / (n - 1) : 0;
    while (j < pts.length - 1 && cum[j] < s) j++;
    const f = cum[j] > cum[j - 1] ? (s - cum[j - 1]) / (cum[j] - cum[j - 1]) : 0;
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f]);
  }
  return out;
}

/** A satin column needs this many penetrations to be rebuilt. */
const SATIN_MIN = 8;

/**
 * Re-spaces satin columns evenly: the penetrations along each edge are resampled at a wider,
 * even spacing (removing single zigzags would leave visible gaps in the column). Each edge keeps
 * its shape, both edges keep the same number of penetrations so the column still turns as before,
 * and the first and last penetration stay.
 */
export function respaceSatins(p: Pattern, opts: RespaceOptions, columns: { start: number; end: number }[]): RespaceResult {
  const edits: { from: number; to: number; points: [number, number][]; removed: number }[] = [];
  for (const c of columns) {
    const n = c.end - c.start + 1;
    if (n < SATIN_MIN) continue;
    let asked = 0;
    let need = 0;
    for (let i = c.start; i <= c.end; i++) {
      const v = opts.needAt(i);
      if (v > 0) {
        asked++;
        need += v;
      }
    }
    if (!asked || asked < (opts.minShare ?? 0.25) * n) continue;
    need /= asked;
    const a: [number, number][] = [];
    const b: [number, number][] = [];
    for (let i = c.start; i <= c.end; i++) ((i - c.start) % 2 ? b : a).push([p.x[i], p.y[i]]);
    const len = (e: [number, number][]) => e.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - e[i][0], q[1] - e[i][1]), 0);
    // Same-side spacing, measured on the longer (outer) edge as digitizers define it.
    const outer = Math.max(len(a), len(b));
    const spacing = outer / Math.max(1, a.length - 1);
    const target = Math.min(opts.maxSpacing, spacing / Math.max(0.05, 1 - need));
    if (target < spacing * MIN_GAIN) continue;
    const m = Math.max(2, Math.round(outer / target) + 1); // penetrations per edge
    if (m >= a.length) continue;
    // Keep the column ending on the same edge: with an even count the last point is on edge b.
    const lastOnB = n % 2 === 0;
    const na = m;
    const nb = lastOnB ? m : m - 1;
    if (nb < 2) continue;
    const ra = resample(a, na);
    const rb = resample(b, nb);
    const points: [number, number][] = [];
    for (let k = 0; k < na; k++) {
      points.push(ra[k]);
      if (k < nb) points.push(rb[k]);
    }
    edits.push({ from: c.start, to: c.end, points, removed: n - points.length });
  }
  if (!edits.length) return { pattern: p, sweeps: 0, rows: 0 };
  return { pattern: splice(p, edits), sweeps: edits.length, rows: edits.reduce((s, e) => s + e.removed, 0) };
}
