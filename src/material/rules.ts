/**
 * Rules by size that hold on every fabric, in one place (research: plans/voreinstellungen-recherche.md
 * in the project files). Values per fabric are in fabrics.ts.
 */

/**
 * Lock stitches at the start and end of a run: the half-stitch lock over 0.7 mm (there 0.35, 0.7,
 * back 0.35, home). Ink/Stitch's default (lock_*_scale_mm 0.7, half_stitch); short enough to hide
 * under the following stitches.
 */
export const LOCK_MM = 0.7;

/**
 * Satin underlay by column width (mm). Narrower than SATIN_UNDER_MIN no underlay (it would only
 * pile up); up to SATIN_CENTER_MAX a walk along the middle; wider contour and zigzag. Ink/Stitch's
 * underlay tutorial: center walk 1 to 2 mm, contour 2 to 3.5 mm, contour and zigzag from 4 mm;
 * Wilcom: center run up to 2 to 3 mm. Disputed between 2 and 4 mm: the center walk stays there,
 * since the satin is sewn back over the underlay and a contour would end where it began.
 */
export const SATIN_UNDER_MIN = 1;
export const SATIN_CENTER_MAX = 4;

/**
 * Satin stitches are split from this length (mm) unless an object says otherwise. Wilcom's auto
 * split and Ink/Stitch ("over 7 mm risk of brittleness") agree on 7 mm; the fabric may ask for less
 * (Fabric.longMm).
 */
export const SATIN_SPLIT_MM = 7;
/** Longest split length the panel offers (mm); most machines sew up to 12.1 mm per stitch. */
export const SATIN_SPLIT_MAX = 12;
