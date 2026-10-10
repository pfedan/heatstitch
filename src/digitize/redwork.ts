import { JOIN_SNAP_MM } from '../shape/join';
import type { Pt } from './skeleton';

/**
 * Redwork: a drawing of many lines sewn in one go, each line exactly twice (there and back),
 * without a trim inside a connected part.
 *
 * 1. The lines are made a planar graph: split where they cross or touch, and where lines that do
 *    not touch come within `snap` of each other a straight piece bridges the gap.
 * 2. Every edge doubled, one copy each way: in the symmetric graph every node has as many ways in
 *    as out, so it has an Euler circuit (Euler, Hierholzer) in every connected part.
 * 3. The circuit taken is Tarry's depth first traversal (G. Tarry 1895, the classic maze walk that
 *    goes every edge once in each direction): an edge is left back the way it came only once all
 *    edges beyond it are sewn. So the first pass over an edge lies below and its return comes as
 *    late as it can, on top (the order Ink/Stitch's redwork aims at too). At each node the walk goes
 *    on as straight as it can, so the first pass follows the drawn lines.
 *
 * Parts that do not touch are sewn one after the other, each from its node nearest the needle,
 * with a jump (and a trim when far) between them, as before.
 */

/** Points this close (mm) are one node: crossings found twice, ends that meet. */
const MERGE = 0.05;

/**
 * Gaps up to this (mm) are bridged with a stitch: the snap of joining paths (JOIN_SNAP_MM). About a
 * thread wide, so a bridge does not show as a line of its own, while lines drawn apart on purpose
 * (a stitch length, 2.5 mm, and more) stay apart.
 */
export const REDWORK_GAP = JOIN_SNAP_MM;

/** Nodes this close (mm) along a line between them are one: about a stitch too short to sew (see contract). */
const NODE = 0.5;

export interface RedworkLine {
  pts: Pt[];
  closed: boolean;
}

/** The graph of the lines: nodes and the edges between them, each a polyline from node a to node b. */
export interface RedworkGraph {
  nodes: Pt[];
  edges: { a: number; b: number; pts: Pt[] }[];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Points within MERGE as one: a grid of cells MERGE wide, looked up in the cell and its neighbours. */
class Points {
  list: Pt[] = [];
  private cells = new Map<string, number[]>();
  id(q: Pt): number {
    const cx = Math.floor(q[0] / MERGE);
    const cy = Math.floor(q[1] / MERGE);
    let best = -1;
    let bd = MERGE;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = dist(this.list[i], q);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
    if (best >= 0) return best;
    this.list.push([q[0], q[1]]);
    const k = `${cx},${cy}`;
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k)!.push(this.list.length - 1);
    return this.list.length - 1;
  }
}

/** Segments in a grid of cells `size` wide, by their bounding box. */
class SegGrid {
  private cells = new Map<string, number[]>();
  constructor(private size: number) {}
  private range(a: Pt, b: Pt, pad: number): [number, number, number, number] {
    const s = this.size;
    return [Math.floor((Math.min(a[0], b[0]) - pad) / s), Math.floor((Math.min(a[1], b[1]) - pad) / s), Math.floor((Math.max(a[0], b[0]) + pad) / s), Math.floor((Math.max(a[1], b[1]) + pad) / s)];
  }
  add(i: number, a: Pt, b: Pt): void {
    const [x0, y0, x1, y1] = this.range(a, b, 0);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k)!.push(i);
      }
  }
  near(a: Pt, b: Pt, pad: number): Set<number> {
    const out = new Set<number>();
    const [x0, y0, x1, y1] = this.range(a, b, pad);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const i of this.cells.get(`${x},${y}`) ?? []) out.add(i);
    return out;
  }
}

/** Where `q` is nearest on segment a-b: the share t along it and the distance. */
function project(q: Pt, a: Pt, b: Pt): { t: number; d: number; at: Pt } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
  const at: Pt = [a[0] + t * dx, a[1] + t * dy];
  return { t, d: dist(q, at), at };
}

/** Where segments a-b and c-d cross: the shares along each, or null (parallel or apart). */
function cross(a: Pt, b: Pt, c: Pt, d: Pt): [number, number] | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

/** The lines as a planar graph (see the top of this file): split where they cross or touch, gaps up to `snap` bridged. */
export function redworkGraph(lines: RedworkLine[], snap = REDWORK_GAP): RedworkGraph {
  // The straight pieces of all lines.
  const segs: [Pt, Pt][] = [];
  for (const l of lines) {
    const pts = l.closed && l.pts.length > 2 && dist(l.pts[0], l.pts[l.pts.length - 1]) > 1e-9 ? [...l.pts, l.pts[0]] : l.pts;
    for (let i = 1; i < pts.length; i++) if (dist(pts[i - 1], pts[i]) > 1e-9) segs.push([pts[i - 1], pts[i]]);
  }
  const grid = new SegGrid(2);
  segs.forEach(([a, b], i) => grid.add(i, a, b));
  // Points along each piece where it is split: where another crosses it or ends on it.
  const cuts: Pt[][] = segs.map(([a, b]) => [a, b]);
  segs.forEach(([a, b], i) => {
    for (const j of grid.near(a, b, MERGE)) {
      if (j <= i) continue;
      const [c, d] = segs[j];
      const x = cross(a, b, c, d);
      if (x) {
        const q: Pt = [a[0] + x[0] * (b[0] - a[0]), a[1] + x[0] * (b[1] - a[1])];
        cuts[i].push(q);
        cuts[j].push(q);
      }
      // Touching without crossing (an end on the other piece), also along a piece lying on the other.
      for (const [q, k, s, e] of [[c, i, a, b], [d, i, a, b], [a, j, c, d], [b, j, c, d]] as [Pt, number, Pt, Pt][]) {
        const p = project(q, s, e);
        if (p.d < MERGE && p.t > 0 && p.t < 1) cuts[k].push(p.at);
      }
    }
  });
  const pts = new Points();
  const edgeKey = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  const fine = new Map<string, [number, number]>();
  const addFine = (u: number, v: number) => {
    if (u !== v) fine.set(edgeKey(u, v), [u, v]);
  };
  segs.forEach(([a], i) => {
    const along = cuts[i].map((q) => ({ q, t: dist(a, q) })).sort((x, y) => x.t - y.t);
    let prev = pts.id(along[0].q);
    for (let k = 1; k < along.length; k++) {
      const id = pts.id(along[k].q);
      addFine(prev, id);
      prev = id;
    }
  });
  bridgeGaps(pts, fine, addFine, snap);
  return contract(chains(pts.list, [...fine.values()]), NODE);
}

/**
 * Nodes joined by an edge shorter than `d` made one, at their middle (vertex clustering): lines
 * that cross at a shallow angle or meet near a corner give nodes close together, and every node is
 * a needle point, so they would be a heap of short stitches.
 */
function contract(g: RedworkGraph, d: number): RedworkGraph {
  const up = g.nodes.map((_, i) => i);
  const root = (i: number): number => (up[i] === i ? i : (up[i] = root(up[i])));
  const length = (pts: Pt[]) => pts.slice(1).reduce((s, q, i) => s + dist(q, pts[i]), 0);
  const short = g.edges.map((e) => length(e.pts) < d);
  g.edges.forEach((e, i) => {
    if (short[i]) up[root(e.a)] = root(e.b);
  });
  const sum = new Map<number, [number, number, number]>();
  g.nodes.forEach((q, i) => {
    const r = root(i);
    const s = sum.get(r) ?? [0, 0, 0];
    sum.set(r, [s[0] + q[0], s[1] + q[1], s[2] + 1]);
  });
  const index = new Map<number, number>();
  const nodes: Pt[] = [];
  for (const [r, [x, y, n]] of sum) {
    index.set(r, nodes.length);
    nodes.push([x / n, y / n]);
  }
  const edges: RedworkGraph['edges'] = [];
  // Two edges between the same nodes that are now one straight piece (they went from either end of
  // a short one) are sewn once.
  const seen = new Set<string>();
  g.edges.forEach((e, i) => {
    if (short[i]) return;
    const a = index.get(root(e.a))!;
    const b = index.get(root(e.b))!;
    if (e.pts.length === 2) {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(k)) return;
      seen.add(k);
    }
    const pts = [nodes[a], ...e.pts.slice(1, -1), nodes[b]];
    // A loop that shrank to a spike in the merged node: nothing left to sew.
    if (a === b && length(pts) < 2 * d) return;
    edges.push({ a, b, pts });
  });
  return { nodes, edges };
}

/**
 * Lines that do not touch but come within `snap` of each other are joined by a straight piece where
 * they are closest (split there): the nearest pair first, as long as it joins two parts that are
 * apart so far (Kruskal's order), so each gap is bridged once and a line never onto itself.
 */
function bridgeGaps(pts: Points, fine: Map<string, [number, number]>, addFine: (u: number, v: number) => void, snap: number): void {
  if (snap <= 0) return;
  const up = new Map<number, number>();
  const root = (i: number): number => {
    let r = i;
    while ((up.get(r) ?? r) !== r) r = up.get(r)!;
    up.set(i, r);
    return r;
  };
  const join = (a: number, b: number) => up.set(root(a), root(b));
  for (const [u, v] of fine.values()) join(u, v);
  const segs = [...fine.values()];
  const grid = new SegGrid(2);
  segs.forEach(([u, v], i) => grid.add(i, pts.list[u], pts.list[v]));
  // The closest points of two pieces that do not cross: an end of one and its nearest point on the other.
  const gaps: { d: number; i: number; j: number; p: Pt; q: Pt }[] = [];
  segs.forEach(([a, b], i) => {
    const [pa, pb] = [pts.list[a], pts.list[b]];
    for (const j of grid.near(pa, pb, snap)) {
      if (j <= i || root(segs[j][0]) === root(a)) continue;
      const [pc, pd] = [pts.list[segs[j][0]], pts.list[segs[j][1]]];
      let best: { d: number; p: Pt; q: Pt } | null = null;
      for (const [e, s0, s1, mine] of [[pa, pc, pd, true], [pb, pc, pd, true], [pc, pa, pb, false], [pd, pa, pb, false]] as [Pt, Pt, Pt, boolean][]) {
        const x = project(e, s0, s1);
        if (!best || x.d < best.d) best = mine ? { d: x.d, p: e, q: x.at } : { d: x.d, p: x.at, q: e };
      }
      if (best && best.d <= snap) gaps.push({ ...best, i, j });
    }
  });
  gaps.sort((x, y) => x.d - y.d);
  /** The node at `q` on piece `seg` (or on what it was split into), the piece split there. */
  const at = (seg: [number, number], q: Pt): number => {
    const id = pts.id(q);
    if (id === seg[0] || id === seg[1] || !fine.size) return id;
    // The piece itself, or the piece of it nearest q once it was split before.
    let edge: [number, number] | null = fine.get(seg[0] < seg[1] ? `${seg[0]}|${seg[1]}` : `${seg[1]}|${seg[0]}`) ?? null;
    if (!edge) {
      let bd = Infinity;
      for (const e of fine.values()) {
        const d = project(q, pts.list[e[0]], pts.list[e[1]]).d;
        if (d < bd) {
          bd = d;
          edge = e;
        }
      }
    }
    const [u, v] = edge!;
    if (id !== u && id !== v) {
      fine.delete(u < v ? `${u}|${v}` : `${v}|${u}`);
      addFine(u, id);
      addFine(id, v);
    }
    join(id, u);
    return id;
  };
  for (const g of gaps) {
    if (root(segs[g.i][0]) === root(segs[g.j][0])) continue;
    const u = at(segs[g.i], g.p);
    const v = at(segs[g.j], g.q);
    addFine(u, v);
    join(u, v);
  }
}

/** The fine graph with its runs through nodes of two edges joined: edges from junction to junction (or round a loop). */
function chains(all: Pt[], fine: [number, number][]): RedworkGraph {
  const nb = new Map<number, number[]>();
  for (const [u, v] of fine) {
    if (!nb.has(u)) nb.set(u, []);
    if (!nb.has(v)) nb.set(v, []);
    nb.get(u)!.push(v);
    nb.get(v)!.push(u);
  }
  const used = new Set<string>();
  const key = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  const index = new Map<number, number>();
  const nodes: Pt[] = [];
  const node = (v: number) => {
    if (!index.has(v)) {
      index.set(v, nodes.length);
      nodes.push(all[v]);
    }
    return index.get(v)!;
  };
  const edges: RedworkGraph['edges'] = [];
  const junction = (v: number) => nb.get(v)!.length !== 2;
  const follow = (s: number, first: number) => {
    const line = [s, first];
    used.add(key(s, first));
    let prev = s;
    let v = first;
    while (!junction(v) && v !== s) {
      const w = nb.get(v)!.find((x) => x !== prev && !used.has(key(v, x))) ?? nb.get(v)!.find((x) => !used.has(key(v, x)));
      if (w === undefined) break;
      used.add(key(v, w));
      line.push(w);
      prev = v;
      v = w;
    }
    edges.push({ a: node(s), b: node(v), pts: line.map((i) => all[i]) });
  };
  for (const [v, ns] of nb) if (junction(v)) for (const w of ns) if (!used.has(key(v, w))) follow(v, w);
  // Loops without a junction: from any of their points round.
  for (const [v, ns] of nb) for (const w of ns) if (!used.has(key(v, w))) follow(v, w);
  return { nodes, edges };
}

/**
 * The walk over the graph, one per connected part: every edge once each way (Tarry's depth first
 * traversal, see the top of this file), from the node nearest the needle, the parts in the order
 * the needle reaches them. Each walk is the list of edges it takes, with the way along each.
 */
export function redworkWalks(g: RedworkGraph, from?: Pt): { edge: number; back: boolean }[][] {
  const at = new Map<number, number[]>();
  g.edges.forEach((e, i) => {
    if (!at.has(e.a)) at.set(e.a, []);
    at.get(e.a)!.push(i);
    if (e.b !== e.a) {
      if (!at.has(e.b)) at.set(e.b, []);
      at.get(e.b)!.push(i);
    }
  });
  const done = new Set<number>();
  const usedEdge = new Set<number>();
  const walks: { edge: number; back: boolean }[][] = [];
  let pos = from ?? g.nodes[g.edges[0]?.a ?? 0];
  for (;;) {
    let start = -1;
    let sd = Infinity;
    for (const [v] of at) {
      if (done.has(v)) continue;
      const d = from || walks.length ? dist(pos, g.nodes[v]) : 0;
      if (d < sd) {
        sd = d;
        start = v;
      }
    }
    if (start < 0) break;
    const walk: { edge: number; back: boolean }[] = [];
    /** The direction the needle arrives in, to go on as straight as it can. */
    let heading: Pt | null = null;
    const take = (i: number, from: number, way?: boolean) => {
      const e = g.edges[i];
      const back = way ?? e.a !== from;
      walk.push({ edge: i, back });
      const p = e.pts;
      const [s, t] = back ? [p[1], p[0]] : [p[p.length - 2], p[p.length - 1]];
      heading = [t[0] - s[0], t[1] - s[1]];
      return back ? e.a : e.b;
    };
    const leaving = (i: number, v: number): Pt => {
      const e = g.edges[i];
      const p = e.pts;
      const [s, t] = e.a === v ? [p[0], p[1]] : [p[p.length - 1], p[p.length - 2]];
      return [t[0] - s[0], t[1] - s[1]];
    };
    done.add(start);
    const stack: { v: number; via: number }[] = [{ v: start, via: -1 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const v = top.v;
      let next = -1;
      let score = -Infinity;
      for (const i of at.get(v)!) {
        if (usedEdge.has(i)) continue;
        const h = heading as Pt | null;
        const out = leaving(i, v);
        const s = h ? (h[0] * out[0] + h[1] * out[1]) / ((Math.hypot(h[0], h[1]) * Math.hypot(out[0], out[1])) || 1) : 0;
        if (s > score) {
          score = s;
          next = i;
        }
      }
      if (next < 0) {
        stack.pop();
        // Back the way it came, over everything beyond.
        if (top.via >= 0) take(top.via, v);
        continue;
      }
      usedEdge.add(next);
      const w = take(next, v);
      // To a node reached before (or round a loop): back along it at once, the other way.
      if (done.has(w)) take(next, w, !walk[walk.length - 1].back);
      else {
        done.add(w);
        stack.push({ v: w, via: next });
      }
    }
    if (walk.length) walks.push(walk);
    pos = g.nodes[start];
  }
  return walks;
}

/**
 * Redwork stitches along `lines` (see the top of this file): one run per connected part, each edge
 * stitched once by `stitch` (needle points at both ends) and sewn there and back over the same
 * needle points.
 */
export function redworkRuns(lines: RedworkLine[], stitch: (pts: Pt[]) => Pt[], from?: Pt, snap = REDWORK_GAP): Pt[][] {
  const g = redworkGraph(lines, snap);
  const sewn = g.edges.map((e) => stitch(e.pts));
  return redworkWalks(g, from)
    .map((walk) => {
      const run: Pt[] = [];
      for (const { edge, back } of walk) {
        const s = sewn[edge];
        if (s.length < 2) continue;
        const pts = back ? s.slice().reverse() : s;
        for (const q of pts) if (!run.length || dist(run[run.length - 1], q) > 1e-6) run.push(q);
      }
      return run;
    })
    .filter((r) => r.length > 1);
}
