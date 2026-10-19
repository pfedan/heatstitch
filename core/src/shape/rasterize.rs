//! Forms as pixel regions (src/shape/rasterize.ts): an area or a stroke rastered with the fields the
//! fills are made from, and regions taken from, joined with and measured against others.

use serde::{Deserialize, Serialize};

use crate::digitize::region::{Region, signed_field};
use crate::image::edt::distance_inside;
use crate::js::hypot;
use crate::shape::path::{Form, Path, bounds, flatten};

/// Empty pixels around the area (as for regions built from images).
const MARGIN: i64 = 6;

/// The area of a form as pixels of `px_mm` (even-odd: paths inside others are holes; or nonzero for
/// forms marked so). Only closed paths count. None when it covers no pixel.
pub fn rasterize(f: &Form, px_mm: f64) -> Option<Region> {
    let closed: Vec<&Path> = f
        .paths
        .iter()
        .filter(|p| p.closed && p.nodes.len() >= 2)
        .collect();
    let b = bounds(&Form {
        paths: closed.iter().map(|p| (*p).clone()).collect(),
        nonzero: false,
    })?;
    let x0 = (b[0] / px_mm).floor() as i64 - MARGIN;
    let y0 = (b[1] / px_mm).floor() as i64 - MARGIN;
    let w = ((b[2] / px_mm).ceil() as i64 + MARGIN - x0) as usize;
    let h = ((b[3] / px_mm).ceil() as i64 + MARGIN - y0) as usize;
    let mut mask = vec![0u8; w * h];
    // Edges in pixel units, then one scanline through the pixel centers per row.
    let mut edges: Vec<[f64; 4]> = vec![];
    for p in &closed {
        let pts: Vec<[f64; 2]> = flatten(p, px_mm / 2.0)
            .iter()
            .map(|[x, y]| [x / px_mm - x0 as f64 - 0.5, y / px_mm - y0 as f64 - 0.5])
            .collect();
        for i in 0..pts.len() {
            let (a, c) = (pts[i], pts[(i + 1) % pts.len()]);
            if a[1] != c[1] {
                edges.push([a[0], a[1], c[0], c[1]]);
            }
        }
    }
    let mut area = 0usize;
    let mut xs: Vec<(f64, i32)> = vec![];
    let mut span = |mask: &mut [u8], y: usize, a: f64, b: f64| {
        let from = a.ceil().max(0.0) as i64;
        let to = ((b.ceil() - 1.0) as i64).min(w as i64 - 1);
        for x in from..=to {
            let i = y * w + x as usize;
            if mask[i] == 0 {
                area += 1;
            }
            mask[i] = 1;
        }
    };
    for y in 0..h {
        let yf = y as f64;
        xs.clear();
        for &[ax, ay, cx, cy] in &edges {
            // Half-open in y, so a vertex shared by two edges counts once.
            if (ay <= yf && cy > yf) || (cy <= yf && ay > yf) {
                xs.push((
                    ax + ((yf - ay) / (cy - ay)) * (cx - ax),
                    if cy > ay { 1 } else { -1 },
                ));
            }
        }
        xs.sort_by(|m, n| m.0.total_cmp(&n.0));
        if !f.nonzero {
            let mut k = 0;
            while k + 1 < xs.len() {
                span(&mut mask, y, xs[k].0, xs[k + 1].0);
                k += 2;
            }
            continue;
        }
        let mut wind = 0;
        for k in 0..xs.len().saturating_sub(1) {
            wind += xs[k].1;
            if wind != 0 {
                span(&mut mask, y, xs[k].0, xs[k + 1].0);
            }
        }
    }
    region_of(mask, x0 as i32, y0 as i32, w, h, px_mm, Some(area))
}

/// A region from a mask in its window (world pixel x0, y0), with its fields; None when empty.
pub fn region_of(
    mask: Vec<u8>,
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    px_mm: f64,
    area: Option<usize>,
) -> Option<Region> {
    let area = area.unwrap_or_else(|| mask.iter().map(|&m| m as usize).sum());
    if area == 0 {
        return None;
    }
    let sdf = signed_field(&mask, w, h, px_mm);
    let inside = distance_inside(&mask, w, h);
    Some(Region {
        label: 0,
        x0,
        y0,
        w,
        h,
        px_mm,
        mask,
        inside,
        sdf_base: sdf,
        sdf_grown: None,
        area_mm2: area as f64 * px_mm * px_mm,
    })
}

/// How the ends of an open line are drawn: cut off square at the end, or round.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineCap {
    Flat,
    Round,
}

/// Start point of a polyline and its unit direction there, measured over about `len`.
fn end_cut<'a>(mut pts: impl Iterator<Item = &'a [f64; 2]> + Clone, len: f64) -> [f64; 4] {
    let Some(&[sx, sy]) = pts.clone().next() else {
        return [0.0, 0.0, 1.0, 0.0];
    };
    let last = *pts.clone().last().unwrap_or(&[sx, sy]);
    let q = pts
        .find(|p| (p[0] - sx).powi(2) + (p[1] - sy).powi(2) >= len * len)
        .copied()
        .unwrap_or(last);
    let d = match hypot(q[0] - sx, q[1] - sy) {
        0.0 => 1.0,
        d => d,
    };
    [sx, sy, (q[0] - sx) / d, (q[1] - sy) / d]
}

/// A line of the form drawn `width` mm wide (round corners; round ends, or flat with `cap`), as an
/// area: the strokes of SVG shapes. Open and closed paths count.
pub fn rasterize_stroke(f: &Form, width: f64, px_mm: f64, cap: LineCap) -> Option<Region> {
    let b = bounds(f)?;
    if width.is_nan() || width <= 0.0 {
        return None;
    }
    let r = width / 2.0 / px_mm;
    let x0 = (b[0] / px_mm - r).floor() as i64 - MARGIN;
    let y0 = (b[1] / px_mm - r).floor() as i64 - MARGIN;
    let w = ((b[2] / px_mm + r).ceil() as i64 + MARGIN - x0) as usize;
    let h = ((b[3] / px_mm + r).ceil() as i64 + MARGIN - y0) as usize;
    let mut mask = vec![0u8; w * h];
    let r2 = r * r;
    for p in &f.paths {
        let mut pts: Vec<[f64; 2]> = flatten(p, px_mm / 2.0)
            .iter()
            .map(|[x, y]| [x / px_mm - x0 as f64 - 0.5, y / px_mm - y0 as f64 - 0.5])
            .collect();
        if p.closed && pts.len() > 1 {
            pts.push(pts[0]);
        }
        if pts.len() == 1 {
            pts.push(pts[0]);
        }
        // Flat ends: nothing beyond the first and the last point of an open line.
        let flat = cap == LineCap::Flat && !p.closed && pts.len() > 1;
        // Each end is cut square to the line's direction there (taken over a stretch as long as the
        // half width, since the flattened line is made of tiny steps), close to that end only, so a
        // line that turns back on itself is not cut elsewhere.
        let cut: Vec<[f64; 4]> = if flat {
            vec![end_cut(pts.iter(), r), end_cut(pts.iter().rev(), r)]
        } else {
            vec![]
        };
        let kept = |x: f64, y: f64| {
            cut.iter().all(|&[sx, sy, ux, uy]| {
                (x - sx) * ux + (y - sy) * uy >= 0.0
                    || (x - sx).powi(2) + (y - sy).powi(2) > 4.0 * r2
            })
        };
        for i in 0..pts.len().saturating_sub(1) {
            let [ax, ay] = pts[i];
            let [bx, by] = pts[i + 1];
            let (dx, dy) = (bx - ax, by - ay);
            let l2 = dx * dx + dy * dy;
            let min_x = (ax.min(bx) - r).floor().max(0.0) as i64;
            let max_x = ((ax.max(bx) + r).ceil() as i64).min(w as i64 - 1);
            let min_y = (ay.min(by) - r).floor().max(0.0) as i64;
            let max_y = ((ay.max(by) + r).ceil() as i64).min(h as i64 - 1);
            for y in min_y..=max_y {
                for x in min_x..=max_x {
                    let (xf, yf) = (x as f64, y as f64);
                    let t = if l2 > 0.0 {
                        (((xf - ax) * dx + (yf - ay) * dy) / l2).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let ex = ax + t * dx - xf;
                    let ey = ay + t * dy - yf;
                    if ex * ex + ey * ey <= r2 && (!flat || kept(xf, yf)) {
                        mask[y as usize * w + x as usize] = 1;
                    }
                }
            }
        }
    }
    region_of(mask, x0 as i32, y0 as i32, w, h, px_mm, None)
}

// Knocking out, sharing and joining regions, for Rust callers: the TypeScript keeps its own pixel
// loops, as copying masks and fields into the core costs more than the loops take.

/// The window and fields of a region another takes pixels away from.
pub struct Cover<'a> {
    pub x0: i32,
    pub y0: i32,
    pub w: usize,
    pub h: usize,
    pub px_mm: f64,
    pub sdf_base: &'a [f32],
}

/// `base` without what `covers` hide: a pixel goes when it lies deeper than `overlap` mm inside one
/// of them, so the area sewn first still reaches that far under the ones on top. None when nothing
/// is left or nothing is hidden (`changed` false: `base` stays as it is).
pub fn knock_out(base: &Region, covers: &[Cover], overlap: f64) -> (bool, Option<Region>) {
    let px = base.px_mm;
    let mut mask = base.mask.clone();
    let mut changed = false;
    let (bw, bh) = (base.w as i64, base.h as i64);
    for c in covers {
        if c.px_mm != px {
            continue;
        }
        // Overlap of the windows, in base pixels.
        let fx = (c.x0 as i64 - base.x0 as i64).max(0);
        let tx = (c.x0 as i64 + c.w as i64 - base.x0 as i64).min(bw);
        let fy = (c.y0 as i64 - base.y0 as i64).max(0);
        let ty = (c.y0 as i64 + c.h as i64 - base.y0 as i64).min(bh);
        for y in fy..ty {
            for x in fx..tx {
                let i = (y * bw + x) as usize;
                if mask[i] == 0 {
                    continue;
                }
                let ci = (y + base.y0 as i64 - c.y0 as i64) * c.w as i64
                    + (x + base.x0 as i64 - c.x0 as i64);
                if (c.sdf_base[ci as usize] as f64) < -overlap {
                    mask[i] = 0;
                    changed = true;
                }
            }
        }
    }
    if !changed {
        return (false, None);
    }
    (
        true,
        region_of(mask, base.x0, base.y0, base.w, base.h, px, None),
    )
}

/// A mask in its window.
pub struct Mask<'a> {
    pub x0: i32,
    pub y0: i32,
    pub w: usize,
    pub h: usize,
    pub mask: &'a [u8],
}

/// Pixels two masks share, as a count.
pub fn shared_pixels(a: &Mask, b: &Mask) -> usize {
    let fx = a.x0.max(b.x0) as i64;
    let tx = (a.x0 as i64 + a.w as i64).min(b.x0 as i64 + b.w as i64);
    let fy = a.y0.max(b.y0) as i64;
    let ty = (a.y0 as i64 + a.h as i64).min(b.y0 as i64 + b.h as i64);
    let mut n = 0;
    for y in fy..ty {
        for x in fx..tx {
            let ia = (y - a.y0 as i64) * a.w as i64 + x - a.x0 as i64;
            let ib = (y - b.y0 as i64) * b.w as i64 + x - b.x0 as i64;
            if a.mask[ia as usize] != 0 && b.mask[ib as usize] != 0 {
                n += 1;
            }
        }
    }
    n
}

/// Masks of the same pixel size as one region.
pub fn union_of(rs: &[Mask], px_mm: f64) -> Option<Region> {
    let x0 = rs.iter().map(|r| r.x0).min()?;
    let y0 = rs.iter().map(|r| r.y0).min()?;
    let w = (rs.iter().map(|r| r.x0 as i64 + r.w as i64).max()? - x0 as i64) as usize;
    let h = (rs.iter().map(|r| r.y0 as i64 + r.h as i64).max()? - y0 as i64) as usize;
    let mut mask = vec![0u8; w * h];
    for r in rs {
        for y in 0..r.h {
            for x in 0..r.w {
                if r.mask[y * r.w + x] != 0 {
                    let i = (y as i64 + r.y0 as i64 - y0 as i64) as usize * w
                        + (x as i64 + r.x0 as i64 - x0 as i64) as usize;
                    mask[i] = 1;
                }
            }
        }
    }
    region_of(mask, x0, y0, w, h, px_mm, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape::path::Node;

    fn square(s: f64) -> Form {
        Form {
            paths: vec![Path {
                closed: true,
                nodes: [[0.0, 0.0], [s, 0.0], [s, s], [0.0, s]]
                    .iter()
                    .map(|&p| Node {
                        p,
                        a: p,
                        b: p,
                        smooth: false,
                    })
                    .collect(),
            }],
            nonzero: false,
        }
    }

    #[test]
    fn a_square_covers_its_pixels() {
        let r = rasterize(&square(2.0), 0.1).unwrap();
        assert!((r.area_mm2 - 4.0).abs() < 1e-9);
        assert_eq!(r.w, 20 + 12);
    }

    #[test]
    fn strokes_flat_and_round() {
        let mut line = square(10.0);
        line.paths[0].closed = false;
        line.paths[0].nodes.truncate(2);
        let round = rasterize_stroke(&line, 1.0, 0.1, LineCap::Round).unwrap();
        let flat = rasterize_stroke(&line, 1.0, 0.1, LineCap::Flat).unwrap();
        assert!(round.area_mm2 > flat.area_mm2);
        assert!((flat.area_mm2 - 10.0).abs() < 0.3, "{}", flat.area_mm2);
    }

    #[test]
    fn knock_out_and_union() {
        let a = rasterize(&square(4.0), 0.1).unwrap();
        let cover = Cover {
            x0: a.x0,
            y0: a.y0,
            w: a.w,
            h: a.h,
            px_mm: a.px_mm,
            sdf_base: &a.sdf_base,
        };
        let (changed, left) = knock_out(&a, &[cover], 0.5);
        assert!(changed);
        let left = left.unwrap();
        assert!(left.area_mm2 < a.area_mm2 && left.area_mm2 > 0.0);
        fn m(r: &Region) -> Mask<'_> {
            Mask {
                x0: r.x0,
                y0: r.y0,
                w: r.w,
                h: r.h,
                mask: &r.mask,
            }
        }
        assert_eq!(
            shared_pixels(&m(&a), &m(&left)) as f64 * 0.01,
            left.area_mm2
        );
        let u = union_of(&[m(&a), m(&left)], 0.1).unwrap();
        assert!((u.area_mm2 - a.area_mm2).abs() < 1e-9);
    }
}
