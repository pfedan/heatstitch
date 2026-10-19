//! `Math.sin`, `Math.cos` and `Math.pow` bit for bit as Node computes them.
//!
//! V8 (as Node builds it) uses its own copy of fdlibm 5.3 (`src/base/ieee754.cc`). Rust's
//! `f64::sin` on wasm32 is the musl libm, whose kernels were reworked later and round
//! differently for about 1% of arguments (pow: about 9%): that moves stitches by an ulp and can
//! flip a comparison further down, so the Rust fills would not match the TypeScript they
//! replace. These are line by line ports of the fdlibm routines; sin and cos cover
//! |x| <= 2^19 * pi/2 (every angle a design uses), larger arguments fall back to the platform.
//! Checked against Node 22 on 300k (sin, cos) and 400k (pow) arguments: no difference.
//! Browsers may build V8 with glibc's trig instead; there the Rust result is still the same
//! everywhere, which the TypeScript was not.

const fn word(hi: u32, lo: u32) -> f64 {
    f64::from_bits(((hi as u64) << 32) | lo as u64)
}

const INVPIO2: f64 = word(0x3FE45F30, 0x6DC9C883);
const PIO2_1: f64 = word(0x3FF921FB, 0x54400000);
const PIO2_1T: f64 = word(0x3DD0B461, 0x1A626331);
const PIO2_2: f64 = word(0x3DD0B461, 0x1A600000);
const PIO2_2T: f64 = word(0x3BA3198A, 0x2E037073);
const PIO2_3: f64 = word(0x3BA3198A, 0x2E000000);
const PIO2_3T: f64 = word(0x397B839A, 0x252049C1);

const C1: f64 = word(0x3FA55555, 0x5555554C);
const C2: f64 = word(0xBF56C16C, 0x16C15177);
const C3: f64 = word(0x3EFA01A0, 0x19CB1590);
const C4: f64 = word(0xBE927E4F, 0x809C52AD);
const C5: f64 = word(0x3E21EE9E, 0xBDB4B1C4);
const C6: f64 = word(0xBDA8FAE9, 0xBE8838D4);

const S1: f64 = word(0xBFC55555, 0x55555549);
const S2: f64 = word(0x3F811111, 0x1110F8A6);
const S3: f64 = word(0xBF2A01A0, 0x19C161D5);
const S4: f64 = word(0x3EC71DE3, 0x57B1FE7D);
const S5: f64 = word(0xBE5AE5E6, 0x8A2B9CEB);
const S6: f64 = word(0x3DE5D93A, 0x5ACFD57C);

/// High words of n * pi/2 for n = 1..32, where the quick reduction may cancel.
const NPIO2_HW: [u32; 32] = [
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
    0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB,
    0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
    0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
];

#[inline]
fn high(x: f64) -> u32 {
    (x.to_bits() >> 32) as u32
}

/// cos(x + y) for |x| <= pi/4.
fn kernel_cos(x: f64, y: f64) -> f64 {
    let ix = high(x) & 0x7FFF_FFFF;
    if ix < 0x3E40_0000 {
        return 1.0;
    }
    let z = x * x;
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if ix < 0x3FD3_3333 {
        return 1.0 - (0.5 * z - (z * r - x * y));
    }
    let qx = if ix > 0x3FE9_0000 {
        0.28125
    } else {
        word(ix - 0x0020_0000, 0)
    };
    let iz = 0.5 * z - qx;
    let a = 1.0 - qx;
    a - (iz - (z * r - x * y))
}

/// sin(x + y) for |x| <= pi/4; `tail` says whether y is used.
fn kernel_sin(x: f64, y: f64, tail: bool) -> f64 {
    let ix = high(x) & 0x7FFF_FFFF;
    if ix < 0x3E40_0000 {
        return x;
    }
    let z = x * x;
    let v = z * x;
    let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    if !tail {
        x + v * (S1 + z * r)
    } else {
        x - ((z * (0.5 * y - v * r) - y) - v * S1)
    }
}

/// x minus the nearest multiple n of pi/2 as y0 + y1, with n; None beyond 2^19 * pi/2.
fn rem_pio2(x: f64) -> Option<(i32, f64, f64)> {
    let hx = high(x) as i32;
    let ix = (hx & 0x7FFF_FFFF) as u32;
    if ix < 0x4002_D97C {
        // |x| < 3pi/4: n is +-1.
        let near = ix == 0x3FF9_21FB;
        return Some(if hx > 0 {
            let mut z = x - PIO2_1;
            if !near {
                let y0 = z - PIO2_1T;
                (1, y0, (z - y0) - PIO2_1T)
            } else {
                z -= PIO2_2;
                let y0 = z - PIO2_2T;
                (1, y0, (z - y0) - PIO2_2T)
            }
        } else {
            let mut z = x + PIO2_1;
            if !near {
                let y0 = z + PIO2_1T;
                (-1, y0, (z - y0) + PIO2_1T)
            } else {
                z += PIO2_2;
                let y0 = z + PIO2_2T;
                (-1, y0, (z - y0) + PIO2_2T)
            }
        });
    }
    if ix > 0x4139_21FB {
        return None;
    }
    let t = x.abs();
    let n = (t * INVPIO2 + 0.5) as i32;
    let f = n as f64;
    let mut r = t - f * PIO2_1;
    let mut w = f * PIO2_1T;
    let mut y0;
    if n < 32 && ix != NPIO2_HW[n as usize - 1] {
        y0 = r - w;
    } else {
        let j = (ix >> 20) as i32;
        y0 = r - w;
        let i = j - ((high(y0) >> 20) & 0x7FF) as i32;
        if i > 16 {
            let t = r;
            w = f * PIO2_2;
            r = t - w;
            w = f * PIO2_2T - ((t - r) - w);
            y0 = r - w;
            let i = j - ((high(y0) >> 20) & 0x7FF) as i32;
            if i > 49 {
                let t = r;
                w = f * PIO2_3;
                r = t - w;
                w = f * PIO2_3T - ((t - r) - w);
                y0 = r - w;
            }
        }
    }
    let y1 = (r - y0) - w;
    Some(if hx < 0 { (-n, -y0, -y1) } else { (n, y0, y1) })
}

/// `Math.sin(x)`.
pub fn sin(x: f64) -> f64 {
    let ix = high(x) & 0x7FFF_FFFF;
    if ix <= 0x3FE9_21FB {
        return kernel_sin(x, 0.0, false);
    }
    if ix >= 0x7FF0_0000 {
        return f64::NAN;
    }
    match rem_pio2(x) {
        Some((n, y0, y1)) => match n & 3 {
            0 => kernel_sin(y0, y1, true),
            1 => kernel_cos(y0, y1),
            2 => -kernel_sin(y0, y1, true),
            _ => -kernel_cos(y0, y1),
        },
        None => x.sin(),
    }
}

/// `Math.cos(x)`.
pub fn cos(x: f64) -> f64 {
    let ix = high(x) & 0x7FFF_FFFF;
    if ix <= 0x3FE9_21FB {
        return kernel_cos(x, 0.0);
    }
    if ix >= 0x7FF0_0000 {
        return f64::NAN;
    }
    match rem_pio2(x) {
        Some((n, y0, y1)) => match n & 3 {
            0 => kernel_cos(y0, y1),
            1 => -kernel_sin(y0, y1, true),
            2 => -kernel_cos(y0, y1),
            _ => kernel_sin(y0, y1, true),
        },
        None => x.cos(),
    }
}

fn with_low(d: f64, lo: u32) -> f64 {
    f64::from_bits((d.to_bits() & 0xFFFF_FFFF_0000_0000) | lo as u64)
}

fn with_high(d: f64, hi: u32) -> f64 {
    f64::from_bits((d.to_bits() & 0xFFFF_FFFF) | ((hi as u64) << 32))
}

const BP: [f64; 2] = [1.0, 1.5];
const DP_H: [f64; 2] = [0.0, word(0x3FE2B803, 0x40000000)];
const DP_L: [f64; 2] = [0.0, word(0x3E4CFDEB, 0x43CFD006)];
const L1: f64 = word(0x3FE33333, 0x33333303);
const L2: f64 = word(0x3FDB6DB6, 0xDB6FABFF);
const L3: f64 = word(0x3FD55555, 0x518F264D);
const L4: f64 = word(0x3FD17460, 0xA91D4101);
const L5: f64 = word(0x3FCD864A, 0x93C9DB65);
const L6: f64 = word(0x3FCA7E28, 0x4A454EEF);
const P1: f64 = word(0x3FC55555, 0x5555553E);
const P2: f64 = word(0xBF66C16C, 0x16BEBD93);
const P3: f64 = word(0x3F11566A, 0xAF25DE2C);
const P4: f64 = word(0xBEBBBD41, 0xC5D26BF1);
const P5: f64 = word(0x3E663769, 0x72BEA4D0);
const LG2: f64 = word(0x3FE62E42, 0xFEFA39EF);
const LG2_H: f64 = word(0x3FE62E43, 0x00000000);
const LG2_L: f64 = word(0xBE205C61, 0x0CA86C39);
const CP: f64 = word(0x3FEEC709, 0xDC3A03FD);
const CP_H: f64 = word(0x3FEEC709, 0xE0000000);
const CP_L: f64 = word(0xBE3E2FE0, 0x145B01F5);

/// `Math.pow(x, y)` (and `x ** y`): fdlibm's `__ieee754_pow` as V8 has it. Special values
/// (zeros, infinities, NaN, |y| > 2^31, results out of the normal range) go to the platform.
pub fn pow(x: f64, y: f64) -> f64 {
    if y == 0.0 {
        return 1.0;
    }
    if x.is_nan() || y.is_nan() {
        return x + y;
    }
    if y == 1.0 {
        return x;
    }
    if y == -1.0 {
        return 1.0 / x;
    }
    if y == 2.0 {
        return x * x;
    }
    if y == 0.5 && x >= 0.0 {
        return x.sqrt();
    }
    if !x.is_finite() || !y.is_finite() || x == 0.0 || x.abs() == 1.0 || y.abs() > 2147483648.0 {
        return x.powf(y);
    }
    // Sign of the result: -1 for a negative x to an odd power.
    let mut s = 1.0;
    if x < 0.0 {
        if y.fract() != 0.0 {
            return f64::NAN;
        }
        if (y / 2.0).fract() != 0.0 {
            s = -1.0;
        }
    }
    let mut ax = x.abs();
    let mut ix = high(ax) as i32;
    let mut n: i32 = 0;
    if ix < 0x0010_0000 {
        // Subnormal x.
        ax *= 9007199254740992.0;
        n -= 53;
        ix = high(ax) as i32;
    }
    n += (ix >> 20) - 0x3ff;
    let j = ix & 0x000f_ffff;
    ix = j | 0x3ff0_0000;
    let k = if j <= 0x3988E {
        0
    } else if j < 0xBB67A {
        1
    } else {
        n += 1;
        ix -= 0x0010_0000;
        0
    };
    ax = with_high(ax, ix as u32);

    // ss = s_h + s_l = (x - 1) / (x + 1) or (x - 1.5) / (x + 1.5).
    let u = ax - BP[k];
    let v = 1.0 / (ax + BP[k]);
    let ss = u * v;
    let s_h = with_low(ss, 0);
    let t_h = word(
        (((ix >> 1) | 0x2000_0000) + 0x0008_0000 + ((k as i32) << 18)) as u32,
        0,
    );
    let t_l = ax - (t_h - BP[k]);
    let s_l = v * ((u - s_h * t_h) - s_h * t_l);
    // log(ax).
    let s2 = ss * ss;
    let mut r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    let s2 = s_h * s_h;
    let t_h = with_low(3.0 + s2 + r, 0);
    let t_l = r - ((t_h - 3.0) - s2);
    let u = s_h * t_h;
    let v = s_l * t_h + t_l * ss;
    let p_h = with_low(u + v, 0);
    let p_l = v - (p_h - u);
    let z_h = CP_H * p_h;
    let z_l = CP_L * p_h + p_l * CP + DP_L[k];
    // log2(ax) = n + dp_h + z_h + z_l = t1 + t2.
    let t = f64::from(n);
    let t1 = with_low(((z_h + z_l) + DP_H[k]) + t, 0);
    let t2 = z_l - (((t1 - t) - DP_H[k]) - z_h);

    // (y1 + y2) * (t1 + t2).
    let y1 = with_low(y, 0);
    let p_l = (y - y1) * t1 + y * t2;
    let mut p_h = y1 * t1;
    let z = p_l + p_h;
    let j = high(z) as i32;
    let i = j & 0x7fff_ffff;
    if i >= 0x408f_f000 {
        // Near or beyond overflow or underflow.
        return x.powf(y);
    }
    // 2^(p_h + p_l).
    let mut k = (i >> 20) - 0x3ff;
    let mut n = 0;
    if i > 0x3fe0_0000 {
        n = j.wrapping_add(0x0010_0000 >> (k + 1));
        k = ((n & 0x7fff_ffff) >> 20) - 0x3ff;
        let t = word((n & !(0x000f_ffff >> k)) as u32, 0);
        n = ((n & 0x000f_ffff) | 0x0010_0000) >> (20 - k);
        if j < 0 {
            n = -n;
        }
        p_h -= t;
    }
    let t = with_low(p_l + p_h, 0);
    let u = t * LG2_H;
    let v = (p_l - (t - p_h)) * LG2 + t * LG2_L;
    let z = u + v;
    let w = v - (z - u);
    let t = z * z;
    let t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    let r = (z * t1) / ((t1 - 2.0) - (w + z * w));
    let z = 1.0 - (r - z);
    let j = (high(z) as i32).wrapping_add(((n as u32) << 20) as i32);
    if (j >> 20) <= 0 {
        return x.powf(y);
    }
    s * with_high(z, j as u32)
}

/// Method form, so ported code reads like the TypeScript (`a.js_sin()` for `Math.sin(a)`).
pub trait JsMath {
    fn js_sin(self) -> f64;
    fn js_pow(self, y: f64) -> f64;
    fn js_cos(self) -> f64;
}

impl JsMath for f64 {
    #[inline]
    fn js_sin(self) -> f64 {
        sin(self)
    }
    #[inline]
    fn js_pow(self, y: f64) -> f64 {
        pow(self, y)
    }
    #[inline]
    fn js_cos(self) -> f64 {
        cos(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_values() {
        assert_eq!(sin(0.0), 0.0);
        assert_eq!(cos(0.0), 1.0);
        // Values Node prints for Math.sin / Math.cos.
        assert_eq!(sin(-1.0204760883364052), -0.852357093795568);
        assert_eq!(sin(16.58773515155093), -0.7705935142227063);
        assert_eq!(sin(-556.7713835505397), 0.6514422672202843);
        assert!(sin(f64::NAN).is_nan());
        assert!(cos(f64::INFINITY).is_nan());
        assert_eq!(pow(0.7, 3.0), 0.3429999999999999);
        assert_eq!(pow(1.9, -4.0), 0.0767336039471766);
        assert_eq!(pow(-2.5, 3.0), -15.625);
        assert_eq!(pow(123.4, -2.7), 0.0000022565713442268993);
        assert!(pow(-2.0, 0.5).is_nan());
    }

    #[test]
    fn close_to_std() {
        let mut x = -50.0;
        while x < 50.0 {
            assert!((sin(x) - x.sin()).abs() < 1e-15, "{x}");
            assert!((cos(x) - x.cos()).abs() < 1e-15, "{x}");
            x += 0.0137;
        }
    }
}
