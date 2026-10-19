//! Corners and ends of a satin along a line (a drawn line, an SVG stroke), made as changes of its
//! rails before it is stitched: the stitch generator then sews the rails as they are, a stitch for
//! each pair of points.
//!
//! A corner is a bend of CORNER_DEG or more within about half the width (a real corner, not a
//! curve; a fillet tighter than the satin is wide counts too). Without corner handling the rails
//! of a satin round a corner fold over on the inside and fan on the outside, piling stitches up at
//! the inner corner. At a corner both arms run straight to it, the inside rail ends where the inner
//! edges of both arms meet, and the stitches turn from square on the first arm to square on the
//! second over a column width on each side (as digitizers place a bisector rung with square rungs
//! a width before and after). The outside takes the corner's form:
//!
//! - `miter`: the outer edges meet in a point, the turning stitch on the bisector;
//! - `cap`: the outer corner cut off square to the bisector, the stitches fanning over the cut;
//! - `round`: the outer corner rounded about the corner point, half the width out;
//! - `overlap` (lapped): no turning; the first arm runs on square past the corner until it covers
//!   it, the second starts square behind it and lies on top.
//!
//! A miter (the default) is capped where the turn is CAP_DEG or sharper (an inside angle under
//! 20°): there it would reach about six widths out.
//!
//! Ends (SVG stroke-linecap): `flat` square across at the end of the line, `square` the same half a
//! width further on, `round` a half circle, its stitches square across the line and shorter towards
//! the tip.
//!
//! Ported from src/digitize/satinJoins.ts.

use serde::Deserialize;

use super::rungs::{norm, sub};
use crate::geom::Pt;
use crate::js::{dist, round};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SatinCorner {
    Miter,
    Cap,
    Round,
    Overlap,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SatinEnd {
    Flat,
    Round,
    Square,
}

/// A bend from this many degrees is a corner (a turn of 45° or more).
pub const CORNER_DEG: f64 = 45.0;
/// A miter caps a corner turning this much or more: it would grow too long.
pub const CAP_DEG: f64 = 160.0;

/// Points of the line this far apart when looking for corners (mm).
const STEP: f64 = 0.1;
/// Pairs of points this far apart on the rails made here (mm).
const PAIR: f64 = 0.1;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Rails {
    pub left: Vec<Pt>,
    pub right: Vec<Pt>,
}

fn add(a: Pt, b: Pt) -> Pt {
    [a[0] + b[0], a[1] + b[1]]
}
fn mul(a: Pt, k: f64) -> Pt {
    [a[0] * k, a[1] * k]
}
fn dot(a: Pt, b: Pt) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn cross(a: Pt, b: Pt) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
fn mid(a: Pt, b: Pt) -> Pt {
    [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}
/// The left normal of a direction, as line_rails takes it.
fn left_of(d: Pt) -> Pt {
    [-d[1], d[0]]
}
fn length_of(l: &[Pt]) -> f64 {
    l.windows(2).map(|w| dist(w[0], w[1])).sum()
}
fn nonzero(l: f64) -> f64 {
    if l == 0.0 || l.is_nan() { 1.0 } else { l }
}

// The line's points and rails as border.ts makes them (resample, lineRails); stage 3a ports
// border.ts to core/src/digitize/border.rs: use those once both are in.

/// Points every `step` mm along a line, its end kept.
fn resample(pts: &[Pt], step: f64) -> Vec<Pt> {
    let mut out = vec![pts[0]];
    let mut carry = 0.0;
    for i in 1..pts.len() {
        let a = pts[i - 1];
        let b = pts[i];
        let l = dist(a, b);
        let mut t = step - carry;
        while t <= l {
            out.push([
                a[0] + ((b[0] - a[0]) * t) / l,
                a[1] + ((b[1] - a[1]) * t) / l,
            ]);
            t += step;
        }
        carry = l - (t - step);
    }
    let end = pts[pts.len() - 1];
    let n = out.len();
    if dist(out[n - 1], end) > step * 0.3 {
        out.push(end);
    } else {
        out[n - 1] = end;
    }
    out
}

/// A closed line smoothed by a moving average (the pixel steps of a traced edge go).
fn smooth_loop(pts: Vec<Pt>, k: usize) -> Vec<Pt> {
    let open = &pts[..pts.len() - 1];
    let n = open.len();
    if n < 2 * k + 1 {
        return pts;
    }
    let mut out: Vec<Pt> = (0..n)
        .map(|i| {
            let (mut x, mut y) = (0.0, 0.0);
            for j in 0..=2 * k {
                let q = open[(i + j + 2 * n - k) % n];
                x += q[0];
                y += q[1];
            }
            [x / (2 * k + 1) as f64, y / (2 * k + 1) as f64]
        })
        .collect();
    out.push(out[0]);
    out
}

/// An open line smoothed by a moving average; the ends stay where they are.
fn smooth_line(pts: Vec<Pt>, k: usize) -> Vec<Pt> {
    let n = pts.len();
    if n < 2 * k + 1 {
        return pts;
    }
    (0..n)
        .map(|i| {
            if i == 0 || i == n - 1 {
                return pts[i];
            }
            let r = k.min(i).min(n - 1 - i);
            let (mut x, mut y) = (0.0, 0.0);
            for j in i - r..=i + r {
                x += pts[j][0];
                y += pts[j][1];
            }
            [x / (2 * r + 1) as f64, y / (2 * r + 1) as f64]
        })
        .collect()
}

/// Rails of a satin of width `w` centered on a line with no area around it (a drawn line): each
/// side half the width out along the normal. A closed line repeats its first point at the end.
fn line_rails(line: &[Pt], closed: bool, w: f64) -> Rails {
    let half = w / 2.0;
    let center = if closed {
        smooth_loop(resample(line, 0.2), 3)
    } else {
        smooth_line(resample(line, 0.2), 3)
    };
    let n = center.len() as i64;
    let at = |i: i64| {
        if closed {
            center[i.rem_euclid(n - 1) as usize]
        } else {
            center[i.clamp(0, n - 1) as usize]
        }
    };
    let mut r = Rails::default();
    for i in 0..n {
        let a = at(i - 3);
        let b = at(i + 3);
        let l = nonzero(dist(a, b));
        let nn = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
        let c = center[i as usize];
        r.left.push([c[0] + nn[0] * half, c[1] + nn[1] * half]);
        r.right.push([c[0] - nn[0] * half, c[1] - nn[1] * half]);
    }
    r
}

#[derive(Clone, Copy, Debug)]
struct Corner {
    /// Where the arms meet.
    at: Pt,
    din: Pt,
    dout: Pt,
    /// Turn in degrees.
    turn: f64,
    /// Indices of the line where the straight arms to the corner start and end.
    i0: i64,
    i1: i64,
}

fn turn_deg(din: Pt, dout: Pt) -> f64 {
    dot(din, dout).clamp(-1.0, 1.0).acos() * 180.0 / std::f64::consts::PI
}

/// The corners of a line given as points STEP apart (closed: the first point repeated at the end):
/// where it turns by CORNER_DEG or more within `arm` on both sides, at the sharpest point; where
/// two are nearer than two arms, the sharper one.
fn corners_of(pts: &[Pt], closed: bool, arm: f64) -> Vec<Corner> {
    let n = if closed { pts.len() - 1 } else { pts.len() } as i64;
    let k = (round(arm / STEP) as i64).max(2);
    if n < 2 * k + 1 {
        return vec![];
    }
    let at = |i: i64| {
        if closed {
            pts[i.rem_euclid(n) as usize]
        } else {
            pts[i as usize]
        }
    };
    let (lo, hi) = if closed { (0, n - 1) } else { (k, n - 1 - k) };
    let mut found: Vec<(i64, f64, Pt, Pt)> = vec![];
    for i in lo..=hi {
        let din = norm(sub(at(i), at(i - k)));
        let dout = norm(sub(at(i + k), at(i)));
        let t = turn_deg(din, dout);
        if t >= CORNER_DEG {
            found.push((i, t, din, dout));
        }
    }
    found.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.0.cmp(&b.0))
    });
    let gap = |a: i64, b: i64| {
        if closed {
            (a - b).rem_euclid(n).min((b - a).rem_euclid(n))
        } else {
            (a - b).abs()
        }
    };
    let mut chosen: Vec<Corner> = vec![];
    for (i, t, din, dout) in found {
        if chosen.iter().any(|c| gap(c.i0 + k, i) < 2 * k) {
            continue;
        }
        let p = at(i - k);
        let q = at(i + k);
        // Where the straight arms meet; the line's own point where they hardly cross (a hairpin).
        let den = cross(din, dout);
        let mut c = at(i);
        if den.abs() > 0.05 {
            let tt = cross(sub(q, p), dout) / den;
            let x = add(p, mul(din, tt));
            if dist(x, at(i)) < 2.0 * arm {
                c = x;
            }
        }
        chosen.push(Corner {
            at: c,
            din,
            dout,
            turn: t,
            i0: i - k,
            i1: i + k,
        });
    }
    chosen.sort_by_key(|c| c.i0);
    chosen
}

/// The point at length `s` along points with lengths `cum`, between i-1 and i.
fn lerp_at(cum: &[f64], s: f64) -> (usize, f64) {
    let mut i = 1;
    while i < cum.len() - 1 && cum[i] < s {
        i += 1;
    }
    let t = if cum[i] > cum[i - 1] {
        ((s - cum[i - 1]) / (cum[i] - cum[i - 1])).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (i, t)
}

fn lp(u: Pt, v: Pt, t: f64) -> Pt {
    [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t]
}

fn cumulative(l: &[Pt]) -> Vec<f64> {
    let mut cum = vec![0.0];
    for i in 1..l.len() {
        cum.push(cum[i - 1] + dist(l[i - 1], l[i]));
    }
    cum
}

/// The pairs of `r` whose middle lies from `from` to `len - to` along the middle (mm), cut exactly there.
fn trimmed(r: &Rails, from: f64, to: f64) -> Rails {
    let c: Vec<Pt> = r
        .left
        .iter()
        .zip(&r.right)
        .map(|(&l, &q)| mid(l, q))
        .collect();
    let cum = cumulative(&c);
    let len = cum[cum.len() - 1];
    let a = from.min(len);
    let b = a.max(len - to);
    let at = |s: f64| -> (Pt, Pt) {
        let (i, t) = lerp_at(&cum, s);
        (
            lp(r.left[i - 1], r.left[i], t),
            lp(r.right[i - 1], r.right[i], t),
        )
    };
    let mut out = Rails::default();
    let mut put = |(l, q): (Pt, Pt)| {
        out.left.push(l);
        out.right.push(q);
    };
    put(at(a));
    for i in 0..c.len() {
        if cum[i] > a + 1e-6 && cum[i] < b - 1e-6 {
            put((r.left[i], r.right[i]));
        }
    }
    if b > a + 1e-6 {
        put(at(b));
    }
    out
}

/// Points along a polyline at shares 0..1 (by length).
fn along(line: &[Pt], shares: &[f64]) -> Vec<Pt> {
    let cum = cumulative(line);
    let len = cum[cum.len() - 1];
    shares
        .iter()
        .map(|&f| {
            let (i, t) = lerp_at(&cum, f * len);
            lp(line[i - 1], line[i], t)
        })
        .collect()
}

/// Pairs between two rungs, walking the inner and outer line at the same share (without the first pair).
fn between(inner: &[Pt], outer: &[Pt]) -> Vec<(Pt, Pt)> {
    let n = (length_of(inner).max(length_of(outer)) / PAIR)
        .ceil()
        .max(1.0) as usize;
    let f: Vec<f64> = (0..n).map(|j| (j + 1) as f64 / n as f64).collect();
    along(inner, &f).into_iter().zip(along(outer, &f)).collect()
}

/// The arc about c from c + r·u to c + r·v the short way, points about PAIR apart (both ends kept).
fn arc(c: Pt, r: f64, u: Pt, v: Pt) -> Vec<Pt> {
    let pi = std::f64::consts::PI;
    let a0 = u[1].atan2(u[0]);
    let mut da = v[1].atan2(v[0]) - a0;
    while da > pi {
        da -= 2.0 * pi;
    }
    while da < -pi {
        da += 2.0 * pi;
    }
    let n = ((2.0 * ((da.abs() * r) / PAIR / 2.0).ceil()) as usize).max(2);
    (0..=n)
        .map(|j| {
            let a = a0 + (da * j as f64) / n as f64;
            [c[0] + r * a.cos(), c[1] + r * a.sin()]
        })
        .collect()
}

fn dedupe(l: Vec<Pt>) -> Vec<Pt> {
    let mut out: Vec<Pt> = Vec::with_capacity(l.len());
    for (i, &q) in l.iter().enumerate() {
        if i == 0 || dist(q, l[i - 1]) > 1e-6 {
            out.push(q);
        }
    }
    out
}

/// The style a corner is sewn in.
pub fn corner_style(style: SatinCorner, turn: f64) -> SatinCorner {
    if style == SatinCorner::Miter && turn >= CAP_DEG {
        SatinCorner::Cap
    } else {
        style
    }
}

/// Arm a (ending at the corner) and arm b (starting there) joined: how far each arm is cut back
/// and taken on, and how the pairs go from the last one kept of a to the first one kept of b.
struct Join {
    cn: Corner,
    h: f64,
    style: SatinCorner,
    cut_a: f64,
    cut_b: f64,
    ext_a: f64,
    ext_b: f64,
    e_a: f64,
    e_b: f64,
}

/// `room_a`, `room_b`: how much of each arm the corner may take.
fn join(cn: Corner, h: f64, style: SatinCorner, room_a: f64, room_b: f64) -> Join {
    let theta = (cn.turn * std::f64::consts::PI) / 180.0;
    if style == SatinCorner::Overlap {
        // The first arm on until its middle reaches the far edge of the second (at most a width), the second from as far behind.
        let ext = if theta > std::f64::consts::FRAC_PI_2 {
            (2.0 * h).min(h / theta.sin())
        } else {
            h
        };
        return Join {
            cn,
            h,
            style,
            cut_a: 0.0,
            cut_b: 0.0,
            ext_a: ext,
            ext_b: ext,
            e_a: 0.0,
            e_b: 0.0,
        };
    }
    let e = h * (theta / 2.0).tan();
    Join {
        cn,
        h,
        style,
        cut_a: (e + 2.0 * h).min(room_a),
        cut_b: (e + 2.0 * h).min(room_b),
        ext_a: 0.0,
        ext_b: 0.0,
        e_a: e.min(room_a),
        e_b: e.min(room_b),
    }
}

impl Join {
    fn pairs(&self, a_end: (Pt, Pt), b_start: (Pt, Pt)) -> Vec<(Pt, Pt)> {
        if self.style == SatinCorner::Overlap {
            // Between them a pair of no width at the middle of each: the satin passes on to the second
            // arm in one stitch (under it), with no stitches turning across the corner.
            let (a, b) = (mid(a_end.0, a_end.1), mid(b_start.0, b_start.1));
            return vec![(a, a), (b, b)];
        }
        let Corner {
            at: c, din, dout, ..
        } = self.cn;
        let h = self.h;
        let theta = (self.cn.turn * std::f64::consts::PI) / 180.0;
        let inner_left = cross(din, dout) > 0.0;
        let sg = if inner_left { 1.0 } else { -1.0 };
        let n_ai = mul(left_of(din), sg);
        let n_bi = mul(left_of(dout), sg);
        let n_ao = mul(n_ai, -1.0);
        let n_bo = mul(n_bi, -1.0);
        let (ia, oa) = if inner_left {
            a_end
        } else {
            (a_end.1, a_end.0)
        };
        let (ib, ob) = if inner_left {
            b_start
        } else {
            (b_start.1, b_start.0)
        };
        // Inside: where the inner edges meet (or as near as the arms allow).
        let i_a = add(add(c, mul(din, -self.e_a)), mul(n_ai, h));
        let i_b = add(add(c, mul(dout, self.e_b)), mul(n_bi, h));
        let i_mid = mid(i_a, i_b);
        // Outside by the corner's form, through its middle point.
        let (o1, o2) = match self.style {
            SatinCorner::Miter => {
                let o = add(c, mul(add(n_ao, n_bo), h / (1.0 + theta.cos())));
                (vec![oa, o], vec![o, ob])
            }
            SatinCorner::Cap => {
                let p = add(c, mul(n_ao, h));
                let q = add(c, mul(n_bo, h));
                let m = mid(p, q);
                (vec![oa, p, m], vec![m, q, ob])
            }
            _ => {
                let ring = arc(c, h, n_ao, n_bo);
                let k = ring.len() >> 1;
                let mut o1 = vec![oa];
                o1.extend_from_slice(&ring[..=k]);
                let mut o2 = ring[k..].to_vec();
                o2.push(ob);
                (o1, o2)
            }
        };
        let first = between(&dedupe(vec![ia, i_a, i_mid]), &dedupe(o1));
        let mut second = between(&dedupe(vec![i_mid, i_b, ib]), &dedupe(o2));
        second.pop();
        first
            .into_iter()
            .chain(second)
            .map(|(i, o)| if inner_left { (i, o) } else { (o, i) })
            .collect()
    }
}

/// Rails taken on straight past their end (`at_end`) or before their start by `ext` mm, square across.
fn extended(r: Rails, ext: f64, at_end: bool, shape: &dyn Fn(f64, f64) -> f64, step: f64) -> Rails {
    if ext <= 0.0 || r.left.len() < 2 {
        return r;
    }
    let k = if at_end { r.left.len() - 1 } else { 0 };
    let l = r.left[k];
    let q = r.right[k];
    let c = mid(l, q);
    let h = dist(l, q) / 2.0;
    let n = norm(sub(l, q));
    // Along the line, outward from this end.
    let d = if at_end { [n[1], -n[0]] } else { [-n[1], n[0]] };
    let m = (round(ext / step) as usize).max(1);
    let mut left = vec![];
    let mut right = vec![];
    for j in 1..=m {
        let x = (ext * j as f64) / m as f64;
        let w = shape(x, h);
        let p = add(c, mul(d, x));
        left.push(add(p, mul(n, w)));
        right.push(add(p, mul(n, -w)));
    }
    if at_end {
        let mut out = r;
        out.left.extend(left);
        out.right.extend(right);
        out
    } else {
        left.reverse();
        right.reverse();
        left.extend(r.left);
        right.extend(r.right);
        Rails { left, right }
    }
}

fn flat(_: f64, h: f64) -> f64 {
    h
}

/// The open rails with their ends in `style`.
pub fn with_ends(r: Rails, style: Option<SatinEnd>) -> Rails {
    let Some(style) = style else { return r };
    if style == SatinEnd::Flat || r.left.len() < 2 {
        return r;
    }
    let h0 = dist(r.left[0], r.right[0]) / 2.0;
    let h1 = dist(r.left[r.left.len() - 1], r.right[r.right.len() - 1]) / 2.0;
    if style == SatinEnd::Square {
        return extended(extended(r, h0, false, &flat, 0.2), h1, true, &flat, 0.2);
    }
    // Round: a half circle, its stitches square across and shorter towards the tip.
    let round_end = |x: f64, h: f64| (h * h - x * x).max(0.0).sqrt();
    extended(
        extended(r, h0, false, &round_end, PAIR),
        h1,
        true,
        &round_end,
        PAIR,
    )
}

/// Rails of a satin `w` wide centered on `line` (closed: its first point repeated at the end),
/// with its corners in `corner` and its ends in `ends` (an open line only); see the top.
pub fn stroke_rails(
    line: &[Pt],
    closed: bool,
    w: f64,
    corner: SatinCorner,
    ends: SatinEnd,
) -> Rails {
    let h = w / 2.0;
    let pts = if line.len() >= 2 {
        resample(line, STEP)
    } else {
        line.to_vec()
    };
    let corners = if pts.len() >= 2 {
        corners_of(&pts, closed, h.max(0.4))
    } else {
        vec![]
    };
    if corners.is_empty() {
        let r = line_rails(line, closed, w);
        return if closed { r } else { with_ends(r, Some(ends)) };
    }
    // A closed line is opened half way between two corners, so it starts and ends on a straight stretch.
    let mut seq = pts.clone();
    let mut cs = corners.clone();
    if closed {
        let n = pts.len() as i64 - 1;
        let a = corners[0].i0 + corners[0].i1;
        let b = if corners.len() > 1 {
            corners[1].i0 + corners[1].i1
        } else {
            a + 2 * n
        };
        let start = (round((a + b) as f64 / 4.0) as i64).rem_euclid(n);
        seq = (0..=n).map(|j| pts[((start + j) % n) as usize]).collect();
        let sh = |i: i64| (i - start).rem_euclid(n);
        cs = corners
            .iter()
            .map(|c| Corner {
                i0: sh(c.i0),
                i1: sh(c.i0) + (c.i1 - c.i0),
                ..*c
            })
            .collect();
        cs.sort_by_key(|c| c.i0);
    }
    let slice = |from: i64, to: i64| -> &[Pt] {
        let len = seq.len() as i64;
        let (a, b) = (from.clamp(0, len), to.clamp(0, len));
        if a < b {
            &seq[a as usize..b as usize]
        } else {
            &[]
        }
    };
    // Arms: straight to each corner and on from it, each sewn along its own rails.
    let mut arms: Vec<Vec<Pt>> = vec![];
    let mut from = 0i64;
    let mut head: Option<Pt> = None;
    for c in &cs {
        let mut arm: Vec<Pt> = head.into_iter().collect();
        arm.extend_from_slice(slice(from, c.i0 + 1));
        arm.push(c.at);
        arms.push(arm);
        from = c.i1;
        head = Some(c.at);
    }
    let mut arm: Vec<Pt> = head.into_iter().collect();
    arm.extend_from_slice(slice(from, seq.len() as i64));
    arms.push(arm);
    let na = arms.len();
    let room: Vec<f64> = arms
        .iter()
        .enumerate()
        .map(|(k, a)| {
            let len = length_of(a);
            let both = k > 0 && k < na - 1;
            (if both { len / 2.0 - 0.1 } else { len - 0.2 }).max(0.0)
        })
        .collect();
    let joins: Vec<Join> = cs
        .iter()
        .enumerate()
        .map(|(k, &c)| join(c, h, corner_style(corner, c.turn), room[k], room[k + 1]))
        .collect();
    let rails: Vec<Rails> = arms
        .into_iter()
        .enumerate()
        .map(|(k, a)| {
            let mut r = line_rails(&dedupe(a), false, w);
            r = trimmed(
                &r,
                if k > 0 { joins[k - 1].cut_b } else { 0.0 },
                if k < joins.len() { joins[k].cut_a } else { 0.0 },
            );
            if k > 0 {
                r = extended(r, joins[k - 1].ext_b, false, &flat, 0.2);
            }
            if k < joins.len() {
                r = extended(r, joins[k].ext_a, true, &flat, 0.2);
            }
            r
        })
        .collect();
    let mut out = Rails::default();
    for (k, r) in rails.iter().enumerate() {
        if k > 0 {
            let prev = &rails[k - 1];
            let z = joins[k - 1].pairs(
                (
                    prev.left[prev.left.len() - 1],
                    prev.right[prev.right.len() - 1],
                ),
                (r.left[0], r.right[0]),
            );
            for (l, q) in z {
                out.left.push(l);
                out.right.push(q);
            }
        }
        out.left.extend_from_slice(&r.left);
        out.right.extend_from_slice(&r.right);
    }
    if closed {
        out.left.push(out.left[0]);
        out.right.push(out.right[0]);
        return out;
    }
    with_ends(out, Some(ends))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_straight_line_has_no_corners() {
        let r = stroke_rails(
            &[[0.0, 0.0], [10.0, 0.0]],
            false,
            2.0,
            SatinCorner::Miter,
            SatinEnd::Flat,
        );
        assert_eq!(r.left.len(), r.right.len());
        assert!((dist(r.left[10], r.right[10]) - 2.0).abs() < 1e-9);
    }

    #[test]
    fn an_l_turns_on_its_corner() {
        for style in [
            SatinCorner::Miter,
            SatinCorner::Cap,
            SatinCorner::Round,
            SatinCorner::Overlap,
        ] {
            let r = stroke_rails(
                &[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]],
                false,
                2.0,
                style,
                SatinEnd::Round,
            );
            assert_eq!(r.left.len(), r.right.len());
            assert!(r.left.len() > 100);
        }
        assert_eq!(corner_style(SatinCorner::Miter, 170.0), SatinCorner::Cap);
    }

    #[test]
    fn a_closed_square() {
        let sq = [
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [0.0, 0.0],
        ];
        let r = stroke_rails(&sq, true, 2.0, SatinCorner::Miter, SatinEnd::Flat);
        assert_eq!(r.left[0], r.left[r.left.len() - 1]);
    }
}
