import { STITCH, type Pattern } from '../../../../src/model/pattern';
import { eStitchMask, satinMask } from './satin';
import { tagShortStitches, TIE } from './shortStitches';

/**
 * Copy of the stitch kinds as TypeScript worked them out before the Rust core (model/sequence.ts
 * workOutKinds, correct/structure.ts stitchRuns and fillRowEnds, correct/thin.ts turningPoints),
 * for the differential test.
 */

export const RUNNING = 1;
export const SATIN = 2;
export const FILL = 3;
export const TIE_STITCH = 4;

const TURN_COS = 0.5;

/** Turning points of the stitch run [s, e], including both ends, at turns with cosine below `turnCos`. */
export function turningPoints(p: Pattern, s: number, e: number, turnCos = TURN_COS): number[] {
  const t = [s];
  let prev = s; // last point with a distinct position
  for (let i = s + 1; i < e; i++) {
    const ix = p.x[i] - p.x[prev];
    const iy = p.y[i] - p.y[prev];
    if (!ix && !iy) continue;
    let next = i + 1;
    while (next < e && p.x[next] === p.x[i] && p.y[next] === p.y[i]) next++;
    const ox = p.x[next] - p.x[i];
    const oy = p.y[next] - p.y[i];
    if (ox || oy) {
      const cos = (ix * ox + iy * oy) / (Math.hypot(ix, iy) * Math.hypot(ox, oy));
      if (cos < turnCos) t.push(i);
    }
    prev = i;
  }
  t.push(e);
  return t;
}

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

export interface RowEnd {
  at: number;
  rows: number[];
  run: number;
}

const ROW_MIN = 10;
const ROW_SPACING_MAX = 10;
const ANTI_COS = -0.9;
const ROW_TURN_COS = 0.9;
const ROW_ARC = 1.2;

const len = (p: Pattern, a: number, b: number) => Math.hypot(p.x[b] - p.x[a], p.y[b] - p.y[a]);

function lineDist(p: Pattern, a: number, b: number, q: number): number {
  const dx = p.x[b] - p.x[a];
  const dy = p.y[b] - p.y[a];
  const l = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x[q] - p.x[a]) * dy - (p.y[q] - p.y[a]) * dx) / l;
}

export function fillRowEnds(p: Pattern, runs = stitchRuns(p), mask = satinMask(p)): RowEnd[] {
  const out: RowEnd[] = [];
  runs.forEach((r, ri) => {
    if (r.end - r.start < 4) return;
    const t = turningPoints(p, r.start, r.end, ROW_TURN_COS);
    const isRow = t.map((_, k) => {
      if (k + 1 >= t.length) return false;
      const a = t[k];
      const b = t[k + 1];
      const chord = len(p, a, b);
      if (chord < ROW_MIN) return false;
      let along = 0;
      for (let i = a + 1; i <= b; i++) along += len(p, i - 1, i);
      if (along > ROW_ARC * chord) return false;
      let satin = true;
      for (let i = a + 1; i <= b; i++) if (!mask[i]) satin = false;
      return !satin;
    });
    const dir = (k: number) => {
      const l = len(p, t[k], t[k + 1]) || 1;
      return [(p.x[t[k + 1]] - p.x[t[k]]) / l, (p.y[t[k + 1]] - p.y[t[k]]) / l];
    };
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

export const ZIGZAG_MIN = 3;

export function stitchKinds(p: Pattern): Uint8Array {
  const n = p.cmd.length;
  const out = new Uint8Array(n);
  const satin = satinMask(p);
  const narrow = satinMask(p, ZIGZAG_MIN);
  const runs = stitchRuns(p);
  const blanket = eStitchMask(p);
  for (let i = 1; i < n; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) out[i] = narrow[i] || blanket[i] ? SATIN : RUNNING;
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
