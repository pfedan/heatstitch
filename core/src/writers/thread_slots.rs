//! Palette slots for the formats that store threads as palette indices (src/writers/threadSlots.ts),
//! with the sRGB to CIELAB conversion and CIEDE2000 difference it needs (from src/image/color.ts;
//! the image area has its own copy until the two are merged).

use std::collections::HashMap;

use crate::pattern::ThreadColor;

type Lab = [f64; 3];

/// Math.hypot as V8 computes it (scaled, Kahan-summed), so slot choices match the TypeScript ones
/// to the last bit.
fn hypot(a: f64, b: f64) -> f64 {
    let (a, b) = (a.abs(), b.abs());
    let max = a.max(b);
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if max == 0.0 {
        return 0.0;
    }
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for v in [a, b] {
        let n = v / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

fn to_linear(c: u8) -> f64 {
    let v = c as f64 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

pub fn rgb_to_lab(r: u8, g: u8, b: u8) -> Lab {
    // D65 reference white.
    const XN: f64 = 0.95047;
    const ZN: f64 = 1.08883;
    let eps = 216.0 / 24389.0;
    let kappa = 24389.0 / 27.0;
    let f = |t: f64| {
        if t > eps {
            t.cbrt()
        } else {
            (kappa * t + 16.0) / 116.0
        }
    };
    let (rr, gg, bb) = (to_linear(r), to_linear(g), to_linear(b));
    let x = (0.4124564 * rr + 0.3575761 * gg + 0.1804375 * bb) / XN;
    let y = 0.2126729 * rr + 0.7151522 * gg + 0.072175 * bb;
    let z = (0.0193339 * rr + 0.119192 * gg + 0.9503041 * bb) / ZN;
    let (fx, fy, fz) = (f(x), f(y), f(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// CIEDE2000 color difference with kL = kC = kH = 1 (Sharma, Wu & Dalal 2005).
pub fn delta_e2000(l1: Lab, l2: Lab) -> f64 {
    let rad = std::f64::consts::PI / 180.0;
    let [ll1, a1, b1] = l1;
    let [ll2, a2, b2] = l2;
    let pow7 = |v: f64| v.powf(7.0);
    let c25 = 25f64.powf(7.0);
    let cm = (hypot(a1, b1) + hypot(a2, b2)) / 2.0;
    let g = 0.5 * (1.0 - (pow7(cm) / (pow7(cm) + c25)).sqrt());
    let (a1p, a2p) = ((1.0 + g) * a1, (1.0 + g) * a2);
    let (c1p, c2p) = (hypot(a1p, b1), hypot(a2p, b2));
    let hue = |b: f64, a: f64| {
        if a == 0.0 && b == 0.0 {
            return 0.0;
        }
        let h = b.atan2(a) / rad;
        if h < 0.0 { h + 360.0 } else { h }
    };
    let (h1p, h2p) = (hue(b1, a1p), hue(b2, a2p));
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
    let dhh = 2.0 * (c1p * c2p).sqrt() * ((dhp / 2.0) * rad).sin();
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
    let t = 1.0 - 0.17 * ((hpm - 30.0) * rad).cos()
        + 0.24 * (2.0 * hpm * rad).cos()
        + 0.32 * ((3.0 * hpm + 6.0) * rad).cos()
        - 0.2 * ((4.0 * hpm - 63.0) * rad).cos();
    let q = (hpm - 275.0) / 25.0;
    let d_theta = 30.0 * (-(q * q)).exp();
    let rc = 2.0 * (pow7(cpm) / (pow7(cpm) + c25)).sqrt();
    let l50 = (lpm - 50.0) * (lpm - 50.0);
    let sl = 1.0 + (0.015 * l50) / (20.0 + l50).sqrt();
    let sc = 1.0 + 0.045 * cpm;
    let sh = 1.0 + 0.015 * cpm * t;
    let rt = -(2.0 * d_theta * rad).sin() * rc;
    let (tl, tc, th) = (dlp / sl, dcp / sc, dhh / sh);
    (tl * tl + tc * tc + th * th + rt * tc * th).sqrt()
}

/// Palette slot per color block for formats that store threads as palette indices (PEC, JEF). Every
/// distinct color gets a slot of its own, so two different threads never show up on the machine as
/// the same one. The distinct colors are assigned to the slots at the least total squared CIEDE2000
/// difference (Hungarian method), so no color takes a slot another one needs more. A color keeps
/// the slot `own` names for it (one read from the file) unless another color has it already.
/// Colors beyond the number of slots share their nearest slot.
pub fn unique_slots(
    colors: &[ThreadColor],
    slots: &[u32],
    color_of: impl Fn(u32) -> ThreadColor,
    own: impl Fn(&ThreadColor) -> Option<u32>,
) -> Vec<u32> {
    let lab = |c: &ThreadColor| rgb_to_lab(c.r, c.g, c.b);
    let slot_labs: Vec<Lab> = slots.iter().map(|&s| lab(&color_of(s))).collect();
    let key = |c: &ThreadColor| (c.r, c.g, c.b, c.pec_index);
    let mut distinct: Vec<&ThreadColor> = vec![];
    let mut row = HashMap::new();
    for c in colors {
        row.entry(key(c)).or_insert_with(|| {
            distinct.push(c);
            distinct.len() - 1
        });
    }
    let costs: Vec<Vec<f64>> = distinct
        .iter()
        .map(|c| {
            let (l, o) = (lab(c), own(c));
            slots
                .iter()
                .zip(&slot_labs)
                .map(|(&s, sl)| {
                    if o == Some(s) {
                        -1.0
                    } else {
                        let d = delta_e2000(l, *sl);
                        d * d
                    }
                })
                .collect()
        })
        .collect();
    let assigned = assign(&costs[..costs.len().min(slots.len())], slots.len());
    let nearest = |r: usize| {
        let mut best = 0;
        for j in 1..slots.len() {
            if costs[r][j] < costs[r][best] {
                best = j;
            }
        }
        slots[best]
    };
    colors
        .iter()
        .map(|c| {
            let r = row[&key(c)];
            assigned
                .get(r)
                .map(|&j| slots[j])
                .unwrap_or_else(|| nearest(r))
        })
        .collect()
}

/// Minimum-cost assignment of n rows to distinct columns out of m >= n (Hungarian method with
/// potentials, O(n^2 m)). Returns the column of each row.
pub fn assign(cost: &[Vec<f64>], m: usize) -> Vec<usize> {
    let n = cost.len();
    let mut u = vec![0.0; n + 1];
    let mut v = vec![0.0; m + 1];
    let mut owner = vec![0usize; m + 1]; // row (1-based) holding each column, 0 = free
    let mut way = vec![0usize; m + 1];
    for i in 1..=n {
        owner[0] = i;
        let mut j0 = 0;
        let mut minv = vec![f64::INFINITY; m + 1];
        let mut used = vec![false; m + 1];
        loop {
            used[j0] = true;
            let i0 = owner[j0];
            let mut delta = f64::INFINITY;
            let mut j1 = 0;
            for j in 1..=m {
                if used[j] {
                    continue;
                }
                let cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                if cur < minv[j] {
                    minv[j] = cur;
                    way[j] = j0;
                }
                if minv[j] < delta {
                    delta = minv[j];
                    j1 = j;
                }
            }
            for j in 0..=m {
                if used[j] {
                    u[owner[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
            if owner[j0] == 0 {
                break;
            }
        }
        loop {
            let j1 = way[j0];
            owner[j0] = owner[j1];
            j0 = j1;
            if j0 == 0 {
                break;
            }
        }
    }
    let mut out = vec![0; n];
    for j in 1..=m {
        if owner[j] != 0 {
            out[owner[j] - 1] = j - 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lab_and_difference() {
        let white = rgb_to_lab(255, 255, 255);
        assert!((white[0] - 100.0).abs() < 1e-3);
        // Sharma et al., test pair 1.
        let d = delta_e2000([50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485]);
        assert!((d - 2.0425).abs() < 1e-4);
        assert_eq!(hypot(3.0, 4.0), 5.0);
    }

    #[test]
    fn assigns_at_least_cost() {
        let cost = vec![
            vec![4.0, 1.0, 3.0],
            vec![2.0, 0.0, 5.0],
            vec![3.0, 2.0, 2.0],
        ];
        assert_eq!(assign(&cost, 3), vec![1, 0, 2]);
    }

    #[test]
    fn distinct_colors_get_distinct_slots() {
        let palette = |s: u32| ThreadColor {
            r: (s * 100) as u8,
            ..Default::default()
        };
        let c = |r: u8| ThreadColor {
            r,
            ..Default::default()
        };
        let slots = unique_slots(&[c(10), c(20), c(10), c(250)], &[0, 1, 2], palette, |_| {
            None
        });
        assert_eq!(slots[0], slots[2]);
        assert_ne!(slots[0], slots[1]);
        assert_eq!(slots[3], 2);
    }
}
