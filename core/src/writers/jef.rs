//! Janome JEF (src/writers/jef.ts).

use crate::js::{round, to_int32};
use crate::parsers::palettes::{jef_color, jef_slots};
use crate::pattern::{COLOR_CHANGE, END, Hoop, JUMP, Records, STITCH, TRIM};

use super::bytes::{ByteWriter, block_color, extents, split_move};
use super::thread_slots::unique_slots;

/// Largest move per JEF record and axis (signed byte).
pub const JEF_MAX_DELTA: i64 = 127;

/// Janome hoop codes.
const HOOP_110X110: i64 = 0;
const HOOP_50X50: i64 = 1;
const HOOP_140X200: i64 = 2;
const HOOP_126X110: i64 = 3;
const HOOP_200X200: i64 = 4;

/// Smallest standard Janome hoop the design fits (0.1 mm), as pyembroidery picks it.
pub fn jef_hoop(width: i64, height: i64) -> i64 {
    if width < 500 && height < 500 {
        HOOP_50X50
    } else if width < 1260 && height < 1100 {
        HOOP_126X110
    } else if width < 1400 && height < 2000 {
        HOOP_140X200
    } else if width < 2000 && height < 2000 {
        HOOP_200X200
    } else {
        HOOP_110X110
    }
}

/// Janome code of a chosen sewing field (mm), or None when Janome has no such hoop.
pub fn jef_hoop_code(hoop: Hoop) -> Option<i64> {
    let codes = [
        (50.0, 50.0, HOOP_50X50),
        (100.0, 100.0, HOOP_110X110),
        (110.0, 110.0, HOOP_110X110),
        (126.0, 110.0, HOOP_126X110),
        (140.0, 200.0, HOOP_140X200),
        (200.0, 200.0, HOOP_200X200),
    ];
    codes
        .iter()
        .find(|c| c.0 == hoop.w && c.1 == hoop.h)
        .map(|c| c.2)
}

/// Writes a Janome JEF file. JEF has no trim command: a cut is written as three zero-length jumps, as
/// pyembroidery and Ink/Stitch write it (Janome machines cut on three in a row, readers on one), so
/// it holds however short the move after it is. A zero-length jump is therefore never written for
/// anything else. Long stitches are split into equal stitches, since long jumps would read as cuts;
/// after a cut the way to the next stitch is jumps. Colors are rounded to the Janome palette.
/// `stamp` is the date as YYYYMMDDhhmmss (local time, which only the caller knows).
pub fn write_jef(p: &Records, stamp: &str, hoop: Option<Hoop>) -> Vec<u8> {
    let mut recs = ByteWriter::new();
    let mut points = 1; // the end command
    let mut blocks = 1;
    let (mut cx, mut cy) = (0i64, 0i64);
    let mut rec =
        |recs: &mut ByteWriter, cx: &mut i64, cy: &mut i64, dx: i64, dy: i64, ctrl: Option<u8>| {
            if let Some(c) = ctrl {
                recs.bytes(&[0x80, c]);
                points += 1;
            }
            recs.u8(dx);
            recs.u8(-dy);
            points += 1;
            *cx += dx;
            *cy += dy;
        };
    // Nothing is sewn yet: the way to the first stitch is jumps, not a stitch from the origin.
    let mut trimmed = true;
    // A cut since the last stitch, written right before the next record.
    let mut cut = false;
    macro_rules! write_cut {
        () => {
            if cut {
                for _ in 0..3 {
                    rec(&mut recs, &mut cx, &mut cy, 0, 0, Some(0x02));
                }
                cut = false;
            }
        };
    }
    for i in 0..p.cmd.len() {
        let c = p.cmd[i];
        if c == END {
            break;
        }
        if c == STITCH {
            write_cut!();
            // After a cut the way there may be jumps; otherwise they would read as a cut.
            let pieces = split_move(p.x[i] as i64 - cx, p.y[i] as i64 - cy, JEF_MAX_DELTA);
            let last = pieces.len() - 1;
            for (k, (dx, dy)) in pieces.into_iter().enumerate() {
                rec(
                    &mut recs,
                    &mut cx,
                    &mut cy,
                    dx,
                    dy,
                    (trimmed && k < last).then_some(0x02),
                );
            }
            trimmed = false;
        } else if c == TRIM {
            // Only thread that was sewn can be cut.
            if !trimmed {
                cut = true;
            }
            trimmed = true;
        } else if c == JUMP {
            write_cut!();
            for (dx, dy) in split_move(p.x[i] as i64 - cx, p.y[i] as i64 - cy, JEF_MAX_DELTA) {
                if dx != 0 || dy != 0 {
                    rec(&mut recs, &mut cx, &mut cy, dx, dy, Some(0x02));
                }
            }
        } else if c == COLOR_CHANGE {
            write_cut!();
            rec(&mut recs, &mut cx, &mut cy, 0, 0, Some(0x01));
            blocks += 1;
            trimmed = true;
        }
    }
    if cut {
        for _ in 0..3 {
            rec(&mut recs, &mut cx, &mut cy, 0, 0, Some(0x02));
        }
    }
    recs.bytes(&[0x80, 0x10]);

    let b = extents(p);
    let (w, h) = (
        b.max_x as i64 - b.min_x as i64,
        b.max_y as i64 - b.min_y as i64,
    );
    let half_w = round(w as f64 / 2.0) as i64;
    let half_h = round(h as f64 / 2.0) as i64;
    let mut out = ByteWriter::new();
    out.u32(0x74 + blocks * 8);
    out.u32(0x14);
    out.ascii(stamp);
    out.u8(0);
    out.u8(0);
    out.u32(blocks);
    out.u32(points);
    out.u32(
        hoop.and_then(jef_hoop_code)
            .unwrap_or_else(|| jef_hoop(w, h)),
    );
    for v in [half_w, half_h, half_w, half_h] {
        out.u32(v);
    }
    // Distance to the edges of the 110 x 110, 50 x 50, 140 x 200 and custom hoops (-1 when it does not fit).
    // The custom slot holds the chosen sewing field.
    let custom = hoop.map_or((700.0, 1000.0), |h| (h.w * 5.0, h.h * 5.0));
    for (hw, hh) in [(550.0, 550.0), (250.0, 250.0), (700.0, 1000.0), custom] {
        let ex = hw - half_w as f64;
        let ey = hh - half_h as f64;
        let fits = ex.min(ey) >= 0.0;
        for v in [ex, ey, ex, ey] {
            out.u32(if fits { i64::from(to_int32(v)) } else { -1 });
        }
    }
    let colors: Vec<_> = (0..blocks as usize).map(|k| block_color(p, k)).collect();
    for index in unique_slots(&colors, &jef_slots(), |s| jef_color(s as u64), |_| None) {
        out.u32(index as i64);
    }
    for _ in 0..blocks {
        out.u32(0x0d);
    }
    out.bytes(&recs.buf);
    out.buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsers::jef::parse_jef;

    #[test]
    fn hoops() {
        assert_eq!(jef_hoop(400, 400), HOOP_50X50);
        assert_eq!(jef_hoop(1300, 1900), HOOP_140X200);
        assert_eq!(
            jef_hoop_code(Hoop { w: 200.0, h: 200.0 }),
            Some(HOOP_200X200)
        );
        assert_eq!(jef_hoop_code(Hoop { w: 130.0, h: 180.0 }), None);
        assert_eq!(to_int32(-1.5), -1);
    }

    #[test]
    fn cuts_survive_a_round_trip() {
        let p = Records {
            x: vec![0, 10, 10, 20, 400],
            y: vec![0, 0, 0, 0, 0],
            cmd: vec![STITCH, STITCH, TRIM, STITCH, STITCH],
            colors: vec![jef_color(10)],
        };
        let data = write_jef(&p, "20261005120000", Some(Hoop { w: 126.0, h: 110.0 }));
        assert_eq!(&data[8..22], b"20261005120000");
        let q = parse_jef(&data, "j").unwrap();
        assert_eq!(q.records.cmd.iter().filter(|&&c| c == TRIM).count(), 1);
        assert_eq!(q.records.colors[0].name.as_deref(), Some("Red"));
        assert_eq!(q.hoop, Some(Hoop { w: 126.0, h: 110.0 }));
        assert_eq!(q.records.x.last(), Some(&400));
    }
}
