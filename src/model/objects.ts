import { tagShortStitches, TIE } from '../validation/shortStitches';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { FILL, SATIN, stitchKinds } from './sequence';

/**
 * The objects of a design as far as the stitches tell them: everything the machine sews between
 * two trims is one object. Digitizing software trims between its objects (a fill with its
 * underlay, a satin column, an outline) and only jumps short distances inside one, so this is the
 * unit that can be sewn earlier or later without changing what it looks like, and every object
 * starts and ends with its thread cut.
 */

export type ObjectKind = 'fill' | 'satin' | 'run';

export interface SewObject {
  /** Position in sewing order. */
  index: number;
  /** Color block the object is sewn in. */
  block: number;
  color: ThreadColor;
  /** Record of the first and last stitch; between them only stitches and jumps. */
  first: number;
  last: number;
  stitches: number;
  /** Thread on the fabric (mm). */
  threadMm: number;
  /** What most of its thread is. */
  kind: ObjectKind;
  /** Lock stitches at its start and end (count of records). */
  tieIn: number;
  tieOff: number;
  /** Bounds of its stitches, 0.1 mm. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const GREY: ThreadColor = { r: 128, g: 128, b: 128 };

export function sewObjects(p: Pattern, kinds = stitchKinds(p), tags = tagShortStitches(p)): SewObject[] {
  const out: SewObject[] = [];
  const n = p.cmd.length;
  let block = 0;
  for (let i = 0; i < n; i++) {
    const c = p.cmd[i];
    if (c === COLOR_CHANGE) block++;
    if (c !== STITCH) continue;
    let j = i;
    for (let k = i + 1; k < n && (p.cmd[k] === STITCH || p.cmd[k] === JUMP); k++) if (p.cmd[k] === STITCH) j = k;
    let thread = 0;
    let stitches = 0;
    const len: Record<number, number> = {};
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = i; k <= j; k++) {
      if (p.cmd[k] !== STITCH) continue;
      stitches++;
      minX = Math.min(minX, p.x[k]);
      maxX = Math.max(maxX, p.x[k]);
      minY = Math.min(minY, p.y[k]);
      maxY = Math.max(maxY, p.y[k]);
      if (k === i || p.cmd[k - 1] !== STITCH) continue;
      const l = Math.hypot(p.x[k] - p.x[k - 1], p.y[k] - p.y[k - 1]) / 10;
      thread += l;
      len[kinds[k]] = (len[kinds[k]] ?? 0) + l;
    }
    let tieIn = 0;
    while (i + tieIn + 1 <= j && tags[i + tieIn + 1] === TIE) tieIn++;
    let tieOff = 0;
    while (j - tieOff > i + tieIn && tags[j - tieOff] === TIE) tieOff++;
    const fill = len[FILL] ?? 0;
    const satin = len[SATIN] ?? 0;
    let kind: ObjectKind = fill >= thread * 0.3 && fill >= satin ? 'fill' : satin >= thread * 0.3 ? 'satin' : 'run';
    // Back and forth along a line (a double run) looks like rows to the recognizer, but covers no area;
    // a line that winds closely over an area (a spiral or contour fill) does.
    if (kind === 'fill' && coverShare(p, i, j) < AREA) kind = 'run';
    else if (kind === 'run' && stitches > 30 && coverShare(p, i, j) >= DENSE_AREA) kind = 'fill';
    out.push({
      index: out.length,
      block,
      color: p.colors[block] ?? p.colors[p.colors.length - 1] ?? GREY,
      first: i,
      last: j,
      stitches,
      threadMm: thread,
      kind,
      tieIn,
      tieOff,
      minX,
      minY,
      maxX,
      maxY,
    });
    i = j;
  }
  return out;
}

/** Share of covered cells inside the covered area above which stitches cover an area. */
const AREA = 0.2;
/** Running stitch that covers this much is a fill sewn as one line. */
const DENSE_AREA = 0.5;

/**
 * How much the stitches from record a to b cover an area rather than a line: the share of the
 * 0.5 mm cells they pass through that have all four neighbours covered too (0 when too few).
 */
function coverShare(p: Pattern, a: number, b: number): number {
  const seen = new Set<number>();
  const key = (cx: number, cy: number) => cx * 100003 + cy;
  for (let k = a + 1; k <= b; k++) {
    if (p.cmd[k] !== STITCH || p.cmd[k - 1] !== STITCH) continue;
    const x0 = p.x[k - 1] / 5;
    const y0 = p.y[k - 1] / 5;
    const x1 = p.x[k] / 5;
    const y1 = p.y[k] / 5;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
    for (let s = 0; s <= steps; s++) seen.add(key(Math.floor(x0 + ((x1 - x0) * s) / steps), Math.floor(y0 + ((y1 - y0) * s) / steps)));
  }
  let inner = 0;
  for (const c of seen) {
    const cx = Math.floor(c / 100003 + 0.5);
    const cy = c - cx * 100003;
    if (seen.has(key(cx + 1, cy)) && seen.has(key(cx - 1, cy)) && seen.has(key(cx, cy + 1)) && seen.has(key(cx, cy - 1))) inner++;
  }
  return inner >= 4 ? inner / seen.size : 0;
}

/** Number of an object among the objects of its kind in its color block (1-based), for its name. */
export function numberInColor(objs: SewObject[], o: SewObject): number {
  let n = 0;
  for (const x of objs) {
    if (x.block === o.block && x.kind === o.kind) n++;
    if (x === o) break;
  }
  return n;
}

/** Whether a trim (or color change) lies between the end of object a and the start of b (a sewn right before b). */
export function trimmedBetween(p: Pattern, a: SewObject, b: SewObject): boolean {
  for (let i = a.last + 1; i < b.first; i++) if (p.cmd[i] === TRIM || p.cmd[i] === COLOR_CHANGE) return true;
  return false;
}

/** Grid cell for the overlap test (0.1 mm). */
const CELL = 4;
/** Objects share at least this many cells to count as lying on top of each other. */
const SHARED = 2;

/** Cells (on a global CELL grid) the thread of an object passes through. */
function cells(p: Pattern, o: SewObject): Set<number> {
  const out = new Set<number>();
  const key = (cx: number, cy: number) => cx * 100003 + cy;
  for (let k = o.first; k <= o.last; k++) {
    if (p.cmd[k] !== STITCH) continue;
    const x1 = p.x[k] / CELL;
    const y1 = p.y[k] / CELL;
    if (k === o.first || p.cmd[k - 1] !== STITCH) {
      out.add(key(Math.floor(x1), Math.floor(y1)));
      continue;
    }
    const x0 = p.x[k - 1] / CELL;
    const y0 = p.y[k - 1] / CELL;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.add(key(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t)));
    }
  }
  return out;
}

/**
 * Pairs of objects that lie on top of each other: `over[b]` lists the objects sewn before b that b
 * covers in places. Their order decides what is seen, so it has to stay.
 */
export function overlaps(p: Pattern, objs: SewObject[]): number[][] {
  const over: number[][] = objs.map(() => []);
  const cache = new Map<number, Set<number>>();
  const cellsOf = (i: number) => {
    let c = cache.get(i);
    if (!c) {
      c = cells(p, objs[i]);
      cache.set(i, c);
    }
    return c;
  };
  const pad = CELL;
  for (let b = 0; b < objs.length; b++) {
    const B = objs[b];
    for (let a = 0; a < b; a++) {
      const A = objs[a];
      if (A.maxX + pad < B.minX || B.maxX + pad < A.minX || A.maxY + pad < B.minY || B.maxY + pad < A.minY) continue;
      const ca = cellsOf(a);
      const cb = cellsOf(b);
      const [small, large] = ca.size < cb.size ? [ca, cb] : [cb, ca];
      let shared = 0;
      for (const c of small) {
        if (large.has(c) && ++shared >= SHARED) break;
      }
      if (shared >= SHARED) over[b].push(a);
    }
  }
  return over;
}
