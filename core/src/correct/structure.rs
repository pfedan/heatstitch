//! Object structure recovered from the stitches alone (src/correct/structure.ts). Runs, turning
//! points and fill row ends are shared with the checks (validation/kinds.rs); satin columns are
//! the corrections' own.

pub use crate::validation::kinds::{
    RowEnd, Run, ZIGZAG_MIN, fill_row_ends, stitch_runs, turning_points,
};

/// A satin column: records start..end alternate between its two edges.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SatinColumn {
    pub start: usize,
    pub end: usize,
    pub run: usize,
}

pub fn satin_columns(runs: &[Run], mask: &[u8]) -> Vec<SatinColumn> {
    let mut out = vec![];
    for (ri, r) in runs.iter().enumerate() {
        let mut i = r.start + 1;
        while i <= r.end {
            if mask[i] != 0 {
                let mut j = i;
                while j < r.end && mask[j + 1] != 0 {
                    j += 1;
                }
                out.push(SatinColumn {
                    start: i - 1,
                    end: j,
                    run: ri,
                });
                i = j;
            }
            i += 1;
        }
    }
    out
}
