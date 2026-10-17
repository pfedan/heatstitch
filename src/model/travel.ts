import { pathLength, TRAVEL_STITCH, TravelGrid } from '../digitize/fill';
import { outline, sample, type Region } from '../digitize/region';
import { runStitch } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import { regionOf } from '../shape/rasterize';
import { withRecords } from './edit';
import { bandArea, geoOf, geoUse } from './geo';
import { wholeArea } from './knockout';
import { setObjects, sewObjects, stitchKey, tableOf, trimmedBetween, type PlacedEntry, type SewObject } from './objects';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern } from './pattern';
import { isOpenPattern, remembered, type FillPattern, type Remembered } from './restitch';
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
  const f = m?.fill;
  if (!m || !f || m.read || m.hand || m.free || m.applique || m.lettering || m.satin || (m.outline && m.border)) return null;
  if (isOpenPattern(f.pattern) || !HIDING.has(f.pattern)) return null;
  if (m.parts?.some((pt) => pt.kind !== 'fill' && !pt.border)) return null;
  const gradient = f.pattern === 'gradient' || !!f.gradient;
  if (Math.max(f.spacing, gradient ? f.spacingEnd : 0) > HIDING_SPACING) return null;
  const use = geoUse(m);
  const region = use === 'band' ? bandArea(geoOf(m)!, f) : (m.region ?? (use === 'area' ? wholeArea(geoOf(m)!, 0.1, f.areaGrow ?? 0) : null));
  if (!region) return null;
  // Rows that stop short of the edge, or an area shrunk before it is filled, hide less of it.
  return { region, inset: Math.max(0, -f.edge) + Math.max(0, -(f.expand ?? 0)) };
}

/** Whether point q lies under one of the hiding areas (inside it by its inset). */
function under(areas: Hiding[], q: Pt): boolean {
  for (const h of areas) if (sample(h.region, h.region.sdf, q[0], q[1]) <= -h.inset) return true;
  return false;
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
  const half = reach / 2;
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const box: Box = { minX: mid[0] - half, minY: mid[1] - half, maxX: mid[0] + half, maxY: mid[1] + half };
  const near = areas.filter((h) => {
    const r = boxOf(h.region);
    return r.minX <= box.maxX && box.minX <= r.maxX && r.minY <= box.maxY && box.minY <= r.maxY;
  });
  if (!near.length) return null;
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
  for (let j = 2; j < h - 2; j++) {
    for (let i = 2; i < w - 2; i++) if (under(areas, [(x0 + i + 0.5) * CELL, (y0 + j + 0.5) * CELL])) mask[j * w + i] = 1;
  }
  const all = regionOf(mask, x0, y0, w, h, CELL);
  if (!all) return null;
  const ends = HIDE_ENDS * 0.9;
  for (let j = 2; j < h - 2; j++) {
    for (let i = 2; i < w - 2; i++) {
      const q: Pt = [(x0 + i + 0.5) * CELL, (y0 + j + 0.5) * CELL];
      const k = j * w + i;
      mask[k] = all.sdf[k] <= -HIDE_INSET || Math.hypot(q[0] - a[0], q[1] - a[1]) < ends || Math.hypot(q[0] - b[0], q[1] - b[1]) < ends ? 1 : 0;
    }
  }
  const region = regionOf(mask, x0, y0, w, h, CELL);
  if (!region) return null;
  const grid = new TravelGrid(region);
  const path = grid.path(a, b, false);
  if (!path || pathLength(path) > reach) return null;
  const pts = runStitch(path, TRAVEL_STITCH, 0.1).map((q): Pt => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]);
  let inner = pts.slice(1, -1);
  // A way of one stitch still gets a point of its own: the object it leads to knows its travel by its stitches.
  if (!inner.length) inner = [[Math.round(((a[0] + b[0]) / 2) * 10) / 10, Math.round(((a[1] + b[1]) / 2) * 10) / 10]];
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
      if (d >= bd || !(under(areas, q) || RING.some((r) => under(areas, [q[0] + r[0] * HIDE_ENDS * 0.9, q[1] + r[1] * HIDE_ENDS * 0.9])))) continue;
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
    if (!mem[k] || a.block !== o.block || tiedTo(mem[k - 1]) || tiedTo(mem[k])) continue;
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
