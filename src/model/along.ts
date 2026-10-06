import { borderLoops, borderRails, borderRun, keptLines, keptRails, lineRails, orderLoops, type BorderType } from '../digitize/border';
import { sample, type Region } from '../digitize/region';
import { TOLERANCE } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import type { UnderlayKind } from '../digitize/satin';
import { MOTIF_PERIOD, motifStitches, type LineMotif } from '../digitize/motif';
import { satinRuns, type SatinSettings } from './restitch';

/**
 * Stitches along a line: the border of a fill (on the edge of its area) and, for drawn lines, a
 * line of its own. Running stitch (once, or as bean stitch three or five times), a satin or an
 * open zigzag of a set width centered on the line, or an E stitch with its edge on the line; the
 * same settings and the same stitches for both.
 */

export interface PathStitch {
  type: BorderType;
  /** Satin width (mm); kept when another type is picked, so it comes back. */
  width: number;
  /** Stitch length of running and triple stitch (mm); BORDER_STITCH by default. */
  length?: number;
  /** Triple stitch: each stitch this many times, 3 (by default) or 5. A motif: 1 (by default), 3 or 5. */
  repeat?: number;
  /** Motif stitch: the figure repeated along the line (waves by default); `width` is its size across. */
  motif?: LineMotif;
  /** Curves keep this close to the line (mm); TOLERANCE by default. */
  tolerance?: number;
  /** A border lies this far outside the edge (mm; inside when negative); on the edge by default. */
  offset?: number;
  /** Satin, zigzag, E stitch: distance between penetrations on one side (mm); see spacingOf. */
  spacing?: number;
  /** E stitch, scallops, hearts: on the other side (a line: left in its direction; a border: outward). */
  flip?: boolean;
  /** Satin: wider on each side by this (mm), against the pull of the thread; 0 by default. */
  pull?: number;
  /** Satin: its underlay; along the middle from 1.5 mm width, none below, by default. */
  under?: UnderlayKind | 'off';
}

/** Sewn as a running stitch (once or more often), not across a band. */
export const isRunType = (t: BorderType): boolean => t === 'run' || t === 'triple';

/** Sewn as one line of running stitches (a motif too): an object of the kind Steppstich. */
export const runLike = (t: BorderType): boolean => isRunType(t) || t === 'motif';

/** How often each stitch of a running stitch is sewn. */
export const timesOf = (s: PathStitch): number => (s.type === 'triple' ? (s.repeat === 5 ? 5 : 3) : s.type === 'motif' && (s.repeat === 3 || s.repeat === 5) ? s.repeat : 1);

/** Each stitch of a running stitch sewn `times` times: there, back, there ... */
function repeated(pts: Pt[], times: number): Pt[] {
  if (times < 3 || pts.length < 2) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    for (let k = 0; k < (times - 1) / 2; k++) out.push(pts[i], pts[i - 1]);
    out.push(pts[i]);
  }
  return out;
}

/** Distance between penetrations on one side by default (mm): a zigzag and an E stitch are open. */
export const ZIGZAG_SPACING = 1.5;
export const E_SPACING = 2.5;
export const spacingOf = (s: PathStitch): number => s.spacing ?? (s.type === 'zigzag' ? ZIGZAG_SPACING : s.type === 'e' ? E_SPACING : s.type === 'motif' ? MOTIF_PERIOD[s.motif ?? 'waves'] : 0.4);

/** The satin's underlay when none is chosen (a zigzag and an E stitch have none). */
export const autoUnder = (s: PathStitch): UnderlayKind | 'off' => (s.type !== 'satin' ? 'off' : (s.under ?? (s.width >= 1.5 ? 'center' : 'off')));

/** The satin of a line: narrow, underlay along its middle once it is wide enough to need one. */
const satinOf = (s: PathStitch): SatinSettings => ({
  spacing: spacingOf(s),
  edge: s.type === 'satin' ? (s.pull ?? 0) : 0,
  short: s.type === 'satin',
  underlay: autoUnder(s) !== 'off',
  tolerance: s.tolerance ?? TOLERANCE,
  under: autoUnder(s) === 'off' ? 'center' : (autoUnder(s) as UnderlayKind),
  stagger: true,
  edgeShare: 0,
  ...(s.type === 'e' ? { type: 'e' as const } : {}),
});

type Band = { left: Pt[]; right: Pt[] };

/**
 * The rails an E stitch is sewn between, from those of a band centered on the line: its edge (the
 * left rail, where eStitches runs along) on the line itself, its prongs the band's width out to
 * the side `toLeft` names.
 */
function eRails<B extends Band>(b: B, toLeft: boolean): B {
  const mid = b.left.map((q, i): Pt => [(q[0] + b.right[i][0]) / 2, (q[1] + b.right[i][1]) / 2]);
  const side = toLeft ? b.left : b.right;
  return { ...b, left: mid, right: side.map((q, i): Pt => [2 * q[0] - mid[i][0], 2 * q[1] - mid[i][1]]) };
}

/** Whether the normal of `line` (to the right of its direction on screen) points into the area `r`. */
function rightInside(r: Region, line: Pt[]): boolean {
  let d = 0;
  for (let i = 1; i < line.length; i += 3) {
    const a = line[i - 1];
    const b = line[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: Pt = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    d += sample(r, r.sdfBase, a[0] + n[0] * 0.5, a[1] + n[1] * 0.5) - sample(r, r.sdfBase, a[0] - n[0] * 0.5, a[1] - n[1] * 0.5);
  }
  return d < 0;
}

/** Whether the left rail of a band on the edge of `r` lies inside the area. */
function leftInside(r: Region, b: Band): boolean {
  let d = 0;
  for (let i = 0; i < b.left.length; i += 5) d += sample(r, r.sdfBase, b.left[i][0], b.left[i][1]) - sample(r, r.sdfBase, b.right[i][0], b.right[i][1]);
  return d < 0;
}

/** A band on the edge of `r` as `s` sews it: an E stitch's prongs inward (outward with flip). */
function onEdge<B extends Band>(r: Region, b: B, s: PathStitch): B {
  return s.type === 'e' ? eRails(b, leftInside(r, b) !== !!s.flip) : b;
}

/**
 * The stitches along `line` (closed: its first point repeated at the end), from its end nearest
 * `start`. With `area`, a closed line is the edge of that area and a satin on it keeps out of the
 * area's corners (the rails do not fold over there). `reversed`: the line runs against the way it
 * was drawn (an E stitch keeps its prongs on the side of the drawn line all the same).
 */
export function sewAlong(line: Pt[], closed: boolean, s: PathStitch, start?: Pt, area?: Region, reversed = false): Pt[][] {
  if (line.length < 2) return [];
  let l = line;
  let back = reversed;
  if (start && closed) l = orderLoops([line], start)[0];
  else if (start) {
    const d = (q: Pt) => Math.hypot(q[0] - start[0], q[1] - start[1]);
    if (d(line[line.length - 1]) < d(line[0])) {
      l = line.slice().reverse();
      back = !back;
    }
  }
  if (isRunType(s.type)) {
    const run = borderRun(l, timesOf(s), s.tolerance ?? TOLERANCE, s.length);
    return run.length > 1 ? [run] : [];
  }
  if (s.type === 'motif') {
    // Like the prongs of an E stitch: on a border inward (outward with flip), on a line to its right.
    const right = area ? rightInside(area, l) !== !!s.flip : back === !!s.flip;
    const run = repeated(motifStitches(l, closed, s.motif ?? 'waves', s.width, spacingOf(s), right ? 1 : -1), timesOf(s));
    return run.length > 1 ? [run] : [];
  }
  if (area && closed) return satinRuns([onEdge(area, borderRails(area, l, s.width, s.offset ?? 0), s)], satinOf(s));
  const rails = lineRails(l, closed, s.width);
  // Prongs of an E stitch on the right of the drawn line (the left rail is on the right on screen, y down).
  return satinRuns([s.type === 'e' ? eRails(rails, back === !!s.flip) : rails], satinOf(s));
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
  if (isRunType(s.type) || s.type === 'motif') {
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
  // One satin (zigzag, E stitch) over all loops: its underlay first, then the satin, as satinRuns sews them.
  return satinRuns(
    loops.flatMap((l) => (keep ? keptRails(r, l, s.width, off, keep) : [borderRails(r, l, s.width, off)]).map((b) => onEdge(r, b, s))),
    satinOf(s),
  );
}
