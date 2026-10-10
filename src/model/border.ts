import type { Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { tidy, withRecords } from './edit';
import { rememberObjects, sewObjects, stitchKey, type SewObject } from './objects';
import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { borderStitches, openStitches, seamStitches, sewAlong, type PathStitch } from './along';
import { wholeOf } from './knockout';
import { borderOf, lockAt, objectKey, remember, remembered, trimBefore, withLine, type BorderSettings, type FillSettings, type Rec, type Remembered } from './restitch';
import { expandRegion } from '../digitize/region';
import { fillRegion } from '../digitize/fill';
import { stitchKinds } from './sequence';
import { hasPart, lineParts, linePartsOf, partInThread, partOf, type LinePart } from './shadow';
import { storeForm, type Form, type Path } from '../shape/path';
import { offsetForm, opsReady } from '../shape/ops';
import { borderLoops } from '../digitize/border';
import { simplify } from '../digitize/run';
import { echoCopyLines, lineStitches } from './line';
import { ownCopies } from '../digitize/echo';
import { unionOf } from '../shape/rasterize';
import { readBorder } from './readBorder';
import { recolor } from './recolor';
import { areaOf as formArea, formKey, lineGeoOf, openOf } from './geo';

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
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].every((k) => JSON.stringify(x[k]) === JSON.stringify(y[k]));
};

/**
 * The line a fill's border runs on, as a form: the edge of `region` (the fill's area, all its parts
 * when it is cut apart) or `st.offset` from it, and the open paths of the fill's form. Its echo and
 * shadow lie along it. With a form given, the edge is the form's own closed paths, offset on its
 * curves by the pull compensation and `st.offset` (src/shape/ops.ts, once loaded); else the edge
 * of the pixels.
 */
export function borderForm(m: Remembered, region: Region, st: BorderSettings): Form {
  const by = (st.offset ?? 0) + (m.fill?.areaGrow ?? 0);
  const area = formArea(m);
  const closed = area && sameRegion(region, m.region) ? { ...area, paths: area.paths.filter((x) => x.closed) } : null;
  const curves = closed && (!by ? closed : opsReady() ? offsetForm(closed, by) : null);
  const edge: Path[] =
    curves?.paths ??
    borderLoops(region, st.offset ?? 0).map((l) => {
      const pts = simplify(l, EDGE_TOLERANCE);
      return { closed: true, nodes: (samePt(pts[0], pts[pts.length - 1]) ? pts.slice(0, -1) : pts).map((q) => ({ p: q, a: q, b: q, smooth: false })) };
    });
  return { paths: [...edge, ...(openOf(m)?.paths ?? [])] };
}

/** How near the edge of an area its border's echo and shadow keep (mm). */
const EDGE_TOLERANCE = 0.05;

const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** A border's stitch as a line's (its echo copies and shadow are lines): without its thread, link, offset and the side of its fringe. */
export function asLine({ color: _c, link: _l, seams: _s, offset: _o, fringeSide: _f, ...st }: BorderSettings): PathStitch {
  return st;
}

/** The copies of a border's echo in the fill's thread, sewn after the border (before it, reversed), from `from` on. */
function echoRuns(form: Form, b: BorderSettings, from: Pt): Pt[][] {
  const e = b.echo;
  if (!e) return [];
  const st = asLine(b);
  const plain: PathStitch = { ...st, echo: undefined, shadow: undefined };
  const lines = echoCopyLines(form, { ...st, echo: { ...e, only: ownCopies(e), reverse: false } });
  const out: Pt[][] = [];
  let at = from;
  for (const l of e.reverse ? lines.slice().sort((x, y) => Math.abs(y.k) - Math.abs(x.k)) : lines.slice().sort((x, y) => Math.abs(x.k) - Math.abs(y.k))) {
    const runs = sewAlong(l.line, l.closed, plain, at, undefined, l.back);
    // Cut: a trim before each copy, however near.
    if (e.cut && runs[0]) trimBefore.add(runs[0]);
    out.push(...runs);
    const last = runs[runs.length - 1];
    if (last) at = last[last.length - 1];
  }
  return out;
}

/** What a border object remembers without its link to the fill (a line of its own then). */
const withoutLink = ({ outline: _o, border: _b, along: _a, ...rest }: Remembered): Remembered => rest;

/** A new link between a fill and its border object. */
export const newLink = () => Math.random().toString(36).slice(2, 10);

/** Whether `m` is a fill that can have a border object of its own (see syncOwnBorders). */
const bordered = (m: Remembered | undefined): boolean => !!m?.region && !!m.fill && !m.blendOf && !(m.line && !m.line.color && m.borderAt);

/**
 * The parts of fills cut apart (Remembered.piece) as wholes: for each object the objects of its
 * whole in sewing order, itself alone when it is no part (or the only one left).
 */
function wholes(mem: readonly (Remembered | undefined)[]): number[][] {
  const by = new Map<string, number[]>();
  const out: number[][] = mem.map((_, k) => [k]);
  mem.forEach((m, k) => {
    if (!m?.piece || !bordered(m)) return;
    const list = by.get(m.piece) ?? [];
    list.push(k);
    by.set(m.piece, list);
  });
  for (const list of by.values()) for (const k of list) out[k] = list;
  return out;
}

/** The area of a whole (one region, or the regions of its parts as one), kept while the parts keep theirs. */
const unions = new WeakMap<Region, { rs: Region[]; u: Region | null }>();
function areaOf(rs: Region[]): Region | null {
  if (rs.length === 1) return rs[0];
  const kept = unions.get(rs[0]);
  if (kept && kept.rs.length === rs.length && kept.rs.every((r, k) => r === rs[k])) return kept.u;
  const u = unionOf(rs.filter((r) => r.pxMm === rs[0].pxMm));
  unions.set(rs[0], { rs, u });
  return u;
}

/**
 * The parts of a fill cut apart share the border of the part `edited` was given (with the panel):
 * each part of its whole takes over its border settings (and link), so the one border around them
 * all changes for every part. Call it before syncBorders.
 */
export function shareBorders(p: Pattern, edited: readonly SewObject[]): void {
  if (!edited.length) return;
  const objs = sewObjects(p);
  for (const e of edited) {
    const m = remembered(p, e);
    if (!m?.piece || !m.fill || !bordered(m)) continue;
    for (const o of objs) {
      if (o.first === e.first) continue;
      const n = remembered(p, o);
      if (n?.piece !== m.piece || !bordered(n) || !n.fill || JSON.stringify(n.line) === JSON.stringify(m.line)) continue;
      remember(p, o, withLine(n, m.line && { ...m.line }));
    }
  }
}

/** Records of a border (or a drawn line): a jump to its start, its runs with locks, a trim at the end. */
export function runRecords(runs: Pt[][], trimMm: number): Rec[] {
  const out: Rec[] = [];
  const at = (q: Pt, cmd: number): Rec => ({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd });
  let last: Pt | null = null;
  runs.forEach((run, k) => {
    const d = last ? Math.hypot(run[0][0] - last[0], run[0][1] - last[1]) : Infinity;
    const cut = d > trimMm || trimBefore.has(run);
    if (k && cut) out.push(...lockAt(runs[k - 1], true), { ...out[out.length - 1], cmd: TRIM });
    if (!k || d > 1 || cut) out.push(at(run[0], JUMP));
    if (!k || cut) out.push(...lockAt(run, false));
    for (const q of run) out.push(at(q, STITCH));
    last = run[run.length - 1];
  });
  if (runs.length) out.push(...lockAt(runs[runs.length - 1], true), { ...out[out.length - 1], cmd: TRIM });
  return out;
}

/** The key the stitches of `recs` have as an object (objectKey). */
function keyOf(recs: Rec[]): string {
  const x = Int32Array.from(recs, (r) => r.x);
  const y = Int32Array.from(recs, (r) => r.y);
  const cmd = Uint8Array.from(recs, (r) => r.cmd);
  return stitchKey({ x, y, cmd } as Pattern, 0, recs.length - 1);
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
  /** The records are a color block of this thread of their own, inserted before block `block` (at its start). */
  before?: { block: number; c: ThreadColor };
  /** What to remember for the border object made by this change. */
  memory?: Remembered;
}

/**
 * The pattern with every fill's border fitting its fill, and every color blend's second thread
 * fitting its fill (see syncBlends), or `p` itself when nothing changes. `drop` lists links whose
 * borders or blends go: their fill has none any more.
 */
export function syncBorders(p: Pattern, trimMm: number, drop: ReadonlySet<string> = new Set()): Pattern {
  const before = partners(p);
  const a = syncBlends(syncOwnBorders(p, trimMm, drop), trimMm, drop);
  // A blend made just now lies after its fill's border: the border moves after it (later it stays
  // where it is put).
  const fresh = new Set([...partners(a)].filter((l) => !before.has(l)));
  return syncShadows(fresh.size ? syncOwnBorders(a, trimMm, drop, fresh) : a, trimMm);
}

/**
 * Which objects have line parts (see syncShadows), and those parts: a line's, and a fill's border's
 * along the edge it runs on. A fill cut apart has one border: its parts go with its first part.
 */
export function partHolders(mem: readonly (Remembered | undefined)[]): { holds: (k: number) => boolean; partsOf: (k: number) => LinePart[] } {
  const isLine = (m: Remembered | undefined) => !!lineGeoOf(m) && !!m!.line && !partOf(m);
  const whole = wholes(mem);
  const isBordered = (k: number) => {
    const m = mem[k];
    return !!m?.fill && !!m.region && !!m.line?.link && !m.blendOf && !partOf(m) && whole[k][0] === k && !(!m.line.color && m.borderAt);
  };
  const holds = (k: number) => isLine(mem[k]) || isBordered(k);
  const partsOf = (k: number): LinePart[] => {
    const m = mem[k]!;
    if (!isBordered(k)) return lineParts(m);
    const list = whole[k];
    const region = list.length > 1 ? areaOf(list.map((j) => mem[j]!.region!)) : m.region!;
    return region ? linePartsOf(asLine(m.line!), borderForm(list.length > 1 ? { ...m, geo: undefined } : m, region, m.line!)) : [];
  };
  return { holds, partsOf };
}

/**
 * The parts of lines in threads of their own, each an object linked to its line: its shadow
 * (line.shadow, the object's `shadowOf`), sewn before the line, and the copies of its echo in
 * threads of their own (line.echo.colors, one object per thread, `echoOf`), sewn after it. A shadow
 * goes to the end of the last block before the line's that has its thread, else into a block of
 * its own just before the line's; echo copies right after the line's block (into the next block
 * when that has their thread). They are sewn anew in place when the line, its stitch or the part
 * changed; moved when their thread changed; taken out when the line has the part no more or is
 * gone. Moved by hand, they stay where they are put. A copy of a line gets parts of its own; a copy
 * of a part is a line of its own.
 */
export function syncShadows(p: Pattern, trimMm: number): Pattern {
  if (!p.cmd.length) return p;
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const mem = objs.map((o) => remembered(p, o));
  const { holds, partsOf } = partHolders(mem);
  if (!mem.some((m, k) => partOf(m) || (holds(k) && (m!.line!.shadow || m!.line!.echo?.link)))) return p;
  // Where each border is sewn, by its link: its echo copies follow it.
  const borderAt = new Map<string, number>();
  mem.forEach((m, k) => m?.outline && !borderAt.has(m.outline) && borderAt.set(m.outline, k));
  const byLink = new Map<string, number>();
  mem.forEach((m, k) => {
    const l = partOf(m);
    if (!l) return;
    if (!byLink.has(l)) byLink.set(l, k);
    else remember(p, objs[k], (mem[k] = { ...m!, shadowOf: undefined, echoOf: undefined }));
  });
  // A copy of a line gets links of its own.
  const claimed = new Set<string>();
  mem.forEach((m, k) => {
    if (!holds(k)) return;
    const links = [m!.line!.shadow?.link, m!.line!.echo?.link].filter((l): l is string => !!l);
    if (!links.length) return;
    if (!links.some((l) => claimed.has(l))) return void links.forEach((l) => claimed.add(l));
    const st = m!.line!;
    const line = { ...st, ...(st.shadow ? { shadow: { ...st.shadow, link: newLink() } } : {}), ...(st.echo?.link ? { echo: { ...st.echo, link: newLink() } } : {}) };
    // The parts of a fill cut apart have one border: all of them take the new links.
    for (const j of mem[k]?.fill ? wholes(mem)[k] : [k]) remember(p, objs[j], (mem[j] = { ...mem[j]!, line }));
    [line.shadow?.link, line.echo?.link].forEach((l) => l && claimed.add(l));
  });
  let keys: Set<string> | null = null;
  const taken = () => (keys ??= new Set(objs.map((o) => objectKey(p, o))));
  const changes: Change[] = [];
  const wanted = new Set<string>();
  objs.forEach((line, k) => {
    const m = mem[k];
    if (!holds(k)) return;
    // Copies of a border's echo come after the border, its shadow before the fill.
    const sewnAt = m!.fill ? borderAt.get(m!.line!.link!) : undefined;
    for (const part of partsOf(k)) {
      const o = part.after && sewnAt !== undefined ? objs[sewnAt] : line;
      wanted.add(part.link);
      const at = byLink.get(part.link);
      const cur = at === undefined ? undefined : mem[at];
      const target = at === undefined ? null : objs[at];
      const same = target && sameColor(target.color, part.color);
      const curGeo = lineGeoOf(cur);
      const partGeo = lineGeoOf(part.memory)!;
      if (same && curGeo && JSON.stringify(storeForm(curGeo)) === JSON.stringify(storeForm(partGeo)) && JSON.stringify(cur!.line) === JSON.stringify(part.memory.line)) continue;
      const runs = lineStitches(partGeo, part.memory.line!);
      if (!runs.length) continue;
      let recs = runRecords(runs, trimMm);
      // The very stitches of another object (a shadow landing on a line, say): sewn the other way
      // round, so each remembers its own (memory is keyed by stitches).
      if (taken().has(keyOf(recs)) && (!target || keyOf(recs) !== objectKey(p, target))) recs = runRecords(runs.slice().reverse().map((run) => run.slice().reverse()), trimMm);
      taken().add(keyOf(recs));
      const memory = part.memory;
      if (same) {
        changes.push({ a: leadOf(p, target), b: target.last, recs, memory });
        continue;
      }
      if (target) changes.push({ a: leadOf(p, target), b: target.last, recs: [] });
      // Where each color block ends (its color change).
      const ends: number[] = [];
      for (let i = 0; i < p.cmd.length && ends.length <= o.block; i++) if (p.cmd[i] === COLOR_CHANGE) ends.push(i);
      if (part.after) {
        // After the line's block, or after the block of its last copies sewn after it, so nearer
        // copies come first: at the start of the next block when that has the thread.
        let after = o.block;
        mem.forEach((x, j) => {
          const l = x?.echoOf;
          if (l && l !== part.link && hasPart(m, l) && objs[j].block > after) after = objs[j].block;
        });
        for (let i = ends.length ? ends[ends.length - 1] + 1 : 0; i < p.cmd.length && ends.length <= after; i++) if (p.cmd[i] === COLOR_CHANGE) ends.push(i);
        const end = ends[after] ?? p.cmd.length - 1;
        const next = p.cmd[end] === COLOR_CHANGE ? p.colors[after + 1] : undefined;
        if (next && sameColor(next, part.color)) changes.push({ a: end + 1, b: end, recs, memory });
        else changes.push({ a: end, b: end - 1, recs, color: { block: after, c: part.color }, memory });
        continue;
      }
      // Before: at the end of the last block before the line's with its thread, so shadows share
      // a thread change; else a block of its own right before.
      let into = o.block - 1;
      while (into >= 0 && !sameColor(p.colors[into], part.color)) into--;
      if (into >= 0) changes.push({ a: ends[into], b: ends[into] - 1, recs, memory });
      else {
        const start = o.block > 0 ? ends[o.block - 1] + 1 : 0;
        changes.push({ a: start, b: start - 1, recs, before: { block: o.block, c: part.color }, memory });
      }
    }
  });
  // Parts whose line has them no more, or is gone.
  for (const [link, at] of byLink) if (!wanted.has(link)) changes.push({ a: leadOf(p, objs[at]), b: objs[at].last, recs: [] });
  return applyChanges(p, changes);
}

/** The links of the blends whose second thread is sewn. */
const partners = (p: Pattern) => new Set(sewObjects(p).flatMap((o) => remembered(p, o)?.blendOf ?? []));

/**
 * Every fill's border as an object of its own, linked to its fill (`border.link`, the object's
 * `outline`): in the border's thread, or the fill's when it has none. It is sewn after its fill
 * (in the fill's thread right after it, else after the fill's color block), and after the second
 * thread of a blend made just now (`fresh`). Where it is moved to by hand it stays, and is sewn
 * anew there when the fill changes.
 */
function syncOwnBorders(p: Pattern, trimMm: number, drop: ReadonlySet<string>, fresh: ReadonlySet<string> = new Set()): Pattern {
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
  // The parts of a fill cut apart share one border: all take the settings of the first one (the
  // panel gives them to all, see shareBorders; this is for anything else).
  const whole = wholes(mem);
  whole.forEach((list, k) => {
    if (list.length < 2 || list[0] !== k) return;
    const b = mem[k]!.line;
    for (const j of list.slice(1)) {
      const m = mem[j]!;
      if (JSON.stringify(m.line) === JSON.stringify(b)) continue;
      remember(p, objs[j], (mem[j] = withLine(m, b && { ...b })));
    }
  });
  // A copy of a fill gets a border of its own: the first fill (or whole) keeps the link, later ones
  // a new one (the parts of a whole one together).
  const claimed = new Map<string, number>();
  whole.forEach((list, k) => {
    const m = mem[k];
    const b = borderOf(m);
    // A border still sewn as the last part of its fill (from before borders were objects) stays so.
    if (!m?.fill || !b || (!b.color && m.borderAt)) return;
    if (b.link && (claimed.get(b.link) ?? list[0]) === list[0]) return void claimed.set(b.link, list[0]);
    // A border without link yet, or the copy of a fill: a link of its own.
    if (list[0] !== k) {
      // A later part of a whole takes the link its first part was given.
      const first = mem[list[0]]!.line!;
      remember(p, objs[k], (mem[k] = withLine(m, { ...b, link: first.link })));
      return;
    }
    remember(p, objs[k], (mem[k] = withLine(m, { ...b, link: newLink() })));
    claimed.set(mem[k]!.line!.link!, k);
  });
  const seconds = new Map<string, number>();
  mem.forEach((m, k) => m?.blendOf && !seconds.has(m.blendOf) && seconds.set(m.blendOf, k));
  let keys: Set<string> | null = null;
  const taken = () => (keys ??= new Set(objs.map((o) => objectKey(p, o))));
  const changes: Change[] = [];
  const wanted = new Set<string>();
  objs.forEach((o, k) => {
    const m = mem[k];
    const b = borderOf(m);
    // A blend's second thread is sewn as its fill says, without border.
    if (!m?.region || !b?.link || (!b.color && m.borderAt) || m.blendOf) return;
    wanted.add(b.link);
    // The parts of a fill cut apart: one border around them all, sewn after the last one.
    const list = whole[k];
    if (list[list.length - 1] !== k) return;
    const region = areaOf(list.map((j) => mem[j]!.region!));
    if (!region) return;
    const cuts = list.map((j) => wholeOf(mem[j]!.region!, mem[j]));
    const cutFrom = cuts.some(Boolean) ? areaOf(list.map((j, i) => cuts[i] ?? mem[j]!.region!)) : null;
    // In the thread of the first part, when it has none of its own (the parts can be recolored apart).
    const color = b.color ?? objs[list[0]].color;
    // Sewn after this object: the fill, or the second thread of its blend.
    const second = m.fill?.deco?.blend ? seconds.get(m.fill.deco.blend.link) : undefined;
    const after = second === undefined ? o : objs[second];
    let at = byLink.get(b.link);
    // A fill from a file that just got its border: the line sewn along its edge in the file is it.
    if (at === undefined && list.length === 1) {
      const found = readBorder(p, objs, o, kinds, region);
      if (found && !mem[found.at]?.outline && sameColor(objs[found.at].color, color)) {
        const id = mem[found.at]?.id ?? objs[found.at].id;
        // Its stitches stay the file's (read) until the fill or the border settings change.
        remember(p, objs[found.at], (mem[found.at] = { region, outline: b.link, border: stitchOf(found.border), read: true, ...(id ? { id } : {}) }));
        byLink.set(b.link, (at = found.at));
      }
    }
    const cur = at === undefined ? undefined : mem[at];
    const target = at === undefined ? null : objs[at];
    const same = target && cur?.border && sameColor(target.color, color) && (second === undefined || !fresh.has(m.fill!.deco!.blend!.link) || at! > second);
    // Its fill's open paths: the border runs along them too (a vein in a leaf).
    const open = list.length === 1 ? openOf(m) : null;
    const along = open ? formKey(open) : undefined;
    if (same && sameRegion(cur!.region, region) && sameBorder(cur!.border!, b) && cur!.along === along) return;
    const from: Pt = [p.x[after.last] / 10, p.y[after.last] / 10];
    const uncut = list.length > 1 ? cutFrom : wholeOf(m.region, m);
    let runs = borderStitches(region, b, from, uncut);
    // One line along each cut too, sewn first (the border on top covers where they end).
    if (list.length > 1 && b.seams) {
      const seams = seamStitches(list.map((j) => mem[j]!.region!), region, b, from);
      const end = seams[seams.length - 1];
      if (end) runs = [...seams, ...borderStitches(region, b, end[end.length - 1], cutFrom)];
    }
    if (open) {
      const end = runs[runs.length - 1];
      runs = [...runs, ...openStitches(open, b, end ? end[end.length - 1] : from, region, uncut)];
    }
    // The copies of its echo in its thread: after it, or before it when the echo is sewn the other way round.
    if (b.echo && ownCopies(b.echo).length) {
      const form = borderForm(list.length > 1 ? { ...m, geo: undefined } : m, region, b);
      if (b.echo.reverse) runs = [...echoRuns(form, b, from), ...runs];
      else {
        const end = runs[runs.length - 1];
        runs = [...runs, ...echoRuns(form, b, end ? end[end.length - 1] : from)];
      }
    }
    // Nothing of its edge shows (all of it under shapes on top): no border to sew, and none left in
    // its old stitches or thread; it comes back with its edge.
    if (!runs.length) {
      if (target) changes.push({ a: leadOf(p, target), b: target.last, recs: [] });
      return;
    }
    // Sewn anew, it stays the same object (its id), wherever it goes.
    const memory: Remembered = { region, outline: b.link, border: stitchOf(b), ...(along ? { along } : {}), ...(cur?.id ? { id: cur.id } : {}) };
    let recs = runRecords(runs, trimMm);
    // The very stitches of another border (a fill copied in place): sewn the other way round, so
    // each remembers its own (memory is keyed by stitches).
    if (taken().has(keyOf(recs)) && (!target || keyOf(recs) !== objectKey(p, target))) {
      runs = runs.slice().reverse().map((run) => run.slice().reverse());
      recs = runRecords(runs, trimMm);
    }
    taken().add(keyOf(recs));
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

/** The links of what follows a fill in a thread of its own: its border and the second thread of its blend. */
export function followerLinks(m: Remembered | null | undefined): string[] {
  return [borderOf(m)?.link, m?.fill?.deco?.blend?.link].filter((l): l is string => !!l);
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
    if (c.before) {
      // Its own block, then the thread changes back to the block that follows.
      const x = out[out.length - 1] ?? { x: 0, y: 0, cmd: STITCH };
      if (x.cmd !== TRIM) out.push({ ...x, cmd: TRIM });
      out.push({ ...x, cmd: COLOR_CHANGE });
      colors.splice(c.before.block + added, 0, { ...c.before.c });
      added++;
    }
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
  const b = borderOf(m);
  if (!m || !b) return [];
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
  return { ...f, pattern: 'gradient', underlay: false, deco: { ...deco, fade: f.deco?.fade === 'in' ? 'out' : 'in' } };
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
  let keys: Set<string> | null = null;
  const taken = () => (keys ??= new Set(objs.map((o) => objectKey(p, o))));
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
    let recs = runRecords(runs, trimMm);
    // The very stitches of another object (a fill copied in place): sewn the other way round.
    if (taken().has(keyOf(recs)) && (!target || keyOf(recs) !== objectKey(p, target))) recs = runRecords(runs.slice().reverse().map((run) => run.slice().reverse()), trimMm);
    taken().add(keyOf(recs));
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
  // A fill in it whose border (in the fill's thread) is sewn in another block: the border keeps
  // its thread, only this block changes.
  const old = p.colors[block];
  objs.forEach((o) => {
    const m = o.block === block ? remembered(next, o) : undefined;
    const b = borderOf(m);
    if (!b?.link || b.color || !old) return;
    const border = objs.find((x) => remembered(next, x)?.outline === b.link);
    if (!border || border.block === block) return;
    // The thread it is sewn in (for parts of a fill cut apart, that of the first part); all parts take it.
    remember(next, o, withLine(m!, { ...b, color: { ...border.color } }));
    shareBorders(next, [o]);
  });
  return takeThreads(next, objs.filter((o) => o.block === block).map((o) => o.index));
}

/**
 * Objects `which` of `p` sewn in the thread they have now: a border or a blend's second thread
 * among them tells its fill (moved into another color, or recolored), so the next sync keeps it
 * in that thread where it is, and does not sew it anew in the old one. Returns `p`.
 */
export function takeThreads(p: Pattern, which: readonly number[]): Pattern {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  for (const i of which) {
    const own = mem[i];
    const color = objs[i]?.color;
    const part = partOf(own);
    if (!color || !own || !(own.outline || own.blendOf || part)) continue;
    objs.forEach((x, k) => {
      if (part && hasPart(mem[k], part)) remember(p, x, (mem[k] = partInThread(mem[k]!, part, color)));
      const f = mem[k]?.fill;
      if (!f) return;
      // A border in the fill's thread has none of its own (for parts of a fill cut apart: the
      // thread of the first part, which all parts go by).
      const b = mem[k]!.line;
      if (own.outline && b?.link === own.outline) {
        const first = objs[mem.findIndex((n) => borderOf(n)?.link === own.outline)] ?? x;
        remember(p, x, (mem[k] = withLine(mem[k]!, { ...b, color: sameColor(first.color, color) ? undefined : { ...color } })));
      }
      if (own.blendOf && f.deco?.blend?.link === own.blendOf) remember(p, x, (mem[k] = { ...mem[k]!, fill: { ...f, deco: { ...f.deco, blend: { ...f.deco.blend, color: { ...color } } } } }));
    });
  }
  return p;
}
