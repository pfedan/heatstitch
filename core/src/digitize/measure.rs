//! Measurements of generated stitches, to check them before they are used.

use super::region::Region;
use crate::geom::Pt;
use crate::js::{IdMap, hypot, round};

/// Thread per area (mm/mm²) at the densest 1 mm cell of the runs. A satin column reaches about
/// 2 / spacing; where a tight bend fans its stitches or columns pile up, the generated satin is
/// measured instead of predicted. Cells where `skip` holds for their middle are not counted.
pub fn peak_density(runs: &[Vec<Pt>], skip: impl Fn(f64, f64) -> bool) -> f64 {
    peak_cell(runs, skip).0
}

/// The densest 1 mm cell of the runs (see peak_density): its density and its middle.
pub fn peak_cell(runs: &[Vec<Pt>], skip: impl Fn(f64, f64) -> bool) -> (f64, Pt) {
    // Cells in the order they were first met: of equal ones the first wins, as in the TypeScript twin.
    let mut index: IdMap<i64, usize> = IdMap::default();
    let mut cells: Vec<(i64, f64)> = Vec::new();
    for run in runs {
        for i in 1..run.len() {
            let [x0, y0] = run[i - 1];
            let [x1, y1] = run[i];
            let len = hypot(x1 - x0, y1 - y0);
            let n = (len / 0.2).ceil().max(1.0) as usize;
            for k in 0..n {
                let x = x0 + ((x1 - x0) * (k as f64 + 0.5)) / n as f64;
                let y = y0 + ((y1 - y0) * (k as f64 + 0.5)) / n as f64;
                let key = x.floor() as i64 * 100003 + y.floor() as i64;
                let at = *index.entry(key).or_insert_with(|| {
                    cells.push((key, 0.0));
                    cells.len() - 1
                });
                cells[at].1 += len / n as f64;
            }
        }
    }
    let mut best = (0.0, [0.0, 0.0]);
    for &(key, v) in &cells {
        if v <= best.0 {
            continue;
        }
        let x = round(key as f64 / 100003.0);
        let at = [x + 0.5, key as f64 - x * 100003.0 + 0.5];
        if skip(at[0], at[1]) {
            continue;
        }
        best = (v, at);
    }
    best
}

/// Share of the region's pixels within `rad_mm` (0.2 mm) of a stitch. That closes the gaps of a satin column
/// (its stitches lie at most one spacing apart), not those between columns fanning out from a
/// junction, which a triangle or a blot would get.
pub fn coverage(r: &Region, runs: &[Vec<Pt>], rad_mm: f64) -> f64 {
    coverage_of(&r.mask, r.w, r.h, r.x0, r.y0, r.px_mm, runs, rad_mm)
}

/// [`coverage`] on a bare mask and window.
pub fn coverage_of(
    mask: &[u8],
    w: usize,
    h: usize,
    x0: i32,
    y0: i32,
    px_mm: f64,
    runs: &[Vec<Pt>],
    rad_mm: f64,
) -> f64 {
    let mut hit = vec![0u8; mask.len()];
    let rad = round(rad_mm / px_mm).max(1.0) as i64;
    let step = px_mm / 2.0;
    let (wi, hi) = (w as i64, h as i64);
    for run in runs {
        for i in 1..run.len() {
            let [ax, ay] = run[i - 1];
            let [bx, by] = run[i];
            let n = (hypot(bx - ax, by - ay) / step).ceil().max(1.0) as usize;
            for k in 0..=n {
                let cx = ((ax + ((bx - ax) * k as f64) / n as f64) / px_mm).floor() as i64
                    - i64::from(x0);
                let cy = ((ay + ((by - ay) * k as f64) / n as f64) / px_mm).floor() as i64
                    - i64::from(y0);
                for y in (cy - rad).max(0)..=(cy + rad).min(hi - 1) {
                    for x in (cx - rad).max(0)..=(cx + rad).min(wi - 1) {
                        hit[(y * wi + x) as usize] = 1;
                    }
                }
            }
        }
    }
    let mut inside = 0usize;
    let mut covered = 0usize;
    for i in 0..mask.len() {
        if mask[i] == 0 {
            continue;
        }
        inside += 1;
        covered += usize::from(hit[i]);
    }
    if inside > 0 {
        covered as f64 / inside as f64
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    #[test]
    fn a_satin_column_reaches_two_over_its_spacing() {
        // Zigzag 4 mm wide, 0.4 mm spacing.
        let run: Vec<Pt> = (0..60)
            .map(|i| [i as f64 * 0.2, if i % 2 == 0 { 0.0 } else { 4.0 }])
            .collect();
        let d = peak_density(std::slice::from_ref(&run), |_, _| false);
        assert!(d > 4.0 && d < 6.5, "{d}");
        let (d2, at) = peak_cell(&[run], |x, _| x < 6.0);
        assert!(d2 <= d && at[0] >= 6.0);
    }

    #[test]
    fn coverage_of_a_bar_by_its_satin() {
        let r = region_of(120, 0.1, |x, y| {
            (2.0..10.0).contains(&x) && (2.0..4.0).contains(&y)
        });
        let zig: Vec<Pt> = (0..41)
            .map(|i| [2.0 + i as f64 * 0.2, if i % 2 == 0 { 2.0 } else { 4.0 }])
            .collect();
        assert!(coverage(&r, &[zig], 0.2) > 0.95);
        assert!(coverage(&r, &[vec![[2.0, 3.0], [10.0, 3.0]]], 0.2) < 0.4);
        assert_eq!(coverage(&r, &[], 0.2), 0.0);
    }

    #[test]
    fn the_same_peak_as_typescript() {
        let curve: Vec<Pt> = (0..81)
            .map(|i| {
                [
                    i as f64 / 4.0,
                    (i * i) as f64 / 160.0 + (i % 3) as f64 * 0.01,
                ]
            })
            .collect();
        let zig: Vec<Pt> = (0..40)
            .map(|i| {
                [
                    i as f64 * 0.15 + (i % 5) as f64 * 0.01,
                    if i % 2 == 1 { 3.3 } else { 0.2 },
                ]
            })
            .collect();
        assert_eq!(
            peak_cell(&[zig.clone(), curve], |_, _| false),
            (7.8670462774855014, [3.5, 1.5])
        );
        assert_eq!(peak_density(&[zig], |x, _| x < 2.0), 6.789596473597863);
    }
}
