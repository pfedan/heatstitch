//! A window of a design (crop in src/correct/plan.ts): the stitches inside a box only, so a part of
//! a design can be measured quickly.

use crate::pattern::{Records, STITCH, TRIM};

/// The stitches of `p` inside `[x0, y0, x1, y1]` (0.1 mm), with their own records. Thread leaving
/// the window is cut there (a trim); `skip` follows the records.
pub fn crop(p: &Records, b: [f64; 4], skip: Option<&[u8]>) -> (Records, Vec<u8>) {
    let [x0, y0, x1, y1] = b;
    let mut out = Records::default();
    let mut sk = vec![];
    let mut cut = true;
    for i in 0..p.cmd.len() {
        if p.cmd[i] != STITCH {
            cut = true;
            continue;
        }
        let (x, y) = (p.x[i], p.y[i]);
        let (fx, fy) = (x as f64, y as f64);
        if fx < x0 || fx > x1 || fy < y0 || fy > y1 {
            cut = true;
            continue;
        }
        if cut && !out.x.is_empty() {
            out.x.push(x);
            out.y.push(y);
            out.cmd.push(TRIM);
            sk.push(0);
        }
        out.x.push(x);
        out.y.push(y);
        out.cmd.push(STITCH);
        sk.push(skip.map_or(0, |s| s[i]));
        cut = false;
    }
    (out, sk)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaving_the_window_trims() {
        let p = Records {
            x: vec![0, 10, 100, 20, 30],
            y: vec![0; 5],
            cmd: vec![STITCH; 5],
            colors: vec![],
        };
        let (c, _) = crop(&p, [0.0, -5.0, 50.0, 5.0], None);
        assert_eq!(c.cmd, vec![STITCH, STITCH, TRIM, STITCH, STITCH]);
        assert_eq!(c.x, vec![0, 10, 20, 20, 30]);
    }
}
