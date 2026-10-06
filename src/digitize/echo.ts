import { distanceToSeeds } from '../image/edt';
import { insidePoly } from '../shape/path';
import { outline, type Region } from './region';
import type { ThreadColor } from '../model/pattern';
import type { Pt } from './skeleton';

/**
 * Echo of a line: copies of it at the same distance, one beside the other, like echo quilting
 * along a line. The copies are the level lines of the distance to the line, so they stay smooth
 * where the line bends sharply (no loops at inner corners, round outer corners) and a ring inside
 * a closed line can part into several rings where the shape gets narrow.
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
}

export const ECHO_DEFAULT: LineEcho = { side: 'out', count: 2, gap: 3 };
export const ECHO_COUNT: [number, number] = [1, 6];
export const ECHO_GAP: [number, number] = [1, 10];

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
    [x.only, x.skip].every((l) => l === undefined || (Array.isArray(l) && l.every((k) => Number.isInteger(k) && k >= 1 && k <= ECHO_COUNT[1])))
  );
}

/** The copies (1 nearest) sewn in the line's own thread. */
export function ownCopies(e: LineEcho): number[] {
  const n = Math.max(1, Math.round(e.count));
  return Array.from({ length: n }, (_, i) => i + 1).filter((k) => !e.colors?.[k - 1] && !e.skip?.includes(k));
}

/** Pieces of copies shorter than this are left out (mm). */
const MIN_PIECE = 1.5;
/** At most this many pixels for the distance field; larger lines get coarser pixels. */
const MAX_PIXELS = 3e6;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function lengthOf(l: Pt[]): number {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += dist(l[i - 1], l[i]);
  return s;
}

/**
 * The lines an echo of `line` is sewn along, in the order to sew them, each from the end nearest
 * where the one before ended: the line itself first when the copies lie on one side, or the
 * farthest copy on the inner (right) side first when they lie on both. `closed`: the line is a
 * loop (its first point repeated at the end); its copies are loops too. `gap` is at least
 * `minGap` (a satin needs its width).
 */
export function echoLines(line: Pt[], closed: boolean, e: LineEcho, minGap = 0): EchoLine[] {
  const base = { line, closed, back: false };
  if (line.length < 2) return [base];
  const gap = Math.max(e.gap, minGap);
  const n = Math.max(1, Math.round(e.count));
  // The line with its copies in its own thread, or only the copies asked for.
  const rings = new Set(e.only ?? ownCopies(e));
  const levels: number[] = [];
  if (e.side === 'both') for (let k = n; k >= 1; k--) if (rings.has(k)) levels.push(-k * gap);
  if (!e.only) levels.push(0);
  for (let k = 1; k <= n; k++) if (rings.has(k)) levels.push((e.side === 'in' ? -k : k) * gap);
  if (!levels.length) return [];
  const field = distanceField(line, n * gap + 1);
  const out: EchoLine[] = [];
  const turn = closed ? Math.sign(area(line)) : 0;
  let at: Pt | null = null;
  for (const lv of levels) {
    const pieces = lv === 0 ? [base] : copiesAt(field, line, closed, lv).map((pc) => ({ ...pc, back: pc.closed && Math.sign(area(pc.line)) !== turn }));
    for (const pc of order(pieces, at)) {
      out.push(pc);
      at = pc.line[pc.line.length - 1];
    }
  }
  return out;
}

/** A line to sew: `back` when it runs against the drawn direction of the line it echoes (what lies to one side of it stays there). */
export interface EchoLine {
  line: Pt[];
  closed: boolean;
  back: boolean;
}

/** Twice the signed area of a loop: its sign tells which way round it goes. */
function area(l: Pt[]): number {
  let a = 0;
  for (let i = 1; i < l.length; i++) a += l[i - 1][0] * l[i][1] - l[i][0] * l[i - 1][1];
  return a;
}

interface Field {
  r: Region;
  d: Float32Array;
}

/** Distance (mm) of each pixel to the line, out to `reach` mm around it. */
function distanceField(line: Pt[], reach: number): Field {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of line) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const span = (maxX - minX + 2 * reach) * (maxY - minY + 2 * reach);
  const px = Math.max(0.1, Math.sqrt(span / MAX_PIXELS));
  const x0 = Math.floor((minX - reach) / px) - 2;
  const y0 = Math.floor((minY - reach) / px) - 2;
  const w = Math.ceil((maxX + reach) / px) + 2 - x0;
  const h = Math.ceil((maxY + reach) / px) + 2 - y0;
  const seed = new Uint8Array(w * h);
  const mark = (q: Pt) => {
    const x = Math.round(q[0] / px - x0 - 0.5);
    const y = Math.round(q[1] / px - y0 - 0.5);
    if (x >= 0 && y >= 0 && x < w && y < h) seed[y * w + x] = 1;
  };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const steps = Math.max(1, Math.ceil((dist(a, b) / px) * 3));
    for (let k = 0; k <= steps; k++) mark([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
  }
  const d = distanceToSeeds(seed, w, h);
  for (let i = 0; i < d.length; i++) d[i] *= px;
  const r = { label: 0, x0, y0, w, h, pxMm: px, mask: seed, inside: d, sdf: d, sdfBase: d, areaMm2: 0 } as Region;
  return { r, d };
}

/** Nearest point of the line to q: arc length there, whether it is an end, and which side q lies on (+1 left). */
function nearest(line: Pt[], cum: number[], q: Pt): { s: number; end: boolean; side: number } {
  let best = Infinity;
  let s = 0;
  let end = false;
  let side = 1;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const raw = l2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
    const t = Math.max(0, Math.min(1, raw));
    const ex = q[0] - (a[0] + t * dx);
    const ey = q[1] - (a[1] + t * dy);
    const d2 = ex * ex + ey * ey;
    if (d2 < best) {
      best = d2;
      s = cum[i - 1] + t * Math.sqrt(l2);
      end = (i === 1 && raw < 0) || (i === line.length - 1 && raw > 1);
      // On screen (y down) the left of the direction (dx, dy) is (dy, -dx).
      const cross = dx * ey - dy * ex;
      side = cross < 0 ? 1 : -1;
    }
  }
  return { s, end, side };
}

/**
 * The copies `level` mm beside the line (left or outside when positive): closed lines give
 * loops, open lines the pieces of the level line on that side, along the line's direction,
 * without the round ends around the line's ends.
 */
function copiesAt(f: Field, line: Pt[], closed: boolean, level: number): { line: Pt[]; closed: boolean }[] {
  const d = Math.abs(level);
  const loops = outline(f.r, d, f.d) as Pt[][];
  if (closed) {
    const want = level > 0;
    return loops
      .filter((l) => lengthOf(l) >= MIN_PIECE)
      .filter((l) => {
        // A ring is outside or inside the line as a whole; its middle point tells.
        const q = l[Math.floor(l.length / 2)];
        return !insidePoly(line, q) === want;
      })
      .map((l) => ({ line: l, closed: true }));
  }
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
  const want = level > 0 ? 1 : -1;
  const out: { line: Pt[]; closed: boolean; s: number }[] = [];
  for (const loop of loops) {
    const ring = loop.slice(0, -1);
    const info = ring.map((q) => nearest(line, cum, q));
    const keep = info.map((x) => !x.end && x.side === want);
    if (!keep.some(Boolean)) continue;
    // Start where a kept stretch begins, so no piece is cut in two by the start of the ring.
    let start = keep.findIndex((k, i) => k && !keep[(i - 1 + keep.length) % keep.length]);
    if (start < 0) start = 0;
    let piece: { pts: Pt[]; s: number[] } = { pts: [], s: [] };
    const flush = () => {
      if (piece.pts.length >= 2 && lengthOf(piece.pts) >= MIN_PIECE) {
        // Along the line's direction.
        const forward = piece.s[piece.s.length - 1] >= piece.s[0];
        const pts = forward ? piece.pts : piece.pts.slice().reverse();
        out.push({ line: pts, closed: false, s: Math.min(piece.s[0], piece.s[piece.s.length - 1]) });
      }
      piece = { pts: [], s: [] };
    };
    for (let k = 0; k < ring.length; k++) {
      const i = (start + k) % ring.length;
      if (keep[i]) {
        piece.pts.push(ring[i]);
        piece.s.push(info[i].s);
      } else flush();
    }
    flush();
  }
  return out.sort((a, b) => a.s - b.s).map(({ line: l, closed: c }) => ({ line: l, closed: c }));
}

/** The pieces of one copy, each from its end (or for loops, its point) nearest where the needle is; the first stays as it is when nothing was sewn yet. */
function order(pieces: EchoLine[], from: Pt | null): EchoLine[] {
  if (!from) return pieces;
  const todo = pieces.slice();
  const out: EchoLine[] = [];
  let at = from;
  while (todo.length) {
    let best = 0;
    let bestK = 0;
    let bestD = Infinity;
    todo.forEach((pc, j) => {
      const cands = pc.closed ? pc.line.map((_, k) => k) : [0, pc.line.length - 1];
      for (const k of cands) {
        const dd = dist(pc.line[k], at);
        if (dd < bestD) {
          bestD = dd;
          best = j;
          bestK = k;
        }
      }
    });
    const pc = todo.splice(best, 1)[0];
    let l = pc.line;
    let back = pc.back;
    if (pc.closed) {
      const open = l.slice(0, -1);
      const k = bestK % open.length;
      l = [...open.slice(k), ...open.slice(0, k), open[k]];
    } else if (bestK !== 0) {
      l = l.slice().reverse();
      back = !back;
    }
    out.push({ line: l, closed: pc.closed, back });
    at = l[l.length - 1];
  }
  return out;
}
