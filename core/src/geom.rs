//! Points as the TypeScript core has them: `[x, y]` in millimetres (or pixels where a module says so).

pub type Pt = [f64; 2];

/// Points from a flat list x0, y0, x1, y1, ... (a `Float64Array` on the JavaScript side).
pub fn pts_from_flat(flat: &[f64]) -> Vec<Pt> {
    flat.as_chunks::<2>().0.to_vec()
}

/// Points as a flat list x0, y0, x1, y1, ...
pub fn pts_to_flat(pts: &[Pt]) -> Vec<f64> {
    pts.iter().flat_map(|p| [p[0], p[1]]).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_round_trip() {
        let pts = vec![[1.0, 2.0], [3.5, -4.0]];
        assert_eq!(pts_from_flat(&pts_to_flat(&pts)), pts);
    }
}
