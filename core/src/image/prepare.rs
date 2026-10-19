//! Turns any image into an image that can be embroidered: a few flat thread colors, regions large
//! enough to sew, no anti-aliasing seams, the background left out. Stages, each cached by the caller
//! (the Preparer in src/image/prepare.ts) for the next change of a later setting:
//!
//! 1. Resample to the working resolution and convert to Lab; smooth photos edge-preservingly
//!    (`smooth`).
//! 2. Quantize to at most `max_colors` colors (`quantize::quantize`).
//! 3. Match threads, apply the user's color changes and brush strokes, remove the background,
//!    clean up the regions (`finish`).

use serde::{Deserialize, Serialize};

use super::color::{Lab, Rgb, delta_e2000, hypot3, lab_to_rgb, rgb_lab, rgb_to_lab};
use super::filters::bilateral;
use super::labels::{distance_to_other, merge_small, mode_filter, remove_background, remove_seams};
use super::orientation::{Orientation, orientation};
use super::quantize::NONE;
use super::raster::{LabImage, Raster, resize_area, to_lab};
use super::thread_match::{Thread, match_threads, nearest_thread};
use crate::js::round;
use crate::pattern::ThreadColor;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareOptions {
    /// Width of the design in mm; the height follows the image's aspect ratio.
    pub width_mm: f64,
    /// Most thread colors (2 to 16).
    pub max_colors: f64,
    /// Smoothing passes for photos (0 = off).
    pub smooth: f64,
    /// Regions below this area (mm²) are merged into their neighbours.
    pub min_area_mm2: f64,
    /// Leave the border-connected background unsewn.
    pub background: bool,
    /// Use the nearest thread colors instead of the image's own colors.
    pub threads: bool,
}

/// A user's change to one color of the quantized image, keyed by the color it was found as.
#[derive(Clone, Debug, Deserialize)]
pub struct ColorEdit {
    /// Color of the cluster as quantized (before thread matching).
    pub from: Rgb,
    /// Not sewn, merged into another color (by its quantized color), or sewn with another thread.
    #[serde(default)]
    pub skip: Option<bool>,
    #[serde(default)]
    pub merge: Option<Rgb>,
    #[serde(default)]
    pub thread: Option<ThreadColor>,
}

/// A brush stroke in image coordinates (0..1 of the width for x, of the height for y).
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Stroke {
    pub points: Vec<[f64; 2]>,
    /// Brush radius as a share of the image width.
    pub radius: f64,
    /// Color painted with, as the `source` of a palette entry; None erases (not sewn).
    pub color: Option<Rgb>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteEntry {
    /// Color shown and sewn.
    pub thread: ThreadColor,
    pub lab: Lab,
    /// Color the cluster was quantized as, the key for color edits; equal to the thread for painted colors.
    pub source: Rgb,
    /// CIEDE2000 between the image color and the thread (0 without thread matching).
    #[serde(rename = "deltaE")]
    pub delta_e: f64,
    /// Area in mm² (also for skipped colors).
    pub area_mm2: f64,
    pub sew: bool,
}

pub struct Finished {
    /// Palette index per pixel, NONE where nothing is sewn.
    pub labels: Vec<u8>,
    pub palette: Vec<PaletteEntry>,
    /// For a vector image: the palette entry each of its exact colors went to, -1 for none.
    pub of_source: Option<Vec<i32>>,
}

/// Working resolution: 0.1 mm per pixel, coarser for designs over 120 mm so the image stays near 1200 px.
pub fn working_px_mm(width_mm: f64, height_mm: f64) -> f64 {
    (width_mm.max(height_mm) / 1200.0).max(0.1)
}

/// Stage 1: the image at w × h in Lab, smoothed with `smooth` passes, and the direction of its own
/// structure, taken before smoothing flattens fur and strands.
pub fn smooth(
    src: &Raster,
    w: usize,
    h: usize,
    px_mm: f64,
    smooth: f64,
) -> (LabImage, Orientation) {
    let mut img = to_lab(&resize_area(src, w, h));
    // Integrated over about 1 mm.
    let orient = orientation(&img, 1.0 / px_mm);
    // 0.4 mm spatial sigma: texture finer than the thread is flattened, edges stay.
    if smooth > 0.0 {
        img = bilateral(&img, round(smooth) as usize, (0.4 / px_mm).max(1.0), 8.0);
    }
    (img, orient)
}

/// Index of the entry whose source color matches `c` (within a small CIEDE2000 tolerance).
fn find_source(palette: &[PaletteEntry], c: Rgb, tolerance: f64) -> Option<usize> {
    // The same color exactly wins (the last such entry, as before).
    if let Some(i) = palette.iter().rposition(|p| p.source == c) {
        return Some(i);
    }
    let lab = rgb_lab(c);
    let mut best = None;
    let mut bd = tolerance;
    for (i, p) in palette.iter().enumerate() {
        let d = delta_e2000(&lab, &rgb_lab(p.source));
        if d < bd {
            bd = d;
            best = Some(i);
        }
    }
    best
}

/// Palette entry each stroke paints with: the entry with the stroke's color as its source, else a new
/// entry (thread matched like the clusters). NONE for erasing.
fn stroke_labels(
    palette: &mut Vec<PaletteEntry>,
    strokes: &[Stroke],
    use_threads: bool,
    threads: &[Thread],
) -> Vec<u8> {
    strokes
        .iter()
        .map(|s| {
            let Some(color) = s.color else { return NONE };
            if let Some(i) = find_source(palette, color, 3.0) {
                return i as u8;
            }
            if palette.len() >= NONE as usize {
                return NONE;
            }
            let lab = rgb_lab(color);
            let near = (use_threads && !threads.is_empty()).then(|| nearest_thread(&lab, threads));
            let thread = match near {
                Some(m) => threads[m.thread].color.clone(),
                None => ThreadColor {
                    r: color[0],
                    g: color[1],
                    b: color[2],
                    ..Default::default()
                },
            };
            palette.push(PaletteEntry {
                lab: rgb_to_lab(thread.r, thread.g, thread.b),
                thread,
                source: color,
                delta_e: near.map_or(0.0, |m| m.delta_e),
                area_mm2: 0.0,
                sew: true,
            });
            (palette.len() - 1) as u8
        })
        .collect()
}

/// Paints the strokes into the label map, each with its label.
fn paint(labels: &mut [u8], w: usize, h: usize, strokes: &[Stroke], label_of: &[u8]) {
    let (wf, hf) = (w as f64, h as f64);
    for (si, s) in strokes.iter().enumerate() {
        let label = label_of[si];
        let r = s.radius * wf;
        let r2 = r * r;
        let mut stamp = |cx: f64, cy: f64| {
            let y0 = (cy - r).floor().max(0.0);
            let y1 = (cy + r).ceil().min(hf - 1.0);
            let x0 = (cx - r).floor().max(0.0);
            let x1 = (cx + r).ceil().min(wf - 1.0);
            let mut y = y0;
            while y <= y1 {
                let mut x = x0;
                while x <= x1 {
                    if (x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy) <= r2 {
                        labels[y as usize * w + x as usize] = label;
                    }
                    x += 1.0;
                }
                y += 1.0;
            }
        };
        for i in 0..s.points.len() {
            let (x1, y1) = (s.points[i][0] * wf, s.points[i][1] * hf);
            let (x0, y0) = if i > 0 {
                (s.points[i - 1][0] * wf, s.points[i - 1][1] * hf)
            } else {
                (x1, y1)
            };
            let steps = ((x1 - x0).hypot(y1 - y0) / (r / 2.0).max(0.5))
                .ceil()
                .max(1.0);
            let mut k = if i > 0 { 1.0 } else { 0.0 };
            while k <= steps {
                stamp(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
                k += 1.0;
            }
        }
    }
}

/// Stage 3: from the quantized colors (`centers`, one label per pixel in `raw`) to the palette and
/// regions that are sewn. `sources` are the exact colors of a vector image (one per center): no
/// anti-aliasing to clean up. `threads` are the threads to match with.
pub fn finish(
    w: usize,
    h: usize,
    px_mm: f64,
    centers: &[Lab],
    raw: &[u8],
    o: &PrepareOptions,
    edits: &[ColorEdit],
    strokes: &[Stroke],
    sources: Option<&[Rgb]>,
    threads: &[Thread],
) -> Finished {
    let exact = sources.is_some();
    // Clusters, then thread matching, all colors together: clusters that land on the same thread
    // (only those too close to tell apart) become one color.
    let mut palette: Vec<PaletteEntry> = Vec::new();
    let mut map = [NONE; 256];
    let use_threads = o.threads && !threads.is_empty();
    let matched = if use_threads {
        let weights = (!exact).then(|| own_share(raw, centers, w, h, px_mm));
        match_threads(centers, weights.as_deref(), threads)
    } else {
        vec![]
    };
    for (k, lab) in centers.iter().enumerate().take(256) {
        let source = sources.map_or_else(|| lab_to_rgb(lab[0], lab[1], lab[2]), |s| s[k]);
        let entry = if use_threads {
            let m = matched[k];
            let thread = &threads[m.thread].color;
            if let Some(same) = palette
                .iter()
                .position(|p| p.thread.pec_index == thread.pec_index)
            {
                map[k] = same as u8;
                continue;
            }
            PaletteEntry {
                thread: thread.clone(),
                lab: rgb_to_lab(thread.r, thread.g, thread.b),
                source,
                delta_e: m.delta_e,
                area_mm2: 0.0,
                sew: true,
            }
        } else {
            PaletteEntry {
                thread: ThreadColor {
                    r: source[0],
                    g: source[1],
                    b: source[2],
                    ..Default::default()
                },
                lab: *lab,
                source,
                delta_e: 0.0,
                area_mm2: 0.0,
                sew: true,
            }
        };
        map[k] = palette.len() as u8;
        palette.push(entry);
    }

    // Painted colors join the palette before the color changes, so those apply to them as well.
    let painted = stroke_labels(&mut palette, strokes, use_threads, threads);

    // The user's color changes: another thread, merging, skipping.
    let mut merged = [NONE; 256];
    for e in edits {
        let Some(i) = find_source(&palette, e.from, 8.0) else {
            continue;
        };
        if let Some(t) = &e.thread {
            let p = &mut palette[i];
            p.thread = t.clone();
            p.lab = rgb_to_lab(t.r, t.g, t.b);
            p.delta_e = delta_e2000(&rgb_lab(p.source), &p.lab);
        }
        if let Some(m) = e.merge
            && let Some(j) = find_source(&palette, m, 8.0)
            && j != i
        {
            merged[i] = j as u8;
        }
        if e.skip == Some(true) {
            palette[i].sew = false;
        }
    }
    let resolve = |mut k: u8| {
        let mut guard = 0;
        while guard < 16 && merged[k as usize] != NONE {
            k = merged[k as usize];
            guard += 1;
        }
        k
    };

    let mut labels: Vec<u8> = raw
        .iter()
        .map(|&l| {
            if l == NONE {
                NONE
            } else {
                resolve(map[l as usize])
            }
        })
        .collect();

    // Painted strokes count before the cleanup (so regions form around them) and after it (so they win).
    let paint_labels: Vec<u8> = painted
        .iter()
        .map(|&l| if l == NONE { NONE } else { resolve(l) })
        .collect();
    paint(&mut labels, w, h, strokes, &paint_labels);
    // Exact regions have neither jagged edges nor seams; the filters would only eat fine lines.
    if !exact {
        labels = mode_filter(&labels, w, h);
        // Judged by the image's own colors: a seam between two threads need not lie between them (a dark
        // orange edge matched to a dark brown thread), but it does between the colors it blends.
        let image_lab: Vec<Lab> = palette.iter().map(|p| rgb_lab(p.source)).collect();
        labels = without_seams(&labels, w, h, px_mm, &image_lab);
    }
    // After the seams, so the seams along the background's edge go too.
    if o.background {
        labels = remove_background(&labels, w, h);
    }
    // In mm at the size sewn (the image is worked at that size), so it follows the width. Long narrow
    // details stay whatever their area.
    labels = merge_small(
        &labels,
        w,
        h,
        (o.min_area_mm2 / (px_mm * px_mm)).max(1.0),
        Some(px_mm),
    );
    if !exact {
        labels = mode_filter(&labels, w, h);
    }
    if !strokes.is_empty() {
        paint(&mut labels, w, h, strokes, &paint_labels);
    }

    // Areas, then the colors that are not sewn.
    let mut counts = vec![0usize; palette.len()];
    for &l in &labels {
        if let Some(c) = counts.get_mut(l as usize) {
            *c += 1;
        }
    }
    for (p, &c) in palette.iter_mut().zip(&counts) {
        p.area_mm2 = c as f64 * px_mm * px_mm;
    }
    for l in labels.iter_mut() {
        if palette.get(*l as usize).is_some_and(|p| !p.sew) {
            *l = NONE;
        }
    }

    // Drop colors without pixels, unless the user skipped them (they stay listed to switch them back on).
    let mut index = [NONE; 256];
    let mut kept = Vec::with_capacity(palette.len());
    for (i, p) in palette.into_iter().enumerate() {
        if counts[i] > 0 || !p.sew {
            index[i] = kept.len() as u8;
            kept.push(p);
        }
    }
    for l in labels.iter_mut() {
        if *l != NONE {
            *l = index[*l as usize];
        }
    }
    let of_source = sources.map(|s| {
        (0..s.len())
            .map(|k| {
                let m = map.get(k).copied().unwrap_or(NONE);
                if m == NONE {
                    return -1;
                }
                let i = index[resolve(m) as usize];
                if i == NONE { -1 } else { i as i32 }
            })
            .collect()
    });
    Finished {
        labels,
        palette: kept,
        of_source,
    }
}

/// Seams of anti-aliasing: at most 0.5 mm wide, colored between their two neighbours.
fn without_seams(labels: &[u8], w: usize, h: usize, px_mm: f64, image_lab: &[Lab]) -> Vec<u8> {
    let lab_of = |k: u8| {
        if k == NONE {
            None
        } else {
            image_lab.get(k as usize)
        }
    };
    remove_seams(labels, w, h, 0.5 / px_mm, |s, a, b| {
        match (lab_of(s), lab_of(a), lab_of(b)) {
            (Some(ls), Some(la), Some(lb)) => distance_to_segment(ls, la, lb) < 12.0,
            _ => false,
        }
    })
}

/// How much of each cluster is a color of the image's own (0 to 1) rather than the blend along an
/// edge between two others: a cluster colored between two others counts by the share of its pixels
/// more than half the seam width (0.25 mm) from any other cluster, so a thin band along an edge
/// hardly counts, a small area like an eye fully. A cluster of a color of its own always counts.
fn own_share(raw: &[u8], centers: &[Lab], w: usize, h: usize, px_mm: f64) -> Vec<f64> {
    let n = centers.len();
    let between: Vec<bool> = centers
        .iter()
        .enumerate()
        .map(|(k, c)| {
            (0..n).any(|i| {
                i != k
                    && (i + 1..n)
                        .any(|j| j != k && distance_to_segment(c, &centers[i], &centers[j]) < 12.0)
            })
        })
        .collect();
    if !between.iter().any(|&b| b) {
        return vec![1.0; n];
    }
    let dist = distance_to_other(raw, w, h);
    let half = 0.25 / px_mm;
    let mut all = vec![0u32; n];
    let mut core = vec![0u32; n];
    for (i, &l) in raw.iter().enumerate() {
        let l = l as usize;
        if l == NONE as usize || l >= n {
            continue;
        }
        all[l] += 1;
        if dist[i] as f64 > half {
            core[l] += 1;
        }
    }
    (0..n)
        .map(|k| {
            if !between[k] {
                1.0
            } else if all[k] > 0 {
                core[k] as f64 / all[k] as f64
            } else {
                0.0
            }
        })
        .collect()
}

/// Euclidean distance in Lab from p to the segment a-b.
fn distance_to_segment(p: &Lab, a: &Lab, b: &Lab) -> f64 {
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    let l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    let t = if l2 > 0.0 {
        ((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    hypot3(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::quantize::quantize;
    use crate::image::thread_match::threads_of;

    /// The working image's size for a source of `src_w` × `src_h`, as the app picks it.
    fn working_size(width_mm: f64, src_w: usize, src_h: usize) -> (usize, usize, f64) {
        let height_mm = (width_mm * src_h as f64) / src_w as f64;
        let px_mm = working_px_mm(width_mm, height_mm);
        (
            round(width_mm / px_mm).max(1.0) as usize,
            round(height_mm / px_mm).max(1.0) as usize,
            px_mm,
        )
    }

    fn options() -> PrepareOptions {
        PrepareOptions {
            width_mm: 20.0,
            max_colors: 6.0,
            smooth: 0.0,
            min_area_mm2: 3.0,
            background: true,
            threads: true,
        }
    }

    fn threads() -> Vec<Thread> {
        let c = |r, g, b, i| ThreadColor {
            r,
            g,
            b,
            pec_index: Some(i),
            ..Default::default()
        };
        threads_of(vec![
            c(0, 0, 0, 1),
            c(240, 240, 240, 2),
            c(237, 23, 31, 3),
            c(10, 85, 163, 4),
        ])
    }

    /// A red disc and a blue square on white, anti-aliased by a 2 x 2 box.
    fn picture(w: usize, h: usize) -> Raster {
        let mut data = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let mut acc = [0u32; 3];
                for s in 0..4 {
                    let (px, py) = (
                        x as f64 + 0.25 + 0.5 * (s % 2) as f64,
                        y as f64 + 0.25 + 0.5 * (s / 2) as f64,
                    );
                    let c = if (px - 50.0).hypot(py - 50.0) < 25.0 {
                        [220, 30, 40]
                    } else if (120.0..170.0).contains(&px) && (30.0..80.0).contains(&py) {
                        [20, 60, 170]
                    } else {
                        [255, 255, 255]
                    };
                    for k in 0..3 {
                        acc[k] += c[k];
                    }
                }
                data.extend_from_slice(&[
                    (acc[0] / 4) as u8,
                    (acc[1] / 4) as u8,
                    (acc[2] / 4) as u8,
                    255,
                ]);
            }
        }
        Raster {
            width: w,
            height: h,
            data,
        }
    }

    #[test]
    fn a_picture_becomes_two_threads_without_background() {
        let src = picture(200, 100);
        let o = options();
        let (w, h, px_mm) = working_size(o.width_mm, src.width, src.height);
        let (img, _) = smooth(&src, w, h, px_mm, o.smooth);
        let q = quantize(&img, o.max_colors, None);
        let t = threads();
        let f = finish(w, h, px_mm, &q.centers, &q.labels, &o, &[], &[], None, &t);
        let pec: Vec<Option<u32>> = f.palette.iter().map(|p| p.thread.pec_index).collect();
        assert_eq!(pec.len(), 2, "{pec:?}");
        assert!(pec.contains(&Some(3)) && pec.contains(&Some(4)));
        assert_eq!(f.labels[0], NONE);
        let total: f64 = f.palette.iter().map(|p| p.area_mm2).sum();
        // The disc (r = 2.5 mm) and the square (5 mm) cover about 44.6 mm².
        assert!((total - 44.6).abs() < 2.0, "{total}");
    }

    #[test]
    fn skipping_and_painting() {
        let src = picture(200, 100);
        let o = options();
        let (w, h, px_mm) = working_size(o.width_mm, src.width, src.height);
        let (img, _) = smooth(&src, w, h, px_mm, 0.0);
        let q = quantize(&img, o.max_colors, None);
        let t = threads();
        let red = q
            .centers
            .iter()
            .map(|c| lab_to_rgb(c[0], c[1], c[2]))
            .find(|c| c[0] > 150 && c[1] < 100)
            .unwrap();
        let edits = [ColorEdit {
            from: red,
            skip: Some(true),
            merge: None,
            thread: None,
        }];
        let strokes = [Stroke {
            points: vec![[0.1, 0.9], [0.3, 0.9]],
            radius: 0.02,
            color: Some([0, 0, 0]),
        }];
        let f = finish(
            w, h, px_mm, &q.centers, &q.labels, &o, &edits, &strokes, None, &t,
        );
        let red_entry = f
            .palette
            .iter()
            .position(|p| p.thread.pec_index == Some(3))
            .unwrap();
        assert!(!f.palette[red_entry].sew);
        assert!(!f.labels.contains(&(red_entry as u8)));
        let black = f
            .palette
            .iter()
            .position(|p| p.thread.pec_index == Some(1))
            .unwrap() as u8;
        assert_eq!(f.labels[(h * 9 / 10) * w + w / 5], black);
    }

    #[test]
    fn working_size_follows_the_width() {
        assert_eq!(working_size(80.0, 400, 200), (800, 400, 0.1));
        let (w, h, px) = working_size(240.0, 1000, 1000);
        assert_eq!((w, h), (1200, 1200));
        assert!((px - 0.2).abs() < 1e-12);
    }
}
