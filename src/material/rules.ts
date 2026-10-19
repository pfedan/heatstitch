/**
 * Rules by size that hold on every fabric, in one place (research: plans/voreinstellungen-recherche.md
 * in the project files). Values per fabric are in fabrics.ts. The Rust core has the same values in
 * core/src/material/rules.rs: change both together.
 */

/**
 * Lock stitches at the start and end of a run: the half-stitch lock over 0.7 mm (there 0.35, 0.7,
 * back 0.35, home). Ink/Stitch's default (lock_*_scale_mm 0.7, half_stitch); short enough to hide
 * under the following stitches.
 */
export const LOCK_MM = 0.7;

/**
 * Satin underlay by column width (mm), in tiers: narrower than SATIN_UNDER_MIN none (it would only
 * pile up); under SATIN_CENTER_MAX a walk along the middle; under SATIN_CONTOUR_MAX an edge run
 * inside both rails; under SATIN_ZIGZAG_MAX edge run and one zigzag; from there edge run and a
 * crossed (double) zigzag. On stretchy fabric (Fabric.pull high) crossed already from
 * SATIN_CROSS_STRETCH, as the fabric needs holding in both diagonals sooner. Ink/Stitch's underlay
 * tutorial: center walk 1 to 2 mm, contour 2 to 3.5 mm, contour and zigzag from 4 mm; Wilcom:
 * center run up to 2 to 3 mm, edge run for wider columns, zigzag or double zigzag for wide ones;
 * the tiers in mm are a current commercial digitizer's published table.
 */
export const SATIN_UNDER_MIN = 1;
export const SATIN_CENTER_MAX = 3;
export const SATIN_CONTOUR_MAX = 6;
export const SATIN_ZIGZAG_MAX = 10;
export const SATIN_CROSS_STRETCH = 6;

/**
 * Satin stitches are split from this length (mm) unless an object says otherwise. Wilcom's auto
 * split and Ink/Stitch ("over 7 mm risk of brittleness") agree on 7 mm; the fabric may ask for less
 * (Fabric.longMm).
 */
export const SATIN_SPLIT_MM = 7;
/** Longest split length the panel offers (mm); most machines sew up to 12.1 mm per stitch. */
export const SATIN_SPLIT_MAX = 12;
