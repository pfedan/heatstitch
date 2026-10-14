import { triangulate } from '../shape/cdt';
import type { Branch, Graph, Pt } from './skeleton';

/**
 * The medial axis of an area on its vector outline, for satin over a whole area (see satinInner).
 *
 * The discrete Voronoi skeleton of Ogniewicz and Ilg (1992), the method StrokeStyles (Berio et al.,
 * ACM TOG 2022) builds on: the outline is sampled densely, its constrained Delaunay triangulation
 * (shape/cdt) gives the Voronoi diagram of the samples inside the area (a vertex at each
 * triangle's circumcenter, an edge across each inner triangle edge), and of the Voronoi edges only
 * those are kept whose two samples lie far apart along the outline compared to straight across:
 * the chord residual, outline distance minus chord, at least RESIDUAL. That drops the hairs every
 * sample would grow and keeps the axis connected, with one loop round each hole.
 *
 * Each kept edge has its chord: the line between the two samples it is equidistant from, where
 * the largest circle inside the area touches the outline (a rib). Along an arm the ribs are the
 * directions a satin across it takes.
 *
 * Then end branches that hardly reach beyond the circle of the junction they hang from (the
 * corners of a rectangle) are pruned, iteratively (a scale axis criterion, see PROTRUDE), and
 * junctions within each other's circles are joined into one (the middle of a star).
 */

/** Spacing of the outline samples (mm). */
const STEP = 0.15;
/** A Voronoi edge is kept when its two samples are this much farther apart along the outline than across (mm). */
const RESIDUAL = 0.25;
/**
 * An end branch is kept when its circles reach this many junction radii beyond the junction's
 * circle: a 90° corner reaches 0.41, a 60° corner 1, the point of a star more.
 */
const PROTRUDE = 0.55;

export interface AxisBranch extends Branch {
  /** The rib at each step from pts[i] to pts[i + 1]: where the circles there touch the outline. */
  ribs: [Pt, Pt][];
  /** The triangle of each point (its circumcenter). */
  tris: number[];
}

export interface AxisNode {
  p: Pt;
  r: number;
  /** The triangles the node stands for: one, or a junction joined from several (a hub). */
  tris: number[];
  /** Ends of branches pruned here (corners beside the axis): where a bend is mitered to. */
  tips: Pt[];
}

export interface Axis extends Graph {
  nodes: AxisNode[];
  branches: AxisBranch[];
  /** The triangulation's points and triangles (three point indices each), for the area of a hub. */
  points: Pt[];
  tris: number[];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The outlines sampled every STEP or less, each point with its loop and distance along it. */
function sampled(loops: Pt[][], step: number): { pts: Pt[][]; at: { loop: number; s: number; len: number }[] } {
  const pts: Pt[][] = [];
  const at: { loop: number; s: number; len: number }[] = [];
  loops.forEach((l, k) => {
    const ring = l.length > 1 && dist(l[0], l[l.length - 1]) < 1e-9 ? l.slice(0, -1) : l;
    const out: Pt[] = [];
    const ss: number[] = [];
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const d = dist(a, b);
      const n = Math.max(1, Math.ceil(d / step));
      for (let j = 0; j < n; j++) {
        out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
        ss.push(s + (d * j) / n);
      }
      s += d;
    }
    pts.push(out);
    for (const x of ss) at.push({ loop: k, s: x, len: s });
  });
  return { pts, at };
}

/** Circumcenter and radius of a triangle. */
function circle(a: Pt, b: Pt, c: Pt): { p: Pt; r: number } {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const cx = c[0] - a[0];
  const cy = c[1] - a[1];
  const d = 2 * (bx * cy - by * cx);
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  return { p: [a[0] + ux, a[1] + uy], r: Math.hypot(ux, uy) };
}

/** The medial axis of the area inside `outsides` and outside `holes` (closed lines in mm). */
export function medialAxis(outsides: Pt[][], holes: Pt[][] = []): Axis {
  const loops = [...outsides, ...holes].filter((l) => l.length > 2);
  const { pts, at } = sampled(loops, STEP);
  const T = triangulate(pts);
  const P = T.points;
  // Per point of the triangulation: where it lies on the outlines (its first sample).
  const where: { loop: number; s: number; len: number }[] = new Array(P.length);
  T.index.forEach((id, i) => (where[id] ??= at[i]));
  const nt = T.tris.length / 3;
  const cc = Array.from({ length: nt }, (_, t) => circle(P[T.tris[3 * t]], P[T.tris[3 * t + 1]], P[T.tris[3 * t + 2]]));
  const tri = (e: number) => (e - (e % 3)) / 3;
  const nxt = (e: number) => (e % 3 === 2 ? e - 2 : e + 1);

  // The Voronoi edges kept by their chord residual.
  const adj: { u: number; e: number }[][] = Array.from({ length: nt }, () => []);
  for (let e = 0; e < T.tris.length; e++) {
    const f = T.twin[e];
    if (f < e || T.fixed[e]) continue;
    const a = T.tris[e];
    const b = T.tris[nxt(e)];
    const wa = where[a];
    const wb = where[b];
    let along = Infinity;
    if (wa && wb && wa.loop === wb.loop) {
      const d = Math.abs(wa.s - wb.s);
      along = Math.min(d, wa.len - d);
    }
    if (along - dist(P[a], P[b]) < RESIDUAL) continue;
    adj[tri(e)].push({ u: tri(f), e });
    adj[tri(f)].push({ u: tri(e), e: f });
  }

  // Nodes where the axis ends or branches; branches between them.
  const nodeOf = new Int32Array(nt).fill(-1);
  const nodes: AxisNode[] = [];
  const addNode = (t: number) => {
    nodeOf[t] = nodes.length;
    nodes.push({ p: cc[t].p, r: cc[t].r, tris: [t], tips: [] });
    return nodeOf[t];
  };
  for (let t = 0; t < nt; t++) if (adj[t].length && adj[t].length !== 2) addNode(t);
  let branches: AxisBranch[] = [];
  const used = new Set<number>();
  const rib = (e: number): Pt => P[T.tris[e]];
  const walk = (start: number, first: { u: number; e: number }) => {
    const ptsOut: Pt[] = [cc[start].p];
    const r: number[] = [cc[start].r];
    const ribs: [Pt, Pt][] = [];
    const tris: number[] = [start];
    let prev = start;
    let step = first;
    for (let guard = 0; guard <= nt; guard++) {
      used.add(Math.min(step.e, T.twin[step.e]));
      ribs.push([rib(step.e), rib(nxt(step.e))]);
      const t = step.u;
      ptsOut.push(cc[t].p);
      r.push(cc[t].r);
      tris.push(t);
      if (nodeOf[t] >= 0) return branches.push({ a: nodeOf[start], b: nodeOf[t], pts: ptsOut, r, ribs, tris });
      // On through a triangle of the branch: by the other kept edge.
      step = adj[t][0].u === prev ? adj[t][1] : adj[t][0];
      prev = t;
    }
  };
  for (let t = 0; t < nt; t++) {
    if (nodeOf[t] < 0) continue;
    for (const x of adj[t]) if (!used.has(Math.min(x.e, T.twin[x.e]))) walk(t, x);
  }
  // Loops without a branch point (a ring): a node anywhere on them.
  for (let t = 0; t < nt; t++) {
    if (adj[t].length !== 2 || nodeOf[t] >= 0 || adj[t].every((x) => used.has(Math.min(x.e, T.twin[x.e])))) continue;
    addNode(t);
    walk(t, adj[t][0]);
  }

  // Pruning end branches that hardly reach beyond their junction's circle, again while any does.
  const degree = () => {
    const d = new Array(nodes.length).fill(0);
    for (const b of branches) {
      d[b.a]++;
      d[b.b]++;
    }
    return d;
  };
  for (let changed = true; changed; ) {
    changed = false;
    const d = degree();
    // Shortest first, so of two spurs at one corner the lesser goes.
    const ends = branches.filter((b) => b.a !== b.b && (d[b.a] === 1) !== (d[b.b] === 1)).sort((x, y) => reach(x, nodes) - reach(y, nodes));
    for (const b of ends) {
      const j = d[b.a] === 1 ? b.b : b.a;
      if (d[j] < 2 || reach(b, nodes) >= PROTRUDE * nodes[j].r) continue;
      nodes[j].tips.push(tipOf(b, j === b.a));
      branches = branches.filter((x) => x !== b);
      d[b.a]--;
      d[b.b]--;
      changed = true;
    }
    // Nodes left between two branches join them (the bend keeps its pruned tips, see bends).
    for (let n = 0; n < nodes.length; n++) {
      const at = branches.filter((b) => b.a === n || b.b === n);
      if (at.length !== 2 || at[0] === at[1] || at.some((b) => b.a === b.b)) continue;
      // A corner pruned here stays a node where the axis bends sharply between two long sides (the
      // corner of a U, mitered there); else (the slanted foot of a leg) the line goes on.
      if (nodes[n].tips.length && isBend(nodes[n], at[0], at[1], branches, n)) continue;
      nodes[n].tips = [];
      const [p, q] = at;
      const pIn = p.b === n ? p : reversed(p);
      const qOut = q.a === n ? q : reversed(q);
      branches = branches.filter((b) => b !== p && b !== q).concat([{ a: pIn.a, b: qOut.b, pts: [...pIn.pts, ...qOut.pts.slice(1)], r: [...pIn.r, ...qOut.r.slice(1)], ribs: [...pIn.ribs, ...qOut.ribs], tris: [...pIn.tris, ...qOut.tris.slice(1)] }]);
      changed = true;
    }
  }

  // Junctions within each other's circles are one (the middle of a star, several triangles).
  const d = degree();
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of branches) {
      if (b.a === b.b || d[b.a] < 3 || d[b.b] < 3) continue;
      const [na, nb] = [nodes[b.a], nodes[b.b]];
      if (dist(na.p, nb.p) >= Math.max(na.r, nb.r)) continue;
      // b.b joins b.a: its branches now start there, the triangles between are the hub's.
      const keep = na.r >= nb.r ? b.a : b.b;
      const gone = keep === b.a ? b.b : b.a;
      const inner = b.tris.slice(1, -1);
      nodes[keep].tris.push(...nodes[gone].tris, ...inner);
      nodes[keep].tips.push(...nodes[gone].tips);
      branches = branches.filter((x) => x !== b).map((x) => ({ ...x, a: x.a === gone ? keep : x.a, b: x.b === gone ? keep : x.b }));
      d[keep] += d[gone] - 2;
      d[gone] = 0;
      changed = true;
      break;
    }
  }
  // Nodes no branch uses any more are left out, the others numbered anew.
  const usedNodes = new Map<number, number>();
  const out: AxisNode[] = [];
  for (const b of branches) {
    for (const n of [b.a, b.b]) {
      if (usedNodes.has(n)) continue;
      usedNodes.set(n, out.length);
      out.push(nodes[n]);
    }
  }
  // An area whose axis was pruned to nothing (a square, a disc): its middle as one node.
  if (!out.length && nt) {
    let best = 0;
    for (let t = 1; t < nt; t++) if (cc[t].r > cc[best].r && adj[t].length) best = t;
    out.push({ p: cc[best].p, r: cc[best].r, tris: [best], tips: [] });
  }
  return {
    nodes: out,
    branches: branches.map((b) => ({ ...b, a: usedNodes.get(b.a)!, b: usedNodes.get(b.b)! })),
    points: P,
    tris: T.tris,
  };
}

/** A bend at least this sharp (degrees) between two sides is mitered. */
export const BEND_DEG = 45;

/** The direction a branch leaves node n in, over about the node's radius. */
export function leaving(b: AxisBranch, n: number, r: number): Pt {
  const pts = b.a === n ? b.pts : b.pts.slice().reverse();
  const reachMm = Math.max(r, 0.5);
  let q = pts[pts.length - 1];
  for (let i = 1; i < pts.length; i++) {
    if (dist(pts[i], pts[0]) >= reachMm) {
      q = pts[i];
      break;
    }
  }
  const l = dist(q, pts[0]) || 1;
  return [(q[0] - pts[0][0]) / l, (q[1] - pts[0][1]) / l];
}

/** Whether node n between branches p and q is a sharp bend with a long side either way (not a free end close by). */
function isBend(node: AxisNode, p: AxisBranch, q: AxisBranch, all: AxisBranch[], n: number): boolean {
  const u = leaving(p, n, node.r);
  const v = leaving(q, n, node.r);
  const turn = 180 - (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI;
  if (turn < BEND_DEG) return false;
  // A side ending freely within the node's circle and a radius more is the end of the line, not a side.
  const free = (b: AxisBranch) => {
    const other = b.a === n ? b.b : b.a;
    if (all.some((x) => x !== b && (x.a === other || x.b === other))) return false;
    return Math.max(...b.pts.map((pt) => dist(pt, node.p))) < 2 * node.r;
  };
  return !free(p) && !free(q);
}

/** How far the circles of an end branch reach beyond the circle of its junction (mm). */
function reach(b: AxisBranch, nodes: AxisNode[]): number {
  // The junction is the end that is not free; either end may be, so both are tried.
  const ra = Math.max(...b.pts.map((p, i) => dist(p, nodes[b.a].p) + b.r[i])) - nodes[b.a].r;
  const rb = Math.max(...b.pts.map((p, i) => dist(p, nodes[b.b].p) + b.r[i])) - nodes[b.b].r;
  return Math.min(ra, rb);
}

/** The farthest point an end branch reaches from its junction (`fromA`: the junction is its end a). */
function tipOf(b: AxisBranch, fromA: boolean): Pt {
  const end = fromA ? b.pts.length - 1 : 0;
  const rib = b.ribs[fromA ? b.ribs.length - 1 : 0];
  // At the free end the two samples of the last rib lie either side of the corner: their middle.
  return rib ? [(rib[0][0] + rib[1][0]) / 2, (rib[0][1] + rib[1][1]) / 2] : b.pts[end];
}

export function reversed(b: AxisBranch): AxisBranch {
  return { a: b.b, b: b.a, pts: b.pts.slice().reverse(), r: b.r.slice().reverse(), ribs: b.ribs.slice().reverse().map(([x, y]) => [y, x]), tris: b.tris.slice().reverse() };
}
