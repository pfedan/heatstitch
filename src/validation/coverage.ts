
/**
 * The lower limits a design has to keep, next to the upper ones (density, short stitches,
 * perforation): fabric that shows through, gaps that open where the thread pulls the fabric, and
 * stitches long enough to snag. Measured profile-independently like the rest (see measure.ts); the
 * profile picks the limit when the cells are classified.
 */

/**
 * How far rows and satin stitches pull in at each end, as a share of their length and at most
 * `cap` mm: on stable fabric (woven, caps, leather) and on stretchy or soft fabric (knits, terry,
 * light fabrics). Typical pull compensation in digitizing guides: 0.1 to 0.3 mm on woven fabric,
 * 0.3 to 0.5 mm on knits. The core measures with the same values (PULL_LOW, PULL_HIGH in
 * core/src/validation/coverage.rs).
 */
export const PULL = {
  low: { share: 0.015, cap: 0.25 },
  high: { share: 0.03, cap: 0.45 },
} as const;

/**
 * In `skip`: a record of the placement line of an appliqué. The fabric laid on inside it covers the
 * ground, as thread does: no gap opens on it (its inside has no stitches on purpose).
 */
export const PATCH = 2;
