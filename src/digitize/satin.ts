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
 * - which the short-stitch rule relieves: a penetration too close to the last full one on the same
 *   rail is moved in towards the other rail, 15 % and 30 % of the width by turns (see SHORT_DIST),
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
  /** Irregular satin (fur, grass, a hand-sewn look), 0 to 1: see roughen. */
  rough?: number;
  /** Which irregular satin: the same seed gives the same stitches every time. */
  seed?: number;
}

export interface Column {
  /** Centerline from end a to end b, extended into free ends. */
  center: Pt[];
  left: Pt[];
  right: Pt[];
  /** Median width (mm). */
  width: number;
}

/**
 * Short stitches (Ink/Stitch's short stitch inset, re-implemented): on the inside of a curve the
 * needle points of one rail crowd. One closer to the last full one on its rail than SHORT_DIST, or
 * than SHORT_SHARE of the spacing where that is more (on a looser satin: the inside no more than
 * twice as dense as the spacing), moves in towards the other rail; while they keep coming that close, by SHORT_INSETS of
 * the width in turn (Ink/Stitch's multi-level "15 30"). So the tighter the curve, the more points
 * fall short, spread over three lines instead of piling up on one; never further than a third of
 * the split length, so a split stitch keeps its parts.
 */
const SHORT_DIST = 0.25;
const SHORT_SHARE = 0.5;
const SHORT_INSETS = [0.15, 0.3];

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
  // The spacing at each pair (for the short stitches).
  const spacings: number[] = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    const w = dist(c.left[i], c.right[i]);
    if (w < 0.3) continue;
    if (ends && (dist(c.center[i], ends.from) < ends.fromTrim || dist(c.center[i], ends.to) < ends.toTrim)) continue;
    if (last >= 0) {
      const d = norm(sub(c.right[last], c.left[last]));
      const perp = (a: Pt, b: Pt) => Math.abs((b[0] - a[0]) * d[1] - (b[1] - a[1]) * d[0]);
      const adv = Math.max(perp(c.left[last], c.left[i]), perp(c.right[last], c.right[i]));
      const base = out.length === 1 && p.lead ? p.lead : (p.spacingAt?.[last] ?? p.spacing);
      // Irregular: each pair a different way nearer or further than the spacing.
      const sp = p.rough ? base * (1 + ROUGH_SPACING * p.rough * (2 * hash(out.length, 2, p.seed) - 1)) : base;
      if (adv < sp && i < n - 1) continue;
      if (adv < 0.1) continue;
    }
    out.push([c.left[i], c.right[i]]);
    spacings.push(p.spacingAt?.[i] ?? p.spacing);
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
  if (p.rough) roughen(comp, p.rough, p.seed ?? 0);
  // Short stitches on the inside of curves (see SHORT_DIST).
  for (const side of p.short === false ? [] : ([0, 1] as const)) {
    let ref = comp.length ? comp[0][side] : null;
    let run = 0;
    for (let i = 1; i < comp.length; i++) {
      const q = comp[i][side];
      const other = comp[i][1 - side];
      if (ref && dist(q, ref) < Math.max(SHORT_DIST, SHORT_SHARE * spacings[i])) {
        const w = dist(q, other);
        const k = w > 1e-9 ? Math.min(SHORT_INSETS[run % SHORT_INSETS.length], p.splitMm / 3 / w) : 0;
        comp[i][side] = lerp(q, other, k);
        run++;
      } else {
        ref = q;
        run = 0;
      }
    }
  }
  if (p.fringe || p.fringeB) fringe(comp, p.fringe ?? 0, p.fringeB ?? 0);
  return comp;
}

/** A fringed stitch keeps at least this long (mm), and this share of the width. */
const FRINGE_KEEP = 1;
const FRINGE_KEEP_SHARE = 0.35;

/**
 * A number in [0, 1) for stitch i on a side, the same every time (no state, so restitching repeats
 * it); another `seed` gives other numbers (seed 0: the fringe's, as before seeds).
 */
function hash(i: number, side: number, seed = 0): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(side + 7, 0x85ebca6b) ^ (seed ? Math.imul(seed | 0, 0x27d4eb2f) : 0);
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

/**
 * Irregular satin, as Ink/Stitch's random width and zigzag spacing (re-implemented): each needle
 * point reaches up to ROUGH_OUT of the width beyond its rail or up to ROUGH_IN short of it, each
 * side on its own, and the spacing varies by up to ROUGH_SPACING (see pairs), all times `k` (0 to
 * 1). Uniform and independent from stitch to stitch, from a hash of the stitch and the seed, so the
 * edge looks hand-sewn or furry and comes out the same each time.
 */
export const ROUGH_OUT = 0.2;
export const ROUGH_IN = 0.1;
const ROUGH_SPACING = 0.25;

function roughen(ps: [Pt, Pt][], k: number, seed: number): void {
  ps.forEach(([a, b], i) => {
    const w = dist(a, b);
    if (w < 1e-6) return;
    const u = norm(sub(a, b));
    const ea = w * k * ((ROUGH_OUT + ROUGH_IN) * hash(i, 3, seed) - ROUGH_IN);
    const eb = w * k * ((ROUGH_OUT + ROUGH_IN) * hash(i, 4, seed) - ROUGH_IN);
    ps[i] = [[a[0] + u[0] * ea, a[1] + u[1] * ea], [b[0] - u[0] * eb, b[1] - u[1] * eb]];
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

/** Inset of the contour underlay from the rails (mm), at most a fourth of the width; the zigzag's is half of it. */
const INSET = 0.4;

/**
 * Underlay sewn on the way out along the column, ending at its far end (the satin follows on the
 * way back), by width (see SATIN_CENTER_MAX): a center walk for columns up to 4 mm; for wider ones
 * a contour inset 0.4 mm from both rails, then one zigzag with 3 mm between penetrations on the
 * same side (Ink/Stitch's underlay tutorial). The center walk keeps within `tol` of the centerline,
 * so it stays under the satin in tight curves. The image conversion walks its columns this way;
 * objects get underlayOf, whose zigzag goes out and back.
 */
export function underlay(c: Column, tol = TOLERANCE, inset = insetOf(undefined), zig = insetOf(undefined, true)): Pt[] {
  const parts = byWidth(c);
  if (parts.length === 1) return c.width <= WIDE ? centerWalk(c, tol) : wideUnder(c, tol, inset, zig);
  // Along the column by its width there: a centre walk where narrow, a zigzag where wide.
  const out: Pt[] = [];
  for (const { a, b, wide } of parts) {
    const part = sliceColumn(c, a, b);
    out.push(...(wide ? wideUnder(part, tol, inset, zig) : centerWalk(part, tol)));
  }
  return out;
}

/**
 * The underlay by width with a double zigzag where the column is wide (German underlay: edge run
 * and zigzag out and back). It ends back at the start where any stretch is wide: there the narrow
 * stretches walk their centre out and back on the same holes, the wide ones get edge run and the
 * first zigzag on the way out and the second zigzag on the way back.
 */
function autoUnder(c: Column, tol: number, inset: Inset, zig: Inset): { pts: Pt[]; atEnd: boolean } {
  const parts = byWidth(c);
  if (parts.length === 1) return c.width <= WIDE ? { pts: centerWalk(c, tol), atEnd: true } : { pts: [...contour(c, tol, inset), ...doubleZigzag(c, zig)], atEnd: false };
  const out: Pt[] = [];
  const back: Pt[][] = [];
  for (const { a, b, wide } of parts) {
    const part = sliceColumn(c, a, b);
    if (wide) {
      const [there, home] = zigzags(part, zig);
      out.push(...contour(part, tol, inset), ...there);
      back.push(home);
    } else {
      const walk = centerWalk(part, tol);
      out.push(...walk);
      back.push(walk.slice().reverse());
    }
  }
  return { pts: [...out, ...back.reverse().flat()], atEnd: false };
}

/** How far underlay keeps inside a rung from a to b, as a fraction of its length. */
type Inset = (a: Pt, b: Pt) => number;

/** Wider than this (mm), a column gets contour and zigzag underlay; up to it a centre walk. */
const WIDE = SATIN_CENTER_MAX;

/** Contour (out and back along the rails) then zigzag to the far end, where the satin starts back. */
const wideUnder = (c: Column, tol: number, inset: Inset, zig: Inset): Pt[] => [...contour(c, tol, inset), ...zigzags(c, zig)[0]];
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

/**
 * The inset across a rung from a to b, as a fraction of its length (at most 45 % from each side).
 * `half`: the zigzag's when none is set, half the edge run's (as Ink/Stitch's default), so the
 * zigzag also carries the satin's edge beside the edge run.
 */
const insetOf = (ins: UnderInset | undefined, half = false): Inset => (a: Pt, b: Pt) => {
  const w = Math.max(dist(a, b), 1e-6);
  if (ins?.share !== undefined) return Math.min(0.45, Math.max(0, ins.share));
  if (ins?.mm !== undefined) return Math.min(0.45 * w, Math.max(0, ins.mm)) / w;
  return Math.min(INSET, w / 4) / w / (half ? 2 : 1);
};

/** Between penetrations of the zigzag underlay (mm along the middle, alternating sides): 3 mm on one side. */
const ZIGZAG_STEP = 1.5;

/**
 * The zigzag underlay as two passes over the same stations every ZIGZAG_STEP along the column: out
 * from the left rail, then back starting on the other rail at the far end, so at each station the
 * second pass meets the side the first one left out and the two cross between stations, the
 * double zigzag (cross-hatch) of Wilcom and Ink/Stitch, which holds the fabric in both diagonals.
 */
function zigzags(c: Column, inset = insetOf(undefined, true)): [Pt[], Pt[]] {
  const side = (i: number, j: number) => {
    const a = c.left[i];
    const b = c.right[i];
    const k = inset(a, b);
    return j === 0 ? lerp(a, b, k) : lerp(b, a, k);
  };
  // Whether a zigzag stitch from station i to j (either way across) would cross a rail: round the
  // inside of a sharp corner, where it would cut across what is not the column. Any part of the
  // rails, as rungs may slant far along them.
  const near = railGrid(c);
  const cuts = (i: number, j: number) => [[side(i, 0), side(j, 1)], [side(i, 1), side(j, 0)]].some(([p, q]) => near(p, q).some(([a, b]) => crossing(p, q, a, b)));
  // Every ZIGZAG_STEP along the middle, or sooner where a stitch would leave the column.
  const at: number[] = [0];
  let sc = 0;
  for (let i = 1; i < c.center.length; i++) {
    sc += dist(c.center[i - 1], c.center[i]);
    if (sc < ZIGZAG_STEP && i < c.center.length - 1) continue;
    // Back towards the last station until the stitches stay inside, yet not nearer than a third
    // of the step: where rails slant so much that no station helps, more would only pile up.
    const last = at[at.length - 1];
    let j = i;
    while (j - 1 > last && dist(c.center[j - 1], c.center[last]) >= ZIGZAG_STEP / 3 && cuts(last, j)) j--;
    at.push(j);
    i = j;
    sc = 0;
  }
  const out = at.map((i, n) => side(i, n % 2));
  const back = at.map((i, n) => side(i, 1 - (n % 2))).reverse();
  return [out, back];
}

/** Cells of the grid railGrid sorts the rails' segments into (mm). */
const RAIL_CELL = 1;

/** The segments of both rails, found by the cells of a grid: those near the segment p-q. */
function railGrid(c: Column): (p: Pt, q: Pt) => [Pt, Pt][] {
  const cells = new Map<string, [Pt, Pt][]>();
  const span = (a: number, b: number) => [Math.floor(Math.min(a, b) / RAIL_CELL), Math.floor(Math.max(a, b) / RAIL_CELL)];
  for (const rail of [c.left, c.right]) {
    for (let k = 0; k + 1 < rail.length; k++) {
      const [x0, x1] = span(rail[k][0], rail[k + 1][0]);
      const [y0, y1] = span(rail[k][1], rail[k + 1][1]);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const list = cells.get(key);
          if (list) list.push([rail[k], rail[k + 1]]);
          else cells.set(key, [[rail[k], rail[k + 1]]]);
        }
      }
    }
  }
  return (p, q) => {
    const [x0, x1] = span(p[0], q[0]);
    const [y0, y1] = span(p[1], q[1]);
    const out = new Set<[Pt, Pt]>();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const s of cells.get(`${x},${y}`) ?? []) out.add(s);
    return [...out];
  };
}

/** Whether the segments p-q and a-b cross (not only touch). */
function crossing(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const o = (u: Pt, v: Pt, w: Pt) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = o(p, q, a);
  const d2 = o(p, q, b);
  const d3 = o(a, b, p);
  const d4 = o(a, b, q);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Both zigzag passes: out to the far end and back to the start. */
function doubleZigzag(c: Column, inset = insetOf(undefined, true)): Pt[] {
  const [out, back] = zigzags(c, inset);
  return [...out, ...back];
}

/** Out along the left rail and back along the right one, both inset. */
function contour(c: Column, tol: number, inset = insetOf(undefined)): Pt[] {
  const l = c.left.map((a, i) => lerp(a, c.right[i], inset(a, c.right[i])));
  const r = c.right.map((b, i) => lerp(b, c.left[i], inset(b, c.left[i])));
  return [...runStitch(l, 2, tol), ...runStitch(r.reverse(), 2, tol)];
}

/**
 * The underlay of `kind` for the column, and whether it ends at the column's far end (then the
 * satin comes back over it) or back where it started (then the satin goes out over it). A zigzag
 * is sewn out and back (see zigzags), so it ends where it started; `oneWay` (a column that has to
 * come home, in a chain) sews it out only, so it ends at the far end and needs no run out along
 * the middle on top (more thread where columns meet).
 */
export function underlayOf(c: Column, kind: UnderlayKind, tol = TOLERANCE, ins?: UnderInset, oneWay = false): { pts: Pt[]; atEnd: boolean } {
  const k = insetOf(ins);
  const z = insetOf(ins, true);
  if (kind === 'center') return { pts: centerWalk(c, tol), atEnd: true };
  if (kind === 'contour') return { pts: contour(c, tol, k), atEnd: false };
  if (oneWay && kind === 'zigzag') return { pts: zigzags(c, z)[0], atEnd: true };
  if (oneWay && kind === 'both') return { pts: [...contour(c, tol, k), ...zigzags(c, z)[0]], atEnd: true };
  if (oneWay) return { pts: underlay(c, tol, k, z), atEnd: true };
  if (kind === 'zigzag') return { pts: doubleZigzag(c, z), atEnd: false };
  if (kind === 'both') return { pts: [...contour(c, tol, k), ...doubleZigzag(c, z)], atEnd: false };
  return autoUnder(c, tol, k, z);
}
