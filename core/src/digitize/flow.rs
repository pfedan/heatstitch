//! Fill whose stitch direction follows the image: fur, hair, petals, the strokes of a drawing.
//!
//! 1. Direction field: the structure tensor of the image (image/orientation.rs) where the image
//!    has structure, and the direction of the region's centerline where it is flat (a long shape is
//!    filled along its length), averaged as doubled angles and smoothed.
//! 2. Nearly the same direction everywhere: straight tatami rows in exactly that direction.
//! 3. Otherwise curved rows: evenly spaced streamlines of the field (Jobard & Lefer, "Creating
//!    evenly-spaced streamlines of arbitrary density", 1997). Each row is traced along the field
//!    (a line field: the direction keeps its sense from step to step, so turning points of the field
//!    need no care); new rows start one spacing beside existing ones, and a row ends where it comes
//!    closer than half a spacing to another, so rows neither pile up nor leave gaps wider than about
//!    1.5 spacings. Rows are sewn back and forth, each continuing at the nearest row end, with travel
//!    under unsewn rows between groups.
//! 4. The rows are measured before they are sewn: where they crowd (more than 2.2 times the nominal
//!    density) or leave gaps, the straight fill is used instead.

use std::collections::{HashMap, VecDeque};

use super::fill::{
    FillParams, FillResult, SHARED_TURN, TRAVEL_STITCH, TRAVEL_TOLERANCE, choose_angle,
    fill_region, note_travel, path_length, point_count, sew_underlay,
};
use super::measure::{coverage, peak_density};
use super::plan::{BEAM_PIECES, Pieces, beam_on_grid, plan_on_grid};
use super::region::{Region, sample};
use super::rings::{RingMode, ring_fill};
use super::run::{MIN_ROW_STITCH, Path, TOLERANCE, run_stitch, simplify};
use super::skeleton::Graph;
use super::travel_grid::{Footprint, TravelGrid};
use crate::geom::Pt;
use crate::js::{IdMap, dist, hypot, round};
use crate::trig::JsMath;

/// Grid cell (mm); larger regions get coarser cells, so the grid stays near 45 000 cells.
const CELL_MIN: f64 = 0.2;
const CELLS: f64 = 45000.0;
/// The field reaches this far outside the region, so rows end cleanly at its edge (mm).
const MARGIN: f64 = 0.6;
/// Weight of the shape's own direction against pronounced image structure (about 1).
const SHAPE_WEIGHT: f64 = 0.35;
/// The image's structure counts from this far inside the region (mm).
const IMAGE_INSET: f64 = 1.2;
/// Smoothing of the field (mm).
const SMOOTH_MM: f64 = 1.5;
/// Mean resultant length of the field above which rows stay straight.
const UNIFORM: f64 = 0.93;
/// Below this mean field strength there is no direction to follow.
const WEAK: f64 = 0.05;
/// Curved rows denser than this many times the nominal 1 / spacing somewhere are not used (with
/// underlay that stays under the caution limit of the density check).
pub const FLOW_PEAK: f64 = 2.2;
pub const FLOW_COVER: f64 = 0.95;
const STAGGERS: usize = 4;

#[derive(Clone, Debug)]
pub struct Grid {
    pub cell: f64,
    pub gw: usize,
    pub gh: usize,
    pub ox: f64,
    pub oy: f64,
    /// Cells of the field's domain (the region and a margin around it).
    pub dom: Vec<u8>,
    pub sdf: Vec<f32>,
}

impl Grid {
    pub fn new(r: &Region) -> Grid {
        let cell = CELL_MIN.max(((r.w * r.h) as f64 * r.px_mm * r.px_mm / CELLS).sqrt());
        let ox = f64::from(r.x0) * r.px_mm;
        let oy = f64::from(r.y0) * r.px_mm;
        let gw = ((r.w as f64 * r.px_mm) / cell).ceil() as usize;
        let gh = ((r.h as f64 * r.px_mm) / cell).ceil() as usize;
        let mut g = Grid {
            cell,
            gw,
            gh,
            ox,
            oy,
            dom: vec![0; gw * gh],
            sdf: vec![0.0; gw * gh],
        };
        let sdf = r.sdf();
        for j in 0..gh {
            for i in 0..gw {
                let k = j * gw + i;
                let c = g.center(i, j);
                g.sdf[k] = sample(r, sdf, c[0], c[1]) as f32;
                if f64::from(g.sdf[k]) < MARGIN {
                    g.dom[k] = 1;
                }
            }
        }
        g
    }

    pub fn center(&self, i: usize, j: usize) -> Pt {
        [
            self.ox + (i as f64 + 0.5) * self.cell,
            self.oy + (j as f64 + 0.5) * self.cell,
        ]
    }

    pub fn index(&self, p: Pt) -> Option<usize> {
        let i = ((p[0] - self.ox) / self.cell).floor();
        let j = ((p[1] - self.oy) / self.cell).floor();
        if i < 0.0 || j < 0.0 || i >= self.gw as f64 || j >= self.gh as f64 {
            None
        } else {
            Some(j as usize * self.gw + i as usize)
        }
    }
}

/// A direction field over a region, as doubled-angle vectors per cell of its grid.
#[derive(Clone, Debug)]
pub struct DirField {
    pub g: Grid,
    pub c: Vec<f32>,
    pub s: Vec<f32>,
}

/// Box blur of a field over the domain only (three passes, about a Gaussian).
fn blur_domain(f: &[f32], g: &Grid, r: usize) -> Vec<f32> {
    let (gw, gh) = (g.gw, g.gh);
    let ri = r as isize;
    let mut v: Vec<f32> = f
        .iter()
        .zip(&g.dom)
        .map(|(&x, &d)| if d != 0 { x } else { 0.0 })
        .collect();
    let mut wgt: Vec<f32> = g.dom.iter().map(|&d| f32::from(d)).collect();
    let pass = |a: &[f32]| -> Vec<f32> {
        let mut t = vec![0f32; a.len()];
        let mut o = vec![0f32; a.len()];
        for j in 0..gh {
            let mut acc = 0f64;
            for i in -ri..=ri {
                if i >= 0 && (i as usize) < gw {
                    acc += f64::from(a[j * gw + i as usize]);
                }
            }
            for i in 0..gw {
                t[j * gw + i] = acc as f32;
                if i + r + 1 < gw {
                    acc += f64::from(a[j * gw + i + r + 1]);
                }
                if i >= r {
                    acc -= f64::from(a[j * gw + i - r]);
                }
            }
        }
        for i in 0..gw {
            let mut acc = 0f64;
            for j in -ri..=ri {
                if j >= 0 && (j as usize) < gh {
                    acc += f64::from(t[j as usize * gw + i]);
                }
            }
            for j in 0..gh {
                o[j * gw + i] = acc as f32;
                if j + r + 1 < gh {
                    acc += f64::from(t[(j + r + 1) * gw + i]);
                }
                if j >= r {
                    acc -= f64::from(t[(j - r) * gw + i]);
                }
            }
        }
        o
    };
    for _ in 0..3 {
        v = pass(&v);
        wgt = pass(&wgt);
    }
    v.iter()
        .zip(&wgt)
        .map(|(&x, &w)| {
            if w > 0.0 {
                (f64::from(x) / f64::from(w)) as f32
            } else {
                0.0
            }
        })
        .collect()
}

/// The image's structure tensor where the field needs it: `look(px, py)` gives the doubled-angle
/// vector of the image pixel (px, py), clamped to `width` x `height`.
pub struct OrientLook<'a> {
    pub width: usize,
    pub height: usize,
    pub look: &'a dyn Fn(usize, usize) -> (f32, f32),
}

/// Direction field as doubled-angle vectors (c, s) per cell.
pub fn field(
    r: &Region,
    g: &Grid,
    graph: Option<&Graph>,
    orient: &OrientLook,
) -> (Vec<f32>, Vec<f32>) {
    let n = g.gw * g.gh;
    let mut c = vec![0f32; n];
    let mut s = vec![0f32; n];
    // The image's structure inside the region. Near its edge the tensor sees the region's own
    // outline, which is not structure to follow (the shape's direction below covers the shape), so
    // it counts only from IMAGE_INSET inside, fully a millimetre further in.
    for j in 0..g.gh {
        for i in 0..g.gw {
            let k = j * g.gw + i;
            let w = 1f64.min(0f64.max(-f64::from(g.sdf[k]) - IMAGE_INSET));
            if g.dom[k] == 0 || w <= 0.0 {
                continue;
            }
            let [x, y] = g.center(i, j);
            let px = ((orient.width - 1) as f64).min(0f64.max((x / r.px_mm).floor())) as usize;
            let py = ((orient.height - 1) as f64).min(0f64.max((y / r.px_mm).floor())) as usize;
            let (oc, os) = (orient.look)(px, py);
            c[k] = (w * f64::from(oc)) as f32;
            s[k] = (w * f64::from(os)) as f32;
        }
    }
    // The shape's direction: the tangent of the nearest centerline, spread out from it.
    if let Some(graph) = graph.filter(|g| !g.branches.is_empty()) {
        let mut sc = vec![0f32; n];
        let mut ss = vec![0f32; n];
        let mut seen = vec![0u8; n];
        let mut queue: Vec<usize> = Vec::new();
        for b in &graph.branches {
            // Only a branch that is long against its width says which way the shape runs: none for a
            // compact shape, fully from three widths on.
            let width = 2.0 * (b.r.iter().fold(0.0, |x, y| x + y) / b.r.len() as f64);
            let wgt = 1f64.min(0f64.max((path_length(&b.pts) / width.max(1e-6) - 1.0) / 2.0));
            if wgt <= 0.0 {
                continue;
            }
            let len = b.pts.len();
            for q in 0..len {
                let a = b.pts[q.saturating_sub(3)];
                let e = b.pts[(len - 1).min(q + 3)];
                let t = (e[1] - a[1]).atan2(e[0] - a[0]);
                let Some(k) = g.index(b.pts[q]) else { continue };
                if g.dom[k] == 0 || seen[k] != 0 {
                    continue;
                }
                seen[k] = 1;
                sc[k] = (wgt * (2.0 * t).js_cos()) as f32;
                ss[k] = (wgt * (2.0 * t).js_sin()) as f32;
                queue.push(k);
            }
        }
        while !queue.is_empty() {
            let mut next = Vec::new();
            for &k in &queue {
                let i = k % g.gw;
                let around = [
                    if i > 0 { k as isize - 1 } else { -1 },
                    if i < g.gw - 1 { k as isize + 1 } else { -1 },
                    k as isize - g.gw as isize,
                    (k + g.gw) as isize,
                ];
                for q in around {
                    if q < 0 || q as usize >= n {
                        continue;
                    }
                    let q = q as usize;
                    if seen[q] != 0 || g.dom[q] == 0 {
                        continue;
                    }
                    seen[q] = 1;
                    sc[q] = sc[k];
                    ss[q] = ss[k];
                    next.push(q);
                }
            }
            queue = next;
        }
        for k in 0..n {
            c[k] = (f64::from(c[k]) + SHAPE_WEIGHT * f64::from(sc[k])) as f32;
            s[k] = (f64::from(s[k]) + SHAPE_WEIGHT * f64::from(ss[k])) as f32;
        }
    }
    let rad = 1f64.max(round(SMOOTH_MM / g.cell / 1.7)) as usize;
    (blur_domain(&c, g, rad), blur_domain(&s, g, rad))
}

/// Unit direction of the field at p (bilinear in the doubled angles), or None where it has none.
fn direction_at(g: &Grid, c: &[f32], s: &[f32], p: Pt) -> Option<Pt> {
    let fx = (p[0] - g.ox) / g.cell - 0.5;
    let fy = (p[1] - g.oy) / g.cell - 0.5;
    let i = 0f64.max(((g.gw as f64) - 2.0).min(fx.floor()));
    let j = 0f64.max(((g.gh as f64) - 2.0).min(fy.floor()));
    let tx = 0f64.max(1f64.min(fx - i));
    let ty = 0f64.max(1f64.min(fy - j));
    let k = j as usize * g.gw + i as usize;
    let lerp2 = |f: &[f32]| {
        let at = |q: usize| f.get(q).map_or(f64::NAN, |&v| f64::from(v));
        (at(k) * (1.0 - tx) + at(k + 1) * tx) * (1.0 - ty)
            + (at(k + g.gw) * (1.0 - tx) + at(k + g.gw + 1) * tx) * ty
    };
    let cc = lerp2(c);
    let ss = lerp2(s);
    // NaN (a grid of one cell) is not below the limit, as in TypeScript.
    if hypot(cc, ss) < 1e-6 {
        return None;
    }
    let t = ss.atan2(cc) / 2.0;
    Some([t.js_cos(), t.js_sin()])
}

/// Points of committed rows in buckets, for the distance tests.
struct Occupancy {
    buckets: IdMap<i64, Vec<Pt>>,
    size: f64,
}

impl Occupancy {
    fn new(size: f64) -> Occupancy {
        Occupancy {
            buckets: IdMap::default(),
            size,
        }
    }
    fn add(&mut self, p: Pt) {
        let k = (p[0] / self.size).floor() as i64 * 1000003 + (p[1] / self.size).floor() as i64;
        self.buckets.entry(k).or_default().push(p);
    }
    /// Whether a point lies within d (at most the bucket size) of p.
    fn near(&self, p: Pt, d: f64) -> bool {
        let bx = (p[0] / self.size).floor() as i64;
        let by = (p[1] / self.size).floor() as i64;
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(l) = self.buckets.get(&((bx + dx) * 1000003 + by + dy))
                    && l.iter().any(|&q| dist(p, q) < d)
                {
                    return true;
                }
            }
        }
        false
    }
}

/// Integration step along a row (mm).
const STEP: f64 = 0.1;
/// Below this length a traced row is not kept (mm).
const MIN_ROW: f64 = 1.0;

/// Row spacing at a point (mm): the same everywhere, or changing evenly across the shape, as for
/// straight gradient rows (see Frame in fill.rs): `from` on the side across the rows (at right
/// angles to `angle` degrees) where the rows start, `to` on the far side, measured over the
/// region's own pixels.
#[derive(Clone, Copy)]
struct Spacing {
    from: f64,
    to: f64,
    n: Pt,
    lo: f64,
    span: f64,
    graded: bool,
}

impl Spacing {
    fn even(s: f64) -> Spacing {
        Spacing {
            from: s,
            to: s,
            n: [0.0, 0.0],
            lo: 0.0,
            span: 1.0,
            graded: false,
        }
    }

    fn across(r: &Region, angle: f64, from: f64, to: f64) -> Spacing {
        let a = (angle * std::f64::consts::PI) / 180.0;
        let n = [-a.js_sin(), a.js_cos()];
        let mut lo = f64::INFINITY;
        let mut hi = f64::NEG_INFINITY;
        for y in 0..r.h {
            for x in 0..r.w {
                if r.mask[y * r.w + x] == 0 {
                    continue;
                }
                let v = (x as f64 + f64::from(r.x0) + 0.5) * r.px_mm * n[0]
                    + (y as f64 + f64::from(r.y0) + 0.5) * r.px_mm * n[1];
                lo = lo.min(v);
                hi = hi.max(v);
            }
        }
        if !lo.is_finite() {
            return Spacing::even(from);
        }
        Spacing {
            from,
            to,
            n,
            lo,
            span: 1e-6f64.max(hi - lo),
            graded: true,
        }
    }

    fn at(&self, p: Pt) -> f64 {
        if !self.graded {
            return self.from;
        }
        self.from
            + (self.to - self.from)
                * 0f64.max(1f64.min((p[0] * self.n[0] + p[1] * self.n[1] - self.lo) / self.span))
    }
}

/// Evenly spaced streamlines of the field over the region, one row spacing apart (see above). With a
/// spacing that changes over the region, rows lie as far apart as the spacing where they are
/// (Jobard & Lefer's streamlines of varying density).
fn streamlines(
    r: &Region,
    g: &Grid,
    c: &[f32],
    s: &[f32],
    at: Spacing,
    widest: f64,
) -> Vec<Vec<Pt>> {
    let sdf = r.sdf();
    let mut occ = Occupancy::new(widest);
    let inside = |p: Pt| sample(r, sdf, p[0], p[1]) < 0.0;
    let max_steps = ((4.0 * hypot(r.w as f64, r.h as f64) * r.px_mm) / STEP).ceil() as usize;

    // One direction from the seed; own points count once they are three spacings behind.
    let trace = |occ: &Occupancy, seed: Pt, d0: Pt| -> Vec<Pt> {
        let mut pts = vec![seed];
        let mut own = Occupancy::new(widest);
        let lag = ((3.0 * at.at(seed)) / STEP).ceil() as usize;
        let mut p = seed;
        let mut prev = d0;
        for _ in 0..max_steps {
            let mut d = direction_at(g, c, s, p).unwrap_or(prev);
            if d[0] * prev[0] + d[1] * prev[1] < 0.0 {
                d = [-d[0], -d[1]];
            }
            let mid = [p[0] + (d[0] * STEP) / 2.0, p[1] + (d[1] * STEP) / 2.0];
            let mut d2 = direction_at(g, c, s, mid).unwrap_or(d);
            if d2[0] * d[0] + d2[1] * d[1] < 0.0 {
                d2 = [-d2[0], -d2[1]];
            }
            let q = [p[0] + d2[0] * STEP, p[1] + d2[1] * STEP];
            let fq = sample(r, sdf, q[0], q[1]);
            if fq >= 0.0 {
                // Ends at the edge of the region, at the crossing.
                let fp = sample(r, sdf, p[0], p[1]);
                let t = fp / (fp - fq);
                pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
                break;
            }
            let d_test = 0.5 * at.at(q);
            if occ.near(q, d_test) || own.near(q, d_test) {
                break;
            }
            pts.push(q);
            if pts.len() > lag {
                own.add(pts[pts.len() - 1 - lag]);
            }
            p = q;
            prev = d2;
        }
        pts
    };

    let mut lines: Vec<Vec<Pt>> = Vec::new();
    // The row through a seed, traced both ways; None if too short.
    let through = |occ: &Occupancy, seed: Pt| -> Option<Vec<Pt>> {
        if !inside(seed) || occ.near(seed, at.at(seed) * 0.99) {
            return None;
        }
        let d = direction_at(g, c, s, seed).unwrap_or([1.0, 0.0]);
        let fwd = trace(occ, seed, d);
        let mut line = trace(occ, seed, [-d[0], -d[1]]);
        line.reverse();
        line.extend_from_slice(&fwd[1..]);
        (path_length(&line) >= MIN_ROW).then_some(line)
    };
    let commit = |occ: &mut Occupancy, lines: &mut Vec<Vec<Pt>>, line: Vec<Pt>| -> usize {
        for &p in &line {
            occ.add(p);
        }
        lines.push(line);
        lines.len() - 1
    };
    let grow = |occ: &mut Occupancy, lines: &mut Vec<Vec<Pt>>, first: usize| {
        let mut queue = VecDeque::from([first]);
        while let Some(li) = queue.pop_front() {
            let mut acc = 0.0;
            let len = lines[li].len();
            for i in 1..len {
                let line = &lines[li];
                acc += dist(line[i - 1], line[i]);
                if acc < at.at(line[i]) / 2.0 {
                    continue;
                }
                acc = 0.0;
                let a = line[i.saturating_sub(2)];
                let b = line[(len - 1).min(i + 2)];
                let l = dist(a, b);
                let l = if l == 0.0 { 1.0 } else { l };
                let nrm = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
                let li_pt = line[i];
                for side in [1.0, -1.0] {
                    // The spacing halfway to the new row, so a row beside a denser one is not seeded too close.
                    let half = at.at(li_pt) / 2.0;
                    let d = at.at([
                        li_pt[0] + nrm[0] * half * side,
                        li_pt[1] + nrm[1] * half * side,
                    ]);
                    let seed = [li_pt[0] + nrm[0] * d * side, li_pt[1] + nrm[1] * d * side];
                    if let Some(next) = through(occ, seed) {
                        let k = commit(occ, lines, next);
                        queue.push_back(k);
                    }
                }
            }
        }
    };
    // Start at the deepest point, then fill whatever the rows did not reach (other lobes of the shape).
    let mut deepest = 0;
    for i in 1..r.inside.len() {
        if r.inside[i] > r.inside[deepest] {
            deepest = i;
        }
    }
    let seed = [
        ((deepest % r.w) as f64 + f64::from(r.x0) + 0.5) * r.px_mm,
        ((deepest / r.w) as f64 + f64::from(r.y0) + 0.5) * r.px_mm,
    ];
    if let Some(first) = through(&occ, seed) {
        let k = commit(&mut occ, &mut lines, first);
        grow(&mut occ, &mut lines, k);
    }
    for j in 0..g.gh {
        for i in 0..g.gw {
            if f64::from(g.sdf[j * g.gw + i]) > -at.at(g.center(i, j)) / 2.0 {
                continue;
            }
            let Some(line) = through(&occ, g.center(i, j)) else {
                continue;
            };
            let k = commit(&mut occ, &mut lines, line);
            grow(&mut occ, &mut lines, k);
        }
    }
    lines
}

/// Lengthens a row at both ends along its direction (pull compensation).
fn lengthen(pts: Vec<Pt>, d: f64) -> Vec<Pt> {
    if d <= 0.0 || pts.len() < 2 {
        return pts;
    }
    let ext = |a: Pt, b: Pt| -> Pt {
        let l = dist(a, b);
        let l = if l == 0.0 { 1.0 } else { l };
        [
            a[0] + ((a[0] - b[0]) / l) * d,
            a[1] + ((a[1] - b[1]) / l) * d,
        ]
    };
    let n = pts.len();
    let mut out = Vec::with_capacity(n);
    out.push(ext(pts[0], pts[2.min(n - 1)]));
    out.extend_from_slice(&pts[1..n - 1]);
    out.push(ext(pts[n - 1], pts[n.saturating_sub(3)]));
    out
}

/// Stitches along a row: needle points every `len` of arc length, shifted by a quarter stitch from
/// level to level (stagger). Where the row bends between two of them by more than `tol`, a straight
/// stitch would cut the curve, so that stretch is divided into shorter stitches until each keeps
/// within `tol` (not shorter than MIN_ROW_STITCH).
fn row_stitches(k: usize, pts: &[Pt], len: f64, tol: f64) -> Vec<Pt> {
    let path = Path::new(pts.to_vec());
    let total = path.total;
    let phase = ((k % STAGGERS) as f64 / STAGGERS as f64) * len;
    let margin = 0.6f64.min(len / 4.0);
    let mut marks = vec![0.0];
    let mut s = phase;
    while s < total - margin {
        if s >= margin {
            marks.push(s);
        }
        s += len;
    }
    marks.push(total);
    let mut out = vec![pts[0]];
    for m in 1..marks.len() {
        let s0 = marks[m - 1];
        let s1 = marks[m];
        let fits = |n: usize| {
            let nf = n as f64;
            (1..=n).all(|q| {
                let qf = q as f64;
                path.deviation(
                    s0 + ((s1 - s0) * (qf - 1.0)) / nf,
                    s0 + ((s1 - s0) * qf) / nf,
                ) <= tol
            })
        };
        let mut parts = 1;
        while !fits(parts) && (s1 - s0) / (parts + 1) as f64 >= MIN_ROW_STITCH {
            parts += 1;
        }
        for q in 1..=parts {
            out.push(path.at(s0 + ((s1 - s0) * q as f64) / parts as f64));
        }
    }
    out
}

/// Fill following the image's direction; None when the region has no direction to follow (the
/// caller fills it straight at the usual angle) or curved rows fail the checks.
pub fn flow_fill(
    r: &Region,
    graph: Option<&Graph>,
    orient: &OrientLook,
    p: &FillParams,
    start: Pt,
) -> Option<FillResult> {
    let g = Grid::new(r);
    let (c, s) = field(r, &g, graph, orient);
    field_fill(r, &g, &c, &s, p, start, false, FLOW_PEAK, FLOW_COVER)
}

/// Field of rows that run along the outline (contour fill): at every cell the direction across the
/// gradient of the distance to the edge, so rows form rings inside the shape.
pub fn contour_field(r: &Region) -> DirField {
    let g = Grid::new(r);
    let n = g.gw * g.gh;
    let mut c = vec![0f32; n];
    let mut s = vec![0f32; n];
    for j in 1..g.gh.saturating_sub(1) {
        for i in 1..g.gw.saturating_sub(1) {
            let k = j * g.gw + i;
            if g.dom[k] == 0 {
                continue;
            }
            let dx = f64::from(g.sdf[k + 1]) - f64::from(g.sdf[k - 1]);
            let dy = f64::from(g.sdf[k + g.gw]) - f64::from(g.sdf[k - g.gw]);
            let l = hypot(dx, dy);
            if l < 1e-6 {
                continue;
            }
            // Along the edge: the gradient turned by 90 degrees, which flips the doubled angle.
            let ca = dx / l;
            let sa = dy / l;
            c[k] = (-(ca * ca - sa * sa)) as f32;
            s[k] = (-(2.0 * ca * sa)) as f32;
        }
    }
    let rad = 1f64.max(round(0.6 / g.cell)) as usize;
    let (c, s) = (blur_domain(&c, &g, rad), blur_domain(&s, &g, rad));
    DirField { g, c, s }
}

/// Field of the directions of given stitches (rows as sewn), spread over the whole region: keeps
/// the look of curved rows when they are sewn anew at another spacing.
pub fn stitch_field(r: &Region, lines: &[[Pt; 2]]) -> DirField {
    let g = Grid::new(r);
    let n = g.gw * g.gh;
    let mut c = vec![0f32; n];
    let mut s = vec![0f32; n];
    let mut w = vec![0f32; n];
    for &[a, b] in lines {
        let l = dist(a, b);
        if l < 1e-6 {
            continue;
        }
        let t = (b[1] - a[1]).atan2(b[0] - a[0]);
        let cc = (2.0 * t).js_cos();
        let ss = (2.0 * t).js_sin();
        let steps = 1f64.max((l / (g.cell / 2.0)).ceil());
        let mut q = 0.0;
        while q <= steps {
            if let Some(k) = g.index([
                a[0] + ((b[0] - a[0]) * q) / steps,
                a[1] + ((b[1] - a[1]) * q) / steps,
            ]) && g.dom[k] != 0
            {
                c[k] = (f64::from(c[k]) + cc) as f32;
                s[k] = (f64::from(s[k]) + ss) as f32;
                w[k] += 1.0;
            }
            q += 1.0;
        }
    }
    let rad = 1f64.max(round(SMOOTH_MM / g.cell / 1.7)) as usize;
    let mut bc = blur_domain(&c, &g, rad);
    let mut bs = blur_domain(&s, &g, rad);
    let bw = blur_domain(&w, &g, rad);
    for k in 0..n {
        let wk = f64::from(bw[k]);
        bc[k] = if wk > 1e-6 {
            (f64::from(bc[k]) / wk) as f32
        } else {
            0.0
        };
        bs[k] = if wk > 1e-6 {
            (f64::from(bs[k]) / wk) as f32
        } else {
            0.0
        };
    }
    DirField { g, c: bc, s: bs }
}

/// Field of guide lines drawn on a fill (guided fill): every cell takes the direction of the
/// nearest point of each guide, weighted by the inverse square of its distance, so one guide gives
/// rows parallel to it and several guides blend from one to the next.
pub fn guide_field(r: &Region, guides: &[Vec<Pt>]) -> DirField {
    let g = Grid::new(r);
    let n = g.gw * g.gh;
    let mut c = vec![0f32; n];
    let mut s = vec![0f32; n];
    struct Seg {
        a: Pt,
        b: Pt,
        cc: f64,
        ss: f64,
        guide: usize,
    }
    let mut segs = Vec::new();
    for (k, line) in guides.iter().enumerate() {
        for i in 1..line.len() {
            let (a, b) = (line[i - 1], line[i]);
            if dist(a, b) < 1e-6 {
                continue;
            }
            let t = (b[1] - a[1]).atan2(b[0] - a[0]);
            segs.push(Seg {
                a,
                b,
                cc: (2.0 * t).js_cos(),
                ss: (2.0 * t).js_sin(),
                guide: k,
            });
        }
    }
    if segs.is_empty() {
        return DirField { g, c, s };
    }
    let mut near = vec![0f64; guides.len()];
    let mut nc = vec![0f64; guides.len()];
    let mut ns = vec![0f64; guides.len()];
    for k in 0..n {
        if g.dom[k] == 0 {
            continue;
        }
        let p = g.center(k % g.gw, k / g.gw);
        near.fill(f64::INFINITY);
        for sg in &segs {
            let dx = sg.b[0] - sg.a[0];
            let dy = sg.b[1] - sg.a[1];
            let t = 0f64.max(
                1f64.min(((p[0] - sg.a[0]) * dx + (p[1] - sg.a[1]) * dy) / (dx * dx + dy * dy)),
            );
            let d = hypot(sg.a[0] + dx * t - p[0], sg.a[1] + dy * t - p[1]);
            if d < near[sg.guide] {
                near[sg.guide] = d;
                nc[sg.guide] = sg.cc;
                ns[sg.guide] = sg.ss;
            }
        }
        for q in 0..guides.len() {
            if !near[q].is_finite() {
                continue;
            }
            let w = 1.0 / (near[q] * near[q] + 0.25);
            c[k] = (f64::from(c[k]) + w * nc[q]) as f32;
            s[k] = (f64::from(s[k]) + w * ns[q]) as f32;
        }
        let l = hypot(f64::from(c[k]), f64::from(s[k]));
        if l > 1e-12 {
            c[k] = (f64::from(c[k]) / l) as f32;
            s[k] = (f64::from(s[k]) / l) as f32;
        }
    }
    let rad = 1f64.max(round(0.6 / g.cell)) as usize;
    let (c, s) = (blur_domain(&c, &g, rad), blur_domain(&s, &g, rad));
    DirField { g, c, s }
}

/// Fill along a direction field: straight tatami rows when the field has nearly one direction
/// (unless `curved_only`), else curved rows; None when there is no direction or the rows fail the
/// checks. `peak` is the highest density allowed anywhere, in times the nominal 1 / spacing.
#[allow(clippy::too_many_arguments)]
pub fn field_fill(
    r: &Region,
    g: &Grid,
    c: &[f32],
    s: &[f32],
    p: &FillParams,
    start: Pt,
    curved_only: bool,
    peak: f64,
    cover: f64,
) -> Option<FillResult> {
    let (mut sc, mut ss, mut sm) = (0.0, 0.0, 0.0);
    let mut cells = 0usize;
    for k in 0..c.len() {
        if g.dom[k] == 0 || g.sdf[k] >= 0.0 {
            continue;
        }
        let (ck, sk) = (f64::from(c[k]), f64::from(s[k]));
        sc += ck;
        ss += sk;
        sm += hypot(ck, sk);
        cells += 1;
    }
    if cells == 0 || sm / (cells as f64) < WEAK {
        return None;
    }
    let mean = (ss.atan2(sc) / 2.0) * (180.0 / std::f64::consts::PI);
    if !curved_only && hypot(sc, ss) / sm > UNIFORM {
        let mut q = p.clone();
        q.angle = Some(mean);
        let mut res = fill_region(r, &q, start, &[])?;
        res.curved = false;
        return Some(res);
    }

    // Curved rows; with spacing_end as a gradient across the shape, at right angles to the mean direction.
    let end = p.spacing_end.unwrap_or(p.spacing);
    let graded = (end - p.spacing).abs() >= 1e-3;
    let at = if graded {
        Spacing::across(r, mean, p.spacing, end)
    } else {
        Spacing::even(p.spacing)
    };
    let (dense, open) = (p.spacing.min(end), p.spacing.max(end));
    let rows: Vec<Vec<Pt>> = streamlines(r, g, c, s, at, open)
        .into_iter()
        .map(|line| lengthen(simplify(&line, 0.02), p.pull))
        .collect();
    if rows.is_empty() {
        return None;
    }
    // The rows must not crowd or leave gaps; checked before anything is sewn.
    if peak_density(&rows, |_, _| false) > peak / dense || coverage(r, &rows, open * 0.75) < cover {
        return None;
    }
    Some(sew_rows(r, &rows, p, start, mean, open, false))
}

/// Chains of rows as pieces to plan: entered at either end.
struct ChainPieces<'a> {
    chains: &'a [Vec<Vec<Pt>>],
    half: f64,
    straight: &'a dyn Fn(Pt, Pt) -> bool,
}

#[derive(Clone, Copy, Debug)]
pub struct ChainWay {
    p: Pt,
    rev: bool,
}

impl ChainPieces<'_> {
    fn ends(&self, c: usize) -> (Pt, Pt) {
        let ch = &self.chains[c];
        let last = &ch[ch.len() - 1];
        (ch[0][0], last[last.len() - 1])
    }
}

impl Pieces for ChainPieces<'_> {
    type W = ChainWay;
    fn ways(&self, s: usize) -> Vec<ChainWay> {
        let (a, b) = self.ends(s);
        vec![ChainWay { p: a, rev: false }, ChainWay { p: b, rev: true }]
    }
    fn p(w: &ChainWay) -> Pt {
        w.p
    }
    fn exit(&self, s: usize, w: &ChainWay) -> Pt {
        let (a, b) = self.ends(s);
        if w.rev { a } else { b }
    }
    fn prints(&self, s: usize, grid: &mut TravelGrid) -> Vec<Footprint> {
        let mut out = Vec::new();
        for row in &self.chains[s] {
            for i in 1..row.len() {
                out.push(grid.footprint(row[i - 1], row[i], self.half));
            }
        }
        out
    }
    fn straight(&self, a: Pt, b: Pt) -> bool {
        (self.straight)(a, b)
    }
}

/// Curved rows (each a line through the area) sewn one after the other: underlay at `mean` degrees
/// first when asked, then the rows joined into chains (row_chains: rows whose ends lie close by,
/// within `widest` rows with the step inside the area, are joined straight), the chains in the order
/// planned on the travel grid as sections of straight rows are (beam_on_grid, plan_on_grid): the
/// next is the one reached by the shortest way hidden under rows still to come, so the needle does
/// not run back along the outline on top of sewn rows. Between chains travel runs under rows not
/// sewn yet, else the needle jumps. `stitched` rows are needle points already (else they are cut
/// into stitches here).
pub fn sew_rows(
    r: &Region,
    rows: &[Vec<Pt>],
    p: &FillParams,
    start: Pt,
    mean: f64,
    widest: f64,
    stitched: bool,
) -> FillResult {
    let mut runs: Vec<Vec<Pt>> = Vec::new();
    let mut grid = TravelGrid::new(
        p.travel.as_ref().unwrap_or(r),
        p.off_row_ends == Some(true),
        None,
    );
    grid.walks = p.save_trims == Some(true);
    let mut pos = if p.underlay {
        sew_underlay(r, mean, p, start, &mut grid, &mut runs, None)
    } else {
        start
    };
    let under = point_count(&runs);
    let mut has_cur = !runs.is_empty();
    let reach = 2.5 * widest + 0.3;
    let half = p.spacing / 2.0;
    let mut trail: Vec<[usize; 2]> = Vec::new();
    let sdf = r.sdf();
    // A row starting this close is joined straight, while the step stays inside the area.
    let straight = |a: Pt, b: Pt| -> bool {
        let d = dist(a, b);
        d <= 1.0 || (d < reach && sample(r, sdf, (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0) < half)
    };
    let chains = row_chains(rows, &straight, reach);
    let pieces = ChainPieces {
        chains: &chains,
        half,
        straight: &straight,
    };
    for row in rows {
        for i in 1..row.len() {
            grid.expect(row[i - 1], row[i], half);
        }
    }
    let secs: Vec<usize> = (0..chains.len()).collect();
    let (order, _) = if chains.len() <= BEAM_PIECES {
        beam_on_grid(&pieces, &secs, pos, &mut grid, None)
    } else {
        plan_on_grid(&pieces, &secs, pos, &mut grid, None, None)
    };
    let tol = p.tolerance.unwrap_or(TOLERANCE);
    let mut count = 0usize;
    for (ci, e) in order {
        let chain = &chains[ci];
        let lines: Vec<Vec<Pt>> = if e.rev {
            chain
                .iter()
                .rev()
                .map(|row| row.iter().rev().copied().collect())
                .collect()
        } else {
            chain.clone()
        };
        let mut pts: Vec<Pt> = Vec::new();
        for line in &lines {
            let row = if stitched {
                line.clone()
            } else {
                let k = count;
                count += 1;
                row_stitches(k, line, p.stitch, tol)
            };
            // Rows this close share the hole where they turn, as tatami rows do (see SHARED_TURN).
            let skip = matches!(pts.last(), Some(&last) if row.len() > 1 && dist(last, row[0]) <= SHARED_TURN + 1e-3);
            pts.extend_from_slice(if skip { &row[1..] } else { &row[..] });
        }
        let bd = dist(pos, pts[0]);
        let mut travel: Option<Vec<Pt>> = None;
        if has_cur && straight(pos, pts[0]) {
            travel = Some(vec![pos, pts[0]]);
        } else if has_cur
            && let Some(path) = grid.path(pos, pts[0], true)
            && path_length(&path) < grid.way(bd)
        {
            travel = Some(run_stitch(&path, TRAVEL_STITCH, TRAVEL_TOLERANCE));
        }
        match travel {
            Some(t) if has_cur => {
                if t.len() > 2 {
                    note_travel(&mut trail, &runs, t.len());
                }
                let cur = runs.last_mut().unwrap();
                cur.extend_from_slice(&t[1..]);
                cur.extend_from_slice(&pts[1..]);
            }
            _ => {
                runs.push(pts.clone());
                has_cur = true;
            }
        }
        for row in chain {
            for i in 1..row.len() {
                grid.cover(row[i - 1], row[i], half);
            }
        }
        pos = pts[pts.len() - 1];
    }

    FillResult {
        runs,
        angle: mean,
        under,
        travel: trail,
        curved: true,
    }
}

/// The rows joined into chains sewn back and forth in one go, independent of where sewing starts:
/// row ends close enough to step straight (see `straight`) are paired, shortest step first, each end
/// at most once and never into a loop (a path cover by greedy matching, as Kruskal builds a tree).
/// `straight` holds only for ends less than `reach` (or 1 mm) apart.
/// Each chain lists its rows in sewing order, each turned to start where the one before ends.
pub fn row_chains(
    rows: &[Vec<Pt>],
    straight: &dyn Fn(Pt, Pt) -> bool,
    reach: f64,
) -> Vec<Vec<Vec<Pt>>> {
    let n = rows.len();
    let end_of = |e: usize| -> Pt {
        let row = &rows[e >> 1];
        if e % 2 == 1 {
            row[row.len() - 1]
        } else {
            row[0]
        }
    };
    struct Link {
        a: usize,
        b: usize,
        d: f64,
    }
    let mut links: Vec<Link> = Vec::new();
    // Ends on a grid of cells `reach` wide, so only ends near each other are compared.
    let cell = reach.max(1.0);
    let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for e in 0..2 * n {
        let q = end_of(e);
        grid.entry(((q[0] / cell).floor() as i64, (q[1] / cell).floor() as i64))
            .or_default()
            .push(e);
    }
    for e in 0..2 * n {
        let q = end_of(e);
        let ci = (q[0] / cell).floor() as i64;
        let cj = (q[1] / cell).floor() as i64;
        for dj in -1..=1 {
            for di in -1..=1 {
                let Some(list) = grid.get(&(ci + di, cj + dj)) else {
                    continue;
                };
                for &f in list {
                    if f <= e || f >> 1 == e >> 1 {
                        continue;
                    }
                    let o = end_of(f);
                    if straight(q, o) {
                        links.push(Link {
                            a: e,
                            b: f,
                            d: dist(q, o),
                        });
                    }
                }
            }
        }
    }
    links.sort_by(|x, y| x.d.partial_cmp(&y.d).unwrap_or(std::cmp::Ordering::Equal));
    let mut mate = vec![-1i64; 2 * n];
    let mut root: Vec<usize> = (0..n).collect();
    fn find(root: &mut [usize], i: usize) -> usize {
        let mut a = i;
        while root[a] != a {
            a = root[a];
        }
        let mut b = i;
        while root[b] != a {
            let next = root[b];
            root[b] = a;
            b = next;
        }
        a
    }
    for &Link { a, b, .. } in &links {
        if mate[a] >= 0 || mate[b] >= 0 {
            continue;
        }
        let ra = find(&mut root, a >> 1);
        let rb = find(&mut root, b >> 1);
        if ra == rb {
            continue;
        }
        mate[a] = b as i64;
        mate[b] = a as i64;
        root[ra] = rb;
    }
    let mut chains = Vec::new();
    let mut seen = vec![false; n];
    for i in 0..n {
        if seen[i] {
            continue;
        }
        // Walk to one end of the chain, then along it.
        let mut e = 2 * i;
        while mate[e] >= 0 {
            e = mate[e] as usize ^ 1;
        }
        let mut chain = Vec::new();
        loop {
            let r = e >> 1;
            seen[r] = true;
            chain.push(if e % 2 == 1 {
                rows[r].iter().rev().copied().collect()
            } else {
                rows[r].clone()
            });
            let out = e ^ 1;
            if mate[out] < 0 {
                break;
            }
            e = mate[out] as usize;
        }
        chains.push(chain);
    }
    chains
}

/// Contour fill as rings at even distances inside the edge: the level lines of the area's
/// distance field, the first half a spacing inside the edge (moved out by `pull`), each next one a
/// spacing further in. Every ring is exactly one spacing from its neighbours all round, so the rows
/// neither crowd nor open up, also in narrow and bent shapes. Each ring passes on to the next over
/// a few millimetres, without a step (see rings.rs).
pub fn contour_fill(r: &Region, p: &FillParams, start: Pt) -> Option<FillResult> {
    ring_fill(
        r,
        p,
        start,
        RingMode::Contour,
        choose_angle(r, p.spacing, &[]),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    fn params() -> FillParams {
        FillParams {
            spacing: 0.4,
            stitch: 3.0,
            ..Default::default()
        }
    }

    #[test]
    fn a_ring_field_gives_curved_rows() {
        let r = region_of(160, 0.1, |x, y| {
            let d = (x - 8.0).hypot(y - 8.0);
            (3.0..7.0).contains(&d)
        });
        let f = contour_field(&r);
        // Rings crowd a little where they close (about 2.3 times the nominal density here).
        assert!(
            field_fill(
                &r,
                &f.g,
                &f.c,
                &f.s,
                &params(),
                [1.0, 8.0],
                false,
                FLOW_PEAK,
                FLOW_COVER
            )
            .is_none()
        );
        let res = field_fill(
            &r,
            &f.g,
            &f.c,
            &f.s,
            &params(),
            [1.0, 8.0],
            false,
            3.0,
            FLOW_COVER,
        )
        .expect("rows");
        assert!(res.curved);
        assert!(res.runs.iter().map(|r| r.len()).sum::<usize>() > 100);
    }

    #[test]
    fn a_straight_guide_gives_straight_rows() {
        let r = region_of(100, 0.1, |x, y| {
            (1.0..9.0).contains(&x) && (1.0..9.0).contains(&y)
        });
        let f = guide_field(&r, &[vec![[0.0, 0.0], [10.0, 10.0]]]);
        let res = field_fill(
            &r,
            &f.g,
            &f.c,
            &f.s,
            &params(),
            [1.0, 1.0],
            false,
            FLOW_PEAK,
            FLOW_COVER,
        )
        .expect("rows");
        assert!(!res.curved);
        assert!((res.angle - 45.0).abs() < 1.0);
    }

    #[test]
    fn row_chains_join_close_ends() {
        let rows = vec![
            vec![[0.0, 0.0], [5.0, 0.0]],
            vec![[0.0, 0.4], [5.0, 0.4]],
            vec![[20.0, 0.0], [25.0, 0.0]],
        ];
        let chains = row_chains(&rows, &|a, b| dist(a, b) <= 1.0, 1.0);
        assert_eq!(chains.len(), 2);
        assert_eq!(chains[0].len(), 2);
        assert!(dist(*chains[0][0].last().unwrap(), chains[0][1][0]) < 1.0);
    }
}
