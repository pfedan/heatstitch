//! Operations on forms as vectors (src/shape/ops.ts): areas joined and cut exactly on their
//! curves, areas grown or shrunk by a distance (polygons, curves fitted again), paths cut where
//! they cross, a fill cut apart along drawn lines, and the free area around shapes.
//!
//! Joining and cutting on the curves uses `linesweeper` (a sweep over the curves themselves, kept
//! as curves), with the slivers it leaves where curves lie on each other dropped; offsets and the
//! polygon work use `clipper2-rust`, a faithful port of Clipper2. Chosen by measurement on the forms
//! of the demo project and the SVG examples (pull request "Rust core stage 2"): on 314 pairs and
//! 2 250 hard cases (the same form, moved by 1e-7 mm, turned) it is within 0.001 mm of a 1 µm
//! reference like paper.js before, with no case off by more than 0.1 mm (paper.js: 51), and keeps
//! the nodes of the input. Offsets with `clipper2-rust` give the same results as Clipper2 in
//! TypeScript did (within 0.042 mm of the reference in 375 of 375 cases), where offsetting the
//! curves directly failed past a curve's radius.

use std::collections::HashMap;

use clipper2_rust::{
    self as clip, ClipType, ClipperOffset, EndType, FillRule as ClipFill, JoinType, Path64,
    Paths64, Point64, PointInPolygonResult, PolyTree64,
};
use kurbo::{BezPath, PathEl, Point, Shape as _};
use linesweeper::topology::Topology;
use serde::{Deserialize, Serialize};

use crate::geom::Pt;
use crate::js::{dist, hypot, round};
use crate::shape::path::{
    Cubic, Form, Node, Path, bezier, insert_node, segment, segments, straight,
};
use crate::shape::vectorize::fit_cubic;

// Joining and cutting --------------------------------------------------------------------------

/// Curves nearer than this (mm) are one curve to the sweep. The sweep leaves a piece about a
/// hundred times this wide where curves lie on each other; at 1e-9 that is under 0.1 µm, a tenth of
/// `SLIVER`, and the sweep still holds on forms moved by 1e-7 mm or turned.
const SWEEP_EPS: f64 = 1e-9;
/// Result pieces thinner than this on average (twice their area over their outline, mm) are
/// slivers where curves lie on each other, not parts.
const SLIVER: f64 = 1e-3;
/// Result pieces smaller than this (mm²) are specks, not parts.
const SPECK: f64 = 1e-5;
/// A curve followed by itself backwards within this (mm) is a spike of no width.
const SPIKE: f64 = 1e-6;

/// Rule by which two forms are combined.
#[derive(Clone, Copy)]
enum Rule {
    Union,
    Difference,
    Intersect,
}

/// One result part: its outline first, then the outlines inside it (holes, parts in holes, ...).
type Shape = Vec<Vec<Cubic>>;

/// The closed paths of a form as one Bézier path (each closed, at least two nodes).
fn bez_path(f: &Form) -> BezPath {
    let mut bp = BezPath::new();
    for p in f.paths.iter().filter(|p| p.closed && p.nodes.len() > 1) {
        let at = |q: Pt| Point::new(q[0], q[1]);
        bp.move_to(at(p.nodes[0].p));
        for k in 0..segments(p) {
            let c = segment(p, k);
            if straight(&c) {
                bp.line_to(at(c[3]));
            } else {
                bp.curve_to(at(c[1]), at(c[2]), at(c[3]));
            }
        }
        bp.close_path();
    }
    bp
}

/// Whether a form has an area to work on.
fn has_area(f: &Form) -> bool {
    f.paths.iter().any(|p| p.closed && p.nodes.len() > 1)
}

/// The curves of one result contour, as cubics (lines with their handles on the nodes).
fn contour_cubics(bp: &BezPath) -> Vec<Cubic> {
    let pt = |p: Point| [p.x, p.y];
    let (mut start, mut last): (Pt, Pt) = ([0.0; 2], [0.0; 2]);
    let mut out = vec![];
    for el in bp.elements() {
        let cubic = match *el {
            PathEl::MoveTo(p) => {
                start = pt(p);
                last = start;
                continue;
            }
            PathEl::LineTo(p) => [last, last, pt(p), pt(p)],
            PathEl::QuadTo(q, p) => {
                let (q, e) = (pt(q), pt(p));
                [
                    last,
                    [
                        last[0] + 2.0 / 3.0 * (q[0] - last[0]),
                        last[1] + 2.0 / 3.0 * (q[1] - last[1]),
                    ],
                    [
                        e[0] + 2.0 / 3.0 * (q[0] - e[0]),
                        e[1] + 2.0 / 3.0 * (q[1] - e[1]),
                    ],
                    e,
                ]
            }
            PathEl::CurveTo(a, b, p) => [last, pt(a), pt(b), pt(p)],
            PathEl::ClosePath => [last, last, start, start],
        };
        last = cubic[3];
        // Pieces of no length.
        if dist(cubic[0], cubic[3]) < 1e-12 && straight(&cubic) {
            continue;
        }
        out.push(cubic);
    }
    out
}

/// A closed run of cubics without the spikes of no width in it: a curve followed by the same curve
/// backwards goes, a straight side followed by a way back along it is cut to what is left.
fn without_spikes(mut cs: Vec<Cubic>) -> Vec<Cubic> {
    loop {
        let n = cs.len();
        if n < 2 {
            return vec![];
        }
        let mut hit = None;
        for i in 0..n {
            let (a, b) = (cs[i], cs[(i + 1) % n]);
            if dist(a[0], b[3]) < SPIKE
                && dist(a[1], b[2]) < SPIKE
                && dist(a[2], b[1]) < SPIKE
                && dist(a[3], b[0]) < SPIKE
            {
                hit = Some((i, None));
                break;
            }
            if straight(&a) && straight(&b) {
                let u = [a[3][0] - a[0][0], a[3][1] - a[0][1]];
                let v = [b[3][0] - b[0][0], b[3][1] - b[0][1]];
                let lu = hypot(u[0], u[1]);
                if lu < 1e-12 || u[0] * v[0] + u[1] * v[1] >= 0.0 {
                    continue;
                }
                let off = ((b[3][0] - a[0][0]) * u[1] - (b[3][1] - a[0][1]) * u[0]).abs() / lu;
                if off < SPIKE {
                    hit = Some((i, Some([a[0], a[0], b[3], b[3]])));
                    break;
                }
            }
        }
        let Some((i, rest)) = hit else { return cs };
        let j = (i + 1) % n;
        let (lo, hi) = (i.min(j), i.max(j));
        cs.remove(hi);
        cs.remove(lo);
        if let Some(r) = rest.filter(|r| dist(r[0], r[3]) > 1e-12) {
            cs.insert(lo.min(cs.len()), r);
        }
    }
}

/// Whether a result contour is a part: not a sliver where curves lay on each other, not a speck.
fn is_part(bp: &BezPath) -> bool {
    let area = bp.area().abs();
    area >= SPECK && 2.0 * area / bp.perimeter(1e-5).max(1e-12) >= SLIVER
}

/// The parts the sweep found inside by `inside`, without slivers, specks and spikes.
fn shapes_of<W: linesweeper::topology::WindingNumber>(
    top: &Topology<W>,
    inside: impl Fn(&W) -> bool,
) -> Vec<Shape> {
    let contours = top.contours(inside);
    let all: Vec<&linesweeper::topology::Contour> = contours.contours().collect();
    let mut dropped = vec![false; all.len()];
    let mut shapes = vec![];
    for group in contours.grouped() {
        let mut shape: Shape = vec![];
        for idx in group {
            let c = all[idx.0];
            // What lies in a dropped piece goes with it.
            if c.parent.is_some_and(|p| dropped[p.0]) || !is_part(&c.path) {
                dropped[idx.0] = true;
                continue;
            }
            let cs = without_spikes(contour_cubics(&c.path));
            if cs.len() < 2 {
                dropped[idx.0] = true;
                continue;
            }
            shape.push(cs);
        }
        if !shape.is_empty() {
            shapes.push(shape);
        }
    }
    shapes
}

/// The sweep moves points by well under this (mm): a result point this near a node of the input
/// is that node.
const SNAP: f64 = 1e-5;

/// The input nodes, to find a result point's node by.
struct Known {
    cells: HashMap<(i64, i64), Vec<Node>>,
}

impl Known {
    fn new(from: &[&Form]) -> Self {
        let mut cells: HashMap<(i64, i64), Vec<Node>> = HashMap::new();
        for f in from {
            for p in &f.paths {
                for n in &p.nodes {
                    cells.entry(Self::cell(n.p)).or_default().push(*n);
                }
            }
        }
        Known { cells }
    }
    fn cell(p: Pt) -> (i64, i64) {
        (
            (p[0] / (4.0 * SNAP)).floor() as i64,
            (p[1] / (4.0 * SNAP)).floor() as i64,
        )
    }
    fn near(&self, p: Pt) -> Option<&Node> {
        let (cx, cy) = Self::cell(p);
        let mut best: Option<(&Node, f64)> = None;
        for x in cx - 1..=cx + 1 {
            for y in cy - 1..=cy + 1 {
                for n in self.cells.get(&(x, y)).into_iter().flatten() {
                    let d = dist(n.p, p);
                    if d <= SNAP && best.is_none_or(|(_, bd)| d < bd) {
                        best = Some((n, d));
                    }
                }
            }
        }
        best.map(|(n, _)| n)
    }
}

/// Handles on one line through the node (as paper.js read it: the angle under 1e-8).
fn collinear(n: &Node) -> bool {
    let (u, v) = (
        [n.a[0] - n.p[0], n.a[1] - n.p[1]],
        [n.b[0] - n.p[0], n.b[1] - n.p[1]],
    );
    let zero = |w: [f64; 2]| w[0].abs() < 1e-12 && w[1].abs() < 1e-12;
    !zero(u)
        && !zero(v)
        && (u[0] * v[1] - u[1] * v[0]).abs()
            <= ((u[0] * u[0] + u[1] * u[1]) * (v[0] * v[0] + v[1] * v[1])).sqrt() * 1e-8
}

/// One result contour as a path; nodes that were nodes of `from` are those nodes exactly and keep
/// whether they were smooth. None for less than two curves.
fn path_of(cs: &[Cubic], known: &Known) -> Option<Path> {
    let m = cs.len();
    if m < 2 {
        return None;
    }
    let nodes = (0..m)
        .map(|i| {
            let mut n = Node {
                p: cs[i][0],
                a: cs[(i + m - 1) % m][2],
                b: cs[i][1],
                smooth: false,
            };
            match known.near(n.p) {
                Some(k) => {
                    // Back on the node, its handles with it (a straight side stays straight).
                    let (dx, dy) = (k.p[0] - n.p[0], k.p[1] - n.p[1]);
                    let line_a = dist(n.a, n.p) < 1e-9;
                    let line_b = dist(n.b, n.p) < 1e-9;
                    n.p = k.p;
                    n.a = if line_a {
                        k.p
                    } else {
                        [n.a[0] + dx, n.a[1] + dy]
                    };
                    n.b = if line_b {
                        k.p
                    } else {
                        [n.b[0] + dx, n.b[1] + dy]
                    };
                    n.smooth = k.smooth;
                }
                None => n.smooth = collinear(&n),
            }
            n
        })
        .collect();
    Some(Path {
        closed: true,
        nodes,
    })
}

/// Result shapes as one form (even-odd: they do not overlap).
fn form_of(shapes: &[Shape], from: &[&Form]) -> Option<Form> {
    let known = Known::new(from);
    let paths: Vec<Path> = shapes
        .iter()
        .flatten()
        .filter_map(|c| path_of(c, &known))
        .collect();
    (!paths.is_empty()).then_some(Form {
        paths,
        nonzero: false,
    })
}

fn inside(w: i32, nonzero: bool) -> bool {
    if nonzero { w != 0 } else { w % 2 != 0 }
}

/// The area of a form by its own rule, as shapes that do not overlap.
fn settled(f: &Form) -> Vec<Shape> {
    let bp = bez_path(f);
    if bp.is_empty() {
        return vec![];
    }
    Topology::from_path(&bp, SWEEP_EPS)
        .map(|t| shapes_of(&t, |w| inside(*w, f.nonzero)))
        .unwrap_or_default()
}

/// The area of a form as outlines that run one way round it (the area on their right), as the sweep
/// leaves them. Combining forms needs this: `linesweeper` 0.5 misreads a curve two forms share when
/// they run it in opposite directions with their areas on the same side (a form and itself drawn
/// the other way round, a part cut from a fill and that fill), and outlines that run alike round
/// their areas only share a curve that way when the areas lie on opposite sides of it.
fn settled_path(f: &Form) -> BezPath {
    let bp = bez_path(f);
    if bp.is_empty() {
        return bp;
    }
    let Ok(t) = Topology::from_path(&bp, SWEEP_EPS) else {
        return bp;
    };
    let mut out = BezPath::new();
    for c in t.contours(|w| inside(*w, f.nonzero)).contours() {
        out.extend(c.path.iter());
    }
    out
}

/// `a` and `b` combined by `rule`, each filled by its own rule.
fn boolean(a: &Form, b: &Form, rule: Rule) -> Vec<Shape> {
    let (pa, pb) = (settled_path(a), settled_path(b));
    if pa.is_empty() && pb.is_empty() {
        return vec![];
    }
    Topology::from_paths_binary(&pa, &pb, SWEEP_EPS)
        .map(|t| {
            shapes_of(&t, |w| {
                // Settled, each area is where its outlines wind once.
                let (x, y) = (w.shape_a != 0, w.shape_b != 0);
                match rule {
                    Rule::Union => x || y,
                    Rule::Difference => x && !y,
                    Rule::Intersect => x && y,
                }
            })
        })
        .unwrap_or_default()
}

/// The areas of the forms as one (their closed paths; each fills by its own rule). None when empty.
pub fn union_forms(forms: &[Form]) -> Option<Form> {
    let closed: Vec<&Form> = forms.iter().filter(|f| has_area(f)).collect();
    let first = closed.first()?;
    if closed.len() == 1 {
        // One form stays as it is (its closed paths), settled only when it fills by the nonzero rule.
        if first.nonzero {
            return form_of(&settled(first), &closed);
        }
        let paths: Vec<Path> = first
            .paths
            .iter()
            .filter(|p| p.closed && p.nodes.len() > 1)
            .cloned()
            .collect();
        return Some(Form {
            paths,
            nonzero: false,
        });
    }
    let mut acc: Form = (*first).clone();
    for f in &closed[1..] {
        let u = boolean(&acc, f, Rule::Union);
        acc = form_of(&u, &closed).unwrap_or_default();
    }
    (!acc.paths.is_empty()).then_some(acc)
}

/// The area of `a` without the area of `b`; None when nothing is left.
pub fn subtract_form(a: &Form, b: &Form) -> Option<Form> {
    form_of(&boolean(a, b, Rule::Difference), &[a, b])
}

/// The areas both forms cover; None when none.
pub fn intersect_forms(a: &Form, b: &Form) -> Option<Form> {
    form_of(&boolean(a, b, Rule::Intersect), &[a, b])
}

/// Signed area of a closed run of cubics (Green's theorem, exact for cubics; the formula of
/// kurbo's `CubicBez::signed_area`).
fn cubics_area(cs: &[Cubic]) -> f64 {
    cs.iter()
        .map(|[p0, p1, p2, p3]| {
            (p0[0] * (6.0 * p1[1] + 3.0 * p2[1] + p3[1])
                + 3.0
                    * (p1[0] * (-2.0 * p0[1] + p2[1] + p3[1])
                        - p2[0] * (p0[1] + p1[1] - 2.0 * p3[1]))
                - p3[0] * (p0[1] + 3.0 * p1[1] + 6.0 * p2[1]))
                / 20.0
        })
        .sum()
}

/// Area enclosed by a form (mm², even-odd or nonzero as the form says), exact on the curves.
pub fn area_of_form(f: &Form) -> f64 {
    // The sweep turns every outline one way round the area (holes the other): the signed areas add up.
    settled(f)
        .iter()
        .flatten()
        .map(|c| cubics_area(c))
        .sum::<f64>()
        .abs()
}

// Crossings -------------------------------------------------------------------------------------

/// A crossing this near a node is that node (curve time).
const AT_NODE: f64 = 1e-4;

fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}
fn cross(a: Pt, b: Pt) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
fn derivative(c: &Cubic, t: f64) -> Pt {
    let u = 1.0 - t;
    let (a, b, d) = (3.0 * u * u, 6.0 * u * t, 3.0 * t * t);
    [
        a * (c[1][0] - c[0][0]) + b * (c[2][0] - c[1][0]) + d * (c[3][0] - c[2][0]),
        a * (c[1][1] - c[0][1]) + b * (c[2][1] - c[1][1]) + d * (c[3][1] - c[2][1]),
    ]
}

/// The part of a cubic from `t0` to `t1`.
fn sub_curve(c: &Cubic, t0: f64, t1: f64) -> Cubic {
    let split = |q: &Cubic, t: f64| -> (Cubic, Cubic) {
        let l = |a: Pt, b: Pt| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        let (p01, p12, p23) = (l(q[0], q[1]), l(q[1], q[2]), l(q[2], q[3]));
        let (a, b) = (l(p01, p12), l(p12, p23));
        let m = l(a, b);
        ([q[0], p01, a, m], [m, b, p23, q[3]])
    };
    let left = if t1 < 1.0 { split(c, t1).0 } else { *c };
    if t0 > 0.0 {
        split(&left, if t1 > 0.0 { t0 / t1 } else { 0.0 }).1
    } else {
        left
    }
}

fn bbox(c: &Cubic) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in c {
        b = [
            b[0].min(p[0]),
            b[1].min(p[1]),
            b[2].max(p[0]),
            b[3].max(p[1]),
        ];
    }
    b
}

/// How far the handles of a cubic lie off its chord.
fn flatness(c: &Cubic) -> f64 {
    let d = sub(c[3], c[0]);
    let l = hypot(d[0], d[1]);
    if l < 1e-12 {
        return dist(c[0], c[1]).max(dist(c[0], c[2]));
    }
    (cross(d, sub(c[1], c[0])).abs() / l).max(cross(d, sub(c[2], c[0])).abs() / l)
}

/// Where two cubics meet, as (t, u) pairs: subdivision (boxes that overlap are halved until the
/// pieces are flat), the chords intersected, then Newton steps on both curve times.
fn curve_hits(c1: &Cubic, c2: &Cubic) -> Vec<(f64, f64)> {
    let mut out: Vec<(f64, f64)> = vec![];
    let mut todo = vec![(0.0, 1.0, 0.0, 1.0, 0u32)];
    let mut steps = 0;
    while let Some((t0, t1, u0, u1, depth)) = todo.pop() {
        steps += 1;
        // Curves lying on each other: no crossing to find.
        if steps > 20_000 {
            return vec![];
        }
        let (a, b) = (sub_curve(c1, t0, t1), sub_curve(c2, u0, u1));
        let (ba, bb) = (bbox(&a), bbox(&b));
        const E: f64 = 1e-9;
        if ba[0] > bb[2] + E || bb[0] > ba[2] + E || ba[1] > bb[3] + E || bb[1] > ba[3] + E {
            continue;
        }
        let (fa, fb) = (flatness(&a), flatness(&b));
        if (fa < 1e-7 && fb < 1e-7) || depth > 48 {
            // The chords: p + s r = q + v w.
            let (p, r, qq, w) = (a[0], sub(a[3], a[0]), b[0], sub(b[3], b[0]));
            let den = cross(r, w);
            if den.abs() < 1e-18 {
                continue;
            }
            let s = cross(sub(qq, p), w) / den;
            let v = cross(sub(qq, p), r) / den;
            const M: f64 = 1e-9;
            if !(-M..=1.0 + M).contains(&s) || !(-M..=1.0 + M).contains(&v) {
                continue;
            }
            out.push((
                t0 + (t1 - t0) * s.clamp(0.0, 1.0),
                u0 + (u1 - u0) * v.clamp(0.0, 1.0),
            ));
            continue;
        }
        // Halve the larger piece.
        if (ba[2] - ba[0]).max(ba[3] - ba[1]) >= (bb[2] - bb[0]).max(bb[3] - bb[1]) {
            let m = (t0 + t1) / 2.0;
            todo.push((t0, m, u0, u1, depth + 1));
            todo.push((m, t1, u0, u1, depth + 1));
        } else {
            let m = (u0 + u1) / 2.0;
            todo.push((t0, t1, u0, m, depth + 1));
            todo.push((t0, t1, m, u1, depth + 1));
        }
    }
    // Newton steps on c1(t) - c2(u) = 0.
    for (t, u) in out.iter_mut() {
        for _ in 0..8 {
            let f = sub(bezier(c1, *t), bezier(c2, *u));
            let (d1, d2) = (derivative(c1, *t), derivative(c2, *u));
            let det = -cross(d1, d2);
            if det.abs() < 1e-14 {
                break;
            }
            // [d1, -d2] [dt, du] = -f
            let dt = -(f[0] * -d2[1] - -d2[0] * f[1]) / det;
            let du = -(d1[0] * f[1] - d1[1] * f[0]) / det;
            *t = (*t + dt).clamp(0.0, 1.0);
            *u = (*u + du).clamp(0.0, 1.0);
            if dt.abs() < 1e-15 && du.abs() < 1e-15 {
                break;
            }
        }
    }
    // One hit per place.
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut kept: Vec<(f64, f64)> = vec![];
    for h in out {
        if !kept
            .iter()
            .any(|k| dist(bezier(c1, k.0), bezier(c1, h.0)) < 1e-7)
        {
            kept.push(h);
        }
    }
    kept
}

/// Points just before and just after a place on a path (none past the end of an open path).
fn around(p: &Path, seg: usize, t: f64) -> (Option<Pt>, Option<Pt>) {
    let n = segments(p);
    let at = bezier(&segment(p, seg), t);
    let step = |mut s: usize, mut t: f64, back: bool| -> Option<Pt> {
        // Far enough to tell the sides, near enough to stay by the place.
        let mut dt = 1e-3;
        for _ in 0..12 {
            let (mut s2, mut t2) = (s, if back { t - dt } else { t + dt });
            if t2 < 0.0 {
                if s == 0 && !p.closed {
                    return None;
                }
                s2 = (s + n - 1) % n;
                t2 += 1.0;
            } else if t2 > 1.0 {
                if s + 1 == n && !p.closed {
                    return None;
                }
                s2 = (s + 1) % n;
                t2 -= 1.0;
            }
            let q = bezier(&segment(p, s2), t2.clamp(0.0, 1.0));
            if dist(q, at) > 1e-6 {
                return Some(q);
            }
            (s, t) = (s, t);
            dt *= 4.0;
        }
        None
    };
    // At a node, step from the curve on the side asked.
    (step(seg, t, true), step(seg, t, false))
}

/// Whether path `pi` crosses path `pj` at the place: the points just before and after it on one
/// lie on either side of the other (read by angle around the place, as at a corner).
fn crosses_at(pi: &Path, li: (usize, f64), pj: &Path, lj: (usize, f64)) -> bool {
    let at = bezier(&segment(pi, li.0), li.1);
    let (Some(ib), Some(ia)) = around(pi, li.0, li.1) else {
        return false;
    };
    let (Some(jb), Some(ja)) = around(pj, lj.0, lj.1) else {
        return false;
    };
    let ang = |q: Pt| (q[1] - at[1]).atan2(q[0] - at[0]);
    let (a1, a2) = (ang(jb), ang(ja));
    // Whether angle x lies on the arc from a1 counterclockwise to a2.
    let on_arc = |x: f64| {
        let tau = std::f64::consts::TAU;
        let span = (a2 - a1).rem_euclid(tau);
        let off = (x - a1).rem_euclid(tau);
        off > 1e-9 && off < span - 1e-9
    };
    let (x, y) = (ang(ib), ang(ia));
    // Touching along the other's direction is no crossing.
    let on_line = |x: f64| {
        let tau = std::f64::consts::TAU;
        let d1 = (x - a1).rem_euclid(tau);
        let d2 = (x - a2).rem_euclid(tau);
        d1.min(tau - d1) < 1e-9 || d2.min(tau - d2) < 1e-9
    };
    if on_line(x) || on_line(y) {
        return false;
    }
    on_arc(x) != on_arc(y)
}

/// The form with a node wherever its paths cross (themselves or each other), the curves split
/// exactly there so the outline stays as it was; None when nothing crosses. Touching without
/// crossing does not count. Returns the form and how many nodes were added.
pub fn with_crossing_nodes(f: &Form) -> Option<(Form, usize)> {
    let mut at: Vec<Vec<(usize, f64)>> = vec![vec![]; f.paths.len()];
    for i in 0..f.paths.len() {
        let pi = &f.paths[i];
        if pi.nodes.len() < 2 {
            continue;
        }
        for j in i..f.paths.len() {
            let pj = &f.paths[j];
            if pj.nodes.len() < 2 {
                continue;
            }
            for s in 0..segments(pi) {
                let ci = segment(pi, s);
                let from = if i == j { s + 1 } else { 0 };
                for u in from..segments(pj) {
                    let cj = segment(pj, u);
                    for (t, w) in curve_hits(&ci, &cj) {
                        // The node two neighbouring curves of one path share.
                        if i == j {
                            let q = bezier(&ci, t);
                            let shared = (u == s + 1 && dist(q, ci[3]) < 1e-9)
                                || (pi.closed
                                    && s == 0
                                    && u + 1 == segments(pi)
                                    && dist(q, ci[0]) < 1e-9);
                            if shared {
                                continue;
                            }
                        }
                        if crosses_at(pi, (s, t), pj, (u, w)) {
                            at[i].push((s, t));
                            at[j].push((u, w));
                        }
                    }
                }
            }
        }
    }
    let mut form = f.clone();
    let mut added = 0;
    for (k, locs) in at.iter().enumerate() {
        // From the last curve back, and within a curve from its end back: the earlier places keep their curve and time.
        let mut sorted: Vec<(usize, f64)> = locs
            .iter()
            .copied()
            .filter(|l| l.1 > AT_NODE && l.1 < 1.0 - AT_NODE)
            .collect();
        sorted.sort_by(|x, y| y.0.cmp(&x.0).then(y.1.total_cmp(&x.1)));
        let (mut seg, mut upper, mut last) = (usize::MAX, 1.0, f64::INFINITY);
        for (s, t) in sorted {
            if s != seg {
                seg = s;
                upper = 1.0;
                last = f64::INFINITY;
            }
            // A crossing met twice (a path crossing itself is found from both sides).
            if (t - last).abs() < AT_NODE {
                continue;
            }
            insert_node(&mut form, k, s, t / upper);
            upper = t;
            last = t;
            added += 1;
        }
    }
    (added > 0).then_some((form, added))
}

// Offsetting ------------------------------------------------------------------------------------

/// Clipper works in integers: 0.1 µm.
pub const SCALE: f64 = 1e4;
/// Largest distance of the polygons from the curves, and of the round joins from a circle (mm).
pub const FLAT: f64 = 0.01;
/// Largest distance of the fitted curves from the offset polygon (mm).
pub const FIT: f64 = 0.03;
/// How far along the polygon on either side a corner is measured (mm).
const CORNER_SPAN: f64 = 0.3;
/// Polygon edges shorter than this are left out before fitting (mm).
const MIN_EDGE: f64 = 0.005;
/// How far a polygon kept to work on may lie from the exact one (mm).
const SIMPLE: f64 = 0.002;
/// Turn at a polygon point that makes a corner of the fitted curves (degrees).
const CORNER_DEG: f64 = 35.0;

fn unit(a: Pt, b: Pt) -> [f64; 2] {
    let l = match dist(a, b) {
        0.0 => 1.0,
        l => l,
    };
    [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
}

/// Points of a path, at most `tol` from its curves (Wang's bound on the steps per curve).
pub fn flattened(p: &Path, tol: f64) -> Vec<Pt> {
    let mut out = vec![];
    for k in 0..segments(p) {
        let c = segment(p, k);
        let ddx = (c[0][0] - 2.0 * c[1][0] + c[2][0])
            .abs()
            .max((c[1][0] - 2.0 * c[2][0] + c[3][0]).abs());
        let ddy = (c[0][1] - 2.0 * c[1][1] + c[2][1])
            .abs()
            .max((c[1][1] - 2.0 * c[2][1] + c[3][1]).abs());
        let n = ((0.75 * hypot(ddx, ddy)) / tol)
            .sqrt()
            .ceil()
            .clamp(1.0, 2000.0) as usize;
        for i in 0..n {
            out.push(bezier(&c, i as f64 / n as f64));
        }
    }
    if !p.closed
        && let Some(l) = p.nodes.last()
    {
        out.push(l.p);
    }
    out
}

fn to_int(pts: &[Pt]) -> Path64 {
    pts.iter()
        .map(|[x, y]| Point64::new(round(x * SCALE) as i64, round(y * SCALE) as i64))
        .collect()
}

fn from_int(r: &Path64) -> Vec<Pt> {
    r.iter()
        .map(|q| [q.x as f64 / SCALE, q.y as f64 / SCALE])
        .collect()
}

fn clip_fill(f: &Form) -> ClipFill {
    if f.nonzero {
        ClipFill::NonZero
    } else {
        ClipFill::EvenOdd
    }
}

fn offset_paths(paths: &Paths64, jt: JoinType, et: EndType, delta: f64, miter: f64) -> Paths64 {
    let mut o = ClipperOffset::new(miter, FLAT * SCALE, false, false);
    o.add_paths(paths, jt, et);
    let mut out = Paths64::new();
    o.execute(delta * SCALE, &mut out);
    out
}

/// The area of `f` grown by `d` mm (shrunk when negative), round at the corners. Lines (open paths)
/// count with `line_width`: their band grows by `d` too. None when nothing is left. Without `fit` the
/// result stays polygons (straight nodes 0.01 mm off the curve): for working on, without a fit's error.
pub fn offset_form(f: &Form, d: f64, line_width: f64, fit: bool) -> Option<Form> {
    // Offsetting reads holes from the turning sense of the paths: settle the fill rule first.
    let subj: Paths64 = f
        .paths
        .iter()
        .filter(|p| p.closed && p.nodes.len() > 1)
        .map(|p| to_int(&flattened(p, FLAT)))
        .collect();
    let areas = clip::union_subjects_64(&subj, clip_fill(f));
    let mut parts = Paths64::new();
    if !areas.is_empty() {
        parts = offset_paths(&areas, JoinType::Round, EndType::Polygon, d, 2.0);
    }
    let open: Paths64 = f
        .paths
        .iter()
        .filter(|p| !p.closed && p.nodes.len() > 1)
        .map(|p| to_int(&flattened(p, FLAT)))
        .collect();
    if !open.is_empty() && line_width / 2.0 + d > 0.0 {
        parts.extend(offset_paths(
            &open,
            JoinType::Round,
            EndType::Round,
            line_width / 2.0 + d,
            2.0,
        ));
    }
    if parts.is_empty() {
        return None;
    }
    form_of_rings(&clip::union_subjects_64(&parts, ClipFill::NonZero), fit)
}

/// Clipper's rings as a form: fitted as curves, or as they are.
fn form_of_rings(rings: &Paths64, fit: bool) -> Option<Form> {
    // Polygons to work on keep only the points that matter (within SIMPLE): the next offset puts an
    // arc at every point, and the round joins of this one are points 0.01 mm apart.
    let simple;
    let kept = if fit {
        rings
    } else {
        simple = clip::simplify_paths(rings, SIMPLE * SCALE, true);
        &simple
    };
    let paths: Vec<Path> = kept
        .iter()
        .filter(|r| r.len() > 2)
        .filter_map(|r| {
            let pts = from_int(r);
            if fit {
                fit_ring(&pts)
            } else {
                Some(Path {
                    closed: true,
                    nodes: pts
                        .iter()
                        .map(|&q| Node {
                            p: q,
                            a: q,
                            b: q,
                            smooth: false,
                        })
                        .collect(),
                })
            }
        })
        .collect();
    // Clipper turns holes the other way round: read nonzero they stay holes, also next to other forms.
    (!paths.is_empty()).then_some(Form {
        paths,
        nonzero: !fit,
    })
}

/// The rings of a band along the paths (closed ones all round, open ones with `cap` ends).
fn band_rings(ways: &[&Path], half: f64, join: JoinType, cap: EndType, miter: f64) -> Paths64 {
    let mut parts = Paths64::new();
    for closed in [true, false] {
        let list: Paths64 = ways
            .iter()
            .filter(|p| p.closed == closed)
            .map(|p| to_int(&flattened(p, FLAT)))
            .collect();
        if list.is_empty() {
            continue;
        }
        parts.extend(offset_paths(
            &list,
            join,
            if closed { EndType::Joined } else { cap },
            half,
            miter,
        ));
    }
    parts
}

/// The area a thread `w` mm wide covers along every path of `f` (closed ones all round, not filled),
/// round at the ends and corners: what a line sews. None when nothing is left; `fit` as in offset_form.
pub fn band_form(f: &Form, w: f64, fit: bool) -> Option<Form> {
    let ways: Vec<&Path> = f.paths.iter().filter(|p| p.nodes.len() > 1).collect();
    if ways.is_empty() || w.is_nan() || w <= 0.0 {
        return None;
    }
    let parts = band_rings(&ways, w / 2.0, JoinType::Round, EndType::Round, 2.0);
    form_of_rings(&clip::union_subjects_64(&parts, ClipFill::NonZero), fit)
}

/// How a stroke of an SVG ends and turns its corners.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StrokeCap {
    Butt,
    Round,
    Square,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StrokeJoin {
    Miter,
    Round,
    Bevel,
}

/// The area a stroke `w` mm wide paints along the paths of `f`, as SVG draws it: its ends and
/// corners as given (`miter` the longest a miter may reach, as a multiple of the half width; a
/// sharper corner is cut off), closed paths all round and not filled. None when nothing is left.
pub fn stroke_form(f: &Form, w: f64, cap: StrokeCap, join: StrokeJoin, miter: f64) -> Option<Form> {
    let ways: Vec<&Path> = f.paths.iter().filter(|p| p.nodes.len() > 1).collect();
    if ways.is_empty() || w.is_nan() || w <= 0.0 {
        return None;
    }
    let jt = match join {
        StrokeJoin::Round => JoinType::Round,
        StrokeJoin::Bevel => JoinType::Bevel,
        StrokeJoin::Miter => JoinType::Miter,
    };
    let et = match cap {
        StrokeCap::Round => EndType::Round,
        StrokeCap::Square => EndType::Square,
        StrokeCap::Butt => EndType::Butt,
    };
    // Clipper measures the limit as SVG does (the miter's reach over the half width); at least 1.
    let parts = band_rings(&ways, w / 2.0, jt, et, miter.max(1.0));
    form_of_rings(&clip::union_subjects_64(&parts, ClipFill::NonZero), true)
}

/// A closed polygon as curves: sharp turns stay corners, the rest is fitted within FIT. None for a
/// speck (fewer than three points apart), which has no outline to fit.
pub fn fit_ring(ring: &[Pt]) -> Option<Path> {
    let m = ring.len();
    // Points on top of each other (Clipper rounds to its grid) would read as corners.
    let raw: Vec<Pt> = (0..m)
        .filter(|&i| dist(ring[i], ring[(i + 1) % m]) > MIN_EDGE)
        .map(|i| ring[i])
        .collect();
    if raw.len() < 3 {
        return None;
    }
    // The fit checks its error at the points and halfway between them: long straight edges get points in between.
    let mut pts: Vec<Pt> = vec![];
    for i in 0..raw.len() {
        let (a, b) = (raw[i], raw[(i + 1) % raw.len()]);
        let k = (dist(a, b) / 0.2).ceil().max(1.0) as usize;
        for j in 0..k {
            pts.push([
                a[0] + ((b[0] - a[0]) * j as f64) / k as f64,
                a[1] + ((b[1] - a[1]) * j as f64) / k as f64,
            ]);
        }
    }
    let n = pts.len();
    let angle =
        |v1: [f64; 2], v2: [f64; 2]| (v1[0] * v2[0] + v1[1] * v2[1]).clamp(-1.0, 1.0).acos();
    let turns: Vec<f64> = (0..n)
        .map(|i| {
            angle(
                unit(pts[(i + n - 1) % n], pts[i]),
                unit(pts[i], pts[(i + 1) % n]),
            )
        })
        .collect();
    // The turn seen over CORNER_SPAN on either side: a round join of a small offset is flattened in
    // steps that each turn a lot, yet as a whole it turns little.
    let reach = |i: usize, fwd: bool| {
        let mut j = i;
        let (mut len, mut s) = (0.0, 0);
        // (s < n / 2 in JavaScript, with n / 2 not rounded.)
        while len < CORNER_SPAN && s < n.div_ceil(2) {
            let next = if fwd { (j + 1) % n } else { (j + n - 1) % n };
            len += dist(pts[j], pts[next]);
            j = next;
            s += 1;
        }
        j
    };
    let span = |i: usize| {
        angle(
            unit(pts[reach(i, false)], pts[i]),
            unit(pts[i], pts[reach(i, true)]),
        )
    };
    let limit = CORNER_DEG * std::f64::consts::PI / 180.0;
    let seen: Vec<f64> = (0..n)
        .map(|i| if turns[i] > limit / 8.0 { span(i) } else { 0.0 })
        .collect();
    // One corner where it turns most, not every point near it.
    let near = |i: usize, j: usize| i.abs_diff(j).min(n - i.abs_diff(j));
    let mut breaks: Vec<usize> = (0..n)
        .filter(|&i| {
            seen[i] > limit
                && (0..n).all(|j| {
                    j == i
                        || near(i, j) > 8
                        || dist(pts[i], pts[j]) > CORNER_SPAN
                        || turns[j] < turns[i]
                        || (turns[j] == turns[i] && j > i)
                })
        })
        .collect();
    let mut corner = vec![false; n];
    for &b in &breaks {
        corner[b] = true;
    }
    // A round loop is cut in two to have ends to fit between.
    if breaks.is_empty() {
        breaks = vec![0, n / 2];
    } else if breaks.len() == 1 {
        let mut b = vec![breaks[0], (breaks[0] + n / 2) % n];
        b.sort_unstable();
        breaks = b;
    }
    let tangent = |i: usize, out: bool| {
        if corner[i] {
            if out {
                unit(pts[i], pts[(i + 1) % n])
            } else {
                unit(pts[(i + n - 1) % n], pts[i])
            }
        } else {
            unit(pts[(i + n - 1) % n], pts[(i + 1) % n])
        }
    };
    let mut curves: Vec<Cubic> = vec![];
    let mut sharp: Vec<bool> = vec![];
    for b in 0..breaks.len() {
        let (s, e) = (breaks[b], breaks[(b + 1) % breaks.len()]);
        let mut run: Vec<Pt> = vec![];
        let mut i = s;
        loop {
            run.push(pts[i]);
            if i == e && run.len() > 1 {
                break;
            }
            i = (i + 1) % n;
        }
        let t2 = tangent(e, false);
        for (k, c) in fit_cubic(&run, tangent(s, true), [-t2[0], -t2[1]], FIT, true)
            .into_iter()
            .enumerate()
        {
            curves.push(c);
            sharp.push(k == 0 && corner[s]);
        }
    }
    let m = curves.len();
    Some(Path {
        closed: true,
        nodes: (0..m)
            .map(|i| Node {
                p: curves[i][0],
                a: curves[(i + m - 1) % m][2],
                b: curves[i][1],
                smooth: !sharp[i],
            })
            .collect(),
    })
}

// Cutting apart ---------------------------------------------------------------------------------

/// The cut is taken out as a band this wide (mm): the parts are separate, their edges on the cut.
const CUT_BAND: f64 = 0.002;
/// How far a drawn cut may be smoothed from its points (mm): a hand is not this exact.
const CUT_FIT: f64 = 0.1;

/// A fill cut apart: its parts (largest first, each reaching under its neighbours) and which touch.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SplitForms {
    pub parts: Vec<Form>,
    pub touching: Vec<[usize; 2]>,
}

/// Polylines of the closed paths of a form, fine enough to stand for its curves.
fn outlines(f: &Form) -> Vec<Vec<Pt>> {
    f.paths
        .iter()
        .filter(|p| p.closed && p.nodes.len() > 1)
        .map(|p| flattened(p, 1e-4))
        .collect()
}

fn winding(pts: &[Pt], [x, y]: Pt) -> i32 {
    let mut w = 0;
    for i in 0..pts.len() {
        let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
        let c = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
        if a[1] <= y {
            if b[1] > y && c > 0.0 {
                w += 1;
            }
        } else if b[1] <= y && c < 0.0 {
            w -= 1;
        }
    }
    w
}

/// Whether the form fills point `q` by its rule.
fn contains(lines: &[Vec<Pt>], nonzero: bool, q: Pt) -> bool {
    let w: i32 = lines.iter().map(|l| winding(l, q)).sum();
    if nonzero { w != 0 } else { w % 2 != 0 }
}

/// A point inside a closed outline (as paper.js finds one: the middle of its bounds, or else halfway
/// between the first two places the line across that middle meets the outline).
fn interior_point(pts: &[Pt]) -> Pt {
    let b = bounds_of(pts);
    let mid = [(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0];
    if winding(pts, mid) != 0 {
        return mid;
    }
    let y = mid[1];
    let mut xs: Vec<f64> = vec![];
    for i in 0..pts.len() {
        let (a, c) = (pts[i], pts[(i + 1) % pts.len()]);
        if (a[1] <= y && c[1] > y) || (c[1] <= y && a[1] > y) {
            xs.push(a[0] + (y - a[1]) / (c[1] - a[1]) * (c[0] - a[0]));
        }
    }
    xs.sort_by(f64::total_cmp);
    if xs.len() >= 2 {
        [(xs[0] + xs[1]) / 2.0, y]
    } else {
        mid
    }
}

fn bounds_of(pts: &[Pt]) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in pts {
        b = [
            b[0].min(p[0]),
            b[1].min(p[1]),
            b[2].max(p[0]),
            b[3].max(p[1]),
        ];
    }
    b
}

fn to_segment(q: Pt, a: Pt, b: Pt) -> f64 {
    crate::shape::vectorize::to_segment(q, a, b)
}

/// Distance from `q` to a closed outline.
fn distance_to(pts: &[Pt], q: Pt) -> f64 {
    (0..pts.len())
        .map(|i| to_segment(q, pts[i], pts[(i + 1) % pts.len()]))
        .fold(f64::INFINITY, f64::min)
}

/// A drawn line as the curve through it (corners stay), in points close enough to read as that
/// curve: its points one by one would be sewn as small kinks along the cut.
fn smooth_line(raw: &[Pt]) -> Vec<Pt> {
    let pts: Vec<Pt> = raw
        .iter()
        .enumerate()
        .filter(|&(i, q)| i == 0 || dist(*q, raw[i - 1]) > MIN_EDGE)
        .map(|(_, q)| *q)
        .collect();
    if pts.len() < 3 {
        return pts;
    }
    let limit = CORNER_DEG * std::f64::consts::PI / 180.0;
    let mut breaks = vec![0];
    for i in 1..pts.len() - 1 {
        let (u, v) = (unit(pts[i - 1], pts[i]), unit(pts[i], pts[i + 1]));
        if (u[0] * v[0] + u[1] * v[1]).clamp(-1.0, 1.0).acos() > limit {
            breaks.push(i);
        }
    }
    breaks.push(pts.len() - 1);
    let mut nodes: Vec<Node> = vec![];
    for r in 0..breaks.len() - 1 {
        let run = &pts[breaks[r]..=breaks[r + 1]];
        let curves = if run.len() < 3 {
            vec![[run[0], run[0], run[1], run[1]]]
        } else {
            fit_cubic(
                run,
                unit(run[0], run[1]),
                unit(run[run.len() - 1], run[run.len() - 2]),
                CUT_FIT,
                false,
            )
        };
        for [p0, c1, c2, p3] in curves {
            match nodes.last_mut() {
                None => nodes.push(Node {
                    p: p0,
                    a: p0,
                    b: c1,
                    smooth: false,
                }),
                Some(l) => l.b = c1,
            }
            nodes.push(Node {
                p: p3,
                a: c2,
                b: p3,
                smooth: false,
            });
        }
    }
    flattened(
        &Path {
            closed: false,
            nodes,
        },
        FLAT / 10.0,
    )
}

/// The strip `w` wide on either side of open lines (ends cut square), as curves.
fn strip_along(lines: &[Vec<Pt>], w: f64) -> Option<Form> {
    let ls: Paths64 = lines.iter().map(|l| to_int(l)).collect();
    let sol = offset_paths(&ls, JoinType::Round, EndType::Butt, w, 2.0);
    let paths: Vec<Path> = sol
        .iter()
        .filter(|r| r.len() > 2)
        .filter_map(|r| fit_ring(&from_int(r)))
        .collect();
    (!paths.is_empty()).then_some(Form {
        paths,
        nonzero: false,
    })
}

/// Form `f` cut along the polylines `cuts` (world mm), on its curves: the parts keep the nodes and
/// curves of `f`; along a cut each reaches `overlap` mm under its neighbour. A cut that ends inside
/// the area within `reach` mm of its edge is taken on to it. Pieces under `min_part` mm² are no part
/// of their own; they go to the nearest part. None when the cuts leave it in one piece.
pub fn split_form(
    f: &Form,
    cuts: &[Vec<Pt>],
    overlap: f64,
    min_part: f64,
    reach: f64,
) -> Option<SplitForms> {
    let whole = outlines(f);
    let inside = |q: Pt| contains(&whole, f.nonzero, q);
    // Ends that stop short inside are carried on to the edge.
    let carry = |end: Pt, before: Pt| -> Pt {
        if !inside(end) {
            return end;
        }
        let d = dist(end, before);
        if d == 0.0 {
            return end;
        }
        let u = [(end[0] - before[0]) / d, (end[1] - before[1]) / d];
        let mut t = 0.05;
        while t <= reach {
            if !inside([end[0] + u[0] * t, end[1] + u[1] * t]) {
                return [end[0] + u[0] * (t + 0.1), end[1] + u[1] * (t + 0.1)];
            }
            t += 0.05;
        }
        end
    };
    let lines: Vec<Vec<Pt>> = cuts
        .iter()
        .filter(|c| c.len() >= 2)
        .map(|c| {
            let mut out = c.clone();
            let n = c.len();
            out[0] = carry(c[0], c[1]);
            out[n - 1] = carry(c[n - 1], c[n - 2]);
            smooth_line(&out)
        })
        .collect();
    if lines.is_empty() {
        return None;
    }
    let mut o = ClipperOffset::new(2.0, 0.0005 * SCALE, false, false);
    for l in &lines {
        o.add_path(&to_int(l), JoinType::Round, EndType::Butt);
    }
    let mut band = Paths64::new();
    o.execute(CUT_BAND / 2.0 * SCALE, &mut band);
    if band.is_empty() {
        return None;
    }
    // The band's rings do not overlap: either rule reads them alike.
    let cutter = Form {
        paths: band
            .iter()
            .map(|r| Path {
                closed: true,
                nodes: from_int(r)
                    .into_iter()
                    .map(|q| Node {
                        p: q,
                        a: q,
                        b: q,
                        smooth: false,
                    })
                    .collect(),
            })
            .collect(),
        nonzero: f.nonzero,
    };
    let rest = boolean(f, &cutter, Rule::Difference);
    // The pieces: each outline with the holes in it.
    let pieces: Vec<&Shape> = rest
        .iter()
        .filter(|s| s.first().is_some_and(|c| cubics_area(c).abs() > 1e-9))
        .collect();
    let known = [f];
    let forms: Vec<Option<Form>> = pieces
        .iter()
        .map(|s| form_of(std::slice::from_ref(*s), &known))
        .collect();
    let outer_pts: Vec<Vec<Pt>> = pieces
        .iter()
        .map(|s| {
            let mut pts = vec![];
            for c in &s[0] {
                for i in 0..16 {
                    pts.push(bezier(c, i as f64 / 16.0));
                }
            }
            pts
        })
        .collect();
    struct Sized {
        g: Form,
        i: usize,
        a: f64,
    }
    let sized: Vec<Sized> = forms
        .into_iter()
        .enumerate()
        .filter_map(|(i, g)| {
            g.map(|g| Sized {
                a: area_of_form(&g),
                g,
                i,
            })
        })
        .collect();
    // Largest first; as large, the one nearer the top, then the left (reading order).
    let top = |i: usize| bounds_of(&outer_pts[i]);
    let mut kept: Vec<&Sized> = sized.iter().filter(|x| x.a >= min_part).collect();
    kept.sort_by(|a, b| {
        if (b.a - a.a).abs() > 1e-6 * a.a.max(b.a) {
            b.a.total_cmp(&a.a)
        } else {
            let (ta, tb) = (top(a.i), top(b.i));
            ta[1].total_cmp(&tb[1]).then(ta[0].total_cmp(&tb[0]))
        }
    });
    if kept.len() < 2 {
        return None;
    }
    // Crumbs to the nearest part.
    let mut own: Vec<Vec<Form>> = kept.iter().map(|k| vec![k.g.clone()]).collect();
    for c in sized.iter().filter(|x| x.a < min_part) {
        let at = interior_point(&outer_pts[c.i]);
        let mut best = 0;
        let mut best_d = f64::INFINITY;
        for (n, k) in kept.iter().enumerate() {
            let d = distance_to(&outer_pts[k.i], at);
            if d < best_d {
                best_d = d;
                best = n;
            }
        }
        own[best].push(c.g.clone());
    }
    // Each part reaches under its neighbours: by the strip along the cuts where it lies beside them,
    // held to the area (whose curves stay).
    let strip = if overlap > 0.0 {
        strip_along(&lines, overlap)
    } else {
        None
    };
    let mut parts: Vec<Form> = vec![];
    for group in &own {
        let base = if group.len() > 1 {
            union_forms(group)?
        } else {
            group[0].clone()
        };
        let beside = strip
            .as_ref()
            .and_then(|_| offset_form(&base, overlap * 1.5, 0.0, true));
        let under = match (&strip, &beside) {
            (Some(s), Some(b)) => intersect_forms(s, b),
            _ => None,
        };
        let grown = match under {
            Some(u) => union_forms(&[base, u]),
            None => Some(base),
        };
        let part = grown.and_then(|g| intersect_forms(&g, f))?;
        parts.push(part);
    }
    let mut touching = vec![];
    for a in 0..parts.len() {
        for b in a + 1..parts.len() {
            if intersect_forms(&parts[a], &kept[b].g).is_some_and(|both| area_of_form(&both) > 1e-4)
            {
                touching.push([a, b]);
            }
        }
    }
    Some(SplitForms { parts, touching })
}

// Filling a gap (Flächen-Werkzeug) ------------------------------------------------------------------

/// What stands in the way of a new area: an area of its own, or a line covering a band `width` mm wide.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Obstacle {
    pub form: Form,
    /// A line (every path, closed ones too, is a thread): its band. Otherwise the closed paths are an area.
    pub line: bool,
    pub width: f64,
}

/// How far the gap may reach: shapes all round (`closed`), or the convex hull of all shapes (`hull`).
/// `wrap` fills no gap: it lays the convex hull around the shapes in the clicked area, under them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GapMode {
    Closed,
    Hull,
    Wrap,
}

/// The gap at a point, or why there is none: `outside` (in `closed`, the point is not shut in by
/// shapes), `covered` (on a shape, or the gap is too small to sew), `empty` (in `wrap`, no shape lies
/// in the area).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum GapResult {
    Form { form: Form },
    None { none: GapNone },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GapNone {
    Outside,
    Covered,
    Empty,
}

/// Gaps smaller than this are not worth an object (mm²).
const MIN_GAP_MM2: f64 = 1.0;

/// The rings an obstacle covers, grown by `d` mm.
fn grown_rings(o: &Obstacle, d: f64) -> Paths64 {
    if !o.line {
        return offset_form(&o.form, d, 0.0, false)
            .map(|f| {
                f.paths
                    .iter()
                    .map(|p| to_int(&p.nodes.iter().map(|n| n.p).collect::<Vec<_>>()))
                    .collect()
            })
            .unwrap_or_default();
    }
    let ways: Vec<&Path> = o.form.paths.iter().filter(|p| p.nodes.len() > 1).collect();
    let half = o.width / 2.0 + d;
    if ways.is_empty() || half.is_nan() || half <= 0.0 {
        return vec![];
    }
    band_rings(&ways, half, JoinType::Round, EndType::Round, 2.0)
}

/// The convex hull of points (Andrew's monotone chain), counterclockwise in Clipper's sense.
fn convex_hull(pts: &[Point64]) -> Path64 {
    let mut s = pts.to_vec();
    s.sort_by(|a, b| a.x.cmp(&b.x).then(a.y.cmp(&b.y)));
    if s.len() < 3 {
        return s;
    }
    let cross = |o: &Point64, a: &Point64, b: &Point64| {
        (a.x - o.x) as f64 * (b.y - o.y) as f64 - (a.y - o.y) as f64 * (b.x - o.x) as f64
    };
    let mut lower: Path64 = vec![];
    for p in &s {
        while lower.len() >= 2 && cross(&lower[lower.len() - 2], &lower[lower.len() - 1], p) <= 0.0
        {
            lower.pop();
        }
        lower.push(*p);
    }
    let mut upper: Path64 = vec![];
    for p in s.iter().rev() {
        while upper.len() >= 2 && cross(&upper[upper.len() - 2], &upper[upper.len() - 1], p) <= 0.0
        {
            upper.pop();
        }
        upper.push(*p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// The free parts around the shapes, worked out once; each form fitted on first use (gapFinder).
pub struct GapFinder {
    mode: GapMode,
    d: f64,
    /// None: nothing stands anywhere, every point is outside.
    bound: Option<Path64>,
    b: clip::Rect64,
    margin: i64,
    parts: Vec<Paths64>,
    fitted: HashMap<isize, GapResult>,
}

/// gapAt for many points over the same shapes (the preview while the pointer moves).
pub fn gap_finder(obstacles: &[Obstacle], d: f64, mode: GapMode) -> GapFinder {
    let mut gf = GapFinder {
        mode,
        d,
        bound: None,
        b: clip::Rect64::new(0, 0, 0, 0),
        margin: 0,
        parts: vec![],
        fitted: HashMap::new(),
    };
    // Wrapped, the distance grows the hull, not the shapes: the area to click is the free space itself.
    let grown: Paths64 = obstacles
        .iter()
        .flat_map(|o| {
            grown_rings(
                o,
                if mode == GapMode::Wrap {
                    0.0
                } else {
                    d.max(0.0)
                },
            )
        })
        .collect();
    if grown.is_empty() {
        return gf;
    }
    let solid = clip::union_subjects_64(&grown, ClipFill::NonZero);
    let b = clip::get_bounds_paths(&solid);
    let margin = round(5.0 * SCALE) as i64;
    let bound: Path64 = if mode == GapMode::Hull {
        let raw: Vec<Point64> = obstacles
            .iter()
            .flat_map(|o| grown_rings(o, 0.0))
            .flatten()
            .collect();
        let hull = if raw.is_empty() {
            convex_hull(&solid.iter().flatten().copied().collect::<Vec<_>>())
        } else {
            convex_hull(&raw)
        };
        if hull.len() < 3 {
            return gf;
        }
        hull
    } else {
        vec![
            Point64::new(b.left - margin, b.top - margin),
            Point64::new(b.right + margin, b.top - margin),
            Point64::new(b.right + margin, b.bottom + margin),
            Point64::new(b.left - margin, b.bottom + margin),
        ]
    };
    let mut tree = PolyTree64::new();
    clip::boolean_op_tree_64(
        ClipType::Difference,
        ClipFill::NonZero,
        &vec![bound.clone()],
        &solid,
        &mut tree,
    );
    // The free parts: each outer ring with the holes right in it.
    fn walk(tree: &PolyTree64, node: usize, parts: &mut Vec<Paths64>) {
        for &outer in tree.nodes[node].children() {
            let mut rings: Paths64 = vec![tree.nodes[outer].polygon().clone()];
            for &hole in tree.nodes[outer].children() {
                rings.push(tree.nodes[hole].polygon().clone());
                walk(tree, hole, parts);
            }
            parts.push(rings);
        }
    }
    walk(&tree, 0, &mut gf.parts);
    gf.bound = Some(bound);
    gf.b = b;
    gf.margin = margin;
    gf
}

fn area_mm2(rings: &Paths64) -> f64 {
    clip::area_paths(rings).abs() / (SCALE * SCALE)
}

impl GapFinder {
    fn big(rings: &Paths64) -> bool {
        area_mm2(rings) >= MIN_GAP_MM2
    }

    /// Shut in only when it does not reach the box around everything.
    fn shut(&self, rings: &Paths64) -> bool {
        let pb = clip::get_bounds_path(&rings[0]);
        let (b, m) = (&self.b, self.margin);
        pb.left > b.left - m
            && pb.top > b.top - m
            && pb.right < b.right + m
            && pb.bottom < b.bottom + m
    }

    fn result(&mut self, k: isize, rings: &[Paths64]) -> GapResult {
        if let Some(r) = self.fitted.get(&k) {
            return r.clone();
        }
        let flat: Paths64 = rings.iter().flatten().cloned().collect();
        let form = if rings.is_empty() {
            None
        } else {
            form_of_rings(&flat, true)
        };
        let r = match form {
            Some(form) => GapResult::Form { form },
            None => GapResult::None {
                none: GapNone::Covered,
            },
        };
        self.fitted.insert(k, r.clone());
        r
    }

    /// The hull around the shapes in a part (its holes), clipped to the part's outline.
    fn wrapped(&mut self, k: usize) -> GapResult {
        let empty = GapResult::None {
            none: GapNone::Empty,
        };
        let holes: Vec<Point64> = self.parts[k][1..].iter().flatten().copied().collect();
        if holes.is_empty() {
            return empty;
        }
        let hull = convex_hull(&holes);
        if hull.len() < 3 {
            return empty;
        }
        let wide = if self.d > 0.0 {
            clip::inflate_paths_64(
                &vec![hull],
                self.d * SCALE,
                JoinType::Round,
                EndType::Polygon,
                2.0,
                FLAT * SCALE,
            )
        } else {
            vec![hull]
        };
        let kept = clip::intersect_64(&wide, &vec![self.parts[k][0].clone()], ClipFill::NonZero);
        if area_mm2(&kept) >= MIN_GAP_MM2 {
            self.result(k as isize, &[kept])
        } else {
            empty
        }
    }

    /// The gap at `at` (see gapAt in src/shape/ops.ts).
    pub fn at(&mut self, at: Pt) -> GapResult {
        let none = |n| GapResult::None { none: n };
        let Some(bound) = self.bound.clone() else {
            return none(GapNone::Outside);
        };
        let q = Point64::new(round(at[0] * SCALE) as i64, round(at[1] * SCALE) as i64);
        let holds = |rings: &Paths64| {
            clip::point_in_polygon(q, &rings[0]) != PointInPolygonResult::IsOutside
                && rings[1..]
                    .iter()
                    .all(|h| clip::point_in_polygon(q, h) != PointInPolygonResult::IsInside)
        };
        let beyond = clip::point_in_polygon(q, &bound) == PointInPolygonResult::IsOutside;
        // Outside the hull: every free part in it, as one form.
        if self.mode == GapMode::Hull && beyond {
            let big: Vec<Paths64> = self
                .parts
                .iter()
                .filter(|r| Self::big(r))
                .cloned()
                .collect();
            return self.result(-1, &big);
        }
        let mut k = self.parts.iter().position(holds);
        // Beyond the box is the open space around everything.
        if k.is_none() && self.mode == GapMode::Wrap && beyond {
            k = self.parts.iter().position(|r| !self.shut(r));
        }
        let Some(k) = k else {
            return none(if self.mode == GapMode::Closed && beyond {
                GapNone::Outside
            } else {
                GapNone::Covered
            });
        };
        if self.mode == GapMode::Wrap {
            return self.wrapped(k);
        }
        if self.mode == GapMode::Closed && !self.shut(&self.parts[k]) {
            return none(GapNone::Outside);
        }
        if Self::big(&self.parts[k]) {
            let rings = vec![self.parts[k].clone()];
            self.result(k as isize, &rings)
        } else {
            none(GapNone::Covered)
        }
    }
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
    fn rect(x: f64, y: f64, w: f64, h: f64) -> Form {
        Form {
            paths: vec![Path {
                closed: true,
                nodes: vec![
                    corner(x, y),
                    corner(x + w, y),
                    corner(x + w, y + h),
                    corner(x, y + h),
                ],
            }],
            nonzero: false,
        }
    }
    const K: f64 = 0.5522847498;
    fn disc(cx: f64, cy: f64, r: f64) -> Form {
        let o = r * K;
        let n = |p: Pt, a: Pt, b: Pt| Node {
            p,
            a,
            b,
            smooth: true,
        };
        Form {
            paths: vec![Path {
                closed: true,
                nodes: vec![
                    n([cx + r, cy], [cx + r, cy - o], [cx + r, cy + o]),
                    n([cx, cy + r], [cx + o, cy + r], [cx - o, cy + r]),
                    n([cx - r, cy], [cx - r, cy + o], [cx - r, cy - o]),
                    n([cx, cy - r], [cx - o, cy - r], [cx + o, cy - r]),
                ],
            }],
            nonzero: false,
        }
    }

    #[test]
    fn joins_overlapping_areas_and_keeps_their_nodes() {
        let (a, b) = (rect(0.0, 0.0, 10.0, 10.0), disc(10.0, 5.0, 4.0));
        let u = union_forms(&[a, b.clone()]).unwrap();
        assert_eq!(u.paths.len(), 1);
        // The sweep lays curves where others are near again, within a few hundredths of a µm.
        assert!((area_of_form(&u) - (100.0 + area_of_form(&b) / 2.0)).abs() < 1e-3);
        let has = |q: Pt| u.paths[0].nodes.iter().find(|n| n.p == q).map(|n| n.smooth);
        assert_eq!(has([0.0, 0.0]), Some(false));
        assert_eq!(has([0.0, 10.0]), Some(false));
        assert_eq!(has([14.0, 5.0]), Some(true));
    }

    #[test]
    fn holes_by_rule_and_subtracting() {
        let mut ring = rect(0.0, 0.0, 20.0, 20.0);
        ring.paths.extend(rect(5.0, 5.0, 10.0, 10.0).paths);
        assert!((area_of_form(&ring) - 300.0).abs() < 1e-6);
        let closed = union_forms(&[ring, rect(4.0, 4.0, 12.0, 12.0)]).unwrap();
        assert!((area_of_form(&closed) - 400.0).abs() < 1e-6);
        assert!(subtract_form(&disc(5.0, 5.0, 2.0), &rect(0.0, 0.0, 10.0, 10.0)).is_none());
        let a = disc(5.0, 5.0, 3.0);
        assert!(subtract_form(&a, &a).is_none());
        assert!((area_of_form(&intersect_forms(&a, &a).unwrap()) - area_of_form(&a)).abs() < 1e-3);
    }

    #[test]
    fn curves_shared_in_either_direction() {
        // An ellipse, and the same drawn the other way round: the sweep alone reads them wrong.
        let n = |p: Pt, a: Pt, b: Pt| Node {
            p,
            a,
            b,
            smooth: true,
        };
        let a = Form {
            paths: vec![Path {
                closed: true,
                nodes: vec![
                    n([31.07, 19.95], [24.56, 17.83], [37.58, 22.06]),
                    n([40.76, 30.25], [41.92, 26.68], [39.6, 33.82]),
                    n([26.87, 32.88], [33.38, 35.0], [20.35, 30.77]),
                    n([17.17, 22.58], [16.01, 26.16], [18.34, 19.01]),
                ],
            }],
            nonzero: false,
        };
        let mut b = a.clone();
        for p in &mut b.paths {
            p.nodes.reverse();
            for n in &mut p.nodes {
                std::mem::swap(&mut n.a, &mut n.b);
            }
        }
        let whole = area_of_form(&a);
        for f in [
            intersect_forms(&a, &b),
            union_forms(&[a.clone(), b.clone()]),
        ] {
            assert!((area_of_form(&f.unwrap()) - whole).abs() < 1e-3);
        }
        assert!(subtract_form(&a, &b).is_none());
        // A part cut from a lens, held to the lens: the part again.
        let lens = Form {
            paths: vec![Path {
                closed: true,
                nodes: vec![
                    n([55.0, 34.0], [60.5, 27.63], [60.5, 40.38]),
                    n([77.0, 34.0], [72.6, 40.38], [72.6, 27.63]),
                ],
            }],
            nonzero: false,
        };
        let top = subtract_form(&lens, &rect(50.0, 34.0, 30.0, 10.0)).unwrap();
        let held = intersect_forms(&top, &lens).unwrap();
        assert!((area_of_form(&held) - area_of_form(&top)).abs() < 1e-3);
    }

    #[test]
    fn grows_and_shrinks() {
        let sq = rect(0.0, 0.0, 10.0, 10.0);
        let g = offset_form(&sq, 2.0, 0.0, true).unwrap();
        assert!((area_of_form(&g) - (180.0 + std::f64::consts::PI * 4.0)).abs() < 0.05);
        assert!(offset_form(&sq, -6.0, 0.0, true).is_none());
    }

    #[test]
    fn crossing_nodes() {
        let line = |pts: &[Pt]| Path {
            closed: false,
            nodes: pts.iter().map(|q| corner(q[0], q[1])).collect(),
        };
        let r = with_crossing_nodes(&Form {
            paths: vec![line(&[[0.0, 0.0], [20.0, 20.0], [20.0, 0.0], [0.0, 20.0]])],
            nonzero: false,
        })
        .unwrap();
        assert_eq!(r.1, 2);
        let touch = Form {
            paths: vec![
                line(&[[0.0, 0.0], [10.0, 0.0]]),
                line(&[[10.0, 0.0], [10.0, 10.0]]),
            ],
            nonzero: false,
        };
        assert!(with_crossing_nodes(&touch).is_none());
        // A T: one line ends on the other, no crossing.
        let t = Form {
            paths: vec![
                line(&[[0.0, 0.0], [10.0, 0.0]]),
                line(&[[5.0, 0.0], [5.0, 10.0]]),
            ],
            nonzero: false,
        };
        assert!(with_crossing_nodes(&t).is_none());
    }

    #[test]
    fn gap_inside_a_ring() {
        let mut ring = rect(0.0, 0.0, 20.0, 20.0);
        ring.paths.extend(rect(5.0, 5.0, 10.0, 10.0).paths);
        let mut g = gap_finder(
            &[Obstacle {
                form: ring,
                line: false,
                width: 0.0,
            }],
            0.0,
            GapMode::Closed,
        );
        match g.at([10.0, 10.0]) {
            GapResult::Form { form } => assert!((area_of_form(&form) - 100.0).abs() < 0.5),
            r => panic!("{r:?}"),
        }
        assert!(matches!(
            g.at([30.0, 30.0]),
            GapResult::None {
                none: GapNone::Outside
            }
        ));
        assert!(matches!(
            g.at([2.0, 2.0]),
            GapResult::None {
                none: GapNone::Covered
            }
        ));
    }
}
