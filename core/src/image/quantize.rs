//! Color quantization for embroidery: few colors, flat regions, no dithering.
//!
//! Weighted k-means on a Lab histogram, which Celebi ("Improving the performance of k-means for
//! color quantization", Image Vis. Comput. 29(4), 2011) found the most effective and among the
//! fastest methods; unlike Wu or median cut alone it keeps small but distinct regions (his example:
//! the whites of the eyes). Pixels are weighted by a simple saliency term (local contrast and
//! chroma), so small accents get a cluster of their own. The number of colors is the user's maximum,
//! reduced while two clusters are nearly the same color or a tiny cluster is not distinctive.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

use super::color::{Lab, Rgb, delta_e2000, hypot3, js_round, rgb_lab};
use super::raster::{ALPHA_MIN, LabImage, Raster};

/// Pixels that are not quantized (transparent).
pub const NONE: u8 = 255;

/// A fast hash for integer keys (the multiply-rotate of rustc's FxHasher): the maps here are keyed
/// by colors and component pairs, and the default hasher would dominate their cost.
#[derive(Default)]
pub struct Fx(u64);

impl Hasher for Fx {
    fn finish(&self) -> u64 {
        // The product's high bits depend on all of the key; the table picks buckets by the low ones.
        self.0.rotate_left(26)
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u64(b as u64);
        }
    }
    fn write_u64(&mut self, v: u64) {
        self.0 = (self.0.rotate_left(5) ^ v).wrapping_mul(0x517c_c1b7_2722_0a95);
    }
    fn write_u32(&mut self, v: u32) {
        self.write_u64(v as u64);
    }
    fn write_i64(&mut self, v: i64) {
        self.write_u64(v as u64);
    }
}

pub type FastMap<K, V> = HashMap<K, V, BuildHasherDefault<Fx>>;

pub struct Quantized {
    pub centers: Vec<Lab>,
    /// Cluster per pixel, NONE for transparent pixels.
    pub labels: Vec<u8>,
}

/// Clusters closer than this (CIEDE2000) are one color.
const MERGE_DE: f64 = 6.0;
/// Clusters below this share of the pixels are dropped unless they are distinctive.
const MIN_SHARE: f64 = 0.004;
/// A small cluster this far from every other one is an accent worth keeping.
const ACCENT_DE: f64 = 22.0;
/// Weight of the saliency term (1 + ALPHA * saliency per pixel).
const ALPHA: f64 = 3.0;

#[derive(Clone, Copy, Default)]
struct Bin {
    l: f64,
    a: f64,
    b: f64,
    w: f64,
    /// Pixel count, for the share of each cluster.
    n: u32,
}

/// Local contrast against a 7 x 7 box mean, plus chroma; 0 to 1.
fn saliency(img: &LabImage) -> Vec<f32> {
    let (w, h, lab) = (img.width, img.height, &img.lab);
    let r = 3usize;
    // Separable box mean of the three channels.
    let mut tmp = vec![0f32; lab.len()];
    let mut mean = vec![0f32; lab.len()];
    for y in 0..h {
        for x in 0..w {
            let x0 = x.saturating_sub(r);
            let x1 = (x + r).min(w - 1);
            for c in 0..3 {
                let mut s = 0.0;
                for k in x0..=x1 {
                    s += lab[(y * w + k) * 3 + c] as f64;
                }
                tmp[(y * w + x) * 3 + c] = (s / (x1 - x0 + 1) as f64) as f32;
            }
        }
    }
    for y in 0..h {
        let y0 = y.saturating_sub(r);
        let y1 = (y + r).min(h - 1);
        for x in 0..w {
            for c in 0..3 {
                let mut s = 0.0;
                for k in y0..=y1 {
                    s += tmp[(k * w + x) * 3 + c] as f64;
                }
                mean[(y * w + x) * 3 + c] = (s / (y1 - y0 + 1) as f64) as f32;
            }
        }
    }
    (0..w * h)
        .map(|i| {
            let at = |k: usize| lab[i * 3 + k] as f64 - mean[i * 3 + k] as f64;
            let d = hypot3(at(0), at(1), at(2));
            let chroma = (lab[i * 3 + 1] as f64).hypot(lab[i * 3 + 2] as f64);
            (d / 25.0 + 0.3 * (chroma / 60.0).min(1.0)).min(1.0) as f32
        })
        .collect()
}

/// Weighted bins in the order their first pixel comes.
fn histogram(img: &LabImage) -> Vec<Bin> {
    let (lab, opaque) = (&img.lab, &img.opaque);
    let sal = saliency(img);
    let mut index: FastMap<i64, usize> = FastMap::default();
    let mut bins: Vec<Bin> = Vec::new();
    for i in 0..opaque.len() {
        if opaque[i] == 0 {
            continue;
        }
        let (l, a, b) = (
            lab[i * 3] as f64,
            lab[i * 3 + 1] as f64,
            lab[i * 3 + 2] as f64,
        );
        // 3 units of lightness, 4 of a and b: below what a thread palette can tell apart.
        let key = ((js_round(l / 3.0) * 128.0 + js_round(a / 4.0) + 64.0) * 128.0
            + js_round(b / 4.0)
            + 64.0) as i64;
        let wt = 1.0 + ALPHA * sal[i] as f64;
        let k = *index.entry(key).or_insert_with(|| {
            bins.push(Bin::default());
            bins.len() - 1
        });
        let bin = &mut bins[k];
        bin.l += l * wt;
        bin.a += a * wt;
        bin.b += b * wt;
        bin.w += wt;
        bin.n += 1;
    }
    for b in &mut bins {
        b.l /= b.w;
        b.a /= b.w;
        b.b /= b.w;
    }
    bins
}

fn d2(b: &Bin, c: &Lab) -> f64 {
    (b.l - c[0]) * (b.l - c[0]) + (b.a - c[1]) * (b.a - c[1]) + (b.b - c[2]) * (b.b - c[2])
}

fn nearest(b: &Bin, centers: &[Lab]) -> usize {
    let mut best = 0;
    let mut bd = f64::INFINITY;
    for (k, c) in centers.iter().enumerate() {
        let d = d2(b, c);
        if d < bd {
            bd = d;
            best = k;
        }
    }
    best
}

/// Lloyd iterations on the weighted bins; empty clusters are removed.
fn lloyd(bins: &[Bin], mut centers: Vec<Lab>, iterations: usize) -> Vec<Lab> {
    for _ in 0..iterations {
        let mut sum = vec![[0.0f64; 4]; centers.len()];
        for b in bins {
            let s = &mut sum[nearest(b, &centers)];
            s[0] += b.l * b.w;
            s[1] += b.a * b.w;
            s[2] += b.b * b.w;
            s[3] += b.w;
        }
        let mut moved = 0f64;
        let mut next = Vec::with_capacity(centers.len());
        for (k, s) in sum.iter().enumerate() {
            if s[3] <= 0.0 {
                continue;
            }
            let c = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
            moved = moved.max(hypot3(
                c[0] - centers[k][0],
                c[1] - centers[k][1],
                c[2] - centers[k][2],
            ));
            next.push(c);
        }
        centers = next;
        if moved < 0.05 {
            break;
        }
    }
    centers
}

/// Deterministic seeding in the spirit of k-means++: start with the heaviest bin, then repeatedly
/// take the bin with the largest weight times squared distance to its nearest seed.
fn seed(bins: &[Bin], k: usize) -> Vec<Lab> {
    let mut first = &bins[0];
    for b in bins {
        if b.w > first.w {
            first = b;
        }
    }
    let mut centers = vec![[first.l, first.a, first.b]];
    let mut dist: Vec<f64> = bins.iter().map(|b| d2(b, &centers[0])).collect();
    while centers.len() < k {
        let mut best = None;
        let mut bs = 0.0;
        for (i, b) in bins.iter().enumerate() {
            let s = b.w * dist[i];
            if s > bs {
                bs = s;
                best = Some(i);
            }
        }
        let Some(best) = best else { break };
        let c = [bins[best].l, bins[best].a, bins[best].b];
        centers.push(c);
        for (i, b) in bins.iter().enumerate() {
            dist[i] = dist[i].min(d2(b, &c));
        }
    }
    centers
}

/// Pixel share per cluster.
fn shares(bins: &[Bin], centers: &[Lab]) -> Vec<f64> {
    let mut n = vec![0f64; centers.len()];
    let mut total = 0f64;
    for b in bins {
        n[nearest(b, centers)] += b.n as f64;
        total += b.n as f64;
    }
    n.iter().map(|v| v / total.max(1.0)).collect()
}

/// Merges near-identical clusters and drops tiny ones that are not distinctive.
fn reduce(bins: &[Bin], mut centers: Vec<Lab>) -> Vec<Lab> {
    let mut guard = 0;
    while guard < 32 && centers.len() > 1 {
        guard += 1;
        let share = shares(bins, &centers);
        let (mut mi, mut mj, mut md) = (0, 0, f64::INFINITY);
        for i in 0..centers.len() {
            for j in i + 1..centers.len() {
                let d = delta_e2000(&centers[i], &centers[j]);
                if d < md {
                    md = d;
                    mi = i;
                    mj = j;
                }
            }
        }
        if md < MERGE_DE {
            let (wi, wj) = (share[mi], share[mj]);
            let t = if wi + wj > 0.0 { wj / (wi + wj) } else { 0.5 };
            let (a, b) = (centers[mi], centers[mj]);
            let c: Lab = std::array::from_fn(|k| a[k] + (b[k] - a[k]) * t);
            let mut next: Vec<Lab> = centers
                .iter()
                .enumerate()
                .filter(|&(k, _)| k != mi && k != mj)
                .map(|(_, c)| *c)
                .collect();
            next.push(c);
            centers = lloyd(bins, next, 3);
            continue;
        }
        let mut drop: Option<usize> = None;
        for i in 0..centers.len() {
            if share[i] >= MIN_SHARE || drop.is_some_and(|d| share[i] >= share[d]) {
                continue;
            }
            let distinct = centers
                .iter()
                .enumerate()
                .all(|(j, c)| j == i || delta_e2000(c, &centers[i]) > ACCENT_DE);
            if !distinct {
                drop = Some(i);
            }
        }
        let Some(drop) = drop else { break };
        let next = centers
            .iter()
            .enumerate()
            .filter(|&(k, _)| k != drop)
            .map(|(_, c)| *c)
            .collect();
        centers = lloyd(bins, next, 3);
    }
    centers
}

/// Index of the nearest center per pixel (Euclidean in Lab).
pub fn assign(img: &LabImage, centers: &[Lab]) -> Vec<u8> {
    let (lab, opaque) = (&img.lab, &img.opaque);
    let mut out = vec![NONE; opaque.len()];
    for i in 0..opaque.len() {
        if opaque[i] == 0 {
            continue;
        }
        let (l, a, b) = (
            lab[i * 3] as f64,
            lab[i * 3 + 1] as f64,
            lab[i * 3 + 2] as f64,
        );
        let mut best = 0;
        let mut bd = f64::INFINITY;
        for (k, c) in centers.iter().enumerate() {
            let d = (l - c[0]) * (l - c[0]) + (a - c[1]) * (a - c[1]) + (b - c[2]) * (b - c[2]);
            if d < bd {
                bd = d;
                best = k;
            }
        }
        out[i] = best as u8;
    }
    out
}

/// At most `max_colors` (2 to 16) colors; the exact colors of a graphic (see `graphic_palette`) are
/// taken as they are when there are no more than `max_colors`.
pub fn quantize(img: &LabImage, max_colors: f64, palette: Option<&[Lab]>) -> Quantized {
    if let Some(p) = palette.filter(|p| !p.is_empty() && p.len() as f64 <= max_colors) {
        return Quantized {
            centers: p.to_vec(),
            labels: assign(img, p),
        };
    }
    let bins = histogram(img);
    if bins.is_empty() {
        return Quantized {
            centers: vec![],
            labels: vec![NONE; img.opaque.len()],
        };
    }
    let k = (js_round(max_colors)
        .min(16.0)
        .min(bins.len() as f64)
        .max(1.0)) as usize;
    let centers = reduce(&bins, lloyd(&bins, seed(&bins, k), 30));
    let labels = assign(img, &centers);
    Quantized { centers, labels }
}

/// Most colors a graphic can have of its own; with more it is quantized like a photo.
pub const MAX_OWN_COLORS: usize = 16;
/// A color covering less of a graphic than this share (or than MIN_OWN_PX pixels) is noise.
const MIN_OWN_SHARE: f64 = 1e-4;
const MIN_OWN_PX: f64 = 12.0;
/// Pixels of a color with all four neighbours the same: from this share on the color fills areas.
const SOLID: f64 = 0.2;
/// A color this close (sRGB units) to the line between two others is their blend along an edge.
const BLEND_RGB: f64 = 3.0;

/// The colors a flat graphic (a logo, clip art, a drawing; not a photo) is drawn in, exactly, or
/// None for a photo. A graphic is made of a few exact colors plus the blends anti-aliasing puts along
/// its edges. Every color that fills areas of its own counts (it has inner pixels); a color without
/// any (a fine line, a thin ring) counts unless it lies between two counted colors, as the blends do.
/// So a fine accent keeps its color, where clustering by area would fold it into its neighbour.
pub fn graphic_palette(src: &Raster) -> Option<Vec<Rgb>> {
    let (w, h, d) = (src.width, src.height, &src.data);
    // Per color in the order first seen: key, pixel count, inner pixels.
    let mut index: FastMap<u32, usize> = FastMap::default();
    let mut stat: Vec<(u32, u32, u32)> = Vec::new();
    let mut opaque = 0u32;
    let key_at = |i: usize| -> i64 {
        if d[i * 4 + 3] >= ALPHA_MIN {
            (((d[i * 4] as u32) << 16) | ((d[i * 4 + 1] as u32) << 8) | d[i * 4 + 2] as u32) as i64
        } else {
            -1
        }
    };
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let k = key_at(i);
            if k < 0 {
                continue;
            }
            opaque += 1;
            let at = *index.entry(k as u32).or_insert_with(|| {
                stat.push((k as u32, 0, 0));
                stat.len() - 1
            });
            stat[at].1 += 1;
            if x > 0
                && x + 1 < w
                && y > 0
                && y + 1 < h
                && key_at(i - 1) == k
                && key_at(i + 1) == k
                && key_at(i - w) == k
                && key_at(i + w) == k
            {
                stat[at].2 += 1;
            }
        }
    }
    if opaque == 0 {
        return None;
    }
    stat.sort_by_key(|s| std::cmp::Reverse(s.1));
    // A photo: its most frequent colors cover little of it (as looks_like_photo tells).
    let top: u32 = stat.iter().take(MAX_OWN_COLORS).map(|s| s.1).sum();
    if (top as f64) < 0.85 * opaque as f64 {
        return None;
    }
    let rgb = |k: u32| -> Rgb { [(k >> 16) as u8, (k >> 8) as u8, k as u8] };
    let min = MIN_OWN_PX.max(MIN_OWN_SHARE * opaque as f64);
    let found: Vec<&(u32, u32, u32)> = stat.iter().filter(|s| s.1 as f64 >= min).collect();
    let mut own: Vec<Rgb> = Vec::new();
    let add = |own: &mut Vec<Rgb>, c: Rgb, solid: bool| {
        // Near-identical colors (JPEG noise, a slightly different shade) are one. Of a fine line the
        // most frequent shade can be a blend that hardly differs from its own color: the line's color,
        // with the blend between it and its neighbour, takes its place.
        let lab = rgb_lab(c);
        match own
            .iter()
            .position(|o| delta_e2000(&rgb_lab(*o), &lab) < MERGE_DE)
        {
            None => own.push(c),
            Some(same) => {
                let mut others: Vec<Rgb> = own
                    .iter()
                    .enumerate()
                    .filter(|&(k, _)| k != same)
                    .map(|(_, o)| *o)
                    .collect();
                others.push(c);
                if !solid && is_blend(own[same], &others) {
                    own[same] = c;
                }
            }
        }
    };
    for s in &found {
        if s.2 as f64 >= SOLID * s.1 as f64 {
            add(&mut own, rgb(s.0), true);
        }
    }
    for s in &found {
        if (s.2 as f64) < SOLID * s.1 as f64 && !is_blend(rgb(s.0), &own) {
            add(&mut own, rgb(s.0), false);
        }
    }
    (!own.is_empty() && own.len() <= MAX_OWN_COLORS).then_some(own)
}

/// Whether `c` lies between two of `colors`, as an edge pixel blending them does.
fn is_blend(c: Rgb, colors: &[Rgb]) -> bool {
    let c = c.map(|v| v as f64);
    for i in 0..colors.len() {
        for j in i + 1..colors.len() {
            let a = colors[i].map(|v| v as f64);
            let b = colors[j].map(|v| v as f64);
            let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
            if l2 == 0.0 {
                continue;
            }
            let t = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / l2;
            if t <= 0.0 || t >= 1.0 {
                continue;
            }
            if hypot3(
                c[0] - a[0] - t * ab[0],
                c[1] - a[1] - t * ab[1],
                c[2] - a[2] - t * ab[2],
            ) <= BLEND_RGB
            {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::raster::to_lab;

    fn raster(w: usize, h: usize, at: impl Fn(usize, usize) -> [u8; 4]) -> Raster {
        let mut data = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                data.extend_from_slice(&at(x, y));
            }
        }
        Raster {
            width: w,
            height: h,
            data,
        }
    }

    const RED: [u8; 4] = [220, 30, 40, 255];
    const BLUE: [u8; 4] = [20, 60, 170, 255];
    const WHITE: [u8; 4] = [255, 255, 255, 255];

    #[test]
    fn two_colors_and_a_small_accent() {
        let img = raster(60, 60, |x, y| {
            if (28..32).contains(&x) && (28..32).contains(&y) {
                BLUE
            } else if x < 30 {
                RED
            } else {
                WHITE
            }
        });
        let q = quantize(&to_lab(&img), 8.0, None);
        assert_eq!(q.centers.len(), 3);
        let blue = rgb_lab([20, 60, 170]);
        assert!(q.centers.iter().any(|c| delta_e2000(c, &blue) < 5.0));
    }

    #[test]
    fn graphic_keeps_its_exact_colors_and_skips_blends() {
        // Red and white halves with a blended column between them.
        let img = raster(40, 40, |x, _| match x {
            0..20 => RED,
            20 => [238, 143, 148, 255],
            _ => WHITE,
        });
        let p = graphic_palette(&img).unwrap();
        assert_eq!(p, vec![[220, 30, 40], [255, 255, 255]]);
    }

    #[test]
    fn photo_has_no_palette() {
        let img = raster(30, 30, |x, y| {
            [(x * 8) as u8, (y * 8) as u8, ((x * y) % 256) as u8, 255]
        });
        assert!(graphic_palette(&img).is_none());
    }

    #[test]
    fn transparent_stays_none() {
        let img = raster(4, 4, |x, _| if x < 2 { [0, 0, 0, 0] } else { RED });
        let q = quantize(&to_lab(&img), 4.0, None);
        assert_eq!(q.labels[0], NONE);
        assert_eq!(q.labels[3], 0);
    }
}
