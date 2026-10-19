//! Decorative fills, all drawn from a few numbers so they need no stored geometry:
//!
//! - Embossing (Prägung) on tatami: rows put their needle points where they cross the lines of a
//!   motif tiled over the area (diamonds, waves, stars, hearts). Many needle points on one line
//!   form a groove, so the motif shows in the light while the fill stays as dense as before (what
//!   professional software calls program split).
//! - Fields for curved rows: waves, grain (a soft random flow), rays from a point and swirls. The
//!   rows are laid on them by field_fill like guided fills.
//! - Open patterns: one line through the area with the fabric showing between, for large areas on
//!   soft fabric and the quilting look. Meander and maze are the outline of a random tree on a
//!   grid: that outline is always one closed line that never crosses itself. Grids (honeycomb,
//!   diamonds, bricks) and cross stitch are graphs sewn in one go, every edge there and back.
//!   Echo is the contour fill with wide spacing.
//!
//! Every random choice comes from `seed`, so the same settings always give the same stitches.

use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use super::fill::{FillParams, FillResult, fill_region};
use super::flow::{DirField, Grid, contour_fill, sew_rows};
use super::region::{Region, outline, sample};
use super::run::run_stitch;
use crate::geom::Pt;
use crate::js::{IdMap, Random, dist, hypot, round};
use crate::trig::JsMath;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Motif {
    Diamonds,
    Waves,
    Stars,
    Hearts,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GridKind {
    Hex,
    Diamond,
    Brick,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CrossKind {
    Full,
    Half,
    Double,
}

/// Figures of a motif fill.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Figure {
    Hearts,
    Stars,
    Flowers,
    Circles,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Texture {
    Zigzag,
    Swell,
    Steps,
    Herringbone,
}

// ------------------------------------------------------------------------------------------------
// Embossing

/// One tile of each motif: its lines and its width and height, in units of the motif size (the
/// tile's width in mm). Tiles repeat without gaps, so lines leaving a tile go on in the next one.
struct Tile {
    w: f64,
    h: f64,
    lines: Vec<Vec<Pt>>,
}

fn tile(m: Motif) -> &'static Tile {
    use std::sync::OnceLock;
    static TILES: OnceLock<[Tile; 4]> = OnceLock::new();
    let tiles = TILES.get_or_init(|| {
        let star = |cx: f64, cy: f64, r: f64| -> Vec<Pt> {
            (0..=10)
                .map(|i| {
                    let rr = if i % 2 == 1 { r * 0.45 } else { r };
                    let a = -PI / 2.0 + (f64::from(i) * PI) / 5.0;
                    [cx + rr * a.js_cos(), cy + rr * a.js_sin()]
                })
                .collect()
        };
        let heart = |cx: f64, cy: f64, r: f64| -> Vec<Pt> {
            (0..=40)
                .map(|i| {
                    let t = (2.0 * PI * f64::from(i)) / 40.0;
                    let x = 16.0 * t.js_sin().js_pow(3.0);
                    let y = 13.0 * t.js_cos()
                        - 5.0 * (2.0 * t).js_cos()
                        - 2.0 * (3.0 * t).js_cos()
                        - (4.0 * t).js_cos();
                    [cx + (x / 17.0) * r, cy - (y / 17.0) * r]
                })
                .collect()
        };
        let wave = |x: f64| -> Vec<Pt> {
            (0..33)
                .map(|i| {
                    let i = f64::from(i);
                    [x + 0.2 * ((2.0 * PI * i) / 32.0).js_sin(), (2.5 * i) / 32.0]
                })
                .collect()
        };
        let dh = 1.88;
        let rows = 1.9;
        [
            Tile {
                w: 1.0,
                h: dh,
                lines: vec![vec![
                    [0.5, 0.0],
                    [1.0, dh / 2.0],
                    [0.5, dh],
                    [0.0, dh / 2.0],
                    [0.5, 0.0],
                ]],
            },
            Tile {
                w: 1.0,
                h: 2.5,
                lines: vec![wave(0.25), wave(0.75)],
            },
            Tile {
                w: 1.0,
                h: rows,
                lines: vec![
                    star(0.25, rows / 4.0, 0.4),
                    star(0.75, (3.0 * rows) / 4.0, 0.4),
                ],
            },
            Tile {
                w: 1.0,
                h: rows,
                lines: vec![
                    heart(0.25, rows / 4.0, 0.36),
                    heart(0.75, (3.0 * rows) / 4.0, 0.36),
                ],
            },
        ]
    });
    &tiles[m as usize]
}

/// A pattern turned by `angle` degrees (clockwise on screen) about the design origin: `to` takes a
/// point of the upright pattern onto the design, `from` back. At 0 both leave every point as it is.
#[derive(Clone, Copy)]
pub struct Turning {
    c: f64,
    s: f64,
}

impl Turning {
    pub fn new(angle: f64) -> Turning {
        let a = (angle * PI) / 180.0;
        Turning {
            c: a.js_cos(),
            s: a.js_sin(),
        }
    }
    pub fn to(&self, q: Pt) -> Pt {
        [self.c * q[0] - self.s * q[1], self.s * q[0] + self.c * q[1]]
    }
    pub fn from(&self, q: Pt) -> Pt {
        [self.c * q[0] + self.s * q[1], self.c * q[1] - self.s * q[0]]
    }
}

/// Where the row o + u e crosses the motif lines between u = lo and hi, sorted; `size` is the tile
/// width (mm), and the motif is turned by `angle` degrees (see Turning).
pub fn motif_crossings(
    m: Motif,
    size: f64,
    o: Pt,
    e: Pt,
    lo: f64,
    hi: f64,
    angle: f64,
) -> Vec<f64> {
    // In the motif's own frame the row is turned back; distances along it stay the same.
    let t = Turning::new(angle);
    let o = t.from(o);
    let e = t.from(e);
    let tile = tile(m);
    let tw = tile.w * size;
    let th = tile.h * size;
    let a = [o[0] + e[0] * lo, o[1] + e[1] * lo];
    let z = [o[0] + e[0] * hi, o[1] + e[1] * hi];
    let mut out = Vec::new();
    let i0 = (a[0].min(z[0]) / tw).floor() as i64 - 1;
    let i1 = (a[0].max(z[0]) / tw).floor() as i64 + 1;
    let j0 = (a[1].min(z[1]) / th).floor() as i64 - 1;
    let j1 = (a[1].max(z[1]) / th).floor() as i64 + 1;
    let reach = hypot(tw, th);
    for j in j0..=j1 {
        for i in i0..=i1 {
            let (fi, fj) = (i as f64, j as f64);
            // Only tiles the row passes near (its bounding box touches more of them).
            let cx = (fi + 0.5) * tw - o[0];
            let cy = (fj + 0.5) * th - o[1];
            if (cx * e[1] - cy * e[0]).abs() > reach {
                continue;
            }
            for line in &tile.lines {
                for k in 1..line.len() {
                    let px = fi * tw + line[k - 1][0] * size;
                    let py = fj * th + line[k - 1][1] * size;
                    let dx = (line[k][0] - line[k - 1][0]) * size;
                    let dy = (line[k][1] - line[k - 1][1]) * size;
                    // Row o + u e meets segment p + t d.
                    let den = e[0] * dy - e[1] * dx;
                    if den.abs() < 1e-9 {
                        continue;
                    }
                    let wx = px - o[0];
                    let wy = py - o[1];
                    let t = (wx * e[1] - wy * e[0]) / den;
                    if !(0.0..1.0).contains(&t) {
                        continue;
                    }
                    let u = (wx * dy - wy * dx) / den;
                    if u > lo && u < hi {
                        out.push(u);
                    }
                }
            }
        }
    }
    out.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Whether point `at` (mm) lies inside the motif turned by `angle` degrees: between the two lines
/// of a wave, or within a diamond, star or heart. Counts the lines crossed on the way to the corner
/// of its tile, which is outside every motif.
pub fn motif_inside(m: Motif, size: f64, at: Pt, angle: f64) -> bool {
    let q = Turning::new(angle).from(at);
    let tile = tile(m);
    let tw = tile.w * size;
    let th = tile.h * size;
    let i = (q[0] / tw).floor();
    let j = (q[1] / th).floor();
    let c = [i * tw, j * th];
    let mut n = 0;
    for dj in -1..=1 {
        for di in -1..=1 {
            for line in &tile.lines {
                for k in 1..line.len() {
                    let a = [
                        (i + f64::from(di)) * tw + line[k - 1][0] * size,
                        (j + f64::from(dj)) * th + line[k - 1][1] * size,
                    ];
                    let b = [
                        (i + f64::from(di)) * tw + line[k][0] * size,
                        (j + f64::from(dj)) * th + line[k][1] * size,
                    ];
                    if crosses(q, c, a, b) {
                        n += 1;
                    }
                }
            }
        }
    }
    n % 2 == 1
}

/// Whether segment p-q crosses segment a-b (a touching end counts once: half open at b).
fn crosses(p: Pt, q: Pt, a: Pt, b: Pt) -> bool {
    let d1x = q[0] - p[0];
    let d1y = q[1] - p[1];
    let d2x = b[0] - a[0];
    let d2y = b[1] - a[1];
    let den = d1x * d2y - d1y * d2x;
    if den.abs() < 1e-12 {
        return false;
    }
    let wx = a[0] - p[0];
    let wy = a[1] - p[1];
    let t = (wx * d2y - wy * d2x) / den;
    let s = (wx * d1y - wy * d1x) / den;
    (0.0..=1.0).contains(&t) && (0.0..1.0).contains(&s)
}

/// Needle points of an embossed row from lo to hi (sorted, u along the row), as in the program
/// split of commercial software: on every crossing of a motif line lies a needle point, so the
/// points of neighbouring rows line up into a groove that draws the motif. The regular points stay
/// where they are not too close to a crossing, and no stitch gets longer than 1.4 stitch lengths.
pub fn emboss_points(cross: &[f64], regular: &[f64], len: f64, lo: f64, hi: f64) -> Vec<f64> {
    let near = 1.2f64.min(len * 0.4);
    let mut ms: Vec<f64> = Vec::new();
    for &m in cross {
        if ms.last().is_none_or(|&l| m - l >= 0.6) {
            ms.push(m);
        }
    }
    let keep = regular
        .iter()
        .filter(|&&r| ms.iter().all(|&m| (r - m).abs() > near));
    let mut pts: Vec<f64> = ms.iter().copied().chain(keep.copied()).collect();
    pts.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
    fill_long(&pts, len, 1.4, lo, hi)
}

/// The points with points added where two lie more than `long` stitch lengths apart (from lo to
/// hi), evenly at most a stitch length apart.
fn fill_long(pts: &[f64], len: f64, long: f64, lo: f64, hi: f64) -> Vec<f64> {
    let mut out = Vec::new();
    let mut prev = lo;
    for &u in pts.iter().chain(std::iter::once(&hi)) {
        let g = u - prev;
        if g > len * long {
            let n = (g / len).ceil() as i64;
            for i in 1..n {
                out.push(prev + (g * i as f64) / n as f64);
            }
        }
        if u < hi {
            out.push(u);
        }
        prev = u;
    }
    out
}

// ------------------------------------------------------------------------------------------------
// Textures

/// Steps of a staircase from bottom to top.
const STEPS: f64 = 2.0;
/// No two needle points of a textured row closer than this share of a stitch.
const TEXTURE_NEAR: f64 = 0.3;
/// No stitch of a textured row longer than this many stitch lengths.
const TEXTURE_LONG: f64 = 1.4;

/// 0 at 0, 1 at 1/2, 0 at 1: a triangle wave of period 1.
fn tri(t: f64) -> f64 {
    1.0 - (2.0 * (t - t.floor()) - 1.0).abs()
}

/// Shift of the needle points of a row at v (in stitch lengths), in column `col` of a herringbone.
fn texture_shift(t: Texture, size: f64, len: f64, v: f64, col: i64) -> f64 {
    let a = size / 2.0 / len;
    match t {
        Texture::Zigzag => a * tri(v / size),
        Texture::Swell => ((2.0 * a) / 3.0) * 0.5 * (1.0 - ((2.0 * PI * v) / size).js_cos()),
        Texture::Steps => (a * (tri(v / size) * STEPS + 0.5).floor()) / STEPS,
        // Herringbone: lines at 45 degrees, the other way in every second column.
        Texture::Herringbone => (if col % 2 == 0 { 1.0 } else { -1.0 } * v) / len,
    }
}

/// Needle points of a textured row from lo to hi (u along the row, sorted), its first and last
/// `margin` mm left free as for plain rows. Herringbone columns are `size` wide along the rows.
pub fn texture_points(
    t: Texture,
    size: f64,
    len: f64,
    v: f64,
    lo: f64,
    hi: f64,
    margin: f64,
) -> Vec<f64> {
    let a = lo + margin;
    let b = hi - margin;
    if b <= a {
        return vec![];
    }
    let herring = t == Texture::Herringbone;
    let w = size;
    let mut raw = Vec::new();
    let (c0, c1) = if herring {
        ((a / w).floor() as i64, (b / w).floor() as i64)
    } else {
        (0, 0)
    };
    for c in c0..=c1 {
        let from = if herring { a.max(c as f64 * w) } else { a };
        let to = if herring {
            b.min((c + 1) as f64 * w)
        } else {
            b
        };
        let s = texture_shift(t, size, len, v, ((c % 2) + 2) % 2);
        let ph = s - s.floor();
        let mut j = (from / len - ph).ceil();
        while (j + ph) * len < to + 1e-9 {
            let u = (j + ph) * len;
            if u >= from - 1e-9 {
                raw.push(u);
            }
            j += 1.0;
        }
    }
    let near = len * TEXTURE_NEAR;
    let mut out: Vec<f64> = Vec::new();
    let mut prev = lo;
    for u in raw {
        if u - prev >= near {
            out.push(u);
            prev = u;
        }
    }
    if out.last().is_some_and(|&l| hi - l < near) {
        out.pop();
    }
    fill_long(&out, len, TEXTURE_LONG, lo, hi)
}

// ------------------------------------------------------------------------------------------------
// Fields

/// A smooth random function of the plane, about -1.6 to 1.6, with features about `scale` mm wide.
pub struct Noise(Vec<[f64; 4]>);

impl Noise {
    pub fn new(seed: f64, scale: f64, octaves: i32) -> Noise {
        let mut rnd = Random::new(seed);
        Noise(
            (0..octaves)
                .map(|o| {
                    let a = rnd.next() * 2.0 * PI;
                    let f = ((2.0 * PI) / scale) * 1.9f64.js_pow(f64::from(o));
                    let ph = rnd.next() * 2.0 * PI;
                    [
                        a.js_cos() * f,
                        a.js_sin() * f,
                        ph,
                        1.0 / 1.7f64.js_pow(f64::from(o)),
                    ]
                })
                .collect(),
        )
    }
    pub fn at(&self, x: f64, y: f64) -> f64 {
        self.0
            .iter()
            .fold(0.0, |s, q| s + q[3] * (q[0] * x + q[1] * y + q[2]).js_sin())
    }
}

/// A field from the direction (radians) at each point of the region's grid; None leaves a cell empty.
fn field_of(r: &Region, dir: impl Fn(Pt) -> Option<f64>) -> DirField {
    let g = Grid::new(r);
    let n = g.gw * g.gh;
    let mut c = vec![0f32; n];
    let mut s = vec![0f32; n];
    for k in 0..n {
        if g.dom[k] == 0 {
            continue;
        }
        let Some(t) = dir(g.center(k % g.gw, k / g.gw)) else {
            continue;
        };
        c[k] = (2.0 * t).js_cos() as f32;
        s[k] = (2.0 * t).js_sin() as f32;
    }
    DirField { g, c, s }
}

/// Wave rows: every row is the same wave, `height` mm from crest to middle and `length` mm long,
/// one spacing below the last, running at `angle` degrees (see fill_region).
pub fn wave_fill(
    r: &Region,
    p: &FillParams,
    angle: f64,
    height: f64,
    length: f64,
    start: Pt,
) -> Option<FillResult> {
    let mut q = p.clone();
    q.angle = Some(angle);
    q.wave = Some(super::fill::WaveSpec { height, length });
    fill_region(r, &q, start, &[])
}

/// Zigzag rows (see model/zigzag): their course, from low to high peak, and where the peaks lie.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ZigzagRows {
    pub angle: f64,
    pub height: f64,
    /// High peaks at points q with wave · q = phase (modulo 2 pi), low ones half a turn on.
    pub wave: Pt,
    pub phase: f64,
}

/// Shorter stitches at the edge go into the peak beside them (mm).
const ZIG_SHORT: f64 = 0.3;

/// Straight rows that zigzag, `p.spacing` apart, their peaks where `z` puts them: each row's peaks
/// lie on the same lines as the next row's, so the slants line up into chevrons (the knit look).
/// Every stitch runs from peak to peak; where a row leaves the area it ends on the edge.
pub fn zigzag_fill(r: &Region, p: &FillParams, z: &ZigzagRows, start: Pt) -> Option<FillResult> {
    let a = (z.angle * PI) / 180.0;
    let e = [a.js_cos(), a.js_sin()];
    let n = [-e[1], e[0]];
    // Along a row, the wave turns this fast (radians per mm).
    let ke = z.wave[0] * e[0] + z.wave[1] * e[1];
    let kn = z.wave[0] * n[0] + z.wave[1] * n[1];
    if ke.abs() < 1e-6 {
        return None;
    }
    let [x0, y0, x1, y1] = region_box(r);
    let corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    let us: Vec<f64> = corners.iter().map(|q| q[0] * e[0] + q[1] * e[1]).collect();
    let vs: Vec<f64> = corners.iter().map(|q| q[0] * n[0] + q[1] * n[1]).collect();
    let min = |v: &[f64]| v.iter().copied().fold(f64::INFINITY, f64::min);
    let max = |v: &[f64]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let reach = p.pull.max(0.0);
    let inside = |q: Pt| sample(r, r.sdf(), q[0], q[1]) < reach;
    // Where the stitch from q (inside) towards s (outside) leaves the area.
    let edge = |q: Pt, s: Pt| -> Pt {
        let (mut lo, mut hi) = (0.0, 1.0);
        for _ in 0..12 {
            let m = (lo + hi) / 2.0;
            if inside([q[0] + (s[0] - q[0]) * m, q[1] + (s[1] - q[1]) * m]) {
                lo = m;
            } else {
                hi = m;
            }
        }
        [q[0] + (s[0] - q[0]) * lo, q[1] + (s[1] - q[1]) * lo]
    };
    let mut rows: Vec<Vec<Pt>> = Vec::new();
    let mut row: Vec<Pt> = Vec::new();
    let add = |row: &mut Vec<Pt>, q: Pt| {
        if let Some(last) = row.last_mut()
            && dist(*last, q) < ZIG_SHORT
        {
            *last = q;
        } else {
            row.push(q);
        }
    };
    let end = |row: &mut Vec<Pt>, rows: &mut Vec<Vec<Pt>>| {
        let mut l = 0.0;
        for i in 1..row.len() {
            l += dist(row[i - 1], row[i]);
        }
        if row.len() > 1 && l > 1.0 {
            rows.push(std::mem::take(row));
        } else {
            row.clear();
        }
    };
    // Peak j of the row at v: on the high side for even j, where the wave reaches phase + j pi.
    let u_min = min(&us) - 1.0;
    let u_max = max(&us) + 1.0;
    let v0 = ((min(&vs) - z.height / 2.0) / p.spacing).floor() * p.spacing + p.spacing / 2.0;
    let v_end = max(&vs) + z.height / 2.0;
    let mut v = v0;
    while v < v_end {
        let at = |j: i64| -> Pt {
            let sign = if j.rem_euclid(2) == 0 { 1.0 } else { -1.0 };
            let w = v + (sign * z.height) / 2.0;
            let u = (z.phase + j as f64 * PI - kn * w) / ke;
            [e[0] * u + n[0] * w, e[1] * u + n[1] * w]
        };
        let j_at = |u: f64| (ke * u + kn * v - z.phase) / PI;
        let margin = ((kn.abs() * z.height) / 2.0 / PI).ceil() as i64 + 1;
        let j0 = j_at(u_min).min(j_at(u_max)).floor() as i64 - margin;
        let j1 = j_at(u_min).max(j_at(u_max)).ceil() as i64 + margin;
        let mut prev = at(j0);
        let mut was = inside(prev);
        for j in j0 + 1..=j1 {
            let q = at(j);
            // Along the stitch in small steps: it may leave the area and come back (a notch).
            let steps = ((dist(prev, q) / 0.2).ceil() as i64).max(1);
            let mut from = prev;
            for s in 1..=steps {
                let t = [
                    prev[0] + ((q[0] - prev[0]) * s as f64) / steps as f64,
                    prev[1] + ((q[1] - prev[1]) * s as f64) / steps as f64,
                ];
                let now = inside(t);
                if now && !was {
                    add(&mut row, edge(t, from));
                } else if !now && was {
                    add(&mut row, edge(from, t));
                    end(&mut row, &mut rows);
                }
                was = now;
                from = t;
            }
            if was {
                if row.is_empty() {
                    add(&mut row, prev);
                }
                add(&mut row, q);
            }
            prev = q;
        }
        end(&mut row, &mut rows);
        v += p.spacing;
    }
    // Rows chain at their ends along the edge, which lie up to a height apart.
    if rows.is_empty() {
        return None;
    }
    let widest = p.spacing.max((z.height + p.spacing) / 2.5);
    Some(sew_rows(r, &rows, p, start, z.angle, widest, true))
}

/// Grain: features about this wide (mm); wood rings, not ripples.
pub const GRAIN_SCALE: f64 = 125.0;

/// Rows that wander softly around `angle` degrees, like wood grain; `strength` 0 to 1.
pub fn grain_field(r: &Region, angle: f64, strength: f64, seed: f64, scale: f64) -> DirField {
    let n = Noise::new(seed, scale, 5);
    let a = (angle * PI) / 180.0;
    field_of(r, |p| Some(a + strength * 1.1 * n.at(p[0], p[1])))
}

/// Rows that run out from `focus` (mm) like rays.
pub fn ray_field(r: &Region, focus: Pt) -> DirField {
    field_of(r, |p| {
        if dist(p, focus) < 0.3 {
            None
        } else {
            Some((p[1] - focus[1]).atan2(p[0] - focus[0]))
        }
    })
}

/// Rows in rings around `focus` (mm), like Ink/Stitch's circle fill.
pub fn circle_field(r: &Region, focus: Pt) -> DirField {
    field_of(r, |p| {
        if dist(p, focus) < 0.3 {
            None
        } else {
            Some((p[1] - focus[1]).atan2(p[0] - focus[0]) + PI / 2.0)
        }
    })
}

/// Rows turning around a few points inside the region (`centers`, mm, or picked by `seed`), the
/// next one turning the other way.
pub fn swirl_field(r: &Region, seed: f64, centers: Option<&[Pt]>) -> DirField {
    let own;
    let centers = match centers {
        Some(c) => c,
        None => {
            own = swirl_centers(r, seed);
            &own
        }
    };
    field_of(r, |p| {
        let (mut vx, mut vy) = (0.0, 0.0);
        for (i, c) in centers.iter().enumerate() {
            let dx = p[0] - c[0];
            let dy = p[1] - c[1];
            let w = if i % 2 == 1 { -1.0 } else { 1.0 } / (dx * dx + dy * dy + 16.0);
            vx -= dy * w;
            vy += dx * w;
        }
        if hypot(vx, vy) < 1e-12 {
            None
        } else {
            Some(vy.atan2(vx))
        }
    })
}

/// The extent of the region's pixels (mm): min x, min y, max x, max y.
pub fn region_box(r: &Region) -> [f64; 4] {
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0usize, 0usize);
    let mut any = false;
    for y in 0..r.h {
        for x in 0..r.w {
            if r.mask[y * r.w + x] == 0 {
                continue;
            }
            any = true;
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x + 1);
            y1 = y1.max(y + 1);
        }
    }
    let (rx, ry) = (f64::from(r.x0), f64::from(r.y0));
    if !any {
        return [
            rx * r.px_mm,
            ry * r.px_mm,
            (rx + r.w as f64) * r.px_mm,
            (ry + r.h as f64) * r.px_mm,
        ];
    }
    [
        (rx + x0 as f64) * r.px_mm,
        (ry + y0 as f64) * r.px_mm,
        (rx + x1 as f64) * r.px_mm,
        (ry + y1 as f64) * r.px_mm,
    ]
}

/// The region's box in the frame of a pattern turned by `angle` degrees (see Turning).
fn turned_box(r: &Region, angle: f64) -> [f64; 4] {
    let [x0, y0, x1, y1] = region_box(r);
    if angle == 0.0 {
        return [x0, y0, x1, y1];
    }
    let t = Turning::new(angle);
    let qs: Vec<Pt> = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        .iter()
        .map(|&q| t.from(q))
        .collect();
    [
        qs.iter().map(|q| q[0]).fold(f64::INFINITY, f64::min),
        qs.iter().map(|q| q[1]).fold(f64::INFINITY, f64::min),
        qs.iter().map(|q| q[0]).fold(f64::NEG_INFINITY, f64::max),
        qs.iter().map(|q| q[1]).fold(f64::NEG_INFINITY, f64::max),
    ]
}

/// One to three points well inside the region, far enough apart, picked by `seed`.
pub fn swirl_centers(r: &Region, seed: f64) -> Vec<Pt> {
    let mut rnd = Random::new(seed * 7919.0 + 13.0);
    let [x0, y0, x1, y1] = region_box(r);
    let want = round(r.area_mm2 / 500.0).clamp(1.0, 3.0) as usize;
    let apart = 6f64.max((r.area_mm2 / want as f64).sqrt() * 0.6);
    let mut out: Vec<Pt> = Vec::new();
    let mut deepest = [(x0 + x1) / 2.0, (y0 + y1) / 2.0];
    let mut dd = f64::INFINITY;
    let mut tries = 0;
    while tries < 400 && out.len() < want {
        tries += 1;
        let px = x0 + rnd.next() * (x1 - x0);
        let py = y0 + rnd.next() * (y1 - y0);
        let p = [px, py];
        let f = sample(r, &r.sdf_base, p[0], p[1]);
        if f < dd {
            dd = f;
            deepest = p;
        }
        if f > -(4f64.min(apart / 3.0)) {
            continue;
        }
        if out.iter().any(|&q| dist(p, q) < apart) {
            continue;
        }
        out.push(p);
    }
    if out.is_empty() { vec![deepest] } else { out }
}

// ------------------------------------------------------------------------------------------------
// Open patterns

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct OpenParams {
    /// Distance between neighbouring lines (mm); for grids and cross stitch the cell size.
    pub size: f64,
    /// Stitch length (mm).
    pub stitch: f64,
    pub seed: f64,
    /// Every stitch three times (bean stitch).
    #[serde(default)]
    pub triple: bool,
    /// The pattern turned by this many degrees (see Turning).
    #[serde(default)]
    pub angle: Option<f64>,
    /// Cross stitch: the corner of its grid (mm); the design origin when not set.
    #[serde(default)]
    pub origin: Option<Pt>,
}

fn open_result(runs: Vec<Vec<Pt>>) -> Option<FillResult> {
    (!runs.is_empty()).then(|| FillResult {
        runs,
        angle: 0.0,
        under: 0,
        travel: Vec::new(),
        curved: false,
    })
}

/// Bean stitch: forward, back, forward.
pub fn tripled(run: &[Pt]) -> Vec<Pt> {
    let mut out = vec![run[0]];
    for i in 1..run.len() {
        out.push(run[i]);
        out.push(run[i - 1]);
        out.push(run[i]);
    }
    out
}

/// Closed loops sewn one after the other, each from its point nearest the needle.
fn sew_loops(loops: Vec<Vec<Pt>>, start: Pt, p: &OpenParams) -> Vec<Vec<Pt>> {
    let mut runs = Vec::new();
    let mut pos = start;
    let mut todo: Vec<Vec<Pt>> = loops.into_iter().filter(|l| l.len() > 2).collect();
    while !todo.is_empty() {
        let (mut bi, mut bk, mut bd) = (0, 0, f64::INFINITY);
        for (i, l) in todo.iter().enumerate() {
            for (k, &q) in l.iter().enumerate() {
                let d = dist(pos, q);
                if d < bd {
                    bd = d;
                    bi = i;
                    bk = k;
                }
            }
        }
        let l = todo.remove(bi);
        let mut lp: Vec<Pt> = l[bk..].to_vec();
        lp.extend_from_slice(&l[..bk]);
        lp.push(l[bk]);
        let mut run = run_stitch(&lp, p.stitch, 0.2);
        if p.triple {
            run = tripled(&run);
        }
        pos = run[run.len() - 1];
        runs.push(run);
    }
    runs
}

const DIRS: [[i64; 2]; 4] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/// The outline of a random spanning tree on a grid of `cell` mm inside the region, one closed loop
/// per connected part. `maze` grows the tree depth first (long corridors, a labyrinth), else from a
/// random edge of all grown so far (short branches, a meander). The grid is turned by `angle`
/// degrees (see Turning).
fn tree_loops(
    r: &Region,
    cell: f64,
    seed: f64,
    maze: bool,
    margin: f64,
    angle: f64,
    phase: Pt,
) -> Vec<Vec<Pt>> {
    let mut rnd = Random::new(seed);
    let [bx0, by0, bx1, by1] = turned_box(r, angle);
    let turn = Turning::new(angle);
    // Anchored to the design origin, like tatami rows (shifted by `phase` mm).
    let i0 = ((bx0 - phase[0]) / cell).floor();
    let j0 = ((by0 - phase[1]) / cell).floor();
    let gw = (((bx1 - phase[0]) / cell).ceil() - i0 + 1.0) as usize;
    let gh = (((by1 - phase[1]) / cell).ceil() - j0 + 1.0) as usize;
    let at = |i: usize, j: usize| -> Pt {
        [
            (i0 + i as f64 + 0.5) * cell + phase[0],
            (j0 + j as f64 + 0.5) * cell + phase[1],
        ]
    };
    // The loop runs through the centers of the cells' quarters (spanning tree coverage, Gabriely and
    // Rimon): a quarter is free where its center keeps the margin left beyond the quarter cell.
    let q = cell / 4.0;
    let free = |i: usize, j: usize, dx: f64, dy: f64| {
        let [x, y] = at(i, j);
        let [sx, sy] = turn.to([x + dx * q, y + dy * q]);
        sample(r, r.sdf(), sx, sy) < -(margin - q)
    };
    // Free quarters per cell, bit (dx > 0) + 2 (dy > 0); a cell with all four free joins the tree.
    let n = gw * gh;
    let mut quarters = vec![0u8; n];
    for j in 0..gh {
        for i in 0..gw {
            let mut m = 0u8;
            for b in 0..4 {
                let dx = if b & 1 != 0 { 1.0 } else { -1.0 };
                let dy = if b & 2 != 0 { 1.0 } else { -1.0 };
                if free(i, j, dx, dy) {
                    m |= 1 << b;
                }
            }
            quarters[j * gw + i] = m;
        }
    }
    let ok: Vec<bool> = quarters.iter().map(|&m| m == 15).collect();
    let mut seen = vec![false; n];
    // Tree edges per cell: bit d for direction d.
    let mut links = vec![0u8; n];
    let mut grown = Vec::new();
    let shuffled = |rnd: &mut Random| -> [usize; 4] {
        let mut d = [0, 1, 2, 3];
        for i in (1..4).rev() {
            let k = (rnd.next() * (i + 1) as f64).floor() as usize;
            d.swap(i, k);
        }
        d
    };
    let neighbour = |c: usize, d: usize| -> Option<usize> {
        let ni = (c % gw) as i64 + DIRS[d][0];
        let nj = (c / gw) as i64 + DIRS[d][1];
        if ni < 0 || nj < 0 || ni >= gw as i64 || nj >= gh as i64 {
            None
        } else {
            Some(nj as usize * gw + ni as usize)
        }
    };
    for root in 0..n {
        if !ok[root] || seen[root] {
            continue;
        }
        seen[root] = true;
        if maze {
            let mut stack = vec![root];
            while let Some(&c) = stack.last() {
                let mut moved = false;
                for d in shuffled(&mut rnd) {
                    let Some(nk) = neighbour(c, d) else {
                        continue;
                    };
                    if !ok[nk] || seen[nk] {
                        continue;
                    }
                    seen[nk] = true;
                    links[c] |= 1 << d;
                    links[nk] |= 1 << ((d + 2) % 4);
                    stack.push(nk);
                    moved = true;
                    break;
                }
                if !moved {
                    stack.pop();
                }
            }
        } else {
            let mut front: Vec<(usize, usize)> = (0..4).map(|d| (root, d)).collect();
            while !front.is_empty() {
                let (c, d) = front.remove((rnd.next() * front.len() as f64).floor() as usize);
                let Some(nk) = neighbour(c, d) else {
                    continue;
                };
                if !ok[nk] || seen[nk] {
                    continue;
                }
                seen[nk] = true;
                links[c] |= 1 << d;
                links[nk] |= 1 << ((d + 2) % 4);
                front.extend((0..4).map(|d| (nk, d)));
            }
        }
        grown.push(root);
    }
    // Cells along the edge with only two free quarters, on the side of a tree cell, hang on it as
    // half leaves: the loop turns back through those two quarters (as in full spanning tree
    // coverage), so the edge keeps no more than about one line spacing free.
    let mut half = vec![-1i8; n];
    let side_free = |m: u8, d: usize| {
        // The two quarters on side d of a cell (d as in DIRS).
        let side = [0b1010, 0b1100, 0b0101, 0b0011][d];
        (m & side) == side
    };
    for d in shuffled_all(&mut rnd, n) {
        if ok[d] || quarters[d] == 0 {
            continue;
        }
        for t in 0..4 {
            let Some(nk) = neighbour(d, t) else {
                continue;
            };
            if !ok[nk] || !side_free(quarters[d], t) {
                continue;
            }
            // The tree cell's side towards it is free: it is a whole cell.
            links[nk] |= 1 << ((t + 2) % 4);
            links[d] |= 1 << t;
            half[d] = t as i8;
            break;
        }
    }
    grown
        .into_iter()
        .map(|root| {
            outline_of_tree(root, gw, &links, &at, q, &half)
                .into_iter()
                .map(|p| turn.to(p))
                .collect()
        })
        .collect()
}

/// Shifts of the grid tried when the one anchored at the origin fits no cell, in quarters of a cell.
const PHASES: usize = 4;

/// The loops of tree_loops on the grid anchored at the design origin. Where not one cell of that
/// grid fits, the grid shifted by the quarter cells that fit the most of it: whether a shape can be
/// sewn must not depend on where it lies.
fn anchored_tree_loops(
    r: &Region,
    cell: f64,
    seed: f64,
    maze: bool,
    margin: f64,
    angle: f64,
) -> Vec<Vec<Pt>> {
    let loops = tree_loops(r, cell, seed, maze, margin, angle, [0.0, 0.0]);
    if !loops.is_empty() {
        return loops;
    }
    let mut best = loops;
    let mut most = 0.0;
    for j in 0..PHASES {
        for i in 0..PHASES {
            if i == 0 && j == 0 {
                continue;
            }
            let shifted = tree_loops(
                r,
                cell,
                seed,
                maze,
                margin,
                angle,
                [
                    (i as f64 * cell) / PHASES as f64,
                    (j as f64 * cell) / PHASES as f64,
                ],
            );
            let length = shifted.iter().fold(0.0, |n, l| {
                n + (1..l.len()).fold(0.0, |m, k| m + dist(l[k - 1], l[k]))
            });
            if length > most {
                most = length;
                best = shifted;
            }
        }
    }
    best
}

/// The numbers 0 to n - 1 in a random order.
fn shuffled_all(rnd: &mut Random, n: usize) -> Vec<usize> {
    let mut a: Vec<usize> = (0..n).collect();
    for i in (1..n).rev() {
        let k = (rnd.next() * (i + 1) as f64).floor() as usize;
        a.swap(i, k);
    }
    a
}

/// Walks round a tree with it on the left, a quarter cell off its edges, and returns the corners
/// of that walk: at every cell it takes the first link turning right, then straight on, left, back.
fn outline_of_tree(
    root: usize,
    gw: usize,
    links: &[u8],
    at: &dyn Fn(usize, usize) -> Pt,
    q: f64,
    half: &[i8],
) -> Vec<Pt> {
    // y grows downwards: (1,0) turned right is (0,1).
    let right = |d: usize| (d + 1) % 4;
    let off = |d: usize| -> Pt {
        let v = DIRS[right(d)];
        [v[0] as f64, v[1] as f64]
    };
    let pos = |c: usize| at(c % gw, c / gw);
    if links[root] == 0 {
        let [x, y] = pos(root);
        return vec![
            [x - q, y - q],
            [x + q, y - q],
            [x + q, y + q],
            [x - q, y + q],
            [x - q, y - q],
        ];
    }
    let mut d0 = 0;
    while links[root] & (1 << d0) == 0 {
        d0 += 1;
    }
    let mut out: Vec<Pt> = Vec::new();
    let mut c = root;
    let mut d = d0;
    for _ in 0..8 * links.len() + 8 {
        // Along the link from c in direction d, to its next cell.
        let nc = (c as i64 + DIRS[d][0] + DIRS[d][1] * gw as i64) as usize;
        // At nc: the next direction, right first.
        let mut nd = usize::MAX;
        for t in [right(d), d, (d + 3) % 4, (d + 2) % 4] {
            if links[nc] & (1 << t) != 0 {
                nd = t;
                break;
            }
        }
        let v = pos(nc);
        let o1 = off(d);
        let dd = [DIRS[d][0] as f64, DIRS[d][1] as f64];
        if nd == d {
            // Straight on: no corner.
        } else if nd == (d + 2) % 4 {
            // Dead end: round the cell's far side, or for a half leaf its near side.
            let f = if half[nc] >= 0 { -1.0 } else { 1.0 };
            out.push([
                v[0] + q * (o1[0] + f * dd[0]),
                v[1] + q * (o1[1] + f * dd[1]),
            ]);
            out.push([
                v[0] + q * (-o1[0] + f * dd[0]),
                v[1] + q * (-o1[1] + f * dd[1]),
            ]);
        } else {
            let o2 = off(nd);
            out.push([v[0] + q * (o1[0] + o2[0]), v[1] + q * (o1[1] + o2[1])]);
        }
        c = nc;
        d = nd;
        if c == root && d == d0 {
            break;
        }
    }
    if let Some(&f) = out.first() {
        out.push(f);
    }
    out
}

/// A closed loop of straight runs with every corner rounded to an arc of `radius` mm (less where a
/// run is too short for both of its ends): the runs keep their place, so lines that lie
/// `2 * radius` apart stay that far apart and a dead end becomes a half circle.
fn rounded(lp: &[Pt], radius: f64) -> Vec<Pt> {
    // Without repeated points and points in the middle of a straight run.
    let mut pts: Vec<Pt> = Vec::new();
    for &q in &lp[..lp.len() - 1] {
        if pts.last().is_none_or(|&l| dist(l, q) > 1e-9) {
            pts.push(q);
        }
    }
    let n0 = pts.len();
    let corners: Vec<Pt> = (0..n0)
        .filter(|&i| {
            let q = pts[i];
            let a = pts[(i + n0 - 1) % n0];
            let b = pts[(i + 1) % n0];
            ((q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0])).abs() > 1e-9
        })
        .map(|i| pts[i])
        .collect();
    let n = corners.len();
    if n < 3 {
        return lp.to_vec();
    }
    let mut out = Vec::new();
    for i in 0..n {
        let a = corners[(i + n - 1) % n];
        let c = corners[i];
        let b = corners[(i + 1) % n];
        let la = dist(a, c);
        let lb = dist(c, b);
        let ua = [(a[0] - c[0]) / la, (a[1] - c[1]) / la];
        let ub = [(b[0] - c[0]) / lb, (b[1] - c[1]) / lb];
        // Tangent length of an arc of the radius between the two runs.
        let half = (ua[0] * ub[0] + ua[1] * ub[1]).clamp(-1.0, 1.0).acos() / 2.0;
        let t = (radius / half.tan()).min(la / 2.0).min(lb / 2.0);
        let p0 = [c[0] + ua[0] * t, c[1] + ua[1] * t];
        let p1 = [c[0] + ub[0] * t, c[1] + ub[1] * t];
        // The arc as a quadratic curve with its control point at the corner.
        let steps = 6;
        for k in 0..=steps {
            let s = f64::from(k) / f64::from(steps);
            out.push([
                (1.0 - s) * (1.0 - s) * p0[0] + 2.0 * s * (1.0 - s) * c[0] + s * s * p1[0],
                (1.0 - s) * (1.0 - s) * p0[1] + 2.0 * s * (1.0 - s) * c[1] + s * s * p1[1],
            ]);
        }
    }
    out.push(out[0]);
    out
}

/// Points every `step` mm along a closed loop (keeping its corners close enough).
fn densify(lp: &[Pt], step: f64) -> Vec<Pt> {
    let mut out = vec![lp[0]];
    for i in 1..lp.len() {
        let (a, b) = (lp[i - 1], lp[i]);
        let n = ((dist(a, b) / step).ceil() as i64).max(1);
        for k in 1..=n {
            out.push([
                a[0] + ((b[0] - a[0]) * k as f64) / n as f64,
                a[1] + ((b[1] - a[1]) * k as f64) / n as f64,
            ]);
        }
    }
    out
}

/// Meander (stippling): a tree outline with its corners rounded, bent by a smooth warp of the plane,
/// which keeps the line from crossing itself. Lines are `size` mm apart.
pub fn meander_fill(r: &Region, p: &OpenParams, start: Pt) -> Option<FillResult> {
    let cell = 2.0 * p.size;
    let amp = 0.2 * cell;
    let nx = Noise::new(p.seed * 31.0 + 1.0, 3.0 * cell, 2);
    let ny = Noise::new(p.seed * 31.0 + 2.0, 3.0 * cell, 2);
    // The warp fades out towards the edge, so the line can come as close to it as a maze's and is
    // never pushed out (it moves a point by less than half its depth beyond the 0.2 mm kept free).
    let warp = |[x, y]: Pt| -> Pt {
        let f = amp * 0.6 * ((-sample(r, r.sdf(), x, y) - 0.2) / (2.0 * amp)).clamp(0.0, 1.0);
        [x + f * nx.at(x, y), y + f * ny.at(x, y)]
    };
    let loops: Vec<Vec<Pt>> = anchored_tree_loops(
        r,
        cell,
        p.seed,
        false,
        cell / 4.0 + 0.2,
        p.angle.unwrap_or(0.0),
    )
    .iter()
    .map(|l| {
        densify(&rounded(l, cell / 4.0), cell / 8.0)
            .into_iter()
            .map(warp)
            .collect()
    })
    .collect();
    open_result(sew_loops(loops, start, p))
}

/// Maze: the tree outline with straight corridors and sharp corners. Lines are `size` mm apart.
pub fn maze_fill(r: &Region, p: &OpenParams, start: Pt) -> Option<FillResult> {
    let cell = 2.0 * p.size;
    let loops = anchored_tree_loops(
        r,
        cell,
        p.seed,
        true,
        cell / 4.0 + 0.2,
        p.angle.unwrap_or(0.0),
    );
    open_result(sew_loops(loops, start, p))
}

/// Echo: rings `size` mm apart along the edge, like echo quilting.
pub fn echo_fill(r: &Region, p: &OpenParams, start: Pt) -> Option<FillResult> {
    let fp = FillParams {
        spacing: p.size,
        stitch: p.stitch,
        angle: Some(0.0),
        pull: 0.0,
        underlay: false,
        tolerance: Some(0.2),
        ..Default::default()
    };
    let mut res = contour_fill(r, &fp, start)?;
    if p.triple {
        res.runs = res.runs.iter().map(|r| tripled(r)).collect();
    }
    res.under = 0;
    Some(res)
}

/// A graph of points and their edges, keyed by the points rounded to 0.01 mm; nodes and their
/// neighbours keep the order they came in (the order a JavaScript Map and Set keep).
#[derive(Default)]
struct Graph {
    ids: IdMap<(i64, i64), usize>,
    pts: Vec<Pt>,
    adj: Vec<Vec<usize>>,
    gone: Vec<bool>,
}

impl Graph {
    fn key(q: Pt) -> (i64, i64) {
        (round(q[0] * 100.0) as i64, round(q[1] * 100.0) as i64)
    }
    fn node(&mut self, k: (i64, i64), q: Pt) -> usize {
        if let Some(&i) = self.ids.get(&k) {
            // The point stored for a key is the last one given for it.
            self.pts[i] = q;
            return i;
        }
        self.ids.insert(k, self.pts.len());
        self.pts.push(q);
        self.adj.push(Vec::new());
        self.gone.push(false);
        self.pts.len() - 1
    }
    fn add(&mut self, a: Pt, b: Pt) {
        let (ka, kb) = (Graph::key(a), Graph::key(b));
        if ka == kb {
            return;
        }
        let ia = self.node(ka, a);
        let ib = self.node(kb, b);
        if !self.adj[ia].contains(&ib) {
            self.adj[ia].push(ib);
        }
        if !self.adj[ib].contains(&ia) {
            self.adj[ib].push(ia);
        }
    }
    /// Takes away dead ends, again and again, so only closed cells stay.
    fn prune(&mut self) {
        let mut leaves: Vec<usize> = (0..self.pts.len())
            .filter(|&k| self.adj[k].len() < 2)
            .collect();
        while let Some(k) = leaves.pop() {
            if self.gone[k] {
                continue;
            }
            self.gone[k] = true;
            let ns = std::mem::take(&mut self.adj[k]);
            for n in ns {
                if self.gone[n] {
                    continue;
                }
                self.adj[n].retain(|&x| x != k);
                if self.adj[n].len() < 2 {
                    leaves.push(n);
                }
            }
        }
    }
    /// Every edge once there and back, depth first, one run per connected part, the parts in the
    /// order the needle reaches them.
    fn walk(&self, start: Pt) -> Vec<Vec<Pt>> {
        let n = self.pts.len();
        let mut used: std::collections::HashSet<(usize, usize)> = std::collections::HashSet::new();
        let mut done = vec![false; n];
        let mut runs = Vec::new();
        let mut pos = start;
        let edge = |a: usize, b: usize| if a < b { (a, b) } else { (b, a) };
        loop {
            let mut first = None;
            let mut fd = f64::INFINITY;
            for k in 0..n {
                if self.gone[k] || done[k] {
                    continue;
                }
                let d = dist(pos, self.pts[k]);
                if d < fd {
                    fd = d;
                    first = Some(k);
                }
            }
            let Some(first) = first else {
                break;
            };
            let mut path = vec![self.pts[first]];
            let mut stack = vec![first];
            done[first] = true;
            while let Some(&v) = stack.last() {
                let mut next = None;
                // The nearest unused edge, so the walk stays local.
                let mut nd = f64::INFINITY;
                for &w in &self.adj[v] {
                    if used.contains(&edge(v, w)) {
                        continue;
                    }
                    let d = dist(self.pts[v], self.pts[w]) + if done[w] { 1e6 } else { 0.0 };
                    if d < nd {
                        nd = d;
                        next = Some(w);
                    }
                }
                let Some(next) = next else {
                    stack.pop();
                    if let Some(&top) = stack.last() {
                        path.push(self.pts[top]);
                    }
                    continue;
                };
                used.insert(edge(v, next));
                path.push(self.pts[next]);
                if done[next] {
                    // Already reached: back at once (the edge is sewn twice), the walk goes on from v.
                    path.push(self.pts[v]);
                } else {
                    done[next] = true;
                    stack.push(next);
                }
            }
            pos = path[path.len() - 1];
            if path.len() > 1 {
                runs.push(path);
            }
        }
        runs
    }
}

/// How far inside the edge a grid stays (mm).
const GRID_MARGIN: f64 = 0.3;
/// Lattice pieces shorter than this where the edge cuts them are left out (mm).
const MIN_PIECE: f64 = 0.4;

/// A part of a lattice line, and which of its ends the edge cut.
struct Piece {
    a: Pt,
    b: Pt,
    cut_a: bool,
    cut_b: bool,
}

/// The ends of a lattice line, the same way round from either cell it borders.
fn ordered(a: Pt, b: Pt) -> (Pt, Pt) {
    if a[0] < b[0] || (a[0] == b[0] && a[1] < b[1]) {
        (a, b)
    } else {
        (b, a)
    }
}

/// A grid of honeycombs, diamonds or bricks `size` mm wide, turned by `p.angle`, sewn in one go per
/// connected part.
pub fn grid_fill(r: &Region, p: &OpenParams, kind: GridKind, start: Pt) -> Option<FillResult> {
    let angle = p.angle.unwrap_or(0.0);
    let [x0, y0, x1, y1] = turned_box(r, angle);
    let turn = Turning::new(angle);
    let s = p.size;
    let mut pieces: Vec<Piece> = Vec::new();
    let mut add = |a0: Pt, b0: Pt| {
        let (a, b) = ordered(turn.to(a0), turn.to(b0));
        pieces.extend(clipped(r, a, b, GRID_MARGIN, MIN_PIECE));
    };
    let fl = |x: f64| x.floor() as i64;
    let ce = |x: f64| x.ceil() as i64;
    match kind {
        GridKind::Hex => {
            let rad = s / 3f64.sqrt();
            let hx = s;
            let hy = 1.5 * rad;
            for j in fl(y0 / hy) - 1..=ce(y1 / hy) + 1 {
                for i in fl(x0 / hx) - 1..=ce(x1 / hx) + 1 {
                    let cx = i as f64 * hx + if j % 2 != 0 { hx / 2.0 } else { 0.0 };
                    let cy = j as f64 * hy;
                    let c: Vec<Pt> = (0..6)
                        .map(|k| {
                            let a = ((30.0 + 60.0 * f64::from(k)) * PI) / 180.0;
                            [cx + rad * a.js_cos(), cy + rad * a.js_sin()]
                        })
                        .collect();
                    for k in 0..6 {
                        add(c[k], c[(k + 1) % 6]);
                    }
                }
            }
        }
        GridKind::Diamond => {
            // A square grid turned by 45 degrees, `size` across a diamond.
            let h = s / 2.0;
            for j in fl(y0 / h) - 1..=ce(y1 / h) + 1 {
                for i in fl(x0 / s) - 1..=ce(x1 / s) + 1 {
                    let c = [
                        i as f64 * s + if j % 2 != 0 { h } else { 0.0 },
                        j as f64 * h,
                    ];
                    add(c, [c[0] + h, c[1] + h]);
                    add(c, [c[0] - h, c[1] + h]);
                }
            }
        }
        GridKind::Brick => {
            // Bricks twice as long as high, every row shifted by half a brick.
            let h = s / 2.0;
            for j in fl(y0 / h) - 1..=ce(y1 / h) + 1 {
                for i in fl(x0 / h) - 1..=ce(x1 / h) + 1 {
                    let a = [i as f64 * h, j as f64 * h];
                    add(a, [a[0] + h, a[1]]);
                    if (((i + j) % 2) + 2) % 2 == 0 {
                        add(a, [a[0], a[1] + h]);
                    }
                }
            }
        }
    }
    let mut g = lattice_graph(r, &pieces, GRID_MARGIN);
    g.prune();
    let mut runs: Vec<Vec<Pt>> = g
        .walk(start)
        .iter()
        .map(|run| run_stitch(run, p.stitch, 0.05))
        .collect();
    if p.triple {
        runs = runs.iter().map(|r| tripled(r)).collect();
    }
    open_result(runs)
}

/// A figure's width as a share of the distance between figures: the rest is the link between them.
const FIGURE_SHARE: f64 = 0.62;
/// Rows of figures this share of their distance apart.
const FIGURE_ROW: f64 = 0.9;

/// Motif fill: small figures (hearts, stars, flowers, circles) `size` mm apart in rows shifted by
/// half a figure, each row strung on one line from figure to figure, sewn in one go like the grids.
/// Figures and links the edge cuts end on the line along the edge, which joins the rows; every line
/// is sewn there and back, so the figures come out as a double line.
pub fn motif_fill(r: &Region, p: &OpenParams, figure: Figure, start: Pt) -> Option<FillResult> {
    let angle = p.angle.unwrap_or(0.0);
    let [x0, y0, x1, y1] = turned_box(r, angle);
    let turn = Turning::new(angle);
    let s = p.size;
    let hy = s * FIGURE_ROW;
    let shape = figure_outline(figure, s * FIGURE_SHARE);
    // The points where a figure is strung: its leftmost and rightmost.
    let (mut li, mut ri) = (0, 0);
    for (i, q) in shape.iter().enumerate() {
        if q[0] < shape[li][0] {
            li = i;
        }
        if q[0] > shape[ri][0] {
            ri = i;
        }
    }
    let mut pieces: Vec<Piece> = Vec::new();
    let inside = |q: Pt| sample(r, r.sdf(), q[0], q[1]) < -GRID_MARGIN;
    let mut add = |a0: Pt, b0: Pt| {
        let a = turn.to(a0);
        let b = turn.to(b0);
        // The short pieces of a curve are all kept, so a figure the edge cuts stays one line.
        let m = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
        if inside(a) && inside(b) && inside(m) {
            pieces.push(Piece {
                a,
                b,
                cut_a: false,
                cut_b: false,
            });
        } else {
            let (a, b) = ordered(a, b);
            pieces.extend(clipped(r, a, b, GRID_MARGIN, 0.0));
        }
    };
    for j in (y0 / hy).floor() as i64 - 1..=(y1 / hy).ceil() as i64 + 1 {
        let dx = if ((j % 2) + 2) % 2 != 0 { s / 2.0 } else { 0.0 };
        let mut prev: Option<Pt> = None;
        for i in (x0 / s).floor() as i64 - 1..=(x1 / s).ceil() as i64 + 1 {
            let c = [i as f64 * s + dx, j as f64 * hy];
            let at: Vec<Pt> = shape.iter().map(|q| [c[0] + q[0], c[1] + q[1]]).collect();
            for k in 1..at.len() {
                add(at[k - 1], at[k]);
            }
            if let Some(pv) = prev {
                add(pv, at[li]);
            }
            prev = Some(at[ri]);
        }
    }
    let mut g = lattice_graph(r, &pieces, GRID_MARGIN);
    g.prune();
    let mut runs: Vec<Vec<Pt>> = g
        .walk(start)
        .iter()
        .map(|run| run_stitch(run, p.stitch, 0.05))
        .collect();
    if p.triple {
        runs = runs.iter().map(|r| tripled(r)).collect();
    }
    open_result(runs)
}

/// The outline of a figure `w` mm wide around 0, closed (the last point is the first), upright.
pub fn figure_outline(f: Figure, w: f64) -> Vec<Pt> {
    let r = w / 2.0;
    let mut out: Vec<Pt> = Vec::new();
    match f {
        Figure::Hearts => {
            // The heart curve is 32 units wide (x from -16 to 16).
            for i in 0..48 {
                let t = (2.0 * PI * f64::from(i)) / 48.0;
                let x = 16.0 * t.js_sin().js_pow(3.0);
                let y = 13.0 * t.js_cos()
                    - 5.0 * (2.0 * t).js_cos()
                    - 2.0 * (3.0 * t).js_cos()
                    - (4.0 * t).js_cos();
                out.push([(x / 16.0) * r, (-(y + 2.5) / 16.0) * r]);
            }
        }
        Figure::Stars => {
            for i in 0..10 {
                let rr = if i % 2 == 1 { r * 0.45 } else { r };
                let a = -PI / 2.0 + (f64::from(i) * PI) / 5.0;
                out.push([rr * a.js_cos(), rr * a.js_sin() + r * 0.1]);
            }
        }
        Figure::Flowers => {
            // Five round petals, one pointing up, with narrow notches between them.
            for i in 0..80 {
                let a = (2.0 * PI * f64::from(i)) / 80.0;
                let rr = r * (0.3 + 0.7 * (2.5 * (a + PI / 2.0)).js_cos().abs().sqrt());
                out.push([rr * a.js_cos(), rr * a.js_sin()]);
            }
        }
        Figure::Circles => {
            for i in 0..36 {
                let a = (2.0 * PI * f64::from(i)) / 36.0;
                out.push([r * 0.9 * a.js_cos(), r * 0.9 * a.js_sin()]);
            }
        }
    }
    out.push(out[0]);
    out
}

/// The parts of segment ab more than `margin` inside the region: sampled every 0.1 mm, each end
/// where it crosses that line found by bisection.
fn clipped(r: &Region, a: Pt, b: Pt, margin: f64, min_piece: f64) -> Vec<Piece> {
    let len = dist(a, b);
    let at = |t: f64| -> Pt { [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
    let inside = |t: f64| {
        let q = at(t);
        sample(r, r.sdf(), q[0], q[1]) < -margin
    };
    let n = ((len / 0.1).ceil() as i64).max(2);
    let cross = |mut lo: f64, mut hi: f64| {
        // inside(lo) differs from inside(hi): the crossing between them.
        let was = inside(lo);
        for _ in 0..14 {
            let m = (lo + hi) / 2.0;
            if inside(m) == was {
                lo = m;
            } else {
                hi = m;
            }
        }
        (lo + hi) / 2.0
    };
    let piece = |t0: f64, t1: f64| Piece {
        a: at(t0),
        b: at(t1),
        cut_a: t0 > 0.0,
        cut_b: t1 < 1.0,
    };
    let mut out = Vec::new();
    let mut from: Option<f64> = if inside(0.0) { Some(0.0) } else { None };
    for k in 1..=n {
        let t0 = (k - 1) as f64 / n as f64;
        let t1 = k as f64 / n as f64;
        let now = inside(t1);
        match from {
            None if now => from = Some(cross(t0, t1)),
            Some(f) if !now => {
                let to = cross(t0, t1);
                if (to - f) * len >= min_piece {
                    out.push(piece(f, to));
                }
                from = None;
            }
            _ => {}
        }
    }
    if let Some(f) = from
        && (1.0 - f) * len >= min_piece
    {
        out.push(piece(f, 1.0));
    }
    out
}

/// A lattice cut by the edge as one graph, the way Ink/Stitch joins fill rows: the line `margin`
/// inside the edge joins the cut ends, so the lattice reaches the edge all round and is sewn in one
/// go, with no dead ends sewn twice and no part of the area left out because its cells are cut.
fn lattice_graph(r: &Region, pieces: &[Piece], margin: f64) -> Graph {
    let mut g = Graph::default();
    let loops = outline(r, -margin, r.sdf());
    // Cut ends, put on the nearest point of the line along the edge: per loop, its place along it.
    let mut on_loop: Vec<Vec<(f64, Pt)>> = vec![Vec::new(); loops.len()];
    let snap = |q: Pt, on_loop: &mut Vec<Vec<(f64, Pt)>>| -> Pt {
        let (mut bd, mut bl, mut bs, mut bq) = (f64::INFINITY, usize::MAX, 0.0, q);
        for (li, l) in loops.iter().enumerate() {
            for i in 1..l.len() {
                let (a, b) = (l[i - 1], l[i]);
                let dx = b[0] - a[0];
                let dy = b[1] - a[1];
                let ll = dx * dx + dy * dy;
                let t = if ll > 0.0 {
                    (((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / ll).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let c = [a[0] + dx * t, a[1] + dy * t];
                let d = dist(c, q);
                if d < bd {
                    bd = d;
                    bl = li;
                    bs = (i - 1) as f64 + t;
                    bq = c;
                }
            }
        }
        // Too far from the line (a crossing where the edge is cut by the region's window): kept as it is.
        if bl == usize::MAX || bd > 0.2 {
            return q;
        }
        on_loop[bl].push((bs, bq));
        bq
    };
    for pc in pieces {
        let a = if pc.cut_a {
            snap(pc.a, &mut on_loop)
        } else {
            pc.a
        };
        let b = if pc.cut_b {
            snap(pc.b, &mut on_loop)
        } else {
            pc.b
        };
        g.add(a, b);
    }
    for (li, l) in loops.iter().enumerate() {
        let cuts = &on_loop[li];
        if cuts.is_empty() {
            continue;
        }
        // The loop's points and the cut ends on it, in order along it.
        let mut along: Vec<(f64, Pt)> = l[..l.len() - 1]
            .iter()
            .enumerate()
            .map(|(i, &q)| (i as f64, q))
            .collect();
        along.extend_from_slice(cuts);
        along.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
        for i in 0..along.len() {
            g.add(along[i].1, along[(i + 1) % along.len()].1);
        }
    }
    g
}

/// The grid of a cross stitch: cells `size` mm wide, turned by `angle` degrees about `origin`.
#[derive(Clone, Copy, Debug)]
pub struct CrossGrid {
    pub size: f64,
    pub angle: f64,
    pub origin: Pt,
}

/// A cell is crossed when the area covers at least this share of it.
pub const CROSS_COVERAGE: f64 = 0.5;

impl CrossGrid {
    /// Where a point of the design (mm) lies on the grid, in cells (upright, from the origin).
    pub fn on(&self, q: Pt) -> Pt {
        let u = Turning::new(self.angle).from([q[0] - self.origin[0], q[1] - self.origin[1]]);
        [u[0] / self.size, u[1] / self.size]
    }
    /// Where a point of the grid (in cells) lies in the design (mm).
    pub fn off(&self, q: Pt) -> Pt {
        let u = Turning::new(self.angle).to([q[0] * self.size, q[1] * self.size]);
        [u[0] + self.origin[0], u[1] + self.origin[1]]
    }
}

/// The cells of grid `g` the region covers enough of (CROSS_COVERAGE), counted pixel by pixel, in
/// rows from the top.
pub fn cross_cells(r: &Region, g: &CrossGrid) -> Vec<[i64; 2]> {
    let mut count: IdMap<(i64, i64), f64> = IdMap::default();
    let t = Turning::new(g.angle);
    for y in 0..r.h {
        for x in 0..r.w {
            if r.mask[y * r.w + x] == 0 {
                continue;
            }
            let p = [
                (x as f64 + f64::from(r.x0) + 0.5) * r.px_mm,
                (y as f64 + f64::from(r.y0) + 0.5) * r.px_mm,
            ];
            let u = t.from([p[0] - g.origin[0], p[1] - g.origin[1]]);
            let q = [u[0] / g.size, u[1] / g.size];
            *count
                .entry((q[0].floor() as i64, q[1].floor() as i64))
                .or_default() += 1.0;
        }
    }
    let need = (CROSS_COVERAGE * g.size * g.size) / (r.px_mm * r.px_mm) - 1e-6;
    let mut out: Vec<[i64; 2]> = count
        .into_iter()
        .filter(|&(_, n)| n >= need)
        .map(|((i, j), _)| [i, j])
        .collect();
    out.sort_by(|a, b| a[1].cmp(&b[1]).then(a[0].cmp(&b[0])));
    out
}

/// How often a cross lays each of its diagonals: there and back on small crosses, twice that on
/// coarse ones (3 mm and up), where one pair of threads looks thin.
pub fn cross_passes(size: f64) -> usize {
    if size >= CROSS_COARSE { 4 } else { 2 }
}
const CROSS_COARSE: f64 = 2.75;

/// Cross stitch on grid `g` over the cells the region covers (cross_cells). A full cross is one
/// closed loop through its middle, the thread only on the diagonals; loops of crosses that share a
/// corner are joined there (as Hierholzer joins cycles), so a connected area is sewn in one go and
/// every cross gets its top diagonal last. Half and double crosses are graphs walked as the grids.
pub fn cross_fill(r: &Region, p: &OpenParams, kind: CrossKind, start: Pt) -> Option<FillResult> {
    let g = CrossGrid {
        size: p.size,
        angle: p.angle.unwrap_or(0.0),
        origin: p.origin.unwrap_or([0.0, 0.0]),
    };
    let cells = cross_cells(r, &g);
    if cells.is_empty() {
        return None;
    }
    if kind == CrossKind::Full {
        let runs: Vec<Vec<Pt>> = cross_loops(&cells, cross_passes(g.size), g.on(start))
            .into_iter()
            .map(|run| run.into_iter().map(|q| g.off(q)).collect())
            .collect();
        return open_result(runs);
    }
    let mut gr = Graph::default();
    for &[l, t] in &cells {
        let (l, t) = (l as f64, t as f64);
        let tl = [l, t];
        let tr = [l + 1.0, t];
        let br = [l + 1.0, t + 1.0];
        let bl = [l, t + 1.0];
        if kind == CrossKind::Double {
            let m = [l + 0.5, t + 0.5];
            for q in [
                tl,
                tr,
                br,
                bl,
                [l + 0.5, t],
                [l + 1.0, t + 0.5],
                [l + 0.5, t + 1.0],
                [l, t + 0.5],
            ] {
                gr.add(g.off(q), g.off(m));
            }
        } else {
            gr.add(g.off(bl), g.off(tr));
        }
    }
    let mut runs = gr.walk(start);
    if p.triple {
        runs = runs.iter().map(|r| tripled(r)).collect();
    }
    open_result(runs)
}

/// The loop of one cross (cell `c`) from its corner `e` back to it, on the grid (in cells), each
/// diagonal `passes` times; the corner itself first and last.
fn cross_loop(c: [i64; 2], e: Pt, passes: usize) -> Vec<Pt> {
    let (l, t) = (c[0] as f64, c[1] as f64);
    let tl = [l, t];
    let br = [l + 1.0, t + 1.0];
    let bl = [l, t + 1.0];
    let tr = [l + 1.0, t];
    let m = [l + 0.5, t + 0.5];
    // Back and forth n times from a, ending on b.
    let spans = |a: Pt, b: Pt, n: usize| -> Vec<Pt> {
        (0..n).map(|k| if k % 2 == 1 { a } else { b }).collect()
    };
    let n = passes - 1;
    let mut out = Vec::new();
    if e == bl || e == tr {
        // Entered on the bottom diagonal: it first, then the top one, back to the middle and home.
        let x = e;
        let y = if e == bl { tr } else { bl };
        out.push(x);
        out.extend(spans(x, y, n));
        out.push(m);
        out.push(tl);
        out.extend(spans(tl, br, n));
        out.push(m);
        out.push(x);
        return out;
    }
    // Entered on the top diagonal: to the middle, the bottom diagonal, the top one home.
    let a = e;
    let b = if e == tl { br } else { tl };
    out.push(a);
    out.push(m);
    out.push(bl);
    out.extend(spans(bl, tr, n));
    out.push(m);
    out.push(b);
    out.extend(spans(b, a, n));
    out
}

/// The crosses as runs on the grid (in cells): loops joined at shared corners into one run per
/// connected group, the groups in the order the needle reaches them from `start` (in cells).
fn cross_loops(cells: &[[i64; 2]], passes: usize, start: Pt) -> Vec<Vec<Pt>> {
    let mut index: IdMap<(i64, i64), usize> = IdMap::default();
    for (i, c) in cells.iter().enumerate() {
        index.entry((c[0], c[1])).or_insert(i);
    }
    let mut left: Vec<bool> = vec![false; cells.len()];
    for &i in index.values() {
        left[i] = true;
    }
    let mut count = left.iter().filter(|&&l| l).count();
    // The cells around corner q that are still to sew, the one to the right and below first.
    let around = |q: Pt, left: &[bool]| -> Option<usize> {
        for [di, dj] in [[0, 0], [-1, 0], [0, -1], [-1, -1]] {
            if let Some(&i) = index.get(&(q[0] as i64 + di, q[1] as i64 + dj))
                && left[i]
            {
                return Some(i);
            }
        }
        None
    };
    let corners = |c: [i64; 2]| -> [Pt; 4] {
        let (x, y) = (c[0] as f64, c[1] as f64);
        [[x, y], [x + 1.0, y], [x + 1.0, y + 1.0], [x, y + 1.0]]
    };
    let mut runs = Vec::new();
    let mut pos = start;
    while count > 0 {
        // The corner nearest the needle of a cross still to sew.
        let mut first = 0;
        let mut entry = [0.0, 0.0];
        let mut best = f64::INFINITY;
        for (i, c) in cells.iter().enumerate() {
            if !left[i] {
                continue;
            }
            for q in corners(*c) {
                let d = dist(q, pos);
                if d < best {
                    best = d;
                    first = i;
                    entry = q;
                }
            }
        }
        left[first] = false;
        count -= 1;
        let mut run = vec![entry];
        // Loops being sewn, the innermost last, each with the place reached in it.
        let mut stack: Vec<(Vec<Pt>, usize)> = vec![(cross_loop(cells[first], entry, passes), 0)];
        while let Some(f) = stack.last_mut() {
            let q = f.0[f.1];
            // On a corner: crosses still to sew there are sewn now, their loops ending here again.
            if q[0].fract() == 0.0
                && q[1].fract() == 0.0
                && let Some(c) = around(q, &left)
            {
                left[c] = false;
                count -= 1;
                stack.push((cross_loop(cells[c], q, passes), 0));
                continue;
            }
            f.1 += 1;
            if f.1 >= f.0.len() {
                stack.pop();
                continue;
            }
            run.push(f.0[f.1]);
        }
        pos = run[run.len() - 1];
        runs.push(run);
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    #[test]
    fn random_is_mulberry32() {
        // The first numbers of mulberry32 for seed 1, as JavaScript gives them.
        let mut r = Random::new(1.0);
        let a = r.next();
        assert!((0.0..1.0).contains(&a));
        let mut r2 = Random::new(1.0);
        assert_eq!(a, r2.next());
    }

    #[test]
    fn open_patterns_stay_inside() {
        let r = region_of(250, 0.1, |x, y| (x - 12.5).hypot(y - 12.5) < 10.0);
        let p = OpenParams {
            size: 2.5,
            stitch: 2.5,
            seed: 3.0,
            ..Default::default()
        };
        for res in [
            meander_fill(&r, &p, [0.0, 0.0]),
            maze_fill(&r, &p, [0.0, 0.0]),
            grid_fill(&r, &p, GridKind::Hex, [0.0, 0.0]),
            motif_fill(
                &r,
                &OpenParams {
                    size: 6.0,
                    ..p.clone()
                },
                Figure::Hearts,
                [0.0, 0.0],
            ),
            cross_fill(&r, &p, CrossKind::Full, [0.0, 0.0]),
            cross_fill(&r, &p, CrossKind::Double, [0.0, 0.0]),
        ] {
            let res = res.unwrap();
            assert!(!res.runs.is_empty());
            for run in &res.runs {
                for q in run {
                    assert!(sample(&r, r.sdf(), q[0], q[1]) < 1.2, "{q:?}");
                }
            }
        }
    }

    #[test]
    fn emboss_and_texture_points_are_sorted() {
        let cross = motif_crossings(Motif::Diamonds, 5.0, [0.0, 2.0], [1.0, 0.0], 0.0, 40.0, 0.0);
        assert!(!cross.is_empty());
        let pts = emboss_points(&cross, &[1.0, 4.0, 7.0, 10.0], 3.0, 0.0, 40.0);
        assert!(pts.windows(2).all(|w| w[0] <= w[1]));
        let t = texture_points(Texture::Herringbone, 12.0, 3.0, 1.0, 0.0, 40.0, 0.6);
        assert!(t.windows(2).all(|w| w[0] <= w[1]));
        assert!(motif_inside(Motif::Diamonds, 5.0, [2.5, 4.7], 0.0));
    }
}
