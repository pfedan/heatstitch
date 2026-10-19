//! Letters that overlap are sewn there once (src/lettering/overlap.ts). Where a letter sewn later
//! lies on one sewn before, the letter below leaves out every stitch that lies wholly under a
//! letter on top; a stitch only partly under stays whole, so the letter below still reaches under
//! the one on top and no fabric shows between them. What is left out is crossed by a few running
//! stitches hidden under the letter on top, so every piece starts and ends where the font has it.
//!
//! What a satin covers is the strip between its rails: it is sewn wider by its pull compensation
//! and pulls in to about that width on the fabric.

use crate::digitize::region::{Region, sample};
use crate::geom::Pt;
use crate::js::dist;
use crate::model::restitch::{Rails, column_of};

/// Longest running stitch hidden under the letter on top (mm).
const TRAVEL: f64 = 2.0;
/// How many stitches ahead a running stitch may reach (satin stitches lie closer than 0.2 mm apart
/// along the column).
const REACH: usize = 24;
/// A stitch is followed this finely to see whether it lies under a cover (mm).
const STEP: f64 = 0.1;

struct Quad {
    pts: [Pt; 4],
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

/// Whether `p` lies in the quadrilateral (crossings counted, so either orientation).
fn in_quad(q: &Quad, p: Pt) -> bool {
    if p[0] < q.min_x || p[0] > q.max_x || p[1] < q.min_y || p[1] > q.max_y {
        return false;
    }
    let mut c = false;
    let mut j = 3;
    for i in 0..4 {
        let a = q.pts[i];
        let b = q.pts[j];
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
        {
            c = !c;
        }
        j = i;
    }
    c
}

enum Shape {
    Quads(Vec<Quad>),
    Area(Region),
}

/// What an element of a letter covers.
pub struct Cover {
    shape: Shape,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl Cover {
    fn inside(&self, p: Pt) -> bool {
        match &self.shape {
            Shape::Quads(qs) => qs.iter().any(|q| in_quad(q, p)),
            Shape::Area(r) => sample(r, &r.sdf_base, p[0], p[1]) < 0.0,
        }
    }
}

fn min4(v: [f64; 4]) -> f64 {
    v.into_iter().fold(f64::INFINITY, f64::min)
}
fn max4(v: [f64; 4]) -> f64 {
    v.into_iter().fold(f64::NEG_INFINITY, f64::max)
}

/// What a satin column covers: the strip between its rails, piece by piece from rung to rung (so
/// a column that crosses itself, as in a loop, covers the crossing too).
pub fn satin_cover(rails: &Rails) -> Option<Cover> {
    let col = column_of(rails);
    let n = col.left.len().min(col.right.len());
    if n < 2 {
        return None;
    }
    let mut quads = vec![];
    for i in 0..n - 1 {
        let pts = [col.left[i], col.left[i + 1], col.right[i + 1], col.right[i]];
        let xs = pts.map(|p| p[0]);
        let ys = pts.map(|p| p[1]);
        quads.push(Quad {
            pts,
            min_x: min4(xs),
            min_y: min4(ys),
            max_x: max4(xs),
            max_y: max4(ys),
        });
    }
    let min_x = quads.iter().fold(f64::INFINITY, |a, q| a.min(q.min_x));
    let min_y = quads.iter().fold(f64::INFINITY, |a, q| a.min(q.min_y));
    let max_x = quads.iter().fold(f64::NEG_INFINITY, |a, q| a.max(q.max_x));
    let max_y = quads.iter().fold(f64::NEG_INFINITY, |a, q| a.max(q.max_y));
    Some(Cover {
        shape: Shape::Quads(quads),
        min_x,
        min_y,
        max_x,
        max_y,
    })
}

/// What a fill covers: its area as sewn.
pub fn fill_cover(r: Region) -> Cover {
    let px = r.px_mm;
    Cover {
        min_x: f64::from(r.x0) * px,
        min_y: f64::from(r.y0) * px,
        max_x: (f64::from(r.x0) + r.w as f64) * px,
        max_y: (f64::from(r.y0) + r.h as f64) * px,
        shape: Shape::Area(r),
    }
}

/// Whether `p` lies under a cover.
fn under(covers: &[&Cover], p: Pt) -> bool {
    covers.iter().any(|c| {
        p[0] >= c.min_x && p[0] <= c.max_x && p[1] >= c.min_y && p[1] <= c.max_y && c.inside(p)
    })
}

fn lerp(a: Pt, b: Pt, t: f64) -> Pt {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// Whether the stitch a to b lies under the covers along its whole length.
fn hidden(covers: &[&Cover], a: Pt, b: Pt) -> bool {
    let n = (dist(a, b) / STEP).ceil().max(1.0) as usize;
    (0..=n).all(|k| under(covers, lerp(a, b, k as f64 / n as f64)))
}

/// Running stitches along `route` (stitches left out, so under the covers), each at most TRAVEL
/// long and hidden under them, from its first point to its last; the first point is not repeated.
fn travel(covers: &[&Cover], route: &[Pt], out: &mut Vec<Pt>) {
    let mut i = 0;
    while i + 1 < route.len() {
        // The farthest point within reach that a hidden stitch gets to (the next one always does).
        let mut j = i + 1;
        let mut k = (route.len() - 1).min(i + REACH);
        while k > i + 1 {
            if dist(route[i], route[k]) <= TRAVEL && hidden(covers, route[i], route[k]) {
                j = k;
                break;
            }
            k -= 1;
        }
        let parts = (dist(route[i], route[j]) / TRAVEL).ceil().max(1.0) as usize;
        for k in 1..=parts {
            out.push(lerp(route[i], route[j], k as f64 / parts as f64));
        }
        i = j;
    }
}

/// The stitches of `run` without those that lie wholly under `covers`, crossed by running stitches
/// hidden under them; the run starts and ends where it did. None when nothing is left out.
pub fn leave_out_covered(run: &[Pt], covers: &[&Cover]) -> Option<Vec<Pt>> {
    if covers.is_empty() || run.len() < 2 {
        return None;
    }
    // Only stitches near a cover can change.
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for &[x, y] in run {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }
    let near: Vec<&Cover> = covers
        .iter()
        .copied()
        .filter(|c| c.min_x <= max_x && c.max_x >= min_x && c.min_y <= max_y && c.max_y >= min_y)
        .collect();
    if near.is_empty() {
        return None;
    }
    let mut out = vec![run[0]];
    let mut route: Option<Vec<Pt>> = None;
    let mut changed = false;
    for i in 1..run.len() {
        let a = run[i - 1];
        let b = run[i];
        if hidden(&near, a, b) {
            route.get_or_insert_with(|| vec![a]).push(b);
            continue;
        }
        if let Some(r) = route.take() {
            travel(&near, &r, &mut out);
            changed |= r.len() > 2;
        }
        out.push(b);
    }
    if let Some(r) = route {
        travel(&near, &r, &mut out);
        changed |= r.len() > 2;
    }
    changed.then_some(out)
}
