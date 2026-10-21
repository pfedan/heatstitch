//! Pulls fill row ends back where a later object covers them (src/correct/pullback.ts).
//!
//! Digitizers let a fill reach only about a quarter to a third of the way under the satin border
//! that is sewn over it, and adjacent fills overlap by a fraction of a millimetre. Fills that run
//! on under the whole border (common in auto-digitized files) put a full fill layer, its row-end
//! penetrations and the border on top of each other. Shortening the covered part of each row keeps
//! the look, since the border hides the fill edge either way, and removes thread and penetrations
//! exactly where they pile up.
//!
//! The same holds for a fill whose end lies under a later fill (the "remove underlying stitches"
//! step of digitizing programs), but only where that fill is dense enough to hide the edge: real
//! designs also stack light texture fills on a base fill, and those would show the gap.

use super::cover::walk_covered;
use super::structure::{RowEnd, fill_row_ends, stitch_runs};
use super::sync_marks;
use crate::js::{IdMap, hypot, round};
use crate::pattern::{Bounds, Records};
use crate::validation::satin::{MIN_LEN, satin_mask};

/// Later satin thread per area (mm/mm²) from which a point counts as under a border.
const SATIN_COVER: f64 = 3.0;
/// Overlap kept under a satin border, as a share of its width, and its bounds (0.1 mm).
const SATIN_KEEP: f64 = 0.3;
const SATIN_KEEP_MIN: f64 = 4.0;
const SATIN_KEEP_MAX: f64 = 10.0;
/// Later thread per area from which a fill counts as opaque cover: a full fill layer.
const FILL_COVER: f64 = 2.2;
/// Overlap kept under a covering fill (0.1 mm).
const FILL_KEEP: f64 = 6.0;
/// Moves shorter than this are not worth it (0.1 mm).
const MIN_SHIFT: f64 = 3.0;
/// Rows stay at least this long (0.1 mm).
const MIN_ROW: f64 = 10.0;
/// Only rows at least this long are pulled back (0.1 mm). Narrower fills are details (a strip
/// between two outlines, a small area) whose visible part would shrink noticeably.
const MIN_FILL: f64 = 30.0;
/// Two rows meeting at an end must run within about 10 degrees of each other for it to move.
const ALIGNED_COS: f64 = 0.985;
/// Stitches of a straight row lie within this distance of the line between its ends (0.1 mm).
const STRAIGHT: f64 = 2.0;

pub struct Pullback {
    /// Positions with the row ends moved (marks synced).
    pub x: Vec<i32>,
    pub y: Vec<i32>,
    /// Interior row stitches to drop because they now lie beyond the row end.
    pub remove: Vec<u8>,
    pub moved: usize,
    pub removed: usize,
}

/// Steps of `o` from `at` (exclusive) towards `o` (exclusive).
fn between(at: usize, o: usize) -> impl Iterator<Item = usize> {
    let up = o > at;
    let n = at.abs_diff(o).saturating_sub(1);
    (1..=n).map(move |k| if up { at + k } else { at - k })
}

/// Row ends that may move are those where `wanted` is set; `b` are the design's bounds.
pub fn pull_back_fills(p: &Records, b: Bounds, wanted: &[u8]) -> Pullback {
    let runs = stitch_runs(p);
    let mask = satin_mask(p, MIN_LEN);
    let ends = fill_row_ends(p, &runs, &mask);
    let mut by_run: IdMap<usize, Vec<&RowEnd>> = IdMap::default();
    for e in &ends {
        by_run.entry(e.run).or_default().push(e);
    }
    let mut work = p.clone();
    let mut remove = vec![0u8; p.cmd.len()];
    let mut moved = 0;
    let mut removed = 0;
    let fx = |i: usize| p.x[i] as f64;
    let fy = |i: usize| p.y[i] as f64;

    walk_covered(&mut work, b, &runs, &mask, |work, run, cover| {
        let Some(list) = by_run.get(&run) else {
            return;
        };
        let mut shifts: Vec<(usize, f64, f64)> = vec![];
        for e in list {
            if wanted[e.at] == 0 {
                continue;
            }
            let ax = fx(e.at);
            let ay = fy(e.at);
            let mut ux = 0.0;
            let mut uy = 0.0;
            let mut reach = f64::INFINITY;
            let mut dirs: Vec<[f64; 2]> = vec![];
            let mut straight = true;
            for &o in &e.rows {
                let l = hypot(fx(o) - ax, fy(o) - ay);
                // Only straight rows: a pass that swallowed a connector at one end has no single direction.
                for i in between(e.at, o) {
                    if !straight {
                        break;
                    }
                    if ((fx(i) - ax) * (fy(o) - ay) - (fy(i) - ay) * (fx(o) - ax)).abs() / l
                        > STRAIGHT
                    {
                        straight = false;
                    }
                }
                dirs.push([(fx(o) - ax) / l, (fy(o) - ay) / l]);
                ux += dirs[dirs.len() - 1][0];
                uy += dirs[dirs.len() - 1][1];
                reach = reach.min(l);
            }
            if !straight || reach < MIN_FILL {
                continue;
            }
            // The end moves along its rows; where two rows meet at an angle (tips, corners) it would
            // leave both lines, so it stays.
            if dirs.len() == 2 && dirs[0][0] * dirs[1][0] + dirs[0][1] * dirs[1][1] < ALIGNED_COS {
                continue;
            }
            let ul = hypot(ux, uy);
            if ul == 0.0 || ul.is_nan() {
                continue;
            }
            ux /= ul;
            uy /= ul;
            let under_satin = cover.satin(ax, ay) >= SATIN_COVER;
            // Under a fill, the cover must also reach past the row end: the end lies inside it.
            if !under_satin
                && !(cover.all(ax, ay) >= FILL_COVER
                    && cover.all(ax - ux * FILL_KEEP, ay - uy * FILL_KEEP) >= FILL_COVER)
            {
                continue;
            }
            let covered = |d: f64| {
                let x = ax + ux * d;
                let y = ay + uy * d;
                if under_satin {
                    cover.satin(x, y) >= SATIN_COVER
                } else {
                    cover.all(x, y) >= FILL_COVER
                }
            };
            let max_walk = reach - MIN_ROW;
            let mut d = 0.0;
            while d < max_walk && covered(d + 1.0) {
                d += 1.0;
            }
            // Covered all the way: the row is hidden, not overlapping an edge. Thinning deals with that.
            if d >= max_walk {
                continue;
            }
            let keep = if under_satin {
                SATIN_KEEP_MAX.min(SATIN_KEEP_MIN.max(SATIN_KEEP * cover.satin_width(work, ax, ay)))
            } else {
                FILL_KEEP
            };
            let shift = d - keep;
            if shift < MIN_SHIFT {
                continue;
            }
            shifts.push((e.at, ux * shift, uy * shift));
            // Row stitches between the old and the new end are dropped.
            for &o in &e.rows {
                for i in between(e.at, o) {
                    let along = (fx(i) - ax) * ux + (fy(i) - ay) * uy;
                    if along < shift + MIN_SHIFT && remove[i] == 0 {
                        remove[i] = 1;
                        removed += 1;
                    }
                }
            }
        }
        for (i, dx, dy) in shifts {
            work.x[i] = round(fx(i) + dx) as i32;
            work.y[i] = round(fy(i) + dy) as i32;
            moved += 1;
        }
    });

    let Records { mut x, mut y, .. } = work;
    if moved > 0 {
        sync_marks(&mut x, &mut y, &p.cmd);
    }
    Pullback {
        x,
        y,
        remove,
        moved,
        removed,
    }
}
