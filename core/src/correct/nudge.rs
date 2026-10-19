//! Crowded penetrations pushed apart, and the ones that share a hole (src/correct/nudge.ts).

use super::sync_marks;
use crate::js::{IdMap, hypot, round};
use crate::pattern::{Records, STITCH};

#[inline]
fn key(bx: i64, by: i64) -> i64 {
    bx * 1_000_003 + by
}

/// Pushes crowded penetrations apart, by at most `max_shift`. Each penetration marked `movable` is
/// repelled by every other penetration within `radius` (0.1 mm), more strongly the closer it is;
/// two penetrations in the same hole separate sideways to the stitch direction. This separates
/// stacked holes (two layers hitting the same spot, the classic same-hole problem) and relieves
/// perforation at stacked edges. It does not lower the thread per area; only thinning does.
/// Returns the new positions (marks synced) and how many moved.
pub fn nudge_penetrations(
    p: &Records,
    movable: &[u8],
    radius: f64,
    max_shift: f64,
    iterations: usize,
) -> (Vec<i32>, Vec<i32>, usize) {
    let n = p.cmd.len();
    let idx: Vec<usize> = (0..n).filter(|&i| p.cmd[i] == STITCH).collect();
    let mut fx: Vec<f64> = p.x.iter().map(|&v| v as f64).collect();
    let mut fy: Vec<f64> = p.y.iter().map(|&v| v as f64).collect();
    let r = radius;
    let mv: Vec<usize> = idx.iter().copied().filter(|&i| movable[i] != 0).collect();
    if mv.is_empty() {
        return (p.x.clone(), p.y.clone(), 0);
    }
    let mut mx = vec![0.0; mv.len()];
    let mut my = vec![0.0; mv.len()];
    for _ in 0..iterations {
        let mut buckets: IdMap<i64, Vec<usize>> = IdMap::default();
        for &i in &idx {
            let k = key((fx[i] / r).floor() as i64, (fy[i] / r).floor() as i64);
            buckets.entry(k).or_default().push(i);
        }
        for (m, &i) in mv.iter().enumerate() {
            let bx = (fx[i] / r).floor() as i64;
            let by = (fy[i] / r).floor() as i64;
            let mut sx = 0.0;
            let mut sy = 0.0;
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let Some(list) = buckets.get(&key(bx + dx, by + dy)) else {
                        continue;
                    };
                    for &j in list {
                        if j == i {
                            continue;
                        }
                        let ex = fx[i] - fx[j];
                        let ey = fy[i] - fy[j];
                        let d = hypot(ex, ey);
                        if d >= r {
                            continue;
                        }
                        let w = (r - d) / r;
                        if d < 0.5 {
                            // Same hole: move sideways to the local stitch direction, the later
                            // stitch to the left.
                            let a = i.saturating_sub(1);
                            let b = (i + 1).min(n - 1);
                            let mut tx = fx[b] - fx[a];
                            let mut ty = fy[b] - fy[a];
                            let tl = hypot(tx, ty);
                            let tl = if tl == 0.0 { 1.0 } else { tl };
                            tx /= tl;
                            ty /= tl;
                            let side = if i > j { 1.0 } else { -1.0 };
                            sx += -ty * side * w;
                            sy += tx * side * w;
                        } else {
                            sx += (ex / d) * w;
                            sy += (ey / d) * w;
                        }
                    }
                }
            }
            // At most 0.1 mm per iteration keeps the relaxation stable.
            let l = hypot(sx, sy);
            let step = (l * 0.5).min(1.0);
            mx[m] = if l != 0.0 { (sx / l) * step } else { 0.0 };
            my[m] = if l != 0.0 { (sy / l) * step } else { 0.0 };
        }
        for (m, &i) in mv.iter().enumerate() {
            let mut nx = fx[i] + mx[m];
            let mut ny = fy[i] + my[m];
            let ox = nx - p.x[i] as f64;
            let oy = ny - p.y[i] as f64;
            let o = hypot(ox, oy);
            if o > max_shift {
                nx = p.x[i] as f64 + (ox / o) * max_shift;
                ny = p.y[i] as f64 + (oy / o) * max_shift;
            }
            fx[i] = nx;
            fy[i] = ny;
        }
    }
    let mut x = p.x.clone();
    let mut y = p.y.clone();
    let mut moved = 0;
    for &i in &mv {
        let nx = round(fx[i]) as i32;
        let ny = round(fy[i]) as i32;
        if nx != x[i] || ny != y[i] {
            moved += 1;
        }
        x[i] = nx;
        y[i] = ny;
    }
    if moved > 0 {
        sync_marks(&mut x, &mut y, &p.cmd);
    }
    (x, y, moved)
}

/// Penetrations that share a hole (closer than `within`, 0.1 mm) with a penetration more than four
/// stitches away in the same run, or in another run. Lock stitches and bean stitches revisit their
/// holes within a few stitches on purpose and are skipped.
pub fn same_hole_stitches(p: &Records, within: f64) -> Vec<u8> {
    let n = p.cmd.len();
    let mut out = vec![0u8; n];
    let mut buckets: IdMap<i64, Vec<usize>> = IdMap::default();
    for i in 0..n {
        if p.cmd[i] != STITCH {
            continue;
        }
        let bx = (p.x[i] as f64 / within).floor() as i64;
        let by = (p.y[i] as f64 / within).floor() as i64;
        for dy in -1..=1 {
            for dx in -1..=1 {
                let Some(list) = buckets.get(&key(bx + dx, by + dy)) else {
                    continue;
                };
                for &j in list {
                    if i - j <= 4 && p.cmd[j..=i].iter().all(|&c| c == STITCH) {
                        continue;
                    }
                    if hypot((p.x[i] - p.x[j]) as f64, (p.y[i] - p.y[j]) as f64) < within {
                        out[i] = 1;
                        out[j] = 1;
                    }
                }
            }
        }
        buckets.entry(key(bx, by)).or_default().push(i);
    }
    out
}
