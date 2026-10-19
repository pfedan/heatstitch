import { core } from '../wasm/core';

/** Separable Gaussian blur with zero padding; preserves the sum as long as values sit >= 3 sigma from the edge. */
export const gaussianBlur = (src: Float32Array, cols: number, rows: number, sigma: number): Float32Array => core().gaussianBlur(src, cols, rows, sigma);
