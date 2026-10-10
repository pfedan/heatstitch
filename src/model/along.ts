import { SATIN_UNDER_MIN } from '../material/rules';
import { borderLoops, borderRails, borderRun, keptLines, keptOpen, keptRails, lineRails, orderLoops, type BorderType } from '../digitize/border';
import { flatten, type Form } from '../shape/path';
import type { LineEcho } from '../digitize/echo';
import type { LineShadow } from './shadow';
import { sample, type Region } from '../digitize/region';
import { TOLERANCE } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import type { UnderlayKind } from '../digitize/satin';
import { MOTIF_PERIOD, motifStitches, type LineMotif } from '../digitize/motif';
import { satinRuns, type FringeSide, type SatinSettings } from './restitch';

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
  /**
   * How often it is sewn, 1 to 5 (once by default). A triple stitch: each stitch this many times,
   * 3 (by default) or 5 (bean stitch). A motif: each stitch, at an odd number unless `whole`. A
   * running stitch, a satin, a zigzag, an E stitch: the whole line, there and back.
   */
  repeat?: number;
  /** A motif repeated: the whole line there and back instead of each stitch (bean stitch). */
  whole?: boolean;
  /** Motif stitch: the figure repeated along the line (waves by default); `width` is its size across. */
  motif?: LineMotif;
  /** Motif stitch: its longest stitch (mm), shorter where the figure bends; MOTIF_STITCH by default. */
  stitch?: number;
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
  /** Satin lines and borders only: a ragged edge, stitches up to this far short of the side (mm); see SatinSettings.fringe. */
  fringe?: number;
  /** The fringe on this side only, both by default: of a line, this side of the drawn line; of a border, left inside and right outside. */
  fringeSide?: FringeSide;
  /** Lines only: copies of the line beside it (see digitize/echo.ts); none by default. */
  echo?: LineEcho;
  /** Lines only: a copy beside it in a thread of its own, sewn before it (see shadow.ts). */
  shadow?: LineShadow;
}

/** Sewn as a running stitch (once or more often), not across a band. */
export const isRunType = (t: BorderType): boolean => t === 'run' || t === 'triple';

/** Sewn as one line of running stitches (a motif too): an object of the kind Steppstich. */
export const runLike = (t: BorderType): boolean => isRunType(t) || t === 'motif';

/** How often a line can be sewn. */
export const REPEAT: [number, number] = [1, 5];

const repeatOf = (s: PathStitch): number => Math.min(REPEAT[1], Math.max(REPEAT[0], Math.round(s.repeat ?? 1)));

/** How often each stitch of a running stitch is sewn (bean stitch): an odd number. */
export const timesOf = (s: PathStitch): number => (s.type === 'triple' ? (s.repeat === 5 ? 5 : 3) : s.type === 'motif' && !s.whole && repeatOf(s) % 2 ? repeatOf(s) : 1);

/** How often the whole line is sewn, there and back: what is not sewn as bean stitch. */
export const passesOf = (s: PathStitch): number => (s.type === 'triple' || timesOf(s) > 1 ? 1 : repeatOf(s));

/** Kinds of stitch whose figures repeat along the line: an echo shifts them from copy to copy (LineEcho.phase). */
export const hasPhase = (t: BorderType): boolean => t === 'motif' || t === 'zigzag' || t === 'e';

/**
 * How wide the stitches of a line lie on the fabric (mm): copies of it (echo, shadow) nearer than
 * this overlap it. A running stitch about a thread wide.
 */
export function coverOf(s: PathStitch): number {
  if (s.type === 'run') return 0.4;
  if (s.type === 'triple') return 0.6;
  return s.width + (s.type === 'satin' ? 2 * (s.pull ?? 0) : 0);
}

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

/** The satin's underlay when none is chosen (a zigzag and an E stitch have none): by width as any satin (see SATIN_UNDER_MIN). */
export const autoUnder = (s: PathStitch): UnderlayKind | 'off' => (s.type !== 'satin' ? 'off' : (s.under ?? (s.width >= SATIN_UNDER_MIN ? 'auto' : 'off')));

/**
 * The satin of a line: narrow, underlay along its middle once it is wide enough to need one. A
 * line (not a border) keeps its fringe on its side of the drawn line, also sewn the other way (`back`).
 */
const satinOf = (s: PathStitch, line = false, back = false): SatinSettings => ({
  spacing: spacingOf(s),
  edge: s.type === 'satin' ? (s.pull ?? 0) : 0,
  short: s.type === 'satin',
  underlay: autoUnder(s) !== 'off',
  tolerance: s.tolerance ?? TOLERANCE,
  under: autoUnder(s) === 'off' ? 'center' : (autoUnder(s) as UnderlayKind),
  stagger: true,
  edgeShare: 0,
  ...(s.type === 'e' ? { type: 'e' as const } : {}),
  ...(line && s.type === 'satin' && s.fringe ? { fringe: s.fringe, ...(s.fringeSide ? { fringeSide: back ? other(s.fringeSide) : s.fringeSide } : {}) } : {}),
});

const other = (side: FringeSide): FringeSide => (side === 'left' ? 'right' : 'left');

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
export function sewAlong(line: Pt[], closed: boolean, s: PathStitch, start?: Pt, area?: Region, reversed = false, shift = 0): Pt[][] {
  const passes = area ? 1 : passesOf(s);
  const once = sewOnce(line, closed, s, start, area, reversed, shift);
  if (passes < 2 || !once.length) return once;
  // Sewn again: back over the same needle points (a loop round again), the satin without its underlay.
  const again = autoUnder(s) === 'off' ? once : sewOnce(line, closed, { ...s, under: 'off' }, start, area, reversed, shift);
  const pass = again.flat();
  const back = closed ? pass : pass.slice().reverse();
  const out = once.map((r) => r.slice());
  for (let k = 1; k < passes; k++) out[out.length - 1].push(...(k % 2 ? back : pass).slice(1));
  return out;
}

/** The stitches along `line` sewn once (see sewAlong); `shift`: a share of the period a zigzag, E stitch or motif starts later. */
function sewOnce(line: Pt[], closed: boolean, s: PathStitch, start?: Pt, area?: Region, reversed = false, shift = 0): Pt[][] {
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
    const run = repeated(motifStitches(l, closed, s.motif ?? 'waves', s.width, spacingOf(s), right ? 1 : -1, shift, s.stitch), timesOf(s));
    return run.length > 1 ? [run] : [];
  }
  if (area && closed) return satinRuns([onEdge(area, borderRails(area, l, s.width, s.offset ?? 0), s)], satinOf(s));
  const rails = lineRails(l, closed, s.width);
  const lead = shift > 0 && s.type !== 'satin' ? shift * spacingOf(s) : 0;
  // Prongs of an E stitch on the right of the drawn line (the left rail is on the right on screen, y down).
  return satinRuns([s.type === 'e' ? eRails(rails, back === !!s.flip) : rails], { ...satinOf(s, true, back), ...(lead ? { lead } : {}) });
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
  const bands = loops.flatMap((l) => (keep ? keptRails(r, l, s.width, off, keep) : [borderRails(r, l, s.width, off)]).map((b) => onEdge(r, b, s)));
  if (!(s.type === 'satin' && s.fringe)) return satinRuns(bands, satinOf(s));
  // Frayed: every band with its left rail inside, so the fringe is on the side asked for (a
  // border's fringeSide: left inside, right outside).
  const inward = bands.map((b) => (leftInside(r, b) ? b : { ...b, left: b.right, right: b.left }));
  return satinRuns(inward, { ...satinOf(s), fringe: s.fringe, ...(s.fringeSide ? { fringeSide: other(s.fringeSide) } : {}) });
}

/**
 * The stitches of a fill's border along the open paths of its form (the fill leaves them unfilled,
 * see geo.ts), each from the end nearest the needle, starting near `from`. Where shapes on top
 * cover the fill (`r` the area sewn, `whole` the area before they were left out) they are left
 * out, as the edge is there. Its offset is the edge's: an open path has no inside or outside.
 */
export function openStitches(open: Form, s: PathStitch, from: Pt, r: Region, whole?: Region | null): Pt[][] {
  // An open path has no inside or outside: frayed on both sides.
  const st: PathStitch = { ...s, offset: undefined, fringeSide: undefined };
  const covered = whole ? (q: Pt) => sample(whole, whole.sdfBase, q[0], q[1]) < 0 && sample(r, r.sdfBase, q[0], q[1]) > CUT_EDGE : null;
  const lines = open.paths.filter((p) => !p.closed).flatMap((p) => {
    const pts = flatten(p);
    return pts.length < 2 ? [] : covered ? keptOpen(pts, (q) => !covered(q)) : [pts];
  });
  const out: Pt[][] = [];
  let at = from;
  const todo = lines.slice();
  while (todo.length) {
    // The nearest end next.
    let best = 0;
    let flip = false;
    let bestD = Infinity;
    todo.forEach((l, k) => {
      const a = Math.hypot(l[0][0] - at[0], l[0][1] - at[1]);
      const b = Math.hypot(l[l.length - 1][0] - at[0], l[l.length - 1][1] - at[1]);
      if (a < bestD) [bestD, best, flip] = [a, k, false];
      if (b < bestD) [bestD, best, flip] = [b, k, true];
    });
    const [line] = todo.splice(best, 1);
    const runs = sewAlong(flip ? line.slice().reverse() : line, false, st, at);
    out.push(...runs);
    const last = runs[runs.length - 1];
    if (last) at = last[last.length - 1];
  }
  return out;
}

/**
 * The lines along the cuts between the parts `parts` of a fill cut apart (in sewing order), one
 * line per cut: the edge of each part where it lies on a part sewn before it (the one on top shows
 * its edge), away from the edge of all parts together (`area`), where the border runs.
 */
export function seamLines(parts: readonly Region[], area: Region): Pt[][] {
  const out: Pt[][] = [];
  for (let k = 1; k < parts.length; k++) {
    const before = parts.slice(0, k);
    const keep = (q: Pt) => sample(area, area.sdfBase, q[0], q[1]) < -CUT_EDGE && before.some((r) => sample(r, r.sdfBase, q[0], q[1]) < SEAM_NEAR);
    for (const l of borderLoops(parts[k], 0)) for (const k2 of keptLines(l, keep)) if (!k2.closed && k2.line.length > 1) out.push(k2.line);
  }
  return out;
}

/**
 * An edge counts as lying on another part up to this far outside it (mm): the parts reach 0.2 mm
 * under each other, but their curves are traced from pixels and can come apart a little.
 */
const SEAM_NEAR = 0.15;

/** The stitches along the cuts between parts (see seamLines), each line from its end nearest the last stitch. */
export function seamStitches(parts: readonly Region[], area: Region, s: PathStitch, from: Pt): Pt[][] {
  const out: Pt[][] = [];
  let at = from;
  for (const line of orderedLines(seamLines(parts, area), from)) {
    const runs = sewAlong(line, false, s, at);
    out.push(...runs);
    const last = runs[runs.length - 1];
    if (last) at = last[last.length - 1];
  }
  return out;
}

/** Open lines, each next the one with an end nearest where the one before ended. */
function orderedLines(lines: Pt[][], from: Pt): Pt[][] {
  const left = lines.slice();
  const out: Pt[][] = [];
  let at = from;
  const d = (q: Pt) => Math.hypot(q[0] - at[0], q[1] - at[1]);
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (Math.min(d(left[i][0]), d(left[i][left[i].length - 1])) < Math.min(d(left[best][0]), d(left[best][left[best].length - 1]))) best = i;
    let l = left.splice(best, 1)[0];
    if (d(l[l.length - 1]) < d(l[0])) l = l.slice().reverse();
    out.push(l);
    at = l[l.length - 1];
  }
  return out;
}
