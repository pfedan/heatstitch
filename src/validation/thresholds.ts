export const SAFE = 0;
export const CAUTION = 1;
export const CRITICAL = 2;
export type Level = typeof SAFE | typeof CAUTION | typeof CRITICAL;

/** Thread length per area in mm/mm². One fill layer at 0.4 mm row spacing is 2.5 mm/mm². */
export const CAUTION_MM = 6.0;
export const CRITICAL_MM = 10.0;
/** A satin cell stays Safe below this (satin border over one base layer). */
export const SATIN_SAFE_MAX_MM = 7.5;

/** Stitches shorter than this (mm) count towards the short-stitch cluster rule. */
export const SHORT_STITCH_MM = 1.0;
/** This many non-exempt short stitches in one 1 mm cell make it Critical. */
export const SHORT_STITCH_COUNT = 8;

/** Absorbs float noise so that e.g. exactly 4 layers at 0.4 mm (10.0) counts as Critical. */
const EPS = 1e-3;

export function classify(density: number, isSatin: boolean): Level {
  if (density >= CRITICAL_MM - EPS) return CRITICAL;
  if (density >= CAUTION_MM - EPS) return isSatin && density < SATIN_SAFE_MAX_MM - EPS ? SAFE : CAUTION;
  return SAFE;
}
