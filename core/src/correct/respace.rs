//! Re-spaces fill rows and satin columns evenly at a wider spacing (src/correct/respace.ts).
//!
//! Lowering the density of a fill is a matter of row spacing: a fill at 0.4 mm has 2.5 mm thread per
//! mm², at 0.5 mm 2.0. Dropping single rows (what the first version did) leaves stripes of double
//! spacing that show on the fabric. Instead the sweep is rebuilt: the row ends of the original are
//! the outline of the shape on either side, new rows are laid between them at even spacing, and the
//! stitches inside each row follow the stitch length and stagger of the original rows. The first and
//! last stitch stay where they are, so the sweep connects to the rest of the design as before.
//!
//! The result is the new records before tidying; the caller makes the version and tidies it.

use super::structure::{stitch_runs, turning_points};
use super::thin::TURN_COS;
use crate::geom::{Pt, cumulative};
use crate::js::{hypot, median, round};
use crate::pattern::{Records, STITCH};
use crate::validation::satin::{MIN_LEN, satin_mask};

/// Shortest pass that counts as a row (0.1 mm).
const ROW_MIN: f64 = 10.0;
/// Longest connector between two rows (0.1 mm).
const CONNECTOR_MAX: f64 = 25.0;
/// Rows of a sweep are at most this far apart (0.1 mm).
const SPACING_MAX: f64 = 10.0;
const ANTI_COS: f64 = -0.9;
/// A sweep needs this many rows to be rebuilt.
const MIN_ROWS: usize = 6;
/// Re-spacing by less than this factor is not worth it.
const MIN_GAIN: f64 = 1.05;
/// Sweeps with shorter rows (median, 0.1 mm) are narrow details and keep their spacing.
const MIN_WIDTH: f64 = 30.0;
/// A satin column needs this many penetrations to be rebuilt.
const SATIN_MIN: usize = 8;

/// Record indices of a row's first and last stitch.
#[derive(Clone, Copy, Debug)]
pub struct Row {
    pub a: usize,
    pub b: usize,
}

/// `l || 1` for a length.
fn or_one(l: f64) -> f64 {
    if l == 0.0 || l.is_nan() { 1.0 } else { l }
}

/// Fill sweeps of one run: sequences of antiparallel rows, directly joined or via a short connector.
pub fn fill_sweeps(p: &Records, start: usize, end: usize, mask: &[u8]) -> Vec<Vec<Row>> {
    let t = turning_points(p, start, end, TURN_COS);
    let mut sweeps = vec![];
    let is_row = |k: usize| {
        if k + 1 >= t.len() || p.dist(t[k], t[k + 1]) < ROW_MIN {
            return false;
        }
        (t[k] + 1..=t[k + 1]).any(|i| mask[i] == 0)
    };
    let unit = |r: Row| {
        let l = or_one(p.dist(r.a, r.b));
        [
            (p.x[r.b] - p.x[r.a]) as f64 / l,
            (p.y[r.b] - p.y[r.a]) as f64 / l,
        ]
    };
    let follows = |r: Row, s: Row| {
        let u = unit(r);
        let w = unit(s);
        if u[0] * w[0] + u[1] * w[1] > ANTI_COS {
            return false;
        }
        // Offset of the next row's middle from this row's line. Row ends are unreliable: where the
        // connector is too short to register as a turn, a row starts on the previous row's end.
        let mx = (p.x[s.a] as f64 + p.x[s.b] as f64) / 2.0 - p.x[r.a] as f64;
        let my = (p.y[s.a] as f64 + p.y[s.b] as f64) / 2.0 - p.y[r.a] as f64;
        let off = (mx * u[1] - my * u[0]).abs();
        off > 0.0 && off <= SPACING_MAX
    };
    let mut cur: Vec<Row> = vec![];
    let flush = |cur: &mut Vec<Row>, sweeps: &mut Vec<Vec<Row>>| {
        if cur.len() >= MIN_ROWS {
            sweeps.push(std::mem::take(cur));
        }
        cur.clear();
    };
    let mut k = 0;
    while k + 1 < t.len() {
        if !is_row(k) {
            flush(&mut cur, &mut sweeps);
            k += 1;
            continue;
        }
        let row = Row {
            a: t[k],
            b: t[k + 1],
        };
        if let Some(&last) = cur.last()
            && !follows(last, row)
        {
            flush(&mut cur, &mut sweeps);
        }
        cur.push(row);
        // Next row: directly, or after one short connector.
        if is_row(k + 1) {
            k += 1;
        } else if k + 2 < t.len() && p.dist(t[k + 1], t[k + 2]) <= CONNECTOR_MAX && is_row(k + 2) {
            k += 2;
        } else {
            flush(&mut cur, &mut sweeps);
            k += 1;
        }
    }
    flush(&mut cur, &mut sweeps);
    sweeps
}

/// Linear interpolation along a chain of (v, x, y) points sorted by v.
fn along(chain: &[[f64; 3]], v: f64) -> Pt {
    if v <= chain[0][0] {
        return [chain[0][1], chain[0][2]];
    }
    for i in 1..chain.len() {
        if v <= chain[i][0] {
            let [v0, x0, y0] = chain[i - 1];
            let [v1, x1, y1] = chain[i];
            let f = if v1 > v0 { (v - v0) / (v1 - v0) } else { 0.0 };
            return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
        }
    }
    let l = chain[chain.len() - 1];
    [l[1], l[2]]
}

/// Stable sort by the first value, as Array.prototype.sort with a numeric comparator.
fn sort_chain(c: &mut [[f64; 3]]) {
    c.sort_by(|a, b| {
        let d = a[0] - b[0];
        if d < 0.0 {
            std::cmp::Ordering::Less
        } else if d > 0.0 {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
}

pub struct Rebuilt {
    pub points: Vec<Pt>,
    pub before: f64,
    pub after: f64,
}

/// New stitch points replacing records rows[0].a .. rows[last].b, with the row spacing widened so
/// the density drops by `need` (0 to 1) but stays at most `max_spacing` (0.1 mm). None when the
/// sweep is not regular enough to rebuild or the gain would be too small.
pub fn rebuild_sweep(p: &Records, rows: &[Row], need: f64, max_spacing: f64) -> Option<Rebuilt> {
    let r0 = rows[0];
    let lens: Vec<f64> = rows.iter().map(|r| p.dist(r.a, r.b)).collect();
    if median(&lens) < MIN_WIDTH {
        return None;
    }
    // Row direction from the longest row; short rows near tips are dominated by their ends.
    let mut rf = rows[0];
    for &r in &rows[1..] {
        if p.dist(r.a, r.b) > p.dist(rf.a, rf.b) {
            rf = r;
        }
    }
    let l0 = p.dist(rf.a, rf.b);
    let ux = (p.x[rf.b] - p.x[rf.a]) as f64 / l0;
    let uy = (p.y[rf.b] - p.y[rf.a]) as f64 / l0;
    let nx = -uy;
    let ny = ux;
    let u_of = |i: usize| p.x[i] as f64 * ux + p.y[i] as f64 * uy;
    let v_of = |i: usize| p.x[i] as f64 * nx + p.y[i] as f64 * ny;
    // Each row's offset is the median over its stitches: the inner stitches lie exactly on the row,
    // an end can belong to an absorbed connector.
    let vs: Vec<f64> = rows
        .iter()
        .map(|r| {
            let v: Vec<f64> = (r.a.min(r.b)..=r.a.max(r.b)).map(v_of).collect();
            if v.len() > 2 {
                median(&v)
            } else {
                (v_of(r.a) + v_of(r.b)) / 2.0
            }
        })
        .collect();
    let d = vs[vs.len() - 1] - vs[0];
    let sign = if d > 0.0 {
        1.0
    } else if d < 0.0 {
        -1.0
    } else {
        return None;
    };
    let mut gaps = vec![];
    for j in 1..vs.len() {
        let g = (vs[j] - vs[j - 1]) * sign;
        if g <= 0.0 {
            return None;
        }
        gaps.push(g);
    }
    let s = median(&gaps);
    let spacing = max_spacing.min(s / (1.0 - need).max(0.05));
    if spacing < s * MIN_GAIN {
        return None;
    }
    if gaps.iter().any(|&g| g > 2.0 * s) {
        // Already uneven: leave it.
        return None;
    }

    // Outline chains: row ends on the low-u and on the high-u side, sorted by v.
    let mut low: Vec<[f64; 3]> = vec![];
    let mut high: Vec<[f64; 3]> = vec![];
    let mut lens: Vec<f64> = vec![];
    let mut ends: Vec<f64> = vec![];
    for r in rows {
        let (lo, hi) = if u_of(r.a) < u_of(r.b) {
            (r.a, r.b)
        } else {
            (r.b, r.a)
        };
        low.push([v_of(lo) * sign, p.x[lo] as f64, p.y[lo] as f64]);
        high.push([v_of(hi) * sign, p.x[hi] as f64, p.y[hi] as f64]);
        let up = r.b > r.a;
        let mut i = r.a;
        while i != r.b {
            let j = if up { i + 1 } else { i - 1 };
            lens.push(p.dist(i, j));
            i = j;
        }
        if r.a.abs_diff(r.b) > 1 {
            let (na, nb) = if up {
                (r.a + 1, r.b - 1)
            } else {
                (r.a - 1, r.b + 1)
            };
            ends.push(p.dist(r.a, na));
            ends.push(p.dist(r.b, nb));
        }
    }
    sort_chain(&mut low);
    sort_chain(&mut high);
    let interior: Vec<f64> = lens.iter().copied().filter(|&l| l > 0.0).collect();
    // Row stitch length.
    let longest = interior.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let l_len = if longest > 15.0 {
        let long: Vec<f64> = interior.iter().copied().filter(|&l| l > 15.0).collect();
        median(&long)
    } else {
        0.0
    };
    let me = median(&ends) * 0.5;
    let gap_end = 15f64.min(3f64.max(if me == 0.0 || me.is_nan() { 5.0 } else { me }));

    let m = rows.len() - 1;
    let v_first = v_of(r0.a) * sign;
    let last = rows[m];
    let v_last = v_of(last.b) * sign;
    let mut big_m = round((v_last - v_first) / spacing) as i64;
    let mi = m as i64;
    // Same parity: the last row ends on the same side.
    if (big_m - mi) % 2 != 0 {
        big_m += if big_m < mi { 1 } else { -1 };
    }
    if big_m >= mi || big_m < 2 {
        return None;
    }

    let mut points: Vec<Pt> = vec![];
    for k in 0..=big_m {
        let v = v_first + ((v_last - v_first) * k as f64) / big_m as f64;
        let orig = rows[(k as usize).min(m)];
        // Same direction as the original row k.
        let fwd = u_of(orig.b) > u_of(orig.a);
        let a = if k == 0 {
            [p.x[r0.a] as f64, p.y[r0.a] as f64]
        } else {
            along(if fwd { &low } else { &high }, v)
        };
        let b = if k == big_m {
            [p.x[last.b] as f64, p.y[last.b] as f64]
        } else {
            along(if fwd { &high } else { &low }, v)
        };
        points.push(a);
        if l_len != 0.0 {
            // Stagger of the original row k: u position of its first inner stitch, modulo L.
            let phase = if orig.a.abs_diff(orig.b) > 1 {
                let first = if orig.b > orig.a {
                    orig.a + 1
                } else {
                    orig.a - 1
                };
                ((u_of(first) % l_len) + l_len) % l_len
            } else {
                0.0
            };
            let ua = a[0] * ux + a[1] * uy;
            let ub = b[0] * ux + b[1] * uy;
            let lo = ua.min(ub) + gap_end;
            let hi = ua.max(ub) - gap_end;
            let mut inner = vec![];
            let mut u = ((lo - phase) / l_len).ceil() * l_len + phase;
            while u < hi {
                inner.push(u);
                u += l_len;
            }
            if ua > ub {
                inner.reverse();
            }
            for u in inner {
                let f = (u - ua) / (ub - ua);
                points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
            }
        }
        points.push(b);
    }
    Some(Rebuilt {
        points,
        before: s,
        after: (v_last - v_first) / big_m as f64,
    })
}

pub struct Edit {
    pub from: usize,
    pub to: usize,
    pub points: Vec<Pt>,
    pub removed: usize,
}

pub struct Respaced {
    /// The records after the edits, not yet tidied; None when nothing changed.
    pub records: Option<(Vec<i32>, Vec<i32>, Vec<u8>)>,
    pub sweeps: usize,
    /// Rows removed in total (the remaining rows are spread evenly).
    pub rows: usize,
}

fn done(p: &Records, mut edits: Vec<Edit>) -> Respaced {
    if edits.is_empty() {
        return Respaced {
            records: None,
            sweeps: 0,
            rows: 0,
        };
    }
    let rows = edits.iter().map(|e| e.removed).sum();
    let sweeps = edits.len();
    edits.sort_by_key(|e| e.from);
    Respaced {
        records: Some(splice(p, &edits)),
        sweeps,
        rows,
    }
}

/// Fill sweeps re-spaced where `need` (per record, 0 to 1) asks for it, at most `max_spacing`
/// apart; a sweep changes when at least `min_share` of its rows are asked.
pub fn respace_fills(p: &Records, need: &[f64], max_spacing: f64, min_share: f64) -> Respaced {
    let mask = satin_mask(p, MIN_LEN);
    let mut edits = vec![];
    for r in stitch_runs(p) {
        if r.end - r.start < 8 {
            continue;
        }
        for sw in fill_sweeps(p, r.start, r.end, &mask) {
            let mut asked = 0;
            let mut total = 0.0;
            for row in &sw {
                let n = need[row.a].max(need[row.b]);
                if n > 0.0 {
                    asked += 1;
                    total += n;
                }
            }
            if asked == 0 || (asked as f64) < min_share * sw.len() as f64 {
                continue;
            }
            let Some(rebuilt) = rebuild_sweep(p, &sw, total / asked as f64, max_spacing) else {
                continue;
            };
            let n = sw.len() as f64 - 1.0;
            let removed = n - round((n * rebuilt.before) / rebuilt.after);
            edits.push(Edit {
                from: sw[0].a,
                to: sw[sw.len() - 1].b,
                points: rebuilt.points,
                removed: removed.max(0.0) as usize,
            });
        }
    }
    done(p, edits)
}

/// Replaces record ranges [from, to] by new stitch points; ranges are sorted and do not overlap.
fn splice(p: &Records, edits: &[Edit]) -> (Vec<i32>, Vec<i32>, Vec<u8>) {
    let mut xs = vec![];
    let mut ys = vec![];
    let mut cs = vec![];
    let mut i = 0;
    for e in edits {
        while i < e.from {
            xs.push(p.x[i]);
            ys.push(p.y[i]);
            cs.push(p.cmd[i]);
            i += 1;
        }
        for &[x, y] in &e.points {
            xs.push(round(x) as i32);
            ys.push(round(y) as i32);
            cs.push(STITCH);
        }
        i = e.to + 1;
    }
    while i < p.cmd.len() {
        xs.push(p.x[i]);
        ys.push(p.y[i]);
        cs.push(p.cmd[i]);
        i += 1;
    }
    (xs, ys, cs)
}

/// Resamples a polyline at `n` points evenly spaced by arc length (first and last kept).
fn resample(pts: &[Pt], n: usize) -> Vec<Pt> {
    let cum = cumulative(pts);
    let total = cum[cum.len() - 1];
    let mut out = vec![];
    let mut j = 1;
    for k in 0..n {
        let s = if n > 1 {
            (total * k as f64) / (n - 1) as f64
        } else {
            0.0
        };
        while j < pts.len() - 1 && cum[j] < s {
            j += 1;
        }
        let f = if cum[j] > cum[j - 1] {
            (s - cum[j - 1]) / (cum[j] - cum[j - 1])
        } else {
            0.0
        };
        out.push([
            pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f,
            pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f,
        ]);
    }
    out
}

/// Satin columns (start, end records) re-spaced evenly: the penetrations along each edge are
/// resampled at a wider, even spacing (removing single zigzags would leave visible gaps in the
/// column). Each edge keeps its shape, both edges keep the same number of penetrations so the
/// column still turns as before, and the first and last penetration stay.
pub fn respace_satins(
    p: &Records,
    need: &[f64],
    max_spacing: f64,
    min_share: f64,
    columns: &[(usize, usize)],
) -> Respaced {
    let mut edits = vec![];
    for &(start, end) in columns {
        let n = end - start + 1;
        if n < SATIN_MIN {
            continue;
        }
        let mut asked = 0;
        let mut total = 0.0;
        for i in start..=end {
            let v = need[i];
            if v > 0.0 {
                asked += 1;
                total += v;
            }
        }
        if asked == 0 || (asked as f64) < min_share * n as f64 {
            continue;
        }
        let need = total / asked as f64;
        let mut a: Vec<Pt> = vec![];
        let mut b: Vec<Pt> = vec![];
        for i in start..=end {
            let q = [p.x[i] as f64, p.y[i] as f64];
            if (i - start) % 2 == 1 {
                b.push(q)
            } else {
                a.push(q)
            }
        }
        let len = |e: &[Pt]| {
            let mut s = 0.0;
            for i in 1..e.len() {
                s += hypot(e[i][0] - e[i - 1][0], e[i][1] - e[i - 1][1]);
            }
            s
        };
        // Same-side spacing, measured on the longer (outer) edge as digitizers define it.
        let outer = len(&a).max(len(&b));
        let spacing = outer / ((a.len() as f64 - 1.0).max(1.0));
        let target = max_spacing.min(spacing / (1.0 - need).max(0.05));
        if target < spacing * MIN_GAIN {
            continue;
        }
        // Penetrations per edge.
        let m = (round(outer / target) + 1.0).max(2.0) as usize;
        if m >= a.len() {
            continue;
        }
        // Keep the column ending on the same edge: with an even count the last point is on edge b.
        let last_on_b = n % 2 == 0;
        let na = m;
        let nb = if last_on_b { m } else { m - 1 };
        if nb < 2 {
            continue;
        }
        let ra = resample(&a, na);
        let rb = resample(&b, nb);
        let mut points = vec![];
        for k in 0..na {
            points.push(ra[k]);
            if k < nb {
                points.push(rb[k]);
            }
        }
        let removed = n - points.len();
        edits.push(Edit {
            from: start,
            to: end,
            points,
            removed,
        });
    }
    done(p, edits)
}
