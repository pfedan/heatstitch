import { tagShortStitches, TIE } from '../validation/shortStitches';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { FILL, SATIN, stitchKinds } from './sequence';

/**
 * The objects of a design as far as the stitches tell them. Digitizing software trims between its
 * objects (a fill with its underlay, a satin column, an outline), so what the machine sews between
 * two trims is a section of one object; most objects are one section, some are several (see
 * groupSections). An object is the unit that can be sewn earlier or later without changing what
 * it looks like, and every object starts and ends with its thread cut.
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
  /** Pieces from trim to trim it is sewn in (its underlay or a fill sewn in parts has more than one). */
  sections: number;
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

/**
 * The kind an object was sewn in here, by its stitches (what restitch.ts remembers). It goes before
 * what the stitches suggest: a small spiral fill winds too loosely to be read as one.
 */
let knownKind: ((p: Pattern, first: number, last: number) => ObjectKind | undefined) | null = null;

/** Lets restitch.ts tell sewObjects the kind of the objects it knows (it imports this module). */
export function knowKinds(f: typeof knownKind): void {
  knownKind = f;
}

export function sewObjects(p: Pattern, kinds = stitchKinds(p), tags = tagShortStitches(p)): SewObject[] {
  const out: SewObject[] = [];
  for (const g of groupSections(p, sections(p, kinds))) {
    const first = g[0];
    const last = g[g.length - 1];
    const i = first.first;
    const j = last.last;
    const m = measure(p, kinds, i, j);
    let tieIn = 0;
    while (i + tieIn + 1 <= j && tags[i + tieIn + 1] === TIE) tieIn++;
    let tieOff = 0;
    while (j - tieOff > i + tieIn && tags[j - tieOff] === TIE) tieOff++;
    out.push({
      index: out.length,
      block: first.block,
      color: p.colors[first.block] ?? p.colors[p.colors.length - 1] ?? GREY,
      first: i,
      last: j,
      sections: g.length,
      stitches: m.stitches,
      threadMm: m.thread,
      kind: knownKind?.(p, i, j) ?? kindOf(p, i, j, m),
      tieIn,
      tieOff,
      minX: m.minX,
      minY: m.minY,
      maxX: m.maxX,
      maxY: m.maxY,
    });
  }
  return out;
}

interface Measure {
  stitches: number;
  thread: number;
  /** Thread per stitch kind (mm). */
  len: Record<number, number>;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function measure(p: Pattern, kinds: Uint8Array, i: number, j: number): Measure {
  const m: Measure = { stitches: 0, thread: 0, len: {}, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let k = i; k <= j; k++) {
    if (p.cmd[k] !== STITCH) continue;
    m.stitches++;
    m.minX = Math.min(m.minX, p.x[k]);
    m.maxX = Math.max(m.maxX, p.x[k]);
    m.minY = Math.min(m.minY, p.y[k]);
    m.maxY = Math.max(m.maxY, p.y[k]);
    if (k === i || p.cmd[k - 1] !== STITCH) continue;
    const l = Math.hypot(p.x[k] - p.x[k - 1], p.y[k] - p.y[k - 1]) / 10;
    m.thread += l;
    m.len[kinds[k]] = (m.len[kinds[k]] ?? 0) + l;
  }
  return m;
}

function kindOf(p: Pattern, i: number, j: number, m: Measure): ObjectKind {
  const fill = m.len[FILL] ?? 0;
  const satin = m.len[SATIN] ?? 0;
  const kind: ObjectKind = fill >= m.thread * 0.3 && fill >= satin ? 'fill' : satin >= m.thread * 0.3 ? 'satin' : 'run';
  // Back and forth along a line (a double run) looks like rows to the recognizer, but covers no area;
  // a line that winds closely over an area (a spiral or contour fill) does.
  if (kind === 'fill' && coverShare(p, i, j) < AREA) return 'run';
  if (kind === 'run' && m.stitches > 30 && coverShare(p, i, j) >= DENSE_AREA) return 'fill';
  return kind;
}

// Sections and how they make up objects ----------------------------------------------------------

/**
 * Sections known to continue the object before them (true) or to start one (false), by their
 * stitches: what the Image mode sewed as one object, and objects given new stitches here. That goes
 * before what the stitches suggest.
 */
const joins = new Map<string, boolean>();
const JOINS_SIZE = 4000;

/** A key for the stitches from record a to b (FNV-1a over their coordinates). */
export function stitchKey(p: Pattern, a: number, b: number): string {
  let h = 0x811c9dc5;
  let n = 0;
  const mix = (v: number) => {
    h ^= v & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  };
  for (let i = a; i <= b; i++) {
    if (p.cmd[i] !== STITCH) continue;
    mix(p.x[i]);
    mix(p.y[i]);
    n++;
  }
  return `${n}:${(h >>> 0).toString(36)}`;
}

const sectionKey = (p: Pattern, s: Section) => `s${stitchKey(p, s.first, s.last)}`;

let joinsHeld = 0;

/** As holdMemory (restitch.ts) for the sections: call the returned function to put them back. */
export function holdJoins(): () => void {
  const saved = new Map(joins);
  joinsHeld++;
  return () => {
    joinsHeld--;
    joins.clear();
    for (const [k, v] of saved) joins.set(k, v);
  };
}

function rememberJoin(key: string, join: boolean): void {
  joins.delete(key);
  joins.set(key, join);
  if (!joinsHeld && joins.size > JOINS_SIZE) joins.delete(joins.keys().next().value!);
}

/**
 * Remembers which sections of `p` make up one object: `starts` are the numbers of the first
 * stitch of each object (counting stitch records from 0, in sewing order), and every object runs
 * up to the next start. Only what `starts` covers is remembered (`end`: number of the stitch after
 * the last object, else to the end).
 */
export function rememberObjects(p: Pattern, starts: number[], end = Infinity): void {
  if (!starts.length) return;
  const number = new Int32Array(p.cmd.length);
  let n = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    number[i] = n;
    if (p.cmd[i] === STITCH) n++;
  }
  let owner = -2;
  for (const s of sections(p, stitchKinds(p))) {
    const at = number[s.first];
    if (at < starts[0] || at >= end) {
      owner = -2;
      continue;
    }
    let o = 0;
    while (o + 1 < starts.length && starts[o + 1] <= at) o++;
    rememberJoin(sectionKey(p, s), o === owner);
    owner = o;
  }
}

/** Number of stitches before each record. */
function stitchesBefore(p: Pattern): Int32Array {
  const number = new Int32Array(p.cmd.length + 1);
  let n = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    number[i] = n;
    if (p.cmd[i] === STITCH) n++;
  }
  number[p.cmd.length] = n;
  return number;
}

/** Sews the objects `objs` (one after the other in one color) as one object from now on. */
export function joinObjects(p: Pattern, objs: SewObject[]): void {
  if (!objs.length) return;
  const number = stitchesBefore(p);
  rememberObjects(p, [number[objs[0].first]], number[objs[objs.length - 1].last + 1]);
}

/** Shows object `o` as its sections from now on, each one an object. */
export function splitObject(p: Pattern, o: SewObject): void {
  const number = stitchesBefore(p);
  const starts = sections(p, stitchKinds(p))
    .filter((s) => s.first >= o.first && s.last <= o.last)
    .map((s) => number[s.first]);
  rememberObjects(p, starts, number[o.last + 1]);
}

/** What is remembered about the sections of `p`, to store it with the file. */
export function joinsIn(p: Pattern): { key: string; join: boolean }[] {
  const out: { key: string; join: boolean }[] = [];
  for (const s of sections(p, stitchKinds(p))) {
    const key = sectionKey(p, s);
    const join = joins.get(key);
    if (join !== undefined) out.push({ key, join });
  }
  return out;
}

export function restoreJoin(key: string, join: boolean): void {
  rememberJoin(key, join);
}

/** Forgets every section memory, as a fresh page would (tests). */
export function forgetJoins(): void {
  joins.clear();
}

/** What is sewn from one trim (or color change) to the next. */
interface Section {
  block: number;
  first: number;
  last: number;
  stitches: number;
  thread: number;
  kind: ObjectKind;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Cells its thread passes through (lazily). */
  cells?: Set<number>;
  /** Direction of its long stitches per cell, as doubled-angle vectors (lazily). */
  dirs?: Map<number, [number, number]>;
}

function sections(p: Pattern, kinds: Uint8Array): Section[] {
  const out: Section[] = [];
  const n = p.cmd.length;
  let block = 0;
  for (let i = 0; i < n; i++) {
    const c = p.cmd[i];
    if (c === COLOR_CHANGE) block++;
    if (c !== STITCH) continue;
    let j = i;
    for (let k = i + 1; k < n && (p.cmd[k] === STITCH || p.cmd[k] === JUMP); k++) if (p.cmd[k] === STITCH) j = k;
    const m = measure(p, kinds, i, j);
    out.push({ block, first: i, last: j, stitches: m.stitches, thread: m.thread, kind: kindOf(p, i, j, m), minX: m.minX, minY: m.minY, maxX: m.maxX, maxY: m.maxY });
    i = j;
  }
  return out;
}

/** Sections this small (stitches, or thread in mm) are leftovers: locks, a short end. */
const TINY_STITCHES = 12;
const TINY_THREAD = 3;
/** Share of a running stitch that has to lie on an object to be its underlay or travel. */
const INSIDE = 0.8;
/** Neighbouring cells along which fill pieces have to touch to be one area. */
const CONTACT = 3;
/** Fill pieces whose rows meet at this angle or less where they touch are one area (radians). */
const SAME_ANGLE = (20 * Math.PI) / 180;
/** Sections looked ahead for what covers an underlay. */
const LOOKAHEAD = 12;

const tiny = (s: Section) => s.stitches < TINY_STITCHES || s.thread < TINY_THREAD;

/**
 * Which sections belong together. Digitizing software (and the Image mode) trims inside an object
 * too: before the rows when the underlay ends far from where they start, and between the pieces a
 * fill is sewn in when the way between them is long. Following one another in one color:
 * - running stitch that the fills or satins sewn next cover is their underlay (it is not seen),
 * - running stitch that lies on the pieces of one fill before and after it is travel or underlay,
 * - fill pieces that touch along an edge and have rows in the same direction are one area,
 * - a leftover (locks, a few stitches) goes with what it touches.
 * Fills in other directions, or not sewn one after the other, stay apart: that is on purpose.
 */
function groupSections(p: Pattern, secs: Section[]): Section[][] {
  const cellsOf = (s: Section) => (s.cells ??= threadCells(p, s.first, s.last));
  const dirsOf = (s: Section) => (s.dirs ??= rowDirections(p, s.first, s.last));
  const near = (a: Section, b: Section) => a.block === b.block && boxesMeet(a, b, CELL);
  const touch = (a: Section, b: Section, need: number) => near(a, b) && contact(cellsOf(a), cellsOf(b), need);
  const onTop = (s: Section, on: Section[]) => {
    const cs = on.filter((o) => near(s, o)).map(cellsOf);
    return cs.length > 0 && share(cellsOf(s), cs) >= INSIDE;
  };
  const covering = (s: Section) => s.kind === 'fill' || s.kind === 'satin';
  // Underlay: running stitch covered by the fills (or satins) that follow it in its color.
  const under = new Set<Section>();
  secs.forEach((s, k) => {
    if (s.kind !== 'run' || tiny(s)) return;
    const ahead: Section[] = [];
    for (let m = k + 1; m < secs.length && m <= k + LOOKAHEAD && secs[m].block === s.block; m++) {
      const t = secs[m];
      if (!covering(t)) continue;
      if (ahead.length && t.kind !== ahead[0].kind) break;
      ahead.push(t);
    }
    if (onTop(s, ahead)) under.add(s);
  });
  type Group = { secs: Section[]; fills: Section[] };
  const groups: Group[] = [];
  // A fill piece continues the fills of a group where it touches them with rows in the same direction.
  const sameArea = (g: Group, s: Section) => {
    if (s.kind !== 'fill' || !g.fills.length || g.secs.some((x) => x.kind === 'satin')) return false;
    const by = g.fills.filter((f) => touch(f, s, CONTACT));
    return by.length > 0 && rowsMeet(dirsOf(s), by.map(dirsOf));
  };
  for (let k = 0; k < secs.length; k++) {
    const s = secs[k];
    const g = groups[groups.length - 1];
    if (!g || g.secs[0].block !== s.block) {
      groups.push({ secs: [s], fills: s.kind === 'fill' ? [s] : [] });
      continue;
    }
    const next = secs[k + 1]?.block === s.block ? secs[k + 1] : undefined;
    const underlayOnly = g.secs.every((x) => tiny(x) || under.has(x));
    const known = joins.size ? joins.get(sectionKey(p, s)) : undefined;
    let join = false;
    if (known !== undefined) join = known;
    else if (g.secs.every(tiny)) join = g.secs.some((x) => touch(x, s, 1));
    else if (tiny(s)) join = g.secs.some((x) => touch(x, s, 1)) || !(next && touch(s, next, 1));
    else if (s.kind === 'run') {
      // Travel between pieces of a fill stays with it; underlay of what comes next goes with that.
      join = (!!next && sameArea(g, next) && onTop(s, [...g.fills, next])) || (under.has(s) && underlayOnly);
    } else if (underlayOnly) join = g.secs.some((x) => !tiny(x) && touch(x, s, CONTACT));
    else join = sameArea(g, s);
    if (!join) groups.push({ secs: [s], fills: s.kind === 'fill' ? [s] : [] });
    else {
      g.secs.push(s);
      if (s.kind === 'fill') g.fills.push(s);
    }
  }
  return groups.map((g) => g.secs);
}

const boxesMeet = (a: Section, b: Section, pad: number) => !(a.maxX + pad < b.minX || b.maxX + pad < a.minX || a.maxY + pad < b.minY || b.maxY + pad < a.minY);

const cellKey = (cx: number, cy: number) => cx * 100003 + cy;

/** Whether at least `need` cells of `a` are in `b` or next to one of its cells. */
function contact(a: Set<number>, b: Set<number>, need: number): boolean {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let n = 0;
  for (const c of small) if (nextTo(large, c) && ++n >= need) return true;
  return false;
}

function nextTo(set: Set<number>, c: number): boolean {
  if (set.has(c)) return true;
  for (const d of [1, -1, 100003, -100003, 100004, 100002, -100002, -100004]) if (set.has(c + d)) return true;
  return false;
}

/** Share of the cells `a` that lie in or next to the cells of one of `on`. */
function share(a: Set<number>, on: Set<number>[]): number {
  if (!a.size) return 0;
  let n = 0;
  for (const c of a) if (on.some((b) => nextTo(b, c))) n++;
  return n / a.size;
}

/** Grid for the directions of rows (0.1 mm): about the spacing of rows, so a fill covers every cell. */
const ROW_CELL = 5;

/**
 * Directions of the rows from record a to b: per cell of the ROW_CELL grid that is covered all
 * around (inside an area, not on a single line like an underlay or travel), the direction of the
 * stitches of at least 0.8 mm through it, as doubled-angle vectors.
 */
function rowDirections(p: Pattern, a: number, b: number): Map<number, [number, number]> {
  const all = new Map<number, [number, number]>();
  for (let k = a + 1; k <= b; k++) {
    if (p.cmd[k] !== STITCH || p.cmd[k - 1] !== STITCH) continue;
    const dx = p.x[k] - p.x[k - 1];
    const dy = p.y[k] - p.y[k - 1];
    const l = Math.hypot(dx, dy);
    const long = l >= 8;
    const c2 = long ? (dx * dx - dy * dy) / (l * l) : 0;
    const s2 = long ? (2 * dx * dy) / (l * l) : 0;
    const x0 = p.x[k - 1] / ROW_CELL;
    const y0 = p.y[k - 1] / ROW_CELL;
    const steps = Math.max(1, Math.ceil((l / ROW_CELL) * 2));
    for (let s = 0; s <= steps; s++) {
      const key = cellKey(Math.floor(x0 + (dx / ROW_CELL) * (s / steps)), Math.floor(y0 + (dy / ROW_CELL) * (s / steps)));
      const v = all.get(key);
      if (v) {
        v[0] += c2;
        v[1] += s2;
      } else all.set(key, [c2, s2]);
    }
  }
  const out = new Map<number, [number, number]>();
  for (const [c, v] of all) {
    if ((v[0] || v[1]) && all.has(c + 1) && all.has(c - 1) && all.has(c + 100003) && all.has(c - 100003)) out.set(c, v);
  }
  return out;
}

/**
 * Whether the rows of `a` go on in the direction of the rows in `others` where they touch: the
 * mean difference of direction over the cells of `a` next to theirs is at most SAME_ANGLE (a
 * piece may meet the others at a corner only, so one cell is enough).
 */
function rowsMeet(a: Map<number, [number, number]>, others: Map<number, [number, number]>[]): boolean {
  let agree = 0;
  let n = 0;
  for (const [c, [ax, ay]] of a) {
    for (const d of [0, 1, -1, 100003, -100003, 100004, 100002, -100002, -100004]) {
      const o = others.find((m) => m.has(c + d))?.get(c + d);
      if (!o) continue;
      const la = Math.hypot(ax, ay);
      const lo = Math.hypot(o[0], o[1]);
      if (la < 1e-6 || lo < 1e-6) break;
      agree += (ax * o[0] + ay * o[1]) / (la * lo);
      n++;
      break;
    }
  }
  return n > 0 && agree / n >= Math.cos(2 * SAME_ANGLE);
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
const cells = (p: Pattern, o: SewObject) => threadCells(p, o.first, o.last);

/** Cells (on a global CELL grid) the thread from record a to b passes through. */
function threadCells(p: Pattern, a: number, b: number): Set<number> {
  const out = new Set<number>();
  const key = cellKey;
  for (let k = a; k <= b; k++) {
    if (p.cmd[k] !== STITCH) continue;
    const x1 = p.x[k] / CELL;
    const y1 = p.y[k] / CELL;
    if (k === a || p.cmd[k - 1] !== STITCH) {
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

