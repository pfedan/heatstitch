//! Sewing in the model (src/model): what one object gives as stitches from its shape and how it is
//! sewn. The design's state (pattern versions, what each object remembers, undo) stays TypeScript;
//! these modules get plain specs and give runs of needle points back.

pub mod along;
pub mod applique;
pub mod covers;
pub mod fill;
pub mod line;
pub mod line_order;
pub mod order;
pub mod restitch;
pub mod runs;
pub mod sew;
pub mod trace;
pub mod travel;
