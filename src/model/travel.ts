import { TRAVEL_STITCH } from '../digitize/fill';
import { core } from '../wasm/core';
import { outline, sample, type Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { rasterize, rasterizeStroke, regionOf, unionOf } from '../shape/rasterize';
import type { Form } from '../shape/path';
import { withRecords } from './edit';
import { bandArea, geoOf, geoUse } from './geo';
import { wholeArea } from './knockout';
import { relearn, setObjects, sewObjects, stitchKey, tableOf, trimmedBetween, type PlacedEntry, type SewObject } from './objects';
import { setTrims } from './jumps';
import { blockIndex, transitions, type Transition } from './sequence';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern } from './pattern';
import { isOpenPattern, remember, remembered, type FillPattern, type Remembered } from './restitch';
import { listOf, sewList, specOf } from './sew';

/**
 * Hidden travel between objects: where the thread goes from one object to the next in the same
 * thread, a running stitch under a dense fill sewn later instead of a jump (and a trim when
 * further than the trim length). The professional programs do this when they branch objects
 * (Wilcom and Hatch: "overlapped segments are hidden behind objects later in the stitch order"),
 * Ink/Stitch leaves it to the hand ("Jump to Stroke", then hide the line under other elements).
 *
 * The way is found on the travel grid the fills plan their underpath on (see TravelGrid in
 * digitize/fill.ts): the shortest way inside the area that later dense fills cover, kept off their
 * edges, not only the straight line. Only fills whose rows lie close enough to hide a thread count:
 * not the open and light patterns (the fabric shows between their lines, and so would the travel),
 * not satin or lines (too narrow to be sure), not appliqué fabric, not a part left out of a fill
 * under something on top (the fill's area is what it sews), and not a shape guessed from stitches.
 *
 * The travel belongs to the object it leads to: its first `travel` stitches (Remembered.travel),
 * counted in its parts like the travel inside a fill. sewList (sew.ts) plans it whenever it joins
 * two neighbours anew and drops it when what hid it changed; settleTravel does the same for an
 * edit made elsewhere.
 */

/** Patterns whose rows cover the fabric (at a dense spacing): what lies under them does not show. */
const HIDING: ReadonlySet<FillPattern> = new Set<FillPattern>(['tatami', 'gradient', 'contour', 'spiral', 'follow', 'guided', 'waves', 'grain', 'rays', 'swirl', 'circles']);
/** Rows further apart than this (mm) let a thread under them show (a light fill). */
export const HIDING_SPACING = 0.6;
/** Travel keeps this far inside what hides it (mm): rows pull in at their ends, the fabric moves. */
export const HIDE_INSET = 0.5;
/** Checked, travel may come this much nearer the edge (mm): its stitches cut the way's corners, rounded to 0.1 mm. */
const CHECK_SLACK = 0.25;
/** Within this of its ends (mm) travel leaves the object before and reaches the next one: it may show there, as a plain stitch between them does. */
export const HIDE_ENDS = 1;
/** Grid travel is planned on (mm). */
const CELL = 0.25;

/** An area that hides what is sewn under it, and how far inside its edge it does (its rows may stop short of it). */
export interface Hiding {
  region: Region;
  inset: number;
}

/**
 * The area of what object memory `m` sews that hides travel sewn before it, or null: a dense fill
 * whose shape is known (given or made here), as it is sewn (with the parts left out under what lies
 * on top).
 */
export function hidingOf(m: Remembered | null | undefined): Hiding | null {
  if (m && !m.read && !m.hand && !m.free && !m.applique && !m.lettering) {
    const satin = satinHiding(m);
    if (satin !== undefined) return satin;
  }
  const f = m?.fill;
  if (!m || !f || m.read || m.hand || m.free || m.applique || m.lettering || m.satin || (m.outline && m.border)) return null;
  // A fill that fades leaves rows ever further apart, down to none: what lies under it shows.
  if (isOpenPattern(f.pattern) || !HIDING.has(f.pattern) || f.deco?.fade) return null;
  if (m.parts?.some((pt) => pt.kind !== 'fill' && !pt.border)) return null;
  const gradient = f.pattern === 'gradient' || !!f.gradient;
  if (Math.max(f.spacing, gradient ? f.spacingEnd : 0) > HIDING_SPACING) return null;
  const use = geoUse(m);
  const region = use === 'band' ? bandArea(geoOf(m)!, f) : (m.region ?? (use === 'area' ? wholeArea(geoOf(m)!, 0.1, f.areaGrow ?? 0) : null));
  if (!region) return null;
  // Rows that stop short of the edge, or an area shrunk before it is filled, hide less of it.
  return { region, inset: Math.max(0, -f.edge) + Math.max(0, -(f.expand ?? 0)) };
}

/** Satin further apart than this between penetrations on one side (mm) lets a thread under it show. */
export const SATIN_HIDING_SPACING = 1;
/** Satin hides only this far inside its rails besides HIDE_INSET (mm): a way under it needs a column at least 2 mm wide. */
export const SATIN_INSET = 1 - HIDE_INSET;
/** Satin areas are rastered this fine (mm). */
const SATIN_PX = 0.2;
const satins = new WeakMap<Remembered, Hiding | null>();

/**
 * The area a dense satin of object memory `m` covers: a column between its rails, a satin line
 * along its path, a satin border along its area's edge; null when it does not hide (an E stitch, a
 * fringe, penetrations far apart); undefined when `m` is no satin.
 */
function satinHiding(m: Remembered): Hiding | null | undefined {
  const line = m.outline && m.border && m.region ? m.border : geoUse(m) === 'line' ? m.line : undefined;
  const column = !line && m.satin && m.columns?.length && !m.fill ? m.satin : undefined;
  if (!column && line?.type !== 'satin') return undefined;
  if (satins.has(m)) return satins.get(m)!;
  let out: Hiding | null = null;
  if (column) {
    if ((column.type ?? 'satin') === 'satin' && !column.fringe && column.spacing <= SATIN_HIDING_SPACING) {
      const polys = m.columns!.flat().map((r): Form => ({ paths: [{ closed: true, nodes: [...r.left, ...[...r.right].reverse()].map((q) => ({ p: q, a: q, b: q, smooth: false })) }] }));
      const region = unionOf(polys.map((f) => rasterize(f, SATIN_PX)).filter((r): r is Region => !!r));
      if (region) out = { region, inset: SATIN_INSET + Math.max(0, -column.edge) };
    }
  } else if (line && !line.fringe && (line.spacing ?? 0) <= SATIN_HIDING_SPACING) {
    const width = line.width + 2 * Math.max(0, line.pull ?? 0);
    const region = m.outline && m.border ? bandAround(m.region!, line.offset ?? 0, width) : geoOf(m) ? rasterizeStroke(geoOf(m)!, width, SATIN_PX, 'flat') : null;
    if (region) out = { region, inset: SATIN_INSET };
  }
  satins.set(m, out);
  return out;
}

/** The band `width` wide along the edge of `area`, its middle `offset` outside it (inside when negative). */
function bandAround(area: Region, offset: number, width: number): Region | null {
  const reach = Math.abs(offset) + width / 2 + 1;
  const [minX, minY] = [area.x0 * area.pxMm - reach, area.y0 * area.pxMm - reach];
  const [maxX, maxY] = [(area.x0 + area.w) * area.pxMm + reach, (area.y0 + area.h) * area.pxMm + reach];
  const x0 = Math.floor(minX / SATIN_PX);
  const y0 = Math.floor(minY / SATIN_PX);
  const w = Math.ceil(maxX / SATIN_PX) - x0;
  const h = Math.ceil(maxY / SATIN_PX) - y0;
  const mask = new Uint8Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const d = sample(area, area.sdf, (x0 + i + 0.5) * SATIN_PX, (y0 + j + 0.5) * SATIN_PX);
      // Beyond the window of its field the edge lies further than the band reaches.
      if (d < 10 && Math.abs(d - offset) <= width / 2) mask[j * w + i] = 1;
    }
  return regionOf(mask, x0, y0, w, h, SATIN_PX);
}

/** Whether point q lies under one of the hiding areas (inside it by its inset). */
function under(areas: Hiding[], q: Pt): boolean {
  for (const h of areas) if (sample(h.region, h.region.sdf, q[0], q[1]) <= -h.inset) return true;
  return false;
}

/** Whether point q lies under one of the hiding areas off its edge (as a way is planned). */
function deep(areas: Hiding[], q: Pt): boolean {
  for (const h of areas) if (sample(h.region, h.region.sdf, q[0], q[1]) <= -h.inset - HIDE_INSET) return true;
  return false;
}

/** Some area covers a point within HIDE_ENDS of `q`. */
function nearCover(areas: Hiding[], q: Pt): boolean {
  return under(areas, q) || RING.some((r) => under(areas, [q[0] + r[0] * HIDE_ENDS * 0.9, q[1] + r[1] * HIDE_ENDS * 0.9]));
}

const RING = Array.from({ length: 8 }, (_, k): Pt => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

/**
 * Whether the disc of radius `r` round q lies under the hiding areas together (checked at its
 * middle and round its edge): where two of them overlap, travel under the seam is hidden too.
 */
function hiddenAt(areas: Hiding[], q: Pt, r: number): boolean {
  return under(areas, q) && RING.every((d) => under(areas, [q[0] + d[0] * r, q[1] + d[1] * r]));
}

/**
 * Whether the thread along `pts` (the end of the object before, the travel stitches, the start of
 * the next) lies under the hiding areas all along, apart from HIDE_ENDS at either end.
 */
export function hiddenAlong(pts: Pt[], areas: Hiding[]): boolean {
  if (pts.length < 2 || !areas.length) return false;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length; i++) {
    const [p, q] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.1));
    for (let k = 0; k <= n; k++) {
      const x: Pt = [p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n];
      if (Math.hypot(x[0] - a[0], x[1] - a[1]) < HIDE_ENDS || Math.hypot(x[0] - b[0], x[1] - b[1]) < HIDE_ENDS) continue;
      if (!hiddenAt(areas, x, HIDE_INSET - CHECK_SLACK)) return false;
    }
  }
  return true;
}

/** The longest hidden way taken between two points `d` apart (as TravelGrid.way): longer, a trim is better. */
export const longestWay = (d: number) => 2 * d + 6;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** The window a hiding area's field covers (mm). */
function boxOf(r: Region): Box {
  return { minX: r.x0 * r.pxMm, minY: r.y0 * r.pxMm, maxX: (r.x0 + r.w) * r.pxMm, maxY: (r.y0 + r.h) * r.pxMm };
}

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object) => {
  let n = ids.get(o);
  if (!n) ids.set(o, (n = nextId++));
  return n;
};
const found = new Map<string, Pt[] | null>();
const FOUND = 400;

/**
 * The stitches of a hidden way from `a` (where the thread is) to `b` (where the next object
 * starts) under `areas`, without its ends (at least one stitch); null when there is none short
 * enough. Points on the 0.1 mm grid of the records, checked as sewn (hiddenAlong).
 */
export function hiddenWay(a: Pt, b: Pt, areas: Hiding[]): Pt[] | null {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const reach = longestWay(d);
  // Only ways inside the ellipse round a and b this long can be taken: its box.
  // Only ways inside the ellipse round a and b this long can be taken: its box, and of that only
  // where the hiding areas are.
  const [ax, by] = [reach / 2, Math.sqrt(Math.max(0, (reach / 2) ** 2 - (d / 2) ** 2))];
  const [c, s] = d > 0 ? [(b[0] - a[0]) / d, (b[1] - a[1]) / d] : [1, 0];
  const [hx, hy] = [Math.hypot(ax * c, by * s), Math.hypot(ax * s, by * c)];
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let box: Box = { minX: mid[0] - hx, minY: mid[1] - hy, maxX: mid[0] + hx, maxY: mid[1] + hy };
  const near = areas.filter((h) => {
    const r = boxOf(h.region);
    return r.minX <= box.maxX && box.minX <= r.maxX && r.minY <= box.maxY && box.minY <= r.maxY;
  });
  if (!near.length) return null;
  const cover = near.map((h) => boxOf(h.region)).reduce((u, r) => ({ minX: Math.min(u.minX, r.minX), minY: Math.min(u.minY, r.minY), maxX: Math.max(u.maxX, r.maxX), maxY: Math.max(u.maxY, r.maxY) }));
  box = { minX: Math.max(box.minX, cover.minX - HIDE_ENDS), minY: Math.max(box.minY, cover.minY - HIDE_ENDS), maxX: Math.min(box.maxX, cover.maxX + HIDE_ENDS), maxY: Math.min(box.maxY, cover.maxY + HIDE_ENDS) };
  // The thread leaves and reaches the objects within HIDE_ENDS of a cover, or not at all.
  if (!nearCover(near, a) || !nearCover(near, b)) return null;
  const key = `${a[0]},${a[1]};${b[0]},${b[1]};${near.map((h) => `${idOf(h.region)}:${h.inset}`).join(',')}`;
  if (found.has(key)) return found.get(key)!;
  const out = search(a, b, near, box, reach);
  found.set(key, out);
  if (found.size > FOUND) found.delete(found.keys().next().value!);
  return out;
}

function search(a: Pt, b: Pt, areas: Hiding[], box: Box, reach: number): Pt[] | null {
  // The area travel may take, on a grid of its own: under the hiding areas, off their edges, and
  // round the two ends, where the thread leaves and reaches the objects.
  const x0 = Math.floor(box.minX / CELL) - 2;
  const y0 = Math.floor(box.minY / CELL) - 2;
  const w = Math.ceil(box.maxX / CELL) + 2 - x0;
  const h = Math.ceil(box.maxY / CELL) + 2 - y0;
  const mask = new Uint8Array(w * h);
  // Each area only over its own window.
  for (const area of areas) {
    const r = boxOf(area.region);
    const [i0, i1] = [Math.max(2, Math.floor(r.minX / CELL) - x0), Math.min(w - 2, Math.ceil(r.maxX / CELL) - x0)];
    const [j0, j1] = [Math.max(2, Math.floor(r.minY / CELL) - y0), Math.min(h - 2, Math.ceil(r.maxY / CELL) - y0)];
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const k = j * w + i;
        if (!mask[k] && sample(area.region, area.region.sdf, (x0 + i + 0.5) * CELL, (y0 + j + 0.5) * CELL) <= -area.inset) mask[k] = 1;
      }
    }
  }
  // Off the edges, joined, the shortest way and its stitches: the core (core/src/model/travel.rs).
  const flat = core().hiddenSearch(mask, x0, y0, w, h, a[0], a[1], b[0], b[1], reach);
  if (!flat) return null;
  const inner: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) inner.push([flat[i], flat[i + 1]]);
  return hiddenAlong([a, ...inner, b], areas) ? inner : null;
}

const exits = new Map<string, Pt | null>();

/**
 * Where a fill on `area` best ends when the next object in its thread fills `next`: the point of
 * its edge nearest to `next` from which a hidden way can leave (under `areas`); null when there is
 * none. Its rows end near it (see FillWay.end), so the thread is where the way starts.
 */
export function exitToward(area: Region, next: Region, areas: Hiding[]): Pt | null {
  if (!areas.length) return null;
  const key = `${idOf(area)};${idOf(next)};${areas.map((h) => `${idOf(h.region)}:${h.inset}`).join(',')}`;
  if (exits.has(key)) return exits.get(key)!;
  let best: Pt | null = null;
  let bd = Infinity;
  // Its field reaches only a few mm beyond it: further away, the distance to its edge.
  const edge = outline(next).flat();
  const far = (q: Pt) => {
    let m = Infinity;
    for (const e of edge) m = Math.min(m, (e[0] - q[0]) ** 2 + (e[1] - q[1]) ** 2);
    return Math.sqrt(m);
  };
  for (const ring of outline(area)) {
    for (const q of ring) {
      const near = sample(next, next.sdf, q[0], q[1]);
      const d = near < 10 ? near : far(q);
      // Off the edge of what hides the way, by half the reach of the ends: the next object then
      // starts near enough to it too (it starts where it is nearest).
      if (d >= bd || !(deep(areas, q) || RING.some((r) => deep(areas, [q[0] + r[0] * HIDE_ENDS * 0.5, q[1] + r[1] * HIDE_ENDS * 0.5])))) continue;
      bd = d;
      best = [q[0], q[1]];
    }
  }
  // Touching or overlapping: the next one starts right there anyway.
  const out = bd > HIDE_ENDS ? best : null;
  exits.set(key, out);
  if (exits.size > FOUND) exits.delete(exits.keys().next().value!);
  return out;
}

/** The travel stitches object memory `m` starts with (see Remembered.travel). */
export const travelOf = (m: Remembered | null | undefined): number => m?.travel ?? 0;

/**
 * What object memory `m` knows with `to` travel stitches before its own in place of the ones it
 * has: its parts, underlay and border counted on from them.
 */
export function withTravel(m: Remembered, to: number): Remembered {
  const by = to - travelOf(m);
  if (!by) return m;
  const out: Remembered = { ...m };
  if (to > 0) out.travel = to;
  else delete out.travel;
  if (m.parts) out.parts = m.parts.map((pt) => ({ ...pt, end: pt.end + by }));
  if (m.under) {
    const from = (m.underFrom ?? 0) + by;
    if (from > 0) out.underFrom = from;
    else delete out.underFrom;
  }
  if (m.borderAt !== undefined) out.borderAt = m.borderAt + by;
  return out;
}

/** Tied to another object (a border, a blend's second thread, a shadow, an echo copy): trimmed apart from its neighbours. */
const tiedTo = (m: Remembered | undefined) => !!(m?.outline || m?.blendOf || m?.shadowOf || m?.echoOf);

/**
 * The stitches of the travel object `o` of `p` starts with, from the end of the one before:
 * null when they are not a way from there (no object before, a trim or color change between, a
 * first travel stitch too far from where the thread was).
 */
function travelPoints(p: Pattern, before: SewObject | undefined, o: SewObject, n: number): Pt[] | null {
  if (!before) return null;
  for (let i = before.last + 1; i < o.first; i++) if (p.cmd[i] === TRIM || p.cmd[i] === COLOR_CHANGE) return null;
  const pts: Pt[] = [[p.x[before.last] / 10, p.y[before.last] / 10]];
  for (let i = o.first; i <= o.first + n && i <= o.last; i++) {
    if (p.cmd[i] !== STITCH) return null;
    pts.push([p.x[i] / 10, p.y[i] / 10]);
  }
  if (pts.length !== n + 2) return null;
  return Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) <= TRAVEL_STITCH + 0.3 ? pts : null;
}

/** What hides travel to object k of `objs` (from the objects sewn from it on). */
function hidingAfter(k: number, hides: (Hiding | null)[]): Hiding[] {
  const out: Hiding[] = [];
  for (let j = k; j < hides.length; j++) if (hides[j]) out.push(hides[j]!);
  return out;
}

/**
 * Hidden travel in `p` where it belongs after an edit made without sewList (stitch settings,
 * borders, a design from the image mode): travel that no longer leads hidden from the object
 * before goes, and where a jump or a trim for its length between neighbours in one thread can be
 * a hidden way, it becomes one. `p` itself when all is as it should be; otherwise the design with
 * those neighbours joined anew (see sewList).
 */
export function settleTravel(p: Pattern, trimMm: number): Pattern {
  if (!p.cmd.length) return p;
  const objs = sewObjects(p);
  if (objs.length < 2) return p;
  const mem = objs.map((o) => remembered(p, o));
  const hides = mem.map((m) => hidingOf(m));
  if (!hides.some(Boolean) && !mem.some((m) => travelOf(m))) return p;
  const fresh = new Set<number>();
  // Objects sewn anew so the one before ends where a hidden way to them leaves, and those before.
  const resew = new Set<number>();
  const pairs: number[] = [];
  for (let k = 1; k < objs.length; k++) {
    const [a, o] = [objs[k - 1], objs[k]];
    const n = travelOf(mem[k]);
    if (n) {
      const pts = travelPoints(p, a, o, n);
      if (!pts || !hiddenAlong(pts, hidingAfter(k, hides))) fresh.add(k);
      continue;
    }
    if (!mem[k] || mem[k]!.cutIn || a.block !== o.block || tiedTo(mem[k - 1]) || tiedTo(mem[k])) continue;
    const from: Pt = [p.x[a.last] / 10, p.y[a.last] / 10];
    const to: Pt = [p.x[o.first] / 10, p.y[o.first] / 10];
    const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
    // A trim kept for another reason than its length stays (the objects were set apart).
    if (d <= 1 || (trimmedBetween(p, a, o) && d <= trimMm)) continue;
    const areas = hidingAfter(k, hides);
    if (hiddenWay(from, to, areas)) {
      fresh.add(k);
      continue;
    }
    // Two fills sewn as they were made (from the image mode, or before the fill on top came): sewn
    // anew, the first ends where a hidden way to the next one leaves (see sewList).
    const [sa, sb] = [specOf(p, a, mem[k - 1]), specOf(p, o, mem[k])];
    if (sa?.kind !== 'fill' || sb?.kind !== 'fill' || resew.has(k - 1)) continue;
    const exit = exitToward(sa.area, sb.area, areas);
    if (!exit || !hiddenWay(exit, nearestOn(sb.area, exit), areas)) continue;
    resew.add(k - 1).add(k);
    fresh.add(k);
    pairs.push(k);
  }
  if (!fresh.size) return p;
  // Only the way into each: an object with its ways in and out made anew takes both.
  const sewn = (pairs: number[]) => {
    const again = new Set(pairs.flatMap((k) => [k - 1, k]));
    return sewList(p, listOf(p).map((e, k) => (again.has(k) ? { ...e, sew: true } : e)), trimMm, { fresh });
  };
  const q = sewn(pairs);
  // Sewn anew only where that gives the hidden way.
  const now = sewObjects(q);
  const kept = pairs.filter((k) => travelOf(remembered(q, now[k])));
  return kept.length === pairs.length ? q : sewn(kept);
}

/**
 * After an edit by hand (handEdit.ts): travel in `p` that no longer leads hidden from the object
 * before (what hid it was edited by hand, or its own stitches were) is kept as the first stitches
 * of the object it leads to, sewn as they are. Its records stay where they are, so the editor's
 * points do not move; sewn from its shape again, the object finds its way anew. Changes what the
 * objects of `p` remember in place.
 */
export function keepShownTravel(p: Pattern): void {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  if (!mem.some((m) => travelOf(m))) return;
  const hides = mem.map((m) => hidingOf(m));
  for (let k = 1; k < objs.length; k++) {
    const n = travelOf(mem[k]);
    if (!n) continue;
    const pts = travelPoints(p, objs[k - 1], objs[k], n);
    if (pts && hiddenAlong(pts, hidingAfter(k, hides))) continue;
    // Counted in its parts and underlay from its first stitch already: only it is no longer travel.
    const { travel: _t, ...rest } = mem[k]!;
    remember(p, objs[k], rest);
  }
}

/** The point of `area`'s edge nearest to `q`. */
function nearestOn(area: Region, q: Pt): Pt {
  let best = q;
  let bd = Infinity;
  for (const ring of outline(area))
    for (const e of ring) {
      const d = (e[0] - q[0]) ** 2 + (e[1] - q[1]) ** 2;
      if (d < bd) [bd, best] = [d, [e[0], e[1]]];
    }
  return best;
}

/**
 * `p` without the hidden travel the objects `which` (indices) start with: each comes to its own
 * first stitch by a jump again, after a trim when further than `trimMm`. For an edit that sews
 * them anew in its own way (restitch.ts); settleTravel finds their ways again after it.
 */
export function dropTravel(p: Pattern, which: ReadonlySet<number>, trimMm: number): Pattern {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const bodyAt = new Map<number, number>();
  for (const o of objs) if (which.has(o.index) && travelOf(mem[o.index])) bodyAt.set(o.first, o.first + travelOf(mem[o.index]));
  if (!bodyAt.size) return p;
  const x: number[] = [];
  const y: number[] = [];
  const cmd: number[] = [];
  // The number each stitch of `p` has now (-1: gone).
  const num = new Int32Array(p.cmd.length).fill(-1);
  let n = 0;
  for (let i = 0; i < p.cmd.length; ) {
    const body = bodyAt.get(i);
    if (body !== undefined) {
      const end = x.length - 1;
      if (end >= 0 && Math.hypot(p.x[body] - x[end], p.y[body] - y[end]) / 10 > trimMm) {
        x.push(x[end]);
        y.push(y[end]);
        cmd.push(TRIM);
      }
      x.push(p.x[body]);
      y.push(p.y[body]);
      cmd.push(JUMP);
      i = body;
      continue;
    }
    x.push(p.x[i]);
    y.push(p.y[i]);
    cmd.push(p.cmd[i]);
    if (p.cmd[i] === STITCH) num[i] = n++;
    i++;
  }
  const q = withRecords(p, Int32Array.from(x), Int32Array.from(y), Uint8Array.from(cmd));
  const records: number[] = [];
  for (let i = 0; i < q.cmd.length; i++) if (q.cmd[i] === STITCH) records.push(i);
  const placed: PlacedEntry[] = objs.map((o) => {
    const m = mem[o.index];
    const first = num[bodyAt.get(o.first) ?? o.first];
    const last = num[o.last];
    return { id: o.id, first, last, key: stitchKey(q, records[first], records[last]), at: [q.x[records[first]], q.y[records[first]]], ...(m ? { memory: bodyAt.has(o.first) ? withTravel(m, 0) : m } : {}) };
  });
  setObjects(q, placed, tableOf(p).next);
  return q;
}

/**
 * The joins of `p` (as listed by transitions) with the hidden ones among them: each hidden way as a
 * transition of its own (`hidden`), from the last stitch of the object before to the first of the
 * object it leads to, after its travel; and joins trimmed by hand marked as such (`byHand`).
 * In sewing order.
 */
export function withHiddenJoins(p: Pattern, list: Transition[]): Transition[] {
  if (!p.cmd.length) return list;
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const hidden: Transition[] = [];
  const blocks = blockIndex(p);
  objs.forEach((o, k) => {
    const n = travelOf(mem[k]);
    const a = objs[k - 1];
    if (!n || !a) return;
    let len = 0;
    for (let i = a.last; i < o.first + n; i++) len += Math.hypot(p.x[i + 1] - p.x[i], p.y[i + 1] - p.y[i]) / 10;
    hidden.push({ from: a.last, to: o.first + n, lengthMm: len, trimmed: false, tieOff: 0, tieIn: 0, block: blocks[o.first], hidden: true });
  });
  const byHand = new Set(objs.filter((_, k) => mem[k]?.cutIn).map((o) => o.first));
  const marked = list.map((t): Transition => (t.trimmed && byHand.has(objectStart(objs, t.to)) ? { ...t, byHand: true } : t));
  if (!hidden.length) return byHand.size ? marked : list;
  return [...marked, ...hidden].sort((x, y) => x.from - y.from);
}

/** The first record of the object record `i` belongs to (-1: none). */
function objectStart(objs: SewObject[], i: number): number {
  let lo = 0;
  let hi = objs.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (objs[m].last < i) lo = m + 1;
    else if (objs[m].first > i) hi = m - 1;
    else return objs[m].first;
  }
  return -1;
}

/** Indices of the objects joins `list` lead to from the object before (jumps inside an object left out). */
export function joinedObjects(p: Pattern, list: Transition[]): number[] {
  const objs = sewObjects(p);
  const at = new Map(objs.map((o) => [o.first, o.index]));
  return list.flatMap((t) => {
    const k = at.get(objectStart(objs, t.to));
    return k === undefined || t.from >= objs[k].first ? [] : [k];
  });
}

/** A new version of `p` whose objects `which` (indices) are trimmed from the one before by hand, or no longer. */
function markedCut(p: Pattern, which: readonly number[], on: boolean): Pattern {
  const objs = sewObjects(p);
  const change = which.filter((k) => objs[k] && remembered(p, objs[k]) && !!remembered(p, objs[k])!.cutIn !== on);
  if (!change.length) return p;
  return relearn(p, (q) => {
    const now = sewObjects(q);
    for (const k of change) {
      const m = { ...remembered(q, now[k])! };
      if (on) m.cutIn = true;
      else delete m.cutIn;
      remember(q, now[k], m);
    }
  });
}

/**
 * Trim and tie by hand before the objects `which` (indices): hidden travel to them goes, the thread
 * is tied off, trimmed and tied in, and it stays so whatever is changed later (Remembered.cutIn).
 */
export function cutJoins(p: Pattern, which: readonly number[], trimMm: number): Pattern {
  const ways = which.filter((k) => travelOf(remembered(p, sewObjects(p)[k])));
  // Trimmed at any length: the thread is cut here because it was asked to.
  const q = markedCut(ways.length ? dropTravel(p, new Set(ways), 0) : p, which, true);
  const want = new Set(which);
  const joins = transitions(q).filter((t, i, all) => want.has(joinedObjects(q, [t])[0] ?? -1) && all.indexOf(t) === i);
  const r = joins.length ? setTrims(q, joins, true) : q;
  return settleTravel(r, trimMm);
}

/**
 * The objects `which` (indices) no longer trimmed from the one before by hand: carried across by a
 * jump (`carry`), or hidden again where a way under what is sewn later can be found.
 */
export function freeJoins(p: Pattern, which: readonly number[], trimMm: number, carry: boolean): Pattern {
  let q = markedCut(p, which, false);
  if (carry) {
    const want = new Set(which);
    const joins = transitions(q).filter((t) => want.has(joinedObjects(q, [t])[0] ?? -1));
    if (joins.length) q = setTrims(q, joins, false);
  }
  return settleTravel(q, trimMm);
}

/**
 * The joins `picked` (as listed by withHiddenJoins) cut and tied by hand, carried across by a jump,
 * or hidden again, as the jumps panel asks. Null: `hide` found no way under what is sewn later for
 * one of them (it stays trimmed).
 */
export function joinsAs(p: Pattern, picked: Transition[], how: 'cut' | 'carry' | 'hide', trimMm: number): Pattern | null {
  const plain = picked.filter((t) => !t.hidden);
  if (how === 'cut') {
    // Trimmed between two objects by hand, it stays so (a hidden way there goes).
    const between = joinedObjects(p, picked);
    const q = setTrims(p, plain, true);
    return between.length ? cutJoins(q, between, trimMm) : q;
  }
  if (how === 'carry') return freeJoins(setTrims(p, plain, false), joinedObjects(p, plain), trimMm, false);
  // Hidden again: only where a way under what is sewn later is found, else it stays trimmed.
  const which = joinedObjects(p, picked);
  const q = freeJoins(p, which, trimMm, true);
  const now = sewObjects(q);
  return which.every((k) => travelOf(remembered(q, now[k]))) ? q : null;
}
