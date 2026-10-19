import { core } from '../wasm/core';

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled
 * Functions", Theory of Computing 8, 2012), computed by the Rust core (core/src/image/edt.rs).
 */

/** Distance from every inside pixel (mask set) to the nearest outside pixel; outside the image is outside. */
export const distanceInside = (mask: Uint8Array, w: number, h: number): Float32Array => core().distanceInside(mask, w, h);
