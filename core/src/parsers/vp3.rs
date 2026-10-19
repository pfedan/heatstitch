//! Pfaff / Husqvarna Viking VP3 (src/parsers/vp3.ts). Positions in the headers are in 0.001 mm
//! with y up, stitch deltas in 0.1 mm with y down. VP3 has no jumps: a move is a long stitch, after
//! a trim it is the first stitch at the new place. Thread colors are real RGB with brand and
//! catalog number.

use crate::js::round;
use crate::pattern::{COLOR_CHANGE, JUMP, STITCH, TRIM, ThreadColor};

use super::read::{Builder, Parsed, js_trim};

/// "%vsm%\0"
pub fn is_vp3(data: &[u8]) -> bool {
    data.len() >= 6 && data.starts_with(b"%vsm%")
}

/// Big-endian reads that fail past the end of the file.
struct Reader<'a> {
    data: &'a [u8],
    i: usize,
}

const SHORT: &str = "VP3: file too short";

impl Reader<'_> {
    fn need(&self, n: usize) -> Result<(), String> {
        if self.i + n > self.data.len() {
            Err(SHORT.into())
        } else {
            Ok(())
        }
    }

    fn take<const N: usize>(&mut self) -> Result<[u8; N], String> {
        self.need(N)?;
        self.i += N;
        Ok(self.data[self.i - N..self.i].try_into().unwrap())
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take::<1>()?[0])
    }

    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_be_bytes(self.take()?))
    }

    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_be_bytes(self.take()?))
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_be_bytes(self.take()?))
    }

    fn skip_string(&mut self) -> Result<(), String> {
        let n = self.u16()? as usize;
        self.need(n)?;
        self.i += n;
        Ok(())
    }

    fn string8(&mut self) -> Result<String, String> {
        let n = self.u16()? as usize;
        self.need(n)?;
        self.i += n;
        Ok(js_trim(&String::from_utf8_lossy(
            &self.data[self.i - n..self.i],
        )))
    }
}

pub fn parse_vp3(data: &[u8], file_name: &str) -> Result<Parsed, String> {
    if !is_vp3(data) {
        return Err("VP3: missing %vsm% signature".into());
    }
    let mut r = Reader { data, i: 6 };
    r.skip_string()?; // "Produced by ..."
    r.i += 7;
    r.skip_string()?; // settings
    r.i += 32;
    let center_x = r.i32()? as f64 / 100.0;
    let center_y = -(r.i32()? as f64) / 100.0;
    r.i += 27;
    r.skip_string()?;
    r.i += 24;
    r.skip_string()?;
    let count = r.u16()?;

    let mut b = Builder::new();
    let (mut x, mut y) = (0i64, 0i64);
    let mut colors = vec![];
    for k in 0..count {
        r.i += 3;
        let block_end = r.u32()? as u64 + r.i as u64;
        if block_end > data.len() as u64 {
            return Err("VP3: color block out of range".into());
        }
        let block_end = block_end as usize;
        let sx = round(r.i32()? as f64 / 100.0 + center_x) as i64;
        let sy = round(-(r.i32()? as f64) / 100.0 + center_y) as i64;
        if k > 0 {
            b.mark(COLOR_CHANGE);
        }
        if sx != x || sy != y {
            b.add(sx - x, sy - y, JUMP);
            x = sx;
            y = sy;
        }
        let tones = r.u8()?;
        r.i += 1; // transition
        let mut rgb = [0u8; 3];
        for _ in 0..tones {
            r.need(3)?;
            rgb.copy_from_slice(&data[r.i..r.i + 3]);
            r.i += 6;
        }
        r.i += 2; // thread type, weight
        let catalog = r.string8()?;
        let name = r.string8()?;
        let brand = r.string8()?;
        let some = |s: String| (!s.is_empty()).then_some(s);
        colors.push(ThreadColor {
            r: rgb[0],
            g: rgb[1],
            b: rgb[2],
            name: some(name),
            brand: some(brand),
            catalog: some(catalog),
            pec_index: None,
        });
        r.i += 15 + 3;
        let s8 = |v: u8| v as i8 as i64;
        let mut i = r.i;
        while i + 1 < block_end {
            let (b0, b1) = (data[i], data[i + 1]);
            i += 2;
            if b0 != 0x80 {
                b.add(s8(b0), s8(b1), STITCH);
                x += s8(b0);
                y += s8(b1);
            } else if b1 == 0x01 {
                if i + 4 > block_end {
                    break;
                }
                let dx = i16::from_be_bytes([data[i], data[i + 1]]) as i64;
                let dy = i16::from_be_bytes([data[i + 2], data[i + 3]]) as i64;
                i += 6; // the long stitch is followed by 0x80 0x02
                b.add(dx, dy, STITCH);
                x += dx;
                y += dy;
            } else if b1 == 0x03 {
                b.mark(TRIM);
            }
        }
        r.i = block_end;
    }
    if colors.is_empty() {
        colors.push(ThreadColor::default());
    }
    Ok(Parsed {
        name: file_name.to_string(),
        format: "vp3",
        records: b.build(colors),
        hoop: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_other_files() {
        assert_eq!(parse_vp3(b"%vsm%\0", "v").unwrap_err(), SHORT);
        assert!(parse_vp3(b"#PES", "v").is_err());
    }
}
