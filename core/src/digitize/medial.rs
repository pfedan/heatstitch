//! The medial axis of an area on its vector outline, for satin over a whole area (see satin_inner).
//!
//! The discrete Voronoi skeleton of Ogniewicz and Ilg (1992), the method StrokeStyles (Berio et al.,
//! ACM TOG 2022) builds on: the outline is sampled densely, its constrained Delaunay triangulation
//! (shape/cdt) gives the Voronoi diagram of the samples inside the area (a vertex at each
//! triangle's circumcenter, an edge across each inner triangle edge), and of the Voronoi edges only
//! those are kept whose two samples lie far apart along the outline compared to straight across:
//! the chord residual, outline distance minus chord, at least RESIDUAL. That drops the hairs every
//! sample would grow and keeps the axis connected, with one loop round each hole.
//!
//! Each kept edge has its chord: the line between the two samples it is equidistant from, where
//! the largest circle inside the area touches the outline (a rib). Along an arm the ribs are the
//! directions a satin across it takes.
//!
//! Then end branches that hardly reach beyond the circle of the junction they hang from (the
//! corners of a rectangle) are pruned, iteratively (a scale axis criterion, see PROTRUDE), and
//! junctions within each other's circles are joined into one (the middle of a star).

use serde::Serialize;

use super::js::{dist, hypot, max_of};
use crate::geom::Pt;
use crate::shape::cdt::triangulate;

/// Spacing of the outline samples (mm).
const STEP: f64 = 0.15;
/// A Voronoi edge is kept when its two samples are this much farther apart along the outline than across (mm).
const RESIDUAL: f64 = 0.25;
/// An end branch is kept when its circles reach this many junction radii beyond the junction's
/// circle: a 90° corner reaches 0.41, a 60° corner 1, the point of a star more.
const PROTRUDE: f64 = 0.55;

#[derive(Clone, Debug, Serialize)]
pub struct AxisBranch {
    /// Node indices at both ends (equal for a closed loop).
    pub a: usize,
    pub b: usize,
    /// The axis from node a to node b (circumcenters).
    pub pts: Vec<Pt>,
    /// The radius of the largest circle at each point.
    pub r: Vec<f64>,
    /// The rib at each step from pts[i] to pts[i + 1]: where the circles there touch the outline.
    pub ribs: Vec<[Pt; 2]>,
    /// The triangle of each point (its circumcenter).
    pub tris: Vec<usize>,
    /// Identity while pruning (the TypeScript twin compares objects).
    #[serde(skip)]
    id: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct AxisNode {
    pub p: Pt,
    pub r: f64,
    /// The triangles the node stands for: one, or a junction joined from several (a hub).
    pub tris: Vec<usize>,
    /// Ends of branches pruned here (corners beside the axis): where a bend is mitered to.
    pub tips: Vec<Pt>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Axis {
    pub nodes: Vec<AxisNode>,
    pub branches: Vec<AxisBranch>,
    /// The triangulation's points and triangles (three point indices each), for the area of a hub.
    pub points: Vec<Pt>,
    pub tris: Vec<usize>,
}

#[derive(Clone, Copy)]
struct At {
    lp: usize,
    s: f64,
    len: f64,
}

/// The outlines sampled every `step` or less, each point with its loop and distance along it.
fn sampled(loops: &[&Vec<Pt>], step: f64) -> (Vec<Vec<Pt>>, Vec<At>) {
    let mut pts = Vec::new();
    let mut at = Vec::new();
    for (k, l) in loops.iter().enumerate() {
        let ring: &[Pt] = if l.len() > 1 && dist(l[0], l[l.len() - 1]) < 1e-9 {
            &l[..l.len() - 1]
        } else {
            l
        };
        let mut out = Vec::new();
        let mut ss = Vec::new();
        let mut s = 0.0;
        for i in 0..ring.len() {
            let a = ring[i];
            let b = ring[(i + 1) % ring.len()];
            let d = dist(a, b);
            let n = (d / step).ceil().max(1.0) as usize;
            for j in 0..n {
                let jf = j as f64;
                let nf = n as f64;
                out.push([
                    a[0] + ((b[0] - a[0]) * jf) / nf,
                    a[1] + ((b[1] - a[1]) * jf) / nf,
                ]);
                ss.push(s + (d * jf) / nf);
            }
            s += d;
        }
        pts.push(out);
        at.extend(ss.into_iter().map(|x| At {
            lp: k,
            s: x,
            len: s,
        }));
    }
    (pts, at)
}

/// Circumcenter and radius of a triangle.
fn circle(a: Pt, b: Pt, c: Pt) -> (Pt, f64) {
    let bx = b[0] - a[0];
    let by = b[1] - a[1];
    let cx = c[0] - a[0];
    let cy = c[1] - a[1];
    let d = 2.0 * (bx * cy - by * cx);
    let b2 = bx * bx + by * by;
    let c2 = cx * cx + cy * cy;
    let ux = (cy * b2 - by * c2) / d;
    let uy = (bx * c2 - cx * b2) / d;
    ([a[0] + ux, a[1] + uy], hypot(ux, uy))
}

#[derive(Clone, Copy)]
struct Step {
    u: usize,
    e: usize,
}

#[inline]
fn nxt(e: usize) -> usize {
    if e % 3 == 2 { e - 2 } else { e + 1 }
}

/// The medial axis of the area inside `outsides` and outside `holes` (closed lines in mm).
pub fn medial_axis(outsides: &[Vec<Pt>], holes: &[Vec<Pt>]) -> Result<Axis, String> {
    let loops: Vec<&Vec<Pt>> = outsides
        .iter()
        .chain(holes)
        .filter(|l| l.len() > 2)
        .collect();
    let (pts, at) = sampled(&loops, STEP);
    let tr = triangulate(&pts)?;
    let p = &tr.points;
    // Per point of the triangulation: where it lies on the outlines (its first sample).
    let mut wh: Vec<Option<At>> = vec![None; p.len()];
    for (i, &id) in tr.index.iter().enumerate() {
        if wh[id].is_none() {
            wh[id] = Some(at[i]);
        }
    }
    let nt = tr.tris.len() / 3;
    let cc: Vec<(Pt, f64)> = (0..nt)
        .map(|t| {
            circle(
                p[tr.tris[3 * t]],
                p[tr.tris[3 * t + 1]],
                p[tr.tris[3 * t + 2]],
            )
        })
        .collect();
    let twin = |e: usize| tr.twin[e] as usize;
    let edge_key = |e: usize| e.min(twin(e));

    // The Voronoi edges kept by their chord residual.
    let mut adj: Vec<Vec<Step>> = vec![Vec::new(); nt];
    for e in 0..tr.tris.len() {
        let f = tr.twin[e];
        if f < e as i64 || tr.fixed[e] {
            continue;
        }
        let f = f as usize;
        let a = tr.tris[e];
        let b = tr.tris[nxt(e)];
        let mut along = f64::INFINITY;
        if let (Some(wa), Some(wb)) = (wh[a], wh[b])
            && wa.lp == wb.lp
        {
            let d = (wa.s - wb.s).abs();
            along = d.min(wa.len - d);
        }
        if along - dist(p[a], p[b]) < RESIDUAL {
            continue;
        }
        adj[e / 3].push(Step { u: f / 3, e });
        adj[f / 3].push(Step { u: e / 3, e: f });
    }

    // Nodes where the axis ends or branches; branches between them.
    let mut node_of = vec![usize::MAX; nt];
    let mut nodes: Vec<AxisNode> = Vec::new();
    let add_node = |t: usize, nodes: &mut Vec<AxisNode>, node_of: &mut Vec<usize>| {
        node_of[t] = nodes.len();
        nodes.push(AxisNode {
            p: cc[t].0,
            r: cc[t].1,
            tris: vec![t],
            tips: vec![],
        });
    };
    for t in 0..nt {
        if !adj[t].is_empty() && adj[t].len() != 2 {
            add_node(t, &mut nodes, &mut node_of);
        }
    }
    let mut branches: Vec<AxisBranch> = Vec::new();
    let mut used = std::collections::HashSet::new();
    let rib = |e: usize| p[tr.tris[e]];
    let walk = |start: usize,
                first: Step,
                used: &mut std::collections::HashSet<usize>,
                node_of: &[usize],
                branches: &mut Vec<AxisBranch>| {
        let mut pts_out = vec![cc[start].0];
        let mut r = vec![cc[start].1];
        let mut ribs = Vec::new();
        let mut tris = vec![start];
        let mut prev = start;
        let mut step = first;
        for _ in 0..=nt {
            used.insert(edge_key(step.e));
            ribs.push([rib(step.e), rib(nxt(step.e))]);
            let t = step.u;
            pts_out.push(cc[t].0);
            r.push(cc[t].1);
            tris.push(t);
            if node_of[t] != usize::MAX {
                let id = branches.len();
                branches.push(AxisBranch {
                    a: node_of[start],
                    b: node_of[t],
                    pts: pts_out,
                    r,
                    ribs,
                    tris,
                    id,
                });
                return;
            }
            // On through a triangle of the branch: by the other kept edge.
            step = if adj[t][0].u == prev {
                adj[t][1]
            } else {
                adj[t][0]
            };
            prev = t;
        }
    };
    for t in 0..nt {
        if node_of[t] == usize::MAX {
            continue;
        }
        for &x in &adj[t] {
            if !used.contains(&edge_key(x.e)) {
                walk(t, x, &mut used, &node_of, &mut branches);
            }
        }
    }
    // Loops without a branch point (a ring): a node anywhere on them.
    for t in 0..nt {
        if adj[t].len() != 2
            || node_of[t] != usize::MAX
            || adj[t].iter().all(|x| used.contains(&edge_key(x.e)))
        {
            continue;
        }
        add_node(t, &mut nodes, &mut node_of);
        walk(t, adj[t][0], &mut used, &node_of, &mut branches);
    }
    let mut next_id = branches.len();

    // Pruning end branches that hardly reach beyond their junction's circle, again while any does.
    let degree = |branches: &[AxisBranch], n: usize| {
        let mut d = vec![0i64; n];
        for b in branches {
            d[b.a] += 1;
            d[b.b] += 1;
        }
        d
    };
    let mut changed = true;
    while changed {
        changed = false;
        let mut d = degree(&branches, nodes.len());
        // Shortest first, so of two spurs at one corner the lesser goes.
        let mut ends: Vec<(f64, AxisBranch)> = branches
            .iter()
            .filter(|b| b.a != b.b && (d[b.a] == 1) != (d[b.b] == 1))
            .map(|b| (reach(b, &nodes), b.clone()))
            .collect();
        ends.sort_by(|x, y| x.0.total_cmp(&y.0));
        for (rch, b) in ends {
            let j = if d[b.a] == 1 { b.b } else { b.a };
            if d[j] < 2 || rch >= PROTRUDE * nodes[j].r {
                continue;
            }
            let tip = tip_of(&b, j == b.a);
            nodes[j].tips.push(tip);
            branches.retain(|x| x.id != b.id);
            d[b.a] -= 1;
            d[b.b] -= 1;
            changed = true;
        }
        // Nodes left between two branches join them (the bend keeps its pruned tips, see bends).
        for n in 0..nodes.len() {
            let at: Vec<usize> = (0..branches.len())
                .filter(|&k| branches[k].a == n || branches[k].b == n)
                .collect();
            if at.len() != 2 || at.iter().any(|&k| branches[k].a == branches[k].b) {
                continue;
            }
            // A corner pruned here stays a node where the axis bends sharply between two long sides (the
            // corner of a U, mitered there); else (the slanted foot of a leg) the line goes on.
            if !nodes[n].tips.is_empty()
                && is_bend(&nodes[n], &branches[at[0]], &branches[at[1]], &branches, n)
            {
                continue;
            }
            nodes[n].tips.clear();
            let (pb, qb) = (&branches[at[0]], &branches[at[1]]);
            let p_in = if pb.b == n { pb.clone() } else { reversed(pb) };
            let q_out = if qb.a == n { qb.clone() } else { reversed(qb) };
            let mut pts = p_in.pts;
            pts.extend_from_slice(&q_out.pts[1..]);
            let mut r = p_in.r;
            r.extend_from_slice(&q_out.r[1..]);
            let mut ribs = p_in.ribs;
            ribs.extend_from_slice(&q_out.ribs);
            let mut tris = p_in.tris;
            tris.extend_from_slice(&q_out.tris[1..]);
            let joined = AxisBranch {
                a: p_in.a,
                b: q_out.b,
                pts,
                r,
                ribs,
                tris,
                id: next_id,
            };
            next_id += 1;
            branches.remove(at[1]);
            branches.remove(at[0]);
            branches.push(joined);
            changed = true;
        }
    }

    // Junctions within each other's circles are one (the middle of a star, several triangles).
    let mut d = degree(&branches, nodes.len());
    let mut changed = true;
    while changed {
        changed = false;
        for k in 0..branches.len() {
            let (ba, bb) = (branches[k].a, branches[k].b);
            if ba == bb || d[ba] < 3 || d[bb] < 3 {
                continue;
            }
            let (na, nb) = (&nodes[ba], &nodes[bb]);
            if dist(na.p, nb.p) >= na.r.max(nb.r) {
                continue;
            }
            // b.b joins b.a: its branches now start there, the triangles between are the hub's.
            let keep = if na.r >= nb.r { ba } else { bb };
            let gone = if keep == ba { bb } else { ba };
            let bt = &branches[k].tris;
            let inner = bt[1..bt.len() - 1].to_vec();
            let (gt, gtips) = (nodes[gone].tris.clone(), nodes[gone].tips.clone());
            nodes[keep].tris.extend(gt);
            nodes[keep].tris.extend(inner);
            nodes[keep].tips.extend(gtips);
            branches.remove(k);
            for x in &mut branches {
                if x.a == gone {
                    x.a = keep;
                }
                if x.b == gone {
                    x.b = keep;
                }
            }
            d[keep] += d[gone] - 2;
            d[gone] = 0;
            changed = true;
            break;
        }
    }
    // Nodes no branch uses any more are left out, the others numbered anew.
    let mut new_of = vec![usize::MAX; nodes.len()];
    let mut out: Vec<AxisNode> = Vec::new();
    for b in &branches {
        for n in [b.a, b.b] {
            if new_of[n] == usize::MAX {
                new_of[n] = out.len();
                out.push(nodes[n].clone());
            }
        }
    }
    // An area whose axis was pruned to nothing (a square, a disc): its middle as one node.
    if out.is_empty() && nt > 0 {
        let mut best = 0;
        for t in 1..nt {
            if cc[t].1 > cc[best].1 && !adj[t].is_empty() {
                best = t;
            }
        }
        out.push(AxisNode {
            p: cc[best].0,
            r: cc[best].1,
            tris: vec![best],
            tips: vec![],
        });
    }
    for b in &mut branches {
        b.a = new_of[b.a];
        b.b = new_of[b.b];
    }
    Ok(Axis {
        nodes: out,
        branches,
        points: tr.points,
        tris: tr.tris,
    })
}

/// A bend at least this sharp (degrees) between two sides is mitered.
pub const BEND_DEG: f64 = 45.0;

/// The direction a branch leaves node n in, over about the node's radius (`from_a`: it leaves
/// from its end a, else from its end b).
pub fn leaving(b: &AxisBranch, from_a: bool, r: f64) -> Pt {
    let pts: Vec<Pt> = if from_a {
        b.pts.clone()
    } else {
        b.pts.iter().rev().copied().collect()
    };
    let reach_mm = r.max(0.5);
    let mut q = pts[pts.len() - 1];
    for &pt in &pts[1..] {
        if dist(pt, pts[0]) >= reach_mm {
            q = pt;
            break;
        }
    }
    let l = dist(q, pts[0]);
    let l = if l == 0.0 || l.is_nan() { 1.0 } else { l };
    [(q[0] - pts[0][0]) / l, (q[1] - pts[0][1]) / l]
}

/// Whether node n between branches p and q is a sharp bend with a long side either way (not a free end close by).
fn is_bend(node: &AxisNode, p: &AxisBranch, q: &AxisBranch, all: &[AxisBranch], n: usize) -> bool {
    let u = leaving(p, p.a == n, node.r);
    let v = leaving(q, q.a == n, node.r);
    let turn = 180.0
        - ((u[0] * v[0] + u[1] * v[1]).clamp(-1.0, 1.0).acos() * 180.0) / std::f64::consts::PI;
    if turn < BEND_DEG {
        return false;
    }
    // A side ending freely within the node's circle and a radius more is the end of the line, not a side.
    let free = |b: &AxisBranch| {
        let other = if b.a == n { b.b } else { b.a };
        if all
            .iter()
            .any(|x| x.id != b.id && (x.a == other || x.b == other))
        {
            return false;
        }
        max_of(b.pts.iter().map(|&pt| dist(pt, node.p))) < 2.0 * node.r
    };
    !free(p) && !free(q)
}

/// How far the circles of an end branch reach beyond the circle of its junction (mm).
fn reach(b: &AxisBranch, nodes: &[AxisNode]) -> f64 {
    // The junction is the end that is not free; either end may be, so both are tried.
    let beyond =
        |n: &AxisNode| max_of(b.pts.iter().zip(&b.r).map(|(&p, &r)| dist(p, n.p) + r)) - n.r;
    beyond(&nodes[b.a]).min(beyond(&nodes[b.b]))
}

/// The farthest point an end branch reaches from its junction (`from_a`: the junction is its end a).
fn tip_of(b: &AxisBranch, from_a: bool) -> Pt {
    let end = if from_a { b.pts.len() - 1 } else { 0 };
    let rib = if from_a {
        b.ribs.last()
    } else {
        b.ribs.first()
    };
    // At the free end the two samples of the last rib lie either side of the corner: their middle.
    rib.map_or(b.pts[end], |r| {
        [(r[0][0] + r[1][0]) / 2.0, (r[0][1] + r[1][1]) / 2.0]
    })
}

pub fn reversed(b: &AxisBranch) -> AxisBranch {
    AxisBranch {
        a: b.b,
        b: b.a,
        pts: b.pts.iter().rev().copied().collect(),
        r: b.r.iter().rev().copied().collect(),
        ribs: b.ribs.iter().rev().map(|[x, y]| [*y, *x]).collect(),
        tris: b.tris.iter().rev().copied().collect(),
        id: b.id,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A five-pointed star `size` mm wide (tip to tip), its points R from the middle and its notches at 0.382 R.
    pub fn star(cx: f64, cy: f64, size: f64) -> Vec<Pt> {
        let big = size / 2.0 / (18f64.to_radians()).cos();
        (0..10)
            .map(|i| {
                let a = -std::f64::consts::FRAC_PI_2 + i as f64 * std::f64::consts::PI / 5.0;
                let r = if i % 2 == 1 { 0.382 * big } else { big };
                [cx + r * a.cos(), cy + r * a.sin()]
            })
            .collect()
    }

    pub const U: [Pt; 8] = [
        [5.0, 5.0],
        [45.0, 5.0],
        [45.0, 35.0],
        [33.0, 35.0],
        [33.0, 15.0],
        [17.0, 15.0],
        [17.0, 35.0],
        [5.0, 35.0],
    ];

    fn degree_of(ax: &Axis, n: usize) -> usize {
        ax.branches
            .iter()
            .map(|b| usize::from(b.a == n) + usize::from(b.b == n))
            .sum()
    }

    #[test]
    fn a_star_has_five_arms_meeting_in_its_middle() {
        let ax = medial_axis(&[star(25.0, 25.0, 38.0)], &[]).unwrap();
        assert_eq!(ax.branches.len(), 5);
        let hub = (0..ax.nodes.len())
            .find(|&n| degree_of(&ax, n) == 5)
            .unwrap();
        let h = &ax.nodes[hub];
        assert!((h.p[0] - 25.0).hypot(h.p[1] - 25.0) < 0.3);
        assert!((h.r - 0.382 * (19.0 / 18f64.to_radians().cos())).abs() < 0.5);
    }

    #[test]
    fn a_rectangle_is_pruned_to_one_branch_and_a_u_keeps_its_bends() {
        let rect = medial_axis(
            &[vec![[0.0, 0.0], [20.0, 0.0], [20.0, 10.0], [0.0, 10.0]]],
            &[],
        )
        .unwrap();
        assert_eq!(rect.branches.len(), 1);
        let u = medial_axis(&[U.to_vec()], &[]).unwrap();
        assert_eq!(u.branches.len(), 3);
        assert!(u.nodes.iter().filter(|n| !n.tips.is_empty()).count() >= 2);
    }

    #[test]
    fn a_ring_is_one_loop_and_a_disc_one_node() {
        let c = |r: f64, n: usize| -> Vec<Pt> {
            (0..n)
                .map(|i| {
                    let a = std::f64::consts::TAU * i as f64 / n as f64;
                    [r * a.cos(), r * a.sin()]
                })
                .collect()
        };
        let ring = medial_axis(&[c(10.0, 90)], &[c(6.0, 90)]).unwrap();
        assert_eq!(ring.branches.len(), 1);
        assert_eq!(ring.branches[0].a, ring.branches[0].b);
        // All circles of a regular polygon meet in its middle: what is left of the axis is there.
        let disc = medial_axis(&[c(5.0, 90)], &[]).unwrap();
        assert!(
            disc.nodes
                .iter()
                .all(|n| n.p[0].hypot(n.p[1]) < 0.01 && n.r > 4.9)
        );
    }
}
