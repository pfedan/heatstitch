//! Melco EXP (src/parsers/exp.ts): two bytes per stitch, 0x80 introduces a command. EXP stores
//! no colors.

use crate::pattern::{COLOR_CHANGE, JUMP, STITCH, TRIM};

use super::palettes::default_color;
use super::read::{Builder, Parsed, signed8};

pub fn parse_exp(data: &[u8], file_name: &str) -> Result<Parsed, String> {
    let mut b = Builder::new();
    let mut blocks = 1;
    let mut i = 0;
    while i + 1 < data.len() {
        let (b0, b1) = (data[i], data[i + 1]);
        i += 2;
        if b0 != 0x80 {
            b.add(signed8(b0), -signed8(b1), STITCH);
            continue;
        }
        if i + 1 >= data.len() {
            break;
        }
        let dx = signed8(data[i]);
        let dy = -signed8(data[i + 1]);
        i += 2;
        match b1 {
            0x80 => b.mark(TRIM),
            0x02 => b.add(dx, dy, STITCH),
            0x04 => b.add(dx, dy, JUMP),
            0x01 => {
                b.mark(COLOR_CHANGE);
                if dx != 0 || dy != 0 {
                    b.add(dx, dy, JUMP);
                }
                blocks += 1;
            }
            _ => break,
        }
    }
    Ok(Parsed {
        name: file_name.to_string(),
        format: "exp",
        records: b.build((0..blocks).map(default_color).collect()),
        hoop: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_stitches_and_commands() {
        let p = parse_exp(
            &[
                10, 0xf6, 0x80, 0x80, 7, 0, 0x80, 0x04, 5, 0, 0x80, 0x01, 0, 0, 1, 1,
            ],
            "a",
        )
        .unwrap();
        assert_eq!(
            p.records.cmd,
            vec![STITCH, TRIM, JUMP, COLOR_CHANGE, STITCH]
        );
        assert_eq!(p.records.x, vec![10, 10, 15, 15, 16]);
        assert_eq!(p.records.y, vec![10, 10, 10, 10, 9]);
        assert_eq!(p.records.colors.len(), 2);
    }
}
