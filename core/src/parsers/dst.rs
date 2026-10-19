//! Tajima DST (src/parsers/dst.ts): a 512-byte header, three bytes per record in balanced ternary.

use crate::pattern::{COLOR_CHANGE, JUMP, STITCH, TRIM};

use super::palettes::default_color;
use super::read::{Builder, Parsed, insert_before, js_trim, latin1};

pub const DST_HEADER_SIZE: usize = 512;
/// A run of at least this many consecutive jumps is interpreted as a trim (same default as pyembroidery).
pub const DST_TRIM_JUMP_COUNT: usize = 3;

fn bit(b: u8, n: u32) -> i64 {
    ((b >> n) & 1) as i64
}

pub fn decode_dx(b0: u8, b1: u8, b2: u8) -> i64 {
    bit(b2, 2) * 81 - bit(b2, 3) * 81 + bit(b1, 2) * 27 - bit(b1, 3) * 27 + bit(b0, 2) * 9
        - bit(b0, 3) * 9
        + bit(b1, 0) * 3
        - bit(b1, 1) * 3
        + bit(b0, 0)
        - bit(b0, 1)
}

/// Returns dy in DST orientation (y up).
pub fn decode_dy(b0: u8, b1: u8, b2: u8) -> i64 {
    bit(b2, 5) * 81 - bit(b2, 4) * 81 + bit(b1, 5) * 27 - bit(b1, 4) * 27 + bit(b0, 5) * 9
        - bit(b0, 4) * 9
        + bit(b1, 7) * 3
        - bit(b1, 6) * 3
        + bit(b0, 7)
        - bit(b0, 6)
}

/// The "LA:" label of the header, up to the end of its line.
fn read_label(data: &[u8]) -> String {
    let head = &data[..data.len().min(DST_HEADER_SIZE)];
    let Some(at) = head.windows(3).position(|w| w == b"LA:") else {
        return String::new();
    };
    let rest = &head[at + 3..];
    let end = rest
        .iter()
        .position(|&b| b == b'\r' || b == b'\n' || b == 0x1a)
        .unwrap_or(rest.len());
    js_trim(&latin1(&rest[..end]))
}

pub fn parse_dst(data: &[u8], file_name: &str) -> Result<Parsed, String> {
    if data.len() < DST_HEADER_SIZE {
        return Err("DST: file too short".into());
    }
    let mut b = Builder::new();
    let mut jump_run = 0;
    let mut jump_run_start = 0;
    let mut blocks = 1;
    let mut sequin_mode = false;
    // Trims are inferred afterwards: we remember where each jump run started.
    let mut trim_at = vec![];
    let mut i = DST_HEADER_SIZE;
    while i + 2 < data.len() {
        let (b0, b1, b2) = (data[i], data[i + 1], data[i + 2]);
        i += 3;
        let dx = decode_dx(b0, b1, b2);
        let dy = -decode_dy(b0, b1, b2);
        if b2 & 0xf3 == 0xf3 {
            break;
        }
        if b2 & 0xc3 == 0xc3 {
            if jump_run >= DST_TRIM_JUMP_COUNT {
                trim_at.push(jump_run_start);
            }
            jump_run = 0;
            b.mark(COLOR_CHANGE);
            if dx != 0 || dy != 0 {
                b.add(dx, dy, JUMP);
            }
            blocks += 1;
        } else if b2 & 0x43 == 0x43 {
            // Sequin mode toggle; does not move.
            sequin_mode = !sequin_mode;
        } else if b2 & 0x83 == 0x83 {
            if jump_run == 0 {
                jump_run_start = b.len();
            }
            jump_run += 1;
            b.add(dx, dy, if sequin_mode { STITCH } else { JUMP });
        } else {
            if jump_run >= DST_TRIM_JUMP_COUNT {
                trim_at.push(jump_run_start);
            }
            jump_run = 0;
            b.add(dx, dy, STITCH);
        }
    }
    if jump_run >= DST_TRIM_JUMP_COUNT {
        trim_at.push(jump_run_start);
    }
    let mut records = b.build((0..blocks).map(default_color).collect());
    if !trim_at.is_empty() {
        insert_before(&mut records, &trim_at, TRIM);
    }
    let label = read_label(data);
    Ok(Parsed {
        name: if label.is_empty() {
            file_name.to_string()
        } else {
            label
        },
        format: "dst",
        records,
        hoop: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(records: &[[u8; 3]]) -> Vec<u8> {
        let mut d = b"LA:Test  \r".to_vec();
        d.resize(DST_HEADER_SIZE, b' ');
        for r in records {
            d.extend_from_slice(r);
        }
        d.extend_from_slice(&[0, 0, 0xf3]);
        d
    }

    #[test]
    fn decodes_ternary() {
        // +1 in x (b0 bit 0), +1 in y (b0 bit 7).
        assert_eq!(decode_dx(0x01, 0, 0x03), 1);
        assert_eq!(decode_dy(0x80, 0, 0x03), 1);
        assert_eq!(decode_dx(0x04, 0x04, 0x07), 9 + 27 + 81);
    }

    #[test]
    fn three_jumps_are_a_trim() {
        let p = parse_dst(
            &file(&[
                [1, 0, 3],
                [1, 0, 0x83],
                [1, 0, 0x83],
                [1, 0, 0x83],
                [1, 0, 3],
            ]),
            "x",
        )
        .unwrap();
        assert_eq!(p.name, "Test");
        assert_eq!(p.records.cmd, vec![STITCH, TRIM, JUMP, JUMP, JUMP, STITCH]);
        assert_eq!(p.records.x, vec![1, 1, 2, 3, 4, 5]);
        assert_eq!(p.records.colors.len(), 1);
    }

    #[test]
    fn color_changes_add_blocks() {
        let p = parse_dst(&file(&[[1, 0, 3], [0, 0, 0xc3], [1, 0, 3]]), "x").unwrap();
        assert_eq!(p.records.cmd, vec![STITCH, COLOR_CHANGE, STITCH]);
        assert_eq!(p.records.colors.len(), 2);
        assert!(parse_dst(&[0; 10], "x").is_err());
    }
}
