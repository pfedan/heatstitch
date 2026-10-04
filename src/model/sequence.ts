import { fillRowEnds, stitchRuns, ZIGZAG_MIN } from '../correct/structure';
import { satinMask } from '../validation/satin';
import { tagShortStitches, TIE } from '../validation/shortStitches';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';

/**
 * How the machine works through a design: color blocks in sewing order, what kind of stitch each
 * stitch is, and where it moves without sewing. Everything here is derived from the records alone.
 */

const GREY: ThreadColor = { r: 128, g: 128, b: 128 };

export interface ColorBlock {
  index: number;
  color: ThreadColor;
  /** First and last record of the block (the COLOR_CHANGE that opens it belongs to the block before). */
  first: number;
  last: number;
  stitches: number;
  /** Thread on the fabric in mm. */
  threadMm: number;
  trims: number;
}

/** Block index per record; a COLOR_CHANGE record still belongs to the block it closes. */
export function blockIndex(p: Pattern): Uint16Array {
  const out = new Uint16Array(p.cmd.length);
  let b = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    out[i] = b;
    if (p.cmd[i] === COLOR_CHANGE) b++;
  }
  return out;
}

export function colorBlocks(p: Pattern): ColorBlock[] {
  const out: ColorBlock[] = [];
  let cur: ColorBlock | null = null;
  let prevStitch = false;
  const open = (i: number) => {
    const index = out.length;
    cur = { index, color: p.colors[index] ?? p.colors[p.colors.length - 1] ?? GREY, first: i, last: i, stitches: 0, threadMm: 0, trims: 0 };
    out.push(cur);
  };
  for (let i = 0; i < p.cmd.length; i++) {
    if (!cur) open(i);
    const b = cur!;
    const c = p.cmd[i];
    b.last = i;
    if (c === STITCH) {
      b.stitches++;
      if (prevStitch) b.threadMm += Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;
    } else if (c === TRIM) b.trims++;
    prevStitch = c === STITCH;
    if (c === COLOR_CHANGE) cur = null;
  }
  // A trailing color change without stitches after it opens no block.
  return out.filter((b) => b.stitches > 0 || out.length === 1);
}

export const RUNNING = 1;
export const SATIN = 2;
export const FILL = 3;
export const TIE_STITCH = 4;
export type StitchKind = typeof RUNNING | typeof SATIN | typeof FILL | typeof TIE_STITCH;

/**
 * Kind of the stitch ending at each record (0 where no stitch ends): satin columns, fill rows,
 * tie-in and tie-off stitches, and running stitch for everything else (outlines, travel, underlay).
 */
export function stitchKinds(p: Pattern): Uint8Array {
  const n = p.cmd.length;
  const out = new Uint8Array(n);
  const satin = satinMask(p);
  // Narrow satin outlines count as satin too, down to 0.3 mm wide.
  const narrow = satinMask(p, ZIGZAG_MIN);
  const runs = stitchRuns(p);
  for (let i = 1; i < n; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) out[i] = narrow[i] ? SATIN : RUNNING;
  for (const e of fillRowEnds(p, runs, satin)) {
    for (const r of e.rows) {
      const a = Math.min(e.at, r);
      const b = Math.max(e.at, r);
      for (let i = a + 1; i <= b; i++) if (out[i] === RUNNING) out[i] = FILL;
    }
  }
  const tags = tagShortStitches(p);
  for (let i = 0; i < n; i++) if (tags[i] === TIE && out[i]) out[i] = TIE_STITCH;
  return out;
}

/** A move without sewing between two stitches of the same color. */
export interface Transition {
  /** Last stitch before the move and first stitch after it. */
  from: number;
  to: number;
  /** Straight distance in mm. */
  lengthMm: number;
  /** A trim between the two stitches. */
  trimmed: boolean;
  /** Short lock stitches right before `from` and right after `to`. */
  tieOff: number;
  tieIn: number;
  block: number;
}

/**
 * Every move between two stitches of one color block that goes through a jump or a trim. Color
 * changes are left out: the machine stops there anyway.
 */
export function transitions(p: Pattern, tags = tagShortStitches(p)): Transition[] {
  const out: Transition[] = [];
  const n = p.cmd.length;
  let block = 0;
  let last = -1;
  let moved = false;
  let trimmed = false;
  for (let i = 0; i < n; i++) {
    const c = p.cmd[i];
    if (c === COLOR_CHANGE) {
      block++;
      last = -1;
    } else if (c === JUMP) moved = true;
    else if (c === TRIM) trimmed = true;
    else if (c === STITCH) {
      if (last >= 0 && (moved || trimmed)) {
        let tieOff = 0;
        while (last - tieOff > 0 && tags[last - tieOff] === TIE) tieOff++;
        let tieIn = 0;
        while (i + tieIn + 1 < n && tags[i + tieIn + 1] === TIE) tieIn++;
        out.push({
          from: last,
          to: i,
          lengthMm: Math.hypot(p.x[i] - p.x[last], p.y[i] - p.y[last]) / 10,
          trimmed,
          tieOff,
          tieIn,
          block,
        });
      }
      last = i;
      moved = trimmed = false;
    }
  }
  return out;
}

/**
 * Jumps the machine moves without cutting, so the thread lies on top of the fabric from one
 * stitch to the next. `from[i]` is the stitch the thread comes from for the stitch at record i
 * (-1 for all others); `jumps` marks the JUMP records of those moves.
 */
export interface CarriedJumps {
  from: Int32Array;
  jumps: Uint8Array;
}

export function carriedJumps(p: Pattern, list: Transition[]): CarriedJumps {
  const from = new Int32Array(p.cmd.length).fill(-1);
  const jumps = new Uint8Array(p.cmd.length);
  for (const t of list) {
    if (t.trimmed || (p.x[t.from] === p.x[t.to] && p.y[t.from] === p.y[t.to])) continue;
    from[t.to] = t.from;
    for (let i = t.from + 1; i < t.to; i++) if (p.cmd[i] === JUMP) jumps[i] = 1;
  }
  return { from, jumps };
}

/** Records where the machine trims (the last stitch before the trim), and where each color block starts. */
export interface Markers {
  trims: number[];
  colorStarts: number[];
  start: number;
  end: number;
}

export function markers(p: Pattern): Markers {
  const trims: number[] = [];
  const colorStarts: number[] = [];
  let start = -1;
  let end = -1;
  let lastStitch = -1;
  let wantColor = true;
  let trimPending = false;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === STITCH) {
      if (start < 0) start = i;
      if (wantColor) colorStarts.push(i);
      wantColor = false;
      end = lastStitch = i;
      trimPending = false;
    } else if (c === TRIM && lastStitch >= 0 && !trimPending) {
      trims.push(lastStitch);
      trimPending = true;
    } else if (c === COLOR_CHANGE) wantColor = true;
  }
  return { trims, colorStarts, start, end };
}

/** Number of STITCH records up to and including record i, for every record (prefix count). */
export function stitchNumbers(p: Pattern): Uint32Array {
  const out = new Uint32Array(p.cmd.length);
  let k = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.cmd[i] === STITCH) k++;
    out[i] = k;
  }
  return out;
}

/** Record index of the k-th STITCH record (1-based); 0 gives -1. */
export function recordOfStitch(numbers: Uint32Array, k: number): number {
  if (k <= 0) return -1;
  let lo = 0;
  let hi = numbers.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (numbers[mid] < k) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Estimated sewing time in seconds: stitches at `spm` stitches per minute plus a fixed time for
 * every trim and color change (the machine slows down, cuts and starts again).
 */
export function sewingSeconds(stitches: number, trims: number, colorChanges: number, spm: number): number {
  const TRIM_S = 4;
  const COLOR_S = 15;
  return (stitches / spm) * 60 + trims * TRIM_S + colorChanges * COLOR_S;
}
