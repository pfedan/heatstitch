//! Hidden travel between objects (src/model/travel.ts): the way under the dense fills sewn later,
//! found on a grid of its own. Which areas hide what, the check of a way as sewn (sampling the
//! areas' fields point by point) and the caches stay TypeScript; the grid comes here with the
//! cells under the hiding areas set.

use crate::digitize::fill::{TRAVEL_STITCH, path_length};
use crate::digitize::run::run_stitch;
use crate::digitize::travel_grid::TravelGrid;
use crate::geom::Pt;
use crate::js::{hypot, round};
use crate::shape::rasterize::region_of;

/// Travel keeps this far inside what hides it (mm): rows pull in at their ends, the fabric moves.
pub const HIDE_INSET: f64 = 0.5;
/// Within this of its ends (mm) travel leaves the object before and reaches the next one.
pub const HIDE_ENDS: f64 = 1.0;
/// Grid travel is planned on (mm).
pub const CELL: f64 = 0.25;

/// The cells round a cell within HIDE_INSET (as offsets): all under, the cell lies off every edge.
fn disc() -> Vec<(i64, i64)> {
    let n = (HIDE_INSET / CELL).round() as i64;
    let mut out = vec![];
    for dj in -n..=n {
        for di in -n..=n {
            if (di != 0 || dj != 0) && hypot(di as f64, dj as f64) * CELL <= HIDE_INSET {
                out.push((di, dj));
            }
        }
    }
    out
}

/// Whether cells `s` and `t` (column, row) are joined through set cells of `m` (w by h).
fn joins(m: &[u8], w: usize, h: usize, s: (i64, i64), t: (i64, i64)) -> bool {
    let at = |c: (i64, i64)| {
        (c.0 >= 0 && c.1 >= 0 && (c.0 as usize) < w && (c.1 as usize) < h)
            .then(|| c.1 as usize * w + c.0 as usize)
    };
    let (Some(from), Some(to)) = (at(s), at(t)) else {
        return false;
    };
    if m[from] == 0 || m[to] == 0 {
        return false;
    }
    let n = w * h;
    let mut seen = vec![0u8; n];
    let mut queue = Vec::with_capacity(n);
    let mut head = 0;
    queue.push(from);
    seen[from] = 1;
    while head < queue.len() {
        let k = queue[head];
        head += 1;
        if k == to {
            return true;
        }
        let nb = [k.wrapping_sub(1), k + 1, k.wrapping_sub(w), k + w];
        for (q, ok) in nb.into_iter().zip([k >= 1, true, k >= w, true]) {
            if !ok || q >= n || seen[q] != 0 || m[q] == 0 {
                continue;
            }
            seen[q] = 1;
            queue.push(q);
        }
    }
    false
}

/// The stitches of a hidden way from `a` to `b` without its ends (search in travel.ts, before the
/// way is checked as sewn): `under` the cells (CELL mm, window x0, y0, w by h) that lie under a
/// hiding area by its inset. None when the cells off the edges do not join a and b or the way is
/// longer than `reach`.
#[allow(clippy::too_many_arguments)]
pub fn hidden_search(
    under: &[u8],
    x0: i64,
    y0: i64,
    w: usize,
    h: usize,
    a: Pt,
    b: Pt,
    reach: f64,
) -> Option<Vec<Pt>> {
    // Off the edges: cells whose disc of HIDE_INSET lies under all of it (the union shrunk), and the
    // discs round the two ends.
    let mut deep = vec![0u8; w * h];
    let disc: Vec<i64> = disc().iter().map(|&(di, dj)| dj * w as i64 + di).collect();
    for j in 2..h.saturating_sub(2) {
        for i in 2..w.saturating_sub(2) {
            let k = j * w + i;
            if under[k] == 0 {
                continue;
            }
            if disc.iter().all(|&d| under[(k as i64 + d) as usize] == 1) {
                deep[k] = 1;
            }
        }
    }
    let ends = HIDE_ENDS * 0.9;
    for e in [a, b] {
        let ci = (e[0] / CELL).floor() as i64 - x0;
        let cj = (e[1] / CELL).floor() as i64 - y0;
        let r = (ends / CELL).ceil() as i64 + 1;
        for j in 2.max(cj - r)..=(h as i64 - 3).min(cj + r) {
            for i in 2.max(ci - r)..=(w as i64 - 3).min(ci + r) {
                let (cx, cy) = ((x0 + i) as f64 + 0.5, (y0 + j) as f64 + 0.5);
                if hypot(cx * CELL - e[0], cy * CELL - e[1]) < ends {
                    deep[j as usize * w + i as usize] = 1;
                }
            }
        }
    }
    // Not joined there at all: no way (a quick answer for most pairs, before the field is worked out).
    let cell = |q: Pt| {
        (
            (q[0] / CELL).floor() as i64 - x0,
            (q[1] / CELL).floor() as i64 - y0,
        )
    };
    if !joins(&deep, w, h, cell(a), cell(b)) {
        return None;
    }
    let region = region_of(deep, x0 as i32, y0 as i32, w, h, CELL, None)?;
    let mut grid = TravelGrid::new(&region, false, None);
    let path = grid.path(a, b, false)?;
    if path_length(&path) > reach {
        return None;
    }
    let pts: Vec<Pt> = run_stitch(&path, TRAVEL_STITCH, 0.1)
        .into_iter()
        .map(|q| [round(q[0] * 10.0) / 10.0, round(q[1] * 10.0) / 10.0])
        .collect();
    // A way of one stitch still gets a point of its own: the object it leads to knows its travel by its stitches.
    if pts.len() <= 2 {
        return Some(vec![[
            round(((a[0] + b[0]) / 2.0) * 10.0) / 10.0,
            round(((a[1] + b[1]) / 2.0) * 10.0) / 10.0,
        ]]);
    }
    Some(pts[1..pts.len() - 1].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cells of a window 0 to 20 by 0 to 12 mm, under a hiding area where `f` holds.
    fn cells(f: impl Fn(f64, f64) -> bool) -> (Vec<u8>, usize, usize) {
        let (w, h) = (80, 48);
        let mut m = vec![0u8; w * h];
        for j in 2..h - 2 {
            for i in 2..w - 2 {
                m[j * w + i] = u8::from(f((i as f64 + 0.5) * CELL, (j as f64 + 0.5) * CELL));
            }
        }
        (m, w, h)
    }

    #[test]
    fn finds_the_way_under_what_hides_it() {
        // A U: the way from one arm to the other runs round the bottom.
        let (m, w, h) = cells(|x, y| {
            (2.0..18.0).contains(&x)
                && (2.0..10.0).contains(&y)
                && !((7.0..13.0).contains(&x) && y < 7.0)
        });
        let (a, b) = ([4.0, 3.0], [16.0, 3.0]);
        let way = hidden_search(&m, 0, 0, w, h, a, b, 60.0).unwrap();
        assert!(way.iter().any(|q| q[1] > 7.0), "{way:?}");
        for q in &way {
            assert_eq!(*q, [round(q[0] * 10.0) / 10.0, round(q[1] * 10.0) / 10.0]);
        }
        // Too long a way is none.
        assert!(hidden_search(&m, 0, 0, w, h, a, b, 13.0).is_none());
        // Two areas apart: none.
        let (m, w, h) = cells(|x, y| (2.0..10.0).contains(&y) && !(9.0..11.0).contains(&x));
        assert!(hidden_search(&m, 0, 0, w, h, [4.0, 5.0], [16.0, 5.0], 60.0).is_none());
    }
}
