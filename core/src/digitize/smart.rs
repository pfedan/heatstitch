//! What the Smart style of the image assistant measures per area (src/digitize/smart.ts): how
//! clearly the image has a direction of its own there, and the satin column across a small round
//! area. Which technique it then chooses, and the list of areas, stay in TypeScript.

use super::flow::OrientLook;
use super::region::{Region, sample};
use super::skeleton::{Branch, Graph, Node};
use crate::geom::Pt;
use crate::image::labels::Components;
use crate::js::hypot;
use crate::trig::JsMath;

/// The image's own structure counts this far inside an area (mm): its edges are those of other areas.
const INSET_MM: f64 = 2.0;

/// How clearly the image has a direction of its own inside the area: the mean coherence of the
/// structure tensor (0 flat or without direction, 1 everywhere one clear line direction), away from
/// the area's edge. Zero without orientation.
pub fn structure(r: &Region, orient: Option<&OrientLook>) -> f64 {
    let Some(orient) = orient else { return 0.0 };
    let inset = INSET_MM / r.px_mm;
    let (mut sum, mut n, mut sum_all, mut n_all) = (0.0, 0usize, 0.0, 0usize);
    for y in 0..r.h {
        for x in 0..r.w {
            let i = y * r.w + x;
            if r.mask[i] == 0 {
                continue;
            }
            let gx = x as i64 + i64::from(r.x0);
            let gy = y as i64 + i64::from(r.y0);
            if gx < 0 || gy < 0 || gx >= orient.width as i64 || gy >= orient.height as i64 {
                continue;
            }
            let (c, s) = (orient.look)(gx as usize, gy as usize);
            let m = hypot(f64::from(c), f64::from(s));
            sum_all += m;
            n_all += 1;
            if f64::from(r.inside[i]) < inset {
                continue;
            }
            sum += m;
            n += 1;
        }
    }
    // A narrow area has no inside: then all of it.
    if n >= 20 {
        sum / n as f64
    } else if n_all > 0 {
        sum_all / n_all as f64
    } else {
        0.0
    }
}

/// Widest inscribed circle of the area (mm).
pub fn widest(r: &Region) -> f64 {
    let m = r
        .inside
        .iter()
        .fold(0.0f32, |m, &v| if v > m { v } else { m });
    2.0 * f64::from(m) * r.px_mm
}

/// A single satin column across the area along its longest axis (its stitches cross it the short
/// way), or None when the area is no small blob: wider than `satin_max` or `max_width` anywhere, or
/// larger than `max_area` (ROUND_MAX_WIDTH and ROUND_MAX_MM2 in TypeScript; set by hand: other limits).
pub fn across_graph(r: &Region, satin_max: f64, max_width: f64, max_area: f64) -> Option<Graph> {
    if r.area_mm2 > max_area || widest(r) > satin_max.min(max_width) {
        return None;
    }
    // Centroid and second moments of the pixels.
    let (mut n, mut sx, mut sy) = (0.0, 0.0, 0.0);
    for y in 0..r.h {
        for x in 0..r.w {
            if r.mask[y * r.w + x] != 0 {
                n += 1.0;
                sx += x as f64;
                sy += y as f64;
            }
        }
    }
    if n < 4.0 {
        return None;
    }
    let cx = sx / n;
    let cy = sy / n;
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    for y in 0..r.h {
        for x in 0..r.w {
            if r.mask[y * r.w + x] == 0 {
                continue;
            }
            let (dx, dy) = (x as f64 - cx, y as f64 - cy);
            xx += dx.js_pow(2.0);
            xy += dx * dy;
            yy += dy.js_pow(2.0);
        }
    }
    let a = 0.5 * (2.0 * xy).atan2(xx - yy);
    let d: Pt = [a.js_cos(), a.js_sin()];
    let c: Pt = [
        (cx + f64::from(r.x0) + 0.5) * r.px_mm,
        (cy + f64::from(r.y0) + 0.5) * r.px_mm,
    ];
    // Along the axis both ways from the centroid, as long as it is inside.
    let step = 0.2f64.max(r.px_mm);
    let inside = |t: f64| sample(r, &r.sdf_base, c[0] + d[0] * t, c[1] + d[1] * t) < 0.0;
    if !inside(0.0) {
        return None;
    }
    let (mut t0, mut t1) = (0.0, 0.0);
    while inside(t0 - step) {
        t0 -= step;
    }
    while inside(t1 + step) {
        t1 += step;
    }
    // The ends stay a little inside: the column is extended into its free ends (satin.rs).
    let ends = 0.3f64.min((t1 - t0) / 4.0);
    t0 += ends;
    t1 -= ends;
    if t1 - t0 < step * 2.0 {
        return None;
    }
    // Half the chord across at each point (not the distance to the nearest edge, which near the
    // ends of a round area is much shorter): the rails are found within it (satin.rs).
    let half = |p: Pt, side: f64| {
        let mut u = 0.0;
        while u < satin_max
            && sample(
                r,
                &r.sdf_base,
                p[0] - d[1] * side * (u + step / 2.0),
                p[1] + d[0] * side * (u + step / 2.0),
            ) < 0.0
        {
            u += step / 2.0;
        }
        u
    };
    let mut pts = vec![];
    let mut rad = vec![];
    let mut t = t0;
    while t <= t1 + 1e-9 {
        let p = [c[0] + d[0] * t, c[1] + d[1] * t];
        pts.push(p);
        rad.push(0.1f64.max(half(p, 1.0)).max(half(p, -1.0)));
        t += step;
    }
    Some(Graph {
        nodes: vec![
            Node {
                p: pts[0],
                r: rad[0],
            },
            Node {
                p: pts[pts.len() - 1],
                r: rad[rad.len() - 1],
            },
        ],
        branches: vec![Branch {
            a: 0,
            b: 1,
            pts,
            r: rad,
        }],
    })
}

/// An area as its key names it: its color and bounding box in image pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct AreaBox {
    pub label: u16,
    pub min_x: u32,
    pub min_y: u32,
    pub max_x: u32,
    pub max_y: u32,
}

/// The pixels of some areas (1 inside), to show them on the stage: the pieces of the area's color
/// inside its box (several when a later detail cut it apart), without pieces that are areas of
/// their own (a dot inside a ring). `all` are the boxes of every area, `keys` those to show.
pub fn area_pixels(
    comps: &Components,
    w: usize,
    h: usize,
    all: &[AreaBox],
    keys: &[AreaBox],
) -> Vec<u8> {
    let mut out = vec![0u8; w * h];
    let all: std::collections::HashSet<AreaBox> = all.iter().copied().collect();
    let mut take = vec![false; comps.label.len()];
    for b in keys {
        for (c, &l) in comps.label.iter().enumerate() {
            if l != b.label
                || comps.min_x[c] < b.min_x
                || comps.min_y[c] < b.min_y
                || comps.max_x[c] > b.max_x
                || comps.max_y[c] > b.max_y
            {
                continue;
            }
            let own = AreaBox {
                label: l,
                min_x: comps.min_x[c],
                min_y: comps.min_y[c],
                max_x: comps.max_x[c],
                max_y: comps.max_y[c],
            };
            if own == *b || !all.contains(&own) {
                take[c] = true;
            }
        }
    }
    for i in 0..w * h {
        if take[comps.comp[i] as usize] {
            out[i] = 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;
    use crate::image::labels::components;

    #[test]
    fn a_small_oval_gets_one_column_along_its_long_axis() {
        let r = region_of(100, 0.1, |x, y| {
            ((x - 5.0) / 2.5).powi(2) + ((y - 5.0) / 1.5).powi(2) < 1.0
        });
        let g = across_graph(&r, 7.0, 4.5, 60.0).expect("across");
        let b = &g.branches[0];
        // Along x, about 5 mm long less the ends, half widths up to 1.5 mm.
        assert!((b.pts[0][1] - b.pts[b.pts.len() - 1][1]).abs() < 0.1);
        assert!((b.pts[b.pts.len() - 1][0] - b.pts[0][0]) > 3.5);
        assert!(b.r.iter().all(|&v| v <= 1.6));
        // Too wide for satin across.
        assert!(across_graph(&r, 7.0, 2.0, 60.0).is_none());
        assert!((widest(&r) - 3.0).abs() < 0.3);
    }

    #[test]
    fn structure_is_the_mean_coherence_inside() {
        let r = region_of(100, 0.1, |x, y| {
            (1.0..9.0).contains(&x) && (1.0..9.0).contains(&y)
        });
        let look = |_: usize, _: usize| (0.6f32, 0.8f32);
        let o = OrientLook {
            width: 100,
            height: 100,
            look: &look,
        };
        assert!((structure(&r, Some(&o)) - 1.0).abs() < 1e-6);
        assert_eq!(structure(&r, None), 0.0);
    }

    #[test]
    fn area_pixels_leave_out_areas_of_their_own() {
        // A ring of label 0 with a dot of label 0 inside it, apart.
        let (w, h) = (40, 40);
        let mut labels = vec![1u8; w * h];
        for y in 0..h {
            for x in 0..w {
                let d = ((x as f64 - 20.0).powi(2) + (y as f64 - 20.0).powi(2)).sqrt();
                if (12.0..16.0).contains(&d) || d < 3.0 {
                    labels[y * w + x] = 0;
                }
            }
        }
        let c = components(&labels, w, h);
        let boxes: Vec<AreaBox> = (0..c.label.len())
            .filter(|&k| c.label[k] == 0)
            .map(|k| AreaBox {
                label: 0,
                min_x: c.min_x[k],
                min_y: c.min_y[k],
                max_x: c.max_x[k],
                max_y: c.max_y[k],
            })
            .collect();
        assert_eq!(boxes.len(), 2);
        let ring = *boxes.iter().max_by_key(|b| b.max_x - b.min_x).unwrap();
        let px = area_pixels(&c, w, h, &boxes, &[ring]);
        assert_eq!(px[20 * w + 20], 0);
        assert_eq!(px[20 * w + 6], 1);
    }
}
