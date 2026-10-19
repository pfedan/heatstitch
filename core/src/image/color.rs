//! Color spaces for the image converter: sRGB (D65) to CIELAB and back, and the CIEDE2000 color
//! difference (Sharma, Wu & Dalal, "The CIEDE2000 color-difference formula: implementation notes,
//! supplementary test data, and mathematical observations", Color Res. Appl. 30(1), 2005).
//!
//! Clustering averages colors, so it uses plain Euclidean distance in Lab; CIEDE2000 is used where
//! single colors are compared (matching threads, merging clusters).
//!
//! The TypeScript twin (src/image/color.ts) stays for callers in TypeScript that convert one color
//! at a time; this one serves the Rust modules.

use std::sync::OnceLock;

pub type Lab = [f64; 3];
pub type Rgb = [u8; 3];

/// `Math.round` of JavaScript: halves round up (towards +infinity), not away from zero.
pub fn js_round(v: f64) -> f64 {
    let f = v.floor();
    if v - f >= 0.5 { f + 1.0 } else { f }
}

fn to_linear(c: f64) -> f64 {
    let v = c / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn from_linear(v: f64) -> u8 {
    let c = if v <= 0.0031308 {
        12.92 * v
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    js_round(c * 255.0).clamp(0.0, 255.0) as u8
}

// D65 reference white.
const XN: f64 = 0.95047;
const YN: f64 = 1.0;
const ZN: f64 = 1.08883;
const EPS: f64 = 216.0 / 24389.0;
const KAPPA: f64 = 24389.0 / 27.0;

fn f(t: f64) -> f64 {
    if t > EPS {
        t.cbrt()
    } else {
        (KAPPA * t + 16.0) / 116.0
    }
}

fn finv(t: f64) -> f64 {
    let t3 = t.powf(3.0);
    if t3 > EPS {
        t3
    } else {
        (116.0 * t - 16.0) / KAPPA
    }
}

/// Lookup table: 8-bit sRGB to linear light.
fn linear() -> &'static [f64; 256] {
    static LINEAR: OnceLock<[f64; 256]> = OnceLock::new();
    LINEAR.get_or_init(|| std::array::from_fn(|i| to_linear(i as f64)))
}

pub fn rgb_to_lab(r: u8, g: u8, b: u8) -> Lab {
    let lin = linear();
    let (r, g, b) = (lin[r as usize], lin[g as usize], lin[b as usize]);
    let x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
    let y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / YN;
    let z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN;
    let (fx, fy, fz) = (f(x), f(y), f(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

pub fn rgb_lab(c: Rgb) -> Lab {
    rgb_to_lab(c[0], c[1], c[2])
}

pub fn lab_to_rgb(l: f64, a: f64, b: f64) -> Rgb {
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    let x = finv(fx) * XN;
    let y = (if l > KAPPA * EPS {
        fy.powf(3.0)
    } else {
        l / KAPPA
    }) * YN;
    let z = finv(fz) * ZN;
    let r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    let g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
    let bb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
    [from_linear(r), from_linear(g), from_linear(bb)]
}

const RAD: f64 = std::f64::consts::PI / 180.0;

fn hue(b: f64, a: f64) -> f64 {
    if a == 0.0 && b == 0.0 {
        return 0.0;
    }
    let h = b.atan2(a) / RAD;
    if h < 0.0 { h + 360.0 } else { h }
}

/// CIEDE2000 color difference with kL = kC = kH = 1.
pub fn delta_e2000(l1: &Lab, l2: &Lab) -> f64 {
    let [ll1, a1, b1] = *l1;
    let [ll2, a2, b2] = *l2;
    let c1 = a1.hypot(b1);
    let c2 = a2.hypot(b2);
    let cm = (c1 + c2) / 2.0;
    let p25 = 25f64.powf(7.0);
    let cm7 = cm.powf(7.0);
    let g = 0.5 * (1.0 - (cm7 / (cm7 + p25)).sqrt());
    let a1p = (1.0 + g) * a1;
    let a2p = (1.0 + g) * a2;
    let c1p = a1p.hypot(b1);
    let c2p = a2p.hypot(b2);
    let h1p = hue(b1, a1p);
    let h2p = hue(b2, a2p);
    let dlp = ll2 - ll1;
    let dcp = c2p - c1p;
    let mut dhp = 0.0;
    if c1p * c2p != 0.0 {
        dhp = h2p - h1p;
        if dhp > 180.0 {
            dhp -= 360.0;
        } else if dhp < -180.0 {
            dhp += 360.0;
        }
    }
    let d_hp = 2.0 * (c1p * c2p).sqrt() * ((dhp / 2.0) * RAD).sin();
    let lpm = (ll1 + ll2) / 2.0;
    let cpm = (c1p + c2p) / 2.0;
    let mut hpm = h1p + h2p;
    if c1p * c2p != 0.0 {
        hpm = if (h1p - h2p).abs() <= 180.0 {
            (h1p + h2p) / 2.0
        } else if h1p + h2p < 360.0 {
            (h1p + h2p + 360.0) / 2.0
        } else {
            (h1p + h2p - 360.0) / 2.0
        };
    }
    let t = 1.0 - 0.17 * ((hpm - 30.0) * RAD).cos()
        + 0.24 * (2.0 * hpm * RAD).cos()
        + 0.32 * ((3.0 * hpm + 6.0) * RAD).cos()
        - 0.2 * ((4.0 * hpm - 63.0) * RAD).cos();
    let d_theta = 30.0 * (-((hpm - 275.0) / 25.0).powf(2.0)).exp();
    let cpm7 = cpm.powf(7.0);
    let rc = 2.0 * (cpm7 / (cpm7 + p25)).sqrt();
    let lm50 = (lpm - 50.0) * (lpm - 50.0);
    let sl = 1.0 + (0.015 * lm50) / (20.0 + lm50).sqrt();
    let sc = 1.0 + 0.045 * cpm;
    let sh = 1.0 + 0.015 * cpm * t;
    let rt = -(2.0 * d_theta * RAD).sin() * rc;
    let tl = dlp / sl;
    let tc = dcp / sc;
    let th = d_hp / sh;
    (tl * tl + tc * tc + th * th + rt * tc * th).sqrt()
}

/// Euclidean length of a 3-vector, as `Math.hypot(a, b, c)`.
pub fn hypot3(a: f64, b: f64, c: f64) -> f64 {
    (a * a + b * b + c * c).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_srgb() {
        for c in [
            [0, 0, 0],
            [255, 255, 255],
            [220, 30, 40],
            [20, 60, 170],
            [250, 210, 20],
        ] {
            let l = rgb_lab(c);
            assert_eq!(lab_to_rgb(l[0], l[1], l[2]), c);
        }
    }

    #[test]
    fn white_is_l100() {
        let l = rgb_to_lab(255, 255, 255);
        assert!((l[0] - 100.0).abs() < 1e-3 && l[1].abs() < 1e-2 && l[2].abs() < 1e-2);
    }

    /// Pairs from Sharma, Wu & Dalal's test data.
    #[test]
    fn ciede2000_reference_pairs() {
        let pairs: [(Lab, Lab, f64); 4] = [
            ([50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485], 2.0425),
            ([50.0, -1.0, 2.0], [50.0, 0.0, 0.0], 2.3669),
            ([50.0, 2.5, 0.0], [73.0, 25.0, -18.0], 27.1492),
            (
                [22.7233, 20.0904, -46.694],
                [23.0331, 14.973, -42.5619],
                2.0373,
            ),
        ];
        for (a, b, want) in pairs {
            assert!((delta_e2000(&a, &b) - want).abs() < 1e-4, "{a:?} {b:?}");
        }
    }

    #[test]
    fn js_round_rounds_halves_up() {
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.6), -3.0);
    }
}
