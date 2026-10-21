//! Thread sewn later, as seen from one run (src/correct/cover.ts). Built by walking the runs from
//! last to first: when a run is visited, the raster holds exactly the stitching that lies on top
//! of it.

use crate::js::{IdMap, hypot, round};
use crate::pattern::{Bounds, COLOR_CHANGE, Records, STITCH};
use crate::validation::kinds::Run;

/// Raster cell for coverage lookups, 0.1 mm units (0.2 mm).
const CELL: f64 = 2.0;
/// Coverage is the thread per area within this box half size (0.1 mm): a 0.6 x 0.6 mm window, fine
/// enough that the gap between two outlines half a millimetre apart does not read as covered.
const HALF: f64 = 3.0;

struct Raster {
    x0: f64,
    y0: f64,
    cols: i64,
    rows: i64,
    data: Vec<f32>,
}

impl Raster {
    fn new(x0: f64, y0: f64, cols: i64, rows: i64) -> Raster {
        Raster {
            x0,
            y0,
            cols,
            rows,
            data: vec![0.0; (cols * rows) as usize],
        }
    }

    fn add_segment(&mut self, ax: f64, ay: f64, bx: f64, by: f64) {
        let l = hypot(bx - ax, by - ay);
        let n = (l / 0.5).ceil().max(1.0);
        // mm per sample
        let w = l / n / 10.0;
        let n = n as i64;
        for k in 0..n {
            let t = (k as f64 + 0.5) / n as f64;
            let cx = ((ax + (bx - ax) * t - self.x0) / CELL).floor() as i64;
            let cy = ((ay + (by - ay) * t - self.y0) / CELL).floor() as i64;
            if cx >= 0 && cy >= 0 && cx < self.cols && cy < self.rows {
                let i = (cy * self.cols + cx) as usize;
                self.data[i] = (self.data[i] as f64 + w) as f32;
            }
        }
    }

    /// mm of thread per mm² in the window around (x, y).
    fn density(&self, x: f64, y: f64) -> f64 {
        let r = round(HALF / CELL) as i64;
        let cx = ((x - self.x0) / CELL).floor() as i64;
        let cy = ((y - self.y0) / CELL).floor() as i64;
        let mut s = 0.0;
        // The window clamped to the raster once, rows summed as slices: the hot loop of the
        // pull-back and the hidden test. Same order of additions as the TypeScript.
        let (i0, i1) = ((cx - r).max(0), (cx + r).min(self.cols - 1));
        if i0 <= i1 {
            for j in (cy - r).max(0)..=(cy + r).min(self.rows - 1) {
                let row = (j * self.cols) as usize;
                for &v in &self.data[row + i0 as usize..=row + i1 as usize] {
                    s += v as f64;
                }
            }
        }
        let side = ((2 * r + 1) as f64 * CELL) / 10.0;
        s / (side * side)
    }
}

/// What lies on top of the run being visited.
pub struct Cover {
    all: Raster,
    later: Raster,
    sat: Raster,
    /// Satin segments (record of their end) by 1 mm bucket, for width lookups.
    buckets: IdMap<i64, Vec<usize>>,
}

#[inline]
fn key(bx: i64, by: i64) -> i64 {
    bx * 1_000_003 + by
}

impl Cover {
    /// Thread per area (mm/mm²) around (x, y) in 0.1 mm, of later runs in other color blocks.
    /// Later runs in the same thread are left out: a second layer in the same color is a
    /// deliberate base or texture layer, not cover.
    pub fn all(&self, x: f64, y: f64) -> f64 {
        self.all.density(x, y)
    }
    /// Same, counting every later run, also in the same color.
    pub fn later(&self, x: f64, y: f64) -> f64 {
        self.later.density(x, y)
    }
    /// Same, counting only later satin stitches.
    pub fn satin(&self, x: f64, y: f64) -> f64 {
        self.sat.density(x, y)
    }
    /// Length (0.1 mm) of the later satin stitch of `p` passing closest to (x, y), within 0.5 mm, or 0.
    pub fn satin_width(&self, p: &Records, x: f64, y: f64) -> f64 {
        let mut best = 5.0;
        let mut width = 0.0;
        let bx = (x / 10.0).floor() as i64;
        let by = (y / 10.0).floor() as i64;
        for dy in -2..=2 {
            for dx in -2..=2 {
                let Some(list) = self.buckets.get(&key(bx + dx, by + dy)) else {
                    continue;
                };
                for &i in list {
                    let ax = p.x[i - 1] as f64;
                    let ay = p.y[i - 1] as f64;
                    let ex = p.x[i] as f64 - ax;
                    let ey = p.y[i] as f64 - ay;
                    let l2 = ex * ex + ey * ey;
                    let t = if l2 != 0.0 {
                        (((x - ax) * ex + (y - ay) * ey) / l2).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let d = hypot(ax + t * ex - x, ay + t * ey - y);
                    if d < best {
                        best = d;
                        width = l2.sqrt();
                    }
                }
            }
        }
        width
    }
}

/// Calls `visit` for every run from the last to the first, with the coverage of everything sewn
/// after it. `satin[i]` marks satin segments (ending at record i), `b` are the design's bounds.
/// The visitor may move points of the run it visits (pull-back does): the raster takes the run in
/// as it is after the visit.
pub fn walk_covered(
    p: &mut Records,
    b: Bounds,
    runs: &[Run],
    satin: &[u8],
    mut visit: impl FnMut(&mut Records, usize, &Cover),
) {
    let pad = 20.0;
    let x0 = b.min_x as f64 - pad;
    let y0 = b.min_y as f64 - pad;
    let cols = (((b.max_x - b.min_x) as f64 + 2.0 * pad) / CELL)
        .ceil()
        .max(1.0) as i64;
    let rows = (((b.max_y - b.min_y) as f64 + 2.0 * pad) / CELL)
        .ceil()
        .max(1.0) as i64;
    let mut cover = Cover {
        all: Raster::new(x0, y0, cols, rows),
        later: Raster::new(x0, y0, cols, rows),
        sat: Raster::new(x0, y0, cols, rows),
        buckets: IdMap::default(),
    };
    // Color block of every run; runs of the current block wait until an earlier block is reached.
    let mut block = vec![0usize; runs.len()];
    let mut b0 = 0;
    let mut r0 = 0;
    let mut i = 0;
    while i < p.cmd.len() && r0 < runs.len() {
        if p.cmd[i] == COLOR_CHANGE {
            b0 += 1;
        }
        if i == runs[r0].start {
            block[r0] = b0;
            r0 += 1;
        }
        i += 1;
    }
    let mut pending: Vec<usize> = vec![];
    let seg = |p: &Records, i: usize| {
        (
            p.x[i - 1] as f64,
            p.y[i - 1] as f64,
            p.x[i] as f64,
            p.y[i] as f64,
        )
    };
    for r in (0..runs.len()).rev() {
        if !pending.is_empty() && block[pending[0]] != block[r] {
            for &q in &pending {
                for i in runs[q].start + 1..=runs[q].end {
                    if p.cmd[i] == STITCH && p.cmd[i - 1] == STITCH {
                        let (ax, ay, bx, by) = seg(p, i);
                        cover.all.add_segment(ax, ay, bx, by);
                    }
                }
            }
            pending.clear();
        }
        visit(p, r, &cover);
        pending.push(r);
        let Run { start, end } = runs[r];
        for i in start + 1..=end {
            if p.cmd[i] != STITCH || p.cmd[i - 1] != STITCH {
                continue;
            }
            let (ax, ay, bx, by) = seg(p, i);
            cover.later.add_segment(ax, ay, bx, by);
            if satin[i] == 0 {
                continue;
            }
            cover.sat.add_segment(ax, ay, bx, by);
            // Register the segment in every bucket it passes through.
            let l = hypot(bx - ax, by - ay);
            let n = (l / 5.0).ceil().max(1.0) as i64;
            let mut seen: Vec<i64> = Vec::with_capacity(n as usize + 1);
            for k in 0..=n {
                let kx = ((ax + ((bx - ax) * k as f64) / n as f64) / 10.0).floor() as i64;
                let ky = ((ay + ((by - ay) * k as f64) / n as f64) / 10.0).floor() as i64;
                let kk = key(kx, ky);
                if seen.contains(&kk) {
                    continue;
                }
                seen.push(kk);
                cover.buckets.entry(kk).or_default().push(i);
            }
        }
    }
}
