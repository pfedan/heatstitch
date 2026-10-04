import type { KeptShape } from '../digitize/digitize';
import { fillRegion, type FillParams } from '../digitize/fill';
import { contourField, fieldFill, stitchField } from '../digitize/flow';
import { spiralFill } from '../digitize/spiral';
import { coverage } from '../digitize/measure';
import { sample, signedField, type Region } from '../digitize/region';
import { runStitch, TOLERANCE } from '../digitize/run';
import { pairs, satinStitches, underlay as satinUnderlay, type Column } from '../digitize/satin';
import type { Pt } from '../digitize/skeleton';
import { distanceInside, distanceToSeeds } from '../image/edt';
import { tidy, withRecords } from './edit';
import { joinsIn, restoreJoin, stitchKey, type ObjectKind, type SewObject } from './objects';
import { JUMP, STITCH, TRIM, type Pattern } from './pattern';
import { SATIN, TIE_STITCH } from './sequence';

/**
 * New stitches for the objects of a design, with other settings: density, angle, stitch length,
 * underlay, edges. The shape comes from the stitches themselves (any file has them): the rows of a
 * fill are drawn thick enough to touch and closed, which gives the area they cover with its edge
 * at the row ends; a satin column's two rails are its penetrations, left and right in turn; a
 * running stitch is its path. That is what commercial software calls stitch recognition, and like
 * there the result follows the original closely but not exactly.
 *
 * An object is cut off before and after (see objects.ts), so only its own stitches change. Inside
 * an object the parts of other kinds stay as they were (a satin border sewn with a fill without a
 * trim keeps its stitches when the fill changes).
 */

/**
 * How the rows of a fill run: straight (tatami), straight with a spacing that changes across the
 * shape (gradient), along the outline (contour), as one line winding to the middle (spiral), or
 * with the directions and curves of the rows sewn now (follow).
 */
export type FillPattern = 'tatami' | 'gradient' | 'contour' | 'spiral' | 'follow';

export interface FillSettings {
  pattern: FillPattern;
  /** Row spacing (mm); for a gradient where it starts. */
  spacing: number;
  /** Gradient: spacing on the far side (mm). */
  spacingEnd: number;
  /** Tatami: shift of the needle points from row to row (fraction of a stitch; 0 at random). */
  offset: number;
  /** Direction of the rows, degrees 0 to 180 (tatami and gradient). */
  angle: number;
  /** Stitch length (mm). */
  stitch: number;
  underlay: boolean;
  /** Rows reach this much further (+) or less far (-) than now at both ends (mm). */
  edge: number;
  /** Largest distance of a curved row's stitches from its line (mm); see TOLERANCE. */
  tolerance: number;
}

export interface SatinSettings {
  /** Distance between penetrations on one side (mm). */
  spacing: number;
  /** Wider (+) or narrower (-) on each side than now (mm). */
  edge: number;
  short: boolean;
  underlay: boolean;
  /** Largest distance of the underlay's stitches from the column's middle (mm). */
  tolerance: number;
}

export interface RunSettings {
  stitch: number;
  /** Every stitch sewn three times (bean stitch). */
  triple: boolean;
  /** Largest distance of a stitch from the path (mm): stitches get shorter on curves. */
  tolerance: number;
}

export type Settings = { kind: 'fill'; s: FillSettings } | { kind: 'satin'; s: SatinSettings } | { kind: 'run'; s: RunSettings };

/** A stretch of one kind inside an object: stitch points `s` to `e` (records; jumps may lie between). */
export interface Part {
  kind: ObjectKind;
  s: number;
  e: number;
}

/** What an object is made of: its parts in sewing order, and the area its fill parts cover. */
export interface Analysis {
  parts: Part[];
  /** Area of the fill parts (their stitches drawn thick, closed and opened), or null without fill. */
  fill: Region | null;
}

/** Fill rows touch when drawn this thick (mm on each side); travel lines vanish when opened by `OPEN`. */
const REACH = 0.3;
/** Highest density allowed for curved rows, in times the nominal (where rows meet). */
const CONTOUR_PEAK = 3;
/** Half width of the band along the old thread that new travel may follow (mm). */
const TRAVEL_REACH = 0.5;
const OPEN = 0.36;

/**
 * Splits an object into fill, satin and running stitch. Satin comes from the recognizer (its
 * columns are reliable); for the rest, the area covered by the object's other stitches is traced
 * (thin lines like travel and outlines drop out of it), and every stitch inside that area is fill:
 * rows, underlay and travel under the rows. What lies outside is running stitch of its own.
 */
// What objects were last sewn with ------------------------------------------------------------

/** The two sides of a satin column: its penetrations, left and right in turn (mm). */
export interface Rails {
  left: Pt[];
  right: Pt[];
}

/**
 * The shape of an object and its settings, kept for the next edit: the fill area and fill
 * settings, the rails of its satin columns (per satin part) and satin settings. The next edit
 * starts from these instead of reading them again from the stitches of the last one, which would
 * let the shape drift a little with every change.
 */
export interface Remembered {
  region: Region | null;
  fill?: FillSettings;
  satin?: SatinSettings;
  columns?: Rails[][];
}

/**
 * Objects given new stitches here, by their stitches: the next edit starts from the exact shape
 * and the chosen pattern instead of recognizing them again from the stitches (an open gradient
 * or a spiral would not give its shape back as well as dense rows do).
 */
const memory = new Map<string, Remembered>();
const MEMORY_SIZE = 400;

/** A key for an object's stitches. */
export const objectKey = (p: Pattern, o: SewObject): string => stitchKey(p, o.first, o.last);

export function remember(p: Pattern, o: SewObject, r: Remembered): void {
  rememberKey(objectKey(p, o), r);
}

function rememberKey(key: string, r: Remembered): void {
  memory.delete(key);
  memory.set(key, r);
  if (memory.size > MEMORY_SIZE) memory.delete(memory.keys().next().value!);
}

export function remembered(p: Pattern, o: SewObject): Remembered | undefined {
  return memory.get(objectKey(p, o));
}

/**
 * A remembered object as it is stored: the shape as its pixels only (the rest is rebuilt from
 * them). Entries with `join` are sections instead: whether they continue the object before.
 */
export interface StoredObject {
  key: string;
  region: { x0: number; y0: number; w: number; h: number; pxMm: number; mask: Uint8Array; areaMm2: number } | null;
  fill?: FillSettings;
  satin?: SatinSettings;
  /** Rails per satin part and column, as flat x, y lists. */
  columns?: { left: number[]; right: number[] }[][];
  join?: boolean;
}

/** What is remembered about the objects of `p`, to store it with the file. */
export function rememberedIn(p: Pattern, objects: SewObject[]): StoredObject[] {
  const out: StoredObject[] = [];
  for (const o of objects) {
    const key = objectKey(p, o);
    const r = memory.get(key);
    if (!r) continue;
    const g = r.region;
    out.push({
      key,
      region: g && { x0: g.x0, y0: g.y0, w: g.w, h: g.h, pxMm: g.pxMm, mask: g.mask, areaMm2: g.areaMm2 },
      ...(r.fill ? { fill: { ...r.fill } } : {}),
      ...(r.satin ? { satin: { ...r.satin } } : {}),
      ...(r.columns ? { columns: r.columns.map((part) => part.map((c) => ({ left: c.left.flat(), right: c.right.flat() }))) } : {}),
    });
  }
  for (const j of joinsIn(p)) out.push({ key: j.key, region: null, join: j.join });
  return out;
}

const PATTERNS: FillPattern[] = ['tatami', 'gradient', 'contour', 'spiral', 'follow'];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isFill(f: unknown): f is FillSettings {
  const s = f as FillSettings | null;
  return (
    !!s &&
    PATTERNS.includes(s.pattern) &&
    [s.spacing, s.spacingEnd, s.offset, s.angle, s.stitch, s.edge].every(finite) &&
    (s.tolerance === undefined || finite(s.tolerance)) &&
    typeof s.underlay === 'boolean'
  );
}

function isSatin(f: unknown): f is SatinSettings {
  const s = f as SatinSettings | null;
  return !!s && [s.spacing, s.edge].every(finite) && typeof s.short === 'boolean' && typeof s.underlay === 'boolean' && (s.tolerance === undefined || finite(s.tolerance));
}

/** Stored rails back as points, or undefined when malformed. */
function railsFrom(list: unknown): Rails[][] | undefined {
  if (!Array.isArray(list)) return undefined;
  const pts = (v: unknown): Pt[] | null => {
    if (!Array.isArray(v) || v.length % 2 || v.length < 4 || !v.every(finite)) return null;
    const out: Pt[] = [];
    for (let i = 0; i < v.length; i += 2) out.push([v[i], v[i + 1]]);
    return out;
  };
  const out: Rails[][] = [];
  for (const part of list) {
    if (!Array.isArray(part)) return undefined;
    const cols: Rails[] = [];
    for (const c of part) {
      const left = pts(c?.left);
      const right = pts(c?.right);
      if (!left || !right) return undefined;
      cols.push({ left, right });
    }
    out.push(cols);
  }
  return out;
}

/** A region from its pixels (null when malformed). */
function regionFrom(g: NonNullable<StoredObject['region']>): Region | null {
  const { x0, y0, w, h, pxMm, mask, areaMm2 } = g;
  if (![x0, y0, w, h, pxMm, areaMm2].every(finite) || !(mask instanceof Uint8Array)) return null;
  if (w < 1 || h < 1 || pxMm <= 0 || mask.length !== w * h) return null;
  const sdf = signedField(mask, w, h, pxMm);
  return { label: 0, x0, y0, w, h, pxMm, mask, inside: distanceInside(mask, w, h), sdf, sdfBase: sdf, areaMm2 };
}

/**
 * Remembers the exact areas the Image mode filled (`shapes`, by object, as `starts`: the number
 * of each object's first stitch), so editing them starts from those instead of the stitches.
 */
export function rememberShapes(p: Pattern, objs: SewObject[], starts: number[], shapes: (KeptShape | undefined)[]): void {
  const at = new Map<number, SewObject>();
  let n = 0;
  let k = 0;
  for (let i = 0; i < p.cmd.length && k < objs.length; i++) {
    if (i === objs[k].first) at.set(n, objs[k++]);
    if (p.cmd[i] === STITCH) n++;
  }
  starts.forEach((s, j) => {
    const shape = shapes[j];
    const o = at.get(s);
    if (!shape || !o) return;
    const region = regionFrom(shape);
    if (region) remember(p, o, { region, fill: { ...shape.fill } });
  });
}

/** Remembers stored objects again (from storage or a project file); malformed entries are skipped. */
export function restoreRemembered(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const e of list as StoredObject[]) {
    if (typeof e?.key === 'string' && typeof e.join === 'boolean') {
      restoreJoin(e.key, e.join);
      n++;
      continue;
    }
    if (typeof e?.key !== 'string' || (e.fill !== undefined && !isFill(e.fill))) continue;
    const region = e.region ? regionFrom(e.region) : null;
    if (e.region && !region) continue;
    // Files from before the tolerance existed have none.
    const r: Remembered = { region, fill: e.fill && { ...e.fill, tolerance: e.fill.tolerance ?? TOLERANCE } };
    if (isSatin(e.satin)) r.satin = { ...e.satin, tolerance: e.satin.tolerance ?? TOLERANCE };
    const columns = railsFrom(e.columns);
    if (columns) r.columns = columns;
    rememberKey(e.key, r);
    n++;
  }
  return n;
}

/**
 * How far the fill area of an object can be trusted: `kept` when it is the shape the object was
 * sewn with here, `good` when the rows recognized cover it closely, `approximate` when they are too
 * open to close into an area or leave parts of it uncovered (its edges are a guess).
 */
export type ShapeTrust = 'kept' | 'good' | 'approximate';

/** Rows further apart than this do not close into an area reliably (mm). */
const OPEN_ROWS = 0.6;
/** Share of the traced area the old rows must cover. */
const COVERED = 0.93;

export function shapeTrust(p: Pattern, o: SewObject, a: Analysis, spacing: number): ShapeTrust {
  if (!a.fill) return 'approximate';
  if (remembered(p, o)?.region === a.fill) return 'kept';
  if (spacing > OPEN_ROWS) return 'approximate';
  const runs: Pt[][] = [];
  for (const pt of a.parts) {
    if (pt.kind !== 'fill') continue;
    let run: Pt[] = [];
    for (let i = pt.s; i <= pt.e; i++) {
      if (p.cmd[i] !== STITCH) continue;
      if (i > pt.s && p.cmd[i - 1] !== STITCH && run.length) {
        runs.push(run);
        run = [];
      }
      run.push(pt10(p, i));
    }
    if (run.length) runs.push(run);
  }
  return coverage(a.fill, runs, Math.max(0.3, spacing * 0.75)) >= COVERED ? 'good' : 'approximate';
}

export function analyze(p: Pattern, o: SewObject, kinds: Uint8Array, known = remembered(p, o)): Analysis {
  const idx: number[] = [];
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) idx.push(i);
  if (idx.length < 3) return { parts: [{ kind: o.kind === 'fill' ? 'run' : o.kind, s: o.first, e: o.last }], fill: null };
  // A stitch is the segment from the point before to point k.
  const sewnSeg = (k: number) => k > 0 && p.cmd[idx[k] - 1] === STITCH;
  const len = idx.map((i, k) => (sewnSeg(k) ? seg(p, i) : 0));
  const W = 8;
  const satin = idx.map((_, k) => {
    let sat = 0;
    let all = 0;
    for (let j = Math.max(1, k - W); j <= Math.min(idx.length - 1, k + W); j++) {
      all += len[j];
      if (kinds[idx[j]] === SATIN) sat += len[j];
    }
    return kinds[idx[k]] === SATIN || sat >= all * 0.5;
  });
  const others: number[] = [];
  for (let k = 1; k < idx.length; k++) if (sewnSeg(k) && !satin[k]) others.push(idx[k]);
  const region = known?.region ?? (others.length > 4 ? traceRegion(p, others, REACH, OPEN) : null);
  const inFill = (k: number) => {
    if (!region) return false;
    const i = idx[k];
    const mx = (p.x[i] + p.x[i - 1]) / 20;
    const my = (p.y[i] + p.y[i - 1]) / 20;
    return sample(region, region.sdfBase, mx, my) < 0.15 && sample(region, region.sdfBase, p.x[i] / 10, p.y[i] / 10) < 0.25;
  };
  const kindAt: ObjectKind[] = idx.map((_, k) => (k === 0 ? 'run' : satin[k] ? 'satin' : inFill(k) ? 'fill' : 'run'));
  kindAt[0] = kindAt[1] ?? 'run';
  const raw: { kind: ObjectKind; a: number; b: number }[] = [];
  for (let k = 1; k < idx.length; k++) {
    const last = raw[raw.length - 1];
    if (last && last.kind === kindAt[k]) last.b = k;
    else raw.push({ kind: kindAt[k], a: k - 1, b: k });
  }
  // Stretches of a few stitches (locks, a corner) go with the stretch before (or after, at the start).
  const MIN = 6;
  const merged: typeof raw = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && (last.kind === r.kind || r.b - r.a < MIN)) last.b = r.b;
    else if (last && merged.length === 1 && last.b - last.a < MIN) {
      last.kind = r.kind;
      last.b = r.b;
    } else merged.push({ ...r });
  }
  // Running stitch under a satin column (its underlay, also when trimmed off from it) is part of it.
  const satinSegs: number[] = [];
  for (let k = 1; k < idx.length; k++) if (kindAt[k] === 'satin' && sewnSeg(k)) satinSegs.push(idx[k]);
  const column = satinSegs.length > 4 ? traceRegion(p, satinSegs, REACH) : null;
  if (column) {
    for (const r of merged) {
      if (r.kind !== 'run') continue;
      let inside = 0;
      for (let k = r.a; k <= r.b; k++) if (sample(column, column.sdfBase, p.x[idx[k]] / 10, p.y[idx[k]] / 10) < 0.2) inside++;
      if (inside >= (r.b - r.a + 1) * 0.8) r.kind = 'satin';
    }
  }
  const parts: Part[] = [];
  for (const r of merged) {
    const last = parts[parts.length - 1];
    if (last && last.kind === r.kind) last.e = idx[r.b];
    else parts.push({ kind: r.kind, s: idx[r.a], e: idx[r.b] });
  }
  return { parts, fill: parts.some((pt) => pt.kind === 'fill') ? region : null };
}

const seg = (p: Pattern, i: number) => Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;

function percentile(v: number[], q: number): number {
  if (!v.length) return 0;
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// Shapes from fill stitches ---------------------------------------------------------------------

const MARGIN = 4;

/**
 * The area the stitches `segs` (records; each the stitch from the record before) cover: drawn
 * `reach` mm thick and closed by as much, so rows up to 2 * reach apart merge and the edge lies at
 * the row ends; then opened by `open`, which removes lines narrower than 2 * open (travel, outlines).
 * Without `close` the lines just stay `reach` thick (where the thread went).
 */
export function traceRegion(p: Pattern, segs: number[], reach: number, open = 0, close = true): Region | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of segs) {
    for (const j of [i - 1, i]) {
      minX = Math.min(minX, p.x[j]);
      maxX = Math.max(maxX, p.x[j]);
      minY = Math.min(minY, p.y[j]);
      maxY = Math.max(maxY, p.y[j]);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const wMm = (maxX - minX) / 10 + 2 * reach;
  const hMm = (maxY - minY) / 10 + 2 * reach;
  const pxMm = Math.max(0.05, Math.sqrt((wMm * hMm) / 1.5e6), reach / 5);
  const x0 = Math.floor((minX / 10 - reach) / pxMm) - MARGIN;
  const y0 = Math.floor((minY / 10 - reach) / pxMm) - MARGIN;
  const w = Math.ceil(wMm / pxMm) + 2 * MARGIN + 2;
  const h = Math.ceil(hMm / pxMm) + 2 * MARGIN + 2;
  const seed = new Uint8Array(w * h);
  const put = (xMm: number, yMm: number) => {
    const x = Math.floor(xMm / pxMm) - x0;
    const y = Math.floor(yMm / pxMm) - y0;
    if (x >= 0 && y >= 0 && x < w && y < h) seed[y * w + x] = 1;
  };
  for (const i of segs) {
    const ax = p.x[i - 1] / 10;
    const ay = p.y[i - 1] / 10;
    const bx = p.x[i] / 10;
    const by = p.y[i] / 10;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (pxMm / 2)));
    for (let k = 0; k <= n; k++) put(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
  }
  // Pixel centers sit half a pixel off the seeds' corners: measure from the centers.
  const r = reach / pxMm;
  const near = distanceToSeeds(seed, w, h);
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < outside.length; i++) outside[i] = near[i] <= r ? 0 : 1;
  const far = distanceToSeeds(outside, w, h);
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = (close ? far[i] > r : near[i] <= r) ? 1 : 0;
  if (open > 0) {
    const o = open / pxMm;
    const toOut = distanceToSeeds(Uint8Array.from(mask, (m) => 1 - m), w, h);
    const core = Uint8Array.from(toOut, (d) => (d > o ? 1 : 0));
    const toCore = distanceToSeeds(core, w, h);
    mask = Uint8Array.from(toCore, (d) => (d <= o ? 1 : 0));
  }
  let area = 0;
  for (const m of mask) area += m;
  if (!area) return null;
  const sdf = signedField(mask, w, h, pxMm);
  return { label: 0, x0, y0, w, h, pxMm, mask, inside: distanceInside(mask, w, h), sdf, sdfBase: sdf, areaMm2: area * pxMm * pxMm };
}

// Measuring what an object has now ------------------------------------------------------------

/**
 * Fill settings as the stitches have them: the rows are the long stitches of the fill parts; their
 * main direction is the angle (doubled-angle mean), the distance between neighbouring parallel
 * rows the spacing, their long stitches the stitch length. Underlay is running stitch in the fill
 * area before the first row.
 */
export function measureFill(p: Pattern, a: Analysis): FillSettings {
  const segs: { i: number; l: number; a: number }[] = [];
  for (const pt of a.parts) {
    if (pt.kind !== 'fill') continue;
    for (let i = pt.s + 1; i <= pt.e; i++) {
      if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
      const l = seg(p, i);
      if (l >= 0.8) segs.push({ i, l, a: Math.atan2(p.y[i] - p.y[i - 1], p.x[i] - p.x[i - 1]) });
    }
  }
  let sx = 0;
  let sy = 0;
  for (const g of segs) {
    sx += g.l * g.l * Math.cos(2 * g.a);
    sy += g.l * g.l * Math.sin(2 * g.a);
  }
  const main = Math.atan2(sy, sx) / 2;
  const rows = segs.filter((g) => Math.abs(Math.cos(g.a - main)) > Math.cos((12 * Math.PI) / 180));
  // Distance to the nearest parallel row beside each row (in the frame of the main direction).
  const ex = Math.cos(main);
  const ey = Math.sin(main);
  const fr = rows
    .map((g) => {
      const ax = p.x[g.i - 1] / 10;
      const ay = p.y[g.i - 1] / 10;
      const bx = p.x[g.i] / 10;
      const by = p.y[g.i] / 10;
      const u0 = ax * ex + ay * ey;
      const u1 = bx * ex + by * ey;
      return { lo: Math.min(u0, u1), hi: Math.max(u0, u1), v: ((ay + by) / 2) * ex - ((ax + bx) / 2) * ey };
    })
    .sort((x, y) => x.v - y.v);
  const gaps: number[] = [];
  for (let k = 0; k < fr.length; k++) {
    for (let j = k + 1; j < fr.length && fr[j].v - fr[k].v < 1.6; j++) {
      const d = fr[j].v - fr[k].v;
      if (d < 0.12) continue;
      if (fr[j].lo < fr[k].hi - 0.3 && fr[k].lo < fr[j].hi - 0.3) {
        gaps.push(d);
        break;
      }
    }
  }
  const spacing = Math.min(1.5, Math.max(0.15, percentile(gaps, 0.5) || 0.4));
  let firstRow = Infinity;
  for (const g of rows) firstRow = Math.min(firstRow, g.i);
  let rowThread = 0;
  for (const g of rows) rowThread += g.l;
  let before = 0;
  for (const pt of a.parts) {
    if (pt.kind !== 'fill') continue;
    for (let i = pt.s + 1; i <= Math.min(pt.e, firstRow - 1); i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) before += seg(p, i);
  }
  const angle = Math.round(((((main * 180) / Math.PI) % 180) + 180) % 180);
  // Rows that do not keep one direction are curved or turn from patch to patch (fills that follow an image, several angles).
  let all = 0;
  for (const g of segs) all += g.l;
  const curved = segs.length > 10 && rowThread < all * 0.75;
  const sp = Math.round(spacing * 100) / 100;
  return {
    pattern: curved ? 'follow' : 'tatami',
    spacing: sp,
    spacingEnd: Math.min(1.2, Math.round(sp * 2.5 * 100) / 100),
    offset: 0.25,
    angle: angle === 180 ? 0 : angle,
    stitch: Math.round((percentile(rows.map((g) => g.l), 0.8) || 4) * 10) / 10,
    underlay: before > rowThread * 0.06,
    edge: 0,
    tolerance: TOLERANCE,
  };
}

/** Satin columns of a part: runs of satin stitches alternating between two rails. */
function satinColumns(p: Pattern, pt: Part, kinds: Uint8Array): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = [];
  for (let i = pt.s + 1; i <= pt.e; i++) {
    if (kinds[i] !== SATIN || p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    let j = i;
    while (j + 1 <= pt.e && kinds[j + 1] === SATIN && p.cmd[j + 1] === STITCH) j++;
    if (j - i >= 3) out.push({ s: i - 1, e: j });
    i = j;
  }
  return out;
}

export function measureSatin(p: Pattern, pt: Part, kinds: Uint8Array): SatinSettings {
  const steps: number[] = [];
  let satin = 0;
  let other = 0;
  for (const c of satinColumns(p, pt, kinds)) for (let i = c.s + 2; i <= c.e; i++) steps.push(Math.hypot(p.x[i] - p.x[i - 2], p.y[i] - p.y[i - 2]) / 10);
  for (let i = pt.s + 1; i <= pt.e; i++) {
    if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    if (kinds[i] === SATIN) satin += seg(p, i);
    else if (kinds[i] !== TIE_STITCH) other += seg(p, i);
  }
  const spacing = Math.round(Math.min(1.5, Math.max(0.15, percentile(steps, 0.5) || 0.4)) * 100) / 100;
  return { spacing, edge: 0, short: true, underlay: other > satin * 0.03, tolerance: TOLERANCE };
}

export function measureRun(p: Pattern, pt: Part): RunSettings {
  const lens: number[] = [];
  let back = 0;
  for (let i = pt.s + 1; i <= pt.e; i++) {
    if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    lens.push(seg(p, i));
    if (i >= 2 && p.x[i] === p.x[i - 2] && p.y[i] === p.y[i - 2]) back++;
  }
  return { stitch: Math.round((percentile(lens, 0.6) || 2.5) * 10) / 10, triple: back > lens.length * 0.4, tolerance: TOLERANCE };
}

// New stitches -----------------------------------------------------------------------------------

const pt10 = (p: Pattern, i: number): Pt => [p.x[i] / 10, p.y[i] / 10];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Rails of a satin column from its penetrations, filled in between so the spacing can get finer. */
function railsOf(p: Pattern, c: { s: number; e: number }): Rails | null {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = c.s; i + 1 <= c.e; i += 2) {
    left.push(pt10(p, i));
    right.push(pt10(p, i + 1));
  }
  return left.length < 2 ? null : { left, right };
}

/** A satin column between two rails, filled in between so the spacing can get finer. */
function columnOf({ left, right }: Rails): Column {
  const L: Pt[] = [];
  const R: Pt[] = [];
  const C: Pt[] = [];
  const widths: number[] = [];
  const SUB = 8;
  for (let k = 0; k < left.length; k++) {
    const steps = k + 1 < left.length ? SUB : 1;
    for (let j = 0; j < steps; j++) {
      const t = j / SUB;
      const a = k + 1 < left.length ? lerp(left[k], left[k + 1], t) : left[k];
      const b = k + 1 < right.length ? lerp(right[k], right[k + 1], t) : right[Math.min(k, right.length - 1)];
      L.push(a);
      R.push(b);
      C.push(lerp(a, b, 0.5));
      widths.push(dist(a, b));
    }
  }
  widths.sort((a, b) => a - b);
  return { center: C, left: L, right: R, width: widths[widths.length >> 1] };
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function newFill(p: Pattern, o: SewObject, a: Analysis, s: FillSettings): Pt[][] | null {
  const first = a.parts.find((pt) => pt.kind === 'fill');
  if (!a.fill || !first) return null;
  // Travel may also follow the object's old thread (its travel between patches lies under other
  // objects), so patches the old stitches connected stay connected without a trim.
  const segs: number[] = [];
  for (let i = o.first + 1; i <= o.last; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) segs.push(i);
  const travel = traceRegion(p, segs, TRAVEL_REACH, 0, false) ?? undefined;
  const fp: FillParams = { spacing: s.spacing, stitch: s.stitch, angle: s.angle, pull: s.edge, underlay: s.underlay, travel, tolerance: s.tolerance };
  const start = pt10(p, first.s);
  const r = a.fill;
  let res;
  if (s.pattern === 'gradient') {
    res = fillRegion(r, { ...fp, spacingEnd: s.spacingEnd }, start);
  } else if (s.pattern === 'contour') {
    const f = contourField(r);
    // Rings meet where the shape narrows to its middle: a little denser there is the nature of
    // a contour fill.
    res = fieldFill(r, f.g, f, fp, start, true, CONTOUR_PEAK);
  } else if (s.pattern === 'spiral') res = spiralFill(r, fp, start);
  else if (s.pattern === 'follow') {
    const lines: [Pt, Pt][] = [];
    for (const pt of a.parts) {
      if (pt.kind !== 'fill') continue;
      for (let i = pt.s + 1; i <= pt.e; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH && seg(p, i) >= 0.8) lines.push([pt10(p, i - 1), pt10(p, i)]);
    }
    const f = stitchField(r, lines);
    res = fieldFill(r, f.g, f, fp, start, false, CONTOUR_PEAK);
  } else res = fillRegion(r, { ...fp, offset: s.offset }, start);
  return res?.runs.filter((run) => run.length > 1) ?? null;
}

/**
 * New satin for a part, along `known` rails (kept from an earlier edit) or the rails its stitches
 * have now. Returns the stitches and the rails used.
 */
function newSatin(p: Pattern, pt: Part, s: SatinSettings, kinds: Uint8Array, known?: Rails[]): { runs: Pt[][]; rails: Rails[] } | null {
  const runs: Pt[][] = [];
  const rails = known ?? satinColumns(p, pt, kinds).map((c) => railsOf(p, c)).filter((r): r is Rails => !!r);
  for (const r of rails) {
    const col = columnOf(r);
    const ps = pairs(col, { spacing: s.spacing, pull: s.edge, splitMm: 12, short: s.short });
    if (ps.length < 2) continue;
    if (s.underlay) {
      // Underlay out along the column, satin back.
      const under = satinUnderlay(col, s.tolerance);
      const rev: Column = { center: col.center.slice().reverse(), left: col.right.slice().reverse(), right: col.left.slice().reverse(), width: col.width };
      runs.push([...under, ...satinStitches(pairs(rev, { spacing: s.spacing, pull: s.edge, splitMm: 12, short: s.short }), { spacing: s.spacing, pull: 0, splitMm: 12 })]);
    } else runs.push(satinStitches(ps, { spacing: s.spacing, pull: 0, splitMm: 12 }));
  }
  return runs.length ? { runs, rails } : null;
}

function newRun(p: Pattern, pt: Part, s: RunSettings, kinds: Uint8Array): Pt[][] | null {
  // The path without lock stitches and without the way back of a triple stitch.
  const path: Pt[] = [];
  for (let i = pt.s; i <= pt.e; i++) {
    if (p.cmd[i] !== STITCH || (kinds[i] === TIE_STITCH && i > pt.s)) continue;
    const q = pt10(p, i);
    if (path.length >= 2 && dist(q, path[path.length - 2]) < 0.05) {
      path.pop();
      continue;
    }
    if (!path.length || dist(q, path[path.length - 1]) > 0.05) path.push(q);
  }
  if (path.length < 2) return null;
  const pts = runStitch(path, s.stitch, s.tolerance);
  if (!s.triple) return [pts];
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) out.push(pts[i], pts[i - 1], pts[i]);
  return [out];
}

interface Rec {
  x: number;
  y: number;
  cmd: number;
}

/** Lock stitches at the start of a run of points (0.1 mm records), the half-stitch lock. */
function lockAt(run: Pt[], atEnd: boolean): Rec[] {
  const pts = atEnd ? run.slice().reverse() : run;
  const a = pts[0];
  let b = pts[1] ?? a;
  for (const q of pts) {
    if (dist(q, a) > 0.3) {
      b = q;
      break;
    }
  }
  const d = dist(a, b) || 1;
  const t = Math.min(0.7, d) / d;
  const m = lerp(a, b, t / 2);
  const f = lerp(a, b, t);
  const r = (q: Pt): Rec => ({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: STITCH });
  return atEnd ? [r(m), r(f), r(m), r(a)] : [r(a), r(m), r(f), r(m), r(a)];
}

export interface RestitchResult {
  pattern: Pattern;
  /** Number of the stitches before each changed object, and up to its end, in the new pattern. */
  starts: number[];
  ends: number[];
  /** Objects that could not be given new stitches (no shape found). */
  failed: number[];
  /** Fill area of each changed object (as `starts`). */
  regions: (Region | null)[];
  /** What to remember about each changed object for the next edit (as `starts`). */
  memory: Remembered[];
}

/**
 * New stitches for the parts of kind `settings.kind` in the objects `which`. Moves inside an object
 * up to 1 mm are stitched, up to `trimMm` jumped, longer ones trimmed with lock stitches.
 */
export function restitch(p: Pattern, objs: SewObject[], which: number[], settings: Settings, kinds: Uint8Array, trimMm: number): RestitchResult {
  const set = new Set(which);
  const out: Rec[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const failed: number[] = [];
  const regions: (Region | null)[] = [];
  const memory: Remembered[] = [];
  let sewn = 0;
  let counted = 0;
  const count = () => {
    for (; counted < out.length; counted++) if (out[counted].cmd === STITCH) sewn++;
  };
  const copy = (a: number, b: number) => {
    for (let i = a; i <= b; i++) out.push({ x: p.x[i], y: p.y[i], cmd: p.cmd[i] });
  };
  let i = 0;
  for (const o of objs) {
    if (!set.has(o.index)) continue;
    const known = remembered(p, o);
    const an = analyze(p, o, kinds, known);
    const parts = an.parts;
    // Satin columns kept from an earlier edit, if the object still has as many satin parts.
    const satinParts = parts.filter((pt) => pt.kind === 'satin');
    const keptRails = known?.columns?.length === satinParts.length ? known.columns : undefined;
    const rails: Rails[][] = [];
    // All fill parts are one area, filled anew where the first of them was sewn.
    const fill = settings.kind === 'fill' ? newFill(p, o, an, settings.s) : null;
    const firstFill = parts.findIndex((pt) => pt.kind === 'fill');
    let lastFill = -1;
    parts.forEach((pt, k) => pt.kind === 'fill' && (lastFill = k));
    const fresh: (Pt[][] | null | 'skip')[] = parts.map((pt, k) => {
      // Running stitch between the old fill patches was travel; the new fill travels its own way.
      if (fill && pt.kind === 'run' && k > firstFill && k < lastFill) return 'skip';
      if (pt.kind !== settings.kind) return null;
      if (settings.kind === 'fill') return !fill ? null : k === firstFill ? fill : 'skip';
      if (settings.kind === 'satin') {
        const sat = newSatin(p, pt, settings.s, kinds, keptRails?.[satinParts.indexOf(pt)]);
        if (sat) rails.push(sat.rails);
        return sat?.runs ?? null;
      }
      return newRun(p, pt, settings.s, kinds);
    });
    if (fresh.every((f) => !f)) {
      if (parts.some((pt) => pt.kind === settings.kind)) failed.push(o.index);
      continue;
    }
    // Up to the object: everything as it was, except the jumps that lead to its first stitch.
    let lead = o.first;
    while (lead - 1 >= i && p.cmd[lead - 1] === JUMP) lead--;
    copy(i, lead - 1);
    const startsWithNew = !!fresh[0];
    let last: Pt | null = null;
    let prevRun: Pt[] | null = null;
    let first = true;
    const emitPoint = (q: Pt) => {
      if (last && dist(last, q) < 0.05) return;
      out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: STITCH });
      last = q;
    };
    const moveTo = (q: Pt, run: Pt[] | null) => {
      if (first) {
        out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: JUMP });
        count();
        starts.push(sewn);
        regions.push(an.fill);
        memory.push({
          region: an.fill,
          fill: settings.kind === 'fill' ? { ...settings.s } : known?.fill,
          satin: settings.kind === 'satin' ? { ...settings.s } : known?.satin,
          columns: settings.kind === 'satin' ? (rails.length === satinParts.length ? rails : undefined) : known?.columns,
        });
        if (run && startsWithNew) out.push(...lockAt(run, false));
        else emitPoint(q);
        first = false;
        last = q;
        return;
      }
      const d = dist(last!, q);
      if (d <= 1) return emitPoint(q);
      if (d > trimMm && run) {
        out.push(...lockAt(prevRun!, true), { x: out[out.length - 1].x, y: out[out.length - 1].y, cmd: TRIM });
        out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: JUMP });
        out.push(...lockAt(run, false));
        last = q;
        return;
      }
      out.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd: JUMP });
      emitPoint(q);
    };
    parts.forEach((pt, k) => {
      const f = fresh[k];
      if (f === 'skip') return;
      if (f) {
        for (const run of f) {
          moveTo(run[0], run);
          for (let j = 1; j < run.length; j++) emitPoint(run[j]);
          prevRun = run;
        }
        return;
      }
      // An unchanged part: its own points (the shared first point only when not there yet).
      const run: Pt[] = [];
      for (let j = pt.s; j <= pt.e; j++) if (p.cmd[j] === STITCH) run.push(pt10(p, j));
      moveTo(run[0], run);
      for (let j = pt.s + 1; j <= pt.e; j++) {
        // Jumps and trims inside it stay as they are (an object can be sewn in trimmed pieces).
        if (p.cmd[j] === STITCH || p.cmd[j] === JUMP || p.cmd[j] === TRIM) out.push({ x: p.x[j], y: p.y[j], cmd: p.cmd[j] });
        if (p.cmd[j] === STITCH) last = pt10(p, j);
      }
      prevRun = run;
    });
    // A new last part ends with a lock, as the old one did.
    if (fresh[fresh.length - 1] && prevRun) out.push(...lockAt(prevRun, true));
    count();
    ends.push(sewn);
    i = o.last + 1;
  }
  copy(i, p.cmd.length - 1);
  const x = Int32Array.from(out, (r) => r.x);
  const y = Int32Array.from(out, (r) => r.y);
  const cmd = Uint8Array.from(out, (r) => r.cmd);
  return { pattern: tidy(withRecords(p, x, y, cmd)), starts, ends, failed, regions, memory };
}
