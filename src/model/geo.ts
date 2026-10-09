import type { Pt } from '../digitize/skeleton';
import { flatten, type Form, type Path } from '../shape/path';
import { FIT_TOLERANCE, READ_TOLERANCE, vectorize } from '../shape/vectorize';
import type { SewObject } from './objects';
import type { Pattern } from './pattern';
import { runWays, traceLine } from './line';
import { analyze, keepShape, remembered, type Rails, type Remembered } from './restitch';
import { stitchKinds } from './sequence';

/**
 * The form of an object (see docs on the vector model): its paths, each open or closed. Every
 * object has at most one, and only these functions know where it lies in what an object remembers;
 * everything else asks them.
 *
 * - `geoOf`: the form someone gave (drawn, from an SVG, the Image mode, or read and then edited).
 * - `guessGeo`: that form, or else one traced from the stitches (guessed: shown dashed, kept only
 *   once edited, see `geoGuessed`).
 * - `withGeo`: the same object with another form, in the same place.
 */

/**
 * How an object's form is sewn: its closed paths filled (`area`), sewn along (`line`), or filled
 * in a band of a width along them (`band`, a wide line sewn as a fill).
 */
export type GeoUse = 'area' | 'line' | 'band';

/** How the form of what an object remembers is sewn, or null when it has none. */
export function geoUse(m: Remembered | null | undefined): GeoUse | null {
  if (!m) return null;
  if (m.asLine && m.fill) return 'band';
  if (m.path) return 'line';
  if (m.form) return 'area';
  return null;
}

/** The form an object was given (not guessed), or null. */
export function geoOf(m: Remembered | null | undefined): Form | null {
  switch (geoUse(m)) {
    case 'band':
      return m!.asLine!.path;
    case 'line':
      return m!.path!;
    case 'area':
      return m!.form!;
    default:
      return null;
  }
}

/** The form of an object whose closed paths are filled, or null. */
export const areaOf = (m: Remembered | null | undefined): Form | null => (geoUse(m) === 'area' ? m!.form! : null);

/** The form of an object sewn along its paths, or null. */
export const lineGeoOf = (m: Remembered | null | undefined): Form | null => (geoUse(m) === 'line' ? m!.path! : null);

/**
 * What `m` remembers with `geo` as its form, used as before (`use` for one that had none, or to use
 * it otherwise). Only the form changes: an area rastered from it is the caller's to make anew.
 */
export function withGeo(m: Remembered, geo: Form, use: GeoUse = geoUse(m) ?? 'area'): Remembered {
  const { form: _f, path: _p, ...rest } = m;
  switch (use) {
    case 'band':
      return { ...rest, asLine: { ...m.asLine!, path: geo } };
    case 'line':
      return { ...rest, path: geo };
    case 'area':
      return { ...rest, form: geo };
  }
}

/**
 * The filled form of object `o`: the one it was given, else its area (kept or read from its
 * stitches) traced. Null for objects without a fill.
 */
export function guessArea(p: Pattern, o: SewObject, kinds: Uint8Array): Form | null {
  const known = remembered(p, o);
  const use = geoUse(known);
  if (use === 'area' || use === 'band') return geoOf(known);
  const an = analyze(p, o, kinds, known);
  if (!an.fill || !an.parts.some((pt) => pt.kind === 'fill')) return null;
  // The exact area of a design made here, or one read from the stitches (rougher).
  const exact = known && !known.read && known.region === an.fill;
  const f = vectorize(an.fill, exact ? FIT_TOLERANCE : READ_TOLERANCE);
  return f.paths.length ? f : null;
}

/** The paths of a line object: the ones it was given, else traced through its running stitches. */
export function guessLine(p: Pattern, o: SewObject, kinds?: Uint8Array): Form | null {
  const known = lineGeoOf(remembered(p, o));
  if (known) return known;
  if (o.kind !== 'run') return null;
  const paths = runWays(p, o.first, o.last, kinds ?? stitchKinds(p)).flatMap((w) => traceLine(w)?.paths ?? []);
  return paths.length ? { paths } : null;
}

/**
 * Whether object `o` is sewn along its paths: given as a line (drawn, an SVG stroke) or the running
 * stitch of a file, read as one; not the border of a fill and not a letter.
 */
export function sewnAlong(p: Pattern, o: SewObject): boolean {
  const m = remembered(p, o);
  if (geoUse(m) === 'line') return true;
  return o.kind === 'run' && !m?.outline && !m?.lettering;
}

/** Whether object `o` is satin only (no fill in it), with no form given, not a lettering. */
function satinOnly(p: Pattern, o: SewObject, kinds: Uint8Array): boolean {
  const known = remembered(p, o);
  if (geoOf(known) || known?.lettering) return false;
  const an = analyze(p, o, kinds, known);
  return an.parts.some((pt) => pt.kind === 'satin') && !an.parts.some((pt) => pt.kind === 'fill');
}

/** Twice the area a ring of points encloses, positive when it goes round counterclockwise (y up). */
function twiceArea(ring: Pt[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    twice += ax * by - bx * ay;
  }
  return twice;
}

/** Whether a rail ends near where it began (within 1 mm), after going round (more than 4 mm long). */
function meets(rail: Pt[]): boolean {
  let len = 0;
  for (let i = 1; i < rail.length; i++) len += Math.hypot(rail[i][0] - rail[i - 1][0], rail[i][1] - rail[i - 1][1]);
  return len > 4 && Math.hypot(rail[0][0] - rail[rail.length - 1][0], rail[0][1] - rail[rail.length - 1][1]) < 1;
}

/** A ring of points as a closed path of few nodes, going round the way `sign` says. */
function closedPath(ring: Pt[], sign: 1 | -1): Path | null {
  const pts = Math.sign(twiceArea(ring)) === sign ? ring : ring.slice().reverse();
  const traced = traceLine([...pts, pts[0]]);
  return traced?.paths[0]?.closed ? traced.paths[0] : null;
}

/** How many paths the outline of each satin column has (see satinOutline): two for one that goes all round, else one. */
export const outlinePaths = (cols: Rails[]): number[] => cols.map((c) => (c.left.length < 2 || c.right.length < 2 ? 0 : meets(c.left) && meets(c.right) ? 2 : 1));

/**
 * The area of a satin with no form given (of a file from elsewhere): each column between its two
 * rails as a closed outline of few nodes, all one way round so columns that overlap add up.
 * Guessed from its stitches; edited, it becomes the satin's form (a satin over an area).
 */
export function satinOutline(p: Pattern, o: SewObject, kinds: Uint8Array): Form | null {
  if (!satinOnly(p, o, kinds)) return null;
  const cols = keepShape(p, o, kinds).columns?.flat();
  if (!cols?.length) return null;
  const paths: Path[] = [];
  for (const c of cols) {
    if (c.left.length < 2 || c.right.length < 2) continue;
    // A column that goes all round (an O) ends where it began: its rails are its outside and its hole.
    if (meets(c.left) && meets(c.right)) {
      const [outer, inner] = Math.abs(twiceArea(c.left)) >= Math.abs(twiceArea(c.right)) ? [c.left, c.right] : [c.right, c.left];
      const out = closedPath(outer, 1);
      const hole = closedPath(inner, -1);
      if (out && hole) paths.push(out, hole);
      continue;
    }
    // Along the left rail, then back along the right one (both go the way the column was sewn).
    const ring = closedPath([...c.left, ...c.right.slice().reverse()], 1);
    if (ring) paths.push(ring);
  }
  return paths.length ? { paths, nonzero: true } : null;
}

/**
 * The form of object `o`, given or guessed from its stitches: its paths as a line, else its filled
 * area, else (a satin of a file) the outline of its columns.
 */
export function guessGeo(p: Pattern, o: SewObject, kinds: Uint8Array): Form | null {
  return sewnAlong(p, o) ? guessLine(p, o, kinds) : (guessArea(p, o, kinds) ?? satinOutline(p, o, kinds));
}

/** Whether object `o` has no form given to it, so any form shown for it is guessed from its stitches. */
export const geoGuessed = (p: Pattern, o: SewObject): boolean => !geoOf(remembered(p, o));

/**
 * What a form allows, the one rule of the vector model for it (asked by the kind switch, the level
 * Form and cutting apart; nothing else decides by the kind of an object):
 *
 * | stitch type                              | needs                                     |
 * |------------------------------------------|-------------------------------------------|
 * | fill (also satin over the area)          | a closed path that encloses an area       |
 * | line (along all paths, also satin line)  | a path                                    |
 *
 * Open paths beside closed ones are not filled (`openBeside` says how many): no path is closed in
 * thought, as SVG would.
 */
export interface Fit {
  fill: boolean;
  line: boolean;
  /** Open paths of a form that can be filled: sewn by its border only, not filled. */
  openBeside: number;
}

/** The area a closed path encloses (mm², its curves flattened). */
const pathArea = (path: Path): number => Math.abs(twiceArea(flatten(path, 0.1))) / 2;

/** What form `geo` allows (see Fit). */
export function fitsOf(geo: Form | null | undefined): Fit {
  const paths = geo?.paths.filter((x) => x.nodes.length >= 2) ?? [];
  const closed = paths.filter((x) => x.closed && pathArea(x) > 1e-3);
  const fill = closed.length > 0;
  return { fill, line: paths.length > 0, openBeside: fill ? paths.filter((x) => !x.closed).length : 0 };
}

/** Whether form `geo` allows stitch type `s` (see Fit). */
export const fits = (geo: Form | null | undefined, s: 'fill' | 'line'): boolean => fitsOf(geo)[s];
