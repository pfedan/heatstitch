//! Exports of the parsers area: an embroidery file in, its records, colors, name, format and hoop
//! out (src/parsers/*.ts builds the Pattern from them).

use wasm_bindgen::prelude::*;

use crate::parsers::read;

/// A design read by the core. The arrays are copied out on each access, so read each once.
#[wasm_bindgen]
pub struct ReadDesign {
    inner: read::Parsed,
}

#[wasm_bindgen]
impl ReadDesign {
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.inner.name.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn format(&self) -> String {
        self.inner.format.to_string()
    }

    #[wasm_bindgen(getter)]
    pub fn x(&self) -> Vec<i32> {
        self.inner.records.x.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn y(&self) -> Vec<i32> {
        self.inner.records.y.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn cmd(&self) -> Vec<u8> {
        self.inner.records.cmd.clone()
    }

    /// The thread colors, one per color block (ThreadColor objects).
    #[wasm_bindgen(getter)]
    pub fn colors(&self) -> Result<JsValue, JsError> {
        Ok(serde_wasm_bindgen::to_value(&self.inner.records.colors)?)
    }

    /// The sewing field the header names ({ w, h } in mm), or undefined.
    #[wasm_bindgen(getter)]
    pub fn hoop(&self) -> Result<JsValue, JsError> {
        Ok(match self.inner.hoop {
            Some(h) => serde_wasm_bindgen::to_value(&h)?,
            None => JsValue::UNDEFINED,
        })
    }
}

/// Reads an embroidery file, by its signature or else by the extension of `fileName`.
#[wasm_bindgen(js_name = readDesign)]
pub fn read_design(data: &[u8], file_name: &str) -> Result<ReadDesign, JsError> {
    read::read_file(data, file_name)
        .map(|inner| ReadDesign { inner })
        .map_err(|e| JsError::new(&e))
}

/// Reads `data` as the given format; `name` is used when the file names no design.
#[wasm_bindgen(js_name = readFormat)]
pub fn read_format(format: &str, data: &[u8], name: &str) -> Result<ReadDesign, JsError> {
    read::read_format(format, data, name)
        .map(|inner| ReadDesign { inner })
        .map_err(|e| JsError::new(&e))
}
