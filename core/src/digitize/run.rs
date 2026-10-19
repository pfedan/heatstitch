//! Running stitch along a line: simplification, even stitches and shorter ones on curves.

use crate::geom::{Pt, to_segment};
use crate::js::{dist, hypot};

/// How far a stitch may lie from the line it follows by default (mm): a straight stitch cuts every
/// curve, by L² / 8R for a stitch of length L on a radius R. Below a third of the thread's width
/// the cut does not show.
pub const TOLERANCE: f64 = 0.15;
/// Stitches shortened for a curve stay at least this long (mm); shorter ones are short-stitch findings.
pub const MIN_CURVE_STITCH: f64 = 1.0;
/// The same for the rows of a fill, a little above: needle points are rounded to 0.1 mm in the file,
/// which made a stitch of exactly 1 mm as often 0.9 mm, and rows 0.2 mm apart around the eye of a
/// swirl clustered them.
pub const MIN_ROW_STITCH: f64 = 1.15;

/// Douglas-Peucker simplification with tolerance `tol` (mm).
pub fn simplify(pts: &[Pt], tol: f64) -> Vec<Pt> {
    if pts.len() < 3 {
        return pts.to_vec();
    }
    let mut keep = vec![false; pts.len()];
    keep[0] = true;
    keep[pts.len() - 1] = true;
    let mut stack = vec![(0, pts.len() - 1)];
    while let Some((a, b)) = stack.pop() {
        let [ax, ay] = pts[a];
        let dx = pts[b][0] - ax;
        let dy = pts[b][1] - ay;
        let l = hypot(dx, dy);
        let mut best = None;
        let mut bd = tol;
        for i in a + 1..b {
            let d = if l > 0.0 {
                ((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx).abs() / l
            } else {
                dist(pts[i], pts[a])
            };
            if d > bd {
                bd = d;
                best = Some(i);
            }
        }
        if let Some(best) = best {
            keep[best] = true;
            stack.push((a, best));
            stack.push((best, b));
        }
    }
    pts.iter()
        .zip(&keep)
        .filter(|(_, k)| **k)
        .map(|(p, _)| *p)
        .collect()
}

/// A polyline with its arc length, for points at a distance along it.
pub struct Path {
    pub pts: Vec<Pt>,
    pub cum: Vec<f64>,
    pub total: f64,
}

impl Path {
    pub fn new(pts: Vec<Pt>) -> Path {
        let mut cum = vec![0.0];
        for i in 1..pts.len() {
            cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
        }
        let total = cum[cum.len() - 1];
        Path { pts, cum, total }
    }

    /// Index of the first point further along than s.
    fn after(&self, s: f64) -> usize {
        self.cum
            .partition_point(|&c| c <= s)
            .min(self.cum.len() - 1)
    }

    /// Point at arc length s.
    pub fn at(&self, s: f64) -> Pt {
        let pts = &self.pts;
        if pts.len() < 2 {
            return pts[0];
        }
        let i = self.after(s).clamp(1, pts.len() - 1);
        let l = self.cum[i] - self.cum[i - 1];
        let t = if l > 0.0 {
            ((s - self.cum[i - 1]) / l).clamp(0.0, 1.0)
        } else {
            0.0
        };
        [
            pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
            pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
        ]
    }

    /// How far the line between arc lengths s0 and s1 strays from the straight stitch between them.
    pub fn deviation(&self, s0: f64, s1: f64) -> f64 {
        let a = self.at(s0);
        let b = self.at(s1);
        let mut d: f64 = 0.0;
        let mut i = self.after(s0);
        while i < self.pts.len() && self.cum[i] < s1 {
            d = d.max(to_segment(self.pts[i], a, b));
            i += 1;
        }
        d
    }

    /// Arc lengths of the needle points from `from` to `to` (without `from`, with `to`): stitches of
    /// equal length, at most `len`, where that keeps every stitch within `tol` of the line; else each
    /// stitch as long as it may be (not below MIN_CURVE_STITCH), so curves get shorter stitches and
    /// straight stretches keep theirs.
    pub fn marks(&self, from: f64, to: f64, len: f64, tol: f64) -> Vec<f64> {
        let total = to - from;
        if total <= 1e-9 {
            return vec![];
        }
        let even = |n: usize| -> Vec<f64> {
            (0..n)
                .map(|k| from + (total * (k + 1) as f64) / n as f64)
                .collect()
        };
        let worst = |m: &[f64]| -> f64 {
            (0..m.len())
                .map(|k| self.deviation(if k > 0 { m[k - 1] } else { from }, m[k]))
                .fold(f64::NEG_INFINITY, f64::max)
        };
        let n0 = ((total / len - 1e-9).ceil() as usize).max(1);
        let plain = even(n0);
        if (0..plain.len())
            .all(|k| self.deviation(if k > 0 { plain[k - 1] } else { from }, plain[k]) <= tol)
        {
            return plain;
        }
        let min = MIN_CURVE_STITCH.min(len);
        let mut out = vec![];
        let mut a = from;
        while to - a > 1e-9 {
            let mut hi = (a + len).min(to);
            let mut b = hi;
            if self.deviation(a, hi) > tol {
                let mut lo = (a + min).min(hi);
                if self.deviation(a, lo) <= tol {
                    let mut it = 0;
                    while it < 14 && hi - lo > 0.01 {
                        let m = (lo + hi) / 2.0;
                        if self.deviation(a, m) <= tol {
                            lo = m;
                        } else {
                            hi = m;
                        }
                        it += 1;
                    }
                }
                b = lo;
            }
            // No short stitch left over at the end: the rest in two halves instead.
            if b < to && to - b < min {
                b = if to - a >= 2.0 * min {
                    (a + to) / 2.0
                } else {
                    to
                };
            }
            out.push(b);
            a = b;
        }
        // As many stitches of equal length (or one more) look calmer, where they fit as well. Where
        // the shortest stitch keeps any from fitting, the closest of them.
        let options = [even(out.len()), even(out.len() + 1), out];
        let devs: Vec<f64> = options.iter().map(|m| worst(m)).collect();
        let pick = devs.iter().position(|&d| d <= tol).unwrap_or_else(|| {
            let lo = devs.iter().copied().fold(f64::INFINITY, f64::min);
            devs.iter().position(|&d| d == lo).unwrap_or(0)
        });
        options.into_iter().nth(pick).unwrap_or_default()
    }
}

/// Running stitch along a polyline: corners sharper than 45 degrees get a needle point, and between
/// them the stitches are of equal length, at most `len` (like Ink/Stitch's even running stitch). On
/// curves they get shorter until no stitch is further than `tol` from the line (the line simplified
/// by up to half of it first, at most 0.1 mm, which drops the steps of a traced edge).
/// Returns the needle points including both ends.
pub fn run_stitch(pts: &[Pt], len: f64, tol: f64) -> Vec<Pt> {
    let simple = 0.1f64.min(tol / 2.0);
    let s = simplify(pts, simple);
    if s.len() < 2 {
        return s;
    }
    // Split at sharp corners.
    let mut pieces: Vec<Vec<Pt>> = vec![vec![s[0]]];
    for i in 1..s.len() {
        pieces.last_mut().unwrap().push(s[i]);
        if i < s.len() - 1 {
            let a = [s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]];
            let b = [s[i + 1][0] - s[i][0], s[i + 1][1] - s[i][1]];
            let l = hypot(a[0], a[1]) * hypot(b[0], b[1]);
            let cos = (a[0] * b[0] + a[1] * b[1]) / if l == 0.0 || l.is_nan() { 1.0 } else { l };
            if cos < std::f64::consts::FRAC_1_SQRT_2 {
                pieces.push(vec![s[i]]);
            }
        }
    }
    let mut out = vec![s[0]];
    for piece in pieces {
        let path = Path::new(piece);
        if path.total < 0.05 {
            continue;
        }
        for m in path.marks(0.0, path.total, len, 0.02f64.max(tol - simple)) {
            out.push(path.at(m));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simplify_drops_points_on_a_straight_line() {
        let pts: Vec<Pt> = (0..11).map(|i| [i as f64, 0.0]).collect();
        assert_eq!(simplify(&pts, 0.01), vec![[0.0, 0.0], [10.0, 0.0]]);
        assert_eq!(
            simplify(&[[0.0, 0.0], [1.0, 1.0], [2.0, 0.0]], 0.5).len(),
            3
        );
    }

    #[test]
    fn a_straight_run_has_even_stitches() {
        let s = run_stitch(&[[0.0, 0.0], [10.0, 0.0]], 2.5, TOLERANCE);
        assert_eq!(s.len(), 5);
        for w in s.windows(2) {
            assert!((dist(w[0], w[1]) - 2.5).abs() < 1e-9);
        }
    }

    #[test]
    fn a_square_gets_a_needle_point_in_each_corner() {
        let sq = [
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [0.0, 0.0],
        ];
        let s = run_stitch(&sq, 3.0, TOLERANCE);
        for c in &sq {
            assert!(s.iter().any(|p| dist(*p, *c) < 1e-9));
        }
    }

    #[test]
    fn curves_get_shorter_stitches_within_the_tolerance() {
        let circle: Vec<Pt> = (0..=200)
            .map(|i| {
                let a = i as f64 / 200.0 * std::f64::consts::TAU;
                [5.0 * a.cos(), 5.0 * a.sin()]
            })
            .collect();
        let s = run_stitch(&circle, 4.0, TOLERANCE);
        for w in s.windows(2) {
            let l = dist(w[0], w[1]);
            assert!((MIN_CURVE_STITCH - 1e-9..=4.0 + 1e-9).contains(&l));
            // Sagitta of a chord of length l on radius 5.
            assert!(l * l / 40.0 < TOLERANCE + 0.02);
        }
    }

    #[test]
    fn path_points_and_deviation() {
        let p = Path::new(vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]);
        assert_eq!(p.total, 2.0);
        assert_eq!(p.at(1.5), [1.0, 0.5]);
        assert!((p.deviation(0.0, 2.0) - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-12);
    }
    /// The curve the golden values below were computed on by the TypeScript twin.
    fn curve() -> Vec<Pt> {
        (0..81)
            .map(|i| {
                [
                    i as f64 / 4.0,
                    (i * i) as f64 / 160.0 + (i % 3) as f64 * 0.01,
                ]
            })
            .collect()
    }

    #[test]
    fn the_same_needle_points_as_typescript() {
        let r = run_stitch(&curve(), 3.0, 0.15);
        let ts: [Pt; 18] = [
            [0.0, 0.0],
            [1.5825846096322354, 0.2946793212534186],
            [2.7549910993434876, 0.8092446596060925],
            [4.28589871137366, 1.8671228917813476],
            [6.333286980391223, 4.049937423528151],
            [8.0058623565039, 6.49761256496923],
            [9.510453663399577, 9.093032569364272],
            [10.792193167863097, 11.803243741970267],
            [12.031733909333264, 14.535191536170512],
            [13.102536452007794, 17.336311699168483],
            [14.137276387069088, 20.152215331537555],
            [15.147705059350427, 22.976348816405128],
            [16.036204020539955, 25.84175796624135],
            [16.924702981729478, 28.70716711607757],
            [17.742153537713644, 31.593101226439426],
            [18.518567597540866, 34.49089024700366],
            [19.294981657368087, 37.388679267567895],
            [20.0, 40.02],
        ];
        assert_eq!(r, ts);
        let s = simplify(&curve(), 0.05);
        assert_eq!((s.len(), s[5]), (16, [6.0, 3.6]));
    }
}
