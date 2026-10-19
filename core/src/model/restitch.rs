//! Satin sewn from its rails, as src/model/restitch.ts sews it: columns, sections (cut lines, free
//! rungs, a plan of their order), chains of columns joined through the satin, push and seam
//! compensation at their ends, and the best order of a chain. The reading of shapes from stitches
//! and what objects remember stay TypeScript.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::runs::Run;
use super::truthy;
use crate::digitize::run::run_stitch;
use crate::digitize::rungs::{
    InsideTest, Rung, column_from_rungs, project, reversed_rungs, strip_of_loop, tidy_rungs,
};
use crate::digitize::satin::{
    Column, Pair, ROUGH_IN, SatinParams, UnderInset, UnderlayKind, e_stitches, fringed_column,
    pairs, satin_stitches, underlay_of,
};
use crate::geom::{Pt, bounds_of, cumulative, lerp, mid, point_at, to_segment};
use crate::js::{Random, dist, yes};
use crate::material::rules::SATIN_SPLIT_MM;
use crate::shape::path::inside_poly;

/// One section of a column in the order its satin is sewn: which, turned round, trimmed before.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SectionStep {
    pub sec: f64,
    pub flip: bool,
    pub trim: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub mirror: bool,
}

/// The two sides of a satin column (see Rails in restitch.ts; the split of a fill it was cut from is
/// not needed to sew it).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rails {
    pub left: Vec<Pt>,
    pub right: Vec<Pt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rungs: Option<Vec<Rung>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cuts: Option<Vec<Rung>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spacings: Option<Vec<[f64; 2]>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spans: Option<Vec<[Pt; 2]>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chain: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<Vec<SectionStep>>,
    #[serde(
        default,
        skip_serializing_if = "std::ops::Not::not",
        deserialize_with = "truthy"
    )]
    pub mirror: bool,
}

impl Rails {
    pub fn new(left: Vec<Pt>, right: Vec<Pt>) -> Rails {
        Rails {
            left,
            right,
            ..Default::default()
        }
    }
}

/// A number JavaScript would read from a missing field: undefined, NaN in arithmetic.
pub(crate) fn nan() -> f64 {
    f64::NAN
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FringeSide {
    Left,
    Right,
}

impl FringeSide {
    pub fn other(self) -> FringeSide {
        match self {
            FringeSide::Left => FringeSide::Right,
            FringeSide::Right => FringeSide::Left,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SatinType {
    Satin,
    E,
}

/// Where a column is shortened by push compensation: the middle of its end and by how much (mm).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PushEnd {
    pub at: Pt,
    pub mm: f64,
}

/// SatinSettings of restitch.ts.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SatinSettings {
    #[serde(default = "nan")]
    pub spacing: f64,
    #[serde(default = "nan")]
    pub edge: f64,
    #[serde(default, deserialize_with = "truthy")]
    pub short: bool,
    #[serde(default, deserialize_with = "truthy")]
    pub underlay: bool,
    #[serde(default = "nan")]
    pub tolerance: f64,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<SatinType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub under: Option<UnderlayKind>,
    #[serde(
        default,
        skip_serializing_if = "std::ops::Not::not",
        deserialize_with = "truthy"
    )]
    pub under_cross: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub under_inset: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub under_inset_share: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stagger: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_share: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_b: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_share_b: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "std::ops::Not::not",
        deserialize_with = "truthy"
    )]
    pub by_width: bool,
    #[serde(
        default,
        skip_serializing_if = "std::ops::Not::not",
        deserialize_with = "truthy"
    )]
    pub edge_auto: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fringe: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fringe_side: Option<FringeSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rough: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rough_seed: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push: Option<Vec<PushEnd>>,
}

impl SatinSettings {
    fn is_e(&self) -> bool {
        self.kind == Some(SatinType::E)
    }
}

fn last<T: Copy>(v: &[T]) -> T {
    v[v.len() - 1]
}

/// Whether a plan fits a column of n sections: each section once.
pub fn plan_fits(plan: Option<&[SectionStep]>, n: usize) -> bool {
    let Some(plan) = plan else { return false };
    if plan.len() != n {
        return false;
    }
    let mut seen: Vec<f64> = vec![];
    for x in plan {
        if !seen.contains(&x.sec) {
            seen.push(x.sec);
        }
    }
    seen.len() == n
        && plan
            .iter()
            .all(|x| x.sec.fract() == 0.0 && x.sec >= 0.0 && x.sec < n as f64)
}

/// The column of rails: interpolated between its rungs, or each pair of penetrations as one.
pub fn column_of(r: &Rails) -> Column {
    if let Some(rungs) = &r.rungs {
        return column_from_rungs(&r.left, &r.right, rungs, 0.05);
    }
    let (left, right) = (&r.left, &r.right);
    let mut l = vec![];
    let mut rr = vec![];
    let mut c = vec![];
    let mut widths = vec![];
    const SUB: usize = 8;
    for k in 0..left.len() {
        let steps = if k + 1 < left.len() { SUB } else { 1 };
        for j in 0..steps {
            let t = j as f64 / SUB as f64;
            let a = if k + 1 < left.len() {
                lerp(left[k], left[k + 1], t)
            } else {
                left[k]
            };
            let b = if k + 1 < right.len() {
                lerp(right[k], right[k + 1], t)
            } else {
                right[k.min(right.len() - 1)]
            };
            l.push(a);
            rr.push(b);
            c.push(lerp(a, b, 0.5));
            widths.push(dist(a, b));
        }
    }
    widths.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Column {
        center: c,
        left: l,
        right: rr,
        width: widths.get(widths.len() >> 1).copied().unwrap_or(f64::NAN),
    }
}

/// Rails walked from the other end: the sides swap, the rungs come along.
pub fn reversed_rails(r: &Rails) -> Rails {
    let mut out = Rails::new(
        r.right.iter().rev().copied().collect(),
        r.left.iter().rev().copied().collect(),
    );
    let la = last(&cumulative(&r.left));
    let lb = last(&cumulative(&r.right));
    if let Some(rungs) = &r.rungs {
        out.rungs = Some(reversed_rungs(rungs, la, lb));
    }
    if let Some(cuts) = &r.cuts {
        out.cuts = Some(reversed_rungs(cuts, la, lb));
    }
    if let Some(spans) = &r.spans {
        out.spans = Some(spans.clone());
    }
    out.chain = r.chain;
    out.mirror = r.mirror;
    if let Some(plan) = &r.plan {
        // Walked the other way: the last step first, each section numbered from the other end; a
        // trim stays between the same two steps.
        let n = plan.len();
        out.plan = Some(
            plan.iter()
                .rev()
                .enumerate()
                .map(|(j, x)| SectionStep {
                    sec: (n - 1) as f64 - x.sec,
                    flip: x.flip,
                    trim: j > 0 && plan[n - j].trim,
                    mirror: x.mirror,
                })
                .collect(),
        );
    }
    if let Some(spacings) = &r.spacings {
        // Kept at their rung: measured along the other rail from its other end.
        let at = |s: f64| match r
            .rungs
            .as_ref()
            .and_then(|g| g.iter().find(|[a, _]| (a - s).abs() < 0.05))
        {
            Some(g) => lb - g[1],
            None => lb * (1.0 - s / la.max(1e-6)),
        };
        out.spacings = Some(spacings.iter().rev().map(|&[s, v]| [at(s), v]).collect());
    }
    out
}

/// The part of a rail from distance s0 to s1 along it.
fn sub_rail(rail: &[Pt], cum: &[f64], s0: f64, s1: f64) -> Vec<Pt> {
    let mut out = vec![point_at(rail, cum, s0)];
    for i in 0..rail.len() {
        if cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6 {
            out.push(rail[i]);
        }
    }
    out.push(point_at(rail, cum, s1));
    out
}

/// The sections of a column cut across by its cut lines, each with the rungs and spacings that lie
/// in it; the column itself when it has none.
pub fn sections_of(r: &Rails) -> Vec<Rails> {
    if r.spans.as_ref().is_some_and(|s| !s.is_empty()) {
        return with_spans(r);
    }
    let Some(cuts) = r.cuts.as_ref().filter(|c| !c.is_empty()) else {
        return vec![r.clone()];
    };
    let cl = cumulative(&r.left);
    let cr = cumulative(&r.right);
    let la = last(&cl);
    let lb = last(&cr);
    let cuts = tidy_rungs(cuts, la, lb);
    if cuts.is_empty() {
        let mut one = r.clone();
        one.cuts = None;
        return vec![one];
    }
    let mut out = vec![];
    let spacings_in = |s0: f64, s1: f64, off: f64| -> Option<Vec<[f64; 2]>> {
        let sp: Vec<[f64; 2]> = r
            .spacings
            .as_ref()?
            .iter()
            .filter(|[s, _]| *s >= s0 && *s <= s1)
            .map(|&[s, v]| [s - off, v])
            .collect();
        (!sp.is_empty()).then_some(sp)
    };
    let Some(rungs) = &r.rungs else {
        // Paired by index (the stitches' own direction): cut where the left rail is nearest.
        let at: Vec<usize> = cuts
            .iter()
            .map(|&[a, _]| {
                let mut k = 0;
                for i in 1..cl.len() {
                    if (cl[i] - a).abs() < (cl[k] - a).abs() {
                        k = i;
                    }
                }
                k
            })
            .collect();
        let mut ks = vec![0];
        for (i, &k) in at.iter().enumerate() {
            if k > 0 && k < r.left.len() - 1 && (i == 0 || k > at[i - 1]) {
                ks.push(k);
            }
        }
        ks.push(r.left.len() - 1);
        for j in 0..ks.len() - 1 {
            let s0 = cl[ks[j]];
            let s1 = cl[ks[j + 1]];
            let mut sec = Rails::new(
                r.left[ks[j]..=ks[j + 1]].to_vec(),
                r.right[ks[j]..=ks[j + 1]].to_vec(),
            );
            sec.spacings = spacings_in(s0, s1, s0);
            out.push(sec);
        }
        return out;
    };
    let mut bounds = vec![[0.0, 0.0]];
    bounds.extend(cuts);
    bounds.push([la, lb]);
    for k in 0..bounds.len() - 1 {
        let [a0, b0] = bounds[k];
        let [a1, b1] = bounds[k + 1];
        let mut sec = Rails::new(
            sub_rail(&r.left, &cl, a0, a1),
            sub_rail(&r.right, &cr, b0, b1),
        );
        sec.rungs = Some(
            rungs
                .iter()
                .filter(|&&[a, b]| a > a0 && a < a1 && b > b0 && b < b1)
                .map(|&[a, b]| [a - a0, b - b0])
                .collect(),
        );
        sec.spacings = spacings_in(a0, a1, a0);
        out.push(sec);
    }
    out
}

/// A section of a column as a closed outline (see SectionLoop in restitch.ts).
#[derive(Clone, Debug, Serialize)]
pub struct SectionLoop {
    pub ring: Vec<Pt>,
    pub cum: Vec<f64>,
    pub start: [f64; 2],
    pub end: [f64; 2],
    pub from: Rung,
    pub to: Rung,
}

/// Each section of the column (between its cut lines) as a closed outline.
pub fn section_loops(r: &Rails) -> Vec<SectionLoop> {
    let cl = cumulative(&r.left);
    let cr = cumulative(&r.right);
    let la = last(&cl);
    let lb = last(&cr);
    let mut bounds = vec![[0.0, 0.0]];
    bounds.extend(tidy_rungs(r.cuts.as_deref().unwrap_or(&[]), la, lb));
    bounds.push([la, lb]);
    let mut out = vec![];
    for k in 0..bounds.len() - 1 {
        let [a0, b0] = bounds[k];
        let [a1, b1] = bounds[k + 1];
        let l = sub_rail(&r.left, &cl, a0, a1);
        let mut rr = sub_rail(&r.right, &cr, b0, b1);
        rr.reverse();
        let mut ring = l.clone();
        ring.extend(&rr);
        ring.push(l[0]);
        let cum = cumulative(&ring);
        let n = ring.len();
        out.push(SectionLoop {
            end: [cum[l.len() - 1], cum[l.len()]],
            start: [cum[n - 2], cum[n - 1]],
            ring,
            cum,
            from: [a0, b0],
            to: [a1, b1],
        });
    }
    out
}

/// The section a free rung lies in (its middle inside the section's outline).
pub fn section_of_rung(loops: &[SectionLoop], [a, b]: [Pt; 2]) -> Option<usize> {
    let m = mid(a, b);
    loops.iter().position(|l| inside_poly(&l.ring, m))
}

/// A section with free rungs as a column of its own (see spanSection in restitch.ts).
pub fn span_section(loop_: &SectionLoop, plain: &[Rung], spans: &[[Pt; 2]]) -> Option<Rails> {
    let ring = &loop_.ring;
    let cum = &loop_.cum;
    let lb = loop_.to[1] - loop_.from[1];
    let mut chords: Vec<[f64; 2]> = plain
        .iter()
        .map(|&[a, b]| [a, loop_.end[1] + (lb - b)])
        .collect();
    for &[a, b] in spans {
        chords.push([
            project(ring, cum, a, 0.0, f64::INFINITY).0,
            project(ring, cum, b, 0.0, f64::INFINITY).0,
        ]);
    }
    let strip = strip_of_loop(ring, &chords, &[loop_.start, loop_.end], false)?;
    let mut out = Rails::new(strip.left, strip.right);
    out.rungs = Some(strip.rungs);
    Some(out)
}

/// Sections of a column with free rungs: those with any sewn as columns of their own.
fn with_spans(r: &Rails) -> Vec<Rails> {
    let mut base = r.clone();
    base.rungs = Some(r.rungs.clone().unwrap_or_default());
    base.spans = None;
    let plain = sections_of(&base);
    let loops = section_loops(&base);
    if loops.len() != plain.len() {
        return plain;
    }
    let start_of = |x: &Rails| mid(x.left[0], x.right[0]);
    let end_of = |x: &Rails| mid(last(&x.left), last(&x.right));
    let spans = r.spans.as_deref().unwrap_or(&[]);
    let mut out: Vec<Rails> = vec![];
    for (k, sec) in plain.into_iter().enumerate() {
        let free: Vec<[Pt; 2]> = spans
            .iter()
            .filter(|f| section_of_rung(&loops, **f) == Some(k))
            .copied()
            .collect();
        let own = if free.is_empty() {
            None
        } else {
            span_section(&loops[k], sec.rungs.as_deref().unwrap_or(&[]), &free)
        };
        let Some(fwd) = own else {
            out.push(sec);
            continue;
        };
        // Walked from the end nearer to where the column comes from.
        let from = match out.last() {
            Some(x) => end_of(x),
            None => start_of(&base),
        };
        out.push(if dist(end_of(&fwd), from) < dist(start_of(&fwd), from) {
            reversed_rails(&fwd)
        } else {
            fwd
        });
    }
    out
}

/// Spacing grows on narrow columns and shrinks on wide ones, 1 at 4 mm.
pub fn width_factor(w: f64) -> f64 {
    if w <= 2.0 {
        1.2
    } else if w <= 4.0 {
        1.2 - ((w - 2.0) / 2.0) * 0.2
    } else if w <= 6.0 {
        1.0 - ((w - 4.0) / 2.0) * 0.1
    } else {
        0.9
    }
}

/// The spacing at each point of the column (None when even): see spacingAlong in restitch.ts.
pub fn spacing_along(c: &Column, r: &Rails, base: f64, by_width: bool) -> Option<Vec<f64>> {
    if !r.spacings.as_ref().is_some_and(|s| !s.is_empty()) && !by_width {
        return None;
    }
    let cum = cumulative(&c.left);
    let la = last(&cum);
    let mut ctrl: Vec<[f64; 2]> = vec![[0.0, base], [la, base]];
    for &[a, _] in r.rungs.as_deref().unwrap_or(&[]) {
        ctrl.push([a, base]);
    }
    for &[s, v] in r.spacings.as_deref().unwrap_or(&[]) {
        match ctrl.iter().position(|[x, _]| (x - s).abs() < 0.05) {
            Some(near) => ctrl[near] = [s, v],
            None => ctrl.push([s, v]),
        }
    }
    ctrl.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap_or(std::cmp::Ordering::Equal));
    Some(
        cum.iter()
            .enumerate()
            .map(|(i, &s)| {
                let mut k = 0;
                while k + 2 < ctrl.len() && ctrl[k + 1][0] <= s {
                    k += 1;
                }
                let [x0, v0] = ctrl[k];
                let [x1, v1] = ctrl[(k + 1).min(ctrl.len() - 1)];
                let v = if x1 > x0 {
                    v0 + (v1 - v0) * ((s - x0) / (x1 - x0)).clamp(0.0, 1.0)
                } else {
                    v0
                };
                if by_width {
                    v * width_factor(dist(c.left[i], c.right[i]))
                } else {
                    v
                }
            })
            .collect(),
    )
}

/// Settings for the columns walked from the other end: what was right is left now.
pub fn swapped_sides(s: &SatinSettings) -> SatinSettings {
    let mut out = s.clone();
    if let Some(b) = s.edge_b {
        out.edge = b;
        out.edge_b = Some(s.edge);
    }
    if let Some(b) = s.edge_share_b {
        out.edge_share = Some(b);
        out.edge_share_b = Some(s.edge_share.unwrap_or(0.0));
    }
    if let Some(side) = s.fringe_side {
        out.fringe_side = Some(side.other());
    }
    out
}

/// How deep the fringe is on the rails `left` and `right` (mm); an E stitch has none.
fn fringe_of(s: &SatinSettings) -> [f64; 2] {
    let f = if s.is_e() {
        0.0
    } else {
        s.fringe.unwrap_or(0.0).max(0.0)
    };
    [
        if s.fringe_side == Some(FringeSide::Left) {
            0.0
        } else {
            f
        },
        if s.fringe_side == Some(FringeSide::Right) {
            0.0
        } else {
            f
        },
    ]
}

/// The irregular satin of settings `s` (an E stitch has none): its strength, 0 for none.
fn rough_of(s: &SatinSettings) -> f64 {
    if s.is_e() {
        0.0
    } else {
        s.rough.unwrap_or(0.0).clamp(0.0, 1.0)
    }
}

/// The satin's parameters for `pairs` and its stitches.
pub fn satin_params(s: &SatinSettings) -> SatinParams {
    let [a, b] = fringe_of(s);
    let rough = rough_of(s);
    let some = |v: f64| v != 0.0 && !v.is_nan();
    SatinParams {
        spacing: s.spacing,
        pull: s.edge,
        pull_b: s.edge_b,
        pull_share: Some(s.edge_share.unwrap_or(0.0)),
        pull_share_b: s.edge_share_b,
        split_mm: s.split.unwrap_or(SATIN_SPLIT_MM),
        short: Some(s.short && !s.is_e()),
        stagger: Some(s.stagger.unwrap_or(true)),
        fringe: (some(a) || some(b)).then_some(a),
        fringe_b: (some(a) || some(b)).then_some(b),
        lead: s.lead.filter(|&v| some(v)),
        rough: some(rough).then_some(rough),
        seed: some(rough).then(|| s.rough_seed.unwrap_or(0.0)),
        spacing_at: None,
    }
}

/// Seeds of the columns of an object this far apart (a prime), so no two irregular columns look alike.
const COLUMN_SEED: f64 = 7919.0;

/// How the satin stitches of settings `s` are made, and their spacing along a column.
struct Sewing {
    by_width: bool,
    e: bool,
    sp: SatinParams,
}

impl Sewing {
    fn of(s: &SatinSettings) -> Sewing {
        Sewing {
            by_width: s.by_width,
            e: s.is_e(),
            sp: satin_params(s),
        }
    }

    fn sew(&self, ps: &[Pair]) -> Vec<Pt> {
        if self.e {
            e_stitches(ps, &self.sp)
        } else {
            satin_stitches(ps, &self.sp)
        }
    }

    /// The parameters along column `col` of rails `r`; for the k-th column of an object an
    /// irregular satin gets a seed of its own (seeded in restitch.ts).
    fn along(&self, col: &Column, r: &Rails, q: &SatinParams, k: usize) -> SatinParams {
        let mut p = q.clone();
        if let Some(at) = spacing_along(col, r, q.spacing, self.by_width) {
            p.spacing_at = Some(at);
        }
        if k > 0 && yes(p.rough) {
            p.seed = Some(p.seed.unwrap_or(0.0) + COLUMN_SEED * k as f64);
        }
        p
    }

    /// Satin of a column or section that starts on its other rail when it is mirrored.
    fn sided(&self, r: &Rails, ps: Vec<Pair>) -> Vec<Pt> {
        if r.mirror {
            let swapped: Vec<Pair> = ps.into_iter().map(|[a, b]| [b, a]).collect();
            self.sew(&swapped)
        } else {
            self.sew(&ps)
        }
    }
}

// Push compensation: see the comment on PUSH_MAX in restitch.ts.
const PUSH_MAX: f64 = 0.5;
const PUSH_TOUCH: f64 = 0.3;
const PUSH_REACH: f64 = 1.0;

/// The outline of a column (both rails, closed), a point every few tenths.
fn outline_of(r: &Rails) -> Vec<Pt> {
    let mut out: Vec<Pt> = vec![];
    let all = r
        .left
        .iter()
        .chain(r.right.iter().rev())
        .chain(std::iter::once(&r.left[0]));
    for &q in all {
        if out.is_empty() || dist(last(&out), q) >= 0.3 {
            out.push(q);
        }
    }
    out
}

/// Whether the end `q` touches outline `o` (its box and `PUSH_TOUCH` around it).
fn touches(q: Pt, o: &[Pt], b: &[f64; 4]) -> bool {
    if q[0] < b[0] - PUSH_TOUCH
        || q[0] > b[2] + PUSH_TOUCH
        || q[1] < b[1] - PUSH_TOUCH
        || q[1] > b[3] + PUSH_TOUCH
    {
        return false;
    }
    if inside_poly(o, q) {
        return true;
    }
    (1..o.len()).any(|i| to_segment(q, o[i - 1], o[i]) < PUSH_TOUCH)
}

/// The free ends of the columns `rails` (one object) and how much each is shortened; none unless
/// the satin follows the fabric.
pub fn push_ends(rails: &[Rails], s: &SatinSettings) -> Vec<PushEnd> {
    if !s.edge_auto || s.is_e() || rails.is_empty() {
        return vec![];
    }
    let outlines: Vec<Vec<Pt>> = rails.iter().map(outline_of).collect();
    let boxes: Vec<[f64; 4]> = outlines.iter().map(|o| bounds_of(o)).collect();
    let pull = (s.edge + s.edge_b.unwrap_or(s.edge)) / 2.0;
    let mut out = vec![];
    for (k, r) in rails.iter().enumerate() {
        if r.left.len() < 2 || r.right.len() < 2 {
            continue;
        }
        let a = mid(r.left[0], r.right[0]);
        let b = mid(last(&r.left), last(&r.right));
        if dist(a, b) < PUSH_TOUCH {
            continue;
        }
        let col = column_of(r);
        let cum = cumulative(&col.center);
        let len = last(&cum);
        for (at, from_end) in [(a, false), (b, true)] {
            if (0..outlines.len()).any(|j| j != k && touches(at, &outlines[j], &boxes[j])) {
                continue;
            }
            let mut w: f64 = 0.0;
            for i in 0..cum.len() {
                if (if from_end { len - cum[i] } else { cum[i] }) <= PUSH_REACH {
                    w = w.max(dist(col.left[i], col.right[i]));
                }
            }
            let mm = PUSH_MAX.min(pull + w * s.edge_share.unwrap_or(0.0));
            if mm > 0.01 {
                out.push(PushEnd { at, mm });
            }
        }
    }
    out
}

/// Parts of one satin overlap where they meet by this in all (mm): see SEAM_OVERLAP in restitch.ts.
pub const SEAM_OVERLAP: f64 = 0.3;

/// The ends of the columns `rails` (one object) that meet another column, each lengthened.
pub fn seam_ends(rails: &[Rails], s: &SatinSettings) -> Vec<PushEnd> {
    if s.is_e() || rails.is_empty() {
        return vec![];
    }
    let outlines: Vec<Vec<Pt>> = rails.iter().map(outline_of).collect();
    let boxes: Vec<[f64; 4]> = outlines.iter().map(|o| bounds_of(o)).collect();
    let mut out = vec![];
    for (k, r) in rails.iter().enumerate() {
        if r.left.len() < 2 || r.right.len() < 2 {
            continue;
        }
        let a = mid(r.left[0], r.right[0]);
        let b = mid(last(&r.left), last(&r.right));
        if dist(a, b) < PUSH_TOUCH {
            continue;
        }
        for at in [a, b] {
            if (0..outlines.len()).any(|j| j != k && touches(at, &outlines[j], &boxes[j])) {
                out.push(PushEnd {
                    at,
                    mm: -SEAM_OVERLAP / 2.0,
                });
            }
        }
    }
    out
}

/// A column taken on beyond its ends by `s0` and `s1` (mm), each rail straight on along its last step.
fn lengthened(col: &Column, s0: f64, s1: f64) -> Column {
    let on = |line: Vec<Pt>, at_end: bool, mm: f64| -> Vec<Pt> {
        if mm <= 0.0 || line.is_empty() {
            return line;
        }
        let p = if at_end { last(&line) } else { line[0] };
        let q = if at_end {
            line.iter().rev().find(|x| dist(**x, p) > 1e-6).copied()
        } else {
            line.iter().find(|x| dist(**x, p) > 1e-6).copied()
        };
        let e = match q {
            Some(q) => {
                let l = dist(p, q);
                [
                    p[0] + ((p[0] - q[0]) / l) * mm,
                    p[1] + ((p[1] - q[1]) / l) * mm,
                ]
            }
            None => [p[0], p[1]],
        };
        let mut out = line;
        if at_end {
            out.push(e);
        } else {
            out.insert(0, e);
        }
        out
    };
    let both = |line: &[Pt]| on(on(line.to_vec(), false, s0), true, s1);
    Column {
        center: both(&col.center),
        left: both(&col.left),
        right: both(&col.right),
        width: col.width,
    }
}

/// A column shortened by push compensation keeps at least this share of it at each end.
const PUSH_SHARE: f64 = 0.25;

/// The column shortened at the ends `ends` names (see push_ends), else as it is.
pub fn pushed_column(col: Column, ends: Option<&[PushEnd]>) -> Column {
    let Some(ends) = ends.filter(|e| !e.is_empty()) else {
        return col;
    };
    if col.center.len() < 2 {
        return col;
    }
    let n = col.center.len();
    let near = |q: Pt| {
        ends.iter()
            .find(|e| dist(e.at, q) < 1e-3)
            .map_or(0.0, |e| e.mm)
    };
    let cum = cumulative(&col.center);
    let len = cum[n - 1];
    let m0 = near(mid(col.left[0], col.right[0]));
    let m1 = near(mid(col.left[n - 1], col.right[n - 1]));
    // Ends that meet another column are taken on (see seam_ends), free ends shortened.
    let s0 = m0.max(0.0).min(len * PUSH_SHARE);
    let s1 = m1.max(0.0).min(len * PUSH_SHARE);
    let on = |c: Column| {
        if m0 < 0.0 || m1 < 0.0 {
            lengthened(&c, -m0.min(0.0), -m1.min(0.0))
        } else {
            c
        }
    };
    if s0 == 0.0 && s1 == 0.0 {
        return on(col);
    }
    let at = |s: f64| {
        let mut i = 1;
        while i < n - 1 && cum[i] < s {
            i += 1;
        }
        let t = if cum[i] > cum[i - 1] {
            ((s - cum[i - 1]) / (cum[i] - cum[i - 1])).clamp(0.0, 1.0)
        } else {
            0.0
        };
        (
            i,
            lerp(col.left[i - 1], col.left[i], t),
            lerp(col.right[i - 1], col.right[i], t),
            lerp(col.center[i - 1], col.center[i], t),
        )
    };
    let (ai, al, ar, ac) = at(s0);
    let (bi, bl, br, bc) = at(len - s1);
    let keep = |arr: &[Pt], first: Pt, end: Pt| -> Vec<Pt> {
        let mut out = vec![first];
        if ai < bi {
            for (j, &q) in arr[ai..bi].iter().enumerate() {
                if cum[ai + j] > s0 && cum[ai + j] < len - s1 {
                    out.push(q);
                }
            }
        }
        out.push(end);
        out
    };
    on(Column {
        center: keep(&col.center, ac, bc),
        left: keep(&col.left, al, bl),
        right: keep(&col.right, ar, br),
        width: col.width,
    })
}

/// The column of `r` as satin_runs sews it with `s`: shortened at its free ends, taken on where it
/// meets another.
fn column_for(r: &Rails, s: &SatinSettings) -> Column {
    pushed_column(column_of(r), s.push.as_deref())
}

/// How far a satin's underlay keeps inside its rails, as its settings say.
fn under_inset(s: &SatinSettings) -> UnderInset {
    UnderInset {
        mm: s.under_inset,
        share: s.under_inset_share,
    }
}

/// The underlay of a column sewn with `s`: inside the fringe, where every stitch covers it.
fn under_of(c: &Column, s: &SatinSettings, one_way: bool) -> crate::digitize::satin::Under {
    // An irregular satin falls short of its rails by up to ROUGH_IN of the width: the underlay keeps inside that too.
    let short = rough_of(s) * ROUGH_IN * c.width;
    let [a, b] = fringe_of(s);
    underlay_of(
        &fringed_column(c, a + short, b + short),
        s.under.unwrap_or(UnderlayKind::Auto),
        s.tolerance,
        Some(under_inset(s)),
        one_way,
        s.under_cross,
    )
}

/// Longest stitch of the run joining two sections that do not meet (mm).
const TRAVEL_STEP: f64 = 2.5;

fn reversed_column(col: &Column) -> Column {
    Column {
        center: col.center.iter().rev().copied().collect(),
        left: col.right.iter().rev().copied().collect(),
        right: col.left.iter().rev().copied().collect(),
        width: col.width,
    }
}

/// Whether sections of a column that follow one another do not meet (one sewn as a column of its own).
fn apart_of(parts: &[Rails]) -> bool {
    parts.windows(2).any(|w| {
        let (r, n) = (&w[0], &w[1]);
        dist(last(&r.left), n.left[0]) + dist(last(&r.right), n.right[0]) > 1.0
    })
}

/// Whether section_run sews the satin of these sections back: the last first, each from its end.
pub fn sewn_back(parts: &[Rails], s: &SatinSettings) -> bool {
    if apart_of(parts) {
        return true;
    }
    s.underlay
        && parts
            .iter()
            .all(|r| under_of(&column_of(r), s, false).at_end)
}

/// The steps a column's sections are sewn in: its plan, or as section_run sews them.
pub fn section_plan(r: &Rails, s: &SatinSettings) -> Vec<SectionStep> {
    let secs = sections_of(r);
    if plan_fits(r.plan.as_deref(), secs.len()) {
        return r.plan.clone().unwrap();
    }
    let n = secs.len();
    let back = n > 1 && sewn_back(&secs, s);
    (0..n)
        .map(|i| {
            if back {
                SectionStep {
                    sec: (n - 1 - i) as f64,
                    flip: true,
                    trim: false,
                    mirror: false,
                }
            } else {
                SectionStep {
                    sec: i as f64,
                    flip: false,
                    trim: false,
                    mirror: false,
                }
            }
        })
        .collect()
}

/// Points joined on: a section that does not meet the one before is joined by a run between them.
fn push_joined(out: &mut Vec<Pt>, pts: Vec<Pt>) {
    if let (Some(&l), Some(&p0)) = (out.last(), pts.first()) {
        let d = dist(l, p0);
        let n = (d / TRAVEL_STEP).ceil() as usize;
        for j in 1..n {
            out.push([
                l[0] + ((p0[0] - l[0]) * j as f64) / n as f64,
                l[1] + ((p0[1] - l[1]) * j as f64) / n as f64,
            ]);
        }
    }
    out.extend(pts);
}

/// A column in sections, sewn as one run without trims (see sectionRun in restitch.ts).
fn section_run(parts: &[Rails], s: &SatinSettings, sw: &Sewing, k: usize) -> Vec<Pt> {
    let sp = satin_params(s);
    let cols: Vec<Column> = parts.iter().map(|r| column_for(r, s)).collect();
    let mut out: Vec<Pt> = vec![];
    let apart = apart_of(parts);
    if !s.underlay && !apart {
        for (j, r) in parts.iter().enumerate() {
            let ps = pairs(&cols[j], &sw.along(&cols[j], r, &sp, k), None);
            push_joined(&mut out, sw.sided(r, ps));
        }
        return out;
    }
    let unders: Vec<crate::digitize::satin::Under> = cols
        .iter()
        .map(|c| {
            if s.underlay {
                under_of(c, s, false)
            } else {
                Default::default()
            }
        })
        .collect();
    if apart {
        for (j, c) in cols.iter().enumerate() {
            let mut pts = unders[j].pts.clone();
            if !unders[j].at_end {
                pts.extend(run_stitch(&c.center, TRAVEL_STEP, s.tolerance));
            }
            push_joined(&mut out, pts);
        }
    } else if !unders.iter().all(|u| u.at_end) {
        for (j, r) in parts.iter().enumerate() {
            let mut pts = unders[j].pts.clone();
            let ps = pairs(&cols[j], &sw.along(&cols[j], r, &sp, k), None);
            pts.extend(sw.sided(r, ps));
            push_joined(&mut out, pts);
        }
        return out;
    } else {
        for u in &unders {
            push_joined(&mut out, u.pts.clone());
        }
    }
    let back = satin_params(&swapped_sides(s));
    for j in (0..parts.len()).rev() {
        let rev = reversed_column(&cols[j]);
        let ps = pairs(
            &rev,
            &sw.along(&rev, &reversed_rails(&parts[j]), &back, k),
            None,
        );
        push_joined(&mut out, sw.sided(&parts[j], ps));
    }
    out
}

/// Sections sewn as `plan` says (see plannedRuns in restitch.ts); `sewn_in(step, run)` hears where
/// each step went.
fn planned_runs(
    secs: &[Rails],
    plan: &[SectionStep],
    s: &SatinSettings,
    sw: &Sewing,
    k: usize,
    mut sewn_in: impl FnMut(usize, usize),
) -> Vec<Run> {
    let mut runs: Vec<Run> = vec![];
    let mut held: Vec<usize> = vec![];
    let mut group: Vec<Rails> = vec![];
    let mut cut = false;
    let mut flush =
        |group: &mut Vec<Rails>, held: &mut Vec<usize>, cut: &mut bool, runs: &mut Vec<Run>| {
            if group.is_empty() {
                return;
            }
            let feed: Vec<Rails> = if sewn_back(group, s) {
                group.iter().rev().map(reversed_rails).collect()
            } else {
                group.clone()
            };
            let run = section_run(&feed, s, sw, k);
            if !run.is_empty() {
                let mut run = Run::new(run);
                run.trim = *cut;
                for &i in held.iter() {
                    sewn_in(i, runs.len());
                }
                runs.push(run);
            }
            *cut = false;
            group.clear();
            held.clear();
        };
    for (i, x) in plan.iter().enumerate() {
        if x.trim && i > 0 {
            flush(&mut group, &mut held, &mut cut, &mut runs);
            cut = true;
        }
        held.push(i);
        let mut sec = if x.flip {
            reversed_rails(&secs[x.sec as usize])
        } else {
            secs[x.sec as usize].clone()
        };
        if x.mirror {
            sec.mirror = true;
        }
        group.push(sec);
    }
    flush(&mut group, &mut held, &mut cut, &mut runs);
    runs
}

/// A column of a chain on its own: out along it and the satin back to its start.
fn column_run(r: &Rails, s: &SatinSettings, sw: &Sewing, k: usize) -> Vec<Pt> {
    let secs = sections_of(r);
    if secs.len() > 1 {
        return section_run(&secs, s, sw, k);
    }
    let col = column_for(&secs[0], s);
    let rev = reversed_column(&col);
    let satin_back = || {
        let q = satin_params(&swapped_sides(s));
        let ps = pairs(
            &rev,
            &sw.along(&rev, &reversed_rails(&secs[0]), &q, k),
            None,
        );
        sw.sided(r, ps)
    };
    // Out and back without a run along the middle: the zigzag sewn out only.
    if s.underlay {
        let under = under_of(&col, s, true);
        if under.at_end {
            let mut out = under.pts;
            out.extend(satin_back());
            return out;
        }
    }
    let mut out = run_stitch(&col.center, TRAVEL_STEP, s.tolerance);
    if s.underlay {
        out.extend(under_of(&rev, &swapped_sides(s), false).pts);
    }
    out.extend(satin_back());
    out
}

/// A piece of a satin part as satin_runs sews it (see SewnStep in restitch.ts).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SewnStep {
    pub col: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<usize>,
    pub run: usize,
    pub along: (Vec<Pt>, Vec<Pt>),
    #[serde(skip_serializing_if = "Option::is_none")]
    pub way: Option<Vec<Pt>>,
}

fn back_of(r: &Rails) -> (Vec<Pt>, Vec<Pt>) {
    (
        r.left.iter().rev().copied().collect(),
        r.right.iter().rev().copied().collect(),
    )
}

fn step_along(secs: &[Rails], x: &SectionStep) -> (Vec<Pt>, Vec<Pt>) {
    let sec = &secs[x.sec as usize];
    if x.flip {
        back_of(sec)
    } else {
        (sec.left.clone(), sec.right.clone())
    }
}

/// Satin along each pair of rails: with underlay, the underlay first and the satin over it the
/// other way. `steps`, when given, hears where each piece went (see SewnStep).
pub fn satin_runs(
    rails: &[Rails],
    given: &SatinSettings,
    mut steps: Option<&mut Vec<SewnStep>>,
) -> Vec<Run> {
    let mut ends = push_ends(rails, given);
    ends.extend(seam_ends(rails, given));
    let s = if ends.is_empty() {
        given.clone()
    } else {
        let mut s = given.clone();
        s.push = Some(ends);
        s
    };
    let mut runs: Vec<Run> = vec![];
    let mut chained: Vec<bool> = vec![];
    let sp = satin_params(&s);
    let sw = Sewing::of(&s);
    let mut k = 0;
    while k < rails.len() {
        let whole = &rails[k];
        // Columns in one chain: sewn on one after the other without a trim, each back to its start.
        if let Some(c) = whole.chain {
            let first = k;
            while k < rails.len() && rails[k].chain == Some(c) {
                k += 1;
            }
            let chain = &rails[first..k];
            let mut ways: Vec<Option<Vec<Pt>>> = vec![];
            let run = chain_run(chain, &s, &sw, first, Some(&mut ways));
            if !run.is_empty() {
                if let Some(steps) = steps.as_deref_mut() {
                    for (j, way) in ways.into_iter().enumerate() {
                        if let Some(way) = way {
                            steps.push(SewnStep {
                                col: first + j,
                                step: None,
                                run: runs.len(),
                                along: back_of(&chain[j]),
                                way: (!way.is_empty()).then_some(way),
                            });
                        }
                    }
                }
                runs.push(Run::new(run));
                chained.push(true);
            }
            continue;
        }
        let parts = sections_of(whole);
        if parts.len() > 1 && plan_fits(whole.plan.as_deref(), parts.len()) {
            let before = runs.len();
            let plan = whole.plan.as_deref().unwrap();
            let mut heard: Vec<(usize, usize)> = vec![];
            let got = planned_runs(&parts, plan, &s, &sw, k, |step, run| {
                heard.push((step, run))
            });
            if let Some(steps) = steps.as_deref_mut() {
                for (step, run) in heard {
                    steps.push(SewnStep {
                        col: k,
                        step: Some(step),
                        run: before + run,
                        along: step_along(&parts, &plan[step]),
                        way: None,
                    });
                }
            }
            chained.extend(got.iter().map(|_| false));
            runs.extend(got);
            k += 1;
            continue;
        }
        if parts.len() > 1 {
            let run = section_run(&parts, &s, &sw, k);
            if !run.is_empty() {
                if let Some(steps) = steps.as_deref_mut() {
                    for (step, x) in section_plan(whole, &s).iter().enumerate() {
                        steps.push(SewnStep {
                            col: k,
                            step: Some(step),
                            run: runs.len(),
                            along: step_along(&parts, x),
                            way: None,
                        });
                    }
                }
                runs.push(Run::new(run));
                chained.push(false);
            }
            k += 1;
            continue;
        }
        let r = &parts[0];
        let col = column_for(r, &s);
        let ps = pairs(&col, &sw.along(&col, r, &sp, k), None);
        if ps.len() < 2 {
            k += 1;
            continue;
        }
        let under = s.underlay.then(|| under_of(&col, &s, false));
        // Its satin from the start, or back from the end after an underlay out.
        if let Some(steps) = steps.as_deref_mut() {
            steps.push(SewnStep {
                col: k,
                step: None,
                run: runs.len(),
                along: if under.as_ref().is_some_and(|u| u.at_end) {
                    back_of(r)
                } else {
                    (r.left.clone(), r.right.clone())
                },
                way: None,
            });
        }
        let run = match under {
            None => sw.sided(whole, ps),
            Some(u) if !u.at_end => {
                let mut out = u.pts;
                out.extend(sw.sided(whole, ps));
                out
            }
            Some(u) => {
                // Underlay out along the column, satin back (its sides swap with the direction).
                let rev = reversed_column(&col);
                let q = satin_params(&swapped_sides(&s));
                let back = pairs(&rev, &sw.along(&rev, &reversed_rails(r), &q, k), None);
                let mut out = u.pts;
                out.extend(sw.sided(whole, back));
                out
            }
        };
        runs.push(Run::new(run));
        chained.push(false);
        k += 1;
    }
    // Chains are cut apart from what comes before and after them, however near.
    for j in 1..runs.len() {
        if chained[j] || chained[j - 1] {
            runs[j].trim = true;
        }
    }
    runs
}

/// The stitch pairs of a column as it is sewn (each section on its own, with the spacing along it).
pub fn preview_pairs(r: &Rails, s: &SatinSettings) -> Vec<Vec<Pair>> {
    let sp = satin_params(s);
    let sw = Sewing::of(s);
    sections_of(r)
        .iter()
        .map(|sec| {
            let col = column_of(sec);
            pairs(&col, &sw.along(&col, sec, &sp, 0), None)
        })
        .collect()
}

/// Columns in one chain, sewn as one run without a trim (see chainRun in restitch.ts). `ways`, when
/// given, gets the way to each column (None where it sews nothing).
fn chain_run(
    cols: &[Rails],
    s: &SatinSettings,
    sw: &Sewing,
    first: usize,
    mut ways: Option<&mut Vec<Option<Vec<Pt>>>>,
) -> Vec<Pt> {
    let columns: Vec<Column> = cols.iter().map(|r| column_of(&sections_of(r)[0])).collect();
    let outlines: Vec<Vec<Pt>> = cols.iter().map(outline_of).collect();
    let mut model = WayModel::new(outlines, &columns);
    let mut later = vec![0u8; cols.len()];
    let mut out: Vec<Pt> = vec![];
    for (k, r) in cols.iter().enumerate() {
        let pts = column_run(r, s, sw, first + k);
        if let Some(w) = ways.as_deref_mut() {
            w.push(None);
        }
        if pts.is_empty() {
            continue;
        }
        // As a running stitch along the way: a stitch to each point of a middle would pile up needle holes.
        later[..k].fill(0);
        later[k..].fill(1);
        let way = match out.last() {
            Some(&from) => run_stitch(
                &model.between(from, pts[0], &later).0,
                TRAVEL_STEP,
                s.tolerance,
            ),
            None => vec![],
        };
        if way.len() > 1 {
            out.extend_from_slice(&way[1..]);
        }
        if let Some(w) = ways.as_deref_mut() {
            *w.last_mut().unwrap() = Some(way);
        }
        out.extend(pts);
    }
    out
}

/// Steps the ways between the columns of a chain are measured in (mm, see travel_of).
const TRAVEL_MEASURE: f64 = 0.1;

/// How the ways between the columns of one chain lie when sewn in this order: mm hidden under
/// columns sewn later, and mm in sight.
pub fn travel_of(cols: &[Rails], s: &SatinSettings) -> (f64, f64) {
    let sw = Sewing::of(s);
    let outlines: Vec<Vec<Pt>> = cols.iter().map(outline_of).collect();
    let columns: Vec<Column> = cols.iter().map(|r| column_of(&sections_of(r)[0])).collect();
    let mut model = WayModel::new(outlines.clone(), &columns);
    let mut later = vec![0u8; cols.len()];
    let mut from: Option<Pt> = None;
    let (mut hidden, mut visible) = (0.0, 0.0);
    for (k, r) in cols.iter().enumerate() {
        let pts = column_run(r, s, &sw, 0);
        if pts.is_empty() {
            continue;
        }
        later[..k].fill(0);
        later[k..].fill(1);
        if let Some(f) = from {
            let way = model.between(f, pts[0], &later).0;
            for i in 1..way.len() {
                let l = dist(way[i - 1], way[i]);
                let n = (l / TRAVEL_MEASURE).ceil().max(1.0) as usize;
                for j in 0..n {
                    let q = lerp(way[i - 1], way[i], (j as f64 + 0.5) / n as f64);
                    // Under a column sewn later (k itself is sewn right after the way, so it covers it too).
                    if (k..outlines.len()).any(|c| inside_poly(&outlines[c], q)) {
                        hidden += l / n as f64;
                    } else {
                        visible += l / n as f64;
                    }
                }
            }
        }
        from = Some(last(&pts));
    }
    (hidden, visible)
}

/// What the ways between the columns of a chain cost in the order given (as best_chain scores them).
pub fn chain_cost(cols: &[Rails], s: &SatinSettings) -> f64 {
    let sw = Sewing::of(s);
    let ends: Vec<Option<(Pt, Pt)>> = cols
        .iter()
        .map(|r| {
            let run = column_run(r, s, &sw, 0);
            (!run.is_empty()).then(|| (run[0], last(&run)))
        })
        .collect();
    let columns: Vec<Column> = cols.iter().map(|r| column_of(&sections_of(r)[0])).collect();
    let mut model = WayModel::new(cols.iter().map(outline_of).collect(), &columns);
    let mut later = vec![0u8; cols.len()];
    let mut v = 0.0;
    for k in 1..cols.len() {
        let (Some((_, b)), Some((a, _))) = (ends[k - 1], ends[k]) else {
            continue;
        };
        later[..k].fill(0);
        later[k..].fill(1);
        v += model.between(b, a, &later).1;
    }
    v
}

/// How much of each way between columns of `cols` shows (as the way model sees it): across the
/// fabric and over satin sewn before it; `later[k][j]` set where column j is still to be sewn.
pub fn shown_among(cols: &[Rails], ways: &[Vec<Pt>], later: &[Vec<u8>]) -> Vec<(f64, f64)> {
    let columns: Vec<Column> = cols.iter().map(|r| column_of(&sections_of(r)[0])).collect();
    let mut model = WayModel::new(cols.iter().map(outline_of).collect(), &columns);
    ways.iter()
        .zip(later)
        .map(|(w, l)| model.shown(w, l))
        .collect()
}

// --- The best order of a chain -----------------------------------------------------------------

/// Chains up to this many columns get their best order outright; longer ones are searched.
const EXACT_MAX: usize = 11;
/// Columns of a chain as bits in one number: up to this many.
const MASK_MAX: usize = 30;
/// What a change from the order given costs when it does not help otherwise.
const TIE: f64 = 1e-4;
/// How often a long chain's search is shaken up and searched again.
const SHAKES: usize = 12;

/// Which columns of a chain are still to be sewn, as flags and (up to MASK_MAX columns) as bits.
struct Later {
    n: usize,
    flags: Vec<u8>,
    mask: i32,
}

impl Later {
    fn new(n: usize) -> Later {
        Later {
            n,
            flags: vec![0; n],
            mask: 0,
        }
    }
    /// Only the columns not in `set` (bits) are still to be sewn.
    fn from(&mut self, set: i32) {
        let full: i32 = if self.n >= 31 {
            -1
        } else {
            (1i32 << self.n) - 1
        };
        self.mask = !set & full;
        if self.n > MASK_MAX {
            for j in 0..self.n {
                self.flags[j] = if (set >> (j & 31)) & 1 != 0 { 0 } else { 1 };
            }
        }
    }
    /// The columns at positions `lo` on of `cs` are still to be sewn.
    fn reset_from(&mut self, cs: &[usize], lo: usize) {
        self.mask = 0;
        for (k, &c) in cs.iter().enumerate() {
            let on = k >= lo;
            self.flags[c] = on as u8;
            if on && c < 31 {
                self.mask |= 1 << c;
            }
        }
    }
    /// Column c is sewn now.
    fn clear(&mut self, c: usize) {
        self.flags[c] = 0;
        if c < 31 {
            self.mask &= !(1 << c);
        }
    }
}

/// A column of a chain in its order: which, and sewn which way.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Step {
    pub c: usize,
    pub w: usize,
}

/// The columns of a chain as best_chain orders them (bestChain in restitch.ts): each turned round
/// or mirrored as its step says.
pub fn chained(cols: &[Rails], s: &SatinSettings) -> Vec<Rails> {
    best_chain(cols, s)
        .iter()
        .map(|st| {
            let c = &cols[st.c];
            let mut r = if st.w & 1 != 0 {
                reversed_rails(c)
            } else {
                c.clone()
            };
            if st.w & 2 != 0 {
                r.mirror = !c.mirror;
            }
            r
        })
        .collect()
}

/// The columns of a chain in the order, directions and sides that show the least of the way
/// between them (see bestChain in restitch.ts): which column at each place, and sewn which of the
/// four ways (as given, turned round, mirrored, both).
pub fn best_chain(cols: &[Rails], s: &SatinSettings) -> Vec<Step> {
    let n = cols.len();
    if n < 2 {
        return (0..n).map(|c| Step { c, w: 0 }).collect();
    }
    let sw = Sewing::of(s);
    // Where the runs start and end, each point once (the start is the same mirrored or not).
    let mut points: Vec<Pt> = vec![];
    let mut ids: HashMap<[u64; 2], i32> = HashMap::new();
    let mut id_of = |p: Option<Pt>| -> i32 {
        let Some(p) = p else { return -1 };
        let key = [key_bits(p[0]), key_bits(p[1])];
        *ids.entry(key).or_insert_with(|| {
            points.push(p);
            (points.len() - 1) as i32
        })
    };
    let mut starts = vec![-1i32; n * 4];
    let mut ends = vec![-1i32; n * 4];
    for (c, col) in cols.iter().enumerate() {
        let turned = reversed_rails(col);
        let mut mirrored = col.clone();
        mirrored.mirror = !col.mirror;
        let mut both = turned.clone();
        both.mirror = !col.mirror;
        for (w, r) in [col, &turned, &mirrored, &both].into_iter().enumerate() {
            let run = column_run(r, s, &sw, 0);
            starts[c * 4 + w] = id_of(run.first().copied());
            ends[c * 4 + w] = id_of(run.last().copied());
        }
    }
    let columns: Vec<Column> = cols.iter().map(|r| column_of(&sections_of(r)[0])).collect();
    let mut model = WayModel::new(cols.iter().map(outline_of).collect(), &columns);
    let np = points.len();
    // The ways tried from the end of one run to the start of another, costed once.
    let mut tried: Vec<Option<Vec<Costed>>> = vec![None; np * np];
    let mut later = Later::new(n);
    let mut cx = ChainCx {
        starts: &starts,
        ends: &ends,
        points: &points,
        tried: &mut tried,
        model: &mut model,
    };
    if n <= EXACT_MAX {
        exact_chain(n, &mut cx, &mut later)
    } else {
        searched_chain(n, &mut cx, &mut later)
    }
}

/// A coordinate as a key: the same for 0 and -0, as a string of the number is.
fn key_bits(v: f64) -> u64 {
    if v == 0.0 { 0 } else { v.to_bits() }
}

/// What the order search asks about the ways between columns.
struct ChainCx<'a> {
    starts: &'a [i32],
    ends: &'a [i32],
    points: &'a [Pt],
    tried: &'a mut Vec<Option<Vec<Costed>>>,
    model: &'a mut WayModel,
}

impl ChainCx<'_> {
    /// What the way from column c sewn way w to column d sewn way x costs, `later` still to be sewn.
    fn travel(&mut self, c: usize, w: usize, d: usize, x: usize, later: &Later) -> f64 {
        let p = self.ends[c * 4 + w];
        let q = self.starts[d * 4 + x];
        if p < 0 || q < 0 {
            return 0.0;
        }
        let key = p as usize * self.points.len() + q as usize;
        if self.tried[key].is_none() {
            let t = self
                .model
                .costed(self.points[p as usize], self.points[q as usize]);
            self.tried[key] = Some(t);
        }
        self.model.cost_of(self.tried[key].as_ref().unwrap(), later)
    }
    /// The least that way can cost: straight there.
    fn at_least(&self, c: usize, w: usize, d: usize, x: usize) -> f64 {
        let p = self.ends[c * 4 + w];
        let q = self.starts[d * 4 + x];
        if p < 0 || q < 0 {
            0.0
        } else {
            dist(self.points[p as usize], self.points[q as usize])
        }
    }
}

/// The best order of a short chain (Held-Karp over the sewn columns and the last of them).
fn exact_chain(n: usize, cx: &mut ChainCx, later: &mut Later) -> Vec<Step> {
    let nn = n * 4;
    let full = (1usize << n) - 1;
    let mut best = vec![f64::INFINITY; (full + 1) * nn];
    let mut from = vec![-1i64; (full + 1) * nn];
    // Among orders that cost the same, the one that changes the least.
    for c in 0..n {
        for w in 0..4 {
            best[(1 << c) * nn + c * 4 + w] = if w > 0 { TIE } else { 0.0 };
        }
    }
    for set in 1..full {
        let base = set * nn;
        later.from(set as i32);
        for c in 0..n {
            if (set >> c) & 1 == 0 {
                continue;
            }
            for w in 0..4 {
                let v = best[base + c * 4 + w];
                if v == f64::INFINITY {
                    continue;
                }
                for d in 0..n {
                    if (set >> d) & 1 != 0 {
                        continue;
                    }
                    let to = (set | (1 << d)) * nn + d * 4;
                    let u = v + if d == c + 1 { 0.0 } else { TIE };
                    for x in 0..4 {
                        let t = u + cx.travel(c, w, d, x, later) + if x > 0 { TIE } else { 0.0 };
                        if t < best[to + x] {
                            best[to + x] = t;
                            from[to + x] = (base + c * 4 + w) as i64;
                        }
                    }
                }
            }
        }
    }
    let mut end = full * nn;
    for k in full * nn..(full + 1) * nn {
        if best[k] < best[end] {
            end = k;
        }
    }
    let mut steps = vec![];
    let mut k = end as i64;
    while k >= 0 {
        let u = k as usize;
        steps.push(Step {
            c: (u % nn) / 4,
            w: u % 4,
        });
        k = from[u];
    }
    steps.reverse();
    steps
}

/// A change tried in the search: where the columns of the changed order are found in the order now.
#[derive(Clone, Copy)]
enum Pos {
    Id,
    /// A stretch of `len` from k moved to start at j (before k), turned round or not.
    Before {
        j: usize,
        k: usize,
        len: usize,
        turned: bool,
    },
    /// The same, to start at j after k.
    After {
        j: usize,
        k: usize,
        len: usize,
        turned: bool,
    },
    /// The stretch from k to j turned round.
    Rev {
        k: usize,
        j: usize,
    },
}

impl Pos {
    fn at(self, i: usize) -> usize {
        match self {
            Pos::Id => i,
            Pos::Before { j, k, len, turned } => {
                if i < j || i >= k + len {
                    i
                } else if i < j + len {
                    if turned {
                        k + len - 1 - (i - j)
                    } else {
                        k + i - j
                    }
                } else {
                    i - len
                }
            }
            Pos::After { j, k, len, turned } => {
                if i < k || i >= j + len {
                    i
                } else if i < j {
                    i + len
                } else if turned {
                    k + len - 1 - (i - j)
                } else {
                    k + i - j
                }
            }
            Pos::Rev { k, j } => {
                if i < k || i > j {
                    i
                } else {
                    k + j - i
                }
            }
        }
    }
}

/// The way each position is sewn in a change tried: as now, or one column another way.
#[derive(Clone, Copy)]
enum WayAt {
    Base,
    One { k: usize, w: usize },
}

struct Search<'a, 'b> {
    n: usize,
    cs: Vec<usize>,
    ws: Vec<usize>,
    pos: Pos,
    way: WayAt,
    terms: Vec<f64>,
    cx: &'a mut ChainCx<'b>,
    later: &'a mut Later,
}

impl Search<'_, '_> {
    fn way_at(&self, i: usize) -> usize {
        match self.way {
            WayAt::Base => self.ws[self.pos.at(i)],
            WayAt::One { k, w } => {
                if i == k {
                    w
                } else {
                    self.ws[i]
                }
            }
        }
    }
    /// What the ways into positions lo to hi cost, summed, in the changed order; Infinity once over `limit`.
    fn cost_of(&mut self, lo: usize, hi: usize, limit: f64) -> f64 {
        let lo = lo.max(1);
        self.later.reset_from(&self.cs, lo - 1);
        let mut v = 0.0;
        let mut c = self.cs[self.pos.at(lo - 1)];
        let mut w = self.way_at(lo - 1);
        for k in lo..=hi {
            let d = self.cs[self.pos.at(k)];
            let x = self.way_at(k);
            self.later.clear(c);
            v += self.cx.travel(c, w, d, x, self.later);
            if v >= limit {
                return f64::INFINITY;
            }
            c = d;
            w = x;
        }
        v
    }
    /// The least the ways into positions lo to hi can cost in the changed order.
    fn least_of(&self, lo: usize, hi: usize) -> f64 {
        let mut v = 0.0;
        for k in lo.max(1)..=hi {
            v += self.cx.at_least(
                self.cs[self.pos.at(k - 1)],
                self.way_at(k - 1),
                self.cs[self.pos.at(k)],
                self.way_at(k),
            );
        }
        v
    }
    fn refresh(&mut self) {
        self.pos = Pos::Id;
        self.way = WayAt::Base;
        for k in 1..self.n {
            self.terms[k] = self.cost_of(k, k, f64::INFINITY);
        }
    }
    fn sum(&self, lo: usize, hi: usize) -> f64 {
        let mut v = 0.0;
        for k in lo.max(1)..=hi {
            v += self.terms[k];
        }
        v
    }
    fn total(&self) -> f64 {
        self.sum(1, self.n - 1)
    }
    /// Costs the change set in pos and way over positions lo to hi; a better gain replaces `found`.
    fn offer(
        &mut self,
        lo: usize,
        hi: usize,
        gain: &mut f64,
        found: &mut Option<Change>,
        change: Change,
    ) {
        let hi = hi.min(self.n - 1);
        let now = self.sum(lo, hi);
        // Worth costing only where the ways could get cheaper by more than the best change so far.
        if now - self.least_of(lo, hi) <= *gain {
            return;
        }
        let g = now - self.cost_of(lo, hi, now - *gain);
        if g > *gain {
            *gain = g;
            *found = Some(change);
        }
    }
    fn apply(&mut self, change: Change) {
        let n = self.n;
        match change {
            Change::Way { k, w } => self.ws[k] = w,
            Change::Move { k, j, len, turned } => {
                let mut block: Vec<(usize, usize)> =
                    (0..len).map(|m| (self.cs[k + m], self.ws[k + m])).collect();
                if turned {
                    block.reverse();
                }
                let mut rest: Vec<(usize, usize)> = (0..n)
                    .filter(|&i| i < k || i >= k + len)
                    .map(|i| (self.cs[i], self.ws[i]))
                    .collect();
                rest.splice(j..j, block);
                for (i, (c, w)) in rest.into_iter().enumerate() {
                    self.cs[i] = c;
                    self.ws[i] = w;
                }
            }
            Change::Rev { k, j } => {
                let (mut a, mut b) = (k, j);
                while a < b {
                    self.cs.swap(a, b);
                    self.ws.swap(a, b);
                    a += 1;
                    b -= 1;
                }
            }
        }
    }
    /// A round over the columns: for each, the best change that moves or turns it, applied at once.
    fn improve(&mut self) -> bool {
        let n = self.n;
        let mut helped = false;
        for k in 0..n {
            let mut gain = 1e-6;
            let mut found: Option<Change> = None;
            // Sewn another way.
            self.pos = Pos::Id;
            for w in 0..4 {
                if w == self.ws[k] {
                    continue;
                }
                self.way = WayAt::One { k, w };
                self.offer(k, k + 1, &mut gain, &mut found, Change::Way { k, w });
            }
            self.way = WayAt::Base;
            // A stretch of len columns from k moved to start at j, turned round or not.
            let mut len = 1;
            while len <= 3 && k + len <= n {
                let mut j = 0;
                while j + len <= n {
                    if j != k {
                        let turns: &[bool] = if len > 1 { &[false, true] } else { &[false] };
                        for &turned in turns {
                            self.pos = if j < k {
                                Pos::Before { j, k, len, turned }
                            } else {
                                Pos::After { j, k, len, turned }
                            };
                            self.offer(
                                j.min(k),
                                j.max(k) + len,
                                &mut gain,
                                &mut found,
                                Change::Move { k, j, len, turned },
                            );
                        }
                    }
                    j += 1;
                }
                len += 1;
            }
            // A stretch from k to j turned round.
            for j in k + 3..n {
                self.pos = Pos::Rev { k, j };
                self.offer(k, j + 1, &mut gain, &mut found, Change::Rev { k, j });
            }
            self.pos = Pos::Id;
            if let Some(change) = found {
                self.apply(change);
                self.refresh();
                helped = true;
            }
        }
        helped
    }
    fn search(&mut self) {
        self.refresh();
        let mut round = 0;
        while round < 200 && self.improve() {
            round += 1;
        }
    }
}

#[derive(Clone, Copy)]
enum Change {
    Way {
        k: usize,
        w: usize,
    },
    Move {
        k: usize,
        j: usize,
        len: usize,
        turned: bool,
    },
    Rev {
        k: usize,
        j: usize,
    },
}

/// A good order of a long chain (see searchedChain in restitch.ts).
fn searched_chain(n: usize, cx: &mut ChainCx, later: &mut Later) -> Vec<Step> {
    let mut sr = Search {
        n,
        cs: (0..n).collect(),
        ws: vec![0; n],
        pos: Pos::Id,
        way: WayAt::Base,
        terms: vec![0.0; n],
        cx,
        later,
    };
    sr.search();
    let mut best = (sr.total(), sr.cs.clone(), sr.ws.clone());
    // Shaken up: from the best so far, two stretches swapped and a few columns sewn another way.
    let mut rnd = Random::new(f64::from(0x9e37_79b9u32));
    let mut random = || rnd.next();
    for _ in 0..SHAKES {
        sr.cs.copy_from_slice(&best.1);
        sr.ws.copy_from_slice(&best.2);
        let mut cuts: Vec<usize> = (0..3)
            .map(|_| 1 + (random() * (n - 1) as f64).floor() as usize)
            .collect();
        cuts.sort();
        let (a, b, c) = (cuts[0], cuts[1], cuts[2]);
        let seq: Vec<(usize, usize)> = (0..n).map(|i| (best.1[i], best.2[i])).collect();
        let shaken: Vec<(usize, usize)> = seq[..a]
            .iter()
            .chain(&seq[b..c])
            .chain(&seq[a..b])
            .chain(&seq[c..])
            .copied()
            .collect();
        for (i, (x, w)) in shaken.into_iter().enumerate() {
            sr.cs[i] = x;
            sr.ws[i] = w;
        }
        for _ in 0..2 {
            let i = (random() * n as f64).floor() as usize;
            sr.ws[i] = (random() * 4.0).floor() as usize;
        }
        sr.search();
        let v = sr.total();
        if v < best.0 - 1e-6 {
            best = (v, sr.cs.clone(), sr.ws.clone());
        }
    }
    (0..n)
        .map(|i| Step {
            c: best.1[i],
            w: best.2[i],
        })
        .collect()
}

// --- The ways between the columns of a chain ------------------------------------------------------

/// Cells of the grid an outline's edges are sorted into for GridInside (mm).
const GRID: f64 = 0.5;

/// Whether points lie inside a closed outline (even-odd), for very many points (see insideGridOf
/// in restitch.ts).
struct GridInside {
    ring: Vec<Pt>,
    banded: InsideTest,
    x0: f64,
    y0: f64,
    nx: usize,
    ny: usize,
    edges: Vec<Vec<u32>>,
    states: Vec<i8>,
}

impl GridInside {
    fn new(ring: &[Pt], b: &[f64; 4]) -> GridInside {
        let [x0, y0, x1, y1] = *b;
        let nx = (((x1 - x0) / GRID).floor() + 1.0).max(1.0) as usize;
        let ny = (((y1 - y0) / GRID).floor() + 1.0).max(1.0) as usize;
        let mut edges = vec![vec![]; nx * ny];
        let mut j = ring.len().wrapping_sub(1);
        for i in 0..ring.len() {
            let ([ax, ay], [bx, by]) = (ring[i], ring[j]);
            let cx0 = ((ax.min(bx) - x0) / GRID).floor() as usize;
            let cx1 = ((ax.max(bx) - x0) / GRID).floor() as usize;
            let cy0 = ((ay.min(by) - y0) / GRID).floor() as usize;
            let cy1 = ((ay.max(by) - y0) / GRID).floor() as usize;
            for cy in cy0..=cy1.min(ny - 1) {
                for cx in cx0..=cx1.min(nx - 1) {
                    edges[cy * nx + cx].push(i as u32);
                }
            }
            j = i;
        }
        GridInside {
            ring: ring.to_vec(),
            banded: InsideTest::new(ring),
            x0,
            y0,
            nx,
            ny,
            edges,
            states: vec![-1; nx * ny],
        }
    }

    fn test(&mut self, q: Pt) -> bool {
        let cx = ((q[0] - self.x0) / GRID).floor();
        let cy = ((q[1] - self.y0) / GRID).floor();
        if !(cx >= 0.0 && cy >= 0.0 && cx < self.nx as f64 && cy < self.ny as f64) {
            return false;
        }
        let (cx, cy) = (cx as usize, cy as usize);
        let cell = cy * self.nx + cx;
        let mx = self.x0 + (cx as f64 + 0.5) * GRID;
        let my = self.y0 + (cy as f64 + 0.5) * GRID;
        let mut state = self.states[cell];
        if state < 0 {
            state = self.banded.test([mx, my]) as i8;
            self.states[cell] = state;
        }
        let mut c = state != 0;
        let dx = q[0] - mx;
        let dy = q[1] - my;
        let ring = &self.ring;
        for &i in &self.edges[cell] {
            let i = i as usize;
            let j = if i == 0 { ring.len() - 1 } else { i - 1 };
            let [xi, yi] = ring[i];
            let [xj, yj] = ring[j];
            // Which side of the line from the middle to q each end lies on: the edge crosses it where
            // they differ; then where along the line, before q.
            let si = dx * (yi - my) - dy * (xi - mx);
            let sj = dx * (yj - my) - dy * (xj - mx);
            if (si > 0.0) == (sj > 0.0) {
                continue;
            }
            let f = si / (si - sj);
            let t = ((xi + (xj - xi) * f - mx) * dx + (yi + (yj - yi) * f - my) * dy)
                / (dx * dx + dy * dy);
            if (0.0..1.0).contains(&t) {
                c = !c;
            }
        }
        c
    }
}

/// Cells of the grid that says which columns a point may lie in (mm).
const CELL: f64 = 1.0;

/// A way in steps of at most a quarter mm, each step over a set of columns (see Walked).
struct Walked {
    way: Vec<Pt>,
    d: Vec<f64>,
    ends: Vec<usize>,
    len: Vec<f64>,
    at: Vec<usize>,
    over: Vec<usize>,
}

/// The key of a set of columns: bits up to MASK_MAX columns, else the list.
#[derive(Clone, PartialEq, Eq, Hash)]
enum Key {
    Mask(i32),
    List(Vec<usize>),
}

/// How much of a way lies over one set of columns (none: across the fabric).
#[derive(Clone)]
struct Group {
    len: f64,
    over: Vec<usize>,
    mask: i32,
}

/// Groups in the order their sets were first met, as a Map keeps them.
#[derive(Default, Clone)]
struct Groups {
    list: Vec<Group>,
    at: HashMap<Key, usize>,
}

/// A way between two columns, costed: its length over each set of columns, in all, and the least it can cost.
#[derive(Clone)]
struct Costed {
    groups: Vec<Group>,
    len: f64,
    floor: f64,
}

#[derive(Clone)]
struct Piece {
    groups: Vec<Group>,
    len: f64,
}

struct Prefix {
    keys: Vec<(Vec<usize>, i32)>,
    sums: Vec<Vec<f64>>,
    d: Vec<f64>,
}

struct Reach {
    to: Piece,
    up: Piece,
    down: Piece,
    i0: usize,
    i1: usize,
}

type PtKey = [u64; 2];
fn pk(p: Pt) -> PtKey {
    [p[0].to_bits(), p[1].to_bits()]
}

/// The ways from one column of a chain to the next (see wayModel in restitch.ts).
struct WayModel {
    n: usize,
    boxes: Vec<[f64; 4]>,
    tests: Vec<GridInside>,
    gx0: f64,
    gy0: f64,
    gw: usize,
    gh: usize,
    cells: Vec<Vec<usize>>,
    centers: Vec<(Vec<Pt>, Vec<f64>)>,
    pieces: HashMap<(PtKey, PtKey), Vec<Vec<usize>>>,
    along: HashMap<PtKey, Vec<(f64, Pt)>>,
    straight: HashMap<(PtKey, PtKey), std::rc::Rc<Walked>>,
    alongs: HashMap<(PtKey, PtKey), Vec<std::rc::Rc<Walked>>>,
    prefixes: Vec<Option<std::rc::Rc<Prefix>>>,
    reaches: HashMap<PtKey, std::rc::Rc<Vec<Reach>>>,
}

/// The first index in the rising list `xs` with a value above `x` (at or above with `or_at`).
fn first_above(xs: &[f64], x: f64, or_at: bool) -> usize {
    let (mut lo, mut hi) = (0, xs.len());
    while lo < hi {
        let m = (lo + hi) >> 1;
        if xs[m] > x || (or_at && xs[m] == x) {
            hi = m;
        } else {
            lo = m + 1;
        }
    }
    lo
}

/// How far along a line its nearest point to q lies.
fn nearest_along(line: &[Pt], cum: &[f64], q: Pt) -> f64 {
    let mut best = 0.0;
    let mut best_d = f64::INFINITY;
    for i in 1..line.len() {
        let [ax, ay] = line[i - 1];
        let vx = line[i][0] - ax;
        let vy = line[i][1] - ay;
        let l2 = vx * vx + vy * vy;
        let mut u = if l2 > 0.0 {
            ((q[0] - ax) * vx + (q[1] - ay) * vy) / l2
        } else {
            0.0
        };
        u = u.clamp(0.0, 1.0);
        let dx = ax + vx * u - q[0];
        let dy = ay + vy * u - q[1];
        let d = dx * dx + dy * dy;
        if d < best_d {
            best_d = d;
            best = cum[i - 1] + u * (cum[i] - cum[i - 1]);
        }
    }
    best
}

impl WayModel {
    fn new(outlines: Vec<Vec<Pt>>, columns: &[Column]) -> WayModel {
        let boxes: Vec<[f64; 4]> = outlines.iter().map(|o| bounds_of(o)).collect();
        let tests = outlines
            .iter()
            .zip(&boxes)
            .map(|(o, b)| GridInside::new(o, b))
            .collect();
        let (mut gx0, mut gy0, mut gx1, mut gy1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for b in &boxes {
            gx0 = gx0.min(b[0]);
            gy0 = gy0.min(b[1]);
            gx1 = gx1.max(b[2]);
            gy1 = gy1.max(b[3]);
        }
        let gw = (((gx1 - gx0) / CELL).ceil() + 1.0).max(1.0) as usize;
        let gh = (((gy1 - gy0) / CELL).ceil() + 1.0).max(1.0) as usize;
        let mut cells = vec![vec![]; gw * gh];
        for (j, b) in boxes.iter().enumerate() {
            let ya = ((b[1] - gy0) / CELL).floor() as usize;
            let yb = ((b[3] - gy0) / CELL).floor() as usize;
            let xa = ((b[0] - gx0) / CELL).floor() as usize;
            let xb = ((b[2] - gx0) / CELL).floor() as usize;
            for y in ya..=yb {
                for x in xa..=xb {
                    cells[y * gw + x].push(j);
                }
            }
        }
        let centers = columns
            .iter()
            .map(|c| (c.center.clone(), cumulative(&c.center)))
            .collect();
        WayModel {
            n: outlines.len(),
            boxes,
            tests,
            gx0,
            gy0,
            gw,
            gh,
            cells,
            centers,
            pieces: HashMap::new(),
            along: HashMap::new(),
            straight: HashMap::new(),
            alongs: HashMap::new(),
            prefixes: (0..columns.len()).map(|_| None).collect(),
            reaches: HashMap::new(),
        }
    }

    fn is_in(&mut self, j: usize, q: Pt) -> bool {
        let b = &self.boxes[j];
        q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3] && self.tests[j].test(q)
    }

    fn may_hold(&self, q: Pt) -> Vec<usize> {
        let x = ((q[0] - self.gx0) / CELL).floor();
        let y = ((q[1] - self.gy0) / CELL).floor();
        if x < 0.0 || y < 0.0 || x >= self.gw as f64 || y >= self.gh as f64 {
            return vec![];
        }
        self.cells[y as usize * self.gw + x as usize].clone()
    }

    /// The columns under each step of a piece of a way.
    fn over_of(&mut self, a: Pt, b: Pt, n: usize) -> Vec<Vec<usize>> {
        if let Some(v) = self.pieces.get(&(pk(a), pk(b))) {
            return v.clone();
        }
        let v: Vec<Vec<usize>> = (0..n)
            .map(|j| {
                let q = lerp(a, b, (j as f64 + 0.5) / n as f64);
                (0..self.n).filter(|&c| self.is_in(c, q)).collect()
            })
            .collect();
        self.pieces.insert((pk(a), pk(b)), v.clone());
        v
    }

    /// The way walked: which columns lie under each of its steps.
    fn walk(&mut self, way: Vec<Pt>) -> Walked {
        let mut w = Walked {
            d: vec![],
            ends: vec![],
            len: vec![],
            at: vec![0],
            over: vec![],
            way: vec![],
        };
        for i in 1..way.len() {
            let d = dist(way[i - 1], way[i]);
            let n = (d / 0.25).ceil().max(1.0) as usize;
            w.d.push(d);
            let mut last: Option<Vec<usize>> = None;
            for here in self.over_of(way[i - 1], way[i], n) {
                if last.as_ref() == Some(&here) {
                    *w.len.last_mut().unwrap() += d / n as f64;
                } else {
                    w.over.extend(&here);
                    w.at.push(w.over.len());
                    w.len.push(d / n as f64);
                    last = Some(here);
                }
            }
            w.ends.push(w.len.len());
        }
        w.way = way;
        w
    }

    /// What a walked way costs with `later`; stops counting once over `limit`.
    fn walked_cost(w: &Walked, later: &[u8], limit: f64) -> f64 {
        let mut seen = 0.0;
        let mut all = 0.0;
        let mut q = 0;
        for i in 0..w.d.len() {
            while q < w.ends[i] {
                let mut shows = if w.at[q] == w.at[q + 1] { 3.0 } else { 1.0 };
                let mut k = w.at[q];
                while k < w.at[q + 1] && shows != 0.0 {
                    if later[w.over[k]] != 0 {
                        shows = 0.0;
                    }
                    k += 1;
                }
                seen += shows * w.len[q];
                q += 1;
            }
            all += w.d[i];
            if seen * 1000.0 + all > limit {
                return f64::INFINITY;
            }
        }
        seen * 1000.0 + all
    }

    /// Where a point lies along the middle of each column.
    fn along_of(&mut self, q: Pt) -> Vec<(f64, Pt)> {
        if let Some(v) = self.along.get(&pk(q)) {
            return v.clone();
        }
        let v: Vec<(f64, Pt)> = self
            .centers
            .iter()
            .map(|(line, cum)| {
                let s = nearest_along(line, cum, q);
                (s, point_at(line, cum, s))
            })
            .collect();
        self.along.insert(pk(q), v.clone());
        v
    }

    /// The ways tried from one point to another: straight on first, then along the middle of each column.
    fn ways(&mut self, from: Pt, to: Pt) -> Vec<std::rc::Rc<Walked>> {
        let key = (pk(from), pk(to));
        let first = match self.straight.get(&key) {
            Some(w) => w.clone(),
            None => {
                let w = std::rc::Rc::new(self.walk(vec![from, to]));
                self.straight.insert(key, w.clone());
                w
            }
        };
        let rest = match self.alongs.get(&key) {
            Some(v) => v.clone(),
            None => {
                let af = self.along_of(from);
                let at = self.along_of(to);
                let mut v = vec![];
                for k in 0..self.centers.len() {
                    let (a, b) = (af[k], at[k]);
                    let (lo, hi) = if a.0 <= b.0 { (a, b) } else { (b, a) };
                    let (line, cum) = &self.centers[k];
                    let i0 = first_above(cum, lo.0 + 1e-6, false);
                    let i1 = first_above(cum, hi.0 - 1e-6, true);
                    let mut mid = vec![lo.1];
                    if i0 < i1 {
                        mid.extend_from_slice(&line[i0..i1]);
                    }
                    mid.push(hi.1);
                    if a.0 > b.0 {
                        mid.reverse();
                    }
                    let mut way = vec![from];
                    way.extend(mid);
                    way.push(to);
                    v.push(std::rc::Rc::new(self.walk(way)));
                }
                self.alongs.insert(key, v.clone());
                v
            }
        };
        let mut out = vec![first];
        out.extend(rest);
        out
    }

    /// The best way from one point to another and what it costs (`later[j]` set where column j is
    /// still to be sewn): seen less than a little, straight on.
    fn between(&mut self, from: Pt, to: Pt, later: &[u8]) -> (Vec<Pt>, f64) {
        let tried = self.ways(from, to);
        let mut way = 0;
        let mut best = Self::walked_cost(&tried[0], later, f64::INFINITY);
        if best >= 0.3 * 1000.0 {
            for k in 1..tried.len() {
                let v = Self::walked_cost(&tried[k], later, best);
                if v < best {
                    way = k;
                    best = v;
                }
            }
        }
        (tried[way].way.clone(), best)
    }

    fn key_of(&self, over: &[usize]) -> Key {
        if self.n <= MASK_MAX {
            Key::Mask(over.iter().fold(0, |m, &j| m | (1 << j)))
        } else {
            Key::List(over.to_vec())
        }
    }

    fn add(&self, groups: &mut Groups, over: &[usize], len: f64) {
        let key = self.key_of(over);
        if let Some(&i) = groups.at.get(&key) {
            groups.list[i].len += len;
        } else {
            let mask = match key {
                Key::Mask(m) => m,
                Key::List(_) => 0,
            };
            groups.at.insert(key, groups.list.len());
            groups.list.push(Group {
                len,
                over: over.to_vec(),
                mask,
            });
        }
    }

    /// Adds the samples of the straight piece from a to b to `groups`; its length.
    fn sample_into(&mut self, groups: &mut Groups, a: Pt, b: Pt) -> f64 {
        let d = dist(a, b);
        let m = (d / 0.25).ceil().max(1.0) as usize;
        for j in 0..m {
            let q = lerp(a, b, (j as f64 + 0.5) / m as f64);
            let here: Vec<usize> = self
                .may_hold(q)
                .into_iter()
                .filter(|&c| self.is_in(c, q))
                .collect();
            self.add(groups, &here, d / m as f64);
        }
        d
    }

    fn prefix_of(&mut self, k: usize) -> std::rc::Rc<Prefix> {
        if let Some(p) = &self.prefixes[k] {
            return p.clone();
        }
        let line = self.centers[k].0.clone();
        let m = line.len().saturating_sub(1);
        let mut per: Vec<Groups> = vec![];
        let mut d = vec![0.0; m + 1];
        for i in 0..m {
            let mut g = Groups::default();
            d[i + 1] = d[i] + self.sample_into(&mut g, line[i], line[i + 1]);
            per.push(g);
        }
        let mut keys: Vec<(Vec<usize>, i32)> = vec![];
        let mut sums: Vec<Vec<f64>> = vec![];
        let mut index: HashMap<Key, usize> = HashMap::new();
        for (i, g) in per.iter().enumerate() {
            for x in &g.list {
                let key = self.key_of(&x.over);
                let at = *index.entry(key).or_insert_with(|| {
                    keys.push((x.over.clone(), x.mask));
                    sums.push(vec![0.0; m + 1]);
                    sums.len() - 1
                });
                sums[at][i + 1] = x.len;
            }
        }
        for s in &mut sums {
            for i in 1..=m {
                s[i] += s[i - 1];
            }
        }
        let p = std::rc::Rc::new(Prefix { keys, sums, d });
        self.prefixes[k] = Some(p.clone());
        p
    }

    fn piece(&mut self, a: Pt, b: Pt) -> Piece {
        let mut groups = Groups::default();
        let len = self.sample_into(&mut groups, a, b);
        Piece {
            groups: groups.list,
            len,
        }
    }

    fn costed_of(groups: Vec<Group>, len: f64) -> Costed {
        let mut bare = 0.0;
        for g in &groups {
            if g.over.is_empty() {
                bare += g.len;
            }
        }
        Costed {
            groups,
            len,
            floor: bare * 3.0 * 1000.0 + len,
        }
    }

    fn joined(&self, pieces: &[&Piece]) -> Costed {
        let mut groups = Groups::default();
        let mut len = 0.0;
        for x in pieces {
            len += x.len;
            for g in &x.groups {
                self.add(&mut groups, &g.over, g.len);
            }
        }
        Self::costed_of(groups.list, len)
    }

    fn reach_of(&mut self, q: Pt) -> std::rc::Rc<Vec<Reach>> {
        if let Some(v) = self.reaches.get(&pk(q)) {
            return v.clone();
        }
        let along = self.along_of(q);
        let mut v = vec![];
        for (k, (s, p)) in along.into_iter().enumerate() {
            let (i0, i1, n) = {
                let (line, cum) = &self.centers[k];
                (
                    first_above(cum, s + 1e-6, false),
                    first_above(cum, s - 1e-6, true),
                    line.len(),
                )
            };
            let to = self.piece(q, p);
            let up = if i0 < n {
                let b = self.centers[k].0[i0];
                self.piece(p, b)
            } else {
                Piece {
                    groups: vec![],
                    len: 0.0,
                }
            };
            let down = if i1 > 0 {
                let a = self.centers[k].0[i1 - 1];
                self.piece(a, p)
            } else {
                Piece {
                    groups: vec![],
                    len: 0.0,
                }
            };
            v.push(Reach {
                to,
                up,
                down,
                i0,
                i1,
            });
        }
        let v = std::rc::Rc::new(v);
        self.reaches.insert(pk(q), v.clone());
        v
    }

    /// The ways from one point to another, costed: straight on first, then along the middle of each
    /// column from the one that can cost the least on.
    fn costed(&mut self, from: Pt, to: Pt) -> Vec<Costed> {
        let first = {
            let x = self.piece(from, to);
            Self::costed_of(x.groups, x.len)
        };
        let rf = self.reach_of(from);
        let rt = self.reach_of(to);
        let af = self.along_of(from);
        let at = self.along_of(to);
        let mut alongs = vec![];
        for k in 0..self.n {
            let upward = af[k].0 <= at[k].0;
            let (lo, hi) = if upward {
                (&rf[k], &rt[k])
            } else {
                (&rt[k], &rf[k])
            };
            let (lo_p, hi_p) = if upward {
                (af[k].1, at[k].1)
            } else {
                (at[k].1, af[k].1)
            };
            let (i0, i1) = (lo.i0, hi.i1);
            let mut owned: Vec<Piece> = vec![];
            let middle = if i0 < i1 {
                if i1 - 1 > i0 {
                    let pre = self.prefix_of(k);
                    let mut groups = vec![];
                    for (j, sums) in pre.sums.iter().enumerate() {
                        let v = sums[i1 - 1] - sums[i0];
                        if v > 0.0 {
                            groups.push(Group {
                                len: v,
                                over: pre.keys[j].0.clone(),
                                mask: if self.n <= MASK_MAX { pre.keys[j].1 } else { 0 },
                            });
                        }
                    }
                    owned.push(Piece {
                        groups,
                        len: pre.d[i1 - 1] - pre.d[i0],
                    });
                }
                None
            } else {
                Some(self.piece(lo_p, hi_p))
            };
            let mut pieces: Vec<&Piece> = vec![&rf[k].to];
            if i0 < i1 {
                pieces.push(&lo.up);
                if let Some(p) = owned.first() {
                    pieces.push(p);
                }
                pieces.push(&hi.down);
            } else {
                pieces.push(middle.as_ref().unwrap());
            }
            pieces.push(&rt[k].to);
            alongs.push(self.joined(&pieces));
        }
        // Straight on first, then the ways along a middle from the one that can cost the least on.
        alongs.sort_by(|a, b| {
            a.floor
                .partial_cmp(&b.floor)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let mut out = vec![first];
        out.extend(alongs);
        out
    }

    /// What a costed way costs with `later` still to be sewn.
    fn one_of(&self, t: &Costed, later: &Later) -> f64 {
        let mut seen = 0.0;
        let mask = later.mask;
        for g in &t.groups {
            if g.over.is_empty() {
                seen += 3.0 * g.len;
            } else if if self.n <= MASK_MAX {
                (g.mask & mask) == 0
            } else {
                !g.over.iter().any(|&j| later.flags[j] != 0)
            } {
                seen += g.len;
            }
        }
        seen * 1000.0 + t.len
    }

    /// What the best of the costed ways costs with `later` still to be sewn (as `between` chooses).
    fn cost_of(&self, tried: &[Costed], later: &Later) -> f64 {
        let mut best = self.one_of(&tried[0], later);
        if best >= 0.3 * 1000.0 {
            let mut k = 1;
            while k < tried.len() && tried[k].floor < best {
                let v = self.one_of(&tried[k], later);
                if v < best {
                    best = v;
                }
                k += 1;
            }
        }
        best
    }

    /// How much of a way shows (mm): across the fabric, and over satin sewn before it.
    fn shown(&mut self, way: &[Pt], later: &[u8]) -> (f64, f64) {
        let w = self.walk(way.to_vec());
        let (mut bare, mut over) = (0.0, 0.0);
        for q in 0..w.len.len() {
            if w.at[q] == w.at[q + 1] {
                bare += w.len[q];
            } else if !w.over[w.at[q]..w.at[q + 1]].iter().any(|&j| later[j] != 0) {
                over += w.len[q];
            }
        }
        (bare, over)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bar(x0: f64, y0: f64, len: f64, w: f64) -> Rails {
        let n = (len / 0.5) as usize;
        Rails::new(
            (0..=n).map(|i| [x0 + i as f64 * 0.5, y0]).collect(),
            (0..=n).map(|i| [x0 + i as f64 * 0.5, y0 + w]).collect(),
        )
    }

    fn settings() -> SatinSettings {
        SatinSettings {
            spacing: 0.4,
            edge: 0.2,
            short: true,
            underlay: true,
            tolerance: 0.15,
            ..Default::default()
        }
    }

    #[test]
    fn a_column_is_one_run_over_its_underlay() {
        let runs = satin_runs(&[bar(0.0, 0.0, 20.0, 3.0)], &settings(), None);
        assert_eq!(runs.len(), 1);
        assert!(runs[0].len() > 100);
        assert!(!runs[0].trim);
    }

    #[test]
    fn reversed_twice_is_the_same() {
        let mut r = bar(0.0, 0.0, 10.0, 2.0);
        r.rungs = Some(vec![[5.0, 5.0]]);
        r.cuts = Some(vec![[3.0, 3.0]]);
        let back = reversed_rails(&reversed_rails(&r));
        assert_eq!(back.left, r.left);
        assert_eq!(back.rungs.unwrap()[0], [5.0, 5.0]);
    }

    #[test]
    fn sections_split_at_cut_lines() {
        let mut r = bar(0.0, 0.0, 10.0, 2.0);
        r.rungs = Some(vec![]);
        r.cuts = Some(vec![[4.0, 4.0]]);
        let secs = sections_of(&r);
        assert_eq!(secs.len(), 2);
        assert!((secs[0].left.last().unwrap()[0] - 4.0).abs() < 1e-9);
    }

    #[test]
    fn a_chain_is_ordered_and_trimmed_apart() {
        let cols: Vec<Rails> = (0..4)
            .map(|k| {
                let mut r = bar(k as f64 * 6.0, 0.0, 5.0, 2.0);
                r.chain = Some(0.0);
                r
            })
            .collect();
        let steps = best_chain(&cols, &settings());
        assert_eq!(steps.len(), 4);
        let mut seen: Vec<usize> = steps.iter().map(|s| s.c).collect();
        seen.sort();
        assert_eq!(seen, vec![0, 1, 2, 3]);
        let mut runs = satin_runs(&cols, &settings(), None);
        runs.insert(0, Run::new(vec![[0.0, 0.0]]));
        assert_eq!(runs.len(), 2);
    }

    #[test]
    fn a_long_chain_is_searched() {
        let cols: Vec<Rails> = (0..13)
            .map(|k| {
                let mut r = bar((k * 7 % 13) as f64 * 4.0, 0.0, 3.0, 1.5);
                r.chain = Some(1.0);
                r
            })
            .collect();
        let steps = best_chain(&cols, &settings());
        let mut seen: Vec<usize> = steps.iter().map(|s| s.c).collect();
        seen.sort();
        assert_eq!(seen, (0..13).collect::<Vec<_>>());
    }
}
