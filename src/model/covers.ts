import type { Region } from '../digitize/region';
import { bounds } from '../shape/path';
import { knockOut } from '../shape/rasterize';
import { wholeArea } from './knockout';
import type { SewObject } from './objects';
import type { Pattern } from './pattern';
import { columnOf, keepShape, objectKey, railsArea, remembered, type Remembered } from './restitch';
import { stitchKinds } from './sequence';
import { areaOf } from './geo';

/**
 * What objects sewn later cover of an object: fills whose shape is known as curves, and satins
 * (their columns, remembered or read from their stitches). Each cover comes with how far the
 * object below may still reach under it: a fixed overlap under a fill, a share of the column's
 * width under a satin (the usual quarter to third, so no fabric shows when the satin pulls in).
 */
export interface Cover {
  region: Region;
  /** How far the object below still reaches under it (mm). */
  overlap: number;
}

/** Overlap under a fill sewn later (mm). */
export const FILL_OVERLAP = 0.2;
/** Overlap under a satin sewn later: this share of its width. */
export const SATIN_SHARE = 0.3;

const satinCache = new Map<string, { region: Region; width: number } | null>();
const CACHE_SIZE = 200;

/** The area of a satin object and its median width, or null when its columns are not known. */
function satinCover(p: Pattern, x: SewObject, kinds: () => Uint8Array): { region: Region; width: number } | null {
  const key = objectKey(p, x);
  const known = remembered(p, x);
  // Remembered columns can change without the stitches (rails moved): not cached then.
  if (!known?.columns && satinCache.has(key)) return satinCache.get(key)!;
  const rails = (known?.columns ?? keepShape(p, x, kinds()).columns ?? []).flat();
  const region = rails.length ? railsArea(rails) : null;
  const widths = rails.map((r) => columnOf(r).width).filter((w) => w > 0).sort((a, b) => a - b);
  const out = region && widths.length ? { region, width: widths[widths.length >> 1] } : null;
  if (!known?.columns) {
    satinCache.set(key, out);
    if (satinCache.size > CACHE_SIZE) satinCache.delete(satinCache.keys().next().value!);
  }
  return out;
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };
const overlapsBox = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/**
 * Where object `o` can be covered (0.1 mm): its whole shape when known, not its stitches, which
 * leave out what lies on top (else what covers it would depend on what it left out last time).
 */
function reachOf(p: Pattern, o: SewObject): Box {
  const f = areaOf(remembered(p, o));
  const b = f && bounds(f);
  return b ? { minX: b.minX * 10 - 1, minY: b.minY * 10 - 1, maxX: b.maxX * 10 + 1, maxY: b.maxY * 10 + 1 } : o;
}

/** The covers over object `o` from the objects sewn after it (see Cover). */
export function coversOver(p: Pattern, objs: SewObject[], o: SewObject, pxMm: number, share = SATIN_SHARE): Cover[] {
  return coversFrom(p, objs.filter((x) => x.index > o.index), o, pxMm, share);
}

/** The covers over object `o` from the objects `later`, sewn after it (see Cover). */
export function coversFrom(p: Pattern, later: SewObject[], o: SewObject, pxMm: number, share = SATIN_SHARE): Cover[] {
  const out: Cover[] = [];
  let k: Uint8Array | null = null;
  const kinds = () => (k ??= stitchKinds(p));
  const reach = reachOf(p, o);
  // Its own border and second blend thread lie on it on purpose: they leave nothing out of it.
  const own = remembered(p, o)?.fill;
  const mine = (m: Remembered | undefined) => (!!m?.outline && m.outline === own?.border?.link) || (!!m?.blendOf && m.blendOf === own?.deco?.blend?.link);
  for (const x of later) {
    if (!overlapsBox(reachOf(p, x), reach)) continue;
    if (mine(remembered(p, x))) continue;
    const f = areaOf(remembered(p, x));
    const r = f && wholeArea(f, pxMm);
    if (r) {
      out.push({ region: r, overlap: FILL_OVERLAP });
      continue;
    }
    if (x.kind !== 'satin' || pxMm !== 0.1) continue;
    const s = satinCover(p, x, kinds);
    if (s) out.push({ region: s.region, overlap: s.width * share });
  }
  return out;
}

/** `base` without what the covers cover beyond their overlap; null when nothing is left. */
export function cutAway(base: Region, covers: Cover[]): Region | null {
  let cur: Region | null = base;
  for (const c of covers) {
    if (!cur) return null;
    cur = knockOut(cur, [c.region], c.overlap);
  }
  return cur;
}
