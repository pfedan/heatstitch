//! The compute core of heatstitch. Pure Rust in the area modules (no JavaScript types), so it runs
//! natively in `cargo test` too; `bind` exports it to the app as WebAssembly (src/wasm/core.ts).
//! The areas mirror the TypeScript directories under src/ they replace (docs/rust-core.md).

// Numeric code over pixels and points reads best with plain index loops, as in the papers it follows.
#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

pub mod density;
pub mod digitize;
pub mod geom;
pub mod image;
pub mod js;
pub mod parsers;
pub mod pattern;
pub mod shape;
pub mod trig;
pub mod validation;
pub mod writers;

mod bind;
