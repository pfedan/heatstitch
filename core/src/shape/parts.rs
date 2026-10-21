//! The parts a form falls into (src/shape/parts.ts, "In Teile trennen" on a known form).

use std::collections::{HashMap, HashSet};

use crate::geom::{Pt, to_segment, twice_area};
use crate::js::dist;
use crate::shape::path::{Form, flatten};

/// Sample distance along the curves (mm).
const STEP: f64 = 0.2;

fn cross(o: Pt, a: Pt, b: Pt) -> f64 {
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/// Whether the segments a-b and c-d cross (proper or touching).
fn crosses(a: Pt, b: Pt, c: Pt, d: Pt) -> bool {
    let (d1, d2, d3, d4) = (
        cross(c, d, a),
        cross(c, d, b),
        cross(a, b, c),
        cross(a, b, d),
    );
    ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
}

/// Distance between the segments a-b and c-d (0 where they cross).
fn seg_dist(a: Pt, b: Pt, c: Pt, d: Pt) -> f64 {
    if crosses(a, b, c, d) {
        return 0.0;
    }
    to_segment(a, c, d)
        .min(to_segment(b, c, d))
        .min(to_segment(c, a, b))
        .min(to_segment(d, a, b))
}

struct UnionFind {
    up: Vec<usize>,
}

impl UnionFind {
    fn find(&mut self, mut i: usize) -> usize {
        while self.up[i] != i {
            self.up[i] = self.up[self.up[i]];
            i = self.up[i];
        }
        i
    }
    fn join(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        self.up[ra] = rb;
    }
}

/// The polyline of each path (a closed one ends where it starts).
fn polylines(f: &Form) -> Vec<Vec<Pt>> {
    f.paths
        .iter()
        .map(|p| {
            let mut pts = flatten(p, STEP);
            if p.closed && pts.len() > 1 {
                pts.push(pts[0]);
            }
            pts
        })
        .collect()
}

/// Pairs of paths that come within `reach` of each other anywhere along their curves (crossing,
/// touching, an end on the middle of another), found with a grid of cells 2 mm wide.
fn touching_pairs(lines: &[Vec<Pt>], reach: f64) -> Vec<(usize, usize)> {
    const CELL: f64 = 2.0;
    // Cells in the order first met, as a Map in JavaScript.
    let mut order: Vec<(i64, i64)> = vec![];
    let mut cells: HashMap<(i64, i64), Vec<(usize, usize)>> = HashMap::new();
    for (k, pts) in lines.iter().enumerate() {
        for i in 0..pts.len().saturating_sub(1) {
            let (a, b) = (pts[i], pts[i + 1]);
            let x0 = ((a[0].min(b[0]) - reach) / CELL).floor() as i64;
            let x1 = ((a[0].max(b[0]) + reach) / CELL).floor() as i64;
            let y0 = ((a[1].min(b[1]) - reach) / CELL).floor() as i64;
            let y1 = ((a[1].max(b[1]) + reach) / CELL).floor() as i64;
            for x in x0..=x1 {
                for y in y0..=y1 {
                    cells
                        .entry((x, y))
                        .or_insert_with(|| {
                            order.push((x, y));
                            vec![]
                        })
                        .push((k, i));
                }
            }
        }
    }
    let mut found: HashSet<(usize, usize)> = HashSet::new();
    let mut out = vec![];
    for key in &order {
        let list = &cells[key];
        for u in 0..list.len() {
            for v in u + 1..list.len() {
                let ((k, i), (m, j)) = (list[u], list[v]);
                if k == m {
                    continue;
                }
                let key = (k.min(m), k.max(m));
                if found.contains(&key) {
                    continue;
                }
                if seg_dist(lines[k][i], lines[k][i + 1], lines[m][j], lines[m][j + 1]) <= reach {
                    found.insert(key);
                    out.push((k, m));
                }
            }
        }
    }
    out
}

/// The winding number of the closed polyline `pts` around `q`.
fn winding(pts: &[Pt], q: Pt) -> i32 {
    let mut w = 0;
    for i in 0..pts.len().saturating_sub(1) {
        let (a, b) = (pts[i], pts[i + 1]);
        if a[1] <= q[1] {
            if b[1] > q[1] && cross(a, b, q) > 0.0 {
                w += 1;
            }
        } else if b[1] <= q[1] && cross(a, b, q) < 0.0 {
            w -= 1;
        }
    }
    w
}

/// Whether the form fills point `q` by its rule.
fn filled_at(f: &Form, lines: &[Vec<Pt>], q: Pt) -> bool {
    let mut n = 0;
    for (k, p) in f.paths.iter().enumerate() {
        if !p.closed {
            continue;
        }
        let w = winding(&lines[k], q);
        n += if f.nonzero { w } else { w & 1 };
    }
    if f.nonzero { n != 0 } else { n & 1 == 1 }
}

/// Whether closed path `k` is a hole: just inside it the form is not filled, just outside it is.
/// Tried across its longest piece, which lies clear of its own corners.
fn is_hole(f: &Form, lines: &[Vec<Pt>], k: usize) -> bool {
    let pts = &lines[k];
    let (mut best, mut at) = (0.0, 0);
    for i in 0..pts.len().saturating_sub(1) {
        let d = dist(pts[i], pts[i + 1]);
        if d > best {
            (best, at) = (d, i);
        }
    }
    if best < 1e-6 {
        return false;
    }
    let (a, b) = (pts[at], pts[at + 1]);
    let m = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
    let e = 0.01f64.min(best / 4.0);
    let nx = (-(b[1] - a[1]) / best) * e;
    let ny = ((b[0] - a[0]) / best) * e;
    let l = [m[0] + nx, m[1] + ny];
    let r = [m[0] - nx, m[1] - ny];
    let (inside, outside) = if winding(pts, l) != 0 { (l, r) } else { (r, l) };
    !filled_at(f, lines, inside) && filled_at(f, lines, outside)
}

/// The parts a form falls into, each a form of its own, in the order of their first path.
///
/// A line (`area` false): the paths that touch, cross or come within `reach` mm of each other
/// anywhere along their curves stay together, also through other paths: the connected parts of the
/// drawing, the same ones redwork sews without a jump.
///
/// An area: each outer loop with its holes. Loops that cross are one part; a hole goes with the
/// smallest loop around it, an island in a hole is a part of its own. Open paths beside the area go
/// with the part they lie in, else with the first.
pub fn form_parts(f: &Form, area: bool, reach: f64) -> Vec<Form> {
    part_groups(f, area, reach)
        .into_iter()
        .map(|g| Form {
            paths: g.into_iter().map(|k| f.paths[k].clone()).collect(),
            nonzero: f.nonzero,
        })
        .collect()
}

/// [`form_parts`] as the indices of the paths of each part.
pub fn part_groups(f: &Form, area: bool, reach: f64) -> Vec<Vec<usize>> {
    let n = f.paths.len();
    if n < 2 {
        return vec![(0..n).collect()];
    }
    let lines = polylines(f);
    let mut uf = UnionFind {
        up: (0..n).collect(),
    };
    if !area {
        for (a, b) in touching_pairs(&lines, reach) {
            uf.join(a, b);
        }
    } else {
        let closed: Vec<usize> = (0..n)
            .filter(|&k| f.paths[k].closed && lines[k].len() > 3)
            .collect();
        let is_closed = |k: usize| closed.contains(&k);
        for (a, b) in touching_pairs(&lines, 0.0) {
            if is_closed(a) && is_closed(b) {
                uf.join(a, b);
            }
        }
        let size: HashMap<usize, f64> = closed
            .iter()
            .map(|&k| (k, (twice_area(&lines[k]) / 2.0).abs()))
            .collect();
        // The smallest closed loop around `q` other than `k` (the first of equal ones, as a stable sort).
        let around = |k: usize, q: Pt| -> Option<usize> {
            let mut best: Option<usize> = None;
            for &j in &closed {
                if j != k && winding(&lines[j], q) != 0 && best.is_none_or(|b| size[&j] < size[&b])
                {
                    best = Some(j);
                }
            }
            best
        };
        for &k in &closed {
            if !is_hole(f, &lines, k) {
                continue;
            }
            if let Some(j) = around(k, lines[k][0]) {
                uf.join(k, j);
            }
        }
        // Open paths: with the part they lie in.
        let first = closed.first().copied();
        for k in 0..n {
            if is_closed(k) || lines[k].is_empty() {
                continue;
            }
            let q = lines[k][lines[k].len() / 2];
            if let Some(j) = around(k, q).or(first) {
                uf.join(k, j);
            }
        }
    }
    let mut order: Vec<usize> = vec![];
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for k in 0..n {
        let r = uf.find(k);
        groups
            .entry(r)
            .or_insert_with(|| {
                order.push(r);
                vec![]
            })
            .push(k);
    }
    order
        .into_iter()
        .map(|r| groups.remove(&r).unwrap_or_default())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape::path::{Node, Path};

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Path {
        Path {
            closed: true,
            nodes: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
                .iter()
                .map(|&p| Node {
                    p,
                    a: p,
                    b: p,
                    smooth: false,
                })
                .collect(),
        }
    }

    #[test]
    fn holes_stay_with_their_outline_islands_go() {
        let f = Form {
            paths: vec![
                rect(0.0, 0.0, 20.0, 20.0),
                rect(5.0, 5.0, 10.0, 10.0),
                rect(8.0, 8.0, 4.0, 4.0),
                rect(30.0, 0.0, 5.0, 5.0),
            ],
            nonzero: false,
        };
        let parts = form_parts(&f, true, 0.5);
        assert_eq!(
            parts.iter().map(|p| p.paths.len()).collect::<Vec<_>>(),
            vec![2, 1, 1]
        );
    }

    #[test]
    fn lines_close_together_are_one_part() {
        let f = Form {
            paths: vec![
                rect(0.0, 0.0, 5.0, 5.0),
                rect(5.3, 0.0, 5.0, 5.0),
                rect(20.0, 0.0, 5.0, 5.0),
            ],
            nonzero: false,
        };
        assert_eq!(form_parts(&f, false, 0.5).len(), 2);
    }
}
