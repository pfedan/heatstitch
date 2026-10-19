import { core } from '../wasm/core';
import type { Lab, Rgb } from './color';
import type { LabImage, Raster } from './raster';

/**
 * Color quantization for embroidery: few colors, flat regions, no dithering. Weighted k-means on a
 * Lab histogram (Celebi, "Improving the performance of k-means for color quantization", Image Vis.
 * Comput. 29(4), 2011) with a saliency weight, so small accents keep a cluster of their own;
 * computed by the Rust core (core/src/image/quantize.rs).
 */

/** Pixels that are not quantized (transparent). */
export const NONE = 255;

export interface QuantizeOptions {
  /** Upper bound for the number of colors (2 to 16). */
  maxColors: number;
  /** The exact colors of a graphic (see graphicPalette): taken as they are when there are no more than `maxColors`. */
  palette?: Lab[];
}

export interface Quantized {
  centers: Lab[];
  /** Cluster per pixel, NONE for transparent pixels. */
  labels: Uint8Array;
}

const flat = (labs: Lab[]) => Float64Array.from(labs.flat());
const unflat = (v: Float64Array): Lab[] => Array.from({ length: v.length / 3 }, (_, k) => [v[k * 3], v[k * 3 + 1], v[k * 3 + 2]]);

/** Index of the nearest center per pixel (Euclidean in Lab). */
export const assign = (img: LabImage, centers: Lab[]): Uint8Array => core().assign(img.lab, img.opaque, img.width, img.height, flat(centers));

export function quantize(img: LabImage, o: QuantizeOptions): Quantized {
  if (o.palette?.length && o.palette.length <= o.maxColors) return { centers: o.palette, labels: assign(img, o.palette) };
  const out = core().quantize(img.lab, img.opaque, img.width, img.height, o.maxColors);
  const q = { centers: unflat(out.centers), labels: out.labels };
  out.free();
  return q;
}

/** Most colors a graphic can have of its own; with more it is quantized like a photo. */
export const MAX_OWN_COLORS = 16;

/**
 * The colors a flat graphic (a logo, clip art, a drawing; not a photo) is drawn in, exactly, or
 * null for a photo: every color that fills areas of its own, and each finer one that is not the
 * blend anti-aliasing puts between two others (see core/src/image/quantize.rs).
 */
export function graphicPalette(src: Raster): Rgb[] | null {
  const p = core().graphicPalette(src.data, src.width, src.height);
  if (!p) return null;
  return Array.from({ length: p.length / 3 }, (_, k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]);
}
