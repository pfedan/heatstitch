import type { Column } from './satin';
import type { Pt } from './skeleton';

/**
 * Rungs (Querlinien) of a satin column: lines across it that set the direction of its stitches.
 * Between two rungs both rails are walked at the same share of their length, so the direction
 * turns evenly from one rung to the next (as in Ink/Stitch's satin column: the rails are cut at
 * the rungs and each section paired by `interpolate(..., normalized=True)`; re-implemented here).
 *
 * A rung is where it meets the two rails: its distance along each of them from their start (mm).
 * The ends of the rails are rungs too, without being listed.
 */
export type Rung = [number, number];

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const norm = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** Rungs closer than this to each other or to the ends (mm along a rail) are not kept apart. */
export const RUNG_GAP = 0.2;

/** Length along the rail up to each of its points. */
export function cumulative(rail: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < rail.length; i++) out.push(out[i - 1] + dist(rail[i - 1], rail[i]));
  return out;
}

/** The point at distance `s` along the rail. */
export function pointAt(rail: Pt[], cum: number[], s: number): Pt {
  if (s <= 0) return rail[0];
  const n = rail.length - 1;
  if (s >= cum[n]) return rail[n];
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= s) lo = m;
    else hi = m;
  }
  const l = cum[hi] - cum[lo];
  return l > 0 ? lerp(rail[lo], rail[hi], (s - cum[lo]) / l) : rail[lo];
}

/** Direction of the rail at distance `s`. */
function directionAt(rail: Pt[], cum: number[], s: number, h: number): Pt {
  return norm(sub(pointAt(rail, cum, s + h), pointAt(rail, cum, s - h)));
}

/** The nearest point of the rail to q: its distance along the rail and from q. */
export function project(rail: Pt[], cum: number[], q: Pt, from = 0, to = Infinity): { s: number; d: number } {
  let best = { s: Math.max(0, from), d: Infinity };
  for (let i = 1; i < rail.length; i++) {
    if (cum[i] < from || cum[i - 1] > to) continue;
    const a = rail[i - 1];
    const v = sub(rail[i], a);
    const l2 = v[0] * v[0] + v[1] * v[1];
    let t = l2 > 0 ? ((q[0] - a[0]) * v[0] + (q[1] - a[1]) * v[1]) / l2 : 0;
    t = Math.min(1, Math.max(0, t));
    let s = cum[i - 1] + t * (cum[i] - cum[i - 1]);
    s = Math.min(to, Math.max(from, s));
    const d = dist(pointAt(rail, cum, s), q);
    if (d < best.d) best = { s, d };
  }
  return best;
}

/** Where the line from a to b crosses the rail: distances along the rail and along the line (0 to 1). */
function crossings(rail: Pt[], cum: number[], a: Pt, b: Pt): { s: number; t: number }[] {
  const out: { s: number; t: number }[] = [];
  const r = sub(b, a);
  for (let i = 1; i < rail.length; i++) {
    const p = rail[i - 1];
    const q = sub(rail[i], p);
    const den = r[0] * q[1] - r[1] * q[0];
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(p, a);
    const t = (w[0] * q[1] - w[1] * q[0]) / den;
    const u = (w[0] * r[1] - w[1] * r[0]) / den;
    // A line through a corner of the rail meets it there (rounding can miss both sides).
    if (t < 0 || t > 1 || u < -1e-9 || u > 1 + 1e-9) continue;
    out.push({ s: cum[i - 1] + Math.min(1, Math.max(0, u)) * (cum[i] - cum[i - 1]), t });
  }
  return out;
}

/**
 * The column between the rails with the rungs: each section between two rungs (or a rung and an
 * end) walked on both rails at the same share of its length, a pair every `step` mm or so.
 */
export function columnFromRungs(left: Pt[], right: Pt[], rungs: Rung[], step = 0.05): Column {
  const cl = cumulative(left);
  const cr = cumulative(right);
  const la = cl[cl.length - 1];
  const lb = cr[cr.length - 1];
  const cuts: Rung[] = [[0, 0], ...tidyRungs(rungs, la, lb), [la, lb]];
  const L: Pt[] = [];
  const R: Pt[] = [];
  const C: Pt[] = [];
  const widths: number[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [a0, b0] = cuts[k];
    const [a1, b1] = cuts[k + 1];
    const n = Math.max(1, Math.ceil(Math.max(a1 - a0, b1 - b0) / step));
    const last = k + 2 === cuts.length;
    for (let j = 0; j < n + (last ? 1 : 0); j++) {
      const f = j / n;
      const a = pointAt(left, cl, a0 + (a1 - a0) * f);
      const b = pointAt(right, cr, b0 + (b1 - b0) * f);
      L.push(a);
      R.push(b);
      C.push(lerp(a, b, 0.5));
      widths.push(dist(a, b));
    }
  }
  widths.sort((x, y) => x - y);
  return { center: C, left: L, right: R, width: widths[widths.length >> 1] ?? 0 };
}

/** The rungs sorted along the column, without those that cross another or lie on an end. */
export function tidyRungs(rungs: Rung[], la: number, lb: number): Rung[] {
  const sorted = rungs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).slice().sort((x, y) => x[0] - y[0]);
  const out: Rung[] = [];
  let pa = 0;
  let pb = 0;
  for (const [a, b] of sorted) {
    if (a < pa + RUNG_GAP || b < pb + RUNG_GAP || a > la - RUNG_GAP || b > lb - RUNG_GAP) continue;
    out.push([a, b]);
    pa = a;
    pb = b;
  }
  return out;
}

/**
 * Rungs that give about the directions the column has now (one pair of penetrations per stitch,
 * `left[k]` with `right[k]`): rungs are added where interpolating between the ones there would
 * turn a stitch by more than `maxDeg` (as a line is simplified, by its worst point), but not
 * closer together than about three column widths.
 */
export function seedRungs(left: Pt[], right: Pt[], maxDeg = 10): Rung[] {
  const n = Math.min(left.length, right.length);
  if (n < 3) return [];
  const cl = cumulative(left);
  const cr = cumulative(right);
  const keep = new Set<number>();
  const limit = Math.tan((maxDeg * Math.PI) / 180);
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (j - i < 2) continue;
    // Not closer than about three column widths: the direction cannot turn much faster than that anyway.
    const w = (dist(left[i], right[i]) + dist(left[j], right[j])) / 2;
    if (cl[j] - cl[i] < 3 * w && cr[j] - cr[i] < 3 * w) continue;
    const da = cl[j] - cl[i];
    const db = cr[j] - cr[i];
    let worst = -1;
    let worstErr = limit;
    for (let k = i + 1; k < j; k++) {
      // Only a pair that lies between its neighbours on both rails can be a rung.
      if (cl[k] <= cl[i] || cl[k] >= cl[j] || cr[k] <= cr[i] || cr[k] >= cr[j]) continue;
      const f = da > 0 ? (cl[k] - cl[i]) / da : 0.5;
      const want = pointAt(right, cr, cr[i] + f * db);
      const w = Math.max(0.3, dist(left[k], right[k]));
      const err = dist(want, right[k]) / w;
      if (err > worstErr) {
        worstErr = err;
        worst = k;
      }
    }
    if (worst < 0) continue;
    keep.add(worst);
    stack.push([i, worst], [worst, j]);
  }
  return tidyRungs(
    [...keep].sort((a, b) => a - b).map((k) => [cl[k], cr[k]] as Rung),
    cl[cl.length - 1],
    cr[cr.length - 1],
  );
}

/**
 * A rung along the line from a to b (drawn across the column): where it crosses the two rails,
 * or null when it does not cross both. The line counts longer than drawn (the crossings nearest
 * its middle are taken).
 */
export function rungFromLine(left: Pt[], right: Pt[], a: Pt, b: Pt): Rung | null {
  const d = sub(b, a);
  // A short line drawn inside the column reaches out to the rails, up to 10 mm on.
  const ext = Math.max(0.25, 10 / Math.max(0.1, Math.hypot(d[0], d[1])));
  const a2: Pt = [a[0] - d[0] * ext, a[1] - d[1] * ext];
  const b2: Pt = [b[0] + d[0] * ext, b[1] + d[1] * ext];
  const near = (xs: { s: number; t: number }[]) => (xs.length ? xs.reduce((x, y) => (Math.abs(y.t - 0.5) < Math.abs(x.t - 0.5) ? y : x)).s : null);
  const sa = near(crossings(left, cumulative(left), a2, b2));
  const sb = near(crossings(right, cumulative(right), a2, b2));
  return sa === null || sb === null ? null : [sa, sb];
}

/** The rungs with `r` added, or null when it would cross one of them or lie on an end. */
export function addRung(rungs: Rung[], r: Rung, la: number, lb: number): Rung[] | null {
  const all = [...rungs, r].sort((x, y) => x[0] - y[0]);
  const tidy = tidyRungs(all, la, lb);
  return tidy.length === rungs.length + 1 ? tidy : null;
}

/** How far the end `side` (0 on the left rail, 1 on the right) of rung i may move: between its neighbours. */
export function rungRange(rungs: Rung[], i: number, side: 0 | 1, la: number, lb: number): [number, number] {
  const len = side ? lb : la;
  const lo = (i > 0 ? rungs[i - 1][side] : 0) + RUNG_GAP;
  const hi = (i + 1 < rungs.length ? rungs[i + 1][side] : len) - RUNG_GAP;
  return [lo, Math.max(lo, hi)];
}

/** Corners of a rail: distances along it where it turns by more than `minDeg` within `h` mm on both sides. */
function railCorners(rail: Pt[], cum: number[], h: number, minDeg: number): { s: number; turn: number; dir: Pt; out: Pt }[] {
  const len = cum[cum.length - 1];
  const found: { s: number; turn: number; dir: Pt; out: Pt }[] = [];
  const step = Math.max(0.1, h / 4);
  let prev = 0;
  let rising: { s: number; turn: number; dir: Pt; out: Pt } | null = null;
  for (let s = h; s <= len - h; s += step) {
    const p = pointAt(rail, cum, s);
    const din = norm(sub(p, pointAt(rail, cum, s - h)));
    const dout = norm(sub(pointAt(rail, cum, s + h), p));
    const turn = (Math.acos(Math.max(-1, Math.min(1, din[0] * dout[0] + din[1] * dout[1]))) * 180) / Math.PI;
    if (turn > minDeg && turn >= prev) rising = { s, turn, dir: din, out: dout };
    else if (rising && turn < prev) {
      found.push(rising);
      rising = null;
    }
    prev = turn;
  }
  if (rising) found.push(rising);
  return found;
}

/**
 * Rungs for the corners of the column, so the stitches fan around them instead of piling up: a
 * rung along each corner's bisector (inner corner to outer corner) and one about a column width
 * before and after it, square to the rails. Rungs that were in the way are dropped; the others stay.
 */
type Corner = { rung: Rung; turn: number };

/** The corners of a column turning by `minDeg` or more: a rung along each one's bisector, along the column. */
function cornersOf(left: Pt[], right: Pt[], rungs: Rung[], minDeg: number): { corners: Corner[]; w: number } {
  const cl = cumulative(left);
  const cr = cumulative(right);
  const col = columnFromRungs(left, right, rungs, 0.2);
  const w = Math.max(0.5, col.width);
  const h = Math.max(0.4, w * 0.6);
  const corners: Corner[] = [];
  for (const side of [0, 1] as const) {
    const [rail, cum, other, ocum] = side === 0 ? [left, cl, right, cr] : [right, cr, left, cl];
    for (const c of railCorners(rail, cum, h, minDeg)) {
      const v = pointAt(rail, cum, c.s);
      const bis = norm(sub(c.dir, c.out));
      let best: { s: number; d: number } | null = null;
      for (const sign of [1, -1]) {
        const far: Pt = [v[0] + bis[0] * sign * w * 3, v[1] + bis[1] * sign * w * 3];
        for (const x of crossings(other, ocum, v, far)) {
          const d = x.t * w * 3;
          if (d > 0.05 && (!best || d < best.d)) best = { s: x.s, d };
        }
      }
      if (!best) continue;
      corners.push({ rung: side === 0 ? [c.s, best.s] : [best.s, c.s], turn: c.turn });
    }
  }
  // The same corner seen from both rails: the sharper one counts.
  corners.sort((a, b) => b.turn - a.turn);
  const chosen: Corner[] = [];
  for (const c of corners) {
    const p = pointAt(left, cl, c.rung[0]);
    if (chosen.some((x) => dist(pointAt(left, cl, x.rung[0]), p) < w * 1.5)) continue;
    chosen.push(c);
  }
  return { corners: chosen.sort((a, b) => a.rung[0] - b.rung[0]), w };
}

/**
 * Cut lines at the sharp corners of a column (turning by `minDeg` or more), along their bisectors:
 * sewn in sections there, each side ends in a clean mitre instead of fanning round the corner.
 */
export function cornerCuts(left: Pt[], right: Pt[], rungs: Rung[] = [], minDeg = 60): Rung[] {
  return cornersOf(left, right, rungs, minDeg).corners.map((c) => c.rung);
}

export function cornerRungs(left: Pt[], right: Pt[], rungs: Rung[], minDeg = 35): Rung[] {
  const cl = cumulative(left);
  const cr = cumulative(right);
  const la = cl[cl.length - 1];
  const lb = cr[cr.length - 1];
  const { corners: chosen, w } = cornersOf(left, right, rungs, minDeg);
  let out = rungs.slice();
  for (const c of chosen) {
    const [ca, cb] = c.rung;
    // Square rungs a column width before and after, measured on the rail with the shorter way round.
    const before = square(left, cl, right, cr, ca, cb, -1, w);
    const after = square(left, cl, right, cr, ca, cb, 1, w);
    const lo: Rung = before ?? [ca, cb];
    const hi: Rung = after ?? [ca, cb];
    out = out.filter(([a, b]) => !((a >= lo[0] - RUNG_GAP && a <= hi[0] + RUNG_GAP) || (b >= lo[1] - RUNG_GAP && b <= hi[1] + RUNG_GAP)));
    for (const r of [before, c.rung, after]) {
      if (!r) continue;
      const next = addRung(out, r, la, lb);
      if (next) out = next;
    }
  }
  return out;
}

/** A rung square to the rails `w` mm before (dir -1) or after (dir 1) the rung (ca, cb), or null. */
function square(left: Pt[], cl: number[], right: Pt[], cr: number[], ca: number, cb: number, dir: number, w: number): Rung | null {
  const la = cl[cl.length - 1];
  const lb = cr[cr.length - 1];
  // On the inner rail (the shorter way round the corner) the distance is closest to the column's own.
  const tryOn = (onLeft: boolean): Rung | null => {
    const [rail, cum, len, s0, other, ocum, o0] = onLeft ? [left, cl, la, ca, right, cr, cb] : [right, cr, lb, cb, left, cl, ca];
    const s = s0 + dir * w;
    if (s <= RUNG_GAP || s >= len - RUNG_GAP) return null;
    const q = pointAt(rail, cum, s);
    const t = directionAt(rail, cum, s, 0.3);
    // The rail on the other side, straight across from q.
    const n: Pt = [-t[1], t[0]];
    let best: number | null = null;
    let bestD = Infinity;
    for (const sign of [1, -1]) {
      const far: Pt = [q[0] + n[0] * sign * w * 3, q[1] + n[1] * sign * w * 3];
      for (const x of crossings(other, ocum, q, far)) {
        if ((x.s - o0) * dir <= 0) continue;
        if (x.t < bestD) {
          bestD = x.t;
          best = x.s;
        }
      }
    }
    if (best === null) best = project(other, ocum, q, dir > 0 ? o0 : 0, dir > 0 ? Infinity : o0).s;
    return onLeft ? [s, best] : [best, s];
  };
  const a = tryOn(true);
  const b = tryOn(false);
  if (!a || !b) return a ?? b;
  // The one whose other end moved less from the corner rung: it lies on the outer rail.
  return Math.abs(a[1] - cb) <= Math.abs(b[0] - ca) ? a : b;
}

/** The rails walked from the other end, sides swapped, with their rungs. */
export function reversedRungs(rungs: Rung[], la: number, lb: number): Rung[] {
  return rungs.map(([a, b]) => [lb - b, la - a] as Rung).reverse();
}

/**
 * Rails of a satin column for a shape (its outline, a closed line) cut across by rungs drawn on
 * it: each rung meets the outline twice; going round the outline the ends must come in the
 * order 1, 2 … n on one side and n … 2, 1 on the other (the rungs cut the shape into a strip).
 * Beyond the first and the last rung the rails meet in the middle of the outline there (the shape
 * has to end soon after them). Returns null when the rungs do not cut the shape into a strip.
 */
export function railsFromOutline(loop: Pt[], lines: [Pt, Pt][]): { left: Pt[]; right: Pt[]; rungs: Rung[] } | null {
  const n = lines.length;
  if (n < 2 || loop.length < 4) return null;
  const ring = dist(loop[0], loop[loop.length - 1]) < 1e-9 ? loop : [...loop, loop[0]];
  const cum = cumulative(ring);
  const total = cum[cum.length - 1];
  if (total <= 0) return null;
  // Each rung's two meeting points with the outline: the crossings nearest its two ends.
  const ends: { u: number; rung: number }[] = [];
  for (let k = 0; k < n; k++) {
    const [a, b] = lines[k];
    const d = sub(b, a);
    const xs = crossings(ring, cum, [a[0] - d[0] * 0.25, a[1] - d[1] * 0.25], [b[0] + d[0] * 0.25, b[1] + d[1] * 0.25]);
    if (xs.length < 2) return null;
    xs.sort((x, y) => x.t - y.t);
    ends.push({ u: xs[0].s % total, rung: k }, { u: xs[xs.length - 1].s % total, rung: k });
  }
  ends.sort((x, y) => x.u - y.u);
  const m = ends.length;
  let start = -1;
  for (let r = 0; r < m && start < 0; r++) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) ok = ends[(r + i) % m].rung === ends[(r + m - 1 - i) % m].rung && ends[(r + i) % m] !== ends[(r + m - 1 - i) % m];
    if (ok) start = r;
  }
  if (start < 0) return null;
  const at = (i: number) => ends[(start + i) % m].u;
  const fwd = (u0: number, u1: number) => (u1 - u0 + total) % total;
  // Middle of the outline beyond the first rung (from its B end round to its A end) and beyond the last.
  // Beyond the first and the last rung the shape has to end soon (a round or pointed end), not go on.
  const capLen = (u0: number, u1: number) => fwd(u0, u1) <= 4 * dist(pointAt(ring, cum, u0), pointAt(ring, cum, u1)) + 2;
  if (!capLen(at(m - 1), at(0)) || !capLen(at(n - 1), at(n))) return null;
  const capA = (at(m - 1) + fwd(at(m - 1), at(0)) / 2) % total;
  const capB = (at(n - 1) + fwd(at(n - 1), at(n)) / 2) % total;
  // The outline from u0 on for `len` mm: the point there, the outline's own points on the way, the end.
  const walk = (u0: number, len: number): Pt[] => {
    const inner: { u: number; p: Pt }[] = [];
    for (let i = 0; i + 1 < ring.length; i++) {
      const u = fwd(u0, cum[i]);
      if (u > 1e-6 && u < len - 1e-6) inner.push({ u, p: ring[i] });
    }
    inner.sort((x, y) => x.u - y.u);
    const out = [pointAt(ring, cum, u0), ...inner.map((x) => x.p), pointAt(ring, cum, (u0 + len) % total)];
    return out.filter((p, i) => !i || dist(p, out[i - 1]) > 1e-6);
  };
  const lenA = fwd(capA, capB);
  const left = walk(capA, lenA);
  const right = walk(capB, fwd(capB, capA)).reverse();
  if (left.length < 2 || right.length < 2) return null;
  const rungs: Rung[] = [];
  for (let i = 0; i < n; i++) rungs.push([fwd(capA, at(i)), fwd(at(m - 1 - i), capA)]);
  const tidy = tidyRungs(rungs, cumulative(left).pop()!, cumulative(right).pop()!);
  return { left, right, rungs: tidy };
}

/** A stretch of a closed outline: from distance u0 along it forward to u1 (may wrap round). */
export type Arc = [number, number];

/**
 * A satin column for a closed outline (first point repeated at the end) cut across by rungs, each
 * given by the two places it meets the outline (distances along it). As in railsFromOutline the
 * rungs must cut the outline into a strip. Beyond the first and the last rung the column ends on
 * one of `caps` lying there (the one that leaves the two rails most alike in length), or where
 * none lies, in a point in the middle when the outline ends soon after the rung. This is how a
 * satin section finds its own rails: a cut line it does not end on becomes part of a rail. With
 * `far` the outline may go on any length beyond the rung (a part of a fill: its end is the edge
 * farthest out, the rails checked by `ratio`).
 * `ratio` is how much longer the longer rail is; null when the rungs make no strip.
 */
export function stripOfLoop(ring: Pt[], chords: [number, number][], caps: Arc[], far = false): { left: Pt[]; right: Pt[]; rungs: Rung[]; ratio: number } | null {
  const n = chords.length;
  if (!n || ring.length < 4) return null;
  const cum = cumulative(ring);
  const total = cum[cum.length - 1];
  if (total <= 0) return null;
  const fwd = (u0: number, u1: number) => (((u1 - u0) % total) + total) % total;
  const ends: { u: number; rung: number }[] = [];
  chords.forEach(([a, b], k) => ends.push({ u: fwd(0, a), rung: k }, { u: fwd(0, b), rung: k }));
  ends.sort((x, y) => x.u - y.u);
  const m = ends.length;
  let start = -1;
  for (let r = 0; r < m && start < 0; r++) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) ok = ends[(r + i) % m].rung === ends[(r + m - 1 - i) % m].rung && ends[(r + i) % m] !== ends[(r + m - 1 - i) % m];
    if (ok) start = r;
  }
  if (start < 0) return null;
  const at = (i: number) => ends[(start + i) % m].u;
  // The far ends as they are sewn, by the cap they were chosen as.
  const tight = new Map<Arc, Arc>();
  // The caps that fit beyond a rung: in the stretch of outline from u0 on for len mm.
  const fitting = (u0: number, len: number): Arc[] => {
    const out = caps.filter(([c0, c1]) => {
      let x0 = fwd(u0, c0);
      if (x0 > total - 1e-6) x0 = 0;
      const x1 = x0 + fwd(c0, c1);
      return x1 <= len + 1e-6;
    });
    // On a part of a fill the edge farthest out competes with the cut lines: a cut line along the
    // side of a part (into a hole, say) is no end of it.
    if (out.length && !far) return out;
    const a = pointAt(ring, cum, u0);
    const b = pointAt(ring, cum, (u0 + len) % total);
    if (!far && len > 4 * dist(a, b) + 2) return out;
    // The end is the stretch farthest beyond the rung: a square end its edge, a round or pointed one its tip.
    const n = Math.max(2, Math.ceil(len / 0.05));
    const t = norm(sub(b, a));
    const beyond = (u: number) => {
      const q = sub(pointAt(ring, cum, (u0 + u) % total), a);
      return Math.abs(q[0] * t[1] - q[1] * t[0]);
    };
    const d = Array.from({ length: n + 1 }, (_, k) => beyond((len * k) / n));
    const most = Math.max(...d);
    // The stretch round the farthest point that stays this far out (not beyond a dip, such as a
    // cut line into a hole on the way).
    const top = d.indexOf(most);
    const stretch = (near: number): Arc => {
      let first = top;
      let last = top;
      while (first > 0 && d[first - 1] >= near) first--;
      while (last < n && d[last + 1] >= near) last++;
      return [(u0 + (len * first) / n) % total, (u0 + (len * last) / n) % total];
    };
    // Chosen among the caps as wide as an edge drawn slightly askew, sewn as narrow as a few tenths:
    // on a long part 5 % eats into its sides round the corners, the rails would stop short of its end.
    const wide = stretch(most - Math.max(0.1, most * 0.05));
    // Only where it bends round a corner into the sides: a straight edge stays as it is.
    const along = fwd(wide[0], wide[1]);
    // A cut line right at the end (into a hole, say) keeps it as it is, the satin turns there.
    const close = (x: number, y: number) => Math.min(fwd(x, y), fwd(y, x)) < 0.6;
    const byCut = caps.some(([c0, c1]) => [c0, c1].some((c) => close(c, wide[0]) || close(c, wide[1])));
    if (!byCut && along > dist(pointAt(ring, cum, wide[0]), pointAt(ring, cum, wide[1])) * 1.05 + 0.05) tight.set(wide, stretch(most - Math.min(0.15, Math.max(0.1, most * 0.05))));
    return [...out, wide];
  };
  const capsA = fitting(at(m - 1), fwd(at(m - 1), at(0)));
  const capsB = fitting(at(n - 1), fwd(at(n - 1), at(n)));
  let best: { ca: Arc; cb: Arc; l: number; r: number; ratio: number } | null = null;
  for (const ca of capsA) {
    for (const cb of capsB) {
      const l = fwd(ca[1], cb[0]);
      const r = fwd(cb[1], ca[0]);
      if (l <= 1e-6 || r <= 1e-6) continue;
      const ratio = Math.max(l, r) / Math.min(l, r);
      if (!best || ratio < best.ratio) best = { ca, cb, l, r, ratio };
    }
  }
  if (!best) return null;
  const walk = (u0: number, len: number): Pt[] => {
    const inner: { u: number; p: Pt }[] = [];
    for (let i = 0; i + 1 < ring.length; i++) {
      const u = fwd(u0, cum[i]);
      if (u > 1e-6 && u < len - 1e-6) inner.push({ u, p: ring[i] });
    }
    inner.sort((x, y) => x.u - y.u);
    const out = [pointAt(ring, cum, u0), ...inner.map((x) => x.p), pointAt(ring, cum, (u0 + len) % total)];
    return out.filter((p, i) => !i || dist(p, out[i - 1]) > 1e-6);
  };
  const ca = tight.get(best.ca) ?? best.ca;
  const cb = tight.get(best.cb) ?? best.cb;
  const l = fwd(ca[1], cb[0]);
  const r = fwd(cb[1], ca[0]);
  const left = walk(ca[1], l);
  const right = walk(cb[1], r).reverse();
  if (left.length < 2 || right.length < 2) return null;
  const rungs: Rung[] = [];
  for (let i = 0; i < n; i++) rungs.push([fwd(ca[1], at(i)), fwd(at(m - 1 - i), ca[0])]);
  return { left, right, rungs: tidyRungs(rungs, cumulative(left).pop()!, cumulative(right).pop()!), ratio: best.ratio };
}

/** Whether q lies inside the closed outline. */
export function inside(ring: Pt[], q: Pt): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Height of the bands the edges of an outline are sorted into for insideOf (mm). */
const BAND = 0.5;
const insideTests = new WeakMap<Pt[], (q: Pt) => boolean>();

/**
 * Whether points lie inside the closed outline, as `inside`, for many points: the edges are sorted
 * into bands across the outline once, so each point looks only at the edges of its band.
 * Kept per outline (outlines are not changed in place).
 */
export function insideOf(ring: Pt[]): (q: Pt) => boolean {
  const known = insideTests.get(ring);
  if (known) return known;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of ring) {
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  const n = Math.max(1, Math.ceil((y1 - y0) / BAND) + 1);
  const bands: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const lo = Math.floor((Math.min(ring[i][1], ring[j][1]) - y0) / BAND);
    const hi = Math.floor((Math.max(ring[i][1], ring[j][1]) - y0) / BAND);
    for (let b = lo; b <= hi; b++) bands[b].push(i);
  }
  const test = (q: Pt): boolean => {
    const b = Math.floor((q[1] - y0) / BAND);
    if (b < 0 || b >= n) return false;
    let c = false;
    for (const i of bands[b]) {
      const j = i === 0 ? ring.length - 1 : i - 1;
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  insideTests.set(ring, test);
  return test;
}

/**
 * Where a line drawn inside a closed outline meets it: going out from the line's middle both ways,
 * the first crossing each side (distances along the outline). Null when the middle is outside.
 */
export function chordOf(ring: Pt[], a: Pt, b: Pt, known?: Known): [number, number] | null {
  const mid: Pt = lerp(a, b, 0.5);
  if (!(known ? known.inside(ring)(mid) : inside(ring, mid))) return null;
  const d = sub(b, a);
  const len = Math.hypot(d[0], d[1]);
  if (len < 1e-9) return null;
  const ext = Math.max(0.25, 10 / len);
  const xs = crossings(ring, known ? known.cum(ring) : cumulative(ring), [a[0] - d[0] * ext, a[1] - d[1] * ext], [b[0] + d[0] * ext, b[1] + d[1] * ext]);
  // t along the extended line; the middle of the drawn line is at 0.5.
  let lo: { s: number; t: number } | null = null;
  let hi: { s: number; t: number } | null = null;
  for (const x of xs) {
    if (x.t < 0.5 && (!lo || x.t > lo.t)) lo = x;
    if (x.t > 0.5 && (!hi || x.t < hi.t)) hi = x;
  }
  return lo && hi ? [lo.s, hi.s] : null;
}

/** Twice the signed area of a closed outline (its sign tells which way round it goes). */
function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 1; i < ring.length; i++) a += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return a;
}

/** A closed outline walked once round from distance u along it, back to that point. */
function rotated(ring: Pt[], u: number, cum = cumulative(ring)): Pt[] {
  const total = cum[cum.length - 1];
  const fwd = (b: number) => (((b - u) % total) + total) % total;
  const inner: { x: number; p: Pt }[] = [];
  for (let i = 0; i + 1 < ring.length; i++) {
    const x = fwd(cum[i]);
    if (x > 1e-6 && x < total - 1e-6) inner.push({ x, p: ring[i] });
  }
  inner.sort((a, b) => a.x - b.x);
  const at = pointAt(ring, cum, u);
  return [at, ...inner.map((x) => x.p), at];
}

/**
 * A cut line from the edge of a part into a hole: going out from the line's middle both ways, the
 * first crossing one side on the part's outline and the other on a hole's. The part (k) and the
 * place on it (u), the hole (h) and the place on it (v).
 */
function bridgeOf(parts: Pt[][], holes: Pt[][], a: Pt, b: Pt, known: Known): { k: number; u: number; h: number; v: number } | null {
  const m = lerp(a, b, 0.5);
  const d = sub(b, a);
  const len = Math.hypot(d[0], d[1]);
  if (len < 1e-9 || holes.some((h) => inside(h, m))) return null;
  const k = parts.findIndex((r) => inside(r, m));
  if (k < 0) return null;
  const ext = Math.max(0.25, 10 / len);
  const from: Pt = [a[0] - d[0] * ext, a[1] - d[1] * ext];
  const to: Pt = [b[0] + d[0] * ext, b[1] + d[1] * ext];
  type Hit = { ring: number; s: number; t: number };
  const hits: Hit[] = [];
  [parts[k], ...holes].forEach((r, i) => crossings(r, known.cum(r), from, to).forEach((x) => hits.push({ ring: i - 1, ...x })));
  let lo: Hit | null = null;
  let hi: Hit | null = null;
  for (const x of hits) {
    if (x.t < 0.5 && (!lo || x.t > lo.t)) lo = x;
    if (x.t > 0.5 && (!hi || x.t < hi.t)) hi = x;
  }
  if (!lo || !hi) return null;
  const [edge, hole] = lo.ring < 0 && hi.ring >= 0 ? [lo, hi] : hi.ring < 0 && lo.ring >= 0 ? [hi, lo] : [null, null];
  return edge && hole ? { k, u: edge.s, h: hole.ring, v: hole.s } : null;
}

/** A closed outline cut in two by the chord from distance u to v along it (both closed again). */
function splitRing(ring: Pt[], u: number, v: number, cum = cumulative(ring)): [Pt[], Pt[]] {
  const total = cum[cum.length - 1];
  const fwd = (a: number, b: number) => (((b - a) % total) + total) % total;
  const arc = (u0: number, u1: number): Pt[] => {
    const len = fwd(u0, u1);
    const inner: { u: number; p: Pt }[] = [];
    for (let i = 0; i + 1 < ring.length; i++) {
      const x = fwd(u0, cum[i]);
      if (x > 1e-6 && x < len - 1e-6) inner.push({ u: x, p: ring[i] });
    }
    inner.sort((a, b) => a.u - b.u);
    const out = [pointAt(ring, cum, u0), ...inner.map((x) => x.p), pointAt(ring, cum, u1)];
    const kept = out.filter((p, i) => !i || dist(p, out[i - 1]) > 1e-6);
    return [...kept, kept[0]];
  };
  return [arc(u, v), arc(v, u)];
}

type Strip = { left: Pt[]; right: Pt[]; rungs: Rung[] };

/** Lengths along outlines and tests for points inside them, found once per outline (outlines not changed meanwhile). */
interface Known {
  cum: (ring: Pt[]) => number[];
  inside: (ring: Pt[]) => (q: Pt) => boolean;
}

function knownOf(): Known {
  const cums = new Map<Pt[], number[]>();
  return {
    cum: (ring) => {
      let c = cums.get(ring);
      if (!c) cums.set(ring, (c = cumulative(ring)));
      return c;
    },
    inside: insideOf,
  };
}

/**
 * Satin columns for a closed outline cut into parts by `cuts` (lines drawn across it, Trennlinien):
 * each part a strip of its own along the lines drawn across it (`lines`, as in railsFromOutline),
 * ending on its cut lines where that fits (see stripOfLoop). The parts join up as a tree: each part
 * after the parts beyond it, starting at the cut line it shares with the part it hangs from (see
 * chainRun). `parts` are the outlines of the parts; `bad` is the part that makes no strip (-1 when
 * all do). `holes` are the outlines of holes in the area: each needs a cut line from the edge into
 * it (see bridgeOf); `hole` is one that has none (-1 when all are opened).
 */
export function stripsOfOutline(loop: Pt[], lines: [Pt, Pt][], cuts: [Pt, Pt][], holes: Pt[][] = []): { strips: Strip[]; parts: Pt[][]; bad: number; hole: number; made?: (Strip | null)[]; open?: number[] } {
  const closed = (r: Pt[]) => (dist(r[0], r[r.length - 1]) < 1e-9 ? r : [...r, r[0]]);
  const known = knownOf();
  let parts: Pt[][] = [closed(loop)];
  const edges: [Pt, Pt][] = [];
  // Holes first: a cut line from the edge into a hole opens it, the hole's outline becomes part of
  // the edge (an o cut once is a C). A hole not opened is said, the satin would cover it.
  const open = holes.map((h) => closed(h));
  // Which of `holes` each still open one is.
  const which = holes.map((_, j) => j);
  const rest: [Pt, Pt][] = [];
  for (const [a, b] of cuts) {
    const bridge = bridgeOf(parts, open, a, b, known);
    if (!bridge) {
      rest.push([a, b]);
      continue;
    }
    const { k, u, h, v } = bridge;
    const ring = parts[k];
    const hole = open[h];
    const P = pointAt(ring, known.cum(ring), u);
    const Q = pointAt(hole, known.cum(hole), v);
    let around = rotated(hole, v, known.cum(hole));
    // Round the hole the other way than round the edge, so the outline stays one simple loop.
    if (Math.sign(signedArea(around)) === Math.sign(signedArea(ring))) around = around.slice().reverse();
    parts[k] = [...rotated(ring, u, known.cum(ring)), ...around, P];
    edges.push([P, Q]);
    open.splice(h, 1);
    which.splice(h, 1);
  }
  for (const [a, b] of rest) {
    const k = parts.findIndex((r) => chordOf(r, a, b, known));
    if (k < 0) continue;
    const [u, v] = chordOf(parts[k], a, b, known)!;
    const cum = known.cum(parts[k]);
    edges.push([pointAt(parts[k], cum, u), pointAt(parts[k], cum, v)]);
    parts = [...parts.slice(0, k), ...splitRing(parts[k], u, v, cum), ...parts.slice(k + 1)];
  }
  if (open.length) return { strips: [], parts, bad: -1, hole: which[0], open: which };
  parts = parts.filter((r) => r.length >= 4);
  // Near in both directions first: most points are far apart, and that is quick to tell.
  const same = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6 && dist(p, q) < 1e-6;
  // The cut lines each part has as an edge (by index in `edges`), as stretches of its outline.
  const capsOf = parts.map((ring) => {
    const cum = known.cum(ring);
    const out: { arc: Arc; edge: number }[] = [];
    for (let i = 0; i + 1 < ring.length; i++) {
      const e = edges.findIndex(([p, q]) => (same(ring[i], p) && same(ring[i + 1], q)) || (same(ring[i], q) && same(ring[i + 1], p)));
      if (e >= 0) out.push({ arc: [cum[i], cum[i + 1]], edge: e });
    }
    return out;
  });
  const made = parts.map((ring, k) => {
    const chords = lines.map(([a, b]) => chordOf(ring, a, b, known)).filter((c): c is [number, number] => !!c);
    return stripOfLoop(ring, chords, capsOf[k].map((c) => c.arc), true);
  });
  const bad = made.findIndex((m) => !m);
  if (bad >= 0) return { strips: [], parts, bad, hole: -1, made };
  // The parts as a tree joined at the cut lines they share, from a part at an end (one neighbour).
  const shared = (k: number, j: number) => capsOf[k].find((c) => capsOf[j].some((d) => d.edge === c.edge))?.edge;
  const root = Math.max(0, parts.findIndex((_, k) => parts.filter((_, j) => j !== k && shared(k, j) !== undefined).length <= 1));
  const parent = new Map<number, number>([[root, -1]]);
  const queue = [root];
  while (queue.length) {
    const k = queue.shift()!;
    parts.forEach((_, j) => {
      if (!parent.has(j) && shared(k, j) !== undefined) {
        parent.set(j, k);
        queue.push(j);
      }
    });
  }
  // Each part starts at the cut line to its parent (the root away from its first child): sewn
  // after the parts beyond it, it ends there, back where the way came in.
  const mid = (e: number) => lerp(edges[e][0], edges[e][1], 0.5);
  const startOf = (s: Strip) => lerp(s.left[0], s.right[0], 0.5);
  const endOf = (s: Strip) => lerp(s.left[s.left.length - 1], s.right[s.right.length - 1], 0.5);
  const flip = (s: Strip): Strip => ({
    left: s.right.slice().reverse(),
    right: s.left.slice().reverse(),
    rungs: reversedRungs(s.rungs, cumulative(s.left).pop()!, cumulative(s.right).pop()!),
  });
  const oriented = (k: number): Strip => {
    const s: Strip = { left: made[k]!.left, right: made[k]!.right, rungs: made[k]!.rungs };
    const up = parent.get(k)!;
    const child = up < 0 ? parts.findIndex((_, j) => parent.get(j) === k) : -1;
    const at = up >= 0 ? mid(shared(k, up)!) : child >= 0 ? mid(shared(k, child)!) : null;
    if (!at) return s;
    const nearStart = dist(startOf(s), at) < dist(endOf(s), at);
    return nearStart === up >= 0 ? s : flip(s);
  };
  // Children before their parent (each subtree in the order its cut lines come along the parent).
  const strips: Strip[] = [];
  // How far along the parent from where it starts (its entry) a child hangs on.
  const along = (k: number, j: number) => dist(startOf(oriented(k)), mid(shared(k, j)!));
  const visit = (k: number) => {
    const kids = parts.map((_, j) => j).filter((j) => parent.get(j) === k);
    kids.sort((x, y) => along(k, x) - along(k, y));
    for (const j of kids) visit(j);
    strips.push(oriented(k));
  };
  visit(root);
  // Parts that join no other (cannot happen for cut lines across one outline): after the rest.
  parts.forEach((_, k) => !parent.has(k) && strips.push(oriented(k)));
  return { strips, parts, bad: -1, hole: -1 };
}

/**
 * Areas apart from one another (the dot and the stem of an i), each cut into strips as
 * stripsOfOutline does, with the holes that lie in it. The first part that makes no column, or the
 * first hole not opened (by index in `holes`), is said instead.
 */
export function stripsOfAreas(outlines: Pt[][], lines: [Pt, Pt][], cuts: [Pt, Pt][], holes: Pt[][] = []): { areas: Strip[][]; bad: Pt[] | null; hole: number } {
  const areas: Strip[][] = [];
  for (const o of outlines) {
    const mine = holes.map((_, j) => j).filter((j) => inside(o, holes[j][0]));
    const made = stripsOfOutline(o, lines, cuts, mine.map((j) => holes[j]));
    if (made.hole >= 0) return { areas: [], bad: null, hole: mine[made.hole] };
    if (made.bad >= 0) return { areas: [], bad: made.parts[made.bad], hole: -1 };
    areas.push(made.strips);
  }
  return { areas, bad: null, hole: -1 };
}

/** What a fill cut by these lines makes: the strips that work, and every part or hole that does not. */
export interface SectionCheck {
  /** Strips of the parts that make a column (also where other parts of the same area do not). */
  strips: Strip[];
  /** Outlines of the parts that make no column (a line across that crosses them whole is missing). */
  parts: Pt[][];
  /** Holes no cut line opens (the satin would cover them). */
  holes: Pt[][];
}

/**
 * All that is wrong with a fill cut into parts at once (stripsOfAreas says only the first), with
 * the strips of the parts that are fine, so each part can be shown as it would be sewn.
 */
export function checkSections(outlines: Pt[][], lines: [Pt, Pt][], cuts: [Pt, Pt][], holes: Pt[][] = []): SectionCheck {
  const out: SectionCheck = { strips: [], parts: [], holes: [] };
  for (const o of outlines) {
    const mine = holes.map((_, j) => j).filter((j) => inside(o, holes[j][0]));
    const made = stripsOfOutline(o, lines, cuts, mine.map((j) => holes[j]));
    if (made.hole >= 0) {
      for (const h of made.open ?? [made.hole]) out.holes.push(holes[mine[h]]);
      continue;
    }
    if (made.bad < 0) {
      out.strips.push(...made.strips);
      continue;
    }
    (made.made ?? []).forEach((m, k) => (m ? out.strips.push(m) : out.parts.push(made.parts[k])));
  }
  return out;
}

/**
 * The cut lines a fill was cut into these columns by (see stripsOfOutline), found again from the
 * columns: an end of a column inside the fill (another column goes on beyond it, not the edge)
 * is one. Drawn a little beyond the edge, as by hand.
 */
export function cutLinesBetween(cols: { left: Pt[]; right: Pt[] }[], outlines: Pt[][], holes: Pt[][]): [Pt, Pt][] {
  const within = (q: Pt) => outlines.some((o) => inside(o, q)) && !holes.some((h) => inside(h, q));
  const cuts: [Pt, Pt][] = [];
  for (const c of cols) {
    const n = Math.min(c.left.length, c.right.length);
    if (n < 2) continue;
    const ends: [Pt, Pt, Pt][] = [
      [c.left[0], c.right[0], mid(c.left[1], c.right[1])],
      [c.left[c.left.length - 1], c.right[c.right.length - 1], mid(c.left[c.left.length - 2], c.right[c.right.length - 2])],
    ];
    for (const [a, b, inward] of ends) {
      const m = mid(a, b);
      const d = Math.hypot(m[0] - inward[0], m[1] - inward[1]) || 1;
      if (!within([m[0] + ((m[0] - inward[0]) / d) * 0.4, m[1] + ((m[1] - inward[1]) / d) * 0.4])) continue;
      // The two columns on either side of one cut line end on it both.
      if (cuts.some(([p, q]) => Math.hypot((p[0] + q[0]) / 2 - m[0], (p[1] + q[1]) / 2 - m[1]) < 0.3)) continue;
      const w = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const e: Pt = [((b[0] - a[0]) / w) * 0.5, ((b[1] - a[1]) / w) * 0.5];
      cuts.push([[a[0] - e[0], a[1] - e[1]], [b[0] + e[0], b[1] + e[1]]]);
    }
  }
  return cuts;
}

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
