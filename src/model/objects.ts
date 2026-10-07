import { tagShortStitches, TIE } from '../validation/shortStitches';
import { COLOR_CHANGE, dropParent, JUMP, parentOf, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import type { Remembered } from './restitch';
import { FILL, SATIN, stitchKinds } from './sequence';

/**
 * The objects of a design. Every version of a design has a list of its objects in sewing order
 * (see "The object list of a version" below): each with a fixed id, the records it is sewn in and
 * what it knows about its shape and stitch type (restitch.ts). The list belongs to the version like
 * its stitches, so undo brings it back with them. A new version takes the objects over from the
 * version it was made from; only where its stitches are new and nobody said what they are are they
 * recognized from the stitches, as in a file from elsewhere: digitizing software trims between its
 * objects (a fill with its underlay, a satin column, an outline), so what the machine sews between
 * two trims is a section of one object; most objects are one section, some are several (see
 * groupSections).
 */

export type ObjectKind = 'fill' | 'satin' | 'run';

export interface SewObject {
  /** Position in sewing order. */
  index: number;
  /** Fixed id of the object within its design: it stays the same through every change. */
  id: number;
  /** Color block the object is sewn in. */
  block: number;
  color: ThreadColor;
  /** Record of the first and last stitch; between them stitches, jumps and the object's own trims. */
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
 * The kind an object was sewn in here, by what it remembers (restitch.ts). It goes before what the
 * stitches suggest: a small spiral fill winds too loosely to be read as one.
 */
let knownKind: ((m: Remembered | undefined) => ObjectKind | undefined) | null = null;

/** Lets restitch.ts tell sewObjects the kind of the objects it knows (it imports this module). */
export function knowKinds(f: typeof knownKind): void {
  knownKind = f;
}

export function sewObjects(p: Pattern, kinds = stitchKinds(p), tags = tagShortStitches(p)): SewObject[] {
  const out: SewObject[] = [];
  let block = 0;
  let at = 0;
  for (const e of tableOf(p).entries) {
    for (; at < e.first; at++) if (p.cmd[at] === COLOR_CHANGE) block++;
    const i = e.first;
    const j = e.last;
    const m = measure(p, kinds, i, j);
    let tieIn = 0;
    while (i + tieIn + 1 <= j && tags[i + tieIn + 1] === TIE) tieIn++;
    let tieOff = 0;
    while (j - tieOff > i + tieIn && tags[j - tieOff] === TIE) tieOff++;
    let sections = 1;
    let cut = false;
    for (let k = i + 1; k <= j; k++) {
      if (p.cmd[k] === TRIM || p.cmd[k] === COLOR_CHANGE) cut = true;
      else if (p.cmd[k] === STITCH && cut) {
        sections++;
        cut = false;
      }
    }
    out.push({
      index: out.length,
      id: e.id,
      block,
      color: p.colors[block] ?? p.colors[p.colors.length - 1] ?? GREY,
      first: i,
      last: j,
      sections,
      stitches: m.stitches,
      threadMm: m.thread,
      kind: knownKind?.(e.memory) ?? kindOf(p, i, j, m),
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

// The object list of a version -------------------------------------------------------------------

/** One object of a version: its fixed id, the records of its first and last stitch, what it knows. */
export interface Entry {
  id: number;
  first: number;
  last: number;
  memory?: Remembered;
}

/** The objects of a version in sewing order; `next` is the id the next new object gets. */
export interface Table {
  entries: Entry[];
  next: number;
}

const tables = new WeakMap<Pattern, Table>();

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

/** Where the stitches of a version are: the record of each stitch, and the number of the stitches before each record. */
interface Index {
  records: Int32Array;
  before: Int32Array;
  /** Rolling hashes over the stitches (two of them), to find runs of stitches again in a later version. */
  h1: Int32Array;
  h2: Int32Array;
}
const indexes = new WeakMap<Pattern, Index>();
const B1 = 0x01000193;
const B2 = 0x2545f491;
let pow1 = new Int32Array([1]);
let pow2 = new Int32Array([1]);

function powers(n: number): void {
  if (pow1.length > n) return;
  const len = Math.max(n + 1, pow1.length * 2);
  const a = new Int32Array(len);
  const b = new Int32Array(len);
  a[0] = b[0] = 1;
  for (let i = 1; i < len; i++) {
    a[i] = Math.imul(a[i - 1], B1);
    b[i] = Math.imul(b[i - 1], B2);
  }
  pow1 = a;
  pow2 = b;
}

const stitchValue = (x: number, y: number) => Math.imul(x, 0x9e3779b1) ^ Math.imul(y + 0x7f4a7c15, 0x85ebca6b);

/** Where the stitches of `p` are (see Index). */
export const stitchIndex = (p: Pattern): { records: Int32Array; before: Int32Array } => indexOf(p);

function indexOf(p: Pattern): Index {
  let ix = indexes.get(p);
  if (ix) return ix;
  const n = p.cmd.length;
  const before = new Int32Array(n + 1);
  let count = 0;
  for (let i = 0; i < n; i++) {
    before[i] = count;
    if (p.cmd[i] === STITCH) count++;
  }
  before[n] = count;
  const records = new Int32Array(count);
  const h1 = new Int32Array(count + 1);
  const h2 = new Int32Array(count + 1);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (p.cmd[i] !== STITCH) continue;
    records[k] = i;
    const v = stitchValue(p.x[i], p.y[i]);
    h1[k + 1] = (Math.imul(h1[k], B1) + v) | 0;
    h2[k + 1] = (Math.imul(h2[k], B2) + (v ^ 0x5bd1e995)) | 0;
    k++;
  }
  ix = { records, before, h1, h2 };
  indexes.set(p, ix);
  return ix;
}

/** Hashes of stitches a (inclusive) to b (exclusive). */
function runHash(ix: Index, a: number, b: number): [number, number] {
  powers(b - a);
  return [(ix.h1[b] - Math.imul(ix.h1[a], pow1[b - a])) | 0, (ix.h2[b] - Math.imul(ix.h2[a], pow2[b - a])) | 0];
}

/** The object list of version `p`: kept with it, taken over from the version it came from, or recognized. */
export function tableOf(p: Pattern): Table {
  const t = tables.get(p);
  if (t) return t;
  let from = parentOf(p);
  while (from && !tables.has(from)) from = parentOf(from);
  const made = derive(p, from ? { p: from, t: tables.get(from)! } : undefined);
  tables.set(p, made);
  dropParent(p);
  return made;
}

/** Whether version `p` has its object list yet. */
export const hasTable = (p: Pattern): boolean => tables.has(p);

/**
 * Lists of versions that learned something lately: where a version made without telling where it
 * came from (a pattern built anew from records) finds what its objects are.
 */
const recent: { p: Pattern; t: Table }[] = [];
const RECENT = 12;

function noteRecent(p: Pattern, t: Table): void {
  const k = recent.findIndex((x) => x.p === p);
  if (k === 0) return;
  if (k > 0) recent.splice(k, 1);
  recent.unshift({ p, t });
  if (recent.length > RECENT) recent.pop();
}

/**
 * The objects of `p` from those of the version it came from: each object whose stitches are in `p`
 * unchanged is the same object, with its id and what it knows. Stitches no object of it had are
 * found among the objects of versions that learned something lately, and what is left is
 * recognized from the stitches (sections between trims, grouped as digitizing software makes them).
 * `hint` gives the grouping and knowledge of a stored older project (see restoreObjects).
 */
function derive(p: Pattern, from?: { p: Pattern; t: Table }, hint?: { joins: ReadonlyMap<string, boolean> }): Table {
  const ix = indexOf(p);
  const n = ix.records.length;
  const claimed = new Uint8Array(n);
  const out: Entry[] = [];
  const used = new Set<number>();
  let next = from?.t.next ?? 1;
  const take = (src: { p: Pattern; t: Table }, keepIds: boolean, onlyKnown: boolean) => {
    const six = indexOf(src.p);
    // Stitches of p by their first coordinates, to find where an object's stitches start.
    const starts = new Map<number, number[]>();
    for (let k = 0; k < n; k++) {
      if (claimed[k]) continue;
      const i = ix.records[k];
      const key = stitchValue(p.x[i], p.y[i]);
      const list = starts.get(key);
      if (list) list.push(k);
      else starts.set(key, [k]);
    }
    for (const e of src.t.entries) {
      if (onlyKnown && !e.memory) continue;
      const a = six.before[e.first];
      const m = six.before[e.last] + 1 - a;
      if (m <= 0) continue;
      const [ha, hb] = runHash(six, a, a + m);
      const fx = src.p.x[e.first];
      const fy = src.p.y[e.first];
      for (const k of starts.get(stitchValue(fx, fy)) ?? []) {
        if (k + m > n || claimed[k] || claimed[k + m - 1]) continue;
        const [ga, gb] = runHash(ix, k, k + m);
        if (ga !== ha || gb !== hb) continue;
        let free = true;
        for (let j = k; j < k + m && free; j++) if (claimed[j]) free = false;
        if (!free) continue;
        // The same stitches again: the same object (a copy of it, the second time).
        claimed.fill(1, k, k + m);
        const id = keepIds && !used.has(e.id) ? e.id : 0;
        if (id) used.add(id);
        out.push({ id, first: ix.records[k], last: ix.records[k + m - 1], ...(e.memory ? { memory: e.memory } : {}) });
      }
    }
  };
  if (from) take(from, true, false);
  if (n && claimed.includes(0)) for (const r of recent) if (r.p !== from?.p && r.p !== p) take(r, false, true);
  // What is left: recognized, run by run of stitches no object had.
  const kinds = claimed.includes(0) ? stitchKinds(p) : null;
  for (let k = 0; k < n; ) {
    if (claimed[k]) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < n && !claimed[e + 1]) e++;
    for (const g of groupSections(p, sections(p, kinds!, ix.records[k], ix.records[e]), hint?.joins)) {
      out.push({ id: 0, first: g[0].first, last: g[g.length - 1].last });
    }
    k = e + 1;
  }
  out.sort((a, b) => a.first - b.first);
  for (const e of out) if (e.id >= next) next = e.id + 1;
  for (const e of out) {
    if (e.id) continue;
    e.id = next++;
    // What a copy knows is its own: it gets the copy's id.
    if (e.memory && e.memory.id !== e.id) e.memory = { ...e.memory, id: e.id };
  }
  return { entries: out, next };
}

// Changing the list -----------------------------------------------------------------------------

/** Tries in progress (see hold): each keeps the lists it changed as they were before. */
const journals: Map<Table, Table>[] = [];
/** What versions knew when they were kept (see keepVersion). */
const kept = new WeakMap<Pattern, Table>();

const copyTable = (t: Table): Table => ({ entries: t.entries.map((e) => ({ ...e })), next: t.next });

function changing(t: Table): void {
  for (const j of journals) if (!j.has(t)) j.set(t, copyTable(t));
}

function setTable(t: Table, to: Table): void {
  t.entries = to.entries.map((e) => ({ ...e }));
  t.next = to.next;
}

/**
 * Lets things be tried out: until the returned function is called the object lists that change are
 * kept as they were, and then they are put back (what the tries learned goes again).
 */
export function hold(): () => void {
  const j = new Map<Table, Table>();
  journals.push(j);
  return () => {
    const k = journals.indexOf(j);
    if (k >= 0) journals.splice(k, 1);
    for (const [t, was] of j) setTable(t, was);
  };
}

/** Keeps what `p` knows now as its own: undo and redo bring back all of it (see backToVersion). */
export function keepVersion(p: Pattern): void {
  kept.set(p, copyTable(tableOf(p)));
}

/** Brings back what version `p` knew when it was kept (undo, redo, another file). False when it never was. */
export function backToVersion(p: Pattern): boolean {
  const v = kept.get(p);
  if (!v) return false;
  const t = tableOf(p);
  changing(t);
  setTable(t, v);
  return true;
}

/** The entry of the object from record `first` to `last` of `p`, if it is one. */
export function entryOf(p: Pattern, first: number, last: number): Entry | undefined {
  const list = tableOf(p).entries;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].first < first) lo = mid + 1;
    else if (list[mid].first > first) hi = mid - 1;
    else return list[mid].last === last ? list[mid] : undefined;
  }
  return undefined;
}

/** The entry with id `id` in `p`. */
export const entryById = (p: Pattern, id: number): Entry | undefined => tableOf(p).entries.find((e) => e.id === id);

/**
 * Sets what the object from record `first` to `last` knows (its stitches become one object when
 * they were not). A memory that names another object's id takes that id along when no other
 * object of `p` has it: an object sewn anew stays the same object.
 */
export function setMemory(p: Pattern, first: number, last: number, r: Remembered | undefined): void {
  let e = entryOf(p, first, last);
  if (!e) {
    const ix = indexOf(p);
    rememberObjects(p, [ix.before[first]], ix.before[last] + 1);
    e = entryOf(p, first, last);
    if (!e) return;
  }
  const t = tableOf(p);
  changing(t);
  if (r?.id !== undefined && r.id !== e.id && r.id > 0 && !t.entries.some((x) => x.id === r.id)) {
    e.id = r.id;
    if (r.id >= t.next) t.next = r.id + 1;
  }
  if (!r) delete e.memory;
  else e.memory = r.id === e.id ? r : { ...r, id: e.id };
  if (r) noteRecent(p, t);
}

/**
 * Remembers which stitches of `p` make up one object: `starts` are the numbers of the first
 * stitch of each object (counting stitches from 0, in sewing order), and every object runs
 * up to the next start. Only what `starts` covers changes (`end`: number of the stitch after
 * the last object, else to the end). An object that keeps its stitches keeps what it knows; one
 * that changes keeps its id where it starts where it did, and knows nothing yet.
 */
export function rememberObjects(p: Pattern, starts: number[], end = Infinity): void {
  if (!starts.length) return;
  const t = tableOf(p);
  const ix = indexOf(p);
  const n = ix.records.length;
  const from = Math.max(0, starts[0]);
  const to = Math.min(end, n);
  if (from >= to) return;
  const pieces: [number, number][] = [];
  starts.forEach((s, k) => {
    const a = Math.max(s, from);
    const b = Math.min(k + 1 < starts.length ? starts[k + 1] : to, to) - 1;
    if (b >= a) pieces.push([a, b]);
  });
  const old = t.entries.map((e) => ({ e, a: ix.before[e.first], b: ix.before[e.last] }));
  if (pieces.every(([a, b]) => old.some((o) => o.a === a && o.b === b)) && old.every((o) => o.b < from || o.a >= to || pieces.some(([a, b]) => o.a === a && o.b === b))) return;
  changing(t);
  const out: Entry[] = [];
  const ids = new Set<number>();
  const add = (e: Entry) => {
    out.push(e);
    ids.add(e.id);
  };
  const piece = (a: number, b: number) => ({ first: ix.records[a], last: ix.records[b] });
  const wanted: { first: number; last: number; owner?: Entry }[] = [];
  for (const o of old) {
    if (o.b < from || o.a >= to) wanted.push({ first: o.e.first, last: o.e.last, owner: o.e });
    else {
      if (o.a < from) wanted.push(piece(o.a, from - 1));
      if (o.b >= to) wanted.push(piece(to, o.b));
    }
  }
  for (const [a, b] of pieces) wanted.push(piece(a, b));
  wanted.sort((x, y) => x.first - y.first);
  // Ids: the same stitches keep their object; a changed one keeps the id of the object it starts in.
  const byRange = new Map(old.map((o) => [`${o.e.first}:${o.e.last}`, o.e]));
  const containing = (first: number) => t.entries.find((e) => e.first <= first && first <= e.last);
  for (const w of wanted) {
    const same = byRange.get(`${w.first}:${w.last}`);
    if (same && !ids.has(same.id)) add({ ...same });
    else {
      const c = containing(w.first);
      add({ id: c && !ids.has(c.id) ? c.id : 0, first: w.first, last: w.last });
    }
  }
  for (const e of out) if (!e.id) e.id = t.next++;
  t.entries = out;
}

/** Shows object `o` as its sections from now on, each one an object. */
export function splitObject(p: Pattern, o: SewObject): void {
  const ix = indexOf(p);
  const starts = sections(p, stitchKinds(p), o.first, o.last).map((s) => ix.before[s.first]);
  rememberObjects(p, starts, ix.before[o.last + 1]);
}

/**
 * The object list of `to`, made from that of `from`: `origin[i]` is the record of `from` that
 * record i of `to` was (or -1 for a new record). Each object keeps its id and what it knows, and
 * the new records go with the object they lie in (a stitch added at an object's end, its locks,
 * goes with it), so changing what lies between objects (a trim, locks) changes no object.
 */
export function carryObjects(from: Pattern, to: Pattern, origin: Int32Array): void {
  const t0 = tableOf(from);
  const src = t0.entries;
  const owner = new Int32Array(from.cmd.length).fill(-1);
  src.forEach((e, k) => owner.fill(k, e.first, e.last + 1));
  // Each time an object's records come again (a copy) it is another object: its instances.
  const inst: { k: number; first: number; last: number }[] = [];
  const current = new Int32Array(src.length).fill(-1);
  const seen = new Int32Array(from.cmd.length).fill(-1);
  // Each stitch of `to`: the object of the record it was, else that of the stitches before it
  // without a trim between, else that of the stitches after it.
  const of = new Int32Array(to.cmd.length).fill(-1);
  let run = -1;
  for (let i = 0; i < to.cmd.length; i++) {
    const c = to.cmd[i];
    if (c === TRIM || c === COLOR_CHANGE) run = -1;
    if (c !== STITCH) continue;
    const r = origin[i];
    const k = r >= 0 ? owner[r] : -1;
    if (k >= 0) {
      if (current[k] < 0 || seen[r] === current[k]) {
        current[k] = inst.length;
        inst.push({ k, first: Infinity, last: -Infinity });
      }
      seen[r] = current[k];
      run = current[k];
    }
    of[i] = run;
  }
  run = -1;
  for (let i = to.cmd.length - 1; i >= 0; i--) {
    const c = to.cmd[i];
    if (c === TRIM || c === COLOR_CHANGE) run = -1;
    if (c !== STITCH) continue;
    if (of[i] >= 0) run = of[i];
    else of[i] = run;
  }
  for (let i = 0; i < to.cmd.length; i++) {
    const n = of[i];
    if (n < 0) continue;
    inst[n].first = Math.min(inst[n].first, i);
    inst[n].last = Math.max(inst[n].last, i);
  }
  let next = t0.next;
  const used = new Set<number>();
  const entries: Entry[] = [];
  for (const x of inst) {
    if (x.first > x.last) continue;
    const e = src[x.k];
    // The first keeps the object's id; a copy is an object of its own that knows the same.
    const id = used.has(e.id) ? next++ : e.id;
    used.add(id);
    entries.push({ ...e, id, first: x.first, last: x.last, ...(e.memory && id !== e.id ? { memory: { ...e.memory, id } } : {}) });
  }
  entries.sort((a, b) => a.first - b.first);
  // Objects whose stitches now overlap or that lost the stitches before them: recognized where needed.
  const clean = entries.filter((e, k) => k === 0 || e.first > entries[k - 1].last);
  const t: Table = { entries: clean, next };
  const ix = indexOf(to);
  const covered = new Uint8Array(ix.records.length);
  for (const e of clean) covered.fill(1, ix.before[e.first], ix.before[e.last] + 1);
  if (covered.includes(0)) {
    const kinds = stitchKinds(to);
    for (let k = 0; k < covered.length; ) {
      if (covered[k]) {
        k++;
        continue;
      }
      let e = k;
      while (e + 1 < covered.length && !covered[e + 1]) e++;
      for (const g of groupSections(to, sections(to, kinds, ix.records[k], ix.records[e]))) clean.push({ id: t.next++, first: g[0].first, last: g[g.length - 1].last });
      k = e + 1;
    }
    clean.sort((a, b) => a.first - b.first);
  }
  tables.set(to, t);
  dropParent(to);
}

/** An object as stored: its id, its first and last stitch (numbers), its stitches' key and first point, what it knows. */
export interface PlacedEntry {
  id: number;
  first: number;
  last: number;
  key: string;
  at: [number, number];
  memory?: Remembered;
}

/**
 * Sets the object list of `p` as stored with it. Each object is looked for where it was (by its
 * stitch numbers), else where its stitches are now (the file was written and read again);
 * objects not found are left out, and the stitches no object covers are recognized.
 */
export function setObjects(p: Pattern, list: PlacedEntry[], next: number): void {
  const ix = indexOf(p);
  const n = ix.records.length;
  const claimed = new Uint8Array(n);
  const ok: Entry[] = [];
  const ids = new Set<number>();
  let byStart: Map<string, number[]> | null = null;
  const fits = (a: number, e: PlacedEntry) => {
    const m = e.last - e.first + 1;
    if (a < 0 || a + m > n) return false;
    for (let k = a; k < a + m; k++) if (claimed[k]) return false;
    return stitchKey(p, ix.records[a], ix.records[a + m - 1]) === e.key;
  };
  for (const e of list) {
    if (!Number.isInteger(e.id) || e.id <= 0 || ids.has(e.id) || e.last < e.first) continue;
    let a = fits(e.first, e) ? e.first : -1;
    if (a < 0) {
      if (!byStart) {
        byStart = new Map();
        for (let k = 0; k < n; k++) {
          const key = `${p.x[ix.records[k]]},${p.y[ix.records[k]]}`;
          const l = byStart.get(key);
          if (l) l.push(k);
          else byStart.set(key, [k]);
        }
      }
      a = (byStart.get(`${e.at[0]},${e.at[1]}`) ?? []).find((k) => fits(k, e)) ?? -1;
    }
    if (a < 0) continue;
    const b = a + e.last - e.first;
    claimed.fill(1, a, b + 1);
    ids.add(e.id);
    ok.push({ id: e.id, first: ix.records[a], last: ix.records[b], ...(e.memory ? { memory: e.memory.id === e.id ? e.memory : { ...e.memory, id: e.id } } : {}) });
  }
  let nextId = Math.max(next || 1, ...ok.map((e) => e.id + 1));
  if (claimed.includes(0)) {
    const kinds = stitchKinds(p);
    for (let k = 0; k < n; ) {
      if (claimed[k]) {
        k++;
        continue;
      }
      let e = k;
      while (e + 1 < n && !claimed[e + 1]) e++;
      for (const g of groupSections(p, sections(p, kinds, ix.records[k], ix.records[e]))) ok.push({ id: nextId++, first: g[0].first, last: g[g.length - 1].last });
      k = e + 1;
    }
  }
  ok.sort((a, b) => a.first - b.first);
  const t = tables.get(p);
  if (t) {
    changing(t);
    t.entries = ok;
    t.next = nextId;
  } else tables.set(p, { entries: ok, next: nextId });
  dropParent(p);
}

/**
 * The object list of `p` from what an older project stored (version 1): which sections continued
 * the object before (`joins`, by their stitches), and what objects knew, by their stitches.
 */
export function setObjectsFromKeys(p: Pattern, joins: ReadonlyMap<string, boolean>, memory: ReadonlyMap<string, Remembered>): void {
  const t = derive(p, undefined, { joins });
  for (const e of t.entries) {
    const m = memory.get(stitchKey(p, e.first, e.last));
    if (m) e.memory = { ...m, id: e.id };
  }
  const was = tables.get(p);
  if (was) {
    changing(was);
    setTable(was, t);
  } else tables.set(p, t);
  dropParent(p);
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

/** The sections from record a to record b (both stitches). */
function sections(p: Pattern, kinds: Uint8Array, a = 0, b = p.cmd.length - 1): Section[] {
  const out: Section[] = [];
  let block = 0;
  for (let i = 0; i < a; i++) if (p.cmd[i] === COLOR_CHANGE) block++;
  for (let i = a; i <= b; i++) {
    const c = p.cmd[i];
    if (c === COLOR_CHANGE) block++;
    if (c !== STITCH) continue;
    let j = i;
    for (let k = i + 1; k <= b && (p.cmd[k] === STITCH || p.cmd[k] === JUMP); k++) if (p.cmd[k] === STITCH) j = k;
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
function groupSections(p: Pattern, secs: Section[], joins?: ReadonlyMap<string, boolean>): Section[][] {
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
    const known = joins?.size ? joins.get(sectionKey(p, s)) : undefined;
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
  // The same stitches come back with every new version of a design: worked out once for them.
  const id = rangeKey(p, a, b);
  let share = shares.get(id);
  if (share === undefined) {
    share = workOutCoverShare(p, a, b);
    shares.set(id, share);
    if (shares.size > SHARES_SIZE) shares.delete(shares.keys().next().value!);
  }
  return share;
}

/** Cover shares by the records they were worked out from (oldest first, at most SHARES_SIZE). */
const shares = new Map<string, number>();
const SHARES_SIZE = 4000;

/** A key for the records from a to b (FNV-1a over commands and coordinates). */
function rangeKey(p: Pattern, a: number, b: number): string {
  let h = 0x811c9dc5;
  for (let i = a; i <= b; i++) {
    h = Math.imul(h ^ p.cmd[i], 0x01000193);
    h = Math.imul(h ^ p.x[i], 0x01000193);
    h = Math.imul(h ^ p.y[i], 0x01000193);
  }
  return `${b - a}:${h >>> 0}`;
}

function workOutCoverShare(p: Pattern, a: number, b: number): number {
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

