import { knockOut, unionOf } from '../shape/rasterize';
import { translation, type Form, type Mat } from '../shape/path';
import { vectorize } from '../shape/vectorize';
import { takeOver, wholeArea } from './knockout';
import { rememberObjects, sewObjects } from './objects';
import { reorder } from './order';
import type { Pattern } from './pattern';
import { remembered } from './restitch';
import { formOf, reshapeFill, transformSewObject } from './reshape';
import { stitchKinds } from './sequence';

/**
 * Working with objects as shapes: deleting, duplicating, mirroring, and combining fills by their
 * outlines (one area out of several, or the top one cut out of the others).
 */

/** Where a copy lands, beside the original (mm). */
export const DUPLICATE_OFFSET_MM = 2;

/** The pattern without the objects `which`; null when nothing would be left. */
export function deleteObjects(p: Pattern, which: number[], trimMm: number): Pattern | null {
  const objs = sewObjects(p);
  const gone = new Set(which);
  const order = objs.map((o) => o.index).filter((i) => !gone.has(i));
  if (!order.length || order.length === objs.length) return null;
  const starts: number[] = [];
  const next = reorder(p, objs, order, trimMm, starts);
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
  const doubled = reorder(p, objs, order, trimMm, starts);
  // The copy has the same stitches, so it remembers the same (its key is its stitches).
  rememberObjects(doubled, starts);
  const kinds = stitchKinds(doubled);
  const nobjs = sewObjects(doubled, kinds);
  const copy = nobjs[o + 1];
  if (!copy) return null;
  const r = transformSewObject(doubled, nobjs, copy, kinds, translation(offset, offset), trimMm);
  return r ? { pattern: r.pattern, index: o + 1 } : null;
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
  const cutter = formOf(cur, objs[top], kinds);
  const hole = cutter && wholeArea(cutter);
  if (!hole) return null;
  const gone = [top];
  const cut: number[] = [];
  for (const o of sorted) {
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
