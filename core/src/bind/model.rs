//! Exports of the model's sewing (model/restitch and what sews one object). Specs and settings
//! cross as plain objects (serde); runs come back as a flat x, y list, the point count of each run
//! and a flag byte per run (1: a trim before it, 2: the machine stops before it), so the
//! TypeScript can mark them in its WeakSets.

use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;

use super::digitize::lines_from;
use super::fill::RegionIn;
use crate::geom::{Pt, pts_from_flat, pts_to_flat};
use crate::model::along::{self, PathStitch};
use crate::model::applique::{self, AppliqueSettings};
use crate::model::line;
use crate::model::restitch::{self, Rails, SatinSettings, SewnStep};
use crate::model::runs::Run;
use crate::shape::path::Form;

pub(crate) fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    v.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsError::new(&e.to_string()))
}

pub(crate) fn from_js<T: DeserializeOwned>(v: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(v).map_err(|e| JsError::new(&e.to_string()))
}

/// Runs for TypeScript: points, counts, flags, and (satin only) where each piece went.
#[wasm_bindgen]
pub struct RunsOut {
    pts: Vec<f64>,
    lens: Vec<u32>,
    flags: Vec<u8>,
    steps: Option<Vec<SewnStep>>,
    under: usize,
}

#[wasm_bindgen]
impl RunsOut {
    #[wasm_bindgen(js_name = takePts)]
    pub fn take_pts(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.pts)
    }
    #[wasm_bindgen(js_name = takeLens)]
    pub fn take_lens(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.lens)
    }
    #[wasm_bindgen(js_name = takeFlags)]
    pub fn take_flags(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.flags)
    }
    /// Points of the runs that lie under the rest (an appliqué's placement line and tack-down).
    #[wasm_bindgen(getter)]
    pub fn under(&self) -> usize {
        self.under
    }
    /// The SewnSteps as plain objects, or undefined when they were not asked for.
    #[wasm_bindgen(js_name = takeSteps)]
    pub fn take_steps(&mut self) -> Result<JsValue, JsError> {
        match self.steps.take() {
            Some(s) => to_js(&s),
            None => Ok(JsValue::UNDEFINED),
        }
    }
}

pub(crate) fn runs_out(runs: &[Run], steps: Option<Vec<SewnStep>>) -> RunsOut {
    let mut pts = Vec::with_capacity(runs.iter().map(|r| 2 * r.len()).sum());
    let mut lens = Vec::with_capacity(runs.len());
    let mut flags = Vec::with_capacity(runs.len());
    for r in runs {
        lens.push(r.len() as u32);
        flags.push(u8::from(r.trim) | (u8::from(r.stop) << 1));
        pts.extend(pts_to_flat(&r.pts));
    }
    RunsOut {
        pts,
        lens,
        flags,
        steps,
        under: 0,
    }
}

#[wasm_bindgen(js_name = satinRuns)]
pub fn satin_runs(rails: JsValue, settings: JsValue, with_steps: bool) -> Result<RunsOut, JsError> {
    let rails: Vec<Rails> = from_js(rails)?;
    let s: SatinSettings = from_js(settings)?;
    let mut steps = vec![];
    let runs = restitch::satin_runs(&rails, &s, with_steps.then_some(&mut steps));
    Ok(runs_out(&runs, with_steps.then_some(steps)))
}

/// The best order of a chain as column, way pairs (way: bit 1 turned, bit 2 mirrored).
#[wasm_bindgen(js_name = bestChain)]
pub fn best_chain(cols: JsValue, settings: JsValue) -> Result<Vec<u32>, JsError> {
    let cols: Vec<Rails> = from_js(cols)?;
    let s: SatinSettings = from_js(settings)?;
    Ok(restitch::best_chain(&cols, &s)
        .iter()
        .flat_map(|st| [st.c as u32, st.w as u32])
        .collect())
}

/// Each section's pairs: a flat list of left x, y, right x, y per pair, and the pair count of each.
#[wasm_bindgen(js_name = previewPairs)]
pub fn preview_pairs(rails: JsValue, settings: JsValue) -> Result<Vec<f64>, JsError> {
    let r: Rails = from_js(rails)?;
    let s: SatinSettings = from_js(settings)?;
    let secs = restitch::preview_pairs(&r, &s);
    // The count of sections, then each section's pair count, then the pairs.
    let mut out = vec![secs.len() as f64];
    out.extend(secs.iter().map(|ps| ps.len() as f64));
    for ps in &secs {
        out.extend(ps.iter().flat_map(|[a, b]| [a[0], a[1], b[0], b[1]]));
    }
    Ok(out)
}

#[wasm_bindgen(js_name = chainCost)]
pub fn chain_cost(cols: JsValue, settings: JsValue) -> Result<f64, JsError> {
    let cols: Vec<Rails> = from_js(cols)?;
    let s: SatinSettings = from_js(settings)?;
    Ok(restitch::chain_cost(&cols, &s))
}

/// Hidden and visible mm of the ways of a chain.
#[wasm_bindgen(js_name = chainTravel)]
pub fn chain_travel(cols: JsValue, settings: JsValue) -> Result<Vec<f64>, JsError> {
    let cols: Vec<Rails> = from_js(cols)?;
    let s: SatinSettings = from_js(settings)?;
    let (hidden, visible) = restitch::travel_of(&cols, &s);
    Ok(vec![hidden, visible])
}

/// How much of each way shows among the columns: `later` holds one flag per column for each way.
/// Bare and over mm per way.
#[wasm_bindgen(js_name = shownAmong)]
pub fn shown_among(
    cols: JsValue,
    ways: &[f64],
    way_lens: &[u32],
    later: &[u8],
) -> Result<Vec<f64>, JsError> {
    let cols: Vec<Rails> = from_js(cols)?;
    let ways: Vec<Vec<Pt>> = lines_from(ways, way_lens);
    let n = cols.len();
    let later: Vec<Vec<u8>> = (0..ways.len())
        .map(|k| later[k * n..(k + 1) * n].to_vec())
        .collect();
    Ok(restitch::shown_among(&cols, &ways, &later)
        .into_iter()
        .flat_map(|(bare, over)| [bare, over])
        .collect())
}

#[wasm_bindgen(js_name = satinWidthFactor)]
pub fn satin_width_factor(w: f64) -> f64 {
    restitch::width_factor(w)
}

/// The spacing at each point of the rails' column, or undefined when even.
#[wasm_bindgen(js_name = satinSpacingAlong)]
pub fn satin_spacing_along(
    rails: JsValue,
    base: f64,
    by_width: bool,
) -> Result<Option<Vec<f64>>, JsError> {
    let r: Rails = from_js(rails)?;
    Ok(restitch::spacing_along(
        &restitch::column_of(&r),
        &r,
        base,
        by_width,
    ))
}

#[wasm_bindgen(js_name = satinPushEnds)]
pub fn satin_push_ends(rails: JsValue, settings: JsValue) -> Result<JsValue, JsError> {
    let rails: Vec<Rails> = from_js(rails)?;
    let s: SatinSettings = from_js(settings)?;
    to_js(&restitch::push_ends(&rails, &s))
}

#[wasm_bindgen(js_name = satinSeamEnds)]
pub fn satin_seam_ends(rails: JsValue, settings: JsValue) -> Result<JsValue, JsError> {
    let rails: Vec<Rails> = from_js(rails)?;
    let s: SatinSettings = from_js(settings)?;
    to_js(&restitch::seam_ends(&rails, &s))
}

fn pt_of(v: Option<Vec<f64>>) -> Option<Pt> {
    v.filter(|v| v.len() >= 2).map(|v| [v[0], v[1]])
}

/// Stitches along a line (sewAlong in along.ts); `start` an x, y pair or undefined.
#[wasm_bindgen(js_name = sewAlong)]
#[allow(clippy::too_many_arguments)]
pub fn sew_along(
    line: &[f64],
    closed: bool,
    s: JsValue,
    start: Option<Vec<f64>>,
    area: Option<RegionIn>,
    reversed: bool,
    shift: f64,
) -> Result<RunsOut, JsError> {
    let s: PathStitch = from_js(s)?;
    let area = area.map(|a| a.r);
    let runs = along::sew_along(
        &pts_from_flat(line),
        closed,
        &s,
        pt_of(start),
        area.as_ref(),
        reversed,
        shift,
    );
    Ok(runs_out(&runs, None))
}

#[wasm_bindgen(js_name = borderStitches)]
pub fn border_stitches(
    r: RegionIn,
    s: JsValue,
    from_x: f64,
    from_y: f64,
    whole: Option<RegionIn>,
) -> Result<RunsOut, JsError> {
    let s: PathStitch = from_js(s)?;
    let whole = whole.map(|w| w.r);
    let runs = along::border_stitches(&r.r, &s, [from_x, from_y], whole.as_ref());
    Ok(runs_out(&runs, None))
}

#[wasm_bindgen(js_name = openStitches)]
pub fn open_stitches(
    open: JsValue,
    s: JsValue,
    from_x: f64,
    from_y: f64,
    r: RegionIn,
    whole: Option<RegionIn>,
) -> Result<RunsOut, JsError> {
    let open: Form = from_js(open)?;
    let s: PathStitch = from_js(s)?;
    let whole = whole.map(|w| w.r);
    let runs = along::open_stitches(&open, &s, [from_x, from_y], &r.r, whole.as_ref());
    Ok(runs_out(&runs, None))
}

#[wasm_bindgen(js_name = seamStitches)]
pub fn seam_stitches(
    parts: Vec<RegionIn>,
    area: RegionIn,
    s: JsValue,
    from_x: f64,
    from_y: f64,
) -> Result<RunsOut, JsError> {
    let s: PathStitch = from_js(s)?;
    let parts: Vec<_> = parts.into_iter().map(|p| p.r).collect();
    let refs: Vec<_> = parts.iter().collect();
    let runs = along::seam_stitches(&refs, &area.r, &s, [from_x, from_y]);
    Ok(runs_out(&runs, None))
}

/// The stitches along the paths of a form (lineStitches in line.ts).
#[wasm_bindgen(js_name = lineStitches)]
pub fn line_stitches(
    form: JsValue,
    s: JsValue,
    reverse: bool,
    from: Option<Vec<f64>>,
) -> Result<RunsOut, JsError> {
    let form: Form = from_js(form)?;
    let s: PathStitch = from_js(s)?;
    let runs = line::line_stitches(&form, &s, reverse, pt_of(from));
    Ok(runs_out(&runs, None))
}

/// The runs of an appliqué (flag 2: the machine stops before it), with `under` set.
#[wasm_bindgen(js_name = appliqueRuns)]
pub fn applique_runs(
    area: RegionIn,
    s: JsValue,
    from_x: f64,
    from_y: f64,
    shared: Option<RegionIn>,
) -> Result<RunsOut, JsError> {
    let s: AppliqueSettings = from_js(s)?;
    let shared = shared.map(|r| r.r);
    let (runs, under) = applique::applique_runs(&area.r, &s, [from_x, from_y], shared.as_ref());
    let mut out = runs_out(&runs, None);
    out.under = under;
    Ok(out)
}

/// The lines a border lies on: points, count per line and 1 for each closed one.
#[wasm_bindgen(js_name = borderLines)]
pub fn border_lines(r: RegionIn, offset: f64, whole: Option<RegionIn>) -> RunsOut {
    let whole = whole.map(|w| w.r);
    let lines = along::border_lines(&r.r, offset, whole.as_ref());
    let runs: Vec<Run> = lines
        .into_iter()
        .map(|l| Run {
            pts: l.line,
            trim: l.closed,
            stop: false,
        })
        .collect();
    runs_out(&runs, None)
}
