import { core } from '../wasm/core';
import type { LabImage, Raster } from './raster';

/**
 * Edge-preserving smoothing for photos: a bilateral filter (Tomasi & Manduchi 1998) in Lab,
 * applied separably along rows and columns and iterated, as in real-time video abstraction
 * (Winnemöller, Olsen & Gooch 2006), computed by the Rust core (core/src/image/filters.rs).
 *
 * `sigmaS` is the spatial sigma in pixels, `sigmaR` the range sigma in Lab units.
 */
export function bilateral(img: LabImage, iterations: number, sigmaS: number, sigmaR: number): LabImage {
  return { ...img, lab: core().bilateral(img.lab, img.opaque, img.width, img.height, iterations, sigmaS, sigmaR) };
}

/**
 * Photo or graphic: in logos and clip art a few exact colors cover almost every pixel; in photos
 * no small set does. Used to suggest how much to smooth.
 */
export const looksLikePhoto = (src: Raster): boolean => core().looksLikePhoto(src.data, src.width, src.height);
