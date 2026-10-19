//! Centerlines of narrow regions, for satin columns and running stitch.
//!
//! Thinning in the order of the distance transform (as scikit-image's medial_axis): pixels are
//! removed from the outside in, only where removing them keeps the region 8-connected, and line ends
//! are kept. The result lies on the ridge of the distance field and keeps the topology (a ring stays
//! a ring). The pixel skeleton becomes a graph of nodes (ends, junctions) and branches; side branches
//! that are short against the local width (spurs from corners and outline noise) are pruned, the
//! criterion the Goldman patent and the integer medial axis pruning (Hesselink & Roerdink 2008) use.

use serde::{Deserialize, Serialize};

use super::region::{Region, pixel_mm};
use crate::geom::Pt;
use crate::image::edt::distance_inside;
use crate::js::{dist, max_of, round};

/// Gaps inside a region smaller than this (mm²) are not holes: the outline drops them too.
const HOLE_MIN_MM2: f64 = 0.25;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Branch {
    /// Node indices at both ends (equal for a closed loop).
    pub a: usize,
    pub b: usize,
    /// Centerline in image mm from node a to node b.
    pub pts: Vec<Pt>,
    /// Half width (mm) at each point.
    pub r: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub p: Pt,
    pub r: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub branches: Vec<Branch>,
}

// Neighbour offsets, counterclockwise from east: x1..x8 of the connectivity number.
const NX: [isize; 8] = [1, 1, 0, -1, -1, -1, 0, 1];
const NY: [isize; 8] = [0, -1, -1, -1, 0, 1, 1, 1];

/// Yokoi 8-connectivity number per neighbourhood byte: 1 means removing the pixel keeps the topology.
const SIMPLE: [bool; 256] = {
    const fn x(m: usize, k: usize) -> i32 {
        1 - ((m >> (k % 8)) & 1) as i32
    }
    let mut t = [false; 256];
    let mut m = 0;
    while m < 256 {
        let mut n = 0;
        let mut k = 0;
        while k < 8 {
            n += x(m, k) - x(m, k) * x(m, k + 1) * x(m, k + 2);
            k += 2;
        }
        t[m] = n == 1;
        m += 1;
    }
    t
};

/// Index of the neighbour of pixel i in direction d, if inside the buffer.
#[inline]
fn nb(i: usize, d: usize, w: usize) -> Option<usize> {
    let q = i as isize + NY[d] * w as isize + NX[d];
    (q >= 0).then_some(q as usize)
}

#[inline]
fn at(s: &[u8], q: Option<usize>) -> bool {
    q.and_then(|q| s.get(q)).is_some_and(|&v| v != 0)
}

fn neighbour_byte(s: &[u8], w: usize, i: usize) -> u32 {
    let mut m = 0;
    for k in 0..8 {
        if at(s, nb(i, k, w)) {
            m |= 1 << k;
        }
    }
    m
}

/// One of the two pixels at the end of a ridge two pixels wide (a line an even number of pixels
/// wide): its three neighbours side by side in one corner, none farther inside. Thinned in index
/// order, a vertical such line would otherwise be eaten from its end, pixel pair by pixel pair, in
/// one pass (each pair ending it in turn), and the line lost. Kept until its twin is gone.
fn tip(r: &Region, i: usize, m: u32) -> bool {
    if m.count_ones() != 3 {
        return false;
    }
    let Some(k) = [1usize, 3, 5, 7]
        .into_iter()
        .find(|&c| m == ((7u32 << (c - 1)) | (7u32 >> (9 - c))) % 256)
    else {
        return false;
    };
    for d in [k + 7, k + 8, k + 9] {
        let n = d % 8;
        if nb(i, n, r.w)
            .and_then(|q| r.inside.get(q))
            .is_some_and(|&v| v > r.inside[i])
        {
            return false;
        }
    }
    true
}

/// One-pixel skeleton of the region mask (the mask has an empty margin).
pub fn thin(r: &Region) -> Vec<u8> {
    let mut s = r.mask.clone();
    let mut order: Vec<usize> = (0..s.len()).filter(|&i| s[i] != 0).collect();
    order.sort_by(|&a, &b| r.inside[a].total_cmp(&r.inside[b]));
    let mut changed = true;
    while changed {
        changed = false;
        for &i in &order {
            if s[i] == 0 {
                continue;
            }
            let m = neighbour_byte(&s, r.w, i);
            if m.count_ones() <= 1 || !SIMPLE[m as usize] || tip(r, i, m) {
                continue;
            }
            s[i] = 0;
            changed = true;
        }
    }
    s
}

struct Edge {
    a: usize,
    b: usize,
    px: Vec<usize>,
}

/// Walk order: the 4-neighbours first so diagonal staircases are not cut short twice.
const WALK: [usize; 8] = [0, 2, 4, 6, 1, 3, 5, 7];

/// Turns the pixel skeleton into nodes and branches (pixel indices).
fn trace(s: &[u8], w: usize) -> (Vec<Vec<usize>>, Vec<Edge>) {
    let n = s.len();
    let set = |q: Option<usize>| at(s, q);
    let mut deg = vec![0u32; n];
    for i in 0..n {
        if s[i] != 0 {
            deg[i] = neighbour_byte(s, w, i).count_ones();
        }
    }
    // Node pixels: ends and junctions; touching junction pixels form one node.
    let mut node_of = vec![-1i64; n];
    let mut nodes: Vec<Vec<usize>> = Vec::new();
    for i in 0..n {
        if s[i] == 0 || node_of[i] >= 0 || deg[i] == 2 {
            continue;
        }
        let id = nodes.len() as i64;
        let mut cluster = vec![i];
        node_of[i] = id;
        if deg[i] >= 3 {
            let mut k = 0;
            while k < cluster.len() {
                let p = cluster[k];
                for d in 0..8 {
                    if let Some(q) = nb(p, d, w)
                        && set(Some(q))
                        && deg[q] >= 3
                        && node_of[q] < 0
                    {
                        node_of[q] = id;
                        cluster.push(q);
                    }
                }
                k += 1;
            }
        }
        nodes.push(cluster);
    }
    let mut used = vec![false; n];
    let mut edges: Vec<Edge> = Vec::new();
    let mut seen_direct = std::collections::HashSet::new();
    let walk = |start: usize,
                from: usize,
                node: i64,
                used: &mut Vec<bool>,
                node_of: &[i64]|
     -> Option<(usize, Vec<usize>)> {
        let mut px = vec![start];
        used[start] = true;
        let mut prev = from;
        let mut cur = start;
        loop {
            let mut next = None;
            for d in WALK {
                let Some(q) = nb(cur, d, w) else { continue };
                if !set(Some(q)) || q == prev || (node_of[q] == node && px.len() == 1 && q == from)
                {
                    continue;
                }
                if node_of[q] >= 0 && !(node_of[q] == node && px.len() < 2) {
                    next = Some(q);
                    break;
                }
                if node_of[q] < 0 && !used[q] {
                    next = Some(q);
                    break;
                }
            }
            let next = next?;
            if node_of[next] >= 0 {
                return Some((node_of[next] as usize, px));
            }
            used[next] = true;
            px.push(next);
            prev = cur;
            cur = next;
        }
    };
    for id in 0..nodes.len() {
        for ci in 0..nodes[id].len() {
            let p = nodes[id][ci];
            for d in 0..8 {
                let Some(q) = nb(p, d, w) else { continue };
                if !set(Some(q)) || node_of[q] == id as i64 {
                    continue;
                }
                if node_of[q] >= 0 {
                    let o = node_of[q] as usize;
                    if seen_direct.insert((id.min(o), id.max(o))) {
                        edges.push(Edge {
                            a: id,
                            b: o,
                            px: vec![],
                        });
                    }
                    continue;
                }
                if used[q] {
                    continue;
                }
                if let Some((b, px)) = walk(q, p, id as i64, &mut used, &node_of) {
                    edges.push(Edge { a: id, b, px });
                }
            }
        }
    }
    // What is left are rings without any node: start a node anywhere on them.
    for i in 0..n {
        if s[i] == 0 || used[i] || node_of[i] >= 0 {
            continue;
        }
        let id = nodes.len();
        nodes.push(vec![i]);
        node_of[i] = id as i64;
        let mut px = vec![];
        let mut prev = i;
        let mut cur = i;
        loop {
            let next = WALK
                .iter()
                .filter_map(|&d| nb(cur, d, w))
                .find(|&q| set(Some(q)) && q != prev && !used[q] && node_of[q] < 0);
            let Some(next) = next else { break };
            used[next] = true;
            px.push(next);
            prev = cur;
            cur = next;
        }
        edges.push(Edge { a: id, b: id, px });
    }
    (nodes, edges)
}

/// Length of a polyline.
pub fn polyline_length(pts: &[Pt]) -> f64 {
    let mut l = 0.0;
    for i in 1..pts.len() {
        l += dist(pts[i - 1], pts[i]);
    }
    l
}

/// Gaussian smoothing over `sigma` points (the points are about evenly spaced). Open polylines keep
/// their ends, and the window shrinks symmetrically towards them; a closed loop wraps around (its
/// last point repeats the first).
pub fn smooth(pts: &[Pt], sigma: f64, closed: bool) -> Vec<Pt> {
    let n = if closed {
        pts.len().saturating_sub(1)
    } else {
        pts.len()
    };
    if n < 3 {
        return pts.to_vec();
    }
    let kk = (2.5 * sigma).ceil() as i64;
    let ni = n as i64;
    let mut out: Vec<Pt> = (0..ni)
        .map(|i| {
            if !closed && (i == 0 || i == ni - 1) {
                return pts[i as usize];
            }
            let k = if closed {
                kk
            } else {
                kk.min(i).min(ni - 1 - i)
            };
            let (mut sx, mut sy, mut sw) = (0.0, 0.0, 0.0);
            for j in -k..=k {
                let q = pts[if closed {
                    (i + j).rem_euclid(ni)
                } else {
                    i + j
                } as usize];
                let wt = (-((j * j) as f64) / (2.0 * sigma * sigma)).exp();
                sx += q[0] * wt;
                sy += q[1] * wt;
                sw += wt;
            }
            [sx / sw, sy / sw]
        })
        .collect();
    if closed {
        out.push(out[0]);
    }
    out
}

/// The region with its pinholes filled: gaps inside it too small to count as holes (the outline
/// drops them, see areaLoops), from a speckled scan or a raw threshold. Each would otherwise become
/// a ring in the skeleton, and a line hundreds of little rings.
fn without_pinholes(r: &Region) -> Option<Region> {
    let limit = HOLE_MIN_MM2 / (r.px_mm * r.px_mm);
    let mut seen = vec![false; r.mask.len()];
    let mut mask = r.mask.clone();
    let mut filled = false;
    let mut gap = Vec::new();
    for i in 0..mask.len() {
        if mask[i] != 0 || seen[i] {
            continue;
        }
        // One gap, 4-connected (the region is 8-connected, so its gaps are 4-connected).
        gap.clear();
        gap.push(i);
        seen[i] = true;
        let mut open = false;
        let mut k = 0;
        while k < gap.len() {
            let j = gap[k];
            k += 1;
            let (x, y) = (j % r.w, j / r.w);
            if x == 0 || y == 0 || x == r.w - 1 || y == r.h - 1 {
                open = true;
                continue;
            }
            for n in [j - 1, j + 1, j - r.w, j + r.w] {
                if mask[n] != 0 || seen[n] {
                    continue;
                }
                seen[n] = true;
                gap.push(n);
            }
        }
        if open || gap.len() as f64 >= limit {
            continue;
        }
        for &j in &gap {
            mask[j] = 1;
        }
        filled = true;
    }
    filled.then(|| {
        let inside = distance_inside(&mask, r.w, r.h);
        Region {
            mask,
            inside,
            ..r.clone()
        }
    })
}

/// Skeleton graph of the region in image mm: pruned and smoothed, each branch with its half width.
pub fn skeleton(area: &Region) -> Graph {
    let filled = without_pinholes(area);
    let r = filled.as_ref().unwrap_or(area);
    let s = thin(r);
    let (pix_nodes, edges) = trace(&s, r.w);
    let pm = |i: usize| pixel_mm(r, i % r.w, i / r.w);
    let half = |i: usize| (f64::from(r.inside[i]) - 0.5).max(0.5) * r.px_mm;
    let nodes: Vec<Node> = pix_nodes
        .iter()
        .map(|c| {
            let (mut x, mut y) = (0.0, 0.0);
            for &i in c {
                let p = pm(i);
                x += p[0];
                y += p[1];
            }
            let n = c.len() as f64;
            Node {
                p: [x / n, y / n],
                r: max_of(c.iter().map(|&i| half(i))),
            }
        })
        .collect();
    let mut branches: Vec<Branch> = edges
        .iter()
        .map(|e| {
            let mut pts = vec![nodes[e.a].p];
            pts.extend(e.px.iter().map(|&i| pm(i)));
            pts.push(nodes[e.b].p);
            let mut rr = vec![nodes[e.a].r];
            rr.extend(e.px.iter().map(|&i| half(i)));
            rr.push(nodes[e.b].r);
            Branch {
                a: e.a,
                b: e.b,
                pts,
                r: rr,
            }
        })
        .collect();

    // Prune spurs: an end branch shorter than 1.5 local radii of its junction plus two pixels.
    let mut changed = true;
    while changed {
        changed = false;
        let mut degree = vec![0i64; nodes.len()];
        for b in &branches {
            degree[b.a] += 1;
            degree[b.b] += 1;
        }
        let mut keep = Vec::with_capacity(branches.len());
        for b in branches {
            if b.a == b.b {
                keep.push(b);
                continue;
            }
            let end_a = degree[b.a] == 1;
            let end_b = degree[b.b] == 1;
            let junction = if end_a && !end_b {
                Some(b.b)
            } else if end_b && !end_a {
                Some(b.a)
            } else {
                None
            };
            if let Some(j) = junction
                && polyline_length(&b.pts) < 1.5 * nodes[j].r + 2.0 * r.px_mm
            {
                degree[b.a] -= 1;
                degree[b.b] -= 1;
                changed = true;
                continue;
            }
            keep.push(b);
        }
        branches = keep;
        // Join the two branches at nodes that are left with degree 2.
        for n in 0..nodes.len() {
            let at: Vec<usize> = (0..branches.len())
                .filter(|&k| branches[k].a == n || branches[k].b == n)
                .collect();
            if at.len() != 2 || at.iter().any(|&k| branches[k].a == branches[k].b) {
                continue;
            }
            let (p, q) = (&branches[at[0]], &branches[at[1]]);
            let p_in = if p.b == n { p.clone() } else { reverse(p) };
            let q_out = if q.a == n { q.clone() } else { reverse(q) };
            let mut pts = p_in.pts;
            pts.extend_from_slice(&q_out.pts[1..]);
            let mut rr = p_in.r;
            rr.extend_from_slice(&q_out.r[1..]);
            let joined = Branch {
                a: p_in.a,
                b: q_out.b,
                pts,
                r: rr,
            };
            branches.remove(at[1]);
            branches.remove(at[0]);
            branches.push(joined);
            changed = true;
        }
    }
    // Thinning can run a line end out into one corner of the shape (a thin diagonal tail). Free ends
    // lose their thin tail; the satin extends them along their direction to the edge again.
    let mut degree = vec![0; nodes.len()];
    for b in &branches {
        degree[b.a] += 1;
        degree[b.b] += 1;
    }
    let branches = branches
        .into_iter()
        .map(|b| {
            let (free_a, free_b) = (degree[b.a] == 1, degree[b.b] == 1);
            if b.a == b.b {
                b
            } else {
                trim_tails(b, free_a, free_b)
            }
        })
        // Smooth the centerlines and resample them evenly (0.1 mm).
        .map(|b| {
            let closed = b.a == b.b;
            let sm = smooth(&b.pts, 0.35 / r.px_mm, closed);
            let (pts, rr) = resample(&sm, &smooth1(&b.r, 3), 0.1);
            Branch { pts, r: rr, ..b }
        })
        .collect();
    Graph { nodes, branches }
}

/// Drops points at free ends where the branch is thinner than half its median width.
fn trim_tails(b: Branch, free_a: bool, free_b: bool) -> Branch {
    let mut sorted = b.r.clone();
    sorted.sort_by(f64::total_cmp);
    let limit = sorted[sorted.len() >> 1] / 2.0;
    // At most a third of the branch from each end.
    let most = b.pts.len() / 3;
    let mut i = 0;
    let mut j = b.pts.len() - 1;
    if free_a {
        while i < most && b.r[i] < limit {
            i += 1;
        }
    }
    if free_b {
        while b.pts.len() - 1 - j < most && b.r[j] < limit {
            j -= 1;
        }
    }
    if j as i64 - (i as i64) < 1 {
        return b;
    }
    Branch {
        pts: b.pts[i..=j].to_vec(),
        r: b.r[i..=j].to_vec(),
        ..b
    }
}

pub fn reverse(b: &Branch) -> Branch {
    Branch {
        a: b.b,
        b: b.a,
        pts: b.pts.iter().rev().copied().collect(),
        r: b.r.iter().rev().copied().collect(),
    }
}

/// Moving average over 2k+1 values.
fn smooth1(v: &[f64], k: usize) -> Vec<f64> {
    (0..v.len())
        .map(|i| {
            let lo = i.saturating_sub(k);
            let hi = (v.len() - 1).min(i + k);
            let mut s = 0.0;
            for x in &v[lo..=hi] {
                s += x;
            }
            s / (hi - lo + 1) as f64
        })
        .collect()
}

/// Resamples a polyline (with a value per point) at even arc length steps.
pub fn resample(pts: &[Pt], vals: &[f64], step: f64) -> (Vec<Pt>, Vec<f64>) {
    if pts.len() < 2 {
        return (pts.to_vec(), vals.to_vec());
    }
    let total = polyline_length(pts);
    let n = round(total / step).max(1.0) as usize;
    let mut out = vec![pts[0]];
    let mut r = vec![vals[0]];
    let mut seg = 0;
    let mut seg_start = 0.0;
    let mut seg_len = dist(pts[0], pts[1]);
    for k in 1..=n {
        let s = (k as f64 / n as f64) * total;
        while seg < pts.len() - 2 && seg_start + seg_len < s {
            seg_start += seg_len;
            seg += 1;
            seg_len = dist(pts[seg], pts[seg + 1]);
        }
        let t = if seg_len > 0.0 {
            ((s - seg_start) / seg_len).min(1.0)
        } else {
            0.0
        };
        let (a, b) = (pts[seg], pts[seg + 1]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        r.push(vals[seg] + (vals[seg + 1] - vals[seg]) * t);
    }
    (out, r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    #[test]
    fn a_bar_has_one_centerline_with_its_half_width() {
        // 20 × 2 mm bar.
        let r = region_of(260, 0.1, |x, y| {
            (3.0..23.0).contains(&x) && (5.0..7.0).contains(&y)
        });
        let g = skeleton(&r);
        assert_eq!(g.branches.len(), 1);
        let b = &g.branches[0];
        assert!(polyline_length(&b.pts) > 17.0);
        // Away from the ends, where thinning runs out into a corner.
        for (p, w) in b
            .pts
            .iter()
            .zip(&b.r)
            .filter(|(p, _)| (5.0..21.0).contains(&p[0]))
        {
            assert!((p[1] - 6.0).abs() < 0.1);
            assert!(*w > 0.3 && *w < 1.1);
        }
    }

    #[test]
    fn a_ring_stays_a_ring_and_a_plus_has_four_arms() {
        let ring = region_of(200, 0.1, |x, y| {
            (3.0..4.0).contains(&(x - 10.0).hypot(y - 10.0))
        });
        let g = skeleton(&ring);
        assert_eq!(g.branches.len(), 1);
        assert_eq!(g.branches[0].a, g.branches[0].b);
        let plus = region_of(200, 0.1, |x, y| {
            ((x - 10.0).abs() < 0.6 && (y - 10.0).abs() < 8.0)
                || ((y - 10.0).abs() < 0.6 && (x - 10.0).abs() < 8.0)
        });
        let g = skeleton(&plus);
        assert_eq!(g.branches.len(), 4);
    }

    #[test]
    fn pinholes_do_not_become_rings() {
        let r = region_of(200, 0.1, |x, y| {
            (2.0..18.0).contains(&x)
                && (8.0..11.0).contains(&y)
                && !((x - 10.05).abs() < 0.1 && (y - 9.55).abs() < 0.1)
        });
        let g = skeleton(&r);
        assert!(g.branches.iter().all(|b| b.a != b.b));
    }

    #[test]
    fn smoothing_keeps_ends_and_resampling_is_even() {
        let pts: Vec<Pt> = (0..10)
            .map(|i| [i as f64, if i % 2 == 0 { 0.0 } else { 1.0 }])
            .collect();
        let s = smooth(&pts, 1.0, false);
        assert_eq!(s[0], pts[0]);
        assert_eq!(s[9], pts[9]);
        assert!(s[5][1] > 0.2 && s[5][1] < 0.8);
        let (rs, vals) = resample(&[[0.0, 0.0], [1.0, 0.0]], &[0.0, 1.0], 0.25);
        assert_eq!(rs.len(), 5);
        assert_eq!(vals[2], 0.5);
        assert_eq!(
            reverse(&Branch {
                a: 0,
                b: 1,
                pts: rs.clone(),
                r: vals
            })
            .pts[0],
            rs[4]
        );
    }

    #[test]
    fn smoothing_and_resampling_as_in_typescript() {
        let curve: Vec<Pt> = (0..81)
            .map(|i| {
                [
                    i as f64 / 4.0,
                    (i * i) as f64 / 160.0 + (i % 3) as f64 * 0.01,
                ]
            })
            .collect();
        let close = |a: Pt, b: Pt| (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12;
        assert!(close(
            smooth(&curve, 2.5, false)[7],
            [1.7500000000000002, 0.3543125947080991]
        ));
        let ring = smooth(
            &[[0.0, 0.0], [4.0, 0.0], [4.0, 3.0], [1.0, 4.0], [0.0, 0.0]],
            1.0,
            true,
        );
        let ts = [
            [1.6643910487361064, 1.309910605939919],
            [2.6900893940600805, 1.17145249363339],
            [2.8285475063666095, 2.183027949162797],
            [1.816972050837203, 2.3356089512638936],
            [1.6643910487361064, 1.309910605939919],
        ];
        assert!(ring.iter().zip(&ts).all(|(a, b)| close(*a, *b)));
        let vals: Vec<f64> = curve.iter().map(|p| p[1]).collect();
        let (pts, r) = resample(&curve, &vals, 0.7);
        assert_eq!(
            (pts.len(), pts[13], r[13]),
            (
                67,
                [7.1597859938298205, 5.144086480960687],
                5.144086480960687
            )
        );
        assert_eq!(polyline_length(&curve), 46.48477924786446);
    }
}
