//! What the writers share (src/writers/bytes.ts): a byte buffer, splitting long moves, the header
//! label and the extents the headers describe.

use crate::parsers::read::js_round;
use crate::pattern::{Bounds, Records, STITCH};

/// Growable byte buffer, little endian unless a method says otherwise. Values are cut to their
/// low bytes as the TypeScript writers did (`v & 0xff`).
#[derive(Default)]
pub struct ByteWriter {
    pub buf: Vec<u8>,
}

impl ByteWriter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    pub fn u8(&mut self, v: i64) {
        self.buf.push(v as u8);
    }

    pub fn bytes(&mut self, values: &[u8]) {
        self.buf.extend_from_slice(values);
    }

    pub fn fill(&mut self, v: u8, count: usize) {
        self.buf.resize(self.buf.len() + count, v);
    }

    pub fn u16(&mut self, v: i64) {
        self.bytes(&(v as u16).to_le_bytes());
    }

    pub fn u24(&mut self, v: i64) {
        self.bytes(&(v as u32).to_le_bytes()[..3]);
    }

    pub fn u32(&mut self, v: i64) {
        self.bytes(&(v as u32).to_le_bytes());
    }

    pub fn f32(&mut self, v: f64) {
        self.bytes(&(v as f32).to_le_bytes());
    }

    pub fn u16be(&mut self, v: i64) {
        self.bytes(&(v as u16).to_be_bytes());
    }

    pub fn u32be(&mut self, v: i64) {
        self.bytes(&(v as u32).to_be_bytes());
    }

    /// Writes a string as single bytes; characters outside printable ASCII become '_'.
    pub fn ascii(&mut self, s: &str) {
        for c in s.chars() {
            let c = c as u32;
            self.buf
                .push(if (0x20..0x7f).contains(&c) || c == 0x0d || c == 0x1a {
                    c as u8
                } else {
                    b'_'
                });
        }
    }

    /// Overwrites `count` bytes (little endian) at `at`.
    pub fn patch(&mut self, at: usize, v: i64, count: usize) {
        self.buf[at..at + count].copy_from_slice(&(v as u32).to_le_bytes()[..count]);
    }
}

/// Splits a move into the fewest equal-ish pieces whose components stay within ±max.
/// Always returns at least one piece (a zero move stays one zero piece).
pub fn split_move(dx: i64, dy: i64, max: i64) -> Vec<(i64, i64)> {
    let n = ((dx.abs().max(dy.abs()) as f64 / max as f64).ceil() as i64).max(1);
    let (mut px, mut py) = (0, 0);
    (1..=n)
        .map(|k| {
            let x = js_round((dx * k) as f64 / n as f64) as i64;
            let y = js_round((dy * k) as f64 / n as f64) as i64;
            let piece = (x - px, y - py);
            (px, py) = (x, y);
            piece
        })
        .collect()
}

/// Design name usable in a header label: printable ASCII, at most `max` characters. The name
/// comes NFKD-normalized (by TypeScript, which has the Unicode tables), so accents drop off here.
pub fn header_label(name: &str, max: usize) -> String {
    let name = if name.is_empty() { "heatstitch" } else { name };
    name.chars()
        .filter(|c| (' '..='~').contains(c))
        .take(max)
        .collect()
}

/// Bounds of the stitches alone (of every record when there are none): the design as sewn.
pub fn stitch_extents(p: &Records) -> Bounds {
    if p.cmd.contains(&STITCH) {
        p.bounds()
    } else {
        extents(p)
    }
}

/// Bounds of every record (jumps included) and the origin, which the headers describe.
pub fn extents(p: &Records) -> Bounds {
    let mut b = Bounds::default();
    for i in 0..p.cmd.len() {
        b.min_x = b.min_x.min(p.x[i]);
        b.max_x = b.max_x.max(p.x[i]);
        b.min_y = b.min_y.min(p.y[i]);
        b.max_y = b.max_y.max(p.y[i]);
    }
    b
}

/// The records up to the first END, with the color of each block (the last one, or black, for
/// blocks without one), as every writer reads them.
pub fn block_color(p: &Records, k: usize) -> crate::pattern::ThreadColor {
    p.colors
        .get(k)
        .or(p.colors.last())
        .cloned()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_moves() {
        assert_eq!(split_move(0, 0, 121), vec![(0, 0)]);
        assert_eq!(split_move(121, -121, 121), vec![(121, -121)]);
        let pieces = split_move(300, -50, 121);
        assert_eq!(pieces.len(), 3);
        assert_eq!(pieces.iter().map(|p| p.0).sum::<i64>(), 300);
        assert_eq!(pieces.iter().map(|p| p.1).sum::<i64>(), -50);
        assert!(pieces.iter().all(|p| p.0.abs() <= 121));
    }

    #[test]
    fn labels_and_bytes() {
        assert_eq!(header_label("", 16), "heatstitch");
        assert_eq!(
            header_label("Ka\u{308}fer und mehr Text", 16),
            "Kafer und mehr T"
        );
        let mut w = ByteWriter::new();
        w.ascii("A\u{e9}\r");
        w.u16(-2);
        w.u24(0x123456);
        w.u32be(1);
        w.patch(0, 0x4241, 2);
        assert_eq!(
            w.buf,
            vec![0x41, 0x42, 0x0d, 0xfe, 0xff, 0x56, 0x34, 0x12, 0, 0, 0, 1]
        );
    }
}
