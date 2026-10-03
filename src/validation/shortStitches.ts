import { STITCH, type Pattern } from '../model/pattern';
import { SHORT_STITCH_MM } from './thresholds';

/** Record ends a short stitch that counts towards the cluster rule. */
export const SHORT = 1;
/** Record ends a short stitch of a tie-in or tie-off run (exempt from the checks). */
export const TIE = 2;

/** Lock stitches are a handful of stitches; longer runs of short stitches are real stitching. */
export const TIE_MAX = 6;

/**
 * Tags every stitch record whose incoming stitch is shorter than SHORT_STITCH_MM. Up to TIE_MAX
 * short stitches directly after the first stitch of a block (after a jump, trim, color change or
 * the design start: tie-in) or directly before its last stitch (tie-off) are ties.
 */
export function tagShortStitches(p: Pattern): Uint8Array {
  const n = p.cmd.length;
  const tags = new Uint8Array(n);
  const limit = SHORT_STITCH_MM * 10;
  const isStitch = (i: number) => i >= 0 && i < n && p.cmd[i] === STITCH;
  const isShort = (i: number) =>
    isStitch(i) && isStitch(i - 1) && Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) < limit;

  for (let a = 0; a < n; a++) {
    if (!isShort(a)) continue;
    let b = a;
    while (isShort(b + 1)) b++;
    tags.fill(SHORT, a, b + 1);
    if (!isStitch(a - 2)) tags.fill(TIE, a, Math.min(b, a + TIE_MAX - 1) + 1); // a - 1 starts its block
    if (!isStitch(b + 1)) tags.fill(TIE, Math.max(a, b - TIE_MAX + 1), b + 1); // b ends its block
    a = b;
  }
  return tags;
}

/** Counts non-exempt short stitches per 1 mm cell. */
export function shortStitchCounts(
  p: Pattern,
  tags: Uint8Array,
  originX: number,
  originY: number,
  cols: number,
  rows: number,
): Uint16Array {
  const counts = new Uint16Array(cols * rows);
  for (let k = 0; k < tags.length; k++) {
    if (tags[k] !== SHORT) continue;
    const cx = Math.floor(p.x[k] / 10 - originX);
    const cy = Math.floor(p.y[k] / 10 - originY);
    if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) counts[cy * cols + cx]++;
  }
  return counts;
}
