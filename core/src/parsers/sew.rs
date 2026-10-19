//! Janome SEW (src/parsers/sew.ts), the older sibling of JEF: a count and palette indices at the
//! start, two bytes per stitch from 0x1D78, 0x80 introduces a command. SEW has no trim; like
//! pyembroidery, which this follows (pystitch/pyembroidery SewReader, MIT), no cuts are guessed
//! from long moves.

use crate::pattern::{COLOR_CHANGE, JUMP, STITCH};

use super::palettes::sew_color;
use super::read::{Builder, Parsed, signed8};

/// The stitches of a SEW file start at this fixed offset, after the header.
pub const SEW_STITCH_START: usize = 0x1d78;

pub fn parse_sew(data: &[u8], file_name: &str) -> Result<Parsed, String> {
    if data.len() < SEW_STITCH_START {
        return Err("SEW: file too short".into());
    }
    let count = u16::from_le_bytes([data[0], data[1]]) as usize;
    let palette: Vec<_> = (0..count.min((SEW_STITCH_START - 2) >> 1))
        .map(|k| sew_color(u16::from_le_bytes([data[2 + 2 * k], data[3 + 2 * k]]) as u64))
        .collect();

    let mut b = Builder::new();
    let mut blocks = 1;
    let mut i = SEW_STITCH_START;
    while i + 1 < data.len() {
        let (b0, control) = (data[i], data[i + 1]);
        i += 2;
        if b0 != 0x80 {
            b.add(signed8(b0), -signed8(control), STITCH);
            continue;
        }
        if i + 1 >= data.len() {
            break;
        }
        let dx = signed8(data[i]);
        let dy = -signed8(data[i + 1]);
        i += 2;
        if control & 1 != 0 {
            b.mark(COLOR_CHANGE);
            if dx != 0 || dy != 0 {
                b.add(dx, dy, JUMP);
            }
            blocks += 1;
        } else if control == 0x02 || control == 0x04 {
            b.add(dx, dy, JUMP);
        } else if control == 0x10 {
            b.add(dx, dy, STITCH);
        } else {
            break;
        }
    }
    let colors = (0..blocks)
        .map(|k| {
            palette
                .get(k)
                .or(palette.last())
                .cloned()
                .unwrap_or_else(|| sew_color(1))
        })
        .collect();
    Ok(Parsed {
        name: file_name.to_string(),
        format: "sew",
        records: b.build(colors),
        hoop: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_colors_and_stitches() {
        let mut d = vec![0u8; SEW_STITCH_START];
        d[0] = 2;
        d[2] = 10; // Red
        d[4] = 12; // Blue
        d.extend_from_slice(&[5, 0, 0x80, 0x01, 0, 0, 0x80, 0x02, 3, 3, 1, 1]);
        let p = parse_sew(&d, "s").unwrap();
        assert_eq!(p.records.cmd, vec![STITCH, COLOR_CHANGE, JUMP, STITCH]);
        assert_eq!(p.records.colors[1].name.as_deref(), Some("Blue"));
        assert!(parse_sew(&[0; 10], "s").is_err());
    }
}
