//! Satin columns and E stitches recognized from the stitches alone (src/validation/satin.ts).

use crate::density::jsmath::hypot;
use crate::pattern::{Records, STITCH};

/// Minimum number of consecutive zigzag segments to call a run satin.
pub const SATIN_MIN_RUN: usize = 4;
/// 1.0 mm in 0.1 mm units.
pub const MIN_LEN: f64 = 10.0;
/// 12.1 mm, the DST maximum.
const MAX_LEN: f64 = 121.0;
/// Consecutive segments must point in roughly opposite directions (angle > ~134 degrees).
const MAX_DOT: f64 = -0.7;
const MAX_RATIO: f64 = 2.0;

/// Marks satin segments: mask[i] = 1 if the stitch segment ending at record i belongs to a run of
/// at least SATIN_MIN_RUN consecutive stitch-to-stitch segments that zigzag back and forth with
/// similar lengths. `min_len` (0.1 mm) lowers the shortest segment that counts.
pub fn satin_mask(p: &Records, min_len: f64) -> Vec<u8> {
    let n = p.cmd.len();
    let mut mask = vec![0u8; n];
    let mut len = vec![0f64; n];
    for i in 1..n {
        if p.cmd[i] == STITCH && p.cmd[i - 1] == STITCH {
            len[i] = hypot((p.x[i] - p.x[i - 1]) as f64, (p.y[i] - p.y[i - 1]) as f64);
        }
    }
    let valid = |i: usize| len[i] >= min_len && len[i] <= MAX_LEN;
    // Segment i follows segment i - 1 directly.
    let zigzag = |i: usize| {
        if i < 2 || !valid(i) || !valid(i - 1) {
            return false;
        }
        let r = len[i] / len[i - 1];
        if !(1.0 / MAX_RATIO..=MAX_RATIO).contains(&r) {
            return false;
        }
        let dot = (p.x[i] - p.x[i - 1]) as f64 * (p.x[i - 1] - p.x[i - 2]) as f64
            + (p.y[i] - p.y[i - 1]) as f64 * (p.y[i - 1] - p.y[i - 2]) as f64;
        dot / (len[i] * len[i - 1]) < MAX_DOT
    };

    // First segment of the current run.
    let mut start: Option<usize> = None;
    let mut close = |start: &mut Option<usize>, end: usize| {
        if let Some(s) = *start
            && end + 1 >= s + SATIN_MIN_RUN
        {
            mask[s..=end].fill(1);
        }
        *start = None;
    };
    for i in 1..n {
        if !valid(i) {
            close(&mut start, i - 1);
            continue;
        }
        if start.is_none() {
            start = Some(i);
        } else if !zigzag(i) {
            close(&mut start, i - 1);
            start = Some(i);
        }
    }
    if n > 0 {
        close(&mut start, n - 1);
    }
    mask
}

/// Marks E stitches (blanket stitch along appliqué edges): a stitch across, the stitch back into
/// the same hole and a step on along the edge, square to it, at least three times in a row.
pub fn e_stitch_mask(p: &Records) -> Vec<u8> {
    let n = p.cmd.len();
    let mut mask = vec![0u8; n];
    let sewn = |i: usize| i > 0 && i < n && p.cmd[i] == STITCH && p.cmd[i - 1] == STITCH;
    // Spoke out ending at record i, back at i + 1, the step on at i + 2.
    let spoke = |i: usize| {
        if !sewn(i) || !sewn(i + 1) || !sewn(i + 2) {
            return false;
        }
        if p.x[i + 1] != p.x[i - 1] || p.y[i + 1] != p.y[i - 1] {
            return false;
        }
        let sx = (p.x[i] - p.x[i - 1]) as f64;
        let sy = (p.y[i] - p.y[i - 1]) as f64;
        let tx = (p.x[i + 2] - p.x[i + 1]) as f64;
        let ty = (p.y[i + 2] - p.y[i + 1]) as f64;
        let ls = hypot(sx, sy);
        let lt = hypot(tx, ty);
        if !(8.0..=MAX_LEN).contains(&ls) || !(3.0..=80.0).contains(&lt) {
            return false;
        }
        (sx * tx + sy * ty).abs() / (ls * lt) < 0.6
    };
    let mut i = 1;
    while i < n {
        let mut k = i;
        while spoke(k) {
            k += 3;
        }
        let count = (k - i) / 3;
        if count >= 3 {
            mask[i..k].fill(1);
        }
        if count > 0 {
            i = k - 1;
        }
        i += 1;
    }
    mask
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

    #[test]
    fn zigzag_is_satin() {
        let pts: Vec<(i32, i32)> = (0..10)
            .map(|i| (i * 4, if i % 2 == 0 { 0 } else { 30 }))
            .collect();
        let m = satin_mask(&records(&pts), MIN_LEN);
        assert_eq!(m[0], 0);
        assert!(m[1..].iter().all(|&v| v == 1));
        // Too narrow unless the shortest length is lowered.
        let narrow: Vec<(i32, i32)> = (0..10)
            .map(|i| (i, if i % 2 == 0 { 0 } else { 5 }))
            .collect();
        assert!(
            satin_mask(&records(&narrow), MIN_LEN)
                .iter()
                .all(|&v| v == 0)
        );
        assert_eq!(satin_mask(&records(&narrow), 3.0)[5], 1);
    }

    #[test]
    fn straight_run_is_not_satin() {
        let pts: Vec<(i32, i32)> = (0..10).map(|i| (i * 25, 0)).collect();
        assert!(satin_mask(&records(&pts), MIN_LEN).iter().all(|&v| v == 0));
        assert!(satin_mask(&records(&[]), MIN_LEN).is_empty());
    }

    #[test]
    fn blanket_stitch() {
        let mut pts = vec![(0, 0)];
        for k in 0..5 {
            let x = k * 20;
            pts.extend([(x, 30), (x, 0), (x + 20, 0)]);
        }
        let m = e_stitch_mask(&records(&pts));
        assert_eq!(m[1], 1);
        assert_eq!(m[0], 0);
        assert_eq!(m.iter().filter(|&&v| v == 1).count(), 15);
    }
}
