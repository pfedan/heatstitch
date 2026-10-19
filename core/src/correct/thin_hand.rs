//! Thinning out by hand (Ausdünnen in the stitch editor, src/correct/thinHand.ts): fewer stitches
//! where they are selected, the shape staying covered as before.
//!
//! Rows (of a fill) and zigzags (of a satin) are sweeps: passes back and forth, one spacing apart.
//! They are made looser the way any digitizing program does it, by sewing them at a wider spacing:
//! the passes are laid anew, evenly spread between the first and the last selected one. Each new
//! pass lies between two neighbouring old ones that run the same way (blended along their length),
//! so its ends stay on the edge the old ends trace and its penetrations follow theirs. Taking out
//! whole passes instead (as the correction does where it only has to lower the density) would leave
//! a stripe of three spacings for every pair.
//!
//! A line (running stitch) is made looser by longer stitches: every so many of its penetrations are
//! taken out, evenly spread, where the line stays within LINE_TOLERANCE without it and the stitch
//! does not grow beyond LINE_MAX. Lines that go back over themselves (triple and bean stitch) stay.

use super::structure::turning_points;
use crate::geom::Pt;
use crate::js::{IdMap, hypot, round};
use crate::pattern::{Records, STITCH};

/// Direction change (cosine) below which a point is a turning point of a sweep.
const TURN_COS: f64 = 0.5;
/// Neighbouring passes of a sweep run against each other at least this much (cosine).
const ANTI_COS: f64 = -0.5;
/// The next pass starts at most this far from where the one before ended (0.1 mm).
const GAP_MAX: f64 = 20.0;
/// Penetrations this close (0.1 mm) are the same.
const SAME: f64 = 1.0;
/// Passes shorter than this are no passes (0.1 mm).
const PASS_MIN: f64 = 3.0;
/// A line keeps to its path within this (0.1 mm).
const LINE_TOLERANCE: f64 = 2.0;
/// Longest stitch a thinned line gets (0.1 mm).
const LINE_MAX: f64 = 50.0;
/// A line counts as going on (not back over itself) while it turns by less than this (cosine).
const LINE_COS: f64 = 0.0;

/// A pass of a sweep: its records from the turning point it starts at to the one it ends at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pass {
    pub s: usize,
    pub e: usize,
}

fn len(p: &Records, a: usize, b: usize) -> f64 {
    hypot((p.x[b] - p.x[a]) as f64, (p.y[b] - p.y[a]) as f64)
}

/// Whether most penetrations inside pass `b` lie on penetrations of pass `a` (sewn back over it).
fn overlays(p: &Records, a: Pass, b: Pass) -> bool {
    let mut on = 0;
    for i in b.s + 1..b.e {
        if (a.s..=a.e).any(|j| len(p, i, j) <= SAME) {
            on += 1;
        }
    }
    on > 0 && 2 * on + 1 >= b.e - b.s
}

/// The sweeps of the stitch run [s, e]: runs of passes back and forth, each as its passes.
pub fn sweeps(p: &Records, s: usize, e: usize) -> Vec<Vec<Pass>> {
    let t = turning_points(p, s, e, TURN_COS);
    let mut out = vec![];
    let mut cur: Vec<Pass> = vec![];
    let close = |cur: &mut Vec<Pass>, out: &mut Vec<Vec<Pass>>| {
        if cur.len() >= 3 {
            out.push(std::mem::take(cur));
        }
        cur.clear();
    };
    let mut k = 0;
    while k + 1 < t.len() {
        let pass = Pass {
            s: t[k],
            e: t[k + 1],
        };
        let l = len(p, pass.s, pass.e);
        if l < PASS_MIN {
            // A stitch in place.
            k += 1;
            continue;
        }
        // A connector: a short stitch along the edge between two rows much longer than it.
        let before = if k > 0 {
            len(p, t[k - 1], t[k])
        } else {
            f64::INFINITY
        };
        let after = if k + 2 < t.len() {
            len(p, t[k + 1], t[k + 2])
        } else {
            f64::INFINITY
        };
        if l <= GAP_MAX && 2.0 * l < before.min(after) {
            k += 1;
            continue;
        }
        if let Some(&prev) = cur.last() {
            // Joined at one edge (straight or by a connector), and close to it at the other edge
            // too: where the rows end elsewhere (around a notch), they are no longer neighbours.
            let joined = (pass.s == prev.e
                || (k > 0 && t[k - 1] == prev.e && len(p, prev.e, pass.s) <= GAP_MAX))
                && len(p, prev.s, pass.e) <= GAP_MAX;
            let ax = (p.x[prev.e] - p.x[prev.s]) as f64;
            let ay = (p.y[prev.e] - p.y[prev.s]) as f64;
            let bx = (p.x[pass.e] - p.x[pass.s]) as f64;
            let by = (p.y[pass.e] - p.y[pass.s]) as f64;
            let cos = (ax * bx + ay * by) / (hypot(ax, ay) * hypot(bx, by));
            // A pass back onto the one before it (a triple or bean stitch line) is no sweep.
            let apart = !overlays(p, prev, pass);
            if !joined || cos > ANTI_COS || !apart {
                close(&mut cur, &mut out);
            }
        }
        cur.push(pass);
        k += 1;
    }
    close(&mut cur, &mut out);
    out
}

/// Where along pass `q` (0 to 1 of its length) each of its penetrations lies, and the point at a share.
struct Along {
    s: usize,
    at: Vec<f64>,
    total: f64,
}

impl Along {
    fn new(p: &Records, q: Pass) -> Along {
        let mut at = vec![0.0];
        for i in q.s + 1..=q.e {
            let l = at[at.len() - 1] + len(p, i - 1, i);
            at.push(l);
        }
        let total = at[at.len() - 1];
        let total = if total == 0.0 { 1.0 } else { total };
        Along { s: q.s, at, total }
    }

    fn shares(&self) -> Vec<f64> {
        self.at.iter().map(|d| d / self.total).collect()
    }

    fn point(&self, p: &Records, f: f64) -> Pt {
        let d = f * self.total;
        let mut k = 1;
        while k < self.at.len() - 1 && self.at[k] < d {
            k += 1;
        }
        let span = self.at[k] - self.at[k - 1];
        let span = if span == 0.0 { 1.0 } else { span };
        let u = ((d - self.at[k - 1]) / span).clamp(0.0, 1.0);
        let a = self.s + k - 1;
        [
            p.x[a] as f64 + (p.x[a + 1] - p.x[a]) as f64 * u,
            p.y[a] as f64 + (p.y[a + 1] - p.y[a]) as f64 * u,
        ]
    }
}

/// Lays passes first..last of `rows` anew as `m + 1` passes (m of the same parity as last - first),
/// the first and last staying where they are. Returns the points from after the first pass's end
/// up to and including the last pass's start.
fn respread(p: &Records, rows: &[Pass], first: usize, last: usize, m: usize) -> Vec<[i32; 2]> {
    let n = last - first;
    let mut pts = vec![];
    let straight = |q: usize| q > 0 && rows[q].s == rows[q - 1].e;
    for j in 1..m {
        let u = (j * n) as f64 / m as f64;
        // The old passes on either side that run the same way as this one.
        let mut a = u.floor() as i64;
        if (a - j as i64) % 2 != 0 {
            a -= 1;
        }
        let a = a as usize;
        let b = (a + 2).min(n);
        let f = if b > a {
            (u - a as f64) / (b - a) as f64
        } else {
            0.0
        };
        let pa_ = Along::new(p, rows[first + a]);
        let pb_ = Along::new(p, rows[first + b]);
        // Its penetrations where the nearer old pass has them. Passes that turn straight into the
        // next one (a satin) share that point: each starts where the one before ended, and the last
        // ends where the last pass kept starts.
        let near = first + if f < 0.5 { a } else { b };
        let shares = if f < 0.5 { pa_.shares() } else { pb_.shares() };
        let from = usize::from(straight(near));
        let to = if j == m - 1 && straight(last) {
            shares.len().saturating_sub(1)
        } else {
            shares.len()
        };
        for &g in shares.get(from..to.max(from)).unwrap_or(&[]) {
            let pa = pa_.point(p, g);
            let pb = pb_.point(p, g);
            pts.push([
                round(pa[0] + (pb[0] - pa[0]) * f) as i32,
                round(pa[1] + (pb[1] - pa[1]) * f) as i32,
            ]);
        }
    }
    pts.push([p.x[rows[last].s], p.y[rows[last].s]]);
    pts
}

/// Distance from point i to the segment a-b (0.1 mm).
fn off_line(p: &Records, i: usize, a: usize, b: usize) -> f64 {
    let vx = (p.x[b] - p.x[a]) as f64;
    let vy = (p.y[b] - p.y[a]) as f64;
    let l2 = vx * vx + vy * vy;
    let t = if l2 != 0.0 {
        (((p.x[i] - p.x[a]) as f64 * vx + (p.y[i] - p.y[a]) as f64 * vy) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    hypot(
        p.x[i] as f64 - (p.x[a] as f64 + vx * t),
        p.y[i] as f64 - (p.y[a] as f64 + vy * t),
    )
}

pub struct HandThin {
    /// Positions with the new passes laid (before the removal).
    pub x: Vec<i32>,
    pub y: Vec<i32>,
    /// 1 for each record of the input that goes.
    pub mask: Vec<u8>,
    /// Stitch records removed.
    pub removed: usize,
}

/// Thins where `need` (per record, the share of stitches to take out) is positive; `protect`
/// marks records that must never be removed or moved (tie-in and tie-off stitches).
pub fn thin_by_hand(p: &Records, need: &[f64], protect: Option<&[u8]>) -> HandThin {
    let n = p.cmd.len();
    let mut mask = vec![0u8; n];
    let mut x = p.x.clone();
    let mut y = p.y.clone();
    let fixed =
        |i: usize| p.cmd[i] != STITCH || protect.is_some_and(|pr| pr[i] != 0) || need[i] <= 0.0;
    let mut in_sweep = vec![0u8; n];
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
        // Rows and zigzags: each stretch of selected passes spread anew at a wider spacing.
        for rows in sweeps(p, s, e) {
            for q in &rows {
                in_sweep[q.s..=q.e].fill(1);
            }
            // A pass takes part when none of its points is held; the stretch is kept by its ends.
            let free = |q: Pass| (q.s..=q.e).all(|i| !fixed(i));
            let mut k = 0;
            while k < rows.len() {
                if !free(rows[k]) {
                    k += 1;
                    continue;
                }
                let mut l = k;
                while l + 1 < rows.len() && free(rows[l + 1]) {
                    l += 1;
                }
                let span = l - k;
                let mut nd = 0.0;
                for i in rows[k].s..=rows[l].e {
                    nd += need[i];
                }
                nd /= (rows[l].e - rows[k].s + 1) as f64;
                let mut m = round(span as f64 * (1.0 - nd.min(1.0))) as i64;
                if (span as i64 - m) % 2 != 0 {
                    m += 1;
                }
                if m >= 1 && (m as usize) < span {
                    let pts = respread(p, &rows, k, l, m as usize);
                    let from = rows[k].e + 1;
                    let old = rows[l].s + 1 - from;
                    if pts.len() <= old {
                        // The new passes take the first records; the last new point is the last
                        // pass's start (where it was), and the records left over go.
                        for i in 0..pts.len() - 1 {
                            x[from + i] = pts[i][0];
                            y[from + i] = pts[i][1];
                        }
                        mask[from + pts.len() - 1..rows[l].s].fill(1);
                    }
                }
                k = l + 1;
            }
        }
        // Lines: every so many penetrations out, where the line keeps its path without them. A
        // line sewn back over itself (triple, bean stitch) takes out the same penetrations on every
        // pass.
        let mut credit = 0.5;
        // The point kept last.
        let mut last = s;
        let mut decided: IdMap<(i32, i32), bool> = IdMap::default();
        for i in s + 1..e {
            let key = (p.x[i], p.y[i]);
            let ok =
                in_sweep[i] == 0 && in_sweep[i - 1] == 0 && in_sweep[i + 1] == 0 && !fixed(i) && {
                    let ax = (p.x[i] - p.x[i - 1]) as f64;
                    let ay = (p.y[i] - p.y[i - 1]) as f64;
                    let bx = (p.x[i + 1] - p.x[i]) as f64;
                    let by = (p.y[i + 1] - p.y[i]) as f64;
                    let l = hypot(ax, ay) * hypot(bx, by);
                    // It turns here.
                    if l == 0.0
                        || (ax * bx + ay * by) / l <= LINE_COS
                        || len(p, last, i + 1) > LINE_MAX
                    {
                        false
                    } else {
                        (last + 1..=i).all(|r| off_line(p, r, last, i + 1) <= LINE_TOLERANCE)
                    }
                };
            let mut out = false;
            if ok {
                if let Some(&before) = decided.get(&key) {
                    out = before;
                } else {
                    credit += need[i];
                    out = credit >= 1.0;
                    if out {
                        credit -= 1.0;
                    }
                }
            }
            decided.entry(key).or_insert(out);
            if out {
                mask[i] = 1;
            } else {
                last = i;
            }
        }
        s = e + 1;
    }
    let removed = (0..n)
        .filter(|&i| mask[i] != 0 && p.cmd[i] == STITCH)
        .count();
    HandThin {
        x,
        y,
        mask,
        removed,
    }
}
