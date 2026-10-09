import { SATIN_CENTER_MAX } from '../material/rules';
import { sample, type Region } from './region';
import { runStitch, TOLERANCE } from './run';
import type { Branch, Pt } from './skeleton';

/**
 * Satin columns along a centerline. The rails are found by casting rays from the centerline along
 * its normal to the region's boundary (the "stroke normals" of the Goldman patent), so they follow
 * the real edges even where the column is asymmetric. Stitch placement follows Ink/Stitch's satin
 * column (re-implemented, not ported):
 *
 * - pairs are spaced so the rail that moves more advances by `spacing`, measured perpendicular to
 *   the previous stitch; on curves the inner side gets denser,
 * - which the short-stitch rule relieves: a penetration closer than 0.25 mm to the last full one on
 *   the same rail is moved 15 % of the width towards the other rail,
 * - pull compensation widens every pair outwards from its middle,
 * - stitches longer than the split length are divided evenly.
 */

export interface SatinParams {
  /** Distance between penetrations on the same side (mm). */
  spacing: number;
  /** Added to each side (mm). */
  pull: number;
  /** Longer stitches are split (mm). */
  splitMm: number;
  /** Short stitches on the inside of curves (default on). */
  short?: boolean;
  /** Added to the right side instead of `pull` (mm); the sides can differ. */
  pullB?: number;
  /** Added to each side in proportion to the column's width there (0.1 = 10 %). */
  pullShare?: number;
  /** Split stitches staggered from stitch to stitch, so the split points do not line up into a groove. */
  stagger?: boolean;
  /** Spacing at each point of the column instead of `spacing` (see spacingAlong in restitch). */
  spacingAt?: number[];
  /** Fringe on the left side: each stitch ends up to this much short of the rail (mm), see fringe. */
  fringe?: number;
  /** Fringe on the right side (mm). */
  fringeB?: number;
  /** The second pair this far after the first (mm) instead of `spacing`: the pattern starts later (an echo copy's phase). */
  lead?: number;
}

export interface Column {
  /** Centerline from end a to end b, extended into free ends. */
  center: Pt[];
  left: Pt[];
  right: Pt[];
  /** Median width (mm). */
  width: number;
}

const SHORT_DIST = 0.25;
const SHORT_INSET = 0.15;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const norm = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Tangent at index i, over a window of a few points. */
function tangent(pts: Pt[], i: number): Pt {
  const k = 3;
  const a = pts[Math.max(0, i - k)];
  const b = pts[Math.min(pts.length - 1, i + k)];
  return norm(sub(b, a));
}

/**
 * Extends the centerline past a free end until it leaves the region: a medial axis stops about one
 * radius short of a round end, and further short of a tapering tip.
 */
function extend(r: Region, pts: Pt[], radius: number, atStart: boolean): Pt[] {
  if (pts.length < 2) return [];
  const t = atStart ? tangent(pts, 0) : tangent(pts, pts.length - 1);
  const dir: Pt = atStart ? [-t[0], -t[1]] : t;
  const from = atStart ? pts[0] : pts[pts.length - 1];
  const out: Pt[] = [];
  for (let s = 0.1; s <= 3 * radius + 1; s += 0.1) {
    const p: Pt = [from[0] + dir[0] * s, from[1] + dir[1] * s];
    if (sample(r, r.sdfBase, p[0], p[1]) > -0.05) break;
    out.push(p);
  }
  return atStart ? out.reverse() : out;
}

/** Distance along `dir` from p to the region boundary, or -1 if none within `max`. */
function cast(r: Region, p: Pt, dir: Pt, max: number): number {
  const step = Math.min(0.05, r.pxMm / 2);
  let prev = sample(r, r.sdfBase, p[0], p[1]);
  if (prev >= 0) return 0;
  for (let t = step; t <= max; t += step) {
    const f = sample(r, r.sdfBase, p[0] + dir[0] * t, p[1] + dir[1] * t);
    if (f >= 0) return t - step + (step * -prev) / (f - prev);
    prev = f;
  }
  return -1;
}

/** Rails of a branch, from node a to node b; `freeA`/`freeB` extend the column into free ends. */
export function column(r: Region, br: Branch, freeA: boolean, freeB: boolean): Column {
  const head = freeA ? extend(r, br.pts, br.r[0], true) : [];
  const tail = freeB ? extend(r, br.pts, br.r[br.r.length - 1], false) : [];
  const center = [...head, ...br.pts, ...tail];
  const radius = [...head.map(() => br.r[0]), ...br.r, ...tail.map(() => br.r[br.r.length - 1])];
  const hl: number[] = [];
  const hr: number[] = [];
  for (let i = 0; i < center.length; i++) {
    const t = tangent(center, i);
    const n: Pt = [-t[1], t[0]];
    const rad = radius[i];
    const max = Math.max(0.6, 1.6 * rad + 0.2);
    for (const [side, out] of [[1, hl], [-1, hr]] as const) {
      let d = cast(r, center[i], [n[0] * side, n[1] * side], max);
      // Rays that miss or run far into a junction fall back to the inscribed radius.
      if (d < 0 || d > 1.6 * rad + 0.2) d = rad;
      out.push(Math.max(0, d));
    }
  }
  const sm = (v: number[]) => v.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(v.length - 1, i + 2); j++) {
      s += v[j];
      c++;
    }
    return s / c;
  });
  const L = sm(hl);
  const R = sm(hr);
  const left: Pt[] = [];
  const right: Pt[] = [];
  const widths: number[] = [];
  for (let i = 0; i < center.length; i++) {
    const t = tangent(center, i);
    const n: Pt = [-t[1], t[0]];
    left.push([center[i][0] + n[0] * L[i], center[i][1] + n[1] * L[i]]);
    right.push([center[i][0] - n[0] * R[i], center[i][1] - n[1] * R[i]]);
    widths.push(L[i] + R[i]);
  }
  widths.sort((a, b) => a - b);
  return { center, left, right, width: widths[widths.length >> 1] ?? 0 };
}

/** Junctions at the column's ends that other columns cover already: the column stops this far from them. */
export interface ColumnEnds {
  from: Pt;
  fromTrim: number;
  to: Pt;
  toTrim: number;
}

/** Stitch pairs (left, right) along the column, in its direction. */
export function pairs(c: Column, p: SatinParams, ends?: ColumnEnds): [Pt, Pt][] {
  const n = c.center.length;
  if (n < 2) return [];
  const out: [Pt, Pt][] = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    const w = dist(c.left[i], c.right[i]);
    if (w < 0.3) continue;
    if (ends && (dist(c.center[i], ends.from) < ends.fromTrim || dist(c.center[i], ends.to) < ends.toTrim)) continue;
    if (last >= 0) {
      const d = norm(sub(c.right[last], c.left[last]));
      const perp = (a: Pt, b: Pt) => Math.abs((b[0] - a[0]) * d[1] - (b[1] - a[1]) * d[0]);
      const adv = Math.max(perp(c.left[last], c.left[i]), perp(c.right[last], c.right[i]));
      if (adv < (out.length === 1 && p.lead ? p.lead : (p.spacingAt?.[last] ?? p.spacing)) && i < n - 1) continue;
      if (adv < 0.1) continue;
    }
    out.push([c.left[i], c.right[i]]);
    last = i;
  }
  // Pull compensation: each pair widened outwards from its middle (never turned inside out).
  const comp = out.map(([a, b]): [Pt, Pt] => {
    const u = norm(sub(a, b));
    const w = dist(a, b);
    let ea = p.pull + w * (p.pullShare ?? 0);
    let eb = (p.pullB ?? p.pull) + w * (p.pullShare ?? 0);
    if (ea + eb < -w * 0.8) {
      const k = (-w * 0.8) / (ea + eb);
      ea *= k;
      eb *= k;
    }
    return [[a[0] + u[0] * ea, a[1] + u[1] * ea], [b[0] - u[0] * eb, b[1] - u[1] * eb]];
  });
  // Short stitches on the inside of curves.
  for (const side of p.short === false ? [] : ([0, 1] as const)) {
    let ref = comp.length ? comp[0][side] : null;
    for (let i = 1; i < comp.length; i++) {
      const q = comp[i][side];
      if (ref && dist(q, ref) < SHORT_DIST) comp[i][side] = lerp(q, comp[i][1 - side], SHORT_INSET);
      else ref = q;
    }
  }
  if (p.fringe || p.fringeB) fringe(comp, p.fringe ?? 0, p.fringeB ?? 0);
  return comp;
}

/** A fringed stitch keeps at least this long (mm), and this share of the width. */
const FRINGE_KEEP = 1;
const FRINGE_KEEP_SHARE = 0.35;

/** A number in [0, 1) for stitch i on a side, the same every time (no state, so restitching repeats it). */
function hash(i: number, side: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(side + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * A ragged edge (fur, feathers): on each side every stitch ends a different way short of the rail,
 * up to `a` (left) and `b` (right) mm. Neighbours always differ by at least 30 % of the depth, so the
 * edge looks frayed rather than wavy; the depths scale with the setting and stay where they are.
 */
function fringe(ps: [Pt, Pt][], a: number, b: number): void {
  let ra = 0.5;
  let rb = 0.5;
  ps.forEach(([l, r], i) => {
    ra = (ra + 0.3 + 0.4 * hash(i, 0)) % 1;
    rb = (rb + 0.3 + 0.4 * hash(i, 1)) % 1;
    const w = dist(l, r);
    if (w < 1e-6) return;
    const room = Math.max(0, w - Math.max(FRINGE_KEEP, FRINGE_KEEP_SHARE * w));
    // Each side's share of the room, so also the stitch back from one pair to the next keeps it.
    const k = a + b > room ? room / (a + b) : 1;
    const da = a * k * ra;
    const db = b * k * rb;
    ps[i] = [lerp(l, r, da / w), lerp(r, l, db / w)];
  });
}

/** The column with its rails drawn in by the fringe (left `a`, right `b` mm): where the satin covers on every stitch. */
export function fringedColumn(c: Column, a: number, b: number): Column {
  if (!a && !b) return c;
  const left: Pt[] = [];
  const right: Pt[] = [];
  c.left.forEach((l, i) => {
    const r = c.right[i];
    const w = dist(l, r);
    const room = Math.max(0, w - Math.max(FRINGE_KEEP, FRINGE_KEEP_SHARE * w));
    const k = a + b > room ? room / (a + b) : 1;
    left.push(w ? lerp(l, r, (a * k) / w) : l);
    right.push(w ? lerp(r, l, (b * k) / w) : r);
  });
  return { ...c, left, right, center: left.map((l, i) => lerp(l, right[i], 0.5)) };
}

/** Splits a stitch from a to b into equal parts no longer than `max`; returns the points after a. */
function split(a: Pt, b: Pt, max: number): Pt[] {
  const n = Math.max(1, Math.ceil(dist(a, b) / max));
  const out: Pt[] = [];
  for (let k = 1; k <= n; k++) out.push(lerp(a, b, k / n));
  return out;
}

/** Split points of stitch number `row` staggered: no two neighbours split at the same place. */
const STAGGERS = 4;
/** No split point closer to a rail than this (mm): it would make a stitch too short to sew. */
const SPLIT_END = 1;

/**
 * Splits a stitch across the column from a to b (`fromA` measured from a, else from b, so a
 * stitch and the one back share their grid): at a fourth of the length further on from stitch
 * to stitch, every `max - 1` mm, never nearer than 1 mm to a rail. Returns the points after a.
 */
function splitStaggered(a: Pt, b: Pt, max: number, row: number, fromA: boolean): Pt[] {
  const d = dist(a, b);
  if (d <= max) return [b];
  const step = Math.max(1, max - SPLIT_END);
  const ts: number[] = [];
  for (let x = ((row % STAGGERS) / STAGGERS) * step; x < d; x += step) if (x >= SPLIT_END && x <= d - SPLIT_END) ts.push(x);
  const along = (fromA ? ts : ts.map((x) => d - x).reverse()).map((x) => lerp(a, b, x / d));
  return [...along, b];
}

/** Needle points of the satin: left, right, left, right ... along the pairs. */
export function satinStitches(ps: [Pt, Pt][], p: SatinParams): Pt[] {
  const out: Pt[] = [];
  let row = 0;
  const cross = (a: Pt, b: Pt, fromA: boolean) => (p.stagger ? splitStaggered(a, b, p.splitMm, row++, fromA) : split(a, b, p.splitMm));
  for (const [a, b] of ps) {
    if (!out.length) out.push(a);
    else out.push(...cross(out[out.length - 1], a, false));
    out.push(...cross(a, b, true));
  }
  return out;
}

/**
 * Needle points of an E stitch (blanket stitch, for appliqué edges): a running stitch along the
 * left rail, at each pair a stitch across to the right rail and back on the same holes.
 */
export function eStitches(ps: [Pt, Pt][], p: SatinParams): Pt[] {
  const out: Pt[] = [];
  let row = 0;
  for (const [a, b] of ps) {
    if (!out.length) out.push(a);
    else out.push(...split(out[out.length - 1], a, p.splitMm));
    const there = p.stagger ? splitStaggered(a, b, p.splitMm, row++, true) : split(a, b, p.splitMm);
    out.push(...there, ...[a, ...there.slice(0, -1)].reverse());
  }
  return out;
}

/** Kinds of satin underlay: by the column's width, along the middle, along both rails, zigzag, rails and zigzag. */
export type UnderlayKind = 'auto' | 'center' | 'contour' | 'zigzag' | 'both';

/** Inset of the contour and zigzag underlay from the rails (mm), at most a fourth of the width. */
const INSET = 0.4;

/**
 * Underlay sewn on the way out along the column (the satin follows on the way back), by width (see
 * SATIN_CENTER_MAX): a center walk for columns up to 4 mm; for wider ones a contour inset 0.4 mm
 * from both rails, then a zigzag with 3 mm between penetrations on the same side (Ink/Stitch's
 * underlay tutorial). The center walk keeps within `tol` of the centerline, so it stays under the
 * satin in tight curves.
 */
export function underlay(c: Column, tol = TOLERANCE, inset = insetOf(undefined)): Pt[] {
  const parts = byWidth(c);
  if (parts.length === 1) return c.width <= WIDE ? centerWalk(c, tol) : wideUnder(c, tol, inset);
  // Along the column by its width there: a centre walk where narrow, a zigzag where wide.
  const out: Pt[] = [];
  for (const { a, b, wide } of parts) {
    const part = sliceColumn(c, a, b);
    out.push(...(wide ? wideUnder(part, tol, inset) : centerWalk(part, tol)));
  }
  return out;
}

/** Wider than this (mm), a column gets contour and zigzag underlay; up to it a centre walk. */
const WIDE = SATIN_CENTER_MAX;

/** Contour (out and back along the rails) then zigzag to the far end, where the satin starts back. */
const wideUnder = (c: Column, tol: number, inset: (a: Pt, b: Pt) => number): Pt[] => [...contour(c, tol, inset), ...zigzag(c, inset)];
/** Along a column a stretch counts as wide only this much over WIDE (mm), so a column about 4 mm wide is not cut up. */
const WIDE_MARGIN = 0.5;
/** Stretches shorter than this (mm along the middle) go with their neighbours. */
const MIN_STRETCH = 5;

/** The column in stretches of about even width class: from index a to b, wide or not. */
function byWidth(c: Column): { a: number; b: number; wide: boolean }[] {
  const n = c.center.length;
  const parts: { a: number; b: number; wide: boolean; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const wide = dist(c.left[i], c.right[i]) > WIDE + WIDE_MARGIN;
    const step = i ? dist(c.center[i - 1], c.center[i]) : 0;
    const last = parts[parts.length - 1];
    if (last && last.wide === wide) {
      last.b = i;
      last.len += step;
    } else parts.push({ a: last ? last.b : 0, b: i, wide, len: step });
  }
  // The shortest stretch under MIN_STRETCH goes to its longer neighbour, until none is left.
  for (;;) {
    let k = -1;
    for (let j = 0; j < parts.length; j++) if (parts[j].len < MIN_STRETCH && (k < 0 || parts[j].len < parts[k].len)) k = j;
    if (k < 0 || parts.length === 1) break;
    const prev = parts[k - 1];
    const next = parts[k + 1];
    const into = !next || (prev && prev.len >= next.len) ? k - 1 : k + 1;
    const lo = Math.min(k, into);
    const merged = { a: parts[lo].a, b: parts[lo + 1].b, wide: parts[into].wide, len: parts[lo].len + parts[lo + 1].len };
    parts.splice(lo, 2, merged);
    // Neighbours of the same kind become one.
    for (let j = parts.length - 1; j > 0; j--) {
      if (parts[j].wide !== parts[j - 1].wide) continue;
      parts[j - 1] = { a: parts[j - 1].a, b: parts[j].b, wide: parts[j].wide, len: parts[j - 1].len + parts[j].len };
      parts.splice(j, 1);
    }
  }
  return parts.map(({ a, b, wide }) => ({ a, b, wide }));
}

const sliceColumn = (c: Column, a: number, b: number): Column => ({ center: c.center.slice(a, b + 1), left: c.left.slice(a, b + 1), right: c.right.slice(a, b + 1), width: c.width });

function centerWalk(c: Column, tol: number): Pt[] {
  return runStitch(c.center, 2.5, tol);
}

/**
 * How far the contour and zigzag underlay keep inside the rails: `mm` from each rail, or `share`
 * of the width there (0.1 = 10 %) in place of it. INSET (at most a fourth of the width) when neither is set.
 */
export interface UnderInset {
  mm?: number;
  share?: number;
}

/** The inset across a rung from a to b, as a fraction of its length (at most 45 % from each side). */
const insetOf = (ins: UnderInset | undefined) => (a: Pt, b: Pt) => {
  const w = Math.max(dist(a, b), 1e-6);
  if (ins?.share !== undefined) return Math.min(0.45, Math.max(0, ins.share));
  if (ins?.mm !== undefined) return Math.min(0.45 * w, Math.max(0, ins.mm)) / w;
  return Math.min(INSET, w / 4) / w;
};

function zigzag(c: Column, inset = insetOf(undefined)): Pt[] {
  const out: Pt[] = [];
  let lastS = -Infinity;
  let s = 0;
  let side = 0;
  for (let i = 0; i < c.center.length; i++) {
    if (i > 0) s += dist(c.center[i - 1], c.center[i]);
    if (s - lastS < 1.5 && i < c.center.length - 1) continue;
    const a = c.left[i];
    const b = c.right[i];
    const k = inset(a, b);
    out.push(side === 0 ? lerp(a, b, k) : lerp(b, a, k));
    side = 1 - side;
    lastS = s;
  }
  return out;
}

/** Out along the left rail and back along the right one, both inset. */
function contour(c: Column, tol: number, inset = insetOf(undefined)): Pt[] {
  const l = c.left.map((a, i) => lerp(a, c.right[i], inset(a, c.right[i])));
  const r = c.right.map((b, i) => lerp(b, c.left[i], inset(b, c.left[i])));
  return [...runStitch(l, 2, tol), ...runStitch(r.reverse(), 2, tol)];
}

/**
 * The underlay of `kind` for the column, and whether it ends at the column's far end (then the
 * satin comes back over it) or back where it started (then the satin goes out over it).
 */
export function underlayOf(c: Column, kind: UnderlayKind, tol = TOLERANCE, ins?: UnderInset): { pts: Pt[]; atEnd: boolean } {
  const k = insetOf(ins);
  if (kind === 'center') return { pts: centerWalk(c, tol), atEnd: true };
  if (kind === 'zigzag') return { pts: zigzag(c, k), atEnd: true };
  if (kind === 'contour') return { pts: contour(c, tol, k), atEnd: false };
  if (kind === 'both') return { pts: [...contour(c, tol, k), ...zigzag(c, k)], atEnd: true };
  return { pts: underlay(c, tol, k), atEnd: true };
}
