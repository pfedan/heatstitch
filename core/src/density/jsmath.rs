//! Numbers exactly as JavaScript computes them, where the checks have to give the same results as
//! the TypeScript they replace (a cell just over a limit has to stay over it).

/// `Math.hypot(a, b)` as V8 computes it: normalized to the larger value with a compensated sum.
/// It differs from the correctly rounded `sqrt(a * a + b * b)` in the last bit for about a third
/// of all integer pairs, and stitch lengths decide limits and grid sums.
pub fn hypot(a: f64, b: f64) -> f64 {
    let (a, b) = (a.abs(), b.abs());
    let max = if a > b { a } else { b };
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut comp = 0.0;
    for v in [a, b] {
        let n = v / max;
        let s = n * n - comp;
        let pre = sum + s;
        comp = (pre - sum) - s;
        sum = pre;
    }
    sum.sqrt() * max
}

/// `Math.round` for the values the checks round: half rounds up, toward positive infinity.
pub fn round(v: f64) -> f64 {
    let f = v.floor();
    if v - f >= 0.5 { f + 1.0 } else { f }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hypot_of_simple_triangles() {
        assert_eq!(hypot(3.0, 4.0), 5.0);
        assert_eq!(hypot(-5.0, 12.0), 13.0);
        assert_eq!(hypot(0.0, 0.0), 0.0);
        assert_eq!(hypot(0.0, -7.0), 7.0);
    }

    #[test]
    fn hypot_follows_v8_not_sqrt() {
        // Values taken from Node: Math.hypot(1, 5) and Math.hypot(1, 6); sqrt gives the neighbours.
        assert_eq!(hypot(1.0, 5.0), 5.099019513592785);
        assert_ne!(26f64.sqrt(), 5.099019513592785);
        assert_eq!(hypot(1.0, 6.0), 6.0827625302982185);
        assert_eq!(hypot(7.0, 9.0), 11.40175425099138);
    }

    #[test]
    fn round_half_up() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(2.4999), 2.0);
        assert_eq!(round(-2.5), -2.0);
    }
}
