//! The density grid of a design (src/density/grid.ts): thread length or penetrations per mm² on a
//! regular grid, optionally smoothed. The thread of every stitch is split exactly over the cells it
//! crosses, so the grid sums to the thread length (or the stitch count) before smoothing.

use super::blur::gaussian_blur;
use crate::js::hypot;
use crate::pattern::{COLOR_CHANGE, Records, STITCH, TRIM};
use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Metric {
    Thread,
    Penetrations,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DensityOptions {
    pub metric: Metric,
    /// Cell edge length in mm.
    pub cell_mm: f64,
    /// Gaussian sigma in mm, 0 disables smoothing.
    pub blur_mm: f64,
    /// Count untrimmed jump threads as thread (thread metric only).
    pub include_jumps: bool,
    /// Snap the grid origin to multiples of this (mm); defaults to the cell size.
    #[serde(default)]
    pub align_mm: Option<f64>,
    /// Added to the snapped origin (mm).
    #[serde(default)]
    pub shift_mm: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DensityGrid {
    /// Row-major values: mm thread per mm² or penetrations per mm².
    pub data: Vec<f32>,
    pub cols: usize,
    pub rows: usize,
    /// World position (mm, y down) of the top-left corner of cell (0, 0).
    pub origin_x: f64,
    pub origin_y: f64,
    pub cell_mm: f64,
    pub max: f64,
}

/// Calls `cb(x0, y0, x1, y1, end)` for every straight piece of thread on the fabric (0.1 mm), as
/// forEachThreadSegment in model/pattern.ts: a stitch after a stitch, and with `include_jumps` the
/// thread a run of jumps without trim or color change leaves between two stitches.
pub fn for_each_thread_segment(
    p: &Records,
    include_jumps: bool,
    mut cb: impl FnMut(i32, i32, i32, i32, usize),
) {
    let mut has_last = false;
    let (mut last_x, mut last_y) = (0, 0);
    let mut prev_cmd = TRIM;
    let mut cut = true;
    for i in 0..p.cmd.len() {
        let c = p.cmd[i];
        if c == STITCH {
            if has_last && (prev_cmd == STITCH || (include_jumps && !cut)) {
                cb(last_x, last_y, p.x[i], p.y[i], i);
            }
            has_last = true;
            last_x = p.x[i];
            last_y = p.y[i];
            cut = false;
        } else if c == TRIM || c == COLOR_CHANGE {
            cut = true;
        }
        prev_cmd = c;
    }
}

/// Adds `length` to every cell the segment a->b (cell units) passes, split exactly by crossing points.
pub fn add_segment(
    data: &mut [f32],
    cols: usize,
    rows: usize,
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    length: f64,
) {
    let mut cx = ax.floor();
    let mut cy = ay.floor();
    let dx = bx - ax;
    let dy = by - ay;
    let step_x = if dx > 0.0 { 1.0 } else { -1.0 };
    let step_y = if dy > 0.0 { 1.0 } else { -1.0 };
    let t_delta_x = if dx != 0.0 {
        (1.0 / dx).abs()
    } else {
        f64::INFINITY
    };
    let t_delta_y = if dy != 0.0 {
        (1.0 / dy).abs()
    } else {
        f64::INFINITY
    };
    let mut t_max_x = if dx > 0.0 {
        (cx + 1.0 - ax) / dx
    } else if dx < 0.0 {
        (cx - ax) / dx
    } else {
        f64::INFINITY
    };
    let mut t_max_y = if dy > 0.0 {
        (cy + 1.0 - ay) / dy
    } else if dy < 0.0 {
        (cy - ay) / dy
    } else {
        f64::INFINITY
    };
    let mut t = 0.0;
    // Upper bound on visited cells guards against float edge cases.
    let mut guard = (bx.floor() - cx).abs() + (by.floor() - cy).abs() + 2.0;
    while guard > 0.0 {
        guard -= 1.0;
        let t_next = t_max_x.min(t_max_y).min(1.0);
        if cx >= 0.0 && cy >= 0.0 && cx < cols as f64 && cy < rows as f64 {
            let i = cy as usize * cols + cx as usize;
            data[i] = (data[i] as f64 + (t_next - t) * length) as f32;
        }
        if t_next >= 1.0 {
            return;
        }
        t = t_next;
        if t_max_x < t_max_y {
            cx += step_x;
            t_max_x += t_delta_x;
        } else {
            cy += step_y;
            t_max_y += t_delta_y;
        }
    }
}

/// Builds the density grid over `bounds` (min x, min y, max x, max y in 0.1 mm; the caller's, which
/// may be grown beyond the stitches). `keep`, when given, excludes records set to 0: for the thread
/// metric the record a thread piece ends at, for penetrations the stitch record itself.
pub fn compute_density(
    p: &Records,
    bounds: [f64; 4],
    opt: &DensityOptions,
    keep: Option<&[u8]>,
) -> DensityGrid {
    let cell = opt.cell_mm;
    let sigma_cells = if opt.blur_mm > 0.0 {
        opt.blur_mm / cell
    } else {
        0.0
    };
    let pad = (3.0 * sigma_cells).ceil() + 1.0;
    let [min_x, min_y, max_x, max_y] = bounds;
    let align = opt.align_mm.unwrap_or(cell);
    let shift = opt.shift_mm.unwrap_or(0.0);
    let pad_mm = ((pad * cell) / align - 1e-9).ceil() * align;
    let origin_x = (min_x / 10.0 / align).floor() * align - pad_mm + shift;
    let origin_y = (min_y / 10.0 / align).floor() * align - pad_mm + shift;
    let cols = (((max_x / 10.0 - origin_x) / cell).floor() + 1.0 + pad).max(0.0) as usize;
    let rows = (((max_y / 10.0 - origin_y) / cell).floor() + 1.0 + pad).max(0.0) as usize;
    let mut data = vec![0f32; cols * rows];
    let to_cell = |v: i32, o: f64| (v as f64 / 10.0 - o) / cell;
    let kept = |i: usize| keep.is_none_or(|k| k[i] != 0);

    match opt.metric {
        Metric::Thread => for_each_thread_segment(p, opt.include_jumps, |x0, y0, x1, y1, end| {
            if !kept(end) {
                return;
            }
            let len = hypot((x1 - x0) as f64, (y1 - y0) as f64) / 10.0;
            if len == 0.0 {
                return;
            }
            add_segment(
                &mut data,
                cols,
                rows,
                to_cell(x0, origin_x),
                to_cell(y0, origin_y),
                to_cell(x1, origin_x),
                to_cell(y1, origin_y),
                len,
            );
        }),
        Metric::Penetrations => {
            for i in 0..p.cmd.len() {
                if p.cmd[i] != STITCH || !kept(i) {
                    continue;
                }
                let cx = to_cell(p.x[i], origin_x).floor();
                let cy = to_cell(p.y[i], origin_y).floor();
                if cx >= 0.0 && cy >= 0.0 && cx < cols as f64 && cy < rows as f64 {
                    let c = cy as usize * cols + cx as usize;
                    data[c] = (data[c] as f64 + 1.0) as f32;
                }
            }
        }
    }

    let area = cell * cell;
    for v in data.iter_mut() {
        *v = (*v as f64 / area) as f32;
    }
    if sigma_cells > 0.0 {
        data = gaussian_blur(&data, cols, rows, sigma_cells);
    }
    let max = data.iter().fold(0f32, |m, &v| if v > m { v } else { m }) as f64;
    DensityGrid {
        data,
        cols,
        rows,
        origin_x,
        origin_y,
        cell_mm: cell,
        max,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pattern::JUMP;

    fn records(pts: &[(i32, i32, u8)]) -> Records {
        Records {
            x: pts.iter().map(|p| p.0).collect(),
            y: pts.iter().map(|p| p.1).collect(),
            cmd: pts.iter().map(|p| p.2).collect(),
            colors: vec![],
        }
    }

    fn bounds(p: &Records) -> [f64; 4] {
        let b = p.bounds();
        [
            b.min_x as f64,
            b.min_y as f64,
            b.max_x as f64,
            b.max_y as f64,
        ]
    }

    #[test]
    fn segment_splits_over_cells() {
        let mut d = vec![0f32; 4];
        add_segment(&mut d, 4, 1, 0.5, 0.5, 3.5, 0.5, 3.0);
        assert_eq!(d, vec![0.5, 1.0, 1.0, 0.5]);
        let mut d = vec![0f32; 100];
        add_segment(&mut d, 10, 10, 0.3, 0.7, 8.9, 6.2, 7.0);
        let s: f64 = d.iter().map(|&v| v as f64).sum();
        assert!((s - 7.0).abs() < 1e-5);
    }

    #[test]
    fn thread_sums_to_length() {
        let p = records(&[
            (0, 0, STITCH),
            (100, 0, STITCH),
            (100, 37, STITCH),
            (300, 300, JUMP),
            (310, 300, STITCH),
        ]);
        for blur in [0.0, 0.6] {
            let opt = DensityOptions {
                metric: Metric::Thread,
                cell_mm: 0.5,
                blur_mm: blur,
                include_jumps: false,
                align_mm: None,
                shift_mm: None,
            };
            let g = compute_density(&p, bounds(&p), &opt, None);
            let s: f64 = g.data.iter().map(|&v| v as f64).sum::<f64>() * 0.25;
            assert!((s - 13.7).abs() < 1e-3, "{s}");
            let with_jumps = compute_density(
                &p,
                bounds(&p),
                &DensityOptions {
                    include_jumps: true,
                    ..opt
                },
                None,
            );
            let s: f64 = with_jumps.data.iter().map(|&v| v as f64).sum::<f64>() * 0.25;
            assert!(s > 13.7 + 20.0);
        }
    }

    #[test]
    fn penetrations_and_filter() {
        let p = records(&[
            (0, 0, STITCH),
            (10, 0, STITCH),
            (20, 0, STITCH),
            (30, 0, STITCH),
        ]);
        let opt = DensityOptions {
            metric: Metric::Penetrations,
            cell_mm: 1.0,
            blur_mm: 0.0,
            include_jumps: false,
            align_mm: None,
            shift_mm: None,
        };
        let g = compute_density(&p, bounds(&p), &opt, None);
        assert_eq!(g.data.iter().sum::<f32>(), 4.0);
        let g = compute_density(&p, bounds(&p), &opt, Some(&[1, 0, 1, 0]));
        assert_eq!(g.data.iter().sum::<f32>(), 2.0);
        assert_eq!(g.max, 1.0);
    }
}
