import { BORDER_STITCH, BORDER_WIDTH } from '../digitize/border';
import { TOLERANCE } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import { flatten, type Form, type Node } from '../shape/path';
import { fitCubic } from '../shape/vectorize';
import { sewAlong, type PathStitch } from './along';
import { runRecords } from './border';
import { tidy, withRecords } from './edit';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import { JUMP, STITCH, type Pattern } from './pattern';
import { remember, remembered, type Rec, type Remembered, type RunSettings } from './restitch';
import { stitchKinds, TIE_STITCH } from './sequence';

/**
 * Lines: sewn along their curves with the same stitches as the border of a fill (along.ts), so
 * they stay exactly where they were drawn and follow every change of their nodes. The object
 * remembers the line as `path` and how it is sewn as `line` (running, triple or satin stitch).
 * Running stitches without curves (from a PES or DST file) get one traced through their stitches
 * the first time they are changed as a line.
 */

/** Running stitch of a drawn line when nothing else is set. */
export const LINE_RUN: RunSettings = { stitch: BORDER_STITCH, triple: false, tolerance: TOLERANCE };

/** Lines from this wide (mm) are sewn as satin, thinner ones in running stitch. */
export const LINE_SATIN = 1;

/** How a line of `width` (mm, as drawn or in an SVG) is sewn to begin with. */
export function lineStitchFor(width: number, tolerance = TOLERANCE): PathStitch {
  return width >= LINE_SATIN ? { type: 'satin', width, tolerance } : { type: 'run', width: BORDER_WIDTH, length: BORDER_STITCH, tolerance };
}

/** The settings of running stitch as those of a line. */
export const runAsLine = (s: RunSettings, width = BORDER_WIDTH): PathStitch => ({ type: s.triple ? 'triple' : 'run', width, length: s.stitch, tolerance: s.tolerance });

/** The stitches along the paths of `form`, one after the other, each from the end nearest the one before (the first from `from` when given). */
export function lineStitches(form: Form, st: PathStitch, reverse = false, from?: Pt): Pt[][] {
  let paths = form.paths.map((p) => ({ pts: flatten(p), closed: p.closed })).filter((x) => x.pts.length >= 2);
  if (reverse) paths = paths.reverse().map((x) => ({ ...x, pts: x.pts.slice().reverse() }));
  const out: Pt[][] = [];
  let at: Pt | undefined = from;
  for (const x of paths) {
    const pts = x.closed && x.pts.length > 2 && !samePt(x.pts[0], x.pts[x.pts.length - 1]) ? [...x.pts, x.pts[0]] : x.pts;
    const runs = sewAlong(pts, x.closed, st, at);
    out.push(...runs);
    const last = runs[runs.length - 1];
    if (last) at = last[last.length - 1];
  }
  return out;
}

/** Running stitch along the paths of `form` (see lineStitches). */
export const lineRuns = (form: Form, s: RunSettings, reverse = false): Pt[][] => lineStitches(form, runAsLine(s), reverse);

const samePt = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/** Turns sharper than this (degrees) are corners of a traced line. */
const CORNER = 40;
/** Traced curves keep this close to the stitches (mm). */
const TRACE_TOLERANCE = 0.2;

/**
 * The path a running stitch follows, read from its penetrations: without lock stitches and without
 * the way back of a triple stitch.
 */
export function runPoints(p: Pattern, first: number, last: number, kinds?: Uint8Array): Pt[] {
  const path: Pt[] = [];
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (let i = first; i <= last; i++) {
    if (p.cmd[i] !== STITCH || (kinds && kinds[i] === TIE_STITCH && i > first && i < last)) continue;
    const q: Pt = [p.x[i] / 10, p.y[i] / 10];
    // Back and forth over the same stitch (triple stitch, locks): only once.
    if (path.length >= 2 && d(q, path[path.length - 2]) < 0.05) {
      path.pop();
      continue;
    }
    if (!path.length || d(q, path[path.length - 1]) > 0.05) path.push(q);
  }
  return path;
}

/** A line of curves through points: corners where it turns sharply, smooth curves between them. */
export function traceLine(pts: Pt[]): Form | null {
  if (pts.length < 2) return null;
  const closed = pts.length > 3 && samePt(pts[0], pts[pts.length - 1]);
  const turn = (i: number) => {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const u = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const v = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let t = Math.abs(v - u);
    if (t > Math.PI) t = 2 * Math.PI - t;
    return (t * 180) / Math.PI;
  };
  const cut = [0];
  for (let i = 1; i < pts.length - 1; i++) if (turn(i) > CORNER) cut.push(i);
  cut.push(pts.length - 1);
  const unit = (a: Pt, b: Pt): [number, number] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const nodes: Node[] = [];
  for (let k = 0; k + 1 < cut.length; k++) {
    const part = pts.slice(cut[k], cut[k + 1] + 1);
    const curves = part.length === 2 ? [[part[0], part[0], part[1], part[1]] as [Pt, Pt, Pt, Pt]] : fitCubic(part, unit(part[0], part[1]), unit(part[part.length - 1], part[part.length - 2]), TRACE_TOLERANCE);
    for (const [p0, c1, c2, p3] of curves) {
      if (!nodes.length) nodes.push({ p: p0, a: p0, b: c1, smooth: false });
      else nodes[nodes.length - 1].b = c1;
      nodes.push({ p: p3, a: c2, b: p3, smooth: true });
    }
    // Where two parts meet is a corner.
    nodes[nodes.length - 1].smooth = false;
  }
  if (closed && nodes.length > 2) {
    // The last node is the first one again.
    const end = nodes.pop()!;
    nodes[0].a = end.a;
  }
  return { paths: [{ closed, nodes }] };
}

/** The curves of a line object: remembered, or traced through its running stitches. */
export function lineOf(p: Pattern, o: SewObject, kinds?: Uint8Array): Form | null {
  const known = remembered(p, o)?.path;
  if (known) return known;
  if (o.kind !== 'run') return null;
  return traceLine(runPoints(p, o.first, o.last, kinds ?? stitchKinds(p)));
}

/** How a line object is sewn now. */
export function lineSettings(p: Pattern, o: SewObject, kinds?: Uint8Array): PathStitch {
  const known = remembered(p, o);
  if (known?.line) return { ...known.line };
  const pts = runPoints(p, o.first, o.last, kinds ?? stitchKinds(p));
  // Measured: the usual length of its stitches, and triple when it goes back and forth.
  const lens: number[] = [];
  for (let i = 1; i < pts.length; i++) lens.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  lens.sort((a, b) => a - b);
  const length = lens.length ? Math.round(lens[Math.floor(lens.length * 0.75)] * 10) / 10 : BORDER_STITCH;
  let stitches = 0;
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) stitches++;
  const triple = stitches > pts.length * 2.4;
  return { type: triple ? 'triple' : 'run', width: BORDER_WIDTH, length: Math.min(6, Math.max(1, length)), tolerance: TOLERANCE };
}

/**
 * Object `index` sewn anew along `path` with `st`, in its place and thread; what it remembers
 * otherwise stays. Null when nothing could be sewn.
 */
export function resewLine(p: Pattern, index: number, path: Form, st: PathStitch, trimMm: number, reverse = false): { pattern: Pattern; first: number; last: number } | null {
  const objs = sewObjects(p);
  const o = objs[index];
  if (!o) return null;
  const runs = lineStitches(path, st, reverse);
  if (!runs.length) return null;
  const recs = runRecords(runs, trimMm);
  let lead = o.first;
  while (lead - 1 >= 0 && p.cmd[lead - 1] === JUMP) lead--;
  const out: Rec[] = [];
  const copy = (a: number, b: number) => {
    for (let i = a; i <= b; i++) out.push({ x: p.x[i], y: p.y[i], cmd: p.cmd[i] });
  };
  copy(0, lead - 1);
  const before = out.reduce((n, r) => n + (r.cmd === STITCH ? 1 : 0), 0);
  out.push(...recs);
  const after = before + recs.reduce((n, r) => n + (r.cmd === STITCH ? 1 : 0), 0);
  copy(o.last + 1, p.cmd.length - 1);
  const next = tidy(
    withRecords(
      p,
      Int32Array.from(out, (r) => r.x),
      Int32Array.from(out, (r) => r.y),
      Uint8Array.from(out, (r) => r.cmd),
    ),
  );
  // This object stays one, also where its new stitches are trimmed inside.
  rememberObjects(next, [before], after);
  const fresh = sewObjects(next).find((x) => stitchesUpTo(next, x.first) === before);
  if (!fresh) return null;
  const known = remembered(p, o);
  const memory: Remembered = { ...(known ?? { region: null }), region: null, path, line: { ...st } };
  // Stitches set by hand are gone with the old ones.
  delete memory.hand;
  remember(next, fresh, memory);
  return { pattern: next, first: fresh.first, last: fresh.last };
}

function stitchesUpTo(p: Pattern, record: number): number {
  let n = 0;
  for (let i = 0; i < record; i++) if (p.cmd[i] === STITCH) n++;
  return n;
}
