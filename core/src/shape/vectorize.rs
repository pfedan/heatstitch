//! Areas as curves (src/shape/vectorize.ts): a region's outline traced and fitted with cubic
//! curves, corners kept sharp, and the curve fitting itself (Schneider), which the shape
//! operations, simplifying and drawing share.

use crate::digitize::region::{Region, outline};
use crate::geom::{Pt, add, dot, mul, signed_area, sub, to_segment};
use crate::js::{dist, hypot};
use crate::shape::path::{Cubic, Form, Node, Path};

/// Largest distance of the curves from the traced outline (mm): rastered again, the area stays
/// within about 1 % of the pixels it came from, with few enough nodes to grab. Areas read from
/// stitches have ragged row ends anyway; they get the coarser READ_TOLERANCE.
pub const FIT_TOLERANCE: f64 = 0.15;
pub const READ_TOLERANCE: f64 = 0.25;
/// Turn (degrees) over about CORNER_REACH on both sides that makes a corner.
const CORNER_DEG: f64 = 50.0;
const CORNER_REACH: f64 = 0.4;
/// Loops smaller than this (mm²) are specks of the tracing, not part of the shape.
const SPECK: f64 = 0.3;

pub type V = [f64; 2];

#[inline]
fn unit(a: V) -> V {
    let l = hypot(a[0], a[1]);
    if l > 1e-12 {
        [a[0] / l, a[1] / l]
    } else {
        [0.0, 0.0]
    }
}

/// The area of a region as curves: its outline (holes included) traced and fitted with cubic
/// curves, corners kept sharp. Raster it again with `rasterize` to get (nearly) the same pixels.
pub fn vectorize(r: &Region, tol: f64) -> Form {
    let mut paths = vec![];
    for lp in outline(r, 0.0, &r.sdf_base) {
        let pts = &lp[..lp.len().saturating_sub(1)];
        if pts.len() < 4 || signed_area(pts).abs() < SPECK {
            continue;
        }
        paths.push(fit_loop(pts, tol));
    }
    Form {
        paths,
        nonzero: false,
    }
}

/// Points of a closed loop as a closed path of cubic curves.
pub fn fit_loop(raw: &[Pt], tol: f64) -> Path {
    let pts = smooth(raw);
    let n = pts.len();
    let corners = find_corners(&pts);
    // Break points: the corners, or for a round loop two points opposite each other.
    let breaks = if corners.is_empty() {
        vec![0, n / 2]
    } else {
        corners.clone()
    };
    let is_corner = |i: usize| corners.contains(&i);
    let tangent_at = |i: usize, out: bool| -> V {
        // At a corner each side has its own direction, elsewhere the line through the neighbours.
        let k = 2usize.max(crate::js::round(n as f64 / 60.0) as usize);
        let prev = pts[(i + n * k - k) % n];
        let next = pts[(i + k) % n];
        if !is_corner(i) {
            return unit(sub(next, prev));
        }
        if out {
            unit(sub(next, pts[i]))
        } else {
            unit(sub(pts[i], prev))
        }
    };
    let mut nodes: Vec<Node> = vec![];
    for b in 0..breaks.len() {
        let s = breaks[b];
        let e = breaks[(b + 1) % breaks.len()];
        let mut run: Vec<Pt> = vec![];
        let mut i = s;
        loop {
            run.push(pts[i]);
            if i == e && run.len() > 1 {
                break;
            }
            i = (i + 1) % n;
        }
        let curves = fit_cubic(
            &run,
            tangent_at(s, true),
            mul(tangent_at(e, false), -1.0),
            tol,
            false,
        );
        for c in curves {
            match nodes.last_mut() {
                Some(last) if dist(last.p, c[0]) < 1e-9 => last.b = c[1],
                _ => nodes.push(Node {
                    p: c[0],
                    a: c[0],
                    b: c[1],
                    smooth: !is_corner(s),
                }),
            }
            nodes.push(Node {
                p: c[3],
                a: c[2],
                b: c[3],
                smooth: true,
            });
        }
        // The node at a break point is a corner when it was found as one.
        if let Some(end) = nodes.last_mut() {
            end.smooth = !is_corner(e);
        }
    }
    // The last node is the first one again.
    let last = nodes.pop().expect("a loop has curves");
    nodes[0].a = last.a;
    nodes[0].smooth = !is_corner(breaks[0]);
    for nd in &mut nodes {
        if dist(nd.p, nd.a) < 1e-9 && dist(nd.p, nd.b) < 1e-9 {
            nd.smooth = false;
        }
    }
    Path {
        closed: true,
        nodes,
    }
}

/// One pass of neighbour averaging: the steps of the pixel edge become a smooth line.
fn smooth(pts: &[Pt]) -> Vec<Pt> {
    let n = pts.len();
    (0..n)
        .map(|i| {
            let (a, p, b) = (pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]);
            [
                (a[0] + 2.0 * p[0] + b[0]) / 4.0,
                (a[1] + 2.0 * p[1] + b[1]) / 4.0,
            ]
        })
        .collect()
}

/// Indices of corners: where the loop turns more than CORNER_DEG within CORNER_REACH on both sides.
fn find_corners(pts: &[Pt]) -> Vec<usize> {
    let n = pts.len();
    let mut total = 0.0;
    for i in 0..n {
        total += dist(pts[i], pts[(i + 1) % n]);
    }
    let step = total / n as f64;
    let k = 2usize.max(crate::js::round(CORNER_REACH / step.max(1e-6)) as usize);
    if n < 4 * k {
        return vec![];
    }
    let turn: Vec<f64> = (0..n)
        .map(|i| {
            let p = pts[i];
            let a = unit(sub(p, pts[(i + n * k - k) % n]));
            let b = unit(sub(pts[(i + k) % n], p));
            dot(a, b).clamp(-1.0, 1.0).acos()
        })
        .collect();
    let limit = CORNER_DEG * std::f64::consts::PI / 180.0;
    let mut out = vec![];
    for i in 0..n {
        if turn[i] < limit {
            continue;
        }
        // The sharpest point of its neighbourhood only.
        let ki = k as isize;
        let peak = (-ki..=ki).all(|j| {
            if j == 0 {
                return true;
            }
            let t = turn[(i as isize + j).rem_euclid(n as isize) as usize];
            !(t > turn[i] || (t == turn[i] && j < 0))
        });
        if peak {
            out.push(i);
        }
    }
    out
}

/// Cubic curves through `pts` (Schneider's algorithm, Graphics Gems 1990): one curve fitted by
/// least squares with the given end directions, split at the worst point until every point lies
/// within `tol`. With `between`, also the curve between two points lies within `tol` of the straight
/// piece joining them: Schneider measures at the points only, and a curve over few points can bulge
/// out between them (a short piece next to a corner, say).
///
/// Every split leaves pieces with fewer points, so splitting ends by itself and is not cut off at a
/// depth: splits at the worst point can be lopsided (a few points off one end each time), and a long
/// run, such as the offset of a jagged outline, would be given up on far outside `tol`.
pub fn fit_cubic(pts: &[Pt], t1: V, t2: V, tol: f64, between: bool) -> Vec<Cubic> {
    let mut out = vec![];
    // Pieces still to fit, the next one last: a run peeled a point at a time can need many splits.
    let mut todo: Vec<(&[Pt], V, V)> = vec![(pts, t1, t2)];
    while let Some((run, a, b)) = todo.pop() {
        match fit_one(run, a, b, tol, between) {
            Ok(c) => out.push(c),
            Err(at) => {
                let center = unit(sub(run[at - 1], run[at + 1]));
                todo.push((&run[at..], mul(center, -1.0), b));
                todo.push((&run[..=at], a, center));
            }
        }
    }
    out
}

/// The one cubic that follows `pts` best with the given end directions, however far off it lies:
/// Schneider's least squares fit with Newton steps on the parameters, the best of the tries kept.
pub fn fit_single_cubic(pts: &[Pt], t1: V, t2: V) -> Cubic {
    if pts.len() < 3 {
        return fit_one(pts, t1, t2, f64::INFINITY, false).expect("two points always fit");
    }
    let mut u = chord_params(pts);
    let mut curve = generate(pts, &u, t1, t2);
    let mut best = (curve, max_error(pts, &curve, &u, false).0);
    for _ in 0..12 {
        u = reparameterize(pts, &u, &curve);
        curve = generate(pts, &u, t1, t2);
        let max = max_error(pts, &curve, &u, false).0;
        if max < best.1 {
            best = (curve, max);
        }
    }
    best.0
}

/// One curve through `pts` within `tol`, or the point to split at when there is none.
fn fit_one(pts: &[Pt], t1: V, t2: V, tol: f64, between: bool) -> Result<Cubic, usize> {
    let (first, last) = (pts[0], pts[pts.len() - 1]);
    if pts.len() < 3 {
        let d = dist(first, last) / 3.0;
        return Ok([first, add(first, mul(t1, d)), add(last, mul(t2, d)), last]);
    }
    let mut u = chord_params(pts);
    let mut curve = generate(pts, &u, t1, t2);
    let (mut max, mut at) = max_error(pts, &curve, &u, between);
    if max < tol {
        return Ok(curve);
    }
    if max < tol * 4.0 {
        for _ in 0..6 {
            u = reparameterize(pts, &u, &curve);
            curve = generate(pts, &u, t1, t2);
            (max, at) = max_error(pts, &curve, &u, between);
            if max < tol {
                return Ok(curve);
            }
        }
    }
    Err(at.clamp(1, pts.len() - 2))
}

fn chord_params(pts: &[Pt]) -> Vec<f64> {
    let mut u = vec![0.0];
    for i in 1..pts.len() {
        u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
    }
    let total = match u[u.len() - 1] {
        0.0 => 1.0,
        t => t,
    };
    u.iter().map(|v| v / total).collect()
}

// `**` in JavaScript is Math.pow.
#[inline]
fn b0(t: f64) -> f64 {
    (1.0 - t).powf(3.0)
}
#[inline]
fn b1(t: f64) -> f64 {
    3.0 * t * (1.0 - t).powf(2.0)
}
#[inline]
fn b2(t: f64) -> f64 {
    3.0 * t * t * (1.0 - t)
}
#[inline]
fn b3(t: f64) -> f64 {
    t.powf(3.0)
}

fn at(c: &Cubic, t: f64) -> Pt {
    let (w0, w1, w2, w3) = (b0(t), b1(t), b2(t), b3(t));
    [
        w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0] + w3 * c[3][0],
        w0 * c[0][1] + w1 * c[1][1] + w2 * c[2][1] + w3 * c[3][1],
    ]
}

fn generate(pts: &[Pt], u: &[f64], t1: V, t2: V) -> Cubic {
    let (first, last) = (pts[0], pts[pts.len() - 1]);
    let (mut c00, mut c01, mut c11, mut x0, mut x1) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for i in 0..pts.len() {
        let a1 = mul(t1, b1(u[i]));
        let a2 = mul(t2, b2(u[i]));
        c00 += dot(a1, a1);
        c01 += dot(a1, a2);
        c11 += dot(a2, a2);
        let base = add(
            add(
                mul(first, b0(u[i]) + b1(u[i])),
                mul(last, b2(u[i]) + b3(u[i])),
            ),
            [0.0, 0.0],
        );
        let tmp = sub(pts[i], base);
        x0 += dot(a1, tmp);
        x1 += dot(a2, tmp);
    }
    let det = c00 * c11 - c01 * c01;
    let mut al = if det != 0.0 {
        (x0 * c11 - x1 * c01) / det
    } else {
        0.0
    };
    let mut ar = if det != 0.0 {
        (c00 * x1 - c01 * x0) / det
    } else {
        0.0
    };
    let seg = dist(first, last);
    let eps = 1e-6 * seg;
    // Degenerate solutions fall back to a third of the chord (Wu/Barsky heuristic).
    if al < eps || ar < eps || al > seg * 2.0 || ar > seg * 2.0 {
        al = seg / 3.0;
        ar = al;
    }
    [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last]
}

fn max_error(pts: &[Pt], c: &Cubic, u: &[f64], between: bool) -> (f64, usize) {
    let mut max = 0.0;
    let mut idx = pts.len() / 2;
    for i in 1..pts.len() - 1 {
        let d = dist(at(c, u[i]), pts[i]);
        if d > max {
            max = d;
            idx = i;
        }
    }
    if !between {
        return (max, idx);
    }
    // Halfway between two points: how far the curve lies from the straight piece joining them,
    // split at the nearer inner point of the two.
    for i in 0..pts.len() - 1 {
        let d = to_segment(at(c, (u[i] + u[i + 1]) / 2.0), pts[i], pts[i + 1]);
        if d > max {
            max = d;
            idx = if i == 0 { 1 } else { i };
        }
    }
    (max, idx)
}

fn reparameterize(pts: &[Pt], u: &[f64], c: &Cubic) -> Vec<f64> {
    let d1 = [
        mul(sub(c[1], c[0]), 3.0),
        mul(sub(c[2], c[1]), 3.0),
        mul(sub(c[3], c[2]), 3.0),
    ];
    let q1 = |t: f64| -> V {
        let (w0, w1, w2) = ((1.0 - t).powf(2.0), 2.0 * t * (1.0 - t), t * t);
        [
            w0 * d1[0][0] + w1 * d1[1][0] + w2 * d1[2][0],
            w0 * d1[0][1] + w1 * d1[1][1] + w2 * d1[2][1],
        ]
    };
    let d2a = mul(sub(d1[1], d1[0]), 2.0);
    let d2b = mul(sub(d1[2], d1[1]), 2.0);
    let q2 = |t: f64| -> V {
        [
            (1.0 - t) * d2a[0] + t * d2b[0],
            (1.0 - t) * d2a[1] + t * d2b[1],
        ]
    };
    u.iter()
        .enumerate()
        .map(|(i, &t)| {
            let p = at(c, t);
            let d = sub(p, pts[i]);
            let (a, b) = (q1(t), q2(t));
            let num = dot(d, a);
            let den = dot(a, a) + dot(d, b);
            if den.abs() < 1e-12 {
                t
            } else {
                (t - num / den).clamp(0.0, 1.0)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn circle(n: usize, r: f64) -> Vec<Pt> {
        (0..n)
            .map(|i| {
                let a = i as f64 / n as f64 * std::f64::consts::TAU;
                [r * a.cos(), r * a.sin()]
            })
            .collect()
    }

    #[test]
    fn fits_a_circle_with_few_round_nodes() {
        let p = fit_loop(&circle(400, 10.0), 0.05);
        assert!(p.closed);
        assert!(p.nodes.len() <= 8, "{} nodes", p.nodes.len());
        assert!(p.nodes.iter().all(|n| n.smooth));
        for n in &p.nodes {
            assert!((hypot(n.p[0], n.p[1]) - 10.0).abs() < 0.1);
        }
    }

    #[test]
    fn keeps_square_corners() {
        let mut pts = vec![];
        for (a, b) in [
            ([0.0, 0.0], [10.0, 0.0]),
            ([10.0, 0.0], [10.0, 10.0]),
            ([10.0, 10.0], [0.0, 10.0]),
            ([0.0, 10.0], [0.0, 0.0]),
        ] {
            for i in 0..50 {
                let t = i as f64 / 50.0;
                pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
        }
        let p = fit_loop(&pts, 0.15);
        assert_eq!(p.nodes.iter().filter(|n| !n.smooth).count(), 4);
    }

    #[test]
    fn fit_cubic_stays_within_tolerance() {
        let pts: Vec<Pt> = (0..100)
            .map(|i| {
                let x = i as f64 * 0.1;
                [x, (x * 1.3).sin() * 2.0]
            })
            .collect();
        let cs = fit_cubic(
            &pts,
            unit(sub(pts[1], pts[0])),
            unit(sub(pts[98], pts[99])),
            0.02,
            true,
        );
        for q in &pts {
            let d = cs
                .iter()
                .flat_map(|c| (0..=200).map(move |k| dist(at(c, k as f64 / 200.0), *q)))
                .fold(f64::INFINITY, f64::min);
            assert!(d < 0.03, "{d}");
        }
    }
}
