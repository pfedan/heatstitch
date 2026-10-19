//! Exports of the shape area.

use wasm_bindgen::prelude::*;

use super::digitize::lines_from;
use crate::shape::cdt;

/// Closed outlines as `flat` points with `lens` points each.
#[wasm_bindgen]
pub fn triangulate(flat: &[f64], lens: &[u32]) -> Result<JsValue, JsError> {
    let t = cdt::triangulate(&lines_from(flat, lens)).map_err(|e| JsError::new(&e))?;
    serde_wasm_bindgen::to_value(&t).map_err(|e| JsError::new(&e.to_string()))
}
