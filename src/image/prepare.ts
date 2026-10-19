import type { ThreadColor } from '../model/pattern';
import { pecThreads } from '../parsers/pecPalette';
import { core } from '../wasm/core';
import { rgbToLab, type Lab, type Rgb } from './color';
import type { Orientation } from './orientation';
import { graphicPalette, NONE, quantize, type Quantized } from './quantize';
import type { LabImage, Raster } from './raster';
import { nearestThread } from './threadMatch';

/**
 * Turns any image into an image that can be embroidered: a few flat thread colors, regions large
 * enough to sew, no anti-aliasing seams, the background left out. Stages, each cached for the next
 * change of a later setting:
 *
 * 1. Resample to the working resolution and convert to Lab; smooth photos edge-preservingly.
 * 2. Quantize to at most `maxColors` colors.
 * 3. Match threads, apply the user's color changes and brush strokes, remove the background,
 *    clean up the regions.
 *
 * The stages are computed by the Rust core (core/src/image/prepare.rs); the Preparer here keeps
 * their results between runs.
 */

export interface PrepareOptions {
  /** Width of the design in mm; the height follows the image's aspect ratio. */
  widthMm: number;
  /** Most thread colors (2 to 16). */
  maxColors: number;
  /** Smoothing passes for photos (0 = off). */
  smooth: number;
  /** Regions below this area (mm²) are merged into their neighbours. */
  minAreaMm2: number;
  /** Leave the border-connected background unsewn. */
  background: boolean;
  /** Use the nearest Brother thread colors instead of the image's own colors. */
  threads: boolean;
}

export const DEFAULT_PREPARE: PrepareOptions = {
  widthMm: 80,
  maxColors: 6,
  smooth: 0,
  minAreaMm2: 3,
  background: true,
  threads: true,
};

/** A user's change to one color of the quantized image, keyed by the color it was found as. */
export interface ColorEdit {
  /** Color of the cluster as quantized (before thread matching). */
  from: Rgb;
  /** Not sewn, merged into another color (by its quantized color), or sewn with another thread. */
  skip?: boolean;
  merge?: Rgb;
  thread?: ThreadColor;
}

/** A brush stroke in image coordinates (0..1 of the width for x, of the height for y). */
export interface Stroke {
  points: [number, number][];
  /** Brush radius as a share of the image width. */
  radius: number;
  /**
   * Color painted with, as the `source` of a palette entry (so a later thread change of that color
   * applies to the painted pixels too); null erases (not sewn).
   */
  color: Rgb | null;
}

export interface PaletteEntry {
  /** Color shown and sewn. */
  thread: ThreadColor;
  lab: Lab;
  /** Color the cluster was quantized as, the key for color edits; equal to the thread for painted colors. */
  source: Rgb;
  /** CIEDE2000 between the image color and the thread (0 without thread matching). */
  deltaE: number;
  /** Area in mm² (also for skipped colors). */
  areaMm2: number;
  sew: boolean;
}

export interface Prepared {
  width: number;
  height: number;
  /** Millimetres per pixel. */
  pxMm: number;
  /** Palette index per pixel, NONE where nothing is sewn. */
  labels: Uint8Array;
  palette: PaletteEntry[];
  /** Direction of the image's own structure (fur, strands, strokes), for the stitch direction. */
  orient?: Orientation;
  /**
   * For a vector image: the palette entry each of its exact colors went to (after thread matching
   * and merging), -1 for none. The lines of an SVG take their thread from it (see redwork).
   */
  ofSource?: number[];
}

/** Working resolution: 0.1 mm per pixel, coarser for designs over 120 mm so the image stays near 1200 px. */
export function workingPxMm(widthMm: number, heightMm: number): number {
  return Math.max(0.1, Math.max(widthMm, heightMm) / 1200);
}

/** Size of the working image in pixels and mm per pixel, for a source of `srcW` × `srcH`. */
export function workingSize(widthMm: number, srcW: number, srcH: number): { w: number; h: number; pxMm: number } {
  const heightMm = (widthMm * srcH) / srcW;
  const pxMm = workingPxMm(widthMm, heightMm);
  return { w: Math.max(1, Math.round(widthMm / pxMm)), h: Math.max(1, Math.round(heightMm / pxMm)), pxMm };
}

/**
 * Colors and regions known exactly, from a vector image (see svg.ts): the palette index per pixel
 * at the working size, and the colors themselves. They replace smoothing and quantizing.
 */
export interface ExactLabels {
  width: number;
  height: number;
  labels: Uint8Array;
  colors: Rgb[];
}

export { nearestThread };

const THREADS = pecThreads();

/** Keeps the expensive stages of the last run and recomputes only what a change needs. */
export class Preparer {
  private smoothed: { key: string; img: LabImage; pxMm: number; orient: Orientation } | null = null;
  private quantized: { key: string; q: Quantized } | null = null;
  private own: Lab[] | null | undefined;

  constructor(private source: Raster) {}

  /** The exact colors of a graphic (see graphicPalette), null for a photo. */
  palette(): Lab[] | null {
    if (this.own === undefined) this.own = graphicPalette(this.source)?.map((c) => rgbToLab(...c)) ?? null;
    return this.own;
  }

  run(o: PrepareOptions, edits: ColorEdit[] = [], strokes: Stroke[] = [], exact?: ExactLabels): Prepared {
    const src = this.source;
    const { w, h, pxMm } = workingSize(o.widthMm, src.width, src.height);
    // Vector images are flat already: no smoothing.
    if (exact) o = { ...o, smooth: 0 };

    const smoothKey = `${w}x${h}:${o.smooth}`;
    if (this.smoothed?.key !== smoothKey) {
      // Resampled, in Lab, the direction of fur and strands (taken before smoothing flattens them),
      // then smoothed.
      const out = core().prepareSmooth(src.data, src.width, src.height, w, h, pxMm, o.smooth);
      const img = { width: w, height: h, lab: out.lab, opaque: out.opaque };
      const orient = { width: w, height: h, c: out.c, s: out.s };
      out.free();
      this.smoothed = { key: smoothKey, img, pxMm, orient };
      this.quantized = null;
    }
    const img = this.smoothed.img;
    if (exact && exact.width === w && exact.height === h) {
      const centers = exact.colors.map((c) => rgbToLab(...c));
      // Flat shapes have no structure of their own (the edges the tensor finds are those of other
      // shapes, and rows bent around them look restless): rows run straight.
      return finish(img, pxMm, centers, exact.labels, o, edits, strokes, exact.colors);
    }
    const qKey = `${o.maxColors}`;
    // A graphic in no more colors than allowed keeps exactly those (a fine line or ring in a color of
    // its own too); else the colors are clustered.
    if (this.quantized?.key !== qKey) this.quantized = { key: qKey, q: quantize(img, { maxColors: o.maxColors, palette: this.palette() ?? undefined }) };
    const { centers, labels: raw } = this.quantized.q;
    return { ...finish(img, pxMm, centers, raw, o, edits, strokes), orient: this.smoothed.orient };
  }
}

/**
 * Stage 3 in the core: thread matching, color changes, strokes, background and cleanup.
 * `sources` are the exact colors of a vector image (one per center): no anti-aliasing to clean up.
 */
function finish(
  img: LabImage,
  pxMm: number,
  centers: Lab[],
  raw: Uint8Array,
  o: PrepareOptions,
  edits: ColorEdit[],
  strokes: Stroke[],
  sources?: Rgb[],
): Prepared {
  const { width: w, height: h } = img;
  const out = core().prepareFinish(
    w,
    h,
    pxMm,
    Float64Array.from(centers.flat()),
    raw,
    o,
    edits,
    strokes,
    sources && Uint8Array.from(sources.flat()),
    THREADS,
  );
  const palette = out.palette as PaletteEntry[];
  const ofSource = out.ofSource && Array.from(out.ofSource);
  const labels = out.labels;
  out.free();
  return { width: w, height: h, pxMm, labels, palette, ...(ofSource ? { ofSource } : {}) };
}

export { NONE };
