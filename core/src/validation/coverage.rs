//! The lower limits a design has to keep (src/validation/coverage.ts): fabric that shows through,
//! gaps that open where the thread pulls the fabric in, and stitches long enough to snag.

use super::kinds::{FILL, SATIN};
use crate::js::{hypot, round};
use crate::pattern::{Records, STITCH};
use std::f64::consts::PI;

/// Raster for gaps (mm per pixel) and the half width of the thread drawn on it (40 wt).
const PX: f64 = 0.1;
const THREAD_R: i64 = 2;
/// A gap needs thread of two objects within this many pixels on opposite sides.
const REACH: i32 = 8;
/// Pixels per 1 mm cell.
const PER: usize = 10;

/// How far rows and satin stitches pull in at each end: a share of their length, at most `cap` mm.
#[derive(Clone, Copy, Debug)]
pub struct Pull {
    pub share: f64,
    pub cap: f64,
}
/// On stable fabric (woven, caps, leather) and on stretchy or soft fabric (knits, terry).
pub const PULL_LOW: Pull = Pull {
    share: 0.015,
    cap: 0.25,
};
pub const PULL_HIGH: Pull = Pull {
    share: 0.03,
    cap: 0.45,
};

/// Stitches that change direction by less than this (radians) continue the same row.
const ROW_TURN: f64 = (25.0 * PI) / 180.0;
/// In `skip`: a record of the placement line of an appliqué, whose fabric covers the ground.
pub const PATCH: u8 = 2;
/// Cells count as stitched area from this mean density on (mm/mm²).
const STITCHED: f64 = 0.9;
/// A run of stitches enclosing less than this (mm²) has not come round yet.
const LOOP_MM2: f64 = 0.5;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct CoverageMeasure {
    /// Mean thread density of cells well inside stitched area, else 0.
    pub cover: Vec<f32>,
    /// Gap pixels (0.01 mm² each) per cell after pull: on stable and on stretchy fabric.
    pub gaps_low: Vec<u8>,
    pub gaps_high: Vec<u8>,
    /// Longest stitch ending in each cell (0.1 mm).
    pub longest: Vec<u16>,
}

/// The gap raster: origin (mm) and size in pixels.
#[derive(Clone, Copy)]
struct Grid {
    ox: f64,
    oy: f64,
    w: usize,
    h: usize,
}

fn cell_at(x: i32, y: i32, ox: f64, oy: f64, cols: usize, rows: usize) -> Option<usize> {
    let cx = (x as f64 / 10.0 - ox).floor();
    let cy = (y as f64 / 10.0 - oy).floor();
    (cx >= 0.0 && cy >= 0.0 && cx < cols as f64 && cy < rows as f64)
        .then(|| cy as usize * cols + cx as usize)
}

/// Lower-limit measurements on the 1 mm grid at (origin_x, origin_y). `mean` is the mean thread
/// density per cell; records with `skip` set do not count for fabric showing through. `kinds` are
/// the stitch kinds (kinds.rs), only read for the gaps.
pub fn measure_coverage(
    p: &Records,
    mean: &[f32],
    origin_x: f64,
    origin_y: f64,
    cols: usize,
    rows: usize,
    skip: Option<&[u8]>,
    gaps: bool,
    kinds: impl FnOnce() -> Vec<u8>,
) -> CoverageMeasure {
    let n = cols * rows;
    let mut cover = vec![0f32; n];
    let skipped = skip.map(|s| cells_of(p, s, origin_x, origin_y, cols, rows));
    // Well inside: everything within 2 mm is stitched too.
    const R: usize = 2;
    for cy in R..rows.saturating_sub(R) {
        for cx in R..cols.saturating_sub(R) {
            let i = cy * cols + cx;
            if (mean[i] as f64) < STITCHED || skipped.as_ref().is_some_and(|s| s[i] != 0) {
                continue;
            }
            let inside = (cy - R..=cy + R)
                .all(|y| (cx - R..=cx + R).all(|x| mean[y * cols + x] as f64 >= STITCHED));
            if inside {
                cover[i] = mean[i];
            }
        }
    }
    let mut longest = vec![0u16; n];
    for i in 1..p.cmd.len() {
        if p.cmd[i] != STITCH || p.cmd[i - 1] != STITCH {
            continue;
        }
        let l = round(hypot(
            (p.x[i] - p.x[i - 1]) as f64,
            (p.y[i] - p.y[i - 1]) as f64,
        ));
        for j in [i - 1, i] {
            if let Some(c) = cell_at(p.x[j], p.y[j], origin_x, origin_y, cols, rows)
                && l > longest[c] as f64
            {
                longest[c] = l.min(65535.0) as u16;
            }
        }
    }
    // Gaps cost most of the measuring: a caller that does not look at them leaves them out.
    if !gaps {
        return CoverageMeasure {
            cover,
            gaps_low: vec![0; n],
            gaps_high: vec![0; n],
            longest,
        };
    }
    let owner = owner_of(p);
    let kinds = kinds();
    let rows_list = pulled_rows(p, &kinds);
    let grid = Grid {
        ox: origin_x,
        oy: origin_y,
        w: cols * PER,
        h: rows * PER,
    };
    let sewn = thread_raster(p, &rows_list, &owner, None, grid);
    let patches = skip.and_then(|s| patch_raster(p, s, grid));
    let pulled = |pull: Pull| {
        let mut own = thread_raster(p, &rows_list, &owner, Some(pull), grid);
        if let Some(patches) = &patches {
            for (o, &q) in own.iter_mut().zip(patches.iter()) {
                if *o == 0 && q != 0 {
                    *o = q;
                }
            }
        }
        own
    };
    CoverageMeasure {
        cover,
        gaps_low: gap_cells(&pulled(PULL_LOW), &sewn, grid, cols, rows),
        gaps_high: gap_cells(&pulled(PULL_HIGH), &sewn, grid, cols, rows),
        longest,
    }
}

/// Cells the stitches of the marked records pass through (and their neighbours).
fn cells_of(p: &Records, mark: &[u8], ox: f64, oy: f64, cols: usize, rows: usize) -> Vec<u8> {
    let mut out = vec![0u8; cols * rows];
    for i in 1..p.cmd.len() {
        if mark[i] != 1 || p.cmd[i] != STITCH || p.cmd[i - 1] != STITCH {
            continue;
        }
        let ax = p.x[i - 1] as f64;
        let ay = p.y[i - 1] as f64;
        let bx = p.x[i] as f64;
        let by = p.y[i] as f64;
        let k = (hypot(bx - ax, by - ay) / 5.0).ceil().max(1.0);
        let mut j = 0.0;
        while j <= k {
            let cx = ((ax + ((bx - ax) * j) / k) / 10.0 - ox).floor() as i64;
            let cy = ((ay + ((by - ay) * j) / k) / 10.0 - oy).floor() as i64;
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let (x, y) = (cx + dx, cy + dy);
                    if x >= 0 && y >= 0 && x < cols as i64 && y < rows as i64 {
                        out[y as usize * cols + x as usize] = 1;
                    }
                }
            }
            j += 1.0;
        }
    }
    out
}

fn ring_area(pts: &[[f64; 2]]) -> f64 {
    let mut a = 0.0;
    let mut j = pts.len() - 1;
    for k in 0..pts.len() {
        a += (pts[j][0] - pts[k][0]) * (pts[j][1] + pts[k][1]);
        j = k;
    }
    a / 2.0
}

/// The fabric of the appliqués on the gap raster: per pixel inside a placement line or tack-down
/// (records marked PATCH, each run of stitches one loop, even-odd), an owner of its own (negative:
/// it does not pull), else 0.
fn patch_raster(p: &Records, skip: &[u8], g: Grid) -> Option<Vec<i32>> {
    let mut loops: Vec<(Vec<[f64; 2]>, i32)> = Vec::new();
    // Index in `loops` of the loop being collected.
    let mut cur: Option<usize> = None;
    let mut id = 0;
    let mut in_patch = false;
    // A run that came round to where it began is a loop: going round again would cancel it out.
    let mut closed = false;
    for i in 0..p.cmd.len() {
        let on = skip[i] == PATCH;
        if on && !in_patch {
            id += 1;
        }
        in_patch = on || (in_patch && p.cmd[i] != STITCH);
        if on && p.cmd[i] == STITCH {
            if closed {
                continue;
            }
            let c = *cur.get_or_insert_with(|| {
                loops.push((Vec::new(), -(0x40000000 + id)));
                loops.len() - 1
            });
            let pts = &mut loops[c].0;
            let q = [p.x[i] as f64 / 10.0, p.y[i] as f64 / 10.0];
            pts.push(q);
            if pts.len() > 3
                && hypot(q[0] - pts[0][0], q[1] - pts[0][1]) < 0.05
                && ring_area(pts).abs() > LOOP_MM2
            {
                closed = true;
            }
        } else if p.cmd[i] != STITCH || !on {
            cur = None;
            closed = false;
        }
    }
    let rings: Vec<&(Vec<[f64; 2]>, i32)> = loops.iter().filter(|l| l.0.len() >= 3).collect();
    if rings.is_empty() {
        return None;
    }
    let (w, h) = (g.w, g.h);
    let mut out = vec![0i32; w * h];
    let mut xs: Vec<f64> = Vec::new();
    for y in 0..h {
        let wy = g.oy + (y as f64 + 0.5) * PX;
        for (pts, pid) in &rings {
            xs.clear();
            for k in 0..pts.len() {
                let [ax, ay] = pts[k];
                let [bx, by] = pts[(k + 1) % pts.len()];
                if (ay <= wy) == (by <= wy) {
                    continue;
                }
                xs.push(ax + ((wy - ay) / (by - ay)) * (bx - ax));
            }
            // Stable and numeric like Array.prototype.sort with (a, b) => a - b; no NaN here.
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let mut k = 0;
            while k + 1 < xs.len() {
                let x0 = ((xs[k] - g.ox) / PX - 0.5).ceil().max(0.0);
                let x1 = ((xs[k + 1] - g.ox) / PX - 0.5).floor().min(w as f64 - 1.0);
                let mut x = x0;
                while x <= x1 {
                    let i = y * w + x as usize;
                    out[i] = if out[i] != 0 { 0 } else { *pid };
                    x += 1.0;
                }
                k += 2;
            }
        }
    }
    Some(out)
}

/// The piece of thread each record belongs to (1-based): a new one after every jump, trim or color change.
fn owner_of(p: &Records) -> Vec<i32> {
    let mut out = vec![0i32; p.cmd.len()];
    let mut id = 0;
    let mut sewing = false;
    for i in 0..p.cmd.len() {
        if p.cmd[i] != STITCH {
            sewing = false;
            continue;
        }
        if !sewing {
            id += 1;
        }
        sewing = true;
        out[i] = id;
    }
    out
}

/// Stitches from record `a` to `b` in one row: fill or satin stitches going on in about the same
/// direction, or a single running stitch (it does not pull in).
#[derive(Clone, Copy, Debug)]
struct Row {
    a: usize,
    b: usize,
    pulls: bool,
}

fn pulled_rows(p: &Records, kinds: &[u8]) -> Vec<Row> {
    let mut out: Vec<Row> = Vec::new();
    // Whether the last row in `out` is still open.
    let mut open = false;
    let mut dir = 0.0;
    for i in 1..p.cmd.len() {
        if p.cmd[i] != STITCH
            || p.cmd[i - 1] != STITCH
            || (p.x[i] == p.x[i - 1] && p.y[i] == p.y[i - 1])
        {
            open = false;
            continue;
        }
        let pulls = kinds[i] == FILL || kinds[i] == SATIN;
        let a = ((p.y[i] - p.y[i - 1]) as f64).atan2((p.x[i] - p.x[i - 1]) as f64);
        let mut turn = (a - dir).abs();
        if turn > PI {
            turn = 2.0 * PI - turn;
        }
        match out.last_mut() {
            Some(cur) if open && pulls && cur.pulls && cur.b == i - 1 && turn < ROW_TURN => {
                cur.b = i
            }
            _ => {
                out.push(Row {
                    a: i - 1,
                    b: i,
                    pulls,
                });
                open = true;
            }
        }
        dir = a;
    }
    out
}

/// Where the thread lies once the rows have pulled in by `pull` (None: as sewn), drawn as thick as
/// the thread: per pixel the object on top, positive for fill and satin, negative for running stitch.
fn thread_raster(
    p: &Records,
    rows: &[Row],
    owner: &[i32],
    pull: Option<Pull>,
    g: Grid,
) -> Vec<i32> {
    let (w, h) = (g.w as i64, g.h as i64);
    let mut own = vec![0i32; g.w * g.h];
    // The samples lie half a pixel apart: a stamp at the same pixel with the same id as the one
    // just drawn writes exactly what is there already, so it is left out.
    let mut last = (i64::MIN, i64::MIN, 0);
    let mut mark = |x_mm: f64, y_mm: f64, id: i32| {
        let cx = ((x_mm - g.ox) / PX).floor() as i64;
        let cy = ((y_mm - g.oy) / PX).floor() as i64;
        if last == (cx, cy, id) {
            return;
        }
        last = (cx, cy, id);
        for dy in -THREAD_R..=THREAD_R {
            let y = cy + dy;
            if y < 0 || y >= h {
                continue;
            }
            for dx in -THREAD_R..=THREAD_R {
                let x = cx + dx;
                if x < 0 || x >= w || dx * dx + dy * dy > THREAD_R * THREAD_R + 1 {
                    continue;
                }
                own[(y * w + x) as usize] = id;
            }
        }
    };
    for (k, r) in rows.iter().enumerate() {
        let o = owner[r.b];
        if o == 0 {
            continue;
        }
        // The short turn from one row to the next goes where the row ends go.
        let before = k.checked_sub(1).map(|j| rows[j]);
        let after = rows.get(k + 1);
        let turn = !r.pulls
            && before.is_some_and(|q| q.pulls && q.b == r.a)
            && after.is_some_and(|q| q.pulls && q.a == r.b);
        if pull.is_some()
            && turn
            && hypot((p.x[r.b] - p.x[r.a]) as f64, (p.y[r.b] - p.y[r.a]) as f64) < 10.0
        {
            continue;
        }
        let id = if r.pulls { o } else { -o };
        let mut len = 0.0;
        for i in r.a + 1..=r.b {
            len += hypot((p.x[i] - p.x[i - 1]) as f64, (p.y[i] - p.y[i - 1]) as f64) / 10.0;
        }
        // Both ends pull in, never by more than 40 % of the row.
        let cut = match pull {
            Some(q) if r.pulls => q.cap.min(q.share * len).min(len * 0.4),
            _ => 0.0,
        };
        let mut s = 0.0;
        for i in r.a + 1..=r.b {
            let ax = p.x[i - 1] as f64 / 10.0;
            let ay = p.y[i - 1] as f64 / 10.0;
            let bx = p.x[i] as f64 / 10.0;
            let by = p.y[i] as f64 / 10.0;
            let l = hypot(bx - ax, by - ay);
            let k = (l / (PX / 2.0)).ceil().max(1.0);
            let mut j = 0.0;
            while j <= k {
                let at = s + (l * j) / k;
                if !(at < cut || at > len - cut) {
                    mark(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k, id);
                }
                j += 1.0;
            }
            s += l;
        }
    }
    own
}

/// Gap pixels per 1 mm cell: empty pixels with thread of two objects on opposite sides close by,
/// along at least three of four axes, where the thread lay as sewn.
fn gap_cells(own: &[i32], sewn: &[i32], g: Grid, cols: usize, rows: usize) -> Vec<u8> {
    let (w, h) = (g.w, g.h);
    let mut closed = vec![0u8; w * h];
    let mut facing = vec![0u8; w * h];
    let mut before = vec![0i32; w * h];
    let mut after = vec![0i32; w * h];
    for (ax, ay) in [(1, 0), (0, 1), (1, 1), (1, -1)] {
        sweep(own, &mut before, w, h, -ax, -ay);
        sweep(own, &mut after, w, h, ax, ay);
        for i in 0..own.len() {
            if own[i] != 0 || sewn[i] == 0 {
                continue;
            }
            let (a, b) = (before[i], after[i]);
            if a == 0 || b == 0 {
                continue;
            }
            closed[i] += 1;
            if a.abs() != b.abs() {
                facing[i] = 1;
            }
        }
    }
    let mut out = vec![0u8; cols * rows];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            // Enclosed on three axes: across a gap, not along the outer edge of a shape.
            if facing[i] == 0 || closed[i] < 3 {
                continue;
            }
            let c = (y / PER) * cols + x / PER;
            out[c] = out[c].saturating_add(1);
        }
    }
    out
}

/// For every pixel, the owner of the nearest thread within REACH pixels when walking from it in
/// direction (dx, dy), or 0. Each line of that direction is walked from its far end back; lines
/// across the rows are walked all at once, row by row, so memory is read in order.
fn sweep(own: &[i32], out: &mut [i32], w: usize, h: usize, dx: i64, dy: i64) {
    // One step on a line: `last` and `d` are the line's state.
    let step = |o: i32, out: &mut i32, last: &mut i32, d: &mut i32| {
        if o != 0 {
            *last = o;
            *d = 0;
            *out = 0;
        } else {
            *d += 1;
            *out = if *d <= REACH { *last } else { 0 };
        }
    };
    if dy == 0 {
        for y in 0..h {
            let (row, out_row) = (&own[y * w..(y + 1) * w], &mut out[y * w..(y + 1) * w]);
            let (mut last, mut d) = (0, REACH + 1);
            for x in 0..w {
                let x = if dx > 0 { w - 1 - x } else { x };
                step(row[x], &mut out_row[x], &mut last, &mut d);
            }
        }
        return;
    }
    // State per line, by the coordinate that stays the same along it.
    let lines = w + h;
    let mut last = vec![0i32; lines];
    let mut d = vec![REACH + 1; lines];
    for k in 0..h {
        let y = if dy > 0 { h - 1 - k } else { k };
        let (row, out_row) = (&own[y * w..(y + 1) * w], &mut out[y * w..(y + 1) * w]);
        for x in 0..w {
            let line = if dx == 0 {
                x
            } else if dx == dy {
                x + h - 1 - y
            } else {
                x + y
            };
            step(row[x], &mut out_row[x], &mut last[line], &mut d[line]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pattern::{JUMP, TRIM};
    use crate::validation::kinds::stitch_kinds;

    fn records(pts: &[(i32, i32, u8)]) -> Records {
        Records {
            x: pts.iter().map(|p| p.0).collect(),
            y: pts.iter().map(|p| p.1).collect(),
            cmd: pts.iter().map(|p| p.2).collect(),
            colors: vec![],
        }
    }

    /// A fill block of rows 0.4 mm apart from x0 to x1 (0.1 mm), y from 20 to 80.
    fn block(pts: &mut Vec<(i32, i32, u8)>, x0: i32, x1: i32) {
        if !pts.is_empty() {
            pts.push((x0, 20, TRIM));
            pts.push((x0, 20, JUMP));
        }
        for k in 0..16 {
            let y = 20 + k * 4;
            let (a, b) = if k % 2 == 0 { (x0, x1) } else { (x1, x0) };
            pts.push((a, y, STITCH));
            pts.push(((a + b) / 2, y, STITCH));
            pts.push((b, y, STITCH));
        }
    }

    #[test]
    fn longest_stitch_per_cell() {
        let p = records(&[(5, 5, STITCH), (85, 5, STITCH)]);
        let m = measure_coverage(&p, &[0.0; 10], 0.0, 0.0, 10, 1, None, false, Vec::new);
        assert_eq!(m.longest[0], 80);
        assert_eq!(m.longest[8], 80);
        assert_eq!(m.longest[4], 0);
    }

    #[test]
    fn cover_only_well_inside() {
        let mean = vec![2.0f32; 49];
        let p = records(&[]);
        let m = measure_coverage(&p, &mean, 0.0, 0.0, 7, 7, None, false, Vec::new);
        assert_eq!(m.cover.iter().filter(|&&v| v > 0.0).count(), 9);
        assert_eq!(m.cover[3 * 7 + 3], 2.0);
    }

    #[test]
    fn pull_opens_a_gap_between_touching_fills() {
        // Two fills with 20 mm rows that meet edge to edge at x = 20 mm: as sewn there is no gap,
        // pulled in there is.
        let mut pts = vec![];
        block(&mut pts, 0, 200);
        block(&mut pts, 200, 400);
        let p = records(&pts);
        let m = measure_coverage(&p, &[0.0; 450], 0.0, 0.0, 45, 10, None, true, || {
            stitch_kinds(&p)
        });
        let low: u32 = m.gaps_low.iter().map(|&v| v as u32).sum();
        let high: u32 = m.gaps_high.iter().map(|&v| v as u32).sum();
        assert!(high > 0 && high >= low, "{low} {high}");
    }
}
