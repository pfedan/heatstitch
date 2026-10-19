//! Stitches hidden under later stitching (hiddenStitches in src/correct/auto.ts).

use super::cover::walk_covered;
use super::structure::stitch_runs;
use crate::js::hypot;
use crate::pattern::{Bounds, Records, STITCH};
use crate::validation::satin::{MIN_LEN, satin_mask};

/// Later thread per area (mm/mm²) from which a stitch counts as hidden: a full fill layer.
const HIDDEN_COVER: f64 = 2.2;

/// Records whose stitches in and out lie completely and well inside at least one full layer of
/// later stitching, checked every 0.1 mm along them. A row that crosses a visible gap between two
/// outlines is not hidden, even if both of its ends are. `b` are the design's bounds.
pub fn hidden_stitches(p: &Records, b: Bounds) -> Vec<u8> {
    let n = p.cmd.len();
    // Segment ending at i.
    let mut covered = vec![0u8; n];
    let runs = stitch_runs(p);
    let mask = satin_mask(p, MIN_LEN);
    let mut work = p.clone();
    walk_covered(&mut work, b, &runs, &mask, |p, r, cover| {
        // Deep inside the cover: also 0.4 mm to every side.
        let deep = |x: f64, y: f64| {
            cover.later(x, y) >= HIDDEN_COVER
                && cover.later(x + 4.0, y) >= HIDDEN_COVER
                && cover.later(x - 4.0, y) >= HIDDEN_COVER
                && cover.later(x, y + 4.0) >= HIDDEN_COVER
                && cover.later(x, y - 4.0) >= HIDDEN_COVER
        };
        for i in runs[r].start + 1..=runs[r].end {
            let dx = (p.x[i] - p.x[i - 1]) as f64;
            let dy = (p.y[i] - p.y[i - 1]) as f64;
            let k = hypot(dx, dy).ceil().max(1.0);
            let (x0, y0) = (p.x[i - 1] as f64, p.y[i - 1] as f64);
            let mut ok = true;
            let mut j = 0.0;
            while j <= k && ok {
                ok = deep(x0 + (dx * j) / k, y0 + (dy * j) / k);
                j += 1.0;
            }
            if ok {
                covered[i] = 1;
            }
        }
    });
    let mut hidden = vec![0u8; n];
    for i in 0..n {
        if p.cmd[i] != STITCH {
            continue;
        }
        let in_ok = i == 0 || p.cmd[i - 1] != STITCH || covered[i] != 0;
        let out_ok = i + 1 >= n || p.cmd[i + 1] != STITCH || covered[i + 1] != 0;
        if in_ok && out_ok && (covered[i] != 0 || (i + 1 < n && covered[i + 1] != 0)) {
            hidden[i] = 1;
        }
    }
    hidden
}
