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
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    out.push({ s: cum[i - 1] + u * (cum[i] - cum[i - 1]), t });
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
 * satin section finds its own rails: a cut line it does not end on becomes part of a rail.
 * `ratio` is how much longer the longer rail is; null when the rungs make no strip.
 */
export function stripOfLoop(ring: Pt[], chords: [number, number][], caps: Arc[]): { left: Pt[]; right: Pt[]; rungs: Rung[]; ratio: number } | null {
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
  // The caps that fit beyond a rung: in the stretch of outline from u0 on for len mm.
  const fitting = (u0: number, len: number): Arc[] => {
    const out = caps.filter(([c0, c1]) => {
      let x0 = fwd(u0, c0);
      if (x0 > total - 1e-6) x0 = 0;
      const x1 = x0 + fwd(c0, c1);
      return x1 <= len + 1e-6;
    });
    if (out.length) return out;
    const a = pointAt(ring, cum, u0);
    const b = pointAt(ring, cum, (u0 + len) % total);
    if (len > 4 * dist(a, b) + 2) return [];
    // The end is the stretch farthest beyond the rung: a square end its edge, a round or pointed one its tip.
    const n = Math.max(2, Math.ceil(len / 0.05));
    const t = norm(sub(b, a));
    const beyond = (u: number) => {
      const q = sub(pointAt(ring, cum, (u0 + u) % total), a);
      return Math.abs(q[0] * t[1] - q[1] * t[0]);
    };
    const d = Array.from({ length: n + 1 }, (_, k) => beyond((len * k) / n));
    const most = Math.max(...d);
    const near = most - Math.max(0.1, most * 0.05);
    const first = d.findIndex((x) => x >= near);
    const last = d.length - 1 - [...d].reverse().findIndex((x) => x >= near);
    return [[(u0 + (len * first) / n) % total, (u0 + (len * last) / n) % total]];
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
  const { ca, cb } = best;
  const left = walk(ca[1], best.l);
  const right = walk(cb[1], best.r).reverse();
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

/**
 * Where a line drawn inside a closed outline meets it: going out from the line's middle both ways,
 * the first crossing each side (distances along the outline). Null when the middle is outside.
 */
export function chordOf(ring: Pt[], a: Pt, b: Pt): [number, number] | null {
  const mid: Pt = lerp(a, b, 0.5);
  if (!inside(ring, mid)) return null;
  const d = sub(b, a);
  const len = Math.hypot(d[0], d[1]);
  if (len < 1e-9) return null;
  const ext = Math.max(0.25, 10 / len);
  const xs = crossings(ring, cumulative(ring), [a[0] - d[0] * ext, a[1] - d[1] * ext], [b[0] + d[0] * ext, b[1] + d[1] * ext]);
  // t along the extended line; the middle of the drawn line is at 0.5.
  let lo: { s: number; t: number } | null = null;
  let hi: { s: number; t: number } | null = null;
  for (const x of xs) {
    if (x.t < 0.5 && (!lo || x.t > lo.t)) lo = x;
    if (x.t > 0.5 && (!hi || x.t < hi.t)) hi = x;
  }
  return lo && hi ? [lo.s, hi.s] : null;
}
