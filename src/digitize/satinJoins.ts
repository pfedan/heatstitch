import { lineRails, resample } from './border';
import type { Pt } from './skeleton';

/**
 * Corners and ends of a satin along a line (a drawn line, an SVG stroke), made as changes of its
 * rails before it is stitched: the stitch generator then sews the rails as they are, a stitch for
 * each pair of points (see Rails without rungs).
 *
 * A corner is a bend of CORNER_DEG or more within about half the width (a real corner, not a
 * curve; a fillet tighter than the satin is wide counts too). Without corner handling the rails
 * of a satin round a corner fold over on the inside and fan on the outside, piling stitches up at
 * the inner corner. At a corner both arms run straight to it, the inside rail ends where the inner
 * edges of both arms meet, and the stitches turn from square on the first arm to square on the
 * second over a column width on each side (as digitizers place a bisector rung with square rungs
 * a width before and after). The outside takes the corner's form (Wilcom's smart corners):
 *
 * - `miter`: the outer edges meet in a point, the turning stitch on the bisector;
 * - `cap`: the outer corner cut off square to the bisector, the stitches fanning over the cut;
 * - `round`: the outer corner rounded about the corner point, half the width out;
 * - `overlap` (lapped): no turning; the first arm runs on square past the corner until it covers
 *   it, the second starts square behind it and lies on top.
 *
 * A miter (the default) is capped where the turn is CAP_DEG or sharper (an inside angle under 20°,
 * Wilcom's "cap below" default): there it would reach about six widths out.
 *
 * Ends (SVG stroke-linecap): `flat` square across at the end of the line, `square` the same half a
 * width further on, `round` a half circle, its stitches square across the line and shorter towards
 * the tip.
 */
export type SatinCorner = 'miter' | 'cap' | 'round' | 'overlap';
export const SATIN_CORNERS: SatinCorner[] = ['miter', 'cap', 'round', 'overlap'];
export type SatinEnd = 'flat' | 'round' | 'square';
export const SATIN_ENDS: SatinEnd[] = ['flat', 'round', 'square'];

/** A bend from this many degrees is a corner (Daniel's rule: a turn of 45° or more). */
export const CORNER_DEG = 45;
/** A miter caps a corner turning this much or more: it would grow too long. */
export const CAP_DEG = 160;

/** Points of the line this far apart when looking for corners (mm). */
const STEP = 0.1;
/** Pairs of points this far apart on the rails made here (mm). */
const PAIR = 0.1;

type Rails = { left: Pt[]; right: Pt[] };

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/** The left normal of a direction, as lineRails takes it. */
const leftOf = (d: Pt): Pt => [-d[1], d[0]];
const lengthOf = (l: Pt[]) => l.reduce((s, q, i) => (i ? s + dist(l[i - 1], q) : 0), 0);

interface Corner {
  /** Where the arms meet. */
  at: Pt;
  din: Pt;
  dout: Pt;
  /** Turn in degrees. */
  turn: number;
  /** Indices of the line where the straight arms to the corner start and end. */
  i0: number;
  i1: number;
}

/**
 * The corners of a line given as points STEP apart (closed: the first point repeated at the end):
 * where it turns by CORNER_DEG or more within `arm` on both sides, at the sharpest point; where
 * two are nearer than two arms, the sharper one.
 */
function cornersOf(pts: Pt[], closed: boolean, arm: number): Corner[] {
  const n = closed ? pts.length - 1 : pts.length;
  const k = Math.max(2, Math.round(arm / STEP));
  if (n < 2 * k + 1) return [];
  const at = (i: number) => (closed ? pts[((i % n) + n) % n] : pts[i]);
  const lo = closed ? 0 : k;
  const hi = closed ? n - 1 : n - 1 - k;
  const turn = new Map<number, { t: number; din: Pt; dout: Pt }>();
  for (let i = lo; i <= hi; i++) {
    const din = norm(sub(at(i), at(i - k)));
    const dout = norm(sub(at(i + k), at(i)));
    turn.set(i, { t: (Math.acos(Math.max(-1, Math.min(1, dot(din, dout)))) * 180) / Math.PI, din, dout });
  }
  const found = [...turn.entries()].filter(([, v]) => v.t >= CORNER_DEG).sort((a, b) => b[1].t - a[1].t || a[0] - b[0]);
  const gap = (a: number, b: number) => (closed ? Math.min(((a - b) % n + n) % n, ((b - a) % n + n) % n) : Math.abs(a - b));
  const chosen: Corner[] = [];
  for (const [i, v] of found) {
    if (chosen.some((c) => gap(c.i0 + k, i) < 2 * k)) continue;
    const p = at(i - k);
    const q = at(i + k);
    // Where the straight arms meet; the line's own point where they hardly cross (a hairpin).
    const den = cross(v.din, v.dout);
    let c = at(i);
    if (Math.abs(den) > 0.05) {
      const t = cross(sub(q, p), v.dout) / den;
      const x = add(p, mul(v.din, t));
      if (dist(x, at(i)) < 2 * arm) c = x;
    }
    chosen.push({ at: c, din: v.din, dout: v.dout, turn: v.t, i0: i - k, i1: i + k });
  }
  return chosen.sort((a, b) => a.i0 - b.i0);
}

/** The pairs of `r` whose middle lies from `from` to `len - to` along the middle (mm), cut exactly there. */
function trimmed(r: Rails, from: number, to: number): Rails {
  const c = r.left.map((l, i) => mid(l, r.right[i]));
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + dist(c[i - 1], c[i]));
  const len = cum[cum.length - 1];
  const a = Math.min(from, len);
  const b = Math.max(a, len - to);
  const at = (s: number): [Pt, Pt] => {
    let i = 1;
    while (i < c.length - 1 && cum[i] < s) i++;
    const t = cum[i] > cum[i - 1] ? Math.min(1, Math.max(0, (s - cum[i - 1]) / (cum[i] - cum[i - 1]))) : 0;
    const lp = (u: Pt, v: Pt): Pt => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t];
    return [lp(r.left[i - 1], r.left[i]), lp(r.right[i - 1], r.right[i])];
  };
  const left: Pt[] = [];
  const right: Pt[] = [];
  const put = ([l, q]: [Pt, Pt]) => {
    left.push(l);
    right.push(q);
  };
  put(at(a));
  for (let i = 0; i < c.length; i++) if (cum[i] > a + 1e-6 && cum[i] < b - 1e-6) put([r.left[i], r.right[i]]);
  if (b > a + 1e-6) put(at(b));
  return { left, right };
}

/** Points along a polyline at shares 0..1 (by length). */
function along(line: Pt[], shares: number[]): Pt[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
  const len = cum[cum.length - 1];
  return shares.map((f) => {
    const s = f * len;
    let i = 1;
    while (i < line.length - 1 && cum[i] < s) i++;
    const t = cum[i] > cum[i - 1] ? Math.min(1, Math.max(0, (s - cum[i - 1]) / (cum[i] - cum[i - 1]))) : 0;
    return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
  });
}

/** Pairs between two rungs, walking the inner and outer line at the same share (without the first pair). */
function between(inner: Pt[], outer: Pt[]): [Pt, Pt][] {
  const n = Math.max(1, Math.ceil(Math.max(lengthOf(inner), lengthOf(outer)) / PAIR));
  const f = Array.from({ length: n }, (_, j) => (j + 1) / n);
  const a = along(inner, f);
  const b = along(outer, f);
  return a.map((p, j) => [p, b[j]]);
}

/** The arc about c from c + r·u to c + r·v the short way, points about PAIR apart (both ends kept). */
function arc(c: Pt, r: number, u: Pt, v: Pt): Pt[] {
  const a0 = Math.atan2(u[1], u[0]);
  let da = Math.atan2(v[1], v[0]) - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const n = Math.max(2, 2 * Math.ceil((Math.abs(da) * r) / PAIR / 2));
  return Array.from({ length: n + 1 }, (_, j) => {
    const a = a0 + (da * j) / n;
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Pt;
  });
}

const dedupe = (l: Pt[]) => l.filter((q, i) => !i || dist(q, l[i - 1]) > 1e-6);

/** The style a corner is sewn in. */
export function cornerStyle(style: SatinCorner, turn: number): SatinCorner {
  return style === 'miter' && turn >= CAP_DEG ? 'cap' : style;
}

/**
 * Arm `a` (ending at the corner) and arm `b` (starting there) joined: the pairs that go from the
 * last one kept of a to the first one kept of b, and how far each arm is cut back. `roomA`, `roomB`:
 * how much of each arm the corner may take.
 */
function join(cn: Corner, h: number, style: SatinCorner, roomA: number, roomB: number): { cutA: number; cutB: number; pairs: (aEnd: [Pt, Pt], bStart: [Pt, Pt]) => [Pt, Pt][]; extA: number; extB: number } {
  const { at: c, din, dout } = cn;
  const theta = (cn.turn * Math.PI) / 180;
  if (style === 'overlap') {
    // The first arm on until its middle reaches the far edge of the second (at most a width), the second from as far behind.
    const ext = theta > Math.PI / 2 ? Math.min(2 * h, h / Math.sin(theta)) : h;
    // Between them a pair of no width at the middle of each: the satin passes on to the second
    // arm in one stitch (under it), with no stitches turning across the corner.
    return { cutA: 0, cutB: 0, extA: ext, extB: ext, pairs: (a, b) => [[mid(...a), mid(...a)], [mid(...b), mid(...b)]] };
  }
  const innerLeft = cross(din, dout) > 0;
  const sg = innerLeft ? 1 : -1;
  const nAi = mul(leftOf(din), sg);
  const nBi = mul(leftOf(dout), sg);
  const nAo = mul(nAi, -1);
  const nBo = mul(nBi, -1);
  const e = h * Math.tan(theta / 2);
  const eA = Math.min(e, roomA);
  const eB = Math.min(e, roomB);
  const cutA = Math.min(e + 2 * h, roomA);
  const cutB = Math.min(e + 2 * h, roomB);
  const pairs = (aEnd: [Pt, Pt], bStart: [Pt, Pt]): [Pt, Pt][] => {
    const [ia, oa] = innerLeft ? aEnd : [aEnd[1], aEnd[0]];
    const [ib, ob] = innerLeft ? bStart : [bStart[1], bStart[0]];
    // Inside: where the inner edges meet (or as near as the arms allow).
    const iA = add(add(c, mul(din, -eA)), mul(nAi, h));
    const iB = add(add(c, mul(dout, eB)), mul(nBi, h));
    const iMid = mid(iA, iB);
    // Outside by the corner's form, through its middle point.
    let o1: Pt[];
    let o2: Pt[];
    if (style === 'miter') {
      const o = add(c, mul(add(nAo, nBo), h / (1 + Math.cos(theta))));
      o1 = [oa, o];
      o2 = [o, ob];
    } else if (style === 'cap') {
      const p = add(c, mul(nAo, h));
      const q = add(c, mul(nBo, h));
      const m = mid(p, q);
      o1 = [oa, p, m];
      o2 = [m, q, ob];
    } else {
      const ring = arc(c, h, nAo, nBo);
      const k = ring.length >> 1;
      o1 = [oa, ...ring.slice(0, k + 1)];
      o2 = [...ring.slice(k), ob];
    }
    const first = between(dedupe([ia, iA, iMid]), dedupe(o1));
    const second = between(dedupe([iMid, iB, ib]), dedupe(o2)).slice(0, -1);
    return [...first, ...second].map(([i, o]) => (innerLeft ? [i, o] : [o, i]));
  };
  return { cutA, cutB, extA: 0, extB: 0, pairs };
}

/** Rails taken on straight past their end (`atEnd`) or before their start by `ext` mm, square across. */
function extended(r: Rails, ext: number, atEnd: boolean, shape: (x: number, h: number) => number = (_, h) => h, step = 0.2): Rails {
  if (ext <= 0 || r.left.length < 2) return r;
  const k = atEnd ? r.left.length - 1 : 0;
  const l = r.left[k];
  const q = r.right[k];
  const c = mid(l, q);
  const h = dist(l, q) / 2;
  const n = norm(sub(l, q));
  // Along the line, outward from this end.
  const d: Pt = atEnd ? [n[1], -n[0]] : [-n[1], n[0]];
  const m = Math.max(1, Math.round(ext / step));
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let j = 1; j <= m; j++) {
    const x = (ext * j) / m;
    const w = shape(x, h);
    const p = add(c, mul(d, x));
    left.push(add(p, mul(n, w)));
    right.push(add(p, mul(n, -w)));
  }
  if (atEnd) return { left: [...r.left, ...left], right: [...r.right, ...right] };
  return { left: [...left.reverse(), ...r.left], right: [...right.reverse(), ...r.right] };
}

/** The open rails with their ends in `style`. */
export function withEnds(r: Rails, style: SatinEnd | undefined): Rails {
  if (!style || style === 'flat' || r.left.length < 2) return r;
  const h0 = dist(r.left[0], r.right[0]) / 2;
  const h1 = dist(r.left[r.left.length - 1], r.right[r.right.length - 1]) / 2;
  if (style === 'square') return extended(extended(r, h0, false), h1, true);
  // Round: a half circle, its stitches square across and shorter towards the tip.
  const round = (x: number, h: number) => Math.sqrt(Math.max(0, h * h - x * x));
  return extended(extended(r, h0, false, round, PAIR), h1, true, round, PAIR);
}

/**
 * Rails of a satin `w` wide centered on `line` (closed: its first point repeated at the end), with
 * its corners in `corner` and its ends in `ends` (an open line only); see the top.
 */
export function strokeRails(line: Pt[], closed: boolean, w: number, corner: SatinCorner = 'miter', ends: SatinEnd = 'flat'): Rails {
  const h = w / 2;
  const pts = line.length >= 2 ? resample(line, STEP) : line;
  const corners = pts.length >= 2 ? cornersOf(pts, closed, Math.max(0.4, h)) : [];
  if (!corners.length) {
    const r = lineRails(line, closed, w);
    return closed ? r : withEnds(r, ends);
  }
  // A closed line is opened half way between two corners, so it starts and ends on a straight stretch.
  let seq = pts;
  let cs = corners;
  if (closed) {
    const n = pts.length - 1;
    const a = corners[0].i0 + corners[0].i1;
    const b = corners.length > 1 ? corners[1].i0 + corners[1].i1 : a + 2 * n;
    const start = (((Math.round((a + b) / 4)) % n) + n) % n;
    seq = Array.from({ length: n + 1 }, (_, j) => pts[(start + j) % n]);
    cs = corners
      .map((c) => {
        const sh = (i: number) => (((i - start) % n) + n) % n;
        return { ...c, i0: sh(c.i0), i1: sh(c.i0) + (c.i1 - c.i0) };
      })
      .sort((x, y) => x.i0 - y.i0);
  }
  // Arms: straight to each corner and on from it, each sewn along its own rails.
  const arms: Pt[][] = [];
  let from = 0;
  let head: Pt | null = null;
  for (const c of cs) {
    arms.push([...(head ? [head] : []), ...seq.slice(from, c.i0 + 1), c.at]);
    from = c.i1;
    head = c.at;
  }
  arms.push([head!, ...seq.slice(from)]);
  const room = arms.map((a, k) => {
    const len = lengthOf(a);
    const both = k > 0 && k < arms.length - 1;
    return Math.max(0, both ? len / 2 - 0.1 : len - 0.2);
  });
  const joins = cs.map((c, k) => join(c, h, cornerStyle(corner, c.turn), room[k], room[k + 1]));
  const rails = arms.map((a, k) => {
    let r = lineRails(dedupe(a), false, w);
    r = trimmed(r, k > 0 ? joins[k - 1].cutB : 0, k < joins.length ? joins[k].cutA : 0);
    if (k > 0) r = extended(r, joins[k - 1].extB, false);
    if (k < joins.length) r = extended(r, joins[k].extA, true);
    return r;
  });
  const left: Pt[] = [];
  const right: Pt[] = [];
  rails.forEach((r, k) => {
    if (k > 0) {
      const prev = rails[k - 1];
      const z = joins[k - 1].pairs([prev.left[prev.left.length - 1], prev.right[prev.right.length - 1]], [r.left[0], r.right[0]]);
      for (const [l, q] of z) {
        left.push(l);
        right.push(q);
      }
    }
    left.push(...r.left);
    right.push(...r.right);
  });
  if (closed) {
    left.push(left[0]);
    right.push(right[0]);
    return { left, right };
  }
  return withEnds({ left, right }, ends);
}
