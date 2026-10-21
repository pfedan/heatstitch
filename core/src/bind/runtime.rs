//! The module itself: how much memory it holds, and starting it afresh after a trap.

use wasm_bindgen::prelude::*;

/// Bytes of WebAssembly memory the module holds (it grows, never shrinks); 0 natively.
#[wasm_bindgen(js_name = memoryBytes)]
pub fn memory_bytes() -> f64 {
    #[cfg(target_arch = "wasm32")]
    return (core::arch::wasm32::memory_size(0) * 65536) as f64;
    #[cfg(not(target_arch = "wasm32"))]
    0.0
}

/// Nothing to set up; the fresh instance resetCore asks for calls it all the same.
#[wasm_bindgen(start)]
pub fn start() {}

/// Has the next call start on a fresh instance of the module. After a trap (memory exhausted, a
/// panic: panic=abort cannot unwind) the instance is left mid-call, its memory full or its state
/// broken, so every later call would fail too.
#[wasm_bindgen(js_name = resetCore)]
pub fn reset_core() {
    wasm_bindgen::handler::schedule_reinit();
}
