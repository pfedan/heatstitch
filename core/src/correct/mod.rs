//! The correction (src/correct): fine corrections on the raw stitches and the engine behind the
//! traffic light. Pure functions of the records; making versions, what objects remember and
//! sewing objects anew stay TypeScript, which calls these once per design or object.

pub mod cover;
pub mod crop;
pub mod engine;
pub mod hidden;
pub mod nudge;
pub mod pullback;
pub mod respace;
pub mod satin_short;
pub mod shorts;
pub mod structure;
pub mod thin;
pub mod thin_hand;

use crate::pattern::{COLOR_CHANGE, TRIM};

/// TRIM and COLOR_CHANGE records carry no movement: they keep the position of the record before
/// (syncMarks in src/model/edit.ts).
pub fn sync_marks(x: &mut [i32], y: &mut [i32], cmd: &[u8]) {
    for i in 1..cmd.len() {
        if cmd[i] == TRIM || cmd[i] == COLOR_CHANGE {
            x[i] = x[i - 1];
            y[i] = y[i - 1];
        }
    }
}
