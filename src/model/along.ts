import { borderLoops, borderRails, borderRun, lineRails, orderLoops, type BorderType } from '../digitize/border';
import type { Region } from '../digitize/region';
import { TOLERANCE } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
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
}

/** The satin of a line: narrow, underlay along its middle once it is wide enough to need one. */
const satinOf = (s: PathStitch): SatinSettings => ({
  spacing: 0.4,
  edge: 0,
  short: true,
  underlay: s.width >= 1.5,
  tolerance: s.tolerance ?? TOLERANCE,
  under: 'center',
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
  const rails = area && closed ? borderRails(area, l, s.width) : lineRails(l, closed, s.width);
  return satinRuns([rails], satinOf(s));
}

/** The stitches of a border on the edge of `r`, loop by loop, starting near `from`. */
export function borderStitches(r: Region, s: PathStitch, from: Pt): Pt[][] {
  const loops = orderLoops(borderLoops(r), from);
  if (s.type !== 'satin') return loops.flatMap((l) => sewAlong(l, true, s, undefined, r));
  // One satin over all loops: its underlay first, then the satin, as satinRuns sews them.
  return satinRuns(
    loops.map((l) => borderRails(r, l, s.width)),
    satinOf(s),
  );
}
