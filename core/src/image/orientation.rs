//! Local direction of the image's own structure: hair, fur, grain, the strokes of a drawing. The
//! structure tensor (the smoothed outer product of the gradient; Förstner & Gülch 1987, Bigün &
//! Granlund 1987) has its main eigenvector across edges; the direction along them is the one that
//! stitches should follow, as in coherence-enhancing and flow-based image abstraction (Weickert
//! 1999; Kang, Lee & Chui, "Coherent Line Drawing", 2007).
//!
//! The result is a line field (directions without a sign) in the doubled-angle form: per pixel
//! (cos 2θ, sin 2θ) of the direction along the structure, scaled by its coherence (0 to 1).
//! Doubled angles can be averaged and smoothed directly.

use super::raster::LabImage;
use crate::js::round;

pub struct Orientation {
    pub width: usize,
    pub height: usize,
    /// Coherence times cos 2θ, sin 2θ of the direction along the structure (y down).
    pub c: Vec<f32>,
    pub s: Vec<f32>,
}

/// Separable box blur, repeated three times (close to a Gaussian of sigma ≈ r).
fn blur(f: &[f32], w: usize, h: usize, r: i64) -> Vec<f32> {
    let (wi, hi) = (w as i64, h as i64);
    let n = 2.0 * r as f64 + 1.0;
    let mut src = f.to_vec();
    let mut tmp = vec![0f32; f.len()];
    let mut dst = vec![0f32; f.len()];
    let cx = |x: i64| x.clamp(0, wi - 1) as usize;
    let cy = |y: i64| y.clamp(0, hi - 1) as usize;
    for _ in 0..3 {
        for y in 0..h {
            let row = y * w;
            let mut acc = 0f64;
            for x in -r..=r {
                acc += src[row + cx(x)] as f64;
            }
            for x in 0..wi {
                tmp[row + x as usize] = (acc / n) as f32;
                acc += src[row + cx(x + r + 1)] as f64 - src[row + cx(x - r)] as f64;
            }
        }
        for x in 0..w {
            let mut acc = 0f64;
            for y in -r..=r {
                acc += tmp[cy(y) * w + x] as f64;
            }
            for y in 0..hi {
                dst[y as usize * w + x] = (acc / n) as f32;
                acc += tmp[cy(y + r + 1) * w + x] as f64 - tmp[cy(y - r) * w + x] as f64;
            }
        }
        std::mem::swap(&mut src, &mut dst);
    }
    src
}

/// Gradient energy (summed squared Sobel responses of L, a, b) below which an area counts as flat:
/// about 2.5 Lab units per pixel, below what a thread color change could show.
const FLAT: f64 = 400.0;

/// Structure tensor orientation of the image, integrated over about `sigma` pixels. Gradients come
/// from all three Lab channels (Di Zenzo), so a border between two colors of equal lightness counts.
pub fn orientation(img: &LabImage, sigma: f64) -> Orientation {
    let (w, h, lab) = (img.width, img.height, &img.lab);
    let (wi, hi) = (w as i64, h as i64);
    let mut jxx = vec![0f32; w * h];
    let mut jxy = vec![0f32; w * h];
    let mut jyy = vec![0f32; w * h];
    let at = |x: i64, y: i64, c: usize| {
        lab[(y.clamp(0, hi - 1) as usize * w + x.clamp(0, wi - 1) as usize) * 3 + c] as f64
    };
    for y in 0..hi {
        for x in 0..wi {
            let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
            for c in 0..3 {
                // Sobel.
                let gx = at(x + 1, y - 1, c) + 2.0 * at(x + 1, y, c) + at(x + 1, y + 1, c)
                    - at(x - 1, y - 1, c)
                    - 2.0 * at(x - 1, y, c)
                    - at(x - 1, y + 1, c);
                let gy = at(x - 1, y + 1, c) + 2.0 * at(x, y + 1, c) + at(x + 1, y + 1, c)
                    - at(x - 1, y - 1, c)
                    - 2.0 * at(x, y - 1, c)
                    - at(x + 1, y - 1, c);
                xx += gx * gx;
                xy += gx * gy;
                yy += gy * gy;
            }
            let i = (y * wi + x) as usize;
            jxx[i] = xx as f32;
            jxy[i] = xy as f32;
            jyy[i] = yy as f32;
        }
    }
    let r = round(sigma / 1.7).max(1.0) as i64;
    let bxx = blur(&jxx, w, h, r);
    let bxy = blur(&jxy, w, h, r);
    let byy = blur(&jyy, w, h, r);
    let mut c = vec![0f32; w * h];
    let mut s = vec![0f32; w * h];
    for i in 0..w * h {
        // Doubled angle of the gradient direction is (jxx - jyy, 2 jxy); the structure runs at right
        // angles to it, which negates the doubled-angle vector. Its length is λ1 - λ2; divided by
        // λ1 + λ2 it is the coherence (0: no preferred direction, 1: one clear direction), whatever
        // the contrast, so fine shading counts as much as hard edges. Flat areas (λ1 + λ2 under
        // FLAT) have no direction.
        let (xx, xy, yy) = (bxx[i] as f64, bxy[i] as f64, byy[i] as f64);
        let dc = -(xx - yy);
        let ds = -2.0 * xy;
        let energy = xx + yy;
        if energy <= 0.0 {
            continue;
        }
        let k = (energy / FLAT).min(1.0) / energy;
        c[i] = (dc * k) as f32;
        s[i] = (ds * k) as f32;
    }
    Orientation {
        width: w,
        height: h,
        c,
        s,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stripes(w: usize, h: usize, vertical: bool) -> LabImage {
        let mut lab = vec![0f32; w * h * 3];
        for y in 0..h {
            for x in 0..w {
                let t = if vertical { x } else { y };
                lab[(y * w + x) * 3] = if (t / 3) % 2 == 0 { 20.0 } else { 80.0 };
            }
        }
        LabImage {
            width: w,
            height: h,
            lab,
            opaque: vec![1; w * h],
        }
    }

    #[test]
    fn vertical_stripes_run_vertically() {
        let o = orientation(&stripes(40, 40, true), 4.0);
        let i = 20 * 40 + 20;
        // Along y: 2θ = 180°, so cos 2θ is near -1.
        assert!(o.c[i] < -0.9, "{}", o.c[i]);
        assert!(o.s[i].abs() < 0.1);
    }

    #[test]
    fn horizontal_stripes_run_horizontally() {
        let o = orientation(&stripes(40, 40, false), 4.0);
        assert!(o.c[20 * 40 + 20] > 0.9);
    }

    #[test]
    fn flat_has_no_direction() {
        let img = LabImage {
            width: 5,
            height: 5,
            lab: vec![50.0; 75],
            opaque: vec![1; 25],
        };
        let o = orientation(&img, 2.0);
        assert!(o.c.iter().chain(&o.s).all(|&v| v == 0.0));
    }
}
