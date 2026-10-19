import { core } from '../wasm/core';
import { NONE } from './quantize';

/**
 * Operations on label maps (one palette index per pixel, NONE = not sewn): connected components
 * with their adjacency, and the cleanup that turns a quantized image into regions that can be
 * embroidered, as commercial tools describe it and as the Goldman patent (US 6,836,695) does it:
 * small objects are reassigned to their neighbours. Computed by the Rust core
 * (core/src/image/labels.rs).
 */

export interface Components {
  /** Component per pixel. */
  comp: Int32Array;
  /** Per component: label, pixel count, bounding box. */
  label: number[];
  area: number[];
  minX: number[];
  minY: number[];
  maxX: number[];
  maxY: number[];
}

/**
 * 4-connected components of equal labels (two-pass union-find). 4-connectivity keeps every region
 * a union of whole pixel squares, so outlines never pinch at a diagonal.
 */
export function components(labels: Uint8Array | Uint16Array, w: number, h: number): Components {
  const out = core().components(labels instanceof Uint16Array ? labels : Uint16Array.from(labels), w, h);
  const c: Components = {
    comp: out.comp,
    label: Array.from(out.label),
    area: Array.from(out.area),
    minX: Array.from(out.minX),
    minY: Array.from(out.minY),
    maxX: Array.from(out.maxX),
    maxY: Array.from(out.maxY),
  };
  out.free();
  return c;
}

/**
 * Narrow details that are not specks: a band at least this many times as long as it is wide
 * (length to width, as for a region kept as a line or a satin column).
 */
export const BAND_RATIO = 4;

/**
 * Which components of `labels` (as `components` numbers them) are bands (see BAND_RATIO): long and
 * narrow, judged by the width at the widest place (Blum's medial axis radius) and the area over it.
 * Only sewn regions: a narrow gap of background stays a gap.
 */
export const bands = (_c: Components, labels: Uint8Array, w: number, h: number, pxMm: number): Uint8Array => core().bands(labels, w, h, pxMm);

/**
 * Merges every component smaller than `minArea` pixels into the neighbour it shares the longest
 * border with, smallest first, until none is left. NONE regions take part too, so small holes in a
 * region are closed and stray pixels on the background disappear. With `pxMm` given, bands (long
 * narrow details, see `bands`) stay whatever their area: a vein or a fine ring is a detail, not a
 * speck.
 */
export const mergeSmall = (labels: Uint8Array, w: number, h: number, minArea: number, pxMm?: number): Uint8Array =>
  core().mergeSmall(labels, w, h, minArea, pxMm);

/**
 * Removes anti-aliasing seams: thin components (inscribed width below `maxWidth` pixels) whose
 * color lies between the colors of the two regions they separate. A thin component in a color of
 * its own (a drawn line) is kept; it will be sewn as a running stitch or satin.
 */
export function removeSeams(
  labels: Uint8Array,
  w: number,
  h: number,
  maxWidth: number,
  between: (seam: number, a: number, b: number) => boolean,
): Uint8Array {
  // `between` is asked once per triple of the labels present (a palette has a few), so the core
  // gets a table instead of calling back into JavaScript.
  let n = 0;
  for (const l of labels) if (l !== NONE && l >= n) n = l + 1;
  const table = new Uint8Array(n * n * n);
  for (let s = 0; s < n; s++) {
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) if (s !== a && s !== b && a !== b && between(s, a, b)) table[(s * n + a) * n + b] = 1;
    }
  }
  return core().removeSeams(labels, w, h, maxWidth, table, n);
}

/**
 * Background: the label covering at least 60 % of the image border (and three of its corners) is
 * removed where it is connected to the border (4-connected flood fill), so the same color inside the
 * design (eyes, the counters of letters) is still sewn.
 */
export const removeBackground = (labels: Uint8Array, w: number, h: number): Uint8Array => core().removeBackground(labels, w, h);
