import { removeStitches, withRecords } from '../model/edit';
import { STITCH, type Pattern } from '../model/pattern';
import { turningPoints } from './thin';

/**
 * Thinning out by hand (Ausdünnen in the stitch editor): fewer stitches where they are selected,
 * the shape staying covered as before.
 *
 * Rows (of a fill) and zigzags (of a satin) are sweeps: passes back and forth, one spacing apart.
 * They are made looser the way any digitizing program does it, by sewing them at a wider spacing:
 * the passes are laid anew, evenly spread between the first and the last selected one. Each new
 * pass lies between two neighbouring old ones that run the same way (blended along their length),
 * so its ends stay on the edge the old ends trace and its penetrations follow theirs. Taking out
 * whole passes instead (as the correction does where it only has to lower the density) would leave
 * a stripe of three spacings for every pair.
 *
 * A line (running stitch) is made looser by longer stitches: every so many of its penetrations are
 * taken out, evenly spread, where the line stays within LINE_TOLERANCE without it and the stitch
 * does not grow beyond LINE_MAX. Lines that go back over themselves (triple and bean stitch) stay.
 */

/** Direction change (cosine) below which a point is a turning point of a sweep. */
const TURN_COS = 0.5;
/** Neighbouring passes of a sweep run against each other at least this much (cosine). */
const ANTI_COS = -0.5;
/** The next pass starts at most this far from where the one before ended (0.1 mm). */
const GAP_MAX = 20;
/** Penetrations this close (0.1 mm) are the same. */
const SAME = 1;
/** Passes shorter than this are no passes (0.1 mm). */
const PASS_MIN = 3;
/** A line keeps to its path within this (0.1 mm). */
const LINE_TOLERANCE = 2;
/** Longest stitch a thinned line gets (0.1 mm). */
const LINE_MAX = 50;
/** A line counts as going on (not back over itself) while it turns by less than this (cosine). */
const LINE_COS = 0;

export interface HandThinOptions {
  /** Share (0 to 1) of the stitches to take out around record i; 0 where nothing should change. */
  needAt: (i: number) => number;
  /** Records that must never be removed or moved (tie-in and tie-off stitches). */
  protect?: Uint8Array;
}

export interface HandThinResult {
  pattern: Pattern;
  /** Stitch records removed. */
  removed: number;
  /** 1 for each record of the input that was removed. */
  mask: Uint8Array;
}

type Pt = [number, number];

/** A pass of a sweep: its records from the turning point it starts at to the one it ends at. */
interface Pass {
  s: number;
  e: number;
}

const len = (p: Pattern, a: number, b: number) => Math.hypot(p.x[b] - p.x[a], p.y[b] - p.y[a]);

/** Whether most penetrations inside pass `b` lie on penetrations of pass `a` (sewn back over it). */
function overlays(p: Pattern, a: Pass, b: Pass): boolean {
  let on = 0;
  for (let i = b.s + 1; i < b.e; i++) {
    for (let j = a.s; j <= a.e; j++) {
      if (len(p, i, j) <= SAME) {
        on++;
        break;
      }
    }
  }
  return on > 0 && 2 * on >= b.e - b.s - 1;
}

/** The sweeps of the stitch run [s, e]: runs of passes back and forth, each as its passes. */
export function sweeps(p: Pattern, s: number, e: number): Pass[][] {
  const t = turningPoints(p, s, e, TURN_COS);
  const out: Pass[][] = [];
  let cur: Pass[] = [];
  const close = () => {
    if (cur.length >= 3) out.push(cur);
    cur = [];
  };
  for (let k = 0; k + 1 < t.length; k++) {
    const pass = { s: t[k], e: t[k + 1] };
    const l = len(p, pass.s, pass.e);
    if (l < PASS_MIN) continue; // a stitch in place
    // A connector: a short stitch along the edge between two rows much longer than it.
    const around = Math.min(k ? len(p, t[k - 1], t[k]) : Infinity, k + 2 < t.length ? len(p, t[k + 1], t[k + 2]) : Infinity);
    if (l <= GAP_MAX && 2 * l < around) continue;
    const prev = cur[cur.length - 1];
    if (prev) {
      // Joined at one edge (straight or by a connector), and close to it at the other edge too:
      // where the rows end elsewhere (around a notch), they are no longer neighbours.
      const joined = (pass.s === prev.e || (t[k - 1] === prev.e && len(p, prev.e, pass.s) <= GAP_MAX)) && len(p, prev.s, pass.e) <= GAP_MAX;
      const ax = p.x[prev.e] - p.x[prev.s];
      const ay = p.y[prev.e] - p.y[prev.s];
      const bx = p.x[pass.e] - p.x[pass.s];
      const by = p.y[pass.e] - p.y[pass.s];
      const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      // A pass back onto the one before it (a triple or bean stitch line) is no sweep.
      const apart = !overlays(p, prev, pass);
      if (!joined || cos > ANTI_COS || !apart) close();
    }
    cur.push(pass);
  }
  close();
  return out;
}

/** Where along pass `q` (0 to 1 of its length) each of its penetrations lies, and the point at a share. */
function along(p: Pattern, q: Pass) {
  const at = [0];
  for (let i = q.s + 1; i <= q.e; i++) at.push(at[at.length - 1] + len(p, i - 1, i));
  const total = at[at.length - 1] || 1;
  const point = (f: number): Pt => {
    const d = f * total;
    let k = 1;
    while (k < at.length - 1 && at[k] < d) k++;
    const span = at[k] - at[k - 1] || 1;
    const u = Math.min(1, Math.max(0, (d - at[k - 1]) / span));
    const a = q.s + k - 1;
    return [p.x[a] + (p.x[a + 1] - p.x[a]) * u, p.y[a] + (p.y[a + 1] - p.y[a]) * u];
  };
  return { shares: at.map((d) => d / total), point };
}

/**
 * Lays passes first..last of `rows` anew as `m + 1` passes (m of the same parity as last - first),
 * the first and last staying where they are. Returns the points from after the first pass's end
 * up to and including the last pass's start.
 */
function respread(p: Pattern, rows: Pass[], first: number, last: number, m: number): Pt[] {
  const n = last - first;
  const pts: Pt[] = [];
  for (let j = 1; j < m; j++) {
    const u = (j * n) / m;
    // The old passes on either side that run the same way as this one.
    let a = Math.floor(u);
    if ((a - j) % 2) a--;
    const b = Math.min(a + 2, n);
    const f = b > a ? (u - a) / (b - a) : 0;
    const A = along(p, rows[first + a]);
    const B = along(p, rows[first + b]);
    // Its penetrations where the nearer old pass has them. Passes that turn straight into the next
    // one (a satin) share that point: each starts where the one before ended, and the last ends
    // where the last pass kept starts.
    const near = first + (f < 0.5 ? a : b);
    const shares = (f < 0.5 ? A : B).shares;
    const straight = (q: number) => q > 0 && rows[q].s === rows[q - 1].e;
    for (const g of shares.slice(straight(near) ? 1 : 0, j === m - 1 && straight(last) ? -1 : undefined)) {
      const pa = A.point(g);
      const pb = B.point(g);
      pts.push([Math.round(pa[0] + (pb[0] - pa[0]) * f), Math.round(pa[1] + (pb[1] - pa[1]) * f)]);
    }
  }
  pts.push([p.x[rows[last].s], p.y[rows[last].s]]);
  return pts;
}

/** Distance from point i to the segment a-b (0.1 mm). */
function offLine(p: Pattern, i: number, a: number, b: number): number {
  const vx = p.x[b] - p.x[a];
  const vy = p.y[b] - p.y[a];
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.min(1, Math.max(0, ((p.x[i] - p.x[a]) * vx + (p.y[i] - p.y[a]) * vy) / l2)) : 0;
  return Math.hypot(p.x[i] - (p.x[a] + vx * t), p.y[i] - (p.y[a] + vy * t));
}

export function thinByHand(p: Pattern, opts: HandThinOptions): HandThinResult {
  const n = p.cmd.length;
  const mask = new Uint8Array(n);
  const x = p.x.slice();
  const y = p.y.slice();
  const fixed = (i: number) => p.cmd[i] !== STITCH || !!opts.protect?.[i] || opts.needAt(i) <= 0;
  const inSweep = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (p.cmd[s] !== STITCH) continue;
    let e = s;
    while (e + 1 < n && p.cmd[e + 1] === STITCH) e++;
    // Rows and zigzags: each stretch of selected passes spread anew at a wider spacing.
    for (const rows of sweeps(p, s, e)) {
      for (const q of rows) inSweep.fill(1, q.s, q.e + 1);
      let k = 0;
      while (k < rows.length) {
        // A pass takes part when none of its points is held; the stretch is kept by its ends.
        const free = (q: Pass) => {
          for (let i = q.s; i <= q.e; i++) if (fixed(i)) return false;
          return true;
        };
        if (!free(rows[k])) {
          k++;
          continue;
        }
        let l = k;
        while (l + 1 < rows.length && free(rows[l + 1])) l++;
        const span = l - k;
        let need = 0;
        for (let i = rows[k].s; i <= rows[l].e; i++) need += opts.needAt(i);
        need /= rows[l].e - rows[k].s + 1;
        let m = Math.round(span * (1 - Math.min(1, need)));
        if ((span - m) % 2) m++;
        if (m >= 1 && m < span) {
          const pts = respread(p, rows, k, l, m);
          const from = rows[k].e + 1;
          const old = rows[l].s - from + 1;
          if (pts.length <= old) {
            // The new passes take the first records; the last new point is the last pass's start
            // (where it was), and the records left over go.
            for (let i = 0; i + 1 < pts.length; i++) [x[from + i], y[from + i]] = pts[i];
            mask.fill(1, from + pts.length - 1, rows[l].s);
          }
        }
        k = l + 1;
      }
    }
    // Lines: every so many penetrations out, where the line keeps its path without them. A line
    // sewn back over itself (triple, bean stitch) takes out the same penetrations on every pass.
    let credit = 0.5;
    let last = s; // the point kept last
    const decided = new Map<string, boolean>();
    for (let i = s + 1; i < e; i++) {
      const key = `${p.x[i]},${p.y[i]}`;
      const ok =
        !inSweep[i] && !inSweep[i - 1] && !inSweep[i + 1] && !fixed(i) &&
        (() => {
          const ax = p.x[i] - p.x[i - 1];
          const ay = p.y[i] - p.y[i - 1];
          const bx = p.x[i + 1] - p.x[i];
          const by = p.y[i + 1] - p.y[i];
          const l = Math.hypot(ax, ay) * Math.hypot(bx, by);
          if (!l || (ax * bx + ay * by) / l <= LINE_COS) return false; // it turns here
          if (len(p, last, i + 1) > LINE_MAX) return false;
          for (let r = last + 1; r <= i; r++) if (offLine(p, r, last, i + 1) > LINE_TOLERANCE) return false;
          return true;
        })();
      let out = false;
      if (ok) {
        const before = decided.get(key);
        if (before !== undefined) out = before;
        else {
          credit += opts.needAt(i);
          out = credit >= 1;
          if (out) credit -= 1;
        }
      }
      if (!decided.has(key)) decided.set(key, out);
      if (out) mask[i] = 1;
      else last = i;
    }
    s = e;
  }
  let removed = 0;
  for (let i = 0; i < n; i++) if (mask[i] && p.cmd[i] === STITCH) removed++;
  if (!removed) return { pattern: p, removed: 0, mask };
  return { pattern: removeStitches(withRecords(p, x, y, p.cmd.slice()), mask), removed, mask };
}
