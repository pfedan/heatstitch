//! The PEC thumbnails (src/writers/pecGraphics.ts): one for the whole design, then one per color
//! block, each 48 x 38 pixels at one bit per pixel.

use crate::pattern::{Bounds, COLOR_CHANGE, Records, STITCH};

pub const ICON_W: i64 = 48;
pub const ICON_H: i64 = 38;
pub const ICON_STRIDE: i64 = ICON_W / 8;

/// Sets pixel (x, y); bit order is least significant bit first, as Brother machines read it.
fn mark(g: &mut [u8], x: i64, y: i64) {
    if x < 0 || y < 0 || x >= ICON_W || y >= ICON_H {
        return;
    }
    g[(y * ICON_STRIDE + (x >> 3)) as usize] |= 1 << (x & 7);
}

fn line(g: &mut [u8], mut x0: i64, mut y0: i64, x1: i64, y1: i64) {
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    loop {
        mark(g, x0, y0);
        if x0 == x1 && y0 == y1 {
            return;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x0 += sx;
        }
        if e2 <= dx {
            err += dx;
            y0 += sy;
        }
    }
}

/// Empty icon with a rounded frame, like the ones Brother software writes. The first row stays
/// empty: it follows the 0xFF end marker directly, and readers such as pyembroidery only stop at
/// the byte pair FF 00.
fn framed() -> Vec<u8> {
    let mut g = vec![0u8; (ICON_STRIDE * ICON_H) as usize];
    let r = ICON_W - 2;
    let b = ICON_H - 2;
    line(&mut g, 4, 1, r - 3, 1);
    line(&mut g, 4, b, r - 3, b);
    line(&mut g, 1, 4, 1, b - 3);
    line(&mut g, r, 4, r, b - 3);
    for (x, y) in [(2, 3), (3, 2)] {
        mark(&mut g, x, y);
        mark(&mut g, ICON_W - 1 - x, y);
        mark(&mut g, x, ICON_H - 1 - y);
        mark(&mut g, ICON_W - 1 - x, ICON_H - 1 - y);
    }
    g
}

/// The thumbnails of the design; stitches are drawn as lines, scaled into the frame.
pub fn pec_icons(p: &Records, b: Bounds, blocks: usize) -> Vec<Vec<u8>> {
    let pad = 5.0;
    let w = ((b.max_x as i64 - b.min_x as i64) as f64).max(1.0);
    let h = ((b.max_y as i64 - b.min_y as i64) as f64).max(1.0);
    let scale = ((ICON_W as f64 - 2.0 * pad - 1.0) / w).min((ICON_H as f64 - 2.0 * pad - 1.0) / h);
    let ox = ICON_W as f64 / 2.0 - ((b.min_x as f64 + b.max_x as f64) / 2.0) * scale;
    let oy = ICON_H as f64 / 2.0 - ((b.min_y as f64 + b.max_y as f64) / 2.0) * scale;
    let px = |x: i32| (x as f64 * scale + ox).floor() as i64;
    let py = |y: i32| (y as f64 * scale + oy).floor() as i64;

    let mut all = framed();
    let mut per_block: Vec<Vec<u8>> = (0..blocks).map(|_| framed()).collect();
    let mut block = 0;
    for i in 0..p.cmd.len() {
        let c = p.cmd[i];
        if c == COLOR_CHANGE {
            block = (block + 1).min(blocks - 1);
        }
        if c != STITCH {
            continue;
        }
        let (x1, y1) = (px(p.x[i]), py(p.y[i]));
        let (x0, y0) = if i > 0 && p.cmd[i - 1] == STITCH {
            (px(p.x[i - 1]), py(p.y[i - 1]))
        } else {
            (x1, y1)
        };
        line(&mut all, x0, y0, x1, y1);
        line(&mut per_block[block], x0, y0, x1, y1);
    }
    let mut out = vec![all];
    out.append(&mut per_block);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_and_draws() {
        let p = Records {
            x: vec![0, 100],
            y: vec![0, 100],
            cmd: vec![STITCH, STITCH],
            colors: vec![],
        };
        let icons = pec_icons(&p, p.bounds(), 1);
        assert_eq!(icons.len(), 2);
        assert_eq!(icons[0].len(), 6 * 38);
        // The first row stays empty, the diagonal crosses the middle.
        assert!(icons[0][..6].iter().all(|&v| v == 0));
        assert_ne!(icons[0][19 * 6 + 3], 0);
        assert_eq!(icons[0], icons[1]);
    }
}
