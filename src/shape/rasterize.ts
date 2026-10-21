import { fromCore, type Region } from '../digitize/region';
import { core } from '../wasm/core';
import type { RegionData } from '../wasm/pkg/heatstitch_core';
import type { Form } from './path';

/**
 * Forms as pixel regions with the fields the fills are made from, and regions taken from, joined
 * with and measured against others. Rastering and the fields are computed by the Rust core
 * (core/src/shape/rasterize.rs).
 */

const made = (o: RegionData | undefined, pxMm: number): Region | null => (o ? fromCore(o, 0, pxMm) : null);

/**
 * The area of a form as pixels of `pxMm` (even-odd: paths inside others are holes; or nonzero for
 * forms marked so), with the fields the fills are made from. Only closed paths count. Null when it
 * covers no pixel.
 */
export function rasterize(f: Form, pxMm = 0.1): Region | null {
  return made(core().rasterize(f, pxMm), pxMm);
}

/** A region from a mask in its window (world pixel x0, y0), with its fields; null when empty. */
export function regionOf(mask: Uint8Array, x0: number, y0: number, w: number, h: number, pxMm: number): Region | null {
  return made(core().regionOf(mask, x0, y0, w, h, pxMm), pxMm);
}

/** How the ends of an open line are drawn: cut off square at the end, or round. */
export type LineCap = 'flat' | 'round';

/**
 * A line of the form drawn `width` mm wide (round corners; round ends, or flat with `cap`), as an
 * area: the strokes of SVG shapes. Open and closed paths count.
 */
export function rasterizeStroke(f: Form, width: number, pxMm = 0.1, cap: LineCap = 'round'): Region | null {
  return made(core().rasterizeStroke(f, width, pxMm, cap === 'flat'), pxMm);
}

// The pixel loops below stay TypeScript: copying masks and fields into the core costs more than
// they take (measured in the pull request "Rust core stage 2"); the fields are made by the core.

/**
 * `base` without what `covers` hide: a pixel goes when it lies deeper than `overlap` mm inside one
 * of them, so the area sewn first still reaches that far under the ones on top. Null when nothing
 * is left; `base` itself when nothing is hidden.
 */
export function knockOut(base: Region, covers: Region[], overlap: number): Region | null {
  const px = base.pxMm;
  const mask = base.mask.slice();
  let changed = false;
  for (const c of covers) {
    if (c.pxMm !== px) continue;
    // Overlap of the windows, in base pixels.
    const fx = Math.max(0, c.x0 - base.x0);
    const tx = Math.min(base.w, c.x0 + c.w - base.x0);
    const fy = Math.max(0, c.y0 - base.y0);
    const ty = Math.min(base.h, c.y0 + c.h - base.y0);
    for (let y = fy; y < ty; y++) {
      for (let x = fx; x < tx; x++) {
        const i = y * base.w + x;
        if (!mask[i]) continue;
        const d = c.sdfBase[(y + base.y0 - c.y0) * c.w + (x + base.x0 - c.x0)];
        if (d < -overlap) {
          mask[i] = 0;
          changed = true;
        }
      }
    }
  }
  if (!changed) return base;
  return regionOf(mask, base.x0, base.y0, base.w, base.h, px);
}

/** Pixels two regions share (of the same pixel size), in mm². */
export function sharedArea(a: Region, b: Region): number {
  if (a.pxMm !== b.pxMm) return 0;
  const fx = Math.max(a.x0, b.x0);
  const tx = Math.min(a.x0 + a.w, b.x0 + b.w);
  const fy = Math.max(a.y0, b.y0);
  const ty = Math.min(a.y0 + a.h, b.y0 + b.h);
  let n = 0;
  for (let y = fy; y < ty; y++) for (let x = fx; x < tx; x++) if (a.mask[(y - a.y0) * a.w + x - a.x0] && b.mask[(y - b.y0) * b.w + x - b.x0]) n++;
  return n * a.pxMm * a.pxMm;
}

/** Regions of the same pixel size as one. */
export function unionOf(rs: Region[]): Region | null {
  if (rs.length <= 1) return rs[0] ?? null;
  const px = rs[0].pxMm;
  const x0 = Math.min(...rs.map((r) => r.x0));
  const y0 = Math.min(...rs.map((r) => r.y0));
  const w = Math.max(...rs.map((r) => r.x0 + r.w)) - x0;
  const h = Math.max(...rs.map((r) => r.y0 + r.h)) - y0;
  const mask = new Uint8Array(w * h);
  for (const r of rs) {
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.mask[y * r.w + x]) mask[(y + r.y0 - y0) * w + x + r.x0 - x0] = 1;
  }
  return regionOf(mask, x0, y0, w, h, px);
}
