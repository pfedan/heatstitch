import { pathLength, pointCount, sewUnderlay, TRAVEL_STITCH, TRAVEL_TOLERANCE, TravelGrid, type FillParams, type FillResult } from './fill';
import { outline, sample, type Region } from './region';
import { MIN_CURVE_STITCH, Path, runStitch, simplify, TOLERANCE } from './run';
import type { Pt } from './skeleton';

/**
 * Fills along the outline, one spacing apart everywhere: the contour fill (ring in ring) and the
 * spiral, for any shape.
 *
 * The rings are the level lines of the area's distance field, the first half a spacing inside the
 * edge (moved out by `pull`), each next one a spacing further in, so neighbouring rings lie exactly
 * one spacing apart all round (as in Ink/Stitch's contour fill and the offset curves of spiral
 * pocket milling). Each ring knows the ring it lies in (its parent, one spacing further out): a
 * tree, which branches where the shape gets narrow (a dumbbell) and has more roots where it has
 * holes.
 *
 * The sewn line runs from ring to ring without a step: ring k is sewn shifted by φ(f) spacings
 * along the field's gradient, where f is the share of the ring's length from its start. When φ
 * goes from -1/2 at the start to +1/2 at the end, the end of ring k lies exactly where ring k+1
 * begins (its start is one spacing further in on the same gradient line), and neighbouring turns
 * stay one spacing apart everywhere, as both are shifted alike. With φ = f - 1/2 the line is a
 * spiral: the ring to ring interpolation of spiral pocket milling (Held and Spielberger, "A smooth
 * spiral tool path for high speed machining of 2D pockets", 2009), here exact in the distance field
 * rather than between resampled polygons. With φ = 0 except a short ramp at both ends it is the
 * contour fill, whose rings pass on to the next one over a few millimetres instead of in one step
 * with a needle point sewn twice.
 *
 * Along the ridge in the middle no full spacing may be left for another line: the last line there
 * moves so that the gap across the ridge and the gap to the line before come out equal, rather than
 * leaving a strip of fabric or two lines on top of each other.
 *
 * Where the tree branches, the line goes on into one branch; every other branch is a spiral of its
 * own, sewn before the line passes it and from its middle outwards, so the needle reaches it and
 * leaves it under rows still to come (like the connected spirals of Zhao et al., "Connected Fermat
 * Spirals for Layered Fabrication", 2016, but with single spirals and hidden travel).
 */

export type RingMode = 'spiral' | 'contour';

/** Rings shorter than this are left out (mm). */
const MIN_RING = 1;
/** Ring points at most this far apart before they are shifted (mm). */
const RESAMPLE = 0.3;
/** Length over which a contour ring passes on to the next one, at each end (mm). */
const RAMP = 3;
/** Cells for finding rings near a point (mm). */
const CELL = 0.2;
/** A ring whose two sides lie closer than this share of a spacing is left out (a sliver along a ridge). */
const SLIVER = 0.25;
/** Probe beyond a ridge (mm), and the cosine between the gradients there below which the ridge is a fold. */
const FOLD_PROBE = 0.3;
const FOLD_COS = -0.5;
/** Rings over which a spiral turns into rings beside its first ring and where branches leave. */
const BLEND = 4;
/** Moves of the last line are evened out over this many ring points to each side. */
const SMOOTH = 3;
/** Needle points: the shortest stitch as a share of the longest that fits, how many lengths are tried, and how far a needle point counts as near (mm). */
const SHORTEST = 0.7;
const CANDIDATES = 6;
const NEAR = 1.2;

interface Ring {
  pts: Pt[];
  /** Number of the ring from the edge, and its depth inside the area (mm). */
  k: number;
  depth: number;
  kids: Ring[];
  /** How far the ring lies inside the one around it (a spacing, less for a ring a quarter spacing further out). */
  out: number;
}

interface Spot {
  /** The point on the line, its depth, and the way on from it to the ridge or a spacing deeper. */
  x: Pt;
  a: number;
  w: { pts: Pt[]; d: number[] };
  move: number;
}

interface Line {
  pts: Pt[];
  /** Where each turn begins (indices into pts). */
  turns: number[];
}

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

export function ringFill(r: Region, p: FillParams, start: Pt, mode: RingMode, angle: number): FillResult | null {
  const s = p.spacing;
  const field = new Field(r, s);
  const roots = ringTree(r, field, s, p.pull);
  if (!roots.length) return null;
  const runs: Pt[][] = [];
  const grid = new TravelGrid(p.travel ?? r, p.offRowEnds);
  let pos = p.underlay ? sewUnderlay(r, angle, p, start, grid, runs) : start;
  const under = pointCount(runs);

  // The lines in the order they are sewn, each reached by travel from the end of the one before.
  const lines: Line[] = [];
  let at = pos;
  const sew = (ring: Ring, inwards: boolean) => {
    const branches: Ring[] = [];
    const line = chain(field, ring, nearestOn(ring.pts, at).pt, mode, branches);
    // Branches off the way first, each from its middle out to its edge.
    while (branches.length) sew(branches.splice(nearestRing(branches, at), 1)[0], false);
    if (!inwards) {
      line.pts.reverse();
      line.turns = line.turns.map((i) => line.pts.length - 1 - i).reverse();
    }
    lines.push(line);
    at = line.pts[line.pts.length - 1];
  };
  const todo = roots.slice();
  while (todo.length) sew(todo.splice(nearestRing(todo, at), 1)[0], true);

  let cur: Pt[] | null = runs.length ? runs[runs.length - 1] : null;
  let turn = 0;
  const needles = new Needles();
  for (const line of lines) {
    const pts = stitches(line, p.stitch, p.tolerance ?? TOLERANCE, turn, needles);
    turn += line.turns.length;
    if (pts.length < 2) continue;
    const bd = dist(pos, pts[0]);
    let travel: Pt[] | null = null;
    if (cur && bd > 1) {
      const path = grid.path(pos, pts[0], true);
      if (path && pathLength(path) < 2 * bd + 6) travel = runStitch(path, TRAVEL_STITCH, TRAVEL_TOLERANCE);
    } else if (cur) travel = [pos, pts[0]];
    if (cur && travel) cur.push(...travel.slice(1), ...pts.slice(1));
    else {
      cur = pts;
      runs.push(cur);
    }
    for (let i = 1; i < line.pts.length; i++) grid.cover(line.pts[i - 1], line.pts[i], s / 2);
    pos = pts[pts.length - 1];
  }
  if (!runs.length) return null;
  return { runs, angle, under };
}

/** Needle points sewn so far, to find the nearest one to a point. */
class Needles {
  private cells = new Map<number, Pt[]>();

  add(q: Pt): void {
    const k = this.key(Math.floor(q[0] / NEAR), Math.floor(q[1] / NEAR));
    const c = this.cells.get(k);
    if (c) c.push(q);
    else this.cells.set(k, [q]);
  }

  /** Distance from q to the nearest needle point (at most NEAR), leaving out those in `skip`. */
  near(q: Pt, skip: Pt[]): number {
    const i = Math.floor(q[0] / NEAR);
    const j = Math.floor(q[1] / NEAR);
    let best = NEAR;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const p of this.cells.get(this.key(i + di, j + dj)) ?? []) if (!skip.includes(p)) best = Math.min(best, dist(p, q));
      }
    }
    return best;
  }

  private key(i: number, j: number): number {
    return (i + 65536) * 131072 + (j + 65536);
  }
}

/**
 * Needle points along a line, at most `len` apart and shorter in curves (as a running stitch), and
 * one at each sharp corner. Each stitch ends at the best of a few lengths between SHORTEST and the
 * longest that fits: the one furthest from the needle points sewn before (Mitchell's best
 * candidate, a blue noise sampling). Needle points of neighbouring turns thus neither line up into
 * spokes nor fall into a regular pattern (as an even split per turn with a fixed or growing offset
 * does, seen as steps or diagonal lines), and the area looks like even thread.
 */
function stitches(line: Line, len: number, tol: number, first: number, needles: Needles): Pt[] {
  const simple = Math.min(0.1, tol / 2);
  const pts = simplify(line.pts, simple);
  tol = Math.max(0.02, tol - simple);
  if (pts.length < 2) return pts;
  const path = new Path(pts);
  const cuts: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
    const b = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
    const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1);
    if (cos < Math.SQRT1_2) cuts.push(path.cum[i]);
  }
  const marks = [0];
  for (const c of cuts) if (c - marks[marks.length - 1] >= MIN_CURVE_STITCH && path.total - c >= MIN_CURVE_STITCH) marks.push(c);
  marks.push(path.total);
  const out: Pt[] = [pts[0]];
  needles.add(pts[0]);
  const min = Math.min(MIN_CURVE_STITCH, len);
  // The same needle points each time the object is sewn.
  let n = first * 7919;
  for (let m = 1; m < marks.length; m++) {
    const to = marks[m];
    let a = marks[m - 1];
    while (to - a > 1e-9) {
      // The longest stitch that stays within tol of the line (as Path.marks).
      let hi = Math.min(a + len, to);
      if (path.deviation(a, hi) > tol) {
        let lo = Math.min(a + min, hi);
        if (path.deviation(a, lo) <= tol) {
          for (let it = 0; it < 14 && hi - lo > 0.01; it++) {
            const c = (lo + hi) / 2;
            if (path.deviation(a, c) <= tol) lo = c;
            else hi = c;
          }
        }
        hi = lo;
      }
      let b = hi;
      if (hi < to) {
        const lo = Math.max(a + SHORTEST * (hi - a), Math.min(hi, a + min));
        // No short stitch left over before the corner or the end.
        const cap = to - min;
        const skip = out.slice(-3);
        let best = -Infinity;
        for (let k = 0; k < CANDIDATES; k++) {
          let c = lo + (hi - lo) * hash(n++);
          if (c > cap) c = Math.max(a + (to - a) / 2, cap);
          const score = needles.near(path.at(c), skip) + 0.02 * (c - a);
          if (score > best) {
            best = score;
            b = c;
          }
        }
      }
      const q = path.at(b);
      out.push(q);
      needles.add(q);
      a = b;
    }
  }
  return out;
}

/** A number in [0, 1) from an integer, the same each time. */
function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Depth inside the area (mm) and its gradient, from the region's signed distance field. */
class Field {
  private e: number;
  private step: number;
  /** Per ring number, where its rings lie (their depth and the cells they pass through). */
  private levels: { depth: number; cells: Set<number> }[][] = [];

  constructor(
    private r: Region,
    readonly s: number,
  ) {
    this.e = r.pxMm / 2;
    this.step = Math.max(0.05, Math.min(0.15, s / 3));
  }

  depth(q: Pt): number {
    return -sample(this.r, this.r.sdf, q[0], q[1]);
  }

  grad(q: Pt): Pt {
    const e = this.e;
    return [(this.depth([q[0] + e, q[1]]) - this.depth([q[0] - e, q[1]])) / (2 * e), (this.depth([q[0], q[1] + e]) - this.depth([q[0], q[1] - e])) / (2 * e)];
  }

  /**
   * The way from q along the gradient (or against it) towards depth `to`, as points with their
   * depths. It stops early where the depth no longer changes that way: on the ridge in the middle
   * of the shape, or at its edge.
   */
  walk(q: Pt, to: number): { pts: Pt[]; d: number[] } {
    let x = q;
    let d = this.depth(x);
    const pts = [x];
    const ds = [d];
    const sign = to >= d ? 1 : -1;
    for (let i = 0; i < 400 && sign * (to - d) > 1e-3; i++) {
      const g = this.grad(x);
      const m = Math.hypot(g[0], g[1]);
      if (m < 0.2) break;
      const len = Math.max(-this.step, Math.min(this.step, (to - d) / m));
      const nx: Pt = [x[0] + (g[0] / m) * len, x[1] + (g[1] / m) * len];
      const nd = this.depth(nx);
      if (sign * (nd - d) < 0.2 * Math.abs(len) * m) break;
      x = nx;
      d = nd;
      pts.push(x);
      ds.push(d);
    }
    return { pts, d: ds };
  }

  /** The point at depth `to` on the way from q, as far as it gets. */
  reach(q: Pt, to: number): Pt {
    const w = this.walk(q, to);
    return w.pts[w.pts.length - 1];
  }

  /**
   * The line through point q of ring `ring` shifted by `delta` (mm) deeper along the gradient, and
   * how far it should move from there: where no further ring lies beyond it, it is the last line
   * before the ridge, and moves by a third of what the gap across the ridge is wider (or narrower)
   * than the gap to the ring before, so both come out equal.
   */
  spot(q: Pt, ring: Ring, delta: number): Spot {
    const s = this.s;
    const x = Math.abs(delta) < 1e-4 ? q : this.reach(q, ring.depth + delta);
    const a = this.depth(x);
    const to = Math.max(a, ring.depth) + s;
    const w = this.walk(x, to);
    const ridge = w.d[w.d.length - 1];
    // Not the last line where the way meets the next ring; nor where it stops on the line from a
    // corner inwards, which the next ring only bends round.
    const last = !this.crosses(ring.k + 1, w) && (ridge >= to - 1e-3 || this.fold(w.pts[w.pts.length - 1]));
    return { x, a, w, move: last ? (2 * (ridge - a) - ring.out) / 3 : 0 };
  }

  /**
   * Whether the ridge at q has the edge on its other side facing back (the two sides of a narrow
   * part), not only turned (the line from a corner inwards, where the rings just bend round).
   */
  private fold(q: Pt): boolean {
    const g = this.grad(q);
    const m = Math.hypot(g[0], g[1]);
    if (m < 1e-6) return true;
    const h = this.grad([q[0] + (g[0] / m) * FOLD_PROBE, q[1] + (g[1] / m) * FOLD_PROBE]);
    const n = Math.hypot(h[0], h[1]);
    return n < 1e-6 || (g[0] * h[0] + g[1] * h[1]) / (m * n) < FOLD_COS;
  }

  /** The spot moved by `move` (mm) deeper (shallower when negative). */
  moved(spot: Spot, move: number): Pt {
    const { x, a, w } = spot;
    if (Math.abs(move) < 1e-3) return x;
    if (move < 0) return this.reach(x, a + move);
    for (let i = 1; i < w.pts.length; i++) {
      if (w.d[i] < a + move) continue;
      const t = w.d[i] > w.d[i - 1] ? (a + move - w.d[i - 1]) / (w.d[i] - w.d[i - 1]) : 1;
      return [w.pts[i - 1][0] + (w.pts[i][0] - w.pts[i - 1][0]) * t, w.pts[i - 1][1] + (w.pts[i][1] - w.pts[i - 1][1]) * t];
    }
    return w.pts[w.pts.length - 1];
  }

  /** Notes where a ring lies, for crosses. */
  add(ring: Ring): void {
    const level = (this.levels[ring.k] ??= []);
    let entry = level.find((e) => Math.abs(e.depth - ring.depth) < 1e-6);
    if (!entry) level.push((entry = { depth: ring.depth, cells: new Set() }));
    for (let i = 1; i < ring.pts.length; i++) {
      const [p, q] = [ring.pts[i - 1], ring.pts[i]];
      const n = Math.ceil(dist(p, q) / (CELL / 2));
      for (let j = 0; j <= n; j++) entry.cells.add(this.cell(p[0] + ((q[0] - p[0]) * j) / n, p[1] + ((q[1] - p[1]) * j) / n));
    }
  }

  /** Whether a ring numbered k lies within a cell or so of q. */
  near(k: number, q: Pt, depth?: number): boolean {
    for (const e of this.levels[k] ?? []) {
      if (depth !== undefined && Math.abs(e.depth - depth) > 1e-6) continue;
      const cx = Math.floor(q[0] / CELL);
      const cy = Math.floor(q[1] / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (e.cells.has(this.key(cx + dx, cy + dy))) return true;
    }
    return false;
  }

  /** Whether the way meets a ring numbered k where it reaches that ring's depth. */
  private crosses(k: number, w: { pts: Pt[]; d: number[] }): boolean {
    for (const e of this.levels[k] ?? []) {
      const i = w.d.findIndex((d) => d >= e.depth - 0.01);
      if (i >= 0 && this.near(k, w.pts[i], e.depth)) return true;
    }
    return false;
  }

  private cell(x: number, y: number): number {
    return this.key(Math.floor(x / CELL), Math.floor(y / CELL));
  }

  private key(i: number, j: number): number {
    return (i + 65536) * 131072 + (j + 65536);
  }
}

/**
 * The rings of the area as trees (see above): every ring oriented with the deeper side on its
 * left, so the line keeps turning the same way from ring to ring.
 */
function ringTree(r: Region, field: Field, s: number, pull: number): Ring[] {
  const first = Math.min(pull, s / 2) - s / 2;
  const roots: Ring[] = [];
  let prev: Ring[] = [];
  for (let k = 0; ; k++) {
    const level = first - k * s;
    const loops = outline(r, level, r.sdf) as Pt[][];
    if (!loops.length) break;
    const rings: Ring[] = [];
    let left = 0;
    for (const l of loops) {
      const ring = { pts: orient(field, simplify(l, 0.02)), k, depth: -level, kids: [], out: s };
      if (pathLength(l) < MIN_RING || sliver(field, ring)) left += pathLength(l);
      else rings.push(ring);
    }
    for (const ring of rings) field.add(ring);
    // Where the ridge lies only just deeper than this ring, its level line falls apart into bits
    // and slivers. A level a quarter spacing further out gives whole rings there instead.
    if (k && left >= MIN_RING) {
      for (const l of outline(r, level + s / 4, r.sdf) as Pt[][]) {
        if (pathLength(l) < MIN_RING) continue;
        const ring = { pts: orient(field, simplify(l, 0.02)), k, depth: -level - s / 4, kids: [], out: s };
        const n = ring.pts.length - 1;
        let by = 0;
        for (let j = 0; j < 8; j++) if (field.near(k, ring.pts[Math.floor((n * j) / 8)], -level)) by++;
        if (by > 2 || sliver(field, ring)) continue;
        rings.push(ring);
        field.add(ring);
      }
    }
    for (const ring of rings) {
      const parent = k ? parentOf(field, ring, prev, s) : null;
      if (parent) {
        parent.kids.push(ring);
        ring.out = ring.depth - parent.depth;
      }
      else roots.push(ring);
    }
    if (!rings.length) break;
    prev = rings;
  }
  return roots;
}

/** Whether the ring is only a thin sliver along a ridge: nowhere deeper inside than a fraction of a spacing. */
function sliver(field: Field, ring: Ring): boolean {
  const n = ring.pts.length - 1;
  const most = ring.depth + (SLIVER / 2) * field.s;
  for (let j = 0; j < 8; j++) {
    const w = field.walk(ring.pts[Math.floor((n * j) / 8)], most);
    if (w.d[w.d.length - 1] >= most - 1e-3) return false;
  }
  return true;
}

/** The loop turned, if needed, so that the deeper side lies on its left. */
function orient(field: Field, pts: Pt[]): Pt[] {
  let sum = 0;
  const n = pts.length - 1;
  const every = Math.max(1, Math.floor(n / 16));
  for (let i = 0; i < n; i += every) {
    const a = pts[i];
    const b = pts[i + 1];
    const l = dist(a, b);
    if (l < 1e-6) continue;
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const left: Pt = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    sum += field.depth([m[0] + left[0] * 0.1, m[1] + left[1] * 0.1]) - field.depth([m[0] - left[0] * 0.1, m[1] - left[1] * 0.1]);
  }
  return sum >= 0 ? pts : pts.slice().reverse();
}

/**
 * The ring one spacing further out that this ring lies in: where a few of its points end up when
 * moved out along the gradient by a spacing (nearness alone would mix up the two sides of a ridge).
 */
function parentOf(field: Field, ring: Ring, candidates: Ring[], s: number): Ring | null {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const score = new Array(candidates.length).fill(0);
  const n = ring.pts.length - 1;
  for (let j = 0; j < 5; j++) {
    const out = field.reach(ring.pts[Math.floor((n * j) / 5)], ring.depth - s);
    candidates.forEach((c, i) => (score[i] += nearestOn(c.pts, out).d));
  }
  return candidates[score.indexOf(Math.min(...score))];
}

/** Nearest point of a polyline to q: the point, its segment and its distance. */
function nearestOn(pts: Pt[], q: Pt): { pt: Pt; i: number; d: number } {
  let best = { pt: pts[0], i: 0, d: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
    const pt: Pt = [a[0] + dx * t, a[1] + dy * t];
    const d = dist(pt, q);
    if (d < best.d) best = { pt, i: i - 1, d };
  }
  return best;
}

function nearestRing(rings: Ring[], q: Pt): number {
  let bi = 0;
  let bd = Infinity;
  rings.forEach((ring, i) => {
    const d = nearestOn(ring.pts, q).d;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return bi;
}

/** The closed ring starting (and ending) at its point nearest `seam`, resampled finely. */
function rolled(ring: Ring, seam: Pt): Pt[] {
  const near = nearestOn(ring.pts, seam);
  const open = ring.pts.slice(0, -1);
  const k = near.i + 1;
  const loop = [near.pt, ...open.slice(k), ...open.slice(0, k), near.pt];
  const out: Pt[] = [loop[0]];
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1];
    const b = loop[i];
    const n = Math.ceil(dist(a, b) / RESAMPLE);
    for (let j = 1; j <= n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return out;
}

/**
 * Shift of a contour ring's points in spacings at share f of its length: none, but for a ramp
 * from -1/2 to +1/2 over a few millimetres round its start (see above).
 */
function ramp(f: number, length: number): number {
  const a = Math.min(0.1, RAMP / length);
  if (f < a) return -0.5 + (0.5 * f) / a;
  if (f > 1 - a) return (0.5 * (f - 1 + a)) / a;
  return 0;
}

/**
 * The line from `ring` inwards, ring after ring, until a ring with nothing inside; it starts at
 * `seam` on the first ring and ends in the middle. Where rings branch, it goes on into the one
 * straight ahead; the others are added to `branches`.
 *
 * A spiral's turns lie between rings, so beside a ring that is not part of it (the edge, a branch
 * sewn on its own) the gap would open and close by half a spacing round the turn. There it is sewn
 * as rings instead, turning into the spiral over a few rings: neighbouring turns differ by little,
 * so they stay about a spacing apart.
 */
function chain(field: Field, ring: Ring, seam: Pt, mode: RingMode, branches: Ring[]): Line {
  const s = field.s;
  // The rings of the line and where each begins.
  const steps: { ring: Ring; at: Pt }[] = [];
  let cur: Ring | null = ring;
  let at = seam;
  while (cur) {
    steps.push({ ring: cur, at });
    // On the gradient line through the start, the next ring begins where it crosses it.
    const start: Pt = nearestOn(cur.pts, at).pt;
    const next: Ring | null = cur.kids.length ? cur.kids[nearestRing(cur.kids, field.reach(start, cur.depth + s))] : null;
    for (const kid of cur.kids) if (kid !== next) branches.push(kid);
    if (next) at = field.reach(start, next.depth);
    cur = next;
  }
  // How much each ring is sewn as a ring rather than a spiral turn: fully at the first one and where
  // branches leave, less and less over BLEND rings from there.
  const ringness = steps.map(() => 0);
  steps.forEach((st, k) => {
    if (k > 0 && st.ring.kids.length < 2) return;
    for (let j = 0; j < steps.length; j++) ringness[j] = Math.max(ringness[j], 1 - Math.abs(j - k) / BLEND);
  });
  const line: Line = { pts: [], turns: [] };
  steps.forEach(({ ring: cur, at }, k) => {
    // Out to the ring before and in to the next one (a quarter spacing less to a ring further out, see ringTree).
    const before = k ? cur.depth - steps[k - 1].ring.depth : s;
    const after = k + 1 < steps.length ? steps[k + 1].ring.depth - cur.depth : s;
    const pts = rolled(cur, at);
    const path = new Path(pts);
    const total = path.total || 1;
    const w = mode === 'contour' ? 1 : ringness[k];
    line.turns.push(Math.max(0, line.pts.length - 1));
    const spots = pts.map((q, i) => {
      const f = path.cum[i] / total;
      let phi = (1 - w) * (f - 0.5) + w * ramp(f, total);
      // The first ring does not reach out past itself (it lies at the edge, or beside rows sewn before).
      if (k === 0) phi = Math.max(0, phi);
      return field.spot(q, cur, phi * (phi < 0 ? before : after));
    });
    // The moves along the ridge evened out over a millimetre or so: the ridge found is uneven.
    const n = spots.length;
    for (let i = k ? 1 : 0; i < n; i++) {
      let sum = 0;
      for (let j = -SMOOTH; j <= SMOOTH; j++) sum += spots[Math.min(n - 1, Math.max(0, i + j))].move;
      line.pts.push(field.moved(spots[i], sum / (2 * SMOOTH + 1)));
    }
  });
  return line;
}
