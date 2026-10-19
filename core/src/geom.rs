//! Points as the TypeScript core has them: `[x, y]` in millimetres (or pixels where a module says so),
//! and the small vector and polyline helpers the modules share.

use crate::js::{dist, hypot};

pub type Pt = [f64; 2];

/// Points from a flat list x0, y0, x1, y1, ... (a `Float64Array` on the JavaScript side).
pub fn pts_from_flat(flat: &[f64]) -> Vec<Pt> {
    flat.as_chunks::<2>().0.to_vec()
}

/// Points as a flat list x0, y0, x1, y1, ...
pub fn pts_to_flat(pts: &[Pt]) -> Vec<f64> {
    pts.iter().flat_map(|p| [p[0], p[1]]).collect()
}

#[inline]
pub fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}

#[inline]
pub fn add(a: Pt, b: Pt) -> Pt {
    [a[0] + b[0], a[1] + b[1]]
}

/// a + k·b.
#[inline]
pub fn add_scaled(a: Pt, b: Pt, k: f64) -> Pt {
    [a[0] + b[0] * k, a[1] + b[1] * k]
}

#[inline]
pub fn mul(a: Pt, k: f64) -> Pt {
    [a[0] * k, a[1] * k]
}

#[inline]
pub fn dot(a: Pt, b: Pt) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

#[inline]
pub fn cross(a: Pt, b: Pt) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

#[inline]
pub fn perp(v: Pt) -> Pt {
    [-v[1], v[0]]
}

#[inline]
pub fn mid(a: Pt, b: Pt) -> Pt {
    [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}

#[inline]
pub fn lerp(a: Pt, b: Pt, t: f64) -> Pt {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// The vector at length 1 (as it is when its length is 0 or NaN).
#[inline]
pub fn norm(v: Pt) -> Pt {
    let l = hypot(v[0], v[1]);
    let l = if l == 0.0 || l.is_nan() { 1.0 } else { l };
    [v[0] / l, v[1] / l]
}

/// The direction from a to b at length 1 (b - a itself when a and b are the same point).
pub fn unit(a: Pt, b: Pt) -> Pt {
    let l = match dist(a, b) {
        0.0 => 1.0,
        l => l,
    };
    [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
}

/// Distance from q to the segment from a to b.
pub fn to_segment(q: Pt, a: Pt, b: Pt) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 != 0.0 {
        (((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    hypot(q[0] - a[0] - dx * t, q[1] - a[1] - dy * t)
}

/// Length of a polyline.
pub fn polyline_length(pts: &[Pt]) -> f64 {
    let mut l = 0.0;
    for i in 1..pts.len() {
        l += dist(pts[i - 1], pts[i]);
    }
    l
}

/// Length along the polyline up to each of its points.
pub fn cumulative(pts: &[Pt]) -> Vec<f64> {
    let mut out = Vec::with_capacity(pts.len().max(1));
    out.push(0.0);
    for i in 1..pts.len() {
        out.push(out[i - 1] + dist(pts[i - 1], pts[i]));
    }
    out
}

/// The point at distance `s` along the polyline (`cum` from cumulative).
pub fn point_at(pts: &[Pt], cum: &[f64], s: f64) -> Pt {
    if s <= 0.0 {
        return pts[0];
    }
    let n = pts.len() - 1;
    if s >= cum[n] {
        return pts[n];
    }
    let (mut lo, mut hi) = (0, n);
    while hi - lo > 1 {
        let m = (lo + hi) >> 1;
        if cum[m] <= s {
            lo = m;
        } else {
            hi = m;
        }
    }
    let l = cum[hi] - cum[lo];
    if l > 0.0 {
        lerp(pts[lo], pts[hi], (s - cum[lo]) / l)
    } else {
        pts[lo]
    }
}

/// Points without those on the one before.
pub fn dedupe(pts: Vec<Pt>) -> Vec<Pt> {
    let mut kept: Vec<Pt> = Vec::with_capacity(pts.len());
    for (i, &p) in pts.iter().enumerate() {
        if i == 0 || dist(p, pts[i - 1]) > 1e-6 {
            kept.push(p);
        }
    }
    kept
}

/// Twice the signed area of a loop whose last point repeats the first (its sign tells which way
/// round it goes).
pub fn twice_area(ring: &[Pt]) -> f64 {
    let mut a = 0.0;
    for i in 1..ring.len() {
        a += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
    }
    a
}

/// Signed area of a closed polyline (the last point joined to the first).
pub fn signed_area(pts: &[Pt]) -> f64 {
    let mut a = 0.0;
    let mut j = pts.len().wrapping_sub(1);
    for i in 0..pts.len() {
        a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
        j = i;
    }
    a / 2.0
}

/// The box around the points, [x0, y0, x1, y1] (infinite the wrong way round for none).
pub fn bounds_of(pts: &[Pt]) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for &[x, y] in pts {
        b = [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)];
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_round_trip() {
        let pts = vec![[1.0, 2.0], [3.5, -4.0]];
        assert_eq!(pts_from_flat(&pts_to_flat(&pts)), pts);
    }

    #[test]
    fn polyline_measures() {
        let l = [[0.0, 0.0], [3.0, 0.0], [3.0, 4.0]];
        assert_eq!(polyline_length(&l), 7.0);
        let cum = cumulative(&l);
        assert_eq!(cum, vec![0.0, 3.0, 7.0]);
        assert_eq!(point_at(&l, &cum, 5.0), [3.0, 2.0]);
        assert_eq!(point_at(&l, &cum, -1.0), [0.0, 0.0]);
        assert_eq!(to_segment([1.0, 1.0], [0.0, 0.0], [3.0, 0.0]), 1.0);
        assert_eq!(to_segment([5.0, 0.0], [0.0, 0.0], [3.0, 0.0]), 2.0);
        let sq = [[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]];
        assert_eq!(signed_area(&sq).abs(), 4.0);
        let closed = [sq.as_slice(), &[sq[0]]].concat();
        assert_eq!(twice_area(&closed), 8.0);
        assert_eq!(bounds_of(&sq), [0.0, 0.0, 2.0, 2.0]);
        assert_eq!(dedupe(vec![[0.0, 0.0], [0.0, 0.0], [1.0, 0.0]]).len(), 2);
    }
}
