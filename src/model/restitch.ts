import { SATIN_MAX, satinForArea, type KeptShape } from '../digitize/digitize';
import { borderStitches, type PathStitch } from './along';
import { lineRuns } from './line';
import { chooseAngle, fillRegion, type FillParams } from '../digitize/fill';
import { contourFill, fieldFill, guideField, stitchField } from '../digitize/flow';
import { spiralFill } from '../digitize/spiral';
import { coverage } from '../digitize/measure';
import { expandRegion, sample, signedField, type Region } from '../digitize/region';
import { runStitch, TOLERANCE } from '../digitize/run';
import { eStitches, pairs, satinStitches, underlayOf, type Column, type SatinParams, type UnderlayKind } from '../digitize/satin';
import { columnFromRungs, cumulative, reversedRungs, type Rung } from '../digitize/rungs';
import type { Pt } from '../digitize/skeleton';
import { formFrom, storeForm, type Form, type StoredPath } from '../shape/path';
import { rasterize } from '../shape/rasterize';
import { distanceInside, distanceToSeeds } from '../image/edt';
import { tidy, withRecords } from './edit';
import { holdJoins, joinsIn, rememberObjects, restoreJoin, stitchKey, type ObjectKind, type SewObject } from './objects';
import { END, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { SATIN, TIE_STITCH } from './sequence';
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
 * the directions and curves of the rows sewn now (follow), or along lines drawn on it (guided).
 */
export type FillPattern = 'tatami' | 'gradient' | 'contour' | 'spiral' | 'follow' | 'guided';

export interface FillSettings {
  pattern: FillPattern;
  /** Row spacing (mm); for a gradient where it starts. */
  spacing: number;
  /** Gradient: spacing on the far side (mm). */
  spacingEnd: number;
  /** Tatami: shift of the needle points from row to row (fraction of a stitch; 0 at random). */
  offset: number;
  /** Direction of the rows, degrees 0 to 180 (tatami and gradient). */
  angle: number;
  /** Stitch length (mm). */
  stitch: number;
  underlay: boolean;
  /** Rows reach this much further (+) or less far (-) than now at both ends (mm). */
  edge: number;
  /** Largest distance of a curved row's stitches from its line (mm); see TOLERANCE. */
  tolerance: number;
  /** Guided: the lines the rows follow (world mm). */
  guides?: Pt[][];
  /** Underlay in two crossing layers instead of one across the rows. */
  underCross?: boolean;
  /** Underlay stays this far inside the edge (mm); 0.4 when not set. */
  underInset?: number;
  /** The area grown (+) or shrunk (-) on all sides before it is filled (mm); 0 when not set. */
  expand?: number;
  /** A border sewn on the edge after the fill; none when not set. */
  border?: BorderSettings;
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
  /** Stitches longer than this are split (mm); 12 when not set. */
  split?: number;
  /** Split points staggered from stitch to stitch; on when not set. */
  stagger?: boolean;
  /** Wider on each side by this share of the width (0.1 = 10 %), on top of `edge`. */
  edgeShare?: number;
  /** The right side gets this instead of `edge` (mm), when set. */
  edgeB?: number;
}

export type SatinType = 'satin' | 'e';
export const UNDERLAYS: UnderlayKind[] = ['auto', 'center', 'contour', 'zigzag', 'both'];
/** Longest satin stitch before it is split (mm), as the stitch panel starts. */
export const SATIN_SPLIT = 12;

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
}

/**
 * The shape of an object and its settings, kept for the next edit: the fill area and fill
 * settings, the rails of its satin columns (per satin part) and satin settings. The next edit
 * starts from these instead of reading them again from the stitches of the last one, which would
 * let the shape drift a little with every change.
 */
export interface Remembered {
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
  /** A drawn line: sewn along these curves (see line.ts), not traced from its stitches. */
  path?: Form;
  /** The first this many stitches of the object are its underlay (sewn here). */
  under?: number;
  /** The border in the fill's thread starts after this many stitches of the object. */
  borderAt?: number;
  /**
   * A fill that was a satin here: the columns it had, so making it a satin again gives the same
   * satin back instead of one found anew on the area.
   */
  asSatin?: Rails[];
  /** The object is the border of a fill in its own thread: the fill's `border.link`. */
  outline?: string;
  /** A border object: the settings it was sewn with (its `region` is the fill's area it was sewn on). */
  border?: BorderSettings;
  /** The lettering the object belongs to (it is sewn anew from its text, see lettering/). */
  lettering?: Lettering;
  /** The correction leaves the object as it is (set by hand). */
  lock?: boolean;
  /** What the correction changed when it last gave the object new stitches (gone with the next change by hand). */
  fixed?: Fixed[];
}

/** A setting the correction changed: which, and its value before and after. */
export interface Fixed {
  field: string;
  from: number | boolean | string;
  to: number | boolean | string;
}

/**
 * Objects given new stitches here, by their stitches: the next edit starts from the exact shape
 * and the chosen pattern instead of recognizing them again from the stitches (an open gradient
 * or a spiral would not give its shape back as well as dense rows do).
 */
const memory = new Map<string, Remembered>();
const MEMORY_SIZE = 400;
/** While trying things out (see holdMemory), nothing is forgotten for lack of room. */
let held = 0;

/**
 * Lets stitches be tried out: until the returned function is called nothing is forgotten, and then
 * memory is put back as it was (what the tries remembered goes again).
 */
export function holdMemory(): () => void {
  const saved = new Map(memory);
  const joins = holdJoins();
  held++;
  return () => {
    held--;
    memory.clear();
    for (const [k, v] of saved) memory.set(k, v);
    joins();
  };
}

/** A key for an object's stitches. */
export const objectKey = (p: Pattern, o: SewObject): string => stitchKey(p, o.first, o.last);

export function remember(p: Pattern, o: SewObject, r: Remembered): void {
  rememberKey(objectKey(p, o), r);
}

function rememberKey(key: string, r: Remembered): void {
  memory.delete(key);
  memory.set(key, r);
  if (!held && memory.size > MEMORY_SIZE) memory.delete(memory.keys().next().value!);
}

/** Remembers `r` for the stitches from record `first` to `last` (an object's records). */
export function rememberRange(p: Pattern, first: number, last: number, r: Remembered): void {
  rememberKey(stitchKey(p, first, last), r);
}

/** Forgets what was remembered for an object's stitches (or puts back `r`). */
export function forget(p: Pattern, o: SewObject, r?: Remembered): void {
  const key = objectKey(p, o);
  if (r) rememberKey(key, r);
  else memory.delete(key);
}

export function remembered(p: Pattern, o: SewObject): Remembered | undefined {
  return memory.get(objectKey(p, o));
}

/**
 * What an object remembers, or its shape as read from its stitches now (fill area, satin rails),
 * so it can be kept fixed before its stitches are changed by hand.
 */
export function keepShape(p: Pattern, o: SewObject, kinds: Uint8Array): Remembered {
  const known = remembered(p, o);
  if (known) return known;
  const an = analyze(p, o, kinds);
  const satin = an.parts.filter((pt) => pt.kind === 'satin');
  const columns = satin.map((pt) => satinColumns(p, pt, kinds).map((c) => railsOf(p, c)).filter((r): r is Rails => !!r));
  return { region: an.fill, read: true, ...(satin.length && columns.every((c) => c.length) ? { columns } : {}) };
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
  if (r) rememberKey(stitchKey(after, first, last), r);
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
  columns?: { left: number[]; right: number[]; rungs?: number[] }[][];
  hand?: number;
  read?: boolean;
  /** The area of an object whose kind was changed, as `region`. */
  shape?: StoredObject['region'];
  /** The fill area as curves (see Remembered.form). */
  form?: StoredPath[];
  knockout?: boolean;
  cut?: string;
  path?: StoredPath[];
  under?: number;
  borderAt?: number;
  asSatin?: { left: number[]; right: number[]; rungs?: number[] }[];
  outline?: string;
  border?: BorderSettings;
  lettering?: Lettering;
  lock?: boolean;
  fixed?: Fixed[];
  join?: boolean;
}

/** What is remembered about the objects of `p`, to store it with the file. */
export function rememberedIn(p: Pattern, objects: SewObject[]): StoredObject[] {
  const out: StoredObject[] = [];
  for (const o of objects) {
    const key = objectKey(p, o);
    const r = memory.get(key);
    if (!r) continue;
    const pixels = (g: Region | null) => g && { x0: g.x0, y0: g.y0, w: g.w, h: g.h, pxMm: g.pxMm, mask: g.mask, areaMm2: g.areaMm2 };
    out.push({
      key,
      region: pixels(r.region),
      ...(r.shape ? { shape: pixels(r.shape) } : {}),
      ...(r.fill ? { fill: { ...r.fill } } : {}),
      ...(r.satin ? { satin: { ...r.satin } } : {}),
      ...(r.columns ? { columns: r.columns.map((part) => part.map((c) => ({ left: c.left.flat(), right: c.right.flat(), ...(c.rungs ? { rungs: c.rungs.flat() } : {}) }))) } : {}),
      ...(r.hand ? { hand: r.hand } : {}),
      ...(r.read ? { read: true } : {}),
      ...(r.form ? { form: storeForm(r.form) } : {}),
      ...(r.knockout ? { knockout: true } : {}),
      ...(r.cut ? { cut: r.cut } : {}),
      ...(r.path ? { path: storeForm(r.path) } : {}),
      ...(r.under ? { under: r.under } : {}),
      ...(r.borderAt ? { borderAt: r.borderAt } : {}),
      ...(r.asSatin ? { asSatin: r.asSatin.map((c) => ({ left: c.left.flat(), right: c.right.flat(), ...(c.rungs ? { rungs: c.rungs.flat() } : {}) })) } : {}),
      ...(r.outline ? { outline: r.outline } : {}),
      ...(r.border ? { border: { ...r.border } } : {}),
      ...(r.lettering ? { lettering: r.lettering } : {}),
      ...(r.lock ? { lock: true } : {}),
      ...(r.fixed?.length ? { fixed: r.fixed.map((x) => ({ ...x })) } : {}),
    });
  }
  for (const j of joinsIn(p)) out.push({ key: j.key, region: null, join: j.join });
  return out;
}

const isValue = (v: unknown) => finite(v) || typeof v === 'boolean' || typeof v === 'string';
const isFixed = (x: unknown): x is Fixed => !!x && typeof (x as Fixed).field === 'string' && isValue((x as Fixed).from) && isValue((x as Fixed).to);
const PATTERNS: FillPattern[] = ['tatami', 'gradient', 'contour', 'spiral', 'follow', 'guided'];
const isLine = (l: unknown) => Array.isArray(l) && l.length >= 2 && l.every((q) => Array.isArray(q) && q.length === 2 && q.every(finite));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isFill(f: unknown): f is FillSettings {
  const s = f as FillSettings | null;
  return (
    !!s &&
    PATTERNS.includes(s.pattern) &&
    [s.spacing, s.spacingEnd, s.offset, s.angle, s.stitch, s.edge].every(finite) &&
    (s.tolerance === undefined || finite(s.tolerance)) &&
    (s.guides === undefined || (Array.isArray(s.guides) && s.guides.every(isLine))) &&
    (s.underCross === undefined || typeof s.underCross === 'boolean') &&
    (s.underInset === undefined || finite(s.underInset)) &&
    (s.expand === undefined || finite(s.expand)) &&
    (s.border === undefined || isBorder(s.border)) &&
    typeof s.underlay === 'boolean'
  );
}

const BORDERS: PathStitch['type'][] = ['run', 'triple', 'satin'];
const isColor = (c: unknown) => !!c && [(c as ThreadColor).r, (c as ThreadColor).g, (c as ThreadColor).b].every(finite);

function isBorder(b: unknown): b is BorderSettings {
  const s = b as BorderSettings | null;
  return !!s && BORDERS.includes(s.type) && finite(s.width) && [s.length, s.tolerance, s.offset, s.spacing, s.pull].every((v) => v === undefined || finite(v)) && (s.under === undefined || s.under === 'off' || UNDERLAYS.includes(s.under)) && (s.color === undefined || isColor(s.color)) && (s.link === undefined || typeof s.link === 'string');
}

function isSatin(f: unknown): f is SatinSettings {
  const s = f as SatinSettings | null;
  const optional = (v: unknown) => v === undefined || finite(v);
  return (
    !!s &&
    [s.spacing, s.edge].every(finite) &&
    typeof s.short === 'boolean' &&
    typeof s.underlay === 'boolean' &&
    [s.tolerance, s.split, s.edgeShare, s.edgeB].every(optional) &&
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
      const r = c?.rungs;
      if (r !== undefined && (!Array.isArray(r) || r.length % 2 || !r.every(finite))) return undefined;
      const rungs: Rung[] | undefined = r && Array.from({ length: r.length / 2 }, (_, k) => [r[2 * k], r[2 * k + 1]] as Rung);
      cols.push(rungs ? { left, right, rungs } : { left, right });
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
export function rememberShapes(p: Pattern, objs: SewObject[], starts: number[], shapes: (KeptShape | undefined)[], forms: ({ form?: Form; knockout?: boolean; path?: Form } | undefined)[] = []): void {
  const at = new Map<number, SewObject>();
  let n = 0;
  let k = 0;
  for (let i = 0; i < p.cmd.length && k < objs.length; i++) {
    if (i === objs[k].first) at.set(n, objs[k++]);
    if (p.cmd[i] === STITCH) n++;
  }
  starts.forEach((s, j) => {
    const shape = shapes[j];
    const o = at.get(s);
    const line = forms[j]?.path;
    if (o && line) return remember(p, o, { region: null, path: line });
    if (!shape || !o) return;
    const region = regionFrom(shape);
    const f = forms[j];
    if (region) remember(p, o, { region, fill: { ...shape.fill }, ...(f?.form ? { form: f.form, ...(f.knockout ? { knockout: true } : {}) } : {}) });
  });
}

/** Remembers stored objects again (from storage or a project file); malformed entries are skipped. */
export function restoreRemembered(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const e of list as StoredObject[]) {
    if (typeof e?.key === 'string' && typeof e.join === 'boolean') {
      restoreJoin(e.key, e.join);
      n++;
      continue;
    }
    if (typeof e?.key !== 'string' || (e.fill !== undefined && !isFill(e.fill))) continue;
    const region = e.region ? regionFrom(e.region) : null;
    if (e.region && !region) continue;
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
    const path = e.path === undefined ? null : formFrom(e.path);
    if (path) r.path = path;
    if (finite(e.under) && e.under > 0) r.under = Math.round(e.under);
    if (finite(e.borderAt) && e.borderAt > 0) r.borderAt = Math.round(e.borderAt);
    const asSatin = railsFrom([e.asSatin])?.[0];
    if (asSatin?.length) r.asSatin = asSatin;
    if (typeof e.outline === 'string') r.outline = e.outline;
    if (isBorder(e.border)) r.border = { ...e.border };
    const lettering = e.lettering === undefined ? null : letteringFrom(e.lettering);
    if (lettering) r.lettering = lettering;
    if (e.lock === true) r.lock = true;
    const fixed = Array.isArray(e.fixed) ? e.fixed.filter(isFixed).map((x) => ({ ...x })) : [];
    if (fixed.length) r.fixed = fixed;
    rememberKey(e.key, r);
    n++;
  }
  return n;
}

/**
 * Records of the fills sewn open on purpose (gradients), which the coverage check leaves out; null
 * when there are none.
 */
export function openOnPurpose(p: Pattern, objs: SewObject[]): Uint8Array | null {
  let out: Uint8Array | null = null;
  for (const o of objs) {
    if (remembered(p, o)?.fill?.pattern !== 'gradient') continue;
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
  if (spacing > OPEN_ROWS) return 'approximate';
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

export function analyze(p: Pattern, o: SewObject, kinds: Uint8Array, known = remembered(p, o)): Analysis {
  const idx: number[] = [];
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) idx.push(i);
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
  const region = known?.region ?? (others.length > 4 ? traceRegion(p, others, REACH, OPEN) : null);
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
  // Running stitch under a satin column (its underlay, also when trimmed off from it) is part of it.
  const satinSegs: number[] = [];
  for (let k = 1; k < idx.length; k++) if (kindAt[k] === 'satin' && sewnSeg(k)) satinSegs.push(idx[k]);
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
  if (known?.satin && known.columns && !known.fill) for (const r of merged) if (r.kind === 'fill') r.kind = 'satin';

  let parts: Part[] = [];
  for (const r of merged) {
    const last = parts[parts.length - 1];
    if (last && last.kind === r.kind) last.e = idx[r.b];
    else parts.push({ kind: r.kind, s: idx[r.a], e: idx[r.b] });
  }
  // A border in the fill's thread, sewn here as the last part: one part from where it starts.
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
export function traceRegion(p: Pattern, segs: number[], reach: number, open = 0, close = true): Region | null {
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
  const s: FillSettings = {
    pattern: curved ? 'follow' : 'tatami',
    spacing: sp,
    spacingEnd: Math.min(1.2, Math.round(sp * 2.5 * 100) / 100),
    offset: 0.25,
    angle: angle === 180 ? 0 : angle,
    stitch: Math.round((percentile(rows.map((g) => g.l), 0.8) || 4) * 10) / 10,
    underlay: before > rowThread * 0.06,
    edge: 0,
    tolerance: TOLERANCE,
  };
  return { s, firstRow };
}

/**
 * The underlay of an object as record ranges (a stitch's record is where its segment ends): of a
 * fill sewn here as it was made, of another fill the stitches in its area before the first row,
 * of a satin the stitches under the column that are not satin.
 */
export function underlayRanges(p: Pattern, o: SewObject, kinds: Uint8Array): [number, number][] {
  const known = remembered(p, o);
  if (known?.under) {
    let n = 0;
    for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH && ++n === known.under) return [[o.first, i]];
    return [[o.first, o.last]];
  }
  const an = analyze(p, o, kinds, known);
  const out: [number, number][] = [];
  if (an.fill && (known?.fill?.underlay ?? true)) {
    const { s, firstRow } = readFill(p, an);
    if (s.underlay && Number.isFinite(firstRow)) {
      // Inset from the edge, its first stitches may be read as running stitch: all up to the first row.
      for (const pt of an.parts) if (pt.kind !== 'satin' && pt.s < firstRow - 1) out.push([pt.s, Math.min(pt.e, firstRow - 1)]);
    }
  }
  for (const pt of an.parts) {
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
  return { spacing, edge: 0, short: true, underlay: other > satin * 0.03, tolerance: TOLERANCE, type, under: 'auto', split: SATIN_SPLIT, stagger: true, edgeShare: 0 };
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
  return left.length < 2 ? null : { left, right };
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
function railsArea(rails: Rails[]): Region | null {
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

function newFill(p: Pattern, o: SewObject, a: Analysis, s: FillSettings, reverse = false): NewFill | null {
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
  const fp: FillParams = { spacing: s.spacing, stitch: s.stitch, angle: s.angle, pull: s.edge, underlay: s.underlay, underCross: s.underCross, underInset: s.underInset, travel: way, tolerance: s.tolerance };
  // Reversed, the new stitches start where the old ones ended.
  const start = reverse ? pt10(p, last.e) : pt10(p, first.s);
  // Straight rows end near where the next object starts, when that shortens the way (if nothing
  // else of the object comes after the fill; not when it is sewn the other way round on purpose).
  let next = o.last + 1;
  while (next < p.cmd.length && p.cmd[next] !== STITCH && p.cmd[next] !== END) next++;
  if (!reverse && a.parts.filter((pt) => !pt.border).pop() === last && next < p.cmd.length && p.cmd[next] === STITCH) fp.end = pt10(p, next);
  let res;
  if (s.pattern === 'gradient') {
    res = fillRegion(r, { ...fp, spacingEnd: s.spacingEnd }, start);
  } else if (s.pattern === 'contour') {
    res = contourFill(r, fp, start);
  } else if (s.pattern === 'spiral') res = spiralFill(r, fp, start);
  else if (s.pattern === 'follow') {
    const lines: [Pt, Pt][] = [];
    for (const pt of a.parts) {
      if (pt.kind !== 'fill' || pt.border) continue;
      for (let i = pt.s + 1; i <= pt.e; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH && seg(p, i) >= 0.8) lines.push([pt10(p, i - 1), pt10(p, i)]);
    }
    const f = stitchField(r, lines);
    res = fieldFill(r, f.g, f, fp, start, false, CONTOUR_PEAK);
  } else if (s.pattern === 'guided') {
    if (!s.guides?.length) return null;
    const f = guideField(r, s.guides);
    res = fieldFill(r, f.g, f, fp, start, false, CONTOUR_PEAK);
  } else res = fillRegion(r, { ...fp, offset: s.offset }, start);
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
  const border = runs.reduce((n, run) => n + run.length, 0);
  // The border goes on the edge of the shape itself (not the grown or shrunk one), starting near
  // where the fill ends.
  if (s.border && !s.border.color && runs.length) {
    const end = runs[runs.length - 1];
    runs.push(...borderStitches(a.fill, s.border, end[end.length - 1]));
  }
  return { runs, under, border };
}

/** Satin of a border: about the density of a satin column, with a walk along the middle under it when wide enough. */
/**
 * New satin for a part, along `known` rails (kept from an earlier edit) or the rails its stitches
 * have now. Returns the stitches and the rails used.
 */
function newSatin(p: Pattern, pt: Part, s: SatinSettings, kinds: Uint8Array, known?: Rails[], reverse = false): { runs: Pt[][]; rails: Rails[] } | null {
  let rails = known ?? satinColumns(p, pt, kinds).map((c) => railsOf(p, c)).filter((r): r is Rails => !!r);
  // Reversed: the columns from the last to the first, each from its other end (sides swap with it).
  if (reverse) rails = rails.slice().reverse().map(reversedRails);
  const runs = satinRuns(rails, reverse ? swappedSides(s) : s);
  return runs.length ? { runs, rails } : null;
}

/** Rails walked from the other end: the sides swap, the rungs come along. */
export function reversedRails(r: Rails): Rails {
  const out: Rails = { left: r.right.slice().reverse(), right: r.left.slice().reverse() };
  if (r.rungs) out.rungs = reversedRungs(r.rungs, cumulative(r.left).pop()!, cumulative(r.right).pop()!);
  return out;
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
  const sp = satinParams(s);
  const sew = (ps: [Pt, Pt][]) => (s.type === 'e' ? eStitches(ps, sp) : satinStitches(ps, sp));
  for (const r of rails) {
    const col = columnOf(r);
    const ps = pairs(col, sp);
    if (ps.length < 2) continue;
    if (!s.underlay) {
      runs.push(sew(ps));
      continue;
    }
    const under = underlayOf(col, s.under ?? 'auto', s.tolerance);
    if (!under.atEnd) {
      runs.push([...under.pts, ...sew(ps)]);
      continue;
    }
    // Underlay out along the column, satin back (its sides swap with the direction).
    const rev: Column = { center: col.center.slice().reverse(), left: col.right.slice().reverse(), right: col.left.slice().reverse(), width: col.width };
    runs.push([...under.pts, ...sew(pairs(rev, satinParams(swappedSides(s))))]);
  }
  return runs;
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
  const t = Math.min(0.7, d) / d;
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
    let an = analyze(p, o, kinds, known);
    // A new area (its shape changed): the old stitches are told apart by the old one, the fill is made in the new one.
    const newArea = areas?.get(o.index);
    if (newArea && an.fill) an = { ...an, fill: newArea };
    const given = typeof settingsFor === 'function' ? settingsFor(o, an, known) : settingsFor;
    if (!given) continue;
    if (reverse) {
      // Turned around as a whole: its underlay and travel are made anew with it.
      const whole = wholeObject(p, o, an, given.kind);
      if (!whole) {
        failed.push(o.index);
        continue;
      }
      an = whole;
    }
    const parts = an.parts;
    // Satin columns kept from an earlier edit, if the object still has as many satin parts.
    const satinParts = parts.filter((pt) => pt.kind === 'satin');
    const keptRails = reverse && known?.columns?.length ? [known.columns.flat()] : known?.columns?.length === satinParts.length ? known.columns : undefined;
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
    if (converting) area = (known?.form ? rasterize(known.form) : null) ?? known?.shape ?? (src === 'fill' ? an.fill : (railsArea(satinRails ?? []) ?? coveredBy(p, parts.filter((pt) => pt.kind === src))));
    // A fill made from satin gets rows across the area in the direction with the fewest sections.
    const settings: Settings =
      converting && given.kind === 'fill' && area
        ? { kind: 'fill', s: { ...given.s, pattern: given.s.pattern === 'follow' || (given.s.pattern === 'guided' && !given.s.guides?.length) ? 'tatami' : given.s.pattern, angle: Number.isFinite(given.s.angle) ? given.s.angle : chooseAngle(area, given.s.spacing, []) } }
        : given;
    // All fill parts are one area, filled anew where the first of them was sewn; so are the parts
    // changing kind.
    const together = converting || settings.kind === 'fill';
    const guide = converting && settings.kind === 'satin' ? (guides?.get(o.index) ?? known?.asSatin) : undefined;
    const filled = together && !converting ? newFill(p, o, an, settings.s as FillSettings, reverse) : null;
    // A drawn line: sewn anew along its curves as a whole.
    const path = paths?.get(o.index) ?? known?.path;
    const line = !converting && settings.kind === 'run' && path ? lineRuns(path, settings.s, reverse) : null;
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
        const sat = newSatin(p, pt, settings.s, kinds, keptRails?.[satinParts.indexOf(pt)], reverse);
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
          ...(path && settings.kind === 'run' ? { path } : {}),
          ...(known?.under && !filled ? { under: known.under } : {}),
          ...(known?.borderAt && !filled ? { borderAt: known.borderAt } : {}),
          // Its shape changed: the satin it was no longer fits.
          ...(known?.asSatin && !newArea ? { asSatin: known.asSatin } : {}),
          ...(known?.outline ? { outline: known.outline, border: known.border } : {}),
        };
    if (known?.lettering) after.lettering = known.lettering;
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
    const underlayDone = () => {
      let n = 0;
      for (let k = objOut; k < out.length; k++) if (out[k].cmd === STITCH) n++;
      if (n) after.under = n;
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
      if (d > trimMm && run) {
        out.push(...lockAt(prevRun!, true), { x: out[out.length - 1].x, y: out[out.length - 1].y, cmd: TRIM });
        out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: JUMP });
        out.push(...lockAt(run, false));
        last = q;
        return;
      }
      out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: JUMP });
      emitPoint(q);
    };
    parts.forEach((pt, k) => {
      const f = fresh[k];
      if (f === 'skip') return;
      if (f) {
        const under = f === whole ? (filled?.under ?? 0) : 0;
        const border = f === whole && filled && filled.border < fed + f.reduce((n, r) => n + r.length, 0) ? filled.border : -1;
        for (const run of f) {
          if (fed === border) borderStarts();
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
    });
    // A new last part ends with a lock, as the old one did.
    if (fresh[fresh.length - 1] && prevRun) out.push(...lockAt(prevRun, true));
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
