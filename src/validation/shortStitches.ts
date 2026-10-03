import { STITCH, type Pattern } from '../model/pattern';
import { SHORT_STITCH_MM } from './thresholds';

/**
 * Counts short stitches (< SHORT_STITCH_MM) per 1 mm cell. A run of consecutive short stitches is
 * ignored when it directly follows the first stitch of a block (after a jump, trim, color change or
 * the design start: tie-in) or ends at the last stitch of a block (tie-off).
 */
export function shortStitchCounts(
  p: Pattern,
  originX: number,
  originY: number,
  cols: number,
  rows: number,
): Uint16Array {
  const counts = new Uint16Array(cols * rows);
  const n = p.cmd.length;
  const limit = SHORT_STITCH_MM * 10;
  const isStitch = (i: number) => i >= 0 && i < n && p.cmd[i] === STITCH;
  const isShort = (i: number) =>
    isStitch(i) && isStitch(i - 1) && Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) < limit;

  for (let a = 0; a < n; a++) {
    if (!isShort(a)) continue;
    let b = a;
    while (isShort(b + 1)) b++;
    const tieIn = !isStitch(a - 2); // stitch a - 1 starts its block
    const tieOff = !isStitch(b + 1); // stitch b ends its block
    if (!tieIn && !tieOff) {
      for (let k = a; k <= b; k++) {
        const cx = Math.floor(p.x[k] / 10 - originX);
        const cy = Math.floor(p.y[k] / 10 - originY);
        if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) counts[cy * cols + cx]++;
      }
    }
    a = b;
  }
  return counts;
}
