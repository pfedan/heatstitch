import { crossCells, offGrid, onGrid, type CrossGrid } from '../digitize/deco';
import { expandRegion, type Region } from '../digitize/region';
import { bounds } from '../shape/path';
import { knockOut, regionOf } from '../shape/rasterize';
import { wholeArea } from './knockout';
import { sewObjects as sewObjectsOf, type SewObject } from './objects';
import type { Pattern } from './pattern';
import { borderOf, columnOf, crossGridOf, keepShape, objectKey, railsArea, remembered, sameGrid, type FillSettings, type Remembered } from './restitch';
import { stitchKinds } from './sequence';
import { areaOf, appliqueArea } from './geo';

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
  const known = remembered(p, o);
  const own = known?.fill;
  const mine = (m: Remembered | undefined) => (!!m?.outline && m.outline === borderOf(known)?.link) || (!!m?.blendOf && m.blendOf === own?.deco?.blend?.link);
  let before: SewObject[] | null = null;
  const filled = () => (before ??= sewObjectsOf(p).filter((f) => f.index < o.index));
  const grid = own && sharedGrid(own);
  for (const x of later) {
    if (!overlapsBox(reachOf(p, x), reach)) continue;
    const m = remembered(p, x);
    if (mine(m)) continue;
    // The border of a fill sewn before that leaves `o` out runs beside `o`, not on it: `o` leaves
    // nothing out for it (else each would leave out the other's border, and neither settle).
    if (m?.outline && filled().some((f) => leavesOut(p, f, m.outline!, reach))) continue;
    // An appliqué's fabric covers its area as a fill does.
    const f = areaOf(m) ?? appliqueArea(m);
    // Cross stitch on the same grid: the cells its crosses take, exactly, so the crosses below
    // stop at the cell next to them (no gap, no cell crossed twice).
    const xg = grid && m?.fill && f && sharedGrid(m.fill);
    if (xg && sameGrid(grid, xg)) {
      const whole = wholeArea(f, pxMm, m.fill!.areaGrow ?? 0);
      const sewn = whole && (m.fill!.expand ? expandRegion(whole, m.fill!.expand) : whole);
      const cells = sewn && crossClaim(sewn, xg);
      if (cells) out.push({ region: cells, overlap: 0 });
      continue;
    }
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

/** Whether `f` is a fill with the border `link` that leaves out what lies on top, reaching over `reach`. */
function leavesOut(p: Pattern, f: SewObject, link: string, reach: Box): boolean {
  const m = remembered(p, f);
  return !!m?.knockout && borderOf(m)?.link === link && overlapsBox(reachOf(p, f), reach);
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

/** The grid of a cross stitch fill when it is the design's (shared with others), else null. */
const sharedGrid = (s: FillSettings): CrossGrid | null => (s.deco?.ownGrid ? null : crossGridOf(s));

const claims = new WeakMap<Region, Map<string, Region | null>>();

/**
 * The cells of grid `g` a cross stitch fill on area `r` crosses (see crossCells), as an area of the
 * same pixels; cached per area and grid, so the same area on top is the same cover.
 */
export function crossClaim(r: Region, g: CrossGrid): Region | null {
  let byGrid = claims.get(r);
  if (!byGrid) claims.set(r, (byGrid = new Map()));
  const key = `${g.size} ${g.angle} ${g.origin[0]} ${g.origin[1]}`;
  if (byGrid.has(key)) return byGrid.get(key)!;
  const cells = crossCells(r, g);
  const px = r.pxMm;
  // A cell reaches beyond the area by less than its diagonal.
  const m = Math.ceil((g.size * Math.SQRT2) / px) + 2;
  const x0 = r.x0 - m;
  const y0 = r.y0 - m;
  const w = r.w + 2 * m;
  const h = r.h + 2 * m;
  const mask = new Uint8Array(w * h);
  const to = offGrid(g);
  const at = onGrid(g);
  let n = 0;
  for (const [i, j] of cells) {
    const qs = [to([i, j]), to([i + 1, j]), to([i + 1, j + 1]), to([i, j + 1])];
    const fx = Math.max(0, Math.floor(Math.min(...qs.map((q) => q[0])) / px) - x0);
    const tx = Math.min(w - 1, Math.ceil(Math.max(...qs.map((q) => q[0])) / px) - x0);
    const fy = Math.max(0, Math.floor(Math.min(...qs.map((q) => q[1])) / px) - y0);
    const ty = Math.min(h - 1, Math.ceil(Math.max(...qs.map((q) => q[1])) / px) - y0);
    for (let y = fy; y <= ty; y++) {
      for (let x = fx; x <= tx; x++) {
        const c = at([(x + x0 + 0.5) * px, (y + y0 + 0.5) * px]);
        if (Math.floor(c[0]) !== i || Math.floor(c[1]) !== j || mask[y * w + x]) continue;
        mask[y * w + x] = 1;
        n++;
      }
    }
  }
  const out = n ? regionOf(mask, x0, y0, w, h, px) : null;
  byGrid.set(key, out);
  return out;
}
