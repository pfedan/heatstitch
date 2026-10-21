//! Embroidery fonts as src/lettering/font.ts reads them: letters already digitized (satin columns
//! with their rails and rungs, running stitch, fills), in millimetres at the height the font was
//! digitized for, y down, the baseline at 0. Loading and the font list stay TypeScript; a font is
//! handed to the core once and kept by its id.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use serde::Deserialize;

/// Settings of a satin column: spacing, pull compensation per side (mm and share of the width,
/// `pcb`/`psb` for the second rail when it differs), underlay, split length, E stitch.
#[derive(Clone, Debug, Deserialize)]
pub struct SatinP {
    pub sp: f64,
    pub pc: f64,
    pub u: String,
    #[serde(default)]
    pub ps: Option<f64>,
    #[serde(default)]
    pub pcb: Option<f64>,
    #[serde(default)]
    pub psb: Option<f64>,
    #[serde(default)]
    pub sl: Option<f64>,
    #[serde(default)]
    pub e: Option<f64>,
}

/// Running stitch: length, triple (`tr`), manual points (`m`).
#[derive(Clone, Debug, Deserialize)]
pub struct RunP {
    pub len: f64,
    #[serde(default)]
    pub tr: Option<f64>,
    #[serde(default)]
    pub m: Option<f64>,
}

/// Fill: row spacing, stitch length, angle (degrees), underlay, stagger, expand.
#[derive(Clone, Debug, Deserialize)]
pub struct FillP {
    pub sp: f64,
    pub len: f64,
    pub a: f64,
    pub u: f64,
    #[serde(default)]
    pub o: Option<f64>,
    #[serde(default)]
    pub ex: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "k")]
pub enum GlyphEl {
    /// Rails as flat x, y lists, rungs as flat pairs of distances along them.
    #[serde(rename = "s")]
    Satin {
        l: Vec<f64>,
        r: Vec<f64>,
        g: Vec<f64>,
        p: SatinP,
    },
    /// A path as a flat x, y list.
    #[serde(rename = "r")]
    Run { d: Vec<f64>, p: RunP },
    /// Closed loops as flat lists, even-odd.
    #[serde(rename = "f")]
    Fill { d: Vec<Vec<f64>>, p: FillP },
}

#[derive(Clone, Debug, Deserialize)]
pub struct Glyph {
    /// Advance to the next letter.
    pub a: f64,
    pub x0: f64,
    pub x1: f64,
    pub y0: f64,
    pub y1: f64,
    /// Elements in sewing order.
    pub e: Vec<GlyphEl>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Font {
    pub id: String,
    pub cap: f64,
    pub lead: f64,
    pub space: f64,
    #[serde(default)]
    pub case: Option<String>,
    pub glyphs: HashMap<String, Glyph>,
    pub kern: HashMap<String, f64>,
    pub rev: bool,
}

impl Font {
    pub fn upper(&self) -> bool {
        self.case.as_deref() == Some("upper")
    }
    pub fn lower(&self) -> bool {
        self.case.as_deref() == Some("lower")
    }

    /// The key of the letter the font shows for `ch`: in its letter case, else as written.
    pub fn glyph_key(&self, ch: &str) -> Option<String> {
        let c = if self.upper() {
            ch.to_uppercase()
        } else if self.lower() {
            ch.to_lowercase()
        } else {
            ch.to_string()
        };
        if self.glyphs.contains_key(&c) {
            Some(c)
        } else if self.glyphs.contains_key(ch) {
            Some(ch.to_string())
        } else {
            None
        }
    }
}

thread_local! {
    static FONTS: RefCell<HashMap<String, Rc<Font>>> = RefCell::new(HashMap::new());
}

/// Keeps `font` under its id (replacing one of the same id).
pub fn register(font: Font) {
    FONTS.with(|f| f.borrow_mut().insert(font.id.clone(), Rc::new(font)));
}

/// The font kept under `id`.
pub fn font(id: &str) -> Option<Rc<Font>> {
    FONTS.with(|f| f.borrow().get(id).cloned())
}
