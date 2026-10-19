use wasm_bindgen::prelude::*;

use crate::image::edt;

#[wasm_bindgen(js_name = distanceToSeeds)]
pub fn distance_to_seeds(seed: &[u8], w: usize, h: usize, border: bool) -> Vec<f32> {
    edt::distance_to_seeds(seed, w, h, border)
}

#[wasm_bindgen(js_name = distanceInside)]
pub fn distance_inside(mask: &[u8], w: usize, h: usize) -> Vec<f32> {
    edt::distance_inside(mask, w, h)
}
