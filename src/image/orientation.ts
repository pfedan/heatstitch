import { core } from '../wasm/core';
import type { LabImage } from './raster';

/**
 * Local direction of the image's own structure: hair, fur, grain, the strokes of a drawing, from the
 * structure tensor (Förstner & Gülch 1987, Bigün & Granlund 1987; Weickert 1999; Kang, Lee & Chui,
 * "Coherent Line Drawing", 2007), computed by the Rust core (core/src/image/orientation.rs).
 *
 * The result is a line field (directions without a sign) in the doubled-angle form: per pixel
 * (cos 2θ, sin 2θ) of the direction along the structure, scaled by its coherence (0 to 1).
 * Doubled angles can be averaged and smoothed directly.
 */
export interface Orientation {
  width: number;
  height: number;
  /** Coherence times cos 2θ, sin 2θ of the direction along the structure (y down). */
  c: Float32Array;
  s: Float32Array;
}

/**
 * Structure tensor orientation of the image, integrated over about `sigma` pixels. Gradients come
 * from all three Lab channels (Di Zenzo), so a border between two colors of equal lightness counts.
 */
export function orientation(img: LabImage, sigma: number): Orientation {
  const out = core().orientation(img.lab, img.width, img.height, sigma);
  const o = { width: img.width, height: img.height, c: out.c, s: out.s };
  out.free();
  return o;
}
