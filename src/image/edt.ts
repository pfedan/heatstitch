import { core } from '../wasm/core';

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled
 * Functions", Theory of Computing 8, 2012), computed by the Rust core (core/src/image/edt.rs).
 */

/**
 * Distance (pixels) from every pixel to the nearest seed pixel (`seed[i]` set). Without seeds all
 * distances are huge. With `border`, the ring of pixels just outside the image counts as seeds.
 */
export const distanceToSeeds = (seed: Uint8Array, w: number, h: number, border = false): Float32Array => core().distanceToSeeds(seed, w, h, border);

/** Distance from every inside pixel (mask set) to the nearest outside pixel; outside the image is outside. */
export const distanceInside = (mask: Uint8Array, w: number, h: number): Float32Array => core().distanceInside(mask, w, h);
