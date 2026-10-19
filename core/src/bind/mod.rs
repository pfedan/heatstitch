//! The WebAssembly exports: thin wrappers that turn typed arrays and plain objects (serde) into Rust
//! values and back. One file per area; names are camelCase on the JavaScript side.

mod density;
mod digitize;
mod image;
mod parsers;
mod satin;
mod shape;
mod validation;
mod writers;
