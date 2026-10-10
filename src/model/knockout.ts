import { expandRegion, type Region } from '../digitize/region';
import { syncBorders } from './border';
import type { Form } from '../shape/path';
import { coversOver, cutAway, SATIN_SHARE, type Cover } from './covers';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import type { Pattern } from './pattern';
import { remember, remembered, rememberRange, type Remembered, type RestitchResult } from './restitch';
import { reshapeFill } from './reshape';
import { stitchKinds } from './sequence';
import { stitchesBefore } from './transform';
import { areaOf, grownForm } from './geo';

/**
 * Leaving out what lies underneath: a fill whose shape is known as curves can leave out the parts
 * that fills sewn later cover, so they are not sewn twice. This is computed, never stored in the
 * shape: the curves stay whole, and when a shape on top moves away the one below fills again.
 * Nothing is left out unless asked for (per object, `Remembered.knockout`).
 */

/** How far a fill still reaches under the shape on top (mm), so no fabric shows between them. */
export { FILL_OVERLAP as KNOCKOUT_OVERLAP } from './covers';
/** Overlaps smaller than this (mm²) are not worth mentioning. */
const NOTABLE_MM2 = 1;
/**
 * Nor are overlaps no wider than this (mm): a thin strip along an edge, as where the parts of a
 * cut fill reach under each other, is meant so (no fabric shows between them).
 */
const THIN_MM = 0.6;

const rastered = new WeakMap<Form, Map<string, Region | null>>();

/**
 * The whole area of a form, grown by `grow` mm (the pull compensation it is sewn with, see
 * FillSettings.areaGrow). Cached per form; forms are not changed in place.
 */
export function wholeArea(form: Form, pxMm = 0.1, grow = 0): Region | null {
  let byKey = rastered.get(form);
  if (!byKey) rastered.set(form, (byKey = new Map()));
  const key = `${pxMm} ${grow}`;
  let r = byKey.get(key);
  if (r === undefined) {
    r = grownForm(form, pxMm, grow);
    byKey.set(key, r);
  }
  return r;
}

/** How far the area of `m` reaches beyond its form (mm, see FillSettings.areaGrow). */
const growOf = (m: Remembered | null | undefined): number => m?.fill?.areaGrow ?? 0;

/** Areas with parts left out, and the whole area they were cut from. */
const cutFrom = new WeakMap<Region, Region>();

/** What was last left out of a whole area, and by what. */
const lastCut = new WeakMap<Region, { covers: Cover[]; cut: Region | null }>();
const sameCovers = (a: Cover[], b: Cover[]) => a.length === b.length && a.every((c, k) => c.region === b[k].region && c.overlap === b[k].overlap);

/**
 * The area to sew for `form` as object `o`: whole (grown by the pull compensation it was made with),
 * or without what later fills and satins cover.
 */
export function sewnArea(p: Pattern, objs: SewObject[], o: SewObject, form: Form, knockout: boolean, pxMm = 0.1, grow = growOf(remembered(p, o))): Region | null {
  const whole = wholeArea(form, pxMm, grow);
  if (!whole || !knockout) return whole;
  const covers = coversOver(p, objs, o, pxMm, remembered(p, o)?.overlapShare ?? SATIN_SHARE);
  // The same shapes on top as last time (areas are cached per form): the same area is left.
  const last = lastCut.get(whole);
  if (last && sameCovers(last.covers, covers)) return last.cut;
  const cut = cutAway(whole, covers);
  if (cut && cut !== whole) cutFrom.set(cut, whole);
  lastCut.set(whole, { covers, cut });
  return cut;
}

/**
 * The whole area a sewn area `r` was cut from by shapes on top (its edges there are not the
 * shape's own), or null when nothing of it was left out. `m` is what the object remembers.
 */
export function wholeOf(r: Region, m?: Remembered | null): Region | null {
  // After a reload only the shape is known: its whole area, for the area remembered with it.
  const w = cutFrom.get(r) ?? (areaOf(m) && m!.knockout && m!.region === r ? wholeArea(areaOf(m)!, r.pxMm, growOf(m)) : null);
  return w && w !== r ? w : null;
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
  const form = o && areaOf(remembered(p, o));
  if (!form) return null;
  const r = reshapeFill(p, objs, o, kinds, form, trimMm, knockout);
  return r && takeOver(r);
}

/**
 * Object `index`, which leaves out what lies on top, sewn anew on what is left of it. When nothing
 * sewable is left (all of it covered, or a strip too thin to fill), it is sewn whole as long as
 * the shapes on top stay so: it still leaves out (`knockout`), and `cut` names the area it could
 * not be sewn on, so it is not tried again until that changes. Null when neither worked.
 */
function sewCut(p: Pattern, index: number, trimMm: number): Pattern | null {
  const cut = sewAgain(p, index, true, trimMm);
  if (cut) return cut;
  const objs = sewObjects(p);
  const o = objs[index];
  const known = o && remembered(p, o);
  const form = areaOf(known);
  if (!known || !form) return null;
  const left = cutKey(sewnArea(p, objs, o, form, true, known.region?.pxMm ?? 0.1));
  const whole = sewAgain(p, index, false, trimMm);
  const w = whole && sewObjects(whole)[index];
  const m = w && remembered(whole, w);
  if (!m) return null;
  remember(whole, w, { ...m, knockout: true, cut: left });
  return whole;
}

/**
 * Turns leaving out on or off for the objects `which` (indices in sewing order); only fills with
 * curves take part. Null when nothing changed.
 */
export function setKnockout(p: Pattern, which: number[], on: boolean, trimMm: number): { pattern: Pattern; changed: number } | null {
  let cur = p;
  let changed = 0;
  let objs = sewObjects(cur);
  for (const index of which) {
    const o = objs[index];
    const known = o && remembered(cur, o);
    if (!known || !areaOf(known) || known.free || !!known.knockout === on) continue;
    const next = sewAgain(cur, index, on, trimMm);
    if (!next) continue;
    cur = next;
    objs = sewObjects(cur);
    changed++;
  }
  // Its border and blend in a thread of their own follow the area it is sewn on now, in the same step.
  return changed ? { pattern: syncBorders(cur, trimMm), changed } : null;
}

/**
 * How far the fills `which` still reach under a satin on top (share of its width): remembered, and
 * sewn anew where they leave out what lies on top. Null when nothing changed.
 */
export function setOverlapShare(p: Pattern, which: number[], share: number, trimMm: number): { pattern: Pattern; changed: number } | null {
  let cur = p;
  let changed = 0;
  for (const index of which) {
    const objs = sewObjects(cur);
    const o = objs[index];
    const known = o && remembered(cur, o);
    if (!known || !areaOf(known) || known.free || (known.overlapShare ?? SATIN_SHARE) === share) continue;
    remember(cur, o, { ...known, overlapShare: share });
    changed++;
    if (!known.knockout) continue;
    const next = sewCut(cur, index, trimMm);
    if (next) cur = next;
  }
  return changed ? { pattern: syncBorders(cur, trimMm), changed } : null;
}

/**
 * After shapes changed: the objects that leave out what lies on top, sewn anew where that is
 * different now (a shape on top moved, grew or went away). Null when none needed it.
 */
export function refreshKnockouts(p: Pattern, trimMm: number): { pattern: Pattern; changed: number[] } | null {
  let cur = p;
  const changed: number[] = [];
  // The objects are found again only when one was sewn anew (with many objects that is most of the time).
  let objs = sewObjects(cur);
  const count = objs.length;
  for (let index = 0; index < count; index++) {
    const o = objs[index];
    const known = o && remembered(cur, o);
    const form = areaOf(known);
    if (!known || !form || known.free || !known.knockout) continue;
    const area = sewnArea(cur, objs, o, form, true, known.region?.pxMm ?? 0.1);
    if (cutKey(area) === known.cut) continue;
    const next = sewCut(cur, index, trimMm);
    if (!next) continue;
    cur = next;
    objs = sewObjects(cur);
    changed.push(index);
  }
  return changed.length ? { pattern: syncBorders(cur, trimMm), changed } : null;
}

/** Whether fills sewn later cover a noticeable part of the shape of `o`. */
export function isCovered(p: Pattern, objs: SewObject[], o: SewObject): boolean {
  const known = remembered(p, o);
  const form = areaOf(known);
  const whole = form && wholeArea(form, known?.region?.pxMm ?? 0.1, growOf(known));
  if (!whole) return false;
  const left = cutAway(whole, coversOver(p, objs, o, whole.pxMm, remembered(p, o)?.overlapShare ?? SATIN_SHARE));
  if ((left?.areaMm2 ?? 0) >= whole.areaMm2 - NOTABLE_MM2) return false;
  // What lies under a thin strip only is not covered: the part still sewn, grown by THIN_MM, reaches over it.
  const near = left && expandRegion(left, THIN_MM);
  return !near || outside(whole, near) * whole.pxMm * whole.pxMm >= NOTABLE_MM2;
}

/** Pixels of `a` that `b` does not cover. */
function outside(a: Region, b: Region): number {
  let n = 0;
  for (let j = 0; j < a.h; j++) {
    const y = j + a.y0 - b.y0;
    for (let i = 0; i < a.w; i++) {
      if (!a.mask[j * a.w + i]) continue;
      const x = i + a.x0 - b.x0;
      if (x < 0 || y < 0 || x >= b.w || y >= b.h || !b.mask[y * b.w + x]) n++;
    }
  }
  return n;
}

/**
 * Fills sewn whole although a later fill covers part of them (noticeably): the ones leaving out
 * would help. Indices in sewing order.
 */
export function overlapsIn(p: Pattern, objs: SewObject[] = sewObjects(p)): number[] {
  return objs.filter((o) => {
    const known = remembered(p, o);
    return !!known && !!areaOf(known) && !known.knockout && isCovered(p, objs, o);
  }).map((o) => o.index);
}
