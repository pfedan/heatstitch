import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import type { Region } from './region';
import type { Pt } from './skeleton';

/** Measurements of generated stitches, to check them before they are used. */

/**
 * Thread per area (mm/mm²) at the densest 1 mm cell of the runs. A satin column reaches about
 * 2 / spacing; where a tight bend fans its stitches or columns pile up, the generated satin is
 * measured instead of predicted. Cells where `skip` holds for their middle are not counted.
 */
export function peakDensity(runs: Pt[][], skip?: (x: number, y: number) => boolean): number {
  return peakCell(runs, skip).density;
}

/** The densest 1 mm cell of the runs (see peakDensity): its density and its middle. */
export function peakCell(runs: Pt[][], skip?: (x: number, y: number) => boolean): { density: number; at: Pt } {
  const cells = new Map<number, number>();
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const [x0, y0] = run[i - 1];
      const [x1, y1] = run[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len / 0.2));
      for (let k = 0; k < n; k++) {
        const x = x0 + ((x1 - x0) * (k + 0.5)) / n;
        const y = y0 + ((y1 - y0) * (k + 0.5)) / n;
        const key = Math.floor(x) * 100003 + Math.floor(y);
        cells.set(key, (cells.get(key) ?? 0) + len / n);
      }
    }
  }
  let best = { density: 0, at: [0, 0] as Pt };
  for (const [key, v] of cells) {
    if (v <= best.density) continue;
    const x = Math.round(key / 100003);
    const at: Pt = [x + 0.5, key - x * 100003 + 0.5];
    if (skip?.(at[0], at[1])) continue;
    best = { density: v, at };
  }
  return best;
}

/**
 * Share of the region's pixels within `radMm` (0.2 mm) of a stitch. That closes the gaps of a satin column
 * (its stitches lie at most one spacing apart), not those between columns fanning out from a
 * junction, which a triangle or a blot would get.
 */
export function coverage(r: Region, runs: Pt[][], radMm = 0.2): number {
  // One call per object: the stamping is the costly part, done by the core (core/src/digitize/measure.rs).
  const { flat, lens } = flatLines(runs);
  return core().coverage(r.mask, r.w, r.h, r.x0, r.y0, r.pxMm, flat, lens, radMm);
}
