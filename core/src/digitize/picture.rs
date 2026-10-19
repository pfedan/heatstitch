//! The image assistant's analysis and planning (src/digitize/digitize.ts): from a prepared label
//! map to the areas it sews and how.
//!
//! Every connected region becomes one object: tatami fill, satin column network or running stitch,
//! chosen from the widths along its skeleton (the Goldman patent's thin/thick test): narrower than the
//! smallest satin is a line, a network of columns no wider than the satin limit is satin, anything
//! else is filled. Colors are sewn largest area first (backgrounds before details); fills before
//! satins and lines within a color; objects nearest first. Satin and line networks are walked depth
//! first, each branch out (underlay or the first pass of the line) and back (satin or the second
//! pass), so a whole network is sewn without a jump (as Ink/Stitch's auto-satin routes it).
//!
//! Between objects: up to 1 mm a plain stitch, up to the trim length a jump, beyond that a tie-off,
//! trim, jump and tie-in. Color changes trim and tie as well.
//!
//! Which technique each area gets with the Smart style, and sewing an area as satin in sections,
//! stay in TypeScript with the model they depend on; they call in here per area.

use std::collections::HashMap;

use serde::Serialize;

use super::measure::{coverage, peak_density};
use super::region::Region;
use super::run::run_stitch;
use super::satin::{self, Column, ColumnEnds, SatinParams};
use super::skeleton::{Branch, Graph, reverse, skeleton};
use crate::geom::Pt;
use crate::image::edt::distance_to_seeds;
use crate::image::labels::Components;
use crate::image::quantize::NONE;
use crate::js::{IdMap, dist, round};
use crate::material::rules::LOCK_MM;
use crate::pattern::{COLOR_CHANGE, END, JUMP, STITCH, TRIM};
use crate::trig::JsMath;

/// What an area is sewn as.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Fill,
    Satin,
    Run,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Fill => "fill",
            Kind::Satin => "satin",
            Kind::Run => "run",
        }
    }
}

/// Satin that leaves more of its region bare than this share is filled instead.
pub const SATIN_COVER: f64 = 0.95;
/// Satin columns overlap a junction they end at by this much once another column has covered it (mm).
const JOIN_OVERLAP: f64 = 0.3;
/// A color this thin on average (mm) is a line color: an outline, strokes, drawn details.
const LINE_MM: f64 = 1.6;
/// Colors up to this many are ordered exactly (2^n subsets).
const ORDER_EXACT: usize = 16;
/// Pieces of one color apart by no more than this, with only later colors between them, are one area (mm).
const BRIDGE: f64 = 2.5;
/// Pieces that reach no deeper than this (mm) into nine tenths of themselves are lines, not bridged.
const LINE_DEPTH: f64 = 1.5;

fn percentile(v: &[f64], q: f64) -> f64 {
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    let k = (s.len() - 1).min((q * s.len() as f64).floor() as usize);
    s.get(k).copied().unwrap_or(0.0)
}

/// Fill, satin or running stitch, from the widths along the skeleton. Satin needs a stroke: no
/// wider than the satin limit, of even width (the Goldman patent's test: the widest point within
/// three standard deviations of the mean), long against its width, and with few branchings (at
/// least four widths of centerline per junction). Blotches with several short arms are filled;
/// as satin they would become stars of columns stacked in their middle.
pub fn classify(g: &Graph, satin_min: f64, satin_max: f64) -> Kind {
    let widths: Vec<f64> = g
        .branches
        .iter()
        .flat_map(|b| b.r.iter().map(|r| 2.0 * r))
        .collect();
    if widths.is_empty() {
        return Kind::Fill;
    }
    let max = widths.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if max < satin_min {
        return Kind::Run;
    }
    let n = widths.len() as f64;
    let mean = widths.iter().fold(0.0, |a, b| a + b) / n;
    let sd = (widths.iter().fold(0.0, |a, w| a + (w - mean).js_pow(2.0)) / n).sqrt();
    let mut length = 0.0;
    for b in &g.branches {
        for i in 1..b.pts.len() {
            length += dist(b.pts[i - 1], b.pts[i]);
        }
    }
    let degree = degrees(g);
    let junctions = degree.iter().filter(|&&d| d >= 3).count() as f64;
    let narrow = percentile(&widths, 0.95) <= satin_max && max <= satin_max * 1.3;
    let even = max <= mean + 3.0 * sd + 0.5;
    let stroke = length >= 2.5 * mean && junctions * 4.0 * mean <= length;
    if narrow && even && stroke {
        Kind::Satin
    } else {
        Kind::Fill
    }
}

fn degrees(g: &Graph) -> Vec<usize> {
    let mut degree = vec![0; g.nodes.len()];
    for b in &g.branches {
        degree[b.a] += 1;
        degree[b.b] += 1;
    }
    degree
}

/// Boundary pixels of the region (every few), to find the nearest object.
pub fn probes(r: &Region) -> Vec<Pt> {
    let mut out = vec![];
    let mut k = 0;
    let m = &r.mask;
    for y in 1..r.h.saturating_sub(1) {
        for x in 1..r.w - 1 {
            let i = y * r.w + x;
            if m[i] == 0 || (m[i - 1] != 0 && m[i + 1] != 0 && m[i - r.w] != 0 && m[i + r.w] != 0) {
                continue;
            }
            if k % 4 == 0 {
                out.push([
                    (x as f64 + f64::from(r.x0) + 0.5) * r.px_mm,
                    (y as f64 + f64::from(r.y0) + 0.5) * r.px_mm,
                ]);
            }
            k += 1;
        }
    }
    out
}

/// Which way a branch is sewn in `walk`: out (underlay, first pass) or back (satin, second pass).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Leg {
    Out,
    Back,
}

/// Walks a skeleton graph depth first from the node nearest to `start`: each branch out with
/// `sew(.., Leg::Out)` and, after everything beyond it, back with `Leg::Back`. Returns one
/// continuous run.
pub fn walk(
    g: &Graph,
    start: Pt,
    mut sew: impl FnMut(&Branch, bool, bool, Leg) -> Vec<Pt>,
) -> Vec<Pt> {
    let degree = degrees(g);
    let free = |n: usize| degree[n] == 1;
    let mut root = 0;
    let mut bd = f64::INFINITY;
    for (i, n) in g.nodes.iter().enumerate() {
        if degree[i] == 0 {
            continue;
        }
        // Ends are better starting points than junctions.
        let d = dist(n.p, start) - if free(i) { 1.0 } else { 0.0 };
        if d < bd {
            bd = d;
            root = i;
        }
    }
    struct State {
        used: Vec<bool>,
        seen: Vec<bool>,
        pts: Vec<Pt>,
    }
    fn append(s: &mut State, q: Vec<Pt>) {
        for p in q {
            if s.pts.last().is_none_or(|&l| dist(l, p) > 0.05) {
                s.pts.push(p);
            }
        }
    }
    fn visit(
        g: &Graph,
        n: usize,
        s: &mut State,
        free: &dyn Fn(usize) -> bool,
        sew: &mut dyn FnMut(&Branch, bool, bool, Leg) -> Vec<Pt>,
    ) {
        s.seen[n] = true;
        for k in 0..g.branches.len() {
            let b = &g.branches[k];
            if s.used[k] || (b.a != n && b.b != n) {
                continue;
            }
            s.used[k] = true;
            let dir = if b.a == n { b.clone() } else { reverse(b) };
            let other = dir.b;
            let q = sew(&dir, free(n), free(other), Leg::Out);
            append(s, q);
            if !s.seen[other] {
                visit(g, other, s, free, sew);
            }
            let q = sew(&dir, free(n), free(other), Leg::Back);
            append(s, q);
        }
    }
    let mut s = State {
        used: vec![false; g.branches.len()],
        seen: vec![false; g.nodes.len()],
        pts: vec![],
    };
    if !g.nodes.is_empty() {
        visit(g, root, &mut s, &free, &mut sew);
    }
    s.pts
}

/// Columns of branches with free ends extended, cached by the branch's ends and the free flags (as
/// the TypeScript twin keyed them: two branches between the same points share one column).
struct Columns<'a> {
    r: &'a Region,
    cache: HashMap<[u64; 6], Column>,
}

impl Columns<'_> {
    fn get(&mut self, b: &Branch, fa: bool, fb: bool) -> &Column {
        // -0 and 0 are one key, as they print the same.
        let bits = |v: f64| (v + 0.0).to_bits();
        let (p, q) = match (b.pts.first(), b.pts.last()) {
            (Some(p), Some(q)) => (*p, *q),
            _ => ([f64::NAN; 2], [f64::NAN; 2]),
        };
        let key = [
            bits(p[0]),
            bits(p[1]),
            bits(q[0]),
            bits(q[1]),
            u64::from(fa),
            u64::from(fb),
        ];
        let r = self.r;
        self.cache
            .entry(key)
            .or_insert_with(|| satin::column(r, &b.pts, &b.r, fa, fb))
    }
}

/// A satin network along its skeleton, sewn without a jump: each branch out as underlay (or a
/// walk along its middle), back as satin. The first column to reach a junction covers it; the
/// others stop at its edge.
pub fn sew_satin(
    r: &Region,
    g: &Graph,
    start: Pt,
    p: &SatinParams,
    with_underlay: bool,
    tol: f64,
    stretch: bool,
) -> Vec<Vec<Pt>> {
    let mut col = Columns {
        r,
        cache: HashMap::new(),
    };
    let mut covered = vec![false; g.nodes.len()];
    let run = walk(g, start, |b, fa, fb, leg| {
        let c = col.get(b, fa, fb);
        match leg {
            Leg::Out => {
                if with_underlay {
                    satin::underlay(c, tol, None, stretch)
                } else {
                    run_stitch(&c.center, 2.5, tol)
                }
            }
            Leg::Back => {
                // Back from the far end: the same column reversed.
                let rev = Column {
                    center: c.center.iter().rev().copied().collect(),
                    left: c.right.iter().rev().copied().collect(),
                    right: c.left.iter().rev().copied().collect(),
                    width: c.width,
                };
                let trim = |n: usize| {
                    if covered[n] {
                        (g.nodes[n].r - JOIN_OVERLAP).max(0.0)
                    } else {
                        0.0
                    }
                };
                let ends = ColumnEnds {
                    from: g.nodes[b.b].p,
                    from_trim: if fb { 0.0 } else { trim(b.b) },
                    to: g.nodes[b.a].p,
                    to_trim: if fa { 0.0 } else { trim(b.a) },
                };
                if !fb {
                    covered[b.b] = true;
                }
                if !fa {
                    covered[b.a] = true;
                }
                satin::satin_stitches(&satin::pairs(&rev, p, Some(&ends)), p)
            }
        }
    });
    if run.is_empty() { vec![] } else { vec![run] }
}

/// A line network in running stitch along its skeleton, each branch there and back.
pub fn sew_run(r: &Region, g: &Graph, start: Pt, tol: f64) -> Vec<Vec<Pt>> {
    let run = walk(g, start, |b, fa, fb, leg| {
        let mut line = run_stitch(&satin::column(r, &b.pts, &b.r, fa, fb).center, 2.0, tol);
        if leg == Leg::Back {
            line.reverse();
        }
        line
    });
    if run.is_empty() { vec![] } else { vec![run] }
}

/// Satin that neither piles up (denser than `limit` somewhere, thread per mm²) nor leaves its region bare.
pub fn satin_ok(runs: &[Vec<Pt>], r: &Region, limit: f64) -> bool {
    peak_density(runs, |_, _| false) <= limit && coverage(r, runs, 0.2) >= SATIN_COVER
}

/// The skeleton of an area that can be sewn as satin, or None.
pub fn is_stroke(r: &Region, satin_max: f64) -> Option<Graph> {
    let graph = skeleton(r);
    (classify(&graph, 0.0, satin_max) == Kind::Satin).then_some(graph)
}

/// Satin for an area, as the Image mode would sew it: None when the area is no stroke (wider than
/// `satin_max`, uneven, or short and branched), or when satin would pile up (more than `peak` times
/// its density somewhere) or leave it bare.
pub fn satin_for_area(
    r: &Region,
    start: Pt,
    p: &SatinParams,
    underlay: bool,
    tol: f64,
    satin_max: f64,
    peak: f64,
) -> Option<Vec<Vec<Pt>>> {
    let graph = is_stroke(r, satin_max)?;
    let out: Vec<Vec<Pt>> = sew_satin(r, &graph, start, p, underlay, tol, false)
        .into_iter()
        .filter(|run| run.len() > 1)
        .collect();
    if out.is_empty()
        || peak_density(&out, |_, _| false) > (peak * 2.0) / p.spacing
        || coverage(r, &out, 0.2) < SATIN_COVER
    {
        return None;
    }
    Some(out)
}

/// Colors in sewing order: what lies on top of something else is sewn after it, as digitizers do. Of
/// two regions that touch, the narrower lies on top (a vein on its leaf, an outline around its area, a
/// dot in a field): sewn later it covers the shared edge, and the wider one reaches under it instead
/// of over it. A region's mean width is 2 × area / perimeter (a strip of width t and length L has area
/// tL and perimeter about 2L).
///
/// Each touching pair votes for its order by the length of the edge they share, the more the clearer
/// the difference in width. Colors are then ordered to agree with as much of that as they can (a
/// linear ordering problem: exactly by dynamic programming over subsets for up to ORDER_EXACT colors,
/// else by moving one color at a time to its best place, Schiavinotto and Stützle 2004). Where the
/// votes leave a choice, the order is the one used before: areas first, largest first, then the line
/// colors.
pub fn sewing_order(
    labels: &[u8],
    c: &Components,
    w: usize,
    h: usize,
    px_mm: f64,
    colors: usize,
) -> Vec<usize> {
    let n = c.label.len();
    let mut perim = vec![0.0f64; n];
    // Shared edges in the order first met (the sums below add up in that order, as in TypeScript).
    let mut shared: Vec<(u64, f64)> = vec![];
    let mut at_key: IdMap<u64, usize> = IdMap::default();
    let mut area = vec![0usize; colors];
    let mut edges = vec![0usize; colors];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let l = labels[i];
            if l == NONE {
                continue;
            }
            let k = c.comp[i] as usize;
            area[l as usize] += 1;
            let mut side = |j: usize, out: bool| {
                if !out && labels[j] == l {
                    return;
                }
                edges[l as usize] += 1;
                perim[k] += 1.0;
                // Each shared edge once, from the pixel with the lower index.
                if !out && labels[j] != NONE && j > i {
                    let key = k as u64 * n as u64 + u64::from(c.comp[j]);
                    let at = *at_key.entry(key).or_insert_with(|| {
                        shared.push((key, 0.0));
                        shared.len() - 1
                    });
                    shared[at].1 += 1.0;
                }
            };
            side(i.wrapping_sub(1), x == 0);
            side(i + 1, x == w - 1);
            side(i.wrapping_sub(w), y == 0);
            side(i + w, y == h - 1);
        }
    }
    let used: Vec<usize> = (0..colors).filter(|&i| area[i] > 0).collect();
    // Pixel edges run in steps along slanted and curved edges: about 4/π times the true length.
    let width = |l: usize| {
        ((2.0 * area[l] as f64) / (edges[l] as f64 * (std::f64::consts::PI / 4.0))) * px_mm
    };
    // With areas of other colors only: a design of lines alone keeps the order by area.
    let any_area = used.iter().any(|&k| width(k) >= LINE_MM);
    let line = |l: usize| width(l) < LINE_MM && any_area;
    let mut base = used.clone();
    base.sort_by(|&a, &b| {
        (line(a) as u8)
            .cmp(&(line(b) as u8))
            .then(area[b].cmp(&area[a]))
    });
    if base.len() < 2 {
        return base;
    }

    // before[a][b]: how much asks for color a before color b.
    let m = used.len();
    let mut before = vec![vec![0.0f64; m]; m];
    let mut at = vec![usize::MAX; colors];
    for (k, &l) in used.iter().enumerate() {
        at[l] = k;
    }
    let comp_width = |k: usize| (2.0 * f64::from(c.area[k])) / perim[k];
    for &(key, len) in &shared {
        let a = (key / n as u64) as usize;
        let b = (key % n as u64) as usize;
        let (wa, wb) = (comp_width(a), comp_width(b));
        if wa == wb {
            continue;
        }
        // The narrower one on top: sewn after the wider one.
        let (under, top) = if wa > wb { (a, b) } else { (b, a) };
        before[at[c.label[under] as usize]][at[c.label[top] as usize]] +=
            len * (1.0 - wa.min(wb) / wa.max(wb));
    }
    // The order used before decides where the votes leave a choice: a weight too small to outweigh any of them.
    let mut pos = vec![0usize; colors];
    for (k, &l) in base.iter().enumerate() {
        pos[l] = k;
    }
    let mut least = f64::INFINITY;
    for row in &before {
        for &v in row {
            if v > 0.0 {
                least = least.min(v);
            }
        }
    }
    let eps = (if least.is_finite() { least } else { 1.0 }) / ((m * m + 1) as f64);
    for a in 0..m {
        for b in 0..m {
            if pos[used[a]] < pos[used[b]] {
                before[a][b] += eps;
            }
        }
    }
    let order = if m <= ORDER_EXACT {
        order_exact(&before)
    } else {
        order_by_moves(&before, &base.iter().map(|&l| at[l]).collect::<Vec<_>>())
    };
    order.into_iter().map(|k| used[k]).collect()
}

/// The order of 0..n-1 with the largest sum of before[a][b] over a placed before b: dynamic programming over the set placed first.
fn order_exact(before: &[Vec<f64>]) -> Vec<usize> {
    let n = before.len();
    let size = 1usize << n;
    let mut best = vec![f64::NEG_INFINITY; size];
    let mut last = vec![-1i8; size];
    best[0] = 0.0;
    for set in 0..size {
        if best[set] == f64::NEG_INFINITY {
            continue;
        }
        for v in 0..n {
            if set & (1 << v) != 0 {
                continue;
            }
            // v after everything in the set.
            let mut gain = 0.0;
            for u in 0..n {
                if set & (1 << u) != 0 {
                    gain += before[u][v];
                }
            }
            let next = set | (1 << v);
            if best[set] + gain > best[next] {
                best[next] = best[set] + gain;
                last[next] = v as i8;
            }
        }
    }
    let mut out = vec![];
    let mut set = size - 1;
    while set != 0 {
        let v = last[set] as usize;
        out.push(v);
        set &= !(1 << v);
    }
    out.reverse();
    out
}

/// Local search for many colors: each color moved to the place that gains most, until no move gains.
fn order_by_moves(before: &[Vec<f64>], start: &[usize]) -> Vec<usize> {
    let mut order = start.to_vec();
    let mut improved = true;
    let mut guard = 0;
    while improved && guard < 100 {
        improved = false;
        for i in 0..order.len() {
            let v = order[i];
            let mut rest: Vec<usize> = order
                .iter()
                .enumerate()
                .filter(|&(k, _)| k != i)
                .map(|(_, &u)| u)
                .collect();
            // Gain of placing v at slot s (before rest[s]) against placing it first.
            let mut gain = 0.0;
            let mut best_gain = 0.0;
            let mut best_slot = 0;
            let mut here = 0.0;
            for s in 1..=rest.len() {
                let u = rest[s - 1];
                gain += before[u][v] - before[v][u];
                if s == i {
                    here = gain;
                }
                if gain > best_gain + 1e-12 {
                    best_gain = gain;
                    best_slot = s;
                }
            }
            if best_gain > here + 1e-12 {
                rest.insert(best_slot, v);
                order = rest;
                improved = true;
            }
        }
        guard += 1;
    }
    order
}

/// Bounding box in image pixels (inclusive).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Box4 {
    pub min_x: i32,
    pub min_y: i32,
    pub max_x: i32,
    pub max_y: i32,
}

/// Pieces of one color bridged into one area (see bridge).
#[derive(Clone, Debug, Default)]
pub struct Bridged {
    /// Components per pixel, with merged pieces and the pixels between them under the first piece;
    /// None when nothing was merged (then the components' own).
    pub comp: Option<Vec<i32>>,
    /// Pieces merged into another one.
    pub into: Vec<usize>,
    /// Bounding boxes of the merged areas, by their first piece.
    pub boxes: Vec<(usize, Box4)>,
}

/// Pieces of one color that a narrow detail sewn later (a line, a stripe) cuts apart are filled as
/// one area, under the detail: the rows go on underneath it, and the detail is sewn on top, as
/// digitizers do. Only gaps up to BRIDGE wide that are all later colors are bridged (a closing of
/// the color's pixels), never background or colors sewn before, and never between lines.
pub fn bridge(
    labels: &[u8],
    comps: &Components,
    w: usize,
    h: usize,
    px_mm: f64,
    rank: &[i32],
) -> Bridged {
    let mut out = Bridged::default();
    let rank_of = |l: u8| rank.get(l as usize).copied();
    // Pieces by label, labels in the order first met.
    let mut by_label: Vec<(u16, Vec<usize>)> = vec![];
    for (c, &l) in comps.label.iter().enumerate() {
        if l == u16::from(NONE) || comps.area[c] < 2 {
            continue;
        }
        match by_label.iter_mut().find(|(x, _)| *x == l) {
            Some((_, v)) => v.push(c),
            None => by_label.push((l, vec![c])),
        }
    }
    let r = BRIDGE / 2.0 / px_mm;
    let pad = r.ceil() as i64 + 2;
    for (label, cs) in &by_label {
        if cs.len() < 2 {
            continue;
        }
        let label = *label as u8;
        let min = |v: &[u32]| cs.iter().map(|&c| i64::from(v[c])).min().unwrap();
        let max = |v: &[u32]| cs.iter().map(|&c| i64::from(v[c])).max().unwrap();
        let x0 = (min(&comps.min_x) - pad).max(0) as usize;
        let y0 = (min(&comps.min_y) - pad).max(0) as usize;
        let x1 = (max(&comps.max_x) + pad).min(w as i64 - 1) as usize;
        let y1 = (max(&comps.max_y) + pad).min(h as i64 - 1) as usize;
        let ww = x1 - x0 + 1;
        let hh = y1 - y0 + 1;
        let mut member = vec![false; comps.label.len()];
        for &c in cs {
            member[c] = true;
        }
        let comp_at = |i: usize| comps.comp[(i / ww + y0) * w + (i % ww) + x0] as usize;
        let mut own = vec![0u8; ww * hh];
        for i in 0..ww * hh {
            if member[comp_at(i)] {
                own[i] = 1;
            }
        }
        let near = distance_to_seeds(&own, ww, hh, false);
        let not_near: Vec<u8> = near.iter().map(|&d| u8::from(f64::from(d) > r)).collect();
        let far = distance_to_seeds(&not_near, ww, hh, true);
        // In the closing of the color, between its pieces, and a color sewn later.
        let mut between = vec![0u8; ww * hh];
        for y in 0..hh {
            for x in 0..ww {
                let i = y * ww + x;
                let l = labels[(y + y0) * w + x + x0];
                if own[i] == 0
                    && f64::from(near[i]) <= r
                    && f64::from(far[i]) > r
                    && l != NONE
                    && matches!((rank_of(l), rank_of(label)), (Some(a), Some(b)) if a > b)
                {
                    between[i] = 1;
                }
            }
        }
        // Which pieces the pixels between connect.
        let mut parent: Vec<usize> = (0..ww * hh).collect();
        fn find(parent: &mut [usize], mut i: usize) -> usize {
            while parent[i] != i {
                parent[i] = parent[parent[i]];
                i = parent[i];
            }
            i
        }
        let in_set = |i: usize| own[i] != 0 || between[i] != 0;
        for y in 0..hh {
            for x in 0..ww {
                let i = y * ww + x;
                if !in_set(i) {
                    continue;
                }
                if x > 0 && in_set(i - 1) {
                    let a = find(&mut parent, i);
                    let b = find(&mut parent, i - 1);
                    parent[a] = b;
                }
                if y > 0 && in_set(i - ww) {
                    let a = find(&mut parent, i);
                    let b = find(&mut parent, i - ww);
                    parent[a] = b;
                }
            }
        }
        // Pieces each root connects, roots in the order first met.
        let mut pieces: Vec<(usize, Vec<usize>)> = vec![];
        let mut piece_of: IdMap<usize, usize> = IdMap::default();
        for i in 0..ww * hh {
            if own[i] == 0 {
                continue;
            }
            let root = find(&mut parent, i);
            let k = *piece_of.entry(root).or_insert_with(|| {
                pieces.push((root, vec![]));
                pieces.len() - 1
            });
            let c = comp_at(i);
            if !pieces[k].1.contains(&c) {
                pieces[k].1.push(c);
            }
        }
        // How thick the color is where it is its own: lines are not bridged into one area (see LINE_DEPTH).
        let not_own: Vec<u8> = own.iter().map(|&v| 1 - v).collect();
        let inner = distance_to_seeds(&not_own, ww, hh, true);
        for (root, set) in &pieces {
            if set.len() < 2 {
                continue;
            }
            let mut depth: Vec<f32> = vec![];
            for i in 0..ww * hh {
                if own[i] != 0 && find(&mut parent, i) == *root {
                    depth.push(inner[i]);
                }
            }
            depth.sort_by(f32::total_cmp);
            // Lines (an outline cut by the areas it frames): closing the gaps between them would fill those
            // areas, small ones beside a junction, into the line as thick places.
            let d = depth[(depth.len() as f64 * 0.9).floor() as usize];
            if f64::from(d) * px_mm < LINE_DEPTH {
                continue;
            }
            let comp = out
                .comp
                .get_or_insert_with(|| comps.comp.iter().map(|&v| v as i32).collect());
            let first = *set.iter().min().unwrap();
            let mut b = Box4 {
                min_x: i32::MAX,
                min_y: i32::MAX,
                max_x: i32::MIN,
                max_y: i32::MIN,
            };
            for i in 0..ww * hh {
                if !in_set(i) || find(&mut parent, i) != *root {
                    continue;
                }
                let x = (i % ww + x0) as i32;
                let y = (i / ww + y0) as i32;
                comp[y as usize * w + x as usize] = first as i32;
                b.min_x = b.min_x.min(x);
                b.min_y = b.min_y.min(y);
                b.max_x = b.max_x.max(x);
                b.max_y = b.max_y.max(y);
            }
            for &c in set {
                if c != first && !out.into.contains(&c) {
                    out.into.push(c);
                }
            }
            out.boxes.push((first, b));
        }
    }
    out
}

/// The runs of one thread, and the object each of them belongs to.
pub struct Block {
    pub runs: Vec<Vec<Pt>>,
    pub owners: Vec<usize>,
}

/// Records of a design (absolute, 0.1 mm), and the number of the first stitch of each object.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Assembled {
    pub x: Vec<i32>,
    pub y: Vec<i32>,
    pub cmd: Vec<u8>,
    pub starts: Vec<usize>,
}

/// Point `d` mm along the run from its start (or end, with `from_end`).
fn along(run: &[Pt], d: f64, from_end: bool) -> Pt {
    let pts: Vec<Pt> = if from_end {
        run.iter().rev().copied().collect()
    } else {
        run.to_vec()
    };
    let mut left = d;
    for i in 1..pts.len() {
        let l = dist(pts[i - 1], pts[i]);
        if l >= left {
            let t = left / l;
            return [
                pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
                pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
            ];
        }
        left -= l;
    }
    pts[pts.len() - 1]
}

/// Builds the records with (cx, cy) mm of the image as their origin; coordinates in 0.1 mm. Lock
/// stitches are half-stitch locks 0, 0.5, 1, 0.5, 0 of LOCK_MM along the path, as Ink/Stitch's default.
pub fn assemble(blocks: &[Block], cx: f64, cy: f64, trim_mm: f64) -> Assembled {
    struct B {
        out: Assembled,
        last: Option<Pt>,
        sewn: usize,
    }
    impl B {
        fn emit(&mut self, p: Pt, cmd: u8, cx: f64, cy: f64) {
            let nx = round((p[0] - cx) * 10.0) as i32;
            let ny = round((p[1] - cy) * 10.0) as i32;
            self.out.x.push(nx);
            self.out.y.push(ny);
            self.out.cmd.push(cmd);
            if cmd == STITCH {
                self.sewn += 1;
            }
            self.last = Some(p);
        }
        fn mark(&mut self, cmd: u8) {
            let (x, y) = (
                self.out.x.last().copied().unwrap_or(0),
                self.out.y.last().copied().unwrap_or(0),
            );
            self.out.x.push(x);
            self.out.y.push(y);
            self.out.cmd.push(cmd);
        }
        fn stitch(&mut self, p: Pt, cx: f64, cy: f64) {
            if self.last.is_some_and(|l| dist(l, p) < 0.1) {
                return;
            }
            self.emit(p, STITCH, cx, cy);
        }
        fn tie(&mut self, run: &[Pt], end: bool, cx: f64, cy: f64) {
            let p = if end { run[run.len() - 1] } else { run[0] };
            for t in [0.5, 1.0, 0.5] {
                self.emit(along(run, LOCK_MM * t, end), STITCH, cx, cy);
            }
            self.emit(p, STITCH, cx, cy);
        }
    }
    let mut b = B {
        out: Assembled::default(),
        last: None,
        sewn: 0,
    };
    let mut prev: Option<&Vec<Pt>> = None;
    let mut owner = usize::MAX;
    for (bi, block) in blocks.iter().enumerate() {
        for (ri, run) in block.runs.iter().enumerate() {
            let start = run[0];
            // Where a new object begins: right before its first stitch.
            let mut mark = |b: &mut B| {
                if block.owners[ri] != owner {
                    owner = block.owners[ri];
                    b.out.starts.push(b.sewn);
                }
            };
            match prev {
                Some(p) if ri > 0 => {
                    let gap = dist(p[p.len() - 1], start);
                    if gap <= 1.0 {
                        mark(&mut b);
                        b.stitch(start, cx, cy);
                    } else if gap <= trim_mm {
                        b.emit(start, JUMP, cx, cy);
                        mark(&mut b);
                        b.emit(start, STITCH, cx, cy);
                    } else {
                        b.tie(p, true, cx, cy);
                        b.mark(TRIM);
                        b.emit(start, JUMP, cx, cy);
                        mark(&mut b);
                        b.emit(start, STITCH, cx, cy);
                        b.tie(run, false, cx, cy);
                    }
                }
                _ => {
                    // The first run of a thread (or of all): from a trim, tied in.
                    if let Some(p) = prev {
                        b.tie(p, true, cx, cy);
                        b.mark(TRIM);
                        if bi > 0 {
                            b.mark(COLOR_CHANGE);
                        }
                    }
                    b.emit(start, JUMP, cx, cy);
                    mark(&mut b);
                    b.emit(start, STITCH, cx, cy);
                    b.tie(run, false, cx, cy);
                }
            }
            for p in &run[1..] {
                b.stitch(*p, cx, cy);
            }
            prev = Some(run);
        }
    }
    if let Some(p) = prev {
        b.tie(p, true, cx, cy);
        b.mark(TRIM);
    }
    b.mark(END);
    b.out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;
    use crate::digitize::skeleton::Node;
    use crate::image::labels::components;

    fn line_graph(pts: Vec<Pt>, r: f64) -> Graph {
        let n = pts.len();
        Graph {
            nodes: vec![Node { p: pts[0], r }, Node { p: pts[n - 1], r }],
            branches: vec![Branch {
                a: 0,
                b: 1,
                r: vec![r; n],
                pts,
            }],
        }
    }

    #[test]
    fn classifies_by_the_widths_along_the_skeleton() {
        let pts: Vec<Pt> = (0..=40).map(|i| [i as f64 * 0.5, 0.0]).collect();
        // 3 mm wide and 20 mm long: satin; 10 mm wide: fill; 0.4 mm: a line.
        assert_eq!(
            classify(&line_graph(pts.clone(), 1.5), 1.0, 7.0),
            Kind::Satin
        );
        assert_eq!(
            classify(&line_graph(pts.clone(), 5.0), 1.0, 7.0),
            Kind::Fill
        );
        assert_eq!(classify(&line_graph(pts, 0.2), 1.0, 7.0), Kind::Run);
        assert_eq!(
            classify(
                &Graph {
                    nodes: vec![],
                    branches: vec![]
                },
                1.0,
                7.0
            ),
            Kind::Fill
        );
    }

    #[test]
    fn sews_a_stroke_as_satin_and_a_blob_not() {
        // A bar 3 mm wide, 20 mm long.
        let bar = region_of(300, 0.1, |x, y| {
            (5.0..25.0).contains(&x) && (13.5..16.5).contains(&y)
        });
        let p = SatinParams {
            spacing: 0.4,
            split_mm: 7.0,
            ..Default::default()
        };
        let runs = satin_for_area(&bar, [5.0, 15.0], &p, true, 0.15, 7.0, 2.4).expect("satin");
        assert_eq!(runs.len(), 1);
        assert!(satin_ok(&runs, &bar, 2.4 * 2.0 / 0.4));
        let disc = region_of(300, 0.1, |x, y| (x - 15.0).hypot(y - 15.0) < 8.0);
        assert!(satin_for_area(&disc, [5.0, 15.0], &p, true, 0.15, 7.0, 2.4).is_none());
        // Run stitch along the bar's middle, there and back.
        let g = skeleton(&bar);
        let run = &sew_run(&bar, &g, [5.0, 15.0], 0.15)[0];
        assert!(dist(run[0], run[run.len() - 1]) < 1.0);
    }

    #[test]
    fn walks_a_star_in_one_run() {
        let c = [10.0, 10.0];
        let mut nodes = vec![Node { p: c, r: 1.0 }];
        let mut branches = vec![];
        for k in 0..3 {
            let a = k as f64 * 2.0;
            let end = [c[0] + 5.0 * a.cos(), c[1] + 5.0 * a.sin()];
            nodes.push(Node { p: end, r: 1.0 });
            branches.push(Branch {
                a: 0,
                b: k + 1,
                pts: vec![c, end],
                r: vec![1.0, 1.0],
            });
        }
        let g = Graph { nodes, branches };
        let mut legs = vec![];
        let run = walk(&g, [100.0, 0.0], |b, _, _, leg| {
            legs.push((b.a, b.b, leg == Leg::Out));
            b.pts.clone()
        });
        // Starts at a free end, every branch out and back.
        assert_eq!(legs.len(), 6);
        assert!(g.nodes[legs[0].0].p != c);
        assert!(!run.is_empty());
    }

    #[test]
    fn orders_narrow_colors_after_the_wide_ones_they_touch() {
        // A wide field (label 0) with a thin stripe (label 1) across it and a dot (label 2).
        let (w, h) = (100, 60);
        let mut labels = vec![0u8; w * h];
        for y in 0..h {
            for x in 48..51 {
                labels[y * w + x] = 1;
            }
        }
        for y in 20..30 {
            for x in 10..20 {
                labels[y * w + x] = 2;
            }
        }
        let c = components(&labels, w, h);
        let order = sewing_order(&labels, &c, w, h, 0.1, 3);
        assert_eq!(order[0], 0);
        // Many colors: by moves, the same rule.
        let before = vec![
            vec![0.0, 1.0, 0.0],
            vec![0.0, 0.0, 0.0],
            vec![2.0, 3.0, 0.0],
        ];
        assert_eq!(order_exact(&before), vec![2, 0, 1]);
        assert_eq!(order_by_moves(&before, &[0, 1, 2]), vec![2, 0, 1]);
    }

    #[test]
    fn bridges_pieces_cut_by_a_later_line() {
        // Label 0 cut in two by a 1 mm stripe of label 1, sewn later.
        let (w, h) = (200, 100);
        let mut labels = vec![0u8; w * h];
        for y in 0..h {
            for x in 95..105 {
                labels[y * w + x] = 1;
            }
        }
        let c = components(&labels, w, h);
        let b = bridge(&labels, &c, w, h, 0.1, &[0, 1]);
        assert_eq!(b.into.len(), 1);
        assert_eq!(b.boxes.len(), 1);
        let comp = b.comp.unwrap();
        assert_eq!(comp[50 * w + 100], comp[50 * w + 10]);
        // Sewn before the stripe: not bridged under it.
        assert!(bridge(&labels, &c, w, h, 0.1, &[1, 0]).comp.is_none());
    }

    #[test]
    fn assembles_with_ties_jumps_and_trims() {
        let a: Vec<Pt> = (0..=10).map(|i| [i as f64, 0.0]).collect();
        let near: Vec<Pt> = (0..=10).map(|i| [10.5 + i as f64, 0.0]).collect();
        let far: Vec<Pt> = (0..=10).map(|i| [40.0 + i as f64, 0.0]).collect();
        let out = assemble(
            &[
                Block {
                    runs: vec![a, near],
                    owners: vec![0, 1],
                },
                Block {
                    runs: vec![far],
                    owners: vec![2],
                },
            ],
            0.0,
            0.0,
            3.0,
        );
        assert_eq!(out.starts.len(), 3);
        assert_eq!(out.cmd[0], JUMP);
        assert_eq!(*out.cmd.last().unwrap(), END);
        assert_eq!(out.cmd.iter().filter(|&&c| c == COLOR_CHANGE).count(), 1);
        assert_eq!(out.cmd.iter().filter(|&&c| c == TRIM).count(), 2);
        // The near run follows with a plain stitch: no jump between the first two objects.
        assert_eq!(out.cmd.iter().filter(|&&c| c == JUMP).count(), 2);
    }
}
