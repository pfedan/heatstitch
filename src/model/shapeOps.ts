import { hasPart, partInThread, partOf, withoutPart } from './shadow';
import { translation, type Form, type Mat } from '../shape/path';
import { areaOfForm, subtractForm, unionForms } from '../shape/ops';
import { takeOver } from './knockout';
import { rememberObjects, sewObjects, stitchKey, type SewObject } from './objects';
import { listOf, sewList } from './sew';
import { newLink, syncBorders } from './border';
import { reorder } from './order';
import { recolor, sameColor } from './recolor';
import type { Pattern, ThreadColor } from './pattern';
import { forget, objectKey, remember, remembered, restitch, type Remembered } from './restitch';
import { reshapeFill, transformSewObject } from './reshape';
import { stitchKinds } from './sequence';
import { stitchesBefore } from './transform';
import { autoReversible, ownSettings, reverseLines } from './reverse';
import { guessArea, lineGeoOf, sewnAlong } from './geo';

/**
 * Working with objects as shapes: deleting, duplicating, mirroring, and combining fills by their
 * outlines (one area out of several, or the top one cut out of the others).
 */

/** Where a copy lands, beside the original (mm). */
export const DUPLICATE_OFFSET_MM = 2;

/**
 * The pattern without the objects `which` (an empty design when none is left); null when none of
 * them is there. A fill's border in a thread of its own goes with it; a border deleted alone
 * leaves its fill without a border.
 */
export function deleteObjects(p: Pattern, which: number[], trimMm: number): Pattern | null {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const gone = new Set(which.filter((o) => objs[o]));
  for (const o of [...gone]) {
    const link = ownBorder(mem[o]);
    const border = link ? mem.findIndex((m) => m?.outline === link) : -1;
    if (border >= 0) gone.add(border);
    // A blend's second thread goes with its fill.
    const blend = mem[o]?.fill?.deco?.blend?.link;
    const second = blend ? mem.findIndex((m) => m?.blendOf === blend) : -1;
    if (second >= 0) gone.add(second);
    // A line's shadow goes with it.
    // A line's shadow and echo copies in threads of their own go with it.
    mem.forEach((m, k) => {
      const l = partOf(m);
      if (l && hasPart(mem[o], l)) gone.add(k);
    });
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
  // Fills whose second thread goes alone: they fade out on their own from now on.
  // Lines whose shadow or echo copies go alone: they have them no more.
  for (const o of objs) {
    let m = mem[o.index];
    if (gone.has(o.index) || !m || !lineGeoOf(m)) continue;
    const parts = [...gone].map((g) => partOf(mem[g])).filter((l): l is string => !!l && hasPart(m, l));
    if (!parts.length) continue;
    for (const l of parts) m = withoutPart(m, l);
    const at = sewObjects(next).find((x) => objectKey(next, x) === objectKey(p, o));
    if (at) remember(next, at, m);
  }
  for (const o of objs) {
    const m = mem[o.index];
    const link = m?.fill?.deco?.blend?.link;
    if (gone.has(o.index) || !link || ![...gone].some((g) => mem[g]?.blendOf === link)) continue;
    const at = sewObjects(next).find((x) => objectKey(next, x) === objectKey(p, o));
    if (at) remember(next, at, { ...m, fill: { ...m.fill!, deco: { ...m.fill!.deco, blend: undefined } } });
  }
  return next;
}

/** The link of a fill's border (an object of its own), if it has one. */
const ownBorder = (m: Remembered | undefined): string | undefined => m?.fill?.border?.link;

/** The pattern without the objects `which`, nothing else changed (with all gone, an empty design); null when none of them is there. */
function removeObjects(p: Pattern, which: number[], trimMm: number): Pattern | null {
  const gone = new Set(which);
  const list = listOf(p);
  const left = list.filter((e) => !gone.has(e.obj.index));
  return left.length === list.length ? null : sewList(p, left, trimMm);
}

/** Object `o` once more, sewn right after it and a little beside it; with the index of the copy. */
export function duplicateObject(p: Pattern, o: number, trimMm: number, offset = DUPLICATE_OFFSET_MM): { pattern: Pattern; index: number } | null {
  const r = duplicateObjects(p, [o], trimMm, offset);
  return r && { pattern: r.pattern, index: r.copies[0] };
}

export interface Duplicated {
  pattern: Pattern;
  /** The copies (indices in `pattern`). */
  copies: number[];
  /** Copies in place that could not be sewn the other way round: 0.1 mm beside their original. */
  nudged: number;
}

/**
 * The objects `which` once more, each copy sewn right after its original and `offset` mm beside it
 * (right and down), all by the same step so they keep their places to each other; with 0 exactly
 * on it (Ctrl+D). What belongs to a chosen object (its border in its own thread, a blend's second
 * thread, a line's shadow and echo copies) is not copied on its own: the copy gets parts of its own
 * (syncBorders). With the indices of the copies.
 */
export function duplicateObjects(p: Pattern, which: number[], trimMm: number, offset = DUPLICATE_OFFSET_MM): Duplicated | null {
  const objs = sewObjects(p);
  const mem = objs.map((x) => remembered(p, x));
  const chosen = new Set(which.filter((o) => objs[o]));
  // Parts of a chosen object come anew with its copy.
  const partsOf = (o: number): number[] => {
    const m = mem[o];
    const link = ownBorder(m);
    const blend = m?.fill?.deco?.blend?.link;
    return objs.flatMap((_, k) => {
      const n = mem[k];
      const l = partOf(n);
      return (link && n?.outline === link) || (blend && n?.blendOf === blend) || (l && hasPart(m, l)) ? [k] : [];
    });
  };
  for (const o of [...chosen]) for (const k of partsOf(o)) if (k !== o && chosen.has(k) && !partsOf(k).includes(o)) chosen.delete(k);
  const list = [...chosen].sort((a, b) => a - b);
  if (!list.length) return null;
  // Memory is keyed by stitches: a copy landing exactly on another object beside it (the second
  // copy of one object on the first) is moved a step further, so copies do not pile up unseen.
  let step = 1;
  if (offset) {
    const taken = new Set(objs.map((x) => objectKey(p, x)));
    const moving = list.flatMap((o) => [o, ...partsOf(o)]);
    const lands = (d: number) => moving.some((k) => taken.has(shiftedKey(p, objs[k], d)));
    while (step < 10 && lands(Math.round(offset * step * 10))) step++;
  }
  const order: number[] = [];
  const apart = new Set<number>();
  for (const x of objs) {
    order.push(x.index);
    if (!list.includes(x.index)) continue;
    // Trimmed off the original, so it stays an object of its own even when it starts where that ends.
    apart.add(order.length);
    order.push(x.index);
  }
  const starts: number[] = [];
  let cur = reorder(p, objs, order, trimMm, starts, { apart });
  // The copy has the same stitches, so it remembers the same (its key is its stitches).
  rememberObjects(cur, starts);
  const copies = [...apart];
  if (copies.some((k) => !sewObjects(cur)[k])) return null;
  let nudged = 0;
  for (const k of copies) {
    const next = offset ? moved(cur, k, translation(offset * step, offset * step), trimMm) : inPlace(cur, k, trimMm);
    if (!next) return null;
    if (next.nudged) nudged++;
    cur = next.pattern;
  }
  // A fill's border of its own thread is copied with it (sewn after the color block, so the copy
  // keeps its number); a copied border becomes a line of its own. The copies are found again by
  // their stitches, as parts sewn in for them move them on.
  const nobjs = sewObjects(cur);
  // Copies of parts of a fill cut apart are a whole of their own (the parts copied together one).
  const wholes = new Map<string, string>();
  for (const k of copies) {
    const m = remembered(cur, nobjs[k]);
    if (!m?.piece) continue;
    if (!wholes.has(m.piece)) wholes.set(m.piece, newLink());
    remember(cur, nobjs[k], { ...m, piece: wholes.get(m.piece) });
  }
  const keys = copies.map((k) => objectKey(cur, nobjs[k]));
  const next = syncBorders(cur, trimMm);
  const after = sewObjects(next).map((x) => objectKey(next, x));
  const found = keys.map((key) => after.indexOf(key));
  if (found.some((k) => k < 0)) return null;
  return { pattern: next, copies: found, nudged };
}

/** Object `k` of `p` moved by `m`. */
function moved(p: Pattern, k: number, m: Mat, trimMm: number): { pattern: Pattern; nudged?: boolean } | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const r = transformSewObject(p, objs, objs[k], kinds, m, trimMm);
  return r && { pattern: r.pattern };
}

/**
 * Copy `k`, lying on its original right before it, kept exactly there but sewn from the other end:
 * it starts where the original ends (no way back to its start), and with stitches of its own it
 * remembers its own (memory is keyed by stitches). A line turns its curve (0.1 mm beside), a fill
 * or satin is sewn anew the other way round. What cannot be turned (stitches from a file changed by hand, a fill
 * read from a file) goes the smallest step beside it, 0.1 mm to the right.
 */
function inPlace(p: Pattern, k: number, trimMm: number): { pattern: Pattern; nudged?: boolean } | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const o = objs[k];
  const known = remembered(p, o);
  // A try whose stitches turn out to be another object's has overwritten what that one remembers
  // (memory is keyed by stitches): it is put back.
  const kept = objs.map((x) => remembered(p, x));
  let next: Pattern | null = null;
  if (sewnAlong(p, o) && !known?.hand) {
    // A line also goes the smallest step beside it: sewn back along itself (an echo on both sides,
    // a line there and back) it would otherwise have the very stitches of its copy.
    const beside = moved(p, k, translation(0.1, 0), trimMm);
    next = beside && reverseLines(beside.pattern, [k], trimMm).pattern;
  }
  else if (autoReversible(p, o)) {
    // Sewn anew the other way round, where it is (not moved in the order, so it stays apart).
    const r = restitch(p, objs, [k], ownSettings(p, kinds), kinds, trimMm, undefined, true);
    if (r.starts.length === 1 && !r.failed.length) {
      rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
      const at = sewObjects(r.pattern).find((x) => stitchesBefore(r.pattern, x.first) === r.starts[0]);
      if (at) {
        remember(r.pattern, at, r.memory[0]);
        next = r.pattern;
      }
    }
  }
  const own = (q: Pattern) => {
    const now = sewObjects(q);
    const key = now.length === objs.length && objectKey(q, now[k]);
    if (key && now.every((x) => x.index === k || objectKey(q, x) !== key)) return true;
    objs.forEach((x, i) => i !== k && forget(p, x, kept[i]));
    return false;
  };
  if (next && next !== p && own(next)) return { pattern: next };
  const step = moved(p, k, translation(0.1, 0), trimMm);
  return step && own(step.pattern) ? { pattern: step.pattern, nudged: true } : null;
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

/** Below this a form counts as empty (mm²): what is left of a cut is a sliver, not an area. */
const NO_AREA = 0.05;

/**
 * The one outline of several fill shapes together, joined on their curves (null when one of them
 * has no fill). Needs `loadOps()`.
 */
export function unionForm(forms: Form[]): Form | null {
  if (forms.some((f) => !f.paths.some((p) => p.closed && p.nodes.length > 1))) return null;
  const f = unionForms(forms);
  return f && areaOfForm(f) >= NO_AREA ? f : null;
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
 * Only fills take part; they are cut on their curves (needs `loadOps()`). Null when it cut nothing.
 */
export function subtractTop(p: Pattern, which: number[], trimMm: number): Subtracted | null {
  const sorted = [...which].sort((a, b) => a - b);
  const top = sorted.pop();
  if (top === undefined || !sorted.length) return null;
  let cur = p;
  let kinds = stitchKinds(cur);
  let objs = sewObjects(cur, kinds);
  // A fill's border in its own thread belongs to its fill: it neither cuts nor is cut (so does a
  // blend's second thread).
  const isBorder = (o: number) => !!objs[o] && !!(remembered(cur, objs[o])?.outline || remembered(cur, objs[o])?.blendOf || partOf(remembered(cur, objs[o])));
  if (isBorder(top)) return null;
  const cutter = guessArea(cur, objs[top], kinds);
  if (!cutter || areaOfForm(cutter) < NO_AREA) return null;
  const gone = [top];
  const cut: number[] = [];
  for (const o of sorted.filter((x) => !isBorder(x))) {
    const obj = objs[o];
    const form = obj && guessArea(cur, obj, kinds);
    if (!form) continue;
    const before = areaOfForm(form);
    if (before < NO_AREA) continue;
    const shape = subtractForm(form, cutter);
    const after = shape ? areaOfForm(shape) : 0;
    // Cut on the curves: an untouched form keeps its area to rounding.
    if (before - after < 1e-6 * before) continue;
    if (!shape || after < NO_AREA) {
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
  const fillOf = (o: number) =>
    mem[o]?.outline
      ? mem.findIndex((m) => ownBorder(m) === mem[o]!.outline)
      : mem[o]?.blendOf
        ? mem.findIndex((m) => m?.fill?.deco?.blend?.link === mem[o]!.blendOf)
        : partOf(mem[o])
          ? mem.findIndex((m) => hasPart(m, partOf(mem[o])!))
          : -1;
  const borders = sel.filter((o) => fillOf(o) >= 0);
  const rest = sel.filter((o) => fillOf(o) < 0);
  let next = rest.length ? recolorStitches(p, objs, rest, color, trimMm) : p;
  if (!next) return null;
  // A border in its fill's thread goes along into the new one.
  if (!borders.length) return syncBorders(next, trimMm);
  const cur = next;
  for (const o of borders) {
    const f = fillOf(o);
    const m = mem[f]!;
    const at = sewObjects(cur).find((x) => objectKey(cur, x) === objectKey(p, objs[f]));
    if (at && partOf(mem[o])) remember(cur, at, partInThread(m, partOf(mem[o])!, color));
    else if (at && mem[o]!.blendOf) remember(cur, at, { ...m, fill: { ...m.fill!, deco: { ...m.fill!.deco, blend: { ...m.fill!.deco!.blend!, color: { ...color } } } } });
    else if (at) remember(cur, at, { ...m, fill: { ...m.fill!, border: { ...m.fill!.border!, color: sameColor(at.color, color) ? undefined : { ...color } } } });
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
  // The others, one by one in the list: each sewn in the thread of a neighbour of that color, else
  // in a color of its own, trimmed off its neighbours (in one thread with them it would become part
  // of one). Nothing else moves, and every object keeps its id and what it knows.
  const chosen = new Set(sel);
  const list = listOf(p);
  const apart = new Set<number>();
  const rgb = (a: ThreadColor, b: ThreadColor) => a.r === b.r && a.g === b.g && a.b === b.b;
  list.forEach((e, k) => {
    if (!chosen.has(e.obj.index)) return;
    const prev = list[k - 1];
    const next = list[k + 1];
    const host = prev && rgb(prev.color, color) ? prev : next && !chosen.has(next.obj.index) && rgb(next.color, color) ? next : null;
    e.color = host ? host.color : { ...color };
    e.thread = host ? host.thread : `own${e.obj.id}`;
    apart.add(k).add(k + 1);
  });
  // Where one now meets a block of its new color, they are one thread.
  for (let k = 1; k < list.length; k++) {
    const [a, b] = [list[k - 1], list[k]];
    if (a.thread === b.thread || !rgb(a.color, b.color) || !(chosen.has(a.obj.index) || chosen.has(b.obj.index))) continue;
    const was = b.thread;
    for (const e of list) if (e.thread === was) e.thread = a.thread;
  }
  return sewList(p, list, trimMm, { apart });
}

