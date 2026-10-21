//! Short stitches and the ties that are exempt from the checks (src/validation/shortStitches.ts).

use crate::js::hypot;
use crate::pattern::{Records, STITCH};

/// Record ends a short stitch that counts towards the cluster rule.
pub const SHORT: u8 = 1;
/// Record ends a short stitch of a tie-in or tie-off run (exempt from the checks).
pub const TIE: u8 = 2;
/// Lock stitches are a handful of stitches; longer runs of short stitches are real stitching.
pub const TIE_MAX: usize = 6;
/// Stitches shorter than this (mm) count as short (SHORT_STITCH_MM in validation/thresholds.ts).
pub const SHORT_STITCH_MM: f64 = 1.0;

/// Tags every stitch record whose incoming stitch is shorter than SHORT_STITCH_MM. Up to TIE_MAX
/// short stitches right after the first stitch of a block (tie-in) or right before its last
/// (tie-off) are ties, and so is a lock in a running thread: a few short stitches back and forth
/// that end where they began.
pub fn tag_short_stitches(p: &Records) -> Vec<u8> {
    let n = p.cmd.len();
    let mut tags = vec![0u8; n];
    let limit = SHORT_STITCH_MM * 10.0;
    // Indices as i64: the rules look one and two records before a run.
    let is_stitch = |i: i64| i >= 0 && (i as usize) < n && p.cmd[i as usize] == STITCH;
    let is_short = |i: i64| {
        is_stitch(i) && is_stitch(i - 1) && {
            let (i, j) = (i as usize, i as usize - 1);
            hypot((p.x[i] - p.x[j]) as f64, (p.y[i] - p.y[j]) as f64) < limit
        }
    };
    let mut a = 0i64;
    while (a as usize) < n {
        if !is_short(a) {
            a += 1;
            continue;
        }
        let mut b = a;
        while is_short(b + 1) {
            b += 1;
        }
        let (au, bu) = (a as usize, b as usize);
        tags[au..=bu].fill(SHORT);
        if !is_stitch(a - 2) {
            // a - 1 starts its block.
            tags[au..=bu.min(au + TIE_MAX - 1)].fill(TIE);
        }
        if !is_stitch(b + 1) {
            // b ends its block.
            tags[au.max((bu + 1).saturating_sub(TIE_MAX))..=bu].fill(TIE);
        }
        if bu - au + 1 >= 3 && bu - au < TIE_MAX && p.x[bu] == p.x[au - 1] && p.y[bu] == p.y[au - 1]
        {
            // A lock in a running thread.
            tags[au..=bu].fill(TIE);
        }
        a = b + 1;
    }
    tags
}

/// Counts non-exempt short stitches per 1 mm cell of the grid at (origin_x, origin_y) mm.
pub fn short_stitch_counts(
    p: &Records,
    tags: &[u8],
    origin_x: f64,
    origin_y: f64,
    cols: usize,
    rows: usize,
) -> Vec<u16> {
    let mut counts = vec![0u16; cols * rows];
    for k in 0..tags.len() {
        if tags[k] != SHORT {
            continue;
        }
        let cx = (p.x[k] as f64 / 10.0 - origin_x).floor();
        let cy = (p.y[k] as f64 / 10.0 - origin_y).floor();
        if cx >= 0.0 && cy >= 0.0 && cx < cols as f64 && cy < rows as f64 {
            let c = cy as usize * cols + cx as usize;
            counts[c] = counts[c].wrapping_add(1);
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pattern::JUMP;

    fn records(pts: &[(i32, i32, u8)]) -> Records {
        Records {
            x: pts.iter().map(|p| p.0).collect(),
            y: pts.iter().map(|p| p.1).collect(),
            cmd: pts.iter().map(|p| p.2).collect(),
            colors: vec![],
        }
    }

    #[test]
    fn ties_at_block_ends_and_shorts_inside() {
        // Tie-in of two short stitches, long stitches, a cluster of short ones, long, tie-off.
        let mut pts = vec![(0, 0, STITCH), (3, 0, STITCH), (0, 0, STITCH)];
        let mut x = 0;
        for _ in 0..3 {
            x += 30;
            pts.push((x, 0, STITCH));
        }
        for _ in 0..8 {
            x += 4;
            pts.push((x, 0, STITCH));
        }
        x += 30;
        pts.push((x, 0, STITCH));
        pts.push((x + 3, 0, STITCH));
        pts.push((x, 0, STITCH));
        pts.push((500, 500, JUMP));
        let tags = tag_short_stitches(&records(&pts));
        assert_eq!(&tags[0..3], &[0, TIE, TIE]);
        assert!(tags[6..14].iter().all(|&t| t == SHORT));
        assert_eq!(&tags[14..18], &[0, TIE, TIE, 0]);
    }

    #[test]
    fn lock_in_running_thread() {
        let pts = vec![
            (0, 0, STITCH),
            (30, 0, STITCH),
            (33, 0, STITCH),
            (30, 0, STITCH),
            (33, 0, STITCH),
            (30, 0, STITCH),
            (60, 0, STITCH),
            (90, 0, STITCH),
        ];
        let tags = tag_short_stitches(&records(&pts));
        assert_eq!(tags, vec![0, 0, TIE, TIE, TIE, TIE, 0, 0]);
    }

    #[test]
    fn counts_per_cell() {
        let p = records(&[(5, 5, STITCH), (15, 5, STITCH), (17, 5, STITCH)]);
        let c = short_stitch_counts(&p, &[0, SHORT, SHORT], 0.0, 0.0, 2, 1);
        assert_eq!(c, vec![0, 2]);
    }
}
