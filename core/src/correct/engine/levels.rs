//! The upper limits of the checks as the engine needs them (src/validation/thresholds.ts): the
//! thresholds come over as the plain object `thresholdsFor` makes, the levels are worked out here.

use serde::Deserialize;

pub const SAFE: u8 = 0;
pub const CAUTION: u8 = 1;
pub const CRITICAL: u8 = 2;

/// This many non-exempt short stitches in one 1 mm cell make it Critical.
pub const SHORT_STITCH_COUNT: i32 = 8;

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Holes {
    pub caution: f64,
    pub critical: f64,
}

/// Thresholds of thresholds.ts (the fields the upper limits use).
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thresholds {
    pub caution: f64,
    pub critical: f64,
    pub satin_caution: f64,
    pub satin_critical: f64,
    pub fill_denser: f64,
    #[serde(default)]
    pub holes: Option<Holes>,
}

/// Caution and Critical limits for a cell whose thread is `satin_share` (0 to 1) satin, blended by
/// the share of layers (densityLimits).
pub fn density_limits(th: &Thresholds, satin_share: f64) -> [f64; 2] {
    let s = satin_share.clamp(0.0, 1.0);
    let f = th.fill_denser;
    // Thread per layer-counted thread, and the satin share of the layers.
    let w = s + (1.0 - s) / f;
    let layers = if w > 0.0 { s / w } else { 0.0 };
    let blend = |fill: f64, satin: f64| (fill / f + layers * (satin - fill / f)) / w;
    [
        blend(th.caution, th.satin_caution),
        blend(th.critical, th.satin_critical),
    ]
}

pub fn classify_density(density: f64, satin_share: f64, th: &Thresholds) -> u8 {
    let [caution, critical] = density_limits(th, satin_share);
    if density >= critical {
        CRITICAL
    } else if density >= caution {
        CAUTION
    } else {
        SAFE
    }
}

pub fn classify_holes(neighbours: f64, th: &Thresholds) -> u8 {
    match th.holes {
        None => SAFE,
        Some(h) if neighbours >= h.critical => CRITICAL,
        Some(h) if neighbours >= h.caution => CAUTION,
        _ => SAFE,
    }
}

#[cfg(test)]
pub(crate) fn woven() -> Thresholds {
    Thresholds {
        caution: 14.0,
        critical: 24.0,
        satin_caution: 15.0,
        satin_critical: 17.5,
        fill_denser: 2.0,
        holes: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pure_fill_and_pure_satin_keep_their_limits() {
        let th = woven();
        assert_eq!(density_limits(&th, 0.0), [14.0, 24.0]);
        assert_eq!(density_limits(&th, 1.0), [15.0, 17.5]);
        assert_eq!(classify_density(24.0, 0.0, &th), CRITICAL);
        assert_eq!(classify_density(13.0, 0.0, &th), SAFE);
    }
}
