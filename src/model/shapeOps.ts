import { knockOut, unionOf } from '../shape/rasterize';
import { translation, type Form, type Mat } from '../shape/path';
import { vectorize } from '../shape/vectorize';
import { takeOver, wholeArea } from './knockout';
import { rememberObjects, sewObjects, stitchKey, type SewObject } from './objects';
import { insertObject } from './addShape';
import { syncBorders } from './border';
import { recs } from './jumps';
import { reorder } from './order';
import { recolor, sameColor } from './recolor';
import { STITCH, type Pattern, type ThreadColor } from './pattern';
import { objectKey, remember, remembered, rememberedIn, restoreRemembered, type Remembered } from './restitch';
import { formOf, reshapeFill, transformSewObject } from './reshape';
import { stitchKinds } from './sequence';

/**
 * Working with objects as shapes: deleting, duplicating, mirroring, and combining fills by their
 * outlines (one area out of several, or the top one cut out of the others).
 */

/** Where a copy lands, beside the original (mm). */
export const DUPLICATE_OFFSET_MM = 2;

/**
 * The pattern without the objects `which`; null when nothing would be left. A fill's border in a
 * thread of its own goes with it; a border deleted alone leaves its fill without a border.
 */
export function deleteObjects(p: Pattern, which: number[], trimMm: number): Pattern | null {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const gone = new Set(which.filter((o) => objs[o]));
  for (const o of [...gone]) {
    const link = ownBorder(mem[o]);
    const border = link ? mem.findIndex((m) => m?.outline === link) : -1;
    if (border >= 0) gone.add(border);
  }
  // Fills that stay while their border goes: they have none any more.
  const bare = objs.filter((o) => !gone.has(o.index) && [...gone].some((g) => mem[g]?.outline && mem[g]!.outline === ownBorder(mem[o.index])));
  const next = removeObjects(p, [...gone], trimMm);
  if (!next) return null;
  for (const o of bare) {
    const m = mem[o.index]!;
    const at = sewObjects(next).find((x) => objectKey(next, x) === objectKey(p, o));
    if (at) remember(next, at, { ...m, fill: { ...m.fill!, border: undefined } });
  }
  return next;
}

/** The link of a fill's border in a thread of its own, if it has one. */
const ownBorder = (m: Remembered | undefined): string | undefined => (m?.fill?.border?.color ? m.fill.border.link : undefined);

/** The pattern without the objects `which`, nothing else changed; null when nothing would be left. */
function removeObjects(p: Pattern, which: number[], trimMm: number): Pattern | null {
  const objs = sewObjects(p);
  const gone = new Set(which);
  const order = objs.map((o) => o.index).filter((i) => !gone.has(i));
  if (!order.length || order.length === objs.length) return null;
  const starts: number[] = [];
  // Objects that meet where one went stay apart (in one thread they would become one object).
  const apart = new Set(order.flatMap((o, k) => (k > 0 && order[k - 1] !== o - 1 ? [k] : [])));
  const next = reorder(p, objs, order, trimMm, starts, { apart });
  rememberObjects(next, starts);
  return next;
}

/** Object `o` once more, sewn right after it and a little beside it; with the index of the copy. */
export function duplicateObject(p: Pattern, o: number, trimMm: number, offset = DUPLICATE_OFFSET_MM): { pattern: Pattern; index: number } | null {
  const objs = sewObjects(p);
  if (!objs[o]) return null;
  const order = objs.map((x) => x.index);
  order.splice(o + 1, 0, o);
  const starts: number[] = [];
  // Trimmed off the original, so it stays an object of its own even when it starts where that ends.
  const doubled = reorder(p, objs, order, trimMm, starts, { apart: new Set([o + 1]) });
  // The copy has the same stitches, so it remembers the same (its key is its stitches).
  rememberObjects(doubled, starts);
  const kinds = stitchKinds(doubled);
  const nobjs = sewObjects(doubled, kinds);
  const copy = nobjs[o + 1];
  if (!copy) return null;
  // Memory is keyed by stitches: a copy landing exactly on another object (the second copy of one
  // object on the first) would share what that one remembers. It goes a step further then.
  // Its border in its own thread is sewn anew beside it too, so that must not land on another either.
  const taken = new Set(objs.map((x) => objectKey(p, x)));
  const link = ownBorder(remembered(p, objs[o]));
  const border = link ? objs.find((x) => remembered(p, x)?.outline === link) : undefined;
  const lands = (d: number) => [objs[o], border].some((x) => x && taken.has(shiftedKey(p, x, d)));
  let step = 1;
  while (step < 10 && lands(Math.round(offset * step * 10))) step++;
  const r = transformSewObject(doubled, nobjs, copy, kinds, translation(offset * step, offset * step), trimMm);
  // A fill's border of its own thread is copied with it (sewn after the color block, so the copy
  // keeps its number); a copied border becomes a line of its own.
  return r ? { pattern: syncBorders(r.pattern, trimMm), index: o + 1 } : null;
}

/** The key the stitches of `o` would have, moved by `d` (0.1 mm) both ways. */
function shiftedKey(p: Pattern, o: SewObject, d: number): string {
  const n = o.last - o.first + 1;
  const x = new Int32Array(n);
  const y = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = p.x[o.first + i] + d;
    y[i] = p.y[o.first + i] + d;
  }
  return stitchKey({ ...p, x, y, cmd: p.cmd.subarray(o.first, o.last + 1) }, 0, n - 1);
}

/** Mirrored left to right (`x`) or top to bottom (`y`) around its own middle. */
export function mirrorMatrix(axis: 'x' | 'y', box: { minX: number; minY: number; maxX: number; maxY: number }): Mat {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return axis === 'x' ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy];
}

/** The one outline of several fill shapes together (null when one of them has no fill). */
export function unionForm(forms: Form[]): Form | null {
  const areas = forms.map((f) => wholeArea(f));
  if (areas.some((a) => !a)) return null;
  const all = unionOf(areas as NonNullable<(typeof areas)[number]>[]);
  const f = all && vectorize(all);
  return f?.paths.length ? f : null;
}

export interface Subtracted {
  pattern: Pattern;
  /** Objects that were cut (indices after the cutting shape is gone). */
  cut: number[];
  /** Objects the cutting shape covered completely, gone with it. */
  covered: number;
}

/**
 * The last of the objects `which` (the one sewn on top) cut out of the others, and gone itself.
 * Only fills take part. Null when it cut nothing.
 */
export function subtractTop(p: Pattern, which: number[], trimMm: number): Subtracted | null {
  const sorted = [...which].sort((a, b) => a - b);
  const top = sorted.pop();
  if (top === undefined || !sorted.length) return null;
  let cur = p;
  let kinds = stitchKinds(cur);
  let objs = sewObjects(cur, kinds);
  // A fill's border in its own thread belongs to its fill: it neither cuts nor is cut.
  const isBorder = (o: number) => !!objs[o] && !!remembered(cur, objs[o])?.outline;
  if (isBorder(top)) return null;
  const cutter = formOf(cur, objs[top], kinds);
  const hole = cutter && wholeArea(cutter);
  if (!hole) return null;
  const gone = [top];
  const cut: number[] = [];
  for (const o of sorted.filter((x) => !isBorder(x))) {
    const obj = objs[o];
    const form = obj && formOf(cur, obj, kinds);
    const whole = form && wholeArea(form);
    if (!whole) continue;
    const left = knockOut(whole, [hole], 0);
    if (left === whole) continue;
    if (!left) {
      gone.push(o);
      continue;
    }
    const shape = vectorize(left);
    if (!shape.paths.length) {
      gone.push(o);
      continue;
    }
    const r = reshapeFill(cur, objs, obj, kinds, shape, trimMm, remembered(cur, obj)?.knockout);
    const next = r && takeOver(r);
    if (!next) continue;
    cur = next;
    kinds = stitchKinds(cur);
    objs = sewObjects(cur, kinds);
    cut.push(o);
  }
  if (!cut.length && gone.length === 1) return null;
  const without = deleteObjects(cur, gone, trimMm);
  if (!without) return null;
  const shift = (o: number) => o - gone.filter((g) => g < o).length;
  return { pattern: without, cut: cut.map(shift), covered: gone.length - 1 };
}

/**
 * The objects `which` sewn in thread `color`, each where it is: into the thread of a neighbour of
 * that color, else as a color of its own. When they are all of their color block, the block simply
 * gets the new thread. Null when nothing changed.
 */
export function recolorObjects(p: Pattern, which: number[], color: ThreadColor, trimMm: number): Pattern | null {
  const objs = sewObjects(p);
  const sel = [...new Set(which)].filter((o) => objs[o] && !sameColor(objs[o].color, color)).sort((a, b) => a - b);
  if (!sel.length) return null;
  // A border in a thread of its own takes the new thread through its fill: the fill's border is
  // sewn in it from now on, placed where borders go (moved by itself it could join a neighbour).
  const mem = objs.map((o) => remembered(p, o));
  const fillOf = (o: number) => (mem[o]?.outline ? mem.findIndex((m) => ownBorder(m) === mem[o]!.outline) : -1);
  const borders = sel.filter((o) => fillOf(o) >= 0);
  const rest = sel.filter((o) => fillOf(o) < 0);
  let next = rest.length ? recolorStitches(p, objs, rest, color, trimMm) : p;
  if (!next) return null;
  if (!borders.length) return next;
  const cur = next;
  for (const o of borders) {
    const f = fillOf(o);
    const m = mem[f]!;
    const at = sewObjects(cur).find((x) => objectKey(cur, x) === objectKey(p, objs[f]));
    if (at) remember(cur, at, { ...m, fill: { ...m.fill!, border: { ...m.fill!.border!, color: { ...color } } } });
  }
  next = syncBorders(cur, trimMm);
  return next === p ? null : next;
}

function recolorStitches(p: Pattern, objs: SewObject[], sel: number[], color: ThreadColor, trimMm: number): Pattern | null {
  const blocks = new Set(sel.map((o) => objs[o].block));
  // Whole color blocks: their thread changes, nothing moves (unless a neighbour has that thread:
  // then they are sewn along in it).
  const whole = (b: number) => objs.filter((o) => o.block === b).every((o) => sel.includes(o.index));
  const besideSame = (b: number) => [b - 1, b + 1].some((n) => p.colors[n] && sameColor(p.colors[n], color));
  if ([...blocks].every((b) => whole(b) && !besideSame(b))) {
    let cur = p;
    for (const b of blocks) cur = recolor(cur, b, color);
    return cur;
  }
  let cur = p;
  for (const o of sel) {
    const all = sewObjects(cur);
    const obj = all[o];
    if (!obj) return null;
    const records = recs(cur, obj.first, obj.last + 1);
    const known = rememberedIn(cur, [obj]).find((m) => m.join === undefined);
    const without = removeObjects(cur, [o], trimMm);
    if (!without) return null;
    const r = insertObject(without, records, color, o - 1, trimMm);
    if (!r) return null;
    if (known) {
      const back = sewObjects(r.pattern).find((x) => stitchesUpTo(r.pattern, x.first) === r.start);
      if (back) restoreRemembered([{ ...known, key: objectKey(r.pattern, back) }]);
    }
    cur = r.pattern;
  }
  return cur;
}

function stitchesUpTo(p: Pattern, record: number): number {
  let n = 0;
  for (let i = 0; i < record; i++) if (p.cmd[i] === STITCH) n++;
  return n;
}
