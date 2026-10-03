import { removeStitches, syncMarks, withRecords } from '../model/edit';
import type { Pattern } from '../model/pattern';
import { satinMask } from '../validation/satin';
import { walkCovered } from './cover';
import { fillRowEnds, stitchRuns } from './structure';

/**
 * Pulls fill row ends back where a later object covers them.
 *
 * Digitizers let a fill reach only about a quarter to a third of the way under the satin border
 * that is sewn over it, and adjacent fills overlap by a fraction of a millimetre. Fills that run
 * on under the whole border (common in auto-digitized files) put a full fill layer, its row-end
 * penetrations and the border on top of each other. Shortening the covered part of each row keeps
 * the look, since the border hides the fill edge either way, and removes thread and penetrations
 * exactly where they pile up.
 *
 * The same holds for a fill whose end lies under a later fill (the "remove underlying stitches"
 * step of digitizing programs), but only where that fill is dense enough to hide the edge: real
 * designs also stack light texture fills on a base fill, and those would show the gap.
 */

/** Later satin thread per area (mm/mm²) from which a point counts as under a border. */
const SATIN_COVER = 3;
/** Overlap kept under a satin border, as a share of its width, and its bounds (0.1 mm). */
const SATIN_KEEP = 0.3;
const SATIN_KEEP_MIN = 4;
const SATIN_KEEP_MAX = 10;
/** Later thread per area from which a fill counts as opaque cover: a full fill layer. */
const FILL_COVER = 2.2;
/** Overlap kept under a covering fill (0.1 mm). */
const FILL_KEEP = 6;
/** Moves shorter than this are not worth it (0.1 mm). */
const MIN_SHIFT = 3;
/** Rows stay at least this long (0.1 mm). */
const MIN_ROW = 10;
/**
 * Only rows at least this long are pulled back (0.1 mm). Narrower fills are details (a strip between
 * two outlines, a small area) whose visible part would shrink noticeably.
 */
const MIN_FILL = 30;
/** Two rows meeting at an end must run within about 10 degrees of each other for it to move. */
const ALIGNED_COS = 0.985;
/** Stitches of a straight row lie within this distance of the line between its ends (0.1 mm). */
const STRAIGHT = 2;

export interface PullbackOptions {
  /** Row ends that may move (record index). */
  wanted: (i: number) => boolean;
}

export interface PullbackResult {
  pattern: Pattern;
  /** Row ends moved. */
  moved: number;
  /** Interior row stitches dropped because they now lie beyond the row end. */
  removed: number;
}

export function pullBackFills(p: Pattern, opts: PullbackOptions): PullbackResult {
  const runs = stitchRuns(p);
  const mask = satinMask(p);
  const ends = fillRowEnds(p, runs, mask);
  const byRun = new Map<number, typeof ends>();
  for (const e of ends) {
    const list = byRun.get(e.run);
    if (list) list.push(e);
    else byRun.set(e.run, [e]);
  }
  const work: Pattern = { ...p, x: p.x.slice(), y: p.y.slice() };
  const remove = new Uint8Array(p.cmd.length);
  let moved = 0;
  let removed = 0;

  walkCovered(work, runs, mask, (run, cover) => {
    const list = byRun.get(run);
    if (!list) return;
    const shifts: [number, number, number][] = [];
    for (const e of list) {
      if (!opts.wanted(e.at)) continue;
      const ax = p.x[e.at];
      const ay = p.y[e.at];
      let ux = 0;
      let uy = 0;
      let reach = Infinity;
      const dirs: [number, number][] = [];
      let straight = true;
      for (const o of e.rows) {
        const l = Math.hypot(p.x[o] - ax, p.y[o] - ay);
        // Only straight rows: a pass that swallowed a connector at one end has no single direction.
        const step = o > e.at ? 1 : -1;
        for (let i = e.at + step; i !== o && straight; i += step) {
          if (Math.abs((p.x[i] - ax) * (p.y[o] - ay) - (p.y[i] - ay) * (p.x[o] - ax)) / l > STRAIGHT) straight = false;
        }
        dirs.push([(p.x[o] - ax) / l, (p.y[o] - ay) / l]);
        ux += dirs[dirs.length - 1][0];
        uy += dirs[dirs.length - 1][1];
        reach = Math.min(reach, l);
      }
      if (!straight || reach < MIN_FILL) continue;
      // The end moves along its rows; where two rows meet at an angle (tips, corners) it would
      // leave both lines, so it stays.
      if (dirs.length === 2 && dirs[0][0] * dirs[1][0] + dirs[0][1] * dirs[1][1] < ALIGNED_COS) continue;
      const ul = Math.hypot(ux, uy);
      if (!ul) continue;
      ux /= ul;
      uy /= ul;
      const underSatin = cover.satin(ax, ay) >= SATIN_COVER;
      // Under a fill, the cover must also reach past the row end: the end lies inside it.
      if (!underSatin && !(cover.all(ax, ay) >= FILL_COVER && cover.all(ax - ux * FILL_KEEP, ay - uy * FILL_KEEP) >= FILL_COVER)) continue;
      const covered = (d: number) => {
        const x = ax + ux * d;
        const y = ay + uy * d;
        return underSatin ? cover.satin(x, y) >= SATIN_COVER : cover.all(x, y) >= FILL_COVER;
      };
      const maxWalk = reach - MIN_ROW;
      let d = 0;
      while (d < maxWalk && covered(d + 1)) d++;
      // Covered all the way: the row is hidden, not overlapping an edge. Thinning deals with that.
      if (d >= maxWalk) continue;
      const keep = underSatin ? Math.min(SATIN_KEEP_MAX, Math.max(SATIN_KEEP_MIN, SATIN_KEEP * cover.satinWidth(ax, ay))) : FILL_KEEP;
      const shift = d - keep;
      if (shift < MIN_SHIFT) continue;
      shifts.push([e.at, ux * shift, uy * shift]);
      // Row stitches between the old and the new end are dropped.
      for (const o of e.rows) {
        const step = o > e.at ? 1 : -1;
        for (let i = e.at + step; i !== o; i += step) {
          const along = (p.x[i] - ax) * ux + (p.y[i] - ay) * uy;
          if (along < shift + MIN_SHIFT && !remove[i]) {
            remove[i] = 1;
            removed++;
          }
        }
      }
    }
    for (const [i, dx, dy] of shifts) {
      work.x[i] = Math.round(p.x[i] + dx);
      work.y[i] = Math.round(p.y[i] + dy);
      moved++;
    }
  });

  if (!moved) return { pattern: p, moved: 0, removed: 0 };
  syncMarks(work.x, work.y, p.cmd);
  const q = withRecords(p, work.x, work.y, p.cmd.slice());
  return { pattern: removed ? removeStitches(q, remove) : q, moved, removed };
}
