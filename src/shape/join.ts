import type { Pt } from '../digitize/skeleton';
import type { Form, Node, Path } from './path';

/**
 * Open paths joined at their ends ("Pfade verbinden", as Inkscape's "Endknoten verbinden" and
 * Illustrator's Verbinden): ends this close are one node, farther ones get a straight piece between
 * them, sewn as a stitch. A chain whose ends then meet this close is closed.
 */
export const JOIN_SNAP_MM = 0.5;

/** One join: the gap between the two ends (mm), and whether it was bridged by a straight piece. */
export interface Joint {
  gap: number;
  bridged: boolean;
}

export interface Joined {
  form: Form;
  joints: Joint[];
  /** Chains closed because their ends met. */
  closed: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const copy = (n: Node): Node => ({ p: [n.p[0], n.p[1]], a: [n.a[0], n.a[1]], b: [n.b[0], n.b[1]], smooth: n.smooth });
const reversed = (nodes: Node[]): Node[] => nodes.map((n) => ({ p: [n.p[0], n.p[1]], a: [n.b[0], n.b[1]], b: [n.a[0], n.a[1]], smooth: n.smooth }) as Node).reverse();
const open = (p: Path) => !p.closed && p.nodes.length >= 2;

/** The node where `last` (end of one path) and `first` (start of the next) meet: at their middle, each keeping its handle. */
function meet(last: Node, first: Node): Node {
  const m: Pt = [(last.p[0] + first.p[0]) / 2, (last.p[1] + first.p[1]) / 2];
  const a: Pt = [last.a[0] + m[0] - last.p[0], last.a[1] + m[1] - last.p[1]];
  const b: Pt = [first.b[0] + m[0] - first.p[0], first.b[1] + m[1] - first.p[1]];
  // Round where both handles go on in one direction (a curve through, not a corner).
  const u: Pt = [m[0] - a[0], m[1] - a[1]];
  const v: Pt = [b[0] - m[0], b[1] - m[1]];
  const lu = Math.hypot(u[0], u[1]);
  const lv = Math.hypot(v[0], v[1]);
  const smooth = lu > 1e-9 && lv > 1e-9 && (u[0] * v[0] + u[1] * v[1]) / (lu * lv) > Math.cos((2 * Math.PI) / 180);
  return { p: m, a, b, smooth };
}

/** Appends `next` to `nodes`, one node where the ends are within `snap`, else a straight piece. */
function append(nodes: Node[], next: Node[], snap: number, joints: Joint[]): void {
  const last = nodes[nodes.length - 1];
  const gap = dist(last.p, next[0].p);
  if (gap <= snap) {
    nodes[nodes.length - 1] = meet(last, next[0]);
    nodes.push(...next.slice(1));
    joints.push({ gap, bridged: false });
    return;
  }
  // A straight piece: the handles facing it lie on their nodes.
  nodes[nodes.length - 1] = { ...last, b: [last.p[0], last.p[1]], smooth: false };
  nodes.push({ ...next[0], a: [next[0].p[0], next[0].p[1]], smooth: false }, ...next.slice(1));
  joints.push({ gap, bridged: true });
}

/** Closes a chain whose ends meet within `snap` (one node there). */
function closeIfMet(nodes: Node[], snap: number): boolean {
  if (nodes.length < 3 || dist(nodes[0].p, nodes[nodes.length - 1].p) > snap) return false;
  const last = nodes.pop()!;
  nodes[0] = meet(last, nodes[0]);
  return true;
}

/**
 * The open paths of `f` joined at their ends, nearest ends first (a greedy matching: each end is
 * used once, no chain is joined to itself). `all`: every open path becomes one, gaps bridged by
 * straight pieces; else only ends within `snap` join. Closed paths stay as they are; paths not
 * joined keep their nodes. Null when nothing joins.
 */
export function joinOpenPaths(f: Form, all: boolean, snap = JOIN_SNAP_MM): Joined | null {
  const idx = f.paths.flatMap((p, k) => (open(p) ? [k] : []));
  if (idx.length < 2) return null;
  const end = (k: number, e: 0 | 1): Pt => (e ? f.paths[k].nodes[f.paths[k].nodes.length - 1].p : f.paths[k].nodes[0].p);
  type Cand = { a: number; ea: 0 | 1; b: number; eb: 0 | 1; d: number };
  const cands: Cand[] = [];
  for (let i = 0; i < idx.length; i++)
    for (let j = i + 1; j < idx.length; j++)
      for (const ea of [0, 1] as const)
        for (const eb of [0, 1] as const) {
          const d = dist(end(idx[i], ea), end(idx[j], eb));
          if (all || d <= snap) cands.push({ a: idx[i], ea, b: idx[j], eb, d });
        }
  cands.sort((x, y) => x.d - y.d);
  // Union-find over paths, and what each end is joined to.
  const root = new Map(idx.map((k) => [k, k]));
  const find = (k: number): number => {
    while (root.get(k) !== k) k = root.get(k)!;
    return k;
  };
  const link = new Map<string, { k: number; e: 0 | 1 }>();
  const key = (k: number, e: 0 | 1) => `${k}:${e}`;
  for (const c of cands) {
    if (link.has(key(c.a, c.ea)) || link.has(key(c.b, c.eb))) continue;
    const ra = find(c.a);
    const rb = find(c.b);
    if (ra === rb) continue;
    root.set(ra, rb);
    link.set(key(c.a, c.ea), { k: c.b, e: c.eb });
    link.set(key(c.b, c.eb), { k: c.a, e: c.ea });
  }
  if (!link.size) return null;
  // Each chain walked from a free end.
  const done = new Set<number>();
  const joints: Joint[] = [];
  const chains = new Map<number, Path>();
  let closed = 0;
  for (const k of idx) {
    if (done.has(k)) continue;
    const startEnd = !link.has(key(k, 0)) ? 0 : !link.has(key(k, 1)) ? 1 : null;
    if (startEnd === null) continue;
    let cur = k;
    let from: 0 | 1 = startEnd;
    const parts: number[] = [cur];
    const nodes = from === 0 ? f.paths[cur].nodes.map(copy) : reversed(f.paths[cur].nodes);
    done.add(cur);
    for (;;) {
      const out = (1 - from) as 0 | 1;
      const next = link.get(key(cur, out));
      if (!next) break;
      const seq = next.e === 0 ? f.paths[next.k].nodes.map(copy) : reversed(f.paths[next.k].nodes);
      append(nodes, seq, snap, joints);
      cur = next.k;
      from = next.e;
      parts.push(cur);
      done.add(cur);
    }
    let isClosed = false;
    if (parts.length > 1 && closeIfMet(nodes, snap)) {
      isClosed = true;
      closed++;
    }
    chains.set(k, parts.length === 1 ? f.paths[k] : { closed: isClosed, nodes });
  }
  // In the place of the first path of each chain; the others of the chain go.
  const paths: Path[] = [];
  f.paths.forEach((p, k) => {
    if (!open(p)) paths.push(p);
    else if (chains.has(k)) paths.push(chains.get(k)!);
  });
  return { form: { ...f, paths }, joints, closed };
}

/**
 * The end `e` of open path `k` joined to the nearest end of another open path (one node within
 * `snap`, else a straight piece). Null when there is no other open path.
 */
export function joinEnd(f: Form, k: number, e: 0 | 1, snap = JOIN_SNAP_MM): Joined | null {
  const p = f.paths[k];
  if (!p || !open(p)) return null;
  const at = e ? p.nodes[p.nodes.length - 1].p : p.nodes[0].p;
  let best: { j: number; ej: 0 | 1; d: number } | null = null;
  f.paths.forEach((q, j) => {
    if (j === k || !open(q)) return;
    for (const ej of [0, 1] as const) {
      const d = dist(at, ej ? q.nodes[q.nodes.length - 1].p : q.nodes[0].p);
      if (!best || d < best.d) best = { j, ej, d };
    }
  });
  if (!best) return null;
  const { j, ej } = best as { j: number; ej: 0 | 1; d: number };
  const joints: Joint[] = [];
  // From the far end of path k through end e to end ej of path j, on to its far end.
  const nodes = e === 1 ? p.nodes.map(copy) : reversed(p.nodes);
  append(nodes, ej === 0 ? f.paths[j].nodes.map(copy) : reversed(f.paths[j].nodes), snap, joints);
  const closed = closeIfMet(nodes, snap);
  const first = Math.min(k, j);
  const paths: Path[] = [];
  f.paths.forEach((q, i) => {
    if (i === first) paths.push({ closed, nodes });
    else if (i !== k && i !== j) paths.push(q);
  });
  return { form: { ...f, paths }, joints, closed: closed ? 1 : 0 };
}

/**
 * Open path `k` split at its node `i` into two paths (the node in both); null at an end or on a
 * closed path (that one opens with Pfad öffnen).
 */
export function splitPathAt(f: Form, k: number, i: number): Form | null {
  const p = f.paths[k];
  if (!p || p.closed || i <= 0 || i >= p.nodes.length - 1) return null;
  const n = p.nodes[i];
  const head = [...p.nodes.slice(0, i).map(copy), { ...copy(n), b: [n.p[0], n.p[1]] as Pt, smooth: false }];
  const tail = [{ ...copy(n), a: [n.p[0], n.p[1]] as Pt, smooth: false }, ...p.nodes.slice(i + 1).map(copy)];
  const paths = [...f.paths];
  paths.splice(k, 1, { closed: false, nodes: head }, { closed: false, nodes: tail });
  return { ...f, paths };
}
