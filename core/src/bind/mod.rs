//! The WebAssembly exports: thin wrappers that turn typed arrays and plain objects (serde) into Rust
//! values and back. One file per area; names are camelCase on the JavaScript side.

mod correct;
mod density;
mod digitize;
mod fill;
mod image;
mod model;
mod parsers;
mod picture;
mod satin;
mod shape;
mod validation;
mod writers;
