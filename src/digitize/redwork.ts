import { JOIN_SNAP_MM } from '../shape/join';
import { core } from '../wasm/core';
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
 *
 * The graph and the walks are computed by the Rust core (core/src/digitize/redwork.rs); the
 * stitches along each edge are made here by the caller's `stitch`.
 */

/**
 * Gaps up to this (mm) are bridged with a stitch: the snap of joining paths (JOIN_SNAP_MM). About a
 * thread wide, so a bridge does not show as a line of its own, while lines drawn apart on purpose
 * (a stitch length, 2.5 mm, and more) stay apart.
 */
export const REDWORK_GAP = JOIN_SNAP_MM;

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

/** The lines as the core takes them. */
const plain = (lines: RedworkLine[]) => lines.map((l) => ({ pts: l.pts, closed: !!l.closed }));

/** The lines as a planar graph (see the top of this file): split where they cross or touch, gaps up to `snap` bridged. */
export function redworkGraph(lines: RedworkLine[], snap = REDWORK_GAP): RedworkGraph {
  return core().redworkGraph(plain(lines), snap) as RedworkGraph;
}

/**
 * The walk over the graph, one per connected part: every edge once each way (Tarry's depth first
 * traversal, see the top of this file), from the node nearest the needle, the parts in the order
 * the needle reaches them. Each walk is the list of edges it takes, with the way along each.
 */
export function redworkWalks(g: RedworkGraph, from?: Pt): { edge: number; back: boolean }[][] {
  return core().redworkWalks(g, from && Float64Array.from(from)) as { edge: number; back: boolean }[][];
}

/**
 * Redwork stitches along `lines` (see the top of this file): one run per connected part, each edge
 * stitched once by `stitch` (needle points at both ends) and sewn there and back over the same
 * needle points. With `bean` the second pass over each edge, the one on top, is a bean stitch (each
 * stitch forward, back, forward): one thread below and three on top, as a thick redwork line is sewn.
 */
export function redworkRuns(lines: RedworkLine[], stitch: (pts: Pt[]) => Pt[], from?: Pt, snap = REDWORK_GAP, bean = false): Pt[][] {
  const { graph: g, walks } = core().redworkPlan(plain(lines), snap, from && Float64Array.from(from)) as { graph: RedworkGraph; walks: { edge: number; back: boolean }[][] };
  const sewn = g.edges.map((e) => stitch(e.pts));
  const passed = new Set<number>();
  return walks
    .map((walk) => {
      const run: Pt[] = [];
      for (const { edge, back } of walk) {
        const s = sewn[edge];
        if (s.length < 2) continue;
        const dir = back ? s.slice().reverse() : s;
        const top = passed.has(edge);
        passed.add(edge);
        const pts = bean && top ? beaned(dir) : dir;
        for (const q of pts) if (!run.length || dist(run[run.length - 1], q) > 1e-6) run.push(q);
      }
      return run;
    })
    .filter((r) => r.length > 1);
}

/** Bean stitch along `pts`: each stitch forward, back, forward over the same two needle points. */
function beaned(pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) out.push(pts[i], pts[i - 1], pts[i]);
  return out;
}
