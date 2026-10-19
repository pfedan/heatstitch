//! Exports of the lettering. A font crosses once (registerFont) and is kept by its id; a lettering
//! crosses as its settings, and its records, runs and layout come back in one call.

use wasm_bindgen::prelude::*;

use crate::lettering::font::{self, Font};
use crate::lettering::layout::{Lettering, layout};
use crate::lettering::sew::{lettering_runs, sew_lettering};

fn from_js<T: serde::de::DeserializeOwned>(v: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(v).map_err(|e| JsError::new(&e.to_string()))
}

fn to_js<T: serde::Serialize>(v: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(v).map_err(|e| JsError::new(&e.to_string()))
}

fn font_of(id: &str) -> Result<std::rc::Rc<Font>, JsError> {
    font::font(id).ok_or_else(|| JsError::new(&format!("font {id} is not registered")))
}

/// Keeps a font (as font.ts reads it) under its id.
#[wasm_bindgen(js_name = registerFont)]
pub fn register_font(f: JsValue) -> Result<(), JsError> {
    font::register(from_js(f)?);
    Ok(())
}

/// The letters of lettering `l` (its text in NFC) set in font `id`: layout.rs's Layout, each
/// letter with the key of its glyph.
#[wasm_bindgen(js_name = letteringLayout)]
pub fn lettering_layout(id: &str, l: JsValue) -> Result<JsValue, JsError> {
    let l: Lettering = from_js(l)?;
    to_js(&layout(&*font_of(id)?, &l))
}

/// Runs of a lettering: points as a flat x, y list with the point count of each run, per run its
/// word, line, letter and whether it leaves out what lies under later letters (4 numbers), and per
/// letter whether it is sewn back.
#[wasm_bindgen]
pub struct LetteringRunsOut {
    pts: Vec<f64>,
    lens: Vec<u32>,
    meta: Vec<u32>,
    back: Vec<u8>,
}

#[wasm_bindgen]
impl LetteringRunsOut {
    #[wasm_bindgen(js_name = takePts)]
    pub fn take_pts(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.pts)
    }
    #[wasm_bindgen(js_name = takeLens)]
    pub fn take_lens(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.lens)
    }
    #[wasm_bindgen(js_name = takeMeta)]
    pub fn take_meta(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.meta)
    }
    #[wasm_bindgen(js_name = takeBack)]
    pub fn take_back(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.back)
    }
}

#[wasm_bindgen(js_name = letteringRuns)]
pub fn lettering_runs_of(id: &str, l: JsValue, all: bool) -> Result<LetteringRunsOut, JsError> {
    let l: Lettering = from_js(l)?;
    let f = font_of(id)?;
    let mut lay = layout(&f, &l);
    let runs = lettering_runs(&f, &l, &mut lay, all);
    let mut o = LetteringRunsOut {
        pts: vec![],
        lens: vec![],
        meta: vec![],
        back: lay.letters.iter().map(|p| u8::from(p.back)).collect(),
    };
    for r in runs {
        o.lens.push(r.pts.len() as u32);
        o.pts.extend(r.pts.iter().flatten());
        o.meta.extend([
            r.word as u32,
            r.line as u32,
            r.letter as u32,
            u32::from(r.leaves),
        ]);
    }
    Ok(o)
}

/// The records of a lettering (x, y, cmd), the first stitch of each piece and of each letter, the
/// stitch count and the layout as sewn.
#[wasm_bindgen]
pub struct LetteringOut {
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    starts: Vec<u32>,
    letters: Vec<u32>,
    stitches: u32,
    layout: JsValue,
}

#[wasm_bindgen]
impl LetteringOut {
    #[wasm_bindgen(js_name = takeX)]
    pub fn take_x(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.x)
    }
    #[wasm_bindgen(js_name = takeY)]
    pub fn take_y(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.y)
    }
    #[wasm_bindgen(js_name = takeCmd)]
    pub fn take_cmd(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.cmd)
    }
    #[wasm_bindgen(js_name = takeStarts)]
    pub fn take_starts(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.starts)
    }
    #[wasm_bindgen(js_name = takeLetters)]
    pub fn take_letters(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.letters)
    }
    #[wasm_bindgen(getter)]
    pub fn stitches(&self) -> u32 {
        self.stitches
    }
    #[wasm_bindgen(getter)]
    pub fn layout(&self) -> JsValue {
        self.layout.clone()
    }
}

#[wasm_bindgen(js_name = sewLettering)]
pub fn sew_lettering_of(id: &str, l: JsValue, trim_mm: f64) -> Result<LetteringOut, JsError> {
    let l: Lettering = from_js(l)?;
    let s = sew_lettering(&*font_of(id)?, &l, trim_mm);
    Ok(LetteringOut {
        layout: to_js(&s.layout)?,
        x: s.x,
        y: s.y,
        cmd: s.cmd,
        starts: s.starts,
        letters: s.letters,
        stitches: s.stitches,
    })
}
