import { removeStitches } from '../model/edit';
import { STITCH, type Pattern } from '../model/pattern';

/**
 * Row thinning without object information.
 *
 * Fills and satins are both sweeps: the needle runs across the shape, turns, and comes back one
 * spacing further on. Inside a run of stitches, the points where the direction turns by more than
 * 60 degrees are its turning points. Their sequence is periodic: in a satin every second turning
 * point lies on the same edge (period 2), in a fill whose rows are joined by a short connector
 * stitch every fourth one does (period 4), and a fill without connectors has period 2 again.
 *
 * Removing one period's worth of turning points removes one "cycle" (two rows of a fill, one zig
 * and one zag of a satin) and joins the remaining ends with a single short stitch, which is either
 * along the edge ("edge" removal) or across like the neighbouring rows ("cross" removal). Removing
 * every k-th cycle lowers the thread per area of that sweep by 1/k. Doing this only where the
 * density is too high is the only automatic fix that really lowers it: nudging penetrations apart
 * keeps the thread length per area the same.
 */

/** Turning points closer than this to their counterpart one period later (0.1 mm) count as periodic. */
const GAP_MAX = 20;
/** Passes must be at least as long as the period gap to count as a sweep (narrow zigzags qualify). */
const PASS_TO_GAP = 1;
/** Minimum average pass length (0.1 mm). */
const PASS_MIN = 3;
/** Direction change (cosine) at which a stitch point becomes a turning point. */
const TURN_COS = 0.5;
/** A cross removal must keep the direction of the row it replaces. */
const CROSS_COS = 0.9;
/** By default at least this share of the thread removed must lie where thinning is asked for. */
export const MIN_SHARE = 0.6;

export interface ThinOptions {
  /** Share of cycles (0 to 1) to remove around record i; 0 where nothing should change. */
  needAt: (i: number) => number;
  /** Records that must never be removed (tie-in and tie-off stitches). */
  protect?: Uint8Array;
  /** Share of a removal's thread that must lie where `needAt` is positive (default MIN_SHARE). */
  minShare?: number;
}

export interface ThinResult {
  pattern: Pattern;
  /** Stitch records removed. */
  removed: number;
  /** Cycles (row pairs, zigzag pairs) removed. */
  cycles: number;
}

const dist = (p: Pattern, a: number, b: number) => Math.hypot(p.x[b] - p.x[a], p.y[b] - p.y[a]);

/** Turning points of the stitch run [s, e], including both ends. */
export function turningPoints(p: Pattern, s: number, e: number): number[] {
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
      if (cos < TURN_COS) t.push(i);
    }
    prev = i;
  }
  t.push(e);
  return t;
}

interface Candidate {
  /** Index in the turning point list of the kept end of the new stitch. */
  end: number;
  need: number;
  period: number;
}

/**
 * Finds the first valid removal starting at turning point k: cross and edge variants, period 2
 * then 4. Returns null if the neighbourhood is not a periodic sweep or nothing should change.
 */
function candidate(p: Pattern, t: number[], k: number, removed: Uint8Array, opts: ThinOptions): Candidate | null {
  const a = t[k];
  for (const period of [2, 4]) {
    // Periodic neighbourhood: this turning point and at least one of its counterparts one
    // period before or after lie close to the point one period further on. Real fills mix
    // connector rows and direct turns, so not every neighbour has to match.
    if (k + period >= t.length || dist(p, a, t[k + period]) > GAP_MAX) continue;
    let others = 0;
    let matching = 0;
    for (const j of [k - period, k + period]) {
      if (j < 0 || j + period >= t.length) continue;
      others++;
      if (dist(p, t[j], t[j + period]) <= GAP_MAX) matching++;
    }
    if (others && !matching) continue;
    const gap = dist(p, a, t[k + period]);
    let passes = 0;
    for (let j = k; j < k + period && j + 1 < t.length; j++) passes += dist(p, t[j], t[j + 1]);
    passes /= period;
    if (passes < PASS_MIN || passes < PASS_TO_GAP * gap) continue;

    for (const cross of [true, false]) {
      const endK = k + period + (cross ? 1 : 0);
      if (endK >= t.length) continue;
      const b = t[endK];
      const newLen = dist(p, a, b);
      let thread = 0;
      let wanted = 0;
      let needSum = 0;
      let longest = 0;
      let ok = true;
      for (let r = a + 1; r <= b; r++) {
        if (r < b && (removed[r] || opts.protect?.[r])) {
          ok = false;
          break;
        }
        const len = dist(p, r - 1, r);
        const need = (opts.needAt(r - 1) + opts.needAt(r)) / 2;
        thread += len;
        if (need > 0) wanted += len;
        needSum += need * len;
        if (len > longest) longest = len;
      }
      if (!ok || thread <= 0) continue;
      if (wanted < (opts.minShare ?? MIN_SHARE) * thread) return null; // mostly outside the area to thin
      if (thread - newLen < 0.5 * thread) continue; // saves too little
      if (cross) {
        if (newLen > longest + gap) continue;
        const rx = p.x[t[k + 1]] - p.x[a];
        const ry = p.y[t[k + 1]] - p.y[a];
        const cos = ((p.x[b] - p.x[a]) * rx + (p.y[b] - p.y[a]) * ry) / (newLen * Math.hypot(rx, ry) || 1);
        if (cos < CROSS_COS) continue;
      } else if (newLen <= 0 || newLen > GAP_MAX) continue;
      // The need where thinning is asked for; the share rule above limits how far out it reaches.
      return { end: endK, need: needSum / wanted, period };
    }
  }
  return null;
}

/**
 * Removes cycles from periodic sweeps where `needAt` asks for it, spreading the removals evenly so
 * that a need of 0.33 removes every third cycle. Only STITCH records are removed; the first and
 * last stitch of every run stay, so jumps, trims and color changes keep their anchors.
 */
export function thinSweeps(p: Pattern, opts: ThinOptions): ThinResult {
  const n = p.cmd.length;
  const removed = new Uint8Array(n);
  let cycles = 0;
  for (let s = 0; s < n; s++) {
    if (p.cmd[s] !== STITCH) continue;
    let e = s;
    while (e + 1 < n && p.cmd[e + 1] === STITCH) e++;
    if (e - s >= 4) {
      const t = turningPoints(p, s, e);
      let credit = 0.5;
      for (let k = 0; k + 2 < t.length; ) {
        const c = candidate(p, t, k, removed, opts);
        if (!c) {
          k++;
          continue;
        }
        // Each turning point is 1/period of a cycle; removing a cycle also passes over its own
        // turning points, so it earns their share before paying for itself.
        const need = Math.min(1, c.need);
        credit = Math.min(1.5, credit + need / c.period);
        if (credit >= 1) {
          for (let r = t[k] + 1; r < t[c.end]; r++) removed[r] = 1;
          cycles++;
          credit += need - 1;
          k = c.end;
        } else k++;
      }
    }
    s = e;
  }
  const count = removed.reduce((a, v) => a + v, 0);
  return { pattern: count ? removeStitches(p, removed) : p, removed: count, cycles };
}
