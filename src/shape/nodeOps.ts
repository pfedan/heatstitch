import type { Pt } from '../digitize/skeleton';
import { meet } from './join';
import { bezier, segment, segments, type Form, type Node, type NodeRef, type Path } from './path';
import { fitSingleCubic } from './vectorize';

/**
 * Operations on the selected nodes of a form, as vector programs have them on their node tools:
 * Auftrennen (Inkscape "Break path", Illustrator "Cut path at selected anchor points"), deleting
 * nodes so the outline keeps its shape (Inkscape's Delete), removing the piece between two nodes
 * (Inkscape "Delete segment") and Knoten zusammenlegen (Inkscape "Join selected nodes").
 */

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const copy = (n: Node): Node => ({ p: [n.p[0], n.p[1]], a: [n.a[0], n.a[1]], b: [n.b[0], n.b[1]], smooth: n.smooth });
const reversed = (nodes: Node[]): Node[] => nodes.map((n) => ({ p: [n.p[0], n.p[1]], a: [n.b[0], n.b[1]], b: [n.a[0], n.a[1]], smooth: n.smooth }) as Node).reverse();
const straight = (c: [Pt, Pt, Pt, Pt]) => dist(c[0], c[1]) < 1e-9 && dist(c[2], c[3]) < 1e-9;

/** The selected node indices of each path. */
function byPath(sel: readonly NodeRef[]): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const s of sel) {
    const set = m.get(s.path);
    if (set) set.add(s.i);
    else m.set(s.path, new Set([s.i]));
  }
  return m;
}

/** Nodes `i` to `j` of `nodes` as an open path; its ends are corners without an outer handle. */
function piece(nodes: Node[], i: number, j: number): Path {
  const part = nodes.slice(i, j + 1).map(copy);
  const a = part[0];
  const b = part[part.length - 1];
  a.a = [a.p[0], a.p[1]];
  b.b = [b.p[0], b.p[1]];
  a.smooth = b.smooth = false;
  return { closed: false, nodes: part };
}

/**
 * The nodes of a closed path read as an open one that starts at node `s` and comes round to it
 * again (the node twice), and where node `i` of the path lies in it.
 */
function unrolled(p: Path, s: number): { nodes: Node[]; at: (i: number) => number } {
  const n = p.nodes.length;
  return { nodes: [...p.nodes.slice(s), ...p.nodes.slice(0, s), p.nodes[s]], at: (i) => (i - s + n) % n };
}

/**
 * The paths cut at the selected nodes, the outline unchanged (Auftrennen): a closed path cut at
 * one node opens there, at k nodes it falls into k open paths; an open path cut at k of its inner
 * nodes falls into k + 1. Ends of open paths are not cut. Null when no selected node cuts.
 */
export function breakAtNodes(f: Form, sel: readonly NodeRef[]): { form: Form; cuts: number } | null {
  const chosen = byPath(sel);
  const paths: Path[] = [];
  let cuts = 0;
  f.paths.forEach((p, k) => {
    const n = p.nodes.length;
    const on = [...(chosen.get(k) ?? [])].filter((i) => i >= 0 && i < n && (p.closed || (i > 0 && i < n - 1))).sort((a, b) => a - b);
    if (!on.length || (p.closed && n < 2)) return paths.push(p);
    cuts += on.length;
    const { nodes, at } = p.closed ? unrolled(p, on[0]) : { nodes: p.nodes, at: (i: number) => i };
    const marks = [0, ...on.map(at).filter((i) => i > 0), nodes.length - 1];
    for (let m = 0; m + 1 < marks.length; m++) paths.push(piece(nodes, marks[m], marks[m + 1]));
  });
  return cuts ? { form: { ...f, paths }, cuts } : null;
}

/**
 * The pieces between two selected neighbouring nodes taken away (Stück entfernen): the path is open
 * there, the nodes stay as ends. Null when no two selected nodes are neighbours.
 */
export function removeSegments(f: Form, sel: readonly NodeRef[]): Form | null {
  const chosen = byPath(sel);
  const paths: Path[] = [];
  let gone = 0;
  f.paths.forEach((p, k) => {
    const on = chosen.get(k);
    const n = p.nodes.length;
    const cut = new Set<number>();
    for (let s = 0; s < segments(p); s++) if (on?.has(s) && on.has((s + 1) % n)) cut.add(s);
    if (!cut.size) return paths.push(p);
    gone += cut.size;
    // A closed path read from the node after its first removed piece round to that piece.
    const first = Math.min(...cut);
    const nodes = p.closed ? unrolled(p, (first + 1) % n).nodes : p.nodes;
    const original = (s: number) => (p.closed ? (s + first + 1) % n : s);
    let start = 0;
    for (let s = 0; s < nodes.length - 1; s++) {
      if (!cut.has(original(s))) continue;
      if (s > start) paths.push(piece(nodes, start, s));
      start = s + 1;
    }
    if (nodes.length - 1 > start) paths.push(piece(nodes, start, nodes.length - 1));
  });
  return gone && paths.length ? { ...f, paths } : null;
}

/** Points along curves `cs`, about `step` mm apart, the first point once. */
function sampleCurves(cs: [Pt, Pt, Pt, Pt][], step = 0.05): Pt[] {
  const out: Pt[] = [cs[0][0]];
  for (const c of cs) {
    const len = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
    const k = Math.min(200, Math.max(8, Math.ceil(len / step)));
    for (let i = 1; i <= k; i++) out.push(bezier(c, i / k));
  }
  return out;
}

/** Unit direction from `from` to the first of `qs` off it, or null. */
function towards(from: Pt, qs: Pt[]): [number, number] | null {
  for (const q of qs) {
    const d = dist(from, q);
    if (d > 1e-6) return [(q[0] - from[0]) / d, (q[1] - from[1]) / d];
  }
  return null;
}

/**
 * Curves `cs` (one after the other, from node `l` to node `r`) as one: the handle `l.b` and `r.a`
 * set so that one cubic follows them as closely as it can (least squares, Schneider), each in the
 * direction its node already had, so a round node stays round. All straight: a straight piece.
 */
function bridge(l: Node, r: Node, cs: [Pt, Pt, Pt, Pt][]): void {
  if (cs.every(straight)) {
    l.b = [l.p[0], l.p[1]];
    r.a = [r.p[0], r.p[1]];
    return;
  }
  const t1 = towards(l.p, cs.flatMap((c) => [c[1], c[2], c[3]]));
  const t2 = towards(r.p, [...cs].reverse().flatMap((c) => [c[2], c[1], c[0]]));
  if (!t1 || !t2) return;
  const fit = fitSingleCubic(sampleCurves(cs), t1, t2);
  l.b = fit[1];
  r.a = fit[2];
}

/**
 * The form without the selected nodes, keeping its shape (Entf, as Inkscape's Delete): the curves
 * from a node kept to the next one kept become one curve fitted to them. Nodes removed at the start
 * or end of an open path shorten it. A path left with too few nodes goes as a whole (a closed one
 * under three, an open one under two); null when no path would be left.
 */
export function deleteNodesKeepingShape(f: Form, sel: readonly NodeRef[]): Form | null {
  const chosen = byPath(sel);
  const paths: Path[] = [];
  f.paths.forEach((p, k) => {
    const on = chosen.get(k);
    const n = p.nodes.length;
    if (!on?.size) return paths.push(p);
    const kept = p.nodes.flatMap((_, i) => (on.has(i) ? [] : [i]));
    if (kept.length < (p.closed ? 3 : 2)) return;
    const nodes = kept.map((i) => copy(p.nodes[i]));
    const pairs = p.closed ? kept.map((i, j) => [j, (j + 1) % kept.length, i, kept[(j + 1) % kept.length]]) : kept.slice(0, -1).map((i, j) => [j, j + 1, i, kept[j + 1]]);
    for (const [a, b, i, j] of pairs) {
      const span = (j - i + n) % n || n;
      if (span < 2) continue;
      const cs: [Pt, Pt, Pt, Pt][] = [];
      for (let s = 0; s < span; s++) cs.push(segment(p, (i + s) % n));
      bridge(nodes[a], nodes[b], cs);
    }
    if (!p.closed) {
      // A shortened end has no curve beyond it.
      if (kept[0] !== 0) nodes[0] = { ...nodes[0], a: [nodes[0].p[0], nodes[0].p[1]], smooth: false };
      const e = nodes.length - 1;
      if (kept[kept.length - 1] !== n - 1) nodes[e] = { ...nodes[e], b: [nodes[e].p[0], nodes[e].p[1]], smooth: false };
    }
    paths.push({ closed: p.closed, nodes });
  });
  return paths.length ? { ...f, paths } : null;
}

/** One node for the run `run` of neighbouring nodes: at their middle, the outer handles kept. */
function merged(run: Node[]): Node {
  const m: Pt = [run.reduce((s, x) => s + x.p[0], 0) / run.length, run.reduce((s, x) => s + x.p[1], 0) / run.length];
  const first = run[0];
  const last = run[run.length - 1];
  const a: Pt = [first.a[0] - first.p[0] + m[0], first.a[1] - first.p[1] + m[1]];
  const b: Pt = [last.b[0] - last.p[0] + m[0], last.b[1] - last.p[1] + m[1]];
  return meet({ p: m, a, b: m, smooth: false }, { p: m, a: m, b, smooth: false });
}

/**
 * The selected nodes laid together into one (Knoten zusammenlegen, as Inkscape's "Join selected
 * nodes"): each run of two or more neighbouring selected nodes becomes one node at their middle;
 * else two selected ends become one node at their middle, joining two open paths or closing one.
 * Null when neither applies.
 */
export function mergeNodes(f: Form, sel: readonly NodeRef[]): Form | null {
  const chosen = byPath(sel);
  let runs = 0;
  const paths = f.paths.map((p, k) => {
    const on = chosen.get(k);
    const n = p.nodes.length;
    if (!on || on.size < 2) return p;
    // A whole path would be one node: it stays.
    if (on.size === n) return p;
    // Start after a node not selected, so a run is not cut where a closed path starts.
    const s = p.closed ? (p.nodes.findIndex((_, i) => !on.has(i)) + 1) % n : 0;
    const order = Array.from({ length: n }, (_, j) => (s + j) % n);
    const out: Node[] = [];
    let run: Node[] = [];
    const flush = () => {
      if (run.length >= 2) {
        out.push(merged(run));
        runs++;
      } else out.push(...run.map(copy));
      run = [];
    };
    for (const i of order) {
      if (on.has(i)) run.push(p.nodes[i]);
      else {
        flush();
        out.push(copy(p.nodes[i]));
      }
    }
    flush();
    return out.length < (p.closed ? 3 : 2) ? p : { closed: p.closed, nodes: out };
  });
  if (runs) return { ...f, paths };
  return joinTwoEnds(f, sel);
}

/** Two selected ends (of one open path or of two) as one node at their middle. */
function joinTwoEnds(f: Form, sel: readonly NodeRef[]): Form | null {
  if (sel.length !== 2) return null;
  const endOf = (r: NodeRef): 0 | 1 | null => {
    const p = f.paths[r.path];
    if (!p || p.closed || p.nodes.length < 2) return null;
    return r.i === 0 ? 0 : r.i === p.nodes.length - 1 ? 1 : null;
  };
  const [x, y] = sel;
  const ex = endOf(x);
  const ey = endOf(y);
  if (ex === null || ey === null) return null;
  if (x.path === y.path) {
    if (ex === ey) return null;
    const p = f.paths[x.path];
    if (p.nodes.length < 3) return null;
    const nodes = p.nodes.map(copy);
    const last = nodes.pop()!;
    nodes[0] = meet(last, nodes[0]);
    return { ...f, paths: f.paths.map((q, k) => (k === x.path ? { closed: true, nodes } : q)) };
  }
  // From the far end of x's path to its selected end, on through y's selected end.
  const a = f.paths[x.path].nodes;
  const b = f.paths[y.path].nodes;
  const nodes = ex === 1 ? a.map(copy) : reversed(a);
  const next = ey === 0 ? b.map(copy) : reversed(b);
  nodes[nodes.length - 1] = meet(nodes[nodes.length - 1], next[0]);
  nodes.push(...next.slice(1));
  const first = Math.min(x.path, y.path);
  const paths: Path[] = [];
  f.paths.forEach((q, k) => {
    if (k === first) paths.push({ closed: false, nodes });
    else if (k !== x.path && k !== y.path) paths.push(q);
  });
  return { ...f, paths };
}
