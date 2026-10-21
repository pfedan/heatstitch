//! Spiral fill: one line that winds from the edge to the middle, its turns one spacing apart all
//! round, in any shape (see rings.rs). A shape that branches (a dumbbell) or has holes gets a spiral
//! per branch, joined under rows still to come. None only when the shape is too small for a ring.

use super::fill::{FillParams, FillResult};
use super::region::Region;
use super::rings::{RingMode, ring_fill};
use crate::geom::Pt;

pub fn spiral_fill(r: &Region, p: &FillParams, start: Pt) -> Option<FillResult> {
    let mut res = ring_fill(r, p, start, RingMode::Spiral, -45.0)?;
    res.angle = 0.0;
    Some(res)
}
