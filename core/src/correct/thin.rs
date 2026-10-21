//! Row thinning without object information (src/correct/thin.ts).
//!
//! Fills and satins are both sweeps: the needle runs across the shape, turns, and comes back one
//! spacing further on. Inside a run of stitches, the points where the direction turns by more than
//! 60 degrees are its turning points. Their sequence is periodic: in a satin every second turning
//! point lies on the same edge (period 2), in a fill whose rows are joined by a short connector
//! stitch every fourth one does (period 4), and a fill without connectors has period 2 again.
//!
//! Removing one period's worth of turning points removes one "cycle" (two rows of a fill, one zig
//! and one zag of a satin) and joins the remaining ends with a single short stitch, which is either
//! along the edge ("edge" removal) or across like the neighbouring rows ("cross" removal). Removing
//! every k-th cycle lowers the thread per area of that sweep by 1/k. Doing this only where the
//! density is too high is the only automatic fix that really lowers it: nudging penetrations apart
//! keeps the thread length per area the same.

use super::structure::turning_points;
use crate::js::hypot;
use crate::pattern::{Records, STITCH};

/// Turning points closer than this to their counterpart one period later (0.1 mm) count as periodic.
const GAP_MAX: f64 = 20.0;
/// Passes must be at least as long as the period gap to count as a sweep (narrow zigzags qualify).
const PASS_TO_GAP: f64 = 1.0;
/// Minimum average pass length (0.1 mm).
const PASS_MIN: f64 = 3.0;
/// Direction change (cosine) at which a stitch point becomes a turning point.
pub const TURN_COS: f64 = 0.5;
/// A cross removal must keep the direction of the row it replaces.
const CROSS_COS: f64 = 0.9;
/// By default at least this share of the thread removed must lie where thinning is asked for.
pub const MIN_SHARE: f64 = 0.6;

pub struct ThinOptions<'a> {
    /// Share of cycles (0 to 1) to remove around each record; 0 where nothing should change.
    pub need: &'a [f64],
    /// Records that must never be removed (tie-in and tie-off stitches).
    pub protect: Option<&'a [u8]>,
    /// Share of a removal's thread that must lie where `need` is positive.
    pub min_share: f64,
    /// Count a stitch as asked for only if `need` is positive at both of its ends (else: either).
    pub strict: bool,
}

pub struct ThinResult {
    /// 1 for every record to remove.
    pub remove: Vec<u8>,
    pub removed: usize,
    /// Cycles (row pairs, zigzag pairs) removed.
    pub cycles: usize,
}

struct Candidate {
    /// Index in the turning point list of the kept end of the new stitch.
    end: usize,
    need: f64,
    period: usize,
}

/// The first valid removal starting at turning point k: cross and edge variants, period 2 then 4.
/// None if the neighbourhood is not a periodic sweep or nothing should change.
fn candidate(
    p: &Records,
    t: &[usize],
    k: usize,
    removed: &[u8],
    o: &ThinOptions,
) -> Option<Candidate> {
    let a = t[k];
    for period in [2usize, 4] {
        // Periodic neighbourhood: this turning point and at least one of its counterparts one
        // period before or after lie close to the point one period further on. Real fills mix
        // connector rows and direct turns, so not every neighbour has to match.
        if k + period >= t.len() || p.dist(a, t[k + period]) > GAP_MAX {
            continue;
        }
        let mut others = 0;
        let mut matching = 0;
        for j in [k as i64 - period as i64, (k + period) as i64] {
            if j < 0 || j as usize + period >= t.len() {
                continue;
            }
            let j = j as usize;
            others += 1;
            if p.dist(t[j], t[j + period]) <= GAP_MAX {
                matching += 1;
            }
        }
        if others > 0 && matching == 0 {
            continue;
        }
        let gap = p.dist(a, t[k + period]);
        let mut passes = 0.0;
        let mut j = k;
        while j < k + period && j + 1 < t.len() {
            passes += p.dist(t[j], t[j + 1]);
            j += 1;
        }
        passes /= period as f64;
        if passes < PASS_MIN || passes < PASS_TO_GAP * gap {
            continue;
        }

        for cross in [true, false] {
            let end_k = k + period + usize::from(cross);
            if end_k >= t.len() {
                continue;
            }
            let b = t[end_k];
            let new_len = p.dist(a, b);
            let mut thread = 0.0;
            let mut wanted = 0.0;
            let mut need_sum = 0.0;
            let mut longest = 0.0;
            let mut ok = true;
            for r in a + 1..=b {
                if r < b && (removed[r] != 0 || o.protect.is_some_and(|pr| pr[r] != 0)) {
                    ok = false;
                    break;
                }
                let len = p.dist(r - 1, r);
                let n0 = o.need[r - 1];
                let n1 = o.need[r];
                let need = (n0 + n1) / 2.0;
                thread += len;
                if if o.strict {
                    n0 > 0.0 && n1 > 0.0
                } else {
                    need > 0.0
                } {
                    wanted += len;
                }
                need_sum += need * len;
                if len > longest {
                    longest = len;
                }
            }
            if !ok || thread <= 0.0 {
                continue;
            }
            if wanted < o.min_share * thread {
                // Mostly outside the area to thin.
                return None;
            }
            if thread - new_len < 0.5 * thread {
                // Saves too little.
                continue;
            }
            if cross {
                if new_len > longest + gap {
                    continue;
                }
                let rx = (p.x[t[k + 1]] - p.x[a]) as f64;
                let ry = (p.y[t[k + 1]] - p.y[a]) as f64;
                let den = new_len * hypot(rx, ry);
                let den = if den == 0.0 || den.is_nan() { 1.0 } else { den };
                let cos = ((p.x[b] - p.x[a]) as f64 * rx + (p.y[b] - p.y[a]) as f64 * ry) / den;
                if cos < CROSS_COS {
                    continue;
                }
            } else if new_len <= 0.0 || new_len > GAP_MAX {
                continue;
            }
            // The need where thinning is asked for; the share rule above limits how far out it reaches.
            return Some(Candidate {
                end: end_k,
                need: need_sum / wanted,
                period,
            });
        }
    }
    None
}

/// Removes cycles from periodic sweeps where `need` asks for it, spreading the removals evenly so
/// that a need of 0.33 removes every third cycle. Only STITCH records are removed; the first and
/// last stitch of every run stay, so jumps, trims and color changes keep their anchors.
pub fn thin_sweeps(p: &Records, o: &ThinOptions) -> ThinResult {
    let n = p.cmd.len();
    let mut removed = vec![0u8; n];
    let mut cycles = 0;
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
        if e - s >= 4 {
            let t = turning_points(p, s, e, TURN_COS);
            let mut credit = 0.5;
            let mut k = 0;
            while k + 2 < t.len() {
                let Some(c) = candidate(p, &t, k, &removed, o) else {
                    k += 1;
                    continue;
                };
                // Each turning point is 1/period of a cycle; removing a cycle also passes over its
                // own turning points, so it earns their share before paying for itself.
                let need = c.need.min(1.0);
                credit = (credit + need / c.period as f64).min(1.5);
                if credit >= 1.0 {
                    for r in t[k] + 1..t[c.end] {
                        removed[r] = 1;
                    }
                    cycles += 1;
                    credit += need - 1.0;
                    k = c.end;
                } else {
                    k += 1;
                }
            }
        }
        s = e + 1;
    }
    let count = removed.iter().filter(|&&v| v != 0).count();
    ThinResult {
        remove: removed,
        removed: count,
        cycles,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fill of `rows` rows from x 0 to `w`, `sp` apart, stitches every 30 (0.1 mm).
    pub(crate) fn fill(rows: i32, w: i32, sp: i32) -> Records {
        let mut p = Records::default();
        for r in 0..rows {
            let y = r * sp;
            let xs: Vec<i32> = (0..=w / 30).map(|k| k * 30).chain([w]).collect();
            let xs: Vec<i32> = if r % 2 == 0 {
                xs
            } else {
                xs.into_iter().rev().collect()
            };
            for x in xs {
                if p.x.last() == Some(&x) && p.y.last() == Some(&y) {
                    continue;
                }
                p.x.push(x);
                p.y.push(y);
                p.cmd.push(STITCH);
            }
        }
        p
    }

    #[test]
    fn half_the_cycles_go() {
        let p = fill(20, 200, 4);
        let need = vec![0.5; p.cmd.len()];
        let r = thin_sweeps(
            &p,
            &ThinOptions {
                need: &need,
                protect: None,
                min_share: MIN_SHARE,
                strict: false,
            },
        );
        assert!(r.cycles >= 4 && r.cycles <= 5, "{}", r.cycles);
        assert!(r.removed > 0);
        let none = vec![0.0; p.cmd.len()];
        let r = thin_sweeps(
            &p,
            &ThinOptions {
                need: &none,
                protect: None,
                min_share: MIN_SHARE,
                strict: false,
            },
        );
        assert_eq!(r.removed, 0);
    }
}
