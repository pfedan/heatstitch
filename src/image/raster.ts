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

/** Converts to Lab. */
export function toLab(src: Raster): LabImage {
  const out = core().toLab(src.data, src.width, src.height);
  const img = { width: src.width, height: src.height, lab: out.lab, opaque: out.opaque };
  out.free();
  return img;
}
