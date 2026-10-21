//! Rules by size that hold on every fabric, as src/material/rules.ts has them (that file points
//! here). Values per fabric stay in TypeScript (fabrics.ts).

/// Lock stitches at the start and end of a run: the half-stitch lock over 0.7 mm (there 0.35, 0.7,
/// back 0.35, home), short enough to hide under the following stitches.
pub const LOCK_MM: f64 = 0.7;

/// Satin underlay by column width (mm), in tiers: narrower than SATIN_UNDER_MIN none (it would only
/// pile up); under SATIN_CENTER_MAX a walk along the middle; under SATIN_CONTOUR_MAX an edge run
/// inside both rails; under SATIN_ZIGZAG_MAX edge run and one zigzag; from there edge run and a
/// crossed (double) zigzag. On stretchy fabric crossed already from SATIN_CROSS_STRETCH, as the
/// fabric needs holding in both diagonals sooner.
pub const SATIN_UNDER_MIN: f64 = 1.0;
pub const SATIN_CENTER_MAX: f64 = 3.0;
pub const SATIN_CONTOUR_MAX: f64 = 6.0;
pub const SATIN_ZIGZAG_MAX: f64 = 10.0;
pub const SATIN_CROSS_STRETCH: f64 = 6.0;

/// Satin stitches are split from this length (mm) unless an object says otherwise.
pub const SATIN_SPLIT_MM: f64 = 7.0;
/// Longest split length the panel offers (mm); most machines sew up to 12.1 mm per stitch.
pub const SATIN_SPLIT_MAX: f64 = 12.0;
