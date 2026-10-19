use wasm_bindgen::Clamped;
use wasm_bindgen::prelude::*;

use crate::image::color::Lab;
use crate::image::crop::{self, Crop};
use crate::image::raster::{LabImage, Raster};
use crate::image::thread_match::{Thread, threads_of};
use crate::image::{edt, filters, labels, orientation, prepare, quantize, raster, thread_match};
use crate::pattern::ThreadColor;

#[wasm_bindgen(js_name = distanceToSeeds)]
pub fn distance_to_seeds(seed: &[u8], w: usize, h: usize, border: bool) -> Vec<f32> {
    edt::distance_to_seeds(seed, w, h, border)
}

#[wasm_bindgen(js_name = distanceInside)]
pub fn distance_inside(mask: &[u8], w: usize, h: usize) -> Vec<f32> {
    edt::distance_inside(mask, w, h)
}

fn lab_image(lab: &[f32], opaque: &[u8], w: usize, h: usize) -> LabImage {
    LabImage {
        width: w,
        height: h,
        lab: lab.to_vec(),
        opaque: opaque.to_vec(),
    }
}

fn raster_of(data: Clamped<Vec<u8>>, w: usize, h: usize) -> Raster {
    Raster {
        width: w,
        height: h,
        data: data.0,
    }
}

fn labs(flat: &[f64]) -> Vec<Lab> {
    flat.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect()
}

fn threads_from(v: JsValue) -> Result<Vec<Thread>, JsError> {
    let colors: Vec<ThreadColor> = serde_wasm_bindgen::from_value(v)?;
    Ok(threads_of(colors))
}

/// An image in Lab with its mask of opaque pixels.
#[wasm_bindgen(getter_with_clone)]
pub struct LabOut {
    pub lab: Vec<f32>,
    pub opaque: Vec<u8>,
}

#[wasm_bindgen(js_name = resizeArea)]
pub fn resize_area(
    data: Clamped<Vec<u8>>,
    sw: usize,
    sh: usize,
    w: usize,
    h: usize,
) -> Clamped<Vec<u8>> {
    Clamped(raster::resize_area(&raster_of(data, sw, sh), w, h).data)
}

#[wasm_bindgen(js_name = toLab)]
pub fn to_lab(data: Clamped<Vec<u8>>, w: usize, h: usize) -> LabOut {
    let l = raster::to_lab(&raster_of(data, w, h));
    LabOut {
        lab: l.lab,
        opaque: l.opaque,
    }
}

#[wasm_bindgen]
pub fn bilateral(
    lab: &[f32],
    opaque: &[u8],
    w: usize,
    h: usize,
    iterations: usize,
    sigma_s: f64,
    sigma_r: f64,
) -> Vec<f32> {
    filters::bilateral(&lab_image(lab, opaque, w, h), iterations, sigma_s, sigma_r).lab
}

#[wasm_bindgen(js_name = looksLikePhoto)]
pub fn looks_like_photo(data: Clamped<Vec<u8>>, w: usize, h: usize) -> bool {
    filters::looks_like_photo(&raster_of(data, w, h))
}

/// Doubled-angle line field of an image (see orientation.rs).
#[wasm_bindgen(getter_with_clone)]
pub struct OrientOut {
    pub c: Vec<f32>,
    pub s: Vec<f32>,
}

#[wasm_bindgen]
pub fn orientation(lab: &[f32], w: usize, h: usize, sigma: f64) -> OrientOut {
    let img = LabImage {
        width: w,
        height: h,
        lab: lab.to_vec(),
        opaque: vec![],
    };
    let o = orientation::orientation(&img, sigma);
    OrientOut { c: o.c, s: o.s }
}

/// Cluster centers (Lab, flat) and the cluster per pixel.
#[wasm_bindgen(getter_with_clone)]
pub struct QuantizeOut {
    pub centers: Vec<f64>,
    pub labels: Vec<u8>,
}

#[wasm_bindgen]
pub fn quantize(
    lab: &[f32],
    opaque: &[u8],
    w: usize,
    h: usize,
    max_colors: f64,
    palette: Option<Vec<f64>>,
) -> QuantizeOut {
    let palette = palette.map(|p| labs(&p));
    let q = quantize::quantize(
        &lab_image(lab, opaque, w, h),
        max_colors,
        palette.as_deref(),
    );
    QuantizeOut {
        centers: q.centers.iter().flatten().copied().collect(),
        labels: q.labels,
    }
}

#[wasm_bindgen]
pub fn assign(lab: &[f32], opaque: &[u8], w: usize, h: usize, centers: &[f64]) -> Vec<u8> {
    quantize::assign(&lab_image(lab, opaque, w, h), &labs(centers))
}

/// The exact colors of a graphic as r, g, b triples, or undefined for a photo.
#[wasm_bindgen(js_name = graphicPalette)]
pub fn graphic_palette(data: Clamped<Vec<u8>>, w: usize, h: usize) -> Option<Vec<u8>> {
    quantize::graphic_palette(&raster_of(data, w, h)).map(|p| p.concat())
}

/// Connected components: the component per pixel and, per component, its label, area and box.
#[wasm_bindgen(getter_with_clone)]
pub struct ComponentsOut {
    pub comp: Vec<i32>,
    pub label: Vec<u16>,
    pub area: Vec<u32>,
    #[wasm_bindgen(js_name = minX)]
    pub min_x: Vec<u32>,
    #[wasm_bindgen(js_name = minY)]
    pub min_y: Vec<u32>,
    #[wasm_bindgen(js_name = maxX)]
    pub max_x: Vec<u32>,
    #[wasm_bindgen(js_name = maxY)]
    pub max_y: Vec<u32>,
}

#[wasm_bindgen]
pub fn components(labels: &[u16], w: usize, h: usize) -> ComponentsOut {
    let c = labels::components(labels, w, h);
    ComponentsOut {
        comp: c.comp.iter().map(|&v| v as i32).collect(),
        label: c.label,
        area: c.area,
        min_x: c.min_x,
        min_y: c.min_y,
        max_x: c.max_x,
        max_y: c.max_y,
    }
}

#[wasm_bindgen(js_name = modeFilter)]
pub fn mode_filter(labels: &[u8], w: usize, h: usize) -> Vec<u8> {
    labels::mode_filter(labels, w, h)
}

#[wasm_bindgen]
pub fn bands(labels: &[u8], w: usize, h: usize, px_mm: f64) -> Vec<u8> {
    labels::bands(&labels::components(labels, w, h), labels, w, h, px_mm)
}

#[wasm_bindgen(js_name = mergeSmall)]
pub fn merge_small(
    labels: &[u8],
    w: usize,
    h: usize,
    min_area: f64,
    px_mm: Option<f64>,
) -> Vec<u8> {
    labels::merge_small(labels, w, h, min_area, px_mm)
}

/// `between` answers for seam s between a and b at `between[(s * n + a) * n + b]`, for labels below n.
#[wasm_bindgen(js_name = removeSeams)]
pub fn remove_seams(
    labels: &[u8],
    w: usize,
    h: usize,
    max_width: f64,
    between: &[u8],
    n: usize,
) -> Vec<u8> {
    labels::remove_seams(labels, w, h, max_width, |s, a, b| {
        let (s, a, b) = (s as usize, a as usize, b as usize);
        s < n && a < n && b < n && between[(s * n + a) * n + b] != 0
    })
}

#[wasm_bindgen(js_name = removeBackground)]
pub fn remove_background(labels: &[u8], w: usize, h: usize) -> Vec<u8> {
    labels::remove_background(labels, w, h)
}

/// For each color: the index of its thread and the CIEDE2000 to it, as pairs.
#[wasm_bindgen(js_name = matchThreads)]
pub fn match_threads(
    colors: &[f64],
    weights: Option<Vec<f64>>,
    threads: JsValue,
) -> Result<Vec<f64>, JsError> {
    let threads = threads_from(threads)?;
    let m = thread_match::match_threads(&labs(colors), weights.as_deref(), &threads);
    Ok(m.iter()
        .flat_map(|m| [m.thread as f64, m.delta_e])
        .collect())
}

fn crop_from(c: Option<Vec<f64>>) -> Option<Crop> {
    c.filter(|c| c.len() == 4).map(|c| Crop {
        x: c[0],
        y: c[1],
        w: c[2],
        h: c[3],
    })
}

/// The cut around the motif as x, y, w, h, or undefined.
#[wasm_bindgen(js_name = contentCrop)]
pub fn content_crop(data: Clamped<Vec<u8>>, w: usize, h: usize) -> Option<Vec<f64>> {
    crop::content_crop(&data, w, h).map(|c| vec![c.x, c.y, c.w, c.h])
}

#[wasm_bindgen(js_name = cutLabels)]
pub fn cut_labels(
    labels: &[u8],
    fw: usize,
    fh: usize,
    c: Option<Vec<f64>>,
    w: usize,
    h: usize,
) -> Vec<u8> {
    crop::cut_labels(labels, fw, fh, crop_from(c), w, h)
}

/// Stage 1 of the preparation: the image at the working size in Lab, smoothed, and its orientation.
#[wasm_bindgen(getter_with_clone)]
pub struct SmoothOut {
    pub lab: Vec<f32>,
    pub opaque: Vec<u8>,
    pub c: Vec<f32>,
    pub s: Vec<f32>,
}

#[wasm_bindgen(js_name = prepareSmooth)]
pub fn prepare_smooth(
    data: Clamped<Vec<u8>>,
    sw: usize,
    sh: usize,
    w: usize,
    h: usize,
    px_mm: f64,
    smooth: f64,
) -> SmoothOut {
    let (img, o) = prepare::smooth(&raster_of(data, sw, sh), w, h, px_mm, smooth);
    SmoothOut {
        lab: img.lab,
        opaque: img.opaque,
        c: o.c,
        s: o.s,
    }
}

/// Stage 3 of the preparation: the label per pixel, and the palette with `ofSource` as a plain object.
#[wasm_bindgen(getter_with_clone)]
pub struct FinishOut {
    pub labels: Vec<u8>,
    pub palette: JsValue,
    #[wasm_bindgen(js_name = ofSource)]
    pub of_source: Option<Vec<i32>>,
}

#[wasm_bindgen(js_name = prepareFinish)]
pub fn prepare_finish(
    w: usize,
    h: usize,
    px_mm: f64,
    centers: &[f64],
    raw: &[u8],
    options: JsValue,
    edits: JsValue,
    strokes: JsValue,
    sources: Option<Vec<u8>>,
    threads: JsValue,
) -> Result<FinishOut, JsError> {
    let o: prepare::PrepareOptions = serde_wasm_bindgen::from_value(options)?;
    let edits: Vec<prepare::ColorEdit> = serde_wasm_bindgen::from_value(edits)?;
    let strokes: Vec<prepare::Stroke> = serde_wasm_bindgen::from_value(strokes)?;
    let threads = threads_from(threads)?;
    let sources: Option<Vec<[u8; 3]>> =
        sources.map(|s| s.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect());
    let f = prepare::finish(
        w,
        h,
        px_mm,
        &labs(centers),
        raw,
        &o,
        &edits,
        &strokes,
        sources.as_deref(),
        &threads,
    );
    Ok(FinishOut {
        labels: f.labels,
        palette: serde_wasm_bindgen::to_value(&f.palette)?,
        of_source: f.of_source,
    })
}

/// Regions of an SVG by color from its drawings (RGBA, one after the other), see image/svg.rs.
#[wasm_bindgen(js_name = labelsFromPasses)]
pub fn labels_from_passes(passes: &[u8], count: usize, size: usize) -> Vec<u8> {
    crate::image::svg::labels_from_passes(passes, count, size)
}
