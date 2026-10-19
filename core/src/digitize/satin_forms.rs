//! Areas cut at their corners for "Vorschlagen" (see satinSuggest), as a digitizer cuts them by hand:
//!
//! - `spikes`: points standing off a body (a star, a grass tuft, the bars of an E standing off its
//!   stem). Each is cut off at its base, from the notch on one side to the notch on the other, and
//!   sewn as a column from the base to its tip; the body is planned on its own.
//! - `frame`: a band turning a corner with a corner outside and one inside (a frame, an L, the
//!   corners of a block letter). It is cut on the miter, from the outer corner to the inner one, so
//!   each side is a column of its own ending on the slant.
//!
//! Each part left is then planned as a column along it (a stroke, a bar, a spike) or as a compact
//! shape (a dot, a pointed area: see satin_shapes).
//!
//! Ported from src/digitize/satinForms.ts.

use serde::Serialize;

use super::rungs::{InsideTest, by, inside, norm, strips_of_outline, sub};
use super::satin_shapes::{
    Material, Shape, add, centroid, degrees, dot, grid, max_of, perp, plan_shape,
};
use super::skeleton::{Branch, Graph, Node};
use crate::geom::Pt;
use crate::js::{dist, hypot};

/// A sharp bend of an outline: where, how sharp, sticking out or cutting in, and the way into the area.
#[derive(Clone, Copy, Debug)]
struct Bend {
    p: Pt,
    /// Index on its ring.
    i: usize,
    /// Distance along its ring.
    s: f64,
    deg: f64,
    convex: bool,
    into: Pt,
    /// Turn over a short arm (degrees): a corner, not the round end of a line.
    sharp: f64,
}

/// A bend sharper than this (degrees, over BEND_ARM either side) is a corner.
const BEND_DEG: f64 = 45.0;
const BEND_ARM: f64 = 1.0;
/// A spike's tip turns at least SHARP_DEG within SHARP_ARM either side (a round line end turns less).
const SHARP_ARM: f64 = 0.4;
const SHARP_DEG: f64 = 70.0;
/// A miter runs within this angle of the bisectors of both its corners (degrees).
const MITER_DEG: f64 = 25.0;
/// A spike sticks out at least this share of its base from it.
const SPIKE_DEPTH: f64 = 0.8;

/// A ring without the first point repeated at its end.
fn open(ring: &[Pt]) -> &[Pt] {
    if ring.len() > 2 && dist(ring[0], ring[ring.len() - 1]) < 1e-9 {
        &ring[..ring.len() - 1]
    } else {
        ring
    }
}

/// Around point `i` of a closed list of `n` points, the arms reaching `arm` mm either side
/// (at most half way round): their far indices.
fn arms(at: &dyn Fn(i64) -> Pt, i: i64, n: usize, arm: f64) -> (i64, i64) {
    let (mut a, mut b, mut la, mut lb) = (i, i, 0.0, 0.0);
    while la < arm && ((i - a) as f64) < n as f64 / 2.0 {
        let p = at(a);
        a -= 1;
        la += dist(p, at(a));
    }
    while lb < arm && ((b - i) as f64) < n as f64 / 2.0 {
        let p = at(b);
        b += 1;
        lb += dist(p, at(b));
    }
    (a, b)
}

/// The corners of a closed outline, in order along it (`hole`: the material is outside it).
fn bends(ring: &[Pt], material: &Material, hole: bool) -> Vec<Bend> {
    let pts = open(ring);
    let n = pts.len();
    if n < 8 {
        return vec![];
    }
    let mut cum = vec![0.0];
    for i in 1..=n {
        cum.push(cum[i - 1] + dist(pts[i - 1], pts[i % n]));
    }
    let total = cum[n];
    let at = |k: i64| pts[k.rem_euclid(n as i64) as usize];
    let mut area = 0.0;
    for i in 0..n as i64 {
        area += at(i)[0] * at(i + 1)[1] - at(i + 1)[0] * at(i)[1];
    }
    let left = (area > 0.0) != hole;
    let turn = |i: usize, arm: f64| -> (f64, bool, Pt) {
        let (a, b) = arms(&at, i as i64, n, arm);
        let p = at(i as i64);
        let din = norm(sub(p, at(a)));
        let dout = norm(sub(at(b), p));
        let m = [(at(a)[0] + at(b)[0]) / 2.0, (at(a)[1] + at(b)[1]) / 2.0];
        let toward = norm(sub(m, p));
        // By which way the outline turns there (a thin tip may have no material a probe's length in).
        let cross = din[0] * dout[1] - din[1] * dout[0];
        let convex = if cross.abs() > 0.03 {
            (cross > 0.0) == left
        } else {
            material.test(add(p, toward, 0.15))
        };
        let into = if convex {
            toward
        } else {
            [-toward[0], -toward[1]]
        };
        (degrees(din, dout), convex, into)
    };
    let ts: Vec<(f64, bool, Pt)> = (0..n).map(|i| turn(i, BEND_ARM)).collect();
    let mut out: Vec<Bend> = vec![];
    for i in 0..n {
        let (deg, convex, into) = ts[i];
        if deg < BEND_DEG || ts[(i + n - 1) % n].0 > deg || ts[(i + 1) % n].0 >= deg {
            continue;
        }
        let close = out.iter_mut().find(|f| {
            f.convex == convex && (f.s - cum[i]).abs().min(total - (f.s - cum[i]).abs()) < 1.2
        });
        match close {
            Some(close) => {
                if deg > close.deg {
                    close.p = pts[i];
                    close.i = i;
                    close.s = cum[i];
                    close.deg = deg;
                    close.into = into;
                }
            }
            None => out.push(Bend {
                p: pts[i],
                i,
                s: cum[i],
                deg,
                convex,
                into,
                sharp: 0.0,
            }),
        }
    }
    for b in &mut out {
        b.sharp = turn(b.i, SHARP_ARM).0;
    }
    out.sort_by(|a, b| by(a.s, b.s));
    out
}

/// Whether the segment runs through the area, clear of its edge.
fn through(material: &Material, a: Pt, b: Pt, clear: f64) -> bool {
    let n = perp(norm(sub(b, a)));
    let mut f = 0.1;
    while f < 0.95 {
        let q = add(a, sub(b, a), f);
        if !material.test(q)
            || !material.test(add(q, n, clear))
            || !material.test(add(q, n, -clear))
        {
            return false;
        }
        f += 0.1;
    }
    true
}

/// The point `s` along a closed outline (wrapping round).
fn along(ring: &[Pt], s: f64) -> Pt {
    let n = ring.len();
    let mut total = 0.0;
    for i in 1..=n {
        total += dist(ring[i - 1], ring[i % n]);
    }
    let mut x = ((s % total) + total) % total;
    for i in 1..=n {
        let l = dist(ring[i - 1], ring[i % n]);
        if x <= l {
            return add(
                ring[i - 1],
                sub(ring[i % n], ring[i - 1]),
                if l != 0.0 { x / l } else { 0.0 },
            );
        }
        x -= l;
    }
    ring[0]
}

/// The cut lines at the corners of an area (see corner_cuts).
#[derive(Clone, Debug, Default, Serialize)]
pub struct CornerCuts {
    pub cuts: Vec<[Pt; 2]>,
    pub spikes: usize,
    pub miters: usize,
    /// The corners of each spike, by the index of its cut line (the spikes' come first).
    pub tips: Vec<Vec<Pt>>,
}

/// The cut lines at the corners of an area: spikes cut off at their bases, bands cut on the miter
/// where they turn a corner. `max` is the widest column (mm).
pub fn corner_cuts(
    outsides: &[Vec<Pt>],
    holes: &[Vec<Pt>],
    material: &Material,
    max: f64,
) -> CornerCuts {
    let mut cuts: Vec<[Pt; 2]> = vec![];
    let mut all: Vec<Bend> = vec![];
    let mut used: Vec<bool> = vec![];
    let mut tips_of: Vec<Vec<Pt>> = vec![];
    for ring in outsides {
        let first = all.len();
        all.extend(bends(ring, material, false));
        used.resize(all.len(), false);
        let notches: Vec<usize> = (first..all.len()).filter(|&k| !all[k].convex).collect();
        if notches.len() < 2 {
            continue;
        }
        let pts = open(ring);
        let mut total = 0.0;
        for i in 1..=pts.len() {
            total += dist(pts[i - 1], pts[i % pts.len()]);
        }
        let fwd = |x: f64, a: f64| (((x - a) % total) + total) % total;
        for (k, &ia) in notches.iter().enumerate() {
            let ib = notches[(k + 1) % notches.len()];
            let (a, b) = (all[ia], all[ib]);
            let arc = fwd(b.s, a.s);
            // Two notches: the spike is the shorter way round.
            if notches.len() == 2 && arc > total / 2.0 {
                continue;
            }
            // Corners sticking out between the two notches: the spike.
            let tips: Vec<&Bend> = all[first..]
                .iter()
                .filter(|x| x.convex && fwd(x.s, a.s) < arc)
                .collect();
            if !tips.iter().any(|x| x.sharp >= SHARP_DEG) {
                continue;
            }
            let base = dist(a.p, b.p);
            // Up to twice the widest column: a wider spike is cut along its middle too (see spike_lines).
            if base > 2.0 * max
                || base < 0.4
                || arc < 2.2 * base
                || !through(material, a.p, b.p, 0.12)
            {
                continue;
            }
            let mut depth = 0.0f64;
            let u = norm(sub(b.p, a.p));
            let mut x = 0.0;
            while x < arc {
                depth = depth.max(dot(sub(along(pts, a.s + x), a.p), perp(u)).abs());
                x += 0.2;
            }
            if depth < SPIKE_DEPTH * base {
                continue;
            }
            // A little in from the notches toward the spike, so two spikes side by side do not share an end.
            let p = along(pts, a.s + 0.15);
            let q = along(pts, b.s - 0.15);
            let d = norm(sub(q, p));
            cuts.push([add(p, d, -0.3), add(q, d, 0.3)]);
            used[ia] = true;
            used[ib] = true;
            tips_of.push(tips.iter().map(|x| x.p).collect());
        }
    }
    let holes_from = all.len();
    for ring in holes {
        all.extend(bends(ring, material, true));
    }
    used.resize(all.len(), false);
    // Miters: an outer corner and the inner corner facing it across the band.
    let outer: Vec<usize> = (0..all.len())
        .filter(|&k| all[k].convex && all[k].deg >= 60.0)
        .collect();
    let inner: Vec<usize> = (0..all.len())
        .filter(|&k| !all[k].convex && !used[k])
        .collect();
    let mut pairs: Vec<(usize, usize, f64)> = vec![];
    for &o in &outer {
        for &n in &inner {
            let (bo, bn) = (all[o], all[n]);
            let v = sub(bn.p, bo.p);
            let d = hypot(v[0], v[1]);
            if d < 0.4 || d > 1.5 * max {
                continue;
            }
            if degrees(v, bo.into) > MITER_DEG || degrees([-v[0], -v[1]], bn.into) > MITER_DEG {
                continue;
            }
            if !through(material, bo.p, bn.p, 0.12) {
                continue;
            }
            pairs.push((o, n, d));
        }
    }
    pairs.sort_by(|x, y| by(x.2, y.2));
    let mut miters = 0;
    for (o, n, _) in pairs {
        if used[o] || used[n] {
            continue;
        }
        used[o] = true;
        used[n] = true;
        // From just beyond each corner, so the line crosses the outline there rather than grazing a vertex.
        let a = add(all[o].p, norm(all[o].into), -0.15);
        let b = add(all[n].p, norm(all[n].into), -0.15);
        let d = norm(sub(b, a));
        cuts.push([add(a, d, -0.3), add(b, d, 0.3)]);
        miters += 1;
    }
    // A sharp corner of a hole whose outer corner is round (a ring drawn with a brush): the miter
    // runs along the inner corner's bisector to where the outline turns round it.
    let rings: Vec<Vec<Pt>> = outsides.iter().chain(holes).cloned().collect();
    for &k in &inner {
        let n = all[k];
        if k < holes_from || used[k] || n.deg < 60.0 || n.sharp < 0.7 * n.deg {
            continue;
        }
        let d = norm(n.into);
        let mut t = 0.1;
        while t < 1.5 * max && material.test(add(n.p, d, t)) {
            t += 0.05;
        }
        if t >= 1.5 * max || t < 0.4 {
            continue;
        }
        let e = add(n.p, d, t);
        if !through(material, n.p, add(n.p, d, t - 0.1), 0.12)
            || !round_corner(&rings, material, e, t.max(1.0))
        {
            continue;
        }
        used[k] = true;
        cuts.push([add(n.p, d, -0.45), add(e, d, 0.3)]);
        miters += 1;
    }
    CornerCuts {
        cuts,
        spikes: tips_of.len(),
        miters,
        tips: tips_of,
    }
}

/// Whether the outline turns round the material by a corner's worth near q, over `arm` either side.
fn round_corner(rings: &[Vec<Pt>], material: &Material, q: Pt, arm: f64) -> bool {
    let mut best = (f64::INFINITY, usize::MAX, 0usize);
    for (r, ring) in rings.iter().enumerate() {
        for (i, &p) in ring.iter().enumerate() {
            let d = dist(p, q);
            if d < best.0 {
                best = (d, r, i);
            }
        }
    }
    if best.1 == usize::MAX || best.0 > 0.3 {
        return false;
    }
    let ring = &rings[best.1];
    let n = ring.len();
    let at = |k: i64| ring[k.rem_euclid(n as i64) as usize];
    let (a, b) = arms(&at, best.2 as i64, n, arm);
    let turn = degrees(sub(q, at(a)), sub(at(b), q));
    // Round the material: the chord between the arms' ends runs through it.
    turn >= BEND_DEG && material.test(add(at(a), sub(at(b), at(a)), 0.5))
}

/// How a part the cut lines leave is planned: lines across it, or as a stroke along the centerline
/// within it (the TypeScript plans those, see satinSuggest's planStrokes).
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum PartPlan {
    Lines {
        cuts: Vec<[Pt; 2]>,
        lines: Vec<[Pt; 2]>,
    },
    Strokes {
        graph: Graph,
        ring: Vec<Pt>,
    },
}

/// Lines across for each part the cut lines leave: a column along it where it is long (by the
/// area's centerline `g` within it), else as a compact shape. None when a part fits neither. The
/// cut lines are those given and then those of the parts' plans, in order.
pub fn plan_parts(
    outsides: &[Vec<Pt>],
    holes: &[Vec<Pt>],
    cuts: &[[Pt; 2]],
    tips: &[Vec<Pt>],
    g: &Graph,
    max: f64,
) -> Option<Vec<PartPlan>> {
    let mut plans = vec![];
    let as_cuts: Vec<Vec<Pt>> = cuts.iter().map(|c| c.to_vec()).collect();
    for o in outsides {
        let mine: Vec<Vec<Pt>> = holes.iter().filter(|h| inside(o, h[0])).cloned().collect();
        let made = strips_of_outline(o, &[], &as_cuts, &mine);
        if made.hole >= 0 {
            return None;
        }
        for part in &made.parts {
            // A spike: the part with its corners beyond the only cut line it has, a spike's base.
            let on: Vec<usize> = (0..cuts.len())
                .filter(|&k| {
                    near_ring(part, add(cuts[k][0], sub(cuts[k][1], cuts[k][0]), 0.5)) < 0.05
                })
                .collect();
            let base = (on.len() == 1
                && on[0] < tips.len()
                && tips[on[0]].iter().any(|&t| near_ring(part, t) < 0.3))
            .then(|| cuts[on[0]]);
            let plan = match base {
                Some(base) => spike_lines(part, base, max),
                None => plan_part(part, g, max),
            };
            plans.push(plan?);
        }
    }
    Some(plans)
}

/// How far q lies from the outline.
fn near_ring(ring: &[Pt], q: Pt) -> f64 {
    let mut best = f64::INFINITY;
    for i in 1..ring.len() {
        let a = ring[i - 1];
        let v = sub(ring[i], a);
        let l2 = dot(v, v);
        let t = if l2 != 0.0 {
            (dot(sub(q, a), v) / l2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        best = best.min(dist(add(a, v, t), q));
    }
    best
}

/// A spike sewn from its base to its tip: lines along the base, a third and two thirds of the way
/// up. Wider at its base than `max`: cut along its middle from the tip, each half sewn across.
fn spike_lines(part: &[Pt], base: [Pt; 2], max: f64) -> Option<PartPlan> {
    let m = add(base[0], sub(base[1], base[0]), 0.5);
    let b = norm(sub(base[1], base[0]));
    // The tip: the middle of the farthest points (a flat end has many).
    let up = |q: Pt| dot(sub(q, m), perp(b)).abs();
    let far = max_of(part.iter().map(|&q| up(q)));
    let top: Vec<Pt> = part
        .iter()
        .copied()
        .filter(|&q| up(q) > far - 0.2)
        .collect();
    let tip = centroid(&top);
    // Up the spike, and across it.
    let n = norm(sub(tip, m));
    let u = perp(n);
    let h = dist(tip, m);
    let mine = InsideTest::new(part);
    let split = dist(base[0], base[1]) > max;
    let mut lines = vec![];
    for f in [0.3, 0.6] {
        let o = add(m, n, h * f);
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        let mut t = -20.0;
        while t <= 20.0 {
            if mine.test(add(o, u, t)) {
                lo = lo.min(t);
                hi = hi.max(t);
            }
            t += 0.05;
        }
        if hi - lo < 0.3 {
            continue;
        }
        // Through the middle of the spike at that height, or of each half.
        let at: Vec<f64> = if split {
            vec![lo + (0.0 - lo) / 2.0, hi / 2.0]
        } else {
            vec![(lo + hi) / 2.0]
        };
        for t in at {
            let c = add(o, u, t);
            if mine.test(c) {
                lines.push([add(c, u, -0.2), add(c, u, 0.2)]);
            }
        }
    }
    if lines.is_empty() {
        return None;
    }
    Some(PartPlan::Lines {
        cuts: if split {
            vec![[add(m, n, -0.3), add(tip, n, 0.3)]]
        } else {
            vec![]
        },
        lines,
    })
}

fn plan_part(part: &[Pt], g: &Graph, max: f64) -> Option<PartPlan> {
    let mine = InsideTest::new(part);
    // The centerline within the part, as pieces (a little in from where it leaves the part).
    let mut nodes: Vec<Node> = vec![];
    let mut branches: Vec<Branch> = vec![];
    for b in &g.branches {
        let mut run: Vec<usize> = vec![];
        let mut flush = |run: &mut Vec<usize>| {
            if run.len() > 2 {
                let pts: Vec<Pt> = run.iter().map(|&k| b.pts[k]).collect();
                let r: Vec<f64> = run.iter().map(|&k| b.r[k]).collect();
                nodes.push(Node { p: pts[0], r: r[0] });
                nodes.push(Node {
                    p: pts[pts.len() - 1],
                    r: r[r.len() - 1],
                });
                branches.push(Branch {
                    a: nodes.len() - 2,
                    b: nodes.len() - 1,
                    pts,
                    r,
                });
            }
            run.clear();
        };
        for (k, &p) in b.pts.iter().enumerate() {
            if mine.test(p) {
                run.push(k);
            } else {
                flush(&mut run);
            }
        }
        flush(&mut run);
    }
    let samples = grid(part, &|q| mine.test(q));
    if samples.len() < 4 {
        return Some(PartPlan::Lines {
            cuts: vec![],
            lines: vec![],
        });
    }
    // Its long way (of the second moments) and how far it reaches along and across it.
    let c = centroid(&samples);
    let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
    for &q in &samples {
        let [u, v] = sub(q, c);
        sxx += u * u;
        syy += v * v;
        sxy += u * v;
    }
    let a = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    let u = [a.cos(), a.sin()];
    let n = perp(u);
    let (mut ulo, mut uhi, mut nlo, mut nhi) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for &q in &samples {
        let (du, dn) = (dot(sub(q, c), u), dot(sub(q, c), n));
        ulo = ulo.min(du);
        uhi = uhi.max(du);
        nlo = nlo.min(dn);
        nhi = nhi.max(dn);
    }
    let (l, w) = (uhi - ulo, nhi - nlo);
    // Longer than wide (a bar, a spike): a column along it, lines square to its long way.
    if l >= 1.15 * w && w <= max {
        // Bending along its way (a curved stroke): lines square to its centerline as it turns.
        let main = branches
            .iter()
            .reduce(|p, b| if b.pts.len() > p.pts.len() { b } else { p });
        if let Some(main) = main
            && main.pts.len() > 10
        {
            let k = main.pts.len();
            let t0 = sub(main.pts[5.min(k - 1)], main.pts[0]);
            let t1 = sub(main.pts[k - 1], main.pts[k.saturating_sub(6)]);
            if degrees(t0, t1) > 30.0 {
                return Some(PartPlan::Strokes {
                    graph: Graph {
                        nodes: vec![nodes[main.a].clone(), nodes[main.b].clone()],
                        branches: vec![Branch {
                            a: 0,
                            b: 1,
                            ..main.clone()
                        }],
                    },
                    ring: part.to_vec(),
                });
            }
        }
        let k = if l > 2.5 * w {
            3
        } else if l > 1.6 * w {
            2
        } else {
            1
        };
        let mut lines = vec![];
        for j in 1..=k {
            let p = add(c, u, ulo + (l * j as f64) / (k + 1) as f64);
            if mine.test(p) {
                lines.push([add(p, n, -0.3), add(p, n, 0.3)]);
            }
        }
        if !lines.is_empty() {
            return Some(PartPlan::Lines {
                cuts: vec![],
                lines,
            });
        }
    }
    let s = Shape {
        samples,
        outline: vec![part.to_vec()],
        holes: vec![],
        attach: vec![],
    };
    if let Some(plan) = plan_shape(&s, &|q| mine.test(q), max, true, true) {
        return Some(PartPlan::Lines {
            cuts: plan.cuts,
            lines: plan.lines,
        });
    }
    if w > max {
        return None;
    }
    Some(PartPlan::Lines {
        cuts: vec![],
        lines: vec![[add(c, n, -0.3), add(c, n, 0.3)]],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A five-pointed star, its points 20 mm across.
    fn star() -> Vec<Pt> {
        let mut v: Vec<Pt> = (0..10)
            .map(|i| {
                let a = -std::f64::consts::FRAC_PI_2 + i as f64 * std::f64::consts::PI / 5.0;
                let r = if i % 2 == 1 { 4.0 } else { 10.0 };
                [10.0 + r * a.cos(), 10.0 + r * a.sin()]
            })
            .collect();
        v.push(v[0]);
        // Points every 0.1 mm, as outlines of areas have them.
        let mut out = vec![];
        for w in v.windows(2) {
            let n = (dist(w[0], w[1]) / 0.1).ceil() as usize;
            for k in 0..n {
                out.push(add(w[0], sub(w[1], w[0]), k as f64 / n as f64));
            }
        }
        out.push(out[0]);
        out
    }

    #[test]
    fn a_star_has_five_spikes() {
        let o = vec![star()];
        let m = Material::new(&o, &[]);
        let c = corner_cuts(&o, &[], &m, 7.0);
        assert_eq!(c.spikes, 5);
        assert_eq!(c.cuts.len(), 5);
    }

    #[test]
    fn an_l_is_cut_on_the_miter() {
        let l: Vec<Pt> = [
            [0.0, 0.0],
            [3.0, 0.0],
            [3.0, 17.0],
            [20.0, 17.0],
            [20.0, 20.0],
            [0.0, 20.0],
            [0.0, 0.0],
        ]
        .to_vec();
        let mut ring = vec![];
        for w in l.windows(2) {
            let n = (dist(w[0], w[1]) / 0.1).ceil() as usize;
            for k in 0..n {
                ring.push(add(w[0], sub(w[1], w[0]), k as f64 / n as f64));
            }
        }
        ring.push(ring[0]);
        let o = vec![ring];
        let m = Material::new(&o, &[]);
        let c = corner_cuts(&o, &[], &m, 7.0);
        assert_eq!(c.miters, 1);
    }
}
