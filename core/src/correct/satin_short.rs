//! Short stitches on the inside of satin curves and corners (src/correct/satinShort.ts).
//!
//! Where a satin column turns, its inner edge is shorter than the outer one, so the penetrations
//! there crowd together: thread piles up and the holes can cut the fabric. Digitizing programs
//! counter this with "short stitches": every second stitch on the crowded side stops short of the
//! edge. The outline stays closed (the full-length stitches still reach it) and the inner edge gets
//! half the penetrations.

use super::structure::{satin_columns, stitch_runs};
use super::sync_marks;
use crate::js::{hypot, round};
use crate::pattern::Records;
use crate::validation::satin::{MIN_LEN, satin_mask};

/// A side counts as crowded where its spacing is below this share of the opposite side's.
const CROWDED: f64 = 0.5;
/// Short stitches end this share of the column width before the edge.
const SHORTEN: f64 = 0.25;

/// New positions with the crowded penetrations moved where `wanted` is set, and how many moved.
pub fn shorten_satin_curves(p: &Records, wanted: &[u8]) -> (Vec<i32>, Vec<i32>, usize) {
    let mut x = p.x.clone();
    let mut y = p.y.clone();
    let d = |a: usize, b: usize| hypot((p.x[b] - p.x[a]) as f64, (p.y[b] - p.y[a]) as f64);
    let mut moved = 0;
    let runs = stitch_runs(p);
    for c in satin_columns(&runs, &satin_mask(p, MIN_LEN)) {
        let (start, end) = (c.start, c.end);
        if end - start < 6 {
            continue;
        }
        // Same-side spacing around each penetration.
        let mut sp = vec![0.0; end - start + 1];
        for k in start..=end {
            let mut s = 0.0;
            let mut n = 0;
            if k >= start + 2 {
                s += d(k - 2, k);
                n += 1;
            }
            if k + 2 <= end {
                s += d(k, k + 2);
                n += 1;
            }
            sp[k - start] = if n > 0 { s / n as f64 } else { 0.0 };
        }
        for k in start + 1..end {
            // Every second penetration of a side; the others keep the edge closed.
            if ((k - start) >> 1) % 2 == 0 {
                continue;
            }
            let opposite = (sp[k - 1 - start] + sp[k + 1 - start]) / 2.0;
            if sp[k - start] >= CROWDED * opposite || wanted[k] == 0 {
                continue;
            }
            let tx = (p.x[k - 1] as f64 + p.x[k + 1] as f64) / 2.0;
            let ty = (p.y[k - 1] as f64 + p.y[k + 1] as f64) / 2.0;
            x[k] = round(p.x[k] as f64 + (tx - p.x[k] as f64) * SHORTEN) as i32;
            y[k] = round(p.y[k] as f64 + (ty - p.y[k] as f64) * SHORTEN) as i32;
            if x[k] != p.x[k] || y[k] != p.y[k] {
                moved += 1;
            }
        }
    }
    if moved > 0 {
        sync_marks(&mut x, &mut y, &p.cmd);
    }
    (x, y, moved)
}
