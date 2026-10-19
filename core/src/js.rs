//! Arithmetic as the TypeScript core does it, so a ported module gives the same numbers as its
//! twin while both exist (the differential tests compare them for equality).

/// `Math.hypot(x, y)` as V8 computes it (scaled by the larger value, Kahan summation): Rust's
/// `f64::hypot` differs in the last bit now and then, which moves thresholds.
#[inline]
pub fn hypot(x: f64, y: f64) -> f64 {
    let (a, b) = (x.abs(), y.abs());
    if x.is_nan() || y.is_nan() {
        return if a == f64::INFINITY || b == f64::INFINITY {
            f64::INFINITY
        } else {
            f64::NAN
        };
    }
    let max = a.max(b);
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut comp = 0.0;
    for v in [a, b] {
        let n = v / max;
        let s = n * n - comp;
        let p = sum + s;
        comp = (p - sum) - s;
        sum = p;
    }
    sum.sqrt() * max
}

/// `Math.round`: halves round up (towards +infinity), not away from zero.
#[inline]
pub fn round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

/// Distance between two points.
#[inline]
pub fn dist(p: [f64; 2], q: [f64; 2]) -> f64 {
    hypot(p[0] - q[0], p[1] - q[1])
}

/// `Math.max(...v)` of a non-empty list without NaN (`-Infinity` for none).
pub fn max_of(v: impl IntoIterator<Item = f64>) -> f64 {
    v.into_iter().fold(f64::NEG_INFINITY, f64::max)
}

/// A number as JavaScript tests it in a condition (`if (x)`): there, not 0 and not NaN.
#[inline]
pub fn yes(x: Option<f64>) -> bool {
    x.is_some_and(|v| v != 0.0 && !v.is_nan())
}

/// `Math.max(...v)`: NaN wins, `-Infinity` for none.
pub fn math_max(v: impl IntoIterator<Item = f64>) -> f64 {
    v.into_iter().fold(f64::NEG_INFINITY, |m, x| {
        if x.is_nan() || m.is_nan() {
            f64::NAN
        } else {
            m.max(x)
        }
    })
}

/// `Math.min(...v)`: NaN wins, `Infinity` for none.
pub fn math_min(v: impl IntoIterator<Item = f64>) -> f64 {
    v.into_iter().fold(f64::INFINITY, |m, x| {
        if x.is_nan() || m.is_nan() {
            f64::NAN
        } else {
            m.min(x)
        }
    })
}

/// `Math.min(hi, Math.max(lo, v))`, NaN kept.
#[inline]
pub fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v.is_nan() { v } else { v.clamp(lo, hi) }
}

/// `Math.sign`: 0 stays 0, NaN stays NaN.
#[inline]
pub fn sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x
    }
}

/// ToInt32 (`x | 0`): the integer part wrapped to 32 bits, 0 for NaN and infinities.
#[inline]
pub fn to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    x.trunc().rem_euclid(4294967296.0) as u32 as i32
}

/// A sort comparator on numbers as V8 takes `(a, b) => a - b`: NaN counts as equal.
#[inline]
pub fn by(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// The median as the TypeScript takes it, `s[s.length >> 1]` of the sorted values (the upper
/// middle), 0 for none.
pub fn median(v: &[f64]) -> f64 {
    let mut s = v.to_vec();
    s.sort_by(|a, b| by(*a, *b));
    s.get(s.len() >> 1).copied().unwrap_or(0.0)
}

/// Small, fast and repeatable random numbers in [0, 1) (mulberry32, as the TypeScript has them).
pub struct Random(u32);

impl Random {
    /// Seeded with ToUint32 of `seed` (1 for 0).
    pub fn new(seed: f64) -> Random {
        let a = to_int32(seed) as u32;
        Random(if a == 0 { 1 } else { a })
    }
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4294967296.0
    }
}

/// Hash maps keyed by small integers (pixel and edge ids): a multiplicative hash, much faster than
/// the default SipHash, and no untrusted keys to defend against.
pub type IdMap<K, V> = std::collections::HashMap<K, V, std::hash::BuildHasherDefault<IdHasher>>;

#[derive(Default)]
pub struct IdHasher(u64);

impl std::hash::Hasher for IdHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0.rotate_left(5) ^ u64::from(b)).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
        }
    }
    fn write_u64(&mut self, v: u64) {
        self.0 = (self.0.rotate_left(5) ^ v).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
    fn write_usize(&mut self, v: usize) {
        self.write_u64(v as u64);
    }
    fn write_i64(&mut self, v: i64) {
        self.write_u64(v as u64);
    }
    fn write_u32(&mut self, v: u32) {
        self.write_u64(u64::from(v));
    }
    fn write_i32(&mut self, v: i32) {
        self.write_u64(v as u64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hypot_and_round_as_in_javascript() {
        assert_eq!(hypot(3.0, 4.0), 5.0);
        assert_eq!(hypot(0.0, 0.0), 0.0);
        assert_eq!(hypot(-2.0, 0.0), 2.0);
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(-2.6), -3.0);
        assert_eq!(round(0.49999999999999994), 0.0);
    }

    #[test]
    fn math_helpers_as_in_javascript() {
        assert!(math_max([1.0, f64::NAN, 3.0]).is_nan());
        assert_eq!(math_min([2.0, -1.0]), -1.0);
        assert!(clamp(f64::NAN, 0.0, 1.0).is_nan());
        assert_eq!(sign(-0.5), -1.0);
        assert_eq!(to_int32(4294967297.5), 1);
        assert_eq!(to_int32(2147483648.0), -2147483648);
        assert_eq!(to_int32(-1.5), -1);
        assert_eq!(median(&[3.0, 1.0, 2.0, 4.0]), 3.0);
        assert_eq!(median(&[]), 0.0);
    }
}
