import { BORDER_STITCH } from '../digitize/border';
import { TOLERANCE } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import { flatten, type Form } from '../shape/path';
import { sewAlong, type PathStitch } from './along';
import type { RunSettings } from './restitch';

/**
 * Drawn lines: sewn along their curves with the same stitches as the border of a fill (along.ts),
 * so they stay exactly where they were drawn and follow every change of their nodes. The object
 * remembers the line as `path`; its running stitch settings are those of any running stitch.
 */

/** Running stitch of a drawn line when nothing else is set. */
export const LINE_RUN: RunSettings = { stitch: BORDER_STITCH, triple: false, tolerance: TOLERANCE };

/** The stitches along the paths of `form`, one run per path, each from the end nearest the one before. */
export function lineRuns(form: Form, s: RunSettings, reverse = false): Pt[][] {
  const st: PathStitch = { type: s.triple ? 'triple' : 'run', width: 0, length: s.stitch, tolerance: s.tolerance };
  let paths = form.paths.map((p) => ({ pts: flatten(p), closed: p.closed })).filter((x) => x.pts.length >= 2);
  if (reverse) paths = paths.reverse().map((x) => ({ ...x, pts: x.pts.slice().reverse() }));
  const out: Pt[][] = [];
  let at: Pt | undefined;
  for (const x of paths) {
    const pts = x.closed && x.pts.length > 2 && !samePt(x.pts[0], x.pts[x.pts.length - 1]) ? [...x.pts, x.pts[0]] : x.pts;
    const runs = sewAlong(pts, x.closed, st, at);
    out.push(...runs);
    const last = runs[runs.length - 1];
    if (last) at = last[last.length - 1];
  }
  return out;
}

const samePt = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
