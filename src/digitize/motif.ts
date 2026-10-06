import { runStitch } from './run';
import type { Pt } from './skeleton';

/**
 * Motif stitch: a small figure repeated along a line, sewn as one running stitch (what Brother and
 * Ink/Stitch call a motif or pattern line). The figures follow the line's curve; their size is the
 * width across the line, their period the distance from one to the next along it, stretched a
 * little so a whole number of them fits the line.
 */

export type LineMotif = 'waves' | 'scallops' | 'hearts' | 'chain';
export const LINE_MOTIFS: LineMotif[] = ['waves', 'scallops', 'hearts', 'chain'];

/** Distance from one figure to the next (mm) when none is set. */
export const MOTIF_PERIOD: Record<LineMotif, number> = { waves: 5, scallops: 4, hearts: 8, chain: 2.2 };

/** Size of a motif across the line the panel starts with (mm). */
export const MOTIF_WIDTH = 3;

/** Motifs with a side: they stand on the line and reach out to one side of it. */
export const SIDED_MOTIFS: LineMotif[] = ['scallops', 'hearts'];

/** Steps of the fine path a motif is drawn as before it gets its needle points (mm). */
const FINE = 0.1;
/** Shortest stitch of a motif (mm): the figures are small, the needle needs room. */
const MIN_STITCH = 0.6;
/** Longest stitch of a motif (mm), and how close its stitches keep to the figure: small figures need short stitches to stay round. */
const MOTIF_STITCH = 1.2;
const MOTIF_TOLERANCE = 0.05;

/** A line by arc length: the point at `s` mm and the unit normal there (to the right on screen, y down). */
function frame(line: Pt[], closed: boolean) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum[cum.length - 1];
  const point = (s: number): Pt => {
    s = closed && total > 0 ? ((s % total) + total) % total : Math.max(0, Math.min(total, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return [line[lo][0] + (line[hi][0] - line[lo][0]) * t, line[lo][1] + (line[hi][1] - line[lo][1]) * t];
  };
  // The normal from the line a little before and after, so a node does not kink the figures.
  const normal = (s: number): Pt => {
    const a = point(closed ? s - 0.5 : Math.max(0, s - 0.5));
    const b = point(closed ? s + 0.5 : Math.min(total, s + 0.5));
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  /** The point `off` mm out along the normal at `s`. */
  const at = (s: number, off = 0): Pt => {
    const p = point(s);
    if (!off) return p;
    const n = normal(s);
    return [p[0] + n[0] * off, p[1] + n[1] * off];
  };
  return { total, at, point, normal };
}

/**
 * The needle points of `motif` along `line` (closed: first point repeated at the end): `width` mm
 * across, one figure every `period` mm, on the side `side` (1: the normal's, -1: the other).
 */
export function motifStitches(line: Pt[], closed: boolean, motif: LineMotif, width: number, period: number, side: 1 | -1 = 1): Pt[] {
  const f = frame(line, closed);
  if (f.total < 0.5) return [];
  const count = Math.max(1, Math.round(f.total / Math.max(0.5, period)));
  const d = f.total / count;
  const fine: Pt[] = [];
  const run = (a: number, b: number) => {
    for (let s = a; s < b; s += FINE) fine.push(f.at(s));
    fine.push(f.at(b));
  };
  if (motif === 'waves') {
    const n = Math.ceil(f.total / FINE);
    for (let i = 0; i <= n; i++) {
      const s = (f.total * i) / n;
      fine.push(f.at(s, (width / 2) * Math.sin((2 * Math.PI * s) / d)));
    }
  } else if (motif === 'scallops') {
    const h = width * side;
    for (let k = 0; k < count; k++) {
      const steps = Math.max(8, Math.ceil(d / FINE));
      for (let i = k ? 1 : 0; i <= steps; i++) {
        const t = i / steps;
        fine.push(f.at(k * d + t * d, h * Math.sin(Math.PI * t)));
      }
    }
  } else if (motif === 'hearts') {
    // A heart on the line every period, hanging from it; a running stitch between them.
    // No wider than 90 % of the period (a heart is 32 parts wide for 22 from notch to tip).
    const size = Math.min(width, ((d * 0.9) / 32) * 22);
    let s = 0;
    for (let k = 0; k < count; k++) {
      const at = k * d + d / 2;
      run(s, at);
      fine.push(...heart(f, at, size, side));
      s = at;
    }
    run(s, f.total);
  } else {
    // Chain stitch look: a teardrop loop forward from each point, the next starting inside it.
    const link = d * 1.35;
    for (let k = 0; k < count; k++) {
      const s0 = k * d;
      const steps = Math.max(12, Math.ceil((2 * link) / FINE));
      for (let i = 0; i <= steps; i++) {
        const t = (2 * Math.PI * i) / steps;
        const u = (1 - Math.cos(t)) / 2;
        fine.push(f.at(Math.min(s0 + u * link, closed ? s0 + u * link : f.total), (Math.sin(t) * width * (0.5 + 0.5 * u)) / 2));
      }
      run(s0, Math.min(f.total, s0 + d));
    }
  }
  const pts = runStitch(fine, MOTIF_STITCH, MOTIF_TOLERANCE);
  return dropShort(pts);
}

/**
 * A heart hanging from the line at `s` by the notch between its lobes, its tip `size` mm out to the
 * side (upright below a line drawn left to right), drawn around once from the notch. Its lobes reach a
 * third of that over the line.
 */
function heart(f: ReturnType<typeof frame>, s: number, size: number, side: 1 | -1): Pt[] {
  const o = f.point(s);
  const n = f.normal(s);
  const tdir: Pt = [n[1], -n[0]];
  const out: Pt[] = [];
  // The classic heart curve: notch at t = 0 (y 5), tip at t = pi (y -17), lobes up to y 12, 32 wide.
  for (let i = 0; i <= 60; i++) {
    const t = (2 * Math.PI * i) / 60;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const a = (x / 22) * size;
    const b = ((5 - y) / 22) * size * side;
    out.push([o[0] + tdir[0] * a + n[0] * b, o[1] + tdir[1] * a + n[1] * b]);
  }
  return out;
}

/** Needle points without stitches shorter than MIN_STITCH (the ends stay). */
function dropShort(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const q = out[out.length - 1];
    if (Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) >= MIN_STITCH) out.push(pts[i]);
  }
  const last = pts[pts.length - 1];
  if (out.length > 1 && Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) < MIN_STITCH) out.pop();
  out.push(last);
  return out;
}
