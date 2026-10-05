import type { Region } from '../digitize/region';
import type { Form } from '../shape/path';
import { knockOut, rasterize } from '../shape/rasterize';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import type { Pattern } from './pattern';
import { remembered, rememberRange, type RestitchResult } from './restitch';
import { reshapeFill } from './reshape';
import { stitchKinds } from './sequence';
import { stitchesBefore } from './transform';

/**
 * Leaving out what lies underneath: a fill whose shape is known as curves can leave out the parts
 * that fills sewn later cover, so they are not sewn twice. This is computed, never stored in the
 * shape: the curves stay whole, and when a shape on top moves away the one below fills again.
 * Nothing is left out unless asked for (per object, `Remembered.knockout`).
 */

/** How far a fill still reaches under the shape on top (mm), so no fabric shows between them. */
export const KNOCKOUT_OVERLAP = 0.2;
/** Overlaps smaller than this (mm²) are not worth mentioning. */
const NOTABLE_MM2 = 1;

const rastered = new WeakMap<Form, Region | null>();

/** The whole area of a form (cached per form; forms are not changed in place). */
export function wholeArea(form: Form, pxMm = 0.1): Region | null {
  let r = rastered.get(form);
  if (r === undefined || (r && r.pxMm !== pxMm)) {
    r = rasterize(form, pxMm);
    rastered.set(form, r);
  }
  return r;
}

/** The whole areas of the fills sewn after `o` whose shape is known as curves. */
function coversOf(p: Pattern, objs: SewObject[], o: SewObject, pxMm: number): Region[] {
  const out: Region[] = [];
  for (const x of objs) {
    if (x.index <= o.index) continue;
    const f = remembered(p, x)?.form;
    const r = f && wholeArea(f, pxMm);
    if (r) out.push(r);
  }
  return out;
}

/** The area to sew for `form` as object `o`: whole, or without what later fills cover. */
export function sewnArea(p: Pattern, objs: SewObject[], o: SewObject, form: Form, knockout: boolean, pxMm = 0.1): Region | null {
  const whole = wholeArea(form, pxMm);
  if (!whole || !knockout) return whole;
  return knockOut(whole, coversOf(p, objs, o, pxMm), KNOCKOUT_OVERLAP);
}

/** A name for an area, the same for the same pixels (FNV-1a over its window and mask). */
export function cutKey(r: Region | null): string {
  if (!r) return '';
  let h = 0x811c9dc5;
  const add = (v: number) => {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const v of [r.x0, r.y0, r.w, r.h]) for (let k = 0; k < 4; k++) add(v >> (8 * k));
  for (let i = 0; i < r.mask.length; i++) add(r.mask[i]);
  return (h >>> 0).toString(36) + r.mask.length.toString(36);
}

/** Takes over new stitches for one object as the edit functions do: one object, remembering its memory. */
export function takeOver(r: RestitchResult): Pattern | null {
  if (!r.starts.length) return null;
  r.starts.forEach((a, k) => rememberObjects(r.pattern, [a], r.ends[k]));
  const fresh = sewObjects(r.pattern);
  const obj = fresh.find((x) => stitchesBefore(r.pattern, x.first) === r.starts[0]);
  if (obj) rememberRange(r.pattern, obj.first, obj.last, r.memory[0]);
  return r.pattern;
}

/** Object `index` sewn anew in its form, leaving out what lies on top or not; null when that did not work. */
function sewAgain(p: Pattern, index: number, knockout: boolean, trimMm: number): Pattern | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const o = objs[index];
  const form = o && remembered(p, o)?.form;
  if (!form) return null;
  const r = reshapeFill(p, objs, o, kinds, form, trimMm, knockout);
  return r && takeOver(r);
}

/**
 * Turns leaving out on or off for the objects `which` (indices in sewing order); only fills with
 * curves take part. Null when nothing changed.
 */
export function setKnockout(p: Pattern, which: number[], on: boolean, trimMm: number): { pattern: Pattern; changed: number } | null {
  let cur = p;
  let changed = 0;
  for (const index of which) {
    const objs = sewObjects(cur);
    const o = objs[index];
    const known = o && remembered(cur, o);
    if (!known?.form || !!known.knockout === on) continue;
    const next = sewAgain(cur, index, on, trimMm);
    if (!next) continue;
    cur = next;
    changed++;
  }
  return changed ? { pattern: cur, changed } : null;
}

/**
 * After shapes changed: the objects that leave out what lies on top, sewn anew where that is
 * different now (a shape on top moved, grew or went away). Null when none needed it.
 */
export function refreshKnockouts(p: Pattern, trimMm: number): { pattern: Pattern; changed: number[] } | null {
  let cur = p;
  const changed: number[] = [];
  const count = sewObjects(cur).length;
  for (let index = 0; index < count; index++) {
    const objs = sewObjects(cur);
    const o = objs[index];
    const known = o && remembered(cur, o);
    if (!known?.form || !known.knockout) continue;
    const area = sewnArea(cur, objs, o, known.form, true, known.region?.pxMm ?? 0.1);
    if (cutKey(area) === known.cut) continue;
    const next = sewAgain(cur, index, true, trimMm);
    if (!next) continue;
    cur = next;
    changed.push(index);
  }
  return changed.length ? { pattern: cur, changed } : null;
}

/** Whether fills sewn later cover a noticeable part of the shape of `o`. */
export function isCovered(p: Pattern, objs: SewObject[], o: SewObject): boolean {
  const form = remembered(p, o)?.form;
  const whole = form && wholeArea(form, remembered(p, o)?.region?.pxMm ?? 0.1);
  if (!whole) return false;
  const left = knockOut(whole, coversOf(p, objs, o, whole.pxMm), KNOCKOUT_OVERLAP);
  return (left?.areaMm2 ?? 0) < whole.areaMm2 - NOTABLE_MM2;
}

/**
 * Fills sewn whole although a later fill covers part of them (noticeably): the ones leaving out
 * would help. Indices in sewing order.
 */
export function overlapsIn(p: Pattern, objs: SewObject[] = sewObjects(p)): number[] {
  return objs.filter((o) => {
    const known = remembered(p, o);
    return !!known?.form && !known.knockout && isCovered(p, objs, o);
  }).map((o) => o.index);
}
