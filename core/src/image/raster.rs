//! Rasters as the image converter has them: RGBA pixels row by row (the layout of ImageData), and
//! the same image in CIELAB with a mask of its opaque pixels.

use super::color::{Lab, rgb_to_lab};

/// RGBA pixels, row by row.
#[derive(Clone, Debug, PartialEq)]
pub struct Raster {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

/// Image in CIELAB, three floats per pixel, with a mask of the opaque pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct LabImage {
    pub width: usize,
    pub height: usize,
    pub lab: Vec<f32>,
    pub opaque: Vec<u8>,
}

/// Pixels with less alpha are transparent: never sewn.
pub const ALPHA_MIN: u8 = 128;

/// A number stored as a byte the way a `Uint8ClampedArray` stores it: clamped, halves to even.
pub fn clamp_u8(v: f64) -> u8 {
    if v.is_nan() || v <= 0.0 {
        0
    } else if v >= 255.0 {
        255
    } else {
        v.round_ties_even() as u8
    }
}

/// Area-average resampling to w x h (box filter over the source footprint of each target pixel).
/// Color is averaged with alpha as weight, so transparent pixels do not darken the edges.
pub fn resize_area(src: &Raster, w: usize, h: usize) -> Raster {
    let (sw, sh, s) = (src.width, src.height, &src.data);
    if sw == w && sh == h {
        return src.clone();
    }
    // Enlarging with a box would copy each source pixel into a block, and every edge would come out
    // as a staircase of those blocks; interpolation keeps the edge where the source's anti-aliasing puts it.
    if w > sw || h > sh {
        return resize_cubic(src, w, h);
    }
    let mut out = vec![0u8; w * h * 4];
    let fx = sw as f64 / w as f64;
    let fy = sh as f64 / h as f64;
    for ty in 0..h {
        let y0 = ty as f64 * fy;
        let y1 = (sh as f64).min(y0 + fy);
        for tx in 0..w {
            let x0 = tx as f64 * fx;
            let x1 = (sw as f64).min(x0 + fx);
            let (mut r, mut g, mut b, mut a, mut area) = (0.0, 0.0, 0.0, 0.0, 0.0);
            let mut y = y0.floor() as usize;
            while (y as f64) < y1 {
                let wy = ((y + 1) as f64).min(y1) - (y as f64).max(y0);
                let mut x = x0.floor() as usize;
                while (x as f64) < x1 {
                    let wgt = wy * (((x + 1) as f64).min(x1) - (x as f64).max(x0));
                    let i = (y * sw + x) * 4;
                    let al = s[i + 3] as f64 * wgt;
                    r += s[i] as f64 * al;
                    g += s[i + 1] as f64 * al;
                    b += s[i + 2] as f64 * al;
                    a += al;
                    area += wgt;
                    x += 1;
                }
                y += 1;
            }
            let o = (ty * w + tx) * 4;
            if a > 0.0 {
                out[o] = clamp_u8(r / a);
                out[o + 1] = clamp_u8(g / a);
                out[o + 2] = clamp_u8(b / a);
            }
            out[o + 3] = if area > 0.0 { clamp_u8(a / area) } else { 0 };
        }
    }
    Raster {
        width: w,
        height: h,
        data: out,
    }
}

/// Mitchell-Netravali cubic (B = C = 1/3): smooth, with hardly any ringing at hard edges.
fn mitchell(x: f64) -> f64 {
    let x = x.abs();
    if x < 1.0 {
        (7.0 * x.powf(3.0) - 12.0 * x * x + 16.0 / 3.0) / 6.0
    } else if x < 2.0 {
        ((-7.0 / 3.0) * x.powf(3.0) + 12.0 * x * x - 20.0 * x + 32.0 / 3.0) / 6.0
    } else {
        0.0
    }
}

/// Taps and weights of each target position along one axis (source pixels clamped at the border).
fn cubic_taps(sn: usize, n: usize) -> (Vec<usize>, Vec<f32>) {
    let mut at = vec![0usize; n * 4];
    let mut wt = vec![0f32; n * 4];
    let f = sn as f64 / n as f64;
    for t in 0..n {
        let c = (t as f64 + 0.5) * f - 0.5;
        let i0 = c.floor() as i64 - 1;
        let mut sum = 0.0;
        for k in 0..4 {
            let wgt = mitchell(c - (i0 + k) as f64);
            at[t * 4 + k as usize] = (i0 + k).clamp(0, sn as i64 - 1) as usize;
            wt[t * 4 + k as usize] = wgt as f32;
            sum += wgt;
        }
        for k in 0..4 {
            wt[t * 4 + k] = (wt[t * 4 + k] as f64 / sum) as f32;
        }
    }
    (at, wt)
}

/// Separable cubic resampling, for enlarging. Color is interpolated premultiplied by alpha, so
/// transparent pixels do not darken the edges.
fn resize_cubic(src: &Raster, w: usize, h: usize) -> Raster {
    let (sw, sh, s) = (src.width, src.height, &src.data);
    let (xat, xwt) = cubic_taps(sw, w);
    let (yat, ywt) = cubic_taps(sh, h);
    // Rows first: sh rows of w premultiplied pixels.
    let mut tmp = vec![0f32; sh * w * 4];
    for y in 0..sh {
        for x in 0..w {
            let (mut r, mut g, mut b, mut a) = (0.0, 0.0, 0.0, 0.0);
            for k in 0..4 {
                let i = (y * sw + xat[x * 4 + k]) * 4;
                let al = s[i + 3] as f64 * xwt[x * 4 + k] as f64;
                r += s[i] as f64 * al;
                g += s[i + 1] as f64 * al;
                b += s[i + 2] as f64 * al;
                a += al;
            }
            let o = (y * w + x) * 4;
            tmp[o] = r as f32;
            tmp[o + 1] = g as f32;
            tmp[o + 2] = b as f32;
            tmp[o + 3] = a as f32;
        }
    }
    let mut out = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let (mut r, mut g, mut b, mut a) = (0.0, 0.0, 0.0, 0.0);
            for k in 0..4 {
                let i = (yat[y * 4 + k] * w + x) * 4;
                let wgt = ywt[y * 4 + k] as f64;
                r += tmp[i] as f64 * wgt;
                g += tmp[i + 1] as f64 * wgt;
                b += tmp[i + 2] as f64 * wgt;
                a += tmp[i + 3] as f64 * wgt;
            }
            let o = (y * w + x) * 4;
            if a > 0.0 {
                out[o] = clamp_u8(r / a);
                out[o + 1] = clamp_u8(g / a);
                out[o + 2] = clamp_u8(b / a);
            }
            out[o + 3] = clamp_u8(a);
        }
    }
    Raster {
        width: w,
        height: h,
        data: out,
    }
}

/// Converts to Lab; a small cache of recent colors keeps photos fast (neighbouring pixels repeat).
pub fn to_lab(src: &Raster) -> LabImage {
    const SLOTS: usize = 1 << 14;
    let n = src.width * src.height;
    let mut lab = vec![0f32; n * 3];
    let mut opaque = vec![0u8; n];
    // Direct-mapped: key + 1 per slot (0 is empty), value next to it.
    let mut keys = vec![0u32; SLOTS];
    let mut vals: Vec<Lab> = vec![[0.0; 3]; SLOTS];
    let d = &src.data;
    for i in 0..n {
        let (r, g, b) = (d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        opaque[i] = u8::from(d[i * 4 + 3] >= ALPHA_MIN);
        let key = ((r as u32) << 16) | ((g as u32) << 8) | b as u32;
        let slot = (key.wrapping_mul(0x9e37_79b1) >> 18) as usize;
        let v = if keys[slot] == key + 1 {
            vals[slot]
        } else {
            let v = rgb_to_lab(r, g, b);
            keys[slot] = key + 1;
            vals[slot] = v;
            v
        };
        lab[i * 3] = v[0] as f32;
        lab[i * 3 + 1] = v[1] as f32;
        lab[i * 3 + 2] = v[2] as f32;
    }
    LabImage {
        width: src.width,
        height: src.height,
        lab,
        opaque,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(w: usize, h: usize, c: [u8; 4]) -> Raster {
        Raster {
            width: w,
            height: h,
            data: c.repeat(w * h),
        }
    }

    #[test]
    fn shrinking_keeps_a_flat_color() {
        let r = resize_area(&solid(10, 8, [200, 100, 50, 255]), 3, 2);
        assert_eq!(r.data, [200, 100, 50, 255].repeat(6));
    }

    #[test]
    fn enlarging_keeps_a_flat_color() {
        let r = resize_cubic(&solid(3, 2, [200, 100, 50, 255]), 10, 7);
        assert!(r.data.chunks(4).all(|p| p == [200, 100, 50, 255]));
    }

    #[test]
    fn transparent_pixels_do_not_darken() {
        let mut src = solid(2, 1, [255, 0, 0, 255]);
        src.data[4..8].copy_from_slice(&[0, 0, 0, 0]);
        let r = resize_area(&src, 1, 1);
        assert_eq!(&r.data[..3], &[255, 0, 0]);
        assert_eq!(r.data[3], 128);
    }

    #[test]
    fn lab_and_mask() {
        let mut src = solid(2, 1, [255, 255, 255, 255]);
        src.data[7] = 10;
        let l = to_lab(&src);
        assert_eq!(l.opaque, vec![1, 0]);
        assert!((l.lab[0] - 100.0).abs() < 1e-3);
    }

    #[test]
    fn clamps_like_uint8_clamped_array() {
        assert_eq!(clamp_u8(2.5), 2);
        assert_eq!(clamp_u8(3.5), 4);
        assert_eq!(clamp_u8(-1.0), 0);
        assert_eq!(clamp_u8(300.0), 255);
        assert_eq!(clamp_u8(f64::NAN), 0);
    }
}
