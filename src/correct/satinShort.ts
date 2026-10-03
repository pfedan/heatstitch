import { syncMarks, withRecords } from '../model/edit';
import type { Pattern } from '../model/pattern';
import { satinColumns } from './structure';

/**
 * Short stitches on the inside of satin curves and corners.
 *
 * Where a satin column turns, its inner edge is shorter than the outer one, so the penetrations
 * there crowd together: thread piles up and the holes can cut the fabric. Digitizing programs
 * counter this with "short stitches": every second stitch on the crowded side stops short of the
 * edge. The outline stays closed (the full-length stitches still reach it) and the inner edge gets
 * half the penetrations.
 */

/** A side counts as crowded where its spacing is below this share of the opposite side's. */
const CROWDED = 0.5;
/** Short stitches end this share of the column width before the edge. */
const SHORTEN = 0.25;

export interface SatinShortOptions {
  /** Penetrations that may move (record index). */
  wanted: (i: number) => boolean;
}

export function shortenSatinCurves(p: Pattern, opts: SatinShortOptions): { pattern: Pattern; moved: number } {
  const x = p.x.slice();
  const y = p.y.slice();
  const d = (a: number, b: number) => Math.hypot(p.x[b] - p.x[a], p.y[b] - p.y[a]);
  let moved = 0;
  for (const c of satinColumns(p)) {
    const { start, end } = c;
    if (end - start < 6) continue;
    // Same-side spacing around each penetration.
    const sp = new Float64Array(end - start + 1);
    for (let k = start; k <= end; k++) {
      let s = 0;
      let n = 0;
      if (k - 2 >= start) {
        s += d(k - 2, k);
        n++;
      }
      if (k + 2 <= end) {
        s += d(k, k + 2);
        n++;
      }
      sp[k - start] = n ? s / n : 0;
    }
    for (let k = start + 1; k < end; k++) {
      // Every second penetration of a side; the others keep the edge closed.
      if (((k - start) >> 1) % 2 === 0) continue;
      const opposite = (sp[k - 1 - start] + sp[k + 1 - start]) / 2;
      if (!(sp[k - start] < CROWDED * opposite) || !opts.wanted(k)) continue;
      const tx = (p.x[k - 1] + p.x[k + 1]) / 2;
      const ty = (p.y[k - 1] + p.y[k + 1]) / 2;
      x[k] = Math.round(p.x[k] + (tx - p.x[k]) * SHORTEN);
      y[k] = Math.round(p.y[k] + (ty - p.y[k]) * SHORTEN);
      if (x[k] !== p.x[k] || y[k] !== p.y[k]) moved++;
    }
  }
  if (!moved) return { pattern: p, moved: 0 };
  syncMarks(x, y, p.cmd);
  return { pattern: withRecords(p, x, y, p.cmd.slice()), moved };
}
