import { STITCH, type Pattern } from '../model/pattern';
import { satinMask } from '../validation/satin';
import { turningPoints } from './thin';

/**
 * Object structure recovered from the stitches alone. Digitizing software builds fills as rows
 * that run across the shape and turn at its edge, and satins as a zigzag between two edges; the
 * corrections need to know which stitches are which, and what was sewn on top of what.
 */

/** A maximal sequence of consecutive STITCH records, sewn without jump or trim. */
export interface Run {
  start: number;
  end: number;
}

export function stitchRuns(p: Pattern): Run[] {
  const runs: Run[] = [];
  for (let s = 0; s < p.cmd.length; s++) {
    if (p.cmd[s] !== STITCH) continue;
    let e = s;
    while (e + 1 < p.cmd.length && p.cmd[e + 1] === STITCH) e++;
    if (e > s) runs.push({ start: s, end: e });
    s = e;
  }
  return runs;
}

/** A fill row end: a turning point between rows of a fill sweep. */
export interface RowEnd {
  /** Record index of the turning point. */
  at: number;
  /** Record indices of the other ends of the adjacent rows (one or two). */
  rows: number[];
  /** Index of the run it belongs to. */
  run: number;
}

/** Shortest pass that counts as a fill row (0.1 mm). */
const ROW_MIN = 10;
/** Rows of one sweep are at most this far apart (0.1 mm); sparser rows are underlay. */
const ROW_SPACING_MAX = 10;
/** Adjacent rows run in opposite directions (cosine below this). */
const ANTI_COS = -0.9;
/**
 * Turns sharper than about 25 degrees end a pass. Where the outline runs at a shallow angle to the
 * rows, the short connector between two rows turns by less than the 60 degrees that separate a
 * sweep's passes, and would otherwise make the row bend at its end.
 */
const ROW_TURN_COS = 0.9;

const len = (p: Pattern, a: number, b: number) => Math.hypot(p.x[b] - p.x[a], p.y[b] - p.y[a]);

/** Distance (0.1 mm) of record q from the line through records a and b. */
function lineDist(p: Pattern, a: number, b: number, q: number): number {
  const dx = p.x[b] - p.x[a];
  const dy = p.y[b] - p.y[a];
  const l = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x[q] - p.x[a]) * dy - (p.y[q] - p.y[a]) * dx) / l;
}

/**
 * Finds the row ends of every fill: turning points next to at least one fill row. A pass between
 * two turning points is a row when it is at least 1 mm long, is not satin, and a row in the opposite
 * direction runs at most 1 mm beside it (one row or one connector away). Satins, running stitches
 * and sparse underlay rows yield nothing.
 */
export function fillRowEnds(p: Pattern, runs = stitchRuns(p), mask = satinMask(p)): RowEnd[] {
  const out: RowEnd[] = [];
  runs.forEach((r, ri) => {
    if (r.end - r.start < 4) return;
    const t = turningPoints(p, r.start, r.end, ROW_TURN_COS);
    const isRow = t.map((_, k) => {
      if (k + 1 >= t.length) return false;
      const a = t[k];
      const b = t[k + 1];
      if (len(p, a, b) < ROW_MIN) return false;
      let satin = true;
      for (let i = a + 1; i <= b; i++) if (!mask[i]) satin = false;
      return !satin;
    });
    const dir = (k: number) => {
      const l = len(p, t[k], t[k + 1]) || 1;
      return [(p.x[t[k + 1]] - p.x[t[k]]) / l, (p.y[t[k + 1]] - p.y[t[k]]) / l];
    };
    // A row with an antiparallel neighbour row (directly next, or after one connector) close by.
    const inSweep = isRow.map((row, k) => {
      if (!row) return false;
      const d = dir(k);
      for (const j of [k - 2, k - 1, k + 1, k + 2]) {
        if (j < 0 || !isRow[j]) continue;
        const e = dir(j);
        if (d[0] * e[0] + d[1] * e[1] > ANTI_COS) continue;
        if (lineDist(p, t[k], t[k + 1], t[j]) <= ROW_SPACING_MAX) return true;
      }
      return false;
    });
    for (let k = 1; k + 1 < t.length; k++) {
      const rows: number[] = [];
      if (inSweep[k - 1]) rows.push(t[k - 1]);
      if (inSweep[k]) rows.push(t[k + 1]);
      if (rows.length) out.push({ at: t[k], rows, run: ri });
    }
  });
  return out;
}

/** A satin column: records start..end alternate between its two edges. */
export interface SatinColumn {
  start: number;
  end: number;
  run: number;
}

/** Narrow zigzags count as columns from this stitch length on (0.1 mm). */
export const ZIGZAG_MIN = 3;

export function satinColumns(p: Pattern, runs = stitchRuns(p), mask = satinMask(p)): SatinColumn[] {
  const out: SatinColumn[] = [];
  runs.forEach((r, ri) => {
    for (let i = r.start + 1; i <= r.end; i++) {
      if (!mask[i]) continue;
      let j = i;
      while (j + 1 <= r.end && mask[j + 1]) j++;
      out.push({ start: i - 1, end: j, run: ri });
      i = j;
    }
  });
  return out;
}
