//! Compact shapes for "Vorschlagen" (see satinSuggest): areas that are no line but are sewn as satin
//! the way a digitizer would, each by its own planner. They are found on their own (a fill that is
//! a dot or a triangle) and inside a drawing of lines (the nose on the mouth, the pupil on the ring
//! of the eye: a thick place the lines run into). There they are cut off where the line starts and
//! planned apart from the lines.
//!
//! - `dot`: a round area. Up to the satin limit one column across; wider (up to DOT_MAX) cut in two
//!   halves along its long axis (through a hole in it, as the highlight in a pupil), each sewn
//!   square to the cut, so no stitch is longer than the half.
//! - `pointed`: an area with corners (a triangle, a nose). The lines across fan out from the corner
//!   that keeps the stitches shortest to the edge opposite it.
//! - `leaf` and `drop`: a long round area pointed at both ends or at one. Sewn as a dot is (one
//!   column, or halves cut along its middle as the vein of a leaf); the halves of a leaf slant
//!   toward its tip, as the veins do.
//!
//! Ported from src/digitize/satinShapes.ts.

use serde::{Deserialize, Serialize};

use super::region::{Bbox, Region, build_region, pixel_mm};
use super::rungs::{InsideTest, by, norm, sub};
use super::skeleton::{Branch, Graph, Node};
use crate::geom::Pt;
use crate::js::{dist, round};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlobKind {
    Dot,
    Pointed,
    Leaf,
    Drop,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShapePlan {
    pub kind: BlobKind,
    pub cuts: Vec<[Pt; 2]>,
    pub lines: Vec<[Pt; 2]>,
}

/// Widest round area cut into two halves (mm).
pub const DOT_MAX: f64 = 12.0;
/// A place this many times the half width of the lines (and 0.6 mm more) is a thick place.
const THICK: f64 = 1.8;
/// A bend sharper than this (degrees, over CORNER_ARM either side) is a corner of the outline.
const CORNER_DEG: f64 = 55.0;
const CORNER_ARM: f64 = 0.7;
/// Grid the shape of a thick place is sampled on (mm).
const STEP: f64 = 0.15;

#[inline]
pub(crate) fn add(a: Pt, b: Pt, k: f64) -> Pt {
    [a[0] + b[0] * k, a[1] + b[1] * k]
}
#[inline]
pub(crate) fn dot(a: Pt, b: Pt) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
#[inline]
pub(crate) fn perp(v: Pt) -> Pt {
    [-v[1], v[0]]
}
pub(crate) fn median(v: &[f64]) -> f64 {
    let mut s = v.to_vec();
    s.sort_by(|a, b| by(*a, *b));
    s.get(s.len() >> 1).copied().unwrap_or(0.0)
}
fn length_of(pts: &[Pt]) -> f64 {
    pts.windows(2).map(|w| dist(w[1], w[0])).sum()
}
pub(crate) fn max_of(v: impl IntoIterator<Item = f64>) -> f64 {
    // Math.max: NaN wins.
    v.into_iter().fold(f64::NEG_INFINITY, |m, x| {
        if x.is_nan() || m.is_nan() {
            f64::NAN
        } else {
            m.max(x)
        }
    })
}
fn min_of(v: impl IntoIterator<Item = f64>) -> f64 {
    v.into_iter().fold(f64::INFINITY, |m, x| {
        if x.is_nan() || m.is_nan() {
            f64::NAN
        } else {
            m.min(x)
        }
    })
}
pub(crate) fn centroid(pts: &[Pt]) -> Pt {
    let (mut x, mut y) = (0.0, 0.0);
    for p in pts {
        x += p[0];
        y += p[1];
    }
    [x / pts.len() as f64, y / pts.len() as f64]
}

/// Whether a point lies on the area: inside one of its outsides and in none of its holes.
pub struct Material {
    outs: Vec<InsideTest>,
    ins: Vec<InsideTest>,
}

impl Material {
    pub fn new(outsides: &[Vec<Pt>], holes: &[Vec<Pt>]) -> Material {
        Material {
            outs: outsides.iter().map(|r| InsideTest::new(r)).collect(),
            ins: holes.iter().map(|r| InsideTest::new(r)).collect(),
        }
    }
    pub fn test(&self, q: Pt) -> bool {
        self.outs.iter().any(|f| f.test(q)) && !self.ins.iter().any(|f| f.test(q))
    }
}

/// The holes that lie in a thick place rather than between lines (the highlight in a pupil): round,
/// and the area around them at least as thick as they are wide. By index in `holes`.
pub fn small_holes(g: &Graph, holes: &[Vec<Pt>]) -> Vec<usize> {
    let pts: Vec<(Pt, f64)> = g
        .branches
        .iter()
        .flat_map(|b| b.pts.iter().zip(&b.r).map(|(&p, &r)| (p, r)))
        .collect();
    (0..holes.len())
        .filter(|&k| {
            let hole = &holes[k];
            let c = centroid(hole);
            let n = hole.len();
            let mut area = 0.0;
            for (i, p) in hole.iter().enumerate() {
                area += p[0] * hole[(i + 1) % n][1] - hole[(i + 1) % n][0] * p[1];
            }
            let area = area.abs() / 2.0;
            let far = max_of(hole.iter().map(|&q| dist(q, c)));
            if area < 0.5 * std::f64::consts::PI * far * far {
                return false;
            }
            let rr = (area / std::f64::consts::PI).sqrt();
            pts.iter()
                .any(|&(p, r)| r >= rr && dist(p, c) < rr + 1.5 * r)
        })
        .collect()
}

/// The area with these holes filled.
pub fn filled(area: &Region, holes: &[Vec<Pt>]) -> Region {
    let (w, h) = (area.w, area.h);
    let tests: Vec<InsideTest> = holes.iter().map(|r| InsideTest::new(r)).collect();
    let mut comp = vec![0i32; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if area.mask[i] != 0 || tests.iter().any(|f| f.test(pixel_mm(area, x, y))) {
                comp[i] = 1;
            }
        }
    }
    let bbox = Bbox {
        min_x: 0,
        min_y: 0,
        max_x: w as i32 - 1,
        max_y: h as i32 - 1,
    };
    let mut r = build_region(
        &comp,
        &vec![0u8; w * h],
        w,
        1,
        1,
        bbox,
        h,
        area.px_mm,
        0.0,
        |_| false,
    );
    r.x0 += area.x0;
    r.y0 += area.y0;
    r
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Disk {
    pub p: Pt,
    pub r: f64,
}

/// Where a line leaves a thick place: the point on the line's centerline, its direction there and half width.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Attach {
    pub p: Pt,
    pub t: Pt,
    pub r: f64,
}

/// A thick place inside a drawing of lines: the disks of its centerline and where lines leave it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Blob {
    pub disks: Vec<Disk>,
    pub attach: Vec<Attach>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Blobs {
    pub blobs: Vec<Blob>,
    pub cuts: Vec<[Pt; 2]>,
    pub strokes: Graph,
}

/// The thick places of a drawing of lines, the cut lines that part them from the lines, and what is
/// left of the lines (a graph for planStrokes). None when there is none.
pub fn split_blobs(g: &Graph) -> Option<Blobs> {
    let all: Vec<f64> = g
        .branches
        .iter()
        .flat_map(|b| b.r.iter().copied())
        .collect();
    if all.is_empty() {
        return None;
    }
    let h = median(&all);
    let tau = (THICK * h).max(h + 0.6);
    // The thick points, grouped where their disks overlap.
    let mut thick: Vec<Disk> = vec![];
    for b in &g.branches {
        for (i, &p) in b.pts.iter().enumerate() {
            if b.r[i] >= tau {
                thick.push(Disk { p, r: b.r[i] });
            }
        }
    }
    if thick.is_empty() {
        return None;
    }
    let mut root: Vec<usize> = (0..thick.len()).collect();
    fn find(root: &mut [usize], i: usize) -> usize {
        if root[i] == i {
            return i;
        }
        let r = find(root, root[i]);
        root[i] = r;
        r
    }
    for i in 0..thick.len() {
        for j in i + 1..thick.len() {
            if dist(thick[i].p, thick[j].p) < thick[i].r + thick[j].r {
                let (a, b) = (find(&mut root, i), find(&mut root, j));
                root[a] = b;
            }
        }
    }
    // Groups in the order their roots first come.
    let mut keys: Vec<usize> = vec![];
    let mut clusters: Vec<Vec<Disk>> = vec![];
    for (i, &d) in thick.iter().enumerate() {
        let k = find(&mut root, i);
        match keys.iter().position(|&x| x == k) {
            Some(c) => clusters[c].push(d),
            None => {
                keys.push(k);
                clusters.push(vec![d]);
            }
        }
    }
    let max_r: Vec<f64> = clusters
        .iter()
        .map(|c| max_of(c.iter().map(|d| d.r)))
        .collect();
    // The circle each thick place fills about (its disks reach its edge all round).
    let circle: Vec<(Pt, f64)> = clusters
        .iter()
        .map(|c| {
            let (mut x, mut y, mut w) = (0.0, 0.0, 0.0);
            for d in c {
                x += d.p[0] * d.r;
                y += d.p[1] * d.r;
                w += d.r;
            }
            let o = [x / w, y / w];
            (o, max_of(c.iter().map(|d| dist(o, d.p) + d.r)))
        })
        .collect();
    // The thick place a centerline point belongs to (-1: none).
    let near = |q: Pt, r: f64| -> i64 {
        clusters
            .iter()
            .position(|c| c.iter().any(|d| dist(q, d.p) < d.r + 0.25 * r))
            .map_or(-1, |k| k as i64)
    };
    let mut degree = std::collections::HashMap::new();
    for b in &g.branches {
        *degree.entry(b.a).or_insert(0) += 1;
        *degree.entry(b.b).or_insert(0) += 1;
    }
    let deg = |n: usize| degree.get(&n).copied().unwrap_or(0);
    let mut blobs: Vec<Blob> = clusters
        .iter()
        .map(|c| Blob {
            disks: c.clone(),
            attach: vec![],
        })
        .collect();
    let mut nodes = g.nodes.clone();
    let mut branches: Vec<Branch> = vec![];
    let mut cuts: Vec<[Pt; 2]> = vec![];
    for b0 in &g.branches {
        let mut b = b0.clone();
        let mut at: Vec<i64> = b.pts.iter().zip(&b.r).map(|(&p, &r)| near(p, r)).collect();
        if at.iter().all(|&x| x < 0) {
            branches.push(b);
            continue;
        }
        // A ring through a thick place: walked from a point in it, so the rest is one piece.
        if b.a == b.b {
            let k = at.iter().position(|&x| x >= 0).unwrap();
            let rot = |v: &[Pt]| [&v[k..], &v[1..=k]].concat();
            let rotf = |v: &[f64]| [&v[k..], &v[1..=k]].concat();
            b = Branch {
                a: b.a,
                b: b.b,
                pts: rot(&b.pts),
                r: rotf(&b.r),
            };
            at = [&at[k..], &at[1..=k]].concat();
        }
        // The pieces outside the thick places.
        let len_b = b.pts.len();
        let mut i = 0;
        while i < len_b {
            if at[i] >= 0 {
                blobs[at[i] as usize].disks.push(Disk {
                    p: b.pts[i],
                    r: b.r[i],
                });
                i += 1;
                continue;
            }
            let mut j = i;
            while j + 1 < len_b && at[j + 1] < 0 {
                j += 1;
            }
            let from = if i > 0 { at[i - 1] } else { -1 };
            let to = if j + 1 < len_b { at[j + 1] } else { -1 };
            let pts = &b.pts[i..=j];
            let r = &b.r[i..=j];
            let len = length_of(pts);
            let free = (i == 0 && deg(b.a) == 1) || (j == len_b - 1 && deg(b.b) == 1);
            let owner = if from >= 0 { from } else { to };
            // A short piece into a corner, a short neck between two sides of the same thick place, or a
            // piece within its round (beside a hole in it): part of the thick place.
            let within = owner >= 0 && {
                let (o, rr) = circle[owner as usize];
                pts.iter()
                    .zip(r)
                    .all(|(&p, &rk)| dist(p, o) + 0.5 * rk <= rr + 0.2)
            };
            if owner >= 0
                && (within
                    || (((free && (from < 0 || to < 0)) || from == to)
                        && len < 1.5 * max_r[owner as usize]))
            {
                for (&p, &rk) in pts.iter().zip(r) {
                    blobs[owner as usize].disks.push(Disk { p, r: rk });
                }
                i = j + 1;
                continue;
            }
            // A line leaving a thick place starts where it stops getting thinner.
            let half = median(r);
            let mut s = 0usize;
            let mut e = pts.len() - 1;
            if from >= 0 {
                while (s as f64) < e as f64 / 2.0 && r[s] > 1.2 * half {
                    s += 1;
                }
            }
            if to >= 0 {
                while (e as f64) > (s as f64).max((pts.len() - 1) as f64 / 2.0) && r[e] > 1.2 * half
                {
                    e -= 1;
                }
            }
            for k in 0..s {
                blobs[from as usize].disks.push(Disk { p: pts[k], r: r[k] });
            }
            for k in e + 1..pts.len() {
                blobs[to as usize].disks.push(Disk { p: pts[k], r: r[k] });
            }
            let piece_pts = pts[s..=e].to_vec();
            let piece_r = r[s..=e].to_vec();
            if piece_pts.len() < 2 {
                i = j + 1;
                continue;
            }
            let mut end = |k: usize, inward: i64, blob: usize| -> usize {
                let p = piece_pts[k];
                let q = (k as i64 + inward * 3).clamp(0, piece_pts.len() as i64 - 1) as usize;
                let t = norm(sub(piece_pts[q], p));
                blobs[blob].attach.push(Attach {
                    p,
                    t,
                    r: piece_r[k],
                });
                let w = piece_r[k] * 1.25 + 0.3;
                cuts.push([add(p, perp(t), -w), add(p, perp(t), w)]);
                nodes.push(Node { p, r: piece_r[k] });
                nodes.len() - 1
            };
            let a = if from >= 0 {
                end(0, 1, from as usize)
            } else if i == 0 {
                b.a
            } else {
                b.b
            };
            let z = if to >= 0 {
                end(piece_pts.len() - 1, -1, to as usize)
            } else if j == len_b - 1 {
                b.b
            } else {
                b.a
            };
            branches.push(Branch {
                a,
                b: z,
                pts: piece_pts,
                r: piece_r,
            });
            i = j + 1;
        }
    }
    Some(Blobs {
        blobs,
        cuts,
        strokes: Graph { nodes, branches },
    })
}

/// The shape to plan: points of it on a grid, and the stretches of the outline around it.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Shape {
    pub samples: Vec<Pt>,
    /// Outline points of the shape, as stretches in order (for its corners).
    pub outline: Vec<Vec<Pt>>,
    /// Holes lying inside the shape.
    pub holes: Vec<Vec<Pt>>,
    /// Where lines leave it (see Blob).
    pub attach: Vec<Attach>,
}

/// A whole area as a shape.
pub fn whole_shape(outsides: &[Vec<Pt>], holes: &[Vec<Pt>], material: &Material) -> Shape {
    // Each ring walked on a little past its start, so a corner at the start has arms both sides.
    let wrap = |r: &Vec<Pt>| {
        let mut out = r.clone();
        let mut l = 0.0;
        let mut i = 1;
        while i < r.len() && l < 2.0 {
            l += dist(r[i - 1], r[i]);
            out.push(r[i]);
            i += 1;
        }
        out
    };
    let flat: Vec<Pt> = outsides.concat();
    Shape {
        samples: grid(&flat, &|q| material.test(q)),
        outline: outsides.iter().chain(holes).map(wrap).collect(),
        holes: holes.to_vec(),
        attach: vec![],
    }
}

/// A thick place as a shape: the part of the area nearer to its disks than to the lines left
/// (`lines`: the centerlines of what is left, see split_blobs), so its corners count too.
pub fn blob_shape(
    blob: &Blob,
    lines: &Graph,
    outsides: &[Vec<Pt>],
    holes: &[Vec<Pt>],
    material: &Material,
) -> Shape {
    let disks: Vec<Disk> = blob.disks.iter().step_by(2).copied().collect();
    let reach = max_of(disks.iter().map(|d| d.r));
    // Corners reach out up to about twice the widest disk beyond it (a narrow triangle further).
    let m = 3.0 * reach;
    let bx: Vec<Pt> = disks
        .iter()
        .flat_map(|d| [add(d.p, [m, m], 1.0), add(d.p, [-m, -m], 1.0)])
        .collect();
    let x0 = min_of(bx.iter().map(|p| p[0]));
    let x1 = max_of(bx.iter().map(|p| p[0]));
    let y0 = min_of(bx.iter().map(|p| p[1]));
    let y1 = max_of(bx.iter().map(|p| p[1]));
    let within = |q: Pt| q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
    let others: Vec<Disk> = lines
        .branches
        .iter()
        .flat_map(|b| b.pts.iter().zip(&b.r).map(|(&p, &r)| Disk { p, r }))
        .enumerate()
        .filter(|&(k, d)| {
            k % 2 == 0 && d.p[0] > x0 - m && d.p[0] < x1 + m && d.p[1] > y0 - m && d.p[1] < y1 + m
        })
        .map(|(_, d)| d)
        .collect();
    // Nearest by how far outside a disk it lies (the medial disks cover the area).
    let gap = |q: Pt, ds: &[Disk]| {
        ds.iter()
            .fold(f64::INFINITY, |m, d| m.min(dist(q, d.p) - d.r))
    };
    let mine = |q: Pt| within(q) && gap(q, &disks) <= gap(q, &others);
    let samples = grid(&bx, &|q| material.test(q) && mine(q));
    let mut outline: Vec<Vec<Pt>> = vec![];
    for ring in outsides.iter().chain(holes) {
        let mut runs: Vec<(usize, Vec<Pt>)> = vec![];
        let mut run: (usize, Vec<Pt>) = (0, vec![]);
        for (i, &q) in ring.iter().enumerate() {
            if mine(q) {
                if run.1.is_empty() {
                    run.0 = i;
                }
                run.1.push(q);
            } else if !run.1.is_empty() {
                runs.push(std::mem::take(&mut run));
            }
        }
        // A stretch running over the start of the outline is one.
        if !run.1.is_empty() && !runs.is_empty() && runs[0].0 == 0 {
            let first = std::mem::take(&mut runs[0].1);
            runs[0].1 = [run.1, first].concat();
        } else if !run.1.is_empty() {
            runs.push(run);
        }
        outline.extend(runs.into_iter().map(|r| r.1));
    }
    // Holes it surrounds (most of their outline nearer to it than to the lines).
    Shape {
        samples,
        outline,
        holes: holes
            .iter()
            .filter(|h| h.iter().filter(|&&q| mine(q)).count() as f64 > 0.7 * h.len() as f64)
            .cloned()
            .collect(),
        attach: blob.attach.clone(),
    }
}

/// Points on a grid over the box of `bx` that `keep` keeps.
pub fn grid(bx: &[Pt], keep: &dyn Fn(Pt) -> bool) -> Vec<Pt> {
    let x0 = min_of(bx.iter().map(|p| p[0]));
    let x1 = max_of(bx.iter().map(|p| p[0]));
    let y0 = min_of(bx.iter().map(|p| p[1]));
    let y1 = max_of(bx.iter().map(|p| p[1]));
    let mut out = vec![];
    let mut y = y0 + STEP / 2.0;
    while y < y1 {
        let mut x = x0 + STEP / 2.0;
        while x < x1 {
            if keep([x, y]) {
                out.push([x, y]);
            }
            x += STEP;
        }
        y += STEP;
    }
    out
}

pub(crate) fn degrees(a: Pt, b: Pt) -> f64 {
    dot(norm(a), norm(b)).clamp(-1.0, 1.0).acos() * 180.0 / std::f64::consts::PI
}

/// The sharp bends of the shape's outline: corners sticking out (the area lies inside the bend) and
/// notches (cutting in, as at the top of a heart).
pub fn corners(s: &Shape, material: &dyn Fn(Pt) -> bool) -> (Vec<Pt>, Vec<Pt>) {
    struct Found {
        p: Pt,
        deg: f64,
        convex: bool,
    }
    let mut found: Vec<Found> = vec![];
    for run in &s.outline {
        let mut cum = vec![0.0];
        for i in 1..run.len() {
            cum.push(cum[i - 1] + dist(run[i - 1], run[i]));
        }
        let turn = |i: usize| -> Option<(f64, bool)> {
            let (mut a, mut b) = (i, i);
            while a > 0 && cum[i] - cum[a] < CORNER_ARM {
                a -= 1;
            }
            while b < run.len() - 1 && cum[b] - cum[i] < CORNER_ARM {
                b += 1;
            }
            if cum[i] - cum[a] < CORNER_ARM * 0.7 || cum[b] - cum[i] < CORNER_ARM * 0.7 {
                return None;
            }
            let din = norm(sub(run[i], run[a]));
            let dout = norm(sub(run[b], run[i]));
            let deg = dot(din, dout).clamp(-1.0, 1.0).acos() * 180.0 / std::f64::consts::PI;
            // Sticking out where the area lies between the arms: the middle of the two arm ends is on it.
            let m = [(run[a][0] + run[b][0]) / 2.0, (run[a][1] + run[b][1]) / 2.0];
            Some((deg, material(add(run[i], norm(sub(m, run[i])), 0.15))))
        };
        let ts: Vec<Option<(f64, bool)>> = (0..run.len()).map(turn).collect();
        let deg_at = |k: Option<usize>| {
            k.and_then(|k| ts.get(k).copied().flatten())
                .map_or(0.0, |t| t.0)
        };
        for i in 0..run.len() {
            let Some((deg, convex)) = ts[i] else { continue };
            if deg < CORNER_DEG {
                continue;
            }
            if deg_at(i.checked_sub(1)) > deg || deg_at(Some(i + 1)) > deg {
                continue;
            }
            if let Some(close) = found
                .iter_mut()
                .find(|f| f.convex == convex && dist(f.p, run[i]) < 1.2)
            {
                if deg > close.deg {
                    close.p = run[i];
                    close.deg = deg;
                }
            } else {
                found.push(Found {
                    p: run[i],
                    deg,
                    convex,
                });
            }
        }
    }
    (
        found.iter().filter(|f| f.convex).map(|f| f.p).collect(),
        found.iter().filter(|f| !f.convex).map(|f| f.p).collect(),
    )
}

/// A plan and its longest stitch (mm).
#[derive(Clone)]
struct Option_ {
    plan: ShapePlan,
    longest: f64,
}

/// Where a fan can start: a corner, or the end of a line leaving the shape (spread along it).
struct Tip {
    p: Pt,
    along: Option<Pt>,
    w: Option<f64>,
}

/// Cut lines and lines across for a compact shape: a dot or a pointed area (see the top), or None
/// when it fits neither within the satin limit `max` (mm). A fan is preferred unless a column
/// across keeps the stitches clearly shorter.
pub fn plan_shape(
    s: &Shape,
    material: &dyn Fn(Pt) -> bool,
    max: f64,
    split: bool,
    column: bool,
) -> Option<ShapePlan> {
    if s.samples.len() < 8 {
        return None;
    }
    let (out, notches) = corners(s, material);
    // A heart: cut from its notch to the corner opposite, each half planned on its own.
    if split
        && notches.len() == 1
        && !out.is_empty()
        && s.holes.is_empty()
        && s.attach.is_empty()
        && let Some(h) = plan_halves(s, notches[0], &out, material, max)
    {
        return Some(h);
    }
    let tips: Vec<Tip> = out
        .iter()
        .map(|&p| Tip {
            p,
            along: None,
            w: None,
        })
        .chain(s.attach.iter().map(|a| Tip {
            p: a.p,
            along: Some(perp(a.t)),
            w: Some(a.r * 0.7),
        }))
        .collect();
    let fan = if !tips.is_empty() && s.holes.is_empty() {
        plan_fan(s, &tips, material, max)
    } else {
        None
    };
    let col = plan_dot(s, material, max, &out);
    if let Some(c) = &col {
        if column || out.len() > 3 {
            return Some(c.plan.clone());
        }
        if c.plan.kind != BlobKind::Dot {
            return Some(c.plan.clone());
        }
    }
    if let Some(f) = &fan
        && col.as_ref().is_none_or(|c| c.longest >= 0.6 * f.longest)
    {
        return Some(f.plan.clone());
    }
    col.map(|c| c.plan)
}

fn plan_halves(
    s: &Shape,
    notch: Pt,
    out: &[Pt],
    material: &dyn Fn(Pt) -> bool,
    max: f64,
) -> Option<ShapePlan> {
    let tip = out[1..].iter().fold(out[0], |a, &b| {
        if dist(b, notch) > dist(a, notch) {
            b
        } else {
            a
        }
    });
    let d = norm(sub(tip, notch));
    let n = perp(d);
    let mut plans = vec![];
    for sgn in [-1.0, 1.0] {
        let on = |q: Pt| sgn * dot(sub(q, notch), n) > 0.0;
        let half = Shape {
            samples: s.samples.iter().copied().filter(|&q| on(q)).collect(),
            outline: s
                .outline
                .iter()
                .map(|r| r.iter().copied().filter(|&q| on(q)).collect::<Vec<_>>())
                .filter(|r| r.len() > 2)
                .collect(),
            holes: vec![],
            attach: vec![],
        };
        plans.push(plan_shape(
            &half,
            &|q| material(q) && on(q),
            max,
            false,
            false,
        )?);
    }
    let mut cuts = vec![[add(notch, d, -0.3), add(tip, d, 0.3)]];
    cuts.extend(plans.iter().flat_map(|p| p.cuts.iter().copied()));
    Some(ShapePlan {
        kind: BlobKind::Pointed,
        cuts,
        lines: plans.iter().flat_map(|p| p.lines.iter().copied()).collect(),
    })
}

/// Lines across fanning out from the corner that keeps the stitches shortest.
fn plan_fan(s: &Shape, tips: &[Tip], material: &dyn Fn(Pt) -> bool, max: f64) -> Option<Option_> {
    let far = |a: Pt| s.samples.iter().fold(0.0f64, |m, &q| m.max(dist(a, q)));
    let mut tip = &tips[0];
    let mut reach = far(tip.p);
    for t in &tips[1..] {
        let f = far(t.p);
        if f < reach {
            tip = t;
            reach = f;
        }
    }
    if reach > max {
        return None;
    }
    let apex = tip.p;
    // The directions the shape lies in, seen from the corner.
    let c = centroid(&s.samples);
    let toward = norm(sub(c, apex));
    let side = perp(toward);
    let mut angles: Vec<f64> = s
        .samples
        .iter()
        .filter(|&&q| dist(q, apex) > 0.3)
        .map(|&q| dot(sub(q, apex), side).atan2(dot(sub(q, apex), toward)))
        .collect();
    angles.sort_by(|a, b| by(*a, *b));
    if angles.len() < 8 {
        return None;
    }
    let lo = angles[(angles.len() as f64 * 0.02).floor() as usize];
    let hi = angles[(angles.len() as f64 * 0.98).ceil() as usize - 1];
    let span = hi - lo;
    // A shape seen within a narrow angle is a line; seen from a point on a round edge (nearly half
    // round), it has no corner there to fan from.
    let deg = std::f64::consts::PI / 180.0;
    if span < 25.0 * deg || span > 140.0 * deg {
        return None;
    }
    let n = (round(span / (25.0 * deg)) + 1.0).clamp(3.0, 7.0) as usize;
    // The lines start a little apart, in the order they fan out, so they meet the outline one after
    // another (at one point the satin tool could not tell their order).
    let along = match tip.along {
        Some(a) if dot(a, side) < 0.0 => [-a[0], -a[1]],
        Some(a) => a,
        None => side,
    };
    let w = tip.w.unwrap_or(0.25);
    let mut lines = vec![];
    for k in 0..n {
        let f = 0.12 + (0.76 * k as f64) / (n - 1) as f64;
        let a = lo + span * f;
        let d = norm(add(
            [toward[0] * a.cos(), toward[1] * a.cos()],
            side,
            a.sin(),
        ));
        let from = add(apex, along, w * (2.0 * f - 1.0));
        // From just outside the corner to beyond the edge opposite it, along the shape.
        let mut end = 0.0;
        let mut t = 0.1;
        while t <= reach + 0.2 {
            if material(add(from, d, t)) {
                end = t;
            }
            t += 0.05;
        }
        if end < 0.4 {
            continue;
        }
        lines.push([add(from, d, -0.4), add(from, d, end + 0.4)]);
    }
    (lines.len() >= 3).then(|| Option_ {
        plan: ShapePlan {
            kind: BlobKind::Pointed,
            cuts: vec![],
            lines,
        },
        longest: reach,
    })
}

/// The extent of the samples along v from o, half a grid step beyond them.
fn extent(s: &Shape, o: Pt, v: Pt) -> (f64, f64) {
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for &q in &s.samples {
        let x = dot(sub(q, o), v);
        lo = lo.min(x);
        hi = hi.max(x);
    }
    (lo - STEP / 2.0, hi + STEP / 2.0)
}

/// A round area: one column across, or two halves cut along it (through a hole in it).
fn plan_dot(s: &Shape, material: &dyn Fn(Pt) -> bool, max: f64, tips: &[Pt]) -> Option<Option_> {
    if s.holes.len() > 1 {
        return None;
    }
    let c = centroid(&s.samples);
    // The long axis (of the second moments).
    let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
    for &q in &s.samples {
        let [x, y] = sub(q, c);
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
    }
    let ang = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    let axis = [ang.cos(), ang.sin()];
    let (ulo, uhi) = extent(s, c, axis);
    let (nlo, nhi) = extent(s, c, perp(axis));
    // Round enough: covers about half its box or more (a triangle just so).
    if (s.samples.len() as f64) * STEP * STEP < 0.45 * (uhi - ulo) * (nhi - nlo) {
        return None;
    }
    // Long, with a corner at an end of its long way or at both: a drop or a leaf.
    let ends = [ulo, uhi].map(|e| {
        tips.iter().any(|&t| {
            (dot(sub(t, c), axis) - e).abs() < 0.6
                && dot(sub(t, c), perp(axis)).abs() < 0.25 * (nhi - nlo)
        })
    });
    let kind = if !s.holes.is_empty() || uhi - ulo < 1.4 * (nhi - nlo) {
        BlobKind::Dot
    } else if ends[0] && ends[1] {
        BlobKind::Leaf
    } else if ends[0] || ends[1] {
        BlobKind::Drop
    } else {
        BlobKind::Dot
    };
    let hole = s.holes.first();
    if hole.is_none() && nhi - nlo <= max {
        // One column across, along the long axis.
        let n = perp(axis);
        let m = if uhi - ulo > 1.3 * (nhi - nlo) { 3 } else { 1 };
        let lines = (1..=m)
            .map(|k| {
                let p = add(c, axis, ulo + ((uhi - ulo) * k as f64) / (m + 1) as f64);
                [add(p, n, nlo - 0.4), add(p, n, nhi + 0.4)]
            })
            .collect();
        return Some(Option_ {
            plan: ShapePlan {
                kind,
                cuts: vec![],
                lines,
            },
            longest: nhi - nlo,
        });
    }
    // Two halves, cut along a line through the middle (through the hole): the long axis, else the
    // way that keeps the halves narrowest with the cut clear of the lines leaving the shape.
    let base = hole.map_or(c, |h| centroid(h));
    // A leaf: cut along its vein, the halves slanting toward the tip at the far end of its axis.
    if kind == BlobKind::Leaf
        && let Some(mut h) = halves(
            s,
            material,
            base,
            axis,
            false,
            std::f64::consts::PI / 3.0,
            max,
        )
        && h.longest <= max
    {
        h.plan.kind = kind;
        return Some(h);
    }
    let mut ways = vec![axis];
    for k in 1..12 {
        let a = ang + (k as f64 * std::f64::consts::PI) / 12.0;
        ways.push([a.cos(), a.sin()]);
    }
    let mut best: Option<Option_> = None;
    for u in ways {
        if let Some(h) = halves(
            s,
            material,
            base,
            u,
            hole.is_some(),
            std::f64::consts::FRAC_PI_2,
            f64::INFINITY,
        ) && best.as_ref().is_none_or(|b| h.longest < b.longest - 0.05)
        {
            best = Some(h);
        }
    }
    let mut best = best.filter(|b| b.longest <= max)?;
    best.plan.kind = if kind == BlobKind::Leaf {
        BlobKind::Dot
    } else {
        kind
    };
    Some(best)
}

/// A material stretch along a ray: where it starts and ends (mm from o), or None.
fn run(material: &dyn Fn(Pt) -> bool, o: Pt, d: Pt, to: f64) -> Option<(f64, f64)> {
    let mut a: Option<f64> = None;
    let mut b = 0.0;
    let mut t = 0.0;
    while t <= to {
        let on = material(add(o, d, t));
        if on && a.is_none() {
            a = Some(t);
        }
        if on {
            b = t;
        }
        if !on && a.is_some() {
            break;
        }
        t += 0.05;
    }
    a.map(|a| (a, b))
}

/// Two halves cut along the line through `base` in direction u, lines square to the cut.
fn halves(
    s: &Shape,
    material: &dyn Fn(Pt) -> bool,
    base: Pt,
    u: Pt,
    hole: bool,
    slant: f64,
    max: f64,
) -> Option<Option_> {
    let n = perp(u);
    let (ulo, uhi) = extent(s, base, u);
    let (nlo, nhi) = extent(s, base, n);
    if nhi - nlo > DOT_MAX {
        return None;
    }
    let mut cuts = vec![];
    let mut ends = vec![];
    for sgn in [-1.0, 1.0] {
        let d = [u[0] * sgn, u[1] * sgn];
        let r = run(
            material,
            base,
            d,
            (if sgn < 0.0 { -ulo } else { uhi }) + 1.0,
        )?;
        ends.push(add(base, d, r.1));
        if hole {
            cuts.push([add(base, d, r.0 - 0.3), add(base, d, r.1 + 0.3)]);
        }
    }
    if !hole {
        cuts.push([add(ends[0], u, -0.4), add(ends[1], u, 0.4)]);
    }
    // Clear of where lines leave the shape (their cut lines lie there).
    let clear = |p: Pt| s.attach.iter().all(|a| dist(a.p, p) > a.r * 1.25 + 0.8);
    if !ends.iter().all(|&p| clear(p)) {
        return None;
    }
    // Slanting (a leaf's veins) where the stitches stay within max so, else square to the cut.
    let half = (-nlo).max(nhi);
    let a = if half / slant.sin() <= max {
        slant
    } else {
        std::f64::consts::FRAC_PI_2
    };
    let mut lines = vec![];
    for f in [0.15, 0.32, 0.5, 0.68, 0.85] {
        let p = add(base, u, ulo + (uhi - ulo) * f);
        for sgn in [-1.0, 1.0] {
            let d = norm(add(
                [n[0] * sgn * a.sin(), n[1] * sgn * a.sin()],
                u,
                a.cos(),
            ));
            let Some(r) = run(
                material,
                p,
                d,
                (if sgn < 0.0 { -nlo } else { nhi }) / a.sin() + 1.0,
            ) else {
                continue;
            };
            if r.1 - r.0 < 0.4 {
                continue;
            }
            lines.push([
                add(p, d, if r.0 > 0.1 { r.0 - 0.3 } else { -0.3 }),
                add(p, d, r.1 + 0.3),
            ]);
        }
    }
    Some(Option_ {
        plan: ShapePlan {
            kind: BlobKind::Dot,
            cuts,
            lines,
        },
        longest: half / a.sin(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn circle(cx: f64, cy: f64, r: f64, n: usize) -> Vec<Pt> {
        (0..n)
            .map(|i| {
                let a = i as f64 / n as f64 * std::f64::consts::TAU;
                [cx + r * a.cos(), cy + r * a.sin()]
            })
            .collect()
    }

    #[test]
    fn a_dot_is_one_column() {
        let o = vec![circle(0.0, 0.0, 2.0, 60)];
        let m = Material::new(&o, &[]);
        let s = whole_shape(&o, &[], &m);
        let p = plan_shape(&s, &|q| m.test(q), 7.0, true, false).unwrap();
        assert_eq!(p.kind, BlobKind::Dot);
        assert!(!p.lines.is_empty() && p.cuts.is_empty());
    }

    #[test]
    fn a_wide_dot_is_cut_in_halves() {
        let o = vec![circle(0.0, 0.0, 5.0, 120)];
        let m = Material::new(&o, &[]);
        let s = whole_shape(&o, &[], &m);
        let p = plan_shape(&s, &|q| m.test(q), 7.0, true, false).unwrap();
        assert_eq!(p.cuts.len(), 1);
    }

    #[test]
    fn a_triangle_fans() {
        let o = vec![vec![[0.0, 0.0], [6.0, 0.0], [3.0, 5.0], [0.0, 0.0]]];
        let m = Material::new(&o, &[]);
        let mut s = whole_shape(&o, &[], &m);
        // Corners need outline points along the sides.
        s.outline = vec![super::super::skeleton::resample(&o[0], &[0.0; 4], 0.1).0];
        let p = plan_shape(&s, &|q| m.test(q), 7.0, true, false);
        assert!(p.is_some());
    }
}
