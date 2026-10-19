//! Fewer nodes for a form (src/shape/simplify.ts, "Vereinfachen"): the curves between corners are
//! fitted anew within a deviation, corners stay where they are and stay corners.

use crate::geom::Pt;
use crate::js::dist;
use crate::shape::path::{Form, Node, Path, bezier, segment, segments};
use crate::shape::vectorize::fit_cubic;

/// Deviations tried one after the other (mm): a press of "Vereinfachen" takes the smallest that
/// saves nodes, so pressing again simplifies further.
pub const SIMPLIFY_STEPS: [f64; 3] = [0.3, 0.6, 1.2];
/// Sample distance along the curves when fitting them again (mm).
const SAMPLE: f64 = 0.05;

fn unit(a: Pt, b: Pt) -> [f64; 2] {
    let l = match dist(a, b) {
        0.0 => 1.0,
        l => l,
    };
    [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
}

pub fn node_count(f: &Form) -> usize {
    f.paths.iter().map(|p| p.nodes.len()).sum()
}

/// The form with fewer nodes, at most `tol` mm from the old outline. None when that saves no node.
pub fn simplify_form(f: &Form, tol: f64) -> Option<Form> {
    let out = Form {
        paths: f.paths.iter().map(|p| simplify_path(p, tol)).collect(),
        nonzero: f.nonzero,
    };
    (node_count(&out) < node_count(f)).then_some(out)
}

/// The form simplified with the first step of SIMPLIFY_STEPS that saves nodes, or None.
pub fn simplify_more(f: &Form) -> Option<Form> {
    SIMPLIFY_STEPS.iter().find_map(|&tol| simplify_form(f, tol))
}

/// Points along segments `from` up to (not including) `to` of path `p`, about SAMPLE apart.
fn sample(p: &Path, from: usize, to: usize) -> Vec<Pt> {
    let n = p.nodes.len();
    let mut pts = vec![p.nodes[from].p];
    let mut k = from;
    while k != to {
        let c = segment(p, k);
        let len = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
        let steps = (len / SAMPLE).ceil().clamp(2.0, 2000.0) as usize;
        for i in 1..=steps {
            pts.push(bezier(&c, i as f64 / steps as f64));
        }
        k = (k + 1) % n;
    }
    pts
}

/// Whether all points lie within `tol` of the straight line from the first to the last.
fn straight(pts: &[Pt], tol: f64) -> bool {
    let (a, b) = (pts[0], pts[pts.len() - 1]);
    let l = dist(a, b);
    if l < 1e-9 {
        return false;
    }
    pts.iter()
        .all(|q| ((b[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (b[1] - a[1])).abs() / l <= tol)
}

fn simplify_path(p: &Path, tol: f64) -> Path {
    let n = p.nodes.len();
    if n < 3 || segments(p) < 2 {
        return p.clone();
    }
    // Runs between corners are fitted as one; a round loop is cut in two to have ends to fit between.
    let mut breaks: Vec<usize> = (0..n).filter(|&i| !p.nodes[i].smooth).collect();
    if !p.closed {
        let mut b = vec![0];
        b.extend(breaks);
        b.push(n - 1);
        // (A set in insertion order.)
        let mut seen = vec![false; n];
        breaks = b
            .into_iter()
            .filter(|&i| !std::mem::replace(&mut seen[i], true))
            .collect();
    } else if breaks.is_empty() {
        breaks = vec![0, n / 2];
    } else if breaks.len() == 1 {
        let mut b = vec![breaks[0], (breaks[0] + n / 2) % n];
        b.sort_unstable();
        breaks = b;
    }
    let runs = if p.closed {
        breaks.len()
    } else {
        breaks.len() - 1
    };
    let mut nodes: Vec<Node> = vec![];
    for r in 0..runs {
        let s = breaks[r];
        let e = breaks[(r + 1) % breaks.len()];
        let pts = sample(p, s, e);
        let m = pts.len();
        let curves = if straight(&pts, tol) {
            vec![[pts[0], pts[0], pts[m - 1], pts[m - 1]]]
        } else {
            fit_cubic(
                &pts,
                unit(pts[0], pts[1]),
                unit(pts[m - 1], pts[m - 2]),
                tol,
                false,
            )
        };
        for [p0, c1, c2, p3] in curves {
            match nodes.last_mut() {
                Some(last) if dist(last.p, p0) < 1e-9 => last.b = c1,
                _ => nodes.push(Node {
                    p: p0,
                    a: if p.closed || r > 0 { p0 } else { p.nodes[0].a },
                    b: c1,
                    smooth: p.nodes[s].smooth,
                }),
            }
            nodes.push(Node {
                p: p3,
                a: c2,
                b: p3,
                smooth: true,
            });
        }
        if let Some(l) = nodes.last_mut() {
            l.smooth = p.nodes[e].smooth;
        }
    }
    if p.closed {
        // The last node is the first one again.
        if let Some(end) = nodes.pop() {
            nodes[0].a = end.a;
        }
    } else if let Some(l) = nodes.last_mut() {
        l.b = p.nodes[n - 1].b;
    }
    Path {
        closed: p.closed,
        nodes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn many_nodes_on_a_circle_become_few() {
        let n = 64;
        let nodes: Vec<Node> = (0..n)
            .map(|i| {
                let t = i as f64 / n as f64 * std::f64::consts::TAU;
                let p = [10.0 * t.cos(), 10.0 * t.sin()];
                Node {
                    p,
                    a: p,
                    b: p,
                    smooth: true,
                }
            })
            .collect();
        let f = Form {
            paths: vec![Path {
                closed: true,
                nodes,
            }],
            nonzero: false,
        };
        let s = simplify_more(&f).unwrap();
        assert!(node_count(&s) < 12, "{}", node_count(&s));
        assert!(s.paths[0].closed);
    }

    #[test]
    fn corners_of_a_square_stay() {
        let sq: Vec<Node> = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]]
            .iter()
            .map(|&p| Node {
                p,
                a: p,
                b: p,
                smooth: false,
            })
            .collect();
        let f = Form {
            paths: vec![Path {
                closed: true,
                nodes: sq,
            }],
            nonzero: false,
        };
        assert!(simplify_form(&f, 0.3).is_none());
    }
}
