//! Vector forms as in src/shape/path.ts: paths of nodes joined by cubic curves, in millimetres.
//! The base the shape, fill and satin stages share; editing a form node by node stays TypeScript.

use serde::{Deserialize, Serialize};

use crate::geom::{Pt, lerp};
use crate::js::{dist, hypot};

/// A node: its point and the handles of the curves before (`a`) and after (`b`) it. A handle on
/// the node makes that side straight; a smooth node keeps both handles on one line.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub p: Pt,
    pub a: Pt,
    pub b: Pt,
    pub smooth: bool,
}

/// Nodes joined by cubic curves; a closed path also joins the last node to the first.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Path {
    pub nodes: Vec<Node>,
    pub closed: bool,
}

/// One or more paths, filled even-odd unless `nonzero` (shapes from SVG files may say so).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Form {
    pub paths: Vec<Path>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub nonzero: bool,
}

/// Affine map x' = a x + c y + e, y' = b x + d y + f.
pub type Mat = [f64; 6];

pub const IDENTITY: Mat = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

pub fn apply(m: &Mat, [x, y]: Pt) -> Pt {
    [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/// `m` after `n` (first n, then m).
pub fn compose(m: &Mat, n: &Mat) -> Mat {
    [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}

pub type Cubic = [Pt; 4];

/// Number of curves of a path.
pub fn segments(p: &Path) -> usize {
    if p.closed {
        p.nodes.len()
    } else {
        p.nodes.len().saturating_sub(1)
    }
}

/// Control points of curve `k` of a path.
pub fn segment(p: &Path, k: usize) -> Cubic {
    let s = &p.nodes[k];
    let e = &p.nodes[(k + 1) % p.nodes.len()];
    [s.p, s.b, e.a, e.p]
}

pub fn bezier([p0, p1, p2, p3]: &Cubic, t: f64) -> Pt {
    let u = 1.0 - t;
    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    [
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]
}

/// Both handles on their nodes: the curve is a straight side.
pub fn straight(c: &Cubic) -> bool {
    dist(c[0], c[1]) < 1e-9 && dist(c[2], c[3]) < 1e-9
}

/// Points along a path, about `step` mm apart on curves (straight sides are one line).
pub fn flatten(p: &Path, step: f64) -> Vec<Pt> {
    let Some(first) = p.nodes.first() else {
        return vec![];
    };
    let mut out = vec![first.p];
    for k in 0..segments(p) {
        let c = segment(p, k);
        let n = if straight(&c) {
            1
        } else {
            ((dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3])) / step)
                .ceil()
                .clamp(2.0, 400.0) as usize
        };
        for i in 1..=n {
            out.push(bezier(&c, i as f64 / n as f64));
        }
    }
    out
}

/// Bounds of a form's outline (flattened at 0.2 mm): min x, min y, max x, max y.
pub fn bounds(f: &Form) -> Option<[f64; 4]> {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in &f.paths {
        for [x, y] in flatten(p, 0.2) {
            b = [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)];
        }
    }
    (b[0] <= b[2]).then_some(b)
}

/// Whether a point lies inside a closed polyline (even-odd).
pub fn inside_poly(pts: &[Pt], [x, y]: Pt) -> bool {
    let mut inside = false;
    let mut j = pts.len().wrapping_sub(1);
    for i in 0..pts.len() {
        let ([xi, yi], [xj, yj]) = (pts[i], pts[j]);
        if (yi > y) != (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// A new node on curve `seg` of path `path` at parameter `t`, the outline exactly as it was; its
/// index.
pub fn insert_node(f: &mut Form, path: usize, seg: usize, t: f64) -> usize {
    let p = &mut f.paths[path];
    let c = segment(p, seg);
    let n = p.nodes.len();
    if straight(&c) {
        let m = lerp(c[0], c[3], t);
        p.nodes.insert(
            seg + 1,
            Node {
                p: m,
                a: m,
                b: m,
                smooth: false,
            },
        );
        return seg + 1;
    }
    // de Casteljau: the curve split in two at t.
    let (a, b, cc) = (
        lerp(c[0], c[1], t),
        lerp(c[1], c[2], t),
        lerp(c[2], c[3], t),
    );
    let (ab, bc) = (lerp(a, b, t), lerp(b, cc, t));
    let m = lerp(ab, bc, t);
    p.nodes[seg].b = a;
    p.nodes[(seg + 1) % n].a = cc;
    p.nodes.insert(
        seg + 1,
        Node {
            p: m,
            a: ab,
            b: bc,
            smooth: true,
        },
    );
    seg + 1
}

/// Node `i` of path `path` made smooth (handles along the line through its neighbours, a third of
/// the way to each) or a corner (handles on the node).
pub fn set_smooth(f: &Form, path: usize, i: usize, smooth: bool) -> Form {
    let mut g = f.clone();
    let p = &mut g.paths[path];
    let k = p.nodes.len();
    let prev = (p.closed || i > 0).then(|| p.nodes[(i + k - 1) % k].p);
    let next = (p.closed || i < k - 1).then(|| p.nodes[(i + 1) % k].p);
    let n = &mut p.nodes[i];
    n.smooth = smooth;
    if !smooth {
        n.a = n.p;
        n.b = n.p;
        return g;
    }
    let (from, to) = (prev.unwrap_or(n.p), next.unwrap_or(n.p));
    let (tx, ty) = (to[0] - from[0], to[1] - from[1]);
    let tl = hypot(tx, ty);
    if tl < 1e-9 {
        return g;
    }
    let la = prev.map_or(0.0, |q| dist(q, n.p) / 3.0);
    let lb = next.map_or(0.0, |q| dist(q, n.p) / 3.0);
    n.a = [n.p[0] - tx / tl * la, n.p[1] - ty / tl * la];
    n.b = [n.p[0] + tx / tl * lb, n.p[1] + ty / tl * lb];
    g
}

#[cfg(test)]
mod tests {
    use super::*;

    fn corner(x: f64, y: f64) -> Node {
        Node {
            p: [x, y],
            a: [x, y],
            b: [x, y],
            smooth: false,
        }
    }

    fn square(x0: f64, y0: f64, s: f64) -> Path {
        Path {
            closed: true,
            nodes: vec![
                corner(x0, y0),
                corner(x0 + s, y0),
                corner(x0 + s, y0 + s),
                corner(x0, y0 + s),
            ],
        }
    }

    #[test]
    fn area_with_a_hole() {
        let f = Form {
            paths: vec![square(0.0, 0.0, 10.0), square(2.0, 2.0, 2.0)],
            nonzero: false,
        };
        assert_eq!(bounds(&f), Some([0.0, 0.0, 10.0, 10.0]));
    }

    #[test]
    fn straight_sides_flatten_to_their_corners() {
        assert_eq!(flatten(&square(0.0, 0.0, 1.0), 0.1).len(), 5);
    }

    #[test]
    fn smooth_node_handles_on_one_line() {
        let f = Form {
            paths: vec![square(0.0, 0.0, 3.0)],
            nonzero: false,
        };
        let n = set_smooth(&f, 0, 1, true).paths[0].nodes[1];
        let (da, db) = (
            [n.p[0] - n.a[0], n.p[1] - n.a[1]],
            [n.b[0] - n.p[0], n.b[1] - n.p[1]],
        );
        assert!((da[0] * db[1] - da[1] * db[0]).abs() < 1e-12);
        assert!(n.smooth);
    }
}
