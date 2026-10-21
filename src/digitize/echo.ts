import { core } from '../wasm/core';
import type { ThreadColor } from '../model/pattern';
import { flatOf } from './fill';
import type { Pt } from './skeleton';

/**
 * Echo of a line: copies of it at the same distance, one beside the other, like echo quilting
 * along a line. The copies are the level lines of the distance to the line, so they stay smooth
 * where the line bends sharply (no loops at inner corners, round outer corners) and a ring inside
 * a closed line can part into several rings where the shape gets narrow.
 *
 * The lines are computed by the Rust core (core/src/digitize/echo.rs).
 */

/**
 * Which side the copies lie on. Closed lines: outside, inside or both. Open lines: `out` is the
 * left of the line's drawing direction as seen on screen (y down), `in` the right.
 */
export type EchoSide = 'out' | 'in' | 'both';
export const ECHO_SIDES: EchoSide[] = ['out', 'in', 'both'];

export interface LineEcho {
  side: EchoSide;
  /** Copies on each side. */
  count: number;
  /** From line to line (mm). */
  gap: number;
  /** Trimmed from copy to copy instead of a short stitch across. */
  cut?: boolean;
  /**
   * A thread for each copy, nearest first (both sides alike); none or null: the line's. Copies in
   * a thread of their own are objects of their own, linked to the line by `link` (model/shadow.ts).
   */
  colors?: (ThreadColor | null)[];
  link?: string;
  /** Only these copies (1 nearest), without the line: what an object of copies in their own thread sews. */
  only?: number[];
  /** Copies the line leaves out (they went their own way as objects of their own). */
  skip?: number[];
  /**
   * Each copy's pattern (a motif's figures, a zigzag's points) this far on from the one before
   * (degrees of one period, -180 to 180): it adds up from copy to copy. None: all in step.
   */
  phase?: number;
  /** Sewn the other way round: the farthest copy first and the line last (both sides: the outer side first). */
  reverse?: boolean;
  /** Stored files only: written since copies may overlap (older files kept wide stitches their width apart). */
  overlap?: boolean;
}

export const ECHO_DEFAULT: LineEcho = { side: 'out', count: 2, gap: 3 };
export const ECHO_COUNT: [number, number] = [1, 6];
/** From line to line (mm): below the width of the stitch the copies overlap, at 0 they lie on the line. */
export const ECHO_GAP: [number, number] = [0, 10];
export const ECHO_PHASE: [number, number] = [-180, 180];

const isColor = (c: unknown) => {
  const x = c as ThreadColor | null;
  const byte = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 255;
  return !!x && byte(x.r) && byte(x.g) && byte(x.b);
};

export function isEcho(e: unknown): e is LineEcho {
  const x = e as LineEcho | null;
  return (
    !!x &&
    ECHO_SIDES.includes(x.side) &&
    Number.isInteger(x.count) &&
    x.count >= ECHO_COUNT[0] &&
    x.count <= ECHO_COUNT[1] &&
    Number.isFinite(x.gap) &&
    x.gap >= ECHO_GAP[0] &&
    x.gap <= ECHO_GAP[1] &&
    (x.cut === undefined || typeof x.cut === 'boolean') &&
    (x.colors === undefined || (Array.isArray(x.colors) && x.colors.every((c) => c === null || isColor(c)))) &&
    (x.link === undefined || typeof x.link === 'string') &&
    (x.phase === undefined || (Number.isFinite(x.phase) && x.phase >= ECHO_PHASE[0] && x.phase <= ECHO_PHASE[1])) &&
    (x.reverse === undefined || typeof x.reverse === 'boolean') &&
    [x.only, x.skip].every((l) => l === undefined || (Array.isArray(l) && l.every((k) => Number.isInteger(k) && k >= 1 && k <= ECHO_COUNT[1])))
  );
}

/** The copies (1 nearest) sewn in the line's own thread. */
export function ownCopies(e: LineEcho): number[] {
  const n = Math.max(1, Math.round(e.count));
  return Array.from({ length: n }, (_, i) => i + 1).filter((k) => !e.colors?.[k - 1] && !e.skip?.includes(k));
}


/**
 * The lines an echo of `line` is sewn along, in the order to sew them, each from the end nearest
 * where the one before ended: the line itself first when the copies lie on one side, or the
 * farthest copy on the inner (right) side first when they lie on both; `e.reverse` turns that
 * round. `closed`: the line is a loop (its first point repeated at the end); its copies are loops
 * too. `gap` is at least `minGap`. `returns`: each line is sewn back to where it started (an even
 * number of passes), so the next starts near there.
 */
export function echoLines(line: Pt[], closed: boolean, e: LineEcho, minGap = 0, returns = false): EchoLine[] {
  if (line.length < 2) return [{ line, closed, back: false, k: 0 }];
  // The line with its copies in its own thread, or only the copies asked for.
  const spec = { side: e.side, count: e.count, gap: e.gap, reverse: !!e.reverse, rings: e.only ?? ownCopies(e), withLine: !e.only };
  const out = core().echoLines(flatOf(line), closed, spec, minGap, returns) as EchoLine[];
  // The line itself as given (the same array) where it is sewn as drawn.
  const same = (l: Pt[]) => l.length === line.length && l.every((q, i) => q[0] === line[i][0] && q[1] === line[i][1]);
  for (const x of out) if (x.k === 0 && same(x.line)) x.line = line;
  return out;
}

/** A line to sew: `back` when it runs against the drawn direction of the line it echoes (what lies to one side of it stays there). */
export interface EchoLine {
  line: Pt[];
  closed: boolean;
  back: boolean;
  /** Which copy: 1 nearest, negative on the inner (right) side, 0 the line itself. */
  k: number;
}
