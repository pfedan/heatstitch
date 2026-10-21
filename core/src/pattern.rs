//! The stitches of a design as in src/model/pattern.ts: one entry per record, absolute coordinates
//! in 0.1 mm, y pointing down. Only the records and their colors; versions, objects and undo stay
//! in TypeScript.

use serde::{Deserialize, Serialize};

pub const STITCH: u8 = 0;
pub const JUMP: u8 = 1;
pub const TRIM: u8 = 2;
pub const COLOR_CHANGE: u8 = 3;
pub const END: u8 = 4;

/// A thread color as `ThreadColor` in TypeScript (plain object across the boundary).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pec_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog: Option<String>,
}

/// Bounds of STITCH records, 0.1 mm.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: i32,
    pub min_y: i32,
    pub max_x: i32,
    pub max_y: i32,
}

/// A sewing field in mm, as `Hoop` in src/model/hoop.ts (read from a file header or chosen).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Hoop {
    pub w: f64,
    pub h: f64,
}

/// The records of a design and one color per color block.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Records {
    pub x: Vec<i32>,
    pub y: Vec<i32>,
    pub cmd: Vec<u8>,
    pub colors: Vec<ThreadColor>,
}

impl Records {
    pub fn len(&self) -> usize {
        self.cmd.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cmd.is_empty()
    }

    /// Distance between records a and b (0.1 mm), with `Math.hypot` as JavaScript has it.
    pub fn dist(&self, a: usize, b: usize) -> f64 {
        crate::js::hypot(
            (self.x[b] - self.x[a]) as f64,
            (self.y[b] - self.y[a]) as f64,
        )
    }

    /// Bounds of the STITCH records (all zero without any), as computeBounds in TypeScript.
    pub fn bounds(&self) -> Bounds {
        compute_bounds(&self.x, &self.y, &self.cmd)
    }
}

pub fn compute_bounds(x: &[i32], y: &[i32], cmd: &[u8]) -> Bounds {
    let mut b: Option<Bounds> = None;
    for i in 0..cmd.len() {
        if cmd[i] != STITCH {
            continue;
        }
        let (px, py) = (x[i], y[i]);
        b = Some(match b {
            None => Bounds {
                min_x: px,
                min_y: py,
                max_x: px,
                max_y: py,
            },
            Some(o) => Bounds {
                min_x: o.min_x.min(px),
                min_y: o.min_y.min(py),
                max_x: o.max_x.max(px),
                max_y: o.max_y.max(py),
            },
        });
    }
    b.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_of_stitches_only() {
        let b = compute_bounds(&[5, -3, 100], &[1, 2, 100], &[STITCH, STITCH, JUMP]);
        assert_eq!(
            b,
            Bounds {
                min_x: -3,
                min_y: 1,
                max_x: 5,
                max_y: 2
            }
        );
        assert_eq!(compute_bounds(&[], &[], &[]), Bounds::default());
    }
}
