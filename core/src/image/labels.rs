//! Operations on label maps (one palette index per pixel, NONE = not sewn): connected components
//! with their adjacency, and the cleanup that turns a quantized image into regions that can be
//! embroidered, as commercial tools describe it (they remove anti-aliasing, noise and dithering, and
//! colors below a given area) and as the Goldman patent (US 6,836,695) does it: small objects are
//! reassigned to their neighbours.

use super::edt::distance_to_seeds;
use super::quantize::{FastMap, NONE};

pub struct Components {
    /// Component per pixel.
    pub comp: Vec<u32>,
    /// Per component: label, pixel count, bounding box.
    pub label: Vec<u16>,
    pub area: Vec<u32>,
    pub min_x: Vec<u32>,
    pub min_y: Vec<u32>,
    pub max_x: Vec<u32>,
    pub max_y: Vec<u32>,
}

/// 4-connected components of equal labels (two-pass union-find). 4-connectivity keeps every region
/// a union of whole pixel squares, so outlines never pinch at a diagonal. Components are numbered
/// in the order of their first pixel.
pub fn components<T: Copy + PartialEq + Into<u16>>(labels: &[T], w: usize, h: usize) -> Components {
    let n = w * h;
    let mut parent: Vec<u32> = vec![0; n];
    fn find(parent: &mut [u32], mut i: usize) -> usize {
        while parent[i] as usize != i {
            parent[i] = parent[parent[i] as usize];
            i = parent[i] as usize;
        }
        i
    }
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            parent[i] = i as u32;
            let l = labels[i];
            if x > 0 && labels[i - 1] == l {
                parent[i] = find(&mut parent, i - 1) as u32;
            }
            if y > 0 && labels[i - w] == l {
                let a = find(&mut parent, i);
                let b = find(&mut parent, i - w);
                if a != b {
                    parent[a.max(b)] = a.min(b) as u32;
                }
            }
        }
    }
    let mut out = Components {
        comp: vec![0; n],
        label: vec![],
        area: vec![],
        min_x: vec![],
        min_y: vec![],
        max_x: vec![],
        max_y: vec![],
    };
    // Component of each root, u32::MAX until its first pixel.
    let mut id = vec![u32::MAX; n];
    for i in 0..n {
        let r = find(&mut parent, i);
        let c = if id[r] == u32::MAX {
            let c = out.label.len();
            id[r] = c as u32;
            out.label.push(labels[i].into());
            out.area.push(0);
            out.min_x.push(w as u32);
            out.min_y.push(h as u32);
            out.max_x.push(0);
            out.max_y.push(0);
            c
        } else {
            id[r] as usize
        };
        out.comp[i] = c as u32;
        let (x, y) = ((i % w) as u32, (i / w) as u32);
        if out.area[c] == 0 {
            out.max_x[c] = x;
            out.max_y[c] = y;
        }
        out.area[c] += 1;
        out.min_x[c] = out.min_x[c].min(x);
        out.max_x[c] = out.max_x[c].max(x);
        out.min_y[c] = out.min_y[c].min(y);
        out.max_y[c] = out.max_y[c].max(y);
    }
    out
}

/// Shared border length (pixel edges) between components, per component: neighbours in the order
/// they were met, so ties are broken as before.
struct Adjacency {
    list: Vec<Vec<(u32, u32)>>,
    at: FastMap<u64, u32>,
}

impl Adjacency {
    fn new(count: usize) -> Self {
        Adjacency {
            list: vec![Vec::new(); count],
            at: FastMap::default(),
        }
    }

    fn add_one(&mut self, a: u32, b: u32, len: u32) {
        let key = ((a as u64) << 32) | b as u64;
        match self.at.get(&key) {
            Some(&k) => self.list[a as usize][k as usize].1 += len,
            None => {
                self.at.insert(key, self.list[a as usize].len() as u32);
                self.list[a as usize].push((b, len));
            }
        }
    }

    fn add(&mut self, a: u32, b: u32, len: u32) {
        self.add_one(a, b, len);
        self.add_one(b, a, len);
    }
}

fn adjacency(c: &Components, w: usize, h: usize) -> Adjacency {
    let mut adj = Adjacency::new(c.label.len());
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let a = c.comp[i];
            if x + 1 < w && c.comp[i + 1] != a {
                adj.add(a, c.comp[i + 1], 1);
            }
            if y + 1 < h && c.comp[i + w] != a {
                adj.add(a, c.comp[i + w], 1);
            }
        }
    }
    adj
}

/// Pixels next to a pixel of another label (4-neighbourhood).
fn edges(labels: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut edge = vec![0u8; labels.len()];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let l = labels[i];
            if (x > 0 && labels[i - 1] != l)
                || (x + 1 < w && labels[i + 1] != l)
                || (y > 0 && labels[i - w] != l)
                || (y + 1 < h && labels[i + w] != l)
            {
                edge[i] = 1;
            }
        }
    }
    edge
}

/// Distance of every pixel to the nearest pixel of another label: half the local width of regions.
pub fn distance_to_other(labels: &[u8], w: usize, h: usize) -> Vec<f32> {
    distance_to_seeds(&edges(labels, w, h), w, h, false)
}

/// 3 x 3 majority filter: a pixel takes the label most of its neighbourhood has, if that is a clear
/// majority (5 of 9). Removes single-pixel specks and smooths stair steps; lines of 2 pixels survive.
pub fn mode_filter(labels: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = labels.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let own = labels[i];
            let mut mixed = false;
            let mut count: [(u8, u8); 9] = [(0, 0); 9];
            let mut kinds = 0;
            for dy in -1i64..=1 {
                let yy = (y as i64 + dy).clamp(0, h as i64 - 1) as usize;
                for dx in -1i64..=1 {
                    let xx = (x as i64 + dx).clamp(0, w as i64 - 1) as usize;
                    let l = labels[yy * w + xx];
                    mixed |= l != own;
                    match count[..kinds].iter_mut().find(|c| c.0 == l) {
                        Some(c) => c.1 += 1,
                        None => {
                            count[kinds] = (l, 1);
                            kinds += 1;
                        }
                    }
                }
            }
            if !mixed {
                continue;
            }
            for &(l, k) in &count[..kinds] {
                if k >= 5 && l != own {
                    out[i] = l;
                }
            }
        }
    }
    out
}

/// Narrow details that are not specks: a band at least this many times as long as it is wide
/// (length to width, as for a region kept as a line or a satin column) ...
pub const BAND_RATIO: f64 = 4.0;
/// ... at least this wide (mm, about a thread: narrower is a speck) ...
pub const BAND_MIN_WIDTH: f64 = 0.3;
/// ... and this long (mm).
pub const BAND_MIN_LENGTH: f64 = 2.0;

/// Which components are bands (see BAND_RATIO): long and narrow, judged by width and length, not by
/// area. The width is that of the widest place (twice the largest distance to another region, Blum's
/// medial axis radius), the length the area over that width; so a vein, a stem or an outline is a
/// band, a blot of the same area is not. Only sewn regions: a narrow gap of background stays a gap.
pub fn bands(c: &Components, labels: &[u8], w: usize, h: usize, px_mm: f64) -> Vec<u8> {
    let dist = distance_to_other(labels, w, h);
    let mut half = vec![0f32; c.label.len()];
    for i in 0..labels.len() {
        let k = c.comp[i] as usize;
        half[k] = half[k].max(dist[i]);
    }
    c.label
        .iter()
        .enumerate()
        .map(|(k, &l)| {
            if l == NONE as u16 {
                return 0;
            }
            // An edge pixel lies half a pixel inside: a line 2r + 1 pixels wide has r at its middle.
            let width = 2.0 * half[k] as f64 + 1.0;
            let length = c.area[k] as f64 / width;
            u8::from(
                length >= BAND_RATIO * width
                    && width * px_mm >= BAND_MIN_WIDTH
                    && length * px_mm >= BAND_MIN_LENGTH,
            )
        })
        .collect()
}

/// Merges every component smaller than `min_area` pixels into the neighbour it shares the longest
/// border with, smallest first, until none is left. NONE regions take part too, so small holes in a
/// region are closed and stray pixels on the background disappear. With `px_mm` given, bands (long
/// narrow details, see `bands`) stay whatever their area: a vein or a fine ring is a detail, not a
/// speck.
pub fn merge_small(
    labels: &[u8],
    w: usize,
    h: usize,
    min_area: f64,
    px_mm: Option<f64>,
) -> Vec<u8> {
    let c = components(labels, w, h);
    let mut adj = adjacency(&c, w, h);
    let count = c.label.len();
    let keep = px_mm
        .filter(|&p| p != 0.0 && !p.is_nan())
        .map(|p| bands(&c, labels, w, h, p));
    let mut target: Vec<u32> = (0..count as u32).collect();
    fn root(target: &mut [u32], mut i: usize) -> usize {
        while target[i] as usize != i {
            target[i] = target[target[i] as usize];
            i = target[i] as usize;
        }
        i
    }
    let mut area: Vec<f64> = c.area.iter().map(|&a| a as f64).collect();
    let mut order: Vec<usize> = (0..count).filter(|&i| area[i] < min_area).collect();
    order.sort_by(|&a, &b| area[a].total_cmp(&area[b]));
    for i in order {
        if root(&mut target, i) != i || area[i] >= min_area {
            continue;
        }
        if keep.as_ref().is_some_and(|k| k[i] != 0) {
            continue;
        }
        let mut best = None;
        let mut best_len = 0;
        let nbs = adj.list[i].clone();
        for &(nb, len) in &nbs {
            let r = root(&mut target, nb as usize);
            if r == i {
                continue;
            }
            if len > best_len {
                best_len = len;
                best = Some(r);
            }
        }
        let Some(best) = best else { continue };
        target[i] = best as u32;
        area[best] += area[i];
        for &(nb, len) in &nbs {
            let r = root(&mut target, nb as usize);
            if r == best {
                continue;
            }
            adj.add(best as u32, r as u32, len);
        }
    }
    (0..labels.len())
        .map(|p| c.label[root(&mut target, c.comp[p] as usize)] as u8)
        .collect()
}

/// Removes anti-aliasing seams: thin components (inscribed width below `max_width` pixels) whose
/// color lies between the colors of the two regions they separate. A thin component in a color of
/// its own (a drawn line) is kept; it will be sewn as a running stitch or satin.
pub fn remove_seams(
    labels: &[u8],
    w: usize,
    h: usize,
    max_width: f64,
    mut between: impl FnMut(u8, u8, u8) -> bool,
) -> Vec<u8> {
    // Distance to the nearest pixel of another region: half the local width of every region.
    let dist = distance_to_other(labels, w, h);
    // A seam can run into a wide region of its own color (the dark edge between a light and a dark
    // area joining a dark area further on). Its thin parts count on their own: whatever a disc of
    // `max_width` does not reach inside the region (a morphological opening) is a component of its own.
    let r = max_width / 2.0;
    let core = |i: usize| 2.0 * (dist[i] as f64 + 1.0) > max_width;
    let mut covered = vec![0u8; labels.len()];
    let reach = r.ceil() as i64;
    let (wi, hi) = (w as i64, h as i64);
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            if !core(i) {
                continue;
            }
            covered[i] = 1;
            // Inner core pixels are covered already; only the core's rim reaches out.
            if x > 0
                && x + 1 < wi
                && y > 0
                && y + 1 < hi
                && core(i - 1)
                && core(i + 1)
                && core(i - w)
                && core(i + w)
            {
                continue;
            }
            let l = labels[i];
            for yy in (y - reach).max(0)..=(y + reach).min(hi - 1) {
                for xx in (x - reach).max(0)..=(x + reach).min(wi - 1) {
                    let j = (yy * wi + xx) as usize;
                    if labels[j] == l
                        && (((xx - x) * (xx - x) + (yy - y) * (yy - y)) as f64) <= r * r
                    {
                        covered[j] = 1;
                    }
                }
            }
        }
    }
    const THIN: u16 = 0x100;
    let split: Vec<u16> = (0..labels.len())
        .map(|i| {
            if labels[i] == NONE || covered[i] != 0 {
                labels[i] as u16
            } else {
                labels[i] as u16 | THIN
            }
        })
        .collect();
    let c = components(&split, w, h);
    let real = |k: usize| (c.label[k] & 0xff) as u8;
    let mut max_half = vec![0f32; c.label.len()];
    for i in 0..labels.len() {
        let k = c.comp[i] as usize;
        max_half[k] = max_half[k].max((dist[i] as f64 + 1.0) as f32);
    }
    let adj = adjacency(&c, w, h);
    let mut out = labels.to_vec();
    for k in 0..c.label.len() {
        if real(k) == NONE || 2.0 * max_half[k] as f64 > max_width {
            continue;
        }
        let mut nbs: Vec<(u32, u32)> = adj.list[k]
            .iter()
            .copied()
            .filter(|&(nb, _)| real(nb as usize) != real(k))
            .collect();
        nbs.sort_by_key(|n| std::cmp::Reverse(n.1));
        if nbs.len() < 2 {
            continue;
        }
        let a = real(nbs[0].0 as usize);
        let Some(second) = nbs.iter().find(|&&(nb, _)| real(nb as usize) != a) else {
            continue;
        };
        let b = real(second.0 as usize);
        if !between(real(k), a, b) {
            continue;
        }
        // Each pixel goes to whichever of the two sides is nearer: grow both into the seam.
        let mut todo: Vec<usize> = Vec::new();
        for y in c.min_y[k] as usize..=c.max_y[k] as usize {
            for x in c.min_x[k] as usize..=c.max_x[k] as usize {
                if c.comp[y * w + x] as usize == k {
                    todo.push(y * w + x);
                }
            }
        }
        let seam = real(k);
        while !todo.is_empty() {
            let mut changes: Vec<(usize, u8)> = Vec::new();
            let mut rest: Vec<usize> = Vec::new();
            for &i in &todo {
                let x = i % w;
                let mut pick = None;
                let nbs = [
                    if x > 0 { i as i64 - 1 } else { -1 },
                    if x < w - 1 { i as i64 + 1 } else { -1 },
                    i as i64 - w as i64,
                    (i + w) as i64,
                ];
                for j in nbs {
                    if j < 0 || j as usize >= out.len() {
                        continue;
                    }
                    let j = j as usize;
                    let l = out[j];
                    let takes = if c.comp[j] as usize != k {
                        l == a || l == b
                    } else {
                        l != seam
                    };
                    if takes {
                        pick = Some(l);
                        break;
                    }
                }
                match pick {
                    Some(l) => changes.push((i, l)),
                    None => rest.push(i),
                }
            }
            if changes.is_empty() {
                break;
            }
            for (i, l) in changes {
                out[i] = l;
            }
            todo = rest;
        }
    }
    out
}

/// Background: the label covering at least 60 % of the image border (and three of its corners) is
/// removed where it is connected to the border (4-connected flood fill), so the same color inside the
/// design (eyes, the counters of letters) is still sewn.
pub fn remove_background(labels: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut ring: Vec<usize> = Vec::new();
    for x in 0..w {
        ring.push(x);
        ring.push((h - 1) * w + x);
    }
    for y in 1..h.saturating_sub(1) {
        ring.push(y * w);
        ring.push(y * w + w - 1);
    }
    // Counts per label in the order first met, so ties go to the first as before.
    let mut counts: Vec<(u8, usize)> = Vec::new();
    let mut total = 0;
    for &i in &ring {
        let l = labels[i];
        if l == NONE {
            continue;
        }
        match counts.iter_mut().find(|c| c.0 == l) {
            Some(c) => c.1 += 1,
            None => counts.push((l, 1)),
        }
        total += 1;
    }
    // Mostly transparent border: the image has its own background removed already.
    if (total as f64) < ring.len() as f64 * 0.5 {
        return labels.to_vec();
    }
    let mut bg: Option<u8> = None;
    let mut best = 0;
    for &(l, k) in &counts {
        if k > best {
            best = k;
            bg = Some(l);
        }
    }
    let Some(bg) = bg else { return labels.to_vec() };
    let corners = [0, w - 1, (h - 1) * w, h * w - 1]
        .iter()
        .filter(|&&i| labels[i] == bg)
        .count();
    if (best as f64) < total as f64 * 0.6 || corners < 3 {
        return labels.to_vec();
    }
    let mut out = labels.to_vec();
    let mut stack: Vec<usize> = ring.into_iter().filter(|&i| labels[i] == bg).collect();
    for &i in &stack {
        out[i] = NONE;
    }
    while let Some(i) = stack.pop() {
        let x = i % w;
        let nbs = [
            if x > 0 { i as i64 - 1 } else { -1 },
            if x < w - 1 { i as i64 + 1 } else { -1 },
            i as i64 - w as i64,
            (i + w) as i64,
        ];
        for j in nbs {
            if j < 0 || j as usize >= out.len() || out[j as usize] != bg {
                continue;
            }
            out[j as usize] = NONE;
            stack.push(j as usize);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(w: usize, h: usize, at: impl Fn(usize, usize) -> u8) -> Vec<u8> {
        (0..w * h).map(|i| at(i % w, i / w)).collect()
    }

    #[test]
    fn components_are_4_connected() {
        // Diagonal neighbours are not connected: four components of one pixel each.
        let c = components(&[0u8, 1, 1, 0], 2, 2);
        assert_eq!(c.comp, vec![0, 1, 2, 3]);
        let c = components(&[1u8, 1, 0, 1, 2, 1], 3, 2);
        assert_eq!(c.comp, vec![0, 0, 1, 0, 2, 3]);
        assert_eq!(c.area, vec![3, 1, 1, 1]);
        assert_eq!(
            (c.min_x[0], c.max_x[0], c.min_y[0], c.max_y[0]),
            (0, 1, 0, 1)
        );
    }

    #[test]
    fn mode_filter_removes_a_speck() {
        let mut l = vec![0u8; 25];
        l[12] = 1;
        assert!(mode_filter(&l, 5, 5).iter().all(|&v| v == 0));
    }

    #[test]
    fn merges_specks_into_neighbours() {
        let w = 20;
        let mut l = map(w, w, |x, _| u8::from(x >= 10));
        l[5 * w + 3] = 2;
        l[15 * w + 15] = 0;
        let out = merge_small(&l, w, w, 3.0, None);
        assert_eq!(out, map(w, w, |x, _| u8::from(x >= 10)));
        assert_eq!(components(&out, w, w).label.len(), 2);
    }

    #[test]
    fn keeps_a_long_thin_band() {
        let w = 60;
        let l = map(w, w, |x, y| {
            if y == 30 && (5..55).contains(&x) {
                1
            } else {
                0
            }
        });
        // 50 pixels of 0.1 mm: a band 5 mm long, 0.1 mm wide; too narrow to keep.
        assert_eq!(merge_small(&l, w, w, 100.0, Some(0.1))[30 * w + 20], 0);
        let l = map(w, w, |x, y| {
            if (29..32).contains(&y) && (5..55).contains(&x) {
                1
            } else {
                0
            }
        });
        assert_eq!(merge_small(&l, w, w, 300.0, Some(0.1))[30 * w + 20], 1);
        assert_eq!(merge_small(&l, w, w, 300.0, None)[30 * w + 20], 0);
    }

    #[test]
    fn removes_a_seam_between_two_regions() {
        let w = 20;
        let l = map(w, w, |x, _| match x {
            0..10 => 0,
            10 => 2,
            _ => 1,
        });
        let out = remove_seams(&l, w, w, 5.0, |_, _, _| true);
        assert!(!out.contains(&2));
        assert!(remove_seams(&l, w, w, 5.0, |_, _, _| false).contains(&2));
    }

    #[test]
    fn background_goes_where_it_touches_the_border() {
        let w = 20;
        let l = map(w, w, |x, y| {
            let inside = (5..15).contains(&x) && (5..15).contains(&y);
            let hole = (9..11).contains(&x) && (9..11).contains(&y);
            if inside && !hole { 1 } else { 0 }
        });
        let out = remove_background(&l, w, w);
        assert_eq!(out[0], NONE);
        assert_eq!(out[10 * w + 10], 0);
        assert_eq!(out[6 * w + 6], 1);
    }
}
