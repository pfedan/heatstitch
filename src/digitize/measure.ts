import type { Region } from './region';
import type { Pt } from './skeleton';

/** Measurements of generated stitches, to check them before they are used. */

/**
 * Thread per area (mm/mm²) at the densest 1 mm cell of the runs. A satin column reaches about
 * 2 / spacing; where a tight bend fans its stitches or columns pile up, the generated satin is
 * measured instead of predicted.
 */
export function peakDensity(runs: Pt[][]): number {
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
  let max = 0;
  for (const v of cells.values()) max = Math.max(max, v);
  return max;
}

/**
 * Share of the region's pixels within `radMm` (0.2 mm) of a stitch. That closes the gaps of a satin column
 * (its stitches lie at most one spacing apart), not those between columns fanning out from a
 * junction, which a triangle or a blot would get.
 */
export function coverage(r: Region, runs: Pt[][], radMm = 0.2): number {
  const hit = new Uint8Array(r.mask.length);
  const rad = Math.max(1, Math.round(radMm / r.pxMm));
  const step = r.pxMm / 2;
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const [x0, y0] = run[i - 1];
      const [x1, y1] = run[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 0; k <= n; k++) {
        const cx = Math.floor((x0 + ((x1 - x0) * k) / n) / r.pxMm) - r.x0;
        const cy = Math.floor((y0 + ((y1 - y0) * k) / n) / r.pxMm) - r.y0;
        for (let dy = -rad; dy <= rad; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= r.h) continue;
          for (let dx = -rad; dx <= rad; dx++) {
            const x = cx + dx;
            if (x >= 0 && x < r.w) hit[y * r.w + x] = 1;
          }
        }
      }
    }
  }
  let inside = 0;
  let covered = 0;
  for (let i = 0; i < r.mask.length; i++) {
    if (!r.mask[i]) continue;
    inside++;
    covered += hit[i];
  }
  return inside ? covered / inside : 1;
}
