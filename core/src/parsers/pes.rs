//! Brother PES and PEC (src/parsers/pes.ts): the stitches are read from the PEC block; a PES
//! header (versions 5 to 10) adds the real thread colors and the sewing field.

use std::collections::HashMap;

use crate::pattern::{COLOR_CHANGE, Hoop, JUMP, STITCH, TRIM, ThreadColor};

use super::palettes::pec_color;
use super::read::{Builder, Parsed, js_space, js_trim, latin1};

pub const PEC_COLOR_COUNT_OFFSET: usize = 48;
/// Where the stitch records of a PEC block begin. Brother (and pystitch, and heatstitch) put a move
/// there first, a long-form jump to the stitches' origin; pyembroidery puts its first record there,
/// which may be anything.
pub const PEC_RECORDS_OFFSET: usize = 528;
/// Where the stitches begin after Brother's opening move.
pub const PEC_STITCH_OFFSET: usize = 532;

fn signed12(v: u32) -> i64 {
    let v = (v & 0xfff) as i64;
    if v > 0x7ff { v - 0x1000 } else { v }
}

fn signed7(v: u8) -> i64 {
    if v > 0x3f { v as i64 - 0x80 } else { v as i64 }
}

pub fn is_pes(data: &[u8]) -> bool {
    data.starts_with(b"#PES")
}

/// "#PEC0001": a bare PEC block as older Brother machines read it.
pub fn is_pec(data: &[u8]) -> bool {
    data.starts_with(b"#PEC0001")
}

pub fn parse_pes(data: &[u8], file_name: &str) -> Result<Parsed, String> {
    if !is_pes(data) || data.len() < 12 {
        return Err("PES: missing #PES signature".into());
    }
    let pec = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as u64;
    if pec + PEC_STITCH_OFFSET as u64 > data.len() as u64 {
        return Err("PES: PEC section out of range".into());
    }
    let mut p = parse_pec(data, pec as usize, file_name);
    // An unusual header only costs the real thread colors; the PEC palette stays.
    let chart = read_pes_threads(data).unwrap_or_default();
    if !chart.is_empty() {
        p.records.colors = apply_chart(&p.records.colors, chart);
    }
    // Without a readable header the file names no hoop.
    p.hoop = read_pes_hoop(data).ok().flatten();
    Ok(p)
}

pub fn parse_pec_file(data: &[u8], file_name: &str) -> Result<Parsed, String> {
    if !is_pec(data) || 8 + PEC_STITCH_OFFSET > data.len() {
        return Err("PEC: missing #PEC0001 signature".into());
    }
    Ok(Parsed {
        format: "pec",
        ..parse_pec(data, 8, file_name)
    })
}

/// The strings of a PES header: a length byte, then that many bytes.
struct Header<'a> {
    data: &'a [u8],
    i: usize,
}

impl Header<'_> {
    fn need(&self, n: usize) -> Result<(), ()> {
        if self.i + n > self.data.len() {
            Err(())
        } else {
            Ok(())
        }
    }

    fn string(&mut self) -> Result<String, ()> {
        self.need(1)?;
        let n = self.data[self.i] as usize;
        self.i += 1;
        self.need(n)?;
        self.i += n;
        Ok(js_trim(&latin1(&self.data[self.i - n..self.i])))
    }

    fn u16(&self, at: usize) -> u16 {
        u16::from_le_bytes([self.data[at], self.data[at + 1]])
    }
}

fn version(data: &[u8]) -> &[u8] {
    &data[4.min(data.len())..8.min(data.len())]
}

/// The thread list of a PES header (versions 5 to 10, as pyembroidery reads them): real RGB, name,
/// brand and catalog number. Headers with programmable fills, motifs or feather patterns are skipped.
fn read_pes_threads(data: &[u8]) -> Result<Vec<ThreadColor>, ()> {
    // Bytes skipped before and after the image file name, per version.
    let l: [usize; 3] = match version(data) {
        b"0050" | b"0055" | b"0056" => [0, 24, 24],
        b"0060" | b"0070" => [0, 36, 24],
        b"0080" => [0, 38, 26],
        b"0090" => [14, 30, 34],
        b"0100" => [14, 38, 34],
        _ => return Ok(vec![]),
    };
    let mut h = Header { data, i: 16 };
    for _ in 0..5 {
        h.string()?; // name, category, author, keywords, comments
    }
    if l[0] != 0 {
        h.i += l[0];
        h.string()?; // hoop name
    }
    h.i += l[1];
    h.string()?; // image file
    h.i += l[2];
    h.need(8)?;
    for _ in 0..3 {
        if h.u16(h.i) != 0 {
            return Ok(vec![]); // programmable fills, motifs, feather patterns
        }
        h.i += 2;
    }
    let count = h.u16(h.i);
    h.i += 2;
    let mut threads = vec![];
    for _ in 0..count {
        let catalog = h.string()?;
        h.need(3)?;
        let (r, g, b) = (data[h.i], data[h.i + 1], data[h.i + 2]);
        h.i += 3 + 5;
        let name = h.string()?;
        let brand = h.string()?;
        h.string()?; // chart
        let some = |s: String| (!s.is_empty()).then_some(s);
        threads.push(ThreadColor {
            r,
            g,
            b,
            name: some(name),
            brand: some(brand),
            catalog: some(catalog),
            pec_index: None,
        });
    }
    Ok(threads)
}

/// `\d+\s*(?:mm)?\s*[x×*]\s*\d+` (case-insensitive), first match: the two numbers.
fn hoop_size(s: &str) -> Option<(f64, f64)> {
    let c: Vec<char> = s.chars().collect();
    let digits = |mut i: usize| {
        let from = i;
        while i < c.len() && c[i].is_ascii_digit() {
            i += 1;
        }
        (from < i).then(|| {
            (
                c[from..i]
                    .iter()
                    .collect::<String>()
                    .parse::<f64>()
                    .unwrap_or(f64::INFINITY),
                i,
            )
        })
    };
    let skip = |mut i: usize| {
        while i < c.len() && js_space(c[i]) {
            i += 1;
        }
        i
    };
    let times = |i: usize| i < c.len() && matches!(c[i], 'x' | 'X' | '×' | '*');
    for start in 0..c.len() {
        if start > 0 && c[start - 1].is_ascii_digit() {
            continue; // a later start inside the same number has the same tail
        }
        let Some((w, i)) = digits(start) else {
            continue;
        };
        let i = skip(i);
        let mm = i + 1 < c.len()
            && c[i].eq_ignore_ascii_case(&'m')
            && c[i + 1].eq_ignore_ascii_case(&'m');
        // With "mm" and without (the group is optional, so both are tried).
        for i in [if mm { Some(skip(i + 2)) } else { None }, Some(i)]
            .into_iter()
            .flatten()
        {
            if times(i)
                && let Some((h, _)) = digits(skip(i + 1))
            {
                return Some((w, h));
            }
        }
    }
    None
}

/// The sewing field a PES header names, mm: versions 5 to 8 store width and height after the
/// metadata, versions 9 and 10 a hoop name like "200 x 200". None when there is none or it is
/// not a plausible size.
fn read_pes_hoop(data: &[u8]) -> Result<Option<Hoop>, ()> {
    let v = version(data);
    let sized = matches!(v, b"0050" | b"0055" | b"0056" | b"0060" | b"0070" | b"0080");
    let named = matches!(v, b"0090" | b"0100");
    if !sized && !named {
        return Ok(None);
    }
    let mut h = Header { data, i: 16 };
    for _ in 0..5 {
        h.string()?; // name, category, author, keywords, comments
    }
    let plausible = |w: f64, h: f64| {
        ((20.0..=1000.0).contains(&w) && (20.0..=1000.0).contains(&h)).then_some(Hoop { w, h })
    };
    if sized {
        if h.i + 8 > data.len() {
            return Ok(None);
        }
        // Optimize hoop change, custom design page, then the hoop size.
        return Ok(plausible(h.u16(h.i + 4) as f64, h.u16(h.i + 6) as f64));
    }
    h.i += 14;
    Ok(hoop_size(&h.string()?).and_then(|(w, hh)| plausible(w, hh)))
}

/// Puts the header threads on the PEC color blocks, keeping each block's PEC slot for saving: one to
/// one when there are enough, otherwise one header thread per distinct PEC slot in order (how
/// PE-Design assigns them).
fn apply_chart(colors: &[ThreadColor], chart: Vec<ThreadColor>) -> Vec<ThreadColor> {
    if chart.len() >= colors.len() {
        return colors
            .iter()
            .zip(chart)
            .map(|(c, t)| ThreadColor {
                pec_index: c.pec_index,
                ..t
            })
            .collect();
    }
    let mut by_slot: HashMap<u32, ThreadColor> = HashMap::new();
    let mut rest = chart.into_iter();
    colors
        .iter()
        .map(|c| {
            let slot = c.pec_index.unwrap_or(0);
            by_slot
                .entry(slot)
                .or_insert_with(|| match rest.next() {
                    Some(t) => ThreadColor {
                        pec_index: Some(slot),
                        ..t
                    },
                    None => c.clone(),
                })
                .clone()
        })
        .collect()
}

/// A long-form jump or trim in both coordinates at `i` (4 bytes).
fn is_long_move(data: &[u8], i: usize) -> bool {
    let mv = |v: u8| v & 0x80 != 0 && v & 0x30 != 0;
    i + 3 < data.len() && mv(data[i]) && mv(data[i + 2])
}

/// Parses a PEC block starting at `pec` (the "LA:" label); the caller checked that its header is there.
pub fn parse_pec(data: &[u8], pec: usize, file_name: &str) -> Parsed {
    let label = js_trim(&latin1(
        &data[(pec + 3).min(data.len())..(pec + 19).min(data.len())],
    ));
    let color_count = data[pec + PEC_COLOR_COUNT_OFFSET] as usize + 1;
    let mut colors: Vec<ThreadColor> = (0..color_count)
        .map(|k| pec_color(data[pec + PEC_COLOR_COUNT_OFFSET + 1 + k] as i64))
        .collect();

    let mut b = Builder::new();
    // Brother's opening move only places the design (from its top left corner to the origin): left
    // out, the stitches stay where they were drawn. Anything else there is the first record.
    let mut i = pec + PEC_RECORDS_OFFSET;
    if is_long_move(data, i) {
        i += 4;
    }
    let mut next = || {
        let v = data.get(i).copied().unwrap_or(0xff);
        i += 1;
        v
    };
    let mut blocks = 1;
    loop {
        let v1 = next();
        if v1 == 0xff {
            break;
        }
        let mut v2 = next();
        if v1 == 0xfe && v2 == 0xb0 {
            next(); // color index byte, unused
            b.mark(COLOR_CHANGE);
            blocks += 1;
            continue;
        }
        let (mut jump, mut trim) = (false, false);
        let dx = if v1 & 0x80 != 0 {
            trim |= v1 & 0x20 != 0;
            jump |= v1 & 0x10 != 0;
            let dx = signed12(((v1 as u32) << 8) | v2 as u32);
            v2 = next();
            dx
        } else {
            signed7(v1)
        };
        let dy = if v2 & 0x80 != 0 {
            trim |= v2 & 0x20 != 0;
            jump |= v2 & 0x10 != 0;
            signed12(((v2 as u32) << 8) | next() as u32)
        } else {
            signed7(v2)
        };
        if trim {
            b.mark(TRIM);
            b.add(dx, dy, JUMP);
        } else {
            b.add(dx, dy, if jump { JUMP } else { STITCH });
        }
    }

    while colors.len() < blocks {
        colors.push(pec_color(0));
    }
    Parsed {
        name: if label.is_empty() {
            file_name.to_string()
        } else {
            label
        },
        format: "pes",
        records: b.build(colors),
        hoop: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pec_file(colors: &[u8], records: &[u8]) -> Vec<u8> {
        let mut d = b"#PEC0001LA:Sun             \r".to_vec();
        d.resize(8 + 512, b' ');
        d[8 + PEC_COLOR_COUNT_OFFSET] = colors.len() as u8 - 1;
        d[8 + 49..8 + 49 + colors.len()].copy_from_slice(colors);
        d.resize(8 + PEC_RECORDS_OFFSET, 0);
        d.extend_from_slice(&[0x90, 0x00, 0x90, 0x00]); // the opening move
        d.extend_from_slice(records);
        d.push(0xff);
        d
    }

    #[test]
    fn reads_a_pec_block() {
        let d = pec_file(
            &[5, 13],
            &[10, 0x7f, 0xa0, 0x05, 0x90, 0x00, 0xfe, 0xb0, 0x02, 1, 1],
        );
        let p = parse_pec_file(&d, "x").unwrap();
        assert_eq!(p.name, "Sun");
        assert_eq!(p.format, "pec");
        assert_eq!(
            p.records.cmd,
            vec![STITCH, TRIM, JUMP, COLOR_CHANGE, STITCH]
        );
        assert_eq!(p.records.x, vec![10, 10, 15, 15, 16]);
        assert_eq!(p.records.y, vec![-1, -1, -1, -1, 0]);
        assert_eq!(p.records.colors[1].name.as_deref(), Some("Yellow"));
    }

    #[test]
    fn finds_the_hoop_in_its_name() {
        assert_eq!(hoop_size("Hoop 200 x 300"), Some((200.0, 300.0)));
        assert_eq!(hoop_size("130mm X 180mm"), Some((130.0, 180.0)));
        assert_eq!(hoop_size("100*100"), Some((100.0, 100.0)));
        assert_eq!(hoop_size("12 mmx 5"), Some((12.0, 5.0)));
        assert_eq!(hoop_size("no size"), None);
    }

    #[test]
    fn chart_per_slot_when_short() {
        let colors = vec![pec_color(5), pec_color(13), pec_color(5)];
        let chart = vec![ThreadColor {
            r: 1,
            ..Default::default()
        }];
        let out = apply_chart(&colors, chart);
        assert_eq!(out[0].r, 1);
        assert_eq!(out[0].pec_index, Some(5));
        assert_eq!(out[1], pec_color(13));
        assert_eq!(out[2], out[0]);
    }
}
