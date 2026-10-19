//! Exports of the shape area. Forms cross as plain objects (serde), point lists and masks as typed
//! arrays, rastered regions as `RegionData`.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use super::digitize::{RegionData, lines_from};
use crate::digitize::region::Region;
use crate::shape::path::{Form, Mat};
use crate::shape::{band, cdt, ops, parts, rasterize, simplify, svg_path, vectorize};

fn to_js<T: Serialize + ?Sized>(v: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(v).map_err(|e| JsError::new(&e.to_string()))
}

fn form(v: JsValue) -> Result<Form, JsError> {
    serde_wasm_bindgen::from_value(v).map_err(|e| JsError::new(&e.to_string()))
}

/// A form or null.
fn maybe(f: Option<Form>) -> Result<JsValue, JsError> {
    match f {
        Some(f) => to_js(&f),
        None => Ok(JsValue::NULL),
    }
}

/// Closed outlines as `flat` points with `lens` points each.
#[wasm_bindgen]
pub fn triangulate(flat: &[f64], lens: &[u32]) -> Result<JsValue, JsError> {
    let t = cdt::triangulate(&lines_from(flat, lens)).map_err(|e| JsError::new(&e))?;
    to_js(&t)
}

// Operations on forms -------------------------------------------------------------------------

#[wasm_bindgen(js_name = unionForms)]
pub fn union_forms(forms: JsValue) -> Result<JsValue, JsError> {
    let forms: Vec<Form> =
        serde_wasm_bindgen::from_value(forms).map_err(|e| JsError::new(&e.to_string()))?;
    maybe(ops::union_forms(&forms))
}

#[wasm_bindgen(js_name = subtractForm)]
pub fn subtract_form(a: JsValue, b: JsValue) -> Result<JsValue, JsError> {
    maybe(ops::subtract_form(&form(a)?, &form(b)?))
}

#[wasm_bindgen(js_name = intersectForms)]
pub fn intersect_forms(a: JsValue, b: JsValue) -> Result<JsValue, JsError> {
    maybe(ops::intersect_forms(&form(a)?, &form(b)?))
}

#[wasm_bindgen(js_name = areaOfForm)]
pub fn area_of_form(f: JsValue) -> Result<f64, JsError> {
    Ok(ops::area_of_form(&form(f)?))
}

#[derive(Serialize)]
struct Crossed {
    form: Form,
    added: usize,
}

#[wasm_bindgen(js_name = withCrossingNodes)]
pub fn with_crossing_nodes(f: JsValue) -> Result<JsValue, JsError> {
    match ops::with_crossing_nodes(&form(f)?) {
        Some((form, added)) => to_js(&Crossed { form, added }),
        None => Ok(JsValue::NULL),
    }
}

/// Cuts as `flat` points with `lens` points each.
#[wasm_bindgen(js_name = splitForm)]
pub fn split_form(
    f: JsValue,
    flat: &[f64],
    lens: &[u32],
    overlap: f64,
    min_part: f64,
    reach: f64,
) -> Result<JsValue, JsError> {
    match ops::split_form(&form(f)?, &lines_from(flat, lens), overlap, min_part, reach) {
        Some(s) => to_js(&s),
        None => Ok(JsValue::NULL),
    }
}

#[wasm_bindgen(js_name = offsetForm)]
pub fn offset_form(f: JsValue, d: f64, line_width: f64, fit: bool) -> Result<JsValue, JsError> {
    maybe(ops::offset_form(&form(f)?, d, line_width, fit))
}

#[wasm_bindgen(js_name = bandForm)]
pub fn band_form(f: JsValue, w: f64, fit: bool) -> Result<JsValue, JsError> {
    maybe(ops::band_form(&form(f)?, w, fit))
}

#[wasm_bindgen(js_name = strokeForm)]
pub fn stroke_form(
    f: JsValue,
    w: f64,
    cap: &str,
    join: &str,
    miter: f64,
) -> Result<JsValue, JsError> {
    let cap = match cap {
        "round" => ops::StrokeCap::Round,
        "square" => ops::StrokeCap::Square,
        _ => ops::StrokeCap::Butt,
    };
    let join = match join {
        "round" => ops::StrokeJoin::Round,
        "bevel" => ops::StrokeJoin::Bevel,
        _ => ops::StrokeJoin::Miter,
    };
    maybe(ops::stroke_form(&form(f)?, w, cap, join, miter))
}

/// The free parts around shapes, worked out once, for the gap at many points.
#[wasm_bindgen]
pub struct GapFinder {
    g: ops::GapFinder,
}

#[wasm_bindgen]
impl GapFinder {
    pub fn at(&mut self, x: f64, y: f64) -> Result<JsValue, JsError> {
        to_js(&self.g.at([x, y]))
    }
}

#[wasm_bindgen(js_name = gapFinder)]
pub fn gap_finder(obstacles: JsValue, d: f64, mode: &str) -> Result<GapFinder, JsError> {
    let obstacles: Vec<ops::Obstacle> =
        serde_wasm_bindgen::from_value(obstacles).map_err(|e| JsError::new(&e.to_string()))?;
    let mode = match mode {
        "hull" => ops::GapMode::Hull,
        "wrap" => ops::GapMode::Wrap,
        _ => ops::GapMode::Closed,
    };
    Ok(GapFinder {
        g: ops::gap_finder(&obstacles, d, mode),
    })
}

// Paths, curves and parts ---------------------------------------------------------------------

/// `m`: the six numbers of the map to world millimetres.
#[wasm_bindgen(js_name = parsePath)]
pub fn parse_path(d: &str, m: &[f64]) -> Result<JsValue, JsError> {
    let m: Mat = m
        .try_into()
        .map_err(|_| JsError::new("a map has six numbers"))?;
    to_js(&svg_path::parse_path(d, &m))
}

#[wasm_bindgen(js_name = simplifyForm)]
pub fn simplify_form(f: JsValue, tol: f64) -> Result<JsValue, JsError> {
    maybe(simplify::simplify_form(&form(f)?, tol))
}

#[wasm_bindgen(js_name = simplifyMore)]
pub fn simplify_more(f: JsValue) -> Result<JsValue, JsError> {
    maybe(simplify::simplify_more(&form(f)?))
}

/// The indices of the paths of each part.
#[wasm_bindgen(js_name = formParts)]
pub fn form_parts(f: JsValue, area: bool, reach: f64) -> Result<JsValue, JsError> {
    to_js(&parts::part_groups(&form(f)?, area, reach))
}

#[wasm_bindgen(js_name = bandEdges)]
pub fn band_edges(f: JsValue, w: f64, offset: f64) -> Result<JsValue, JsError> {
    to_js(&band::band_edges(&form(f)?, w, offset))
}

#[wasm_bindgen(js_name = bandGrip)]
pub fn band_grip(f: JsValue, w: f64, offset: f64) -> Result<JsValue, JsError> {
    match band::band_grip(&form(f)?, w, offset) {
        Some(g) => to_js(&g),
        None => Ok(JsValue::NULL),
    }
}

/// Points as `x, y` pairs; the curves as eight numbers each.
#[wasm_bindgen(js_name = fitCubic)]
pub fn fit_cubic(pts: &[f64], t1: &[f64], t2: &[f64], tol: f64, between: bool) -> Vec<f64> {
    let pts: Vec<[f64; 2]> = pts.chunks_exact(2).map(|c| [c[0], c[1]]).collect();
    vectorize::fit_cubic(&pts, [t1[0], t1[1]], [t2[0], t2[1]], tol, between)
        .into_iter()
        .flat_map(|c| c.into_iter().flatten())
        .collect()
}

#[wasm_bindgen(js_name = fitSingleCubic)]
pub fn fit_single_cubic(pts: &[f64], t1: &[f64], t2: &[f64]) -> Vec<f64> {
    let pts: Vec<[f64; 2]> = pts.chunks_exact(2).map(|c| [c[0], c[1]]).collect();
    vectorize::fit_single_cubic(&pts, [t1[0], t1[1]], [t2[0], t2[1]])
        .into_iter()
        .flatten()
        .collect()
}

/// The region with signed field `sdf_base` in its window, as curves.
#[wasm_bindgen]
pub fn vectorize(
    sdf_base: Vec<f32>,
    w: usize,
    h: usize,
    x0: i32,
    y0: i32,
    px_mm: f64,
    tol: f64,
) -> Result<JsValue, JsError> {
    let r = Region {
        label: 0,
        x0,
        y0,
        w,
        h,
        px_mm,
        mask: Vec::new(),
        inside: Vec::new(),
        sdf_base,
        sdf_grown: None,
        area_mm2: 0.0,
    };
    to_js(&vectorize::vectorize(&r, tol))
}

// Rastering -----------------------------------------------------------------------------------

fn region(r: Option<Region>) -> Option<RegionData> {
    r.map(|r| RegionData { r })
}

#[wasm_bindgen]
pub fn rasterize(f: JsValue, px_mm: f64) -> Result<Option<RegionData>, JsError> {
    Ok(region(rasterize::rasterize(&form(f)?, px_mm)))
}

#[wasm_bindgen(js_name = rasterizeStroke)]
pub fn rasterize_stroke(
    f: JsValue,
    width: f64,
    px_mm: f64,
    flat: bool,
) -> Result<Option<RegionData>, JsError> {
    let cap = if flat {
        rasterize::LineCap::Flat
    } else {
        rasterize::LineCap::Round
    };
    Ok(region(rasterize::rasterize_stroke(
        &form(f)?,
        width,
        px_mm,
        cap,
    )))
}

#[wasm_bindgen(js_name = regionOf)]
pub fn region_of(
    mask: Vec<u8>,
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    px_mm: f64,
) -> Option<RegionData> {
    region(rasterize::region_of(mask, x0, y0, w, h, px_mm, None))
}
