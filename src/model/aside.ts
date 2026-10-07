import type { DigitizeOptions } from '../digitize/digitize';
import { formFrom, storeForm, type Form, type StoredPath } from '../shape/path';
import { addShape, insertObject } from './addShape';
import { recs, type Rec } from './jumps';
import { sewObjects, type ObjectKind } from './objects';
import { nextVersion, STITCH, type Pattern, type ThreadColor } from './pattern';
import { memoryFrom, remember, storedOf, type StoredObject } from './restitch';
import { formOf } from './reshape';
import { deleteObjects } from './shapeOps';
import { stitchKinds } from './sequence';

/**
 * Shapes that are not sewn: switched off (kept with their stitches and settings, to sew them again
 * at their place) or guides (lines and outlines to work along, never sewn), and shapes left out
 * when a file came in (a background). They belong to a version of the pattern like its stitches,
 * so undo takes them back with it.
 */

export type AsideRole = 'off' | 'guide';

export interface AsideShape {
  /** Stable within a file (names its row). */
  id: number;
  role: AsideRole;
  /** What it was, for its name and icon. */
  kind: ObjectKind;
  color: ThreadColor;
  /** Object it was sewn after (-1: the first one), to sew it there again. */
  after: number;
  /** Its stitches as they were (absent for shapes that never had any). */
  records?: Rec[];
  /** What the object remembered (settings, curves). */
  memory?: StoredObject;
  /** Its outline or line as curves, for the canvas and to sew it anew. */
  form?: Form;
  /** Lines: sewn along, not filled. */
  line?: { width: number };
  /** Why it is aside when it came that way. */
  reason?: 'background';
}

const asides = new WeakMap<Pattern, AsideShape[]>();
const NONE: AsideShape[] = [];

/** The shapes aside in this version of the pattern. */
export const asideOf = (p: Pattern | null | undefined): AsideShape[] => (p && asides.get(p)) || NONE;

/** A version of `p` (same stitches) with `list` aside: a new undo step without new stitches. */
export function withAside(p: Pattern, list: AsideShape[]): Pattern {
  const next = nextVersion(p, {});
  asides.set(next, list);
  return next;
}

/** A new version of the pattern keeps the shapes aside of the one before (unless it has its own). */
export function inheritAside(from: Pattern, to: Pattern): void {
  if (!asides.has(to)) asides.set(to, asideOf(from));
}

export function setAsideOf(p: Pattern, list: AsideShape[]): void {
  asides.set(p, list);
}

const nextId = (list: AsideShape[]) => list.reduce((m, a) => Math.max(m, a.id), 0) + 1;

/** The points of a running stitch as an open line of corners. */
function lineOf(p: Pattern, first: number, last: number): Form | null {
  const nodes = [];
  for (let i = first; i <= last; i++) {
    if (p.cmd[i] !== STITCH) continue;
    const pt: [number, number] = [p.x[i] / 10, p.y[i] / 10];
    nodes.push({ p: pt, a: pt, b: pt, smooth: false });
  }
  return nodes.length >= 2 ? { paths: [{ closed: false, nodes }] } : null;
}

/**
 * The objects `which` taken out of the stitches and kept aside in `role`, with their stitches and
 * settings. Null when nothing would be left to sew.
 */
export function setAside(p: Pattern, which: number[], role: AsideRole, trimMm: number): Pattern | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const sorted = [...which].sort((a, b) => a - b).filter((o) => objs[o]);
  if (!sorted.length) return null;
  const list = [...asideOf(p)];
  let id = nextId(list);
  sorted.forEach((o, k) => {
    const obj = objs[o];
    const known = storedOf(p, obj);
    const form = (known?.form && formFrom(known.form)) || (known?.path && formFrom(known.path)) || (obj.kind === 'fill' ? formOf(p, obj, kinds) : obj.kind === 'run' ? lineOf(p, obj.first, obj.last) : null);
    list.push({
      id: id++,
      role,
      kind: obj.kind,
      color: obj.color,
      // The ones before it that go aside too are not there to follow.
      after: o - 1 - k,
      records: recs(p, obj.first, obj.last + 1).map(({ x, y, cmd }) => ({ x, y, cmd })),
      ...(known ? { memory: known } : {}),
      ...(form ? { form } : {}),
      ...(obj.kind === 'run' ? { line: { width: 0 } } : {}),
    });
  });
  const next = deleteObjects(p, sorted, trimMm);
  if (!next) return null;
  asides.set(next, list);
  return next;
}

/** Shape `id` in another role (still not sewn). */
export function setAsideRole(p: Pattern, id: number, role: AsideRole): Pattern | null {
  const list = asideOf(p);
  const a = list.find((x) => x.id === id);
  if (!a || a.role === role) return null;
  return withAside(p, list.map((x) => (x === a ? { ...a, role } : x)));
}

/** Shape `id` dropped for good. */
export function dropAside(p: Pattern, id: number): Pattern | null {
  const list = asideOf(p);
  if (!list.some((x) => x.id === id)) return null;
  return withAside(p, list.filter((x) => x.id !== id));
}

/**
 * Shape `id` sewn again: its own stitches where it was sewn before (after the object it followed),
 * or, without stitches, sewn anew from its curves. Null when that did not work.
 */
export function sewAgain(p: Pattern, id: number, options: DigitizeOptions): { pattern: Pattern; start: number } | null {
  const list = asideOf(p);
  const a = list.find((x) => x.id === id);
  if (!a) return null;
  const count = sewObjects(p).length;
  const after = Math.min(a.after, count - 1);
  let r: { pattern: Pattern; start: number } | null = null;
  if (a.records?.some((x) => x.cmd === STITCH)) {
    r = insertObject(p, a.records, a.color, count ? after : null, options.trimMm);
    if (r && a.memory) {
      const obj = sewObjects(r.pattern).find((o) => stitchesBefore(r!.pattern, o.first) === r!.start);
      const m = obj && memoryFrom(a.memory);
      if (obj && m) remember(r.pattern, obj, m);
    }
  } else if (a.form) {
    r = addShape(p, { form: a.form, kind: a.line ? 'stroke' : 'fill', ...(a.line ? { width: Math.max(0.4, a.line.width) } : {}) }, a.color, count ? after : null, options);
  }
  if (!r) return null;
  asides.set(
    r.pattern,
    list.filter((x) => x.id !== id),
  );
  return r;
}

function stitchesBefore(p: Pattern, record: number): number {
  let n = 0;
  for (let i = 0; i < record; i++) if (p.cmd[i] === STITCH) n++;
  return n;
}

/** As stored with the file. */
export interface StoredAside {
  id: number;
  role: AsideRole;
  kind: ObjectKind;
  color: ThreadColor;
  after: number;
  records?: number[];
  memory?: StoredObject;
  form?: StoredPath[];
  line?: { width: number };
  reason?: 'background';
}

export function storeAside(list: AsideShape[]): StoredAside[] {
  return list.map((a) => ({
    id: a.id,
    role: a.role,
    kind: a.kind,
    color: { ...a.color },
    after: a.after,
    ...(a.records ? { records: a.records.flatMap((r) => [r.x, r.y, r.cmd]) } : {}),
    ...(a.memory ? { memory: a.memory } : {}),
    ...(a.form ? { form: storeForm(a.form) } : {}),
    ...(a.line ? { line: { ...a.line } } : {}),
    ...(a.reason ? { reason: a.reason } : {}),
  }));
}

const KINDS: ObjectKind[] = ['fill', 'satin', 'run'];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Stored shapes back, dropping malformed entries. */
export function asideFrom(list: unknown): AsideShape[] {
  if (!Array.isArray(list)) return [];
  const out: AsideShape[] = [];
  for (const e of list as StoredAside[]) {
    if (!e || !finite(e.id) || (e.role !== 'off' && e.role !== 'guide') || !KINDS.includes(e.kind) || !finite(e.after)) continue;
    const c = e.color;
    if (!c || ![c.r, c.g, c.b].every(finite)) continue;
    const records: Rec[] = [];
    if (Array.isArray(e.records) && e.records.length % 3 === 0 && e.records.every(finite)) {
      for (let i = 0; i < e.records.length; i += 3) records.push({ x: e.records[i], y: e.records[i + 1], cmd: e.records[i + 2] });
    }
    const form = e.form ? formFrom(e.form) : null;
    if (!records.length && !form) continue;
    out.push({
      id: e.id,
      role: e.role,
      kind: e.kind,
      color: { r: c.r, g: c.g, b: c.b, ...(c.name ? { name: String(c.name) } : {}), ...(finite(c.pecIndex) ? { pecIndex: c.pecIndex } : {}) },
      after: e.after,
      ...(records.length ? { records } : {}),
      ...(e.memory && typeof e.memory.key === 'string' ? { memory: e.memory } : {}),
      ...(form ? { form } : {}),
      ...(e.line && finite(e.line.width) ? { line: { width: e.line.width } } : {}),
      ...(e.reason === 'background' ? { reason: 'background' as const } : {}),
    });
  }
  return out;
}
