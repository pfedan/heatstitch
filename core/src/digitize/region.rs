//! One connected color region, in its own pixel window, with a signed distance field.
//!
//! The field (negative inside, in mm) is what the stitch generators work on instead of traced
//! polygons: fill rows end where it crosses zero, satin rails are found by casting rays to its zero
//! level, underlay insets are its level sets. Its zero level lies halfway between inside and outside
//! pixel centers, so two neighbouring regions share the same boundary. A light blur rounds the pixel
//! steps (Ink/Stitch smooths traced outlines for the same reason).

use std::cell::RefCell;

use crate::geom::Pt;
use crate::image::edt::{distance_inside, distance_to_seeds};
use crate::js::IdMap;

#[derive(Clone, Debug)]
pub struct Region {
    pub label: i32,
    /// Window in image pixels; the mask has a margin of empty pixels around the region.
    pub x0: i32,
    pub y0: i32,
    pub w: usize,
    pub h: usize,
    pub px_mm: f64,
    /// Region pixels (without the overlap into neighbours).
    pub mask: Vec<u8>,
    /// Distance of each region pixel to the nearest pixel outside, in pixels.
    pub inside: Vec<f32>,
    /// Signed distance in mm, negative inside, of the region itself (for satin and running stitch).
    pub sdf_base: Vec<f32>,
    /// Signed distance in mm of the region grown by the overlap; None when it is `sdf_base`.
    pub sdf_grown: Option<Vec<f32>>,
    pub area_mm2: f64,
}

impl Region {
    /// Signed distance in mm, negative inside, of the region grown by the overlap.
    pub fn sdf(&self) -> &[f32] {
        self.sdf_grown.as_deref().unwrap_or(&self.sdf_base)
    }
}

const MARGIN: i32 = 6;

/// Signed fields of the last masks: sewing an object anew (another spacing, the correction trying
/// variants, a border following its fill) rasters the same area again and again, and the distance
/// transforms are the costly part. Found by size and content; callers get a copy.
struct Cached {
    w: usize,
    h: usize,
    px_mm: f64,
    hash: u32,
    mask: Vec<u8>,
    field: Vec<f32>,
}

const FIELDS: usize = 12;

thread_local! {
    static CACHE: RefCell<Vec<Cached>> = const { RefCell::new(Vec::new()) };
}

pub fn mask_hash(mask: &[u8]) -> u32 {
    let mut h: u32 = 2166136261;
    for (i, &m) in mask.iter().enumerate() {
        if m != 0 {
            h = (h ^ i as u32).wrapping_mul(16777619);
        }
    }
    h
}

pub fn same_mask(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (*x == 0) == (*y == 0))
}

pub fn signed_field(mask: &[u8], w: usize, h: usize, px_mm: f64) -> Vec<f32> {
    let hash = mask_hash(mask);
    let hit = CACHE.with_borrow(|c| {
        c.iter()
            .find(|c| {
                c.w == w
                    && c.h == h
                    && c.px_mm == px_mm
                    && c.hash == hash
                    && same_mask(&c.mask, mask)
            })
            .map(|c| c.field.clone())
    });
    if let Some(f) = hit {
        return f;
    }
    let field = compute_field(mask, w, h, px_mm);
    CACHE.with_borrow_mut(|c| {
        c.insert(
            0,
            Cached {
                w,
                h,
                px_mm,
                hash,
                mask: mask.to_vec(),
                field: field.clone(),
            },
        );
        c.truncate(FIELDS);
    });
    field
}

fn compute_field(mask: &[u8], w: usize, h: usize, px_mm: f64) -> Vec<f32> {
    let d_in = distance_inside(mask, w, h);
    let d_out = distance_to_seeds(mask, w, h, false);
    let f: Vec<f32> = (0..w * h)
        .map(|i| {
            let v = if mask[i] != 0 {
                -(f64::from(d_in[i]) - 0.5)
            } else {
                f64::from(d_out[i]) - 0.5
            };
            (v * px_mm) as f32
        })
        .collect();
    blur(&f, w, h, 0.7)
}

/// Separable Gaussian blur with sigma in pixels.
fn blur(f: &[f32], w: usize, h: usize, sigma: f64) -> Vec<f32> {
    let r = (2.5 * sigma).ceil() as i64;
    let k: Vec<f64> = (0..=2 * r)
        .map(|i| {
            let d = ((i - r) * (i - r)) as f64;
            f64::from((-d / (2.0 * sigma * sigma)).exp() as f32)
        })
        .collect();
    let (wi, hi) = (w as i64, h as i64);
    let mut tmp = vec![0f32; f.len()];
    let mut out = vec![0f32; f.len()];
    for y in 0..h {
        for x in 0..wi {
            let (mut s, mut ws) = (0.0, 0.0);
            for j in -r..=r {
                let xx = (x + j).clamp(0, wi - 1) as usize;
                let kj = k[(j + r) as usize];
                s += f64::from(f[y * w + xx]) * kj;
                ws += kj;
            }
            tmp[y * w + x as usize] = (s / ws) as f32;
        }
    }
    for y in 0..hi {
        for x in 0..w {
            let (mut s, mut ws) = (0.0, 0.0);
            for j in -r..=r {
                let yy = (y + j).clamp(0, hi - 1) as usize;
                let kj = k[(j + r) as usize];
                s += f64::from(tmp[yy * w + x]) * kj;
                ws += kj;
            }
            out[y as usize * w + x] = (s / ws) as f32;
        }
    }
    out
}

/// Bounding box of a component in image pixels (inclusive).
#[derive(Clone, Copy, Debug)]
pub struct Bbox {
    pub min_x: i32,
    pub min_y: i32,
    pub max_x: i32,
    pub max_y: i32,
}

/// Builds the region for component `comp`. `grow` (mm) extends the fill field into neighbouring
/// pixels for which `grow_into(label)` holds: objects sewn earlier reach a little under the ones sewn
/// later, so no fabric shows between them.
pub fn build_region(
    comp_map: &[i32],
    labels: &[u8],
    img_w: usize,
    comp: i32,
    label: i32,
    bbox: Bbox,
    img_h: usize,
    px_mm: f64,
    grow: f64,
    grow_into: impl Fn(u8) -> bool,
) -> Region {
    let grow_px = (grow / px_mm).ceil() as i32;
    let m = MARGIN + grow_px;
    let x0 = bbox.min_x - m;
    let y0 = bbox.min_y - m;
    let w = (bbox.max_x - bbox.min_x + 1 + 2 * m) as usize;
    let h = (bbox.max_y - bbox.min_y + 1 + 2 * m) as usize;
    let in_image = |x: usize, y: usize| -> Option<usize> {
        let (ix, iy) = (x as i64 + i64::from(x0), y as i64 + i64::from(y0));
        (ix >= 0 && iy >= 0 && ix < img_w as i64 && iy < img_h as i64)
            .then(|| iy as usize * img_w + ix as usize)
    };
    let mut mask = vec![0u8; w * h];
    let mut area = 0usize;
    for y in 0..h {
        for x in 0..w {
            if let Some(i) = in_image(x, y)
                && comp_map[i] == comp
            {
                mask[y * w + x] = 1;
                area += 1;
            }
        }
    }
    let inside = distance_inside(&mask, w, h);
    let sdf_base = signed_field(&mask, w, h, px_mm);
    let mut sdf_grown = None;
    if grow_px > 0 {
        let d_out = distance_to_seeds(&mask, w, h, false);
        let mut grown = mask.clone();
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                let Some(ii) = in_image(x, y) else { continue };
                if grown[i] != 0 || f64::from(d_out[i]) * px_mm > grow {
                    continue;
                }
                if labels.get(ii).is_some_and(|&l| grow_into(l)) {
                    grown[i] = 1;
                }
            }
        }
        sdf_grown = Some(signed_field(&grown, w, h, px_mm));
    }
    Region {
        label,
        x0,
        y0,
        w,
        h,
        px_mm,
        mask,
        inside,
        sdf_base,
        sdf_grown,
        area_mm2: area as f64 * px_mm * px_mm,
    }
}

/// Bilinear sample of a field at image mm coordinates; far outside the window is "outside".
pub fn sample(r: &Region, field: &[f32], x_mm: f64, y_mm: f64) -> f64 {
    let u = x_mm / r.px_mm - 0.5 - f64::from(r.x0);
    let v = y_mm / r.px_mm - 0.5 - f64::from(r.y0);
    if u < 0.0 || v < 0.0 || u > (r.w - 1) as f64 || v > (r.h - 1) as f64 {
        return 10.0;
    }
    let i = u.floor() as usize;
    let j = v.floor() as usize;
    let fu = u - i as f64;
    let fv = v - j as f64;
    let i1 = (r.w - 1).min(i + 1);
    let j1 = (r.h - 1).min(j + 1);
    let a = f64::from(field[j * r.w + i]);
    let b = f64::from(field[j * r.w + i1]);
    let c = f64::from(field[j1 * r.w + i]);
    let d = f64::from(field[j1 * r.w + i1]);
    (a * (1.0 - fu) + b * fu) * (1.0 - fv) + (c * (1.0 - fu) + d * fu) * fv
}

/// Image mm coordinates of the center of window pixel (x, y).
pub fn pixel_mm(r: &Region, x: usize, y: usize) -> Pt {
    pixel_mm_of(r.x0, r.y0, r.px_mm, x as f64, y as f64)
}

fn pixel_mm_of(x0: i32, y0: i32, px_mm: f64, x: f64, y: f64) -> Pt {
    [
        (x + f64::from(x0) + 0.5) * px_mm,
        (y + f64::from(y0) + 0.5) * px_mm,
    ]
}

/// Outline of a region: the zero level of its own signed distance, as closed polylines in mm
/// (marching squares between pixel centers, the crossings interpolated); with `level`, the line
/// that far outside (+) or inside (-) the edge of `field`.
pub fn outline(r: &Region, level: f64, field: &[f32]) -> Vec<Vec<Pt>> {
    outline_of(field, r.w, r.h, r.x0, r.y0, r.px_mm, level)
}

/// [`outline`] on a bare field and window.
pub fn outline_of(
    field: &[f32],
    w: usize,
    h: usize,
    x0: i32,
    y0: i32,
    px_mm: f64,
    level: f64,
) -> Vec<Vec<Pt>> {
    let shifted: Vec<f32>;
    let f: &[f32] = if level != 0.0 {
        shifted = field
            .iter()
            .map(|&v| (f64::from(v) - level) as f32)
            .collect();
        &shifted
    } else {
        field
    };
    // Edges between neighbouring pixel centers carry the crossing points: horizontal edge (x, y)
    // to (x + 1, y) has id 2 * (y * w + x), vertical edge (x, y) to (x, y + 1) the id after it.
    let point = |id: usize| -> Pt {
        let k = id >> 1;
        let (x, y) = (k % w, k / w);
        let a = f64::from(f[k]);
        let b = f64::from(if id & 1 == 1 { f[k + w] } else { f[k + 1] });
        let t = if a == b { 0.5 } else { a / (a - b) };
        let (px, py) = if id & 1 == 1 {
            (x as f64, y as f64 + t)
        } else {
            (x as f64 + t, y as f64)
        };
        pixel_mm_of(x0, y0, px_mm, px, py)
    };
    // Neighbours of each edge on the line, in the order the edges were first met (the lines start
    // and run as in the TypeScript twin).
    let mut next: IdMap<usize, (usize, [usize; 2], u8)> = IdMap::default();
    let mut order: Vec<usize> = Vec::new();
    let mut link_one = |a: usize, b: usize| {
        let n = order.len();
        let e = next.entry(a).or_insert((n, [0; 2], 0));
        if e.0 == n {
            order.push(a);
        }
        if (e.2 as usize) < 2 {
            e.1[e.2 as usize] = b;
        }
        e.2 += 1;
    };
    const CORNERS: [(u8, u8); 4] = [(1, 2), (2, 4), (8, 4), (1, 8)];
    for y in 0..h.saturating_sub(1) {
        for x in 0..w.saturating_sub(1) {
            let k = y * w + x;
            let c = u8::from(f[k] < 0.0)
                | (u8::from(f[k + 1] < 0.0) << 1)
                | (u8::from(f[k + w + 1] < 0.0) << 2)
                | (u8::from(f[k + w] < 0.0) << 3);
            if c == 0 || c == 15 {
                continue;
            }
            let edges = [2 * k, 2 * (k + w), 2 * k + 1, 2 * (k + 1) + 1];
            // top, right, bottom, left
            let ids = [edges[0], edges[3], edges[1], edges[2]];
            // Edges whose two ends lie on different sides, paired around the cell.
            let mut cut = [0usize; 4];
            let mut n = 0;
            for (e, &(p, q)) in CORNERS.iter().enumerate() {
                if (c & p == 0) != (c & q == 0) {
                    cut[n] = ids[e];
                    n += 1;
                }
            }
            if n == 2 {
                link_one(cut[0], cut[1]);
                link_one(cut[1], cut[0]);
            } else if n == 4 {
                link_one(cut[0], cut[1]);
                link_one(cut[1], cut[0]);
                link_one(cut[2], cut[3]);
                link_one(cut[3], cut[2]);
            }
        }
    }
    let mut out = Vec::new();
    let mut seen: IdMap<usize, ()> = IdMap::default();
    for &start in &order {
        if seen.contains_key(&start) {
            continue;
        }
        let mut line = Vec::new();
        let mut prev = usize::MAX;
        let mut cur = Some(start);
        while let Some(c) = cur {
            if seen.insert(c, ()).is_some() {
                break;
            }
            line.push(point(c));
            let (_, nb, cnt) = next[&c];
            let first = (cnt >= 1).then_some(nb[0]);
            let second = (cnt >= 2).then_some(nb[1]);
            let to = if first != Some(prev) { first } else { second };
            prev = c;
            cur = to;
        }
        if line.len() > 2 {
            line.push(line[0]);
            out.push(line);
        }
    }
    out
}

/// The region grown (`mm` > 0) or shrunk (`mm` < 0) on all sides by that distance (Ink/Stitch's
/// expand): its window gets wider by as much, and its fields are made anew. None when nothing is
/// left of it.
pub fn expand_region(r: &Region, mm: f64) -> Option<Region> {
    if mm.abs() < 1e-3 {
        return Some(r.clone());
    }
    expand_field(r.label, r.x0, r.y0, r.w, r.h, r.px_mm, r.sdf(), mm)
}

/// [`expand_region`] from the window and the field the fill covers now.
pub fn expand_field(
    label: i32,
    x0: i32,
    y0: i32,
    rw: usize,
    rh: usize,
    px_mm: f64,
    sdf: &[f32],
    mm: f64,
) -> Option<Region> {
    let pad = if mm > 0.0 {
        (mm / px_mm).ceil() as usize + 1
    } else {
        0
    };
    let w = rw + 2 * pad;
    let h = rh + 2 * pad;
    let mut own = vec![0u8; w * h];
    // From the area the fill covers now (its field, which may reach a little under neighbours).
    for y in 0..rh {
        for x in 0..rw {
            own[(y + pad) * w + x + pad] = u8::from(sdf[y * rw + x] < 0.0);
        }
    }
    let d = if mm > 0.0 {
        distance_to_seeds(&own, w, h, false)
    } else {
        distance_inside(&own, w, h)
    };
    let limit = mm.abs() / px_mm;
    let mut mask = vec![0u8; w * h];
    let mut area = 0usize;
    for i in 0..mask.len() {
        // Pixel centers lie half a pixel from the seeds' edges.
        let di = f64::from(d[i]) - 0.5;
        let on = if mm > 0.0 {
            own[i] == 1 || di <= limit
        } else {
            own[i] == 1 && di > limit
        };
        if on {
            mask[i] = 1;
            area += 1;
        }
    }
    if area == 0 {
        return None;
    }
    let sdf_base = signed_field(&mask, w, h, px_mm);
    let inside = distance_inside(&mask, w, h);
    Some(Region {
        label,
        x0: x0 - pad as i32,
        y0: y0 - pad as i32,
        w,
        h,
        px_mm,
        mask,
        inside,
        sdf_base,
        sdf_grown: None,
        area_mm2: area as f64 * px_mm * px_mm,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A region from a test on pixel centers (mm) in a `n` × `n` pixel image.
    pub fn region_of(n: usize, px: f64, f: impl Fn(f64, f64) -> bool) -> Region {
        let mut comp = vec![0i32; n * n];
        let (mut x0, mut y0, mut x1, mut y1) = (n as i32, n as i32, 0, 0);
        for y in 0..n {
            for x in 0..n {
                if f((x as f64 + 0.5) * px, (y as f64 + 0.5) * px) {
                    comp[y * n + x] = 1;
                    x0 = x0.min(x as i32);
                    y0 = y0.min(y as i32);
                    x1 = x1.max(x as i32);
                    y1 = y1.max(y as i32);
                }
            }
        }
        let bbox = Bbox {
            min_x: x0,
            min_y: y0,
            max_x: x1,
            max_y: y1,
        };
        build_region(&comp, &vec![0; n * n], n, 1, 1, bbox, n, px, 0.0, |_| false)
    }

    fn disc() -> Region {
        region_of(100, 0.1, |x, y| (x - 5.0).hypot(y - 5.0) < 3.0)
    }

    #[test]
    fn a_disc_has_its_area_and_a_field_negative_inside() {
        let r = disc();
        assert!((r.area_mm2 - std::f64::consts::PI * 9.0).abs() < 0.2);
        assert!(sample(&r, r.sdf(), 5.0, 5.0) < -2.8);
        assert!(sample(&r, r.sdf(), 9.0, 5.0) > 0.9);
        assert_eq!(sample(&r, r.sdf(), 50.0, 5.0), 10.0);
    }

    #[test]
    fn the_outline_of_a_disc_is_one_closed_circle() {
        let r = disc();
        let o = outline(&r, 0.0, &r.sdf_base);
        assert_eq!(o.len(), 1);
        assert_eq!(o[0][0], *o[0].last().unwrap());
        for p in &o[0] {
            assert!(((p[0] - 5.0).hypot(p[1] - 5.0) - 3.0).abs() < 0.1);
        }
        let inner = outline(&r, -1.0, &r.sdf_base);
        assert!(((inner[0][0][0] - 5.0).hypot(inner[0][0][1] - 5.0) - 2.0).abs() < 0.1);
    }

    #[test]
    fn expanding_grows_and_shrinking_to_nothing_is_none() {
        let r = disc();
        let g = expand_region(&r, 1.0).unwrap();
        assert!((g.area_mm2 - std::f64::consts::PI * 16.0).abs() < 1.0);
        assert_eq!(g.w, r.w + 2 * 11);
        assert!(expand_region(&r, -3.5).is_none());
    }

    #[test]
    fn growing_reaches_into_allowed_neighbours_only() {
        let n = 60;
        let comp: Vec<i32> = (0..n * n).map(|i| i32::from(i % n < 30)).collect();
        let labels: Vec<u8> = (0..n * n).map(|i| if i % n < 30 { 1 } else { 2 }).collect();
        let bbox = Bbox {
            min_x: 0,
            min_y: 0,
            max_x: 29,
            max_y: 59,
        };
        let r = build_region(&comp, &labels, n, 1, 1, bbox, n, 0.1, 0.5, |l| l == 2);
        let s = r.sdf();
        assert!(sample(&r, s, 3.2, 3.0) < 0.0);
        assert!(sample(&r, &r.sdf_base, 3.2, 3.0) > 0.0);
        let no = build_region(&comp, &labels, n, 1, 1, bbox, n, 0.1, 0.5, |_| false);
        assert!(sample(&no, no.sdf(), 3.2, 3.0) > 0.0);
    }

    #[test]
    fn the_mask_hash_is_fnv_over_set_pixels() {
        assert_eq!(mask_hash(&[0, 0]), 2166136261);
        assert_eq!(mask_hash(&[1]), 2166136261u32.wrapping_mul(16777619));
        assert!(same_mask(&[0, 2], &[0, 1]));
    }
}
