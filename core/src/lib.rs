//! The compute core of heatstitch. Pure Rust in the area modules (no JavaScript types), so it runs
//! natively in `cargo test` too; `bind` exports it to the app as WebAssembly (src/wasm/core.ts).

// Numeric code over pixels and points reads best with plain index loops, as in the papers it follows.
#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

pub mod image;

mod bind;
