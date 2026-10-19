import { core } from '../wasm/core';

/** Normalized Gaussian kernel of radius ceil(3 sigma), computed by the Rust core (core/src/density/blur.rs). */
export const gaussianKernel = (sigma: number): Float32Array => core().gaussianKernel(sigma);

/** Separable Gaussian blur with zero padding; preserves the sum as long as values sit >= 3 sigma from the edge. */
export const gaussianBlur = (src: Float32Array, cols: number, rows: number, sigma: number): Float32Array => core().gaussianBlur(src, cols, rows, sigma);
