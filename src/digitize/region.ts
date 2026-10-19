import { core } from '../wasm/core';
import type { RegionData } from '../wasm/pkg/heatstitch_core';

/**
 * One connected color region, in its own pixel window, with a signed distance field.
 *
 * The field (negative inside, in mm) is what the stitch generators work on instead of traced
 * polygons: fill rows end where it crosses zero, satin rails are found by casting rays to its zero
 * level, underlay insets are its level sets. Its zero level lies halfway between inside and outside
 * pixel centers, so two neighbouring regions share the same boundary. A light blur rounds the pixel
 * steps (Ink/Stitch smooths traced outlines for the same reason).
 *
 * Fields, outlines and grown or shrunk regions are computed by the Rust core
 * (core/src/digitize/region.rs); `sample` and `pixelMm`, called per point, stay here.
 */
export interface Region {
  label: number;
  /** Window in image pixels; the mask has a margin of empty pixels around the region. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  pxMm: number;
  /** Region pixels (without the overlap into neighbours). */
  mask: Uint8Array;
  /** Distance of each region pixel to the nearest pixel outside, in pixels. */
  inside: Float32Array;
  /** Signed distance in mm, negative inside, of the region grown by the overlap. */
  sdf: Float32Array;
  /** Signed distance in mm of the region itself (for satin and running stitch). */
  sdfBase: Float32Array;
  areaMm2: number;
}

/** Empty pixels round a region in its window (as core/src/digitize/region.rs has them). */
const MARGIN = 6;

/** A region the core made, put together as an object (each array crosses once). */
export function fromCore(o: RegionData, label: number, pxMm: number, dx = 0, dy = 0): Region {
  const sdfBase = o.takeSdfBase();
  const region: Region = { label, x0: o.x0 + dx, y0: o.y0 + dy, w: o.w, h: o.h, pxMm, mask: o.takeMask(), inside: o.takeInside(), sdf: o.grown ? o.takeSdf() : sdfBase, sdfBase, areaMm2: o.areaMm2 };
  o.free();
  return region;
}

export function maskHash(mask: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < mask.length; i++) if (mask[i]) h = Math.imul(h ^ i, 16777619);
  return h >>> 0;
}

/**
 * The signed field of a mask (mm, negative inside, lightly blurred), computed by the core
 * (core/src/digitize/region.rs), which keeps the last ones: sewing an object anew rasters the same
 * area again and again, and the distance transforms are the costly part.
 */
export const signedField = (mask: Uint8Array, w: number, h: number, pxMm: number): Float32Array => core().signedField(mask, w, h, pxMm);

export function sameMask(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!a[i] !== !b[i]) return false;
  return true;
}

/**
 * Builds the region for component `comp`. `grow` (mm) extends the fill field into neighbouring
 * pixels for which `growInto(label)` holds: objects sewn earlier reach a little under the ones sewn
 * later, so no fabric shows between them.
 */
export function buildRegion(
  compMap: Int32Array,
  labels: Uint8Array,
  imgW: number,
  comp: number,
  label: number,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  imgH: number,
  pxMm: number,
  grow: number,
  growInto: (label: number) => boolean,
): Region {
  // Only the region's window (with its margin, inside the picture) crosses, not the whole picture.
  const m = MARGIN + Math.ceil(grow / pxMm);
  const [cx0, cy0] = [Math.max(0, bbox.minX - m), Math.max(0, bbox.minY - m)];
  const [cx1, cy1] = [Math.min(imgW, bbox.maxX + 1 + m), Math.min(imgH, bbox.maxY + 1 + m)];
  const [cw, ch] = [cx1 - cx0, cy1 - cy0];
  const map = new Int32Array(cw * ch);
  const near = new Uint8Array(grow > 0 ? cw * ch : 0);
  for (let y = 0; y < ch; y++) {
    const row = (y + cy0) * imgW + cx0;
    map.set(compMap.subarray(row, row + cw), y * cw);
    if (grow > 0) near.set(labels.subarray(row, row + cw), y * cw);
  }
  // Labels are bytes: the predicate crosses as a table.
  const into = new Uint8Array(256);
  if (grow > 0) for (let l = 0; l < 256; l++) into[l] = growInto(l) ? 1 : 0;
  const o = core().buildRegion(map, near, cw, comp, label, bbox.minX - cx0, bbox.minY - cy0, bbox.maxX - cx0, bbox.maxY - cy0, ch, pxMm, grow, into);
  return fromCore(o, label, pxMm, cx0, cy0);
}

/** Bilinear sample of a field at image mm coordinates; far outside the window is "outside". */
export function sample(r: Region, field: Float32Array, xMm: number, yMm: number): number {
  const u = xMm / r.pxMm - 0.5 - r.x0;
  const v = yMm / r.pxMm - 0.5 - r.y0;
  if (u < 0 || v < 0 || u > r.w - 1 || v > r.h - 1) return 10;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const i1 = Math.min(r.w - 1, i + 1);
  const j1 = Math.min(r.h - 1, j + 1);
  const a = field[j * r.w + i];
  const b = field[j * r.w + i1];
  const c = field[j1 * r.w + i];
  const d = field[j1 * r.w + i1];
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

/** Image mm coordinates of the center of window pixel (x, y). */
export const pixelMm = (r: Region, x: number, y: number): [number, number] => [(x + r.x0 + 0.5) * r.pxMm, (y + r.y0 + 0.5) * r.pxMm];

/**
 * Outline of a region: the zero level of its own signed distance, as closed polylines in mm
 * (marching squares between pixel centers, the crossings interpolated); with `level`, the line
 * that far outside (+) or inside (-) the edge of `field`.
 */
export function outline(r: Region, level = 0, field = r.sdfBase): [number, number][][] {
  const flat = core().outline(field, r.w, r.h, r.x0, r.y0, r.pxMm, level);
  const out: [number, number][][] = [];
  for (let i = 0; i < flat.length; ) {
    const n = flat[i++];
    const line: [number, number][] = new Array(n);
    for (let k = 0; k < n; k++, i += 2) line[k] = [flat[i], flat[i + 1]];
    out.push(line);
  }
  return out;
}

/**
 * The region grown (`mm` > 0) or shrunk (`mm` < 0) on all sides by that distance (Ink/Stitch's
 * expand): its window gets wider by as much, and its fields are made anew. Null when nothing is
 * left of it.
 */
export function expandRegion(r: Region, mm: number): Region | null {
  if (Math.abs(mm) < 1e-3) return r;
  const o = core().expandRegion(r.label, r.x0, r.y0, r.w, r.h, r.pxMm, r.sdf, mm);
  return o ? fromCore(o, r.label, r.pxMm) : null;
}
