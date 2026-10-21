//! Pfaff / Husqvarna Viking VP3 (src/writers/vp3.ts). Big endian.

use crate::js::round;
use crate::pattern::{COLOR_CHANGE, END, Records, STITCH, TRIM};

use super::bytes::{ByteWriter, block_color, extents};

const PRODUCER: &str = "Produced by     Software Ltd";

impl ByteWriter {
    fn string16(&mut self, s: &str) {
        let units: Vec<u16> = s.encode_utf16().collect();
        self.u16be(units.len() as i64 * 2);
        for u in units {
            self.u16be(u as i64);
        }
    }

    fn string8(&mut self, s: &str) {
        self.u16be(s.len() as i64);
        self.bytes(s.as_bytes());
    }

    /// Reserves a 32-bit length to be filled by `close`.
    fn open(&mut self) -> usize {
        let at = self.len();
        self.u32be(0);
        at
    }

    /// Writes the distance from after the reserved length to here.
    fn close(&mut self, at: usize) {
        let v = (self.len() - at - 4) as u32;
        self.buf[at..at + 4].copy_from_slice(&v.to_be_bytes());
    }
}

/// Writes a Pfaff / Husqvarna Viking VP3 file. VP3 has no jumps: each color block starts at its
/// first stitch, a move inside a block is a (long) stitch, after a trim it is the first stitch at
/// the new place. Thread colors are stored exactly, with brand and catalog number when known.
pub fn write_vp3(p: &Records) -> Vec<u8> {
    let n = p.cmd.len();
    // Color blocks as [from, to) record ranges.
    let mut blocks: Vec<(usize, usize)> = vec![];
    let mut from = 0;
    for i in 0..=n {
        if i == n || p.cmd[i] == COLOR_CHANGE || p.cmd[i] == END {
            blocks.push((from, i));
            if i == n || p.cmd[i] == END {
                break;
            }
            from = i + 1;
        }
    }
    let b = extents(p);
    let (min_x, min_y, max_x, max_y) = (
        b.min_x as i64,
        b.min_y as i64,
        b.max_x as i64,
        b.max_y as i64,
    );
    // Header positions are in 0.001 mm with y up; 0.1 mm values times 100.
    let cx100 = (min_x + max_x) * 50;
    let cy100 = (min_y + max_y) * 50;
    let w = max_x - min_x;
    let h = max_y - min_y;
    let records = p.cmd.iter().take_while(|&&c| c != END).count() as i64;
    let half = |v: i64| round(v as f64 / 2.0) as i64 * 100;

    let mut out = ByteWriter::new();
    out.ascii("%vsm%");
    out.u8(0);
    out.string16(PRODUCER);
    out.bytes(&[0x00, 0x02, 0x00]);
    let file_at = out.open();
    out.string16("");
    out.u32be(max_x * 100);
    out.u32be(-min_y * 100);
    out.u32be(min_x * 100);
    out.u32be(-max_y * 100);
    out.u32be(records);
    out.bytes(&[0, blocks.len() as u8, 12, 0, 1]);

    out.bytes(&[0x00, 0x03, 0x00]);
    let design_at = out.open();
    out.u32be(cx100);
    out.u32be(-cy100);
    out.bytes(&[0, 0, 0]);
    out.u32be(-half(w));
    out.u32be(half(w));
    out.u32be(-half(h));
    out.u32be(half(h));
    out.u32be(w * 100);
    out.u32be(h * 100);
    out.string16("");
    out.bytes(&[0x64, 0x64]);
    out.u32be(4096);
    out.u32be(0);
    out.u32be(0);
    out.u32be(4096);
    out.ascii("xxPP");
    out.bytes(&[0x01, 0x00]);
    out.string16(PRODUCER);
    out.u16be(blocks.len() as i64);

    let (mut last_x, mut last_y) = (0i64, 0i64);
    for (k, &(from, to)) in blocks.iter().enumerate() {
        let stitches: Vec<usize> = (from..to).filter(|&i| p.cmd[i] == STITCH).collect();
        let at = |i: usize| (p.x[i] as i64, p.y[i] as i64);
        // pyembroidery (and with it Ink/Stitch) ignores a block start with x or y exactly 0; one step
        // aside, the first stitch still lands in place.
        let (fx, fy) = stitches.first().map_or((last_x, last_y), |&i| at(i));
        let (sx, sy) = (if fx == 0 { 1 } else { fx }, if fy == 0 { 1 } else { fy });
        let (ex, ey) = stitches.last().map_or((sx, sy), |&i| at(i));
        let (mut x, mut y) = (sx, sy);
        out.bytes(&[0x00, 0x05, 0x00]);
        let block_at = out.open();
        out.u32be(sx * 100 - cx100);
        out.u32be(-(sy * 100 - cy100));
        let c = block_color(p, k);
        out.bytes(&[0x01, 0x00, c.r, c.g, c.b, 0x00, 0x00, 0x00, 0x05, 0x28]);
        out.string8(c.catalog.as_deref().unwrap_or(""));
        let hex = format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b);
        out.string8(c.name.as_deref().unwrap_or(&hex));
        out.string8(c.brand.as_deref().unwrap_or(""));
        out.u32be((ex - sx) * 100);
        out.u32be(-(ey - sy) * 100);
        out.bytes(&[0x00, 0x01, 0x00]);
        let stitches_at = out.open();
        out.bytes(&[0x0a, 0xf6, 0x00]);
        let mut trimmed = false;
        for i in from..to {
            let cmd = p.cmd[i];
            if cmd == TRIM {
                if !trimmed {
                    out.bytes(&[0x80, 0x03]);
                }
                trimmed = true;
            } else if cmd == STITCH {
                let (px, py) = at(i);
                let (dx, dy) = (px - x, py - y);
                if dx.abs() <= 127 && dy.abs() <= 127 {
                    out.u8(dx);
                    out.u8(dy);
                } else {
                    out.bytes(&[0x80, 0x01]);
                    out.u16be(dx);
                    out.u16be(dy);
                    out.bytes(&[0x80, 0x02]);
                }
                (x, y) = (px, py);
                trimmed = false;
            }
        }
        // The machine cuts before the next color only when told so.
        if !trimmed {
            out.bytes(&[0x80, 0x03]);
        }
        out.close(stitches_at);
        out.u8(0);
        out.close(block_at);
        (last_x, last_y) = (ex, ey);
    }
    out.close(design_at);
    out.close(file_at);
    out.buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsers::vp3::parse_vp3;
    use crate::pattern::{JUMP, ThreadColor};

    #[test]
    fn round_trip_keeps_stitches_and_threads() {
        let thread = ThreadColor {
            r: 10,
            g: 20,
            b: 30,
            name: Some("Navy".into()),
            brand: Some("Brand".into()),
            catalog: Some("123".into()),
            pec_index: None,
        };
        let p = Records {
            x: vec![10, 50, 50, 400, 400, 410],
            y: vec![10, 20, 20, 20, 20, 30],
            cmd: vec![STITCH, STITCH, TRIM, STITCH, COLOR_CHANGE, STITCH],
            colors: vec![
                thread.clone(),
                ThreadColor {
                    r: 255,
                    ..Default::default()
                },
            ],
        };
        let q = parse_vp3(&write_vp3(&p), "v").unwrap();
        let stitches = |r: &Records| {
            (0..r.len())
                .filter(|&i| r.cmd[i] == STITCH)
                .map(|i| (r.x[i], r.y[i]))
                .collect::<Vec<_>>()
        };
        assert_eq!(stitches(&q.records), stitches(&p));
        assert_eq!(q.records.colors[0], thread);
        assert_eq!(q.records.colors[1].name.as_deref(), Some("#ff0000"));
        assert!(q.records.cmd.contains(&JUMP));
    }
}
