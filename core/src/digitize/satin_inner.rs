//! Satin over a whole area (a star, a block letter, a ring, a blob with holes), cut into columns
//! along its medial axis (see medial.rs) the way a digitizer cuts it:
//!
//! - each branch of the axis is a column, its stitches along the ribs of the axis (the lines where
//!   the largest circles touch the outline), so they run square across an arm and fan where it bends;
//! - where branches meet, the two that go on straightest run through as one column if their widths
//!   go together (the stem and one arm of a Y, the bar of a T); every other branch ends on it, cut
//!   along the junction's own triangle (from notch to notch). Where none goes on straight (the
//!   middle of a star) the junction is a hub: a column of its own, all arms cut off at its edge;
//! - a sharp bend between two long sides (the corner of a U) is cut on the miter, from the pruned
//!   corner outside to the notch inside;
//! - a ring without branches is opened once.
//!
//! The result is cut lines and lines across, as the satin tool draws them by hand (see
//! satinSuggest), so the existing machinery makes the columns, sews them in one chain and the user
//! can change them afterwards.

use serde::Serialize;

use super::medial::{Axis, AxisBranch, AxisNode, leaving, medial_axis};
use crate::geom::Pt;
use crate::js::{IdMap, dist, hypot, max_of};

/// Two branches at a junction run through when they turn less than this (degrees): at a fork of
/// three (a Y) the straightest pair goes on, the hub between them being small; where more meet (a
/// star) only a pair that goes on almost straight (a crossing).
const THROUGH_DEG: f64 = 55.0;
const THROUGH_MANY_DEG: f64 = 25.0;
/// ... and their widths differ by less than this factor.
const THROUGH_WIDTH: f64 = 2.5;
/// A line across every this much along an arm (mm), and where its direction turns by TURN_DEG.
const LINE_STEP: f64 = 2.5;
const TURN_DEG: f64 = 12.0;
/// Ribs shorter than this share of their branch's widest are the fan at a point: no line across there.
const TIP_SHARE: f64 = 0.3;
/// Lines across starting this near where a cut line starts are left out (mm).
const CUT_CLEAR: f64 = 0.25;
/// Two lines across a short part at least this far apart (mm).
const SHORT_APART: f64 = 0.6;
/// Lines across stay this far out of a junction's circle (share of its radius).
const NODE_CLEAR: f64 = 1.05;
/// A column at most this many times the satin limit wide (its long stitches are split, see SatinSettings.split).
const WIDE: f64 = 3.0;

type Line = [Pt; 2];

fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}
fn mid(a: Pt, b: Pt) -> Pt {
    [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}
fn dot(a: Pt, b: Pt) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

/// A chord pulled in a little at both ends, so it starts and ends just inside the outline.
fn inset([a, b]: Line) -> Line {
    let k = 0.01;
    let d = sub(b, a);
    [
        [a[0] + d[0] * k, a[1] + d[1] * k],
        [b[0] - d[0] * k, b[1] - d[1] * k],
    ]
}

#[derive(Clone, Debug, Serialize)]
pub struct InnerPlan {
    pub cuts: Vec<Line>,
    pub lines: Vec<Line>,
    /// The axis it was planned on (for opening a hole still closed, see satinSuggest).
    pub axis: Axis,
}

struct End {
    b: usize,
    at_a: bool,
    dir: Pt,
    w: f64,
}

/// Cut lines and lines across for the area; None when it has no axis to cut along or is too wide for satin.
pub fn plan_inner(
    outsides: &[Vec<Pt>],
    holes: &[Vec<Pt>],
    max: f64,
) -> Result<Option<InnerPlan>, String> {
    let axis = medial_axis(outsides, holes)?;
    Ok(plan_on(axis, max))
}

fn plan_on(axis: Axis, max: f64) -> Option<InnerPlan> {
    let (nodes, branches) = (&axis.nodes, &axis.branches);
    if branches.is_empty() {
        return None;
    }
    let mut degree = vec![0usize; nodes.len()];
    for b in branches {
        degree[b.a] += 1;
        degree[b.b] += 1;
    }
    let mut cuts: Vec<Line> = Vec::new();
    let mut lines: Vec<Line> = Vec::new();
    let mut hubs: Vec<usize> = Vec::new();
    // Branch ends cut off at a junction: no lines across inside its circle there.
    let mut cut_ends = std::collections::HashSet::new();

    for (n, node) in nodes.iter().enumerate() {
        if degree[n] >= 3 {
            // Each end of a branch here (a loop through the node counts twice).
            let mut ends: Vec<End> = Vec::new();
            for (k, b) in branches.iter().enumerate() {
                if b.a != n && b.b != n {
                    continue;
                }
                ends.push(End {
                    b: k,
                    at_a: b.a == n,
                    dir: leaving(b, b.a == n, node.r),
                    w: width_near(b, n == b.a),
                });
                if b.a == n && b.b == n {
                    ends.push(End {
                        b: k,
                        at_a: false,
                        dir: leaving(b, false, node.r),
                        w: width_near(b, false),
                    });
                }
            }
            let pair = through_pair(
                &ends,
                if ends.len() > 3 {
                    THROUGH_MANY_DEG
                } else {
                    THROUGH_DEG
                },
            );
            for (i, e) in ends.iter().enumerate() {
                if pair.is_some_and(|(x, y)| i == x || i == y) {
                    continue;
                }
                let b = &branches[e.b];
                cuts.push(inset(if e.at_a {
                    b.ribs[0]
                } else {
                    b.ribs[b.ribs.len() - 1]
                }));
                cut_ends.insert((e.b, e.at_a));
            }
            if pair.is_none() {
                hubs.push(n);
            }
            continue;
        }
        if degree[n] == 2
            && !node.tips.is_empty()
            && let Some(cut) = miter(&axis, node)
        {
            cuts.push(cut);
        }
    }

    // A loop with no node but its own (a ring): opened once, where it is narrowest.
    for b in branches {
        if b.a != b.b || degree[b.a] != 2 {
            continue;
        }
        let mut k = 0;
        for (i, r) in b.ribs.iter().enumerate() {
            if dist(r[0], r[1]) < dist(b.ribs[k][0], b.ribs[k][1]) {
                k = i;
            }
        }
        cuts.push(inset(b.ribs[k]));
    }

    let mut widest: f64 = 0.0;
    for (k, b) in branches.iter().enumerate() {
        let (made, w) = lines_along(
            b,
            nodes,
            cut_ends.contains(&(k, true)),
            cut_ends.contains(&(k, false)),
        );
        lines.extend(made);
        widest = widest.max(w);
    }
    // A line across that starts where a cut line does would meet it on the outline: which side of
    // the cut it lies on is then a matter of rounding.
    let ends: Vec<Pt> = cuts.iter().flatten().copied().collect();
    let mut apart: Vec<Line> = lines
        .into_iter()
        .filter(|l| {
            l.iter()
                .all(|&q| ends.iter().all(|&e| dist(e, q) > CUT_CLEAR))
        })
        .collect();
    for n in hubs {
        let (hub, width) = hub_lines(&axis, &nodes[n])?;
        apart.extend(hub);
        widest = widest.max(width);
    }
    // An area whose axis is a point (a square, a disc) or that is too wide stays a fill.
    if widest > WIDE * max {
        return None;
    }
    Some(InnerPlan {
        cuts,
        lines: apart,
        axis,
    })
}

/// The width of a branch next to its end (`at_a`: its end a), past the junction's circle.
fn width_near(b: &AxisBranch, at_a: bool) -> f64 {
    let r0 = if at_a { b.r[0] } else { b.r[b.r.len() - 1] };
    let start = if at_a {
        b.pts[0]
    } else {
        b.pts[b.pts.len() - 1]
    };
    let mut ribs: Box<dyn Iterator<Item = &Line>> = if at_a {
        Box::new(b.ribs.iter())
    } else {
        Box::new(b.ribs.iter().rev())
    };
    ribs.find(|r| dist(mid(r[0], r[1]), start) > r0)
        .map_or(2.0 * r0, |r| dist(r[0], r[1]))
}

/// Of the branch ends at a junction, the two that go on straightest when they go together, else None.
fn through_pair(ends: &[End], deg: f64) -> Option<(usize, usize)> {
    let mut best = None;
    let mut best_dot = -(deg * std::f64::consts::PI / 180.0).cos();
    for i in 0..ends.len() {
        for j in i + 1..ends.len() {
            let d = dot(ends[i].dir, ends[j].dir);
            let ratio = ends[i].w.max(ends[j].w) / 1e-6f64.max(ends[i].w.min(ends[j].w));
            if d < best_dot && ratio < THROUGH_WIDTH {
                best_dot = d;
                best = Some((i, j));
            }
        }
    }
    best
}

/// The miter at a bend: from the corner pruned outside through the bend to the farthest point its circle touches.
fn miter(axis: &Axis, node: &AxisNode) -> Option<Line> {
    let tip = node.tips[0];
    let t = node.tris[0];
    let mut far: Option<Pt> = None;
    for k in 0..3 {
        let q = axis.points[axis.tris[3 * t + k]];
        if far.is_none_or(|f| dist(q, tip) > dist(f, tip)) {
            far = Some(q);
        }
    }
    far.map(|f| inset([tip, f]))
}

/// Lines across along a branch: ribs every LINE_STEP and where they turn, not in the fan of a point,
/// and out of the circle of a junction where the branch is cut off (`cut_a`, `cut_b`: at its ends).
fn lines_along(b: &AxisBranch, nodes: &[AxisNode], cut_a: bool, cut_b: bool) -> (Vec<Line>, f64) {
    let lens: Vec<f64> = b.ribs.iter().map(|r| dist(r[0], r[1])).collect();
    let widest = max_of(lens.iter().copied().chain([0.0]));
    // How far a point is out of the circles it has to keep out of (Infinity: none).
    let room = |q: Pt| {
        let a = if cut_a {
            dist(q, nodes[b.a].p) - NODE_CLEAR * nodes[b.a].r
        } else {
            f64::INFINITY
        };
        let c = if cut_b {
            dist(q, nodes[b.b].p) - NODE_CLEAR * nodes[b.b].r
        } else {
            f64::INFINITY
        };
        a.min(c)
    };
    let mut out: Vec<Line> = Vec::new();
    let mut since = f64::INFINITY;
    let mut last_dir: Option<Pt> = None;
    let turn_cos = (TURN_DEG * std::f64::consts::PI / 180.0).cos();
    for i in 0..b.ribs.len() {
        since += dist(b.pts[i], b.pts[i + 1]);
        let r = b.ribs[i];
        if lens[i] < TIP_SHARE * widest || room(mid(r[0], r[1])) <= 0.0 {
            continue;
        }
        let d = sub(r[1], r[0]);
        let l = hypot(d[0], d[1]);
        let l = if l == 0.0 { 1.0 } else { l };
        let dir = [d[0] / l, d[1] / l];
        let turned = last_dir.is_some_and(|ld| dot(dir, ld).abs() < turn_cos);
        if since >= LINE_STEP || turned {
            out.push(inset(r));
            since = 0.0;
            last_dir = Some(dir);
        }
    }
    // A branch cut off at both ends and too short for two lines out of the circles: the two ribs
    // with most room, at least SHORT_APART apart, so the part still has a direction to turn between.
    if out.len() < 2 && cut_a && cut_b {
        let room_of = |i: usize| room(mid(b.ribs[i][0], b.ribs[i][1]));
        let mut sorted: Vec<(f64, usize)> = (0..lens.len())
            .filter(|&i| lens[i] >= TIP_SHARE * widest)
            .map(|i| (room_of(i), i))
            .collect();
        sorted.sort_by(|x, y| y.0.total_cmp(&x.0));
        if let Some(&(_, first)) = sorted.first() {
            let m0 = mid(b.ribs[first][0], b.ribs[first][1]);
            if let Some(&(_, second)) = sorted
                .iter()
                .find(|(_, i)| dist(mid(b.ribs[*i][0], b.ribs[*i][1]), m0) >= SHORT_APART)
            {
                let (x, y) = (first.min(second), first.max(second));
                return (vec![inset(b.ribs[x]), inset(b.ribs[y])], widest);
            }
        }
    }
    (out, widest)
}

/// The outline of a hub: the edges of its triangles that no other of them shares, as one closed line.
fn hub_loop(axis: &Axis, node: &AxisNode) -> Option<Vec<Pt>> {
    let mut count: IdMap<(usize, usize), u32> = IdMap::default();
    let mut edges: Vec<(usize, usize)> = Vec::new();
    for &t in &node.tris {
        for k in 0..3 {
            let a = axis.tris[3 * t + k];
            let b = axis.tris[3 * t + (k + 1) % 3];
            *count.entry((a.min(b), a.max(b))).or_insert(0) += 1;
            edges.push((a, b));
        }
    }
    let outer: Vec<(usize, usize)> = edges
        .into_iter()
        .filter(|&(a, b)| count[&(a.min(b), a.max(b))] == 1)
        .collect();
    if outer.len() < 3 {
        return None;
    }
    // Later edges from the same point win, as with a Map built from the list.
    let mut from: IdMap<usize, usize> = IdMap::default();
    for &(a, b) in &outer {
        from.insert(a, b);
    }
    let mut lp = Vec::new();
    let mut at = outer[0].0;
    for _ in 0..=outer.len() {
        lp.push(axis.points[at]);
        at = *from.get(&at)?;
        if at == outer[0].0 {
            return (lp.len() == outer.len()).then_some(lp);
        }
    }
    None
}

/// The piece of the line through o along d that lies inside the closed line `lp` round o.
fn clip_through(lp: &[Pt], o: Pt, d: Pt) -> Option<Line> {
    let mut lo = f64::NEG_INFINITY;
    let mut hi = f64::INFINITY;
    for i in 0..lp.len() {
        let a = lp[i];
        let b = lp[(i + 1) % lp.len()];
        let e = sub(b, a);
        let den = d[0] * e[1] - d[1] * e[0];
        if den.abs() < 1e-12 {
            continue;
        }
        let w = sub(a, o);
        let t = (w[0] * e[1] - w[1] * e[0]) / den;
        let u = (w[0] * d[1] - w[1] * d[0]) / den;
        if !(0.0..=1.0).contains(&u) {
            continue;
        }
        if t > 0.0 && t < hi {
            hi = t;
        }
        if t < 0.0 && t > lo {
            lo = t;
        }
    }
    if !lo.is_finite() || !hi.is_finite() {
        return None;
    }
    Some(inset([
        [o[0] + d[0] * lo, o[1] + d[1] * lo],
        [o[0] + d[0] * hi, o[1] + d[1] * hi],
    ]))
}

/// Lines across a hub along its narrowest way (the direction of least width, rotating calipers
/// over its corners): the shortest stitches, square to a side of a star's middle. With its width.
fn hub_lines(axis: &Axis, node: &AxisNode) -> Option<(Vec<Line>, f64)> {
    let lp = hub_loop(axis, node)?;
    let hull = convex_hull(&lp);
    // The least width of a convex polygon is across one of its sides.
    let mut best_w = f64::INFINITY;
    let mut best_d: Pt = [1.0, 0.0];
    for i in 0..hull.len() {
        let a = hull[i];
        let b = hull[(i + 1) % hull.len()];
        let l = dist(a, b);
        if l < 1e-9 {
            continue;
        }
        let n = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
        let w = max_of(hull.iter().map(|&p| dot(sub(p, a), n).abs()));
        // Of sides about as narrow (a regular star's middle), stitches upright: the star stays mirror-like.
        let tie = (w - best_w).abs() < 0.02 * w;
        if if tie {
            n[1].abs() > best_d[1].abs()
        } else {
            w < best_w
        } {
            best_w = w.min(best_w);
            best_d = n;
        }
    }
    let d = best_d;
    let e = [-d[1], d[0]];
    let mut c = [0.0, 0.0];
    let len = lp.len() as f64;
    for p in &lp {
        c = [c[0] + p[0] / len, c[1] + p[1] / len];
    }
    let along: Vec<f64> = lp.iter().map(|&p| dot(sub(p, c), e)).collect();
    let lo = along.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = max_of(along.iter().copied());
    let mut lines = Vec::new();
    for f in [0.2, 0.5, 0.8] {
        let s = lo + (hi - lo) * f;
        if let Some(line) = clip_through(&lp, [c[0] + e[0] * s, c[1] + e[1] * s], d) {
            lines.push(line);
        }
    }
    (lines.len() >= 2).then_some((lines, best_w))
}

/// Convex hull (Andrew's monotone chain).
fn convex_hull(pts: &[Pt]) -> Vec<Pt> {
    let mut p = pts.to_vec();
    p.sort_by(|a, b| {
        (a[0] - b[0])
            .partial_cmp(&0.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                (a[1] - b[1])
                    .partial_cmp(&0.0)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });
    let cross = |o: Pt, a: Pt, b: Pt| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut lower: Vec<Pt> = Vec::new();
    for &q in &p {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], q) <= 0.0 {
            lower.pop();
        }
        lower.push(q);
    }
    let mut upper: Vec<Pt> = Vec::new();
    for &q in p.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], q) <= 0.0 {
            upper.pop();
        }
        upper.push(q);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::medial::tests::{U, star};

    #[test]
    fn a_star_gets_a_hub_with_five_arms_cut_off() {
        let plan = plan_inner(&[star(25.0, 25.0, 38.0)], &[], 7.0)
            .unwrap()
            .unwrap();
        assert_eq!(plan.cuts.len(), 5);
        assert!(plan.lines.len() >= 5 + 2);
    }

    #[test]
    fn a_u_is_mitered_at_its_two_corners() {
        let plan = plan_inner(&[U.to_vec()], &[], 7.0).unwrap().unwrap();
        assert_eq!(plan.cuts.len(), 2);
        assert!(plan.lines.len() >= 6);
    }

    #[test]
    fn a_disc_and_a_too_wide_area_stay_fills() {
        let c: Vec<Pt> = (0..90)
            .map(|i| {
                let a = std::f64::consts::TAU * i as f64 / 90.0;
                [5.0 * a.cos(), 5.0 * a.sin()]
            })
            .collect();
        assert!(plan_inner(&[c], &[], 2.0).unwrap().is_none());
        assert!(plan_inner(&[U.to_vec()], &[], 2.0).unwrap().is_none());
    }

    #[test]
    fn the_hull_of_a_square_with_a_point_inside() {
        let h = convex_hull(&[[0.0, 0.0], [1.0, 0.0], [0.5, 0.5], [1.0, 1.0], [0.0, 1.0]]);
        assert_eq!(h.len(), 4);
    }
}
