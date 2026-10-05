import type { Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { tidy, withRecords } from './edit';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { borderStitches } from './along';
import { lockAt, remember, remembered, type BorderSettings, type Rec, type Remembered } from './restitch';
import { stitchKinds } from './sequence';

/**
 * Borders of fills in a thread of their own. A border in the fill's thread is part of the fill
 * object (restitch.ts); in another thread it has to be an object of its own, in a color block of
 * that thread. The fill keeps the border's settings with a `link`; the border object remembers
 * the same link, the fill area it was sewn on and the settings. After a change, `syncBorders`
 * makes every such border fit its fill again: sewn when it is new, sewn anew in place when the
 * fill's area or the settings changed, moved when its thread changed, and taken out when the fill
 * has no border of its own thread any more.
 */

const sameColor = (a: ThreadColor, b: ThreadColor) => a.r === b.r && a.g === b.g && a.b === b.b;

/** Whether two areas are the same pixels. */
export function sameRegion(a: Region | null | undefined, b: Region | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.x0 !== b.x0 || a.y0 !== b.y0 || a.w !== b.w || a.h !== b.h || a.pxMm !== b.pxMm) return false;
  for (let i = 0; i < a.mask.length; i++) if (a.mask[i] !== b.mask[i]) return false;
  return true;
}

/** The stitch settings of a border, without its thread and link. */
const stitchOf = ({ color: _c, link: _l, ...rest }: BorderSettings): BorderSettings => rest;
const sameBorder = (a: BorderSettings, b: BorderSettings) => {
  const x = stitchOf(a) as unknown as Record<string, unknown>;
  const y = stitchOf(b) as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].every((k) => x[k] === y[k]);
};

/** A new link between a fill and its border object. */
export const newLink = () => Math.random().toString(36).slice(2, 10);

/** Records of a border: a jump to its start, its loops with locks, a trim at the end. */
function borderRecords(runs: Pt[][], trimMm: number): Rec[] {
  const out: Rec[] = [];
  const at = (q: Pt, cmd: number): Rec => ({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd });
  let last: Pt | null = null;
  runs.forEach((run, k) => {
    const d = last ? Math.hypot(run[0][0] - last[0], run[0][1] - last[1]) : Infinity;
    if (k && d > trimMm) out.push(...lockAt(runs[k - 1], true), { ...out[out.length - 1], cmd: TRIM });
    if (!k || d > 1) out.push(at(run[0], JUMP));
    if (!k || d > trimMm) out.push(...lockAt(run, false));
    for (const q of run) out.push(at(q, STITCH));
    last = run[run.length - 1];
  });
  if (runs.length) out.push(...lockAt(runs[runs.length - 1], true), { ...out[out.length - 1], cmd: TRIM });
  return out;
}

const recordsOf = (p: Pattern, a: number, b: number): Rec[] => {
  const out: Rec[] = [];
  for (let i = a; i <= b; i++) out.push({ x: p.x[i], y: p.y[i], cmd: p.cmd[i] });
  return out;
};

/** First record that belongs to object `o`: its first stitch and the jumps leading to it. */
function leadOf(p: Pattern, o: SewObject): number {
  let i = o.first;
  while (i - 1 >= 0 && p.cmd[i - 1] === JUMP) i--;
  return i;
}

interface Change {
  /** Records `a` to `b` are replaced by `recs` (a > b: inserted before `a`). */
  a: number;
  b: number;
  recs: Rec[];
  /** A color block with this thread starts with the records (inserted after block `block`). */
  color?: { block: number; c: ThreadColor };
  /** What to remember for the border object made by this change. */
  memory?: Remembered;
}

/**
 * The pattern with every fill's border of its own thread fitting its fill (or `p` itself when
 * nothing changes). `drop` lists links whose borders go: their fill has no border of its own
 * thread any more.
 */
export function syncBorders(p: Pattern, trimMm: number, drop: ReadonlySet<string> = new Set()): Pattern {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const mem = objs.map((o) => remembered(p, o));
  const byLink = new Map<string, number>();
  mem.forEach((m, k) => m?.outline && byLink.set(m.outline, k));
  const changes: Change[] = [];
  const wanted = new Set<string>();
  objs.forEach((o, k) => {
    const m = mem[k];
    const b = m?.fill?.border;
    if (!m?.region || !b?.color || !b.link) return;
    wanted.add(b.link);
    const at = byLink.get(b.link);
    const cur = at === undefined ? undefined : mem[at];
    const target = at === undefined ? null : objs[at];
    const same = target && cur?.border && sameColor(target.color, b.color);
    if (same && sameRegion(cur!.region, m.region) && sameBorder(cur!.border!, b)) return;
    const from: Pt = [p.x[o.last] / 10, p.y[o.last] / 10];
    const runs = borderStitches(m.region, b, from);
    if (!runs.length) return;
    const memory: Remembered = { region: m.region, outline: b.link, border: stitchOf(b) };
    const recs = borderRecords(runs, trimMm);
    if (same) {
      changes.push({ a: leadOf(p, target), b: target.last, recs, memory });
      return;
    }
    if (target) changes.push({ a: leadOf(p, target), b: target.last, recs: [] });
    // After the last record of the fill's color block (before the change that closes it); at the
    // start of the next block when that one has the border's thread already.
    let end = o.last;
    while (end + 1 < p.cmd.length && p.cmd[end + 1] !== COLOR_CHANGE && p.cmd[end + 1] !== END) end++;
    const next = p.cmd[end + 1] === COLOR_CHANGE ? p.colors[o.block + 1] : undefined;
    if (next && sameColor(next, b.color)) changes.push({ a: end + 2, b: end + 1, recs, memory });
    else changes.push({ a: end + 1, b: end, recs, color: { block: o.block, c: b.color }, memory });
  });
  // Borders whose fill has none of its own thread any more.
  for (const [link, at] of byLink) if (drop.has(link) && !wanted.has(link)) changes.push({ a: leadOf(p, objs[at]), b: objs[at].last, recs: [] });
  if (!changes.length) return p;
  changes.sort((x, y) => x.a - y.a || x.b - y.b);
  const out: Rec[] = [];
  const colors = p.colors.slice();
  let added = 0;
  const made: { start: number; end: number; memory: Remembered }[] = [];
  let i = 0;
  const sewn = () => out.reduce((n, r) => n + (r.cmd === STITCH ? 1 : 0), 0);
  for (const c of changes) {
    if (c.a < i) continue;
    out.push(...recordsOf(p, i, c.a - 1));
    if (c.color) {
      // A block of its own: trimmed, the thread changed before it; the fill's color goes on after it.
      const x = out[out.length - 1] ?? { x: 0, y: 0, cmd: STITCH };
      out.push({ ...x, cmd: TRIM }, { ...x, cmd: COLOR_CHANGE });
      colors.splice(c.color.block + 1 + added, 0, { ...c.color.c });
      added++;
    }
    const start = sewn();
    out.push(...c.recs);
    if (c.memory) made.push({ start, end: sewn(), memory: c.memory });
    i = c.b + 1;
  }
  out.push(...recordsOf(p, i, p.cmd.length - 1));
  const x = Int32Array.from(out, (r) => r.x);
  const y = Int32Array.from(out, (r) => r.y);
  const cmd = Uint8Array.from(out, (r) => r.cmd);
  const next = tidy(withRecords(p, x, y, cmd, colors));
  // Each border is one object, and remembers what it was sewn on.
  for (const m of made) rememberObjects(next, [m.start], m.end);
  const nobjs = sewObjects(next, stitchKinds(next));
  const number = new Int32Array(next.cmd.length);
  let n = 0;
  for (let r = 0; r < next.cmd.length; r++) {
    number[r] = n;
    if (next.cmd[r] === STITCH) n++;
  }
  for (const m of made) {
    const o = nobjs.find((ob) => number[ob.first] === m.start);
    if (o) remember(next, o, m.memory);
  }
  return next;
}
