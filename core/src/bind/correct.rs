//! Exports of the correction. Records cross as x, y, cmd arrays once per design; what TypeScript
//! asked per record (which stitches may change, how much to thin) crosses as one array per call.
//! The engine's search is an object TypeScript holds for one fix: it gets the design, the objects
//! and each unit's variants as stitches, and gives the choice back.

use wasm_bindgen::prelude::*;

use super::model::from_js;
use crate::correct::engine::levels::Thresholds;
use crate::correct::engine::mip::mip_program;
use crate::correct::engine::search::Search;
use crate::correct::{
    crop, hidden, nudge, pullback, respace, satin_short, shorts, structure, thin, thin_hand,
};
use crate::pattern::{Bounds, Records};

fn records(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>) -> Records {
    Records {
        x,
        y,
        cmd,
        colors: vec![],
    }
}

fn bounds_of(b: &[f64]) -> Bounds {
    Bounds {
        min_x: b[0] as i32,
        min_y: b[1] as i32,
        max_x: b[2] as i32,
        max_y: b[3] as i32,
    }
}

fn four(b: &[f64]) -> [f64; 4] {
    [b[0], b[1], b[2], b[3]]
}

/// What a correction step gives back: new positions or records, a mask of records (to remove, or
/// skipped), and two counts whose meaning the function names.
#[wasm_bindgen]
#[derive(Default)]
pub struct Edited {
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    mask: Vec<u8>,
    a: u32,
    b: u32,
}

#[wasm_bindgen]
impl Edited {
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
    #[wasm_bindgen(js_name = takeMask)]
    pub fn take_mask(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.mask)
    }
    #[wasm_bindgen(getter)]
    pub fn a(&self) -> u32 {
        self.a
    }
    #[wasm_bindgen(getter)]
    pub fn b(&self) -> u32 {
        self.b
    }
}

/// Zero-length stitches to remove (mask), `a` their count.
#[wasm_bindgen(js_name = removeZeroLength)]
pub fn remove_zero_length(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>, wanted: &[u8]) -> Edited {
    let (mask, n) = shorts::zero_length(&records(x, y, cmd), wanted);
    Edited {
        mask,
        a: n as u32,
        ..Default::default()
    }
}

/// Short stitches merged away (mask), `a` their count.
#[wasm_bindgen(js_name = mergeShortStitches)]
pub fn merge_short_stitches(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>, wanted: &[u8]) -> Edited {
    let (mask, n) = shorts::merge_short(&records(x, y, cmd), wanted);
    Edited {
        mask,
        a: n as u32,
        ..Default::default()
    }
}

/// Records to remove (mask), `a` stitches removed, `b` cycles.
#[wasm_bindgen(js_name = thinSweeps)]
pub fn thin_sweeps(
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    need: &[f64],
    protect: Option<Vec<u8>>,
    min_share: f64,
    strict: bool,
) -> Edited {
    let r = thin::thin_sweeps(
        &records(x, y, cmd),
        &thin::ThinOptions {
            need,
            protect: protect.as_deref(),
            min_share,
            strict,
        },
    );
    Edited {
        mask: r.remove,
        a: r.removed as u32,
        b: r.cycles as u32,
        ..Default::default()
    }
}

/// New positions, `a` penetrations moved.
#[wasm_bindgen(js_name = shortenSatinCurves)]
pub fn shorten_satin_curves(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>, wanted: &[u8]) -> Edited {
    let (x, y, moved) = satin_short::shorten_satin_curves(&records(x, y, cmd), wanted);
    Edited {
        x,
        y,
        a: moved as u32,
        ..Default::default()
    }
}

/// New positions and the row stitches to drop (mask), `a` row ends moved, `b` stitches dropped.
#[wasm_bindgen(js_name = pullBackFills)]
pub fn pull_back_fills(
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    bounds: &[f64],
    wanted: &[u8],
) -> Edited {
    let r = pullback::pull_back_fills(&records(x, y, cmd), bounds_of(bounds), wanted);
    Edited {
        x: r.x,
        y: r.y,
        mask: r.remove,
        a: r.moved as u32,
        b: r.removed as u32,
        ..Default::default()
    }
}

fn respaced(r: respace::Respaced) -> Edited {
    let (x, y, cmd) = r.records.unwrap_or_default();
    Edited {
        x,
        y,
        cmd,
        a: r.sweeps as u32,
        b: r.rows as u32,
        ..Default::default()
    }
}

/// The records with the fills re-spaced (none when nothing changed), `a` sweeps, `b` rows saved.
#[wasm_bindgen(js_name = respaceFills)]
pub fn respace_fills(
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    need: &[f64],
    max_spacing: f64,
    min_share: f64,
) -> Edited {
    respaced(respace::respace_fills(
        &records(x, y, cmd),
        need,
        max_spacing,
        min_share,
    ))
}

/// As respaceFills for the satin columns given as start, end pairs.
#[wasm_bindgen(js_name = respaceSatins)]
pub fn respace_satins(
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    need: &[f64],
    max_spacing: f64,
    min_share: f64,
    columns: &[u32],
) -> Edited {
    let cols: Vec<(usize, usize)> = columns
        .chunks_exact(2)
        .map(|c| (c[0] as usize, c[1] as usize))
        .collect();
    respaced(respace::respace_satins(
        &records(x, y, cmd),
        need,
        max_spacing,
        min_share,
        &cols,
    ))
}

/// The satin columns of the records for a satin mask: start, end, run per column.
#[wasm_bindgen(js_name = satinColumns)]
pub fn satin_columns(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>, mask: &[u8]) -> Vec<u32> {
    let p = records(x, y, cmd);
    let runs = structure::stitch_runs(&p);
    structure::satin_columns(&runs, mask)
        .iter()
        .flat_map(|c| [c.start as u32, c.end as u32, c.run as u32])
        .collect()
}

/// New positions, `a` penetrations moved.
#[wasm_bindgen(js_name = nudgePenetrations)]
pub fn nudge_penetrations(
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    movable: &[u8],
    radius: f64,
    max_shift: f64,
    iterations: u32,
) -> Edited {
    let (x, y, moved) = nudge::nudge_penetrations(
        &records(x, y, cmd),
        movable,
        radius,
        max_shift,
        iterations as usize,
    );
    Edited {
        x,
        y,
        a: moved as u32,
        ..Default::default()
    }
}

#[wasm_bindgen(js_name = sameHoleStitches)]
pub fn same_hole_stitches(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>, within: f64) -> Vec<u8> {
    nudge::same_hole_stitches(&records(x, y, cmd), within)
}

/// New positions and the records that go (mask), `a` stitches removed.
#[wasm_bindgen(js_name = thinByHand)]
pub fn thin_by_hand(
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    need: &[f64],
    protect: Option<Vec<u8>>,
) -> Edited {
    let r = thin_hand::thin_by_hand(&records(x, y, cmd), need, protect.as_deref());
    Edited {
        x: r.x,
        y: r.y,
        mask: r.mask,
        a: r.removed as u32,
        ..Default::default()
    }
}

#[wasm_bindgen(js_name = hiddenStitches)]
pub fn hidden_stitches(x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>, bounds: &[f64]) -> Vec<u8> {
    hidden::hidden_stitches(&records(x, y, cmd), bounds_of(bounds))
}

/// The records inside a box (0.1 mm: x0, y0, x1, y1) and the skip mask following them.
#[wasm_bindgen(js_name = cropRecords)]
pub fn crop_records(
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    box_: &[f64],
    skip: Option<Vec<u8>>,
) -> Edited {
    let (r, sk) = crop::crop(&records(x, y, cmd), four(box_), skip.as_deref());
    Edited {
        x: r.x,
        y: r.y,
        cmd: r.cmd,
        mask: sk,
        ..Default::default()
    }
}

/// The exact program of a group: its LP text and the unit, variant pair of each x column.
#[wasm_bindgen]
pub struct MipOut {
    lp: String,
    vars: Vec<u32>,
    rows: usize,
    ys: usize,
}

#[wasm_bindgen]
impl MipOut {
    #[wasm_bindgen(getter)]
    pub fn lp(&self) -> String {
        self.lp.clone()
    }
    #[wasm_bindgen(js_name = takeVars)]
    pub fn take_vars(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.vars)
    }
    #[wasm_bindgen(getter)]
    pub fn rows(&self) -> usize {
        self.rows
    }
    #[wasm_bindgen(getter)]
    pub fn ys(&self) -> usize {
        self.ys
    }
}

/// The search of one fix (see correct/engine/search.rs). Contributions, candidates and groups are
/// numbered in the order they were added.
#[wasm_bindgen]
pub struct Engine(Search);

#[wasm_bindgen]
impl Engine {
    /// The field of design x, y, cmd with its bounds (min x, min y, max x, max y, 0.1 mm), for
    /// the thresholds of a profile (thresholdsFor) and whether the fabric is stable.
    #[wasm_bindgen(constructor)]
    pub fn new(
        x: Vec<i32>,
        y: Vec<i32>,
        cmd: Vec<u8>,
        bounds: &[f64],
        thresholds: JsValue,
        stable_fabric: bool,
    ) -> Result<Engine, JsError> {
        let th: Thresholds = from_js(thresholds)?;
        Ok(Engine(Search::new(
            &records(x, y, cmd),
            four(bounds),
            th,
            stable_fabric,
        )))
    }

    /// Number of 1 mm cells of the field.
    #[wasm_bindgen(getter)]
    pub fn cells(&self) -> usize {
        self.0.f.cells()
    }

    #[wasm_bindgen(getter)]
    pub fn work(&self) -> f64 {
        self.0.f.work
    }

    /// Field cell of each validation cell by its world key (-1: none).
    #[wasm_bindgen(js_name = fieldCells)]
    pub fn field_cells(&self, keys: &[f64]) -> Vec<i32> {
        self.0.field_cells(keys)
    }

    #[wasm_bindgen(js_name = setTarget)]
    pub fn set_target(&mut self, cells: &[u32]) {
        self.0.set_target(cells);
    }

    /// The objects of the design: first, last, min x, min y, max x, max y each.
    #[wasm_bindgen(js_name = addObjects)]
    pub fn add_objects(&mut self, x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>, objects: &[f64]) {
        self.0.add_objects(&records(x, y, cmd), objects);
    }

    #[wasm_bindgen(js_name = hiddenShares)]
    pub fn hidden_shares(&self) -> Vec<f64> {
        self.0.hidden_shares()
    }

    /// Who carries each open cell: cell, count, objects... per cell.
    pub fn carriers(&mut self, share: f64, holes: bool) -> Vec<u32> {
        self.0.find_carriers(share, holes)
    }

    /// What stitches contribute (keep: the records whose thread counts). Its id.
    pub fn contribution(
        &mut self,
        x: Vec<i32>,
        y: Vec<i32>,
        cmd: Vec<u8>,
        bounds: &[f64],
        keep: Option<Vec<u8>>,
    ) -> u32 {
        self.0
            .contribution(&records(x, y, cmd), four(bounds), keep.as_deref()) as u32
    }

    /// A predicted contribution: top scaled by k, under by u, or (after >= 0) under kept where the
    /// objects after that one leave it uncovered. Its id.
    pub fn blend(&mut self, top: u32, under: u32, k: f64, u: f64, after: i32) -> u32 {
        let after = (after >= 0).then_some(after as usize);
        self.0.blend(top as usize, under as usize, k, u, after) as u32
    }

    #[wasm_bindgen(js_name = addCandidate)]
    pub fn add_candidate(&mut self, contribs: &[u32], visibility: &[f64], banned: &[u8]) -> u32 {
        self.0.add_candidate(contribs, visibility, banned) as u32
    }

    /// The candidate of each object (-1: none); returns the number of groups.
    pub fn link(&mut self, obj_cand: &[i32]) -> u32 {
        self.0.link(obj_cand) as u32
    }

    #[wasm_bindgen(js_name = beginGroup)]
    pub fn begin_group(&mut self, g: u32) -> f64 {
        self.0.begin_group(g as usize)
    }

    /// The exact program of group `g` (after beginGroup), or undefined when it fixes nothing.
    #[wasm_bindgen(js_name = mipProgram)]
    pub fn mip_program(&self, g: u32) -> Option<MipOut> {
        let units = self.0.group_units(g as usize);
        mip_program(&self.0.f, &units, self.0.target()).map(|m| MipOut {
            lp: m.lp,
            vars: m
                .vars
                .iter()
                .flat_map(|&(u, k)| [u as u32, k as u32])
                .collect(),
            rows: m.rows,
            ys: m.ys,
        })
    }

    #[wasm_bindgen(js_name = mipResult)]
    pub fn mip_result(&mut self, g: u32, choice: Option<Vec<u32>>, mip: bool) -> bool {
        self.0.mip_result(g as usize, choice.as_deref(), mip)
    }

    #[wasm_bindgen(js_name = searchGroup)]
    pub fn search_group(&mut self, g: u32, budget_ms: f64) {
        self.0.search_group(g as usize, budget_ms);
    }

    pub fn chosen(&self) -> Vec<u32> {
        self.0.chosen()
    }

    pub fn choose(&mut self, c: u32, k: u32) {
        self.0.choose(c as usize, k as usize);
    }

    pub fn ban(&mut self, c: u32, k: u32) {
        self.0.ban(c as usize, k as usize);
    }

    #[wasm_bindgen(js_name = setVisibility)]
    pub fn set_visibility(&mut self, c: u32, k: u32, v: f64) {
        self.0.set_visibility(c as usize, k as usize, v);
    }

    /// The chosen variant of candidate `c` as sewn for real, in place of its prediction.
    pub fn replace(&mut self, c: u32, x: Vec<i32>, y: Vec<i32>, cmd: Vec<u8>, bounds: &[f64]) {
        self.0
            .replace(c as usize, &records(x, y, cmd), four(bounds));
    }

    /// Open cells fixed, new critical (risk), new caution so far.
    pub fn tally(&self) -> Vec<f64> {
        let t = self.0.tally();
        vec![t.fixed as f64, t.new_critical as f64, t.new_caution as f64]
    }
}
