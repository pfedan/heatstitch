import { LOCK_MM, SATIN_SPLIT_MM, SATIN_SPLIT_MAX } from '../material/rules';
import { SATIN_MAX, satinForArea, type KeptShape } from '../digitize/digitize';
import { borderStitches, runLike, type PathStitch } from './along';
import { wholeOf } from './knockout';
import { LINE_MOTIFS } from '../digitize/motif';
import { lineStitches, runAsLine } from './line';
import { chooseAngle, fillRegion, type FillParams } from '../digitize/fill';
import { contourFill, fieldFill, guideField, stitchField } from '../digitize/flow';
import { atShare, crossFill, CROSS_KINDS, echoFill, circleField, grainField, GRID_KINDS, gridFill, mazeFill, meanderFill, MOTIFS, rayField, regionBox, swirlField, waveFill, type CrossKind, type GridKind, type Motif, type OpenParams } from '../digitize/deco';
import { spiralFill } from '../digitize/spiral';
import { isEcho } from '../digitize/echo';
import { isShadow } from './shadow';
import { coverage } from '../digitize/measure';
import { expandRegion, outline, sample, signedField, type Region } from '../digitize/region';
import { runStitch, TOLERANCE } from '../digitize/run';
import { eStitches, pairs, satinStitches, underlayOf, type Column, type SatinParams, type UnderInset, type UnderlayKind } from '../digitize/satin';
import { columnFromRungs, cumulative, inside, pointAt, project, reversedRungs, stripOfLoop, tidyRungs, type Arc, type Rung } from '../digitize/rungs';
import type { Pt } from '../digitize/skeleton';
import { flatten, formFrom, storeForm, type Form, type StoredPath } from '../shape/path';
import { rasterize, rasterizeStroke, type LineCap } from '../shape/rasterize';
import { distanceInside, distanceToSeeds } from '../image/edt';
import { tidy, withRecords } from './edit';
import { coversOver, cutAway, type Cover } from './covers';
import { backToVersion, entryOf, hasTable, hold, keepVersion, knowKinds, rememberObjects, setMemory, setObjects, setObjectsFromKeys, stitchIndex, stitchKey, tableOf, type ObjectKind, type PlacedEntry, type SewObject } from './objects';
import { END, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { SATIN, stitchKinds, TIE_STITCH } from './sequence';
import { gradientOf, patchArea, patchSpacing, rowPatches, type RowPatch } from './rows';
import { letteringFrom } from '../lettering/stored';
import type { Lettering } from '../lettering/layout';

/**
 * New stitches for the objects of a design, with other settings: density, angle, stitch length,
 * underlay, edges. The shape comes from the stitches themselves (any file has them): the rows of a
 * fill are drawn thick enough to touch and closed, which gives the area they cover with its edge
 * at the row ends; a satin column's two rails are its penetrations, left and right in turn; a
 * running stitch is its path. That is what commercial software calls stitch recognition, and like
 * there the result follows the original closely but not exactly.
 *
 * An object is cut off before and after (see objects.ts), so only its own stitches change. Inside
 * an object the parts of other kinds stay as they were (a satin border sewn with a fill without a
 * trim keeps its stitches when the fill changes).
 */

/**
 * How the rows of a fill run: straight (tatami), straight with a spacing that changes across the
 * shape (gradient), along the outline (contour), as one line winding to the middle (spiral), with
 * the directions and curves of the rows sewn now (follow), or along lines drawn on it (guided);
 * or not at all (none): only its border is sewn, in its thread, as the whole object.
 */
export type FillPattern = 'tatami' | 'gradient' | 'contour' | 'spiral' | 'follow' | 'guided' | DecoPattern | OpenPattern | 'none';
/** Dense fills with curved rows laid on a field drawn from a few numbers (see deco.ts). */
export type DecoPattern = 'waves' | 'grain' | 'rays' | 'swirl' | 'circles';
/** One line through the area, the fabric showing between (see deco.ts). */
export type OpenPattern = 'meander' | 'maze' | 'grid' | 'echo' | 'cross';
export const OPEN_PATTERNS: OpenPattern[] = ['meander', 'maze', 'grid', 'echo', 'cross'];
export const DECO_PATTERNS: DecoPattern[] = ['waves', 'grain', 'rays', 'swirl', 'circles'];
export const isOpenPattern = (p: FillPattern): p is OpenPattern => (OPEN_PATTERNS as FillPattern[]).includes(p);

/** Settings of the decorative patterns; each falls back to DECO_DEFAULTS when not set. */
export interface DecoSettings {
  /** Tatami: needle points on the lines of this motif (embossing). */
  emboss?: Motif;
  /** Size of one motif (mm). */
  embossSize?: number;
  /** Embossing that shows clearly: shorter stitches inside the motif as well (see motifInside). */
  embossStrong?: boolean;
  /** Waves: from the middle to a crest, and from crest to crest (mm). */
  height?: number;
  length?: number;
  /** Grain: how far the rows wander from their direction, 0 to 1. */
  strength?: number;
  /** Rays and circles: their middle, as a share (0 to 1) of the shape's width and height. */
  focus?: Pt;
  /** Swirls: their eyes, shares like `focus`; picked by `seed` when not set. */
  centers?: Pt[];
  /** Grain, swirls, meander and maze: which of the random ones. */
  seed?: number;
  /** Open patterns: distance between the lines, or the size of a cell (mm). */
  size?: number;
  /** Open patterns: every stitch three times. */
  triple?: boolean;
  grid?: GridKind;
  cross?: CrossKind;
  /** Gradient: the density falls evenly to nearly nothing (out) or rises from it (in), for color blends. */
  fade?: 'out' | 'in';
  /**
   * A color blend: a second object in `color` fades the other way on the same area. It follows
   * the fill like a border of its own thread (see syncBlends), found by `link`.
   */
  blend?: { color: ThreadColor; link: string };
}

export const DECO_DEFAULTS = {
  embossSize: 8,
  height: 1.8,
  length: 20,
  strength: 0.5,
  // Rays rise from near the bottom, like a sun on the horizon.
  focus: [0.5, 0.9] as Pt,
  seed: 1,
  triple: false,
  grid: 'hex' as GridKind,
  cross: 'full' as CrossKind,
};

/** At most this many swirls in one fill. */
export const MAX_SWIRLS = 3;

/** Circles go round the middle of the shape when no point is set. */
const CIRCLES_FOCUS: Pt = [0.5, 0.5];

/** Open patterns: distance between lines or cell size when none is set (mm). */
export const OPEN_SIZE: Record<OpenPattern, number> = { meander: 2.5, maze: 2.5, grid: 6, echo: 3, cross: 2.5 };
/** Open patterns: the range of `size` (mm). */
export const OPEN_SIZE_RANGE: Record<OpenPattern, [number, number]> = { meander: [1.2, 8], maze: [1.2, 8], grid: [3, 20], echo: [1.2, 10], cross: [1.5, 6] };
/**
 * Decorative fields may crowd rows more than a plain curved fill before they give up (in times the
 * nominal density): rows meet at the start of rays and wind tight at the eye of a swirl, as in the
 * radial and spiral fills of commercial software.
 */
const DECO_PEAK = 3;
const DECO_PEAK_POINT = 5;

export interface FillSettings {
  pattern: FillPattern;
  /** Row spacing (mm); for a gradient where it starts. */
  spacing: number;
  /** Gradient: spacing on the far side (mm). */
  spacingEnd: number;
  /** Rows get further apart evenly from spacing to spacingEnd; curved patterns (follow, guided). */
  gradient?: boolean;
  /** Tatami: shift of the needle points from row to row (fraction of a stitch; 0 at random). */
  offset: number;
  /** Direction of the rows, degrees 0 to 180 (tatami and gradient). */
  angle: number;
  /** Stitch length (mm). */
  stitch: number;
  underlay: boolean;
  /** Rows reach this much further (+) or less far (-) than now at both ends (mm). */
  edge: number;
  /** `edge` follows the fabric (see pullFor): it changes with the material when tuned to it. */
  edgeAuto?: boolean;
  /** Largest distance of a curved row's stitches from its line (mm); see TOLERANCE. */
  tolerance: number;
  /** Guided: the lines the rows follow (world mm). */
  guides?: Pt[][];
  /** Underlay in two crossing layers instead of one across the rows. */
  underCross?: boolean;
  /** Underlay stays this far inside the edge (mm); 0.4 when not set. */
  underInset?: number;
  /** No underlay where objects sewn later cover the fill completely. */
  underCover?: boolean;
  /** Underlay inset by this share of the width where it is (0.1 = 10 %), in place of `underInset`. */
  underInsetShare?: number;
  /** Distance between the underlay rows (mm); three times the spacing, at least 1.2 mm, when not set. */
  underSpacing?: number;
  /** A fill along a line (Remembered.asLine): the width of the line (mm) and how its ends are drawn. */
  lineWidth?: number;
  lineCap?: LineCap;
  /** The area grown (+) or shrunk (-) on all sides before it is filled (mm); 0 when not set. */
  expand?: number;
  /** A border sewn on the edge after the fill; none when not set. */
  border?: BorderSettings;
  /** Settings of the decorative patterns and of embossing. */
  deco?: DecoSettings;
}

/**
 * A fill's border: its kind, the width of a satin, and its own thread. In the fill's thread it is
 * sewn as the last part of the fill object; in another thread it is an object of its own (see
 * border.ts in model), found by `link`, that follows the fill's shape.
 */
/** A border: stitches along the fill's edge (see along.ts). */
export interface BorderSettings extends PathStitch {
  /** Its own thread; the fill's when not set. */
  color?: ThreadColor;
  /** Marks the border object in its own thread (Remembered.outline). */
  link?: string;
}

export interface SatinSettings {
  /** Distance between penetrations on one side (mm). */
  spacing: number;
  /** Wider (+) or narrower (-) on each side than now (mm). */
  edge: number;
  short: boolean;
  underlay: boolean;
  /** Largest distance of the underlay's stitches from the column's middle (mm). */
  tolerance: number;
  /** Satin, or an E stitch (blanket stitch) along the left rail; satin when not set. */
  type?: SatinType;
  /** Which underlay, when `underlay` is on; by the width when not set. */
  under?: UnderlayKind;
  /** Contour and zigzag underlay keep this far inside the rails (mm); 0.4 (at most a fourth of the width) when not set. */
  underInset?: number;
  /** Underlay inset by this share of the width from each rail (0.1 = 10 %), in place of `underInset`. */
  underInsetShare?: number;
  /** Stitches longer than this are split (mm); 12 when not set. */
  split?: number;
  /** Split points staggered from stitch to stitch; on when not set. */
  stagger?: boolean;
  /** Wider on each side by this share of the width (0.1 = 10 %), on top of `edge`. */
  edgeShare?: number;
  /** The right side gets this instead of `edge` (mm), when set. */
  edgeB?: number;
  /** Spacing grows on narrow and shrinks on wide parts of the column (see widthFactor). */
  byWidth?: boolean;
  /** `edge` and `edgeShare` follow the fabric (see pullFor). */
  edgeAuto?: boolean;
}

export type SatinType = 'satin' | 'e';
export const UNDERLAYS: UnderlayKind[] = ['auto', 'center', 'contour', 'zigzag', 'both'];
/** Longest satin stitch before it is split (mm) when the object does not say (see SATIN_SPLIT_MM). */
export const SATIN_SPLIT = SATIN_SPLIT_MM;

export interface RunSettings {
  stitch: number;
  /** Every stitch sewn three times (bean stitch). */
  triple: boolean;
  /** Largest distance of a stitch from the path (mm): stitches get shorter on curves. */
  tolerance: number;
}

export type Settings = { kind: 'fill'; s: FillSettings } | { kind: 'satin'; s: SatinSettings } | { kind: 'run'; s: RunSettings };

/** A stretch of one kind inside an object: stitch points `s` to `e` (records; jumps may lie between). */
export interface Part {
  kind: ObjectKind;
  s: number;
  e: number;
  /** The border of the fill, sewn as its last part (kind fill): made anew with the fill. */
  border?: boolean;
}

/** What an object is made of: its parts in sewing order, and the area its fill parts cover. */
export interface Analysis {
  parts: Part[];
  /** Area of the fill parts (their stitches drawn thick, closed and opened), or null without fill. */
  fill: Region | null;
}

/** Fill rows touch when drawn this thick (mm on each side); travel lines vanish when opened by `OPEN`. */
const REACH = 0.3;
/** Highest density allowed for curved rows, in times the nominal (where rows meet). */
const CONTOUR_PEAK = 3;
/** Half width of the band along the old thread that new travel may follow (mm). */
const TRAVEL_REACH = 0.5;
const OPEN = 0.36;

/**
 * Splits an object into fill, satin and running stitch. Satin comes from the recognizer (its
 * columns are reliable); for the rest, the area covered by the object's other stitches is traced
 * (thin lines like travel and outlines drop out of it), and every stitch inside that area is fill:
 * rows, underlay and travel under the rows. What lies outside is running stitch of its own.
 */
// What objects were last sewn with ------------------------------------------------------------

/** The two sides of a satin column: its penetrations, left and right in turn (mm). */
export interface Rails {
  left: Pt[];
  right: Pt[];
  /**
   * Rungs across the column (see rungs.ts). Not set: each pair of penetrations is one, so the
   * stitches keep the directions they had. Set (also empty): the direction is interpolated
   * between these rungs and the two ends.
   */
  rungs?: Rung[];
  /**
   * Cut lines across the column (as rungs): it is sewn in sections, each starting anew (its own
   * underlay and first stitch), one after the other without a trim. The column stays one.
   */
  cuts?: Rung[];
  /** Spacing set at places along the column: distance along the left rail and spacing (mm); see spacingAlong. */
  spacings?: [number, number][];
  /**
   * Rungs drawn anywhere across a section (its two ends on the section's outline, as world points):
   * also with both ends on one rail or on a cut line. A section with any sews as a column of its
   * own, its rails chosen anew so these rungs go from one to the other; a cut line it does not end
   * on becomes part of a rail, a shortcut of the path (see sectionsOf).
   */
  spans?: [Pt, Pt][];
  /**
   * Columns next to each other in the list with the same chain are sewn as one, without a trim
   * between them, like the sections of one column (a fill cut into strips by Trennlinien).
   */
  chain?: number;
  /**
   * The order the column's sections are sewn in (see sectionsOf), each from its start or turned
   * round, and where a trim comes before one. Not set: as sectionRun sews them. Only used while
   * the column has as many sections as the plan has steps.
   */
  plan?: SectionStep[];
  /**
   * The fill this chain was cut from (kept on one of its columns): its outline, its holes and the
   * cut lines, as world points, so the cut lines can be moved later and the parts made anew (see
   * stripsOfOutline).
   */
  split?: Split;
  /** The satin starts on the right rail instead of the left (and ends on the other side). */
  mirror?: boolean;
}

/** A fill cut into parts by cut lines (see Rails.split). */
export interface Split {
  /** The outsides of its areas (more than one when they lie apart, as the dot and stem of an i). */
  outlines: Pt[][];
  holes: Pt[][];
  cuts: [Pt, Pt][];
}

/** One section of a column in the order its satin is sewn: which, turned round, trimmed before. */
export interface SectionStep {
  sec: number;
  flip: boolean;
  trim: boolean;
  /** Its satin starts on the other rail (see Rails.mirror). */
  mirror?: boolean;
}

/** Whether a plan fits a column of n sections: each section once. */
export function planFits(plan: SectionStep[] | undefined, n: number): plan is SectionStep[] {
  return !!plan && plan.length === n && new Set(plan.map((x) => x.sec)).size === n && plan.every((x) => Number.isInteger(x.sec) && x.sec >= 0 && x.sec < n);
}

/**
 * The shape of an object and its settings, kept for the next edit: the fill area and fill
 * settings, the rails of its satin columns (per satin part) and satin settings. The next edit
 * starts from these instead of reading them again from the stitches of the last one, which would
 * let the shape drift a little with every change.
 */
export interface Remembered {
  /** Id of the object this is about (see objects.ts): it goes with it when the object is sewn anew. */
  id?: number;
  region: Region | null;
  fill?: FillSettings;
  satin?: SatinSettings;
  columns?: Rails[][];
  /** Penetrations moved, added or removed by hand since the object was last given new stitches. */
  hand?: number;
  /** The shape was read from the stitches when they were first changed by hand (not exact). */
  read?: boolean;
  /** The area of an object whose kind was changed here, so changing it back gives the same area. */
  shape?: Region;
  /**
   * The fill area as curves, once its shape was changed here (level Form, turned or scaled):
   * `region` is rastered from it, never the other way round.
   */
  form?: Form;
  /**
   * Parts of `form` that fills sewn later cover are left out of the stitches (computed, the form
   * stays whole). `cut` names the area that was sewn, to see when the shapes on top have changed.
   */
  knockout?: boolean;
  cut?: string;
  /** Leaving out: how far it still reaches under a satin on top, as a share of its width (0.3 when not set). */
  overlapShare?: number;
  /** A drawn line: sewn along these curves (see line.ts), not traced from its stitches. */
  path?: Form;
  /** How a line (`path`) is sewn: running, triple or satin stitch along it. */
  line?: PathStitch;
  /** This many stitches of the object, from `underFrom` on, are its underlay (sewn here). */
  under?: number;
  /** Its underlay starts after this many stitches of the object (other parts sewn before the fill). */
  underFrom?: number;
  /** The border in the fill's thread starts after this many stitches of the object. */
  borderAt?: number;
  /**
   * The parts it was sewn in here, in order: the kind of each and how many stitches of the object
   * it ends at. The next edit takes these instead of telling parts apart by how the stitches look
   * (see analyze); they hold only while the object has that many stitches.
   */
  parts?: SewnPart[];
  /**
   * A fill that was a satin here: the columns it had, so making it a satin again gives the same
   * satin back instead of one found anew on the area.
   */
  asSatin?: Rails[];
  /**
   * A fill along a line: the line is its shape (the area is always made from it, in the fill's
   * lineWidth and lineCap), and how it was sewn as a line, to make it a line again.
   */
  asLine?: LineFill;
  /** The object is the border of a fill in its own thread: the fill's `border.link`. */
  outline?: string;
  /** The object is the second thread of a color blend: the fill's `deco.blend.link` (see syncBlends). */
  blendOf?: string;
  /** The object is the shadow of a line: the line's `line.shadow.link` (see syncShadows). */
  shadowOf?: string;
  /** The object is copies of a line's echo in a thread of their own: the line's `echo.link` and the thread (see lineParts). */
  echoOf?: string;
  /** A border object: the settings it was sewn with (its `region` is the fill's area it was sewn on). */
  border?: BorderSettings;
  /** The lettering the object belongs to (it is sewn anew from its text, see lettering/). */
  lettering?: Lettering;
  /** The correction leaves the object as it is (set by hand). */
  lock?: boolean;
  /**
   * Its stitches are loosed from its shape (by hand): they are never sewn anew, the shape rests
   * until the object is sewn from it again.
   */
  free?: boolean;
  /** What the correction changed when it last gave the object new stitches (gone with the next change by hand). */
  fixed?: Fixed[];
  /**
   * The object as it was before the correction last changed it: its records (absolute, as in the
   * design; the first `lead` of them the travel to it from the object before, the last `trail` the
   * travel from it to the next one) and what it remembered. "Korrektur zurücknehmen" puts exactly these back.
   */
  undo?: { x: Int32Array; y: Int32Array; cmd: Uint8Array; lead: number; trail?: number; memory?: Remembered };
}

/** A part an object was sewn in: its kind, and the number of the object's stitches up to its last one. */
export interface SewnPart {
  kind: ObjectKind;
  end: number;
  /** The fill's border in its thread (see Part.border). */
  border?: true;
}

/** A setting the correction changed: which, and its value before and after. */
export interface Fixed {
  field: string;
  from: number | boolean | string;
  to: number | boolean | string;
}

/**
 * Lets stitches be tried out: until the returned function is called what objects learn is kept
 * apart, and then it is put back as it was (what the tries remembered goes again).
 */
export const holdMemory = hold;

/**
 * The kind an object was sewn in, when what it remembers says so without doubt: a border or a
 * drawn line by how it is sewn along, else a fill or a satin by which settings it has. A lettering
 * or a shape read from stitches leaves it to the stitches.
 */
export function knownKind(r: Remembered | undefined): ObjectKind | undefined {
  if (!r || r.read || r.lettering) return undefined;
  if (r.outline && r.border) return runLike(r.border.type) ? 'run' : 'satin';
  if (r.path && r.line) return runLike(r.line.type) ? 'run' : 'satin';
  if (r.fill && !r.satin) return 'fill';
  if (r.satin && !r.fill) return 'satin';
  // Both settings (a fill made satin, or back): the columns only a satin keeps.
  if (r.satin && r.columns?.length) return 'satin';
  return undefined;
}

knowKinds(knownKind);

/** A key for an object's stitches. */
export const objectKey = (p: Pattern, o: SewObject): string => stitchKey(p, o.first, o.last);

/** Remembers `r` for object `o` of version `p`. */
export function remember(p: Pattern, o: SewObject, r: Remembered): void {
  setMemory(p, o.first, o.last, r);
}

/** Remembers `r` for the stitches from record `first` to `last` (an object's records). */
export function rememberRange(p: Pattern, first: number, last: number, r: Remembered): void {
  setMemory(p, first, last, r);
}

/** Forgets what object `o` of `p` remembered (or puts back `r`). */
export function forget(p: Pattern, o: SewObject, r?: Remembered): void {
  setMemory(p, o.first, o.last, r);
}

export { backToVersion, keepVersion };

/** Nothing to forget any more: what objects know belongs to their version (kept for tests that start afresh). */
export function forgetAll(): void {}

/** The object's shape and stitch type are only guessed from its stitches (a file from elsewhere), not known. */
export function isGuessed(p: Pattern, o: SewObject): boolean {
  const r = remembered(p, o);
  return !r || !!r.read;
}

export function remembered(p: Pattern, o: SewObject): Remembered | undefined {
  return entryOf(p, o.first, o.last)?.memory;
}

/**
 * What an object remembers, or its shape as read from its stitches now (fill area, satin rails),
 * so it can be kept fixed before its stitches are changed by hand.
 */
export function keepShape(p: Pattern, o: SewObject, kinds: Uint8Array): Remembered {
  const known = remembered(p, o);
  if (known?.columns) return known;
  const an = analyze(p, o, kinds);
  const satin = an.parts.filter((pt) => pt.kind === 'satin');
  // A satin that knows its shape (drawn, or from a vector file) but not its rails: read from the
  // stitches, laid onto the shape's edge.
  const columns = satin.map((pt) => readRails(p, pt, kinds, known));
  const read = satin.length && columns.every((c) => c.length) ? { columns } : {};
  return known ? { ...known, ...read } : { region: an.fill, read: true, ...read };
}

/** The rails of a satin part as its stitches have them, laid onto the edge of its shape when it is known. */
function readRails(p: Pattern, pt: Part, kinds: Uint8Array, known?: Remembered): Rails[] {
  const rails = satinColumns(p, pt, kinds).map((c) => railsOf(p, c)).filter((r): r is Rails => !!r);
  const edge = edgeOf(known);
  return edge ? rails.map((r) => ({ left: onEdge(r.left, r.right, edge), right: onEdge(r.right, r.left, edge) })) : rails;
}

/** The edge of a known shape as closed lines (its curves when drawn), or null. */
function edgeOf(known?: Remembered): Pt[][] | null {
  if (known?.form) return known.form.paths.map((path) => flatten(path, 0.05)).filter((l) => l.length > 2);
  if (known?.shape) return outline(known.shape) as Pt[][];
  return null;
}

/**
 * A rail moved onto the shape's edge, point by point: each to the nearest point of the edge, when
 * that is near (within a third of the column's width there), so it never jumps to the other side.
 */
function onEdge(rail: Pt[], other: Pt[], edge: Pt[][]): Pt[] {
  return rail.map((q, i) => {
    let best: Pt = q;
    let bd = Infinity;
    for (const line of edge) {
      for (let k = 1; k < line.length; k++) {
        const c = nearestOnSeg(q, line[k - 1], line[k]);
        const d = dist(c, q);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    }
    const w = dist(q, other[i] ?? q);
    return bd <= Math.max(0.3, w / 3) ? best : q;
  });
}

function nearestOnSeg(q: Pt, a: Pt, b: Pt): Pt {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / l2)) : 0;
  return [a[0] + vx * t, a[1] + vy * t];
}

/**
 * Keeps an object what it was after its stitches were changed by hand: the stitches from record
 * `first` to `last` of `after` are object `o` of `before`. Its sections stay one object, and its
 * shape, kind and settings move to the new stitches (the shape is not read from them again).
 */
export function carryOver(before: Pattern, o: SewObject, after: Pattern, first: number, last: number): void {
  let a = 0;
  let n = 0;
  for (let i = 0; i <= last && i < after.cmd.length; i++) {
    if (i === first) a = n;
    if (after.cmd[i] === STITCH) n++;
  }
  rememberObjects(after, [a], n);
  const r = remembered(before, o);
  setMemory(after, first, last, r ?? (o.id ? ({ region: null, read: true, id: o.id } as Remembered) : undefined));
}

/**
 * A remembered object as it is stored: the shape as its pixels only (the rest is rebuilt from
 * them). Entries with `join` are sections instead: whether they continue the object before.
 */
export interface StoredObject {
  key: string;
  region: { x0: number; y0: number; w: number; h: number; pxMm: number; mask: Uint8Array; areaMm2: number } | null;
  fill?: FillSettings;
  satin?: SatinSettings;
  /** Rails per satin part and column, as flat x, y lists; rungs as flat pairs of distances. */
  columns?: StoredRails[][];
  hand?: number;
  read?: boolean;
  /** The area of an object whose kind was changed, as `region`. */
  shape?: StoredObject['region'];
  /** The fill area as curves (see Remembered.form). */
  form?: StoredPath[];
  knockout?: boolean;
  cut?: string;
  overlapShare?: number;
  path?: StoredPath[];
  line?: PathStitch;
  under?: number;
  underFrom?: number;
  borderAt?: number;
  parts?: SewnPart[];
  asSatin?: StoredRails[];
  asLine?: { path: StoredPath[]; line: PathStitch; cap?: LineCap };
  outline?: string;
  blendOf?: string;
  shadowOf?: string;
  echoOf?: string;
  border?: BorderSettings;
  lettering?: Lettering;
  lock?: boolean;
  free?: boolean;
  fixed?: Fixed[];
  undo?: { x: Int32Array; y: Int32Array; cmd: Uint8Array; lead: number; trail?: number; memory?: StoredObject };
  join?: boolean;
}

/** Rails as stored: flat x, y lists; rungs, cut lines and spacings as flat pairs. */
export interface StoredRails {
  left: number[];
  right: number[];
  rungs?: number[];
  cuts?: number[];
  spacings?: number[];
  /** Free rungs: x, y of one end, then of the other. */
  spans?: number[];
  chain?: number;
  /** Plan: section, turned round (0/1), trimmed before (1) and mirrored (2) as bits, for each step. */
  plan?: number[];
  mirror?: 1;
  /** Split: flat x, y of each outline and of each hole; the cut lines as x, y of both ends. */
  split?: { outlines: number[][]; holes: number[][]; cuts: number[] };
}

const storeRails = (c: Rails): StoredRails => ({
  left: c.left.flat(),
  right: c.right.flat(),
  ...(c.rungs ? { rungs: c.rungs.flat() } : {}),
  ...(c.cuts?.length ? { cuts: c.cuts.flat() } : {}),
  ...(c.spacings?.length ? { spacings: c.spacings.flat() } : {}),
  ...(c.spans?.length ? { spans: c.spans.flat(2) } : {}),
  ...(c.chain !== undefined ? { chain: c.chain } : {}),
  ...(c.plan?.length ? { plan: c.plan.flatMap((x) => [x.sec, +x.flip, +x.trim | (x.mirror ? 2 : 0)]) } : {}),
  ...(c.mirror ? { mirror: 1 as const } : {}),
  ...(c.split ? { split: { outlines: c.split.outlines.map((o) => o.flat()), holes: c.split.holes.map((h) => h.flat()), cuts: c.split.cuts.flat(2) } } : {}),
});

/** One object's memory as stored with the file. */
function storeOne(key: string, r: Remembered): StoredObject {
  const pixels = (g: Region | null) => g && { x0: g.x0, y0: g.y0, w: g.w, h: g.h, pxMm: g.pxMm, mask: g.mask, areaMm2: g.areaMm2 };
  return {
    key,
    region: pixels(r.region),
    ...(r.shape ? { shape: pixels(r.shape) } : {}),
    ...(r.fill ? { fill: { ...r.fill } } : {}),
    ...(r.satin ? { satin: { ...r.satin } } : {}),
    ...(r.columns ? { columns: r.columns.map((part) => part.map(storeRails)) } : {}),
    ...(r.hand ? { hand: r.hand } : {}),
    ...(r.read ? { read: true } : {}),
    ...(r.form ? { form: storeForm(r.form) } : {}),
    ...(r.knockout ? { knockout: true } : {}),
    ...(r.cut ? { cut: r.cut } : {}),
    ...(r.overlapShare !== undefined ? { overlapShare: r.overlapShare } : {}),
    ...(r.path ? { path: storeForm(r.path) } : {}),
    ...(r.line ? { line: { ...r.line, ...(r.line.echo ? { echo: structuredClone(r.line.echo) } : {}), ...(r.line.shadow ? { shadow: { ...r.line.shadow, color: { ...r.line.shadow.color } } } : {}) } } : {}),
    ...(r.under ? { under: r.under } : {}),
    ...(r.underFrom ? { underFrom: r.underFrom } : {}),
    ...(r.borderAt ? { borderAt: r.borderAt } : {}),
    ...(r.parts ? { parts: r.parts.map((x) => ({ ...x })) } : {}),
    ...(r.asSatin ? { asSatin: r.asSatin.map(storeRails) } : {}),
    ...(r.asLine ? { asLine: { path: storeForm(r.asLine.path), line: { ...r.asLine.line }, cap: r.asLine.cap } } : {}),
    ...(r.outline ? { outline: r.outline } : {}),
    ...(r.blendOf ? { blendOf: r.blendOf } : {}),
    ...(r.shadowOf ? { shadowOf: r.shadowOf } : {}),
    ...(r.echoOf ? { echoOf: r.echoOf } : {}),
    ...(r.border ? { border: { ...r.border } } : {}),
    ...(r.lettering ? { lettering: r.lettering } : {}),
    ...(r.lock ? { lock: true } : {}),
    ...(r.free ? { free: true } : {}),
    ...(r.fixed?.length ? { fixed: r.fixed.map((x) => ({ ...x })) } : {}),
    ...(r.undo ? { undo: { x: r.undo.x.slice(), y: r.undo.y.slice(), cmd: r.undo.cmd.slice(), lead: r.undo.lead, ...(r.undo.trail ? { trail: r.undo.trail } : {}), ...(r.undo.memory ? { memory: storeOne(key, r.undo.memory) } : {}) } } : {}),
  };
}

/** How an object follows another one (its leader), as stored: see StoredEntry.of. */
export type FollowRole = 'border' | 'blend' | 'shadow' | 'echo';

/** One object of a version as stored (project version 2). */
export interface StoredEntry {
  id: number;
  /** Its first and last stitch, counted from 0 in sewing order. */
  first: number;
  last: number;
  /** Its stitches (see stitchKey) and where the first one is, to find them when the stitches moved. */
  key: string;
  at: [number, number];
  /** What it knows; absent for an object only recognized from its stitches. */
  memory?: Omit<StoredObject, 'key' | 'join'> & {
    /** The object it follows (by id) and how: its fill's border, its blend's second thread, its line's shadow or echo copies (n: the nearest copy). */
    of?: { id: number; role: FollowRole; n?: number };
  };
}

/** The object list of a version as stored with the file (project version 2). */
export interface StoredObjects {
  v: 2;
  /** The id the next new object gets. */
  next: number;
  objects: StoredEntry[];
}

/** Objects as stored with a file: a list of project version 2, or what version 1 kept by stitches. */
export type ObjectsAsStored = StoredObjects | StoredObject[];

/** Whether `v` is an object list as stored by project version 2 (else a list of an older version). */
export const isStoredObjects = (v: unknown): v is StoredObjects => !!v && typeof v === 'object' && (v as StoredObjects).v === 2 && Array.isArray((v as StoredObjects).objects);

/** The link a leader gives its followers of `role`. */
function leaderLink(m: Remembered, role: FollowRole): string | undefined {
  if (role === 'border') return m.fill?.border?.link;
  if (role === 'blend') return m.fill?.deco?.blend?.link;
  if (role === 'shadow') return m.line?.shadow?.link;
  return m.line?.echo?.link;
}

/** What object `m` follows: the link it names and how. */
function followed(m: Remembered): { link: string; role: FollowRole; n?: number } | null {
  if (m.outline) return { link: m.outline, role: 'border' };
  if (m.blendOf) return { link: m.blendOf, role: 'blend' };
  if (m.shadowOf) return { link: m.shadowOf, role: 'shadow' };
  if (m.echoOf) {
    const k = m.echoOf.lastIndexOf(':');
    const n = Number(m.echoOf.slice(k + 1));
    return k > 0 && Number.isInteger(n) ? { link: m.echoOf.slice(0, k), role: 'echo', n } : { link: m.echoOf, role: 'echo' };
  }
  return null;
}

/** What the objects of `p` are and know, to store it with the file. */
export function rememberedIn(p: Pattern, _objects?: SewObject[]): StoredObjects {
  const t = tableOf(p);
  const ix = stitchIndex(p);
  // Leaders by the links they give.
  const leaders = new Map<string, number>();
  for (const e of t.entries) {
    const m = e.memory;
    if (!m) continue;
    for (const role of ['border', 'blend', 'shadow', 'echo'] as const) {
      const l = leaderLink(m, role);
      if (l && !leaders.has(`${role} ${l}`)) leaders.set(`${role} ${l}`, e.id);
    }
  }
  return {
    v: 2,
    next: t.next,
    objects: t.entries.map((e): StoredEntry => {
      const where = { id: e.id, first: ix.before[e.first], last: ix.before[e.last], key: stitchKey(p, e.first, e.last), at: [p.x[e.first], p.y[e.first]] as [number, number] };
      if (!e.memory) return where;
      const { key: _k, outline: _o, blendOf: _b, shadowOf: _s, echoOf: _e, ...stored } = storeOne('', e.memory);
      const f = followed(e.memory);
      const leader = f ? leaders.get(`${f.role} ${f.link}`) : undefined;
      // A follower whose leader is gone keeps naming it, as it did (the next change drops it).
      const keep = f && (leader === undefined || leader === e.id) ? { [f.role === 'border' ? 'outline' : f.role === 'blend' ? 'blendOf' : f.role === 'shadow' ? 'shadowOf' : 'echoOf']: f.role === 'echo' ? e.memory.echoOf : f.link } : {};
      return { ...where, memory: { ...stored, ...keep, ...(f && leader !== undefined && leader !== e.id ? { of: { id: leader, role: f.role, ...(f.n !== undefined ? { n: f.n } : {}) } } : {}) } };
    }),
  };
}

/** What object `o` of `p` knows, as stored (to keep it with a shape set aside). */
export function storedOf(p: Pattern, o: SewObject): StoredObject | undefined {
  const m = remembered(p, o);
  return m && storeOne(objectKey(p, o), m);
}

/** What a stored object knew, back (null when it does not hold). */
export function memoryFrom(e: StoredObject): Remembered | null {
  return fromStored({ ...e, key: e.key ?? '' });
}

const isValue = (v: unknown) => finite(v) || typeof v === 'boolean' || typeof v === 'string';
const isFixed = (x: unknown): x is Fixed => !!x && typeof (x as Fixed).field === 'string' && isValue((x as Fixed).from) && isValue((x as Fixed).to);
/** Underlay is left out only this far inside what covers it (mm), so its edge stays held. */
const UNDER_COVER_MARGIN = 0.5;
const PATTERNS: FillPattern[] = ['tatami', 'gradient', 'contour', 'spiral', 'follow', 'guided', ...DECO_PATTERNS, ...OPEN_PATTERNS, 'none'];
const isLine = (l: unknown) => Array.isArray(l) && l.length >= 2 && l.every((q) => Array.isArray(q) && q.length === 2 && q.every(finite));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const KINDS: ObjectKind[] = ['fill', 'satin', 'run'];

/** Sewn parts as stored, or undefined when they are not a list of kinds with growing ends. */
function partsFrom(list: unknown): SewnPart[] | undefined {
  if (!Array.isArray(list) || !list.length) return undefined;
  let last = 0;
  for (const x of list as SewnPart[]) {
    if (!x || !KINDS.includes(x.kind) || !Number.isInteger(x.end) || x.end <= last) return undefined;
    last = x.end;
  }
  return (list as SewnPart[]).map((x) => ({ kind: x.kind, end: x.end, ...(x.border === true ? { border: true as const } : {}) }));
}

function isFill(f: unknown): f is FillSettings {
  const s = f as FillSettings | null;
  return (
    !!s &&
    PATTERNS.includes(s.pattern) &&
    [s.spacing, s.spacingEnd, s.offset, s.angle, s.stitch, s.edge].every(finite) &&
    (s.tolerance === undefined || finite(s.tolerance)) &&
    (s.gradient === undefined || typeof s.gradient === 'boolean') &&
    (s.guides === undefined || (Array.isArray(s.guides) && s.guides.every(isLine))) &&
    (s.underCross === undefined || typeof s.underCross === 'boolean') &&
    (s.underInset === undefined || finite(s.underInset)) &&
    (s.underInsetShare === undefined || finite(s.underInsetShare)) &&
    (s.underSpacing === undefined || (finite(s.underSpacing) && s.underSpacing > 0)) &&
    (s.expand === undefined || finite(s.expand)) &&
    (s.border === undefined || isBorder(s.border)) &&
    (s.deco === undefined || isDeco(s.deco)) &&
    typeof s.underlay === 'boolean'
  );
}

const isShare = (f: unknown) => Array.isArray(f) && f.length === 2 && f.every(finite);

function isDeco(d: unknown): d is DecoSettings {
  const s = d as DecoSettings | null;
  return (
    !!s &&
    typeof s === 'object' &&
    (s.emboss === undefined || MOTIFS.includes(s.emboss)) &&
    [s.embossSize, s.height, s.length, s.strength, s.seed, s.size].every((v) => v === undefined || finite(v)) &&
    (s.focus === undefined || isShare(s.focus)) &&
    (s.centers === undefined || (Array.isArray(s.centers) && s.centers.length >= 1 && s.centers.length <= MAX_SWIRLS && s.centers.every(isShare))) &&
    (s.triple === undefined || typeof s.triple === 'boolean') &&
    (s.embossStrong === undefined || typeof s.embossStrong === 'boolean') &&
    (s.grid === undefined || GRID_KINDS.includes(s.grid)) &&
    (s.cross === undefined || CROSS_KINDS.includes(s.cross)) &&
    (s.fade === undefined || s.fade === 'out' || s.fade === 'in') &&
    (s.blend === undefined || (isColor(s.blend.color) && typeof s.blend.link === 'string'))
  );
}

const BORDERS: PathStitch['type'][] = ['run', 'triple', 'satin', 'zigzag', 'e', 'motif'];
const isColor = (c: unknown) => !!c && [(c as ThreadColor).r, (c as ThreadColor).g, (c as ThreadColor).b].every(finite);

export function isLineStitch(b: unknown): b is PathStitch {
  return isBorder(b) && (b as BorderSettings).color === undefined && (b as BorderSettings).link === undefined;
}

function isBorder(b: unknown): b is BorderSettings {
  const s = b as BorderSettings | null;
  return !!s && BORDERS.includes(s.type) && finite(s.width) && [s.length, s.repeat, s.tolerance, s.offset, s.spacing, s.pull].every((v) => v === undefined || finite(v)) && (s.flip === undefined || typeof s.flip === 'boolean') && (s.motif === undefined || LINE_MOTIFS.includes(s.motif)) && (s.under === undefined || s.under === 'off' || UNDERLAYS.includes(s.under)) && (s.color === undefined || isColor(s.color)) && (s.link === undefined || typeof s.link === 'string');
}

function isSatin(f: unknown): f is SatinSettings {
  const s = f as SatinSettings | null;
  const optional = (v: unknown) => v === undefined || finite(v);
  return (
    !!s &&
    [s.spacing, s.edge].every(finite) &&
    typeof s.short === 'boolean' &&
    typeof s.underlay === 'boolean' &&
    [s.tolerance, s.split, s.edgeShare, s.edgeB, s.underInset, s.underInsetShare].every(optional) &&
    (s.type === undefined || s.type === 'satin' || s.type === 'e') &&
    (s.under === undefined || UNDERLAYS.includes(s.under)) &&
    (s.stagger === undefined || typeof s.stagger === 'boolean')
  );
}

/** Stored rails back as points, or undefined when malformed. */
function railsFrom(list: unknown): Rails[][] | undefined {
  if (!Array.isArray(list)) return undefined;
  const pts = (v: unknown): Pt[] | null => {
    if (!Array.isArray(v) || v.length % 2 || v.length < 4 || !v.every(finite)) return null;
    const out: Pt[] = [];
    for (let i = 0; i < v.length; i += 2) out.push([v[i], v[i + 1]]);
    return out;
  };
  const out: Rails[][] = [];
  for (const part of list) {
    if (!Array.isArray(part)) return undefined;
    const cols: Rails[] = [];
    for (const c of part) {
      const left = pts(c?.left);
      const right = pts(c?.right);
      if (!left || !right) return undefined;
      const twos = (r: unknown): [number, number][] | undefined | null => {
        if (r === undefined) return undefined;
        if (!Array.isArray(r) || r.length % 2 || !r.every(finite)) return null;
        return Array.from({ length: r.length / 2 }, (_, k) => [r[2 * k], r[2 * k + 1]] as [number, number]);
      };
      const rungs = twos(c?.rungs);
      const cuts = twos(c?.cuts);
      const spacings = twos(c?.spacings);
      if (rungs === null || cuts === null || spacings === null) return undefined;
      const rails: Rails = rungs ? { left, right, rungs } : { left, right };
      if (cuts?.length) rails.cuts = cuts;
      if (spacings?.length && spacings.every(([, v]) => v > 0)) rails.spacings = spacings;
      const free = c?.spans;
      if (free !== undefined) {
        if (!Array.isArray(free) || free.length % 4 || !free.every(finite)) return undefined;
        if (free.length) rails.spans = Array.from({ length: free.length / 4 }, (_, k) => [[free[4 * k], free[4 * k + 1]], [free[4 * k + 2], free[4 * k + 3]]] as [Pt, Pt]);
      }
      if (c?.chain !== undefined) {
        if (!Number.isInteger(c.chain)) return undefined;
        rails.chain = c.chain;
      }
      const plan = c?.plan;
      if (plan !== undefined) {
        if (!Array.isArray(plan) || plan.length % 3 || !plan.every((v) => Number.isInteger(v))) return undefined;
        if (plan.length) rails.plan = Array.from({ length: plan.length / 3 }, (_, k) => ({ sec: plan[3 * k], flip: !!plan[3 * k + 1], trim: !!(plan[3 * k + 2] & 1), ...(plan[3 * k + 2] & 2 ? { mirror: true } : {}) }));
      }
      if (c?.mirror) rails.mirror = true;
      const split = c?.split;
      if (split !== undefined) {
        const outlines = Array.isArray(split?.outlines) ? split.outlines.map(pts) : null;
        const holes = Array.isArray(split?.holes) ? split.holes.map(pts) : null;
        const cuts = split?.cuts;
        if (!outlines?.length || outlines.some((o: Pt[] | null) => !o) || !holes || holes.some((h: Pt[] | null) => !h) || !Array.isArray(cuts) || cuts.length % 4 || !cuts.every(finite)) return undefined;
        rails.split = { outlines: outlines as Pt[][], holes: holes as Pt[][], cuts: Array.from({ length: cuts.length / 4 }, (_, k) => [[cuts[4 * k], cuts[4 * k + 1]], [cuts[4 * k + 2], cuts[4 * k + 3]]] as [Pt, Pt]) };
      }
      cols.push(rails);
    }
    out.push(cols);
  }
  return out;
}

/** A region from its pixels (null when malformed). */
function regionFrom(g: NonNullable<StoredObject['region']>): Region | null {
  const { x0, y0, w, h, pxMm, mask, areaMm2 } = g;
  if (![x0, y0, w, h, pxMm, areaMm2].every(finite) || !(mask instanceof Uint8Array)) return null;
  if (w < 1 || h < 1 || pxMm <= 0 || mask.length !== w * h) return null;
  const sdf = signedField(mask, w, h, pxMm);
  return { label: 0, x0, y0, w, h, pxMm, mask, inside: distanceInside(mask, w, h), sdf, sdfBase: sdf, areaMm2 };
}

/** The areas together, as one region (on the finest grid among them). */
export function unionRegion(rs: Region[]): Region | null {
  if (!rs.length) return null;
  if (rs.length === 1) return rs[0];
  const pxMm = Math.min(...rs.map((r) => r.pxMm));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rs) {
    minX = Math.min(minX, r.x0 * r.pxMm);
    minY = Math.min(minY, r.y0 * r.pxMm);
    maxX = Math.max(maxX, (r.x0 + r.w) * r.pxMm);
    maxY = Math.max(maxY, (r.y0 + r.h) * r.pxMm);
  }
  const x0 = Math.floor(minX / pxMm) - MARGIN;
  const y0 = Math.floor(minY / pxMm) - MARGIN;
  const w = Math.ceil(maxX / pxMm) + MARGIN - x0;
  const h = Math.ceil(maxY / pxMm) + MARGIN - y0;
  const mask = new Uint8Array(w * h);
  let area = 0;
  for (let y = 0; y < h; y++) {
    const yMm = (y + y0 + 0.5) * pxMm;
    for (let x = 0; x < w; x++) {
      const xMm = (x + x0 + 0.5) * pxMm;
      for (const r of rs) {
        const u = Math.floor(xMm / r.pxMm) - r.x0;
        const v = Math.floor(yMm / r.pxMm) - r.y0;
        if (u >= 0 && v >= 0 && u < r.w && v < r.h && r.mask[v * r.w + u]) {
          mask[y * w + x] = 1;
          area++;
          break;
        }
      }
    }
  }
  const sdf = signedField(mask, w, h, pxMm);
  return { label: 0, x0, y0, w, h, pxMm, mask, inside: distanceInside(mask, w, h), sdf, sdfBase: sdf, areaMm2: area * pxMm * pxMm };
}

/**
 * Remembers the exact areas the Image mode filled (`shapes`, by object, as `starts`: the number
 * of each object's first stitch), so editing them starts from those instead of the stitches.
 */
export function rememberShapes(p: Pattern, objs: SewObject[], starts: number[], shapes: (KeptShape | undefined)[], forms: ({ form?: Form; knockout?: boolean; path?: Form; line?: PathStitch } | undefined)[] = []): void {
  const at = new Map<number, SewObject>();
  let kinds: Uint8Array | undefined;
  let n = 0;
  let k = 0;
  for (let i = 0; i < p.cmd.length && k < objs.length; i++) {
    if (i === objs[k].first) at.set(n, objs[k++]);
    if (p.cmd[i] === STITCH) n++;
  }
  starts.forEach((s, j) => {
    const shape = shapes[j];
    const o = at.get(s);
    if (!o) return;
    // Sewn here as one part of its kind: the next edit takes it as that, whatever its stitches look like.
    const one = (kind: ObjectKind): SewnPart[] => {
      let end = 0;
      for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) end++;
      return [{ kind, end }];
    };
    const f = forms[j];
    if (f?.path) return remember(p, o, { region: null, path: f.path, ...(f.line ? { line: { ...f.line }, parts: one(runLike(f.line.type) ? 'run' : 'satin') } : {}) });
    // A satin from a vector file keeps its shape: its rails lie on the shape's edge.
    if (!shape && f?.form) return remember(p, o, { region: null, form: f.form, parts: one('satin') });
    // A satin made here (a narrow area): its rails, read from its fresh stitches, so it is known as
    // made here and not recognized again from its stitches later.
    if (!shape) {
      const { read: _read, ...known } = keepShape(p, o, (kinds ??= stitchKinds(p)));
      return remember(p, o, { ...known, parts: one('satin') });
    }
    const region = regionFrom(shape);
    if (region) remember(p, o, { region, fill: { ...shape.fill }, parts: one('fill'), ...(f?.form ? { form: f.form, ...(f.knockout ? { knockout: true } : {}) } : {}) });
  });
}

/** One object's memory from the file; null when it does not hold. */
function fromStored(e: StoredObject): Remembered | null {
  if (typeof e?.key !== 'string' || (e.fill !== undefined && !isFill(e.fill))) return null;
  const region = e.region ? regionFrom(e.region) : null;
  if (e.region && !region) return null;
  // Files from before the tolerance existed have none.
  const r: Remembered = { region, fill: e.fill && { ...e.fill, tolerance: e.fill.tolerance ?? TOLERANCE } };
  if (isSatin(e.satin)) r.satin = { ...e.satin, tolerance: e.satin.tolerance ?? TOLERANCE };
  const columns = railsFrom(e.columns);
  if (columns) r.columns = columns;
  if (finite(e.hand) && e.hand > 0) r.hand = Math.round(e.hand);
  if (e.read === true) r.read = true;
  const shape = e.shape ? regionFrom(e.shape) : null;
  if (shape) r.shape = shape;
  const form = e.form === undefined ? null : formFrom(e.form);
  if (form) r.form = form;
  if (form && e.knockout === true) r.knockout = true;
  if (typeof e.cut === 'string') r.cut = e.cut;
  if (finite(e.overlapShare) && e.overlapShare >= 0 && e.overlapShare <= 1) r.overlapShare = e.overlapShare;
  const path = e.path === undefined ? null : formFrom(e.path);
  if (path) r.path = path;
  if (path && isLineStitch(e.line)) {
    r.line = { ...e.line };
    if (r.line.echo !== undefined) {
      if (isEcho(r.line.echo)) r.line.echo = structuredClone(r.line.echo);
      else delete r.line.echo;
    }
    if (r.line.shadow !== undefined) {
      if (isShadow(r.line.shadow)) r.line.shadow = { ...r.line.shadow, color: { ...r.line.shadow.color } };
      else delete r.line.shadow;
    }
  }
  if (finite(e.under) && e.under > 0) r.under = Math.round(e.under);
  if (finite(e.underFrom) && e.underFrom > 0) r.underFrom = Math.round(e.underFrom);
  if (finite(e.borderAt) && e.borderAt > 0) r.borderAt = Math.round(e.borderAt);
  const parts = partsFrom(e.parts);
  if (parts) r.parts = parts;
  const asSatin = railsFrom([e.asSatin])?.[0];
  if (asSatin?.length) r.asSatin = asSatin;
  const asLine = e.asLine && formFrom(e.asLine.path);
  if (asLine && isLineStitch(e.asLine!.line)) r.asLine = { path: asLine, line: { ...e.asLine!.line }, cap: e.asLine!.cap === 'round' ? 'round' : 'flat' };
  if (typeof e.outline === 'string') r.outline = e.outline;
  if (typeof e.blendOf === 'string') r.blendOf = e.blendOf;
  if (typeof e.shadowOf === 'string') r.shadowOf = e.shadowOf;
  if (typeof e.echoOf === 'string') r.echoOf = e.echoOf;
  if (isBorder(e.border)) r.border = { ...e.border };
  const lettering = e.lettering === undefined ? null : letteringFrom(e.lettering);
  if (lettering) r.lettering = lettering;
  if (e.lock === true) r.lock = true;
  if (e.free === true) r.free = true;
  const fixed = Array.isArray(e.fixed) ? e.fixed.filter(isFixed).map((x) => ({ ...x })) : [];
  if (fixed.length) r.fixed = fixed;
  const undo = e.undo;
  if (undo && undo.x instanceof Int32Array && undo.y instanceof Int32Array && undo.cmd instanceof Uint8Array && undo.x.length === undo.y.length && undo.x.length === undo.cmd.length && finite(undo.lead) && undo.lead >= 0 && undo.lead < undo.x.length) {
    const trail = finite(undo.trail) && undo.trail > 0 && undo.lead + undo.trail < undo.x.length ? Math.round(undo.trail) : 0;
    const memory = undo.memory ? fromStored(undo.memory) : null;
    r.undo = { x: undo.x.slice(), y: undo.y.slice(), cmd: undo.cmd.slice(), lead: Math.round(undo.lead), ...(trail ? { trail } : {}), ...(memory ? { memory } : {}) };
  }
  return r;
}

/**
 * Gives version `p` the objects stored with it: an object list (project version 2), or what an
 * older project kept by the objects' stitches (version 1: the knowledge of each object and which
 * sections continued the object before). Malformed entries are skipped. Returns how many objects
 * know what they are.
 */
export function restoreRemembered(p: Pattern, list: unknown): number {
  // Nothing stored: a version that knows its objects keeps them.
  if (Array.isArray(list) && !list.length && hasTable(p)) return 0;
  if (isStoredObjects(list)) {
    const entries: PlacedEntry[] = [];
    const ofs: { at: number; of: NonNullable<NonNullable<StoredEntry['memory']>['of']> }[] = [];
    for (const e of list.objects) {
      if (!e || !finite(e.id) || !finite(e.first) || !finite(e.last) || typeof e.key !== 'string' || !Array.isArray(e.at) || !e.at.every(finite)) continue;
      const m = e.memory ? fromStored({ ...e.memory, key: '' } as StoredObject) : null;
      entries.push({ id: e.id, first: e.first, last: e.last, key: e.key, at: [e.at[0], e.at[1]], ...(m ? { memory: m } : {}) });
      const of = e.memory?.of;
      if (m && of && finite(of.id) && ['border', 'blend', 'shadow', 'echo'].includes(of.role)) ofs.push({ at: entries.length - 1, of });
    }
    // Followers name their leader's link again.
    for (const { at, of } of ofs) {
      const leader = entries.find((x) => x.id === of.id)?.memory;
      const link = leader && leaderLink(leader, of.role);
      if (!link) continue;
      const m = entries[at].memory!;
      if (of.role === 'border') m.outline = link;
      else if (of.role === 'blend') m.blendOf = link;
      else if (of.role === 'shadow') m.shadowOf = link;
      else m.echoOf = of.n !== undefined ? `${link}:${of.n}` : link;
    }
    setObjects(p, entries, finite(list.next) ? list.next : 1);
    return entries.filter((e) => e.memory).length;
  }
  if (!Array.isArray(list)) return 0;
  const joins = new Map<string, boolean>();
  const memory = new Map<string, Remembered>();
  for (const e of list as StoredObject[]) {
    if (typeof e?.key !== 'string') continue;
    if (typeof e.join === 'boolean') {
      joins.set(e.key, e.join);
      continue;
    }
    const r = fromStored(e);
    if (r) memory.set(e.key, r);
  }
  setObjectsFromKeys(p, joins, memory);
  return memory.size;
}

/** Curved patterns that can grow lighter across the shape (FillSettings.gradient). */
export const CURVED_GRADIENT: FillPattern[] = ['follow', 'guided'];

/** A fill whose rows get further apart across the shape: the gradient pattern, or curved rows set so. */
export const isGradient = (f: FillSettings): boolean => f.pattern === 'gradient' || (!!f.gradient && CURVED_GRADIENT.includes(f.pattern));

/**
 * Records of the fills sewn open on purpose (gradients), which the coverage check leaves out; null
 * when there are none.
 */
export function openOnPurpose(p: Pattern, objs: SewObject[]): Uint8Array | null {
  let out: Uint8Array | null = null;
  for (const o of objs) {
    const f = remembered(p, o)?.fill;
    if (!f || (!isGradient(f) && !isOpenPattern(f.pattern))) continue;
    out ??= new Uint8Array(p.cmd.length);
    out.fill(1, o.first, o.last + 1);
  }
  return out;
}

/**
 * How far the fill area of an object can be trusted: `kept` when it is the shape the object was
 * sewn with here, `good` when the rows recognized cover it closely, `approximate` when they are too
 * open to close into an area or leave parts of it uncovered (its edges are a guess).
 */
export type ShapeTrust = 'kept' | 'good' | 'approximate';

/** Rows further apart than this do not close into an area reliably (mm). */
const OPEN_ROWS = 0.6;
/** Share of the traced area the old rows must cover. */
const COVERED = 0.93;

export function shapeTrust(p: Pattern, o: SewObject, a: Analysis, spacing: number): ShapeTrust {
  if (!a.fill) return 'approximate';
  const known = remembered(p, o);
  if (known?.region === a.fill && !known.read) return 'kept';
  // Open rows read as such: the area lies between them, however far apart they are.
  const open = openRows.get(a.fill);
  if (open) spacing = Math.max(spacing, open);
  else if (spacing > OPEN_ROWS) return 'approximate';
  const runs: Pt[][] = [];
  for (const pt of a.parts) {
    if (pt.kind !== 'fill') continue;
    let run: Pt[] = [];
    for (let i = pt.s; i <= pt.e; i++) {
      if (p.cmd[i] !== STITCH) continue;
      if (i > pt.s && p.cmd[i - 1] !== STITCH && run.length) {
        runs.push(run);
        run = [];
      }
      run.push(pt10(p, i));
    }
    if (run.length) runs.push(run);
  }
  return coverage(a.fill, runs, Math.max(0.3, spacing * 0.75)) >= COVERED ? 'good' : 'approximate';
}

/**
 * The parts of an object and the area of its fill parts. An object sewn here knows them (the
 * parts it was sewn in, its area): they are taken as they are. Only an object whose parts are not
 * known (from a file from elsewhere, or with stitches added or taken away by hand since) has them
 * told apart by how its stitches look.
 */
export function analyze(p: Pattern, o: SewObject, kinds: Uint8Array, known = remembered(p, o)): Analysis {
  const idx: number[] = [];
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) idx.push(i);
  const sewn = sewnParts(idx, known);
  if (sewn) return { parts: sewn, fill: sewn.some((pt) => pt.kind === 'fill') ? known!.region : null };
  if (idx.length < 3) return { parts: [{ kind: o.kind === 'fill' ? 'run' : o.kind, s: o.first, e: o.last }], fill: null };
  // A stitch is the segment from the point before to point k.
  const sewnSeg = (k: number) => k > 0 && p.cmd[idx[k] - 1] === STITCH;
  const len = idx.map((i, k) => (sewnSeg(k) ? seg(p, i) : 0));
  const W = 8;
  const satin = idx.map((_, k) => {
    let sat = 0;
    let all = 0;
    for (let j = Math.max(1, k - W); j <= Math.min(idx.length - 1, k + W); j++) {
      all += len[j];
      if (kinds[idx[j]] === SATIN) sat += len[j];
    }
    return kinds[idx[k]] === SATIN || sat >= all * 0.5;
  });
  const others: number[] = [];
  for (let k = 1; k < idx.length; k++) if (sewnSeg(k) && !satin[k]) others.push(idx[k]);
  const traced = known?.region ?? (others.length > 4 ? traceRegion(p, others, REACH, OPEN) : null);
  const region = known?.region ?? withOpenRows(p, o, others, traced);
  const inFill = (k: number) => {
    if (!region) return false;
    const i = idx[k];
    const mx = (p.x[i] + p.x[i - 1]) / 20;
    const my = (p.y[i] + p.y[i - 1]) / 20;
    return sample(region, region.sdfBase, mx, my) < 0.15 && sample(region, region.sdfBase, p.x[i] / 10, p.y[i] / 10) < 0.25;
  };
  const kindAt: ObjectKind[] = idx.map((_, k) => (k === 0 ? 'run' : satin[k] ? 'satin' : inFill(k) ? 'fill' : 'run'));
  kindAt[0] = kindAt[1] ?? 'run';
  const raw: { kind: ObjectKind; a: number; b: number }[] = [];
  for (let k = 1; k < idx.length; k++) {
    const last = raw[raw.length - 1];
    if (last && last.kind === kindAt[k]) last.b = k;
    else raw.push({ kind: kindAt[k], a: k - 1, b: k });
  }
  // Stretches of a few stitches (locks, a corner) go with the stretch before (or after, at the start).
  const MIN = 6;
  const merged: typeof raw = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && (last.kind === r.kind || r.b - r.a < MIN)) last.b = r.b;
    else if (last && merged.length === 1 && last.b - last.a < MIN) {
      last.kind = r.kind;
      last.b = r.b;
    } else merged.push({ ...r });
  }
  // A border in the fill's thread, sewn here as the last part, starts at this record.
  const at = known?.fill?.border && !known.fill.border.color && known.borderAt ? idx[known.borderAt] : undefined;
  // Running stitch under a satin column (its underlay, also when trimmed off from it) is part of it.
  // Not under the fill's own satin border: travel of the fill along its edge lies there too.
  const satinSegs: number[] = [];
  for (let k = 1; k < idx.length; k++) if (kindAt[k] === 'satin' && sewnSeg(k) && !(at !== undefined && idx[k] > at)) satinSegs.push(idx[k]);
  const column = satinSegs.length > 4 ? traceRegion(p, satinSegs, REACH) : null;
  if (column) {
    for (const r of merged) {
      if (r.kind !== 'run') continue;
      let inside = 0;
      for (let k = r.a; k <= r.b; k++) if (sample(column, column.sdfBase, p.x[idx[k]] / 10, p.y[idx[k]] / 10) < 0.2) inside++;
      if (inside >= (r.b - r.a + 1) * 0.8) r.kind = 'satin';
    }
  }
  // A satin made here is satin all along: where rungs slant its stitches far, they are split and
  // look like fill rows to the recognizer.
  if (known?.satin && known.columns?.length) for (const r of merged) if (r.kind === 'fill') r.kind = 'satin';

  const parts: Part[] = [];
  for (const r of merged) {
    const last = parts[parts.length - 1];
    if (last && last.kind === r.kind) last.e = idx[r.b];
    else parts.push({ kind: r.kind, s: idx[r.a], e: idx[r.b] });
  }
  return withBorder(o, idx, known, parts, region);
}

/**
 * The parts an object was sewn in here (see Remembered.parts), as records of its stitch points
 * `idx`; neighbouring parts share the point between them. Null when they are not known or no
 * longer fit its stitches, or a fill part has no area to go with it.
 */
function sewnParts(idx: number[], known: Remembered | undefined): Part[] | null {
  const sp = known?.parts;
  if (!sp?.length || known!.read || sp[sp.length - 1].end !== idx.length) return null;
  if (sp.some((x) => x.kind === 'fill') && !known!.region) return null;
  const parts: Part[] = [];
  let from = 0;
  for (const x of sp) {
    const last = parts[parts.length - 1];
    if (last && last.kind === x.kind && !last.border && !x.border) last.e = idx[x.end - 1];
    else parts.push({ kind: x.kind, s: idx[Math.max(0, from - 1)], e: idx[x.end - 1], ...(x.border ? { border: true } : {}) });
    from = x.end;
  }
  return parts;
}

/** Rows this far apart or more do not close into an area by traceRegion: they are read as rows (mm). */
const OPEN_PATCH = 0.5;
/** Areas that take in open rows, with the widest distance between those rows. */
const openRows = new WeakMap<Region, number>();
/** Areas with open rows lately, by the object's stitches (see traced). */
const withRows = new Map<string, { region: Region | null; open: number }>();

/**
 * The area `traced` from an object's stitches, with the patches of open rows among the stitches
 * `segs` (a gradient, a light fill) added as the strips between their rows.
 */
function withOpenRows(p: Pattern, o: SewObject, segs: number[], traced: Region | null): Region | null {
  const key = `${stitchKey(p, o.first, o.last)}:${segs.length}`;
  let got = withRows.get(key);
  if (!got) {
    const open = openPatches(p, segs);
    const area = open.length ? patchArea(open, traced?.pxMm ?? 0.1) : null;
    const region = area ? (traced ? unionRegion([traced, area]) : area) : traced;
    got = { region, open: area ? Math.max(...open.map(patchSpacing)) : 0 };
    withRows.set(key, got);
    if (withRows.size > TRACED_SIZE) withRows.delete(withRows.keys().next().value!);
  }
  if (!got.region) return null;
  const r = { ...got.region };
  if (got.open) openRows.set(r, got.open);
  return r;
}

/** The patches of rows further apart than OPEN_PATCH among the stitches `segs` (records). */
function openPatches(p: Pattern, segs: number[]): RowPatch[] {
  const out: RowPatch[] = [];
  // Stretches of stitches one after the other.
  for (let k = 0; k < segs.length; ) {
    let e = k;
    while (e + 1 < segs.length && segs[e + 1] === segs[e] + 1) e++;
    if (e - k >= 6) for (const pt of rowPatches(p, segs[k] - 1, segs[e])) if (patchSpacing(pt) >= OPEN_PATCH) out.push(pt);
    k = e + 1;
  }
  return out;
}

/** The parts with a border in the fill's thread, sewn here as the last part, as one part from where it starts. */
function withBorder(o: SewObject, idx: number[], known: Remembered | undefined, list: Part[], region: Region | null): Analysis {
  let parts = list;
  const at = known?.fill?.border && !known.fill.border.color && known.borderAt ? idx[known.borderAt] : undefined;
  if (at !== undefined && parts.some((pt) => pt.kind === 'fill' && pt.s < at)) {
    parts = parts.filter((pt) => pt.s < at).map((pt) => (pt.e > at ? { ...pt, e: at } : pt));
    parts.push({ kind: 'fill', s: at, e: o.last, border: true });
  }
  return { parts, fill: parts.some((pt) => pt.kind === 'fill') ? region : null };
}

const seg = (p: Pattern, i: number) => Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;

function percentile(v: number[], q: number): number {
  if (!v.length) return 0;
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// Shapes from fill stitches ---------------------------------------------------------------------

const MARGIN = 4;

/**
 * The area the stitches `segs` (records; each the stitch from the record before) cover: drawn
 * `reach` mm thick and closed by as much, so rows up to 2 * reach apart merge and the edge lies at
 * the row ends; then opened by `open`, which removes lines narrower than 2 * open (travel, outlines).
 * Without `close` the lines just stay `reach` thick (where the thread went).
 */
/**
 * Regions traced lately, by the segments they were traced from: the correction tries many variants
 * of one design, and each try reads the same unchanged objects again. A copy is handed out, so a
 * caller that sets its own fields leaves the kept one as it was.
 */
const traced = new Map<string, Region | null>();
const TRACED_SIZE = 96;

export function traceRegion(p: Pattern, segs: number[], reach: number, open = 0, close = true): Region | null {
  // Two independent hashes over the segment ends: a wrong hit would need both to collide.
  let h1 = 0x811c9dc5;
  let h2 = 0x1234567;
  for (const i of segs) {
    for (const v of [p.x[i - 1], p.y[i - 1], p.x[i], p.y[i]]) {
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 + v, 0x5bd1e995) ^ (h2 >>> 15);
    }
  }
  const key = `${segs.length}:${h1 >>> 0}:${h2 >>> 0}:${reach}:${open}:${+close}`;
  if (traced.has(key)) {
    const r = traced.get(key)!;
    traced.delete(key);
    traced.set(key, r);
    return r && { ...r };
  }
  const r = traceRegionNow(p, segs, reach, open, close);
  traced.set(key, r);
  if (traced.size > TRACED_SIZE) traced.delete(traced.keys().next().value!);
  return r && { ...r };
}

function traceRegionNow(p: Pattern, segs: number[], reach: number, open: number, close: boolean): Region | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of segs) {
    for (const j of [i - 1, i]) {
      minX = Math.min(minX, p.x[j]);
      maxX = Math.max(maxX, p.x[j]);
      minY = Math.min(minY, p.y[j]);
      maxY = Math.max(maxY, p.y[j]);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const wMm = (maxX - minX) / 10 + 2 * reach;
  const hMm = (maxY - minY) / 10 + 2 * reach;
  const pxMm = Math.max(0.05, Math.sqrt((wMm * hMm) / 1.5e6), reach / 5);
  const x0 = Math.floor((minX / 10 - reach) / pxMm) - MARGIN;
  const y0 = Math.floor((minY / 10 - reach) / pxMm) - MARGIN;
  const w = Math.ceil(wMm / pxMm) + 2 * MARGIN + 2;
  const h = Math.ceil(hMm / pxMm) + 2 * MARGIN + 2;
  const seed = new Uint8Array(w * h);
  const put = (xMm: number, yMm: number) => {
    const x = Math.floor(xMm / pxMm) - x0;
    const y = Math.floor(yMm / pxMm) - y0;
    if (x >= 0 && y >= 0 && x < w && y < h) seed[y * w + x] = 1;
  };
  for (const i of segs) {
    const ax = p.x[i - 1] / 10;
    const ay = p.y[i - 1] / 10;
    const bx = p.x[i] / 10;
    const by = p.y[i] / 10;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (pxMm / 2)));
    for (let k = 0; k <= n; k++) put(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
  }
  // Pixel centers sit half a pixel off the seeds' corners: measure from the centers.
  const r = reach / pxMm;
  const near = distanceToSeeds(seed, w, h);
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < outside.length; i++) outside[i] = near[i] <= r ? 0 : 1;
  const far = distanceToSeeds(outside, w, h);
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = (close ? far[i] > r : near[i] <= r) ? 1 : 0;
  if (open > 0) {
    const o = open / pxMm;
    const toOut = distanceToSeeds(Uint8Array.from(mask, (m) => 1 - m), w, h);
    const core = Uint8Array.from(toOut, (d) => (d > o ? 1 : 0));
    const toCore = distanceToSeeds(core, w, h);
    mask = Uint8Array.from(toCore, (d) => (d <= o ? 1 : 0));
  }
  let area = 0;
  for (const m of mask) area += m;
  if (!area) return null;
  const sdf = signedField(mask, w, h, pxMm);
  return { label: 0, x0, y0, w, h, pxMm, mask, inside: distanceInside(mask, w, h), sdf, sdfBase: sdf, areaMm2: area * pxMm * pxMm };
}

// Measuring what an object has now ------------------------------------------------------------

/**
 * Fill settings as the stitches have them: the rows are the long stitches of the fill parts; their
 * main direction is the angle (doubled-angle mean), the distance between neighbouring parallel
 * rows the spacing, their long stitches the stitch length. Underlay is running stitch in the fill
 * area before the first row.
 */
export function measureFill(p: Pattern, a: Analysis): FillSettings {
  return readFill(p, a).s;
}

function readFill(p: Pattern, a: Analysis): { s: FillSettings; firstRow: number } {
  const segs: { i: number; l: number; a: number }[] = [];
  for (const pt of a.parts) {
    if (pt.kind !== 'fill') continue;
    for (let i = pt.s + 1; i <= pt.e; i++) {
      if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
      const l = seg(p, i);
      if (l >= 0.8) segs.push({ i, l, a: Math.atan2(p.y[i] - p.y[i - 1], p.x[i] - p.x[i - 1]) });
    }
  }
  let sx = 0;
  let sy = 0;
  for (const g of segs) {
    sx += g.l * g.l * Math.cos(2 * g.a);
    sy += g.l * g.l * Math.sin(2 * g.a);
  }
  const main = Math.atan2(sy, sx) / 2;
  const rows = segs.filter((g) => Math.abs(Math.cos(g.a - main)) > Math.cos((12 * Math.PI) / 180));
  // Distance to the nearest parallel row beside each row (in the frame of the main direction).
  const ex = Math.cos(main);
  const ey = Math.sin(main);
  const fr = rows
    .map((g) => {
      const ax = p.x[g.i - 1] / 10;
      const ay = p.y[g.i - 1] / 10;
      const bx = p.x[g.i] / 10;
      const by = p.y[g.i] / 10;
      const u0 = ax * ex + ay * ey;
      const u1 = bx * ex + by * ey;
      return { lo: Math.min(u0, u1), hi: Math.max(u0, u1), v: ((ay + by) / 2) * ex - ((ax + bx) / 2) * ey };
    })
    .sort((x, y) => x.v - y.v);
  const gaps: number[] = [];
  for (let k = 0; k < fr.length; k++) {
    for (let j = k + 1; j < fr.length && fr[j].v - fr[k].v < 1.6; j++) {
      const d = fr[j].v - fr[k].v;
      if (d < 0.12) continue;
      if (fr[j].lo < fr[k].hi - 0.3 && fr[k].lo < fr[j].hi - 0.3) {
        gaps.push(d);
        break;
      }
    }
  }
  const spacing = Math.min(1.5, Math.max(0.15, percentile(gaps, 0.5) || 0.4));
  let firstRow = Infinity;
  for (const g of rows) firstRow = Math.min(firstRow, g.i);
  let rowThread = 0;
  for (const g of rows) rowThread += g.l;
  let before = 0;
  for (const pt of a.parts) {
    if (pt.kind !== 'fill') continue;
    for (let i = pt.s + 1; i <= Math.min(pt.e, firstRow - 1); i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) before += seg(p, i);
  }
  const angle = Math.round(((((main * 180) / Math.PI) % 180) + 180) % 180);
  // Rows that do not keep one direction are curved or turn from patch to patch (fills that follow an image, several angles).
  let all = 0;
  for (const g of segs) all += g.l;
  const curved = segs.length > 10 && rowThread < all * 0.75;
  const sp = Math.round(spacing * 100) / 100;
  const ang = angle === 180 ? 0 : angle;
  // Rows that get further apart (or closer) evenly across most of the fill: a gradient.
  const grad = gradientIn(p, a, all, ang);
  const s: FillSettings = {
    pattern: grad ? 'gradient' : curved ? 'follow' : 'tatami',
    spacing: grad?.spacing ?? sp,
    spacingEnd: grad?.spacingEnd ?? Math.min(1.2, Math.round(sp * 2.5 * 100) / 100),
    offset: 0.25,
    angle: ang,
    stitch: Math.round((percentile(rows.map((g) => g.l), 0.8) || 4) * 10) / 10,
    underlay: before > rowThread * 0.06,
    edge: 0,
    tolerance: TOLERANCE,
  };
  return { s, firstRow };
}

/**
 * The gradient of the fill parts of `a` (see gradientOf), when the patch of rows it is read from
 * holds at least half of their thread (`all`, mm); rows at `angle`.
 */
function gradientIn(p: Pattern, a: Analysis, all: number, angle: number): { spacing: number; spacingEnd: number } | null {
  const patches: RowPatch[] = [];
  for (const pt of a.parts) if (pt.kind === 'fill' && !pt.border) patches.push(...rowPatches(p, pt.s, pt.e));
  const grad = gradientOf(patches, angle);
  if (!grad) return null;
  const largest = patches.reduce((best, x) => (x.rows.length > best.rows.length ? x : best));
  const thread = largest.rows.reduce((n, r) => n + r.len, 0);
  return thread >= all * 0.5 ? grad : null;
}

/**
 * The underlay of an object as record ranges (a stitch's record is where its segment ends): of a
 * fill sewn here as it was made, of another fill the stitches in its area before the first row,
 * of a satin the stitches under the column that are not satin.
 */
export function underlayRanges(p: Pattern, o: SewObject, kinds: Uint8Array): [number, number][] {
  const known = remembered(p, o);
  if (known?.under) {
    const from = known.underFrom ?? 0;
    let n = 0;
    let a = o.first;
    for (let i = o.first; i <= o.last; i++) {
      if (p.cmd[i] !== STITCH) continue;
      n++;
      if (n === from + 1) a = i;
      if (n === from + known.under) return [[a, i]];
    }
    return [[a, o.last]];
  }
  // A fill sewn here without underlay has none (its rows are not read as one).
  if (known?.fill && !known.fill.underlay) return [];
  const an = analyze(p, o, kinds, known);
  const out: [number, number][] = [];
  if (an.fill && (known?.fill?.underlay ?? true)) {
    const { s, firstRow } = readFill(p, an);
    if (s.underlay && Number.isFinite(firstRow)) {
      // Inset from the edge, its first stitches may be read as running stitch: all up to the first row.
      for (const pt of an.parts) if (pt.kind !== 'satin' && pt.s < firstRow - 1) out.push([pt.s, Math.min(pt.e, firstRow - 1)]);
    }
  }
  // Satin parts of a fill sewn here are its curved rows or its border, not columns with underlay.
  for (const pt of known?.fill ? [] : an.parts) {
    if (pt.kind !== 'satin') continue;
    let a = -1;
    for (let i = pt.s; i <= pt.e + 1; i++) {
      const under = i <= pt.e && p.cmd[i] === STITCH && kinds[i] !== SATIN;
      if (under && a < 0) a = i;
      if (!under && a >= 0) {
        if (i - a >= 3) out.push([a, i - 1]);
        a = -1;
      }
    }
  }
  return out;
}

/** Satin columns of a part: runs of satin stitches alternating between two rails. */
function satinColumns(p: Pattern, pt: Part, kinds: Uint8Array): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = [];
  for (let i = pt.s + 1; i <= pt.e; i++) {
    if (kinds[i] !== SATIN || p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    let j = i;
    while (j + 1 <= pt.e && kinds[j + 1] === SATIN && p.cmd[j + 1] === STITCH) j++;
    if (j - i >= 3) out.push({ s: i - 1, e: j });
    i = j;
  }
  return out;
}

export function measureSatin(p: Pattern, pt: Part, kinds: Uint8Array): SatinSettings {
  const steps: number[] = [];
  let satin = 0;
  let other = 0;
  let e = 0;
  let all = 0;
  for (const c of satinColumns(p, pt, kinds)) {
    const isEStitch = isE(p, c.s, c.e);
    all++;
    if (isEStitch) {
      e++;
      for (let i = c.s + 3; i <= c.e; i += 3) steps.push(Math.hypot(p.x[i] - p.x[i - 3], p.y[i] - p.y[i - 3]) / 10);
    } else for (let i = c.s + 2; i <= c.e; i++) steps.push(Math.hypot(p.x[i] - p.x[i - 2], p.y[i] - p.y[i - 2]) / 10);
  }
  for (let i = pt.s + 1; i <= pt.e; i++) {
    if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    if (kinds[i] === SATIN) satin += seg(p, i);
    else if (kinds[i] !== TIE_STITCH) other += seg(p, i);
  }
  const type: SatinType = all && e * 2 > all ? 'e' : 'satin';
  const spacing = Math.round(Math.min(type === 'e' ? 6 : 1.5, Math.max(0.15, percentile(steps, 0.5) || 0.4)) * 100) / 100;
  return { spacing, edge: 0, short: true, underlay: other > satin * 0.03, tolerance: TOLERANCE, type, under: 'auto', split: measuredSplit(p, pt, kinds), stagger: true, edgeShare: 0 };
}

/**
 * The split length the stitches show: the default where none is longer (they were split there, or
 * the column is narrower), else just over the longest, so sewing them anew splits none that the
 * file did not (an unsplit 9 mm column stays unsplit).
 */
function measuredSplit(p: Pattern, pt: Part, kinds: Uint8Array): number {
  let longest = 0;
  for (let i = pt.s + 1; i <= pt.e; i++) if (kinds[i] === SATIN && p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) longest = Math.max(longest, seg(p, i));
  if (longest <= SATIN_SPLIT_MM + 0.15) return SATIN_SPLIT_MM;
  return Math.min(SATIN_SPLIT_MAX, Math.ceil(longest * 2) / 2);
}

export function measureRun(p: Pattern, pt: Part): RunSettings {
  const lens: number[] = [];
  let back = 0;
  for (let i = pt.s + 1; i <= pt.e; i++) {
    if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    lens.push(seg(p, i));
    if (i >= 2 && p.x[i] === p.x[i - 2] && p.y[i] === p.y[i - 2]) back++;
  }
  return { stitch: Math.round((percentile(lens, 0.6) || 2.5) * 10) / 10, triple: back > lens.length * 0.4, tolerance: TOLERANCE };
}

// New stitches -----------------------------------------------------------------------------------

const pt10 = (p: Pattern, i: number): Pt => [p.x[i] / 10, p.y[i] / 10];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Whether the stitches from record s to e are an E stitch: across and back on the same hole, then a step on. */
function isE(p: Pattern, s: number, e: number): boolean {
  let spokes = 0;
  let tries = 0;
  for (let i = s; i + 2 <= e; i += 3) {
    tries++;
    if (p.x[i + 2] === p.x[i] && p.y[i + 2] === p.y[i]) spokes++;
  }
  return tries >= 2 && spokes >= tries * 0.8;
}

/** Rails of a satin column from its penetrations, filled in between so the spacing can get finer. */
function railsOf(p: Pattern, c: { s: number; e: number }): Rails | null {
  const left: Pt[] = [];
  const right: Pt[] = [];
  if (isE(p, c.s, c.e)) {
    // An E stitch: each stitch across and back is a pair.
    for (let i = c.s; i + 1 <= c.e; i += 3) {
      left.push(pt10(p, i));
      right.push(pt10(p, i + 1));
    }
    return left.length < 2 ? null : { left, right };
  }
  for (let i = c.s; i + 1 <= c.e; i += 2) {
    left.push(pt10(p, i));
    right.push(pt10(p, i + 1));
  }
  return left.length < 2 ? null : { left: undent(left, right), right: undent(right, left) };
}

/**
 * A rail read from penetrations without the dents short stitches leave on the inside of a curve
 * (a penetration moved 15 % of the width towards the other rail, every second one or so): a point
 * that lies nearer the other rail than the line between its close neighbours goes back onto it.
 */
function undent(rail: Pt[], other: Pt[]): Pt[] {
  const out = rail.slice();
  for (let i = 1; i + 1 < rail.length; i++) {
    const a = rail[i - 1];
    const b = rail[i + 1];
    if (dist(a, b) > 0.8) continue;
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const w = dist(m, other[i]);
    if (w - dist(rail[i], other[i]) > Math.max(0.1, w * 0.08)) out[i] = m;
  }
  return out;
}

/** A satin column between two rails, filled in between so the spacing can get finer. */
export function columnOf({ left, right, rungs }: Rails): Column {
  if (rungs) return columnFromRungs(left, right, rungs);
  const L: Pt[] = [];
  const R: Pt[] = [];
  const C: Pt[] = [];
  const widths: number[] = [];
  const SUB = 8;
  for (let k = 0; k < left.length; k++) {
    const steps = k + 1 < left.length ? SUB : 1;
    for (let j = 0; j < steps; j++) {
      const t = j / SUB;
      const a = k + 1 < left.length ? lerp(left[k], left[k + 1], t) : left[k];
      const b = k + 1 < right.length ? lerp(right[k], right[k + 1], t) : right[Math.min(k, right.length - 1)];
      L.push(a);
      R.push(b);
      C.push(lerp(a, b, 0.5));
      widths.push(dist(a, b));
    }
  }
  widths.sort((a, b) => a - b);
  return { center: C, left: L, right: R, width: widths[widths.length >> 1] };
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Highest satin density allowed when a fill is turned into satin, in times the nominal. */
const CONVERT_PEAK = 3;

/** The area between the rails of satin columns (each column a polygon, together their union). */
export function railsArea(rails: Rails[]): Region | null {
  const node = (q: Pt) => ({ p: q, a: q, b: q, smooth: false });
  const parts = rails.flatMap((r) => {
    const ring = [...r.left, ...r.right.slice().reverse()];
    const g = ring.length >= 3 ? rasterize({ paths: [{ nodes: ring.map(node), closed: true }] }, 0.1) : null;
    return g ? [g] : [];
  });
  return unionRegion(parts);
}

/** The area the stitches of `parts` cover: drawn thick enough that satin stitches close into it. */
function coveredBy(p: Pattern, parts: Part[]): Region | null {
  const segs: number[] = [];
  for (const pt of parts) for (let i = pt.s + 1; i <= pt.e; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) segs.push(i);
  return segs.length > 4 ? traceRegion(p, segs, REACH) : null;
}

/**
 * The object as one part of `kind`, to be sewn anew as a whole: everything else in it (underlay,
 * travel, a few stitches read as another kind) has to lie on its area, or null.
 */
function wholeObject(p: Pattern, o: SewObject, an: Analysis, kind: ObjectKind): Analysis | null {
  const own = an.parts.filter((pt) => pt.kind === kind);
  if (kind === 'run' || !own.length) return null;
  const area = kind === 'fill' ? an.fill : coveredBy(p, own);
  if (!area) return null;
  for (const pt of an.parts) {
    if (pt.kind === kind) continue;
    for (let i = pt.s; i <= pt.e; i++) if (p.cmd[i] === STITCH && sample(area, area.sdfBase, p.x[i] / 10, p.y[i] / 10) > 0.6) return null;
  }
  return { parts: [{ kind, s: o.first, e: o.last }], fill: kind === 'fill' ? area : null };
}

/**
 * New stitches of kind `s.kind` for the parts of kind `src` of an object, on `area`; satin along
 * the `guide` rails when given (drawn with rungs across the area), else along the area's middle.
 */
function convert(p: Pattern, o: SewObject, parts: Part[], src: ObjectKind, area: Region | null, s: Settings, guide?: Rails[]): Pt[][] | null {
  const first = parts.find((pt) => pt.kind === src);
  if (s.kind === 'satin' && guide) {
    const runs = satinRuns(guide, s.s);
    return runs.length ? runs : null;
  }
  if (!area || !first) return null;
  const start = pt10(p, first.s);
  if (s.kind === 'satin') {
    // Asked for by hand: corners a little denser than the Image mode allows are fine.
    return satinForArea(area, start, { spacing: s.s.spacing, pull: s.s.edge, splitMm: SATIN_MAX }, s.s.underlay, s.s.tolerance, SATIN_MAX, CONVERT_PEAK);
  }
  if (s.kind !== 'fill') return null;
  const a: Analysis = { parts: parts.map((pt) => (pt.kind === src ? { ...pt, kind: 'fill' } : pt)), fill: area };
  return newFill(p, o, a, s.s)?.runs ?? null;
}

/** Stitches of a fill: its runs, the first `under` points of them its underlay. */
interface NewFill {
  runs: Pt[][];
  under: number;
  /** Points of `runs` before the border (all of them without one). */
  border: number;
}

function newFill(p: Pattern, o: SewObject, a: Analysis, s: FillSettings, reverse = false, covers?: Cover[], known?: Remembered): NewFill | null {
  if (s.pattern === 'none') return emptyFill(p, o, a, s, reverse, known);
  const first = a.parts.find((pt) => pt.kind === 'fill' && !pt.border);
  const last = a.parts.filter((pt) => pt.kind === 'fill' && !pt.border).pop();
  if (!a.fill || !first || !last) return null;
  // Travel may also follow the object's old thread (its travel between patches lies under other
  // objects), so patches the old stitches connected stay connected without a trim.
  const segs: number[] = [];
  for (let i = o.first + 1; i <= o.last; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) segs.push(i);
  const travel = traceRegion(p, segs, TRAVEL_REACH, 0, false) ?? undefined;
  // Grown or shrunk for the stitches only: the shape kept for the next edit stays as it is.
  const r = expandRegion(a.fill, s.expand ?? 0);
  if (!r) return null;
  // Grown, the travel may also use the new margin, so it stays one piece; shrunk, it stays inside
  // the smaller area (the old thread runs where nothing is sewn now).
  const ex = s.expand ?? 0;
  const way = ex > 0 && travel ? (unionRegion([travel, r]) ?? travel) : ex < 0 ? r : travel;
  const fp: FillParams = { spacing: s.spacing, stitch: s.stitch, angle: s.angle, pull: s.edge, underlay: s.underlay, underCross: s.underCross, underInset: s.underInset, underInsetShare: s.underInsetShare, underSpacing: s.underSpacing, travel: way, tolerance: s.tolerance };
  // Under what lies on top completely, no underlay (it would only add thread under it).
  if (s.underlay && s.underCover && covers?.length) {
    const left = cutAway(r, covers.map((c) => ({ region: c.region, overlap: UNDER_COVER_MARGIN })));
    if (left !== r) fp.underArea = left ?? undefined;
    if (!left) fp.underlay = false;
  }
  // Reversed, the new stitches start where the old ones ended.
  const start = reverse ? pt10(p, last.e) : pt10(p, first.s);
  // Straight rows end near where the next object starts, when that shortens the way (if nothing
  // else of the object comes after the fill; not when it is sewn the other way round on purpose).
  let next = o.last + 1;
  while (next < p.cmd.length && p.cmd[next] !== STITCH && p.cmd[next] !== END) next++;
  if (!reverse && a.parts.filter((pt) => !pt.border).pop() === last && next < p.cmd.length && p.cmd[next] === STITCH) fp.end = pt10(p, next);
  let res;
  if (s.pattern === 'gradient') {
    res = fillRegion(r, { ...fp, spacingEnd: s.spacingEnd, ...(s.deco?.fade ? { fade: s.deco.fade } : {}) }, start);
  } else if (s.pattern === 'contour') {
    res = contourFill(r, fp, start);
  } else if (s.pattern === 'spiral') res = spiralFill(r, fp, start);
  else if (s.pattern === 'follow') {
    if (s.gradient) fp.spacingEnd = s.spacingEnd;
    const lines: [Pt, Pt][] = [];
    for (const pt of a.parts) {
      if (pt.kind !== 'fill' || pt.border) continue;
      for (let i = pt.s + 1; i <= pt.e; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH && seg(p, i) >= 0.8) lines.push([pt10(p, i - 1), pt10(p, i)]);
    }
    const f = stitchField(r, lines);
    res = fieldFill(r, f.g, f, fp, start, false, CONTOUR_PEAK);
  } else if (s.pattern === 'guided') {
    if (!s.guides?.length) return null;
    if (s.gradient) fp.spacingEnd = s.spacingEnd;
    const f = guideField(r, s.guides);
    res = fieldFill(r, f.g, f, fp, start, false, CONTOUR_PEAK);
  } else if ((DECO_PATTERNS as FillPattern[]).includes(s.pattern)) {
    res = decoFill(r, s, fp, start);
  } else if (isOpenPattern(s.pattern)) {
    res = openFill(r, s, start);
  } else {
    const d = s.deco;
    res = fillRegion(r, { ...fp, offset: s.offset, ...(s.pattern === 'tatami' && d?.emboss ? { emboss: { motif: d.emboss, size: d.embossSize ?? DECO_DEFAULTS.embossSize, strong: !!d.embossStrong } } : {}) }, start);
  }
  if (!res) return null;
  // Underlay points in runs too short to sew are not sewn either.
  let under = 0;
  let seen = 0;
  for (const run of res.runs) {
    const take = Math.max(0, Math.min(run.length, (res.under ?? 0) - seen));
    seen += run.length;
    if (run.length > 1) under += take;
  }
  const runs = res.runs.filter((run) => run.length > 1);
  // The border is an object of its own, sewn after the fill (see syncBorders).
  const border = runs.reduce((n, run) => n + run.length, 0);
  return { runs, under, border };
}

/**
 * An empty fill: its border only, in its thread, as all of the object (there is no fill to trim it
 * off). Where shapes on top left out its area (knockout), the edges they cut get none.
 */
function emptyFill(p: Pattern, o: SewObject, a: Analysis, s: FillSettings, reverse: boolean, known?: Remembered): NewFill | null {
  if (!a.fill || !s.border) return null;
  const from = pt10(p, reverse ? o.last : o.first);
  const runs = borderStitches(a.fill, s.border, from, known ? wholeOf(a.fill, known) : null).filter((run) => run.length > 1);
  return runs.length ? { runs, under: 0, border: runs.reduce((n, run) => n + run.length, 0) } : null;
}

/** A dense fill with curved rows: wave rows, or rows on one of the decorative fields. */
function decoFill(r: Region, s: FillSettings, fp: FillParams, start: Pt) {
  const d = { ...DECO_DEFAULTS, ...s.deco };
  const angle = Number.isFinite(s.angle) ? s.angle : 0;
  if (s.pattern === 'waves') return waveFill(r, fp, angle, d.height, d.length, start);
  const focus = atShare(regionBox(r), s.deco?.focus ?? (s.pattern === 'circles' ? CIRCLES_FOCUS : DECO_DEFAULTS.focus));
  const f =
    s.pattern === 'grain'
      ? grainField(r, angle, d.strength, d.seed)
      : s.pattern === 'rays'
        ? rayField(r, focus)
        : s.pattern === 'circles'
          ? circleField(r, focus)
          : swirlField(r, d.seed, s.deco?.centers?.map((c) => atShare(regionBox(r), c)));
  return fieldFill(r, f.g, f, fp, start, true, s.pattern === 'grain' ? DECO_PEAK : DECO_PEAK_POINT);
}

/** One of the open patterns: no underlay, no pull, one line. */
function openFill(r: Region, s: FillSettings, start: Pt) {
  const pat = s.pattern as OpenPattern;
  const d = { ...DECO_DEFAULTS, ...s.deco };
  const [lo, hi] = OPEN_SIZE_RANGE[pat];
  const p: OpenParams = { size: Math.min(hi, Math.max(lo, d.size ?? OPEN_SIZE[pat])), stitch: Math.min(s.stitch, 3), seed: d.seed, triple: d.triple };
  if (pat === 'meander') return meanderFill(r, p, start);
  if (pat === 'maze') return mazeFill(r, p, start);
  if (pat === 'echo') return echoFill(r, p, start);
  if (pat === 'grid') return gridFill(r, p, d.grid, start);
  return crossFill(r, p, d.cross, start);
}

/** Satin of a border: about the density of a satin column, with a walk along the middle under it when wide enough. */
/**
 * New satin for a part, along `known` rails (kept from an earlier edit) or the rails its stitches
 * have now. Returns the stitches and the rails used.
 */
function newSatin(p: Pattern, pt: Part, s: SatinSettings, kinds: Uint8Array, known?: Rails[], reverse = false, shape?: Remembered): { runs: Pt[][]; rails: Rails[] } | null {
  let rails = known ?? readRails(p, pt, kinds, shape);
  // Reversed: the columns from the last to the first, each from its other end (sides swap with it).
  if (reverse) rails = rails.slice().reverse().map(reversedRails);
  const runs = satinRuns(rails, reverse ? swappedSides(s) : s);
  return runs.length ? { runs, rails } : null;
}

/** Rails walked from the other end: the sides swap, the rungs come along. */
export function reversedRails(r: Rails): Rails {
  const out: Rails = { left: r.right.slice().reverse(), right: r.left.slice().reverse() };
  const la = cumulative(r.left).pop()!;
  const lb = cumulative(r.right).pop()!;
  if (r.rungs) out.rungs = reversedRungs(r.rungs, la, lb);
  if (r.cuts) out.cuts = reversedRungs(r.cuts, la, lb);
  if (r.spans) out.spans = r.spans.map(([a, b]) => [a, b] as [Pt, Pt]);
  if (r.chain !== undefined) out.chain = r.chain;
  if (r.split) out.split = r.split;
  if (r.mirror) out.mirror = true;
  // Walked the other way: the last step first, each section numbered from the other end; a trim
  // stays between the same two steps.
  if (r.plan) {
    const n = r.plan.length;
    out.plan = r.plan
      .slice()
      .reverse()
      .map((x, j) => ({ sec: n - 1 - x.sec, flip: x.flip, trim: j > 0 && r.plan![n - j].trim, ...(x.mirror ? { mirror: true } : {}) }));
  }
  if (r.spacings) {
    // Kept at their rung: measured along the other rail from its other end.
    const at = (s: number) => {
      const g = r.rungs?.find(([a]) => Math.abs(a - s) < 0.05);
      return g ? lb - g[1] : lb * (1 - s / Math.max(la, 1e-6));
    };
    out.spacings = r.spacings.map(([s, v]) => [at(s), v] as [number, number]).reverse();
  }
  return out;
}

/** The part of a rail from distance s0 to s1 along it. */
function subRail(rail: Pt[], cum: number[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [pointAt(rail, cum, s0)];
  for (let i = 0; i < rail.length; i++) if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push(rail[i]);
  out.push(pointAt(rail, cum, s1));
  return out;
}

/**
 * The sections of a column cut across by its cut lines (see Rails.cuts), each with the rungs and
 * spacings that lie in it; the column itself when it has none.
 */
export function sectionsOf(r: Rails): Rails[] {
  if (r.spans?.length) return withSpans(r);
  if (!r.cuts?.length) return [r];
  const cl = cumulative(r.left);
  const cr = cumulative(r.right);
  const la = cl[cl.length - 1];
  const lb = cr[cr.length - 1];
  const cuts = tidyRungs(r.cuts, la, lb);
  if (!cuts.length) return [{ ...r, cuts: undefined }];
  const out: Rails[] = [];
  if (!r.rungs) {
    // Paired by index (the stitches' own direction): cut where the left rail is nearest.
    const at = cuts.map(([a]) => {
      let k = 0;
      for (let i = 1; i < cl.length; i++) if (Math.abs(cl[i] - a) < Math.abs(cl[k] - a)) k = i;
      return k;
    });
    const ks = [0, ...at.filter((k, i) => k > 0 && k < r.left.length - 1 && (i === 0 || k > at[i - 1])), r.left.length - 1];
    for (let j = 0; j + 1 < ks.length; j++) {
      const s0 = cl[ks[j]];
      const s1 = cl[ks[j + 1]];
      const sp = r.spacings?.filter(([s]) => s >= s0 && s <= s1).map(([s, v]) => [s - s0, v] as [number, number]);
      out.push({ left: r.left.slice(ks[j], ks[j + 1] + 1), right: r.right.slice(ks[j], ks[j + 1] + 1), ...(sp?.length ? { spacings: sp } : {}) });
    }
    return out;
  }
  const bounds: Rung[] = [[0, 0], ...cuts, [la, lb]];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [a0, b0] = bounds[k];
    const [a1, b1] = bounds[k + 1];
    const rungs = r.rungs.filter(([a, b]) => a > a0 && a < a1 && b > b0 && b < b1).map(([a, b]) => [a - a0, b - b0] as Rung);
    const sp = r.spacings?.filter(([s]) => s >= a0 && s <= a1).map(([s, v]) => [s - a0, v] as [number, number]);
    out.push({ left: subRail(r.left, cl, a0, a1), right: subRail(r.right, cr, b0, b1), rungs, ...(sp?.length ? { spacings: sp } : {}) });
  }
  return out;
}

/** A section of a column as a closed outline: along the left rail, across its end, back along the right rail and across its start. */
export interface SectionLoop {
  ring: Pt[];
  cum: number[];
  /** Its start and its end (cut lines or the column's own ends) as stretches of the outline. */
  start: Arc;
  end: Arc;
  /** Where the section lies on the column's rails: distances along the left and the right rail. */
  from: Rung;
  to: Rung;
}

/** Each section of the column (between its cut lines) as a closed outline. */
export function sectionLoops(r: Rails): SectionLoop[] {
  const cl = cumulative(r.left);
  const cr = cumulative(r.right);
  const la = cl[cl.length - 1];
  const lb = cr[cr.length - 1];
  const bounds: Rung[] = [[0, 0], ...tidyRungs(r.cuts ?? [], la, lb), [la, lb]];
  const out: SectionLoop[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [a0, b0] = bounds[k];
    const [a1, b1] = bounds[k + 1];
    const L = subRail(r.left, cl, a0, a1);
    const R = subRail(r.right, cr, b0, b1).reverse();
    const ring = [...L, ...R, L[0]];
    const cum = cumulative(ring);
    out.push({ ring, cum, end: [cum[L.length - 1], cum[L.length]], start: [cum[ring.length - 2], cum[ring.length - 1]], from: [a0, b0], to: [a1, b1] });
  }
  return out;
}

/** The section a free rung lies in (its middle inside the section's outline), or -1. */
export function sectionOfRung(loops: SectionLoop[], [a, b]: [Pt, Pt]): number {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return loops.findIndex((l) => inside(l.ring, mid));
}

/**
 * A section with free rungs as a column of its own: the rungs as they meet its outline (the plain
 * ones in it too), the rails chosen so they all go across. Null when they make no strip.
 */
export function spanSection(loop: SectionLoop, plain: Rung[], spans: [Pt, Pt][]): { rails: Rails; ratio: number } | null {
  const { ring, cum } = loop;
  const lb = loop.to[1] - loop.from[1];
  const chords: [number, number][] = plain.map(([a, b]) => [a, loop.end[1] + (lb - b)]);
  for (const [a, b] of spans) chords.push([project(ring, cum, a).s, project(ring, cum, b).s]);
  const strip = stripOfLoop(ring, chords, [loop.start, loop.end]);
  return strip && { rails: { left: strip.left, right: strip.right, rungs: strip.rungs }, ratio: strip.ratio };
}

/** Sections of a column with free rungs: those with any sewn as columns of their own (see Rails.spans). */
function withSpans(r: Rails): Rails[] {
  const base: Rails = { ...r, rungs: r.rungs ?? [] };
  delete base.spans;
  const plain = sectionsOf(base);
  const loops = sectionLoops(base);
  if (loops.length !== plain.length) return plain;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const startOf = (x: Rails) => mid(x.left[0], x.right[0]);
  const endOf = (x: Rails) => mid(x.left[x.left.length - 1], x.right[x.right.length - 1]);
  const out: Rails[] = [];
  plain.forEach((sec, k) => {
    const free = r.spans!.filter((f) => sectionOfRung(loops, f) === k);
    const own = free.length ? spanSection(loops[k], sec.rungs ?? [], free) : null;
    if (!own) return void out.push(sec);
    // Walked from the end nearer to where the column comes from.
    const from = out.length ? endOf(out[out.length - 1]) : startOf(base);
    const fwd = own.rails;
    out.push(dist(endOf(fwd), from) < dist(startOf(fwd), from) ? reversedRails(fwd) : fwd);
  });
  return out;
}

/** Spacing grows on narrow columns and shrinks on wide ones ("Abstand nach Breite"), 1 at 4 mm. */
export function widthFactor(w: number): number {
  if (w <= 2) return 1.2;
  if (w <= 4) return 1.2 - ((w - 2) / 2) * 0.2;
  if (w <= 6) return 1 - ((w - 4) / 2) * 0.1;
  return 0.9;
}

/**
 * The spacing at each point of the column (null when even): set at places along it (blended
 * linearly between those and the rungs and ends that keep the column's spacing), and with
 * `byWidth` grown on narrow and shrunk on wide parts.
 */
export function spacingAlong(c: Column, r: Rails, base: number, byWidth: boolean): number[] | undefined {
  if (!r.spacings?.length && !byWidth) return undefined;
  const cum = cumulative(c.left);
  const la = cum[cum.length - 1];
  const ctrl: [number, number][] = [[0, base], [la, base]];
  for (const [a] of r.rungs ?? []) ctrl.push([a, base]);
  for (const [s, v] of r.spacings ?? []) {
    const near = ctrl.findIndex(([x]) => Math.abs(x - s) < 0.05);
    if (near >= 0) ctrl[near] = [s, v];
    else ctrl.push([s, v]);
  }
  ctrl.sort((a, b) => a[0] - b[0]);
  return cum.map((s, i) => {
    let k = 0;
    while (k + 2 < ctrl.length && ctrl[k + 1][0] <= s) k++;
    const [x0, v0] = ctrl[k];
    const [x1, v1] = ctrl[Math.min(k + 1, ctrl.length - 1)];
    const v = x1 > x0 ? v0 + (v1 - v0) * Math.min(1, Math.max(0, (s - x0) / (x1 - x0))) : v0;
    return byWidth ? v * widthFactor(dist(c.left[i], c.right[i])) : v;
  });
}

/** Settings for the columns walked from the other end: what was right is left now. */
export function swappedSides(s: SatinSettings): SatinSettings {
  return s.edgeB === undefined ? s : { ...s, edge: s.edgeB, edgeB: s.edge };
}

/** The satin's parameters for `pairs` and its stitches. */
export function satinParams(s: SatinSettings): SatinParams {
  return { spacing: s.spacing, pull: s.edge, pullB: s.edgeB, pullShare: s.edgeShare ?? 0, splitMm: s.split ?? SATIN_SPLIT, short: s.short && s.type !== 'e', stagger: s.stagger ?? true };
}

/**
 * Satin along each pair of rails: with underlay, the underlay first (out along the column, or out
 * and back for a contour underlay) and the satin over it the other way.
 */
export function satinRuns(rails: Rails[], s: SatinSettings): Pt[][] {
  const runs: Pt[][] = [];
  const chains = new WeakSet<Pt[]>();
  const sp = satinParams(s);
  const { sew, along } = sewing(s);
  for (let k = 0; k < rails.length; k++) {
    const whole = rails[k];
    // Columns in one chain: sewn on one after the other without a trim, each back to its start
    // (also one alone, a trim before and after it, so its satin goes the same way).
    if (whole.chain !== undefined) {
      const chain: Rails[] = [];
      for (; k < rails.length && rails[k].chain === whole.chain; k++) chain.push(rails[k]);
      k--;
      const run = chainRun(chain, s, sew, along);
      if (run.length) {
        chains.add(run);
        runs.push(run);
      }
      continue;
    }
    const parts = sectionsOf(whole);
    if (parts.length > 1 && planFits(whole.plan, parts.length)) {
      runs.push(...plannedRuns(parts, whole.plan, s, sew, along));
      continue;
    }
    if (parts.length > 1) {
      const run = sectionRun(parts, s, sew, along);
      if (run.length) runs.push(run);
      continue;
    }
    const r = parts[0];
    const col = columnOf(r);
    const ps = pairs(col, along(col, r, sp));
    if (ps.length < 2) continue;
    const sewR = sided(whole, sew);
    if (!s.underlay) {
      runs.push(sewR(ps));
      continue;
    }
    const under = underlayOf(col, s.under ?? 'auto', s.tolerance, underInset(s));
    if (!under.atEnd) {
      runs.push([...under.pts, ...sewR(ps)]);
      continue;
    }
    // Underlay out along the column, satin back (its sides swap with the direction).
    const rev = reversedColumn(col);
    runs.push([...under.pts, ...sewR(pairs(rev, along(rev, reversedRails(r), satinParams(swappedSides(s)))))]);
  }
  // Chains are cut apart from what comes before and after them, however near (the dot of an i and its stem).
  runs.forEach((run, k) => k && (chains.has(run) || chains.has(runs[k - 1])) && trimBefore.add(run));
  return runs;
}

/** Runs of satin with a trim before them wherever they start (asked for, not only for a long way). */
export const trimBefore = new WeakSet<Pt[]>();

/** How the satin stitches of settings `s` are made, and their spacing along a column. */
function sewing(s: SatinSettings) {
  const sp = satinParams(s);
  const sew = (ps: [Pt, Pt][]) => (s.type === 'e' ? eStitches(ps, sp) : satinStitches(ps, sp));
  const along = (col: Column, r: Rails, q: SatinParams): SatinParams => {
    const at = spacingAlong(col, r, q.spacing, !!s.byWidth);
    return at ? { ...q, spacingAt: at } : q;
  };
  return { sew, along };
}

/**
 * The columns of a chain (see Rails.chain) in the order, directions and sides (Rails.mirror) that
 * show the least of the way between them: under columns still to be sewn rather than over sewn
 * satin, over satin rather than across the fabric, then the shortest. Starts from the order given
 * and changes it only where that is better: one column turned round, mirrored or moved at a time,
 * as long as that helps.
 */
export function bestChain(cols: Rails[], s: SatinSettings): Rails[] {
  if (cols.length < 2 && !cols.some((c) => sectionsOf(c).length > 1)) return cols;
  const { sew, along } = sewing(s);
  // Each column in its four ways (as given, turned round, mirrored, both): where its run starts and ends.
  const ways = cols.map((c) => {
    const turned = reversedRails(c);
    return [c, turned, { ...c, mirror: !c.mirror }, { ...turned, mirror: !c.mirror }].map((r) => {
      const run = columnRun(r, s, sew, along);
      return { r, a: run[0], b: run[run.length - 1] };
    });
  });
  const outlines = cols.map(outlineOf);
  const columns = cols.map((r) => columnOf(sectionsOf(r)[0]));
  type Step = { c: number; w: number };
  const cache = new Map<string, number>();
  const score = (order: Step[]) => {
    let v = 0;
    for (let k = 1; k < order.length; k++) {
      const [p, q] = [ways[order[k - 1].c][order[k - 1].w], ways[order[k].c][order[k].w]];
      if (!p.b || !q.a) continue;
      const later = order.slice(k).map((x) => x.c);
      const key = `${order[k - 1].c}.${order[k - 1].w}>${order[k].c}.${order[k].w}|${later.slice().sort((x, y) => x - y)}`;
      let c = cache.get(key);
      if (c === undefined) {
        c = wayBetween(p.b, q.a, k, order.map((x) => outlines[x.c]), columns).cost;
        cache.set(key, c);
      }
      v += c;
    }
    return v;
  };
  let cur: Step[] = cols.map((_, c) => ({ c, w: 0 }));
  let best = score(cur);
  for (let round = 0; round < 50; round++) {
    let found: Step[] | null = null;
    cur.forEach((x, k) => {
      for (let w = 0; w < 4; w++) {
        if (w === x.w) continue;
        const next = cur.map((y, j) => (j === k ? { c: y.c, w } : y));
        const v = score(next);
        if (v < best - 1e-6) [found, best] = [next, v];
      }
      for (let j = 0; j < cur.length; j++) {
        if (j === k) continue;
        const next = cur.filter((_, i) => i !== k);
        next.splice(j, 0, x);
        const v = score(next);
        if (v < best - 1e-6) [found, best] = [next, v];
      }
    });
    if (!found) break;
    cur = found;
  }
  // Mirrored or not: only where set.
  return cur.map(({ c, w }) => {
    const r = ways[c][w].r;
    if (r.mirror) return r;
    const { mirror: _m, ...rest } = r;
    return rest;
  });
}

/** Satin of a column or section that starts on its other rail when it is mirrored (see Rails.mirror). */
const sided = (r: Rails, sew: (ps: [Pt, Pt][]) => Pt[]) => (ps: [Pt, Pt][]) => sew(r.mirror ? ps.map(([a, b]) => [b, a] as [Pt, Pt]) : ps);

/** How far a satin's underlay keeps inside its rails, as its settings say. */
const underInset = (s: SatinSettings): UnderInset => ({ mm: s.underInset, share: s.underInsetShare });

/** Longest stitch of the run joining two sections that do not meet (mm). */
const TRAVEL_STEP = 2.5;

const reversedColumn = (col: Column): Column => ({ center: col.center.slice().reverse(), left: col.right.slice().reverse(), right: col.left.slice().reverse(), width: col.width });

/**
 * A column in sections, sewn as one run without trims: each section starts anew. With an underlay
 * that ends at the far end, all underlays go out first and the sections come back one by one
 * (the last first); otherwise each section brings its own underlay and goes out.
 */
/** Whether sections of a column that follow one another do not meet (one sewn as a column of its own). */
function apartOf(parts: Rails[]): boolean {
  return parts.some((r, k) => {
    const n = parts[k + 1];
    return !!n && dist(r.left[r.left.length - 1], n.left[0]) + dist(r.right[r.right.length - 1], n.right[0]) > 1;
  });
}

/** Whether sectionRun sews the satin of these sections back: the last first, each from its end. */
export function sewnBack(parts: Rails[], s: SatinSettings): boolean {
  if (apartOf(parts)) return true;
  return s.underlay && parts.every((r) => underlayOf(columnOf(r), s.under ?? 'auto', s.tolerance, underInset(s)).atEnd);
}

/** The steps a column's sections are sewn in: its plan, or as sectionRun sews them. */
export function sectionPlan(r: Rails, s: SatinSettings): SectionStep[] {
  const secs = sectionsOf(r);
  if (planFits(r.plan, secs.length)) return r.plan.map((x) => ({ ...x }));
  const back = secs.length > 1 && sewnBack(secs, s);
  return secs.map((_, i) => (back ? { sec: secs.length - 1 - i, flip: true, trim: false } : { sec: i, flip: false, trim: false }));
}

/**
 * Sections sewn as `plan` says: their satin in its order and directions, a run for each stretch
 * between trims. Each stretch is handed to sectionRun so that what it sews back comes out in
 * the order of the plan.
 */
function plannedRuns(secs: Rails[], plan: SectionStep[], s: SatinSettings, sew: (ps: [Pt, Pt][]) => Pt[], along: (col: Column, r: Rails, q: SatinParams) => SatinParams): Pt[][] {
  const runs: Pt[][] = [];
  let group: Rails[] = [];
  // A trim asked for before the stretch.
  let cut = false;
  const flush = () => {
    if (!group.length) return;
    const feed = sewnBack(group, s) ? group.slice().reverse().map(reversedRails) : group;
    const run = sectionRun(feed, s, sew, along);
    if (run.length) {
      if (cut) trimBefore.add(run);
      runs.push(run);
    }
    cut = false;
    group = [];
  };
  plan.forEach((x, i) => {
    if (x.trim && i) {
      flush();
      cut = true;
    }
    const sec = x.flip ? reversedRails(secs[x.sec]) : { ...secs[x.sec] };
    if (x.mirror) sec.mirror = true;
    group.push(sec);
  });
  flush();
  return runs;
}

function sectionRun(parts: Rails[], s: SatinSettings, sew: (ps: [Pt, Pt][]) => Pt[], along: (col: Column, r: Rails, q: SatinParams) => SatinParams): Pt[] {
  const sp = satinParams(s);
  const cols = parts.map(columnOf);
  const out: Pt[] = [];
  const push = (pts: Pt[]) => {
    // Sections that do not meet (one sewn as a column of its own) are joined by a run between them.
    const last = out[out.length - 1];
    if (last && pts.length) {
      const d = dist(last, pts[0]);
      const n = Math.ceil(d / TRAVEL_STEP);
      for (let j = 1; j < n; j++) out.push([last[0] + ((pts[0][0] - last[0]) * j) / n, last[1] + ((pts[0][1] - last[1]) * j) / n]);
    }
    out.push(...pts);
  };
  const kind = s.under ?? 'auto';
  // A section sewn as a column of its own may end away from where the next one starts: then all
  // go out first (underlay, or a run along the middle) and the satin comes back over the way.
  const apart = apartOf(parts);
  if (!s.underlay && !apart) {
    parts.forEach((r, k) => push(sided(r, sew)(pairs(cols[k], along(cols[k], r, sp)))));
    return out;
  }
  const unders = cols.map((c) => (s.underlay ? underlayOf(c, kind, s.tolerance, underInset(s)) : { pts: [] as Pt[], atEnd: false }));
  if (apart) {
    cols.forEach((c, k) => push(unders[k].atEnd ? unders[k].pts : [...unders[k].pts, ...runStitch(c.center, TRAVEL_STEP, s.tolerance)]));
  } else if (!unders.every((u) => u.atEnd)) {
    parts.forEach((r, k) => push([...unders[k].pts, ...sided(r, sew)(pairs(cols[k], along(cols[k], r, sp)))]));
    return out;
  } else for (const u of unders) push(u.pts);
  const back = satinParams(swappedSides(s));
  for (let k = parts.length - 1; k >= 0; k--) {
    const rev = reversedColumn(cols[k]);
    push(sided(parts[k], sew)(pairs(rev, along(rev, reversedRails(parts[k]), back))));
  }
  return out;
}

/**
 * Columns in one chain (see Rails.chain), sewn as one run without a trim. Each column ends where it
 * starts (underlay out and satin back, or a run out along its middle and the satin back over it),
 * so a column hanging off another is sewn out and back before the one it hangs from; the way from
 * one column to the next goes through the columns, along the middle of one that is sewn later,
 * not across the fabric.
 */
function chainRun(cols: Rails[], s: SatinSettings, sew: (ps: [Pt, Pt][]) => Pt[], along: (col: Column, r: Rails, q: SatinParams) => SatinParams): Pt[] {
  const columns = cols.map((r) => columnOf(sectionsOf(r)[0]));
  const outlines = cols.map(outlineOf);
  const out: Pt[] = [];
  cols.forEach((r, k) => {
    const pts = columnRun(r, s, sew, along);
    if (!pts.length) return;
    const from = out[out.length - 1];
    // As a running stitch along the way: the middle of a column has a point every few tenths, a
    // stitch to each would pile up needle holes.
    if (from) out.push(...runStitch(wayBetween(from, pts[0], k, outlines, columns).way, TRAVEL_STEP, s.tolerance).slice(1));
    out.push(...pts);
  });
  return out;
}

/** The outline of a column (both rails, closed). */
const outlineOf = (r: Rails): Pt[] => {
  // A point every few tenths is close enough to tell where the way lies.
  const out: Pt[] = [];
  for (const q of [...r.left, ...r.right.slice().reverse(), r.left[0]]) if (!out.length || dist(out[out.length - 1], q) >= 0.3) out.push(q);
  return out;
};

/** A column of a chain on its own: out along it (underlay or a run along its middle) and the satin back to its start. */
function columnRun(r: Rails, s: SatinSettings, sew: (ps: [Pt, Pt][]) => Pt[], along: (col: Column, r: Rails, q: SatinParams) => SatinParams): Pt[] {
  const secs = sectionsOf(r);
  if (secs.length > 1) return sectionRun(secs, s, sew, along);
  const kind = s.under ?? 'auto';
  const col = columnOf(secs[0]);
  const rev = reversedColumn(col);
  const satinBack = () => sided(r, sew)(pairs(rev, along(rev, reversedRails(secs[0]), satinParams(swappedSides(s)))));
  const under = s.underlay ? underlayOf(col, kind, s.tolerance, underInset(s)) : null;
  if (under?.atEnd) return [...under.pts, ...satinBack()];
  const underBack = s.underlay ? underlayOf(rev, kind, s.tolerance, underInset(s)).pts : [];
  return [...runStitch(col.center, TRAVEL_STEP, s.tolerance), ...underBack, ...satinBack()];
}

/**
 * The way from one column of a chain to column k: hidden under the columns still to be sewn (k
 * and after) as far as can be, straight on or along the middle of one of them; else as short in
 * sight as it gets (a trim with a cut line avoids it). Its cost: how much of it shows (three
 * times as much off the columns as over sewn satin), then how long it is.
 */
function wayBetween(from: Pt, to: Pt, k: number, outlines: Pt[][], columns: Column[]): { way: Pt[]; cost: number } {
  const boxes = outlines.map((o) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of o) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    return [x0, y0, x1, y1];
  });
  const isIn = (j: number, q: Pt) => q[0] >= boxes[j][0] && q[0] <= boxes[j][2] && q[1] >= boxes[j][1] && q[1] <= boxes[j][3] && inside(outlines[j], q);
  const shows = (q: Pt) => (outlines.some((_, j) => j >= k && isIn(j, q)) ? 0 : outlines.some((_, j) => isIn(j, q)) ? 1 : 3);
  const cost = (way: Pt[]) => {
    let seen = 0;
    let all = 0;
    for (let i = 1; i < way.length; i++) {
      const d = dist(way[i - 1], way[i]);
      const n = Math.max(1, Math.ceil(d / 0.25));
      for (let j = 0; j < n; j++) seen += (shows(lerp(way[i - 1], way[i], (j + 0.5) / n)) * d) / n;
      all += d;
    }
    return seen * 1000 + all;
  };
  let way: Pt[] = [from, to];
  let best = cost(way);
  // Seen less than a little: straight on.
  if (best >= 0.3 * 1000) {
    for (const c of columns) {
      const cum = cumulative(c.center);
      const a = project(c.center, cum, from).s;
      const b = project(c.center, cum, to).s;
      const mid = subRail(c.center, cum, Math.min(a, b), Math.max(a, b));
      const along = [from, ...(a <= b ? mid : mid.reverse()), to];
      const v = cost(along);
      if (v < best) [way, best] = [along, v];
    }
  }
  return { way, cost: best };
}

function newRun(p: Pattern, pt: Part, s: RunSettings, kinds: Uint8Array): Pt[][] | null {
  // The path without lock stitches and without the way back of a triple stitch.
  const path: Pt[] = [];
  for (let i = pt.s; i <= pt.e; i++) {
    if (p.cmd[i] !== STITCH || (kinds[i] === TIE_STITCH && i > pt.s)) continue;
    const q = pt10(p, i);
    if (path.length >= 2 && dist(q, path[path.length - 2]) < 0.05) {
      path.pop();
      continue;
    }
    if (!path.length || dist(q, path[path.length - 1]) > 0.05) path.push(q);
  }
  if (path.length < 2) return null;
  const pts = runStitch(path, s.stitch, s.tolerance);
  if (!s.triple) return [pts];
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) out.push(pts[i], pts[i - 1], pts[i]);
  return [out];
}

export interface Rec {
  x: number;
  y: number;
  cmd: number;
}

/** Length of a lock stitch (mm); SHORT_LOCK only to tell an object from one with the very same stitches. */
const LOCK = LOCK_MM;
const SHORT_LOCK = 0.5;
let lockMm = LOCK;

/** Lock stitches at the start of a run of points (0.1 mm records), the half-stitch lock. */
export function lockAt(run: Pt[], atEnd: boolean): Rec[] {
  const pts = atEnd ? run.slice().reverse() : run;
  const a = pts[0];
  let b = pts[1] ?? a;
  for (const q of pts) {
    if (dist(q, a) > 0.3) {
      b = q;
      break;
    }
  }
  const d = dist(a, b) || 1;
  const t = Math.min(lockMm, d) / d;
  const m = lerp(a, b, t / 2);
  const f = lerp(a, b, t);
  const r = (q: Pt): Rec => ({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: STITCH });
  return atEnd ? [r(m), r(f), r(m), r(a)] : [r(a), r(m), r(f), r(m), r(a)];
}

export interface RestitchResult {
  pattern: Pattern;
  /** Number of the stitches before each changed object, and up to its end, in the new pattern. */
  starts: number[];
  ends: number[];
  /** Objects that could not be given new stitches (no shape found). */
  failed: number[];
  /** Fill area of each changed object (as `starts`). */
  regions: (Region | null)[];
  /** What to remember about each changed object for the next edit (as `starts`). */
  memory: Remembered[];
}

/** Settings for each object: the same for all, or chosen per object (null leaves it as it is). */
export type SettingsFor = Settings | ((o: SewObject, a: Analysis, known: Remembered | undefined) => Settings | null);

/**
 * New stitches for the parts of kind `settings.kind` in the objects `which`, or, with `from`, the
 * parts of kind `from` turned into `settings.kind` (satin into fill or fill into satin, on the
 * area they cover). Moves inside an object up to 1 mm are stitched, up to `trimMm` jumped, longer
 * ones trimmed with lock stitches. With `reverse`, satin and fill are sewn from the other side:
 * satin columns from their other end, fills starting where they ended. `guides` gives a fill
 * turned into satin the rails to follow (drawn with rungs across it), by object.
 */
/** Settings of running stitch or satin given for a line, as the stitches along it (`known`: as it had them). */
function asLine(given: Settings, known?: PathStitch): PathStitch | null {
  // Its echo stays when the stitch changes.
  if (given.kind === 'run') return { ...runAsLine(given.s, known?.width), ...(known?.echo ? { echo: { ...known.echo } } : {}), ...(known?.shadow ? { shadow: known.shadow } : {}) };
  if (given.kind !== 'satin') return null;
  const s = given.s;
  return { ...(known ?? { width: 2 }), type: 'satin', spacing: s.spacing, pull: s.edge || undefined, under: s.underlay ? (s.under ?? 'center') : 'off', tolerance: s.tolerance ?? known?.tolerance };
}

export function restitch(
  p: Pattern,
  objs: SewObject[],
  which: number[],
  settingsFor: SettingsFor,
  kinds: Uint8Array,
  trimMm: number,
  from?: ObjectKind,
  reverse = false,
  guides?: Map<number, Rails[]>,
  areas?: Map<number, Region>,
  paths?: Map<number, Form>,
): RestitchResult {
  const once = (back: boolean) => restitchOnce(p, objs, which, settingsFor, kinds, trimMm, from, back, guides, areas, paths);
  const r = once(reverse);
  if (!r.starts.length || !sameStitches(p, objs, which, r)) return r;
  // New stitches that are the very stitches of another object (a copy lying exactly on its
  // original): sewn from the other side, else with the locks a little shorter (under the
  // stitches), so each remembers its own (memory is keyed by stitches).
  const fits = (x: RestitchResult) => x.starts.length === r.starts.length && !sameStitches(p, objs, which, x);
  if (!reverse) {
    const back = once(true);
    if (fits(back)) return back;
  }
  lockMm = SHORT_LOCK;
  try {
    const short = once(reverse);
    return fits(short) ? short : r;
  } finally {
    lockMm = LOCK;
  }
}

/** Whether an object sewn anew in `r` has the stitches of another object. */
function sameStitches(p: Pattern, objs: SewObject[], which: number[], r: RestitchResult): boolean {
  const set = new Set(which);
  const keys = new Set(objs.filter((o) => !set.has(o.index)).map((o) => objectKey(p, o)));
  const records: number[] = [];
  for (let i = 0; i < r.pattern.cmd.length; i++) if (r.pattern.cmd[i] === STITCH) records.push(i);
  for (let k = 0; k < r.starts.length; k++) {
    if (r.ends[k] <= r.starts[k]) continue;
    const key = stitchKey(r.pattern, records[r.starts[k]], records[r.ends[k] - 1]);
    if (keys.has(key)) return true;
    keys.add(key);
  }
  return false;
}

function restitchOnce(
  p: Pattern,
  objs: SewObject[],
  which: number[],
  settingsFor: SettingsFor,
  kinds: Uint8Array,
  trimMm: number,
  from: ObjectKind | undefined,
  reverse: boolean,
  guides?: Map<number, Rails[]>,
  areas?: Map<number, Region>,
  paths?: Map<number, Form>,
): RestitchResult {
  const set = new Set(which);
  const out: Rec[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const failed: number[] = [];
  const regions: (Region | null)[] = [];
  const memory: Remembered[] = [];
  let sewn = 0;
  let counted = 0;
  const count = () => {
    for (; counted < out.length; counted++) if (out[counted].cmd === STITCH) sewn++;
  };
  const copy = (a: number, b: number) => {
    for (let i = a; i <= b; i++) out.push({ x: p.x[i], y: p.y[i], cmd: p.cmd[i] });
  };
  let i = 0;
  for (const o of objs) {
    if (!set.has(o.index)) continue;
    const known = remembered(p, o);
    // Loosed from its shape: its stitches stay as they are.
    if (known?.free) {
      failed.push(o.index);
      continue;
    }
    let an = analyze(p, o, kinds, known);
    // A new area (its shape changed): the old stitches are told apart by the old one, the fill is made in the new one.
    const newArea = areas?.get(o.index);
    if (newArea && an.fill) an = { ...an, fill: newArea };
    const given = typeof settingsFor === 'function' ? settingsFor(o, an, known) : settingsFor;
    if (!given) continue;
    // A fill given a new area whose stitches no longer read as a fill (a thin sliver of few rows
    // reads as running stitch): all of it is the fill it remembers being.
    if (newArea && !an.fill && given.kind === 'fill' && known?.fill && !known.asLine) an = { parts: [{ kind: 'fill', s: o.first, e: o.last }], fill: newArea };
    // A fill along a line: its area is always made from the line, never kept or traced.
    const byLine = !newArea && known?.asLine && given.kind === 'fill' ? lineFillArea(known.asLine, given.s) : null;
    if (byLine && an.fill) an = { ...an, fill: byLine };
    // An empty fill is its border only: all of the object is the fill, on the area it keeps.
    const empty = given.kind === 'fill' && given.s.pattern === 'none' && (from ?? 'fill') === 'fill';
    if (empty) {
      const area = an.fill ?? known?.region ?? null;
      if (!area) {
        failed.push(o.index);
        continue;
      }
      an = { parts: [{ kind: 'fill', s: o.first, e: o.last }], fill: area };
    }
    if (reverse && !empty) {
      // Turned around as a whole: its underlay and travel are made anew with it.
      const whole = wholeObject(p, o, an, given.kind);
      if (!whole) {
        failed.push(o.index);
        continue;
      }
      an = whole;
    }
    // A satin made here, sewn anew as satin: all of it along the columns it keeps, also where its
    // stitches no longer read as satin parts like the kept ones (an E stitch reads as running
    // stitch along its rails).
    const keptSatin =
      !reverse && given.kind === 'satin' && (from ?? 'satin') === 'satin' && !!known?.satin && !!known.columns?.length && an.parts.filter((pt) => pt.kind === 'satin').length !== known.columns.length;
    if (keptSatin) an = { parts: [{ kind: 'satin', s: o.first, e: o.last }], fill: null };
    const parts = an.parts;
    // Satin columns kept from an earlier edit, if the object still has as many satin parts.
    const satinParts = parts.filter((pt) => pt.kind === 'satin');
    const keptRails = (reverse || keptSatin) && known?.columns?.length ? [known.columns.flat()] : known?.columns?.length === satinParts.length ? known.columns : undefined;
    const rails: Rails[][] = [];
    const src = from ?? given.kind;
    const converting = src !== given.kind;
    // The area of the parts that change: the fill area, or for a change of kind the area kept
    // from before or the one the parts cover.
    let area = an.fill;
    // A satin made a fill: its columns, kept so it can become the same satin again; its area is
    // where the columns lie (traced from the stitches it would grow by their thickness each time).
    const satinRails =
      converting && src === 'satin' ? (known?.columns?.flat() ?? satinParts.flatMap((pt) => satinColumns(p, pt, kinds).map((c) => railsOf(p, c)).filter((r): r is Rails => !!r))) : undefined;
    // The drawn form is the source of the area when there is one, never traced back from stitches.
    if (converting) area = newArea ?? (known?.form ? rasterize(known.form) : null) ?? known?.shape ?? (src === 'fill' ? an.fill : (railsArea(satinRails ?? []) ?? coveredBy(p, parts.filter((pt) => pt.kind === src))));
    // A fill made from satin gets rows across the area in the direction with the fewest sections.
    const settings: Settings =
      converting && given.kind === 'fill' && area
        ? { kind: 'fill', s: { ...given.s, pattern: given.s.pattern === 'follow' || (given.s.pattern === 'guided' && !given.s.guides?.length) ? 'tatami' : given.s.pattern, angle: Number.isFinite(given.s.angle) ? given.s.angle : chooseAngle(area, given.s.spacing, []) } }
        : given;
    // All fill parts are one area, filled anew where the first of them was sewn; so are the parts
    // changing kind.
    const together = converting || settings.kind === 'fill';
    const guide = converting && settings.kind === 'satin' ? (guides?.get(o.index) ?? known?.asSatin) : undefined;
    const fillS = settings.s as FillSettings;
    const covers = together && !converting && fillS.underlay && fillS.underCover ? coversOver(p, objs, o, an.fill?.pxMm ?? 0.1) : undefined;
    const filled = together && !converting ? newFill(p, o, an, fillS, reverse, covers, known) : null;
    // A drawn line: sewn anew along its curves as a whole.
    const path = paths?.get(o.index) ?? known?.path;
    const lineSt = !converting && path && settings.kind !== 'fill' ? asLine(settings, known?.line) : null;
    const line = lineSt && path ? lineStitches(path, lineSt, reverse) : null;
    const whole = !together ? null : converting ? convert(p, o, parts, src, area, settings, guide) : (filled?.runs ?? null);
    const firstPart = parts.findIndex((pt) => pt.kind === src && !pt.border);
    let lastPart = -1;
    parts.forEach((pt, k) => pt.kind === src && !pt.border && (lastPart = k));
    const fresh: (Pt[][] | null | 'skip')[] = parts.map((pt, k) => {
      // The old border goes: the new fill brings its own.
      if (pt.border && together) return 'skip';
      // Running stitch between the old patches was travel; the new stitches travel their own way.
      if (whole && pt.kind === 'run' && k > firstPart && k < lastPart) return 'skip';
      if (pt.kind !== src) return null;
      if (line) return k === firstPart ? (line.length ? line : null) : 'skip';
      if (together) return !whole ? null : k === firstPart ? whole : 'skip';
      if (settings.kind === 'satin') {
        const sat = newSatin(p, pt, settings.s, kinds, keptRails?.[satinParts.indexOf(pt)], reverse, known);
        if (sat) rails.push(sat.rails);
        return sat?.runs ?? null;
      }
      return newRun(p, pt, settings.s, kinds);
    });
    if (fresh.every((f) => !f)) {
      if (parts.some((pt) => pt.kind === src)) failed.push(o.index);
      continue;
    }
    // What the object is made of afterwards, for the next edit.
    // Copies all the way down: the panel goes on changing its settings (a border's thread, guides)
    // in place, and what the object remembers must not change with them.
    const newFillS = settings.kind === 'fill' ? structuredClone(settings.s) : undefined;
    // An empty fill's border is the object itself, in its thread: no thread or link of its own.
    if (newFillS?.pattern === 'none' && newFillS.border) {
      delete newFillS.border.color;
      delete newFillS.border.link;
    }
    const newSatinS = settings.kind === 'satin' ? structuredClone(reverse ? swappedSides(settings.s) : settings.s) : undefined;
    const after: Remembered = converting
      ? newFillS
        ? { region: area, fill: newFillS, shape: area ?? undefined, ...(known?.form ? { form: known.form } : {}), ...(satinRails?.length ? { asSatin: satinRails } : {}) }
        : { region: null, satin: newSatinS, shape: area ?? undefined, ...(known?.form ? { form: known.form } : {}), ...(guide ? { columns: [guide] } : {}) }
      : {
          region: an.fill,
          fill: newFillS ?? known?.fill,
          satin: newSatinS ?? known?.satin,
          columns: settings.kind === 'satin' ? (rails.length === satinParts.length ? rails : undefined) : known?.columns,
          shape: known?.shape,
          ...(known?.form && !newArea ? { form: known.form, ...(known.knockout ? { knockout: true, cut: known.cut } : {}) } : {}),
          ...(known?.overlapShare !== undefined ? { overlapShare: known.overlapShare } : {}),
          ...(path && lineSt ? { path, line: lineSt } : {}),
          ...(known?.under && !filled ? { under: known.under, ...(known.underFrom ? { underFrom: known.underFrom } : {}) } : {}),
          ...(known?.borderAt && !filled ? { borderAt: known.borderAt } : {}),
          // Its shape changed: the satin it was no longer fits.
          ...(known?.asSatin && !newArea ? { asSatin: known.asSatin } : {}),
          ...(known?.asLine && settings.kind === 'fill' ? { asLine: lineFillOf(known.asLine, settings.s) } : {}),
          ...(known?.outline ? { outline: known.outline, border: known.border } : {}),
          ...(known?.blendOf ? { blendOf: known.blendOf } : {}),
          ...(known?.shadowOf ? { shadowOf: known.shadowOf } : {}),
          ...(known?.echoOf ? { echoOf: known.echoOf } : {}),
        };
    if (known?.lettering) after.lettering = known.lettering;
    // The same object with new stitches: it keeps its id.
    after.id = o.id;
    if (known?.lock) after.lock = true;
    // Up to the object: everything as it was, except the jumps that lead to its first stitch.
    let lead = o.first;
    while (lead - 1 >= i && p.cmd[lead - 1] === JUMP) lead--;
    copy(i, lead - 1);
    const startsWithNew = !!fresh[0];
    let last: Pt | null = null;
    let prevRun: Pt[] | null = null;
    let first = true;
    // Where the object's records start in `out`, and how many points of the new fill are out (for its underlay).
    let objOut = 0;
    let fed = 0;
    const sewnOfObject = () => {
      let n = 0;
      for (let k = objOut; k < out.length; k++) if (out[k].cmd === STITCH) n++;
      return n;
    };
    let underFrom = 0;
    const underlayDone = () => {
      const n = sewnOfObject() - underFrom;
      if (n > 0) after.under = n;
      if (n > 0 && underFrom) after.underFrom = underFrom;
    };
    const borderStarts = () => {
      let n = 0;
      for (let k = objOut; k < out.length; k++) if (out[k].cmd === STITCH) n++;
      after.borderAt = n;
    };
    const emitPoint = (q: Pt) => {
      if (last && dist(last, q) < 0.05) return;
      out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: STITCH });
      last = q;
    };
    const moveTo = (q: Pt, run: Pt[] | null) => {
      if (first) {
        out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: JUMP });
        objOut = out.length;
        count();
        starts.push(sewn);
        regions.push(after.region);
        memory.push(after);
        if (run && startsWithNew) out.push(...lockAt(run, false));
        else emitPoint(q);
        first = false;
        last = q;
        return;
      }
      const d = dist(last!, q);
      if (d <= 1) return emitPoint(q);
      if (run && (d > trimMm || trimBefore.has(run))) {
        out.push(...lockAt(prevRun!, true), { x: out[out.length - 1].x, y: out[out.length - 1].y, cmd: TRIM });
        out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: JUMP });
        out.push(...lockAt(run, false));
        last = q;
        return;
      }
      out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: JUMP });
      emitPoint(q);
    };
    // The parts as sewn now, for the next edit (see Remembered.parts).
    const made: SewnPart[] = [];
    const partEnds = (kind: ObjectKind, border = false) => {
      const end = sewnOfObject();
      const last = made[made.length - 1];
      if (last && last.kind === kind && !last.border && !border) last.end = end;
      else if (end > (last?.end ?? 0)) made.push(border ? { kind, end, border } : { kind, end });
    };
    parts.forEach((pt, k) => {
      const f = fresh[k];
      if (f === 'skip') return;
      if (f) {
        // New stitches are of the kind asked for (a line in its own stitch, a fill along a line a fill).
        const kind = settings.kind;
        const under = f === whole ? (filled?.under ?? 0) : 0;
        const border = f === whole && filled && filled.border < fed + f.reduce((n, r) => n + r.length, 0) ? filled.border : -1;
        for (const run of f) {
          if (fed === border) {
            borderStarts();
            partEnds(kind);
          }
          // The underlay starts with the fill's first point (other parts may come before it).
          if (fed === 0 && under) underFrom = first ? 0 : sewnOfObject();
          moveTo(run[0], run);
          // The underlay ends with a run or goes on into the rows: counted up to its last point.
          if (fed + 1 === under) underlayDone();
          for (let j = 1; j < run.length; j++) {
            emitPoint(run[j]);
            if (fed + j + 1 === under) underlayDone();
          }
          prevRun = run;
          fed += run.length;
        }
        partEnds(kind, border >= 0);
        return;
      }
      // An unchanged part: its own points (the shared first point only when not there yet).
      const run: Pt[] = [];
      for (let j = pt.s; j <= pt.e; j++) if (p.cmd[j] === STITCH) run.push(pt10(p, j));
      moveTo(run[0], run);
      for (let j = pt.s + 1; j <= pt.e; j++) {
        // Jumps and trims inside it stay as they are (an object can be sewn in trimmed pieces).
        if (p.cmd[j] === STITCH || p.cmd[j] === JUMP || p.cmd[j] === TRIM) out.push({ x: p.x[j], y: p.y[j], cmd: p.cmd[j] });
        if (p.cmd[j] === STITCH) last = pt10(p, j);
      }
      prevRun = run;
      partEnds(pt.kind);
    });
    // A new last part ends with a lock, as the old one did.
    if (fresh[fresh.length - 1] && prevRun) out.push(...lockAt(prevRun, true));
    if (made.length) {
      made[made.length - 1].end = sewnOfObject();
      after.parts = made;
    }
    count();
    ends.push(sewn);
    i = o.last + 1;
  }
  copy(i, p.cmd.length - 1);
  const x = Int32Array.from(out, (r) => r.x);
  const y = Int32Array.from(out, (r) => r.y);
  const cmd = Uint8Array.from(out, (r) => r.cmd);
  return { pattern: tidy(withRecords(p, x, y, cmd)), starts, ends, failed, regions, memory };
}

/** What a fill along a line remembers of it: the line with the width and ends the fill sets. */
export interface LineFill {
  path: Form;
  line: PathStitch;
  cap?: LineCap;
}

/** The line of a fill along it, with the width and ends from the fill's settings. */
export function lineFillOf(l: LineFill, s: FillSettings): LineFill {
  return { path: l.path, line: { ...l.line, width: s.lineWidth ?? l.line.width }, cap: s.lineCap ?? l.cap ?? 'flat' };
}

/** The area of a fill along a line: the line in its width, with its ends. */
export function lineFillArea(l: LineFill, s?: FillSettings): Region | null {
  const x = s ? lineFillOf(l, s) : l;
  return rasterizeStroke(x.path, x.line.width, 0.1, x.cap ?? 'flat');
}
