//! Exports of the digitize area. Regions cross as typed arrays and scalars (the TypeScript wrapper
//! puts the object together), graphs and plans as plain objects (serde).

use wasm_bindgen::prelude::*;

use crate::digitize::{measure, medial, region, satin_inner, skeleton};
use crate::geom::Pt;

/// Polylines from a flat x, y list and the point count of each.
pub(crate) fn lines_from(flat: &[f64], lens: &[u32]) -> Vec<Vec<Pt>> {
    let mut out = Vec::with_capacity(lens.len());
    let mut i = 0;
    for &n in lens {
        let n = n as usize;
        out.push(
            flat[2 * i..2 * (i + n)]
                .chunks_exact(2)
                .map(|c| [c[0], c[1]])
                .collect(),
        );
        i += n;
    }
    out
}

fn to_js<T: serde::Serialize>(v: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(v).map_err(|e| JsError::new(&e.to_string()))
}

/// A region made in Rust. Its arrays are taken out once each (no second copy in WebAssembly memory).
#[wasm_bindgen]
pub struct RegionData {
    r: region::Region,
}

#[wasm_bindgen]
impl RegionData {
    #[wasm_bindgen(getter)]
    pub fn x0(&self) -> i32 {
        self.r.x0
    }
    #[wasm_bindgen(getter)]
    pub fn y0(&self) -> i32 {
        self.r.y0
    }
    #[wasm_bindgen(getter)]
    pub fn w(&self) -> usize {
        self.r.w
    }
    #[wasm_bindgen(getter)]
    pub fn h(&self) -> usize {
        self.r.h
    }
    #[wasm_bindgen(getter, js_name = areaMm2)]
    pub fn area_mm2(&self) -> f64 {
        self.r.area_mm2
    }
    /// Whether the fill field is a field of its own (grown into neighbours), not `sdfBase`.
    #[wasm_bindgen(getter)]
    pub fn grown(&self) -> bool {
        self.r.sdf_grown.is_some()
    }
    #[wasm_bindgen(js_name = takeMask)]
    pub fn take_mask(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.r.mask)
    }
    #[wasm_bindgen(js_name = takeInside)]
    pub fn take_inside(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.r.inside)
    }
    #[wasm_bindgen(js_name = takeSdfBase)]
    pub fn take_sdf_base(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.r.sdf_base)
    }
    #[wasm_bindgen(js_name = takeSdf)]
    pub fn take_sdf(&mut self) -> Vec<f32> {
        self.r.sdf_grown.take().unwrap_or_default()
    }
}

#[wasm_bindgen(js_name = signedField)]
pub fn signed_field(mask: &[u8], w: usize, h: usize, px_mm: f64) -> Vec<f32> {
    region::signed_field(mask, w, h, px_mm)
}

/// `grow_into`: per label (0..255), whether the fill may reach into it.
#[wasm_bindgen(js_name = buildRegion)]
pub fn build_region(
    comp_map: &[i32],
    labels: &[u8],
    img_w: usize,
    comp: i32,
    label: i32,
    min_x: i32,
    min_y: i32,
    max_x: i32,
    max_y: i32,
    img_h: usize,
    px_mm: f64,
    grow: f64,
    grow_into: &[u8],
) -> RegionData {
    let bbox = region::Bbox {
        min_x,
        min_y,
        max_x,
        max_y,
    };
    let r = region::build_region(
        comp_map,
        labels,
        img_w,
        comp,
        label,
        bbox,
        img_h,
        px_mm,
        grow,
        |l| grow_into.get(l as usize).is_some_and(|&g| g != 0),
    );
    RegionData { r }
}

#[wasm_bindgen(js_name = expandRegion)]
pub fn expand_region(
    label: i32,
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    px_mm: f64,
    sdf: &[f32],
    mm: f64,
) -> Option<RegionData> {
    region::expand_field(label, x0, y0, w, h, px_mm, sdf, mm).map(|r| RegionData { r })
}

/// The outline as one flat list: per line its point count, then its points x, y.
#[wasm_bindgen]
pub fn outline(
    field: &[f32],
    w: usize,
    h: usize,
    x0: i32,
    y0: i32,
    px_mm: f64,
    level: f64,
) -> Vec<f64> {
    let lines = region::outline_of(field, w, h, x0, y0, px_mm, level);
    let mut out = Vec::with_capacity(lines.iter().map(|l| 1 + 2 * l.len()).sum());
    for l in lines {
        out.push(l.len() as f64);
        for p in l {
            out.extend(p);
        }
    }
    out
}

fn bare_region(
    mask: Vec<u8>,
    inside: Vec<f32>,
    w: usize,
    h: usize,
    x0: i32,
    y0: i32,
    px_mm: f64,
) -> region::Region {
    region::Region {
        label: 0,
        x0,
        y0,
        w,
        h,
        px_mm,
        mask,
        inside,
        sdf_base: Vec::new(),
        sdf_grown: None,
        area_mm2: 0.0,
    }
}

#[wasm_bindgen]
pub fn skeleton(
    mask: Vec<u8>,
    inside: Vec<f32>,
    w: usize,
    h: usize,
    x0: i32,
    y0: i32,
    px_mm: f64,
) -> Result<JsValue, JsError> {
    to_js(&skeleton::skeleton(&bare_region(
        mask, inside, w, h, x0, y0, px_mm,
    )))
}

/// Outlines as `flat` points with `lens` points each; the first `outsides` of them are outsides.
#[wasm_bindgen(js_name = medialAxis)]
pub fn medial_axis(flat: &[f64], lens: &[u32], outsides: usize) -> Result<JsValue, JsError> {
    let loops = lines_from(flat, lens);
    let axis = medial::medial_axis(&loops[..outsides], &loops[outsides..])
        .map_err(|e| JsError::new(&e))?;
    to_js(&axis)
}

#[wasm_bindgen(js_name = planInner)]
pub fn plan_inner(
    flat: &[f64],
    lens: &[u32],
    outsides: usize,
    max: f64,
) -> Result<JsValue, JsError> {
    let loops = lines_from(flat, lens);
    match satin_inner::plan_inner(&loops[..outsides], &loops[outsides..], max)
        .map_err(|e| JsError::new(&e))?
    {
        Some(plan) => to_js(&plan),
        None => Ok(JsValue::NULL),
    }
}

#[wasm_bindgen]
pub fn coverage(
    mask: &[u8],
    w: usize,
    h: usize,
    x0: i32,
    y0: i32,
    px_mm: f64,
    flat: &[f64],
    lens: &[u32],
    rad_mm: f64,
) -> f64 {
    measure::coverage_of(mask, w, h, x0, y0, px_mm, &lines_from(flat, lens), rad_mm)
}

#[wasm_bindgen]
pub fn thin(mask: Vec<u8>, inside: Vec<f32>, w: usize, h: usize) -> Vec<u8> {
    skeleton::thin(&bare_region(mask, inside, w, h, 0, 0, 1.0))
}
