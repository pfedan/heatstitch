import { core } from '../wasm/core';
import type { LinesOut } from '../wasm/pkg/heatstitch_core';
import { flatOf, linesOf, ptsOf } from './fill';
import { regionIn, type Region } from './region';
import { TOLERANCE } from './run';
import type { Pt } from './skeleton';

/**
 * A border sewn around a fill on its edge (what Ink/Stitch sews for the stroke of a filled path,
 * and digitizing software calls an outline): a running stitch, a triple (bean) stitch or a satin
 * of a set width, centered on the edge, around the outside and every hole; or an open zigzag, or
 * an E stitch (blanket stitch) with its edge on the line, as appliqué is sewn on; or a motif
 * repeated along it (motif.ts).
 *
 * The loops, rails and runs are computed by the Rust core (core/src/digitize/border.rs); picking
 * the parts to sew (a callback per point) and the order of loops stay here.
 */

export type BorderType = 'run' | 'triple' | 'satin' | 'zigzag' | 'e' | 'motif';

/** Stitch length of a running or triple border (mm). */
export const BORDER_STITCH = 2.5;
/** Satin border width the panel starts with (mm). */
export const BORDER_WIDTH = 2;
/** Loops shorter than this are left without a border (mm). */
const MIN_LOOP = 1.5;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * The edge of the area as closed lines (first point repeated at the end), long enough to sew;
 * `offset` mm outside it (inside when negative).
 */
export function borderLoops(r: Region, offset = 0): Pt[][] {
  return lines(core().borderLoops(regionIn(r), offset));
}

/** Lines the core made. */
function lines(o: LinesOut): Pt[][] {
  const l = linesOf(o.takePts(), o.takeLens());
  o.free();
  return l;
}

/** Evenly spaced points along a line, `step` apart (both ends kept). */
export function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = dist(a, b);
    let t = step - carry;
    while (t <= l) {
      out.push([a[0] + ((b[0] - a[0]) * t) / l, a[1] + ((b[1] - a[1]) * t) / l]);
      t += step;
    }
    carry = l - (t - step);
  }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > step * 0.3) out.push(pts[pts.length - 1]);
  else out[out.length - 1] = pts[pts.length - 1];
  return out;
}

/**
 * Rails of a satin of width `w` centered on a closed line `level` mm outside the edge (inside
 * when negative). Each side reaches half the width along the normal, less where the band around
 * that line is narrower (inside a corner), so the rails do not fold over at corners.
 */
export function borderRails(r: Region, loop: Pt[], w: number, level = 0): { left: Pt[]; right: Pt[] } {
  const { left, right } = railsAlong(r, loop, w, level);
  return { left, right };
}

/** borderRails, with the points of the line they are centered on (one per rail point). */
function railsAlong(r: Region, loop: Pt[], w: number, level: number): { left: Pt[]; right: Pt[]; center: Pt[] } {
  const [left, right, center] = lines(core().borderRails(regionIn(r), flatOf(loop), w, level, true));
  return { left, right, center };
}

/**
 * Index ranges of a closed line's n points where `keep` holds, in order along it: [0, n] (the
 * whole line) when it holds everywhere; ranges may run past n (wrap around).
 */
function keptRanges(n: number, keep: (i: number) => boolean, closedLen: number): [number, number][] {
  const flags = Array.from({ length: n }, (_, i) => keep(i));
  if (flags.every(Boolean)) return [[0, closedLen]];
  if (!flags.some(Boolean)) return [];
  // From the first point dropped, so no piece runs over the line's start.
  const s0 = flags.indexOf(false);
  const out: [number, number][] = [];
  let from = -1;
  for (let k = 1; k <= n; k++) {
    const i = (s0 + k) % n;
    if (flags[i] && from < 0) from = s0 + k;
    if ((!flags[i] || k === n) && from >= 0) {
      out.push([from, s0 + k - (flags[i] ? 0 : 1)]);
      from = -1;
    }
  }
  return out;
}

/** Points i..j (inclusive, wrapping around the closed line's n distinct points). */
const span = <T>(pts: T[], n: number, a: number, b: number): T[] => Array.from({ length: b - a + 1 }, (_, k) => pts[(a + k) % n]);

const lengthOf = (l: Pt[]) => l.reduce((s, q, i) => (i ? s + dist(l[i - 1], q) : 0), 0);

/** borderRails cut where `keep` does not hold at the line they are centered on: one rails pair per piece. */
export function keptRails(r: Region, loop: Pt[], w: number, level: number, keep: (q: Pt) => boolean): { left: Pt[]; right: Pt[] }[] {
  const { left, right, center } = railsAlong(r, loop, w, level);
  const n = center.length - 1;
  return keptRanges(n, (i) => keep(center[i]), n)
    .map(([a, b]) => (b - a === n ? { left, right, len: Infinity } : { left: span(left, n, a, b), right: span(right, n, a, b), len: lengthOf(span(center, n, a, b)) }))
    .filter((c) => c.len >= MIN_LOOP)
    .map(({ left, right }) => ({ left, right }));
}

/**
 * Rails of a satin of width `w` centered on a line with no area around it (a drawn line): each
 * side half the width out along the normal. A closed line repeats its first point at the end.
 */
export function lineRails(line: Pt[], closed: boolean, w: number): { left: Pt[]; right: Pt[] } {
  const [left, right] = lines(core().lineRails(flatOf(line), closed, w));
  return { left, right };
}

/** Running stitch along a line (closed or not), each stitch sewn `times` times (3 or 5: bean stitch). */
export function borderRun(loop: Pt[], times = 1, tol = TOLERANCE, len = BORDER_STITCH): Pt[] {
  return ptsOf(core().borderRun(flatOf(loop), times, tol, len));
}
