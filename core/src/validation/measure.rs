//! The profile-independent measurements of a design on the 1 mm validation grid
//! (src/validation/measure.ts): thread density, satin share, short stitches, penetrations and the
//! lower limits of coverage.rs. Classifying them by a profile stays in TypeScript (validate.ts).

use super::coverage::measure_coverage;
use super::kinds::stitch_kinds;
use super::satin::{MIN_LEN, satin_mask};
use super::short_stitches::{TIE, short_stitch_counts, tag_short_stitches};
use crate::density::grid::{DensityGrid, DensityOptions, Metric, compute_density};
use crate::pattern::{Records, STITCH};
use std::collections::HashMap;

/// Validation always uses 1 mm cells, independent of the display settings.
pub const VALIDATION_CELL_MM: f64 = 1.0;
/// Values are computed on 1/SUB mm sub-cells, smoothed, then reduced to 1 mm cells.
const SUB: usize = 5;
/// Shifts the grid by half the file resolution so no stitch coordinate sits on a cell edge.
const SHIFT_MM: f64 = -0.05;
/// Smoothing radius (mm).
pub const BLUR_MM: f64 = 0.6;
/// Penetrations closer than this (mm) to a penetration count as its neighbours.
pub const HOLE_RADIUS_MM: f64 = 1.0;

/// As `Measurement` in measure.ts: one value per 1 mm cell, row-major.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Measurement {
    pub origin_x: f64,
    pub origin_y: f64,
    pub cols: usize,
    pub rows: usize,
    pub cell_mm: f64,
    /// Peak smoothed thread density within each cell, mm/mm².
    pub density: Vec<f32>,
    /// Share (0 to 1) of the cell's thread that belongs to satin columns.
    pub satin: Vec<f32>,
    /// Non-exempt stitches shorter than 1 mm per cell.
    pub shorts: Vec<u16>,
    /// Most neighbouring penetrations within HOLE_RADIUS_MM that any penetration in the cell has.
    pub holes: Vec<u8>,
    pub cover: Vec<f32>,
    pub gaps_low: Vec<u8>,
    pub gaps_high: Vec<u8>,
    /// Longest stitch with an end in the cell (0.1 mm).
    pub longest: Vec<u16>,
}

fn sub_grid(p: &Records, bounds: [f64; 4], keep: Option<&[u8]>) -> DensityGrid {
    let opt = DensityOptions {
        metric: Metric::Thread,
        cell_mm: VALIDATION_CELL_MM / SUB as f64,
        blur_mm: BLUR_MM,
        include_jumps: false,
        align_mm: Some(VALIDATION_CELL_MM),
        shift_mm: Some(SHIFT_MM),
    };
    compute_density(p, bounds, &opt, keep)
}

/// Reduces SUB x SUB blocks of sub-cells to one value: their maximum, or their mean.
fn reduce(g: &DensityGrid, mean: bool) -> Vec<f32> {
    let cols = g.cols.div_ceil(SUB);
    let rows = g.rows.div_ceil(SUB);
    let mut out = vec![0f32; cols * rows];
    for y in 0..g.rows {
        let row = (y / SUB) * cols;
        for x in 0..g.cols {
            let i = row + x / SUB;
            let v = g.data[y * g.cols + x];
            if !mean {
                if v > out[i] {
                    out[i] = v;
                }
            } else {
                out[i] = (out[i] as f64 + v as f64) as f32;
            }
        }
    }
    if mean {
        for v in out.iter_mut() {
            *v = (*v as f64 / (SUB * SUB) as f64) as f32;
        }
    }
    out
}

/// Measures a design whose bounds (0.1 mm) are `bounds`. `skip_cover` marks records that do not
/// count for fabric showing through (see coverage.rs); without `gaps` the gap rasters are left out.
pub fn measure_pattern(
    p: &Records,
    bounds: [f64; 4],
    skip_cover: Option<&[u8]>,
    gaps: bool,
) -> Measurement {
    let total = sub_grid(p, bounds, None);
    let mask = satin_mask(p, MIN_LEN);
    let satin_sub = sub_grid(p, bounds, Some(&mask));
    let tags = tag_short_stitches(p);

    let cols = total.cols.div_ceil(SUB);
    let rows = total.rows.div_ceil(SUB);
    let (origin_x, origin_y) = (total.origin_x, total.origin_y);
    let density = reduce(&total, false);
    let total_mean = reduce(&total, true);
    let satin_mean = reduce(&satin_sub, true);
    let satin: Vec<f32> = total_mean
        .iter()
        .zip(&satin_mean)
        .map(|(&t, &s)| {
            if t > 0.0 {
                (s as f64 / t as f64).min(1.0) as f32
            } else {
                0.0
            }
        })
        .collect();
    let shorts = short_stitch_counts(p, &tags, origin_x, origin_y, cols, rows);
    let holes = hole_neighbours(p, &tags, origin_x, origin_y, cols, rows);
    let c = measure_coverage(
        p,
        &total_mean,
        origin_x,
        origin_y,
        cols,
        rows,
        skip_cover,
        gaps,
        || stitch_kinds(p),
    );
    Measurement {
        origin_x,
        origin_y,
        cols,
        rows,
        cell_mm: VALIDATION_CELL_MM,
        density,
        satin,
        shorts,
        holes,
        cover: c.cover,
        gaps_low: c.gaps_low,
        gaps_high: c.gaps_high,
        longest: c.longest,
    }
}

/// Per cell, the highest neighbour count (within HOLE_RADIUS_MM) of any penetration in it.
fn hole_neighbours(
    p: &Records,
    tags: &[u8],
    origin_x: f64,
    origin_y: f64,
    cols: usize,
    rows: usize,
) -> Vec<u8> {
    // 0.1 mm units.
    let r = HOLE_RADIUS_MM * 10.0;
    let r2 = r * r + 1e-6;
    let idx: Vec<usize> = (0..p.cmd.len())
        .filter(|&i| p.cmd[i] == STITCH && tags[i] != TIE)
        .collect();
    let bucket = |i: usize| {
        (
            (p.x[i] as f64 / r).floor() as i64,
            (p.y[i] as f64 / r).floor() as i64,
        )
    };

    // Spatial hash with bucket size r: neighbours lie in the 3 x 3 surrounding buckets.
    let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for &i in &idx {
        buckets.entry(bucket(i)).or_default().push(i);
    }

    let mut out = vec![0u8; cols * rows];
    for &i in &idx {
        let (bx, by) = bucket(i);
        let mut n = 0u32;
        for dy in -1..=1 {
            for dx in -1..=1 {
                for &j in buckets.get(&(bx + dx, by + dy)).map_or(&[][..], |v| v) {
                    if j == i {
                        continue;
                    }
                    let ex = (p.x[j] - p.x[i]) as f64;
                    let ey = (p.y[j] - p.y[i]) as f64;
                    if ex * ex + ey * ey <= r2 {
                        n += 1;
                    }
                }
            }
        }
        let cx = (p.x[i] as f64 / 10.0 - origin_x).floor();
        let cy = (p.y[i] as f64 / 10.0 - origin_y).floor();
        if cx >= 0.0 && cy >= 0.0 && cx < cols as f64 && cy < rows as f64 {
            let c = cy as usize * cols + cx as usize;
            out[c] = out[c].max(n.min(255) as u8);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn records(pts: &[(i32, i32)]) -> Records {
        Records {
            x: pts.iter().map(|p| p.0).collect(),
            y: pts.iter().map(|p| p.1).collect(),
            cmd: vec![STITCH; pts.len()],
            colors: vec![],
        }
    }

    fn bounds(p: &Records) -> [f64; 4] {
        let b = p.bounds();
        [
            b.min_x as f64,
            b.min_y as f64,
            b.max_x as f64,
            b.max_y as f64,
        ]
    }

    #[test]
    fn satin_column_measures_as_satin() {
        let pts: Vec<(i32, i32)> = (0..60)
            .map(|i| (100 + i * 3, if i % 2 == 0 { 100 } else { 130 }))
            .collect();
        let p = records(&pts);
        let m = measure_pattern(&p, bounds(&p), None, true);
        assert_eq!(m.density.len(), m.cols * m.rows);
        let peak = m.density.iter().cloned().fold(0f32, f32::max);
        assert!(peak > 2.0, "{peak}");
        let i = m.density.iter().position(|&v| v == peak).unwrap();
        assert!(m.satin[i] > 0.9);
        // Penetrations 0.6 mm apart along each edge: two neighbours within 1 mm.
        assert_eq!(m.holes.iter().cloned().max().unwrap(), 2);
        assert!(m.shorts.iter().all(|&s| s == 0));
    }

    #[test]
    fn short_stitches_are_counted() {
        let mut pts = vec![(0, 0), (50, 0), (100, 0)];
        for k in 1..=10 {
            pts.push((100 + k * 2, 0));
        }
        pts.extend([(150, 0), (200, 0)]);
        let p = records(&pts);
        let m = measure_pattern(&p, bounds(&p), None, false);
        let s: u32 = m.shorts.iter().map(|&v| v as u32).sum();
        assert_eq!(s, 10);
        assert!(m.gaps_low.iter().all(|&v| v == 0));
    }

    #[test]
    fn empty_design() {
        let p = records(&[]);
        let m = measure_pattern(&p, [0.0; 4], None, true);
        assert!(m.density.iter().all(|&v| v == 0.0));
    }
}
