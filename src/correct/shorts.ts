import { removeStitches } from '../model/edit';
import { STITCH, type Pattern } from '../model/pattern';
import { tagShortStitches, SHORT } from '../validation/shortStitches';
import { SHORT_STITCH_MM } from '../validation/thresholds';

/** Merged stitches may deviate at most this far (0.1 mm) from the original path. */
const MERGE_TOLERANCE = 3;
/** Merging never creates a stitch longer than this (0.1 mm). */
const MERGE_MAX_LEN = 70;

/**
 * Removes stitches that do not move (same position as the stitch before). They add a second
 * penetration into the same hole and nothing else, so removing them never changes the stitch-out.
 */
export function removeZeroLength(p: Pattern, wanted: (i: number) => boolean = () => true): { pattern: Pattern; removed: number } {
  const remove = new Uint8Array(p.cmd.length);
  let count = 0;
  for (let i = 1; i < p.cmd.length; i++) {
    if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH && p.x[i] === p.x[i - 1] && p.y[i] === p.y[i - 1] && wanted(i)) {
      remove[i] = 1;
      count++;
    }
  }
  return { pattern: count ? removeStitches(p, remove) : p, removed: count };
}

/** Distance (0.1 mm) of point q from the segment a-b. */
function deviation(ax: number, ay: number, bx: number, by: number, qx: number, qy: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - qx, ay + t * dy - qy);
}

/**
 * Merges chains of short stitches (the ones the short-stitch rule counts, tie stitches excluded)
 * where `wanted(i)` is set: a stitch point is dropped while the stitch from the last kept point
 * stays shorter than SHORT_STITCH_MM, every dropped point stays within MERGE_TOLERANCE of the new
 * stitch, and the new stitch stays below MERGE_MAX_LEN. Tight curves of running stitch get coarser
 * but keep their shape; narrow zigzag columns are left alone (their points deviate too far) and
 * are thinned instead.
 */
export function mergeShortStitches(p: Pattern, wanted: (i: number) => boolean): { pattern: Pattern; removed: number } {
  const tags = tagShortStitches(p);
  const n = p.cmd.length;
  const remove = new Uint8Array(n);
  const minLen = SHORT_STITCH_MM * 10;
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (p.cmd[s] !== STITCH) continue;
    let e = s;
    while (e + 1 < n && p.cmd[e + 1] === STITCH) e++;
    let anchor = s;
    let dropped: number[] = [];
    for (let i = s + 1; i < e; i++) {
      const ok =
        tags[i] === SHORT &&
        wanted(i) &&
        Math.hypot(p.x[i] - p.x[anchor], p.y[i] - p.y[anchor]) < minLen &&
        Math.hypot(p.x[i + 1] - p.x[anchor], p.y[i + 1] - p.y[anchor]) <= MERGE_MAX_LEN &&
        [...dropped, i].every(
          (q) => deviation(p.x[anchor], p.y[anchor], p.x[i + 1], p.y[i + 1], p.x[q], p.y[q]) <= MERGE_TOLERANCE,
        );
      if (ok) {
        dropped.push(i);
        remove[i] = 1;
        count++;
      } else {
        anchor = i;
        dropped = [];
      }
    }
    s = e;
  }
  return { pattern: count ? removeStitches(p, remove) : p, removed: count };
}
