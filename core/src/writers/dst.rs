//! Tajima DST (src/writers/dst.ts).

use crate::parsers::dst::{DST_HEADER_SIZE, DST_TRIM_JUMP_COUNT};
use crate::parsers::read::js_round;
use crate::pattern::{COLOR_CHANGE, END, JUMP, Records, STITCH, TRIM};

use super::bytes::{ByteWriter, header_label, split_move};

/// Largest move per DST record and axis (balanced ternary with weights 1 to 81).
pub const DST_MAX_DELTA: i64 = 121;

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Stitch,
    Jump,
    Color,
}

/// Balanced ternary digits for weights [1, 3, 9, 27, 81].
fn ternary(mut v: i64) -> [i64; 5] {
    assert!(v.abs() <= DST_MAX_DELTA, "DST delta out of range: {v}");
    let mut d = [0; 5];
    for digit in &mut d {
        let mut r = v.rem_euclid(3);
        if r == 2 {
            r = -1;
        }
        *digit = r;
        v = (v - r) / 3;
    }
    d
}

/// Encodes one record; dx, dy in DST orientation (y up).
pub fn encode_dst_record(dx: i64, dy: i64, kind: Kind) -> [u8; 3] {
    let x = ternary(dx);
    let y = ternary(dy);
    let mut b = [0u8, 0, 0x03];
    let mut set = |byte: usize, plus: u32, minus: u32, digit: i64| match digit {
        1 => b[byte] |= 1 << plus,
        -1 => b[byte] |= 1 << minus,
        _ => {}
    };
    // x: 1 -> b0 bits 0/1, 3 -> b1 0/1, 9 -> b0 2/3, 27 -> b1 2/3, 81 -> b2 2/3
    set(0, 0, 1, x[0]);
    set(1, 0, 1, x[1]);
    set(0, 2, 3, x[2]);
    set(1, 2, 3, x[3]);
    set(2, 2, 3, x[4]);
    // y: 1 -> b0 7/6, 3 -> b1 7/6, 9 -> b0 5/4, 27 -> b1 5/4, 81 -> b2 5/4
    set(0, 7, 6, y[0]);
    set(1, 7, 6, y[1]);
    set(0, 5, 4, y[2]);
    set(1, 5, 4, y[3]);
    set(2, 5, 4, y[4]);
    match kind {
        Kind::Jump => b[2] |= 0x80,
        Kind::Color => b[2] |= 0xc0,
        Kind::Stitch => {}
    }
    b
}

/// Size of the wobble a trim is sewn as when the move after it is too short to split (1/10 mm).
const WOBBLE: i64 = 2;

/// The DST_TRIM_JUMP_COUNT jumps a trim followed by the move (dx, dy) is written as: the move split
/// into as many equal jumps when each still moves, otherwise a wobble out and back that ends there.
/// None of them is zero.
pub fn trim_jumps(dx: i64, dy: i64) -> Vec<(i64, i64)> {
    let k = DST_TRIM_JUMP_COUNT as i64;
    let pieces = split_move(dx, dy, DST_MAX_DELTA);
    if pieces.len() as i64 >= k {
        return pieces;
    }
    if dx.abs().max(dy.abs()) >= k {
        let at = |v: i64, s: i64| js_round((v * s) as f64 / k as f64) as i64;
        let out: Vec<_> = (1..=k)
            .map(|s| (at(dx, s) - at(dx, s - 1), at(dy, s) - at(dy, s - 1)))
            .collect();
        if out.iter().all(|&(x, y)| x != 0 || y != 0) {
            return out;
        }
    }
    // Out, back across, and to the end; the sign keeps the last step from being zero.
    let w = if dx == -WOBBLE && dy == -WOBBLE {
        -WOBBLE
    } else {
        WOBBLE
    };
    vec![(w, w), (-2 * w, -2 * w), (w + dx, w + dy)]
}

struct Out {
    recs: Vec<u8>,
    cx: i64,
    cy: i64,
    records: usize,
    /// Consecutive jump records just written.
    streak: usize,
    /// Whether the last record written was a color change (or none was written yet).
    after_color: bool,
    min_x: i64,
    min_y: i64,
    max_x: i64,
    max_y: i64,
}

impl Out {
    fn emit(&mut self, dx: i64, dy: i64, kind: Kind) {
        self.recs
            .extend_from_slice(&encode_dst_record(dx, -dy, kind));
        self.cx += dx;
        self.cy += dy;
        self.records += 1;
        self.streak = if kind == Kind::Jump {
            self.streak + 1
        } else {
            0
        };
        self.after_color = kind == Kind::Color;
        self.min_x = self.min_x.min(self.cx);
        self.max_x = self.max_x.max(self.cx);
        self.min_y = self.min_y.min(self.cy);
        self.max_y = self.max_y.max(self.cy);
    }
}

/// Writes a Tajima DST file.
///
/// DST has no trim command: a run of DST_TRIM_JUMP_COUNT or more jumps means "trim" (the reader
/// turns such a run into TRIM followed by the original jumps). So a TRIM is written as nothing when
/// the jump run after it is already long enough; otherwise the move after it is split into that many
/// jumps, or, when it is too short for that, sewn as a small wobble that ends where the move does
/// (pyembroidery writes +0.2, -0.4, +0.2 mm). Never as zero-length jumps: some machines ignore those
/// (Bastidor issue 64). Trims never grow on repeated saves. Untrimmed jump runs that would reach that
/// length are merged into as few records as possible so they do not turn into trims. Long stitches
/// are split into jumps plus one final stitch (no extra needle penetrations), or into equal stitches
/// when that would need enough jumps to read as a trim. A color change moves nothing (as pyembroidery
/// writes it); a jump after it follows on its own. DST stores no thread colors.
pub fn write_dst(p: &Records, name: &str) -> Vec<u8> {
    let n = p.cmd.len();
    let (px, py) = (|i: usize| p.x[i] as i64, |i: usize| p.y[i] as i64);
    let mut o = Out {
        recs: vec![],
        cx: 0,
        cy: 0,
        records: 0,
        streak: 0,
        after_color: true,
        min_x: 0,
        min_y: 0,
        max_x: 0,
        max_y: 0,
    };
    let mut color_changes = 0;

    // End (exclusive) of the jump run starting at i.
    let run_end = |i: usize| {
        let mut j = i;
        while j < n && p.cmd[j] == JUMP {
            j += 1;
        }
        j
    };
    // Records a trimmed jump run [i, j) produces when every jump is kept as its own record(s).
    let run_records = |i: usize, j: usize, from_x: i64, from_y: i64| {
        let (mut count, mut x, mut y) = (0, from_x, from_y);
        for k in i..j {
            count += split_move(px(k) - x, py(k) - y, DST_MAX_DELTA).len();
            (x, y) = (px(k), py(k));
        }
        count
    };

    let mut trimmed = false;
    let mut i = 0;
    while i < n {
        let c = p.cmd[i];
        if c == END {
            break;
        }
        if c == STITCH {
            let pieces = split_move(px(i) - o.cx, py(i) - o.cy, DST_MAX_DELTA);
            let via_jumps = trimmed || o.streak + pieces.len() - 1 < DST_TRIM_JUMP_COUNT;
            trimmed = false;
            let last = pieces.len() - 1;
            for (k, (dx, dy)) in pieces.into_iter().enumerate() {
                o.emit(
                    dx,
                    dy,
                    if k < last && via_jumps {
                        Kind::Jump
                    } else {
                        Kind::Stitch
                    },
                );
            }
        } else if c == TRIM {
            if !trimmed {
                let mut j = i + 1;
                while j < n && p.cmd[j] == TRIM {
                    j += 1;
                }
                let end = if j < n && p.cmd[j] == JUMP {
                    run_end(j)
                } else {
                    j
                };
                let have = if end > j {
                    run_records(j, end, o.cx, o.cy)
                } else {
                    0
                };
                if have < DST_TRIM_JUMP_COUNT {
                    let (tx, ty) = if end > j {
                        (px(end - 1) - o.cx, py(end - 1) - o.cy)
                    } else {
                        (0, 0)
                    };
                    for (dx, dy) in trim_jumps(tx, ty) {
                        o.emit(dx, dy, Kind::Jump);
                    }
                    i = end - 1;
                }
                trimmed = true;
            }
        } else if c == JUMP {
            let j = run_end(i);
            if trimmed || run_records(i, j, o.cx, o.cy) < DST_TRIM_JUMP_COUNT {
                for k in i..j {
                    // A jump to where the needle already is, first in the design or in a color, or alone between
                    // stitches (a design that starts at the origin, a color that starts where the last one ended,
                    // an object led to where the one before ended), is left out: some machines skip zero-length
                    // jumps. Within a run of jumps read from a file it stays, so the file is written as it was.
                    if (o.after_color || (!trimmed && j - i == 1)) && px(k) == o.cx && py(k) == o.cy
                    {
                        continue;
                    }
                    for (dx, dy) in split_move(px(k) - o.cx, py(k) - o.cy, DST_MAX_DELTA) {
                        o.emit(dx, dy, Kind::Jump);
                    }
                }
            } else {
                for (dx, dy) in split_move(px(j - 1) - o.cx, py(j - 1) - o.cy, DST_MAX_DELTA) {
                    o.emit(dx, dy, Kind::Jump);
                }
            }
            i = j - 1;
        } else if c == COLOR_CHANGE {
            trimmed = false;
            color_changes += 1;
            o.emit(0, 0, Kind::Color);
        }
        i += 1;
    }

    let mut out = ByteWriter::new();
    let sign = |v: i64| format!("{}{:>5}", if v < 0 { '-' } else { '+' }, v.abs());
    let header = format!(
        "LA:{:<16}\rST:{:>7}\rCO:{:>3}\r+X:{:>5}\r-X:{:>5}\r+Y:{:>5}\r-Y:{:>5}\rAX:{}\rAY:{}\rMX:+    0\rMY:+    0\rPD:******\r",
        header_label(name, 16),
        o.records,
        color_changes,
        // Extents from the start point; DST y points up.
        o.max_x,
        -o.min_x,
        -o.min_y,
        o.max_y,
        sign(o.cx),
        sign(-o.cy),
    );
    out.ascii(&header);
    out.u8(0x1a);
    out.fill(0x20, DST_HEADER_SIZE.saturating_sub(out.len()));
    out.bytes(&o.recs);
    out.bytes(&[0x00, 0x00, 0xf3]);
    out.buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsers::dst::{decode_dx, decode_dy, parse_dst};

    #[test]
    fn records_round_trip() {
        for dx in -121..=121 {
            let [b0, b1, b2] = encode_dst_record(dx, -dx / 2, Kind::Stitch);
            assert_eq!(decode_dx(b0, b1, b2), dx);
            assert_eq!(decode_dy(b0, b1, b2), -dx / 2);
        }
    }

    #[test]
    fn trims_are_never_zero_jumps() {
        for (dx, dy) in [(0, 0), (1, 0), (-2, -2), (5, 0), (400, 30)] {
            let j = trim_jumps(dx, dy);
            assert!(j.len() >= 3);
            assert!(j.iter().all(|&(x, y)| x != 0 || y != 0));
            assert_eq!(j.iter().map(|p| p.0).sum::<i64>(), dx);
            assert_eq!(j.iter().map(|p| p.1).sum::<i64>(), dy);
        }
    }

    #[test]
    fn writes_what_it_reads() {
        let p = Records {
            x: vec![0, 10, 10, 60, 60, 300],
            y: vec![0, 10, 10, 10, 10, -40],
            cmd: vec![STITCH, STITCH, TRIM, JUMP, COLOR_CHANGE, STITCH],
            colors: vec![],
        };
        let data = write_dst(&p, "Name");
        assert_eq!(&data[..7], b"LA:Name");
        let q = parse_dst(&data, "x").unwrap();
        let stitches = |r: &Records| {
            (0..r.len())
                .filter(|&i| r.cmd[i] == STITCH)
                .map(|i| (r.x[i], r.y[i]))
                .collect::<Vec<_>>()
        };
        assert_eq!(stitches(&q.records), stitches(&p));
        assert_eq!(q.records.cmd.iter().filter(|&&c| c == TRIM).count(), 1);
    }
}
