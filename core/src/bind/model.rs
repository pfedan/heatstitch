//! Exports of the model's sewing (model/restitch and what sews one object). Specs and settings
//! cross as plain objects (serde); runs come back as a flat x, y list, the point count of each run
//! and a flag byte per run (1: a trim before it, 2: the machine stops before it), so the
//! TypeScript can mark them in its WeakSets.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use super::digitize::{RegionData, lines_from};
use super::fill::RegionIn;
use crate::geom::{Pt, pts_from_flat, pts_to_flat};
use crate::model::along::{self, PathStitch};
use crate::model::applique::AppliqueSettings;
use crate::model::covers::Cover;
use crate::model::fill::{self, FillSettings, FillWay, FollowZigzag};
use crate::model::line;
use crate::model::order::{self, OrderObject, OrderOptions, Reversal};
use crate::model::restitch::{self, Rails, SatinSettings, SewnStep};
use crate::model::runs::Run;
use crate::model::sew::{self, Spec, Way};
use crate::model::{trace, travel};
use crate::shape::path::Form;
use crate::shape::rasterize::region_of;

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
    ways: Option<Vec<u32>>,
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
    /// A fill's travel as first and last point index pairs, or undefined when it has none.
    #[wasm_bindgen(js_name = takeWays)]
    pub fn take_ways(&mut self) -> Option<Vec<u32>> {
        self.ways.take()
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
        ways: None,
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

/// The area stitches cover (traceRegionNow in restitch.ts): `segs` the x, y of both ends of each
/// stitch (0.1 mm).
#[wasm_bindgen(js_name = traceRegion)]
pub fn trace_region(segs: &[f64], reach: f64, open: f64, close: bool) -> Option<RegionData> {
    let segs: Vec<[f64; 4]> = segs
        .chunks_exact(4)
        .map(|c| [c[0], c[1], c[2], c[3]])
        .collect();
    trace::trace_region(&segs, reach, open, close).map(|r| RegionData { r })
}

/// An area grown by `grow` mm from its fill field (grownArea in geo.ts); undefined when empty.
#[wasm_bindgen(js_name = grownArea)]
pub fn grown_area(
    sdf: &[f32],
    grow: f64,
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    px_mm: f64,
) -> Option<RegionData> {
    region_of(trace::grown_mask(sdf, grow), x0, y0, w, h, px_mm, None).map(|r| RegionData { r })
}

/// The stitches of a hidden way from a to b without its ends, as x, y pairs (search in travel.ts
/// before the check as sewn); undefined when there is none. `under`: the cells under a hiding area.
#[wasm_bindgen(js_name = hiddenSearch)]
#[allow(clippy::too_many_arguments)]
pub fn hidden_search(
    under: &[u8],
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    reach: f64,
) -> Option<Vec<f64>> {
    travel::hidden_search(under, x0.into(), y0.into(), w, h, [ax, ay], [bx, by], reach)
        .map(|pts| pts_to_flat(&pts))
}

/// The orders the optimizer finds (planCandidates in order.ts). Per object `ends` holds the first
/// and last stitch and, sewn from the other side, start and end (NaN when it may not be), and
/// `meta` its block, thread, cuts before it and up to its end, and flags (1 tie in, 2 tie off,
/// 4 a trim before the next object); `over` the objects each lies on, `over_lens` how many. Out:
/// the count of plans, then each plan's order, its count of reversed objects and those.
#[wasm_bindgen(js_name = planCandidates)]
#[allow(clippy::too_many_arguments)]
pub fn plan_candidates(
    ends: &[f64],
    meta: &[u32],
    over: &[u32],
    over_lens: &[u32],
    combine_colors: bool,
    shortest_ways: bool,
    trim_mm: f64,
) -> Vec<u32> {
    let objs: Vec<OrderObject> = ends
        .chunks_exact(8)
        .zip(meta.chunks_exact(5))
        .map(|(e, m)| OrderObject {
            block: m[0],
            key: m[1],
            first: [e[0], e[1]],
            last: [e[2], e[3]],
            rev: (!e[4].is_nan()).then_some(Reversal {
                sx: e[4],
                sy: e[5],
                ex: e[6],
                ey: e[7],
            }),
            tie_in: m[4] & 1 != 0,
            tie_off: m[4] & 2 != 0,
            cuts_before: m[2],
            cuts_through: m[3],
            trim_after: m[4] & 4 != 0,
        })
        .collect();
    let mut lists = Vec::with_capacity(over_lens.len());
    let mut at = 0;
    for &n in over_lens {
        lists.push(
            over[at..at + n as usize]
                .iter()
                .map(|&x| x as usize)
                .collect(),
        );
        at += n as usize;
    }
    let o = OrderOptions {
        combine_colors,
        shortest_ways,
        trim_mm,
    };
    let plans = order::plan_candidates(&objs, &lists, &o);
    let mut out = vec![plans.len() as u32];
    for p in &plans {
        out.extend(p.order.iter().map(|&i| i as u32));
        out.push(p.flip.len() as u32);
        out.extend(p.flip.iter().map(|&i| i as u32));
    }
    out
}

/// The parts of a Spec of sew.ts that are not areas (those cross as RegionIn).
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum SpecIn {
    Line {
        path: Form,
        line: PathStitch,
    },
    Fill {
        fill: FillSettings,
        /// The whole area the object remembers is the one it was cut from in this session.
        #[serde(default, rename = "keptSame")]
        kept_same: bool,
    },
    Satin {
        columns: Vec<Vec<Rails>>,
        satin: SatinSettings,
    },
    Border {
        border: PathStitch,
        #[serde(default)]
        open: Option<Form>,
    },
    Applique {
        applique: AppliqueSettings,
    },
}

/// One object sewn from its spec (sewOne in sew.ts), in one call: `spec` the plain parts of it,
/// `area` its area, `whole` the area it was cut from (appliqué: the area it shares), `kept` the
/// whole area it remembers when not `whole`; `covers` with an overlap each; `to` an x, y pair.
/// Undefined when nothing is sewn, else the runs with `under` set.
#[wasm_bindgen(js_name = sewOne)]
#[allow(clippy::too_many_arguments)]
pub fn sew_one(
    spec: JsValue,
    area: Option<RegionIn>,
    whole: Option<RegionIn>,
    kept: Option<RegionIn>,
    covers: Vec<RegionIn>,
    overlaps: &[f64],
    from_x: f64,
    from_y: f64,
    to: Option<Vec<f64>>,
) -> Result<Option<RunsOut>, JsError> {
    let spec: SpecIn = from_js(spec)?;
    let area = area.map(|a| a.r);
    let whole = whole.map(|w| w.r);
    let kept = kept.map(|w| w.r);
    let covers: Vec<Cover> = covers
        .into_iter()
        .zip(overlaps)
        .map(|(c, &overlap)| Cover {
            region: c.r,
            overlap,
        })
        .collect();
    let need = || area.as_ref().ok_or_else(|| JsError::new("sewOne: no area"));
    let s = match &spec {
        SpecIn::Line { path, line } => Spec::Line { path, line },
        SpecIn::Satin { columns, satin } => Spec::Satin { columns, satin },
        SpecIn::Fill { fill, kept_same } => Spec::Fill {
            area: need()?,
            fill,
            whole_kept: if *kept_same {
                whole.as_ref()
            } else {
                kept.as_ref()
            },
            whole: whole.as_ref(),
        },
        SpecIn::Border { border, open } => Spec::Border {
            area: need()?,
            border,
            whole: whole.as_ref(),
            open: open.as_ref(),
        },
        SpecIn::Applique { applique } => Spec::Applique {
            area: need()?,
            applique,
            shared: whole.as_ref(),
        },
    };
    let way = Way {
        from: [from_x, from_y],
        to: pt_of(to),
        covers: &covers,
    };
    Ok(sew::sew_one(&s, &way).map(|(runs, under)| {
        let mut out = runs_out(&runs, None);
        out.under = under;
        out
    }))
}

/// The stitches of a fill (fillRuns in restitch.ts): `travel` where travel may run besides the
/// area, `whole` the area it was cut from, `covers` with an overlap each, `end` an x, y pair,
/// `rows` the rows a 'follow' fill follows (x, y of both ends each), `zigzag` theirs. Undefined
/// when nothing is sewn, else the runs with `under` and the travel (takeWays) set.
#[wasm_bindgen(js_name = fillRuns)]
#[allow(clippy::too_many_arguments)]
pub fn fill_runs(
    area: RegionIn,
    s: JsValue,
    from_x: f64,
    from_y: f64,
    end: Option<Vec<f64>>,
    travel: Option<RegionIn>,
    whole: Option<RegionIn>,
    covers: Vec<RegionIn>,
    overlaps: &[f64],
    rows: Option<Vec<f64>>,
    zigzag: JsValue,
) -> Result<Option<RunsOut>, JsError> {
    let s: FillSettings = from_js(s)?;
    let zigzag: Option<FollowZigzag> = from_js(zigzag)?;
    let travel = travel.map(|t| t.r);
    let whole = whole.map(|w| w.r);
    let covers: Vec<Cover> = covers
        .into_iter()
        .zip(overlaps)
        .map(|(c, &overlap)| Cover {
            region: c.r,
            overlap,
        })
        .collect();
    let rows: Option<Vec<[Pt; 2]>> = rows.map(|v| {
        v.chunks_exact(4)
            .map(|c| [[c[0], c[1]], [c[2], c[3]]])
            .collect()
    });
    let way = FillWay {
        start: [from_x, from_y],
        end: pt_of(end),
        travel: travel.as_ref(),
        covers: &covers,
        rows: rows.as_deref(),
        zigzag: zigzag.as_ref(),
        whole: whole.as_ref(),
    };
    Ok(fill::fill_runs(&area.r, &s, &way).map(|f| {
        let mut out = runs_out(&f.runs, None);
        out.under = f.under;
        out.ways = f
            .travel
            .map(|t| t.iter().flat_map(|&[a, b]| [a as u32, b as u32]).collect());
        out
    }))
}
