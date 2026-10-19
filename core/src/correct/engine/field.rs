//! The fast measure behind the search (src/correct/engine/field.ts): thread density, satin share,
//! short stitches and penetrations per 1 mm cell, the way validation measures them, but kept as a
//! sum over objects. The smoothing is linear, so the density of a design is the sum of the
//! densities of its objects: switching an object to another variant subtracts its old map and adds
//! the new one, without sewing or measuring the whole design again. Lower limits (gaps, fabric
//! showing through) are not additive and are checked on the real result.

use super::levels::{
    CAUTION, CRITICAL, SHORT_STITCH_COUNT, Thresholds, classify_density, classify_holes,
    density_limits,
};
use crate::density::grid::{DensityGrid, DensityOptions, Metric, compute_density};
use crate::js::{IdMap, round};
use crate::pattern::{Records, STITCH};
use crate::validation::measure::{BLUR_MM, HOLE_RADIUS_MM, VALIDATION_CELL_MM};
use crate::validation::satin::{MIN_LEN, satin_mask};
use crate::validation::short_stitches::{SHORT, TIE, tag_short_stitches};

pub const SUB: i64 = 5;
const SUB_MM: f64 = VALIDATION_CELL_MM / SUB as f64;
const SHIFT_MM: f64 = -0.05;
/// Share below the critical density that counts as at risk (see Field::risk).
pub const RISK: f64 = 0.04;
/// Margin around the design (mm) that variants may grow into.
const MARGIN_MM: f64 = 4.0;

const OPTIONS: DensityOptions = DensityOptions {
    metric: Metric::Thread,
    cell_mm: SUB_MM,
    blur_mm: BLUR_MM,
    include_jumps: false,
    align_mm: Some(VALIDATION_CELL_MM),
    shift_mm: Some(SHIFT_MM),
};

/// A map on the sub-cell lattice of the field, placed at (ox, oy) sub-cells.
#[derive(Clone, Debug, Default)]
pub struct SubMap {
    pub ox: i64,
    pub oy: i64,
    pub cols: i64,
    pub rows: i64,
    pub total: Vec<f32>,
    pub satin: Vec<f32>,
}

impl SubMap {
    /// Thread at sub-cell (sx, sy), 0 outside.
    pub fn at(&self, sx: i64, sy: i64) -> f64 {
        let x = sx - self.ox;
        let y = sy - self.oy;
        if x >= 0 && y >= 0 && x < self.cols && y < self.rows {
            self.total[(y * self.cols + x) as usize] as f64
        } else {
            0.0
        }
    }
}

/// What one variant of an object contributes.
#[derive(Clone, Debug, Default)]
pub struct Contribution {
    pub map: SubMap,
    /// Short stitches (not ties) per cell: cell index (field) to count.
    pub shorts: IdMap<usize, i32>,
    /// Penetrations (0.1 mm), ties left out: x, y pairs.
    pub holes: Vec<i32>,
}

/// Bounds grown by `mm` on every side (0.1 mm).
fn grown(b: [f64; 4], mm: f64) -> [f64; 4] {
    [
        b[0] - mm * 10.0,
        b[1] - mm * 10.0,
        b[2] + mm * 10.0,
        b[3] + mm * 10.0,
    ]
}

pub struct Field {
    /// Sub-cell lattice.
    pub scols: i64,
    pub srows: i64,
    /// 1 mm cells (blocks of SUB x SUB sub-cells).
    pub cols: i64,
    pub rows: i64,
    /// World position (mm) of the top-left corner of the lattice.
    pub origin_x: f64,
    pub origin_y: f64,
    pub total: Vec<f32>,
    pub satin: Vec<f32>,
    pub shorts: Vec<i32>,
    /// Level per cell now, and as the design is (the surrogate's own measure, for a fair comparison).
    pub level: Vec<u8>,
    pub base: Vec<u8>,
    /// Cells at risk of becoming critical that were not: critical now, or within RISK of the
    /// critical density and denser than before. The fast measure can be off by a little against
    /// sewing for real; the margin keeps a search from walking up to the limit.
    pub risk: Vec<u8>,
    pub base_peak: Vec<f32>,
    /// Penetrations per bucket (HOLE_RADIUS_MM wide), as x, y pairs.
    buckets: IdMap<i64, Vec<i32>>,
    hole_r: f64,
    shorts_level: u8,
    pub th: Thresholds,
    /// Work done by swaps so far, in sub-cells and penetrations touched: a measure of search time
    /// that does not depend on the machine or its load, so a search budgeted by it ends at the same
    /// point everywhere (deterministic time, as CPLEX ticks or Gurobi work units).
    pub work: f64,
}

fn any_stitch(p: &Records) -> bool {
    p.cmd.contains(&STITCH)
}

/// `keep` of satin thread: satin segments, and with `keep` only the kept ones.
fn satin_keep(p: &Records, keep: Option<&[u8]>) -> Vec<u8> {
    let mask = satin_mask(p, MIN_LEN);
    (0..p.cmd.len())
        .map(|i| u8::from(mask[i] == 1 && keep.is_none_or(|k| k[i] != 0)))
        .collect()
}

impl Field {
    /// The field of the records `p` with bounds `bounds` (min x, min y, max x, max y, 0.1 mm).
    pub fn new(p: &Records, bounds: [f64; 4], th: Thresholds, stable_fabric: bool) -> Field {
        let b = grown(bounds, MARGIN_MM);
        let g = compute_density(p, b, &OPTIONS, None);
        let s = compute_density(p, b, &OPTIONS, Some(&satin_keep(p, None)));
        let cols = (g.cols as i64 + SUB - 1) / SUB;
        let rows = (g.rows as i64 + SUB - 1) / SUB;
        let scols = cols * SUB;
        let srows = rows * SUB;
        let mut total = vec![0f32; (scols * srows) as usize];
        let mut satin = vec![0f32; (scols * srows) as usize];
        for y in 0..g.rows {
            for x in 0..g.cols {
                total[y * scols as usize + x] = g.data[y * g.cols + x];
                satin[y * scols as usize + x] = s.data[y * g.cols + x];
            }
        }
        let n = (cols * rows) as usize;
        let mut f = Field {
            scols,
            srows,
            cols,
            rows,
            origin_x: g.origin_x,
            origin_y: g.origin_y,
            total,
            satin,
            shorts: vec![0; n],
            level: vec![0; n],
            base: vec![],
            risk: vec![0; n],
            base_peak: vec![0.0; n],
            buckets: IdMap::default(),
            hole_r: HOLE_RADIUS_MM * 10.0,
            shorts_level: if stable_fabric { CAUTION } else { CRITICAL },
            th,
            work: 0.0,
        };
        let tags = tag_short_stitches(p);
        for i in 0..tags.len() {
            if tags[i] == SHORT
                && let Some(c) = f.cell_at(p.x[i], p.y[i])
            {
                f.shorts[c] += 1;
            }
        }
        if th.holes.is_some() {
            for i in 0..p.cmd.len() {
                if p.cmd[i] == STITCH && tags[i] != TIE {
                    f.add_hole(p.x[i], p.y[i], 1);
                }
            }
        }
        for c in 0..n {
            f.level[c] = f.level_of(c);
            f.base_peak[c] = f.density_of(c).0 as f32;
        }
        f.base = f.level.clone();
        f
    }

    pub fn cells(&self) -> usize {
        (self.cols * self.rows) as usize
    }

    /// Cell of a point (0.1 mm).
    pub fn cell_at(&self, x: i32, y: i32) -> Option<usize> {
        let cx = (x as f64 / 10.0 - self.origin_x).floor();
        let cy = (y as f64 / 10.0 - self.origin_y).floor();
        (cx >= 0.0 && cy >= 0.0 && cx < self.cols as f64 && cy < self.rows as f64)
            .then(|| (cy as i64 * self.cols + cx as i64) as usize)
    }

    /// World key of cell `c` (integer millimetres, as cellKey in cells.ts).
    pub fn key_of(&self, c: usize) -> f64 {
        let c = c as i64;
        let cx = round(self.origin_x + (c % self.cols) as f64);
        let cy = round(self.origin_y + (c / self.cols) as f64);
        (cy + 50000.0) * 100000.0 + (cx + 50000.0)
    }

    /// What the stitches `s` (one object or a few, with their bounds) contribute, on this field's
    /// lattice. With `keep`, only the thread of records it marks (a stitch's record is where its
    /// segment ends); short stitches and penetrations are counted only for kept records.
    pub fn contribution(&self, s: &Records, bounds: [f64; 4], keep: Option<&[u8]>) -> Contribution {
        if !any_stitch(s) {
            return Contribution::default();
        }
        let g: DensityGrid = compute_density(s, bounds, &OPTIONS, keep);
        let sat = compute_density(s, bounds, &OPTIONS, Some(&satin_keep(s, keep)));
        let map = SubMap {
            ox: round((g.origin_x - self.origin_x) / SUB_MM) as i64,
            oy: round((g.origin_y - self.origin_y) / SUB_MM) as i64,
            cols: g.cols as i64,
            rows: g.rows as i64,
            total: g.data,
            satin: sat.data,
        };
        let tags = tag_short_stitches(s);
        let mut shorts: IdMap<usize, i32> = IdMap::default();
        let mut holes = vec![];
        for i in 0..s.cmd.len() {
            if s.cmd[i] != STITCH || keep.is_some_and(|k| k[i] == 0) {
                continue;
            }
            if tags[i] == SHORT
                && let Some(c) = self.cell_at(s.x[i], s.y[i])
            {
                *shorts.entry(c).or_insert(0) += 1;
            }
            if self.th.holes.is_some() && tags[i] != TIE {
                holes.push(s.x[i]);
                holes.push(s.y[i]);
            }
        }
        Contribution { map, shorts, holes }
    }

    /// A predicted contribution: `top` scaled by `k` (denser or looser rows) and `under` scaled by
    /// `u`, or kept only where `keep_under` (a sub-cell test) holds. Short stitches and
    /// penetrations stay those of `top` and `under`.
    pub fn blend(
        &self,
        top: &Contribution,
        under: &Contribution,
        k: f64,
        u: f64,
        keep_under: Option<&dyn Fn(i64, i64) -> bool>,
    ) -> Contribution {
        let parts: Vec<&SubMap> = [&top.map, &under.map]
            .into_iter()
            .filter(|m| m.cols != 0)
            .collect();
        if parts.is_empty() {
            return top.clone();
        }
        let ox = parts.iter().map(|m| m.ox).min().unwrap();
        let oy = parts.iter().map(|m| m.oy).min().unwrap();
        let cols = parts.iter().map(|m| m.ox + m.cols).max().unwrap() - ox;
        let rows = parts.iter().map(|m| m.oy + m.rows).max().unwrap() - oy;
        let mut total = vec![0f32; (cols * rows) as usize];
        let mut satin = vec![0f32; (cols * rows) as usize];
        let mut add = |m: &SubMap, f: f64, test: Option<&dyn Fn(i64, i64) -> bool>| {
            if m.cols == 0 || f == 0.0 {
                return;
            }
            for y in 0..m.rows {
                for x in 0..m.cols {
                    if test.is_some_and(|t| !t(m.ox + x, m.oy + y)) {
                        continue;
                    }
                    let i = ((m.oy + y - oy) * cols + (m.ox + x - ox)) as usize;
                    let j = (y * m.cols + x) as usize;
                    total[i] = (total[i] as f64 + f * m.total[j] as f64) as f32;
                    satin[i] = (satin[i] as f64 + f * m.satin[j] as f64) as f32;
                }
            }
        };
        add(&top.map, k, None);
        add(
            &under.map,
            if keep_under.is_some() { 1.0 } else { u },
            keep_under,
        );
        let mut shorts = top.shorts.clone();
        for (&c, &n) in &under.shorts {
            *shorts.entry(c).or_insert(0) += n;
        }
        let mut holes = top.holes.clone();
        holes.extend_from_slice(&under.holes);
        Contribution {
            map: SubMap {
                ox,
                oy,
                cols,
                rows,
                total,
                satin,
            },
            shorts,
            holes,
        }
    }

    /// Cells a map touches, as a box of cells [c0, r0, c1, r1] (inclusive), clipped to the field.
    fn cells_of(&self, m: &SubMap, h: &[i32]) -> [i64; 4] {
        let mut c0 = m.ox.div_euclid(SUB);
        let mut r0 = m.oy.div_euclid(SUB);
        let mut c1 = (m.ox + m.cols - 1).div_euclid(SUB);
        let mut r1 = (m.oy + m.rows - 1).div_euclid(SUB);
        // Penetrations change neighbour counts up to the hole radius around them.
        for k in (0..h.len()).step_by(2) {
            let cx = (h[k] as f64 / 10.0 - self.origin_x).floor() as i64;
            let cy = (h[k + 1] as f64 / 10.0 - self.origin_y).floor() as i64;
            c0 = c0.min(cx - 1);
            r0 = r0.min(cy - 1);
            c1 = c1.max(cx + 1);
            r1 = r1.max(cy + 1);
        }
        [
            c0.max(0),
            r0.max(0),
            c1.min(self.cols - 1),
            r1.min(self.rows - 1),
        ]
    }

    /// Replaces contribution `from` by `to`, recomputing the levels of the cells that may have
    /// changed; `on_change` sees each changed cell's old and new level and risk.
    pub fn swap(
        &mut self,
        from: &Contribution,
        to: &Contribution,
        mut on_change: impl FnMut(usize, u8, u8, u8, u8),
    ) {
        self.add_map(&from.map, -1.0);
        self.add_map(&to.map, 1.0);
        for (&c, &n) in &from.shorts {
            self.shorts[c] -= n;
        }
        for (&c, &n) in &to.shorts {
            self.shorts[c] += n;
        }
        for k in (0..from.holes.len()).step_by(2) {
            self.add_hole(from.holes[k], from.holes[k + 1], -1);
        }
        for k in (0..to.holes.len()).step_by(2) {
            self.add_hole(to.holes[k], to.holes[k + 1], 1);
        }
        let a = self.cells_of(&from.map, &from.holes);
        let b = self.cells_of(&to.map, &to.holes);
        let mut bx = [
            a[0].min(b[0]),
            a[1].min(b[1]),
            a[2].max(b[2]),
            a[3].max(b[3]),
        ];
        if from.map.cols == 0 {
            bx = b;
        }
        if to.map.cols == 0 {
            bx = a;
        }
        self.work += (from.map.cols * from.map.rows + to.map.cols * to.map.rows) as f64
            + ((from.holes.len() + to.holes.len()) / 2) as f64
            + ((bx[2] - bx[0] + 1).max(0) * (bx[3] - bx[1] + 1).max(0) * SUB * SUB) as f64;
        for r in bx[1]..=bx[3] {
            for c in bx[0]..=bx[2] {
                let i = (r * self.cols + c) as usize;
                let was = self.level[i];
                let now = self.level_of(i);
                let r_was = self.risk[i];
                let r_now = self.risk_of(i, now);
                if now != was || r_now != r_was {
                    self.level[i] = now;
                    self.risk[i] = r_now;
                    on_change(i, was, now, r_was, r_now);
                }
            }
        }
    }

    fn add_map(&mut self, m: &SubMap, sign: f64) {
        for y in 0..m.rows {
            let fy = m.oy + y;
            if fy < 0 || fy >= self.srows {
                continue;
            }
            for x in 0..m.cols {
                let fx = m.ox + x;
                if fx < 0 || fx >= self.scols {
                    continue;
                }
                let k = (y * m.cols + x) as usize;
                let i = (fy * self.scols + fx) as usize;
                self.total[i] = (self.total[i] as f64 + sign * m.total[k] as f64) as f32;
                self.satin[i] = (self.satin[i] as f64 + sign * m.satin[k] as f64) as f32;
            }
        }
    }

    fn bucket(&self, x: f64, y: f64) -> i64 {
        (x / self.hole_r).floor() as i64 * 1_000_003 + (y / self.hole_r).floor() as i64
    }

    fn add_hole(&mut self, x: i32, y: i32, n: i32) {
        let k = self.bucket(x as f64, y as f64);
        if n > 0 {
            let b = self.buckets.entry(k).or_default();
            b.push(x);
            b.push(y);
        } else if let Some(b) = self.buckets.get_mut(&k) {
            let mut j = 0;
            while j < b.len() {
                if b[j] == x && b[j + 1] == y {
                    b.drain(j..j + 2);
                    break;
                }
                j += 2;
            }
        }
    }

    /// Density (peak sub-cell) and satin share of cell `c`.
    pub fn density_of(&self, c: usize) -> (f64, f64) {
        let c = c as i64;
        let cx = c % self.cols;
        let cy = c / self.cols;
        let mut peak = 0.0;
        let mut sum_t = 0.0;
        let mut sum_s = 0.0;
        for y in cy * SUB..cy * SUB + SUB {
            for x in cx * SUB..cx * SUB + SUB {
                let i = (y * self.scols + x) as usize;
                let t = self.total[i] as f64;
                if t > peak {
                    peak = t;
                }
                sum_t += t;
                sum_s += self.satin[i] as f64;
            }
        }
        let share = if sum_t > 1e-6 {
            (sum_s / sum_t).clamp(0.0, 1.0)
        } else {
            0.0
        };
        (peak, share)
    }

    /// Most neighbouring penetrations of any penetration in cell `c`.
    fn holes_of(&self, c: usize) -> i64 {
        let ci = c as i64;
        let cx = ci % self.cols;
        let cy = ci / self.cols;
        let r = self.hole_r;
        let r2 = r * r + 1e-6;
        let mut best = 0;
        // Penetrations in the cell lie in the buckets it spans.
        let bx0 = (((self.origin_x + cx as f64) * 10.0) / r).floor() as i64;
        let by0 = (((self.origin_y + cy as f64) * 10.0) / r).floor() as i64;
        let bx1 = (((self.origin_x + cx as f64 + 1.0) * 10.0) / r).floor() as i64;
        let by1 = (((self.origin_y + cy as f64 + 1.0) * 10.0) / r).floor() as i64;
        for by in by0..=by1 {
            for bx in bx0..=bx1 {
                let Some(b) = self.buckets.get(&(bx * 1_000_003 + by)) else {
                    continue;
                };
                for j in (0..b.len()).step_by(2) {
                    let x = b[j];
                    let y = b[j + 1];
                    if self.cell_at(x, y) != Some(c) {
                        continue;
                    }
                    let mut n = 0;
                    let kx = (x as f64 / r).floor() as i64;
                    let ky = (y as f64 / r).floor() as i64;
                    for dy in -1..=1 {
                        for dx in -1..=1 {
                            let Some(o) = self.buckets.get(&((kx + dx) * 1_000_003 + ky + dy))
                            else {
                                continue;
                            };
                            for q in (0..o.len()).step_by(2) {
                                let ex = (o[q] - x) as f64;
                                let ey = (o[q + 1] - y) as f64;
                                if ex * ex + ey * ey <= r2 {
                                    n += 1;
                                }
                            }
                        }
                    }
                    // The point itself is counted once.
                    best = best.max(n - 1);
                }
            }
        }
        best
    }

    fn risk_of(&self, c: usize, level: u8) -> u8 {
        if self.base[c] == CRITICAL {
            return 0;
        }
        if level == CRITICAL {
            return 1;
        }
        let (peak, share) = self.density_of(c);
        let crit = density_limits(&self.th, share)[1];
        u8::from(peak >= crit * (1.0 - RISK) && peak > self.base_peak[c] as f64 + 0.05)
    }

    /// Level of cell `c` by density, short stitches and penetrations (the upper limits).
    pub fn level_of(&self, c: usize) -> u8 {
        let (peak, share) = self.density_of(c);
        let mut l = classify_density(peak, share, &self.th);
        if l == CRITICAL {
            return l;
        }
        if self.shorts[c] >= SHORT_STITCH_COUNT {
            l = l.max(self.shorts_level);
        }
        if self.th.holes.is_some() && l < CRITICAL {
            l = l.max(classify_holes(self.holes_of(c) as f64, &self.th));
        }
        l
    }

    /// Whether cell `c` is critical by penetrations (short stitches or perforation) now.
    pub fn critical_by_holes(&self, c: usize) -> bool {
        if self.shorts[c] >= SHORT_STITCH_COUNT && self.shorts_level == CRITICAL {
            return true;
        }
        self.th.holes.is_some() && classify_holes(self.holes_of(c) as f64, &self.th) == CRITICAL
    }
}

#[cfg(test)]
mod tests {
    use super::super::levels::woven;
    use super::*;

    /// A fill block of rows 0.2 mm apart from (x0, y0), `w` by `h` (0.1 mm).
    pub(crate) fn block(x0: i32, y0: i32, w: i32, h: i32) -> Records {
        let mut p = Records::default();
        let mut y = y0;
        let mut fwd = true;
        while y <= y0 + h {
            let xs = if fwd { [x0, x0 + w] } else { [x0 + w, x0] };
            for x in xs {
                p.x.push(x);
                p.y.push(y);
                p.cmd.push(STITCH);
            }
            fwd = !fwd;
            y += 2;
        }
        p
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
    fn swapping_an_object_out_and_back_restores_the_field() {
        let p = block(0, 0, 100, 100);
        let mut f = Field::new(&p, bounds(&p), woven(), false);
        let before = f.total.clone();
        let c = f.contribution(&p, bounds(&p), None);
        let empty = Contribution::default();
        let mut changes = 0;
        f.swap(&c, &empty, |_, _, _, _, _| changes += 1);
        let left: f64 = f.total.iter().map(|&v| v.abs() as f64).sum();
        assert!(left < 1e-3, "{left}");
        f.swap(&empty, &c, |_, _, _, _, _| {});
        for (a, b) in before.iter().zip(&f.total) {
            assert!((a - b).abs() < 1e-4);
        }
        assert!(f.work > 0.0);
    }

    #[test]
    fn blend_scales_the_top() {
        let p = block(0, 0, 100, 100);
        let f = Field::new(&p, bounds(&p), woven(), false);
        let c = f.contribution(&p, bounds(&p), None);
        let half = f.blend(&c, &Contribution::default(), 0.5, 1.0, None);
        let a: f64 = c.map.total.iter().map(|&v| v as f64).sum();
        let b: f64 = half.map.total.iter().map(|&v| v as f64).sum();
        assert!((b - a / 2.0).abs() < 1e-3 * a);
    }
}
