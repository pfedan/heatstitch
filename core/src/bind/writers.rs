//! Exports of the writers area: records, colors and options in, the bytes of the file out.

use serde::Deserialize;
use wasm_bindgen::prelude::*;

use crate::pattern::{Hoop, Records, ThreadColor};
use crate::writers::{bytes, jef, write};

/// A thread color as the app holds it. Numbers are taken as the TypeScript writers took them
/// (cut to a byte), so an odd value never fails a save.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColorIn {
    r: f64,
    g: f64,
    b: f64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    pec_index: Option<f64>,
    #[serde(default)]
    brand: Option<String>,
    #[serde(default)]
    catalog: Option<String>,
}

fn byte(v: f64) -> u8 {
    if v.is_finite() {
        v.trunc().rem_euclid(256.0) as u8
    } else {
        0
    }
}

impl From<ColorIn> for ThreadColor {
    fn from(c: ColorIn) -> Self {
        ThreadColor {
            r: byte(c.r),
            g: byte(c.g),
            b: byte(c.b),
            name: c.name,
            pec_index: c
                .pec_index
                .filter(|v| v.is_finite() && *v >= 0.0)
                .map(|v| v as u32),
            brand: c.brand,
            catalog: c.catalog,
        }
    }
}

/// Writes the records as `format` (pes, dst, jef, exp, vp3, xxx, pec). `name` is the design's
/// name, NFKD-normalized; `options` is { hoop?, stamp? } (stamp: the JEF date, YYYYMMDDhhmmss).
#[wasm_bindgen(js_name = writeFormat)]
pub fn write_format(
    format: &str,
    x: &[i32],
    y: &[i32],
    cmd: &[u8],
    colors: JsValue,
    name: &str,
    options: JsValue,
) -> Result<Vec<u8>, JsError> {
    let colors: Vec<ColorIn> = serde_wasm_bindgen::from_value(colors)?;
    let options: write::WriteOptions = if options.is_undefined() || options.is_null() {
        Default::default()
    } else {
        serde_wasm_bindgen::from_value(options)?
    };
    let p = Records {
        x: x.to_vec(),
        y: y.to_vec(),
        cmd: cmd.to_vec(),
        colors: colors.into_iter().map(ThreadColor::from).collect(),
    };
    write::write_pattern(&p, format, name, &options).map_err(|e| JsError::new(&e))
}

/// Splits a move into the fewest equal-ish pieces within ±max, as x, y pairs.
#[wasm_bindgen(js_name = splitMove)]
pub fn split_move(dx: i32, dy: i32, max: i32) -> Vec<i32> {
    bytes::split_move(dx as i64, dy as i64, max as i64)
        .into_iter()
        .flat_map(|(x, y)| [x as i32, y as i32])
        .collect()
}

/// The Janome code of a sewing field (mm), or -1 when Janome has no such hoop.
#[wasm_bindgen(js_name = jefHoopCode)]
pub fn jef_hoop_code(w: f64, h: f64) -> i32 {
    jef::jef_hoop_code(Hoop { w, h }).map_or(-1, |c| c as i32)
}
