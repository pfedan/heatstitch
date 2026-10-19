import { SATIN_UNDER_MIN } from '../material/rules';
import { lineRails, type BorderType } from '../digitize/border';
import type { Form } from '../shape/path';
import type { LineEcho } from '../digitize/echo';
import type { LineShadow } from './shadow';
import { regionIn, type Region } from '../digitize/region';
import { flatOf } from '../digitize/fill';
import { core } from '../wasm/core';
import type { RunsOut } from '../wasm/pkg/heatstitch_core';
import { TOLERANCE } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import type { UnderlayKind } from '../digitize/satin';
import { strokeRails, type SatinCorner, type SatinEnd } from '../digitize/satinJoins';
import { CORD_STEP, HAND_LAYERS, isHandStitch, MOTIF_PERIOD, type LineMotif } from '../digitize/motif';
import { takeRuns, type FringeSide, type SatinSettings } from './restitch';
import type { LineOrder } from './lineOrder';

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
  /**
   * Stem stitch only: sewn as a dense cord, each stitch once at 45° over the next ones, `spacing`
   * the step (CORD_STEP by default); like stranded floss by hand otherwise.
   */
  cord?: boolean;
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
  /** Satin: its underlay; by width from 1 mm (see underTier), none below, by default. */
  under?: UnderlayKind | 'off';
  /** Satin: its automatic underlay as on stretchy fabric (see SatinSettings.underCross); set from the fabric. */
  underCross?: boolean;
  /** Satin lines only: the form of its corners (see satinJoins.ts); a miter by default. */
  corner?: SatinCorner;
  /** Satin lines only: the form of its ends, as SVG's stroke-linecap (see satinJoins.ts); flat by default. */
  ends?: SatinEnd;
  /** Satin lines and borders only: a ragged edge, stitches up to this far short of the side (mm); see SatinSettings.fringe. */
  fringe?: number;
  /** The fringe on this side only, both by default: of a line, this side of the drawn line; of a border, left inside and right outside. */
  fringeSide?: FringeSide;
  /**
   * Satin lines only: the order set by hand in the satin view over what the line makes by itself,
   * one for each of its paths (null: that path as it makes itself); see LineOrder. None: Auto.
   */
  order?: (LineOrder | null)[];
  /** The order of the one path being sewn (set by lineStitches from `order`); never stored. */
  own?: LineOrder | null;
  /** Lines only: copies of the line beside it (see digitize/echo.ts); none by default. */
  echo?: LineEcho;
  /** Lines only: a copy beside it in a thread of its own, sewn before it (see shadow.ts). */
  shadow?: LineShadow;
  /**
   * Lines in running or triple stitch only: all paths in one go, each line there and back without a
   * trim where they touch (redwork, see digitize/redwork.ts); path by path by default. In triple
   * stitch the way back, which lies on top, is a bean stitch.
   */
  redwork?: boolean;
  /** Redwork only: gaps between paths up to this (mm) are bridged by a stitch; REDWORK_GAP (0.5 mm) when not set. */
  redworkGap?: number;
}

/** Sewn as a running stitch (once or more often), not across a band. */
export const isRunType = (t: BorderType): boolean => t === 'run' || t === 'triple';

/** Sewn as one line of running stitches (a motif too): an object of the kind Steppstich. */
export const runLike = (t: BorderType): boolean => isRunType(t) || t === 'motif';

/** How often a line can be sewn. */
export const REPEAT: [number, number] = [1, 5];

const repeatOf = (s: PathStitch): number => Math.min(REPEAT[1], Math.max(REPEAT[0], Math.round(s.repeat ?? 1)));

/** A motif that imitates a hand stitch: its stitches lie in bundles of their own (see handStitches). */
export const isHand = (s: PathStitch): boolean => s.type === 'motif' && isHandStitch(s.motif);

/**
 * How often each stitch of a hand stitch is sewn: 1, 3 (by default) or 5. Not more, and not on top
 * of a bean stitch or the whole line again: the bundles meet in shared holes, and five layers is
 * what the density check still takes.
 */
export const layersOf = (s: PathStitch): number => (isCord(s) || s.repeat === 1 ? 1 : s.repeat === 5 ? 5 : HAND_LAYERS);

/** A stem stitch sewn as a dense cord (PathStitch.cord). */
export const isCord = (s: PathStitch): boolean => s.type === 'motif' && s.motif === 'stem' && !!s.cord;

/** How often each stitch of a running stitch is sewn (bean stitch): an odd number. */
export const timesOf = (s: PathStitch): number => (s.type === 'triple' ? (s.repeat === 5 ? 5 : 3) : s.type === 'motif' && !isHand(s) && !s.whole && repeatOf(s) % 2 ? repeatOf(s) : 1);

/** How often the whole line is sewn, there and back: what is not sewn as bean stitch. */
export const passesOf = (s: PathStitch): number => (s.type === 'triple' || isHand(s) || timesOf(s) > 1 ? 1 : repeatOf(s));

/** Whether a line is sewn as redwork: a running or triple stitch without echo, see PathStitch.redwork. */
export const isRedwork = (s: PathStitch): boolean => !!s.redwork && (s.type === 'run' || s.type === 'triple') && !s.echo;

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

/** Distance between penetrations on one side by default (mm): a zigzag and an E stitch are open. */
export const ZIGZAG_SPACING = 1.5;
export const E_SPACING = 2.5;
export const spacingOf = (s: PathStitch): number => s.spacing ?? (s.type === 'zigzag' ? ZIGZAG_SPACING : s.type === 'e' ? E_SPACING : s.type === 'motif' ? (isCord(s) ? CORD_STEP : MOTIF_PERIOD[s.motif ?? 'waves']) : 0.4);

/** The satin's underlay when none is chosen (a zigzag and an E stitch have none): by width as any satin (see SATIN_UNDER_MIN). */
export const autoUnder = (s: PathStitch): UnderlayKind | 'off' => (s.type !== 'satin' ? 'off' : (s.under ?? (s.width >= SATIN_UNDER_MIN ? 'auto' : 'off')));

/**
 * The satin of a line: narrow, underlay along its middle once it is wide enough to need one. A
 * line (not a border) keeps its fringe on its side of the drawn line, also sewn the other way (`back`).
 */
export const satinOf = (s: PathStitch, line = false, back = false): SatinSettings => ({
  spacing: spacingOf(s),
  edge: s.type === 'satin' ? (s.pull ?? 0) : 0,
  short: s.type === 'satin',
  underlay: autoUnder(s) !== 'off',
  tolerance: s.tolerance ?? TOLERANCE,
  under: autoUnder(s) === 'off' ? 'center' : (autoUnder(s) as UnderlayKind),
  ...(s.type === 'satin' && s.underCross ? { underCross: true } : {}),
  stagger: true,
  edgeShare: 0,
  ...(s.type === 'e' ? { type: 'e' as const } : {}),
  ...(line && s.type === 'satin' && s.fringe ? { fringe: s.fringe, ...(s.fringeSide ? { fringeSide: back ? other(s.fringeSide) : s.fringeSide } : {}) } : {}),
});

const other = (side: FringeSide): FringeSide => (side === 'left' ? 'right' : 'left');

type Band = { left: Pt[]; right: Pt[] };

/**
 * The rails of a line sewn with `s` along `line` (closed: its first point repeated at the end): a
 * satin with its corners and ends (see satinJoins.ts), a zigzag or E stitch centered on the line.
 */
export function lineRailsOf(line: Pt[], closed: boolean, s: PathStitch): Band {
  return s.type === 'satin' ? strokeRails(line, closed, s.width, s.corner ?? 'miter', s.ends ?? 'flat') : lineRails(line, closed, s.width);
}

/** Runs from the core (see takeRuns), freed after. */
function runsOf(out: RunsOut): Pt[][] {
  try {
    return takeRuns(out).runs;
  } finally {
    out.free();
  }
}

const ptIn = (q?: Pt | null) => (q ? Float64Array.from(q) : undefined);

/**
 * The stitches along `line` (closed: its first point repeated at the end), from its end nearest
 * `start`. With `area`, a closed line is the edge of that area and a satin on it keeps out of the
 * area's corners (the rails do not fold over there). `reversed`: the line runs against the way it
 * was drawn (an E stitch keeps its prongs on the side of the drawn line all the same). `shift`: a
 * share of the period a zigzag, E stitch or motif starts later. Sewn by the core
 * (core/src/model/along.rs).
 */
export function sewAlong(line: Pt[], closed: boolean, s: PathStitch, start?: Pt, area?: Region, reversed = false, shift = 0): Pt[][] {
  return runsOf(core().sewAlong(flatOf(line), closed, s, ptIn(start), area && regionIn(area), reversed, shift));
}

/**
 * The lines a border on the edge of `r` (or `offset` from it) lies on, without the edges that
 * shapes on top cut (with `whole`, the area before they were left out): closed loops, or open
 * pieces where a part of the edge is covered.
 */
export function borderLines(r: Region, offset: number, whole?: Region | null): { line: Pt[]; closed: boolean }[] {
  const out = core().borderLines(regionIn(r), offset, whole ? regionIn(whole) : undefined);
  try {
    const flags = out.takeFlags();
    return takeRuns(out).runs.map((line, k) => ({ line, closed: !!(flags[k] & 1) }));
  } finally {
    out.free();
  }
}

/**
 * The stitches of a border on the edge of `r` (or `s.offset` from it), loop by loop, starting near
 * `from`. With `whole` (the area before shapes on top were left out), edges they cut get none: it
 * would be hidden under them.
 */
export function borderStitches(r: Region, s: PathStitch, from: Pt, whole?: Region | null): Pt[][] {
  return runsOf(core().borderStitches(regionIn(r), s, from[0], from[1], whole ? regionIn(whole) : undefined));
}

/**
 * The stitches of a fill's border along the open paths of its form (the fill leaves them unfilled,
 * see geo.ts), each from the end nearest the needle, starting near `from`. Where shapes on top
 * cover the fill (`r` the area sewn, `whole` the area before they were left out) they are left
 * out, as the edge is there. Its offset is the edge's: an open path has no inside or outside.
 */
export function openStitches(open: Form, s: PathStitch, from: Pt, r: Region, whole?: Region | null): Pt[][] {
  return runsOf(core().openStitches(open, s, from[0], from[1], regionIn(r), whole ? regionIn(whole) : undefined));
}

/**
 * The stitches along the cuts between the parts `parts` of a fill cut apart (in sewing order), each
 * line from its end nearest the last stitch: the edge of each part where it lies on a part sewn
 * before it (the one on top shows its edge), away from the edge of all parts together (`area`).
 */
export function seamStitches(parts: readonly Region[], area: Region, s: PathStitch, from: Pt): Pt[][] {
  return runsOf(core().seamStitches(parts.map(regionIn), regionIn(area), s, from[0], from[1]));
}
