import { flatten, setSmooth, type Path } from '../shape/path';
import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import { colOf, flatPts, ptsOf, type Column } from './satin';
import type { Pt } from './skeleton';

/**
 * Rungs (Querlinien) of a satin column: lines across it that set the direction of its stitches.
 * Between two rungs both rails are walked at the same share of their length, so the direction
 * turns evenly from one rung to the next (as in Ink/Stitch's satin column: the rails are cut at
 * the rungs and each section paired by `interpolate(..., normalized=True)`; re-implemented here).
 *
 * A rung is where it meets the two rails: its distance along each of them from their start (mm).
 * The ends of the rails are rungs too, without being listed.
 *
 * The work on whole rails and outlines is done by the core (core/src/digitize/rungs.rs). The helpers
 * the interface calls per rung or point stay here, and so do partsOf, cutParts and stripsOfParts,
 * which satinEase keeps between calls.
 */
export type Rung = [number, number];

/**
 * A cut line (Trennlinie) drawn across an area: the points it goes through, two for a straight
 * line. Between them it bends smoothly, as a path of the vector model whose middle nodes are round
 * (see cutPath); its ends are taken on to the outline straight.
 */
export type Cut = Pt[];

/**
 * A cut line as a path: through its points, the ones between its ends round (as setSmooth makes
 * them). At an end the curve leaves as it arrives at the next point, mirrored about the line
 * between them, so three points on a circle give about that circle.
 */
export function cutPath(c: Cut): Path {
  let f = { paths: [{ closed: false, nodes: c.map((p) => ({ p: [p[0], p[1]] as Pt, a: [p[0], p[1]] as Pt, b: [p[0], p[1]] as Pt, smooth: false })) }] };
  for (let i = 1; i + 1 < c.length; i++) f = setSmooth(f, 0, i, true);
  const nodes = f.paths[0].nodes;
  const n = nodes.length;
  if (n > 2) {
    // The handle of end `e`, with `q` the next node and `h` its handle towards the end.
    const end = (e: Pt, q: Pt, h: Pt): Pt => {
      const l = dist(e, q);
      const u = norm(sub(e, q));
      const t = norm(sub(h, q));
      const k = 2 * (t[0] * u[0] + t[1] * u[1]);
      // t mirrored about the line from q to e, then seen from e (the way back).
      const m: Pt = [k * u[0] - t[0], k * u[1] - t[1]];
      return [e[0] - m[0] * (l / 3), e[1] - m[1] * (l / 3)];
    };
    nodes[0].b = end(nodes[0].p, nodes[1].p, nodes[1].a);
    nodes[n - 1].a = end(nodes[n - 1].p, nodes[n - 2].p, nodes[n - 2].b);
  }
  return f.paths[0];
}

/** The straight pieces a cut line cuts along (one for a straight line). */
export function cutPieces(c: Cut): [Pt, Pt][] {
  const l = cutLine(c);
  return l.slice(1).map((p, i) => [l[i], p]);
}

/** The curves of cut lines worked out before, with the points they were worked out from (a cut line being dragged changes in place). */
const cutLines = new WeakMap<Cut, { from: Pt[]; line: Pt[] }>();

/** The line a cut line cuts along: itself when straight, else its curve in points about 0.1 mm apart. */
export function cutLine(c: Cut): Pt[] {
  if (c.length <= 2) return c;
  const was = cutLines.get(c);
  if (was && was.from.length === c.length && was.from.every((p, i) => p[0] === c[i][0] && p[1] === c[i][1])) return was.line;
  const line = flatten(cutPath(c), 0.1);
  cutLines.set(c, { from: c.map((p) => [p[0], p[1]] as Pt), line });
  return line;
}

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
  return colOf(core().columnFromRungs(flatPts(left), flatPts(right), flatPts(rungs), step));
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
  return ptsOf(core().seedRungs(flatPts(left), flatPts(right), maxDeg));
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

/**
 * Cut lines at the sharp corners of a column (turning by `minDeg` or more), along their bisectors:
 * sewn in sections there, each side ends in a clean mitre instead of fanning round the corner.
 */
export function cornerCuts(left: Pt[], right: Pt[], rungs: Rung[] = [], minDeg = 60): Rung[] {
  return ptsOf(core().rungCornerCuts(flatPts(left), flatPts(right), flatPts(rungs), minDeg));
}

/**
 * Rungs for the corners of the column, so the stitches fan around them instead of piling up: a
 * rung along each corner's bisector (inner corner to outer corner) and one about a column width
 * before and after it, square to the rails. Rungs that were in the way are dropped; the others stay.
 */
export function cornerRungs(left: Pt[], right: Pt[], rungs: Rung[], minDeg = 35): Rung[] {
  return ptsOf(core().cornerRungs(flatPts(left), flatPts(right), flatPts(rungs), minDeg));
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
  return core().railsFromOutline(flatPts(loop), segsFlat(lines)) as Strip | null;
}

/** Lines of two points as one flat list (a x, a y, b x, b y per line). */
const segsFlat = (lines: [Pt, Pt][]): Float64Array => flatPts(lines.flat());

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
  return core().stripOfLoop(flatPts(ring), flatPts(chords), flatPts(caps), far) as ReturnType<typeof loopStrip>;
}

/** stripOfLoop as the TypeScript does it, for stripsOfParts (satinEase keeps its parts between calls). */
function loopStrip(ring: Pt[], chords: [number, number][], caps: Arc[], far = false): { left: Pt[]; right: Pt[]; rungs: Rung[]; ratio: number } | null {
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
 * place on it (u), the hole (h) and the place on it (v), and the points of a bent line between
 * them (from the edge to the hole).
 */
function bridgeOf(parts: Pt[][], holes: Pt[][], line: Pt[], known: Known): { k: number; u: number; h: number; v: number; inner: Pt[] } | null {
  const m = midOf(line);
  if (!m || holes.some((h) => inside(h, m))) return null;
  const k = parts.findIndex((r) => inside(r, m));
  if (k < 0) return null;
  const hit = outward(line, [parts[k], ...holes], known);
  if (!hit) return null;
  const { lo, hi } = hit;
  if (lo.ring === 0 && hi.ring > 0) return { k, u: lo.s, h: hi.ring - 1, v: hi.s, inner: hit.inner };
  if (hi.ring === 0 && lo.ring > 0) return { k, u: hi.s, h: lo.ring - 1, v: lo.s, inner: hit.inner.slice().reverse() };
  return null;
}

/**
 * A line drawn across outlines (`rings`) taken on beyond its ends (straight on, as far as a
 * straight line, see chordOf): going out from its middle both ways, the first crossing each side
 * (`ring` its index in `rings`, `s` the distance along it), and the line's own points between them.
 */
function outward(line: Pt[], rings: Pt[][], known: Known): { lo: { ring: number; s: number }; hi: { ring: number; s: number }; inner: Pt[] } | null {
  const path = reachOf(line);
  if (!path) return null;
  const pc = cumulative(path);
  const middle = pc[pc.length - 1] / 2;
  type Hit = { ring: number; s: number; at: number };
  let lo: Hit | null = null;
  let hi: Hit | null = null;
  rings.forEach((r, ring) => {
    const rc = known.cum(r);
    for (let i = 1; i < path.length; i++) {
      for (const x of crossings(r, rc, path[i - 1], path[i])) {
        const at = pc[i - 1] + x.t * (pc[i] - pc[i - 1]);
        if (at < middle && (!lo || at > lo.at)) lo = { ring, s: x.s, at };
        if (at > middle && (!hi || at < hi.at)) hi = { ring, s: x.s, at };
      }
    }
  });
  if (!lo || !hi) return null;
  const [l, h] = [lo as Hit, hi as Hit];
  // The points of the line strictly between the two crossings (not on them).
  const inner = path.filter((_, i) => pc[i] > l.at + 1e-6 && pc[i] < h.at - 1e-6);
  return { lo: { ring: l.ring, s: l.s }, hi: { ring: h.ring, s: h.s }, inner };
}

/**
 * A line as far as it reaches when it cuts: taken on straight beyond both ends, a quarter of its
 * length or 10 mm, whichever is more (see chordOf). Null for a line without length.
 */
export function reachOf(line: Pt[]): Pt[] | null {
  const n = line.length;
  const lc = cumulative(line);
  const len = lc[n - 1];
  if (n < 2 || len < 1e-9) return null;
  // A straight line as one piece from end to end, so it cuts exactly as before bent lines were known.
  if (n === 2) {
    const [a, b] = line;
    const d = sub(b, a);
    const ext = Math.max(0.25, 10 / len);
    return [
      [a[0] - d[0] * ext, a[1] - d[1] * ext],
      [b[0] + d[0] * ext, b[1] + d[1] * ext],
    ];
  }
  const e = Math.max(0.25 * len, 10);
  const d0 = norm(sub(line[0], line[1]));
  const d1 = norm(sub(line[n - 1], line[n - 2]));
  return [[line[0][0] + d0[0] * e, line[0][1] + d0[1] * e], ...line, [line[n - 1][0] + d1[0] * e, line[n - 1][1] + d1[1] * e]];
}

/** Where a cut line (straight or bent) drawn inside a closed outline meets it, as chordOf, and its points in between. */
function cutOf(ring: Pt[], line: Pt[], known: Known): { u: number; v: number; inner: Pt[] } | null {
  if (line.length === 2) {
    const c = chordOf(ring, line[0], line[1], known);
    return c && { u: c[0], v: c[1], inner: [] };
  }
  const m = midOf(line);
  if (!m || !known.inside(ring)(m)) return null;
  const hit = outward(line, [ring], known);
  return hit && { u: hit.lo.s, v: hit.hi.s, inner: hit.inner };
}

/** Whether a cut line (straight or bent) is drawn across a closed outline (its middle inside, both ways out of it). */
export function cutAcross(ring: Pt[], c: Cut): boolean {
  return !!cutOf(ring, cutLine(c), knownOf());
}

/** The point halfway along a line; null for one without length. */
export function midOf(line: Pt[]): Pt | null {
  const c = cumulative(line);
  const len = c[c.length - 1];
  return line.length >= 2 && len > 1e-9 ? pointAt(line, c, len / 2) : null;
}

/**
 * A closed outline cut in two by the line from distance u to v along it (both closed again):
 * straight across, or through `inner`, the points of a bent line from u to v.
 */
function splitRing(ring: Pt[], u: number, v: number, cum = cumulative(ring), inner: Pt[] = []): [Pt[], Pt[]] {
  const total = cum[cum.length - 1];
  const fwd = (a: number, b: number) => (((b - a) % total) + total) % total;
  const arc = (u0: number, u1: number, via: Pt[]): Pt[] => {
    const len = fwd(u0, u1);
    const inner: { u: number; p: Pt }[] = [];
    for (let i = 0; i + 1 < ring.length; i++) {
      const x = fwd(u0, cum[i]);
      if (x > 1e-6 && x < len - 1e-6) inner.push({ u: x, p: ring[i] });
    }
    inner.sort((a, b) => a.u - b.u);
    const out = [pointAt(ring, cum, u0), ...inner.map((x) => x.p), pointAt(ring, cum, u1)];
    const kept = out.filter((p, i) => !i || dist(p, out[i - 1]) > 1e-6);
    return [...kept, ...via, kept[0]];
  };
  return [arc(u, v, inner.slice().reverse()), arc(v, u, inner)];
}

type Strip = { left: Pt[]; right: Pt[]; rungs: Rung[] };

/** Lengths along outlines, tests for points inside them and the strips made of them, found once per outline (outlines not changed meanwhile). */
interface Known {
  cum: (ring: Pt[]) => number[];
  inside: (ring: Pt[]) => (q: Pt) => boolean;
  /** The strip a part makes along `lines`, ending on `caps` (see stripOfLoop), as found before for the same. */
  strip: (ring: Pt[], lines: [Pt, Pt][], caps: Arc[]) => ReturnType<typeof loopStrip>;
}

function knownOf(): Known {
  const cums = new Map<Pt[], number[]>();
  const strips = new Map<Pt[], { lines: [Pt, Pt][]; caps: Arc[]; made: ReturnType<typeof loopStrip> }>();
  const known: Known = {
    cum: (ring) => {
      let c = cums.get(ring);
      if (!c) cums.set(ring, (c = cumulative(ring)));
      return c;
    },
    inside: insideOf,
    strip: (ring, lines, caps) => {
      const was = strips.get(ring);
      if (was && was.lines === lines && was.caps.length === caps.length && was.caps.every((c, i) => c[0] === caps[i][0] && c[1] === caps[i][1])) return was.made;
      const chords = lines.map(([a, b]) => chordOf(ring, a, b, known)).filter((c): c is [number, number] => !!c);
      const made = loopStrip(ring, chords, caps, true);
      strips.set(ring, { lines, caps, made });
      return made;
    },
  };
  return known;
}

/**
 * A closed outline cut into parts by cut lines (see partsOf): what stripsOfOutline works from. A
 * cut line more cuts one part further (cutParts), the rest stay as they are, so a cut tried costs
 * only its own part.
 */
export interface Parts {
  /** The outlines of the parts (closed). */
  parts: Pt[][];
  /** The cut lines as they cut: each an edge of the parts it made (two points, or more where it bends). */
  edges: Pt[][];
  /** Holes no cut line from the edge has opened yet, and which of the holes given each is. */
  open: Pt[][];
  which: number[];
  known: Known;
}

/** A cut line from the edge into a hole, when `line` is one: the hole opened, its outline now part of the edge (see partsOf). */
function openHole(p: Parts, line: Pt[]): boolean {
  const bridge = bridgeOf(p.parts, p.open, line, p.known);
  if (!bridge) return false;
  const { k, u, h, v, inner } = bridge;
  const ring = p.parts[k];
  const hole = p.open[h];
  const P = pointAt(ring, p.known.cum(ring), u);
  const Q = pointAt(hole, p.known.cum(hole), v);
  let around = rotated(hole, v, p.known.cum(hole));
  // Round the hole the other way than round the edge, so the outline stays one simple loop.
  if (Math.sign(signedArea(around)) === Math.sign(signedArea(ring))) around = around.slice().reverse();
  p.parts[k] = [...rotated(ring, u, p.known.cum(ring)), ...inner, ...around, ...inner.slice().reverse(), P];
  p.edges.push([P, ...inner, Q]);
  p.open.splice(h, 1);
  p.which.splice(h, 1);
  return true;
}

/** The part the line is drawn across cut in two along it; false when it is drawn across none. */
function cutPart(p: Parts, line: Pt[]): boolean {
  for (let k = 0; k < p.parts.length; k++) {
    const c = cutOf(p.parts[k], line, p.known);
    if (!c) continue;
    const cum = p.known.cum(p.parts[k]);
    p.edges.push([pointAt(p.parts[k], cum, c.u), ...c.inner, pointAt(p.parts[k], cum, c.v)]);
    p.parts.splice(k, 1, ...splitRing(p.parts[k], c.u, c.v, cum, c.inner));
    return true;
  }
  return false;
}

/**
 * A closed outline cut into parts by `cuts` (lines drawn across it), with the holes that lie in it.
 * Holes first: a cut line from the edge into a hole opens it, the hole's outline becomes part of
 * the edge (an o cut once is a C); then the other cut lines, each cutting the part it is drawn
 * across in two. A cut line drawn across no part is left out.
 */
export function partsOf(loop: Pt[], cuts: Cut[], holes: Pt[][] = []): Parts {
  const closed = (r: Pt[]) => (dist(r[0], r[r.length - 1]) < 1e-9 ? r : [...r, r[0]]);
  const p: Parts = { parts: [closed(loop)], edges: [], open: holes.map(closed), which: holes.map((_, j) => j), known: knownOf() };
  const rest: Pt[][] = [];
  for (const c of cuts) {
    const line = cutLine(c);
    if (!openHole(p, line)) rest.push(line);
  }
  for (const line of rest) cutPart(p, line);
  return p;
}

/** The parts with one cut line more (the parts as they were left as they are); null when it cuts none of them. */
export function cutParts(p: Parts, cut: Cut): Parts | null {
  const next: Parts = { parts: p.parts.slice(), edges: p.edges.slice(), open: p.open.slice(), which: p.which.slice(), known: p.known };
  const line = cutLine(cut);
  return openHole(next, line) || cutPart(next, line) ? next : null;
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
export function stripsOfOutline(loop: Pt[], lines: [Pt, Pt][], cuts: Cut[], holes: Pt[][] = []): { strips: Strip[]; parts: Pt[][]; bad: number; hole: number; made?: (Strip | null)[]; open?: number[] } {
  const c = flatLines(cuts);
  const h = flatLines(holes);
  return core().stripsOfOutline(flatPts(loop), segsFlat(lines), c.flat, c.lens, h.flat, h.lens) as ReturnType<typeof stripsOfParts>;
}

/** The satin columns of an outline cut into parts (see stripsOfOutline), along `lines`. */
export function stripsOfParts(p: Parts, lines: [Pt, Pt][]): { strips: Strip[]; parts: Pt[][]; bad: number; hole: number; made?: (Strip | null)[]; open?: number[] } {
  const { known, edges, open, which } = p;
  if (open.length) return { strips: [], parts: p.parts, bad: -1, hole: which[0], open: which };
  const parts = p.parts.filter((r) => r.length >= 4);
  // Near in both directions first: most points are far apart, and that is quick to tell.
  const same = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6 && dist(p, q) < 1e-6;
  // The cut lines each part has as an edge (by index in `edges`), as stretches of its outline.
  // A bent cut line is a run of the outline's points, in its order or the other way round.
  const runs = (ring: Pt[], i: number, e: Pt[]) => {
    const n = e.length;
    if (i + n > ring.length) return false;
    let fwd = true;
    let back = true;
    for (let j = 0; j < n && (fwd || back); j++) {
      fwd &&= same(ring[i + j], e[j]);
      back &&= same(ring[i + j], e[n - 1 - j]);
    }
    return fwd || back;
  };
  const capsOf = parts.map((ring) => {
    const cum = known.cum(ring);
    const out: { arc: Arc; edge: number }[] = [];
    for (let i = 0; i + 1 < ring.length; i++) {
      const e = edges.findIndex((x) => runs(ring, i, x));
      if (e >= 0) out.push({ arc: [cum[i], cum[i + edges[e].length - 1]], edge: e });
    }
    return out;
  });
  const made = parts.map((ring, k) => known.strip(ring, lines, capsOf[k].map((c) => c.arc)));
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
  const mid = (e: number) => midOf(edges[e])!;
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
export function stripsOfAreas(outlines: Pt[][], lines: [Pt, Pt][], cuts: Cut[], holes: Pt[][] = []): { areas: Strip[][]; bad: Pt[] | null; hole: number } {
  const o = flatLines(outlines);
  const c = flatLines(cuts);
  const h = flatLines(holes);
  return core().stripsOfAreas(o.flat, o.lens, segsFlat(lines), c.flat, c.lens, h.flat, h.lens) as { areas: Strip[][]; bad: Pt[] | null; hole: number };
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
export function checkSections(outlines: Pt[][], lines: [Pt, Pt][], cuts: Cut[], holes: Pt[][] = []): SectionCheck {
  const o = flatLines(outlines);
  const c = flatLines(cuts);
  const h = flatLines(holes);
  return core().checkSections(o.flat, o.lens, segsFlat(lines), c.flat, c.lens, h.flat, h.lens) as SectionCheck;
}

/**
 * The cut lines a fill was cut into these columns by (see stripsOfOutline), found again from the
 * columns: an end of a column inside the fill (another column goes on beyond it, not the edge)
 * is one. Drawn a little beyond the edge, as by hand.
 */
export function cutLinesBetween(cols: { left: Pt[]; right: Pt[] }[], outlines: Pt[][], holes: Pt[][]): [Pt, Pt][] {
  const l = flatLines(cols.map((c) => c.left));
  const r = flatLines(cols.map((c) => c.right));
  const o = flatLines(outlines);
  const h = flatLines(holes);
  const flat = core().cutLinesBetween(l.flat, l.lens, r.flat, r.lens, o.flat, o.lens, h.flat, h.lens);
  const out: [Pt, Pt][] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) out.push([[flat[i], flat[i + 1]], [flat[i + 2], flat[i + 3]]]);
  return out;
}
