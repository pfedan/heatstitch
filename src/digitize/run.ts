import type { Pt } from './skeleton';

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/**
 * How far a stitch may lie from the line it follows by default (mm): a straight stitch cuts every
 * curve, by L² / 8R for a stitch of length L on a radius R. Below a third of the thread's width
 * the cut does not show.
 */
export const TOLERANCE = 0.15;
/** Stitches shortened for a curve stay at least this long (mm); shorter ones are short-stitch findings. */
export const MIN_CURVE_STITCH = 1;

/** Douglas-Peucker simplification with tolerance `tol` (mm). */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const l = Math.hypot(dx, dy);
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = l > 0 ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / l : dist(pts[i], pts[a]);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Distance from p to the segment a-b. */
function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

/** A polyline with its arc length, for points at a distance along it. */
export class Path {
  readonly cum: number[] = [0];
  readonly total: number;
  constructor(readonly pts: Pt[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + dist(pts[i - 1], pts[i]));
    this.total = this.cum[this.cum.length - 1];
  }

  /** Index of the first point further along than s. */
  private after(s: number): number {
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] > s) hi = m;
      else lo = m + 1;
    }
    return lo;
  }

  /** Point at arc length s. */
  at(s: number): Pt {
    const pts = this.pts;
    if (pts.length < 2) return pts[0];
    const i = Math.max(1, Math.min(pts.length - 1, this.after(s)));
    const l = this.cum[i] - this.cum[i - 1];
    const t = l > 0 ? Math.max(0, Math.min(1, (s - this.cum[i - 1]) / l)) : 0;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }

  /** How far the line between arc lengths s0 and s1 strays from the straight stitch between them. */
  deviation(s0: number, s1: number): number {
    const a = this.at(s0);
    const b = this.at(s1);
    let d = 0;
    for (let i = this.after(s0); i < this.pts.length && this.cum[i] < s1; i++) d = Math.max(d, toSegment(this.pts[i], a, b));
    return d;
  }

  /**
   * Arc lengths of the needle points from `from` to `to` (without `from`, with `to`): stitches of
   * equal length, at most `len`, where that keeps every stitch within `tol` of the line; else each
   * stitch as long as it may be (not below MIN_CURVE_STITCH), so curves get shorter stitches and
   * straight stretches keep theirs.
   */
  marks(from: number, to: number, len: number, tol: number): number[] {
    const total = to - from;
    if (total <= 1e-9) return [];
    const even = (n: number) => Array.from({ length: n }, (_, k) => from + (total * (k + 1)) / n);
    const n0 = Math.max(1, Math.ceil(total / len - 1e-9));
    const plain = even(n0);
    if (plain.every((s, k) => this.deviation(k ? plain[k - 1] : from, s) <= tol)) return plain;
    const min = Math.min(MIN_CURVE_STITCH, len);
    const out: number[] = [];
    let a = from;
    while (to - a > 1e-9) {
      let hi = Math.min(a + len, to);
      let b = hi;
      if (this.deviation(a, hi) > tol) {
        let lo = Math.min(a + min, hi);
        if (this.deviation(a, lo) <= tol) {
          for (let it = 0; it < 14 && hi - lo > 0.01; it++) {
            const m = (lo + hi) / 2;
            if (this.deviation(a, m) <= tol) lo = m;
            else hi = m;
          }
        }
        b = lo;
      }
      // No short stitch left over at the end: the rest in two halves instead.
      if (b < to && to - b < min) b = to - a >= 2 * min ? (a + to) / 2 : to;
      out.push(b);
      a = b;
    }
    // As many stitches of equal length (or one more) look calmer, where they fit as well. Where
    // the shortest stitch keeps any from fitting, the closest of them.
    const options = [even(out.length), even(out.length + 1), out];
    const worst = (m: number[]) => Math.max(...m.map((s, k) => this.deviation(k ? m[k - 1] : from, s)));
    const devs = options.map(worst);
    const ok = devs.findIndex((d) => d <= tol);
    return options[ok >= 0 ? ok : devs.indexOf(Math.min(...devs))];
  }
}

/**
 * Running stitch along a polyline: corners sharper than 45 degrees get a needle point, and between
 * them the stitches are of equal length, at most `len` (like Ink/Stitch's even running stitch). On
 * curves they get shorter until no stitch is further than `tol` from the line (the line simplified
 * by up to half of it first, at most 0.1 mm, which drops the steps of a traced edge).
 * Returns the needle points including both ends.
 */
export function runStitch(pts: Pt[], len: number, tol = TOLERANCE): Pt[] {
  const simple = Math.min(0.1, tol / 2);
  const s = simplify(pts, simple);
  if (s.length < 2) return s;
  // Split at sharp corners.
  const pieces: Pt[][] = [[s[0]]];
  for (let i = 1; i < s.length; i++) {
    pieces[pieces.length - 1].push(s[i]);
    if (i < s.length - 1) {
      const a = [s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]];
      const b = [s[i + 1][0] - s[i][0], s[i + 1][1] - s[i][1]];
      const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1);
      if (cos < Math.SQRT1_2) pieces.push([s[i]]);
    }
  }
  const out: Pt[] = [s[0]];
  for (const piece of pieces) {
    const path = new Path(piece);
    if (path.total < 0.05) continue;
    for (const m of path.marks(0, path.total, len, Math.max(0.02, tol - simple))) out.push(path.at(m));
  }
  return out;
}
