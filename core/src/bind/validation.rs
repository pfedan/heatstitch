//! Exports of the validation area. Records cross as x, y, cmd arrays, once per design or object.

use wasm_bindgen::prelude::*;

use crate::pattern::Records;
use crate::validation::measure::{self, Measurement};
use crate::validation::satin;
use crate::validation::short_stitches;

fn records(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>) -> Records {
    Records {
        x,
        y,
        cmd,
        colors: vec![],
    }
}

#[wasm_bindgen(js_name = satinMask)]
pub fn satin_mask(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>, min_len: f64) -> Vec<u8> {
    satin::satin_mask(&records(x, y, cmd), min_len)
}

#[wasm_bindgen(js_name = eStitchMask)]
pub fn e_stitch_mask(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>) -> Vec<u8> {
    satin::e_stitch_mask(&records(x, y, cmd))
}

#[wasm_bindgen(js_name = tagShortStitches)]
pub fn tag_short_stitches(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>) -> Vec<u8> {
    short_stitches::tag_short_stitches(&records(x, y, cmd))
}

/// A measurement handed to JavaScript: numbers as getters, each array taken once.
#[wasm_bindgen]
pub struct MeasureResult(Measurement);

#[wasm_bindgen]
impl MeasureResult {
    #[wasm_bindgen(getter, js_name = originX)]
    pub fn origin_x(&self) -> f64 {
        self.0.origin_x
    }
    #[wasm_bindgen(getter, js_name = originY)]
    pub fn origin_y(&self) -> f64 {
        self.0.origin_y
    }
    #[wasm_bindgen(getter)]
    pub fn cols(&self) -> usize {
        self.0.cols
    }
    #[wasm_bindgen(getter)]
    pub fn rows(&self) -> usize {
        self.0.rows
    }
    #[wasm_bindgen(getter, js_name = cellMm)]
    pub fn cell_mm(&self) -> f64 {
        self.0.cell_mm
    }
    #[wasm_bindgen(js_name = takeDensity)]
    pub fn take_density(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.0.density)
    }
    #[wasm_bindgen(js_name = takeSatin)]
    pub fn take_satin(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.0.satin)
    }
    #[wasm_bindgen(js_name = takeShorts)]
    pub fn take_shorts(&mut self) -> Vec<u16> {
        std::mem::take(&mut self.0.shorts)
    }
    #[wasm_bindgen(js_name = takeHoles)]
    pub fn take_holes(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.0.holes)
    }
    #[wasm_bindgen(js_name = takeCover)]
    pub fn take_cover(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.0.cover)
    }
    #[wasm_bindgen(js_name = takeGapsLow)]
    pub fn take_gaps_low(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.0.gaps_low)
    }
    #[wasm_bindgen(js_name = takeGapsHigh)]
    pub fn take_gaps_high(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.0.gaps_high)
    }
    #[wasm_bindgen(js_name = takeLongest)]
    pub fn take_longest(&mut self) -> Vec<u16> {
        std::mem::take(&mut self.0.longest)
    }
}

/// Measures the records x, y, cmd with their bounds (min x, min y, max x, max y, 0.1 mm).
#[wasm_bindgen(js_name = measurePattern)]
pub fn measure_pattern(
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    bounds: &[f64],
    skip_cover: Option<Vec<u8>>,
    gaps: bool,
) -> MeasureResult {
    let p = records(x, y, cmd);
    let b = [bounds[0], bounds[1], bounds[2], bounds[3]];
    MeasureResult(measure::measure_pattern(&p, b, skip_cover.as_deref(), gaps))
}
