import { sample, type Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { columnOf, type Rails } from '../model/restitch';

/**
 * Letters that overlap are sewn there once. Where a letter sewn later lies on one sewn before (in
 * a script the end of a letter runs into the next one; letters set close run into each other),
 * the stitches below are not seen, only felt: twice the thread, a hard spot, needles that break.
 * As lettering in Embrilliance does ("remove hidden stitches"), the letter below leaves out every
 * stitch that lies wholly under a letter on top. A stitch only partly under stays whole, so the
 * letter below still reaches under the one on top and no fabric shows between them; nothing is
 * cut, so no short stitches or needle holes side by side come up (cutting stitches at the edge, as
 * measured, made more dense spots than it took away). What is left out is crossed by a few running
 * stitches hidden under the letter on top, so every piece starts and ends where the font has it:
 * joins and trims stay as they were.
 *
 * What a satin covers is the strip between its rails: it is sewn wider by its pull compensation
 * and pulls in to about that width on the fabric.
 */

/** What an element of a letter covers. */
export interface Cover {
  inside: (p: Pt) => boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Longest running stitch hidden under the letter on top (mm). */
const TRAVEL = 2;
/** How many stitches ahead a running stitch may reach (satin stitches lie closer than 0.2 mm apart along the column). */
const REACH = 24;
/** A stitch is followed this finely to see whether it lies under a cover (mm). */
const STEP = 0.1;

interface Quad {
  pts: [Pt, Pt, Pt, Pt];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Whether `p` lies in the quadrilateral (crossings counted, so either orientation). */
function inQuad(q: Quad, p: Pt): boolean {
  if (p[0] < q.minX || p[0] > q.maxX || p[1] < q.minY || p[1] > q.maxY) return false;
  let c = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q.pts[i];
    const b = q.pts[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * What a satin column covers: the strip between its rails, piece by piece from rung to rung (so a
 * column that crosses itself, as in a loop, covers the crossing too).
 */
export function satinCover(rails: Rails): Cover | null {
  const { left, right } = columnOf(rails);
  const n = Math.min(left.length, right.length);
  if (n < 2) return null;
  const quads: Quad[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const pts: [Pt, Pt, Pt, Pt] = [left[i], left[i + 1], right[i + 1], right[i]];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    quads.push({ pts, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
  }
  return {
    inside: (p) => quads.some((q) => inQuad(q, p)),
    minX: Math.min(...quads.map((q) => q.minX)),
    minY: Math.min(...quads.map((q) => q.minY)),
    maxX: Math.max(...quads.map((q) => q.maxX)),
    maxY: Math.max(...quads.map((q) => q.maxY)),
  };
}

/** What a fill covers: its area as sewn. */
export function fillCover(r: Region): Cover {
  return {
    inside: (p) => sample(r, r.sdfBase, p[0], p[1]) < 0,
    minX: r.x0 * r.pxMm,
    minY: r.y0 * r.pxMm,
    maxX: (r.x0 + r.w) * r.pxMm,
    maxY: (r.y0 + r.h) * r.pxMm,
  };
}

/** Whether `p` lies under a cover. */
function under(covers: Cover[], p: Pt): boolean {
  for (const c of covers) if (p[0] >= c.minX && p[0] <= c.maxX && p[1] >= c.minY && p[1] <= c.maxY && c.inside(p)) return true;
  return false;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Whether the stitch a→b lies under the covers along its whole length. */
function hidden(covers: Cover[], a: Pt, b: Pt): boolean {
  const n = Math.max(1, Math.ceil(dist(a, b) / STEP));
  for (let k = 0; k <= n; k++) if (!under(covers, lerp(a, b, k / n))) return false;
  return true;
}

/**
 * Running stitches along `route` (stitches left out, so under the covers), each at most TRAVEL
 * long and hidden under them, from its first point to its last; the first point is not repeated.
 */
function travel(covers: Cover[], route: Pt[]): Pt[] {
  const out: Pt[] = [];
  let i = 0;
  while (i < route.length - 1) {
    // The farthest point within reach that a hidden stitch gets to (the next one always does).
    let j = i + 1;
    for (let k = Math.min(route.length - 1, i + REACH); k > i + 1; k--) {
      if (dist(route[i], route[k]) <= TRAVEL && hidden(covers, route[i], route[k])) {
        j = k;
        break;
      }
    }
    const parts = Math.max(1, Math.ceil(dist(route[i], route[j]) / TRAVEL));
    for (let k = 1; k <= parts; k++) out.push(lerp(route[i], route[j], k / parts));
    i = j;
  }
  return out;
}

/**
 * The stitches of `run` without those that lie wholly under `covers`, crossed by running stitches
 * hidden under them; the run starts and ends where it did. The same array when nothing is left out.
 */
export function leaveOutCovered(run: Pt[], covers: Cover[]): Pt[] {
  if (!covers.length || run.length < 2) return run;
  // Only stitches near a cover can change.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of run) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const near = covers.filter((c) => c.minX <= maxX && c.maxX >= minX && c.minY <= maxY && c.maxY >= minY);
  if (!near.length) return run;
  const out: Pt[] = [run[0]];
  let route: Pt[] | null = null;
  let changed = false;
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1];
    const b = run[i];
    if (hidden(near, a, b)) {
      (route ??= [a]).push(b);
      continue;
    }
    if (route) {
      out.push(...travel(near, route));
      changed ||= route.length > 2;
      route = null;
    }
    out.push(b);
  }
  if (route) {
    out.push(...travel(near, route));
    changed ||= route.length > 2;
  }
  return changed ? out : run;
}
