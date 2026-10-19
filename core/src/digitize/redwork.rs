//! Redwork: a drawing of many lines sewn in one go, each line exactly twice (there and back),
//! without a trim inside a connected part.
//!
//! 1. The lines are made a planar graph: split where they cross or touch, and where lines that do
//!    not touch come within `snap` of each other a straight piece bridges the gap.
//! 2. Every edge doubled, one copy each way: in the symmetric graph every node has as many ways in
//!    as out, so it has an Euler circuit (Euler, Hierholzer) in every connected part.
//! 3. The circuit taken is Tarry's depth first traversal (G. Tarry 1895, the classic maze walk that
//!    goes every edge once in each direction): an edge is left back the way it came only once all
//!    edges beyond it are sewn. So the first pass over an edge lies below and its return comes as
//!    late as it can, on top. At each node the walk goes on as straight as it can, so the first pass
//!    follows the drawn lines.
//!
//! Parts that do not touch are sewn one after the other, each from its node nearest the needle,
//! with a jump (and a trim when far) between them. The stitches along each edge are made by the
//! caller (digitize/redwork.ts), from the graph and the walks.
//!
//! Maps iterate in the order keys were first set, as JavaScript's Map and Set do: ties between
//! equal choices then go the same way as in TypeScript.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::geom::Pt;
use crate::js::dist;

/// Points this close (mm) are one node: crossings found twice, ends that meet.
const MERGE: f64 = 0.05;
/// Nodes this close (mm) along a line between them are one: about a stitch too short to sew (see contract).
const NODE: f64 = 0.5;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RedworkLine {
    pub pts: Vec<Pt>,
    pub closed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RedworkEdge {
    pub a: usize,
    pub b: usize,
    pub pts: Vec<Pt>,
}

/// The graph of the lines: nodes and the edges between them, each a polyline from node a to node b.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RedworkGraph {
    pub nodes: Vec<Pt>,
    pub edges: Vec<RedworkEdge>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Step {
    pub edge: usize,
    pub back: bool,
}

/// A map that iterates in insertion order (a key set again keeps its place; deleted and set again,
/// it goes to the end), as JavaScript's Map.
struct OrderedMap<K, V> {
    at: HashMap<K, usize>,
    slots: Vec<Option<(K, V)>>,
    len: usize,
}

impl<K: std::hash::Hash + Eq + Copy, V> OrderedMap<K, V> {
    fn new() -> Self {
        OrderedMap {
            at: HashMap::new(),
            slots: Vec::new(),
            len: 0,
        }
    }
    fn set(&mut self, k: K, v: V) {
        if let Some(&i) = self.at.get(&k) {
            self.slots[i] = Some((k, v));
        } else {
            self.at.insert(k, self.slots.len());
            self.slots.push(Some((k, v)));
            self.len += 1;
        }
    }
    fn get(&self, k: &K) -> Option<&V> {
        self.at
            .get(k)
            .and_then(|&i| self.slots[i].as_ref().map(|s| &s.1))
    }
    fn get_mut(&mut self, k: &K) -> Option<&mut V> {
        let i = *self.at.get(k)?;
        self.slots[i].as_mut().map(|s| &mut s.1)
    }
    fn delete(&mut self, k: &K) {
        if let Some(i) = self.at.remove(k) {
            self.slots[i] = None;
            self.len -= 1;
        }
    }
    fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.slots.iter().flatten().map(|(k, v)| (k, v))
    }
    fn values(&self) -> impl Iterator<Item = &V> {
        self.iter().map(|(_, v)| v)
    }
}

/// Points within MERGE as one: a grid of cells MERGE wide, looked up in the cell and its neighbours.
#[derive(Default)]
struct Points {
    list: Vec<Pt>,
    cells: HashMap<(i64, i64), Vec<usize>>,
}

impl Points {
    fn id(&mut self, q: Pt) -> usize {
        let cx = (q[0] / MERGE).floor() as i64;
        let cy = (q[1] / MERGE).floor() as i64;
        let mut best: Option<usize> = None;
        let mut bd = MERGE;
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(c) = self.cells.get(&(cx + dx, cy + dy)) {
                    for &i in c {
                        let d = dist(self.list[i], q);
                        if d < bd {
                            bd = d;
                            best = Some(i);
                        }
                    }
                }
            }
        }
        if let Some(b) = best {
            return b;
        }
        self.list.push(q);
        self.cells
            .entry((cx, cy))
            .or_default()
            .push(self.list.len() - 1);
        self.list.len() - 1
    }
}

/// Segments in a grid of cells `size` wide, by their bounding box.
struct SegGrid {
    size: f64,
    cells: HashMap<(i64, i64), Vec<usize>>,
}

impl SegGrid {
    fn new(size: f64) -> SegGrid {
        SegGrid {
            size,
            cells: HashMap::new(),
        }
    }
    fn range(&self, a: Pt, b: Pt, pad: f64) -> (i64, i64, i64, i64) {
        let s = self.size;
        (
            ((a[0].min(b[0]) - pad) / s).floor() as i64,
            ((a[1].min(b[1]) - pad) / s).floor() as i64,
            ((a[0].max(b[0]) + pad) / s).floor() as i64,
            ((a[1].max(b[1]) + pad) / s).floor() as i64,
        )
    }
    fn add(&mut self, i: usize, a: Pt, b: Pt) {
        let (x0, y0, x1, y1) = self.range(a, b, 0.0);
        for x in x0..=x1 {
            for y in y0..=y1 {
                self.cells.entry((x, y)).or_default().push(i);
            }
        }
    }
    /// The segments near a-b, each once, in the order first met.
    fn near(&self, a: Pt, b: Pt, pad: f64) -> Vec<usize> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        let (x0, y0, x1, y1) = self.range(a, b, pad);
        for x in x0..=x1 {
            for y in y0..=y1 {
                if let Some(c) = self.cells.get(&(x, y)) {
                    for &i in c {
                        if seen.insert(i) {
                            out.push(i);
                        }
                    }
                }
            }
        }
        out
    }
}

struct Proj {
    t: f64,
    d: f64,
    at: Pt,
}

/// Where `q` is nearest on segment a-b: the share t along it and the distance.
fn project(q: Pt, a: Pt, b: Pt) -> Proj {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 {
        0f64.max(1f64.min(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
    } else {
        0.0
    };
    let at = [a[0] + t * dx, a[1] + t * dy];
    Proj {
        t,
        d: dist(q, at),
        at,
    }
}

/// Where segments a-b and c-d cross: the shares along each, or None (parallel or apart).
fn cross(a: Pt, b: Pt, c: Pt, d: Pt) -> Option<(f64, f64)> {
    let rx = b[0] - a[0];
    let ry = b[1] - a[1];
    let sx = d[0] - c[0];
    let sy = d[1] - c[1];
    let den = rx * sy - ry * sx;
    if den.abs() < 1e-12 {
        return None;
    }
    let qx = c[0] - a[0];
    let qy = c[1] - a[1];
    let t = (qx * sy - qy * sx) / den;
    let u = (qx * ry - qy * rx) / den;
    ((0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u)).then_some((t, u))
}

fn edge_key(u: usize, v: usize) -> (usize, usize) {
    if u < v { (u, v) } else { (v, u) }
}

type Fine = OrderedMap<(usize, usize), (usize, usize)>;

fn add_fine(fine: &mut Fine, u: usize, v: usize) {
    if u != v {
        fine.set(edge_key(u, v), (u, v));
    }
}

/// The lines as a planar graph (see the top of this file): split where they cross or touch, gaps
/// up to `snap` bridged.
pub fn redwork_graph(lines: &[RedworkLine], snap: f64) -> RedworkGraph {
    // The straight pieces of all lines.
    let mut segs: Vec<(Pt, Pt)> = Vec::new();
    for l in lines {
        let mut pts = l.pts.clone();
        if l.closed && pts.len() > 2 && dist(pts[0], pts[pts.len() - 1]) > 1e-9 {
            pts.push(pts[0]);
        }
        for i in 1..pts.len() {
            if dist(pts[i - 1], pts[i]) > 1e-9 {
                segs.push((pts[i - 1], pts[i]));
            }
        }
    }
    let mut grid = SegGrid::new(2.0);
    for (i, &(a, b)) in segs.iter().enumerate() {
        grid.add(i, a, b);
    }
    // Points along each piece where it is split: where another crosses it or ends on it.
    let mut cuts: Vec<Vec<Pt>> = segs.iter().map(|&(a, b)| vec![a, b]).collect();
    for (i, &(a, b)) in segs.iter().enumerate() {
        for j in grid.near(a, b, MERGE) {
            if j <= i {
                continue;
            }
            let (c, d) = segs[j];
            if let Some((t, _)) = cross(a, b, c, d) {
                let q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
                cuts[i].push(q);
                cuts[j].push(q);
            }
            // Touching without crossing (an end on the other piece), also along a piece lying on the other.
            for (q, k, s, e) in [(c, i, a, b), (d, i, a, b), (a, j, c, d), (b, j, c, d)] {
                let p = project(q, s, e);
                if p.d < MERGE && p.t > 0.0 && p.t < 1.0 {
                    cuts[k].push(p.at);
                }
            }
        }
    }
    let mut pts = Points::default();
    let mut fine: Fine = OrderedMap::new();
    for (i, &(a, _)) in segs.iter().enumerate() {
        let mut along: Vec<(Pt, f64)> = cuts[i].iter().map(|&q| (q, dist(a, q))).collect();
        along.sort_by(|x, y| x.1.partial_cmp(&y.1).unwrap_or(std::cmp::Ordering::Equal));
        let mut prev = pts.id(along[0].0);
        for &(q, _) in &along[1..] {
            let id = pts.id(q);
            add_fine(&mut fine, prev, id);
            prev = id;
        }
    }
    bridge_gaps(&mut pts, &mut fine, snap);
    let list: Vec<(usize, usize)> = fine.values().copied().collect();
    contract(chains(&pts.list, &list), NODE)
}

fn length(pts: &[Pt]) -> f64 {
    let mut s = 0.0;
    for i in 1..pts.len() {
        s += dist(pts[i], pts[i - 1]);
    }
    s
}

fn root_of(up: &mut [usize], i: usize) -> usize {
    let mut r = i;
    while up[r] != r {
        r = up[r];
    }
    let mut b = i;
    while up[b] != r {
        let n = up[b];
        up[b] = r;
        b = n;
    }
    r
}

/// Nodes joined by an edge shorter than `d` made one, at their middle (vertex clustering): lines
/// that cross at a shallow angle or meet near a corner give nodes close together, and every node is
/// a needle point, so they would be a heap of short stitches.
fn contract(g: RedworkGraph, d: f64) -> RedworkGraph {
    let mut up: Vec<usize> = (0..g.nodes.len()).collect();
    let short: Vec<bool> = g.edges.iter().map(|e| length(&e.pts) < d).collect();
    for (i, e) in g.edges.iter().enumerate() {
        if short[i] {
            let ra = root_of(&mut up, e.a);
            let rb = root_of(&mut up, e.b);
            up[ra] = rb;
        }
    }
    let mut sum: OrderedMap<usize, (f64, f64, f64)> = OrderedMap::new();
    for (i, q) in g.nodes.iter().enumerate() {
        let r = root_of(&mut up, i);
        match sum.get_mut(&r) {
            Some(s) => *s = (s.0 + q[0], s.1 + q[1], s.2 + 1.0),
            None => sum.set(r, (q[0], q[1], 1.0)),
        }
    }
    let mut index: HashMap<usize, usize> = HashMap::new();
    let mut nodes: Vec<Pt> = Vec::new();
    for (&r, &(x, y, n)) in sum.iter() {
        index.insert(r, nodes.len());
        nodes.push([x / n, y / n]);
    }
    let mut edges = Vec::new();
    // Two edges between the same nodes that are now one straight piece (they went from either end of
    // a short one) are sewn once.
    let mut seen: HashSet<(usize, usize)> = HashSet::new();
    for (i, e) in g.edges.iter().enumerate() {
        if short[i] {
            continue;
        }
        let a = index[&root_of(&mut up, e.a)];
        let b = index[&root_of(&mut up, e.b)];
        if e.pts.len() == 2 && !seen.insert(edge_key(a, b)) {
            continue;
        }
        let mut pts = vec![nodes[a]];
        pts.extend_from_slice(&e.pts[1..e.pts.len() - 1]);
        pts.push(nodes[b]);
        // A loop that shrank to a spike in the merged node: nothing left to sew.
        if a == b && length(&pts) < 2.0 * d {
            continue;
        }
        edges.push(RedworkEdge { a, b, pts });
    }
    RedworkGraph { nodes, edges }
}

struct Gap {
    d: f64,
    i: usize,
    j: usize,
    p: Pt,
    q: Pt,
}

/// Lines that do not touch but come within `snap` of each other are joined by a straight piece
/// where they are closest (split there): the nearest pair first, as long as it joins two parts that
/// are apart so far (Kruskal's order), so each gap is bridged once and a line never onto itself.
fn bridge_gaps(pts: &mut Points, fine: &mut Fine, snap: f64) {
    if snap <= 0.0 || snap.is_nan() {
        return;
    }
    let mut up: HashMap<usize, usize> = HashMap::new();
    fn root(up: &mut HashMap<usize, usize>, i: usize) -> usize {
        let mut r = i;
        while let Some(&n) = up.get(&r) {
            if n == r {
                break;
            }
            r = n;
        }
        up.insert(i, r);
        r
    }
    fn join(up: &mut HashMap<usize, usize>, a: usize, b: usize) {
        let ra = root(up, a);
        let rb = root(up, b);
        up.insert(ra, rb);
    }
    let segs: Vec<(usize, usize)> = fine.values().copied().collect();
    for &(u, v) in &segs {
        join(&mut up, u, v);
    }
    let mut grid = SegGrid::new(2.0);
    for (i, &(u, v)) in segs.iter().enumerate() {
        grid.add(i, pts.list[u], pts.list[v]);
    }
    // The closest points of two pieces that do not cross: an end of one and its nearest point on the other.
    let mut gaps: Vec<Gap> = Vec::new();
    for (i, &(a, b)) in segs.iter().enumerate() {
        let (pa, pb) = (pts.list[a], pts.list[b]);
        for j in grid.near(pa, pb, snap) {
            if j <= i || root(&mut up, segs[j].0) == root(&mut up, a) {
                continue;
            }
            let (pc, pd) = (pts.list[segs[j].0], pts.list[segs[j].1]);
            let mut best: Option<(f64, Pt, Pt)> = None;
            for (e, s0, s1, mine) in [
                (pa, pc, pd, true),
                (pb, pc, pd, true),
                (pc, pa, pb, false),
                (pd, pa, pb, false),
            ] {
                let x = project(e, s0, s1);
                if best.is_none_or(|b| x.d < b.0) {
                    best = Some(if mine { (x.d, e, x.at) } else { (x.d, x.at, e) });
                }
            }
            if let Some((d, p, q)) = best
                && d <= snap
            {
                gaps.push(Gap { d, i, j, p, q });
            }
        }
    }
    gaps.sort_by(|x, y| x.d.partial_cmp(&y.d).unwrap_or(std::cmp::Ordering::Equal));
    // The node at `q` on piece `seg` (or on what it was split into), the piece split there.
    let at = |pts: &mut Points,
              fine: &mut Fine,
              up: &mut HashMap<usize, usize>,
              seg: (usize, usize),
              q: Pt|
     -> usize {
        let id = pts.id(q);
        if id == seg.0 || id == seg.1 || fine.len == 0 {
            return id;
        }
        // The piece itself, or the piece of it nearest q once it was split before.
        let mut edge = fine.get(&edge_key(seg.0, seg.1)).copied();
        if edge.is_none() {
            let mut bd = f64::INFINITY;
            for &e in fine.values() {
                let d = project(q, pts.list[e.0], pts.list[e.1]).d;
                if d < bd {
                    bd = d;
                    edge = Some(e);
                }
            }
        }
        let (u, v) = edge.expect("an edge");
        if id != u && id != v {
            fine.delete(&edge_key(u, v));
            add_fine(fine, u, id);
            add_fine(fine, id, v);
        }
        join(up, id, u);
        id
    };
    for g in &gaps {
        if root(&mut up, segs[g.i].0) == root(&mut up, segs[g.j].0) {
            continue;
        }
        let u = at(pts, fine, &mut up, segs[g.i], g.p);
        let v = at(pts, fine, &mut up, segs[g.j], g.q);
        add_fine(fine, u, v);
        join(&mut up, u, v);
    }
}

/// The fine graph with its runs through nodes of two edges joined: edges from junction to junction
/// (or round a loop).
fn chains(all: &[Pt], fine: &[(usize, usize)]) -> RedworkGraph {
    let mut nb: OrderedMap<usize, Vec<usize>> = OrderedMap::new();
    for &(u, v) in fine {
        if nb.get(&u).is_none() {
            nb.set(u, Vec::new());
        }
        if nb.get(&v).is_none() {
            nb.set(v, Vec::new());
        }
        nb.get_mut(&u).unwrap().push(v);
        nb.get_mut(&v).unwrap().push(u);
    }
    let mut used: HashSet<(usize, usize)> = HashSet::new();
    let mut index: HashMap<usize, usize> = HashMap::new();
    let mut nodes: Vec<Pt> = Vec::new();
    let mut edges: Vec<RedworkEdge> = Vec::new();
    let junction = |nb: &OrderedMap<usize, Vec<usize>>, v: usize| nb.get(&v).unwrap().len() != 2;
    let node = |index: &mut HashMap<usize, usize>, nodes: &mut Vec<Pt>, v: usize| -> usize {
        *index.entry(v).or_insert_with(|| {
            nodes.push(all[v]);
            nodes.len() - 1
        })
    };
    let mut follow = |used: &mut HashSet<(usize, usize)>, s: usize, first: usize| {
        let mut line = vec![s, first];
        used.insert(edge_key(s, first));
        let mut prev = s;
        let mut v = first;
        while !junction(&nb, v) && v != s {
            let ns = nb.get(&v).unwrap();
            let w = ns
                .iter()
                .copied()
                .find(|&x| x != prev && !used.contains(&edge_key(v, x)))
                .or_else(|| {
                    ns.iter()
                        .copied()
                        .find(|&x| !used.contains(&edge_key(v, x)))
                });
            let Some(w) = w else { break };
            used.insert(edge_key(v, w));
            line.push(w);
            prev = v;
            v = w;
        }
        let a = node(&mut index, &mut nodes, s);
        let b = node(&mut index, &mut nodes, v);
        edges.push(RedworkEdge {
            a,
            b,
            pts: line.iter().map(|&i| all[i]).collect(),
        });
    };
    let order: Vec<(usize, Vec<usize>)> = nb.iter().map(|(&k, v)| (k, v.clone())).collect();
    for (v, ns) in &order {
        if ns.len() != 2 {
            for &w in ns {
                if !used.contains(&edge_key(*v, w)) {
                    follow(&mut used, *v, w);
                }
            }
        }
    }
    // Loops without a junction: from any of their points round.
    for (v, ns) in &order {
        for &w in ns {
            if !used.contains(&edge_key(*v, w)) {
                follow(&mut used, *v, w);
            }
        }
    }
    RedworkGraph { nodes, edges }
}

/// The walk over the graph, one per connected part: every edge once each way (Tarry's depth first
/// traversal, see the top of this file), from the node nearest the needle, the parts in the order
/// the needle reaches them. Each walk is the list of edges it takes, with the way along each.
pub fn redwork_walks(g: &RedworkGraph, from: Option<Pt>) -> Vec<Vec<Step>> {
    let mut at: OrderedMap<usize, Vec<usize>> = OrderedMap::new();
    for (i, e) in g.edges.iter().enumerate() {
        if at.get(&e.a).is_none() {
            at.set(e.a, Vec::new());
        }
        at.get_mut(&e.a).unwrap().push(i);
        if e.b != e.a {
            if at.get(&e.b).is_none() {
                at.set(e.b, Vec::new());
            }
            at.get_mut(&e.b).unwrap().push(i);
        }
    }
    let mut done: HashSet<usize> = HashSet::new();
    let mut used_edge: HashSet<usize> = HashSet::new();
    let mut walks: Vec<Vec<Step>> = Vec::new();
    let first = g.edges.first().map_or(0, |e| e.a);
    let mut pos =
        from.unwrap_or_else(|| g.nodes.get(first).copied().unwrap_or([f64::NAN, f64::NAN]));
    loop {
        let mut start: Option<usize> = None;
        let mut sd = f64::INFINITY;
        for (&v, _) in at.iter() {
            if done.contains(&v) {
                continue;
            }
            let d = if from.is_some() || !walks.is_empty() {
                dist(pos, g.nodes[v])
            } else {
                0.0
            };
            if d < sd {
                sd = d;
                start = Some(v);
            }
        }
        let Some(start) = start else { break };
        let mut walk: Vec<Step> = Vec::new();
        // The way taken along an edge; the direction the needle arrives in is that of the last step
        // (heading_of), to go on as straight as it can.
        let take = |walk: &mut Vec<Step>, i: usize, from: usize, way: Option<bool>| -> usize {
            let e = &g.edges[i];
            let back = way.unwrap_or(e.a != from);
            walk.push(Step { edge: i, back });
            if back { e.a } else { e.b }
        };
        let leaving = |i: usize, v: usize| -> Pt {
            let p = &g.edges[i].pts;
            let (s, t) = if g.edges[i].a == v {
                (p[0], p[1])
            } else {
                (p[p.len() - 1], p[p.len() - 2])
            };
            [t[0] - s[0], t[1] - s[1]]
        };
        done.insert(start);
        // Nodes on the way and the edge each was reached by.
        let mut stack: Vec<(usize, Option<usize>)> = vec![(start, None)];
        while let Some(&(v, via)) = stack.last() {
            let mut next: Option<usize> = None;
            let mut score = f64::NEG_INFINITY;
            for &i in at.get(&v).unwrap() {
                if used_edge.contains(&i) {
                    continue;
                }
                let out = leaving(i, v);
                let s = match heading_of(&walk, g) {
                    Some(h) => {
                        let den = h[0].hypot(h[1]) * out[0].hypot(out[1]);
                        let den = if den == 0.0 || den.is_nan() { 1.0 } else { den };
                        (h[0] * out[0] + h[1] * out[1]) / den
                    }
                    None => 0.0,
                };
                if s > score {
                    score = s;
                    next = Some(i);
                }
            }
            let Some(next) = next else {
                stack.pop();
                // Back the way it came, over everything beyond.
                if let Some(via) = via {
                    take(&mut walk, via, v, None);
                }
                continue;
            };
            used_edge.insert(next);
            let w = take(&mut walk, next, v, None);
            // To a node reached before (or round a loop): back along it at once, the other way.
            if done.contains(&w) {
                let way = !walk[walk.len() - 1].back;
                take(&mut walk, next, w, Some(way));
            } else {
                done.insert(w);
                stack.push((w, Some(next)));
            }
        }
        if !walk.is_empty() {
            walks.push(walk);
        }
        pos = g.nodes[start];
    }
    walks
}

/// The direction the needle arrives in after the last step of the walk (as `take` sets it).
fn heading_of(walk: &[Step], g: &RedworkGraph) -> Option<Pt> {
    let st = walk.last()?;
    let p = &g.edges[st.edge].pts;
    let (s, t) = if st.back {
        (p[1], p[0])
    } else {
        (p[p.len() - 2], p[p.len() - 1])
    };
    Some([t[0] - s[0], t[1] - s[1]])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cross_is_one_walk_over_four_edges() {
        let lines = vec![
            RedworkLine {
                pts: vec![[0.0, 5.0], [10.0, 5.0]],
                closed: false,
            },
            RedworkLine {
                pts: vec![[5.0, 0.0], [5.0, 10.0]],
                closed: false,
            },
        ];
        let g = redwork_graph(&lines, 0.5);
        assert_eq!(g.nodes.len(), 5);
        assert_eq!(g.edges.len(), 4);
        let walks = redwork_walks(&g, Some([0.0, 5.0]));
        assert_eq!(walks.len(), 1);
        assert_eq!(walks[0].len(), 8);
        // Straight on at the crossing.
        assert_eq!(walks[0][0].edge, 0);
    }

    #[test]
    fn a_gap_is_bridged() {
        let lines = vec![
            RedworkLine {
                pts: vec![[0.0, 0.0], [10.0, 0.0]],
                closed: false,
            },
            RedworkLine {
                pts: vec![[5.0, 0.3], [5.0, 10.0]],
                closed: false,
            },
        ];
        let g = redwork_graph(&lines, 0.5);
        assert_eq!(redwork_walks(&g, None).len(), 1);
        assert_eq!(redwork_walks(&redwork_graph(&lines, 0.0), None).len(), 2);
    }
}
