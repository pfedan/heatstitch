//! Satin columns along a centerline. The rails are found by casting rays from the centerline along
//! its normal to the region's boundary (the "stroke normals" of the Goldman patent), so they follow
//! the real edges even where the column is asymmetric. Stitch placement follows Ink/Stitch's satin
//! column (re-implemented, not ported):
//!
//! - pairs are spaced so the rail that moves more advances by `spacing`, measured perpendicular to
//!   the previous stitch; on curves the inner side gets denser,
//! - which the short-stitch rule relieves: a penetration too close to the last full one on the same
//!   rail is moved in towards the other rail, 15 % and 30 % of the width by turns (see SHORT_DIST),
//! - pull compensation widens every pair outwards from its middle,
//! - stitches longer than the split length are divided evenly.
//!
//! Ported from src/digitize/satin.ts.

use serde::{Deserialize, Serialize};

use super::region::{Region, sample};
use super::run::run_stitch;
use super::rungs::{lerp, median_width, norm, sub};
use crate::geom::Pt;
use crate::js::{IdMap, dist};
use crate::material::rules::{
    SATIN_CENTER_MAX, SATIN_CONTOUR_MAX, SATIN_CROSS_STRETCH, SATIN_UNDER_MIN, SATIN_ZIGZAG_MAX,
};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SatinParams {
    /// Distance between penetrations on the same side (mm).
    pub spacing: f64,
    /// Added to each side (mm).
    pub pull: f64,
    /// Longer stitches are split (mm).
    pub split_mm: f64,
    /// Short stitches on the inside of curves (default on).
    pub short: Option<bool>,
    /// Added to the right side instead of `pull` (mm); the sides can differ.
    pub pull_b: Option<f64>,
    /// Added to each side in proportion to the column's width there (0.1 = 10 %).
    pub pull_share: Option<f64>,
    /// Added to the right side instead of `pull_share`; the sides can differ.
    pub pull_share_b: Option<f64>,
    /// Split stitches staggered from stitch to stitch, so the split points do not line up into a groove.
    pub stagger: Option<bool>,
    /// Spacing at each point of the column instead of `spacing`.
    pub spacing_at: Option<Vec<f64>>,
    /// Fringe on the left side: each stitch ends up to this much short of the rail (mm), see fringe.
    pub fringe: Option<f64>,
    /// Fringe on the right side (mm).
    pub fringe_b: Option<f64>,
    /// The second pair this far after the first (mm) instead of `spacing`.
    pub lead: Option<f64>,
    /// Irregular satin, 0 to 1: see roughen.
    pub rough: Option<f64>,
    /// Which irregular satin: the same seed gives the same stitches every time.
    pub seed: Option<f64>,
}

/// A number as JavaScript tests it in a condition (`if (x)`): not 0 and not NaN.
#[inline]
fn truthy(x: Option<f64>) -> bool {
    x.is_some_and(|v| v != 0.0 && !v.is_nan())
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Column {
    /// Centerline from end a to end b, extended into free ends.
    pub center: Vec<Pt>,
    pub left: Vec<Pt>,
    pub right: Vec<Pt>,
    /// Median width (mm).
    pub width: f64,
}

/// Short stitches (Ink/Stitch's short stitch inset, re-implemented): on the inside of a curve the
/// needle points of one rail crowd. One closer to the last full one on its rail than SHORT_DIST, or
/// than SHORT_SHARE of the spacing where that is more, moves in towards the other rail; while they
/// keep coming that close, by SHORT_INSETS of the width in turn. Never further than a third of the
/// split length, so a split stitch keeps its parts.
const SHORT_DIST: f64 = 0.25;
const SHORT_SHARE: f64 = 0.5;
const SHORT_INSETS: [f64; 2] = [0.15, 0.3];

/// Tangent at index i, over a window of a few points.
fn tangent(pts: &[Pt], i: usize) -> Pt {
    let k = 3;
    let a = pts[i.saturating_sub(k)];
    let b = pts[(pts.len() - 1).min(i + k)];
    norm(sub(b, a))
}

/// Extends the centerline past a free end until it leaves the region: a medial axis stops about one
/// radius short of a round end, and further short of a tapering tip.
fn extend(r: &Region, pts: &[Pt], radius: f64, at_start: bool) -> Vec<Pt> {
    if pts.len() < 2 {
        return vec![];
    }
    let t = if at_start {
        tangent(pts, 0)
    } else {
        tangent(pts, pts.len() - 1)
    };
    let dir = if at_start { [-t[0], -t[1]] } else { t };
    let from = if at_start { pts[0] } else { pts[pts.len() - 1] };
    let mut out = vec![];
    let mut s = 0.1;
    while s <= 3.0 * radius + 1.0 {
        let p = [from[0] + dir[0] * s, from[1] + dir[1] * s];
        if sample(r, &r.sdf_base, p[0], p[1]) > -0.05 {
            break;
        }
        out.push(p);
        s += 0.1;
    }
    if at_start {
        out.reverse();
    }
    out
}

/// Distance along `dir` from p to the region boundary, or -1 if none within `max`.
fn cast(r: &Region, p: Pt, dir: Pt, max: f64) -> f64 {
    let step = 0.05f64.min(r.px_mm / 2.0);
    let mut prev = sample(r, &r.sdf_base, p[0], p[1]);
    if prev >= 0.0 {
        return 0.0;
    }
    let mut t = step;
    while t <= max {
        let f = sample(r, &r.sdf_base, p[0] + dir[0] * t, p[1] + dir[1] * t);
        if f >= 0.0 {
            return t - step + (step * -prev) / (f - prev);
        }
        prev = f;
        t += step;
    }
    -1.0
}

/// Rails of a branch (centerline `pts` with half widths `rad`), from node a to node b;
/// `free_a`/`free_b` extend the column into free ends.
pub fn column(r: &Region, pts: &[Pt], rad: &[f64], free_a: bool, free_b: bool) -> Column {
    let head = if free_a {
        extend(r, pts, rad[0], true)
    } else {
        vec![]
    };
    let tail = if free_b {
        extend(r, pts, rad[rad.len() - 1], false)
    } else {
        vec![]
    };
    let mut center = head.clone();
    center.extend_from_slice(pts);
    center.extend_from_slice(&tail);
    let mut radius = vec![rad[0]; head.len()];
    radius.extend_from_slice(rad);
    radius.extend(std::iter::repeat_n(rad[rad.len() - 1], tail.len()));
    let mut hl = Vec::with_capacity(center.len());
    let mut hr = Vec::with_capacity(center.len());
    for i in 0..center.len() {
        let t = tangent(&center, i);
        let n = [-t[1], t[0]];
        let rd = radius[i];
        let max = 0.6f64.max(1.6 * rd + 0.2);
        for (side, out) in [(1.0, &mut hl), (-1.0, &mut hr)] {
            let mut d = cast(r, center[i], [n[0] * side, n[1] * side], max);
            // Rays that miss or run far into a junction fall back to the inscribed radius.
            if d < 0.0 || d > 1.6 * rd + 0.2 {
                d = rd;
            }
            out.push(d.max(0.0));
        }
    }
    let sm = |v: &[f64]| -> Vec<f64> {
        (0..v.len())
            .map(|i| {
                let (mut s, mut c) = (0.0, 0.0);
                for x in &v[i.saturating_sub(2)..=(v.len() - 1).min(i + 2)] {
                    s += x;
                    c += 1.0;
                }
                s / c
            })
            .collect()
    };
    let l = sm(&hl);
    let rr = sm(&hr);
    let mut left = Vec::with_capacity(center.len());
    let mut right = Vec::with_capacity(center.len());
    let mut widths = Vec::with_capacity(center.len());
    for i in 0..center.len() {
        let t = tangent(&center, i);
        let n = [-t[1], t[0]];
        left.push([center[i][0] + n[0] * l[i], center[i][1] + n[1] * l[i]]);
        right.push([center[i][0] - n[0] * rr[i], center[i][1] - n[1] * rr[i]]);
        widths.push(l[i] + rr[i]);
    }
    Column {
        center,
        left,
        right,
        width: median_width(widths),
    }
}

/// Junctions at the column's ends that other columns cover already: the column stops this far from them.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnEnds {
    pub from: Pt,
    pub from_trim: f64,
    pub to: Pt,
    pub to_trim: f64,
}

pub type Pair = [Pt; 2];

/// Stitch pairs (left, right) along the column, in its direction.
pub fn pairs(c: &Column, p: &SatinParams, ends: Option<&ColumnEnds>) -> Vec<Pair> {
    let n = c.center.len();
    if n < 2 {
        return vec![];
    }
    let spacing_at = |i: usize| {
        p.spacing_at
            .as_ref()
            .and_then(|s| s.get(i).copied())
            .unwrap_or(p.spacing)
    };
    let mut out: Vec<Pair> = vec![];
    // The spacing at each pair (for the short stitches).
    let mut spacings = vec![];
    let mut last: Option<usize> = None;
    for i in 0..n {
        let w = dist(c.left[i], c.right[i]);
        if w < 0.3 {
            continue;
        }
        if let Some(e) = ends
            && (dist(c.center[i], e.from) < e.from_trim || dist(c.center[i], e.to) < e.to_trim)
        {
            continue;
        }
        if let Some(last) = last {
            let d = norm(sub(c.right[last], c.left[last]));
            let perp = |a: Pt, b: Pt| ((b[0] - a[0]) * d[1] - (b[1] - a[1]) * d[0]).abs();
            let adv = perp(c.left[last], c.left[i]).max(perp(c.right[last], c.right[i]));
            let base = if out.len() == 1 && truthy(p.lead) {
                p.lead.unwrap()
            } else {
                spacing_at(last)
            };
            // Irregular: each pair a different way nearer or further than the spacing.
            let sp = if truthy(p.rough) {
                base * (1.0
                    + ROUGH_SPACING
                        * p.rough.unwrap()
                        * (2.0 * hash(out.len() as f64, 2.0, p.seed.unwrap_or(0.0)) - 1.0))
            } else {
                base
            };
            if adv < sp && i < n - 1 {
                continue;
            }
            if adv < 0.1 {
                continue;
            }
        }
        out.push([c.left[i], c.right[i]]);
        spacings.push(spacing_at(i));
        last = Some(i);
    }
    // Pull compensation: each pair widened outwards from its middle (never turned inside out).
    let share = p.pull_share.unwrap_or(0.0);
    let share_b = p.pull_share_b.or(p.pull_share).unwrap_or(0.0);
    let mut comp: Vec<Pair> = out
        .iter()
        .map(|&[a, b]| {
            let u = norm(sub(a, b));
            let w = dist(a, b);
            let mut ea = p.pull + w * share;
            let mut eb = p.pull_b.unwrap_or(p.pull) + w * share_b;
            if ea + eb < -w * 0.8 {
                let k = (-w * 0.8) / (ea + eb);
                ea *= k;
                eb *= k;
            }
            [
                [a[0] + u[0] * ea, a[1] + u[1] * ea],
                [b[0] - u[0] * eb, b[1] - u[1] * eb],
            ]
        })
        .collect();
    if truthy(p.rough) {
        roughen(&mut comp, p.rough.unwrap(), p.seed.unwrap_or(0.0));
    }
    // Short stitches on the inside of curves (see SHORT_DIST).
    if p.short != Some(false) {
        for side in 0..2 {
            let mut rf = comp.first().map(|c| c[side]);
            let mut run = 0;
            for i in 1..comp.len() {
                let q = comp[i][side];
                let other = comp[i][1 - side];
                if let Some(r) = rf
                    && dist(q, r) < SHORT_DIST.max(SHORT_SHARE * spacings[i])
                {
                    let w = dist(q, other);
                    let k = if w > 1e-9 {
                        SHORT_INSETS[run % SHORT_INSETS.len()].min(p.split_mm / 3.0 / w)
                    } else {
                        0.0
                    };
                    comp[i][side] = lerp(q, other, k);
                    run += 1;
                } else {
                    rf = Some(q);
                    run = 0;
                }
            }
        }
    }
    if truthy(p.fringe) || truthy(p.fringe_b) {
        fringe(
            &mut comp,
            p.fringe.unwrap_or(0.0),
            p.fringe_b.unwrap_or(0.0),
        );
    }
    comp
}

/// A fringed stitch keeps at least this long (mm), and this share of the width.
const FRINGE_KEEP: f64 = 1.0;
const FRINGE_KEEP_SHARE: f64 = 0.35;

/// `x | 0` in JavaScript.
fn to_int32(x: f64) -> u32 {
    if !x.is_finite() {
        return 0;
    }
    x.trunc().rem_euclid(4294967296.0) as u64 as u32
}

/// A number in [0, 1) for stitch i on a side, the same every time (no state, so restitching repeats
/// it); another `seed` gives other numbers (seed 0: the fringe's, as before seeds).
fn hash(i: f64, side: f64, seed: f64) -> f64 {
    let mut h = to_int32(i + 1.0).wrapping_mul(0x9e37_79b1)
        ^ to_int32(side + 7.0).wrapping_mul(0x85eb_ca6b)
        ^ if seed != 0.0 && !seed.is_nan() {
            to_int32(seed).wrapping_mul(0x27d4_eb2f)
        } else {
            0
        };
    h = (h ^ (h >> 15)).wrapping_mul(0x2c1b_3c6d);
    h = (h ^ (h >> 12)).wrapping_mul(0x297a_2d39);
    f64::from(h ^ (h >> 15)) / 4294967296.0
}

/// A ragged edge (fur, feathers): on each side every stitch ends a different way short of the rail,
/// up to `a` (left) and `b` (right) mm. Neighbours always differ by at least 30 % of the depth, so the
/// edge looks frayed rather than wavy; the depths scale with the setting and stay where they are.
fn fringe(ps: &mut [Pair], a: f64, b: f64) {
    let (mut ra, mut rb) = (0.5, 0.5);
    for (i, pair) in ps.iter_mut().enumerate() {
        let [l, r] = *pair;
        ra = (ra + 0.3 + 0.4 * hash(i as f64, 0.0, 0.0)) % 1.0;
        rb = (rb + 0.3 + 0.4 * hash(i as f64, 1.0, 0.0)) % 1.0;
        let w = dist(l, r);
        if w < 1e-6 {
            continue;
        }
        let room = (w - FRINGE_KEEP.max(FRINGE_KEEP_SHARE * w)).max(0.0);
        // Each side's share of the room, so also the stitch back from one pair to the next keeps it.
        let k = if a + b > room { room / (a + b) } else { 1.0 };
        let da = a * k * ra;
        let db = b * k * rb;
        *pair = [lerp(l, r, da / w), lerp(r, l, db / w)];
    }
}

/// Irregular satin, as Ink/Stitch's random width and zigzag spacing (re-implemented): each needle
/// point reaches up to ROUGH_OUT of the width beyond its rail or up to ROUGH_IN short of it, each
/// side on its own, and the spacing varies by up to ROUGH_SPACING (see pairs), all times `k` (0 to
/// 1). Uniform and independent from stitch to stitch, from a hash of the stitch and the seed.
pub const ROUGH_OUT: f64 = 0.2;
pub const ROUGH_IN: f64 = 0.1;
const ROUGH_SPACING: f64 = 0.25;

fn roughen(ps: &mut [Pair], k: f64, seed: f64) {
    for (i, pair) in ps.iter_mut().enumerate() {
        let [a, b] = *pair;
        let w = dist(a, b);
        if w < 1e-6 {
            continue;
        }
        let u = norm(sub(a, b));
        let ea = w * k * ((ROUGH_OUT + ROUGH_IN) * hash(i as f64, 3.0, seed) - ROUGH_IN);
        let eb = w * k * ((ROUGH_OUT + ROUGH_IN) * hash(i as f64, 4.0, seed) - ROUGH_IN);
        *pair = [
            [a[0] + u[0] * ea, a[1] + u[1] * ea],
            [b[0] - u[0] * eb, b[1] - u[1] * eb],
        ];
    }
}

/// The column with its rails drawn in by the fringe (left `a`, right `b` mm): where the satin covers on every stitch.
pub fn fringed_column(c: &Column, a: f64, b: f64) -> Column {
    if (a == 0.0 || a.is_nan()) && (b == 0.0 || b.is_nan()) {
        return c.clone();
    }
    let mut left = Vec::with_capacity(c.left.len());
    let mut right = Vec::with_capacity(c.left.len());
    for (i, &l) in c.left.iter().enumerate() {
        let r = c.right[i];
        let w = dist(l, r);
        let room = (w - FRINGE_KEEP.max(FRINGE_KEEP_SHARE * w)).max(0.0);
        let k = if a + b > room { room / (a + b) } else { 1.0 };
        let some = w != 0.0 && !w.is_nan();
        left.push(if some { lerp(l, r, (a * k) / w) } else { l });
        right.push(if some { lerp(r, l, (b * k) / w) } else { r });
    }
    let center = left
        .iter()
        .zip(&right)
        .map(|(&l, &r)| lerp(l, r, 0.5))
        .collect();
    Column {
        center,
        left,
        right,
        width: c.width,
    }
}

/// Splits a stitch from a to b into equal parts no longer than `max`; returns the points after a.
fn split(a: Pt, b: Pt, max: f64) -> Vec<Pt> {
    let n = (dist(a, b) / max).ceil().max(1.0) as usize;
    (1..=n).map(|k| lerp(a, b, k as f64 / n as f64)).collect()
}

/// Split points of stitch number `row` staggered: no two neighbours split at the same place.
const STAGGERS: f64 = 4.0;
/// No split point closer to a rail than this (mm): it would make a stitch too short to sew.
const SPLIT_END: f64 = 1.0;

/// Splits a stitch across the column from a to b (`from_a` measured from a, else from b, so a
/// stitch and the one back share their grid): at a fourth of the length further on from stitch
/// to stitch, every `max - 1` mm, never nearer than 1 mm to a rail. Returns the points after a.
fn split_staggered(a: Pt, b: Pt, max: f64, row: usize, from_a: bool) -> Vec<Pt> {
    let d = dist(a, b);
    if d <= max {
        return vec![b];
    }
    let step = (max - SPLIT_END).max(1.0);
    let mut ts = vec![];
    let mut x = ((row as f64 % STAGGERS) / STAGGERS) * step;
    while x < d {
        if x >= SPLIT_END && x <= d - SPLIT_END {
            ts.push(x);
        }
        x += step;
    }
    let mut along: Vec<Pt> = if from_a {
        ts.iter().map(|&x| lerp(a, b, x / d)).collect()
    } else {
        ts.iter().rev().map(|&x| lerp(a, b, (d - x) / d)).collect()
    };
    along.push(b);
    along
}

/// Needle points of the satin: left, right, left, right ... along the pairs.
pub fn satin_stitches(ps: &[Pair], p: &SatinParams) -> Vec<Pt> {
    let mut out: Vec<Pt> = vec![];
    let mut row = 0;
    let stagger = p.stagger == Some(true);
    let mut cross = |a: Pt, b: Pt, from_a: bool| {
        if stagger {
            row += 1;
            split_staggered(a, b, p.split_mm, row - 1, from_a)
        } else {
            split(a, b, p.split_mm)
        }
    };
    for &[a, b] in ps {
        if out.is_empty() {
            out.push(a);
        } else {
            let from = out[out.len() - 1];
            out.extend(cross(from, a, false));
        }
        out.extend(cross(a, b, true));
    }
    out
}

/// Needle points of an E stitch (blanket stitch, for appliqué edges): a running stitch along the
/// left rail, at each pair a stitch across to the right rail and back on the same holes.
pub fn e_stitches(ps: &[Pair], p: &SatinParams) -> Vec<Pt> {
    let mut out: Vec<Pt> = vec![];
    let mut row = 0;
    for &[a, b] in ps {
        if out.is_empty() {
            out.push(a);
        } else {
            let from = out[out.len() - 1];
            out.extend(split(from, a, p.split_mm));
        }
        let there = if p.stagger == Some(true) {
            row += 1;
            split_staggered(a, b, p.split_mm, row - 1, true)
        } else {
            split(a, b, p.split_mm)
        };
        let mut back = vec![a];
        back.extend_from_slice(&there[..there.len() - 1]);
        back.reverse();
        out.extend(there);
        out.extend(back);
    }
    out
}

/// Kinds of satin underlay: by the column's width, along the middle, along both rails, zigzag, rails and zigzag.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnderlayKind {
    Auto,
    Center,
    Contour,
    Zigzag,
    Both,
}

/// Inset of the contour underlay from the rails (mm), at most a fourth of the width; the zigzag's is half of it.
const INSET: f64 = 0.4;

/// Tiers of the automatic underlay, from narrow to wide: none, a walk along the middle, an edge run
/// inside both rails, edge run and one zigzag, edge run and a crossed (double) zigzag.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UnderTier {
    None,
    Center,
    Contour,
    Zigzag,
    Cross,
}

/// The tier of a column `w` mm wide; `stretch`: on stretchy fabric, crossed from SATIN_CROSS_STRETCH.
pub fn under_tier(w: f64, stretch: bool) -> UnderTier {
    if w < SATIN_UNDER_MIN {
        UnderTier::None
    } else if w < SATIN_CENTER_MAX {
        UnderTier::Center
    } else if stretch && w >= SATIN_CROSS_STRETCH {
        UnderTier::Cross
    } else if w < SATIN_CONTOUR_MAX {
        UnderTier::Contour
    } else if w < SATIN_ZIGZAG_MAX {
        UnderTier::Zigzag
    } else {
        UnderTier::Cross
    }
}

/// How far the contour and zigzag underlay keep inside the rails: `mm` from each rail, or `share`
/// of the width there (0.1 = 10 %) in place of it. INSET (at most a fourth of the width) when neither is set.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct UnderInset {
    pub mm: Option<f64>,
    pub share: Option<f64>,
}

/// How far underlay keeps inside a rung, as a fraction of its length (at most 45 % from each side).
/// `half`: the zigzag's when none is set, half the edge run's, so the zigzag also carries the
/// satin's edge beside the edge run.
#[derive(Clone, Copy)]
struct Inset {
    ins: UnderInset,
    half: bool,
}

impl Inset {
    fn of(ins: Option<UnderInset>, half: bool) -> Inset {
        Inset {
            ins: ins.unwrap_or_default(),
            half,
        }
    }
    fn at(&self, a: Pt, b: Pt) -> f64 {
        let w = dist(a, b).max(1e-6);
        if let Some(share) = self.ins.share {
            return 0.45f64.min(share.max(0.0));
        }
        if let Some(mm) = self.ins.mm {
            return (0.45 * w).min(mm.max(0.0)) / w;
        }
        INSET.min(w / 4.0) / w / if self.half { 2.0 } else { 1.0 }
    }
}

/// Along a column a stretch changes its tier only this much past a tier's limit (mm), so a column about at a limit is not cut up.
const TIER_MARGIN: f64 = 0.3;
/// Stretches shorter than this (mm along the middle) go with their neighbours.
const MIN_STRETCH: f64 = 5.0;

struct Stretch {
    a: usize,
    b: usize,
    tier: UnderTier,
    len: f64,
}

/// The column in stretches of one underlay tier each (see under_tier): from index a to b.
fn by_width(c: &Column, stretch: bool) -> Vec<(usize, usize, UnderTier)> {
    let rank = |w: f64| under_tier(w, stretch);
    let mut parts: Vec<Stretch> = vec![];
    for i in 0..c.center.len() {
        let w = dist(c.left[i], c.right[i]);
        // Into another tier only once clearly past its limit.
        let mut tier = rank(w);
        if let Some(last) = parts.last() {
            if tier > last.tier && rank(w - TIER_MARGIN) <= last.tier {
                tier = last.tier;
            }
            if tier < last.tier && rank(w + TIER_MARGIN) >= last.tier {
                tier = last.tier;
            }
        }
        let step = if i > 0 {
            dist(c.center[i - 1], c.center[i])
        } else {
            0.0
        };
        match parts.last_mut() {
            Some(last) if last.tier == tier => {
                last.b = i;
                last.len += step;
            }
            last => {
                let a = last.map_or(0, |l| l.b);
                parts.push(Stretch {
                    a,
                    b: i,
                    tier,
                    len: step,
                })
            }
        }
    }
    // The shortest stretch under MIN_STRETCH goes to its longer neighbour, until none is left.
    loop {
        let mut k: Option<usize> = None;
        for j in 0..parts.len() {
            if parts[j].len < MIN_STRETCH && k.is_none_or(|k| parts[j].len < parts[k].len) {
                k = Some(j);
            }
        }
        let Some(k) = k else { break };
        if parts.len() == 1 {
            break;
        }
        let prev = k.checked_sub(1).map(|j| &parts[j]);
        let next = parts.get(k + 1);
        let into = match (prev, next) {
            (_, None) => k - 1,
            (Some(p), Some(n)) if p.len >= n.len => k - 1,
            _ => k + 1,
        };
        let lo = k.min(into);
        let merged = Stretch {
            a: parts[lo].a,
            b: parts[lo + 1].b,
            tier: parts[into].tier,
            len: parts[lo].len + parts[lo + 1].len,
        };
        parts.splice(lo..lo + 2, [merged]);
        // Neighbours of the same tier become one.
        let mut j = parts.len() - 1;
        while j > 0 {
            if parts[j].tier == parts[j - 1].tier {
                parts[j - 1] = Stretch {
                    a: parts[j - 1].a,
                    b: parts[j].b,
                    tier: parts[j].tier,
                    len: parts[j - 1].len + parts[j].len,
                };
                parts.remove(j);
            }
            j -= 1;
        }
    }
    parts.into_iter().map(|s| (s.a, s.b, s.tier)).collect()
}

fn slice_column(c: &Column, a: usize, b: usize) -> Column {
    Column {
        center: c.center[a..=b].to_vec(),
        left: c.left[a..=b].to_vec(),
        right: c.right[a..=b].to_vec(),
        width: c.width,
    }
}

fn center_walk(c: &Column, tol: f64) -> Vec<Pt> {
    run_stitch(&c.center, 2.5, tol)
}

/// Underlay sewn on the way out along the column, ending at its far end (the satin follows on the
/// way back), by width in tiers (see under_tier), stretch by stretch where the width changes along
/// the column. An edge run comes back to where it started, so in this one-way form it is followed by
/// a walk out along the middle; a zigzag is sewn out only. The center walk keeps within `tol` of the
/// centerline, so it stays under the satin in tight curves.
pub fn underlay(c: &Column, tol: f64, ins: Option<UnderInset>, stretch: bool) -> Vec<Pt> {
    underlay_with(c, tol, Inset::of(ins, false), Inset::of(ins, true), stretch)
}

fn underlay_with(c: &Column, tol: f64, inset: Inset, zig: Inset, stretch: bool) -> Vec<Pt> {
    let one = |part: &Column, tier: UnderTier| -> Vec<Pt> {
        match tier {
            UnderTier::None | UnderTier::Center => center_walk(part, tol),
            UnderTier::Contour => [contour(part, tol, inset), center_walk(part, tol)].concat(),
            _ => [contour(part, tol, inset), zigzags(part, zig).0].concat(),
        }
    };
    let parts = by_width(c, stretch);
    if parts.len() == 1 {
        return one(c, under_tier(c.width, stretch));
    }
    parts
        .into_iter()
        .flat_map(|(a, b, tier)| one(&slice_column(c, a, b), tier))
        .collect()
}

/// Underlay points and whether they end at the column's far end.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Under {
    pub pts: Vec<Pt>,
    pub at_end: bool,
}

/// The automatic underlay by width (see under_tier), and whether it ends at the column's far end. A
/// column of one tier: a center walk out (ends at the far end), an edge run out and back, edge run
/// and a zigzag out (far end), edge run and the zigzag out and back (crossed). Where the width
/// changes along the column it ends back at the start: each stretch goes out and comes back in its
/// own tier.
fn auto_under(c: &Column, tol: f64, inset: Inset, zig: Inset, stretch: bool) -> Under {
    let parts = by_width(c, stretch);
    if parts.len() == 1 {
        let (pts, at_end) = match under_tier(c.width, stretch) {
            UnderTier::None => (vec![], false),
            UnderTier::Center => (center_walk(c, tol), true),
            UnderTier::Contour => (contour(c, tol, inset), false),
            UnderTier::Zigzag => ([contour(c, tol, inset), zigzags(c, zig).0].concat(), true),
            UnderTier::Cross => (
                [contour(c, tol, inset), double_zigzag(c, zig)].concat(),
                false,
            ),
        };
        return Under { pts, at_end };
    }
    let mut out = vec![];
    let mut back: Vec<Vec<Pt>> = vec![];
    for (a, b, tier) in parts {
        let part = slice_column(c, a, b);
        match tier {
            UnderTier::Cross => {
                let (there, home) = zigzags(&part, zig);
                out.extend(contour(&part, tol, inset));
                out.extend(there);
                back.push(home);
            }
            UnderTier::Zigzag | UnderTier::Contour => {
                let (l, r) = edge_runs(&part, tol, inset);
                out.extend(l);
                if tier == UnderTier::Zigzag {
                    out.extend(zigzags(&part, zig).0);
                }
                back.push(r);
            }
            _ => {
                // Also where narrower than SATIN_UNDER_MIN between wider stretches: the way on to them.
                let walk = center_walk(&part, tol);
                out.extend_from_slice(&walk);
                back.push(walk.into_iter().rev().collect());
            }
        }
    }
    for b in back.into_iter().rev() {
        out.extend(b);
    }
    Under {
        pts: out,
        at_end: false,
    }
}

/// Between penetrations of the zigzag underlay (mm along the middle, alternating sides): 3 mm on one side.
const ZIGZAG_STEP: f64 = 1.5;

/// The zigzag underlay as two passes over the same stations every ZIGZAG_STEP along the column: out
/// from the left rail, then back starting on the other rail at the far end, so at each station the
/// second pass meets the side the first one left out and the two cross between stations, the
/// double zigzag (cross-hatch), which holds the fabric in both diagonals.
fn zigzags(c: &Column, inset: Inset) -> (Vec<Pt>, Vec<Pt>) {
    let side = |i: usize, j: usize| {
        let a = c.left[i];
        let b = c.right[i];
        let k = inset.at(a, b);
        if j == 0 { lerp(a, b, k) } else { lerp(b, a, k) }
    };
    // Whether a zigzag stitch from station i to j (either way across) would cross a rail: round the
    // inside of a sharp corner, where it would cut across what is not the column. Any part of the
    // rails, as rungs may slant far along them.
    let grid = RailGrid::new(c);
    let cuts = |i: usize, j: usize| {
        [(side(i, 0), side(j, 1)), (side(i, 1), side(j, 0))]
            .iter()
            .any(|&(p, q)| grid.crosses(p, q))
    };
    // Every ZIGZAG_STEP along the middle, or sooner where a stitch would leave the column.
    let n = c.center.len();
    let mut at = vec![0];
    let mut sc = 0.0;
    let mut i = 1;
    while i < n {
        sc += dist(c.center[i - 1], c.center[i]);
        if sc < ZIGZAG_STEP && i < n - 1 {
            i += 1;
            continue;
        }
        // Back towards the last station until the stitches stay inside, yet not nearer than a third
        // of the step: where rails slant so much that no station helps, more would only pile up.
        let last = at[at.len() - 1];
        let mut j = i;
        while j - 1 > last
            && dist(c.center[j - 1], c.center[last]) >= ZIGZAG_STEP / 3.0
            && cuts(last, j)
        {
            j -= 1;
        }
        at.push(j);
        i = j + 1;
        sc = 0.0;
    }
    let out = at
        .iter()
        .enumerate()
        .map(|(n, &i)| side(i, n % 2))
        .collect();
    let back = at
        .iter()
        .enumerate()
        .rev()
        .map(|(n, &i)| side(i, 1 - (n % 2)))
        .collect();
    (out, back)
}

/// Cells of the grid RailGrid sorts the rails' segments into (mm).
const RAIL_CELL: f64 = 1.0;

/// The segments of both rails, found by the cells of a grid.
struct RailGrid {
    segs: Vec<[Pt; 2]>,
    cells: IdMap<(i64, i64), Vec<u32>>,
}

fn span(a: f64, b: f64) -> (i64, i64) {
    (
        (a.min(b) / RAIL_CELL).floor() as i64,
        (a.max(b) / RAIL_CELL).floor() as i64,
    )
}

impl RailGrid {
    fn new(c: &Column) -> RailGrid {
        let mut segs = vec![];
        let mut cells: IdMap<(i64, i64), Vec<u32>> = IdMap::default();
        for rail in [&c.left, &c.right] {
            for k in 0..rail.len().saturating_sub(1) {
                let (x0, x1) = span(rail[k][0], rail[k + 1][0]);
                let (y0, y1) = span(rail[k][1], rail[k + 1][1]);
                let id = segs.len() as u32;
                segs.push([rail[k], rail[k + 1]]);
                for x in x0..=x1 {
                    for y in y0..=y1 {
                        cells.entry((x, y)).or_default().push(id);
                    }
                }
            }
        }
        RailGrid { segs, cells }
    }

    /// Whether the segment p-q crosses one of the rails' segments near it.
    fn crosses(&self, p: Pt, q: Pt) -> bool {
        let (x0, x1) = span(p[0], q[0]);
        let (y0, y1) = span(p[1], q[1]);
        for x in x0..=x1 {
            for y in y0..=y1 {
                if let Some(list) = self.cells.get(&(x, y))
                    && list.iter().any(|&s| {
                        let [a, b] = self.segs[s as usize];
                        crossing(p, q, a, b)
                    })
                {
                    return true;
                }
            }
        }
        false
    }
}

/// Whether the segments p-q and a-b cross (not only touch).
fn crossing(p: Pt, q: Pt, a: Pt, b: Pt) -> bool {
    let o = |u: Pt, v: Pt, w: Pt| (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    let d1 = o(p, q, a);
    let d2 = o(p, q, b);
    let d3 = o(a, b, p);
    let d4 = o(a, b, q);
    d1 * d2 < 0.0 && d3 * d4 < 0.0
}

/// Both zigzag passes: out to the far end and back to the start.
fn double_zigzag(c: &Column, inset: Inset) -> Vec<Pt> {
    let (out, back) = zigzags(c, inset);
    [out, back].concat()
}

/// The edge runs inside both rails: out along the left one and back along the right one.
fn edge_runs(c: &Column, tol: f64, inset: Inset) -> (Vec<Pt>, Vec<Pt>) {
    let l: Vec<Pt> = c
        .left
        .iter()
        .zip(&c.right)
        .map(|(&a, &b)| lerp(a, b, inset.at(a, b)))
        .collect();
    let r: Vec<Pt> = c
        .right
        .iter()
        .zip(&c.left)
        .map(|(&b, &a)| lerp(b, a, inset.at(b, a)))
        .rev()
        .collect();
    (run_stitch(&l, 2.0, tol), run_stitch(&r, 2.0, tol))
}

/// Out along the left rail and back along the right one, both inset.
fn contour(c: &Column, tol: f64, inset: Inset) -> Vec<Pt> {
    let (l, r) = edge_runs(c, tol, inset);
    [l, r].concat()
}

/// The underlay of `kind` for the column, and whether it ends at the column's far end (then the
/// satin comes back over it) or back where it started (then the satin goes out over it). A zigzag
/// is sewn out and back (see zigzags), so it ends where it started; `one_way` (a column that has to
/// come home, in a chain) sews it out only, so it ends at the far end and needs no run out along
/// the middle on top. `stretch`: Auto on stretchy fabric (see under_tier).
pub fn underlay_of(
    c: &Column,
    kind: UnderlayKind,
    tol: f64,
    ins: Option<UnderInset>,
    one_way: bool,
    stretch: bool,
) -> Under {
    let k = Inset::of(ins, false);
    let z = Inset::of(ins, true);
    let u = |pts: Vec<Pt>, at_end: bool| Under { pts, at_end };
    match (kind, one_way) {
        (UnderlayKind::Center, _) => u(center_walk(c, tol), true),
        (UnderlayKind::Contour, _) => u(contour(c, tol, k), false),
        (UnderlayKind::Zigzag, true) => u(zigzags(c, z).0, true),
        (UnderlayKind::Both, true) => u([contour(c, tol, k), zigzags(c, z).0].concat(), true),
        (UnderlayKind::Auto, true) => u(underlay_with(c, tol, k, z, stretch), true),
        (UnderlayKind::Zigzag, false) => u(double_zigzag(c, z), false),
        (UnderlayKind::Both, false) => u([contour(c, tol, k), double_zigzag(c, z)].concat(), false),
        (UnderlayKind::Auto, false) => auto_under(c, tol, k, z, stretch),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bar(w: f64, len: f64) -> Column {
        let n = (len / 0.1) as usize;
        let center: Vec<Pt> = (0..=n).map(|i| [i as f64 * 0.1, 0.0]).collect();
        Column {
            left: center.iter().map(|p| [p[0], -w / 2.0]).collect(),
            right: center.iter().map(|p| [p[0], w / 2.0]).collect(),
            center,
            width: w,
        }
    }

    fn params() -> SatinParams {
        SatinParams {
            spacing: 0.4,
            pull: 0.2,
            split_mm: 7.0,
            ..Default::default()
        }
    }

    #[test]
    fn pairs_are_spaced_and_widened() {
        let ps = pairs(&bar(3.0, 10.0), &params(), None);
        assert!(ps.len() >= 20 && ps.len() <= 27, "{}", ps.len());
        assert!((dist(ps[3][0], ps[3][1]) - 3.4).abs() < 1e-9);
    }

    #[test]
    fn long_stitches_split() {
        let p = SatinParams {
            split_mm: 4.0,
            ..params()
        };
        let pts = satin_stitches(&pairs(&bar(10.0, 5.0), &p, None), &p);
        for w in pts.windows(2) {
            assert!(dist(w[0], w[1]) <= 4.0 + 1e-9);
        }
        let s = SatinParams {
            stagger: Some(true),
            ..p
        };
        let pts = satin_stitches(&pairs(&bar(10.0, 5.0), &s, None), &s);
        for w in pts.windows(2) {
            assert!(dist(w[0], w[1]) <= 4.0 + 1e-9);
        }
    }

    #[test]
    fn underlay_tiers_by_width() {
        assert_eq!(under_tier(0.5, false), UnderTier::None);
        assert_eq!(under_tier(2.0, false), UnderTier::Center);
        assert_eq!(under_tier(4.0, false), UnderTier::Contour);
        assert_eq!(under_tier(7.0, true), UnderTier::Cross);
        let u = underlay_of(
            &bar(8.0, 20.0),
            UnderlayKind::Auto,
            0.15,
            None,
            false,
            false,
        );
        assert!(u.at_end);
        let u = underlay_of(
            &bar(12.0, 20.0),
            UnderlayKind::Auto,
            0.15,
            None,
            false,
            false,
        );
        assert!(!u.at_end && u.pts.len() > 20);
    }

    #[test]
    fn hash_as_in_javascript() {
        // Values from the TypeScript hash.
        assert!((hash(0.0, 0.0, 0.0) - hash(0.0, 0.0, 0.0)).abs() == 0.0);
        let h = hash(5.0, 3.0, 17.0);
        assert!((0.0..1.0).contains(&h));
    }
}
