import { outline, type Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import type { Form, Node, Path } from './path';

/**
 * Largest distance of the curves from the traced outline (mm): rastered again, the area stays
 * within about 1 % of the pixels it came from, with few enough nodes to grab. Areas read from
 * stitches have ragged row ends anyway; they get the coarser READ_TOLERANCE.
 */
export const FIT_TOLERANCE = 0.15;
export const READ_TOLERANCE = 0.25;
/** Turn (degrees) over about CORNER_REACH on both sides that makes a corner. */
const CORNER_DEG = 50;
const CORNER_REACH = 0.4;
/** Loops smaller than this (mm²) are specks of the tracing, not part of the shape. */
const SPECK = 0.3;

type V = [number, number];
const sub = (a: Pt, b: Pt): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: V): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const len = (a: V) => Math.hypot(a[0], a[1]);
const unit = (a: V): V => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};

function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return a / 2;
}

/**
 * The area of a region as curves: its outline (holes included) traced and fitted with cubic
 * curves, corners kept sharp. Raster it again with `rasterize` to get (nearly) the same pixels.
 */
export function vectorize(r: Region, tol = FIT_TOLERANCE): Form {
  const paths: Path[] = [];
  for (const loop of outline(r)) {
    const pts = loop.slice(0, -1) as Pt[];
    if (pts.length < 4 || Math.abs(signedArea(pts)) < SPECK) continue;
    paths.push(fitLoop(pts, tol));
  }
  return { paths };
}

/** Points of a closed loop as a closed path of cubic curves. */
export function fitLoop(raw: Pt[], tol = FIT_TOLERANCE): Path {
  const pts = smooth(raw);
  const n = pts.length;
  const corners = findCorners(pts);
  // Break points: the corners, or for a round loop two points opposite each other.
  const breaks = corners.length ? corners : [0, Math.floor(n / 2)];
  const isCorner = new Set(corners);
  const tangentAt = (i: number, side: 'in' | 'out'): V => {
    // At a corner each side has its own direction, elsewhere the line through the neighbours.
    const k = Math.max(2, Math.round(n / 60));
    const prev = pts[(i - k + n) % n];
    const next = pts[(i + k) % n];
    if (!isCorner.has(i)) return unit(sub(next, prev));
    return side === 'out' ? unit(sub(next, pts[i])) : unit(sub(pts[i], prev));
  };
  const nodes: Node[] = [];
  for (let b = 0; b < breaks.length; b++) {
    const s = breaks[b];
    const e = breaks[(b + 1) % breaks.length];
    const run: Pt[] = [];
    for (let i = s; ; i = (i + 1) % n) {
      run.push(pts[i]);
      if (i === e && run.length > 1) break;
    }
    const curves = fitCubic(run, tangentAt(s, 'out'), mul(tangentAt(e, 'in'), -1), tol);
    for (const c of curves) {
      const last = nodes[nodes.length - 1];
      if (last && dist(last.p, c[0]) < 1e-9) last.b = c[1];
      else nodes.push({ p: c[0], a: c[0], b: c[1], smooth: !isCorner.has(s) });
      nodes.push({ p: c[3], a: c[2], b: c[3], smooth: true });
    }
    // The node at a break point is a corner when it was found as one.
    const end = nodes[nodes.length - 1];
    end.smooth = !isCorner.has(e);
  }
  // The last node is the first one again.
  const last = nodes.pop()!;
  nodes[0].a = last.a;
  nodes[0].smooth = !isCorner.has(breaks[0]);
  for (const nd of nodes) if (straightish(nd)) nd.smooth = false;
  return { closed: true, nodes };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const straightish = (n: Node) => dist(n.p, n.a) < 1e-9 && dist(n.p, n.b) < 1e-9;

/** One pass of neighbour averaging: the steps of the pixel edge become a smooth line. */
function smooth(pts: Pt[]): Pt[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
  });
}

/** Indices of corners: where the loop turns more than CORNER_DEG within CORNER_REACH on both sides. */
function findCorners(pts: Pt[]): number[] {
  const n = pts.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += dist(pts[i], pts[(i + 1) % n]);
  const step = total / n;
  const k = Math.max(2, Math.round(CORNER_REACH / Math.max(step, 1e-6)));
  if (n < 4 * k) return [];
  const turn = pts.map((p, i) => {
    const a = unit(sub(p, pts[(i - k + n) % n]));
    const b = unit(sub(pts[(i + k) % n], p));
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  });
  const limit = (CORNER_DEG * Math.PI) / 180;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < limit) continue;
    // The sharpest point of its neighbourhood only.
    let peak = true;
    for (let j = -k; j <= k && peak; j++) if (j && (turn[(i + j + n) % n] > turn[i] || (turn[(i + j + n) % n] === turn[i] && j < 0))) peak = false;
    if (peak) out.push(i);
  }
  return out;
}

type Cubic = [Pt, Pt, Pt, Pt];

/**
 * Cubic curves through `pts` (Schneider's algorithm, Graphics Gems 1990): one curve fitted by
 * least squares with the given end directions, split at the worst point until every point lies
 * within `tol`.
 */
export function fitCubic(pts: Pt[], t1: V, t2: V, tol: number, depth = 0): Cubic[] {
  if (pts.length === 2) {
    const d = dist(pts[0], pts[1]) / 3;
    return [[pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]];
  }
  let u = chordParams(pts);
  let curve = generate(pts, u, t1, t2);
  let { max, at } = maxError(pts, curve, u);
  if (max < tol) return [curve];
  if (max < tol * 4) {
    for (let it = 0; it < 6; it++) {
      u = reparameterize(pts, u, curve);
      curve = generate(pts, u, t1, t2);
      ({ max, at } = maxError(pts, curve, u));
      if (max < tol) return [curve];
    }
  }
  // A straight run gets a straight line, not a split.
  if (depth > 12 || pts.length < 3) return [curve];
  at = Math.max(1, Math.min(pts.length - 2, at));
  const center = unit(sub(pts[at - 1], pts[at + 1]));
  return [...fitCubic(pts.slice(0, at + 1), t1, center, tol, depth + 1), ...fitCubic(pts.slice(at), mul(center, -1), t2, tol, depth + 1)];
}

function chordParams(pts: Pt[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

const B0 = (t: number) => (1 - t) ** 3;
const B1 = (t: number) => 3 * t * (1 - t) ** 2;
const B2 = (t: number) => 3 * t * t * (1 - t);
const B3 = (t: number) => t ** 3;

function at(c: Cubic, t: number): Pt {
  return [B0(t) * c[0][0] + B1(t) * c[1][0] + B2(t) * c[2][0] + B3(t) * c[3][0], B0(t) * c[0][1] + B1(t) * c[1][1] + B2(t) * c[2][1] + B3(t) * c[3][1]];
}

function generate(pts: Pt[], u: number[], t1: V, t2: V): Cubic {
  const first = pts[0];
  const last = pts[pts.length - 1];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const a1 = mul(t1, B1(u[i]));
    const a2 = mul(t2, B2(u[i]));
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const base = add(add(mul(first as V, B0(u[i]) + B1(u[i])), mul(last as V, B2(u[i]) + B3(u[i]))), [0, 0]);
    const tmp = sub(pts[i], base);
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  const seg = dist(first, last);
  const eps = 1e-6 * seg;
  // Degenerate solutions fall back to a third of the chord (Wu/Barsky heuristic).
  if (al < eps || ar < eps || al > seg * 2 || ar > seg * 2) al = ar = seg / 3;
  return [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last];
}

function maxError(pts: Pt[], c: Cubic, u: number[]): { max: number; at: number } {
  let max = 0;
  let idx = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(at(c, u[i]), pts[i]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  return { max, at: idx };
}

function reparameterize(pts: Pt[], u: number[], c: Cubic): number[] {
  const d1: Cubic = [mul(sub(c[1], c[0]), 3), mul(sub(c[2], c[1]), 3), mul(sub(c[3], c[2]), 3), [0, 0]] as unknown as Cubic;
  const q1 = (t: number): Pt => [
    (1 - t) ** 2 * d1[0][0] + 2 * t * (1 - t) * d1[1][0] + t * t * d1[2][0],
    (1 - t) ** 2 * d1[0][1] + 2 * t * (1 - t) * d1[1][1] + t * t * d1[2][1],
  ];
  const d2a = mul(sub(d1[1], d1[0]), 2);
  const d2b = mul(sub(d1[2], d1[1]), 2);
  const q2 = (t: number): Pt => [(1 - t) * d2a[0] + t * d2b[0], (1 - t) * d2a[1] + t * d2b[1]];
  return u.map((t, i) => {
    const p = at(c, t);
    const d = sub(p, pts[i]);
    const a = q1(t);
    const b = q2(t);
    const num = dot(d, a as V);
    const den = dot(a as V, a as V) + dot(d, b as V);
    if (Math.abs(den) < 1e-12) return t;
    return Math.max(0, Math.min(1, t - num / den));
  });
}
