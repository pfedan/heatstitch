//! Exports of the fills (digitize/fill, flow, rings, spiral, deco, echo, motif, redwork, border).
//! A region crosses once per call as a RegionIn built from its typed arrays; the settings as a plain
//! object (serde, without the regions in them, which cross as RegionIn of their own); stitches come
//! back as flat x, y lists with the point count of each run.

use wasm_bindgen::prelude::*;

use super::digitize::{RegionData, lines_from};
use crate::digitize::border;
use crate::digitize::deco::{self, CrossKind, Figure, GridKind, OpenParams, ZigzagRows};
use crate::digitize::echo::{EchoSpec, echo_lines};
use crate::digitize::fill::{self, FillParams, FillResult, Under};
use crate::digitize::flow::{self, DirField, OrientLook};
use crate::digitize::motif::{LineMotif, motif_stitches};
use crate::digitize::redwork::{RedworkGraph, RedworkLine, redwork_graph, redwork_walks};
use crate::digitize::region::Region;
use crate::digitize::rings::{self, RingMode};
use crate::digitize::skeleton::Graph;
use crate::geom::{Pt, pts_from_flat, pts_to_flat};

fn to_js<T: serde::Serialize>(v: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(v).map_err(|e| JsError::new(&e.to_string()))
}

fn from_js<T: serde::de::DeserializeOwned>(v: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(v).map_err(|e| JsError::new(&e.to_string()))
}

/// A region from TypeScript. `sdf` is left out when it is `sdfBase` (not grown).
#[wasm_bindgen]
pub struct RegionIn {
    pub(crate) r: Region,
}

#[wasm_bindgen]
impl RegionIn {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        label: i32,
        x0: i32,
        y0: i32,
        w: usize,
        h: usize,
        px_mm: f64,
        area_mm2: f64,
        mask: Vec<u8>,
        inside: Vec<f32>,
        sdf_base: Vec<f32>,
        sdf: Option<Vec<f32>>,
    ) -> RegionIn {
        RegionIn {
            r: Region {
                label,
                x0,
                y0,
                w,
                h,
                px_mm,
                mask,
                inside,
                sdf_base,
                sdf_grown: sdf,
                area_mm2,
            },
        }
    }
}

/// Fill stitches for TypeScript: runs as a flat x, y list and the point count of each.
#[wasm_bindgen]
pub struct FillOut {
    pts: Vec<f64>,
    lens: Vec<u32>,
    travel: Vec<u32>,
    angle: f64,
    under: usize,
    curved: bool,
}

#[wasm_bindgen]
impl FillOut {
    #[wasm_bindgen(js_name = takePts)]
    pub fn take_pts(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.pts)
    }
    #[wasm_bindgen(js_name = takeLens)]
    pub fn take_lens(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.lens)
    }
    /// Travel as first, last point index pairs.
    #[wasm_bindgen(js_name = takeTravel)]
    pub fn take_travel(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.travel)
    }
    #[wasm_bindgen(getter)]
    pub fn angle(&self) -> f64 {
        self.angle
    }
    #[wasm_bindgen(getter)]
    pub fn under(&self) -> usize {
        self.under
    }
    #[wasm_bindgen(getter)]
    pub fn curved(&self) -> bool {
        self.curved
    }
}

pub(crate) fn flat_lines(lines: &[Vec<Pt>]) -> (Vec<f64>, Vec<u32>) {
    let mut pts = Vec::with_capacity(lines.iter().map(|l| 2 * l.len()).sum());
    let mut lens = Vec::with_capacity(lines.len());
    for l in lines {
        lens.push(l.len() as u32);
        pts.extend(pts_to_flat(l));
    }
    (pts, lens)
}

fn out(res: Option<FillResult>) -> Option<FillOut> {
    res.map(|r| {
        let (pts, lens) = flat_lines(&r.runs);
        FillOut {
            pts,
            lens,
            travel: r
                .travel
                .iter()
                .flat_map(|t| [t[0] as u32, t[1] as u32])
                .collect(),
            angle: r.angle,
            under: r.under,
            curved: r.curved,
        }
    })
}

/// Lines for TypeScript: a flat x, y list and the point count of each.
#[wasm_bindgen]
pub struct LinesOut {
    pts: Vec<f64>,
    lens: Vec<u32>,
}

#[wasm_bindgen]
impl LinesOut {
    #[wasm_bindgen(js_name = takePts)]
    pub fn take_pts(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.pts)
    }
    #[wasm_bindgen(js_name = takeLens)]
    pub fn take_lens(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.lens)
    }
}

pub(crate) fn lines_out(lines: &[Vec<Pt>]) -> LinesOut {
    let (pts, lens) = flat_lines(lines);
    LinesOut { pts, lens }
}

/// The settings with the regions in them, which cross on their own.
fn params(
    p: JsValue,
    under_area: Option<RegionIn>,
    travel: Option<RegionIn>,
    whole: Option<RegionIn>,
) -> Result<FillParams, JsError> {
    let mut p: FillParams = from_js(p)?;
    p.under_area = under_area.map(|r| r.r);
    p.travel = travel.map(|r| r.r);
    p.whole = whole.map(|r| r.r);
    Ok(p)
}

#[wasm_bindgen(js_name = fillRegion)]
#[allow(clippy::too_many_arguments)]
pub fn fill_region(
    r: RegionIn,
    p: JsValue,
    sx: f64,
    sy: f64,
    neighbours: &[f64],
    under_area: Option<RegionIn>,
    travel: Option<RegionIn>,
    whole: Option<RegionIn>,
) -> Result<Option<FillOut>, JsError> {
    let p = params(p, under_area, travel, whole)?;
    Ok(out(fill::fill_region(&r.r, &p, [sx, sy], neighbours)))
}

#[wasm_bindgen(js_name = crosshatchFill)]
pub fn crosshatch_fill(
    r: RegionIn,
    p: JsValue,
    sx: f64,
    sy: f64,
    under_area: Option<RegionIn>,
    travel: Option<RegionIn>,
    whole: Option<RegionIn>,
) -> Result<Option<FillOut>, JsError> {
    let p = params(p, under_area, travel, whole)?;
    Ok(out(fill::crosshatch_fill(&r.r, &p, [sx, sy])))
}

#[wasm_bindgen(js_name = chooseAngle)]
pub fn choose_angle(r: RegionIn, spacing: f64, neighbours: &[f64]) -> f64 {
    fill::choose_angle(&r.r, spacing, neighbours)
}

/// Where the underlay goes: null (nowhere), true (the region itself) or the region made smaller.
#[wasm_bindgen(js_name = underlayArea)]
pub fn underlay_area(r: RegionIn, inset: f64, share: Option<f64>) -> JsValue {
    match fill::underlay_area(&r.r, inset, share) {
        None => JsValue::NULL,
        Some(Under::Same) => JsValue::TRUE,
        Some(Under::Other(a)) => RegionData { r: a }.into(),
    }
}

/// Fill along the image's direction: `orient_c`, `orient_s` are the structure tensor's doubled
/// angles over the image window from (`cx0`, `cy0`), `cw` wide, of an image `width` x `height`.
#[wasm_bindgen(js_name = flowFill)]
#[allow(clippy::too_many_arguments)]
pub fn flow_fill(
    r: RegionIn,
    graph: JsValue,
    orient_c: &[f32],
    orient_s: &[f32],
    cx0: usize,
    cy0: usize,
    cw: usize,
    width: usize,
    height: usize,
    p: JsValue,
    sx: f64,
    sy: f64,
    under_area: Option<RegionIn>,
    travel: Option<RegionIn>,
    whole: Option<RegionIn>,
) -> Result<Option<FillOut>, JsError> {
    let graph: Option<Graph> = if graph.is_null() || graph.is_undefined() {
        None
    } else {
        Some(from_js(graph)?)
    };
    let p = params(p, under_area, travel, whole)?;
    let ch = orient_c.len() / cw.max(1);
    let look = |px: usize, py: usize| -> (f32, f32) {
        // Outside the window (never asked for: the window covers the region's grid) counts as flat.
        if px < cx0 || py < cy0 || px - cx0 >= cw || py - cy0 >= ch {
            return (0.0, 0.0);
        }
        let k = (py - cy0) * cw + (px - cx0);
        (orient_c[k], orient_s[k])
    };
    let orient = OrientLook {
        width,
        height,
        look: &look,
    };
    Ok(out(flow::flow_fill(
        &r.r,
        graph.as_ref(),
        &orient,
        &p,
        [sx, sy],
    )))
}

/// A direction field for TypeScript: its doubled angles per cell and the cells.
#[wasm_bindgen]
pub struct FieldOut {
    c: Vec<f32>,
    s: Vec<f32>,
    cell: f64,
    gw: usize,
    gh: usize,
    ox: f64,
    oy: f64,
}

#[wasm_bindgen]
impl FieldOut {
    #[wasm_bindgen(js_name = takeC)]
    pub fn take_c(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.c)
    }
    #[wasm_bindgen(js_name = takeS)]
    pub fn take_s(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.s)
    }
    #[wasm_bindgen(getter)]
    pub fn cell(&self) -> f64 {
        self.cell
    }
    #[wasm_bindgen(getter)]
    pub fn gw(&self) -> usize {
        self.gw
    }
    #[wasm_bindgen(getter)]
    pub fn gh(&self) -> usize {
        self.gh
    }
    #[wasm_bindgen(getter)]
    pub fn ox(&self) -> f64 {
        self.ox
    }
    #[wasm_bindgen(getter)]
    pub fn oy(&self) -> f64 {
        self.oy
    }
}

fn field_out(f: DirField) -> FieldOut {
    FieldOut {
        cell: f.g.cell,
        gw: f.g.gw,
        gh: f.g.gh,
        ox: f.g.ox,
        oy: f.g.oy,
        c: f.c,
        s: f.s,
    }
}

#[wasm_bindgen(js_name = contourField)]
pub fn contour_field(r: RegionIn) -> FieldOut {
    field_out(flow::contour_field(&r.r))
}

/// `lines`: x0, y0, x1, y1 per stitch.
#[wasm_bindgen(js_name = stitchField)]
pub fn stitch_field(r: RegionIn, lines: &[f64]) -> FieldOut {
    let l: Vec<[Pt; 2]> = lines
        .chunks_exact(4)
        .map(|c| [[c[0], c[1]], [c[2], c[3]]])
        .collect();
    field_out(flow::stitch_field(&r.r, &l))
}

#[wasm_bindgen(js_name = guideField)]
pub fn guide_field(r: RegionIn, flat: &[f64], lens: &[u32]) -> FieldOut {
    field_out(flow::guide_field(&r.r, &lines_from(flat, lens)))
}

#[wasm_bindgen(js_name = grainField)]
pub fn grain_field(r: RegionIn, angle: f64, strength: f64, seed: f64, scale: f64) -> FieldOut {
    field_out(deco::grain_field(&r.r, angle, strength, seed, scale))
}

#[wasm_bindgen(js_name = rayField)]
pub fn ray_field(r: RegionIn, fx: f64, fy: f64) -> FieldOut {
    field_out(deco::ray_field(&r.r, [fx, fy]))
}

#[wasm_bindgen(js_name = circleField)]
pub fn circle_field(r: RegionIn, fx: f64, fy: f64) -> FieldOut {
    field_out(deco::circle_field(&r.r, [fx, fy]))
}

/// `centers`: x, y of each center; None places them by the seed.
#[wasm_bindgen(js_name = swirlField)]
pub fn swirl_field(r: RegionIn, seed: f64, centers: Option<Vec<f64>>) -> FieldOut {
    let c = centers.map(|c| pts_from_flat(&c));
    field_out(deco::swirl_field(&r.r, seed, c.as_deref()))
}

/// Fill along a field made by one of the field functions for the same region.
#[wasm_bindgen(js_name = fieldFill)]
#[allow(clippy::too_many_arguments)]
pub fn field_fill(
    r: RegionIn,
    c: &[f32],
    s: &[f32],
    p: JsValue,
    sx: f64,
    sy: f64,
    curved_only: bool,
    peak: f64,
    cover: f64,
    under_area: Option<RegionIn>,
    travel: Option<RegionIn>,
    whole: Option<RegionIn>,
) -> Result<Option<FillOut>, JsError> {
    let p = params(p, under_area, travel, whole)?;
    let g = flow::Grid::new(&r.r);
    if c.len() != g.gw * g.gh || s.len() != c.len() {
        return Err(JsError::new("fieldFill: the field is not of this region"));
    }
    Ok(out(flow::field_fill(
        &r.r,
        &g,
        c,
        s,
        &p,
        [sx, sy],
        curved_only,
        peak,
        cover,
    )))
}

#[wasm_bindgen(js_name = contourFill)]
pub fn contour_fill(
    r: RegionIn,
    p: JsValue,
    sx: f64,
    sy: f64,
    under_area: Option<RegionIn>,
    travel: Option<RegionIn>,
    whole: Option<RegionIn>,
) -> Result<Option<FillOut>, JsError> {
    let p = params(p, under_area, travel, whole)?;
    Ok(out(flow::contour_fill(&r.r, &p, [sx, sy])))
}

/// Rings or a spiral along the outline (see digitize/rings.rs), with underlay at `angle`.
#[wasm_bindgen(js_name = ringFill)]
#[allow(clippy::too_many_arguments)]
pub fn ring_fill(
    r: RegionIn,
    p: JsValue,
    sx: f64,
    sy: f64,
    spiral: bool,
    angle: f64,
    under_area: Option<RegionIn>,
    travel: Option<RegionIn>,
    whole: Option<RegionIn>,
) -> Result<Option<FillOut>, JsError> {
    let p = params(p, under_area, travel, whole)?;
    let mode = if spiral {
        RingMode::Spiral
    } else {
        RingMode::Contour
    };
    Ok(out(rings::ring_fill(&r.r, &p, [sx, sy], mode, angle)))
}

#[wasm_bindgen(js_name = zigzagFill)]
#[allow(clippy::too_many_arguments)]
pub fn zigzag_fill(
    r: RegionIn,
    p: JsValue,
    z: JsValue,
    sx: f64,
    sy: f64,
    under_area: Option<RegionIn>,
    travel: Option<RegionIn>,
    whole: Option<RegionIn>,
) -> Result<Option<FillOut>, JsError> {
    let p = params(p, under_area, travel, whole)?;
    let z: ZigzagRows = from_js(z)?;
    Ok(out(deco::zigzag_fill(&r.r, &p, &z, [sx, sy])))
}

/// The open patterns: `kind` names the pattern (meander, maze, echo, grid, motif, cross) and
/// `variant` its grid, figure or cross kind.
#[wasm_bindgen(js_name = openFill)]
pub fn open_fill(
    r: RegionIn,
    kind: &str,
    variant: JsValue,
    p: JsValue,
    sx: f64,
    sy: f64,
) -> Result<Option<FillOut>, JsError> {
    let p: OpenParams = from_js(p)?;
    let start = [sx, sy];
    let res = match kind {
        "meander" => deco::meander_fill(&r.r, &p, start),
        "maze" => deco::maze_fill(&r.r, &p, start),
        "echo" => deco::echo_fill(&r.r, &p, start),
        "grid" => deco::grid_fill(&r.r, &p, from_js::<GridKind>(variant)?, start),
        "motif" => deco::motif_fill(&r.r, &p, from_js::<Figure>(variant)?, start),
        "cross" => deco::cross_fill(&r.r, &p, from_js::<CrossKind>(variant)?, start),
        _ => return Err(JsError::new("openFill: unknown pattern")),
    };
    Ok(out(res))
}

/// The lines of an echo (see digitize/echo.rs) as plain objects.
#[wasm_bindgen(js_name = echoLines)]
pub fn echo_lines_js(
    line: &[f64],
    closed: bool,
    spec: JsValue,
    min_gap: f64,
    returns: bool,
) -> Result<JsValue, JsError> {
    let spec: EchoSpec = from_js(spec)?;
    to_js(&echo_lines(
        &pts_from_flat(line),
        closed,
        &spec,
        min_gap,
        returns,
    ))
}

#[wasm_bindgen(js_name = motifStitches)]
#[allow(clippy::too_many_arguments)]
pub fn motif_stitches_js(
    line: &[f64],
    closed: bool,
    motif: JsValue,
    width: f64,
    period: f64,
    side: f64,
    shift: f64,
    stitch: f64,
    layers: f64,
    cord: bool,
) -> Result<Vec<f64>, JsError> {
    let motif: LineMotif = from_js(motif)?;
    Ok(pts_to_flat(&motif_stitches(
        &pts_from_flat(line),
        closed,
        motif,
        width,
        period,
        side,
        shift,
        stitch,
        layers,
        cord,
    )))
}

#[wasm_bindgen(js_name = redworkGraph)]
pub fn redwork_graph_js(lines: JsValue, snap: f64) -> Result<JsValue, JsError> {
    let lines: Vec<RedworkLine> = from_js(lines)?;
    to_js(&redwork_graph(&lines, snap))
}

#[wasm_bindgen(js_name = redworkWalks)]
pub fn redwork_walks_js(graph: JsValue, from: Option<Vec<f64>>) -> Result<JsValue, JsError> {
    let g: RedworkGraph = from_js(graph)?;
    to_js(&redwork_walks(&g, from.map(|f| [f[0], f[1]])))
}

/// The graph and its walks in one call: `{ graph, walks }`.
#[wasm_bindgen(js_name = redworkPlan)]
pub fn redwork_plan(lines: JsValue, snap: f64, from: Option<Vec<f64>>) -> Result<JsValue, JsError> {
    #[derive(serde::Serialize)]
    struct Plan<'a> {
        graph: &'a RedworkGraph,
        walks: Vec<Vec<crate::digitize::redwork::Step>>,
    }
    let lines: Vec<RedworkLine> = from_js(lines)?;
    let graph = redwork_graph(&lines, snap);
    let walks = redwork_walks(&graph, from.map(|f| [f[0], f[1]]));
    to_js(&Plan {
        graph: &graph,
        walks,
    })
}

#[wasm_bindgen(js_name = borderLoops)]
pub fn border_loops(r: RegionIn, offset: f64) -> LinesOut {
    lines_out(&border::border_loops(&r.r, offset))
}

/// Rails as two lines (left, right); with `center`, the line they are centered on as a third.
#[wasm_bindgen(js_name = borderRails)]
pub fn border_rails(r: RegionIn, lp: &[f64], w: f64, level: f64, center: bool) -> LinesOut {
    let (rails, c) = border::rails_along(&r.r, &pts_from_flat(lp), w, level);
    let mut lines = vec![rails.left, rails.right];
    if center {
        lines.push(c);
    }
    lines_out(&lines)
}

#[wasm_bindgen(js_name = lineRails)]
pub fn line_rails(line: &[f64], closed: bool, w: f64) -> LinesOut {
    let rails = border::line_rails(&pts_from_flat(line), closed, w);
    lines_out(&[rails.left, rails.right])
}

#[wasm_bindgen(js_name = borderRun)]
pub fn border_run(lp: &[f64], times: u32, tol: f64, len: f64) -> Vec<f64> {
    pts_to_flat(&border::border_run(&pts_from_flat(lp), times, tol, len))
}
