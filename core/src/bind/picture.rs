//! Exports of the image assistant (digitize/picture.rs, digitize/smart.rs): one call per image,
//! per area or per design. Regions cross as RegionIn, graphs and settings as plain objects (serde),
//! stitches as flat x, y lists with the point count of each run.

use wasm_bindgen::prelude::*;

use super::digitize::{RegionData, lines_from};
use super::fill::{LinesOut, RegionIn, flat_lines, lines_out};
use crate::digitize::flow::OrientLook;
use crate::digitize::picture::{self, Block};
use crate::digitize::region;
use crate::digitize::satin::SatinParams;
use crate::digitize::skeleton::{self, Graph};
use crate::digitize::smart::{self, AreaBox};
use crate::image::labels::{Components, components};

fn to_js<T: serde::Serialize>(v: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(v).map_err(|e| JsError::new(&e.to_string()))
}

fn from_js<T: serde::de::DeserializeOwned>(v: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(v).map_err(|e| JsError::new(&e.to_string()))
}

/// What the assistant finds in a prepared image once: its components, the colors in sewing order
/// and the pieces of a color bridged into one area. Each array is taken out once.
#[wasm_bindgen]
pub struct ImageAnalysis {
    comps: Components,
    order: Vec<u32>,
    bridged: picture::Bridged,
}

#[wasm_bindgen]
impl ImageAnalysis {
    #[wasm_bindgen(js_name = takeComp)]
    pub fn take_comp(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.comps.comp)
            .into_iter()
            .map(|v| v as i32)
            .collect()
    }
    #[wasm_bindgen(js_name = takeLabel)]
    pub fn take_label(&mut self) -> Vec<u16> {
        std::mem::take(&mut self.comps.label)
    }
    #[wasm_bindgen(js_name = takeArea)]
    pub fn take_area(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.comps.area)
    }
    /// The boxes of the components: min x, min y, max x, max y each.
    #[wasm_bindgen(js_name = takeBoxes)]
    pub fn take_boxes(&mut self) -> Vec<u32> {
        let c = &self.comps;
        (0..c.min_x.len())
            .flat_map(|k| [c.min_x[k], c.min_y[k], c.max_x[k], c.max_y[k]])
            .collect()
    }
    #[wasm_bindgen(js_name = takeOrder)]
    pub fn take_order(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.order)
    }
    /// The components with bridged pieces merged; empty when nothing was merged.
    #[wasm_bindgen(js_name = takeBridgedComp)]
    pub fn take_bridged_comp(&mut self) -> Vec<i32> {
        self.bridged.comp.take().unwrap_or_default()
    }
    #[wasm_bindgen(js_name = takeInto)]
    pub fn take_into(&mut self) -> Vec<u32> {
        self.bridged.into.iter().map(|&c| c as u32).collect()
    }
    /// The merged areas: first piece, min x, min y, max x, max y each.
    #[wasm_bindgen(js_name = takeMerged)]
    pub fn take_merged(&mut self) -> Vec<i32> {
        self.bridged
            .boxes
            .iter()
            .flat_map(|(c, b)| [*c as i32, b.min_x, b.min_y, b.max_x, b.max_y])
            .collect()
    }
}

#[wasm_bindgen(js_name = analyzeImage)]
pub fn analyze_image(
    labels: &[u8],
    w: usize,
    h: usize,
    px_mm: f64,
    colors: usize,
) -> ImageAnalysis {
    let comps = components(labels, w, h);
    let order = picture::sewing_order(labels, &comps, w, h, px_mm, colors);
    let mut rank = vec![-1i32; colors];
    for (k, &l) in order.iter().enumerate() {
        rank[l] = k as i32;
    }
    let bridged = picture::bridge(labels, &comps, w, h, px_mm, &rank);
    ImageAnalysis {
        comps,
        order: order.into_iter().map(|l| l as u32).collect(),
        bridged,
    }
}

#[wasm_bindgen(js_name = sewingOrder)]
pub fn sewing_order(labels: &[u8], w: usize, h: usize, px_mm: f64, colors: usize) -> Vec<u32> {
    let comps = components(labels, w, h);
    picture::sewing_order(labels, &comps, w, h, px_mm, colors)
        .into_iter()
        .map(|l| l as u32)
        .collect()
}

/// An area as found: its region, skeleton, what it is sewn as and points on its edge.
#[wasm_bindgen]
pub struct FoundArea {
    region: Option<region::Region>,
    graph: Graph,
    kind: picture::Kind,
    probe: Vec<f64>,
}

#[wasm_bindgen]
impl FoundArea {
    #[wasm_bindgen(js_name = takeRegion)]
    pub fn take_region(&mut self) -> Option<RegionData> {
        self.region.take().map(|r| RegionData { r })
    }
    #[wasm_bindgen(getter)]
    pub fn graph(&self) -> Result<JsValue, JsError> {
        to_js(&self.graph)
    }
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> String {
        self.kind.name().into()
    }
    #[wasm_bindgen(js_name = takeProbe)]
    pub fn take_probe(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.probe)
    }
}

/// The region of component `comp` from its window of the component map and labels (`cw` × `ch`
/// from image pixel `cx0`, `cy0`; the box in the window), with its skeleton, kind and probes. As
/// buildRegion: `grow_into` per label whether the fill may reach into it.
#[wasm_bindgen(js_name = findArea)]
pub fn find_area(
    comp_map: &[i32],
    labels: &[u8],
    cw: usize,
    ch: usize,
    comp: i32,
    label: i32,
    min_x: i32,
    min_y: i32,
    max_x: i32,
    max_y: i32,
    px_mm: f64,
    grow: f64,
    grow_into: &[u8],
    cx0: i32,
    cy0: i32,
    satin_min: f64,
    satin_max: f64,
) -> FoundArea {
    let bbox = region::Bbox {
        min_x,
        min_y,
        max_x,
        max_y,
    };
    let mut r = region::build_region(
        comp_map,
        labels,
        cw,
        comp,
        label,
        bbox,
        ch,
        px_mm,
        grow,
        |l| grow_into.get(l as usize).is_some_and(|&g| g != 0),
    );
    r.x0 += cx0;
    r.y0 += cy0;
    let graph = skeleton::skeleton(&r);
    let kind = picture::classify(&graph, satin_min, satin_max);
    let probe = picture::probes(&r)
        .into_iter()
        .flat_map(|p| [p[0], p[1]])
        .collect();
    FoundArea {
        region: Some(r),
        graph,
        kind,
        probe,
    }
}

#[derive(serde::Serialize)]
struct Classified {
    graph: Graph,
    kind: &'static str,
}

/// The skeleton of a region and what it is sewn as (fill, satin or run).
#[wasm_bindgen(js_name = classifyArea)]
pub fn classify_area(r: RegionIn, satin_min: f64, satin_max: f64) -> Result<JsValue, JsError> {
    let graph = skeleton::skeleton(&r.r);
    let kind = picture::classify(&graph, satin_min, satin_max).name();
    to_js(&Classified { graph, kind })
}

#[wasm_bindgen(js_name = isStroke)]
pub fn is_stroke(r: RegionIn, satin_max: f64) -> Result<JsValue, JsError> {
    match picture::is_stroke(&r.r, satin_max) {
        Some(g) => to_js(&g),
        None => Ok(JsValue::NULL),
    }
}

#[wasm_bindgen(js_name = satinForArea)]
pub fn satin_for_area(
    r: RegionIn,
    sx: f64,
    sy: f64,
    p: JsValue,
    underlay: bool,
    tol: f64,
    satin_max: f64,
    peak: f64,
) -> Result<Option<LinesOut>, JsError> {
    let p: SatinParams = from_js(p)?;
    Ok(
        picture::satin_for_area(&r.r, [sx, sy], &p, underlay, tol, satin_max, peak)
            .map(|runs| lines_out(&runs)),
    )
}

/// Satin along a network, and whether it holds (see picture::satin_ok; when `limit` is given).
#[wasm_bindgen]
pub struct SatinRuns {
    pts: Vec<f64>,
    lens: Vec<u32>,
    ok: bool,
}

#[wasm_bindgen]
impl SatinRuns {
    #[wasm_bindgen(js_name = takePts)]
    pub fn take_pts(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.pts)
    }
    #[wasm_bindgen(js_name = takeLens)]
    pub fn take_lens(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.lens)
    }
    #[wasm_bindgen(getter)]
    pub fn ok(&self) -> bool {
        self.ok
    }
}

#[wasm_bindgen(js_name = sewSatinNetwork)]
pub fn sew_satin_network(
    r: RegionIn,
    graph: JsValue,
    sx: f64,
    sy: f64,
    p: JsValue,
    underlay: bool,
    tol: f64,
    stretch: bool,
    limit: Option<f64>,
) -> Result<SatinRuns, JsError> {
    let g: Graph = from_js(graph)?;
    let p: SatinParams = from_js(p)?;
    let runs = picture::sew_satin(&r.r, &g, [sx, sy], &p, underlay, tol, stretch);
    let ok = limit.is_some_and(|l| picture::satin_ok(&runs, &r.r, l));
    let (pts, lens) = flat_lines(&runs);
    Ok(SatinRuns { pts, lens, ok })
}

#[wasm_bindgen(js_name = sewRunNetwork)]
pub fn sew_run_network(
    r: RegionIn,
    graph: JsValue,
    sx: f64,
    sy: f64,
    tol: f64,
) -> Result<LinesOut, JsError> {
    let g: Graph = from_js(graph)?;
    Ok(lines_out(&picture::sew_run(&r.r, &g, [sx, sy], tol)))
}

/// Records of a design, absolute (0.1 mm), and the first stitch of each object.
#[wasm_bindgen]
pub struct Assembled {
    a: picture::Assembled,
}

#[wasm_bindgen]
impl Assembled {
    #[wasm_bindgen(js_name = takeX)]
    pub fn take_x(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.a.x)
    }
    #[wasm_bindgen(js_name = takeY)]
    pub fn take_y(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.a.y)
    }
    #[wasm_bindgen(js_name = takeCmd)]
    pub fn take_cmd(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.a.cmd)
    }
    #[wasm_bindgen(js_name = takeStarts)]
    pub fn take_starts(&mut self) -> Vec<u32> {
        self.a.starts.iter().map(|&s| s as u32).collect()
    }
}

/// Runs as `flat` points with `lens` points each; `runs` runs per block (thread), `owners` the
/// object of each run.
#[wasm_bindgen(js_name = assembleDesign)]
pub fn assemble_design(
    flat: &[f64],
    lens: &[u32],
    runs: &[u32],
    owners: &[u32],
    cx: f64,
    cy: f64,
    trim_mm: f64,
) -> Assembled {
    let mut all = lines_from(flat, lens).into_iter();
    let mut own = owners.iter().map(|&o| o as usize);
    let blocks: Vec<Block> = runs
        .iter()
        .map(|&n| Block {
            runs: all.by_ref().take(n as usize).collect(),
            owners: own.by_ref().take(n as usize).collect(),
        })
        .collect();
    Assembled {
        a: picture::assemble(&blocks, cx, cy, trim_mm),
    }
}

/// How clearly the image has a direction inside the area (smart.rs), from the structure tensor
/// over the image window from (`cx0`, `cy0`), `cw` wide, of an image `width` × `height`.
#[wasm_bindgen(js_name = areaStructure)]
pub fn area_structure(
    r: RegionIn,
    orient_c: &[f32],
    orient_s: &[f32],
    cx0: usize,
    cy0: usize,
    cw: usize,
    width: usize,
    height: usize,
) -> f64 {
    let ch = orient_c.len() / cw.max(1);
    let look = |px: usize, py: usize| -> (f32, f32) {
        if px < cx0 || py < cy0 || px - cx0 >= cw || py - cy0 >= ch {
            return (0.0, 0.0);
        }
        let k = (py - cy0) * cw + (px - cx0);
        (orient_c[k], orient_s[k])
    };
    let orient = OrientLook {
        width,
        height,
        look: &look,
    };
    smart::structure(&r.r, Some(&orient))
}

#[wasm_bindgen(js_name = acrossGraph)]
pub fn across_graph(
    r: RegionIn,
    satin_max: f64,
    max_width: f64,
    max_area: f64,
) -> Result<JsValue, JsError> {
    match smart::across_graph(&r.r, satin_max, max_width, max_area) {
        Some(g) => to_js(&g),
        None => Ok(JsValue::NULL),
    }
}

fn boxes(flat: &[u32]) -> Vec<AreaBox> {
    flat.chunks_exact(5)
        .map(|b| AreaBox {
            label: b[0] as u16,
            min_x: b[1],
            min_y: b[2],
            max_x: b[3],
            max_y: b[4],
        })
        .collect()
}

/// The pixels of the areas `keys` among `all` (label, min x, min y, max x, max y each), see
/// smart.rs; the components as `comp`, `label` and their boxes (min x, min y, max x, max y each).
#[wasm_bindgen(js_name = areaPixels)]
pub fn area_pixels(
    comp: &[i32],
    label: Vec<u16>,
    comp_boxes: &[u32],
    w: usize,
    h: usize,
    all: &[u32],
    keys: &[u32],
) -> Vec<u8> {
    let b = |k: usize| comp_boxes.iter().skip(k).step_by(4).copied().collect();
    let comps = Components {
        comp: comp.iter().map(|&v| v as u32).collect(),
        area: vec![0; label.len()],
        label,
        min_x: b(0),
        min_y: b(1),
        max_x: b(2),
        max_y: b(3),
    };
    smart::area_pixels(&comps, w, h, &boxes(all), &boxes(keys))
}
