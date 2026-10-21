//! Singer XXX (src/writers/xxx.ts).

use crate::pattern::{COLOR_CHANGE, END, JUMP, Records, STITCH, TRIM};

use super::bytes::{ByteWriter, block_color, extents, split_move};

/// Largest jump per record and axis (0.1 mm). The format allows more, but a Singer Superb EM200
/// loses the excess of longer jumps and the design drifts; factory designs stay within about 8 mm.
pub const XXX_MAX_JUMP: i64 = 80;
/// Largest stitch per record and axis. From 124 on a stitch needs the 16-bit 0x7D record, which older firmwares do not know.
pub const XXX_MAX_STITCH: i64 = 123;

struct Recs {
    out: ByteWriter,
    records: i64,
    cx: i64,
    cy: i64,
}

impl Recs {
    fn stitch(&mut self, dx: i64, dy: i64) {
        self.out.bytes(&[dx as u8, (-dy) as u8]);
        self.records += 1;
        self.cx += dx;
        self.cy += dy;
    }

    fn command(&mut self, code: u8, dx: i64, dy: i64) {
        self.out.bytes(&[0x7f, code, dx as u8, (-dy) as u8]);
        self.records += 1;
        self.cx += dx;
        self.cy += dy;
    }
}

/// Writes a Singer XXX file, after pystitch/pyembroidery's XxxWriter (MIT): a 256-byte header, two
/// bytes per stitch, 7F 01 jump, 7F 03 cut, 7F 08 color change, 7F 7F 02 14 end, then the thread
/// colors as RGB. Unlike pyembroidery it never writes the long 0x7D record: long stitches become
/// equal stitches and long jumps equal jumps within what the machines follow. After a cut the way
/// to the next stitch is jumps.
pub fn write_xxx(p: &Records) -> Vec<u8> {
    let mut r = Recs {
        out: ByteWriter::new(),
        records: 0,
        cx: 0,
        cy: 0,
    };
    let mut blocks = 1;
    // Nothing is sewn yet: the way to the first stitch is jumps, not a stitch from the origin.
    let mut cut = true;
    for i in 0..p.cmd.len() {
        let c = p.cmd[i];
        if c == END {
            break;
        }
        let dx = p.x[i] as i64 - r.cx;
        let dy = p.y[i] as i64 - r.cy;
        if c == STITCH {
            if cut && dx.abs().max(dy.abs()) > XXX_MAX_STITCH {
                let pieces = split_move(dx, dy, XXX_MAX_JUMP);
                let last = pieces.len() - 1;
                for (k, (x, y)) in pieces.into_iter().enumerate() {
                    if k < last {
                        r.command(0x01, x, y)
                    } else {
                        r.stitch(x, y)
                    }
                }
            } else {
                for (x, y) in split_move(dx, dy, XXX_MAX_STITCH) {
                    r.stitch(x, y);
                }
            }
            cut = false;
        } else if c == JUMP {
            for (x, y) in split_move(dx, dy, XXX_MAX_JUMP) {
                r.command(0x01, x, y);
            }
        } else if c == TRIM {
            r.command(0x03, 0, 0);
            cut = true;
        } else if c == COLOR_CHANGE {
            r.command(0x08, 0, 0);
            blocks += 1;
            cut = true;
        }
    }

    let b = extents(p);
    let mut out = ByteWriter::new();
    out.fill(0, 0x17);
    out.u32(r.records);
    out.fill(0, 0x0c);
    out.u32(blocks as i64);
    out.u16(0);
    out.u16(b.max_x as i64 - b.min_x as i64);
    out.u16(b.max_y as i64 - b.min_y as i64);
    out.u16(r.cx);
    out.u16(-r.cy);
    out.u16(-(b.min_x as i64));
    out.u16(b.max_y as i64);
    out.fill(0, 0x42 + 4 + 0x73);
    out.u16(0x20);
    out.fill(0, 8);
    out.u32(0x100 + r.out.len() as i64); // end of the stitches
    out.bytes(&r.out.buf);
    out.bytes(&[0x7f, 0x7f, 0x02, 0x14, 0x00, 0x00]);
    for k in 0..blocks {
        let t = block_color(p, k);
        out.bytes(&[0, t.r, t.g, t.b]);
    }
    out.fill(0, 4 * 21usize.saturating_sub(blocks));
    out.u32(0xffffff00);
    out.bytes(&[0x00, 0x01]);
    out.buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsers::xxx::parse_xxx;
    use crate::pattern::ThreadColor;

    #[test]
    fn round_trip_without_long_records() {
        let p = Records {
            x: vec![500, 520, 520, 900],
            y: vec![0, 0, 0, 30],
            cmd: vec![STITCH, STITCH, COLOR_CHANGE, STITCH],
            colors: vec![
                ThreadColor {
                    r: 9,
                    ..Default::default()
                },
                ThreadColor {
                    g: 8,
                    ..Default::default()
                },
            ],
        };
        let data = write_xxx(&p);
        assert!(!data[0x100..].contains(&0x7d));
        let q = parse_xxx(&data, "x").unwrap();
        let stitches = |r: &Records| {
            (0..r.len())
                .filter(|&i| r.cmd[i] == STITCH)
                .map(|i| (r.x[i], r.y[i]))
                .collect::<Vec<_>>()
        };
        assert_eq!(stitches(&q.records), stitches(&p));
        assert_eq!((q.records.colors[0].r, q.records.colors[1].g), (9, 8));
    }
}
