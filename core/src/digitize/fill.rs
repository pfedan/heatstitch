//! Tatami fill of a region (with holes) from its signed distance field.
//!
//! - Rows are scan lines at the fill angle on a lattice anchored at the design origin, so the rows of
//!   neighbouring regions line up; inside/outside comes from the field, so holes need no extra care.
//! - Rows are grouped into sections, monotone pieces that can be sewn back and forth in one go (the
//!   boustrophedon decomposition, Choset 2000): a section ends wherever the shape splits or merges.
//! - Needle points lie on a global lattice along the rows, shifted by a quarter stitch from row to
//!   row (Ink/Stitch's default of 4 staggers), so the stitch ends do not form visible lines.
//! - Without a fixed angle, the angle with the fewest sections out of 16 is used, as in the Goldman
//!   patent; fewer sections mean fewer travels.
//! - Underlay: a sparse fill at +90 degrees (or two crossing at ±45), inset from the edge, sewn first.
//! - Between sections the needle travels inside the region on a shortest path that avoids rows sewn
//!   already, so later rows cover it (Ink/Stitch's underpath); where it would run on top of sewn rows
//!   for more than 2 mm, the needle jumps instead.
//! - Gap rows (`gap_rows`): where two sections meet, the one sewn first runs on for a row or two into
//!   the other, under its rows to come, so stretchy fabric pulled apart in between shows no gap at
//!   the join (Wilcom's segment overlap rows, Ink/Stitch's gap fill rows).

use std::cell::RefCell;

use serde::{Deserialize, Serialize};

use super::border::{border_loops, order_loops};
use super::deco::{Motif, Texture, emboss_points, motif_crossings, motif_inside, texture_points};
use super::plan::{Pieces, beam_on_grid, end_cost, plan_on_grid, planning};
use super::region::{Region, expand_field, expand_region, sample, signed_field};
use super::run::{MIN_ROW_STITCH, TOLERANCE, run_stitch};
use super::tour::{Touch, TourInput, Way, tour};
use super::travel_grid::{Footprint, MinHeap, STEP_I, STEP_J, STEP_LEN, TravelGrid};
use crate::geom::Pt;
use crate::js::{IdMap, dist, hypot, round};
use crate::trig::JsMath;

/// Embossing of tatami rows (see deco.rs).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Emboss {
    pub motif: Motif,
    pub size: f64,
    #[serde(default)]
    pub strong: Option<bool>,
    #[serde(default)]
    pub angle: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TextureSpec {
    pub kind: Texture,
    pub size: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct WaveSpec {
    pub height: f64,
    pub length: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fade {
    Out,
    In,
}

/// The settings of a fill, as FillParams in TypeScript (the regions cross on their own).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillParams {
    /// Distance between neighbouring rows (mm).
    pub spacing: f64,
    /// Stitch length (mm).
    pub stitch: f64,
    /// Degrees; None chooses per region.
    #[serde(default)]
    pub angle: Option<f64>,
    /// Rows are lengthened at both ends by this (mm).
    #[serde(default)]
    pub pull: f64,
    #[serde(default)]
    pub underlay: bool,
    /// Underlay as two crossing layers at ±45 degrees to the rows.
    #[serde(default)]
    pub under_cross: Option<bool>,
    #[serde(default)]
    pub under_inset: Option<f64>,
    /// Rows turn along the outline ('edge') instead of straight across.
    #[serde(default)]
    pub row_ends: Option<String>,
    #[serde(default)]
    pub under_edge: Option<bool>,
    #[serde(default)]
    pub under_inset_share: Option<f64>,
    #[serde(default)]
    pub under_spacing: Option<f64>,
    #[serde(default)]
    pub offset: Option<f64>,
    #[serde(default)]
    pub spacing_end: Option<f64>,
    #[serde(default)]
    pub end: Option<Pt>,
    #[serde(default)]
    pub off_row_ends: Option<bool>,
    #[serde(default)]
    pub save_trims: Option<bool>,
    #[serde(default)]
    pub tolerance: Option<f64>,
    #[serde(default)]
    pub emboss: Option<Emboss>,
    #[serde(default)]
    pub texture: Option<TextureSpec>,
    #[serde(default)]
    pub wave: Option<WaveSpec>,
    #[serde(default)]
    pub fade: Option<Fade>,
    #[serde(default)]
    pub gap_rows: Option<f64>,
    /// The underlay only in this part of the area (same pixels as the area).
    #[serde(skip)]
    pub under_area: Option<Region>,
    /// Where travel between sections may run; the region itself by default.
    #[serde(skip)]
    pub travel: Option<Region>,
    /// The whole area this one was cut from (parts left out under what lies on top).
    #[serde(skip)]
    pub whole: Option<Region>,
}

/// Fill stitches: continuous runs (a jump between two), the angle, how many points of the runs
/// are underlay, and where travel runs along a way (first and last point index).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FillResult {
    pub runs: Vec<Vec<Pt>>,
    pub angle: f64,
    pub under: usize,
    pub travel: Vec<[usize; 2]>,
    /// Curved rows (flow and field fills).
    pub curved: bool,
}

/// Notes travel of `n` points about to be added to the last run of `runs`.
pub fn note_travel(list: &mut Vec<[usize; 2]>, runs: &[Vec<Pt>], n: usize) {
    let at = point_count(runs) - 1;
    list.push([at, at + n - 1]);
}

pub fn point_count(runs: &[Vec<Pt>]) -> usize {
    runs.iter().map(Vec::len).sum()
}

pub fn path_length(p: &[Pt]) -> f64 {
    let mut l = 0.0;
    for i in 1..p.len() {
        l += dist(p[i - 1], p[i]);
    }
    l
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Seg {
    pub k: i64,
    pub u0: f64,
    pub u1: f64,
    /// A gap row: sewn by the section next to the one whose row it is (see section_joins).
    pub gap: bool,
}

pub(crate) type Section = Vec<Seg>;

const STAGGERS: f64 = 4.0;
/// A fading fill ends where it thins out below this share of its density.
const FADE_MIN: f64 = 0.15;
const UNDERLAY_STITCH: f64 = 3.0;
pub const UNDERLAY_INSET: f64 = 0.4;
pub const TRAVEL_STITCH: f64 = 2.5;
/// Travel lies under the rows: it may cut its way's curves further than visible stitches (mm).
pub const TRAVEL_TOLERANCE: f64 = 0.4;
const RAD: f64 = std::f64::consts::PI / 180.0;
/// Wave rows count as straight pieces this long (mm) where they cover the travel grid.
const WAVE_PIECE: f64 = 1.0;
/// How far the step between two sparse rows may cut outside the outline (mm).
const SPARSE_SLACK: f64 = 0.25;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Wave {
    height: f64,
    k: f64,
    tol: f64,
}

#[derive(Clone, Copy, Debug)]
struct Lattice {
    q: f64,
    p: f64,
    m: f64,
}

/// Travel laid onto the rows of two crossing lattices (crosshatch, see onto_lines).
#[derive(Clone, Copy)]
pub(crate) struct OntoLines<'a> {
    n: [Pt; 2],
    spacing: [f64; 2],
    r: &'a Region,
}

/// Rows at an angle: u runs along them, v across. Row k lies at v(k): k * spacing, or for a gradient
/// at spacings that change evenly from `spacing` to `end` across the extent set by `layout`.
#[derive(Clone)]
pub(crate) struct Frame<'a> {
    pub e: Pt,
    pub n: Pt,
    pub spacing: f64,
    pub end: f64,
    offset: f64,
    vs: Option<Vec<f64>>,
    k0: i64,
    emboss: Option<Emboss>,
    texture: Option<TextureSpec>,
    fade: Option<Fade>,
    /// Sparse rows (crosshatch): the half width each row covers for travel, its thread only.
    lane: Option<f64>,
    /// Sparse rows: travel laid onto the lines thread lies on.
    on_lines: Option<OntoLines<'a>>,
    wave: Option<Wave>,
    /// Rows turn along the outline of this region (see FillParams::row_ends).
    edge: Option<&'a Region>,
    lattice: Option<Lattice>,
    /// The area the rows fill: a tour plans its hidden ways inside it.
    area: Option<&'a Region>,
}

impl<'a> Frame<'a> {
    pub fn new(angle_deg: f64, spacing: f64, end: f64, offset: f64) -> Frame<'a> {
        let a = angle_deg * RAD;
        Frame {
            e: [a.js_cos(), a.js_sin()],
            n: [-a.js_sin(), a.js_cos()],
            spacing,
            end,
            offset,
            vs: None,
            k0: 0,
            emboss: None,
            texture: None,
            fade: None,
            lane: None,
            on_lines: None,
            wave: None,
            edge: None,
            lattice: None,
            area: None,
        }
    }

    pub fn at(&self, u: f64, v: f64) -> Pt {
        let w = match self.wave {
            Some(wv) => v + wv.height * (wv.k * u + 0.3 * (v / 6.0).js_sin()).js_sin(),
            None => v,
        };
        [u * self.e[0] + w * self.n[0], u * self.e[1] + w * self.n[1]]
    }

    /// How far rows reach across beyond their v (wave rows swing out by their height).
    fn swing(&self) -> f64 {
        self.wave.map_or(0.0, |w| w.height)
    }

    /// The row from u0 to u1 at v as straight pieces (one for straight rows), for what it covers.
    pub fn pieces(&self, u0: f64, u1: f64, v: f64) -> Vec<[Pt; 2]> {
        let n = if self.wave.is_some() {
            ((u1 - u0).abs() / WAVE_PIECE).ceil().max(1.0) as usize
        } else {
            1
        };
        (0..n)
            .map(|i| {
                [
                    self.at(u0 + ((u1 - u0) * i as f64) / n as f64, v),
                    self.at(u0 + ((u1 - u0) * (i + 1) as f64) / n as f64, v),
                ]
            })
            .collect()
    }

    pub fn gradient(&self) -> bool {
        self.fade.is_some() || (self.end - self.spacing).abs() >= 1e-3
    }

    /// Sets the extent across the rows; returns the first and last row index.
    fn layout(&mut self, vmin: f64, vmax: f64) -> (i64, i64) {
        if !self.gradient() {
            return (
                (vmin / self.spacing).ceil() as i64,
                (vmax / self.spacing).floor() as i64,
            );
        }
        let mut vs = Vec::new();
        let span = (vmax - vmin).max(1e-6);
        if let Some(fade) = self.fade {
            // Density, not spacing, changes evenly: 1 / spacing at full, down to FADE_MIN of it.
            let mut v = vmin + self.spacing / 2.0;
            while v <= vmax {
                let t = (v - vmin) / span;
                let d = if fade == Fade::Out { 1.0 - t } else { t };
                if d >= FADE_MIN {
                    vs.push(v);
                }
                v += self.spacing / FADE_MIN.max(d);
            }
        } else {
            let mut v = vmin + self.spacing / 2.0;
            while v <= vmax {
                vs.push(v);
                v += self.spacing + ((self.end - self.spacing) * (v - vmin)) / span;
            }
        }
        let n = vs.len() as i64;
        self.vs = Some(vs);
        self.k0 = 0;
        (0, n - 1)
    }

    /// The half width a row covers (see lane).
    pub fn half(&self) -> f64 {
        self.lane.unwrap_or(self.spacing / 2.0)
    }

    pub fn v(&self, k: i64) -> f64 {
        let Some(vs) = &self.vs else {
            return k as f64 * self.spacing;
        };
        let i = k - self.k0;
        if vs.is_empty() {
            return f64::NAN;
        }
        if i < 0 {
            return vs[0] + i as f64 * self.spacing;
        }
        let n = vs.len() as i64;
        if i >= n {
            return vs[(n - 1) as usize] + (i - n + 1) as f64 * self.end;
        }
        vs[i as usize]
    }

    /// Needle point phase of row k (fraction of the stitch length).
    fn phase(&self, k: i64) -> f64 {
        if self.offset <= 0.0 {
            // Random but repeatable: a hash of the row index.
            let x = (k as f64 * 12.9898 + 78.233).js_sin() * 43758.5453;
            return x - x.floor();
        }
        let t = k as f64 * self.offset;
        t - t.floor()
    }

    /// With rows turning along the edge: the u nearest `u` (within `reach`) where row v meets the outline.
    fn edge_at(&self, r: &Region, u: f64, v: f64, reach: f64) -> f64 {
        let step = r.px_mm / 2.0;
        let at = |u: f64, v: f64| {
            let q = self.at(u, v);
            sample(r, r.sdf(), q[0], q[1])
        };
        let in0 = at(u, v) < 0.0;
        let mut d = step;
        while d <= reach {
            for dir in [1.0, -1.0] {
                let x = u + dir * d;
                let val = at(x, v);
                if (val < 0.0) != in0 {
                    // Between this step and the one before it, where the field crosses zero.
                    let prev = at(x - dir * step, v);
                    let den = prev - val;
                    return x - dir * step
                        + (dir * step * prev) / if den == 0.0 { 1.0 } else { den };
                }
            }
            d += step;
        }
        u
    }
}

/// Row segments inside the field (value below -inset) on the frame's rows.
pub(crate) fn rows(r: &Region, field: &[f32], f: &mut Frame, inset: f64) -> Vec<Vec<Seg>> {
    let xs = [
        f64::from(r.x0) * r.px_mm,
        (f64::from(r.x0) + r.w as f64) * r.px_mm,
    ];
    let ys = [
        f64::from(r.y0) * r.px_mm,
        (f64::from(r.y0) + r.h as f64) * r.px_mm,
    ];
    let (mut umin, mut umax, mut vmin, mut vmax) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for x in xs {
        for y in ys {
            let u = x * f.e[0] + y * f.e[1];
            let v = x * f.n[0] + y * f.n[1];
            umin = umin.min(u);
            umax = umax.max(u);
            vmin = vmin.min(v);
            vmax = vmax.max(v);
        }
    }
    let step = r.px_mm / 2.0;
    let mut out = Vec::new();
    // A gradient runs across the shape itself, not across the window around it.
    let (mut lo, mut hi) = (vmin, vmax);
    if f.gradient() {
        (lo, hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for y in 0..r.h {
            for x in 0..r.w {
                if r.mask[y * r.w + x] == 0 {
                    continue;
                }
                let v = (x as f64 + f64::from(r.x0) + 0.5) * r.px_mm * f.n[0]
                    + (y as f64 + f64::from(r.y0) + 0.5) * r.px_mm * f.n[1];
                lo = lo.min(v);
                hi = hi.max(v);
            }
        }
        if !lo.is_finite() {
            (lo, hi) = (vmin, vmax);
        }
    }
    let (k0, k1) = f.layout(lo - f.swing(), hi + f.swing());
    let at = |u: f64, v: f64| {
        let q = f.at(u, v);
        sample(r, field, q[0], q[1])
    };
    for k in k0..=k1 {
        let v = f.v(k);
        let mut segs = Vec::new();
        let mut prev_u = umin;
        let mut prev = at(umin, v) + inset;
        let mut start = if prev < 0.0 { umin } else { f64::NAN };
        let mut u = umin + step;
        while u <= umax {
            let val = at(u, v) + inset;
            if (prev < 0.0) != (val < 0.0) {
                let cross = prev_u + (step * prev) / (prev - val);
                if val < 0.0 {
                    start = cross;
                } else {
                    if cross - start > 0.2 {
                        segs.push(Seg {
                            k,
                            u0: start,
                            u1: cross,
                            gap: false,
                        });
                    }
                    start = f64::NAN;
                }
            }
            prev = val;
            prev_u = u;
            u += step;
        }
        if !segs.is_empty() {
            out.push(segs);
        }
    }
    out
}

/// Groups rows into sections that can each be sewn back and forth without leaving the shape.
pub(crate) fn sections(
    r: &Region,
    field: &[f32],
    f: &Frame,
    row_list: &[Vec<Seg>],
) -> Vec<Section> {
    let mut all: Vec<Section> = Vec::new();
    // Open sections by index into `all`.
    let mut open: Vec<usize> = Vec::new();
    let overlaps = |a: &Seg, b: &Seg| a.u0 < b.u1 && b.u0 < a.u1;
    // The step from row to row may cut a corner by half a row; sparse rows lie far apart, and their
    // steps keep near the outline instead.
    let slack = if f.lane.is_some() {
        SPARSE_SLACK
    } else {
        f.spacing.max(f.v(1) - f.v(0)) / 2.0
    };
    let inside = |u: f64, v: f64| {
        let q = f.at(u, v);
        sample(r, field, q[0], q[1]) < slack
    };
    for segs in row_list {
        let k = segs[0].k;
        let live: Vec<usize> = open
            .iter()
            .copied()
            .filter(|&s| all[s].last().unwrap().k == k - 1)
            .collect();
        let mut next = Vec::new();
        for seg in segs {
            let cands: Vec<usize> = live
                .iter()
                .copied()
                .filter(|&s| overlaps(all[s].last().unwrap(), seg))
                .collect();
            let mut joined = false;
            if cands.len() == 1 {
                let c = cands[0];
                let last = *all[c].last().unwrap();
                let exclusive = segs.iter().filter(|o| overlaps(&last, o)).count() == 1;
                let v_mid = (f.v(k - 1) + f.v(k)) / 2.0;
                if exclusive
                    && inside((last.u0 + seg.u0) / 2.0, v_mid)
                    && inside((last.u1 + seg.u1) / 2.0, v_mid)
                {
                    all[c].push(*seg);
                    next.push(c);
                    joined = true;
                }
            }
            if !joined {
                all.push(vec![*seg]);
                next.push(all.len() - 1);
            }
        }
        open = next;
    }
    all
}

/// Most gap rows a section sews on into its neighbour.
pub const GAP_ROWS_MAX: f64 = 2.0;
/// Sections that touch along less than this (mm) get no gap rows.
const JOIN_MIN: f64 = 1.0;

/// Rows one section can sew on into a touching one (gap rows), nearest first.
#[derive(Clone)]
struct Join {
    to: usize,
    rows: Vec<Seg>,
}

/// Where each section touches others across its first row (`lo`) and across its last (`hi`).
struct Joins {
    lo: Vec<Vec<Join>>,
    hi: Vec<Vec<Join>>,
}

/// Gap rows at the joins of sections (segment overlap): where a section's first or last row lies
/// beside a row of another section, the rows of that other section next to it, up to `n`, each cut
/// to where the rows before it reach, so they stay on the stretch both share and taper with the
/// shape (Wilcom's overlap rows; Ink/Stitch's gap_fill_rows). Sewn by the section that comes first,
/// they lie under the later rows on the same lines and needle points, so they do not show.
fn section_joins(r: &Region, f: &Frame, secs: &[Section], n: i64) -> Joins {
    let mut by_row: IdMap<i64, Vec<(Seg, usize)>> = IdMap::default();
    for (si, s) in secs.iter().enumerate() {
        for seg in s {
            by_row.entry(seg.k).or_default().push((*seg, si));
        }
    }
    let row_of = |s: &Section, k: i64| -> Option<Seg> {
        if k >= s[0].k && k <= s[s.len() - 1].k {
            Some(s[(k - s[0].k) as usize])
        } else {
            None
        }
    };
    let inside = |u: f64, v: f64| {
        let q = f.at(u, v);
        sample(r, r.sdf(), q[0], q[1]) < f.spacing / 2.0
    };
    let across = |si: usize, edge: Seg, dir: i64| -> Vec<Join> {
        let mut out = Vec::new();
        let Some(list) = by_row.get(&(edge.k + dir)) else {
            return out;
        };
        for &(seg, t) in list {
            if t == si {
                continue;
            }
            let mut u0 = edge.u0.max(seg.u0);
            let mut u1 = edge.u1.min(seg.u1);
            if u1 - u0 < JOIN_MIN {
                continue;
            }
            // The rows must touch: no slit of the shape between them.
            let v_mid = (f.v(edge.k) + f.v(seg.k)) / 2.0;
            if ![u0 + 0.3, (u0 + u1) / 2.0, u1 - 0.3]
                .iter()
                .all(|&u| inside(u, v_mid))
            {
                continue;
            }
            let mut rows = vec![Seg {
                k: seg.k,
                u0,
                u1,
                gap: true,
            }];
            for j in 2..=n {
                let Some(next) = row_of(&secs[t], edge.k + dir * j) else {
                    break;
                };
                u0 = u0.max(next.u0);
                u1 = u1.min(next.u1);
                if u1 - u0 < JOIN_MIN {
                    break;
                }
                rows.push(Seg {
                    k: next.k,
                    u0,
                    u1,
                    gap: true,
                });
            }
            out.push(Join { to: t, rows });
        }
        out
    };
    let mut joins = Joins {
        lo: Vec::new(),
        hi: Vec::new(),
    };
    for (si, s) in secs.iter().enumerate() {
        joins.lo.push(across(si, s[0], -1));
        joins.hi.push(across(si, s[s.len() - 1], 1));
    }
    joins
}

/// The sections in this sewing order (indices into the sections `joins` was made for) with their
/// gap rows. At each end a section sews on into the touching section sewn after it (along the
/// longest stretch, if several), so the gap rows lie under that one's rows. Where a section's end
/// touches more than one later section, the later section at another such join sews its gap rows
/// back onto the earlier one's last row instead, so every join is covered. Rows stay in order of k.
/// Each section comes with whether it grew.
fn with_gap_rows(order: &[usize], secs: &[Section], joins: &Joins) -> Vec<(Section, bool)> {
    let mut rank: IdMap<usize, usize> = IdMap::default();
    for (i, &s) in order.iter().enumerate() {
        rank.insert(s, i);
    }
    let covered: RefCell<Vec<(usize, usize)>> = RefCell::new(Vec::new());
    let pair = |a: usize, b: usize| {
        let (x, y) = (rank[&a], rank[&b]);
        // Sorted as strings, as the TypeScript twin keyed them; only equality matters.
        if x.to_string() <= y.to_string() {
            (x, y)
        } else {
            (y, x)
        }
    };
    let len = |x: &Join| x.rows[0].u1 - x.rows[0].u0;
    let pick = |s: usize, list: &[Join], ok: &dyn Fn(&Join) -> bool| -> Option<Join> {
        let mut best: Option<&Join> = None;
        for x in list {
            if ok(x) && best.is_none_or(|b| len(x) > len(b)) {
                best = Some(x);
            }
        }
        if let Some(b) = best {
            covered.borrow_mut().push(pair(s, b.to));
        }
        best.cloned()
    };
    let ends: Vec<(usize, Option<Join>, Option<Join>)> = order
        .iter()
        .map(|&s| {
            let later = |x: &Join| rank[&x.to] > rank[&s];
            (
                s,
                pick(s, &joins.lo[s], &later),
                pick(s, &joins.hi[s], &later),
            )
        })
        .collect();
    ends.into_iter()
        .map(|(s, lo, hi)| {
            let back =
                |x: &Join| rank[&x.to] < rank[&s] && !covered.borrow().contains(&pair(s, x.to));
            let lo = lo.or_else(|| pick(s, &joins.lo[s], &back));
            let hi = hi.or_else(|| pick(s, &joins.hi[s], &back));
            if lo.is_none() && hi.is_none() {
                return (secs[s].clone(), false);
            }
            let mut out = Vec::new();
            if let Some(lo) = &lo {
                out.extend(lo.rows.iter().rev());
            }
            out.extend_from_slice(&secs[s]);
            if let Some(hi) = &hi {
                out.extend_from_slice(&hi.rows);
            }
            (out, true)
        })
        .collect()
}

/// Points of one row from u `from` to `to` (row index k for the stagger).
fn row_stitches(f: &Frame, k: i64, v: f64, from: f64, to: f64, len: f64) -> Vec<Pt> {
    let dir = if to >= from { 1 } else { -1 };
    let phase = f.phase(k);
    let lo = from.min(to);
    let hi = from.max(to);
    let margin = 0.6f64.min(len / 4.0);
    let mut pts: Vec<f64> = Vec::new();
    if let Some(t) = &f.texture {
        pts = texture_points(t.kind, t.size, len, v, lo, hi, margin);
    } else {
        let mut j = ((lo + margin) / len - phase).ceil();
        while (j + phase) * len <= hi - margin {
            pts.push((j + phase) * len);
            j += 1.0;
        }
    }
    if let Some(em) = &f.emboss {
        let angle = em.angle.unwrap_or(0.0);
        let cross = motif_crossings(
            em.motif,
            em.size,
            f.at(0.0, v),
            f.e,
            lo + 0.3,
            hi - 0.3,
            angle,
        );
        pts = emboss_points(&cross, &pts, len, lo, hi);
        if em.strong == Some(true) {
            let v0 = f.at(0.0, v);
            let inside = |u: f64| {
                motif_inside(
                    em.motif,
                    em.size,
                    [v0[0] + f.e[0] * u, v0[1] + f.e[1] * u],
                    angle,
                )
            };
            pts = short_inside(&pts, inside, len, lo, hi);
        }
    }
    if dir < 0 {
        pts.reverse();
    }
    if let Some(w) = f.wave {
        let mut us = Vec::with_capacity(pts.len() + 2);
        us.push(from);
        us.extend_from_slice(&pts);
        us.push(to);
        return wave_stitches(f, w.tol, v, &us);
    }
    let mut out = Vec::with_capacity(pts.len() + 2);
    out.push(f.at(from, v));
    out.extend(pts.iter().map(|&u| f.at(u, v)));
    out.push(f.at(to, v));
    if let Some(g) = f.lattice {
        return out.into_iter().map(|q| on_lattice(g, k, q)).collect();
    }
    out
}

/// Grid steps a row direction may take for rows on grid lines (see on_grid).
const LATTICE_STEPS: i64 = 3;
/// How far (degrees) the rows may turn to lie on grid lines.
const LATTICE_TURN: f64 = 0.05;

fn gcd(a: i64, b: i64) -> i64 {
    if b != 0 { gcd(b, a % b) } else { a }
}

/// Lays the rows of `f` on lines of the 0.1 mm grid the needle points are saved on, where its angle
/// runs along such lines (0°, 45°, 90°, and directions of up to LATTICE_STEPS grid steps): rows lie
/// a whole number of grid lines apart, the nearest to the spacing asked for, and every needle point
/// on a grid point of its row. Rounded to the grid one by one, rows at 45° and 0.2 mm lay 0.14 and
/// 0.28 mm apart in turn and read as pairs.
fn on_grid(f: &mut Frame) {
    let a = f.e[1].atan2(f.e[0]);
    for q in -LATTICE_STEPS..=LATTICE_STEPS {
        for p in 0..=LATTICE_STEPS {
            if (p == 0 && q != 1) || (p != 0 && gcd(q.abs(), p) != 1) {
                continue;
            }
            let (qf, pf) = (q as f64, p as f64);
            let b = pf.atan2(qf);
            let turn = (a - b).js_sin().atan2((a - b).js_cos()).abs();
            let flip = (turn - std::f64::consts::PI).abs() < turn;
            if turn.min(std::f64::consts::PI - turn) > LATTICE_TURN * RAD {
                continue;
            }
            let l = hypot(qf, pf);
            let sq = if flip { -qf } else { qf };
            let sp = if flip { -pf } else { pf };
            let line = 0.1 / l;
            let m = round(f.spacing / line).max(1.0);
            f.e = [sq / l, sp / l];
            f.n = [-sp / l, sq / l];
            f.spacing = m * line;
            f.end = f.spacing;
            f.lattice = Some(Lattice { q: sq, p: sp, m });
            return;
        }
    }
}

/// The grid point on row k's line nearest to `pt` (see on_grid).
fn on_lattice(g: Lattice, k: i64, pt: Pt) -> Pt {
    let x0 = round(pt[0] * 10.0);
    let y0 = round(pt[1] * 10.0);
    let want = k as f64 * g.m;
    let r = (g.q.abs() + g.p.abs()) as i64;
    let mut best = pt;
    let mut bd = f64::INFINITY;
    for dy in -r..=r {
        for dx in -r..=r {
            let x = x0 + dx as f64;
            let y = y0 + dy as f64;
            if -g.p * x + g.q * y != want {
                continue;
            }
            let d =
                (x / 10.0 - pt[0]) * (x / 10.0 - pt[0]) + (y / 10.0 - pt[1]) * (y / 10.0 - pt[1]);
            if d < bd {
                bd = d;
                best = [x / 10.0, y / 10.0];
            }
        }
    }
    best
}

/// Needle points of a wave row at v on the given u: where a stitch would cut the curve by more than
/// `tol`, it is divided into shorter ones until each keeps within `tol` (not shorter than
/// MIN_ROW_STITCH), as on other curved rows.
fn wave_stitches(f: &Frame, tol: f64, v: f64, us: &[f64]) -> Vec<Pt> {
    let mut out = vec![f.at(us[0], v)];
    let off = |u0: f64, u1: f64| {
        let a = f.at(u0, v);
        let b = f.at(u1, v);
        let l = dist(a, b);
        let l = if l == 0.0 { 1.0 } else { l };
        let mut d: f64 = 0.0;
        for i in 1..8 {
            let q = f.at(u0 + ((u1 - u0) * i as f64) / 8.0, v);
            d = d.max(((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])).abs() / l);
        }
        d
    };
    for i in 1..us.len() {
        let (u0, u1) = (us[i - 1], us[i]);
        let fits = |n: usize| {
            for q in 0..n {
                if off(
                    u0 + ((u1 - u0) * q as f64) / n as f64,
                    u0 + ((u1 - u0) * (q + 1) as f64) / n as f64,
                ) > tol
                {
                    return false;
                }
            }
            true
        };
        let mut n = 1;
        while !fits(n) && (u1 - u0).abs() / (n + 1) as f64 >= MIN_ROW_STITCH {
            n += 1;
        }
        for q in 1..=n {
            out.push(f.at(u0 + ((u1 - u0) * q as f64) / n as f64, v));
        }
    }
    out
}

/// Strong embossing: inside the motif the stitches are about half as long, so the motif shows as
/// an area of a finer, more matte texture between its grooves. The rows and their spacing stay.
fn short_inside(pts: &[f64], inside: impl Fn(f64) -> bool, len: f64, lo: f64, hi: f64) -> Vec<f64> {
    let short = 1.5f64.max(len * 0.5);
    let mut out = Vec::new();
    let mut prev = lo;
    for &u in pts.iter().chain(std::iter::once(&hi)) {
        let g = u - prev;
        if g > short * 1.4 && inside((prev + u) / 2.0) {
            let n = round(g / short) as i64;
            for i in 1..n {
                out.push(prev + (g * i as f64) / n as f64);
            }
        }
        if u < hi {
            out.push(u);
        }
        prev = u;
    }
    out
}

/// Turns up to this long (mm) share the hole of the row ends (see sew_section).
pub const SHARED_TURN: f64 = 0.25;

/// Stitches of a section, entered at its first or last row and at the start or end of that row.
fn sew_section(f: &Frame, s: &[Seg], len: f64, pull: f64, reversed: bool, flip: bool) -> Vec<Pt> {
    let list: Vec<Seg> = if reversed {
        s.iter().rev().copied().collect()
    } else {
        s.to_vec()
    };
    let mut out: Vec<Pt> = Vec::new();
    for (i, seg) in list.iter().enumerate() {
        let fwd = (i % 2 == 0) != flip;
        let a = if fwd { seg.u0 - pull } else { seg.u1 + pull };
        let b = if fwd { seg.u1 + pull } else { seg.u0 - pull };
        let mut row = shortened(&row_stitches(f, seg.k, f.v(seg.k), a, b, len));
        // The step to the next row: in short stitches where the rows lie far apart (a fading fill),
        // along the outline with row ends on the edge. Its ends stay: they are where the rows end.
        if let Some(&prev) = out.last() {
            if row.len() > 1 && f.edge.is_none() && dist(prev, row[0]) <= SHARED_TURN + 1e-3 {
                // Rows this close: the row ends share their hole, as common embroidery software sews
                // tatami. The next row starts at its second needle point.
                row.remove(0);
            } else {
                let mut way = vec![prev];
                way.extend(turn(
                    f,
                    prev,
                    row[0],
                    if fwd { -1.0 } else { 1.0 },
                    pull,
                    len,
                ));
                way.push(row[0]);
                let m = merged(&way, SHORTEST);
                out.extend_from_slice(&m[1..m.len() - 1]);
            }
        }
        out.extend(row);
    }
    out
}

/// The needle points of one row without stitches shorter than SHORTEST. Both ends stay. A row
/// shorter than that (at a narrow tip) is a single point in its middle.
fn shortened(row: &[Pt]) -> Vec<Pt> {
    let (a, b) = (row[0], row[row.len() - 1]);
    if dist(a, b) < SHORTEST - 1e-3 {
        return vec![[(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]];
    }
    merged(row, SHORTEST)
}

/// Along the outline, the step between rows keeps to it in stitches up to this long (mm).
const EDGE_STEP: f64 = 1.0;

/// The needle points between the end of one row (`a`) and the start of the next (`b`), both left
/// out: straight in stitches up to `len`, or with row ends along the edge, on the outline (`pull`
/// beyond it) in stitches up to EDGE_STEP. `out` is the way the outline lies along the rows there.
fn turn(f: &Frame, a: Pt, b: Pt, out: f64, pull: f64, len: f64) -> Vec<Pt> {
    let gap = dist(a, b);
    let mut pts = Vec::new();
    if let Some(r) = f.edge {
        let n = (gap / len.min(EDGE_STEP)).ceil() as i64;
        let (ua, va) = (a[0] * f.e[0] + a[1] * f.e[1], a[0] * f.n[0] + a[1] * f.n[1]);
        let (ub, vb) = (b[0] * f.e[0] + b[1] * f.e[1], b[0] * f.n[0] + b[1] * f.n[1]);
        for i in 1..n {
            let v = va + ((vb - va) * i as f64) / n as f64;
            let u = ua + ((ub - ua) * i as f64) / n as f64;
            pts.push(f.at(
                f.edge_at(r, u - out * pull, v, (ub - ua).abs().max(1.0)) + out * pull,
                v,
            ));
        }
        return pts;
    }
    let n = (gap / len).ceil() as i64;
    for i in 1..n {
        pts.push([
            a[0] + ((b[0] - a[0]) * i as f64) / n as f64,
            a[1] + ((b[1] - a[1]) * i as f64) / n as f64,
        ]);
    }
    pts
}

/// Shortest stitch of a fill (mm) within its rows.
pub const SHORTEST: f64 = 0.4;

/// The needle points without stitches shorter than `min`: such a stitch is merged into the next
/// by leaving out its end. The first and last points stay.
pub fn merged(pts: &[Pt], min: f64) -> Vec<Pt> {
    if pts.len() < 3 {
        return pts.to_vec();
    }
    let mut out = vec![pts[0]];
    // Slightly shorter still counts as the length: rows `min` apart turn in stitches of that length.
    let lim = min - 1e-3;
    for &p in &pts[1..pts.len() - 1] {
        if dist(*out.last().unwrap(), p) >= lim {
            out.push(p);
        }
    }
    let last = pts[pts.len() - 1];
    if out.len() > 1 && dist(*out.last().unwrap(), last) < lim {
        out.pop();
    }
    out.push(last);
    out
}

/// A way into a section: [reversed, flip] with the entry point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Entry {
    reversed: bool,
    flip: bool,
    p: Pt,
}

/// The four ways into a section.
fn entries(f: &Frame, s: &[Seg], pull: f64) -> [Entry; 4] {
    let first = s[0];
    let last = s[s.len() - 1];
    [
        Entry {
            reversed: false,
            flip: false,
            p: f.at(first.u0 - pull, f.v(first.k)),
        },
        Entry {
            reversed: false,
            flip: true,
            p: f.at(first.u1 + pull, f.v(first.k)),
        },
        Entry {
            reversed: true,
            flip: false,
            p: f.at(last.u0 - pull, f.v(last.k)),
        },
        Entry {
            reversed: true,
            flip: true,
            p: f.at(last.u1 + pull, f.v(last.k)),
        },
    ]
}

/// Where a section entered this way ends.
fn exit_of(f: &Frame, s: &[Seg], e: &Entry, pull: f64) -> Pt {
    let seg = if e.reversed { s[0] } else { s[s.len() - 1] };
    let fwd = (s.len() - 1).is_multiple_of(2) != e.flip;
    f.at(if fwd { seg.u1 + pull } else { seg.u0 - pull }, f.v(seg.k))
}

/// Number of sections at a coarse spacing: the score for choosing the fill angle.
fn section_count(r: &Region, angle: f64, spacing: f64) -> usize {
    let mut f = Frame::new(angle, spacing * 2.0, spacing * 2.0, 1.0 / STAGGERS);
    let rs = rows(r, r.sdf(), &mut f, 0.0);
    sections(r, r.sdf(), &f, &rs).len()
}

/// Fill angle with the fewest sections out of 16; ties prefer the diagonals, and angles within 30
/// degrees of touching regions sewn already count a little worse, so neighbours differ.
pub fn choose_angle(r: &Region, spacing: f64, neighbours: &[f64]) -> f64 {
    let mut best = 45.0;
    let mut best_score = f64::INFINITY;
    for i in 0..16 {
        let a = f64::from(i) * 11.25;
        let diag = (a - 45.0).abs().min((a - 135.0).abs()) / 45.0;
        let near = neighbours.iter().any(|&n| {
            let d = (((a - n) % 180.0) + 180.0) % 180.0;
            let d = d.abs();
            d.min(180.0 - d) < 30.0
        });
        let score = section_count(r, a, spacing) as f64 + 0.2 * diag + if near { 0.6 } else { 0.0 };
        if score < best_score {
            best_score = score;
            best = a;
        }
    }
    best
}

/// Order of the sections: greedily the nearest entry next. With `last`, that section is kept for
/// the end. `cost` adds up the straight ways between sections and, with `end`, on to there.
fn plan(
    f: &Frame,
    secs: &[Section],
    pull: f64,
    start: Pt,
    last: Option<(usize, Entry)>,
    end: Option<Pt>,
) -> (Vec<(usize, Entry)>, f64) {
    let mut todo: Vec<usize> = (0..secs.len())
        .filter(|&s| Some(s) != last.map(|l| l.0))
        .collect();
    let mut order = Vec::new();
    let mut pos = start;
    let mut cost = 0.0;
    while !todo.is_empty() {
        let mut bi = 0;
        let mut be = entries(f, &secs[todo[0]], pull)[0];
        let mut bd = f64::INFINITY;
        for (i, &s) in todo.iter().enumerate() {
            for e in entries(f, &secs[s], pull) {
                let d = dist(pos, e.p);
                if d < bd {
                    bd = d;
                    bi = i;
                    be = e;
                }
            }
        }
        let s = todo.remove(bi);
        order.push((s, be));
        cost += bd;
        pos = exit_of(f, &secs[s], &be, pull);
    }
    if let Some(l) = last {
        cost += dist(pos, l.1.p);
        order.push(l);
        pos = exit_of(f, &secs[l.0], &l.1, pull);
    }
    if let Some(end) = end {
        cost += dist(pos, end);
    }
    (order, cost)
}

/// A tour begins at its start this close outside the area too (mm).
const START_NEAR: f64 = 0.3;
/// A tour walks hidden from its start to its first row only this far (mm); farther, it jumps.
const START_WALK: f64 = 3.0;
/// The rows plan their tour anew from where the underlay ended when that is farther than this (mm).
const REPLAN: f64 = 5.0;
/// The same when choosing the ways into the sections of a tour: hidden ways are only thread.
const TOUR_TRIM_COST: f64 = 100.0;

/// Sections of the frame's rows as pieces to plan.
struct SectionPieces<'f, 'a> {
    f: &'f Frame<'a>,
    secs: &'f [Section],
    pull: f64,
}

impl Pieces for SectionPieces<'_, '_> {
    type W = Entry;
    fn ways(&self, s: usize) -> Vec<Entry> {
        entries(self.f, &self.secs[s], self.pull).to_vec()
    }
    fn p(w: &Entry) -> Pt {
        w.p
    }
    fn exit(&self, s: usize, w: &Entry) -> Pt {
        exit_of(self.f, &self.secs[s], w, self.pull)
    }
    fn prints(&self, s: usize, grid: &mut TravelGrid) -> Vec<Footprint> {
        let f = self.f;
        let mut out = Vec::new();
        for seg in &self.secs[s] {
            for [a, b] in f.pieces(seg.u0, seg.u1, f.v(seg.k)) {
                out.push(grid.footprint(a, b, f.half()));
            }
        }
        out
    }
}

/// A turn from row to row up to this long along the rows (mm) is as usual; see turn_cost.
const TURN_FREE: f64 = 1.0;

/// What the turns to and from gap rows cost a section entered this way (mm).
fn turn_cost(s: &[Seg], e: &Entry) -> f64 {
    let list: Vec<Seg> = if e.reversed {
        s.iter().rev().copied().collect()
    } else {
        s.to_vec()
    };
    let mut cost = 0.0;
    for i in 0..list.len().saturating_sub(1) {
        let (a, b) = (list[i], list[i + 1]);
        if !a.gap && !b.gap {
            continue;
        }
        // Row i ends where row i + 1 starts: at their high ends (u1) when row i runs forward.
        let fwd = (i % 2 == 0) != e.flip;
        let d = if fwd {
            (a.u1 - b.u1).abs()
        } else {
            (a.u0 - b.u0).abs()
        };
        cost += (d - TURN_FREE).max(0.0);
    }
    cost
}

/// Where to start the rows of sections sewn in this order, each from the end (first or last row) the
/// plan chose (`planned`): at the start or at the end of that row, whichever makes the cheapest way
/// through them all (Viterbi). On `grid` a way costs what planning counts (hidden travel, else a
/// trim), else its straight length; with `end`, the way there counts too.
fn entries_for(
    f: &Frame,
    secs: &[Section],
    planned: &[Entry],
    pull: f64,
    start: Pt,
    grid: Option<&mut TravelGrid>,
    end: Option<Pt>,
) -> Vec<(Section, Entry)> {
    let pieces = SectionPieces { f, secs, pull };
    let on_grid = grid.is_some();
    let mut plan = grid.map(|g| planning(g, &pieces));
    let kept = plan.as_ref().map(|p| p.grid.keep());
    struct State {
        e: Entry,
        cost: f64,
        from: usize,
    }
    let mut layers: Vec<Vec<State>> = Vec::new();
    let mut prev: Vec<(Pt, f64)> = vec![(start, 0.0)];
    for (i, s) in secs.iter().enumerate() {
        let mut layer = Vec::new();
        for e in entries(f, s, pull) {
            if e.reversed != planned[i].reversed {
                continue;
            }
            let turns = turn_cost(s, &e);
            let (mut bc, mut bf) = (f64::INFINITY, 0);
            for (j, q) in prev.iter().enumerate() {
                let step = match &mut plan {
                    Some(p) => p.step_cost(q.0, e.p),
                    None => dist(q.0, e.p),
                };
                let c = q.1 + step + turns;
                if c < bc {
                    bc = c;
                    bf = j;
                }
            }
            layer.push(State {
                e,
                cost: bc,
                from: bf,
            });
        }
        if let Some(p) = &mut plan {
            p.cover(i);
        }
        prev = layer
            .iter()
            .map(|x| (exit_of(f, s, &x.e, pull), x.cost))
            .collect();
        layers.push(layer);
    }
    if let (Some(p), Some(k)) = (&mut plan, &kept) {
        p.grid.back(k);
    }
    let total: Vec<f64> = prev
        .iter()
        .map(|q| {
            q.1 + match end {
                Some(end) => {
                    if on_grid {
                        end_cost(q.0, end)
                    } else {
                        dist(q.0, end)
                    }
                }
                None => 0.0,
            }
        })
        .collect();
    let min = total.iter().copied().fold(f64::INFINITY, f64::min);
    let mut at = total.iter().position(|&t| t == min).unwrap_or(0);
    let mut out = Vec::with_capacity(secs.len());
    for i in (0..secs.len()).rev() {
        out.push((secs[i].clone(), layers[i][at].e));
        at = layers[i][at].from;
    }
    out.reverse();
    out
}

/// Where sections touch across a row line (see tour.rs): the last row of one and the first row of
/// the next, as far as both overlap along the rows and the step between them stays inside.
fn section_touches(f: &Frame, secs: &[Section], grid: &TravelGrid) -> Vec<Vec<Touch>> {
    let mut by_first: IdMap<i64, Vec<usize>> = IdMap::default();
    for (i, s) in secs.iter().enumerate() {
        by_first.entry(s[0].k).or_default().push(i);
    }
    let mut touches: Vec<Vec<Touch>> = vec![Vec::new(); secs.len()];
    let inside = |u: f64, v: f64| {
        let q = f.at(u, v);
        if let Some(area) = f.area {
            return sample(area, area.sdf(), q[0], q[1]) < f.spacing / 2.0;
        }
        grid.index(q)
            .is_some_and(|c| f64::from(grid.depth[c]) > -f.spacing / 2.0)
    };
    for (i, s) in secs.iter().enumerate() {
        let last = s[s.len() - 1];
        let Some(js) = by_first.get(&(last.k + 1)) else {
            continue;
        };
        for &j in js {
            let first = secs[j][0];
            let u0 = last.u0.max(first.u0);
            let u1 = last.u1.min(first.u1);
            if u1 <= u0 {
                continue;
            }
            let v = (f.v(last.k) + f.v(first.k)) / 2.0;
            if !inside((u0 + u1) / 2.0, v) {
                continue;
            }
            let at = f.at((u0 + u1) / 2.0, v);
            touches[i].push(Touch {
                to: j,
                side: 1,
                at,
                width: u1 - u0,
            });
            touches[j].push(Touch {
                to: i,
                side: 0,
                at,
                width: u1 - u0,
            });
        }
    }
    touches
}

/// Cell size of the coarse grid that estimates ways for the tour (mm).
const TOUR_CELL: f64 = 1.0;

/// Lengths of ways inside the grid's area, estimated on a coarse grid (Dijkstra, 8 neighbours) for
/// choosing the tour: the straight line underestimates ways round holes and notches. Points that
/// no way joins get the straight line.
struct InsideWays {
    cell: f64,
    w: usize,
    h: usize,
    ox: f64,
    oy: f64,
    open: Vec<u8>,
    cache: RefCell<IdMap<usize, Vec<f32>>>,
}

impl InsideWays {
    fn new(grid: &TravelGrid, area: Option<&Region>) -> InsideWays {
        let k = round(TOUR_CELL / grid.cell).max(1.0) as usize;
        let cell = grid.cell * k as f64;
        let w = grid.gw.div_ceil(k);
        let h = grid.gh.div_ceil(k);
        let mut open = vec![0u8; w * h];
        for j in 0..grid.gh {
            for i in 0..grid.gw {
                let inside = match area {
                    Some(a) => {
                        sample(
                            a,
                            a.sdf(),
                            grid.ox + (i as f64 + 0.5) * grid.cell,
                            grid.oy + (j as f64 + 0.5) * grid.cell,
                        ) < -0.05
                    }
                    None => grid.depth[j * grid.gw + i] > 0.05,
                };
                if inside {
                    open[(j / k) * w + i / k] = 1;
                }
            }
        }
        InsideWays {
            cell,
            w,
            h,
            ox: grid.ox,
            oy: grid.oy,
            open,
            cache: RefCell::new(IdMap::default()),
        }
    }

    fn at(&self, p: Pt) -> usize {
        let i = ((p[0] - self.ox) / self.cell)
            .floor()
            .clamp(0.0, (self.w - 1) as f64) as usize;
        let j = ((p[1] - self.oy) / self.cell)
            .floor()
            .clamp(0.0, (self.h - 1) as f64) as usize;
        j * self.w + i
    }

    fn from(&self, s: usize, q: usize) -> f32 {
        if let Some(d) = self.cache.borrow().get(&s) {
            return d[q];
        }
        let (w, h) = (self.w, self.h);
        let mut d = vec![f32::INFINITY; w * h];
        d[s] = 0.0;
        let mut heap = MinHeap::new();
        heap.push(s as i32, 0.0);
        while !heap.is_empty() {
            let c = heap.pop() as usize;
            let ci = (c % w) as i64;
            let cj = (c / w) as i64;
            for m in 0..8 {
                let i = ci + STEP_I[m];
                let j = cj + STEP_J[m];
                if i < 0 || j < 0 || i >= w as i64 || j >= h as i64 {
                    continue;
                }
                let q = j as usize * w + i as usize;
                if self.open[q] == 0 {
                    continue;
                }
                let nd = f64::from(d[c]) + STEP_LEN[m] * self.cell;
                if nd < f64::from(d[q]) {
                    d[q] = nd as f32;
                    heap.push(q as i32, nd);
                }
            }
        }
        let v = d[q];
        self.cache.borrow_mut().insert(s, d);
        v
    }

    fn way(&self, p: Pt, q: Pt) -> f64 {
        let l = f64::from(self.from(self.at(p), self.at(q)));
        let d = dist(p, q);
        if l.is_finite() { d.max(l) } else { d }
    }
}

/// The order of the sections as one tour with hidden travel (see tour.rs).
fn tour_order(
    f: &Frame,
    secs: &[Section],
    pull: f64,
    start: Pt,
    grid: &TravelGrid,
    end: Option<Pt>,
) -> Vec<(usize, Entry)> {
    let ways_in = InsideWays::new(grid, f.area);
    let d = |p: Pt, q: Pt| ways_in.way(p, q);
    let ways = |i: usize, from: u8| -> Vec<Way<Entry>> {
        entries(f, &secs[i], pull)
            .into_iter()
            .filter(|e| e.reversed == (from == 1))
            .map(|e| Way {
                w: e,
                p: e.p,
                exit: exit_of(f, &secs[i], &e, pull),
            })
            .collect()
    };
    let input = TourInput {
        touches: section_touches(f, secs, grid),
        dist: &d,
        ways: &ways,
    };
    let fin = end.map(|end| move |p: Pt| end_cost(p, end));
    let fin_ref: Option<&dyn Fn(Pt) -> f64> = fin.as_ref().map(|f| f as &dyn Fn(Pt) -> f64);
    tour(&input, start, fin_ref, grid.trim_cost)
        .into_iter()
        .map(|st| (st.i, st.w))
        .collect()
}

/// What sew_all is given beyond the sections.
struct SewOpts<'g> {
    end: Option<Pt>,
    outer: Option<&'g mut TravelGrid>,
    joins: Option<Joins>,
    hidden: bool,
    planned: Option<Vec<(usize, Entry)>>,
}

/// Sews the sections greedily nearest first, connected by travel paths or jumps. With `end`, the
/// section that leaves the needle nearest to it is sewn last, when that makes the ways in between
/// and on to `end` shorter. With `hidden` (covering fills) or where parts are left out (the grid
/// knows them), the order and the ends the sections are entered at are planned on the grid instead
/// (beam_on_grid, plan_on_grid).
#[allow(clippy::too_many_arguments)]
fn sew_all(
    f: &Frame,
    secs: &[Section],
    len: f64,
    pull: f64,
    start: Pt,
    grid: &mut TravelGrid,
    avoid_sewn: bool,
    runs: &mut Vec<Vec<Pt>>,
    trail: &mut Vec<[usize; 2]>,
    opts: SewOpts,
) -> Pt {
    let SewOpts {
        end,
        mut outer,
        joins,
        hidden,
        planned,
    } = opts;
    // With `hidden` or where parts are left out, the order and ends of the sections are planned on
    // the grid, so travel keeps under rows still to come (and the parts left out) rather than
    // beside the outline.
    let smart = avoid_sewn && (grid.gone.is_some() || hidden);
    if smart {
        for s in secs {
            for seg in s {
                for [a, b] in f.pieces(seg.u0, seg.u1, f.v(seg.k)) {
                    grid.expect(a, b, f.half());
                }
            }
        }
    }
    let beam = smart && secs.len() <= super::plan::BEAM_PIECES;
    // Rows on top keep their travel hidden by a tour; underlay rows are covered anyway.
    let toured = avoid_sewn && !grid.layered;
    let (trim_cost, slack) = (grid.trim_cost, grid.slack);
    let outer_slack = outer.as_ref().map_or(0.0, |o| o.slack);
    if !grid.layered {
        // A hidden way round the shape is better than a trim as long as it is shorter than a trim is worth.
        grid.trim_cost = trim_cost.max(TOUR_TRIM_COST);
        grid.slack = slack + TOUR_TRIM_COST;
        if let Some(o) = &mut outer {
            o.slack = outer_slack + TOUR_TRIM_COST;
        }
    }
    let order_of = |grid: &mut TravelGrid| -> Vec<(usize, Entry)> {
        let pieces = SectionPieces { f, secs, pull };
        let all: Vec<usize> = (0..secs.len()).collect();
        let planner = |grid: &mut TravelGrid, l: Option<(usize, Entry)>| {
            if smart {
                plan_on_grid(&pieces, &all, start, grid, l, end)
            } else {
                plan(f, secs, pull, start, l, end)
            }
        };
        let mut best = if beam {
            beam_on_grid(&pieces, &all, start, grid, end)
        } else {
            planner(grid, None)
        };
        if let Some(endp) = end
            && !secs.is_empty()
            && !beam
        {
            let mut close: Option<(usize, Entry)> = None;
            let mut cd = f64::INFINITY;
            for (s, sec) in secs.iter().enumerate() {
                for e in entries(f, sec, pull) {
                    let d = dist(exit_of(f, sec, &e, pull), endp);
                    if d < cd {
                        cd = d;
                        close = Some((s, e));
                    }
                }
            }
            if let Some(c) = close {
                let other = planner(grid, Some(c));
                // A little shorter is not worth a different look: at least 2 mm.
                if other.1 < best.1 - 2.0 {
                    best = other;
                }
            }
        }
        best.0
    };
    let order: Vec<(usize, Entry)> = match planned {
        Some(p) => p,
        None => {
            if toured {
                tour_order(f, secs, pull, start, grid, end)
            } else {
                order_of(grid)
            }
        }
    };
    let mut todo: Vec<(Section, Entry)> =
        order.iter().map(|&(s, e)| (secs[s].clone(), e)).collect();
    if toured && (secs.len() > 1 || end.is_some()) && joins.is_none() {
        let ss: Vec<Section> = todo.iter().map(|t| t.0.clone()).collect();
        let es: Vec<Entry> = todo.iter().map(|t| t.1).collect();
        todo = entries_for(f, &ss, &es, pull, start, smart.then_some(&mut *grid), end);
    }
    if let Some(joins) = &joins {
        // Gap rows go with the section sewn first, which only the order tells. The order stays, and
        // each section is entered from the same row; with gap rows its rows may run the other way, so
        // which end of that row it starts at is chosen anew.
        let idx: Vec<usize> = order.iter().map(|o| o.0).collect();
        let grown = with_gap_rows(&idx, secs, joins);
        if grown.iter().any(|g| g.1) {
            let ss: Vec<Section> = grown.into_iter().map(|g| g.0).collect();
            let es: Vec<Entry> = todo.iter().map(|t| t.1).collect();
            todo = entries_for(f, &ss, &es, pull, start, smart.then_some(&mut *grid), end);
        }
    }
    grid.trim_cost = trim_cost;
    let mut pos = start;
    let mut cur: Option<usize> = if runs.is_empty() {
        None
    } else {
        Some(runs.len() - 1)
    };
    // A tour starts at its far end: from a start inside the area and close by (START_WALK) the
    // needle walks there hidden, where the last object left it, rather than jumping.
    let inside = |g: Option<&TravelGrid>| -> bool {
        g.and_then(|g| {
            g.index(start)
                .map(|at| f64::from(g.depth[at]) > -START_NEAR)
        })
        .unwrap_or(false)
    };
    // When the first row begins right there, that row begins at the start instead.
    let mut first: Option<Pt> = None;
    if cur.is_none()
        && toured
        && !todo.is_empty()
        && (inside(Some(grid)) || inside(outer.as_deref()))
    {
        let d = dist(start, todo[0].1.p);
        if (SHORTEST..=START_WALK).contains(&d) {
            runs.push(vec![start]);
            cur = Some(runs.len() - 1);
        } else if d < SHORTEST {
            first = Some(start);
        }
    }
    for (s, e) in &todo {
        let bd = dist(pos, e.p);
        let pts = sew_section(f, s, len, pull, e.reversed, e.flip);
        // Travel to the entry: straight when close, else along the inside of the shape.
        let mut travel: Option<Vec<Pt>> = None;
        if cur.is_some() && bd > 1.0 {
            // Where the grid has no way (from outside it, or between its parts), the outer one may.
            let path = match grid.path(pos, pts[0], avoid_sewn) {
                Some(p) => Some(p),
                None => outer
                    .as_deref_mut()
                    .and_then(|o| o.path(pos, pts[0], avoid_sewn)),
            };
            if let Some(path) = path {
                let pl = path_length(&path);
                if toured && pl < grid.way(bd) {
                    grid.tread(&path);
                }
                if pl < grid.way(bd) {
                    travel = Some(match &f.on_lines {
                        Some(ol) => run_stitch(&ol.apply(&path), TRAVEL_STITCH, LINE_TOLERANCE),
                        None => run_stitch(&path, TRAVEL_STITCH, TRAVEL_TOLERANCE),
                    });
                }
            }
        } else if cur.is_some() {
            travel = Some(vec![pos]);
        }
        if let (Some(_), Some(t)) = (cur, &travel)
            && t.len() > 2
        {
            note_travel(trail, runs, t.len());
        }
        match (cur, travel) {
            (Some(c), Some(t)) => {
                let run = &mut runs[c];
                run.extend_from_slice(&t[1..]);
                // Straight on, points closer than a stitch may be (see SHORTEST) go into the next
                // stitch, as between the single short rows of a narrow tip; such a row may go
                // altogether. A step as long as the rows lie apart is a turn and stays.
                let mut k = if t.len() > 1 { 1 } else { 0 };
                let near = SHORTEST.min(f.spacing) - 1e-3;
                while k < pts.len() && dist(*run.last().unwrap(), pts[k]) < near {
                    k += 1;
                }
                run.extend_from_slice(&pts[k..]);
            }
            _ => {
                let run = match first {
                    Some(fp) if pts.len() > 2 => {
                        let mut v = vec![fp];
                        v.extend_from_slice(&pts[1..]);
                        v
                    }
                    _ => pts,
                };
                runs.push(run);
                cur = Some(runs.len() - 1);
            }
        }
        for seg in s {
            for [a, b] in f.pieces(seg.u0, seg.u1, f.v(seg.k)) {
                grid.cover(a, b, f.half());
            }
        }
        pos = *runs[cur.unwrap()].last().unwrap();
    }
    grid.slack = slack;
    if let Some(o) = outer {
        o.slack = outer_slack;
    }
    pos
}

/// Fill stitches for the region, starting near `start`. None if no row fits into the region.
pub fn fill_region(
    r: &Region,
    p: &FillParams,
    start: Pt,
    neighbours: &[f64],
) -> Option<FillResult> {
    let angle = p
        .angle
        .unwrap_or_else(|| choose_angle(r, p.spacing, neighbours));
    let mut f = Frame::new(
        angle,
        p.spacing,
        p.spacing_end.unwrap_or(p.spacing),
        p.offset.unwrap_or(1.0 / STAGGERS),
    );
    if let Some(w) = p.wave {
        f.wave = Some(Wave {
            height: w.height,
            k: (2.0 * std::f64::consts::PI) / w.length.max(1.0),
            tol: p.tolerance.unwrap_or(TOLERANCE),
        });
    } else if let Some(em) = &p.emboss {
        f.emboss = Some(em.clone());
    } else if let Some(t) = &p.texture {
        f.texture = Some(t.clone());
    }
    if p.fade.is_some() {
        f.fade = p.fade;
    }
    if p.wave.is_none() && !f.gradient() {
        on_grid(&mut f);
    }
    if p.row_ends.is_some() && p.wave.is_none() {
        f.edge = Some(r);
    }
    f.area = Some(r);
    let top = rows(r, r.sdf(), &mut f, 0.0);
    if top.is_empty() {
        return None;
    }
    let mut runs: Vec<Vec<Pt>> = Vec::new();
    let mut grid = TravelGrid::new(
        p.travel.as_ref().unwrap_or(r),
        p.off_row_ends == Some(true),
        p.whole.as_ref().map(|w| (w, r)),
    );
    grid.walks = p.save_trims == Some(true);
    let secs = sections(r, r.sdf(), &f, &top);
    // The underlay ends where the rows on top begin their tour, at the far end of a branch, so the
    // rows need no way there. Where it cannot end near there, the rows plan their tour anew from
    // where it did end.
    let mut planned = if p.underlay {
        Some(tour_order(&f, &secs, p.pull, start, &grid, p.end))
    } else {
        None
    };
    let pos = match &planned {
        Some(pl) => {
            let first = pl[0].1.p;
            sew_underlay(r, angle, p, start, &mut grid, &mut runs, Some(first))
        }
        None => start,
    };
    if planned
        .as_ref()
        .is_some_and(|pl| dist(pos, pl[0].1.p) > REPLAN)
    {
        planned = None;
    }
    let under = point_count(&runs);
    let gap = if f.gradient() {
        0.0
    } else {
        GAP_ROWS_MAX.min(round(p.gap_rows.unwrap_or(0.0)).max(0.0))
    };
    let mut travel = Vec::new();
    let joins = if gap != 0.0 && secs.len() > 1 {
        Some(section_joins(r, &f, &secs, gap as i64))
    } else {
        None
    };
    sew_all(
        &f,
        &secs,
        p.stitch,
        p.pull,
        pos,
        &mut grid,
        true,
        &mut runs,
        &mut travel,
        SewOpts {
            end: p.end,
            outer: None,
            joins,
            hidden: true,
            planned,
        },
    );
    Some(FillResult {
        runs,
        angle,
        under,
        travel,
        curved: false,
    })
}

/// Crosshatch: the two layers cross at this angle each side of the fill angle (degrees).
pub const CROSSHATCH_HALF: f64 = 45.0;
/// Crosshatch: the half width of the thread a sparse row covers for travel, in cells of the grid.
const CROSSHATCH_LANE: f64 = 0.8;
/// Crosshatch: travel along its net may take this many times the straight way.
const CROSSHATCH_DETOUR: f64 = 5.0;
/// Crosshatch: what a jump costs when planning (mm of travel); its locks show in a light fill.
const CROSSHATCH_TRIM: f64 = 60.0;
/// Travel laid onto a line of thread is taken this far from a point to the line (mm).
const ONTO_LINE: f64 = 0.45;
/// Travel along lines of thread keeps this close to them (mm): it hides under the thread.
const LINE_TOLERANCE: f64 = 0.05;

/// A point of a travel path and the rows of each lattice it lies on.
#[derive(Clone, Copy)]
struct On {
    q: Pt,
    on: [Option<f64>; 2],
}

impl OntoLines<'_> {
    fn cross(&self, k0: f64, k1: f64) -> Pt {
        // q·n0 = k0·s0 and q·n1 = k1·s1.
        let [a, b] = self.n;
        let det = a[0] * b[1] - a[1] * b[0];
        let va = k0 * self.spacing[0];
        let vb = k1 * self.spacing[1];
        [(va * b[1] - vb * a[1]) / det, (a[0] * vb - b[0] * va) / det]
    }

    fn rows_at(&self, q: Pt, near: f64) -> [Option<f64>; 2] {
        let mut out = [None; 2];
        for i in 0..2 {
            let n = self.n[i];
            let v = q[0] * n[0] + q[1] * n[1];
            let k = round(v / self.spacing[i]);
            if (v - k * self.spacing[i]).abs() <= near {
                out[i] = Some(k);
            }
        }
        out
    }

    fn inside(&self, q: Pt) -> bool {
        sample(self.r, self.r.sdf(), q[0], q[1]) < 0.0
    }

    fn snap(&self, q: Pt) -> On {
        let on = self.rows_at(q, ONTO_LINE);
        let Some(i) = on.iter().position(|k| k.is_some()) else {
            return On { q, on };
        };
        let n = self.n[i];
        let d = q[0] * n[0] + q[1] * n[1] - on[i].unwrap() * self.spacing[i];
        let at = match on {
            [Some(a), Some(b)] => self.cross(a, b),
            _ => [q[0] - d * n[0], q[1] - d * n[1]],
        };
        // Near the outline a row may end before the point: it stays where the grid had it.
        if self.inside(at) {
            On { q: at, on }
        } else {
            On {
                q,
                on: [None, None],
            }
        }
    }

    /// The ways round the corners between p and q, best first.
    fn corners(&self, p: &On, q: &On) -> Vec<Vec<Pt>> {
        for i in 0..2 {
            if p.on[i].is_some() && p.on[i] == q.on[i] {
                return vec![];
            }
        }
        let mut ways = Vec::new();
        for i in 0..2 {
            let j = 1 - i;
            if let (Some(pi), Some(qj)) = (p.on[i], q.on[j]) {
                ways.push(vec![if i == 0 {
                    self.cross(pi, qj)
                } else {
                    self.cross(qj, pi)
                }]);
            }
        }
        for i in 0..2 {
            let (Some(pi), Some(qi)) = (p.on[i], q.on[i]) else {
                continue;
            };
            if pi == qi {
                continue;
            }
            // Two rows of one lattice: across along the other's row nearest the middle.
            let o = 1 - i;
            let n = self.n[o];
            let mid = [(p.q[0] + q.q[0]) / 2.0, (p.q[1] + q.q[1]) / 2.0];
            let m = round((mid[0] * n[0] + mid[1] * n[1]) / self.spacing[o]);
            ways.push(if i == 0 {
                vec![self.cross(pi, m), self.cross(qi, m)]
            } else {
                vec![self.cross(m, pi), self.cross(m, qi)]
            });
        }
        ways
    }

    /// A travel path laid onto the rows of two crossing lattices (each row k at v = k * spacing):
    /// each point near a row onto it, near two onto where they cross. Between two points not on one
    /// row the path turns at crossings. A corner outside the area is left out.
    fn apply(&self, path: &[Pt]) -> Vec<Pt> {
        // The ends are where rows start and end: they stay, on their row.
        let pts: Vec<On> = path
            .iter()
            .enumerate()
            .map(|(i, &q)| {
                if i == 0 || i == path.len() - 1 {
                    On {
                        q,
                        on: self.rows_at(q, 0.05),
                    }
                } else {
                    self.snap(q)
                }
            })
            .collect();
        let mut out = vec![pts[0].q];
        for i in 1..pts.len() {
            if let Some(c) = self
                .corners(&pts[i - 1], &pts[i])
                .into_iter()
                .find(|w| w.iter().all(|&q| self.inside(q)))
            {
                out.extend(c);
            }
            out.push(pts[i].q);
        }
        out
    }
}

/// Crosshatch (Kreuzschraffur): two sparse tatami layers, `p.spacing` apart each, at the fill angle
/// ±CROSSHATCH_HALF, the second sewn on the first; a light, lacy fill the fabric shows through. No
/// underlay and no pull: what is sewn shows.
///
/// Travel is what gives a sparse fill away: between the rows it shows. So a row only covers its
/// thread (lane), and travel keeps to lines thread lies on: rows still to come, of both layers while
/// the first is sewn, which hide it, and rows sewn already, which it only doubles (layered). The two
/// layers cross, so their lines form a net that reaches everywhere, and the way found on the grid is
/// laid exactly onto it (OntoLines).
pub fn crosshatch_fill(r: &Region, p: &FillParams, start: Pt) -> Option<FillResult> {
    let angle = p.angle.unwrap_or(0.0);
    let mut grid = TravelGrid::new(
        p.travel.as_ref().unwrap_or(r),
        p.off_row_ends == Some(true),
        p.whole.as_ref().map(|w| (w, r)),
    );
    if grid.gone.is_none() {
        grid.gone = Some(vec![0; grid.gw * grid.gh]);
    }
    // A jump in a light fill leaves two locks that show; travel along the net does not.
    grid.detour = CROSSHATCH_DETOUR;
    grid.trim_cost = CROSSHATCH_TRIM;
    grid.layered = true;
    let lane = CROSSHATCH_LANE * grid.cell;
    let mut layers: Vec<(Frame, Vec<Section>)> = [angle - CROSSHATCH_HALF, angle + CROSSHATCH_HALF]
        .iter()
        .map(|&a| {
            let mut f = Frame::new(a, p.spacing, p.spacing, p.offset.unwrap_or(1.0 / STAGGERS));
            f.lane = Some(lane);
            let top = rows(r, r.sdf(), &mut f, 0.0);
            let secs = if top.is_empty() {
                vec![]
            } else {
                sections(r, r.sdf(), &f, &top)
            };
            (f, secs)
        })
        .collect();
    if !layers.iter().any(|l| !l.1.is_empty()) {
        return None;
    }
    let onto = OntoLines {
        n: [layers[0].0.n, layers[1].0.n],
        spacing: [layers[0].0.spacing, layers[1].0.spacing],
        r,
    };
    layers[0].0.on_lines = Some(onto);
    layers[1].0.on_lines = Some(onto);
    // The first layer's travel may also hide under the second layer's rows (sew_all counts its own).
    {
        let (f, secs) = &layers[1];
        for s in secs {
            for seg in s {
                grid.expect(f.at(seg.u0, f.v(seg.k)), f.at(seg.u1, f.v(seg.k)), lane);
            }
        }
    }
    let mut runs = Vec::new();
    let mut trail = Vec::new();
    let opts = |end: Option<Pt>| SewOpts {
        end,
        outer: None,
        joins: None,
        hidden: false,
        planned: None,
    };
    let pos = sew_all(
        &layers[0].0,
        &layers[0].1,
        p.stitch,
        0.0,
        start,
        &mut grid,
        true,
        &mut runs,
        &mut trail,
        opts(None),
    );
    // Its own rows still to come are counted anew (the first layer's are a way already, see layered).
    if let Some(a) = &mut grid.ahead {
        a.fill(0);
    }
    sew_all(
        &layers[1].0,
        &layers[1].1,
        p.stitch,
        0.0,
        pos,
        &mut grid,
        true,
        &mut runs,
        &mut trail,
        opts(p.end),
    );
    Some(FillResult {
        runs,
        angle,
        under: 0,
        travel: Vec::new(),
        curved: false,
    })
}

/// The area inside by `share` of its width (0.1: 10 %): the union of the largest circles inside it,
/// each shrunk by `share` of its diameter. A wide part loses more at its edge than a narrow one,
/// and what is left stays one piece along the middle (corners get no islands of their own).
fn inset_by_share(r: &Region, share: f64) -> Vec<u8> {
    let (w, h, px_mm) = (r.w, r.h, r.px_mm);
    let sdf = r.sdf();
    let d: Vec<f32> = sdf.iter().map(|&v| (-v).max(0.0)).collect();
    let k = (1.0 - 2.0 * share).max(0.0);
    // The largest circles: those around pixels whose circle (as far as the edge) no other circle
    // nearby holds. A circle held by another lies along a straight way to its center, as deep as
    // that way is long; 15 % short of that counts as held, for the steps of the pixel grid.
    let mut offs: Vec<(i64, i64, f64)> = Vec::new();
    for dy in -4..=4i64 {
        for dx in -4..=4i64 {
            if (dx != 0 || dy != 0) && dx * dx + dy * dy <= 16 {
                offs.push((dx, dy, 0.85 * hypot(dx as f64, dy as f64) * px_mm));
            }
        }
    }
    // The circle that reaches furthest past each pixel (shrunk radius less the distance to its center).
    let n = w * h;
    let mut bx = vec![0f32; n];
    let mut by = vec![0f32; n];
    let mut br = vec![-1f32; n];
    let mut reach = vec![f32::NEG_INFINITY; n];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if d[i] == 0.0 {
                continue;
            }
            let mut held = false;
            for &(dx, dy, l) in &offs {
                let nx = x as i64 + dx;
                let ny = y as i64 + dy;
                if nx >= 0
                    && ny >= 0
                    && nx < w as i64
                    && ny < h as i64
                    && f64::from(d[ny as usize * w + nx as usize]) >= f64::from(d[i]) + l
                {
                    held = true;
                    break;
                }
            }
            if held {
                continue;
            }
            bx[i] = x as f32;
            by[i] = y as f32;
            br[i] = (k * f64::from(d[i])) as f32;
            reach[i] = br[i];
        }
    }
    let take = |i: usize,
                x: usize,
                y: usize,
                nb: usize,
                bx: &mut [f32],
                by: &mut [f32],
                br: &mut [f32],
                reach: &mut [f32]| {
        if br[nb] < 0.0 {
            return;
        }
        let v = f64::from(br[nb])
            - hypot(x as f64 - f64::from(bx[nb]), y as f64 - f64::from(by[nb])) * px_mm;
        if v > f64::from(reach[i]) {
            reach[i] = v as f32;
            bx[i] = bx[nb];
            by[i] = by[nb];
            br[i] = br[nb];
        }
    };
    for _ in 0..2 {
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                if d[i] == 0.0 {
                    continue;
                }
                if x > 0 {
                    take(i, x, y, i - 1, &mut bx, &mut by, &mut br, &mut reach);
                }
                if y > 0 {
                    take(i, x, y, i - w, &mut bx, &mut by, &mut br, &mut reach);
                    if x > 0 {
                        take(i, x, y, i - w - 1, &mut bx, &mut by, &mut br, &mut reach);
                    }
                    if x < w - 1 {
                        take(i, x, y, i - w + 1, &mut bx, &mut by, &mut br, &mut reach);
                    }
                }
            }
        }
        for y in (0..h).rev() {
            for x in (0..w).rev() {
                let i = y * w + x;
                if d[i] == 0.0 {
                    continue;
                }
                if x < w - 1 {
                    take(i, x, y, i + 1, &mut bx, &mut by, &mut br, &mut reach);
                }
                if y < h - 1 {
                    take(i, x, y, i + w, &mut bx, &mut by, &mut br, &mut reach);
                    if x < w - 1 {
                        take(i, x, y, i + w + 1, &mut bx, &mut by, &mut br, &mut reach);
                    }
                    if x > 0 {
                        take(i, x, y, i + w - 1, &mut bx, &mut by, &mut br, &mut reach);
                    }
                }
            }
        }
    }
    let raw: Vec<u8> = (0..n)
        .map(|i| u8::from(d[i] > 0.0 && reach[i] >= 0.0))
        .collect();
    // Circles near the edge that are not the largest there leave specks of their own: of each piece
    // of the area, only the part around its deepest point is kept.
    let mut piece = vec![-1i64; n];
    let mut mask = vec![0u8; n];
    let neighbours = |i: usize| -> [i64; 4] {
        let x = i % w;
        let i = i as i64;
        [
            if x > 0 { i - 1 } else { -1 },
            if x < w - 1 { i + 1 } else { -1 },
            i - w as i64,
            i + w as i64,
        ]
    };
    for i in 0..n {
        if d[i].partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) || piece[i] >= 0 {
            continue;
        }
        let mut deepest = i;
        let mut stack = vec![i];
        piece[i] = i as i64;
        if sdf[i] < sdf[deepest] {
            deepest = i;
        }
        while let Some(c) = stack.pop() {
            for nb in neighbours(c) {
                if nb < 0 || nb >= n as i64 {
                    continue;
                }
                let nb = nb as usize;
                if !(d[nb] > 0.0 && piece[nb] < 0) {
                    continue;
                }
                piece[nb] = i as i64;
                if sdf[nb] < sdf[deepest] {
                    deepest = nb;
                }
                stack.push(nb);
            }
        }
        if raw[deepest] != 0 {
            let mut stack = vec![deepest];
            mask[deepest] = 1;
            while let Some(c) = stack.pop() {
                for nb in neighbours(c) {
                    if nb < 0 || nb >= n as i64 {
                        continue;
                    }
                    let nb = nb as usize;
                    if !(raw[nb] == 1 && mask[nb] == 0) {
                        continue;
                    }
                    mask[nb] = 1;
                    stack.push(nb);
                }
            }
        }
    }
    mask
}

/// The area the underlay keeps to: the fill's area shrunk by the inset in mm, or by `share` of its
/// width where it is (without slivers too thin to sew). None when nothing is left; `Same` when it
/// is the area itself.
pub enum Under {
    Same,
    Other(Region),
}

pub fn underlay_area(r: &Region, inset: f64, share: Option<f64>) -> Option<Under> {
    let Some(share) = share else {
        if inset.abs() < 1e-3 {
            return Some(Under::Same);
        }
        return expand_region(r, -inset).map(Under::Other);
    };
    if share <= 0.0 {
        return Some(Under::Same);
    }
    let mask = inset_by_share(r, share);
    if !mask.iter().any(|&m| m != 0) {
        return None;
    }
    let sdf = signed_field(&mask, r.w, r.h, r.px_mm);
    // Open it: shrink and grow back, which drops teeth and threads thinner than 1 mm.
    let shrunk = expand_field(r.label, r.x0, r.y0, r.w, r.h, r.px_mm, &sdf, -0.5)?;
    expand_region(&shrunk, 0.5).map(Under::Other)
}

/// Stitch length of the edge run (mm): short enough to follow curves, long enough not to perforate.
pub const EDGE_RUN_STITCH: f64 = 2.0;

/// Edge run (Kantenlauf), the first underlay: a running stitch along the edge of the underlay area,
/// just inside the outline and round every hole. Each loop starts nearest where the needle is;
/// between loops the needle travels inside the area (it lies under the rows), or jumps where no way
/// is short enough. Returns where the needle ends.
fn sew_edge_run(area: &Region, start: Pt, grid: &mut TravelGrid, runs: &mut Vec<Vec<Pt>>) -> Pt {
    let mut pos = start;
    for lp in order_loops(&border_loops(area, 0.0), start) {
        let pts = run_stitch(&lp, EDGE_RUN_STITCH, TOLERANCE);
        let d = dist(pos, pts[0]);
        let has = !runs.is_empty();
        let path = if has && d > 1.0 {
            grid.path(pos, pts[0], false)
        } else {
            None
        };
        if has && d <= 1.0 {
            runs.last_mut().unwrap().extend_from_slice(&pts[1..]);
        } else if let Some(path) = path.filter(|p| has && path_length(p) < grid.way(d)) {
            let cur = runs.last_mut().unwrap();
            cur.extend_from_slice(&run_stitch(&path, TRAVEL_STITCH, TRAVEL_TOLERANCE)[1..]);
            cur.extend_from_slice(&pts[1..]);
        } else {
            runs.push(pts.clone());
        }
        pos = pts[pts.len() - 1];
    }
    pos
}

/// Underlay for top rows at `angle`: rows across them (or two layers crossing at ±45 degrees), three
/// times the top spacing apart (at least 1.2 mm) unless set, inside `underlay_area`; appended to
/// `runs`. Travel between its rows stays inside that area too. Returns where the needle ends.
pub(crate) fn sew_underlay(
    r: &Region,
    angle: f64,
    p: &FillParams,
    start: Pt,
    grid: &mut TravelGrid,
    runs: &mut Vec<Vec<Pt>>,
    end: Option<Pt>,
) -> Pt {
    let us = p
        .under_spacing
        .unwrap_or_else(|| 1.2f64.max(3.0 * p.spacing));
    let mut pos = start;
    // Only where it is wanted (not under later objects); travel still goes the whole area's way.
    let (base, base_is_r) = match &p.under_area {
        Some(a) if a.px_mm == r.px_mm && a.w == r.w && a.h == r.h => (a, false),
        _ => (r, true),
    };
    let area = underlay_area(
        base,
        p.under_inset.unwrap_or(UNDERLAY_INSET),
        p.under_inset_share,
    );
    let (area_ref, same_as_r): (Option<&Region>, bool) = match &area {
        None => (None, false),
        Some(Under::Same) => (Some(base), base_is_r),
        Some(Under::Other(a)) => (Some(a), false),
    };
    if let Some(a) = area_ref
        && p.under_edge == Some(true)
    {
        pos = sew_edge_run(a, pos, grid, runs);
    }
    if let Some(a) = area_ref {
        let mut own = if same_as_r {
            None
        } else {
            Some(TravelGrid::new(a, grid.off_row_ends, None))
        };
        let layers: Vec<f64> = if p.under_cross == Some(true) {
            vec![angle - 45.0, angle + 45.0]
        } else {
            vec![angle + 90.0]
        };
        let nl = layers.len();
        let mut trail = Vec::new();
        for (i, &la) in layers.iter().enumerate() {
            let mut uf = Frame::new(la, us, us, 1.0 / STAGGERS);
            let under = rows(a, a.sdf(), &mut uf, 0.0);
            if under.is_empty() {
                continue;
            }
            let secs = sections(a, a.sdf(), &uf, &under);
            let opts = SewOpts {
                end: if i == nl - 1 { end } else { None },
                outer: None,
                joins: None,
                hidden: false,
                planned: None,
            };
            pos = match &mut own {
                Some(inner) => sew_all(
                    &uf,
                    &secs,
                    UNDERLAY_STITCH,
                    0.0,
                    pos,
                    inner,
                    false,
                    runs,
                    &mut trail,
                    SewOpts {
                        outer: Some(&mut *grid),
                        ..opts
                    },
                ),
                None => sew_all(
                    &uf,
                    &secs,
                    UNDERLAY_STITCH,
                    0.0,
                    pos,
                    grid,
                    false,
                    runs,
                    &mut trail,
                    opts,
                ),
            };
        }
    }
    grid.covered.fill(0);
    grid.row_ends.fill(0);
    pos
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    fn params(spacing: f64) -> FillParams {
        FillParams {
            spacing,
            stitch: 3.0,
            angle: None,
            pull: 0.2,
            underlay: true,
            ..Default::default()
        }
    }

    #[test]
    fn a_ring_fills_in_one_run() {
        let r = region_of(300, 0.1, |x, y| {
            let d = (x - 15.0).hypot(y - 15.0);
            d < 12.0 && d > 5.0
        });
        let res = fill_region(&r, &params(0.4), [3.0, 15.0], &[]).unwrap();
        assert!(res.under > 0);
        assert!(point_count(&res.runs) > 500);
        // Every needle point inside or on the edge.
        for run in &res.runs {
            for q in run {
                assert!(sample(&r, r.sdf(), q[0], q[1]) < 0.6, "{q:?}");
            }
        }
        assert!(res.runs.len() <= 2, "{}", res.runs.len());
    }

    #[test]
    fn crosshatch_has_two_layers() {
        let r = region_of(200, 0.1, |x, y| (x - 10.0).hypot(y - 10.0) < 8.0);
        let mut p = params(1.6);
        p.underlay = false;
        p.pull = 0.0;
        let res = crosshatch_fill(&r, &p, [2.0, 10.0]).unwrap();
        assert!(point_count(&res.runs) > 50);
    }

    #[test]
    fn angle_of_a_long_bar_runs_along_it() {
        let r = region_of(300, 0.1, |x, y| {
            (3.0..27.0).contains(&x) && (13.0..17.0).contains(&y)
        });
        // One section at every angle: the diagonal wins (it hides the rows' direction best).
        assert_eq!(choose_angle(&r, 0.4, &[]), 45.0);
        // Next to a fill at 45 degrees, another angle.
        assert_ne!(choose_angle(&r, 0.4, &[45.0]), 45.0);
        assert!(merged(&[[0.0, 0.0], [0.1, 0.0], [1.0, 0.0]], 0.4).len() == 2);
    }
}
