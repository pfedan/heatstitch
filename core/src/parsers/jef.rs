//! Janome JEF (src/parsers/jef.ts). Colors are palette indices; index 0 is a stop (the same
//! thread again).

use crate::pattern::{COLOR_CHANGE, Hoop, JUMP, STITCH, TRIM, ThreadColor};

use super::palettes::jef_color;
use super::read::{Builder, Parsed, insert_before, signed8};

/// JEF has no trim command: a zero-length jump is a cut (heatstitch, pyembroidery and Ink/Stitch
/// write three), and so is a move longer than this (0.1 mm, either axis), as pyembroidery reads it.
pub const JEF_TRIM_DISTANCE: i64 = 30;

fn u32_at(d: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([d[i], d[i + 1], d[i + 2], d[i + 3]])
}

pub fn parse_jef(data: &[u8], file_name: &str) -> Result<Parsed, String> {
    if data.len() < 0x74 {
        return Err("JEF: file too short".into());
    }
    let start = u32_at(data, 0) as u64;
    let count = u32_at(data, 24) as i32 as i64;
    if count < 0 || start > data.len() as u64 || 0x74 + count * 4 > data.len() as i64 {
        return Err("JEF: bad header".into());
    }
    let mut palette: Vec<ThreadColor> = vec![];
    for k in 0..count as usize {
        let index = (u32_at(data, 0x74 + k * 4) as i32 as i64).unsigned_abs();
        let c = match palette.last() {
            Some(last) if index == 0 => last.clone(),
            _ => jef_color(if index == 0 { 1 } else { index }),
        };
        palette.push(c);
    }

    // Janome hoop codes: 0 = 110 x 110 (listed as 100 x 100), 1 = 50 x 50, 2 = 140 x 200, 3 = 126 x 110, 4 = 200 x 200.
    let hoops = [
        (100.0, 100.0),
        (50.0, 50.0),
        (140.0, 200.0),
        (126.0, 110.0),
        (200.0, 200.0),
    ];
    let hoop = usize::try_from(u32_at(data, 32) as i32)
        .ok()
        .and_then(|k| hoops.get(k))
        .map(|&(w, h)| Hoop { w, h });

    let mut b = Builder::new();
    let mut blocks = 1;
    // Moves since the last stitch, to decide where a cut goes.
    let mut run_start: Option<usize> = None;
    let (mut run_dx, mut run_dy) = (0i64, 0i64);
    let mut cut = true;
    let mut trim_at = vec![];
    let mut i = start as usize;
    while i + 1 < data.len() {
        let (b0, b1) = (data[i], data[i + 1]);
        i += 2;
        if b0 != 0x80 {
            b.add(signed8(b0), -signed8(b1), STITCH);
            run_start = None;
            cut = false;
            continue;
        }
        if i + 1 >= data.len() || b1 == 0x10 {
            break;
        }
        let dx = signed8(data[i]);
        let dy = -signed8(data[i + 1]);
        i += 2;
        if b1 == 0x02 && dx == 0 && dy == 0 {
            if !cut {
                trim_at.push(b.len());
            }
            cut = true;
        } else if b1 == 0x02 {
            let rs = *run_start.get_or_insert_with(|| {
                run_dx = 0;
                run_dy = 0;
                b.len()
            });
            run_dx += dx;
            run_dy += dy;
            b.add(dx, dy, JUMP);
            if !cut && (run_dx.abs() > JEF_TRIM_DISTANCE || run_dy.abs() > JEF_TRIM_DISTANCE) {
                trim_at.push(rs);
                cut = true;
            }
        } else if b1 == 0x01 {
            b.mark(COLOR_CHANGE);
            if dx != 0 || dy != 0 {
                b.add(dx, dy, JUMP);
            }
            blocks += 1;
            run_start = None;
            cut = true;
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
                .unwrap_or_else(|| jef_color(1))
        })
        .collect();
    let mut records = b.build(colors);
    if !trim_at.is_empty() {
        insert_before(&mut records, &trim_at, TRIM);
    }
    Ok(Parsed {
        name: file_name.to_string(),
        format: "jef",
        records,
        hoop,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(colors: &[i32], hoop: i32, records: &[u8]) -> Vec<u8> {
        let start = 0x74 + colors.len() * 8;
        let mut d = vec![0u8; start];
        d[0..4].copy_from_slice(&(start as u32).to_le_bytes());
        d[24..28].copy_from_slice(&(colors.len() as i32).to_le_bytes());
        d[32..36].copy_from_slice(&hoop.to_le_bytes());
        for (k, c) in colors.iter().enumerate() {
            d[0x74 + k * 4..0x78 + k * 4].copy_from_slice(&c.to_le_bytes());
        }
        d.extend_from_slice(records);
        d.extend_from_slice(&[0x80, 0x10]);
        d
    }

    #[test]
    fn zero_jump_is_a_cut_and_stop_repeats_the_thread() {
        let p = parse_jef(
            &file(
                &[2, 0],
                4,
                &[
                    5, 0, 0x80, 0x02, 0, 0, 0x80, 0x02, 3, 0, 0x80, 0x01, 0, 0, 1, 0,
                ],
            ),
            "j",
        )
        .unwrap();
        assert_eq!(
            p.records.cmd,
            vec![STITCH, TRIM, JUMP, COLOR_CHANGE, STITCH]
        );
        assert_eq!(p.records.colors[1].name.as_deref(), Some("White"));
        assert_eq!(p.hoop, Some(Hoop { w: 200.0, h: 200.0 }));
    }

    #[test]
    fn long_moves_are_cuts() {
        let p = parse_jef(
            &file(&[1], 9, &[1, 0, 0x80, 0x02, 20, 0, 0x80, 0x02, 20, 0, 1, 0]),
            "j",
        )
        .unwrap();
        assert_eq!(p.records.cmd, vec![STITCH, TRIM, JUMP, JUMP, STITCH]);
        assert_eq!(p.hoop, None);
        assert!(parse_jef(&[0; 10], "j").is_err());
    }
}
