import { core } from '../wasm/core';

/**
 * Rasters for the image converter, computed by the Rust core (core/src/image/raster.rs).
 */

/** RGBA pixels, row by row; the same layout as ImageData, so it works in workers and tests. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Image in CIELAB, three floats per pixel, with a mask of the opaque pixels. */
export interface LabImage {
  width: number;
  height: number;
  lab: Float32Array;
  opaque: Uint8Array;
}

/** Pixels with less alpha are transparent: never sewn. */
export const ALPHA_MIN = 128;

/**
 * Resampling to w x h: area average for shrinking, Mitchell-Netravali cubic for enlarging. Color is
 * weighted by alpha, so transparent pixels do not darken the edges.
 */
export function resizeArea(src: Raster, w: number, h: number): Raster {
  return { width: w, height: h, data: core().resizeArea(src.data, src.width, src.height, w, h) };
}

/** Converts to Lab. */
export function toLab(src: Raster): LabImage {
  const out = core().toLab(src.data, src.width, src.height);
  const img = { width: src.width, height: src.height, lab: out.lab, opaque: out.opaque };
  out.free();
  return img;
}
