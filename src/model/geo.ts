import type { Form } from '../shape/path';
import { FIT_TOLERANCE, READ_TOLERANCE, vectorize } from '../shape/vectorize';
import type { SewObject } from './objects';
import type { Pattern } from './pattern';
import { runWays, traceLine } from './line';
import { analyze, remembered, type Remembered } from './restitch';
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

/** The form of object `o`, given or guessed from its stitches: its paths as a line, else its filled area. */
export function guessGeo(p: Pattern, o: SewObject, kinds: Uint8Array): Form | null {
  return sewnAlong(p, o) ? guessLine(p, o, kinds) : guessArea(p, o, kinds);
}

/** Whether object `o` has no form given to it, so any form shown for it is guessed from its stitches. */
export const geoGuessed = (p: Pattern, o: SewObject): boolean => !geoOf(remembered(p, o));
