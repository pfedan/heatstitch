import type { Pt } from '../digitize/skeleton';
import type { FringeSide, Rails } from './restitch';

/**
 * A satin with a frayed edge read from its stitches: on a side whose penetrations end short of
 * the side's edge by uneven depths (hair, feathers, grass), the rail is the edge they fall short
 * of, and the fringe is how deep they do. Smooth sides stay as they are.
 */

/** Neighbours on each side a penetration's edge is found among. */
const REACH = 3;
/** A side is frayed when half its penetrations end at least this short of the edge (mm)... */
const MEDIAN = 0.15;
/** ...and the deepest tenth at least this (mm). */
const DEEP = 0.3;
/** ...and the reach of neighbouring stitches differs by at least this (mm, half the time). */
const ROUGH = 0.3;
/** Fewest pairs a column needs to tell a frayed side from a taper. */
const FEWEST = 8;

const add = (a: Pt, b: Pt, t = 1): Pt => [a[0] + b[0] * t, a[1] + b[1] * t];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];

function quantile(xs: number[], q: number): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0;
}

/** Points averaged over `r` neighbours on each side. */
function smooth(pts: Pt[], r: number): Pt[] {
  return pts.map((_, i) => {
    let x = 0;
    let y = 0;
    let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(pts.length - 1, i + r); j++) {
      x += pts[j][0];
      y += pts[j][1];
      n++;
    }
    return [x / n, y / n];
  });
}

export interface ReadFringe {
  /** The rails along the edges the stitches fall short of. */
  rails: Rails;
  /** How deep the fringe is on the left and the right rail (mm, 0: smooth). */
  left: number;
  right: number;
  /** Distance from one pair to the next along the middle of the column (mm). */
  spacing: number;
}

/**
 * The fringe of a satin column read from its rails (penetration pairs, as railsOf reads them), or
 * null when neither side is frayed.
 */
export function readFringe(r: Rails): ReadFringe | null {
  const n = Math.min(r.left.length, r.right.length);
  if (n < FEWEST || r.rungs) return null;
  const mid = smooth(
    Array.from({ length: n }, (_, i) => add(r.left[i], sub(r.right[i], r.left[i]), 0.5)),
    REACH + 1,
  );
  // Across the column at each pair, towards the left rail.
  const across: Pt[] = mid.map((_, i) => {
    const a = mid[Math.max(0, i - 1)];
    const b = mid[Math.min(n - 1, i + 1)];
    let u: Pt = [-(b[1] - a[1]), b[0] - a[0]];
    if (dot(u, sub(r.left[i], r.right[i])) < 0) u = [-u[0], -u[1]];
    const l = Math.hypot(u[0], u[1]) || 1;
    return [u[0] / l, u[1] / l];
  });
  const side = (rail: Pt[], sign: 1 | -1) => {
    const d = Array.from({ length: n }, (_, i) => sign * dot(sub(rail[i], mid[i]), across[i]));
    // The edge: the farthest reach among the neighbours, evened out a little.
    const most = d.map((_, i) => Math.max(...d.slice(Math.max(0, i - REACH), i + REACH + 1)));
    const edge = most.map((_, i) => {
      const w = most.slice(Math.max(0, i - 1), i + 2);
      return Math.max(d[i], w.reduce((s, v) => s + v, 0) / w.length);
    });
    const short = edge.map((e, i) => e - d[i]);
    // Frayed, not tapering or curving: the reach jumps from one stitch to the next.
    const rough = quantile(d.slice(1, -1).map((v, i) => Math.abs(d[i] - 2 * v + d[i + 2])), 0.5);
    const frayed = rough >= ROUGH && quantile(short, 0.5) >= MEDIAN && quantile(short, 0.9) >= DEEP;
    return {
      depth: frayed ? Math.round(quantile(short, 0.98) * 10) / 10 : 0,
      rail: frayed ? mid.map((m, i) => add(m, across[i], sign * edge[i])) : rail.slice(0, n),
    };
  };
  const L = side(r.left, 1);
  const R = side(r.right, -1);
  if (!L.depth && !R.depth) return null;
  let along = 0;
  for (let i = 1; i < n; i++) along += Math.hypot(mid[i][0] - mid[i - 1][0], mid[i][1] - mid[i - 1][1]);
  return { rails: { left: L.rail, right: R.rail }, left: L.depth, right: R.depth, spacing: along / (n - 1) };
}

/**
 * The fringe of a satin part from the rails of its columns as their penetrations have them (with
 * the dents of short stitches evened out, so a curve sewn with them is no fringe): the columns with the rails along the edges their stitches fall short of, how deep
 * the deepest side is, and on which side (as the settings say it: 'left' frays the right rail);
 * no side where both fray; and the spacing along the frayed columns. Null when no column is frayed.
 */
export function partFringe(columns: Rails[]): { columns: (Rails | null)[]; fringe: number; side?: FringeSide; spacing: number } | null {
  const read = columns.map(readFringe);
  if (!read.some(Boolean)) return null;
  const left = read.some((f) => f?.left);
  const right = read.some((f) => f?.right);
  const fringe = Math.max(...read.map((f) => Math.max(f?.left ?? 0, f?.right ?? 0)));
  const side: FringeSide | undefined = left && right ? undefined : left ? 'right' : 'left';
  const frayed = read.filter((f): f is ReadFringe => !!f);
  const spacing = frayed.reduce((a, f) => a + f.spacing, 0) / frayed.length;
  return { columns: read.map((f) => f?.rails ?? null), fringe, spacing, ...(side ? { side } : {}) };
}
