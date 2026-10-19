//! A border sewn around a fill on its edge (what Ink/Stitch sews for the stroke of a filled path,
//! and digitizing software calls an outline): a running stitch, a triple (bean) stitch or a satin
//! of a set width, centered on the edge, around the outside and every hole; or an open zigzag, or
//! an E stitch (blanket stitch) with its edge on the line, as appliqué is sewn on; or a motif
//! repeated along it (motif.rs).

use super::region::{Region, outline, sample, signed_field};
use super::run::run_stitch;
use crate::geom::Pt;
use crate::js::dist;

/// Stitch length of a running or triple border (mm).
pub const BORDER_STITCH: f64 = 2.5;
/// Loops shorter than this are left without a border (mm).
const MIN_LOOP: f64 = 1.5;

fn length_of(l: &[Pt]) -> f64 {
    let mut s = 0.0;
    for i in 1..l.len() {
        s += dist(l[i - 1], l[i]);
    }
    s
}

/// The edge of the area as closed lines (first point repeated at the end), long enough to sew;
/// `offset` mm outside it (inside when negative).
pub fn border_loops(r: &Region, offset: f64) -> Vec<Vec<Pt>> {
    let padded_r;
    let f = if offset > 0.0 {
        padded_r = padded(r, offset + 0.5);
        &padded_r
    } else {
        r
    };
    outline(f, offset, &f.sdf_base)
        .into_iter()
        .filter(|l| length_of(l) >= MIN_LOOP)
        .collect()
}

/// The loops in the order to sew them, starting near `from`: each starts at its point nearest the
/// needle, the next is the one nearest where the last ended (a closed loop ends where it starts).
pub fn order_loops(loops: &[Vec<Pt>], from: Pt) -> Vec<Vec<Pt>> {
    let mut todo: Vec<&Vec<Pt>> = loops.iter().collect();
    let mut out = Vec::new();
    let mut at = from;
    while !todo.is_empty() {
        let (mut best, mut best_k, mut best_d) = (0, 0, f64::INFINITY);
        for (j, l) in todo.iter().enumerate() {
            for (k, &q) in l.iter().enumerate() {
                let d = dist(q, at);
                if d < best_d {
                    best_d = d;
                    best = j;
                    best_k = k;
                }
            }
        }
        let l = todo.remove(best);
        let open = &l[..l.len() - 1];
        let k = best_k % open.len();
        let mut lp: Vec<Pt> = open[k..].to_vec();
        lp.extend_from_slice(&open[..k]);
        lp.push(open[k]);
        at = lp[0];
        out.push(lp);
    }
    out
}

/// Evenly spaced points along a line, `step` apart (both ends kept).
pub fn resample(pts: &[Pt], step: f64) -> Vec<Pt> {
    let mut out = vec![pts[0]];
    let mut carry = 0.0;
    for i in 1..pts.len() {
        let (a, b) = (pts[i - 1], pts[i]);
        let l = dist(a, b);
        let mut t = step - carry;
        while t <= l {
            out.push([
                a[0] + ((b[0] - a[0]) * t) / l,
                a[1] + ((b[1] - a[1]) * t) / l,
            ]);
            t += step;
        }
        carry = l - (t - step);
    }
    let last = pts[pts.len() - 1];
    let n = out.len();
    if dist(out[n - 1], last) > step * 0.3 {
        out.push(last);
    } else {
        out[n - 1] = last;
    }
    out
}

/// A closed line smoothed by a moving average (the pixel steps of a traced edge go).
fn smooth_loop(pts: &[Pt], k: usize) -> Vec<Pt> {
    let open = &pts[..pts.len() - 1];
    let n = open.len();
    if n < 2 * k + 1 {
        return pts.to_vec();
    }
    let ki = k as isize;
    let mut out: Vec<Pt> = (0..n)
        .map(|i| {
            let (mut x, mut y) = (0.0, 0.0);
            for j in -ki..=ki {
                let q = open[((i as isize + j + n as isize) as usize) % n];
                x += q[0];
                y += q[1];
            }
            [x / (2 * k + 1) as f64, y / (2 * k + 1) as f64]
        })
        .collect();
    out.push(out[0]);
    out
}

/// The area's shape (as stored, not grown or shrunk) with a wider empty margin, so its field
/// reaches `mm` outside its edge.
pub fn padded(r: &Region, mm: f64) -> Region {
    let pad = (mm / r.px_mm).ceil() as usize + 2;
    let w = r.w + 2 * pad;
    let h = r.h + 2 * pad;
    let mut mask = vec![0u8; w * h];
    for y in 0..r.h {
        for x in 0..r.w {
            mask[(y + pad) * w + x + pad] = u8::from(r.sdf_base[y * r.w + x] < 0.0);
        }
    }
    let f = signed_field(&mask, w, h, r.px_mm);
    Region {
        label: r.label,
        x0: r.x0 - pad as i32,
        y0: r.y0 - pad as i32,
        w,
        h,
        px_mm: r.px_mm,
        mask,
        inside: r.inside.clone(),
        sdf_base: f,
        sdf_grown: None,
        area_mm2: r.area_mm2,
    }
}

/// Rails of a satin band: one point on each side per point of its line.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Rails {
    pub left: Vec<Pt>,
    pub right: Vec<Pt>,
}

/// Rails of a satin of width `w` centered on a closed line `level` mm outside the edge (inside
/// when negative). Each side reaches half the width along the normal, less where the band around
/// that line is narrower (inside a corner), so the rails do not fold over at corners.
pub fn border_rails(r: &Region, lp: &[Pt], w: f64, level: f64) -> Rails {
    rails_along(r, lp, w, level).0
}

/// border_rails, with the points of the line they are centered on (one per rail point).
pub fn rails_along(r: &Region, lp: &[Pt], w: f64, level: f64) -> (Rails, Vec<Pt>) {
    let half = w / 2.0;
    let f = padded(r, half * 1.7 + 0.5 + level.max(0.0));
    let center = smooth_loop(&resample(lp, 0.2), 3);
    let n = center.len() - 1;
    let open = &center[..n];
    let tangent = |i: usize| -> Pt {
        let a = open[(i as isize - 3).rem_euclid(n as isize) as usize];
        let b = open[(i + 3) % n];
        let l = dist(a, b);
        let l = if l == 0.0 { 1.0 } else { l };
        [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
    };
    // Distance from the edge along +-normal until the band |d| <= half is left.
    let reach = |c: Pt, d: Pt| -> f64 {
        let step = 0.05;
        let mut s = step;
        while s <= half * 1.6 {
            let v = (sample(&f, &f.sdf_base, c[0] + d[0] * s, c[1] + d[1] * s) - level).abs();
            if v >= half {
                return s;
            }
            s += step;
        }
        half
    };
    let mut ls = Vec::with_capacity(n);
    let mut rs = Vec::with_capacity(n);
    for i in 0..n {
        let t = tangent(i);
        let nn = [-t[1], t[0]];
        ls.push(half.min(reach(open[i], nn)));
        rs.push(half.min(reach(open[i], [-nn[0], -nn[1]])));
    }
    let mut left = Vec::with_capacity(n + 1);
    let mut right = Vec::with_capacity(n + 1);
    for i in 0..=n {
        let k = i % n;
        let t = tangent(k);
        let nn = [-t[1], t[0]];
        left.push([open[k][0] + nn[0] * ls[k], open[k][1] + nn[1] * ls[k]]);
        right.push([open[k][0] - nn[0] * rs[k], open[k][1] - nn[1] * rs[k]]);
    }
    (Rails { left, right }, center)
}

/// An open line smoothed by a moving average; the ends stay where they are.
fn smooth_line(pts: &[Pt], k: usize) -> Vec<Pt> {
    let n = pts.len();
    if n < 2 * k + 1 {
        return pts.to_vec();
    }
    (0..n)
        .map(|i| {
            if i == 0 || i == n - 1 {
                return pts[i];
            }
            let r = k.min(i).min(n - 1 - i);
            let (mut x, mut y) = (0.0, 0.0);
            for j in i - r..=i + r {
                x += pts[j][0];
                y += pts[j][1];
            }
            [x / (2 * r + 1) as f64, y / (2 * r + 1) as f64]
        })
        .collect()
}

/// Rails of a satin of width `w` centered on a line with no area around it (a drawn line): each
/// side half the width out along the normal. A closed line repeats its first point at the end.
pub fn line_rails(line: &[Pt], closed: bool, w: f64) -> Rails {
    let half = w / 2.0;
    let center = if closed {
        smooth_loop(&resample(line, 0.2), 3)
    } else {
        smooth_line(&resample(line, 0.2), 3)
    };
    let n = center.len() as isize;
    let at = |i: isize| -> Pt {
        if closed {
            center[(((i % (n - 1)) + (n - 1)) % (n - 1)) as usize]
        } else {
            center[i.clamp(0, n - 1) as usize]
        }
    };
    let mut left = Vec::with_capacity(n as usize);
    let mut right = Vec::with_capacity(n as usize);
    for i in 0..n {
        let (a, b) = (at(i - 3), at(i + 3));
        let l = dist(a, b);
        let l = if l == 0.0 { 1.0 } else { l };
        let nn = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
        let c = center[i as usize];
        left.push([c[0] + nn[0] * half, c[1] + nn[1] * half]);
        right.push([c[0] - nn[0] * half, c[1] - nn[1] * half]);
    }
    Rails { left, right }
}

/// Running stitch along a line (closed or not), each stitch sewn `times` times (3 or 5: bean stitch).
pub fn border_run(lp: &[Pt], times: u32, tol: f64, len: f64) -> Vec<Pt> {
    let pts = run_stitch(lp, len, tol);
    if times < 3 {
        return pts;
    }
    let mut out = vec![pts[0]];
    for i in 1..pts.len() {
        let mut k = 0.0;
        while k < f64::from(times - 1) / 2.0 {
            out.push(pts[i]);
            out.push(pts[i - 1]);
            k += 1.0;
        }
        out.push(pts[i]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    #[test]
    fn a_disc_has_one_loop_and_rails_around_it() {
        let r = region_of(120, 0.1, |x, y| (x - 6.0).hypot(y - 6.0) < 4.0);
        let loops = border_loops(&r, 0.0);
        assert_eq!(loops.len(), 1);
        let l = &loops[0];
        assert!((length_of(l) - 2.0 * std::f64::consts::PI * 4.0).abs() < 0.5);
        let rails = border_rails(&r, l, 2.0, 0.0);
        assert_eq!(rails.left.len(), rails.right.len());
        let ordered = order_loops(&loops, [6.0, 10.0]);
        assert!(dist(ordered[0][0], [6.0, 10.0]) < 0.3);
        assert_eq!(ordered[0][0], *ordered[0].last().unwrap());
    }

    #[test]
    fn resample_keeps_the_ends() {
        let pts = resample(&[[0.0, 0.0], [1.0, 0.0], [1.0, 1.05]], 0.5);
        assert_eq!(pts[0], [0.0, 0.0]);
        assert_eq!(*pts.last().unwrap(), [1.0, 1.05]);
        let run = border_run(&[[0.0, 0.0], [5.0, 0.0]], 3, 0.15, 2.5);
        assert_eq!(run.len(), 1 + 3 * 2);
        let rails = line_rails(&[[0.0, 0.0], [5.0, 0.0]], false, 2.0);
        assert!((rails.left[3][1] - 1.0).abs() < 1e-9);
    }
}
