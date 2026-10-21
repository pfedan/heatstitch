//! Edge-preserving smoothing for photos, and telling photos from graphics.

use std::collections::HashMap;

use super::raster::{LabImage, Raster};

/// Edge-preserving smoothing for photos: a bilateral filter (Tomasi & Manduchi 1998) in Lab,
/// applied separably along rows and columns and iterated, as in real-time video abstraction
/// (Winnemöller, Olsen & Gooch 2006). Each pass averages over neighbours of similar color only,
/// so texture and noise flatten into regions while the edges between regions stay sharp.
///
/// `sigma_s` is the spatial sigma in pixels, `sigma_r` the range sigma in Lab units.
pub fn bilateral(img: &LabImage, iterations: usize, sigma_s: f64, sigma_r: f64) -> LabImage {
    let (w, h, opaque) = (img.width, img.height, &img.opaque);
    let mut src = img.lab.clone();
    let mut dst = vec![0f32; src.len()];
    let r = (2.0 * sigma_s).ceil().max(1.0) as i64;
    let spatial: Vec<f32> = (0..=2 * r)
        .map(|k| {
            let d = (k - r) as f64;
            (-(d * d) / (2.0 * sigma_s * sigma_s)).exp() as f32
        })
        .collect();
    // Range weights from a table: the exponential dominates the cost otherwise.
    let max_d2 = 9.0 * sigma_r * sigma_r;
    const LUT_SIZE: usize = 1024;
    let lut_scale = LUT_SIZE as f64 / max_d2;
    let lut: Vec<f32> = (0..LUT_SIZE)
        .map(|k| (-(k as f64 / lut_scale) / (2.0 * sigma_r * sigma_r)).exp() as f32)
        .collect();
    let (wi, hi) = (w as i64, h as i64);
    for _ in 0..iterations {
        for horizontal in [true, false] {
            for y in 0..hi {
                for x in 0..wi {
                    let i = (y * wi + x) as usize;
                    let (l, a, b) = (
                        src[i * 3] as f64,
                        src[i * 3 + 1] as f64,
                        src[i * 3 + 2] as f64,
                    );
                    if opaque[i] == 0 {
                        dst[i * 3..i * 3 + 3].copy_from_slice(&src[i * 3..i * 3 + 3]);
                        continue;
                    }
                    let (mut sl, mut sa, mut sb, mut sw) = (0.0, 0.0, 0.0, 0.0);
                    for k in -r..=r {
                        let (qx, qy) = if horizontal { (x + k, y) } else { (x, y + k) };
                        if qx < 0 || qy < 0 || qx >= wi || qy >= hi {
                            continue;
                        }
                        let q = (qy * wi + qx) as usize;
                        if opaque[q] == 0 {
                            continue;
                        }
                        let (ql, qa, qb) = (
                            src[q * 3] as f64,
                            src[q * 3 + 1] as f64,
                            src[q * 3 + 2] as f64,
                        );
                        let d2 = (ql - l) * (ql - l) + (qa - a) * (qa - a) + (qb - b) * (qb - b);
                        if d2 >= max_d2 {
                            continue;
                        }
                        let wt = spatial[(k + r) as usize] as f64
                            * lut[(d2 * lut_scale) as usize] as f64;
                        sl += ql * wt;
                        sa += qa * wt;
                        sb += qb * wt;
                        sw += wt;
                    }
                    dst[i * 3] = (sl / sw) as f32;
                    dst[i * 3 + 1] = (sa / sw) as f32;
                    dst[i * 3 + 2] = (sb / sw) as f32;
                }
            }
            std::mem::swap(&mut src, &mut dst);
        }
    }
    LabImage {
        width: w,
        height: h,
        lab: src,
        opaque: img.opaque.clone(),
    }
}

/// Photo or graphic: in logos and clip art a few exact colors cover almost every pixel; in photos
/// no small set does. Used to suggest how much to smooth.
pub fn looks_like_photo(src: &Raster) -> bool {
    let mut counts: HashMap<u32, u32> = HashMap::new();
    let mut opaque = 0u32;
    for p in src.data.chunks_exact(4) {
        if p[3] < 128 {
            continue;
        }
        opaque += 1;
        *counts
            .entry(((p[0] as u32) << 16) | ((p[1] as u32) << 8) | p[2] as u32)
            .or_insert(0) += 1;
    }
    if opaque == 0 {
        return false;
    }
    let mut top: Vec<u32> = counts.into_values().collect();
    top.sort_unstable_by(|a, b| b.cmp(a));
    let sum: u32 = top.iter().take(16).sum();
    (sum as f64) / (opaque as f64) < 0.85
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_an_edge_and_flattens_noise() {
        let (w, h) = (20, 1);
        let mut lab = vec![0f32; w * 3];
        for x in 0..w {
            lab[x * 3] = if x < 10 { 20.0 } else { 80.0 } + if x % 2 == 0 { 1.0 } else { -1.0 };
        }
        let img = LabImage {
            width: w,
            height: h,
            lab,
            opaque: vec![1; w],
        };
        let out = bilateral(&img, 3, 2.0, 8.0);
        assert!((out.lab[5 * 3] - 20.0).abs() < 0.5);
        assert!((out.lab[14 * 3] - 80.0).abs() < 0.5);
        assert!(out.lab[9 * 3] < 25.0 && out.lab[10 * 3] > 75.0);
    }

    #[test]
    fn photo_or_graphic() {
        let flat = Raster {
            width: 4,
            height: 4,
            data: [10, 20, 30, 255].repeat(16),
        };
        assert!(!looks_like_photo(&flat));
        let mut data = Vec::new();
        for i in 0..400u32 {
            data.extend_from_slice(&[(i * 7) as u8, (i * 13) as u8, (i * 29) as u8, 255]);
        }
        assert!(looks_like_photo(&Raster {
            width: 20,
            height: 20,
            data
        }));
    }
}
