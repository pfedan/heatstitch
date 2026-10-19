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
    }
}
