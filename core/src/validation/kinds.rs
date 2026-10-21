//! The kind of every stitch (satin, fill, running, tie) from the stitches alone, as stitchKinds in
//! src/model/sequence.ts with the fill row recognition of src/correct/structure.ts and the turning
//! points of src/correct/thin.ts. The checks need it for the gaps; model and correction keep their
//! TypeScript until their stages move, and then use this.

use super::satin::{MIN_LEN, e_stitch_mask, satin_mask};
use super::short_stitches::{TIE, tag_short_stitches};
use crate::js::hypot;
use crate::pattern::{Records, STITCH};

pub const RUNNING: u8 = 1;
pub const SATIN: u8 = 2;
pub const FILL: u8 = 3;
pub const TIE_STITCH: u8 = 4;

/// Narrow zigzags count as columns from this stitch length on (0.1 mm).
pub const ZIGZAG_MIN: f64 = 3.0;

/// A maximal sequence of consecutive STITCH records (start < end), sewn without jump or trim.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Run {
    pub start: usize,
    pub end: usize,
}

pub fn stitch_runs(p: &Records) -> Vec<Run> {
    let n = p.cmd.len();
    let mut runs = Vec::new();
    let mut s = 0;
    while s < n {
        if p.cmd[s] == STITCH {
            let mut e = s;
            while e + 1 < n && p.cmd[e + 1] == STITCH {
                e += 1;
            }
            if e > s {
                runs.push(Run { start: s, end: e });
            }
            s = e;
        }
        s += 1;
    }
    runs
}

/// Turning points of the stitch run [s, e], including both ends, at turns with cosine below `turn_cos`.
pub fn turning_points(p: &Records, s: usize, e: usize, turn_cos: f64) -> Vec<usize> {
    let mut t = vec![s];
    // Last point with a distinct position.
    let mut prev = s;
    for i in s + 1..e {
        let ix = (p.x[i] - p.x[prev]) as f64;
        let iy = (p.y[i] - p.y[prev]) as f64;
        if ix == 0.0 && iy == 0.0 {
            continue;
        }
        let mut next = i + 1;
        while next < e && p.x[next] == p.x[i] && p.y[next] == p.y[i] {
            next += 1;
        }
        let ox = (p.x[next] - p.x[i]) as f64;
        let oy = (p.y[next] - p.y[i]) as f64;
        if ox != 0.0 || oy != 0.0 {
            let cos = (ix * ox + iy * oy) / (hypot(ix, iy) * hypot(ox, oy));
            if cos < turn_cos {
                t.push(i);
            }
        }
        prev = i;
    }
    t.push(e);
    t
}

/// A fill row end: a turning point between rows of a fill sweep.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowEnd {
    pub at: usize,
    /// The other ends of the adjacent rows (one or two).
    pub rows: Vec<usize>,
    pub run: usize,
}

/// Shortest pass that counts as a fill row (0.1 mm).
const ROW_MIN: f64 = 10.0;
/// Rows of one sweep are at most this far apart (0.1 mm); sparser rows are underlay.
const ROW_SPACING_MAX: f64 = 10.0;
/// Adjacent rows run in opposite directions (cosine below this).
const ANTI_COS: f64 = -0.9;
/// Turns sharper than about 25 degrees end a pass.
const ROW_TURN_COS: f64 = 0.9;
/// A row is at most this much longer along its stitches than from end to end.
const ROW_ARC: f64 = 1.2;

/// Distance (0.1 mm) of record q from the line through records a and b.
fn line_dist(p: &Records, a: usize, b: usize, q: usize) -> f64 {
    let dx = (p.x[b] - p.x[a]) as f64;
    let dy = (p.y[b] - p.y[a]) as f64;
    let l = hypot(dx, dy);
    let l = if l == 0.0 { 1.0 } else { l };
    ((p.x[q] - p.x[a]) as f64 * dy - (p.y[q] - p.y[a]) as f64 * dx).abs() / l
}

/// The row ends of every fill: turning points next to at least one fill row. A pass between two
/// turning points is a row when it is at least 1 mm long, not satin, and a row in the opposite
/// direction runs at most 1 mm beside it.
pub fn fill_row_ends(p: &Records, runs: &[Run], mask: &[u8]) -> Vec<RowEnd> {
    let mut out = Vec::new();
    for (ri, r) in runs.iter().enumerate() {
        if r.end - r.start < 4 {
            continue;
        }
        let t = turning_points(p, r.start, r.end, ROW_TURN_COS);
        let is_row: Vec<bool> = (0..t.len())
            .map(|k| {
                if k + 1 >= t.len() {
                    return false;
                }
                let (a, b) = (t[k], t[k + 1]);
                let chord = p.dist(a, b);
                if chord < ROW_MIN {
                    return false;
                }
                // A long arc between two turns is a stretch of a ring, not a row.
                let mut along = 0.0;
                for i in a + 1..=b {
                    along += p.dist(i - 1, i);
                }
                if along > ROW_ARC * chord {
                    return false;
                }
                !(a + 1..=b).all(|i| mask[i] != 0)
            })
            .collect();
        let dir = |k: usize| {
            let l = p.dist(t[k], t[k + 1]);
            let l = if l == 0.0 { 1.0 } else { l };
            [
                (p.x[t[k + 1]] - p.x[t[k]]) as f64 / l,
                (p.y[t[k + 1]] - p.y[t[k]]) as f64 / l,
            ]
        };
        let row_at = |j: i64| j >= 0 && (j as usize) < is_row.len() && is_row[j as usize];
        // A row with an antiparallel neighbour row (directly next, or after one connector) close by.
        let in_sweep: Vec<bool> = (0..is_row.len())
            .map(|k| {
                if !is_row[k] {
                    return false;
                }
                let d = dir(k);
                let ki = k as i64;
                for j in [ki - 2, ki - 1, ki + 1, ki + 2] {
                    if !row_at(j) {
                        continue;
                    }
                    let e = dir(j as usize);
                    if d[0] * e[0] + d[1] * e[1] > ANTI_COS {
                        continue;
                    }
                    if line_dist(p, t[k], t[k + 1], t[j as usize]) <= ROW_SPACING_MAX {
                        return true;
                    }
                }
                false
            })
            .collect();
        for k in 1..t.len().saturating_sub(1) {
            let mut rows = Vec::new();
            if in_sweep[k - 1] {
                rows.push(t[k - 1]);
            }
            if in_sweep[k] {
                rows.push(t[k + 1]);
            }
            if !rows.is_empty() {
                out.push(RowEnd {
                    at: t[k],
                    rows,
                    run: ri,
                });
            }
        }
    }
    out
}

/// Kind of the stitch ending at each record (0 where no stitch ends): satin columns, fill rows,
/// tie-in and tie-off stitches, and running stitch for everything else.
pub fn stitch_kinds(p: &Records) -> Vec<u8> {
    let n = p.cmd.len();
    let mut out = vec![0u8; n];
    let satin = satin_mask(p, MIN_LEN);
    // Narrow satin outlines count as satin too, down to 0.3 mm wide.
    let narrow = satin_mask(p, ZIGZAG_MIN);
    let runs = stitch_runs(p);
    let blanket = e_stitch_mask(p);
    for i in 1..n {
        if p.cmd[i] == STITCH && p.cmd[i - 1] == STITCH {
            out[i] = if narrow[i] != 0 || blanket[i] != 0 {
                SATIN
            } else {
                RUNNING
            };
        }
    }
    for e in fill_row_ends(p, &runs, &satin) {
        for &r in &e.rows {
            let (a, b) = (e.at.min(r), e.at.max(r));
            for k in out[a + 1..=b].iter_mut() {
                if *k == RUNNING {
                    *k = FILL;
                }
            }
        }
    }
    let tags = tag_short_stitches(p);
    for i in 0..n {
        if tags[i] == TIE && out[i] != 0 {
            out[i] = TIE_STITCH;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pattern::JUMP;

    fn records(pts: &[(i32, i32)]) -> Records {
        Records {
            x: pts.iter().map(|p| p.0).collect(),
            y: pts.iter().map(|p| p.1).collect(),
            cmd: vec![STITCH; pts.len()],
            colors: vec![],
        }
    }

    #[test]
    fn runs_split_at_jumps() {
        let mut p = records(&[(0, 0), (10, 0), (20, 0), (30, 0), (40, 0)]);
        p.cmd[2] = JUMP;
        assert_eq!(
            stitch_runs(&p),
            vec![Run { start: 0, end: 1 }, Run { start: 3, end: 4 }]
        );
        p.cmd[2] = STITCH;
        assert_eq!(stitch_runs(&p), vec![Run { start: 0, end: 4 }]);
    }

    #[test]
    fn turning_points_of_a_zigzag() {
        let p = records(&[(0, 0), (50, 0), (50, 4), (0, 4), (0, 8)]);
        assert_eq!(turning_points(&p, 0, 4, 0.5), vec![0, 1, 2, 3, 4]);
        let straight = records(&[(0, 0), (10, 0), (20, 1), (30, 0)]);
        assert_eq!(turning_points(&straight, 0, 3, 0.5), vec![0, 3]);
    }

    #[test]
    fn fill_rows_are_fill() {
        // Rows 5 mm long, 0.4 mm apart, with connectors; split in two stitches each.
        let mut pts = vec![];
        for k in 0..12 {
            let y = k * 4;
            if k % 2 == 0 {
                pts.extend([(0, y), (25, y), (50, y)]);
            } else {
                pts.extend([(50, y), (25, y), (0, y)]);
            }
        }
        let kinds = stitch_kinds(&records(&pts));
        let fill = kinds.iter().filter(|&&k| k == FILL).count();
        assert!(fill >= 20, "{kinds:?}");
        // The connectors between rows stay running stitch.
        assert_eq!(kinds[3], RUNNING);
        assert_eq!(kinds[0], 0);
    }

    #[test]
    fn satin_column_is_satin() {
        let pts: Vec<(i32, i32)> = (0..20)
            .map(|i| (i * 4, if i % 2 == 0 { 0 } else { 30 }))
            .collect();
        let kinds = stitch_kinds(&records(&pts));
        assert!(kinds[1..].iter().all(|&k| k == SATIN));
    }
}
