//! The satin band of a line or border as the editor draws it (src/shape/band.ts): its two edges and
//! the grip its width is dragged by.

use serde::{Deserialize, Serialize};

use crate::geom::Pt;
use crate::js::{dist, hypot};
use crate::shape::path::{Form, Path, flatten};

/// The path as points about `step` mm apart (straight pieces too, so that corners keep their
/// sides' normals).
fn sampled(p: &Path, step: f64) -> Vec<Pt> {
    let pts = flatten(p, step);
    let mut out: Vec<Pt> = pts.first().copied().into_iter().collect();
    for i in 1..pts.len() {
        let (a, b) = (pts[i - 1], pts[i]);
        let n = (hypot(b[0] - a[0], b[1] - a[1]) / step).ceil().max(1.0) as usize;
        for k in 1..=n {
            out.push([
                a[0] + ((b[0] - a[0]) * k as f64) / n as f64,
                a[1] + ((b[1] - a[1]) * k as f64) / n as f64,
            ]);
        }
    }
    out
}

/// Unit normal (to the left of the direction of travel) of the polyline at point i.
fn normal(pts: &[Pt], i: usize) -> Pt {
    let a = pts[i.saturating_sub(1)];
    let b = pts[(i + 1).min(pts.len() - 1)];
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l = match hypot(dx, dy) {
        0.0 => 1.0,
        l => l,
    };
    [-dy / l, dx / l]
}

/// How far the band's middle lies to the left of a path: a border `offset` mm outside the edge of
/// an area (left or right by the way the path runs round), 0 for a line.
fn shift_of(pts: &[Pt], closed: bool, offset: f64) -> f64 {
    if !closed || offset == 0.0 || offset.is_nan() {
        return 0.0;
    }
    let mut a = 0.0;
    for i in 0..pts.len() {
        let (p, q) = (pts[i], pts[(i + 1) % pts.len()]);
        a += p[0] * q[1] - q[0] * p[1];
    }
    // Running one way round, the left side is inside; the other way, outside.
    if a > 0.0 { -offset } else { offset }
}

/// The two edges of a band `w` mm wide along each path: a line sewn as satin, or the satin border
/// of an area lying `offset` mm outside its edge.
pub fn band_edges(f: &Form, w: f64, offset: f64) -> Vec<Vec<Pt>> {
    let mut out = vec![];
    for p in &f.paths {
        let mut pts = sampled(p, 0.2);
        if pts.len() < 2 {
            continue;
        }
        let c = shift_of(&pts, p.closed, offset);
        if p.closed {
            pts.push(pts[1]);
        }
        for side in [1.0, -1.0] {
            out.push(
                (0..pts.len())
                    .map(|i| {
                        let n = normal(&pts, i);
                        let d = c + (side * w) / 2.0;
                        [pts[i][0] + n[0] * d, pts[i][1] + n[1] * d]
                    })
                    .collect(),
            );
        }
    }
    out
}

fn cumulative(rail: &[Pt]) -> Vec<f64> {
    let mut out = vec![0.0];
    for i in 1..rail.len() {
        out.push(out[i - 1] + dist(rail[i - 1], rail[i]));
    }
    out
}

/// The point at distance `s` along the rail (as pointAt in src/digitize/rungs.ts).
fn point_at(rail: &[Pt], cum: &[f64], s: f64) -> Pt {
    if s <= 0.0 {
        return rail[0];
    }
    let n = rail.len() - 1;
    if s >= cum[n] {
        return rail[n];
    }
    let (mut lo, mut hi) = (0, n);
    while hi - lo > 1 {
        let m = (lo + hi) >> 1;
        if cum[m] <= s {
            lo = m;
        } else {
            hi = m;
        }
    }
    let l = cum[hi] - cum[lo];
    if l > 0.0 {
        let t = (s - cum[lo]) / l;
        [
            rail[lo][0] + (rail[hi][0] - rail[lo][0]) * t,
            rail[lo][1] + (rail[hi][1] - rail[lo][1]) * t,
        ]
    } else {
        rail[lo]
    }
}

/// Where the width grip sits (`at`), the band's middle there (`mid`) and the direction across it
/// (`n`), to measure a dragged width from.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Grip {
    pub at: Pt,
    pub mid: Pt,
    pub n: Pt,
}

/// Where the width grip sits: halfway along the first path, on its left edge (outer edge when it is
/// closed).
pub fn band_grip(f: &Form, w: f64, offset: f64) -> Option<Grip> {
    let p = f.paths.first()?;
    let pts = sampled(p, 0.1);
    if pts.len() < 2 {
        return None;
    }
    let c = shift_of(&pts, p.closed, offset);
    let cum = cumulative(&pts);
    let at = grip_along(p, &pts, &cum);
    let on = point_at(&pts, &cum, at);
    let i = cum.iter().position(|&v| v >= at).unwrap_or(pts.len() - 1);
    let n = normal(&pts, i);
    let mid = [on[0] + n[0] * c, on[1] + n[1] * c];
    // Round a closed path the grip sits on the outer edge, off the nodes of an area's outline.
    let side = if p.closed {
        shift_of(&pts, true, 1.0)
    } else {
        1.0
    };
    Some(Grip {
        at: [
            mid[0] + (side * n[0] * w) / 2.0,
            mid[1] + (side * n[1] * w) / 2.0,
        ],
        mid,
        n,
    })
}

/// Where along the path (mm) the grip sits: halfway along its longest stretch from node to node, so
/// it never lies on a node and hides it; of stretches alike, the one nearest halfway along the path.
fn grip_along(p: &Path, pts: &[Pt], cum: &[f64]) -> f64 {
    let total = cum[cum.len() - 1];
    let half = total / 2.0;
    // Each node's place along the path: the nearest sample, in order.
    let mut marks: Vec<f64> = vec![];
    let mut from = 0;
    for nd in &p.nodes {
        let (mut best, mut bd) = (from, f64::INFINITY);
        for (k, q) in pts.iter().enumerate().skip(from) {
            let d = hypot(q[0] - nd.p[0], q[1] - nd.p[1]);
            if d < bd {
                bd = d;
                best = k;
            }
        }
        marks.push(cum[best]);
        from = best;
    }
    if !p.closed || marks[marks.len() - 1] < total - 1e-6 {
        marks.push(total);
    }
    if marks[0] > 1e-6 {
        marks.insert(0, 0.0);
    }
    let (mut at, mut longest) = (half, -1.0);
    for k in 1..marks.len() {
        let len = marks[k] - marks[k - 1];
        let mid = (marks[k] + marks[k - 1]) / 2.0;
        if len > longest + 1e-6
            || ((len - longest).abs() <= 1e-6 && (mid - half).abs() < (at - half).abs())
        {
            longest = len;
            at = mid;
        }
    }
    at
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape::path::Node;

    fn line(pts: &[Pt]) -> Form {
        Form {
            paths: vec![Path {
                closed: false,
                nodes: pts
                    .iter()
                    .map(|&p| Node {
                        p,
                        a: p,
                        b: p,
                        smooth: false,
                    })
                    .collect(),
            }],
            nonzero: false,
        }
    }

    #[test]
    fn edges_either_side_and_grip_halfway() {
        let f = line(&[[0.0, 0.0], [10.0, 0.0]]);
        let e = band_edges(&f, 2.0, 0.0);
        assert_eq!(e.len(), 2);
        assert!(e[0].iter().all(|q| (q[1] - 1.0).abs() < 1e-12));
        assert!(e[1].iter().all(|q| (q[1] + 1.0).abs() < 1e-12));
        let g = band_grip(&f, 2.0, 0.0).unwrap();
        assert!((g.at[0] - 5.0).abs() < 1e-9 && (g.at[1] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn grip_off_a_middle_node() {
        let f = line(&[[0.0, 0.0], [4.0, 0.0], [10.0, 0.0]]);
        let g = band_grip(&f, 2.0, 0.0).unwrap();
        assert!((g.mid[0] - 7.0).abs() < 1e-9);
    }
}
