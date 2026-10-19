//! Exports of the satin modules (digitize/satin, rungs, satin_shapes, satin_forms, satin_joins,
//! satin_suggest, satin_ease).
//!
//! Columns cross as one flat list: the width, then the center, left and right rails, each as
//! x, y pairs of the same count (see src/digitize/satin.ts, colFlat). Rails and point lists cross as
//! flat x, y lists, lists of lines as flat points with a count per line; graphs, shapes, settings and
//! the results with structure as plain objects (serde, `None` as null).

use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;

use super::digitize::{RegionData, lines_from};
use super::fill::RegionIn;
use crate::digitize::region::Region;
use crate::digitize::rungs::{self, Cut, Rung};
use crate::digitize::satin::{self, Column, ColumnEnds, SatinParams, UnderInset, UnderlayKind};
use crate::digitize::satin_forms;
use crate::digitize::satin_joins::{self, SatinCorner, SatinEnd};
use crate::digitize::satin_shapes::{self, Blob, Material, Shape};
use crate::digitize::skeleton::Graph;
use crate::digitize::{satin_ease, satin_suggest};
use crate::geom::{Pt, pts_from_flat, pts_to_flat};
use crate::model::restitch::{Rails, SatinSettings};

fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    v.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsError::new(&e.to_string()))
}

fn from_js<T: DeserializeOwned>(v: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(v).map_err(|e| JsError::new(&e.to_string()))
}

fn opt_from_js<T: DeserializeOwned>(v: JsValue) -> Result<Option<T>, JsError> {
    if v.is_null() || v.is_undefined() {
        Ok(None)
    } else {
        from_js(v).map(Some)
    }
}

fn col_from(flat: &[f64]) -> Column {
    let n = (flat.len() - 1) / 6;
    let pts = |k: usize| pts_from_flat(&flat[1 + 2 * n * k..1 + 2 * n * (k + 1)]);
    Column {
        width: flat[0],
        center: pts(0),
        left: pts(1),
        right: pts(2),
    }
}

fn col_to(c: &Column) -> Vec<f64> {
    let mut out = Vec::with_capacity(1 + 6 * c.center.len());
    out.push(c.width);
    for rail in [&c.center, &c.left, &c.right] {
        out.extend(pts_to_flat(rail));
    }
    out
}

fn pairs_from(flat: &[f64]) -> Vec<satin::Pair> {
    flat.as_chunks::<4>()
        .0
        .iter()
        .map(|c| [[c[0], c[1]], [c[2], c[3]]])
        .collect()
}

fn rungs_from(flat: &[f64]) -> Vec<Rung> {
    pts_from_flat(flat)
}

fn segs_from(flat: &[f64]) -> Vec<[Pt; 2]> {
    pairs_from(flat)
}

fn segs_to(v: &[[Pt; 2]]) -> Vec<f64> {
    v.iter()
        .flat_map(|[a, b]| [a[0], a[1], b[0], b[1]])
        .collect()
}

fn kind_of<T: DeserializeOwned>(s: &str) -> Result<T, JsError> {
    from_js(JsValue::from_str(s))
}

/// The region a column is cast in: only its signed field and window count.
fn field_region(sdf_base: Vec<f32>, x0: i32, y0: i32, w: usize, h: usize, px_mm: f64) -> Region {
    Region {
        label: 0,
        x0,
        y0,
        w,
        h,
        px_mm,
        mask: Vec::new(),
        inside: Vec::new(),
        sdf_base,
        sdf_grown: None,
        area_mm2: 0.0,
    }
}

#[wasm_bindgen(js_name = satinColumn)]
pub fn satin_column(
    sdf_base: Vec<f32>,
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    px_mm: f64,
    pts: &[f64],
    rad: &[f64],
    free_a: bool,
    free_b: bool,
) -> Vec<f64> {
    let r = field_region(sdf_base, x0, y0, w, h, px_mm);
    col_to(&satin::column(&r, &pts_from_flat(pts), rad, free_a, free_b))
}

/// Pairs as a flat list: left x, y, right x, y per pair.
#[wasm_bindgen(js_name = satinPairs)]
pub fn satin_pairs(col: &[f64], params: JsValue, ends: JsValue) -> Result<Vec<f64>, JsError> {
    let p: SatinParams = from_js(params)?;
    let ends: Option<ColumnEnds> = opt_from_js(ends)?;
    Ok(segs_to(&satin::pairs(&col_from(col), &p, ends.as_ref())))
}

#[wasm_bindgen(js_name = satinStitches)]
pub fn satin_stitches(pairs: &[f64], params: JsValue) -> Result<Vec<f64>, JsError> {
    let p: SatinParams = from_js(params)?;
    Ok(pts_to_flat(&satin::satin_stitches(&pairs_from(pairs), &p)))
}

#[wasm_bindgen(js_name = eStitches)]
pub fn e_stitches(pairs: &[f64], params: JsValue) -> Result<Vec<f64>, JsError> {
    let p: SatinParams = from_js(params)?;
    Ok(pts_to_flat(&satin::e_stitches(&pairs_from(pairs), &p)))
}

#[wasm_bindgen(js_name = satinUnderlay)]
pub fn satin_underlay(
    col: &[f64],
    tol: f64,
    ins: JsValue,
    stretch: bool,
) -> Result<Vec<f64>, JsError> {
    let ins: Option<UnderInset> = opt_from_js(ins)?;
    Ok(pts_to_flat(&satin::underlay(
        &col_from(col),
        tol,
        ins,
        stretch,
    )))
}

/// The underlay's points, after a first number: 1 when it ends at the column's far end.
#[wasm_bindgen(js_name = satinUnderlayOf)]
pub fn satin_underlay_of(
    col: &[f64],
    kind: &str,
    tol: f64,
    ins: JsValue,
    one_way: bool,
    stretch: bool,
) -> Result<Vec<f64>, JsError> {
    let ins: Option<UnderInset> = opt_from_js(ins)?;
    let kind: UnderlayKind = kind_of(kind)?;
    let u = satin::underlay_of(&col_from(col), kind, tol, ins, one_way, stretch);
    let mut out = Vec::with_capacity(1 + 2 * u.pts.len());
    out.push(if u.at_end { 1.0 } else { 0.0 });
    out.extend(pts_to_flat(&u.pts));
    Ok(out)
}

#[wasm_bindgen(js_name = fringedColumn)]
pub fn fringed_column(col: &[f64], a: f64, b: f64) -> Vec<f64> {
    col_to(&satin::fringed_column(&col_from(col), a, b))
}

#[wasm_bindgen(js_name = columnFromRungs)]
pub fn column_from_rungs(left: &[f64], right: &[f64], rungs: &[f64], step: f64) -> Vec<f64> {
    col_to(&rungs::column_from_rungs(
        &pts_from_flat(left),
        &pts_from_flat(right),
        &rungs_from(rungs),
        step,
    ))
}

#[wasm_bindgen(js_name = seedRungs)]
pub fn seed_rungs(left: &[f64], right: &[f64], max_deg: f64) -> Vec<f64> {
    pts_to_flat(&rungs::seed_rungs(
        &pts_from_flat(left),
        &pts_from_flat(right),
        max_deg,
    ))
}

#[wasm_bindgen(js_name = cornerRungs)]
pub fn corner_rungs(left: &[f64], right: &[f64], rungs: &[f64], min_deg: f64) -> Vec<f64> {
    pts_to_flat(&rungs::corner_rungs(
        &pts_from_flat(left),
        &pts_from_flat(right),
        &rungs_from(rungs),
        min_deg,
    ))
}

#[wasm_bindgen(js_name = rungCornerCuts)]
pub fn rung_corner_cuts(left: &[f64], right: &[f64], rungs: &[f64], min_deg: f64) -> Vec<f64> {
    pts_to_flat(&rungs::corner_cuts(
        &pts_from_flat(left),
        &pts_from_flat(right),
        &rungs_from(rungs),
        min_deg,
    ))
}

/// `lines`: flat a x, a y, b x, b y per line across.
#[wasm_bindgen(js_name = railsFromOutline)]
pub fn rails_from_outline(ring: &[f64], lines: &[f64]) -> Result<JsValue, JsError> {
    to_js(&rungs::rails_from_outline(
        &pts_from_flat(ring),
        &segs_from(lines),
    ))
}

#[wasm_bindgen(js_name = stripOfLoop)]
pub fn strip_of_loop(
    ring: &[f64],
    chords: &[f64],
    caps: &[f64],
    far: bool,
) -> Result<JsValue, JsError> {
    to_js(&rungs::strip_of_loop(
        &pts_from_flat(ring),
        &pts_from_flat(chords),
        &pts_from_flat(caps),
        far,
    ))
}

#[wasm_bindgen(js_name = stripsOfOutline)]
pub fn strips_of_outline(
    ring: &[f64],
    lines: &[f64],
    cuts: &[f64],
    cut_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
) -> Result<JsValue, JsError> {
    let cuts: Vec<Cut> = lines_from(cuts, cut_lens);
    to_js(&rungs::strips_of_outline(
        &pts_from_flat(ring),
        &segs_from(lines),
        &cuts,
        &lines_from(holes, hole_lens),
    ))
}

#[wasm_bindgen(js_name = stripsOfAreas)]
pub fn strips_of_areas(
    outlines: &[f64],
    outline_lens: &[u32],
    lines: &[f64],
    cuts: &[f64],
    cut_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
) -> Result<JsValue, JsError> {
    to_js(&rungs::strips_of_areas(
        &lines_from(outlines, outline_lens),
        &segs_from(lines),
        &lines_from(cuts, cut_lens),
        &lines_from(holes, hole_lens),
    ))
}

#[wasm_bindgen(js_name = checkSections)]
pub fn check_sections(
    outlines: &[f64],
    outline_lens: &[u32],
    lines: &[f64],
    cuts: &[f64],
    cut_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
) -> Result<JsValue, JsError> {
    to_js(&rungs::check_sections(
        &lines_from(outlines, outline_lens),
        &segs_from(lines),
        &lines_from(cuts, cut_lens),
        &lines_from(holes, hole_lens),
    ))
}

/// Columns as their left rails and their right rails (flat, a count each).
#[wasm_bindgen(js_name = cutLinesBetween)]
pub fn cut_lines_between(
    lefts: &[f64],
    left_lens: &[u32],
    rights: &[f64],
    right_lens: &[u32],
    outlines: &[f64],
    outline_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
) -> Vec<f64> {
    let cols: Vec<(Vec<Pt>, Vec<Pt>)> = lines_from(lefts, left_lens)
        .into_iter()
        .zip(lines_from(rights, right_lens))
        .collect();
    segs_to(&rungs::cut_lines_between(
        &cols,
        &lines_from(outlines, outline_lens),
        &lines_from(holes, hole_lens),
    ))
}

/// The rails as one flat list: the point count, then the left rail's points, then the right's.
#[wasm_bindgen(js_name = strokeRails)]
pub fn stroke_rails(
    line: &[f64],
    closed: bool,
    w: f64,
    corner: &str,
    ends: &str,
) -> Result<Vec<f64>, JsError> {
    let corner: SatinCorner = kind_of(corner)?;
    let ends: SatinEnd = kind_of(ends)?;
    let r = satin_joins::stroke_rails(&pts_from_flat(line), closed, w, corner, ends);
    let mut out = Vec::with_capacity(1 + 4 * r.left.len());
    out.push(r.left.len() as f64);
    out.extend(pts_to_flat(&r.left));
    out.extend(pts_to_flat(&r.right));
    Ok(out)
}

#[wasm_bindgen(js_name = smallHoles)]
pub fn small_holes(graph: JsValue, holes: &[f64], hole_lens: &[u32]) -> Result<Vec<u32>, JsError> {
    let g: Graph = from_js(graph)?;
    Ok(satin_shapes::small_holes(&g, &lines_from(holes, hole_lens))
        .into_iter()
        .map(|k| k as u32)
        .collect())
}

#[wasm_bindgen(js_name = filledRegion)]
pub fn filled_region(
    mask: Vec<u8>,
    w: usize,
    h: usize,
    x0: i32,
    y0: i32,
    px_mm: f64,
    holes: &[f64],
    hole_lens: &[u32],
) -> RegionData {
    let area = Region {
        label: 0,
        x0,
        y0,
        w,
        h,
        px_mm,
        mask,
        inside: Vec::new(),
        sdf_base: Vec::new(),
        sdf_grown: None,
        area_mm2: 0.0,
    };
    RegionData {
        r: satin_shapes::filled(&area, &lines_from(holes, hole_lens)),
    }
}

#[wasm_bindgen(js_name = splitBlobs)]
pub fn split_blobs(graph: JsValue) -> Result<JsValue, JsError> {
    let g: Graph = from_js(graph)?;
    to_js(&satin_shapes::split_blobs(&g))
}

#[wasm_bindgen(js_name = wholeShape)]
pub fn whole_shape(
    outsides: &[f64],
    out_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
) -> Result<JsValue, JsError> {
    let (o, hs) = (lines_from(outsides, out_lens), lines_from(holes, hole_lens));
    to_js(&satin_shapes::whole_shape(&o, &hs, &Material::new(&o, &hs)))
}

#[wasm_bindgen(js_name = blobShape)]
pub fn blob_shape(
    blob: JsValue,
    lines: JsValue,
    outsides: &[f64],
    out_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
) -> Result<JsValue, JsError> {
    let blob: Blob = from_js(blob)?;
    let lines: Graph = from_js(lines)?;
    let (o, hs) = (lines_from(outsides, out_lens), lines_from(holes, hole_lens));
    to_js(&satin_shapes::blob_shape(
        &blob,
        &lines,
        &o,
        &hs,
        &Material::new(&o, &hs),
    ))
}

/// `outsides` and `holes`: the area the shape lies in (its material).
#[wasm_bindgen(js_name = planShape)]
pub fn plan_shape(
    shape: JsValue,
    outsides: &[f64],
    out_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
    max: f64,
    split: bool,
    column: bool,
) -> Result<JsValue, JsError> {
    let s: Shape = from_js(shape)?;
    let m = Material::new(
        &lines_from(outsides, out_lens),
        &lines_from(holes, hole_lens),
    );
    to_js(&satin_shapes::plan_shape(
        &s,
        &|q| m.test(q),
        max,
        split,
        column,
    ))
}

#[wasm_bindgen(js_name = formCornerCuts)]
pub fn form_corner_cuts(
    outsides: &[f64],
    out_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
    max: f64,
) -> Result<JsValue, JsError> {
    let (o, hs) = (lines_from(outsides, out_lens), lines_from(holes, hole_lens));
    to_js(&satin_forms::corner_cuts(
        &o,
        &hs,
        &Material::new(&o, &hs),
        max,
    ))
}

/// Per part its lines across, or the stroke the TypeScript plans (see satin_forms::PartPlan); null
/// when a part fits no plan.
#[wasm_bindgen(js_name = planParts)]
pub fn plan_parts(
    outsides: &[f64],
    out_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
    cuts: &[f64],
    tips: &[f64],
    tip_lens: &[u32],
    graph: JsValue,
    max: f64,
) -> Result<JsValue, JsError> {
    let g: Graph = from_js(graph)?;
    to_js(&satin_forms::plan_parts(
        &lines_from(outsides, out_lens),
        &lines_from(holes, hole_lens),
        &segs_from(cuts),
        &lines_from(tips, tip_lens),
        &g,
        max,
    ))
}

// "Vorschlagen" and easing a satin in sections (digitize/satin_suggest, satin_ease): one call per area.

/// Loops as one flat list: the count of outsides, then per loop its point count and its points.
fn loops_to(outsides: &[Vec<Pt>], holes: &[Vec<Pt>]) -> Vec<f64> {
    let mut out = vec![outsides.len() as f64];
    for l in outsides.iter().chain(holes) {
        out.push(l.len() as f64);
        out.extend(pts_to_flat(l));
    }
    out
}

/// The outsides and holes of an area as the satin tool reads them (see loops_to).
#[wasm_bindgen(js_name = areaLoops)]
pub fn area_loops(
    sdf_base: Vec<f32>,
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    px_mm: f64,
) -> Vec<f64> {
    let (o, hs) = satin_suggest::area_loops(&field_region(sdf_base, x0, y0, w, h, px_mm));
    loops_to(&o, &hs)
}

/// A suggestion for the area (see satin_suggest::suggest_satin), null when it is empty. `graph`:
/// its skeleton when known, else null.
#[wasm_bindgen(js_name = suggestSatin)]
pub fn suggest_satin(
    r: RegionIn,
    graph: JsValue,
    max: f64,
    columns: bool,
    crossings: bool,
) -> Result<JsValue, JsError> {
    let g: Option<Graph> = opt_from_js(graph)?;
    let made = satin_suggest::suggest_satin(&r.r, g.as_ref(), max, columns, crossings)
        .map_err(|e| JsError::new(&e))?;
    to_js(&made)
}

/// The columns "Vorschlagen" makes of an area in sewing order, with the loops and cut lines for
/// their split: { columns, outlines, holes, cuts }, or null.
#[wasm_bindgen(js_name = suggestedColumns)]
pub fn suggested_columns(r: RegionIn, settings: JsValue) -> Result<JsValue, JsError> {
    let s: SatinSettings = from_js(settings)?;
    #[derive(Serialize)]
    struct Out {
        columns: Vec<Rails>,
        outlines: Vec<Vec<Pt>>,
        holes: Vec<Vec<Pt>>,
        cuts: Vec<[Pt; 2]>,
    }
    let made = satin_suggest::suggested_columns(&r.r, &s).map_err(|e| JsError::new(&e))?;
    to_js(&made.map(|(columns, outlines, holes, cuts)| Out {
        columns,
        outlines,
        holes,
        cuts,
    }))
}

/// The cut lines added where the satin of a plan piles up (see satin_ease::ease_piles), as flat
/// pairs of points; empty when none helps. `runs`: the satin as sewn, when known.
#[wasm_bindgen(js_name = easePiles)]
pub fn ease_piles(
    sdf_base: Vec<f32>,
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    px_mm: f64,
    cuts: &[f64],
    cut_lens: &[u32],
    lines: &[f64],
    settings: JsValue,
    max: f64,
    limit: f64,
    runs: Option<Vec<f64>>,
    run_lens: Option<Vec<u32>>,
) -> Result<Vec<f64>, JsError> {
    let s: SatinSettings = from_js(settings)?;
    let runs = runs.zip(run_lens).map(|(p, l)| lines_from(&p, &l));
    let added = satin_ease::ease_piles(
        &field_region(sdf_base, x0, y0, w, h, px_mm),
        &lines_from(cuts, cut_lens),
        &segs_from(lines),
        &s,
        max,
        limit,
        runs,
    );
    Ok(added.iter().flat_map(|c| pts_to_flat(c)).collect())
}

/// The order that opens the holes (see satin_suggest::bridge_order), by index of the cut lines.
#[wasm_bindgen(js_name = bridgeOrder)]
pub fn bridge_order(
    cuts: &[f64],
    outsides: &[f64],
    out_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
) -> Vec<u32> {
    satin_suggest::bridge_indices(
        &segs_from(cuts),
        &lines_from(outsides, out_lens),
        &lines_from(holes, hole_lens),
    )
    .into_iter()
    .map(|k| k as u32)
    .collect()
}

/// Whether a column runs across a hole (see satin_suggest::covers); strips as plain objects.
#[wasm_bindgen(js_name = stripsCover)]
pub fn strips_cover(strips: JsValue, holes: &[f64], hole_lens: &[u32]) -> Result<bool, JsError> {
    let strips: Vec<rungs::Strip> = from_js(strips)?;
    Ok(satin_suggest::covers(
        &strips,
        &lines_from(holes, hole_lens),
    ))
}

/// Where a satin that does not know how it was cut gets its area (see satin_suggest::split_of):
/// { part, outlines, holes, cuts } or null. The columns' rails as flat lines, `parts` the count of
/// columns in each part; `part` the part given, or -1.
#[wasm_bindgen(js_name = splitOf)]
pub fn split_of(
    lefts: &[f64],
    left_lens: &[u32],
    rights: &[f64],
    right_lens: &[u32],
    parts: &[u32],
    sdf_base: Vec<f32>,
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    px_mm: f64,
    part: i32,
) -> Result<JsValue, JsError> {
    let (ls, rs) = (lines_from(lefts, left_lens), lines_from(rights, right_lens));
    let mut cols = ls.into_iter().zip(rs);
    let columns: Vec<Vec<(Vec<Pt>, Vec<Pt>)>> = parts
        .iter()
        .map(|&n| cols.by_ref().take(n as usize).collect())
        .collect();
    #[derive(Serialize)]
    struct Out {
        part: usize,
        outlines: Vec<Vec<Pt>>,
        holes: Vec<Vec<Pt>>,
        cuts: Vec<[Pt; 2]>,
    }
    let area = field_region(sdf_base, x0, y0, w, h, px_mm);
    let made = satin_suggest::split_of(&columns, &area, (part >= 0).then_some(part as usize));
    to_js(&made.map(|(part, outlines, holes, cuts)| Out {
        part,
        outlines,
        holes,
        cuts,
    }))
}

/// A suggestion around cut lines drawn by hand (see satin_suggest::around_cuts).
#[wasm_bindgen(js_name = aroundCuts)]
pub fn around_cuts(
    lines: &[f64],
    cuts: &[f64],
    own: &[f64],
    own_lens: &[u32],
    outsides: &[f64],
    out_lens: &[u32],
    holes: &[f64],
    hole_lens: &[u32],
) -> Result<JsValue, JsError> {
    let own: Vec<Cut> = lines_from(own, own_lens);
    to_js(&satin_suggest::around_cuts(
        &segs_from(lines),
        &segs_from(cuts),
        &own,
        &lines_from(outsides, out_lens),
        &lines_from(holes, hole_lens),
    ))
}

/// The columns a fill makes along lines across it and cut lines (see satin_suggest::Along), or null.
#[wasm_bindgen(js_name = columnsAlong)]
pub fn columns_along(
    sdf_base: Vec<f32>,
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    px_mm: f64,
    lines: &[f64],
    cuts: &[f64],
    cut_lens: &[u32],
) -> Result<JsValue, JsError> {
    to_js(&satin_suggest::columns_along(
        &field_region(sdf_base, x0, y0, w, h, px_mm),
        &segs_from(lines),
        &lines_from(cuts, cut_lens),
    ))
}
