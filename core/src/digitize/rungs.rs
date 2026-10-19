//! Rungs (Querlinien) of a satin column: lines across it that set the direction of its stitches.
//! Between two rungs both rails are walked at the same share of their length, so the direction
//! turns evenly from one rung to the next (as in Ink/Stitch's satin column: the rails are cut at
//! the rungs and each section paired by `interpolate(..., normalized=True)`; re-implemented here).
//!
//! A rung is where it meets the two rails: its distance along each of them from their start (mm).
//! The ends of the rails are rungs too, without being listed.
//!
//! Ported from src/digitize/rungs.ts, which keeps the helpers its interface and satinEase call.

use std::cell::OnceCell;
use std::cmp::Ordering;
use std::rc::Rc;

use serde::{Deserialize, Serialize};

use super::satin::Column;
use crate::geom::Pt;
use crate::js::{dist, hypot};
use crate::shape::path::{Form, Node, Path, flatten, set_smooth};

pub type Rung = [f64; 2];
/// A cut line (Trennlinie) drawn across an area: the points it goes through, two for a straight
/// line; between them it bends smoothly (see cut_path).
pub type Cut = Vec<Pt>;
/// A stretch of a closed outline: from distance u0 along it forward to u1 (may wrap round).
pub type Arc = [f64; 2];

/// Rungs closer than this to each other or to the ends (mm along a rail) are not kept apart.
pub const RUNG_GAP: f64 = 0.2;

#[inline]
pub(crate) fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}
#[inline]
pub(crate) fn norm(v: Pt) -> Pt {
    let l = hypot(v[0], v[1]);
    let l = if l == 0.0 || l.is_nan() { 1.0 } else { l };
    [v[0] / l, v[1] / l]
}
#[inline]
pub(crate) fn lerp(a: Pt, b: Pt, t: f64) -> Pt {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}
#[inline]
fn mid(a: Pt, b: Pt) -> Pt {
    [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}
/// A JavaScript sort comparator on numbers: NaN counts as equal, as V8 takes it.
#[inline]
pub(crate) fn by(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

/// A cut line as a path: through its points, the ones between its ends round (as set_smooth makes
/// them). At an end the curve leaves as it arrives at the next point, mirrored about the line
/// between them, so three points on a circle give about that circle.
pub fn cut_path(c: &[Pt]) -> Path {
    let mut f = Form {
        paths: vec![Path {
            closed: false,
            nodes: c
                .iter()
                .map(|&p| Node {
                    p,
                    a: p,
                    b: p,
                    smooth: false,
                })
                .collect(),
        }],
        nonzero: false,
    };
    for i in 1..c.len().saturating_sub(1) {
        f = set_smooth(&f, 0, i, true);
    }
    let mut path = f.paths.swap_remove(0);
    let n = path.nodes.len();
    if n > 2 {
        // The handle of end `e`, with `q` the next node and `h` its handle towards the end.
        let end = |e: Pt, q: Pt, h: Pt| -> Pt {
            let l = dist(e, q);
            let u = norm(sub(e, q));
            let t = norm(sub(h, q));
            let k = 2.0 * (t[0] * u[0] + t[1] * u[1]);
            // t mirrored about the line from q to e, then seen from e (the way back).
            let m = [k * u[0] - t[0], k * u[1] - t[1]];
            [e[0] - m[0] * (l / 3.0), e[1] - m[1] * (l / 3.0)]
        };
        path.nodes[0].b = end(path.nodes[0].p, path.nodes[1].p, path.nodes[1].a);
        path.nodes[n - 1].a = end(
            path.nodes[n - 1].p,
            path.nodes[n - 2].p,
            path.nodes[n - 2].b,
        );
    }
    path
}

/// The line a cut line cuts along: itself when straight, else its curve in points about 0.1 mm apart.
pub fn cut_line(c: &[Pt]) -> Vec<Pt> {
    if c.len() <= 2 {
        return c.to_vec();
    }
    flatten(&cut_path(c), 0.1)
}

/// The straight pieces a cut line cuts along (one for a straight line).
pub fn cut_pieces(c: &[Pt]) -> Vec<[Pt; 2]> {
    let l = cut_line(c);
    l.windows(2).map(|w| [w[0], w[1]]).collect()
}

/// Length along the rail up to each of its points.
pub fn cumulative(rail: &[Pt]) -> Vec<f64> {
    let mut out = Vec::with_capacity(rail.len().max(1));
    out.push(0.0);
    for i in 1..rail.len() {
        out.push(out[i - 1] + dist(rail[i - 1], rail[i]));
    }
    out
}

/// The point at distance `s` along the rail.
pub fn point_at(rail: &[Pt], cum: &[f64], s: f64) -> Pt {
    if s <= 0.0 {
        return rail[0];
    }
    let n = rail.len() - 1;
    if s >= cum[n] {
        return rail[n];
    }
    let (mut lo, mut hi) = (0, n);
    while hi - lo > 1 {
        let m = (lo + hi) >> 1;
        if cum[m] <= s {
            lo = m;
        } else {
            hi = m;
        }
    }
    let l = cum[hi] - cum[lo];
    if l > 0.0 {
        lerp(rail[lo], rail[hi], (s - cum[lo]) / l)
    } else {
        rail[lo]
    }
}

/// Direction of the rail at distance `s`.
fn direction_at(rail: &[Pt], cum: &[f64], s: f64, h: f64) -> Pt {
    norm(sub(point_at(rail, cum, s + h), point_at(rail, cum, s - h)))
}

/// The nearest point of the rail to q: its distance along the rail and from q.
pub fn project(rail: &[Pt], cum: &[f64], q: Pt, from: f64, to: f64) -> (f64, f64) {
    let mut best = (from.max(0.0), f64::INFINITY);
    for i in 1..rail.len() {
        if cum[i] < from || cum[i - 1] > to {
            continue;
        }
        let a = rail[i - 1];
        let v = sub(rail[i], a);
        let l2 = v[0] * v[0] + v[1] * v[1];
        let mut t = if l2 > 0.0 {
            ((q[0] - a[0]) * v[0] + (q[1] - a[1]) * v[1]) / l2
        } else {
            0.0
        };
        t = t.clamp(0.0, 1.0);
        let mut s = cum[i - 1] + t * (cum[i] - cum[i - 1]);
        s = to.min(from.max(s));
        let d = dist(point_at(rail, cum, s), q);
        if d < best.1 {
            best = (s, d);
        }
    }
    best
}

/// A crossing of a line with a rail: distance along the rail and along the line (0 to 1).
#[derive(Clone, Copy, Debug)]
struct Cross {
    s: f64,
    t: f64,
}

/// Where the line from a to b crosses the rail.
fn crossings(rail: &[Pt], cum: &[f64], a: Pt, b: Pt) -> Vec<Cross> {
    let mut out = Vec::new();
    let r = sub(b, a);
    for i in 1..rail.len() {
        let p = rail[i - 1];
        let q = sub(rail[i], p);
        let den = r[0] * q[1] - r[1] * q[0];
        if den.abs() < 1e-12 {
            continue;
        }
        let w = sub(p, a);
        let t = (w[0] * q[1] - w[1] * q[0]) / den;
        let u = (w[0] * r[1] - w[1] * r[0]) / den;
        // A line through a corner of the rail meets it there (rounding can miss both sides).
        if !(0.0..=1.0).contains(&t) || !(-1e-9..=1.0 + 1e-9).contains(&u) {
            continue;
        }
        out.push(Cross {
            s: cum[i - 1] + u.clamp(0.0, 1.0) * (cum[i] - cum[i - 1]),
            t,
        });
    }
    out
}

/// The median of widths as the TypeScript takes it (the upper middle), 0 for none.
pub(crate) fn median_width(mut widths: Vec<f64>) -> f64 {
    widths.sort_by(|a, b| by(*a, *b));
    widths.get(widths.len() >> 1).copied().unwrap_or(0.0)
}

/// The column between the rails with the rungs: each section between two rungs (or a rung and an
/// end) walked on both rails at the same share of its length, a pair every `step` mm or so.
pub fn column_from_rungs(left: &[Pt], right: &[Pt], rungs: &[Rung], step: f64) -> Column {
    let cl = cumulative(left);
    let cr = cumulative(right);
    let la = cl[cl.len() - 1];
    let lb = cr[cr.len() - 1];
    let mut cuts = vec![[0.0, 0.0]];
    cuts.extend(tidy_rungs(rungs, la, lb));
    cuts.push([la, lb]);
    let (mut l, mut r, mut c, mut widths) = (vec![], vec![], vec![], vec![]);
    for k in 0..cuts.len() - 1 {
        let [a0, b0] = cuts[k];
        let [a1, b1] = cuts[k + 1];
        let n = ((a1 - a0).max(b1 - b0) / step).ceil().max(1.0) as usize;
        let last = k + 2 == cuts.len();
        for j in 0..n + usize::from(last) {
            let f = j as f64 / n as f64;
            let a = point_at(left, &cl, a0 + (a1 - a0) * f);
            let b = point_at(right, &cr, b0 + (b1 - b0) * f);
            l.push(a);
            r.push(b);
            c.push(lerp(a, b, 0.5));
            widths.push(dist(a, b));
        }
    }
    Column {
        center: c,
        left: l,
        right: r,
        width: median_width(widths),
    }
}

/// The rungs sorted along the column, without those that cross another or lie on an end.
pub fn tidy_rungs(rungs: &[Rung], la: f64, lb: f64) -> Vec<Rung> {
    let mut sorted: Vec<Rung> = rungs
        .iter()
        .copied()
        .filter(|r| r[0].is_finite() && r[1].is_finite())
        .collect();
    sorted.sort_by(|x, y| by(x[0], y[0]));
    let mut out = vec![];
    let (mut pa, mut pb) = (0.0, 0.0);
    for [a, b] in sorted {
        if a < pa + RUNG_GAP || b < pb + RUNG_GAP || a > la - RUNG_GAP || b > lb - RUNG_GAP {
            continue;
        }
        out.push([a, b]);
        pa = a;
        pb = b;
    }
    out
}

/// Rungs that give about the directions the column has now (one pair of penetrations per stitch,
/// `left[k]` with `right[k]`): rungs are added where interpolating between the ones there would
/// turn a stitch by more than `max_deg` (as a line is simplified, by its worst point), but not
/// closer together than about three column widths.
pub fn seed_rungs(left: &[Pt], right: &[Pt], max_deg: f64) -> Vec<Rung> {
    let n = left.len().min(right.len());
    if n < 3 {
        return vec![];
    }
    let cl = cumulative(left);
    let cr = cumulative(right);
    let mut keep = vec![false; n];
    let limit = (max_deg * std::f64::consts::PI / 180.0).tan();
    let mut stack = vec![(0, n - 1)];
    while let Some((i, j)) = stack.pop() {
        if j - i < 2 {
            continue;
        }
        // Not closer than about three column widths: the direction cannot turn much faster than that anyway.
        let w = (dist(left[i], right[i]) + dist(left[j], right[j])) / 2.0;
        if cl[j] - cl[i] < 3.0 * w && cr[j] - cr[i] < 3.0 * w {
            continue;
        }
        let da = cl[j] - cl[i];
        let db = cr[j] - cr[i];
        let mut worst = None;
        let mut worst_err = limit;
        for k in i + 1..j {
            // Only a pair that lies between its neighbours on both rails can be a rung.
            if cl[k] <= cl[i] || cl[k] >= cl[j] || cr[k] <= cr[i] || cr[k] >= cr[j] {
                continue;
            }
            let f = if da > 0.0 { (cl[k] - cl[i]) / da } else { 0.5 };
            let want = point_at(right, &cr, cr[i] + f * db);
            let w = dist(left[k], right[k]).max(0.3);
            let err = dist(want, right[k]) / w;
            if err > worst_err {
                worst_err = err;
                worst = Some(k);
            }
        }
        let Some(worst) = worst else { continue };
        keep[worst] = true;
        stack.push((i, worst));
        stack.push((worst, j));
    }
    let kept: Vec<Rung> = (0..n)
        .filter(|&k| keep[k])
        .map(|k| [cl[k], cr[k]])
        .collect();
    tidy_rungs(&kept, cl[cl.len() - 1], cr[cr.len() - 1])
}

/// A rung along the line from a to b (drawn across the column): where it crosses the two rails,
/// or None when it does not cross both. The line counts longer than drawn (the crossings nearest
/// its middle are taken).
pub fn rung_from_line(left: &[Pt], right: &[Pt], a: Pt, b: Pt) -> Option<Rung> {
    let d = sub(b, a);
    // A short line drawn inside the column reaches out to the rails, up to 10 mm on.
    let ext = (10.0 / hypot(d[0], d[1]).max(0.1)).max(0.25);
    let a2 = [a[0] - d[0] * ext, a[1] - d[1] * ext];
    let b2 = [b[0] + d[0] * ext, b[1] + d[1] * ext];
    let near = |xs: Vec<Cross>| {
        xs.into_iter()
            .reduce(|x, y| {
                if (y.t - 0.5).abs() < (x.t - 0.5).abs() {
                    y
                } else {
                    x
                }
            })
            .map(|x| x.s)
    };
    let sa = near(crossings(left, &cumulative(left), a2, b2))?;
    let sb = near(crossings(right, &cumulative(right), a2, b2))?;
    Some([sa, sb])
}

/// The rungs with `r` added, or None when it would cross one of them or lie on an end.
pub fn add_rung(rungs: &[Rung], r: Rung, la: f64, lb: f64) -> Option<Vec<Rung>> {
    let mut all = rungs.to_vec();
    all.push(r);
    all.sort_by(|x, y| by(x[0], y[0]));
    let tidy = tidy_rungs(&all, la, lb);
    (tidy.len() == rungs.len() + 1).then_some(tidy)
}

/// The rails walked from the other end, sides swapped, with their rungs.
pub fn reversed_rungs(rungs: &[Rung], la: f64, lb: f64) -> Vec<Rung> {
    rungs.iter().rev().map(|&[a, b]| [lb - b, la - a]).collect()
}

#[derive(Clone, Copy)]
struct RailCorner {
    s: f64,
    turn: f64,
    dir: Pt,
    out: Pt,
}

/// Corners of a rail: distances along it where it turns by more than `min_deg` within `h` mm on both sides.
fn rail_corners(rail: &[Pt], cum: &[f64], h: f64, min_deg: f64) -> Vec<RailCorner> {
    let len = cum[cum.len() - 1];
    let mut found = vec![];
    let step = (h / 4.0).max(0.1);
    let mut prev = 0.0;
    let mut rising: Option<RailCorner> = None;
    let mut s = h;
    while s <= len - h {
        let p = point_at(rail, cum, s);
        let din = norm(sub(p, point_at(rail, cum, s - h)));
        let dout = norm(sub(point_at(rail, cum, s + h), p));
        let turn = (din[0] * dout[0] + din[1] * dout[1])
            .clamp(-1.0, 1.0)
            .acos()
            * 180.0
            / std::f64::consts::PI;
        if turn > min_deg && turn >= prev {
            rising = Some(RailCorner {
                s,
                turn,
                dir: din,
                out: dout,
            });
        } else if turn < prev
            && let Some(r) = rising.take()
        {
            found.push(r);
        }
        prev = turn;
        s += step;
    }
    if let Some(r) = rising {
        found.push(r);
    }
    found
}

#[derive(Clone, Copy)]
struct Corner {
    rung: Rung,
    turn: f64,
}

/// The corners of a column turning by `min_deg` or more: a rung along each one's bisector, along the column.
fn corners_of(left: &[Pt], right: &[Pt], rungs: &[Rung], min_deg: f64) -> (Vec<Corner>, f64) {
    let cl = cumulative(left);
    let cr = cumulative(right);
    let col = column_from_rungs(left, right, rungs, 0.2);
    let w = col.width.max(0.5);
    let h = (w * 0.6).max(0.4);
    let mut corners = vec![];
    for side in 0..2 {
        let (rail, cum, other, ocum) = if side == 0 {
            (left, &cl, right, &cr)
        } else {
            (right, &cr, left, &cl)
        };
        for c in rail_corners(rail, cum, h, min_deg) {
            let v = point_at(rail, cum, c.s);
            let bis = norm(sub(c.dir, c.out));
            let mut best: Option<(f64, f64)> = None;
            for sign in [1.0, -1.0] {
                let far = [
                    v[0] + bis[0] * sign * w * 3.0,
                    v[1] + bis[1] * sign * w * 3.0,
                ];
                for x in crossings(other, ocum, v, far) {
                    let d = x.t * w * 3.0;
                    if d > 0.05 && best.is_none_or(|b| d < b.1) {
                        best = Some((x.s, d));
                    }
                }
            }
            let Some(best) = best else { continue };
            corners.push(Corner {
                rung: if side == 0 {
                    [c.s, best.0]
                } else {
                    [best.0, c.s]
                },
                turn: c.turn,
            });
        }
    }
    // The same corner seen from both rails: the sharper one counts.
    corners.sort_by(|a, b| by(b.turn, a.turn));
    let mut chosen: Vec<Corner> = vec![];
    for c in corners {
        let p = point_at(left, &cl, c.rung[0]);
        if chosen
            .iter()
            .any(|x| dist(point_at(left, &cl, x.rung[0]), p) < w * 1.5)
        {
            continue;
        }
        chosen.push(c);
    }
    chosen.sort_by(|a, b| by(a.rung[0], b.rung[0]));
    (chosen, w)
}

/// Cut lines at the sharp corners of a column (turning by `min_deg` or more), along their bisectors:
/// sewn in sections there, each side ends in a clean mitre instead of fanning round the corner.
pub fn corner_cuts(left: &[Pt], right: &[Pt], rungs: &[Rung], min_deg: f64) -> Vec<Rung> {
    corners_of(left, right, rungs, min_deg)
        .0
        .into_iter()
        .map(|c| c.rung)
        .collect()
}

/// Rungs for the corners of the column, so the stitches fan around them instead of piling up: a
/// rung along each corner's bisector (inner corner to outer corner) and one about a column width
/// before and after it, square to the rails. Rungs that were in the way are dropped; the others stay.
pub fn corner_rungs(left: &[Pt], right: &[Pt], rungs: &[Rung], min_deg: f64) -> Vec<Rung> {
    let cl = cumulative(left);
    let cr = cumulative(right);
    let la = cl[cl.len() - 1];
    let lb = cr[cr.len() - 1];
    let (chosen, w) = corners_of(left, right, rungs, min_deg);
    let mut out = rungs.to_vec();
    for c in chosen {
        let [ca, cb] = c.rung;
        // Square rungs a column width before and after, measured on the rail with the shorter way round.
        let before = square(left, &cl, right, &cr, ca, cb, -1.0, w);
        let after = square(left, &cl, right, &cr, ca, cb, 1.0, w);
        let lo = before.unwrap_or([ca, cb]);
        let hi = after.unwrap_or([ca, cb]);
        out.retain(|&[a, b]| {
            !((a >= lo[0] - RUNG_GAP && a <= hi[0] + RUNG_GAP)
                || (b >= lo[1] - RUNG_GAP && b <= hi[1] + RUNG_GAP))
        });
        for r in [before, Some(c.rung), after].into_iter().flatten() {
            if let Some(next) = add_rung(&out, r, la, lb) {
                out = next;
            }
        }
    }
    out
}

/// A rung square to the rails `w` mm before (dir -1) or after (dir 1) the rung (ca, cb), or None.
fn square(
    left: &[Pt],
    cl: &[f64],
    right: &[Pt],
    cr: &[f64],
    ca: f64,
    cb: f64,
    dir: f64,
    w: f64,
) -> Option<Rung> {
    let la = cl[cl.len() - 1];
    let lb = cr[cr.len() - 1];
    // On the inner rail (the shorter way round the corner) the distance is closest to the column's own.
    let try_on = |on_left: bool| -> Option<Rung> {
        let (rail, cum, len, s0, other, ocum, o0) = if on_left {
            (left, cl, la, ca, right, cr, cb)
        } else {
            (right, cr, lb, cb, left, cl, ca)
        };
        let s = s0 + dir * w;
        if s <= RUNG_GAP || s >= len - RUNG_GAP {
            return None;
        }
        let q = point_at(rail, cum, s);
        let t = direction_at(rail, cum, s, 0.3);
        // The rail on the other side, straight across from q.
        let n = [-t[1], t[0]];
        let mut best: Option<f64> = None;
        let mut best_d = f64::INFINITY;
        for sign in [1.0, -1.0] {
            let far = [q[0] + n[0] * sign * w * 3.0, q[1] + n[1] * sign * w * 3.0];
            for x in crossings(other, ocum, q, far) {
                if (x.s - o0) * dir <= 0.0 {
                    continue;
                }
                if x.t < best_d {
                    best_d = x.t;
                    best = Some(x.s);
                }
            }
        }
        let best = best.unwrap_or_else(|| {
            if dir > 0.0 {
                project(other, ocum, q, o0, f64::INFINITY).0
            } else {
                project(other, ocum, q, 0.0, o0).0
            }
        });
        Some(if on_left { [s, best] } else { [best, s] })
    };
    match (try_on(true), try_on(false)) {
        // The one whose other end moved less from the corner rung: it lies on the outer rail.
        (Some(a), Some(b)) => Some(if (a[1] - cb).abs() <= (b[0] - ca).abs() {
            a
        } else {
            b
        }),
        (a, b) => a.or(b),
    }
}

/// Rails of a column with its rungs (a strip of an outline).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Strip {
    pub left: Vec<Pt>,
    pub right: Vec<Pt>,
    pub rungs: Vec<Rung>,
    /// How much longer the longer rail is, where the strip was just made from an outline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ratio: Option<f64>,
}

/// The outline from `u0` on for `len` mm: the point there, the outline's own points on the way, the end.
fn walk(
    ring: &[Pt],
    cum: &[f64],
    total: f64,
    u0: f64,
    len: f64,
    fwd: impl Fn(f64, f64) -> f64,
) -> Vec<Pt> {
    let mut inner: Vec<(f64, Pt)> = vec![];
    for i in 0..ring.len() - 1 {
        let u = fwd(u0, cum[i]);
        if u > 1e-6 && u < len - 1e-6 {
            inner.push((u, ring[i]));
        }
    }
    inner.sort_by(|x, y| by(x.0, y.0));
    let mut out = vec![point_at(ring, cum, u0)];
    out.extend(inner.into_iter().map(|x| x.1));
    out.push(point_at(ring, cum, (u0 + len) % total));
    dedupe(out)
}

/// Points without those on the one before.
fn dedupe(out: Vec<Pt>) -> Vec<Pt> {
    let mut kept: Vec<Pt> = Vec::with_capacity(out.len());
    for (i, &p) in out.iter().enumerate() {
        if i == 0 || dist(p, out[i - 1]) > 1e-6 {
            kept.push(p);
        }
    }
    kept
}

/// The order round an outline in which the rungs' ends come 1, 2 … n on one side and n … 2, 1 on
/// the other: the index in `ends` of the first one, or None when they do not.
fn strip_start(ends: &[(f64, usize)], n: usize) -> Option<usize> {
    let m = ends.len();
    (0..m).find(|&r| {
        (0..n).all(|i| {
            let (x, y) = ((r + i) % m, (r + m - 1 - i) % m);
            ends[x].1 == ends[y].1 && x != y
        })
    })
}

/// Rails of a satin column for a shape (its outline, a closed line) cut across by rungs drawn on
/// it: each rung meets the outline twice; going round the outline the ends must come in the
/// order 1, 2 … n on one side and n … 2, 1 on the other (the rungs cut the shape into a strip).
/// Beyond the first and the last rung the rails meet in the middle of the outline there (the shape
/// has to end soon after them). Returns None when the rungs do not cut the shape into a strip.
pub fn rails_from_outline(lp: &[Pt], lines: &[[Pt; 2]]) -> Option<Strip> {
    let n = lines.len();
    if n < 2 || lp.len() < 4 {
        return None;
    }
    let ring = closed(lp);
    let cum = cumulative(&ring);
    let total = cum[cum.len() - 1];
    if total <= 0.0 {
        return None;
    }
    // Each rung's two meeting points with the outline: the crossings nearest its two ends.
    let mut ends: Vec<(f64, usize)> = vec![];
    for (k, &[a, b]) in lines.iter().enumerate() {
        let d = sub(b, a);
        let mut xs = crossings(
            &ring,
            &cum,
            [a[0] - d[0] * 0.25, a[1] - d[1] * 0.25],
            [b[0] + d[0] * 0.25, b[1] + d[1] * 0.25],
        );
        if xs.len() < 2 {
            return None;
        }
        xs.sort_by(|x, y| by(x.t, y.t));
        ends.push((xs[0].s % total, k));
        ends.push((xs[xs.len() - 1].s % total, k));
    }
    ends.sort_by(|x, y| by(x.0, y.0));
    let m = ends.len();
    let start = strip_start(&ends, n)?;
    let at = |i: usize| ends[(start + i) % m].0;
    let fwd = |u0: f64, u1: f64| (u1 - u0 + total) % total;
    // Beyond the first and the last rung the shape has to end soon (a round or pointed end), not go on.
    let cap_len = |u0: f64, u1: f64| {
        fwd(u0, u1) <= 4.0 * dist(point_at(&ring, &cum, u0), point_at(&ring, &cum, u1)) + 2.0
    };
    if !cap_len(at(m - 1), at(0)) || !cap_len(at(n - 1), at(n)) {
        return None;
    }
    let cap_a = (at(m - 1) + fwd(at(m - 1), at(0)) / 2.0) % total;
    let cap_b = (at(n - 1) + fwd(at(n - 1), at(n)) / 2.0) % total;
    let len_a = fwd(cap_a, cap_b);
    let left = walk(&ring, &cum, total, cap_a, len_a, fwd);
    let mut right = walk(&ring, &cum, total, cap_b, fwd(cap_b, cap_a), fwd);
    right.reverse();
    if left.len() < 2 || right.len() < 2 {
        return None;
    }
    let rungs: Vec<Rung> = (0..n)
        .map(|i| [fwd(cap_a, at(i)), fwd(at(m - 1 - i), cap_a)])
        .collect();
    let tidy = tidy_rungs(&rungs, last(&cumulative(&left)), last(&cumulative(&right)));
    Some(Strip {
        left,
        right,
        rungs: tidy,
        ratio: None,
    })
}

fn last(v: &[f64]) -> f64 {
    v[v.len() - 1]
}

/// A closed outline with its first point repeated at the end.
fn closed(r: &[Pt]) -> Vec<Pt> {
    let mut v = r.to_vec();
    if dist(r[0], r[r.len() - 1]) >= 1e-9 {
        v.push(r[0]);
    }
    v
}

/// A cap that fits beyond a rung, and the far end as sewn when it is the edge farthest out.
type CapChoice = (Arc, Option<Arc>);

/// A strip of an outline (see strip_of_loop): its rails, rungs and how much longer the longer rail is.
#[derive(Clone, Debug, Serialize)]
pub struct LoopStrip {
    pub left: Vec<Pt>,
    pub right: Vec<Pt>,
    pub rungs: Vec<Rung>,
    pub ratio: f64,
}

/// A satin column for a closed outline (first point repeated at the end) cut across by rungs, each
/// given by the two places it meets the outline (distances along it). As in rails_from_outline the
/// rungs must cut the outline into a strip. Beyond the first and the last rung the column ends on
/// one of `caps` lying there (the one that leaves the two rails most alike in length), or where
/// none lies, in a point in the middle when the outline ends soon after the rung. This is how a
/// satin section finds its own rails: a cut line it does not end on becomes part of a rail. With
/// `far` the outline may go on any length beyond the rung (a part of a fill: its end is the edge
/// farthest out, the rails checked by `ratio`).
pub fn strip_of_loop(
    ring: &[Pt],
    chords: &[[f64; 2]],
    caps: &[Arc],
    far: bool,
) -> Option<LoopStrip> {
    strip_of_ring(ring, &cumulative(ring), chords, caps, far)
}

fn strip_of_ring(
    ring: &[Pt],
    cum: &[f64],
    chords: &[[f64; 2]],
    caps: &[Arc],
    far: bool,
) -> Option<LoopStrip> {
    let n = chords.len();
    if n == 0 || ring.len() < 4 {
        return None;
    }
    let total = cum[cum.len() - 1];
    if total <= 0.0 {
        return None;
    }
    let fwd = |u0: f64, u1: f64| (((u1 - u0) % total) + total) % total;
    let mut ends: Vec<(f64, usize)> = vec![];
    for (k, &[a, b]) in chords.iter().enumerate() {
        ends.push((fwd(0.0, a), k));
        ends.push((fwd(0.0, b), k));
    }
    ends.sort_by(|x, y| by(x.0, y.0));
    let m = ends.len();
    let start = strip_start(&ends, n)?;
    let at = |i: usize| ends[(start + i) % m].0;
    // The caps that fit beyond a rung: in the stretch of outline from u0 on for len mm, each with
    // the far end as it is sewn when it was chosen as the edge farthest out.
    let fitting = |u0: f64, len: f64| -> Vec<(Arc, Option<Arc>)> {
        let mut out: Vec<(Arc, Option<Arc>)> = caps
            .iter()
            .filter(|&&[c0, c1]| {
                let mut x0 = fwd(u0, c0);
                if x0 > total - 1e-6 {
                    x0 = 0.0;
                }
                let x1 = x0 + fwd(c0, c1);
                x1 <= len + 1e-6
            })
            .map(|&c| (c, None))
            .collect();
        // On a part of a fill the edge farthest out competes with the cut lines: a cut line along the
        // side of a part (into a hole, say) is no end of it.
        if !out.is_empty() && !far {
            return out;
        }
        let a = point_at(ring, cum, u0);
        let b = point_at(ring, cum, (u0 + len) % total);
        if !far && len > 4.0 * dist(a, b) + 2.0 {
            return out;
        }
        // The end is the stretch farthest beyond the rung: a square end its edge, a round or pointed one its tip.
        let n = ((len / 0.05).ceil() as usize).max(2);
        let t = norm(sub(b, a));
        let beyond = |u: f64| {
            let q = sub(point_at(ring, cum, (u0 + u) % total), a);
            (q[0] * t[1] - q[1] * t[0]).abs()
        };
        let d: Vec<f64> = (0..=n).map(|k| beyond(len * k as f64 / n as f64)).collect();
        let most = d.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        // The stretch round the farthest point that stays this far out (not beyond a dip, such as a
        // cut line into a hole on the way).
        let top = d.iter().position(|&x| x == most).unwrap_or(usize::MAX);
        let stretch = |near: f64| -> Arc {
            if top == usize::MAX {
                // No farthest point (NaN): as the TypeScript, which indexes -1.
                return [f64::NAN, f64::NAN];
            }
            let (mut first, mut lst) = (top, top);
            while first > 0 && d[first - 1] >= near {
                first -= 1;
            }
            while lst < n && d[lst + 1] >= near {
                lst += 1;
            }
            [
                (u0 + len * first as f64 / n as f64) % total,
                (u0 + len * lst as f64 / n as f64) % total,
            ]
        };
        // Chosen among the caps as wide as an edge drawn slightly askew, sewn as narrow as a few tenths:
        // on a long part 5 % eats into its sides round the corners, the rails would stop short of its end.
        let wide = stretch(most - (most * 0.05).max(0.1));
        // Only where it bends round a corner into the sides: a straight edge stays as it is.
        let along = fwd(wide[0], wide[1]);
        // A cut line right at the end (into a hole, say) keeps it as it is, the satin turns there.
        let close = |x: f64, y: f64| fwd(x, y).min(fwd(y, x)) < 0.6;
        let by_cut = caps.iter().any(|&[c0, c1]| {
            [c0, c1]
                .iter()
                .any(|&c| close(c, wide[0]) || close(c, wide[1]))
        });
        let tight = (!by_cut
            && along
                > dist(point_at(ring, cum, wide[0]), point_at(ring, cum, wide[1])) * 1.05 + 0.05)
            .then(|| stretch(most - (most * 0.05).clamp(0.1, 0.15)));
        out.push((wide, tight));
        out
    };
    let caps_a = fitting(at(m - 1), fwd(at(m - 1), at(0)));
    let caps_b = fitting(at(n - 1), fwd(at(n - 1), at(n)));
    let mut best: Option<(CapChoice, CapChoice, f64)> = None;
    for &ca in &caps_a {
        for &cb in &caps_b {
            let l = fwd(ca.0[1], cb.0[0]);
            let r = fwd(cb.0[1], ca.0[0]);
            if l <= 1e-6 || r <= 1e-6 {
                continue;
            }
            let ratio = l.max(r) / l.min(r);
            if best.is_none_or(|b| ratio < b.2) {
                best = Some((ca, cb, ratio));
            }
        }
    }
    let (ca, cb, ratio) = best?;
    let ca = ca.1.unwrap_or(ca.0);
    let cb = cb.1.unwrap_or(cb.0);
    let l = fwd(ca[1], cb[0]);
    let r = fwd(cb[1], ca[0]);
    let left = walk(ring, cum, total, ca[1], l, fwd);
    let mut right = walk(ring, cum, total, cb[1], r, fwd);
    right.reverse();
    if left.len() < 2 || right.len() < 2 {
        return None;
    }
    let rungs: Vec<Rung> = (0..n)
        .map(|i| [fwd(ca[1], at(i)), fwd(at(m - 1 - i), ca[0])])
        .collect();
    let rungs = tidy_rungs(&rungs, last(&cumulative(&left)), last(&cumulative(&right)));
    Some(LoopStrip {
        left,
        right,
        rungs,
        ratio,
    })
}

/// Whether q lies inside the closed outline (even-odd).
pub fn inside(ring: &[Pt], q: Pt) -> bool {
    let mut c = false;
    let mut j = ring.len().wrapping_sub(1);
    for i in 0..ring.len() {
        let [xi, yi] = ring[i];
        let [xj, yj] = ring[j];
        if (yi > q[1]) != (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi {
            c = !c;
        }
        j = i;
    }
    c
}

/// Height of the bands the edges of an outline are sorted into for InsideTest (mm).
const BAND: f64 = 0.5;

/// Whether points lie inside a closed outline, as `inside`, for many points: the edges are sorted
/// into bands across the outline once, so each point looks only at the edges of its band.
pub struct InsideTest {
    ring: Vec<Pt>,
    y0: f64,
    bands: Vec<Vec<u32>>,
}

impl InsideTest {
    pub fn new(ring: &[Pt]) -> InsideTest {
        let (mut y0, mut y1) = (f64::INFINITY, f64::NEG_INFINITY);
        for p in ring {
            y0 = y0.min(p[1]);
            y1 = y1.max(p[1]);
        }
        let n = (((y1 - y0) / BAND).ceil() + 1.0).max(1.0) as usize;
        let mut bands = vec![vec![]; n];
        let mut j = ring.len().wrapping_sub(1);
        for i in 0..ring.len() {
            let lo = ((ring[i][1].min(ring[j][1]) - y0) / BAND).floor() as usize;
            let hi = ((ring[i][1].max(ring[j][1]) - y0) / BAND).floor() as usize;
            for b in &mut bands[lo..=hi.min(n - 1)] {
                b.push(i as u32);
            }
            j = i;
        }
        InsideTest {
            ring: ring.to_vec(),
            y0,
            bands,
        }
    }

    pub fn test(&self, q: Pt) -> bool {
        let b = ((q[1] - self.y0) / BAND).floor();
        if !(b >= 0.0 && b < self.bands.len() as f64) {
            return false;
        }
        let ring = &self.ring;
        let mut c = false;
        for &i in &self.bands[b as usize] {
            let i = i as usize;
            let j = if i == 0 { ring.len() - 1 } else { i - 1 };
            let [xi, yi] = ring[i];
            let [xj, yj] = ring[j];
            if (yi > q[1]) != (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi {
                c = !c;
            }
        }
        c
    }
}

/// A closed outline with what is found once about it: its lengths and its inside test.
pub struct Ring {
    pub pts: Vec<Pt>,
    pub cum: Vec<f64>,
    inside: OnceCell<InsideTest>,
}

impl Ring {
    pub fn new(pts: Vec<Pt>) -> Rc<Ring> {
        let cum = cumulative(&pts);
        Rc::new(Ring {
            pts,
            cum,
            inside: OnceCell::new(),
        })
    }
    pub fn contains(&self, q: Pt) -> bool {
        self.inside
            .get_or_init(|| InsideTest::new(&self.pts))
            .test(q)
    }
}

/// Where a line drawn inside a closed outline meets it: going out from the line's middle both ways,
/// the first crossing each side (distances along the outline). None when the middle is outside.
pub fn chord_of(ring: &[Pt], a: Pt, b: Pt) -> Option<[f64; 2]> {
    if !inside(ring, lerp(a, b, 0.5)) {
        return None;
    }
    chord_across(ring, &cumulative(ring), a, b)
}

fn chord_in(ring: &Ring, a: Pt, b: Pt) -> Option<[f64; 2]> {
    if !ring.contains(lerp(a, b, 0.5)) {
        return None;
    }
    chord_across(&ring.pts, &ring.cum, a, b)
}

fn chord_across(ring: &[Pt], cum: &[f64], a: Pt, b: Pt) -> Option<[f64; 2]> {
    let d = sub(b, a);
    let len = hypot(d[0], d[1]);
    if len < 1e-9 {
        return None;
    }
    let ext = (10.0 / len).max(0.25);
    let xs = crossings(
        ring,
        cum,
        [a[0] - d[0] * ext, a[1] - d[1] * ext],
        [b[0] + d[0] * ext, b[1] + d[1] * ext],
    );
    // t along the extended line; the middle of the drawn line is at 0.5.
    let mut lo: Option<Cross> = None;
    let mut hi: Option<Cross> = None;
    for x in xs {
        if x.t < 0.5 && lo.is_none_or(|l| x.t > l.t) {
            lo = Some(x);
        }
        if x.t > 0.5 && hi.is_none_or(|h| x.t < h.t) {
            hi = Some(x);
        }
    }
    Some([lo?.s, hi?.s])
}

/// Twice the signed area of a closed outline (its sign tells which way round it goes).
fn signed_area(ring: &[Pt]) -> f64 {
    let mut a = 0.0;
    for i in 1..ring.len() {
        a += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
    }
    a
}

fn sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x
    }
}

/// A closed outline walked once round from distance u along it, back to that point.
fn rotated(ring: &[Pt], u: f64, cum: &[f64]) -> Vec<Pt> {
    let total = cum[cum.len() - 1];
    let fwd = |b: f64| (((b - u) % total) + total) % total;
    let mut inner: Vec<(f64, Pt)> = vec![];
    for i in 0..ring.len() - 1 {
        let x = fwd(cum[i]);
        if x > 1e-6 && x < total - 1e-6 {
            inner.push((x, ring[i]));
        }
    }
    inner.sort_by(|a, b| by(a.0, b.0));
    let at = point_at(ring, cum, u);
    let mut out = vec![at];
    out.extend(inner.into_iter().map(|x| x.1));
    out.push(at);
    out
}

/// The point halfway along a line; None for one without length.
pub fn mid_of(line: &[Pt]) -> Option<Pt> {
    let c = cumulative(line);
    let len = c[c.len() - 1];
    (line.len() >= 2 && len > 1e-9).then(|| point_at(line, &c, len / 2.0))
}

/// A line as far as it reaches when it cuts: taken on straight beyond both ends, a quarter of its
/// length or 10 mm, whichever is more (see chord_of). None for a line without length.
pub fn reach_of(line: &[Pt]) -> Option<Vec<Pt>> {
    let n = line.len();
    let lc = cumulative(line);
    let len = lc[n - 1];
    if n < 2 || len < 1e-9 {
        return None;
    }
    // A straight line as one piece from end to end, so it cuts exactly as before bent lines were known.
    if n == 2 {
        let [a, b] = [line[0], line[1]];
        let d = sub(b, a);
        let ext = (10.0 / len).max(0.25);
        return Some(vec![
            [a[0] - d[0] * ext, a[1] - d[1] * ext],
            [b[0] + d[0] * ext, b[1] + d[1] * ext],
        ]);
    }
    let e = (0.25 * len).max(10.0);
    let d0 = norm(sub(line[0], line[1]));
    let d1 = norm(sub(line[n - 1], line[n - 2]));
    let mut out = vec![[line[0][0] + d0[0] * e, line[0][1] + d0[1] * e]];
    out.extend_from_slice(line);
    out.push([line[n - 1][0] + d1[0] * e, line[n - 1][1] + d1[1] * e]);
    Some(out)
}

struct Hit {
    ring: usize,
    s: f64,
    at: f64,
}

/// A line drawn across outlines (`rings`) taken on beyond its ends (straight on, as far as a
/// straight line, see chord_of): going out from its middle both ways, the first crossing each side,
/// and the line's own points between them.
fn outward(line: &[Pt], rings: &[&Ring]) -> Option<(Hit, Hit, Vec<Pt>)> {
    let path = reach_of(line)?;
    let pc = cumulative(&path);
    let middle = pc[pc.len() - 1] / 2.0;
    let mut lo: Option<Hit> = None;
    let mut hi: Option<Hit> = None;
    for (ring, r) in rings.iter().enumerate() {
        for i in 1..path.len() {
            for x in crossings(&r.pts, &r.cum, path[i - 1], path[i]) {
                let at = pc[i - 1] + x.t * (pc[i] - pc[i - 1]);
                if at < middle && lo.as_ref().is_none_or(|l| at > l.at) {
                    lo = Some(Hit { ring, s: x.s, at });
                }
                if at > middle && hi.as_ref().is_none_or(|h| at < h.at) {
                    hi = Some(Hit { ring, s: x.s, at });
                }
            }
        }
    }
    let (l, h) = (lo?, hi?);
    // The points of the line strictly between the two crossings (not on them).
    let inner = path
        .iter()
        .enumerate()
        .filter(|&(i, _)| pc[i] > l.at + 1e-6 && pc[i] < h.at - 1e-6)
        .map(|(_, &p)| p)
        .collect();
    Some((l, h, inner))
}

/// Where a cut line (straight or bent) drawn inside a closed outline meets it, as chord_of, and its points in between.
fn cut_of(ring: &Ring, line: &[Pt]) -> Option<(f64, f64, Vec<Pt>)> {
    if line.len() == 2 {
        let c = chord_in(ring, line[0], line[1])?;
        return Some((c[0], c[1], vec![]));
    }
    let m = mid_of(line)?;
    if !ring.contains(m) {
        return None;
    }
    let (l, h, inner) = outward(line, &[ring])?;
    Some((l.s, h.s, inner))
}

/// Whether a cut line (straight or bent) is drawn across a closed outline (its middle inside, both ways out of it).
pub fn cut_across(ring: &[Pt], c: &[Pt]) -> bool {
    cut_of(&Ring::new(ring.to_vec()), &cut_line(c)).is_some()
}

/// A closed outline cut in two by the line from distance u to v along it (both closed again):
/// straight across, or through `inner`, the points of a bent line from u to v.
fn split_ring(ring: &[Pt], u: f64, v: f64, cum: &[f64], inner: &[Pt]) -> [Vec<Pt>; 2] {
    let total = cum[cum.len() - 1];
    let fwd = |a: f64, b: f64| (((b - a) % total) + total) % total;
    let arc = |u0: f64, u1: f64, via: Vec<Pt>| -> Vec<Pt> {
        let len = fwd(u0, u1);
        let mut inner: Vec<(f64, Pt)> = vec![];
        for i in 0..ring.len() - 1 {
            let x = fwd(u0, cum[i]);
            if x > 1e-6 && x < len - 1e-6 {
                inner.push((x, ring[i]));
            }
        }
        inner.sort_by(|a, b| by(a.0, b.0));
        let mut out = vec![point_at(ring, cum, u0)];
        out.extend(inner.into_iter().map(|x| x.1));
        out.push(point_at(ring, cum, u1));
        let mut kept = dedupe(out);
        let first = kept[0];
        kept.extend(via);
        kept.push(first);
        kept
    };
    let back: Vec<Pt> = inner.iter().rev().copied().collect();
    [arc(u, v, back), arc(v, u, inner.to_vec())]
}

/// A closed outline cut into parts by cut lines (see parts_of): what strips_of_parts works from.
pub struct Parts {
    /// The outlines of the parts (closed).
    pub parts: Vec<Rc<Ring>>,
    /// The cut lines as they cut: each an edge of the parts it made (two points, or more where it bends).
    pub edges: Vec<Vec<Pt>>,
    /// Holes no cut line from the edge has opened yet, and which of the holes given each is.
    pub open: Vec<Rc<Ring>>,
    pub which: Vec<usize>,
}

/// A cut line from the edge into a hole, when `line` is one: the hole opened, its outline now part of the edge.
fn open_hole(p: &mut Parts, line: &[Pt]) -> bool {
    // Going out from the line's middle both ways, the first crossing one side on the part's outline
    // and the other on a hole's.
    let Some(m) = mid_of(line) else { return false };
    if p.open.iter().any(|h| inside(&h.pts, m)) {
        return false;
    }
    let Some(k) = p.parts.iter().position(|r| inside(&r.pts, m)) else {
        return false;
    };
    let rings: Vec<&Ring> = std::iter::once(&*p.parts[k])
        .chain(p.open.iter().map(|h| &**h))
        .collect();
    let Some((lo, hi, inner)) = outward(line, &rings) else {
        return false;
    };
    let (u, h, v, inner) = if lo.ring == 0 && hi.ring > 0 {
        (lo.s, hi.ring - 1, hi.s, inner)
    } else if hi.ring == 0 && lo.ring > 0 {
        (hi.s, lo.ring - 1, lo.s, inner.into_iter().rev().collect())
    } else {
        return false;
    };
    let ring = p.parts[k].clone();
    let hole = p.open[h].clone();
    let pp = point_at(&ring.pts, &ring.cum, u);
    let q = point_at(&hole.pts, &hole.cum, v);
    let mut around = rotated(&hole.pts, v, &hole.cum);
    // Round the hole the other way than round the edge, so the outline stays one simple loop.
    if sign(signed_area(&around)) == sign(signed_area(&ring.pts)) {
        around.reverse();
    }
    let mut out = rotated(&ring.pts, u, &ring.cum);
    out.extend_from_slice(&inner);
    out.extend(around);
    out.extend(inner.iter().rev());
    out.push(pp);
    p.parts[k] = Ring::new(out);
    let mut edge = vec![pp];
    edge.extend_from_slice(&inner);
    edge.push(q);
    p.edges.push(edge);
    p.open.remove(h);
    p.which.remove(h);
    true
}

/// The part the line is drawn across cut in two along it; false when it is drawn across none.
fn cut_part(p: &mut Parts, line: &[Pt]) -> bool {
    for k in 0..p.parts.len() {
        let ring = p.parts[k].clone();
        let Some((u, v, inner)) = cut_of(&ring, line) else {
            continue;
        };
        let mut edge = vec![point_at(&ring.pts, &ring.cum, u)];
        edge.extend_from_slice(&inner);
        edge.push(point_at(&ring.pts, &ring.cum, v));
        p.edges.push(edge);
        let [a, b] = split_ring(&ring.pts, u, v, &ring.cum, &inner);
        p.parts.splice(k..=k, [Ring::new(a), Ring::new(b)]);
        return true;
    }
    false
}

/// A closed outline cut into parts by `cuts` (lines drawn across it), with the holes that lie in it.
/// Holes first: a cut line from the edge into a hole opens it, the hole's outline becomes part of
/// the edge (an o cut once is a C); then the other cut lines, each cutting the part it is drawn
/// across in two. A cut line drawn across no part is left out.
pub fn parts_of(lp: &[Pt], cuts: &[Cut], holes: &[Vec<Pt>]) -> Parts {
    let mut p = Parts {
        parts: vec![Ring::new(closed(lp))],
        edges: vec![],
        open: holes.iter().map(|h| Ring::new(closed(h))).collect(),
        which: (0..holes.len()).collect(),
    };
    let mut rest = vec![];
    for c in cuts {
        let line = cut_line(c);
        if !open_hole(&mut p, &line) {
            rest.push(line);
        }
    }
    for line in rest {
        cut_part(&mut p, &line);
    }
    p
}

/// The parts cut further by one more cut line (it opens a hole or cuts a part in two), the parts
/// given left as they were; None when it does neither (satin_ease tries cuts on parts it keeps).
pub fn cut_parts(p: &Parts, cut: &[Pt]) -> Option<Parts> {
    let mut next = Parts {
        parts: p.parts.clone(),
        edges: p.edges.clone(),
        open: p.open.clone(),
        which: p.which.clone(),
    };
    let line = cut_line(cut);
    (open_hole(&mut next, &line) || cut_part(&mut next, &line)).then_some(next)
}

/// Satin columns of an outline cut into parts (see strips_of_outline).
#[derive(Clone, Debug, Default, Serialize)]
pub struct Sections {
    pub strips: Vec<Strip>,
    pub parts: Vec<Vec<Pt>>,
    /// The part that makes no strip (-1 when all do).
    pub bad: i64,
    /// A hole no cut line opens (-1 when all are opened).
    pub hole: i64,
    /// The strip of each part, when one makes none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub made: Option<Vec<Option<Strip>>>,
    /// The holes not opened, when there are.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open: Option<Vec<usize>>,
}

/// Satin columns for a closed outline cut into parts by `cuts` (lines drawn across it, Trennlinien):
/// each part a strip of its own along the lines drawn across it (`lines`, as in rails_from_outline),
/// ending on its cut lines where that fits (see strip_of_loop). The parts join up as a tree: each
/// part after the parts beyond it, starting at the cut line it shares with the part it hangs from.
/// `holes` are the outlines of holes in the area: each needs a cut line from the edge into it.
pub fn strips_of_outline(
    lp: &[Pt],
    lines: &[[Pt; 2]],
    cuts: &[Cut],
    holes: &[Vec<Pt>],
) -> Sections {
    strips_of_parts(&parts_of(lp, cuts, holes), lines)
}

/// The satin columns of an outline cut into parts (see strips_of_outline), along `lines`.
pub fn strips_of_parts(p: &Parts, lines: &[[Pt; 2]]) -> Sections {
    let edges = &p.edges;
    if !p.open.is_empty() {
        return Sections {
            parts: p.parts.iter().map(|r| r.pts.clone()).collect(),
            bad: -1,
            hole: p.which[0] as i64,
            open: Some(p.which.clone()),
            ..Default::default()
        };
    }
    let parts: Vec<&Ring> = p
        .parts
        .iter()
        .filter(|r| r.pts.len() >= 4)
        .map(|r| &**r)
        .collect();
    let all_parts = || parts.iter().map(|r| r.pts.clone()).collect::<Vec<_>>();
    // Near in both directions first: most points are far apart, and that is quick to tell.
    let same = |p: Pt, q: Pt| {
        (p[0] - q[0]).abs() < 1e-6 && (p[1] - q[1]).abs() < 1e-6 && dist(p, q) < 1e-6
    };
    // The cut lines each part has as an edge (by index in `edges`), as stretches of its outline.
    // A bent cut line is a run of the outline's points, in its order or the other way round.
    let runs = |ring: &[Pt], i: usize, e: &[Pt]| {
        let n = e.len();
        if i + n > ring.len() {
            return false;
        }
        let (mut f, mut b) = (true, true);
        let mut j = 0;
        while j < n && (f || b) {
            f = f && same(ring[i + j], e[j]);
            b = b && same(ring[i + j], e[n - 1 - j]);
            j += 1;
        }
        f || b
    };
    let caps_of: Vec<Vec<(Arc, usize)>> = parts
        .iter()
        .map(|ring| {
            let mut out = vec![];
            for i in 0..ring.pts.len() - 1 {
                if let Some(e) = edges.iter().position(|x| runs(&ring.pts, i, x)) {
                    out.push(([ring.cum[i], ring.cum[i + edges[e].len() - 1]], e));
                }
            }
            out
        })
        .collect();
    let made: Vec<Option<Strip>> = parts
        .iter()
        .enumerate()
        .map(|(k, ring)| {
            let chords: Vec<[f64; 2]> = lines
                .iter()
                .filter_map(|&[a, b]| chord_in(ring, a, b))
                .collect();
            let caps: Vec<Arc> = caps_of[k].iter().map(|c| c.0).collect();
            strip_of_ring(&ring.pts, &ring.cum, &chords, &caps, true).map(|s| Strip {
                left: s.left,
                right: s.right,
                rungs: s.rungs,
                ratio: Some(s.ratio),
            })
        })
        .collect();
    if let Some(bad) = made.iter().position(Option::is_none) {
        return Sections {
            parts: all_parts(),
            bad: bad as i64,
            hole: -1,
            made: Some(made),
            ..Default::default()
        };
    }
    let made: Vec<Strip> = made.into_iter().map(Option::unwrap).collect();
    let np = parts.len();
    // The parts as a tree joined at the cut lines they share, from a part at an end (one neighbour).
    let shared = |k: usize, j: usize| {
        caps_of[k]
            .iter()
            .find(|c| caps_of[j].iter().any(|d| d.1 == c.1))
            .map(|c| c.1)
    };
    let root = (0..np)
        .position(|k| {
            (0..np)
                .filter(|&j| j != k && shared(k, j).is_some())
                .count()
                <= 1
        })
        .unwrap_or(0);
    let mut parent: Vec<Option<i64>> = vec![None; np];
    if np > 0 {
        parent[root] = Some(-1);
    }
    let mut queue = std::collections::VecDeque::from([root]);
    while np > 0
        && let Some(k) = queue.pop_front()
    {
        for j in 0..np {
            if parent[j].is_none() && shared(k, j).is_some() {
                parent[j] = Some(k as i64);
                queue.push_back(j);
            }
        }
    }
    // Each part starts at the cut line to its parent (the root away from its first child): sewn
    // after the parts beyond it, it ends there, back where the way came in.
    let mid_e = |e: usize| mid_of(&edges[e]).unwrap_or([f64::NAN, f64::NAN]);
    let start_of = |s: &Strip| lerp(s.left[0], s.right[0], 0.5);
    let end_of = |s: &Strip| lerp(s.left[s.left.len() - 1], s.right[s.right.len() - 1], 0.5);
    let flip = |s: &Strip| Strip {
        left: s.right.iter().rev().copied().collect(),
        right: s.left.iter().rev().copied().collect(),
        rungs: reversed_rungs(
            &s.rungs,
            last(&cumulative(&s.left)),
            last(&cumulative(&s.right)),
        ),
        ratio: None,
    };
    // As sewn: the rails and rungs only.
    let plain = |s: &Strip| Strip {
        ratio: None,
        ..s.clone()
    };
    let oriented: Vec<Strip> = (0..np)
        .map(|k| {
            let s = &made[k];
            let Some(up) = parent[k] else { return plain(s) };
            let at = if up >= 0 {
                Some(mid_e(shared(k, up as usize).unwrap()))
            } else {
                (0..np)
                    .find(|&j| parent[j] == Some(k as i64))
                    .map(|child| mid_e(shared(k, child).unwrap()))
            };
            let Some(at) = at else { return plain(s) };
            let near_start = dist(start_of(s), at) < dist(end_of(s), at);
            if near_start == (up >= 0) {
                plain(s)
            } else {
                flip(s)
            }
        })
        .collect();
    // Children before their parent (each subtree in the order its cut lines come along the parent).
    let mut strips = vec![];
    fn visit(
        k: usize,
        parent: &[Option<i64>],
        along: &dyn Fn(usize, usize) -> f64,
        oriented: &[Strip],
        strips: &mut Vec<Strip>,
    ) {
        let mut kids: Vec<usize> = (0..parent.len())
            .filter(|&j| parent[j] == Some(k as i64))
            .collect();
        kids.sort_by(|&x, &y| by(along(k, x), along(k, y)));
        for j in kids {
            visit(j, parent, along, oriented, strips);
        }
        strips.push(oriented[k].clone());
    }
    // How far along the parent from where it starts (its entry) a child hangs on.
    let along = |k: usize, j: usize| dist(start_of(&oriented[k]), mid_e(shared(k, j).unwrap()));
    if np > 0 {
        visit(root, &parent, &along, &oriented, &mut strips);
    }
    // Parts that join no other (cannot happen for cut lines across one outline): after the rest.
    for k in 0..np {
        if parent[k].is_none() {
            strips.push(oriented[k].clone());
        }
    }
    Sections {
        strips,
        parts: all_parts(),
        bad: -1,
        hole: -1,
        ..Default::default()
    }
}

/// Areas cut into strips (see strips_of_areas).
#[derive(Clone, Debug, Default, Serialize)]
pub struct AreaStrips {
    pub areas: Vec<Vec<Strip>>,
    pub bad: Option<Vec<Pt>>,
    pub hole: i64,
}

/// The holes that lie in outline `o`, by index.
fn holes_in(o: &[Pt], holes: &[Vec<Pt>]) -> Vec<usize> {
    (0..holes.len())
        .filter(|&j| inside(o, holes[j][0]))
        .collect()
}

/// Areas apart from one another (the dot and the stem of an i), each cut into strips as
/// strips_of_outline does, with the holes that lie in it. The first part that makes no column, or
/// the first hole not opened (by index in `holes`), is said instead.
pub fn strips_of_areas(
    outlines: &[Vec<Pt>],
    lines: &[[Pt; 2]],
    cuts: &[Cut],
    holes: &[Vec<Pt>],
) -> AreaStrips {
    let mut areas = vec![];
    for o in outlines {
        let mine = holes_in(o, holes);
        let hs: Vec<Vec<Pt>> = mine.iter().map(|&j| holes[j].clone()).collect();
        let made = strips_of_outline(o, lines, cuts, &hs);
        if made.hole >= 0 {
            return AreaStrips {
                areas: vec![],
                bad: None,
                hole: mine[made.hole as usize] as i64,
            };
        }
        if made.bad >= 0 {
            return AreaStrips {
                areas: vec![],
                bad: Some(made.parts[made.bad as usize].clone()),
                hole: -1,
            };
        }
        areas.push(made.strips);
    }
    AreaStrips {
        areas,
        bad: None,
        hole: -1,
    }
}

/// What a fill cut by these lines makes: the strips that work, and every part or hole that does not.
#[derive(Clone, Debug, Default, Serialize)]
pub struct SectionCheck {
    pub strips: Vec<Strip>,
    pub parts: Vec<Vec<Pt>>,
    pub holes: Vec<Vec<Pt>>,
}

/// All that is wrong with a fill cut into parts at once (strips_of_areas says only the first), with
/// the strips of the parts that are fine, so each part can be shown as it would be sewn.
pub fn check_sections(
    outlines: &[Vec<Pt>],
    lines: &[[Pt; 2]],
    cuts: &[Cut],
    holes: &[Vec<Pt>],
) -> SectionCheck {
    let mut out = SectionCheck::default();
    for o in outlines {
        let mine = holes_in(o, holes);
        let hs: Vec<Vec<Pt>> = mine.iter().map(|&j| holes[j].clone()).collect();
        let made = strips_of_outline(o, lines, cuts, &hs);
        if made.hole >= 0 {
            for h in made.open.unwrap_or_else(|| vec![made.hole as usize]) {
                out.holes.push(holes[mine[h]].clone());
            }
            continue;
        }
        if made.bad < 0 {
            out.strips.extend(made.strips);
            continue;
        }
        for (k, m) in made.made.unwrap_or_default().into_iter().enumerate() {
            match m {
                Some(s) => out.strips.push(s),
                None => out.parts.push(made.parts[k].clone()),
            }
        }
    }
    out
}

/// The cut lines a fill was cut into these columns by (see strips_of_outline), found again from the
/// columns: an end of a column inside the fill (another column goes on beyond it, not the edge)
/// is one. Drawn a little beyond the edge, as by hand.
pub fn cut_lines_between(
    cols: &[(Vec<Pt>, Vec<Pt>)],
    outlines: &[Vec<Pt>],
    holes: &[Vec<Pt>],
) -> Vec<[Pt; 2]> {
    let within =
        |q: Pt| outlines.iter().any(|o| inside(o, q)) && !holes.iter().any(|h| inside(h, q));
    let mut cuts: Vec<[Pt; 2]> = vec![];
    for (left, right) in cols {
        let n = left.len().min(right.len());
        if n < 2 {
            continue;
        }
        let ends = [
            (left[0], right[0], mid(left[1], right[1])),
            (
                left[left.len() - 1],
                right[right.len() - 1],
                mid(left[left.len() - 2], right[right.len() - 2]),
            ),
        ];
        for (a, b, inward) in ends {
            let m = mid(a, b);
            let d = hypot(m[0] - inward[0], m[1] - inward[1]);
            let d = if d == 0.0 || d.is_nan() { 1.0 } else { d };
            if !within([
                m[0] + ((m[0] - inward[0]) / d) * 0.4,
                m[1] + ((m[1] - inward[1]) / d) * 0.4,
            ]) {
                continue;
            }
            // The two columns on either side of one cut line end on it both.
            if cuts
                .iter()
                .any(|[p, q]| hypot((p[0] + q[0]) / 2.0 - m[0], (p[1] + q[1]) / 2.0 - m[1]) < 0.3)
            {
                continue;
            }
            let w = hypot(b[0] - a[0], b[1] - a[1]);
            let w = if w == 0.0 || w.is_nan() { 1.0 } else { w };
            let e = [((b[0] - a[0]) / w) * 0.5, ((b[1] - a[1]) / w) * 0.5];
            cuts.push([[a[0] - e[0], a[1] - e[1]], [b[0] + e[0], b[1] + e[1]]]);
        }
    }
    cuts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    }

    #[test]
    fn column_from_rungs_pairs_both_rails() {
        let left: Vec<Pt> = vec![[0.0, 0.0], [10.0, 0.0]];
        let right: Vec<Pt> = vec![[0.0, 2.0], [10.0, 2.0]];
        let c = column_from_rungs(&left, &right, &[], 0.5);
        assert_eq!(c.left.len(), 21);
        assert!((c.width - 2.0).abs() < 1e-12);
        assert_eq!(c.center[10], [5.0, 1.0]);
    }

    #[test]
    fn tidy_drops_crossing_and_end_rungs() {
        let t = tidy_rungs(
            &[[5.0, 5.0], [3.0, 6.0], [0.1, 1.0], [9.9, 9.0]],
            10.0,
            10.0,
        );
        assert_eq!(t, vec![[3.0, 6.0]]);
    }

    #[test]
    fn rails_of_a_bar() {
        let ring = rect(0.0, 0.0, 20.0, 2.0);
        let s = rails_from_outline(
            &ring,
            &[[[1.0, -1.0], [1.0, 3.0]], [[19.0, -1.0], [19.0, 3.0]]],
        )
        .unwrap();
        assert_eq!(s.rungs.len(), 2);
        assert!(s.left.len() >= 2 && s.right.len() >= 2);
    }

    #[test]
    fn a_bar_cut_in_two_makes_two_strips() {
        let ring = rect(0.0, 0.0, 20.0, 2.0);
        let lines = [[[5.0, -1.0], [5.0, 3.0]], [[15.0, -1.0], [15.0, 3.0]]];
        let made = strips_of_outline(&ring, &lines, &[vec![[10.0, -1.0], [10.0, 3.0]]], &[]);
        assert_eq!(made.bad, -1);
        assert_eq!(made.strips.len(), 2);
    }

    #[test]
    fn a_ring_needs_its_hole_opened() {
        let outer = rect(0.0, 0.0, 20.0, 20.0);
        let hole = rect(5.0, 5.0, 15.0, 15.0);
        let made = strips_of_areas(
            std::slice::from_ref(&outer),
            &[],
            &[],
            std::slice::from_ref(&hole),
        );
        assert_eq!(made.hole, 0);
        let opened = strips_of_areas(
            &[outer],
            &[[[2.0, 10.0], [8.0, 10.0]]],
            &[vec![[-1.0, 10.0], [6.0, 10.0]]],
            &[hole],
        );
        assert_eq!(opened.hole, -1);
    }

    #[test]
    fn banded_inside_matches_plain() {
        let ring: Vec<Pt> = (0..50)
            .map(|i| {
                let t = i as f64 / 50.0 * std::f64::consts::TAU;
                let r = 5.0 + (3.0 * t).cos();
                [r * t.cos(), r * t.sin()]
            })
            .collect();
        let test = InsideTest::new(&ring);
        for y in -60..60 {
            for x in -60..60 {
                let q = [x as f64 / 10.0 + 0.013, y as f64 / 10.0 + 0.007];
                assert_eq!(test.test(q), inside(&ring, q));
            }
        }
    }

    #[test]
    fn seed_rungs_on_a_bend() {
        let left: Vec<Pt> = (0..=100)
            .map(|i| {
                let a = i as f64 / 100.0 * std::f64::consts::PI;
                [10.0 * a.cos(), 10.0 * a.sin()]
            })
            .collect();
        let right: Vec<Pt> = (0..=100)
            .map(|i| {
                let a = i as f64 / 100.0 * std::f64::consts::PI;
                [12.0 * a.cos() + 2.0 * (i as f64 / 100.0), 12.0 * a.sin()]
            })
            .collect();
        let r = seed_rungs(&left, &right, 2.0);
        assert!(tidy_rungs(&r, 1e9, 1e9).len() == r.len());
    }
}
