//! Singer XXX (src/parsers/xxx.ts). Two bytes per stitch; 0x7F introduces a four-byte command (01
//! jump, 03 cut plus an optional move, 08 or 0A..17 color change, 7F or 18 end), 0x7D a long
//! stitch with 16-bit deltas. After the end come the thread colors as RGB. Follows
//! pystitch/pyembroidery's XxxReader (MIT), except that 0x7D is read as the stitch pyembroidery's
//! own writer means by it, not as a jump.

use crate::pattern::{COLOR_CHANGE, JUMP, STITCH, TRIM, ThreadColor};

use super::palettes::default_color;
use super::read::{Builder, Parsed, signed8};

/// The stitches of an XXX file start here, after the 256-byte header.
pub const XXX_STITCH_START: usize = 0x100;

fn signed16(lo: u8, hi: u8) -> i64 {
    i16::from_le_bytes([lo, hi]) as i64
}

pub fn parse_xxx(data: &[u8], file_name: &str) -> Result<Parsed, String> {
    if data.len() < XXX_STITCH_START {
        return Err("XXX: file too short".into());
    }
    let count = u16::from_le_bytes([data[0x27], data[0x28]]) as usize;
    let mut b = Builder::new();
    let mut blocks = 1;
    let mut i = XXX_STITCH_START;
    let mut ended = false;
    while i + 1 < data.len() {
        let b1 = data[i];
        if b1 == 0x7d || b1 == 0x7e {
            if i + 4 >= data.len() {
                break;
            }
            let dx = signed16(data[i + 1], data[i + 2]);
            let dy = -signed16(data[i + 3], data[i + 4]);
            i += 5;
            b.add(dx, dy, if b1 == 0x7d { STITCH } else { JUMP });
            continue;
        }
        let b2 = data[i + 1];
        i += 2;
        if b1 != 0x7f {
            b.add(signed8(b1), -signed8(b2), STITCH);
            continue;
        }
        if i + 1 >= data.len() {
            break;
        }
        let dx = signed8(data[i]);
        let dy = -signed8(data[i + 1]);
        i += 2;
        match b2 {
            0x01 => b.add(dx, dy, JUMP),
            0x03 => {
                b.mark(TRIM);
                if dx != 0 || dy != 0 {
                    b.add(dx, dy, JUMP);
                }
            }
            0x08 | 0x0a..=0x17 => {
                b.mark(COLOR_CHANGE);
                if dx != 0 || dy != 0 {
                    b.add(dx, dy, JUMP);
                }
                blocks += 1;
            }
            0x7f | 0x18 => {
                ended = true;
                break;
            }
            // Other commands are unknown; pyembroidery skips them too.
            _ => {}
        }
    }

    // Two bytes after the end record, then one 00 RR GG BB entry per thread.
    let mut palette: Vec<ThreadColor> = vec![];
    let mut at = i + 2;
    while ended && palette.len() < count && at + 3 < data.len() {
        palette.push(ThreadColor {
            r: data[at + 1],
            g: data[at + 2],
            b: data[at + 3],
            ..Default::default()
        });
        at += 4;
    }
    let colors = (0..blocks)
        .map(|k| palette.get(k).cloned().unwrap_or_else(|| default_color(k)))
        .collect();
    Ok(Parsed {
        name: file_name.to_string(),
        format: "xxx",
        records: b.build(colors),
        hoop: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_records_and_colors() {
        let mut d = vec![0u8; XXX_STITCH_START];
        d[0x27] = 2;
        d.extend_from_slice(&[
            5, 0, 0x7f, 0x03, 0, 0, 0x7d, 0x2c, 0x01, 0, 0, 0x7f, 0x08, 0, 0, 1, 1,
        ]);
        d.extend_from_slice(&[0x7f, 0x7f, 0x02, 0x14, 0, 0, 0, 1, 2, 3, 0, 4, 5, 6]);
        let p = parse_xxx(&d, "x").unwrap();
        assert_eq!(
            p.records.cmd,
            vec![STITCH, TRIM, STITCH, COLOR_CHANGE, STITCH]
        );
        assert_eq!(p.records.x, vec![5, 5, 305, 305, 306]);
        assert_eq!((p.records.colors[1].r, p.records.colors[1].b), (4, 6));
    }
}
