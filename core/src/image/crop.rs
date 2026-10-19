//! Zuschneiden: the part of the picture that becomes the design, a rectangle as shares (0..1) of the
//! picture as opened. The picture itself stays whole, so the cut can be widened again later.

use serde::{Deserialize, Serialize};

use super::color::js_round;
use super::prepare::Stroke;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Where a drag on the frame grabbed it: an edge, a corner or the inside (move).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CropHandle {
    N,
    S,
    E,
    W,
    Nw,
    Ne,
    Sw,
    Se,
    Move,
}

/// Smallest side of a cut, as a share of the picture.
pub const MIN_CROP: f64 = 0.03;

const FULL: Crop = Crop {
    x: 0.0,
    y: 0.0,
    w: 1.0,
    h: 1.0,
};

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    hi.min(lo.max(v))
}

/// The cut, or the whole picture.
pub fn crop_of(c: Option<Crop>) -> Crop {
    c.unwrap_or(FULL)
}

/// True for (nearly) the whole picture: no cut.
pub fn is_full(c: Option<Crop>) -> bool {
    let Some(c) = c else { return true };
    let e = 1e-4;
    c.x < e && c.y < e && c.x + c.w > 1.0 - e && c.y + c.h > 1.0 - e
}

/// A cut read from storage or a project file: inside the picture and not too small, else none.
pub fn read_crop(c: Crop) -> Option<Crop> {
    if ![c.x, c.y, c.w, c.h].iter().all(|v| v.is_finite()) {
        return None;
    }
    let x = clamp(c.x, 0.0, 1.0 - MIN_CROP);
    let y = clamp(c.y, 0.0, 1.0 - MIN_CROP);
    let out = Crop {
        x,
        y,
        w: clamp(c.w, MIN_CROP, 1.0 - x),
        h: clamp(c.h, MIN_CROP, 1.0 - y),
    };
    if is_full(Some(out)) { None } else { Some(out) }
}

/// The cut after dragging `handle` by (dx, dy), shares of the picture. Edges stop at the picture
/// and at the smallest size; the inside moves the whole cut, which stays inside the picture.
pub fn drag_crop(c: Crop, handle: CropHandle, dx: f64, dy: f64) -> Crop {
    use CropHandle::*;
    if handle == Move {
        return Crop {
            x: clamp(c.x + dx, 0.0, 1.0 - c.w),
            y: clamp(c.y + dy, 0.0, 1.0 - c.h),
            ..c
        };
    }
    let (mut x0, mut y0, mut x1, mut y1) = (c.x, c.y, c.x + c.w, c.y + c.h);
    if matches!(handle, W | Nw | Sw) {
        x0 = clamp(x0 + dx, 0.0, x1 - MIN_CROP);
    }
    if matches!(handle, E | Ne | Se) {
        x1 = clamp(x1 + dx, x0 + MIN_CROP, 1.0);
    }
    if matches!(handle, N | Nw | Ne) {
        y0 = clamp(y0 + dy, 0.0, y1 - MIN_CROP);
    }
    if matches!(handle, S | Sw | Se) {
        y1 = clamp(y1 + dy, y0 + MIN_CROP, 1.0);
    }
    Crop {
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
    }
}

/// The handle at (px, py), shares of the picture; `tx`, `ty` is how near counts (also as shares).
/// Corners before edges, the inside moves only a real cut (on the whole picture a drag pans).
pub fn crop_handle_at(c: Crop, px: f64, py: f64, tx: f64, ty: f64) -> Option<CropHandle> {
    use CropHandle::*;
    let x1 = c.x + c.w;
    let y1 = c.y + c.h;
    let in_x = px > c.x - tx && px < x1 + tx;
    let in_y = py > c.y - ty && py < y1 + ty;
    if !in_x || !in_y {
        return None;
    }
    let n = (py - c.y).abs() < ty;
    let s = !n && (py - y1).abs() < ty;
    let w = (px - c.x).abs() < tx;
    let e = !w && (px - x1).abs() < tx;
    match (n, s, w, e) {
        (true, _, true, _) => Some(Nw),
        (true, _, _, true) => Some(Ne),
        (_, true, true, _) => Some(Sw),
        (_, true, _, true) => Some(Se),
        (true, ..) => Some(N),
        (_, true, ..) => Some(S),
        (_, _, true, _) => Some(W),
        (.., true) => Some(E),
        _ if is_full(Some(c)) => None,
        _ => Some(Move),
    }
}

/// The cut in whole pixels (x, y, w, h) of a picture of `ww` × `hh`, at least one pixel.
pub fn crop_pixels(c: Option<Crop>, ww: usize, hh: usize) -> [usize; 4] {
    let k = crop_of(c);
    let (wf, hf) = (ww as f64, hh as f64);
    let x = clamp(js_round(k.x * wf), 0.0, wf - 1.0);
    let y = clamp(js_round(k.y * hf), 0.0, hf - 1.0);
    let w = clamp(js_round((k.x + k.w) * wf) - x, 1.0, wf - x);
    let h = clamp(js_round((k.y + k.h) * hf) - y, 1.0, hf - y);
    [x as usize, y as usize, w as usize, h as usize]
}

/// A brush stroke painted on the cut `from`, moved onto the cut `to`: it stays on the same spot of
/// the picture. Strokes keep their points as shares of the cut and the radius as a share of its width.
pub fn move_stroke(s: &Stroke, from: Option<Crop>, to: Option<Crop>) -> Stroke {
    let a = crop_of(from);
    let b = crop_of(to);
    Stroke {
        points: s
            .points
            .iter()
            .map(|&[x, y]| [(a.x + x * a.w - b.x) / b.w, (a.y + y * a.h - b.y) / b.h])
            .collect(),
        radius: (s.radius * a.w) / b.w,
        color: s.color,
    }
}

/// The part of the picture that differs from its background, as a cut with a small margin; none when
/// the picture has no plain background or the motif fills it. The background is the color of the
/// corners when at least three of them agree; transparent pixels count as background too.
pub fn content_crop(data: &[u8], ww: usize, hh: usize) -> Option<Crop> {
    if ww < 4 || hh < 4 {
        return None;
    }
    let at = |x: usize, y: usize| (y * ww + x) * 4;
    let corners = [at(0, 0), at(ww - 1, 0), at(0, hh - 1), at(ww - 1, hh - 1)];
    let d = |i: usize, j: usize| (data[i] as i32 - data[j] as i32).abs();
    let near = |i: usize, j: usize| {
        (data[i + 3] < 16 && data[j + 3] < 16)
            || (d(i, j) + d(i + 1, j + 1) + d(i + 2, j + 2) < 48 && d(i + 3, j + 3) < 48)
    };
    let bg = *corners
        .iter()
        .find(|&&i| corners.iter().filter(|&&j| near(i, j)).count() >= 3)?;
    let (mut x0, mut y0, mut x1, mut y1) = (ww, hh, 0, 0);
    let mut any = false;
    for y in 0..hh {
        for x in 0..ww {
            if near(at(x, y), bg) {
                continue;
            }
            any = true;
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y);
        }
    }
    if !any {
        return None;
    }
    // A margin of 2 % of the motif keeps its edge stitches clear of the cut.
    let m = (0.02 * (x1 - x0 + 1).max(y1 - y0 + 1) as f64).ceil() as usize;
    let (lx, ly) = (x0.saturating_sub(m), y0.saturating_sub(m));
    let (wf, hf) = (ww as f64, hh as f64);
    read_crop(Crop {
        x: lx as f64 / wf,
        y: ly as f64 / hf,
        w: ((x1 + 1 + m).min(ww) - lx) as f64 / wf,
        h: ((y1 + 1 + m).min(hh) - ly) as f64 / hf,
    })
}

/// The regions of a vector picture drawn whole (`labels` of `fw` × `fh`), cut to `c` and brought to
/// w × h (nearest pixel).
pub fn cut_labels(
    labels: &[u8],
    fw: usize,
    fh: usize,
    c: Option<Crop>,
    w: usize,
    h: usize,
) -> Vec<u8> {
    let k = crop_of(c);
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        let sy = (((k.y + ((y as f64 + 0.5) / h as f64) * k.h) * fh as f64).floor() as usize)
            .min(fh - 1);
        for x in 0..w {
            let sx = (((k.x + ((x as f64 + 0.5) / w as f64) * k.w) * fw as f64).floor() as usize)
                .min(fw - 1);
            out[y * w + x] = labels[sy * fw + sx];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_rejects() {
        assert_eq!(
            read_crop(Crop {
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0
            }),
            None
        );
        assert_eq!(
            read_crop(Crop {
                x: f64::NAN,
                y: 0.0,
                w: 1.0,
                h: 1.0
            }),
            None
        );
        let c = read_crop(Crop {
            x: 0.5,
            y: 0.2,
            w: 0.9,
            h: 0.001,
        })
        .unwrap();
        assert_eq!((c.x, c.y, c.w, c.h), (0.5, 0.2, 0.5, MIN_CROP));
    }

    #[test]
    fn drags_and_finds_handles() {
        let c = Crop {
            x: 0.2,
            y: 0.2,
            w: 0.5,
            h: 0.5,
        };
        let d = drag_crop(c, CropHandle::Se, 0.1, 0.1);
        assert!((d.w - 0.6).abs() < 1e-12 && (d.h - 0.6).abs() < 1e-12);
        assert_eq!(drag_crop(c, CropHandle::Move, 1.0, 0.0).x, 0.5);
        assert_eq!(
            crop_handle_at(c, 0.2, 0.2, 0.01, 0.01),
            Some(CropHandle::Nw)
        );
        assert_eq!(crop_handle_at(c, 0.4, 0.7, 0.01, 0.01), Some(CropHandle::S));
        assert_eq!(
            crop_handle_at(c, 0.4, 0.4, 0.01, 0.01),
            Some(CropHandle::Move)
        );
        assert_eq!(crop_handle_at(FULL, 0.4, 0.4, 0.01, 0.01), None);
    }

    #[test]
    fn pixels_of_a_cut() {
        assert_eq!(
            crop_pixels(
                Some(Crop {
                    x: 0.25,
                    y: 0.5,
                    w: 0.5,
                    h: 0.5
                }),
                100,
                10
            ),
            [25, 5, 50, 5]
        );
        assert_eq!(crop_pixels(None, 7, 3), [0, 0, 7, 3]);
    }

    #[test]
    fn content_around_a_motif() {
        let (w, h) = (100, 50);
        let mut data = [255u8, 255, 255, 255].repeat(w * h);
        for y in 10..20 {
            for x in 40..60 {
                data[(y * w + x) * 4..(y * w + x) * 4 + 3].copy_from_slice(&[200, 0, 0]);
            }
        }
        let c = content_crop(&data, w, h).unwrap();
        assert_eq!((c.x, c.y), (0.39, 0.18));
        assert!((c.w - 0.22).abs() < 1e-12 && (c.h - 0.24).abs() < 1e-12);
    }

    #[test]
    fn cuts_labels() {
        let full: Vec<u8> = (0..16).collect();
        assert_eq!(
            cut_labels(
                &full,
                4,
                4,
                Some(Crop {
                    x: 0.5,
                    y: 0.5,
                    w: 0.5,
                    h: 0.5
                }),
                2,
                2
            ),
            vec![10, 11, 14, 15]
        );
    }
}
