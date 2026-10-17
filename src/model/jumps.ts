import { LOCK_MM } from '../material/rules';
import { tidyKept, withRecords } from './edit';
import { carryObjects, sewObjects } from './objects';
import { remember, remembered } from './restitch';
import { STITCH, TRIM, type Pattern } from './pattern';
import type { Transition } from './sequence';

/**
 * Editing the moves between stitch runs: cutting a jump (tie off, trim, jump, tie in) or letting
 * the machine carry the thread across (no trim, no lock stitches).
 */

/** Length of a lock stitch (0.1 mm); short enough to hide under the following stitches. */
const TIE_LEN = LOCK_MM * 10;

export interface Rec {
  x: number;
  y: number;
  cmd: number;
  /** The record of the pattern it was taken from (see recs), so its object can follow it. */
  from?: number;
}

export const recs = (p: Pattern, a: number, b: number): Rec[] => {
  const out: Rec[] = [];
  for (let i = a; i < b; i++) out.push({ x: p.x[i], y: p.y[i], cmd: p.cmd[i], from: i });
  return out;
};

/** Unit vector from record a towards record b, or a fallback when they coincide. */
function dir(p: Pattern, a: number, b: number): [number, number] {
  const dx = p.x[b] - p.x[a];
  const dy = p.y[b] - p.y[a];
  const l = Math.hypot(dx, dy);
  return l > 0 ? [dx / l, dy / l] : [1, 0];
}

export function build(p: Pattern, list: Rec[], src: Pattern = p): Pattern {
  return built(p, list, src).pattern;
}

/** As build, with the record of `src` each record came from (-1: a new one). */
function built(p: Pattern, list: Rec[], src: Pattern): { pattern: Pattern; origin: Int32Array } {
  const x = Int32Array.from(list, (r) => r.x);
  const y = Int32Array.from(list, (r) => r.y);
  const cmd = Uint8Array.from(list, (r) => r.cmd);
  const { pattern, kept } = tidyKept(withRecords(p, x, y, cmd));
  // The objects follow their records (`from`, records of `src`); new ones go with their neighbours.
  const origin = Int32Array.from(kept, (k) => list[k].from ?? -1);
  carryObjects(src, pattern, origin);
  return { pattern, origin };
}

/**
 * The parts the objects of `q` were sewn in (Remembered.parts) counted in the stitches they have
 * now, after lock stitches were added or taken away (`origin`: the record of `p` each record of `q`
 * came from). A stitch added goes with the part of the stitch before it.
 */
function refitParts(p: Pattern, q: Pattern, origin: Int32Array): void {
  // Each stitch of `p`: how many stitches of its object end with it.
  const num = new Int32Array(p.cmd.length);
  for (const o of sewObjects(p)) {
    let n = 0;
    for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) num[i] = ++n;
  }
  for (const o of sewObjects(q)) {
    const m = remembered(q, o);
    if (!m?.parts?.length) continue;
    const was: number[] = [];
    let last = 0;
    for (let i = o.first; i <= o.last; i++) {
      if (q.cmd[i] !== STITCH) continue;
      const r = origin[i];
      if (r >= 0 && num[r]) last = num[r];
      was.push(last);
    }
    const n = was.length;
    if (m.parts[m.parts.length - 1].end === n) continue;
    const parts = m.parts
      .map((pt, k, all) => {
        const after = was.findIndex((s) => s > pt.end);
        return { ...pt, end: k === all.length - 1 || after < 0 ? n : after };
      })
      .filter((pt, k, all) => pt.end > (k ? all[k - 1].end : 0));
    remember(q, o, { ...m, ...(parts.length ? { parts } : {}) });
  }
}

/**
 * Tie-off: back and forth along the last stitch, ending where it ended, so the thread is locked
 * before the trim. Tie-in: forth and back along the next stitch, which then covers it.
 */
export function tieOff(p: Pattern, at: number): Rec[] {
  const prev = at > 0 && p.cmd[at - 1] === STITCH ? at - 1 : at;
  const seg = Math.hypot(p.x[at] - p.x[prev], p.y[at] - p.y[prev]);
  const [ux, uy] = prev === at ? [1, 0] : dir(p, at, prev);
  const d = Math.max(3, Math.min(TIE_LEN, seg || TIE_LEN));
  const back = { x: Math.round(p.x[at] + ux * d), y: Math.round(p.y[at] + uy * d), cmd: STITCH };
  const home = { x: p.x[at], y: p.y[at], cmd: STITCH };
  return [back, home, { ...back }, { ...home }];
}

export function tieIn(p: Pattern, at: number): Rec[] {
  const next = at + 1 < p.cmd.length && p.cmd[at + 1] === STITCH ? at + 1 : at;
  const seg = Math.hypot(p.x[next] - p.x[at], p.y[next] - p.y[at]);
  const [ux, uy] = next === at ? [1, 0] : dir(p, at, next);
  const d = Math.max(3, Math.min(TIE_LEN, seg / 2 || TIE_LEN));
  const fwd = { x: Math.round(p.x[at] + ux * d), y: Math.round(p.y[at] + uy * d), cmd: STITCH };
  return [fwd, { x: p.x[at], y: p.y[at], cmd: STITCH }, { ...fwd }];
}

/**
 * Applies the change to each transition (found on `p`). Cut: missing tie-off, a trim, the moves,
 * missing tie-in. Carry: the trim and the lock stitches around the move are removed, the moves stay.
 */
export function setTrims(p: Pattern, list: Transition[], cut: boolean): Pattern {
  const todo = list.filter((t) => t.trimmed !== cut || (cut && (!t.tieOff || !t.tieIn)) || (!cut && (t.tieOff || t.tieIn)));
  if (!todo.length) return p;
  todo.sort((a, b) => a.from - b.from);
  const out: Rec[] = [];
  let i = 0;
  for (const t of todo) {
    if (cut) {
      out.push(...recs(p, i, t.from + 1));
      if (!t.tieOff) out.push(...tieOff(p, t.from));
      const gap = recs(p, t.from + 1, t.to);
      if (!gap.some((r) => r.cmd === TRIM)) out.push({ x: p.x[t.from], y: p.y[t.from], cmd: TRIM });
      out.push(...gap, ...recs(p, t.to, t.to + 1));
      if (!t.tieIn) out.push(...tieIn(p, t.to));
      i = t.to + 1;
    } else {
      // Keep the stitch that starts the lock stitches; they all sit within a millimetre of it.
      out.push(...recs(p, i, t.from - t.tieOff + 1));
      out.push(...recs(p, t.from + 1, t.to).filter((r) => r.cmd !== TRIM));
      out.push(...recs(p, t.to, t.to + 1));
      i = t.to + t.tieIn + 1;
    }
  }
  out.push(...recs(p, i, p.cmd.length));
  // The objects stay what they were: what lies between them changed, not they (but their lock stitches).
  const { pattern, origin } = built(p, out, p);
  refitParts(p, pattern, origin);
  return pattern;
}
