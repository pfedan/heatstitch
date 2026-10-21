//! Melco EXP (src/writers/exp.ts): no header, two bytes per stitch, commands start with 0x80. Long
//! stitches become jumps plus one final stitch. EXP stores no colors.

use crate::pattern::{COLOR_CHANGE, END, JUMP, Records, STITCH, TRIM};

use super::bytes::{ByteWriter, split_move};

/// Largest move per EXP record and axis (signed byte).
pub const EXP_MAX_DELTA: i64 = 127;

pub fn write_exp(p: &Records) -> Vec<u8> {
    let mut out = ByteWriter::new();
    let (mut cx, mut cy) = (0i64, 0i64);
    let mv =
        |out: &mut ByteWriter, cx: &mut i64, cy: &mut i64, dx: i64, dy: i64, ctrl: Option<u8>| {
            if let Some(c) = ctrl {
                out.bytes(&[0x80, c]);
            }
            out.u8(dx);
            out.u8(-dy);
            *cx += dx;
            *cy += dy;
        };
    for i in 0..p.cmd.len() {
        let c = p.cmd[i];
        if c == END {
            break;
        }
        let (dx, dy) = (p.x[i] as i64 - cx, p.y[i] as i64 - cy);
        if c == STITCH {
            let pieces = split_move(dx, dy, EXP_MAX_DELTA);
            let last = pieces.len() - 1;
            for (k, (dx, dy)) in pieces.into_iter().enumerate() {
                mv(
                    &mut out,
                    &mut cx,
                    &mut cy,
                    dx,
                    dy,
                    (k < last).then_some(0x04),
                );
            }
        } else if c == JUMP {
            for (dx, dy) in split_move(dx, dy, EXP_MAX_DELTA) {
                mv(&mut out, &mut cx, &mut cy, dx, dy, Some(0x04));
            }
        } else if c == TRIM {
            out.bytes(&[0x80, 0x80, 0x07, 0x00]);
        } else if c == COLOR_CHANGE {
            out.bytes(&[0x80, 0x01, 0x00, 0x00]);
        }
    }
    out.buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsers::exp::parse_exp;

    #[test]
    fn long_stitches_become_jumps() {
        let p = Records {
            x: vec![300, 300],
            y: vec![0, 0],
            cmd: vec![STITCH, TRIM],
            colors: vec![],
        };
        let data = write_exp(&p);
        assert_eq!(
            data,
            vec![
                0x80, 0x04, 100, 0, 0x80, 0x04, 100, 0, 100, 0, 0x80, 0x80, 0x07, 0x00
            ]
        );
        let q = parse_exp(&data, "e").unwrap();
        assert_eq!(q.records.x.last(), Some(&300));
    }
}
