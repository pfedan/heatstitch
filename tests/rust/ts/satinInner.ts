// The TypeScript implementation before stage 1c moved it to the Rust core, kept for the
// differential test (tests/rust/stage1c.test.ts) while both exist.
import { leaving, medialAxis, type Axis, type AxisBranch, type AxisNode } from './medial';
import type { Pt } from './skeleton';

/**
 * Satin over a whole area (a star, a block letter, a ring, a blob with holes), cut into columns
 * along its medial axis (see medial.ts) the way a digitizer cuts it:
 *
 * - each branch of the axis is a column, its stitches along the ribs of the axis (the lines where
 *   the largest circles touch the outline), so they run square across an arm and fan where it bends;
 * - where branches meet, the two that go on straightest run through as one column if their widths
 *   go together (the stem and one arm of a Y, the bar of a T); every other branch ends on it, cut
 *   along the junction's own triangle (from notch to notch). Where none goes on straight (the
 *   middle of a star) the junction is a hub: a column of its own, all arms cut off at its edge;
 * - a sharp bend between two long sides (the corner of a U) is cut on the miter, from the pruned
 *   corner outside to the notch inside;
 * - a ring without branches is opened once.
 *
 * The result is cut lines and lines across, as the satin tool draws them by hand (see
 * satinSuggest), so the existing machinery makes the columns, sews them in one chain and the user
 * can change them afterwards.
 */

/**
 * Two branches at a junction run through when they turn less than this (degrees): at a fork of
 * three (a Y) the straightest pair goes on, the hub between them being small; where more meet (a
 * star) only a pair that goes on almost straight (a crossing).
 */
const THROUGH_DEG = 55;
const THROUGH_MANY_DEG = 25;
/** ... and their widths differ by less than this factor. */
const THROUGH_WIDTH = 2.5;
/** A line across every this much along an arm (mm), and where its direction turns by TURN_DEG. */
const LINE_STEP = 2.5;
const TURN_DEG = 12;
/** Ribs shorter than this share of their branch's widest are the fan at a point: no line across there. */
const TIP_SHARE = 0.3;
/** Lines across starting this near where a cut line starts are left out (mm). */
const CUT_CLEAR = 0.25;
/** Two lines across a short part at least this far apart (mm). */
const SHORT_APART = 0.6;
/** Lines across stay this far out of a junction's circle (share of its radius). */
const NODE_CLEAR = 1.05;
/** A column at most this many times the satin limit wide (its long stitches are split, see SatinSettings.split). */
const WIDE = 3;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];

/** A chord pulled in a little at both ends, so it starts and ends just inside the outline. */
function inset([a, b]: [Pt, Pt], k = 0.01): [Pt, Pt] {
  const d = sub(b, a);
  return [
    [a[0] + d[0] * k, a[1] + d[1] * k],
    [b[0] - d[0] * k, b[1] - d[1] * k],
  ];
}

export interface InnerPlan {
  cuts: [Pt, Pt][];
  lines: [Pt, Pt][];
  /** The axis it was planned on (for opening a hole still closed, see satinSuggest). */
  axis: Axis;
}

/** Cut lines and lines across for the area; null when it has no axis to cut along or is too wide for satin. */
export function planInner(outsides: Pt[][], holes: Pt[][], max: number): InnerPlan | null {
  const axis = medialAxis(outsides, holes);
  const { nodes, branches } = axis;
  if (!branches.length) return null;
  const degree = new Array(nodes.length).fill(0);
  for (const b of branches) {
    degree[b.a]++;
    degree[b.b]++;
  }
  const cuts: [Pt, Pt][] = [];
  const lines: [Pt, Pt][] = [];
  const hubs: number[] = [];
  // Branch ends cut off at a junction: no lines across inside its circle there.
  const cutEnds = new Set<string>();
  const endKey = (b: AxisBranch, atA: boolean) => `${branches.indexOf(b)}${atA ? 'a' : 'b'}`;

  nodes.forEach((node, n) => {
    const at = branches.filter((b) => b.a === n || b.b === n);
    if (degree[n] >= 3) {
      // Each end of a branch here (a loop through the node counts twice).
      const ends: { b: AxisBranch; atA: boolean; dir: Pt; w: number }[] = [];
      for (const b of at) {
        const both = b.a === n && b.b === n;
        ends.push({ b, atA: b.a === n, dir: leaving(b, n, node.r), w: widthNear(b, n === b.a) });
        if (both) ends.push({ b, atA: false, dir: leaving({ ...b, a: -1 }, n, node.r), w: widthNear(b, false) });
      }
      const pair = throughPair(ends, ends.length > 3 ? THROUGH_MANY_DEG : THROUGH_DEG);
      ends.forEach((e, i) => {
        if (pair && (i === pair[0] || i === pair[1])) return;
        cuts.push(inset(e.atA ? e.b.ribs[0] : e.b.ribs[e.b.ribs.length - 1]));
        cutEnds.add(endKey(e.b, e.atA));
      });
      if (!pair) hubs.push(n);
      return;
    }
    if (degree[n] === 2 && node.tips.length) {
      const cut = miter(axis, node);
      if (cut) cuts.push(cut);
    }
  });

  // A loop with no node but its own (a ring): opened once, where it is narrowest.
  for (const b of branches) {
    if (b.a !== b.b || degree[b.a] !== 2) continue;
    let k = 0;
    b.ribs.forEach((r, i) => {
      if (dist(r[0], r[1]) < dist(b.ribs[k][0], b.ribs[k][1])) k = i;
    });
    cuts.push(inset(b.ribs[k]));
  }

  let widest = 0;
  for (const b of branches) {
    const made = linesAlong(b, nodes, cutEnds.has(endKey(b, true)), cutEnds.has(endKey(b, false)));
    lines.push(...made.lines);
    widest = Math.max(widest, made.widest);
  }
  // A line across that starts where a cut line does would meet it on the outline: which side of
  // the cut it lies on is then a matter of rounding.
  const ends = cuts.flat();
  const apart = lines.filter((l) => l.every((q) => ends.every((e) => dist(e, q) > CUT_CLEAR)));
  for (const n of hubs) {
    const hub = hubLines(axis, nodes[n]);
    if (!hub) return null;
    apart.push(...hub.lines);
    widest = Math.max(widest, hub.width);
  }
  // An area whose axis is a point (a square, a disc) or that is too wide stays a fill.
  if (widest > WIDE * max) return null;
  return { cuts, lines: apart, axis };
}

/** The width of a branch next to its end (`atA`: its end a), past the junction's circle. */
function widthNear(b: AxisBranch, atA: boolean): number {
  const ribs = atA ? b.ribs : b.ribs.slice().reverse();
  const r0 = atA ? b.r[0] : b.r[b.r.length - 1];
  const start = atA ? b.pts[0] : b.pts[b.pts.length - 1];
  for (const r of ribs) if (dist(mid(r[0], r[1]), start) > r0) return dist(r[0], r[1]);
  return 2 * r0;
}

/** Of the branch ends at a junction, the two that go on straightest when they go together, else null. */
function throughPair(ends: { dir: Pt; w: number }[], deg: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestDot = -Math.cos((deg * Math.PI) / 180);
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const d = dot(ends[i].dir, ends[j].dir);
      const ratio = Math.max(ends[i].w, ends[j].w) / Math.max(1e-6, Math.min(ends[i].w, ends[j].w));
      if (d < bestDot && ratio < THROUGH_WIDTH) {
        bestDot = d;
        best = [i, j];
      }
    }
  }
  return best;
}

/** The miter at a bend: from the corner pruned outside through the bend to the farthest point its circle touches. */
function miter(axis: Axis, node: AxisNode): [Pt, Pt] | null {
  const tip = node.tips[0];
  const t = node.tris[0];
  let far: Pt | null = null;
  for (let k = 0; k < 3; k++) {
    const q = axis.points[axis.tris[3 * t + k]];
    if (!far || dist(q, tip) > dist(far, tip)) far = q;
  }
  return far ? inset([tip, far]) : null;
}

/**
 * Lines across along a branch: ribs every LINE_STEP and where they turn, not in the fan of a point,
 * and out of the circle of a junction where the branch is cut off (`cutA`, `cutB`: at its ends).
 */
function linesAlong(b: AxisBranch, nodes: AxisNode[], cutA: boolean, cutB: boolean): { lines: [Pt, Pt][]; widest: number } {
  const lens = b.ribs.map((r) => dist(r[0], r[1]));
  const widest = Math.max(0, ...lens);
  // How far a point is out of the circles it has to keep out of (Infinity: none).
  const room = (q: Pt) =>
    Math.min(
      cutA ? dist(q, nodes[b.a].p) - NODE_CLEAR * nodes[b.a].r : Infinity,
      cutB ? dist(q, nodes[b.b].p) - NODE_CLEAR * nodes[b.b].r : Infinity,
    );
  const out: [Pt, Pt][] = [];
  let since = Infinity;
  let lastDir: Pt | null = null;
  for (let i = 0; i < b.ribs.length; i++) {
    since += dist(b.pts[i], b.pts[i + 1]);
    const r = b.ribs[i];
    if (lens[i] < TIP_SHARE * widest || room(mid(r[0], r[1])) <= 0) continue;
    const d = sub(r[1], r[0]);
    const l = Math.hypot(d[0], d[1]) || 1;
    const dir: Pt = [d[0] / l, d[1] / l];
    const turned = lastDir && Math.abs(dot(dir, lastDir)) < Math.cos((TURN_DEG * Math.PI) / 180);
    if (since >= LINE_STEP || turned) {
      out.push(inset(r));
      since = 0;
      lastDir = dir;
    }
  }
  // A branch cut off at both ends and too short for two lines out of the circles: the two ribs
  // with most room, at least SHORT_APART apart, so the part still has a direction to turn between.
  if (out.length < 2 && cutA && cutB) {
    const fit = lens.map((_, i) => i).filter((i) => lens[i] >= TIP_SHARE * widest);
    const roomOf = (i: number) => room(mid(b.ribs[i][0], b.ribs[i][1]));
    const sorted = fit.slice().sort((x, y) => roomOf(y) - roomOf(x));
    const first = sorted[0];
    const second = sorted.find((i) => dist(mid(b.ribs[i][0], b.ribs[i][1]), mid(b.ribs[first][0], b.ribs[first][1])) >= SHORT_APART);
    if (first !== undefined && second !== undefined) return { lines: [first, second].sort((x, y) => x - y).map((i) => inset(b.ribs[i])), widest };
  }
  return { lines: out, widest };
}

/** The outline of a hub: the edges of its triangles that no other of them shares, as one closed line. */
function hubLoop(axis: Axis, node: AxisNode): Pt[] | null {
  const count = new Map<string, number>();
  const edges: [number, number][] = [];
  for (const t of node.tris) {
    for (let k = 0; k < 3; k++) {
      const a = axis.tris[3 * t + k];
      const b = axis.tris[3 * t + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
      edges.push([a, b]);
    }
  }
  const outer = edges.filter(([a, b]) => count.get(a < b ? `${a},${b}` : `${b},${a}`) === 1);
  if (outer.length < 3) return null;
  const from = new Map(outer.map(([a, b]) => [a, b]));
  const loop: Pt[] = [];
  let at = outer[0][0];
  for (let guard = 0; guard <= outer.length; guard++) {
    loop.push(axis.points[at]);
    const nextAt = from.get(at);
    if (nextAt === undefined) return null;
    at = nextAt;
    if (at === outer[0][0]) return loop.length === outer.length ? loop : null;
  }
  return null;
}

/** The piece of the line through o along d that lies inside the closed line `loop` round o. */
function clipThrough(loop: Pt[], o: Pt, d: Pt): [Pt, Pt] | null {
  let lo = -Infinity;
  let hi = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const e = sub(b, a);
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(a, o);
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const u = (w[0] * d[1] - w[1] * d[0]) / den;
    if (u < 0 || u > 1) continue;
    if (t > 0 && t < hi) hi = t;
    if (t < 0 && t > lo) lo = t;
  }
  if (!isFinite(lo) || !isFinite(hi)) return null;
  return inset([
    [o[0] + d[0] * lo, o[1] + d[1] * lo],
    [o[0] + d[0] * hi, o[1] + d[1] * hi],
  ]);
}

/**
 * Lines across a hub along its narrowest way (the direction of least width, rotating calipers
 * over its corners): the shortest stitches, square to a side of a star's middle. With its width.
 */
function hubLines(axis: Axis, node: AxisNode): { lines: [Pt, Pt][]; width: number } | null {
  const loop = hubLoop(axis, node);
  if (!loop) return null;
  const hull = convexHull(loop);
  // The least width of a convex polygon is across one of its sides.
  let best = { width: Infinity, d: [1, 0] as Pt };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const l = dist(a, b);
    if (l < 1e-9) continue;
    const n: Pt = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    const w = Math.max(...hull.map((p) => Math.abs(dot(sub(p, a), n))));
    // Of sides about as narrow (a regular star's middle), stitches upright: the star stays mirror-like.
    const tie = Math.abs(w - best.width) < 0.02 * w;
    if (tie ? Math.abs(n[1]) > Math.abs(best.d[1]) : w < best.width) best = { width: Math.min(w, best.width), d: n };
  }
  const d = best.d;
  const e: Pt = [-d[1], d[0]];
  const c: Pt = [0, 0];
  for (const p of loop) [c[0], c[1]] = [c[0] + p[0] / loop.length, c[1] + p[1] / loop.length];
  const along = loop.map((p) => dot(sub(p, c), e));
  const [lo, hi] = [Math.min(...along), Math.max(...along)];
  const lines: [Pt, Pt][] = [];
  for (const f of [0.2, 0.5, 0.8]) {
    const s = lo + (hi - lo) * f;
    const line = clipThrough(loop, [c[0] + e[0] * s, c[1] + e[1] * s], d);
    if (line) lines.push(line);
  }
  return lines.length >= 2 ? { lines, width: best.width } : null;
}

/** Convex hull (Andrew's monotone chain). */
function convexHull(pts: Pt[]): Pt[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of p.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
