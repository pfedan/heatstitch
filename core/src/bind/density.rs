//! Exports of the density area.

use wasm_bindgen::prelude::*;

use crate::density::blur;
use crate::density::grid::{self, DensityGrid, DensityOptions};
use crate::pattern::Records;

/// A density grid handed to JavaScript: numbers as getters, the values taken once (no copy kept).
#[wasm_bindgen]
pub struct DensityResult(DensityGrid);

#[wasm_bindgen]
impl DensityResult {
    #[wasm_bindgen(getter)]
    pub fn cols(&self) -> usize {
        self.0.cols
    }
    #[wasm_bindgen(getter)]
    pub fn rows(&self) -> usize {
        self.0.rows
    }
    #[wasm_bindgen(getter, js_name = originX)]
    pub fn origin_x(&self) -> f64 {
        self.0.origin_x
    }
    #[wasm_bindgen(getter, js_name = originY)]
    pub fn origin_y(&self) -> f64 {
        self.0.origin_y
    }
    #[wasm_bindgen(getter)]
    pub fn max(&self) -> f64 {
        self.0.max
    }
    #[wasm_bindgen(js_name = takeData)]
    pub fn take_data(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.0.data)
    }
}

/// The density grid of the records x, y, cmd over `bounds` (min x, min y, max x, max y, 0.1 mm).
/// `keep`, when given, holds 1 for every record that counts (see grid::compute_density).
#[wasm_bindgen(js_name = computeDensity)]
pub fn compute_density(
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    bounds: &[f64],
    options: JsValue,
    keep: Option<Vec<u8>>,
) -> Result<DensityResult, JsError> {
    let opt: DensityOptions = serde_wasm_bindgen::from_value(options)?;
    let p = Records {
        x,
        y,
        cmd,
        colors: vec![],
    };
    let b = [bounds[0], bounds[1], bounds[2], bounds[3]];
    Ok(DensityResult(grid::compute_density(
        &p,
        b,
        &opt,
        keep.as_deref(),
    )))
}

#[wasm_bindgen(js_name = gaussianBlur)]
pub fn gaussian_blur(src: &[f32], cols: usize, rows: usize, sigma: f64) -> Vec<f32> {
    blur::gaussian_blur(src, cols, rows, sigma)
}
