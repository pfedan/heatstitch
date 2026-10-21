//! Stitches without movement and chains of tiny stitches (src/correct/shorts.ts). Both give the
//! records to remove; removing them (and tidying) stays with the caller.

use crate::js::hypot;
use crate::pattern::{Records, STITCH};
use crate::validation::short_stitches::{SHORT, SHORT_STITCH_MM, tag_short_stitches};

/// Merged stitches may deviate at most this far (0.1 mm) from the original path.
const MERGE_TOLERANCE: f64 = 3.0;
/// Merging never creates a stitch longer than this (0.1 mm).
const MERGE_MAX_LEN: f64 = 70.0;

/// Stitches that do not move (same position as the stitch before) where `wanted` is set. They add
/// a second penetration into the same hole and nothing else, so removing them never changes the
/// stitch-out.
pub fn zero_length(p: &Records, wanted: &[u8]) -> (Vec<u8>, usize) {
    let mut remove = vec![0u8; p.cmd.len()];
    let mut count = 0;
    for i in 1..p.cmd.len() {
        if p.cmd[i] == STITCH
            && p.cmd[i - 1] == STITCH
            && p.x[i] == p.x[i - 1]
            && p.y[i] == p.y[i - 1]
            && wanted[i] != 0
        {
            remove[i] = 1;
            count += 1;
        }
    }
    (remove, count)
}

/// Distance (0.1 mm) of point q from the segment a-b.
fn deviation(ax: f64, ay: f64, bx: f64, by: f64, qx: f64, qy: f64) -> f64 {
    let dx = bx - ax;
    let dy = by - ay;
    let l2 = dx * dx + dy * dy;
    let t = if l2 != 0.0 {
        (((qx - ax) * dx + (qy - ay) * dy) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    hypot(ax + t * dx - qx, ay + t * dy - qy)
}

/// Chains of short stitches (the ones the short-stitch rule counts, tie stitches excluded) merged
/// where `wanted` is set: a stitch point is dropped while the stitch from the last kept point stays
/// shorter than SHORT_STITCH_MM, every dropped point stays within MERGE_TOLERANCE of the new
/// stitch, and the new stitch stays below MERGE_MAX_LEN. Tight curves of running stitch get coarser
/// but keep their shape; narrow zigzag columns are left alone (their points deviate too far) and
/// are thinned instead.
pub fn merge_short(p: &Records, wanted: &[u8]) -> (Vec<u8>, usize) {
    let tags = tag_short_stitches(p);
    let n = p.cmd.len();
    let mut remove = vec![0u8; n];
    let min_len = SHORT_STITCH_MM * 10.0;
    let mut count = 0;
    let at = |i: usize| (p.x[i] as f64, p.y[i] as f64);
    let mut s = 0;
    while s < n {
        if p.cmd[s] != STITCH {
            s += 1;
            continue;
        }
        let mut e = s;
        while e + 1 < n && p.cmd[e + 1] == STITCH {
            e += 1;
        }
        let mut anchor = s;
        let mut dropped: Vec<usize> = vec![];
        for i in s + 1..e {
            let (ax, ay) = at(anchor);
            let (nx, ny) = at(i + 1);
            let ok = tags[i] == SHORT
                && wanted[i] != 0
                && hypot((p.x[i] - p.x[anchor]) as f64, (p.y[i] - p.y[anchor]) as f64) < min_len
                && hypot(nx - ax, ny - ay) <= MERGE_MAX_LEN
                && dropped.iter().chain([&i]).all(|&q| {
                    let (qx, qy) = at(q);
                    deviation(ax, ay, nx, ny, qx, qy) <= MERGE_TOLERANCE
                });
            if ok {
                dropped.push(i);
                remove[i] = 1;
                count += 1;
            } else {
                anchor = i;
                dropped.clear();
            }
        }
        s = e + 1;
    }
    (remove, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(pts: &[(i32, i32)]) -> Records {
        Records {
            x: pts.iter().map(|p| p.0).collect(),
            y: pts.iter().map(|p| p.1).collect(),
            cmd: vec![STITCH; pts.len()],
            colors: vec![],
        }
    }

    #[test]
    fn zero_length_stitches_go() {
        let p = line(&[(0, 0), (30, 0), (30, 0), (60, 0)]);
        let (r, n) = zero_length(&p, &[1; 4]);
        assert_eq!(n, 1);
        assert_eq!(r, vec![0, 0, 1, 0]);
    }

    #[test]
    fn tiny_stitches_merge() {
        let mut pts = vec![(0, 0), (20, 0), (40, 0)];
        for k in 1..=10 {
            pts.push((40 + 4 * k, 0));
        }
        pts.extend([(110, 0), (130, 0), (150, 0)]);
        let p = line(&pts);
        let (_, n) = merge_short(&p, &vec![1; p.cmd.len()]);
        assert!(n > 0);
    }
}
