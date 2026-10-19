//! The stitches of a fill from its settings (fillRuns in src/model/restitch.ts): the area grown or
//! shrunk, the fill its pattern asks for (tatami, gradient, contour, spiral, rows that follow old
//! stitches or guide lines, the decorative and the open patterns), irregular rows, and the
//! underlay left out under what lies on top. Reading a fill from stitches stays TypeScript.

use serde::Deserialize;

use super::covers::{Cover, cut_away};
use super::restitch::{nan, yes};
use super::runs::Run;
use crate::digitize::deco::{
    self, CrossGrid, CrossKind, Figure, GridKind, Motif, OpenParams, Texture, ZigzagRows,
    region_box,
};
use crate::digitize::fill::{
    Emboss, Fade, FillParams, FillResult, TextureSpec, crosshatch_fill, fill_region,
};
use crate::digitize::flow::{self, DirField, Grid};
use crate::digitize::region::{Region, expand_region, signed_field};
use crate::digitize::spiral::spiral_fill;
use crate::geom::Pt;
use crate::image::edt::distance_inside;
use crate::js::hypot;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FillPattern {
    Tatami,
    Gradient,
    Contour,
    Spiral,
    Follow,
    Guided,
    Waves,
    Grain,
    Rays,
    Swirl,
    Circles,
    Meander,
    Maze,
    Grid,
    Motifs,
    Echo,
    Cross,
    Crosshatch,
}

impl FillPattern {
    pub fn is_open(self) -> bool {
        use FillPattern::*;
        matches!(
            self,
            Meander | Maze | Grid | Motifs | Echo | Cross | Crosshatch
        )
    }
    fn is_deco(self) -> bool {
        use FillPattern::*;
        matches!(self, Waves | Grain | Rays | Swirl | Circles)
    }
}

fn truthy<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(d)?.unwrap_or(false))
}

/// DecoSettings of restitch.ts (the blend it may name is not needed to sew it).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoSettings {
    #[serde(default)]
    pub emboss: Option<Motif>,
    #[serde(default)]
    pub emboss_size: Option<f64>,
    #[serde(default, deserialize_with = "truthy")]
    pub emboss_strong: bool,
    #[serde(default)]
    pub emboss_angle: Option<f64>,
    #[serde(default)]
    pub texture: Option<Texture>,
    #[serde(default)]
    pub texture_size: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub length: Option<f64>,
    #[serde(default)]
    pub strength: Option<f64>,
    #[serde(default)]
    pub focus: Option<Pt>,
    #[serde(default)]
    pub centers: Option<Vec<Pt>>,
    #[serde(default)]
    pub seed: Option<f64>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub triple: Option<bool>,
    #[serde(default)]
    pub angle: Option<f64>,
    #[serde(default)]
    pub grid: Option<GridKind>,
    #[serde(default)]
    pub cross: Option<CrossKind>,
    #[serde(default, deserialize_with = "truthy")]
    pub own_grid: bool,
    #[serde(default)]
    pub figure: Option<Figure>,
    #[serde(default)]
    pub fade: Option<Fade>,
}

/// FillSettings of restitch.ts.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillSettings {
    pub pattern: FillPattern,
    #[serde(default = "nan")]
    pub spacing: f64,
    #[serde(default)]
    pub spacing_end: Option<f64>,
    #[serde(default, deserialize_with = "truthy")]
    pub gradient: bool,
    #[serde(default)]
    pub offset: Option<f64>,
    #[serde(default)]
    pub angle: Option<f64>,
    #[serde(default = "nan")]
    pub stitch: f64,
    #[serde(default, deserialize_with = "truthy")]
    pub underlay: bool,
    #[serde(default)]
    pub edge: Option<f64>,
    #[serde(default)]
    pub tolerance: Option<f64>,
    #[serde(default)]
    pub guides: Option<Vec<Vec<Pt>>>,
    #[serde(default)]
    pub under_cross: Option<bool>,
    #[serde(default, deserialize_with = "truthy")]
    pub under_edge: bool,
    #[serde(default)]
    pub row_ends: Option<String>,
    #[serde(default)]
    pub under_inset: Option<f64>,
    #[serde(default, deserialize_with = "truthy")]
    pub under_cover: bool,
    #[serde(default, deserialize_with = "truthy")]
    pub save_trims: bool,
    #[serde(default)]
    pub under_inset_share: Option<f64>,
    #[serde(default)]
    pub under_spacing: Option<f64>,
    #[serde(default)]
    pub expand: Option<f64>,
    #[serde(default)]
    pub deco: Option<DecoSettings>,
    #[serde(default)]
    pub rough: Option<f64>,
    #[serde(default)]
    pub rough_seed: Option<f64>,
    #[serde(default)]
    pub gap_rows: Option<f64>,
}

/// The zigzag of the rows a 'follow' fill follows (Zigzag in model/zigzag.ts).
#[derive(Clone, Debug, Deserialize)]
pub struct FollowZigzag {
    #[serde(default, deserialize_with = "truthy")]
    pub straight: bool,
    pub angle: f64,
    pub height: f64,
    pub wave: Pt,
    pub phase: f64,
}

impl FollowZigzag {
    /// The course of its rows and where their peaks lie.
    pub fn rows(&self) -> ZigzagRows {
        ZigzagRows {
            angle: self.angle,
            height: self.height,
            wave: self.wave,
            phase: self.phase,
        }
    }
}

/// Where and along what a fill is sewn (FillWay in restitch.ts). `whole`: the area before what
/// lies on top was left out of it (knockout), which the TypeScript keeps by area.
pub struct FillWay<'a> {
    pub start: Pt,
    pub end: Option<Pt>,
    pub travel: Option<&'a Region>,
    pub covers: &'a [Cover],
    pub rows: Option<&'a [[Pt; 2]]>,
    pub zigzag: Option<&'a FollowZigzag>,
    pub whole: Option<&'a Region>,
}

/// Stitches of a fill: its runs (a trim marked before crosses that meet nowhere), the first
/// `under` points of them its underlay, `border` points in all, travel as point index pairs.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NewFill {
    pub runs: Vec<Run>,
    pub under: usize,
    pub border: usize,
    pub travel: Option<Vec<[usize; 2]>>,
}

/// Rows may crowd this much on a contour field before the fill gives up (times the nominal density).
const CONTOUR_PEAK: f64 = 3.0;
/// How much of an area curved rows must cover (see field_fill).
const FLOW_COVER: f64 = 0.95;
/// Decorative fields: rows crowd more at the start of rays and the eye of a swirl.
const DECO_PEAK: f64 = 3.0;
const DECO_PEAK_POINT: f64 = 5.0;
/// Grain: features about this wide (mm).
const GRAIN_SCALE: f64 = 125.0;
/// No underlay under a cover deeper than this inside it (mm).
const UNDER_COVER_MARGIN: f64 = 0.5;
/// Margin of empty pixels round a union of areas.
const MARGIN: i64 = 4;
/// Texture size when none is set, and its range (mm).
const TEXTURE_SIZE: f64 = 12.0;
const TEXTURE_SIZE_RANGE: [f64; 2] = [4.0, 40.0];
/// Irregular fill at full strength: a point moves by up to this share of the shorter stitch beside it.
pub const ROUGH_FILL: f64 = 0.3;
/// No stitch of an irregular fill gets longer than this many stitch lengths.
pub const ROUGH_LONG: f64 = 1.5;
/// Only points between stitches at least this long move (mm).
const ROUGH_MIN: f64 = 0.8;

/// As Math.min(hi, Math.max(lo, v)), NaN kept.
fn clamp_js(v: f64, lo: f64, hi: f64) -> f64 {
    if v.is_nan() { v } else { v.clamp(lo, hi) }
}

/// The areas together, as one region on the finest grid among them (unionRegion in restitch.ts).
pub fn union_region(rs: &[&Region]) -> Option<Region> {
    match rs.len() {
        0 => return None,
        1 => return Some(rs[0].clone()),
        _ => {}
    }
    let px = rs.iter().map(|r| r.px_mm).fold(f64::INFINITY, f64::min);
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for r in rs {
        min_x = min_x.min(f64::from(r.x0) * r.px_mm);
        min_y = min_y.min(f64::from(r.y0) * r.px_mm);
        max_x = max_x.max((f64::from(r.x0) + r.w as f64) * r.px_mm);
        max_y = max_y.max((f64::from(r.y0) + r.h as f64) * r.px_mm);
    }
    let x0 = (min_x / px).floor() as i64 - MARGIN;
    let y0 = (min_y / px).floor() as i64 - MARGIN;
    let w = ((max_x / px).ceil() as i64 + MARGIN - x0) as usize;
    let h = ((max_y / px).ceil() as i64 + MARGIN - y0) as usize;
    let mut mask = vec![0u8; w * h];
    let mut area = 0usize;
    for y in 0..h {
        let y_mm = (y as f64 + y0 as f64 + 0.5) * px;
        for x in 0..w {
            let x_mm = (x as f64 + x0 as f64 + 0.5) * px;
            for r in rs {
                let u = (x_mm / r.px_mm).floor() as i64 - i64::from(r.x0);
                let v = (y_mm / r.px_mm).floor() as i64 - i64::from(r.y0);
                if u >= 0
                    && v >= 0
                    && (u as usize) < r.w
                    && (v as usize) < r.h
                    && r.mask[v as usize * r.w + u as usize] != 0
                {
                    mask[y * w + x] = 1;
                    area += 1;
                    break;
                }
            }
        }
    }
    let sdf = signed_field(&mask, w, h, px);
    Some(Region {
        label: 0,
        x0: x0 as i32,
        y0: y0 as i32,
        w,
        h,
        px_mm: px,
        inside: distance_inside(&mask, w, h),
        mask,
        sdf_base: sdf,
        sdf_grown: None,
        area_mm2: area as f64 * px * px,
    })
}

/// JavaScript's ToInt32.
fn to_i32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    x.trunc().rem_euclid(4294967296.0) as u32 as i32
}

/// A repeatable number from 0 to 1 for point `i` and `seed`.
fn rough_hash(i: usize, seed: f64) -> f64 {
    let imul = |a: i32, b: i32| a.wrapping_mul(b);
    let mut h = imul(
        to_i32(i as f64) ^ 0x9e3779b9u32 as i32,
        0x85ebca6bu32 as i32,
    ) ^ imul(to_i32(seed + f64::from(0x27d4eb2f)), 0xc2b2ae35u32 as i32);
    h = imul(h ^ ((h as u32) >> 16) as i32, 0x7feb352d);
    h = imul(h ^ ((h as u32) >> 15) as i32, 0x846ca68bu32 as i32);
    f64::from((h ^ ((h as u32) >> 16) as i32) as u32) / 4294967296.0
}

/// Moves the needle points of the runs, from point `from` on, along their row by a random share of
/// the shorter stitch beside them, up to `k` · ROUGH_FILL. Row ends, corners and short steps
/// keep their place, so the edge and the density stay.
pub fn roughen_runs(runs: &mut [Vec<Pt>], from: usize, k: f64, seed: f64, long: f64) {
    let straight = (20.0f64 * std::f64::consts::PI / 180.0).cos();
    let mut n = 0;
    for run in runs.iter_mut() {
        for i in 1..run.len().saturating_sub(1) {
            let no = n + i;
            if no < from {
                continue;
            }
            // The point before has moved already: the stitch to it is measured as it is now.
            let (a, q, b) = (run[i - 1], run[i], run[i + 1]);
            let la = hypot(q[0] - a[0], q[1] - a[1]);
            let lb = hypot(b[0] - q[0], b[1] - q[1]);
            if la < ROUGH_MIN || lb < ROUGH_MIN {
                continue;
            }
            let cos = ((q[0] - a[0]) * (b[0] - q[0]) + (q[1] - a[1]) * (b[1] - q[1])) / (la * lb);
            if cos < straight {
                continue;
            }
            let top = long.max(la).max(lb);
            let lo = (ROUGH_MIN / 2.0 - la).max(lb - top);
            let hi = (lb - ROUGH_MIN / 2.0).min(top - la);
            let d =
                hi.min(lo.max(k * ROUGH_FILL * la.min(lb) * (2.0 * rough_hash(no, seed) - 1.0)));
            let ab = hypot(b[0] - a[0], b[1] - a[1]);
            let (ex, ey) = ((b[0] - a[0]) / ab, (b[1] - a[1]) / ab);
            run[i] = [q[0] + ex * d, q[1] + ey * d];
        }
        n += run.len();
    }
}

/// A point at the share of a box's width and height.
fn at_share(b: [f64; 4], f: Pt) -> Pt {
    [b[0] + f[0] * (b[2] - b[0]), b[1] + f[1] * (b[3] - b[1])]
}

fn on_field(
    r: &Region,
    f: &DirField,
    p: &FillParams,
    start: Pt,
    curved_only: bool,
    peak: f64,
) -> Option<FillResult> {
    flow::field_fill(
        r,
        &Grid::new(r),
        &f.c,
        &f.s,
        p,
        start,
        curved_only,
        peak,
        FLOW_COVER,
    )
}

/// A dense fill with curved rows: wave rows, or rows on one of the decorative fields.
fn deco_fill(r: &Region, s: &FillSettings, fp: &FillParams, start: Pt) -> Option<FillResult> {
    let d = s.deco.clone().unwrap_or_default();
    let angle = s.angle.filter(|a| a.is_finite()).unwrap_or(0.0);
    if s.pattern == FillPattern::Waves {
        return deco::wave_fill(
            r,
            fp,
            angle,
            d.height.unwrap_or(1.8),
            d.length.unwrap_or(20.0),
            start,
        );
    }
    let seed = d.seed.unwrap_or(1.0);
    let b = region_box(r);
    let focus = at_share(
        b,
        d.focus.unwrap_or(if s.pattern == FillPattern::Circles {
            [0.5, 0.5]
        } else {
            [0.5, 0.9]
        }),
    );
    let f = match s.pattern {
        FillPattern::Grain => {
            deco::grain_field(r, angle, d.strength.unwrap_or(0.5), seed, GRAIN_SCALE)
        }
        FillPattern::Rays => deco::ray_field(r, focus),
        FillPattern::Circles => deco::circle_field(r, focus),
        _ => {
            let centers: Option<Vec<Pt>> = d
                .centers
                .as_ref()
                .map(|c| c.iter().map(|&q| at_share(b, q)).collect());
            deco::swirl_field(r, seed, centers.as_deref())
        }
    };
    let peak = if s.pattern == FillPattern::Grain {
        DECO_PEAK
    } else {
        DECO_PEAK_POINT
    };
    on_field(r, &f, fp, start, true, peak)
}

fn open_size(p: FillPattern) -> (f64, [f64; 2]) {
    match p {
        FillPattern::Meander | FillPattern::Maze => (2.5, [1.2, 8.0]),
        FillPattern::Grid => (6.0, [3.0, 20.0]),
        FillPattern::Motifs => (8.0, [5.0, 25.0]),
        FillPattern::Echo => (3.0, [1.2, 10.0]),
        FillPattern::Cross => (2.3, [1.0, 5.0]),
        _ => (1.6, [1.0, 4.0]),
    }
}

/// The grid a cross stitch fill is sewn on: the design's, or one anchored at the top left of
/// `whole` (crossGridOf in restitch.ts).
pub fn cross_grid_of(s: &FillSettings, whole: Option<&Region>) -> Option<CrossGrid> {
    let d = s.deco.clone().unwrap_or_default();
    if s.pattern != FillPattern::Cross || (d.own_grid && whole.is_none()) {
        return None;
    }
    let (def, [lo, hi]) = open_size(FillPattern::Cross);
    let size = clamp_js(d.size.unwrap_or(def), lo, hi);
    let angle = d.angle.unwrap_or(0.0);
    match whole {
        Some(w) if d.own_grid => {
            let b = region_box(w);
            Some(CrossGrid {
                size,
                angle,
                origin: [b[0], b[1]],
            })
        }
        _ => Some(CrossGrid {
            size,
            angle,
            origin: [0.0, 0.0],
        }),
    }
}

/// One of the open patterns: no underlay, no pull.
fn open_fill(r: &Region, s: &FillSettings, fp: &FillParams, start: Pt) -> Option<FillResult> {
    let d = s.deco.clone().unwrap_or_default();
    let (def, [lo, hi]) = open_size(s.pattern);
    let p = OpenParams {
        size: clamp_js(d.size.unwrap_or(def), lo, hi),
        stitch: s.stitch.min(3.0),
        seed: d.seed.unwrap_or(1.0),
        triple: d.triple.unwrap_or(false),
        angle: Some(d.angle.unwrap_or(0.0)),
        origin: None,
    };
    let plain = |res: Option<FillResult>| {
        res.map(|x| FillResult {
            under: 0,
            travel: vec![],
            ..x
        })
    };
    match s.pattern {
        FillPattern::Cross => {
            // Its own grid is anchored at its whole shape, whatever lies on top of it.
            let g = cross_grid_of(s, Some(fp.whole.as_ref().unwrap_or(r)))?;
            let q = OpenParams {
                size: g.size,
                angle: Some(g.angle),
                origin: Some(g.origin),
                ..p
            };
            plain(deco::cross_fill(
                r,
                &q,
                d.cross.unwrap_or(CrossKind::Full),
                start,
            ))
        }
        FillPattern::Crosshatch => {
            let mut q = fp.clone();
            q.spacing = p.size;
            q.stitch = p.stitch;
            q.angle = Some(s.angle.filter(|a| a.is_finite()).unwrap_or(0.0));
            q.pull = 0.0;
            q.underlay = false;
            crosshatch_fill(r, &q, start)
        }
        FillPattern::Meander => plain(deco::meander_fill(r, &p, start)),
        FillPattern::Maze => plain(deco::maze_fill(r, &p, start)),
        // Echo is a contour fill and keeps its travel.
        FillPattern::Echo => deco::echo_fill(r, &p, start).map(|x| FillResult { under: 0, ..x }),
        FillPattern::Grid => plain(deco::grid_fill(
            r,
            &p,
            d.grid.unwrap_or(GridKind::Hex),
            start,
        )),
        _ => plain(deco::motif_fill(
            r,
            &p,
            d.figure.unwrap_or(Figure::Hearts),
            start,
        )),
    }
}

/// Embossing or a texture of a tatami (embossing wins when both are set).
fn looks(d: Option<&DecoSettings>, fp: &mut FillParams) {
    let Some(d) = d else { return };
    if let Some(m) = d.emboss {
        fp.emboss = Some(Emboss {
            motif: m,
            size: d.emboss_size.unwrap_or(8.0),
            strong: Some(d.emboss_strong),
            angle: Some(d.emboss_angle.unwrap_or(0.0)),
        });
    } else if let Some(t) = d.texture {
        let [lo, hi] = TEXTURE_SIZE_RANGE;
        fp.texture = Some(TextureSpec {
            kind: t,
            size: clamp_js(d.texture_size.unwrap_or(TEXTURE_SIZE), lo, hi),
        });
    }
}

/// The stitches of a fill in area `area` with settings `s` (fillRuns in restitch.ts).
pub fn fill_runs(area: &Region, s: &FillSettings, way: &FillWay) -> Option<NewFill> {
    // Grown or shrunk for the stitches only.
    let ex = s.expand.unwrap_or(0.0);
    let grown = if ex.abs() < 1e-3 {
        None
    } else {
        Some(expand_region(area, ex)?)
    };
    let r = grown.as_ref().unwrap_or(area);
    // Grown, the travel may also use the new margin; shrunk, it stays inside the smaller area
    // (None: the area itself).
    let travel = if let (true, Some(t)) = (ex > 0.0, way.travel) {
        Some(union_region(&[t, r]).unwrap_or_else(|| t.clone()))
    } else if ex < 0.0 {
        None
    } else {
        way.travel.cloned()
    };
    let tatami_like = matches!(s.pattern, FillPattern::Tatami | FillPattern::Gradient);
    let mut fp = FillParams {
        spacing: s.spacing,
        stitch: s.stitch,
        angle: s.angle,
        pull: s.edge.unwrap_or(0.0),
        underlay: s.underlay,
        under_cross: s.under_cross,
        under_edge: s.under_edge.then_some(true),
        row_ends: s.row_ends.clone().filter(|v| !v.is_empty() && tatami_like),
        under_inset: s.under_inset,
        under_inset_share: s.under_inset_share,
        under_spacing: s.under_spacing,
        travel,
        tolerance: s.tolerance,
        gap_rows: s.gap_rows.filter(|&g| yes(Some(g))),
        ..Default::default()
    };
    // Parts left out (under what lies on top): travel keeps off the outline beside sewn rows.
    if let Some(w) = way.whole {
        fp.off_row_ends = Some(true);
        fp.whole = Some(w.clone());
    }
    // Under what lies on top completely, no underlay.
    if s.underlay && s.under_cover && !way.covers.is_empty() {
        let margins: Vec<Cover> = way
            .covers
            .iter()
            .map(|c| Cover {
                region: c.region.clone(),
                overlap: UNDER_COVER_MARGIN,
            })
            .collect();
        let (changed, left) = cut_away(r, &margins);
        if changed {
            fp.under_area = left.clone();
        }
        if changed && left.is_none() {
            fp.underlay = false;
        }
    }
    if s.save_trims {
        fp.save_trims = Some(true);
    }
    if let Some(e) = way.end {
        fp.end = Some(e);
    }
    let start = way.start;
    let res = match s.pattern {
        FillPattern::Gradient => {
            let mut q = fp.clone();
            q.spacing_end = s.spacing_end;
            q.fade = s.deco.as_ref().and_then(|d| d.fade);
            fill_region(r, &q, start, &[])
        }
        FillPattern::Contour => flow::contour_fill(r, &fp, start),
        FillPattern::Spiral => spiral_fill(r, &fp, start),
        FillPattern::Follow if way.zigzag.is_some_and(|z| z.straight) && !s.gradient => {
            deco::zigzag_fill(r, &fp, &way.zigzag?.rows(), start)
        }
        FillPattern::Follow => {
            if s.gradient {
                fp.spacing_end = s.spacing_end;
            }
            let f = flow::stitch_field(r, way.rows.unwrap_or(&[]));
            on_field(r, &f, &fp, start, false, CONTOUR_PEAK)
        }
        FillPattern::Guided => {
            let guides = s.guides.as_ref().filter(|g| !g.is_empty())?;
            if s.gradient {
                fp.spacing_end = s.spacing_end;
            }
            let f = flow::guide_field(r, guides);
            on_field(r, &f, &fp, start, false, CONTOUR_PEAK)
        }
        p if p.is_deco() => deco_fill(r, s, &fp, start),
        p if p.is_open() => open_fill(r, s, &fp, start),
        _ => {
            let mut q = fp.clone();
            q.offset = s.offset;
            if s.pattern == FillPattern::Tatami {
                looks(s.deco.as_ref(), &mut q);
            }
            fill_region(r, &q, start, &[])
        }
    };
    let mut res = res?;
    let rough = clamp_js(s.rough.unwrap_or(0.0), 0.0, 1.0);
    if yes(Some(rough)) && !s.pattern.is_open() {
        roughen_runs(
            &mut res.runs,
            res.under,
            rough,
            s.rough_seed.unwrap_or(0.0),
            s.stitch * ROUGH_LONG,
        );
    }
    // Underlay points in runs too short to sew are not sewn either.
    let mut under = 0;
    let mut seen = 0;
    for run in &res.runs {
        let take = run.len().min(res.under.saturating_sub(seen));
        seen += run.len();
        if run.len() > 1 {
            under += take;
        }
    }
    // Travel indices as in the runs kept (runs of one point are left out before them).
    let travel = (!res.travel.is_empty()).then(|| {
        let mut left = Vec::with_capacity(seen);
        let mut gone = 0;
        for run in &res.runs {
            left.extend(std::iter::repeat_n(gone, run.len()));
            if run.len() <= 1 {
                gone += run.len();
            }
        }
        res.travel
            .iter()
            .map(|&[a, b]| [a - left[a], b - left[b]])
            .collect()
    });
    let mut runs: Vec<Run> = res
        .runs
        .into_iter()
        .filter(|r| r.len() > 1)
        .map(Run::new)
        .collect();
    // Crosses that meet nowhere: a trim between them.
    let cross = s.deco.as_ref().and_then(|d| d.cross);
    if s.pattern == FillPattern::Cross && cross != Some(CrossKind::Half) {
        for r in runs.iter_mut().skip(1) {
            r.trim = true;
        }
    }
    let border = runs.iter().map(Run::len).sum();
    Some(NewFill {
        runs,
        under,
        border,
        travel,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    /// Settings of a plain fill with `pattern`.
    pub(crate) fn settings(pattern: FillPattern) -> FillSettings {
        FillSettings {
            pattern,
            spacing: 0.4,
            spacing_end: None,
            gradient: false,
            offset: None,
            angle: Some(30.0),
            stitch: 4.0,
            underlay: true,
            edge: Some(0.2),
            tolerance: Some(0.15),
            guides: None,
            under_cross: None,
            under_edge: false,
            row_ends: None,
            under_inset: None,
            under_cover: false,
            save_trims: false,
            under_inset_share: None,
            under_spacing: None,
            expand: None,
            deco: None,
            rough: None,
            rough_seed: None,
            gap_rows: None,
        }
    }

    fn way(covers: &[Cover]) -> FillWay<'_> {
        FillWay {
            start: [2.0, 2.0],
            end: None,
            travel: None,
            covers,
            rows: None,
            zigzag: None,
            whole: None,
        }
    }

    #[test]
    fn fills_with_underlay_and_leaves_it_out_under_what_covers_it() {
        let r = region_of(200, 0.1, |x, y| (x - 10.0).hypot(y - 10.0) < 8.0);
        let mut s = settings(FillPattern::Tatami);
        let f = fill_runs(&r, &s, &way(&[])).unwrap();
        assert!(f.under > 0 && f.under < f.border);
        assert_eq!(f.border, f.runs.iter().map(Run::len).sum::<usize>());
        // Covered all over: no underlay.
        s.under_cover = true;
        let all = Cover {
            region: region_of(200, 0.1, |_, _| true),
            overlap: 0.0,
        };
        let g = fill_runs(&r, &s, &way(std::slice::from_ref(&all))).unwrap();
        assert_eq!(g.under, 0);
        // Irregular rows move their needle points, not their count.
        s.under_cover = false;
        s.rough = Some(1.0);
        let h = fill_runs(&r, &s, &way(&[])).unwrap();
        assert_eq!(h.border, f.border);
        assert_ne!(h.runs, f.runs);
    }

    #[test]
    fn crosses_that_meet_nowhere_are_trimmed_apart() {
        // Two blobs apart: the crosses of the second start after a trim.
        let r = region_of(200, 0.1, |x, y| {
            (x - 5.0).hypot(y - 10.0) < 3.0 || (x - 15.0).hypot(y - 10.0) < 3.0
        });
        let f = fill_runs(&r, &settings(FillPattern::Cross), &way(&[])).unwrap();
        assert_eq!(f.under, 0);
        assert!(f.runs.len() > 1 && f.runs[1..].iter().all(|r| r.trim) && !f.runs[0].trim);
    }

    #[test]
    fn hashes_as_javascript_does() {
        // Math.imul and the unsigned shifts of roughHash in restitch.ts.
        assert_eq!(to_i32(4294967297.0), 1);
        assert_eq!(to_i32(-1.5), -1);
        let h = rough_hash(7, 3.0);
        assert!((0.0..1.0).contains(&h));
        assert_ne!(h, rough_hash(8, 3.0));
    }

    fn square_rows(underlay: bool) -> FillResult {
        let r = region_of(400, 0.1, |x, y| x > 5.0 && x < 35.0 && y > 5.0 && y < 35.0);
        let p = FillParams {
            spacing: 0.4,
            stitch: 4.0,
            angle: Some(90.0),
            underlay,
            ..Default::default()
        };
        fill_region(&r, &p, [5.0, 5.0], &[]).unwrap()
    }

    #[test]
    fn irregular_rows_move_along_themselves_the_same_each_time() {
        let plain = square_rows(false);
        let mut a = plain.runs.clone();
        let mut b = plain.runs.clone();
        roughen_runs(&mut a, 0, 1.0, 7.0, 4.0 * ROUGH_LONG);
        roughen_runs(&mut b, 0, 1.0, 7.0, 4.0 * ROUGH_LONG);
        assert_eq!(a, b);
        let mut moved = 0;
        let mut count = 0;
        for (run, was) in a.iter().zip(&plain.runs) {
            assert_eq!(run.len(), was.len());
            // Row ends stay where they were: the outline is the same.
            assert_eq!((run[0], run[run.len() - 1]), (was[0], was[was.len() - 1]));
            for (q, p) in run.iter().zip(was) {
                // Rows run up and down (90 degrees): a point moves along y only.
                assert!((q[0] - p[0]).abs() < 0.05);
                if (q[1] - p[1]).abs() > 0.1 {
                    moved += 1;
                }
                count += 1;
            }
            for w in run.windows(2) {
                let l = (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]);
                assert!(l > 0.39 && l <= 4.0 * ROUGH_LONG + 1e-6, "{l}");
            }
        }
        assert!(moved * 3 > count, "{moved} of {count}");
    }

    #[test]
    fn irregular_rows_keep_the_underlay() {
        let plain = square_rows(true);
        let mut a = plain.runs.clone();
        roughen_runs(&mut a, plain.under, 1.0, 3.0, 4.0 * ROUGH_LONG);
        let flat = |r: &[Vec<Pt>]| r.concat()[..plain.under].to_vec();
        assert_eq!(flat(&a), flat(&plain.runs));
    }
}
