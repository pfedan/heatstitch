import { STITCH, type Pattern } from '../model/pattern';

/** Minimum number of consecutive zigzag segments to call a run satin. */
export const SATIN_MIN_RUN = 4;
const MIN_LEN = 10; // 1.0 mm in 0.1 mm units
const MAX_LEN = 121; // 12.1 mm, the DST maximum
/** Consecutive segments must point in roughly opposite directions (angle > ~134°). */
const MAX_DOT = -0.7;
const MAX_RATIO = 2;

/**
 * Marks satin segments: mask[i] = 1 if the stitch segment ending at record i belongs to a run of
 * at least SATIN_MIN_RUN consecutive stitch-to-stitch segments that zigzag back and forth with
 * similar lengths (a column stitch).
 */
export function satinMask(p: Pattern): Uint8Array {
  const n = p.cmd.length;
  const mask = new Uint8Array(n);
  const len = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) {
      len[i] = Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]);
    }
  }
  const valid = (i: number) => len[i] >= MIN_LEN && len[i] <= MAX_LEN;
  const zigzag = (i: number) => {
    // segment i follows segment i - 1 directly
    if (!valid(i) || !valid(i - 1)) return false;
    const r = len[i] / len[i - 1];
    if (r > MAX_RATIO || r < 1 / MAX_RATIO) return false;
    const dot =
      (p.x[i] - p.x[i - 1]) * (p.x[i - 1] - p.x[i - 2]) + (p.y[i] - p.y[i - 1]) * (p.y[i - 1] - p.y[i - 2]);
    return dot / (len[i] * len[i - 1]) < MAX_DOT;
  };

  let start = -1; // first segment of the current run
  const close = (end: number) => {
    if (start >= 0 && end - start + 1 >= SATIN_MIN_RUN) mask.fill(1, start, end + 1);
    start = -1;
  };
  for (let i = 1; i < n; i++) {
    if (!valid(i)) {
      close(i - 1);
      continue;
    }
    if (start < 0) start = i;
    else if (!zigzag(i)) {
      close(i - 1);
      start = i;
    }
  }
  close(n - 1);
  return mask;
}
