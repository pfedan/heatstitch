//! Brother PES version 1 and bare PEC (src/writers/pes.ts).

use std::collections::BTreeSet;

use crate::parsers::palettes::{PEC_APPLIQUE, pec_color, pec_own_slot};
use crate::parsers::pes::PEC_STITCH_OFFSET;
use crate::pattern::{COLOR_CHANGE, END, Hoop, JUMP, Records, STITCH, TRIM};

use super::bytes::{ByteWriter, block_color, extents, header_label, split_move, stitch_extents};
use super::pec_graphics::{ICON_H, ICON_STRIDE, pec_icons};
use super::thread_slots::unique_slots;

/// Largest move per PEC record and axis (12-bit long form).
pub const PEC_MAX_DELTA: i64 = 2047;
const JUMP_FLAG: i64 = 0x10;
const TRIM_FLAG: i64 = 0x20;

/// Number of color blocks (one more than the color changes).
fn block_count(p: &Records) -> usize {
    1 + p.cmd.iter().filter(|&&c| c == COLOR_CHANGE).count()
}

/// PEC palette slot per color block (never 0, "unknown"): each distinct color its own. The appliqué
/// slots (62 to 64) only for a color read from one.
fn pec_slots(p: &Records) -> Vec<u32> {
    let colors: Vec<_> = (0..block_count(p)).map(|k| block_color(p, k)).collect();
    let kept: BTreeSet<u32> = colors
        .iter()
        .filter_map(pec_own_slot)
        .filter(|&s| s >= PEC_APPLIQUE)
        .collect();
    let slots: Vec<u32> = (1..PEC_APPLIQUE).chain(kept).collect();
    unique_slots(&colors, &slots, |s| pec_color(s as i64), pec_own_slot)
}

fn long_value(out: &mut ByteWriter, v: i64, flag: i64) {
    let code = (v & 0xfff) | 0x8000 | (flag << 8);
    out.u8(code >> 8);
    out.u8(code);
}

/// Encodes the PEC stitch stream. Unlike pyembroidery, which flags every jump as a trim, only a jump
/// that follows a TRIM carries the trim flag; a TRIM with no jump after it becomes a zero-length
/// trimmed jump. Moves longer than the 12-bit range are split (stitches into jumps plus one stitch).
fn encode_stitches(out: &mut ByteWriter, p: &Records) {
    let (mut cx, mut cy) = (0i64, 0i64);
    let mut pending_trim = false;
    let mut color_two = true;
    let jump = |out: &mut ByteWriter,
                pending_trim: &mut bool,
                cx: &mut i64,
                cy: &mut i64,
                dx: i64,
                dy: i64| {
        let flag = if *pending_trim { TRIM_FLAG } else { JUMP_FLAG };
        *pending_trim = false;
        long_value(out, dx, flag);
        long_value(out, dy, flag);
        *cx += dx;
        *cy += dy;
    };
    for i in 0..p.cmd.len() {
        let c = p.cmd[i];
        if c == END {
            break;
        }
        let (dx, dy) = (p.x[i] as i64 - cx, p.y[i] as i64 - cy);
        if c == TRIM {
            pending_trim = true;
        } else if c == JUMP {
            for (dx, dy) in split_move(dx, dy, PEC_MAX_DELTA) {
                jump(out, &mut pending_trim, &mut cx, &mut cy, dx, dy);
            }
        } else if c == STITCH {
            if pending_trim {
                jump(out, &mut pending_trim, &mut cx, &mut cy, 0, 0);
            }
            let pieces = split_move(dx, dy, PEC_MAX_DELTA);
            let (last, lead) = pieces.split_last().unwrap();
            for &(dx, dy) in lead {
                jump(out, &mut pending_trim, &mut cx, &mut cy, dx, dy);
            }
            let (dx, dy) = *last;
            if (-63..=62).contains(&dx) && (-63..=62).contains(&dy) {
                out.u8(dx & 0x7f);
                out.u8(dy & 0x7f);
            } else {
                long_value(out, dx, 0);
                long_value(out, dy, 0);
            }
            cx += dx;
            cy += dy;
        } else if c == COLOR_CHANGE {
            if pending_trim {
                jump(out, &mut pending_trim, &mut cx, &mut cy, 0, 0);
            }
            out.bytes(&[0xfe, 0xb0, if color_two { 2 } else { 1 }]);
            color_two = !color_two;
        }
    }
    if pending_trim {
        jump(out, &mut pending_trim, &mut cx, &mut cy, 0, 0);
    }
    out.u8(0xff);
}

/// Writes a PEC block (header, stitches, thumbnails) at the current position.
pub fn write_pec(out: &mut ByteWriter, p: &Records, name: &str) {
    let start = out.len();
    let blocks = block_count(p).min(256);
    // As Brother writes it: the size is that of the stitches, and the first record moves from their
    // top left corner to the origin, where the stitch records start.
    let b = stitch_extents(p);

    out.ascii(&format!("LA:{:<16}\r", header_label(name, 16)));
    out.fill(0x20, 12);
    out.bytes(&[0xff, 0x00, ICON_STRIDE as u8, ICON_H as u8]);
    out.fill(0x20, 12);
    out.u8(blocks as i64 - 1);
    let slots = pec_slots(p);
    for &s in &slots[..blocks] {
        out.u8(s as i64);
    }
    out.fill(0x20, (start + 512).saturating_sub(out.len()));

    out.bytes(&[0x00, 0x00]);
    let length_at = out.len();
    out.u24(0);
    out.bytes(&[0x31, 0xff, 0xf0]);
    let (min_x, min_y, max_x, max_y) = (
        b.min_x as i64,
        b.min_y as i64,
        b.max_x as i64,
        b.max_y as i64,
    );
    out.u16(max_x - min_x);
    out.u16(max_y - min_y);
    out.u16(0x1e0);
    out.u16(0x1b0);
    // Bytes 528 to 531: that opening move, a long-form jump. heatstitch's reader (like pystitch)
    // leaves it out, pyembroidery executes it. Beyond the 12-bit range it stays at the origin.
    let reach = |v: i64| if v.abs() <= PEC_MAX_DELTA { v } else { 0 };
    long_value(out, reach(-min_x), JUMP_FLAG);
    long_value(out, reach(-min_y), JUMP_FLAG);
    assert_eq!(
        out.len(),
        start + PEC_STITCH_OFFSET,
        "PEC header size mismatch"
    );
    encode_stitches(out, p);
    let length = out.len() - (start + 512);
    out.patch(length_at, length as i64, 3);

    for icon in pec_icons(p, b, blocks) {
        out.bytes(&icon);
    }
}

/// pyembroidery's "CEmbOne" / "CSewSeg" PES v1 objects, which PE-Design and similar software read.
fn write_emb_objects(out: &mut ByteWriter, p: &Records, field: Hoop) {
    let b = extents(p);
    let width = b.max_x as i64 - b.min_x as i64;
    let height = b.max_y as i64 - b.min_y as i64;
    let string16 = |out: &mut ByteWriter, s: &str| {
        out.u16(s.len() as i64);
        out.ascii(s);
    };

    string16(out, "CEmbOne");
    out.fill(0, 16); // two empty rectangles
    // Placement in the middle of the hoop the header names, with pyembroidery's offsets.
    let hoop_w = field.w * 10.0;
    let hoop_h = field.h * 10.0;
    let (wf, hf) = (width as f64, height as f64);
    for v in [
        1.0,
        0.0,
        0.0,
        1.0,
        350.0 + hoop_w / 2.0 - wf / 2.0,
        100.0 + hf + hoop_h / 2.0 - hf / 2.0,
    ] {
        out.f32(v);
    }
    out.u16(1);
    out.u16(0);
    out.u16(0);
    out.u16(width);
    out.u16(height);
    out.fill(0, 8);
    let sections_at = out.len();
    out.u16(0);
    out.u16(0xffff);
    out.u16(0x0000);

    string16(out, "CSewSeg");
    // Segment coordinates are relative to the lower left corner of the design.
    let (ax, ay) = (b.min_x as i64, b.max_y as i64);
    let mut sections = 0;
    let mut color_log: Vec<(i64, u32)> = vec![];
    let mut block = 0;
    let slots = pec_slots(p);
    let mut code = slots[0];
    let (mut stitched_x, mut stitched_y) = (0i64, 0i64);
    let mut segment = |out: &mut ByteWriter, code: u32, flag: i64, pts: &[(i64, i64)]| {
        if sections > 0 {
            out.u16(0x8003);
        }
        if color_log.last().is_none_or(|l| l.1 != code) {
            color_log.push((sections, code));
        }
        out.u16(flag);
        out.u16(code as i64);
        out.u16(pts.len() as i64);
        for &(x, y) in pts {
            out.u16(x - ax);
            out.u16(y - ay);
        }
        sections += 1;
    };
    let n = p.cmd.len();
    let mut i = 0;
    while i < n {
        let c = p.cmd[i];
        if c == STITCH {
            let mut pts = vec![];
            while i < n && p.cmd[i] == STITCH {
                pts.push((p.x[i] as i64, p.y[i] as i64));
                i += 1;
            }
            (stitched_x, stitched_y) = *pts.last().unwrap();
            segment(out, code, 0, &pts);
        } else if c == JUMP {
            let mut j = i;
            while j < n && p.cmd[j] == JUMP {
                j += 1;
            }
            segment(
                out,
                code,
                1,
                &[
                    (stitched_x, stitched_y),
                    (p.x[j - 1] as i64, p.y[j - 1] as i64),
                ],
            );
            i = j;
        } else {
            if c == COLOR_CHANGE {
                block += 1;
                code = slots[block];
            }
            i += 1;
        }
    }
    out.u16(color_log.len() as i64);
    for &(section, color) in &color_log {
        out.u16(section);
        out.u16(color as i64);
    }
    out.patch(sections_at, sections, 2);
    out.u16(0x0000);
    out.u16(0x0000);
}

/// Writes a PES version 1 file: the PES header with one CEmbOne/CSewSeg object (for design
/// software) followed by the PEC block (what embroidery machines read). Thread colors are PEC
/// palette slots: a color read from a PES file keeps its slot, others get the nearest one.
pub fn write_pes(p: &Records, name: &str, hoop: Option<Hoop>) -> Vec<u8> {
    // Version 1 knows two hoops: 100 x 100 and 130 x 180 mm. Larger fields are written as 130 x 180;
    // machines read the PEC part and center the design themselves.
    let small = hoop.is_some_and(|h| h.w <= 100.0 && h.h <= 100.0);
    let field = if small {
        Hoop { w: 100.0, h: 100.0 }
    } else {
        Hoop { w: 130.0, h: 180.0 }
    };
    let mut out = ByteWriter::new();
    out.ascii("#PES0001");
    let pec_at = out.len();
    out.u32(0);
    let has_stitches = p.cmd.contains(&STITCH);
    out.u16(1); // scale to fit
    out.u16(if small { 0 } else { 1 }); // hoop: 0 = 100 x 100 mm, 1 = 130 x 180 mm
    out.u16(has_stitches as i64);
    if has_stitches {
        out.u16(0xffff);
        out.u16(0x0000);
        write_emb_objects(&mut out, p, field);
    } else {
        out.u16(0);
        out.u16(0);
    }
    let at = out.len() as i64;
    out.patch(pec_at, at, 4);
    write_pec(&mut out, p, name);
    out.buf
}

/// A bare PEC file ("#PEC0001" and the PEC block), as older Brother machines read it.
pub fn write_pec_file(p: &Records, name: &str) -> Vec<u8> {
    let mut out = ByteWriter::new();
    out.ascii("#PEC0001");
    write_pec(&mut out, p, name);
    out.buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsers::pes::{parse_pec_file, parse_pes};

    fn design() -> Records {
        Records {
            x: vec![100, 150, 150, 2000, 2000, 2000, 2010],
            y: vec![100, 120, 120, 120, 120, 120, 100],
            cmd: vec![STITCH, STITCH, TRIM, JUMP, STITCH, COLOR_CHANGE, STITCH],
            colors: vec![pec_color(5), pec_color(13)],
        }
    }

    #[test]
    fn pes_round_trip() {
        let p = design();
        let q = parse_pes(&write_pes(&p, "Sun", None), "x").unwrap();
        assert_eq!(q.name, "Sun");
        assert_eq!(q.records.cmd, p.cmd);
        assert_eq!(q.records.x, p.x);
        assert_eq!(q.records.y, p.y);
        assert_eq!(q.records.colors, p.colors);
    }

    #[test]
    fn pec_keeps_its_slots_and_applique_steps() {
        let mut p = design();
        p.colors[1] = pec_color(62);
        let q = parse_pec_file(&write_pec_file(&p, ""), "x").unwrap();
        assert_eq!(q.name, "heatstitch");
        assert_eq!(q.records.colors[1].pec_index, Some(62));
        // A color merely drawn like an appliqué step gets a thread slot.
        p.colors[1].name = Some("Orange".into());
        let q = parse_pec_file(&write_pec_file(&p, ""), "x").unwrap();
        assert!(q.records.colors[1].pec_index.unwrap() < PEC_APPLIQUE);
    }
}
