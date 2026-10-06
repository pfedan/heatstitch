import type { Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { tidy, withRecords } from './edit';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { borderStitches } from './along';
import { wholeOf } from './knockout';
import { lockAt, remember, remembered, type BorderSettings, type FillSettings, type Rec, type Remembered } from './restitch';
import { expandRegion } from '../digitize/region';
import { fillRegion } from '../digitize/fill';
import { stitchKinds } from './sequence';
import { recolor } from './recolor';

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

/** What a border object remembers without its link to the fill (a line of its own then). */
const withoutLink = ({ outline: _o, border: _b, ...rest }: Remembered): Remembered => rest;

/** A new link between a fill and its border object. */
export const newLink = () => Math.random().toString(36).slice(2, 10);

/** Records of a border (or a drawn line): a jump to its start, its runs with locks, a trim at the end. */
export function runRecords(runs: Pt[][], trimMm: number): Rec[] {
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
 * The pattern with every fill's border fitting its fill, and every color blend's second thread
 * fitting its fill (see syncBlends), or `p` itself when nothing changes. `drop` lists links whose
 * borders or blends go: their fill has none any more.
 */
export function syncBorders(p: Pattern, trimMm: number, drop: ReadonlySet<string> = new Set()): Pattern {
  const a = syncBlends(syncOwnBorders(p, trimMm, drop), trimMm, drop);
  // A blend made just now lies after its fill's border: the border moves after it.
  return a === p || !sewObjects(a).some((o) => remembered(a, o)?.blendOf) ? a : syncOwnBorders(a, trimMm, drop);
}

/**
 * Every fill's border as an object of its own, linked to its fill (`border.link`, the object's
 * `outline`): in the border's thread, or the fill's when it has none. It is sewn after its fill
 * (in the fill's thread right after it, else after the fill's color block), and after the second
 * thread of a blend; where it is moved to by hand it stays, and is sewn anew there when the fill
 * changes.
 */
function syncOwnBorders(p: Pattern, trimMm: number, drop: ReadonlySet<string>): Pattern {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const mem = objs.map((o) => remembered(p, o));
  const byLink = new Map<string, number>();
  mem.forEach((m, k) => {
    if (!m?.outline) return;
    // A copy of a border is a line of its own: only the first object with a link is the border.
    if (!byLink.has(m.outline)) byLink.set(m.outline, k);
    else remember(p, objs[k], (mem[k] = withoutLink(m)));
  });
  // A copy of a fill gets a border of its own: the first fill keeps the link, later ones a new one.
  const claimed = new Set<string>();
  mem.forEach((m, k) => {
    const b = m?.fill?.border;
    // A border still sewn as the last part of its fill (from before borders were objects) stays so.
    if (!m?.fill || !b || (!b.color && m.borderAt)) return;
    if (b.link && !claimed.has(b.link)) return void claimed.add(b.link);
    // A border without link yet, or the copy of a fill: a link of its own.
    remember(p, objs[k], (mem[k] = { ...m, fill: { ...m.fill, border: { ...b, link: newLink() } } }));
    claimed.add(mem[k]!.fill!.border!.link!);
  });
  const seconds = new Map<string, number>();
  mem.forEach((m, k) => m?.blendOf && !seconds.has(m.blendOf) && seconds.set(m.blendOf, k));
  const changes: Change[] = [];
  const wanted = new Set<string>();
  objs.forEach((o, k) => {
    const m = mem[k];
    const b = m?.fill?.border;
    // A blend's second thread is sewn as its fill says, without border.
    if (!m?.region || !b?.link || (!b.color && m.borderAt) || m.blendOf) return;
    wanted.add(b.link);
    const color = b.color ?? o.color;
    // Sewn after this object: the fill, or the second thread of its blend.
    const second = m.fill?.deco?.blend ? seconds.get(m.fill.deco.blend.link) : undefined;
    const after = second === undefined ? o : objs[second];
    const at = byLink.get(b.link);
    const cur = at === undefined ? undefined : mem[at];
    const target = at === undefined ? null : objs[at];
    const same = target && cur?.border && sameColor(target.color, color) && (second === undefined || at! > second);
    if (same && sameRegion(cur!.region, m.region) && sameBorder(cur!.border!, b)) return;
    const from: Pt = [p.x[after.last] / 10, p.y[after.last] / 10];
    const runs = borderStitches(m.region, b, from, wholeOf(m.region, m));
    if (!runs.length) return;
    const memory: Remembered = { region: m.region, outline: b.link, border: stitchOf(b) };
    const recs = runRecords(runs, trimMm);
    if (same) {
      changes.push({ a: leadOf(p, target), b: target.last, recs, memory });
      return;
    }
    if (target) changes.push({ a: leadOf(p, target), b: target.last, recs: [] });
    // In the thread it comes after: right after it, trimmed off it so it is an object of its own.
    if (sameColor(after.color, color)) {
      const x = { x: p.x[after.last], y: p.y[after.last], cmd: TRIM };
      changes.push({ a: after.last + 1, b: after.last, recs: [x, ...recs], memory });
      return;
    }
    // After the last record of its color block (before the change that closes it); at the start
    // of the next block when that one has the border's thread already.
    let end = after.last;
    while (end + 1 < p.cmd.length && p.cmd[end + 1] !== COLOR_CHANGE && p.cmd[end + 1] !== END) end++;
    const next = p.cmd[end + 1] === COLOR_CHANGE ? p.colors[after.block + 1] : undefined;
    if (next && sameColor(next, color)) changes.push({ a: end + 2, b: end + 1, recs, memory });
    else changes.push({ a: end + 1, b: end, recs, color: { block: after.block, c: color }, memory });
  });
  // Borders whose fill has none of its own thread any more.
  for (const [link, at] of byLink) if (drop.has(link) && !wanted.has(link)) changes.push({ a: leadOf(p, objs[at]), b: objs[at].last, recs: [] });
  return syncBlends(applyChanges(p, changes), trimMm, drop);
}

/** The records changed as listed (each new object remembering its `memory`), or `p` when nothing changes. */
function applyChanges(p: Pattern, changes: Change[]): Pattern {
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

/**
 * Records of the border of fill `o`: its last part when it is sewn in the fill's thread, the
 * object of its own when it has a thread of its own.
 */
export function borderRanges(p: Pattern, objs: readonly SewObject[], o: SewObject): [number, number][] {
  const m = remembered(p, o);
  const b = m?.fill?.border;
  if (!b) return [];
  const out: [number, number][] = [];
  if (!b.color && m.borderAt) {
    let n = 0;
    for (let i = o.first; i <= o.last; i++) {
      if (p.cmd[i] !== STITCH) continue;
      if (n++ === m.borderAt) {
        out.push([i, o.last]);
        break;
      }
    }
  }
  if (b.link) for (const x of objs) if (remembered(p, x)?.outline === b.link) out.push([leadOf(p, x), x.last]);
  return out;
}

/**
 * The second thread of a color blend, sewn like the fill it belongs to: the same area, rows,
 * spacing and stitch, fading the other way, without underlay (the fill's holds both) and without
 * border.
 */
export function blendSettings(f: FillSettings): FillSettings {
  const { blend: _b, emboss: _e, focus: _f, centers: _c, ...deco } = f.deco ?? {};
  return { ...f, pattern: 'gradient', underlay: false, border: undefined, deco: { ...deco, fade: f.deco?.fade === 'in' ? 'out' : 'in' } };
}

/** Whether a fill is one of a color blend: it fades, and has a second thread to blend with. */
export const blends = (m: Remembered | undefined): boolean => !!m?.region && m.fill?.pattern === 'gradient' && !!m.fill.deco?.fade && !!m.fill.deco.blend;

/**
 * Color blends: a fill fading out (FillSettings.deco.blend) and an object in a second thread fading
 * in on the same area, so together they stay as dense as one fill. The second object follows its
 * fill as a border of its own thread does: sewn when it is new, sewn anew when the fill's area or
 * settings changed, moved when its thread changed. A fill that blends no more (another pattern)
 * takes it out when its link is in `drop`; otherwise, and when the fill is gone, it stays as a
 * fill of its own. A copy of a blending fill gets a second thread of its own.
 */
export function syncBlends(p: Pattern, trimMm: number, drop: ReadonlySet<string> = new Set()): Pattern {
  if (!p.cmd.length) return p;
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const mem = objs.map((o) => remembered(p, o));
  const byLink = new Map<string, number>();
  mem.forEach((m, k) => {
    if (!m?.blendOf) return;
    // A copy of the second thread is a fill of its own.
    if (!byLink.has(m.blendOf)) byLink.set(m.blendOf, k);
    else remember(p, objs[k], (mem[k] = { ...m, blendOf: undefined }));
  });
  const claimed = new Set<string>();
  mem.forEach((m, k) => {
    const b = m?.fill?.deco?.blend;
    if (!m?.fill || !b) return;
    if (!claimed.has(b.link)) return void claimed.add(b.link);
    remember(p, objs[k], (mem[k] = { ...m, fill: { ...m.fill, deco: { ...m.fill.deco, blend: { ...b, link: newLink() } } } }));
  });
  const changes: Change[] = [];
  const wanted = new Set<string>();
  objs.forEach((o, k) => {
    const m = mem[k];
    if (!blends(m)) return;
    const b = m!.fill!.deco!.blend!;
    wanted.add(b.link);
    const want = blendSettings(m!.fill!);
    const at = byLink.get(b.link);
    const cur = at === undefined ? undefined : mem[at];
    const target = at === undefined ? null : objs[at];
    const same = target && sameColor(target.color, b.color);
    if (same && sameRegion(cur!.region, m!.region) && JSON.stringify(cur!.fill) === JSON.stringify(want)) return;
    const runs = blendRuns(m!.region!, want, [p.x[o.last] / 10, p.y[o.last] / 10]);
    if (!runs) return;
    const memory: Remembered = { region: m!.region, fill: want, blendOf: b.link };
    const recs = runRecords(runs, trimMm);
    if (same) {
      changes.push({ a: leadOf(p, target), b: target.last, recs, memory });
      return;
    }
    if (target) changes.push({ a: leadOf(p, target), b: target.last, recs: [] });
    // After the last record of the fill's color block, as a border of its own thread.
    let end = o.last;
    while (end + 1 < p.cmd.length && p.cmd[end + 1] !== COLOR_CHANGE && p.cmd[end + 1] !== END) end++;
    const next = p.cmd[end + 1] === COLOR_CHANGE ? p.colors[o.block + 1] : undefined;
    if (next && sameColor(next, b.color)) changes.push({ a: end + 2, b: end + 1, recs, memory });
    else changes.push({ a: end + 1, b: end, recs, color: { block: o.block, c: b.color }, memory });
  });
  for (const [link, at] of byLink) {
    if (wanted.has(link)) continue;
    // Its fill blends no more: taken out when asked, else a fill of its own.
    if (drop.has(link)) changes.push({ a: leadOf(p, objs[at]), b: objs[at].last, recs: [] });
    else remember(p, objs[at], { ...mem[at]!, blendOf: undefined });
  }
  return applyChanges(p, changes);
}

/** Stitches of a blend's second thread on `region` (before it is grown or shrunk). */
function blendRuns(region: Region, s: FillSettings, start: Pt): Pt[][] | null {
  const r = expandRegion(region, s.expand ?? 0);
  if (!r) return null;
  const res = fillRegion(r, { spacing: s.spacing, stitch: s.stitch, angle: Number.isFinite(s.angle) ? s.angle : null, pull: s.edge, underlay: false, fade: s.deco?.fade ?? 'in', tolerance: s.tolerance }, start);
  return res?.runs.length ? res.runs.filter((run) => run.length > 1) : null;
}

/**
 * Another thread for color block `block`, as recolor does; a border or a blend's second thread in
 * it takes the thread through its fill, so the next sync keeps it there and does not move it back.
 */
export function recolorBlock(p: Pattern, block: number, color: ThreadColor): Pattern {
  const next = recolor(p, block, color);
  const objs = sewObjects(next);
  const mem = objs.map((o) => remembered(next, o));
  for (const o of objs) {
    const own = mem[o.index];
    if (o.block !== block || !(own?.outline || own?.blendOf)) continue;
    objs.forEach((x, k) => {
      const f = mem[k]?.fill;
      if (!f) return;
      // A border in the fill's thread (none of its own) gets the new one as its own, unless the fill has it too.
      if (own.outline && f.border?.link === own.outline) remember(next, x, (mem[k] = { ...mem[k]!, fill: { ...f, border: { ...f.border, color: sameColor(x.color, color) ? undefined : { ...color } } } }));
      if (own.blendOf && f.deco?.blend?.link === own.blendOf) remember(next, x, (mem[k] = { ...mem[k]!, fill: { ...f, deco: { ...f.deco, blend: { ...f.deco.blend, color: { ...color } } } } }));
    });
  }
  return next;
}
