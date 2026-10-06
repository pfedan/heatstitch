import { borderLoops, borderRails, borderRun, keptLines, keptRails, lineRails, orderLoops, type BorderType } from '../digitize/border';
import type { LineEcho } from '../digitize/echo';
import type { LineShadow } from './shadow';
import { sample, type Region } from '../digitize/region';
import { TOLERANCE } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import type { UnderlayKind } from '../digitize/satin';
import { satinRuns, type SatinSettings } from './restitch';

/**
 * Stitches along a line: the border of a fill (on the edge of its area) and, for drawn lines, a
 * line of its own. Running stitch, triple (bean) stitch or a satin of a set width centered on the
 * line; the same settings and the same stitches for both.
 */

export interface PathStitch {
  type: BorderType;
  /** Satin width (mm); kept when another type is picked, so it comes back. */
  width: number;
  /** Stitch length of running and triple stitch (mm); BORDER_STITCH by default. */
  length?: number;
  /** Curves keep this close to the line (mm); TOLERANCE by default. */
  tolerance?: number;
  /** A border lies this far outside the edge (mm; inside when negative); on the edge by default. */
  offset?: number;
  /** Satin: distance between penetrations on one side (mm); 0.4 by default. */
  spacing?: number;
  /** Satin: wider on each side by this (mm), against the pull of the thread; 0 by default. */
  pull?: number;
  /** Satin: its underlay; along the middle from 1.5 mm width, none below, by default. */
  under?: UnderlayKind | 'off';
  /** Lines only: copies of the line beside it (see digitize/echo.ts); none by default. */
  echo?: LineEcho;
  /** Lines only: a copy beside it in a thread of its own, sewn before it (see shadow.ts). */
  shadow?: LineShadow;
}

/** The satin's underlay when none is chosen. */
export const autoUnder = (s: PathStitch): UnderlayKind | 'off' => s.under ?? (s.width >= 1.5 ? 'center' : 'off');

/** The satin of a line: narrow, underlay along its middle once it is wide enough to need one. */
const satinOf = (s: PathStitch): SatinSettings => ({
  spacing: s.spacing ?? 0.4,
  edge: s.pull ?? 0,
  short: true,
  underlay: autoUnder(s) !== 'off',
  tolerance: s.tolerance ?? TOLERANCE,
  under: autoUnder(s) === 'off' ? 'center' : (autoUnder(s) as UnderlayKind),
  stagger: true,
  edgeShare: 0,
});

/**
 * The stitches along `line` (closed: its first point repeated at the end), from its end nearest
 * `start`. With `area`, a closed line is the edge of that area and a satin on it keeps out of the
 * area's corners (the rails do not fold over there).
 */
export function sewAlong(line: Pt[], closed: boolean, s: PathStitch, start?: Pt, area?: Region): Pt[][] {
  if (line.length < 2) return [];
  let l = line;
  if (start && closed) l = orderLoops([line], start)[0];
  else if (start) {
    const d = (q: Pt) => Math.hypot(q[0] - start[0], q[1] - start[1]);
    if (d(line[line.length - 1]) < d(line[0])) l = line.slice().reverse();
  }
  if (s.type !== 'satin') {
    const run = borderRun(l, s.type === 'triple', s.tolerance ?? TOLERANCE, s.length);
    return run.length > 1 ? [run] : [];
  }
  const rails = area && closed ? borderRails(area, l, s.width, s.offset ?? 0) : lineRails(l, closed, s.width);
  return satinRuns([rails], satinOf(s));
}

/**
 * Cut edges (where a later shape covers the fill) lie this far inside the whole shape at least
 * before they lose their border (mm): where they meet the shape's own edge the border runs on a
 * little, under the shape on top, so no gap shows.
 */
const CUT_EDGE = 0.3;

/**
 * Whether a point of a border line `offset` from the edge of `r` lies on the shape's own edge, not
 * on an edge cut by shapes on top: `whole` is the area before they were left out.
 */
export function onOwnEdge(whole: Region | null | undefined, offset: number): ((q: Pt) => boolean) | null {
  if (!whole) return null;
  return (q) => sample(whole, whole.sdfBase, q[0], q[1]) >= offset - CUT_EDGE;
}

/**
 * The lines a border on the edge of `r` (or `offset` from it) lies on, without the edges that
 * shapes on top cut (with `whole`, the area before they were left out): closed loops, or open
 * pieces where a part of the edge is covered.
 */
export function borderLines(r: Region, offset: number, whole?: Region | null): { line: Pt[]; closed: boolean }[] {
  const keep = onOwnEdge(whole, offset);
  const loops = borderLoops(r, offset);
  return keep ? loops.flatMap((l) => keptLines(l, keep)) : loops.map((line) => ({ line, closed: true }));
}

/**
 * The stitches of a border on the edge of `r` (or `s.offset` from it), loop by loop, starting near
 * `from`. With `whole` (the area before shapes on top were left out), edges they cut get none: it
 * would be hidden under them.
 */
export function borderStitches(r: Region, s: PathStitch, from: Pt, whole?: Region | null): Pt[][] {
  const off = s.offset ?? 0;
  const loops = orderLoops(borderLoops(r, off), from);
  const keep = onOwnEdge(whole, off);
  if (s.type !== 'satin') {
    if (!keep) return loops.flatMap((l) => sewAlong(l, true, s, undefined, r));
    const out: Pt[][] = [];
    let at = from;
    for (const l of loops) {
      for (const k of keptLines(l, keep)) {
        const runs = sewAlong(k.line, k.closed, s, k.closed ? undefined : at, r);
        out.push(...runs);
        const last = runs[runs.length - 1];
        if (last) at = last[last.length - 1];
      }
    }
    return out;
  }
  // One satin over all loops: its underlay first, then the satin, as satinRuns sews them.
  return satinRuns(
    loops.flatMap((l) => (keep ? keptRails(r, l, s.width, off, keep) : [borderRails(r, l, s.width, off)])),
    satinOf(s),
  );
}
