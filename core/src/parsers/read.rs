//! What every reader shares (as src/parsers/index.ts and PatternBuilder in src/model/pattern.ts):
//! the record builder, the result of a reader, text decoding as the browser does it, and picking
//! the reader for a file.

use crate::pattern::{Hoop, Records, ThreadColor};

use super::{dst, exp, jef, pes, sew, vp3, xxx};

/// A design read from a file: its records and colors, the name it gives, its format and the
/// sewing field its header names.
#[derive(Clone, Debug, PartialEq)]
pub struct Parsed {
    pub name: String,
    pub format: &'static str,
    pub records: Records,
    pub hoop: Option<Hoop>,
}

/// Growable record list: relative moves in, absolute records out.
#[derive(Default)]
pub struct Builder {
    x: Vec<i32>,
    y: Vec<i32>,
    cmd: Vec<u8>,
    cx: i64,
    cy: i64,
}

impl Builder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Relative move in 0.1 mm. Positions wrap to 32 bits as Int32Array.from does in TypeScript.
    pub fn add(&mut self, dx: i64, dy: i64, cmd: u8) {
        self.cx += dx;
        self.cy += dy;
        self.x.push(self.cx as i32);
        self.y.push(self.cy as i32);
        self.cmd.push(cmd);
    }

    /// Record without movement (TRIM, COLOR_CHANGE, END).
    pub fn mark(&mut self, cmd: u8) {
        self.add(0, 0, cmd);
    }

    pub fn len(&self) -> usize {
        self.cmd.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cmd.is_empty()
    }

    pub fn build(self, colors: Vec<ThreadColor>) -> Records {
        Records {
            x: self.x,
            y: self.y,
            cmd: self.cmd,
            colors,
        }
    }
}

/// Math.round: halves go up.
pub fn js_round(v: f64) -> f64 {
    let f = v.floor();
    if v - f >= 0.5 { f + 1.0 } else { f }
}

pub fn signed8(v: u8) -> i64 {
    v as i8 as i64
}

/// Inserts a record of `cmd` (at the previous position) before each given record index, in
/// increasing order; an index equal to the length puts it at the end.
pub fn insert_before(r: &mut Records, at: &[usize], cmd: u8) {
    let n = r.cmd.len() + at.len();
    let (mut x, mut y, mut c) = (
        Vec::with_capacity(n),
        Vec::with_capacity(n),
        Vec::with_capacity(n),
    );
    let mut k = 0;
    let prev = |r: &Records, i: usize| {
        if i > 0 {
            (r.x[i - 1], r.y[i - 1])
        } else {
            (0, 0)
        }
    };
    for i in 0..r.cmd.len() {
        if k < at.len() && at[k] == i {
            let (px, py) = prev(r, i);
            x.push(px);
            y.push(py);
            c.push(cmd);
            k += 1;
        }
        x.push(r.x[i]);
        y.push(r.y[i]);
        c.push(r.cmd[i]);
    }
    // A cut after the last record.
    while k < at.len() {
        let (px, py) = prev(r, r.cmd.len());
        x.push(px);
        y.push(py);
        c.push(cmd);
        k += 1;
    }
    r.x = x;
    r.y = y;
    r.cmd = c;
}

/// windows-1252 above 0x7F where it differs from Latin-1, which is what the browser's 'latin1'
/// decoder reads (WHATWG Encoding).
const CP1252: [u16; 32] = [
    0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039,
    0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc,
    0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/// Bytes as TextDecoder('latin1') reads them.
pub fn latin1(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| match b {
            0x80..=0x9f => char::from_u32(CP1252[(b - 0x80) as usize] as u32).unwrap_or('?'),
            _ => b as char,
        })
        .collect()
}

/// Whitespace as String.prototype.trim sees it (not quite Rust's: U+FEFF yes, U+0085 no).
pub fn js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

pub fn js_trim(s: &str) -> String {
    s.trim_matches(js_space).to_string()
}

/// The file name without its extension (the last dot and what follows, if anything does).
pub fn base_name(file_name: &str) -> &str {
    match file_name.rfind('.') {
        Some(i) if i + 1 < file_name.len() => &file_name[..i],
        _ => file_name,
    }
}

fn has_ext(file_name: &str, ext: &str) -> bool {
    let (n, e) = (file_name.as_bytes(), ext.as_bytes());
    n.len() >= e.len() && n[n.len() - e.len()..].eq_ignore_ascii_case(e)
}

/// Reads an embroidery file: the formats with a signature by it, the others by the extension.
/// heatstitch's own records container is read in TypeScript before this (src/parsers/records.ts).
pub fn read_file(data: &[u8], file_name: &str) -> Result<Parsed, String> {
    let base = base_name(file_name);
    if pes::is_pes(data) {
        return pes::parse_pes(data, base);
    }
    if pes::is_pec(data) {
        return pes::parse_pec_file(data, base);
    }
    if vp3::is_vp3(data) {
        return vp3::parse_vp3(data, base);
    }
    type Reader = fn(&[u8], &str) -> Result<Parsed, String>;
    let by_ext: [(&str, Reader); 5] = [
        (".dst", dst::parse_dst),
        (".jef", jef::parse_jef),
        (".exp", exp::parse_exp),
        (".xxx", xxx::parse_xxx),
        (".sew", sew::parse_sew),
    ];
    for (ext, parse) in by_ext {
        if has_ext(file_name, ext) {
            return parse(data, base);
        }
    }
    Err(format!("Unsupported file format: {file_name}"))
}

/// Reads `data` as the given format (the format names of src/model/pattern.ts).
pub fn read_format(format: &str, data: &[u8], file_name: &str) -> Result<Parsed, String> {
    match format {
        "dst" => dst::parse_dst(data, file_name),
        "exp" => exp::parse_exp(data, file_name),
        "jef" => jef::parse_jef(data, file_name),
        "pes" => pes::parse_pes(data, file_name),
        "pec" => pes::parse_pec_file(data, file_name),
        "vp3" => vp3::parse_vp3(data, file_name),
        "xxx" => xxx::parse_xxx(data, file_name),
        "sew" => sew::parse_sew(data, file_name),
        _ => Err(format!("Unsupported file format: {format}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pattern::{STITCH, TRIM};

    #[test]
    fn builder_accumulates_moves() {
        let mut b = Builder::new();
        b.add(3, 4, STITCH);
        b.mark(TRIM);
        b.add(-5, 1, STITCH);
        let r = b.build(vec![]);
        assert_eq!(r.x, vec![3, 3, -2]);
        assert_eq!(r.y, vec![4, 4, 5]);
    }

    #[test]
    fn inserts_before_and_at_the_end() {
        let mut r = Records {
            x: vec![1, 2],
            y: vec![1, 2],
            cmd: vec![STITCH, STITCH],
            colors: vec![],
        };
        insert_before(&mut r, &[0, 1, 2], TRIM);
        assert_eq!(r.cmd, vec![TRIM, STITCH, TRIM, STITCH, TRIM]);
        assert_eq!(r.x, vec![0, 1, 1, 2, 2]);
    }

    #[test]
    fn text_as_the_browser_reads_it() {
        assert_eq!(latin1(&[0x41, 0x80, 0xe9]), "A\u{20ac}\u{e9}");
        assert_eq!(js_trim("\u{feff} a \u{a0}"), "a");
        assert_eq!(js_trim("\u{85}a"), "\u{85}a");
        assert_eq!(base_name("a.b.dst"), "a.b");
        assert_eq!(base_name("a."), "a.");
        assert!(has_ext("X.DST", ".dst"));
    }

    #[test]
    fn rounds_as_javascript() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(0.49999999999999994), 0.0);
    }

    #[test]
    fn unknown_formats_fail() {
        assert_eq!(
            read_file(&[0; 10], "a.txt").unwrap_err(),
            "Unsupported file format: a.txt"
        );
    }
}
