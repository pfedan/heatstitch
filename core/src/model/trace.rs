//! Areas read from stitches and grown from fields (traceRegionNow in src/model/restitch.ts,
//! grownArea in src/model/geo.ts). Which stitches are traced and the caches of what was traced
//! stay TypeScript.

use crate::digitize::region::Region;
use crate::image::edt::distance_to_seeds;
use crate::js::hypot;
use crate::shape::rasterize::region_of;

/// Empty pixels round a traced area in its window.
const MARGIN: i64 = 4;

/// The area the stitches `segs` cover (each from x, y to x, y in 0.1 mm): drawn `reach` mm thick
/// and closed by as much, so rows up to 2 * reach apart merge and the edge lies at the row ends;
/// then opened by `open`, which removes lines narrower than 2 * open (travel, outlines). Without
/// `close` the lines just stay `reach` thick (where the thread went).
pub fn trace_region(segs: &[[f64; 4]], reach: f64, open: f64, close: bool) -> Option<Region> {
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for s in segs {
        for (x, y) in [(s[0], s[1]), (s[2], s[3])] {
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }
    }
    if !min_x.is_finite() {
        return None;
    }
    let w_mm = (max_x - min_x) / 10.0 + 2.0 * reach;
    let h_mm = (max_y - min_y) / 10.0 + 2.0 * reach;
    let px = 0.05f64.max(((w_mm * h_mm) / 1.5e6).sqrt()).max(reach / 5.0);
    let x0 = ((min_x / 10.0 - reach) / px).floor() as i64 - MARGIN;
    let y0 = ((min_y / 10.0 - reach) / px).floor() as i64 - MARGIN;
    let w = ((w_mm / px).ceil() as i64 + 2 * MARGIN + 2) as usize;
    let h = ((h_mm / px).ceil() as i64 + 2 * MARGIN + 2) as usize;
    let mut seed = vec![0u8; w * h];
    let mut put = |x_mm: f64, y_mm: f64| {
        let x = (x_mm / px).floor() as i64 - x0;
        let y = (y_mm / px).floor() as i64 - y0;
        if x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h {
            seed[y as usize * w + x as usize] = 1;
        }
    };
    for s in segs {
        let (ax, ay, bx, by) = (s[0] / 10.0, s[1] / 10.0, s[2] / 10.0, s[3] / 10.0);
        let n = 1.0f64.max((hypot(bx - ax, by - ay) / (px / 2.0)).ceil()) as usize;
        for k in 0..=n {
            let t = k as f64;
            put(
                ax + ((bx - ax) * t) / n as f64,
                ay + ((by - ay) * t) / n as f64,
            );
        }
    }
    // Pixel centers sit half a pixel off the seeds' corners: measure from the centers.
    let r = reach / px;
    let near = distance_to_seeds(&seed, w, h, false);
    let outside: Vec<u8> = near.iter().map(|&d| u8::from(f64::from(d) > r)).collect();
    let far = distance_to_seeds(&outside, w, h, false);
    let mut mask: Vec<u8> = (0..w * h)
        .map(|i| {
            u8::from(if close {
                f64::from(far[i]) > r
            } else {
                f64::from(near[i]) <= r
            })
        })
        .collect();
    if open > 0.0 {
        let o = open / px;
        let out: Vec<u8> = mask.iter().map(|&m| 1 - m).collect();
        let to_out = distance_to_seeds(&out, w, h, false);
        let core: Vec<u8> = to_out.iter().map(|&d| u8::from(f64::from(d) > o)).collect();
        let to_core = distance_to_seeds(&core, w, h, false);
        mask = to_core
            .iter()
            .map(|&d| u8::from(f64::from(d) <= o))
            .collect();
    }
    region_of(mask, x0 as i32, y0 as i32, w, h, px, None)
}

/// The pixels of a field below `grow` mm: its area grown by `grow` (shrunk when negative).
pub fn grown_mask(sdf: &[f32], grow: f64) -> Vec<u8> {
    sdf.iter().map(|&d| u8::from(f64::from(d) < grow)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_close_into_an_area() {
        // Rows 10 mm long, 0.4 mm apart, 20 of them: about 10 by 7.6 mm.
        let segs: Vec<[f64; 4]> = (0..20)
            .map(|k| [0.0, f64::from(k) * 4.0, 100.0, f64::from(k) * 4.0])
            .collect();
        let r = trace_region(&segs, 0.3, 0.0, true).unwrap();
        assert!((r.area_mm2 - 76.0).abs() < 6.0, "{}", r.area_mm2);
        // Without closing, only where the thread went: less.
        let lines = trace_region(&segs, 0.05, 0.0, false).unwrap();
        assert!(
            lines.area_mm2 < r.area_mm2 / 2.0,
            "{} {}",
            lines.area_mm2,
            r.area_mm2
        );
        // A lone line is opened away.
        assert!(trace_region(&segs[..1], 0.3, 0.5, true).is_none());
        assert!(trace_region(&[], 0.3, 0.0, true).is_none());
    }

    #[test]
    fn grows_by_the_field() {
        let sdf = [-0.5f32, -0.1, 0.1, 0.5];
        assert_eq!(grown_mask(&sdf, 0.0), vec![1, 1, 0, 0]);
        assert_eq!(grown_mask(&sdf, 0.2), vec![1, 1, 1, 0]);
    }
}
