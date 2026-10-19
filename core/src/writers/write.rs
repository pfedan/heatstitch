//! Picking the writer for a save format (src/writers/index.ts).

use serde::Deserialize;

use crate::pattern::{Hoop, Records};

use super::{dst, exp, jef, pes, vp3, xxx};

/// What the file should know beyond the stitches.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct WriteOptions {
    /// The chosen hoop, for formats that store one (PES, JEF).
    #[serde(default)]
    pub hoop: Option<Hoop>,
    /// The date JEF stores, YYYYMMDDhhmmss in local time.
    #[serde(default)]
    pub stamp: String,
}

/// Writes the records as `format` (pes, dst, jef, exp, vp3, xxx, pec). `name` is the design's name,
/// NFKD-normalized, for the formats with a label.
pub fn write_pattern(
    p: &Records,
    format: &str,
    name: &str,
    o: &WriteOptions,
) -> Result<Vec<u8>, String> {
    Ok(match format {
        "pes" => pes::write_pes(p, name, o.hoop),
        "dst" => dst::write_dst(p, name),
        "jef" => jef::write_jef(p, &o.stamp, o.hoop),
        "exp" => exp::write_exp(p),
        "vp3" => vp3::write_vp3(p),
        "xxx" => xxx::write_xxx(p),
        "pec" => pes::write_pec_file(p, name),
        _ => return Err(format!("Unsupported output format: {format}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsers::read::read_file;
    use crate::pattern::{COLOR_CHANGE, STITCH, TRIM};

    #[test]
    fn every_format_reads_back() {
        let p = Records {
            x: vec![0, 30, 30, 200, 200, 240],
            y: vec![0, 10, 10, 90, 90, 60],
            cmd: vec![STITCH, STITCH, TRIM, STITCH, COLOR_CHANGE, STITCH],
            colors: vec![],
        };
        let stitches = |r: &Records| {
            (0..r.len())
                .filter(|&i| r.cmd[i] == STITCH)
                .map(|i| (r.x[i], r.y[i]))
                .collect::<Vec<_>>()
        };
        let o = WriteOptions {
            stamp: "20260101000000".into(),
            ..Default::default()
        };
        for f in ["pes", "dst", "jef", "exp", "vp3", "xxx", "pec"] {
            let data = write_pattern(&p, f, "Test", &o).unwrap();
            let q = read_file(&data, &format!("t.{f}")).unwrap();
            assert_eq!(stitches(&q.records), stitches(&p), "{f}");
        }
        assert!(write_pattern(&p, "svg", "", &o).is_err());
    }
}
