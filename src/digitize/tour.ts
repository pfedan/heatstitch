import type { Pt } from './skeleton';

/**
 * The order of the sections of a fill as one tour that keeps all travel hidden.
 *
 * Sections are the cells of the boustrophedon decomposition (Choset 2000): each is sewn back and
 * forth in one go, from the row on one of its sides to the row on the other. Sections that touch
 * across a row line form a graph (the Reeb graph of the decomposition, with cells as nodes). Coverage
 * planning tours that graph as a postman tour (Mannadiar & Rekleitis 2010): on a tree the cheapest
 * tour is a depth-first one, every edge walked twice, except along the way from start to end.
 *
 * Embroidery adds one rule: travel only hides under rows still to come. So each section is sewn on
 * its last visit and every earlier pass through it is travel under its rows to come: the tour walks
 * down the spanning tree to the far end of a branch through rows not sewn yet, and sews back towards
 * the root (postorder: a section after all sections beyond it, ending on the side its parent lies).
 * Every way then runs through sections still to come, so a connected area needs no trim and no
 * travel on top of sewn rows. Areas with holes have cycles in the graph; their spanning tree keeps
 * the widest touches, where hidden ways are roomiest. A postman tour over a cycle (with a matching of
 * its odd nodes) could save one way along it, but would cross a section sewn already where the cycle
 * closes; the tree tour never does.
 *
 * What is left to choose is cheap to search exactly: which section is sewn last (the root) and from
 * which side, and in which order the branches are taken (those on the side the section ends first,
 * each group nearest first). Every root is tried; the cheapest tour by the straight ways counts.
 * Separate parts of the area (holes cut it apart, parts left out) are toured one after another.
 */

/** Where a section touches another across one of its sides (0: its first row, 1: its last). */
export interface Touch {
  to: number;
  side: 0 | 1;
  /** The middle of where they touch. */
  at: Pt;
  /** How long they touch along the rows (mm). */
  width: number;
}

/** A way to sew a section starting at one side: the entry point and where it leaves the needle. */
export interface Way<W> {
  w: W;
  p: Pt;
  exit: Pt;
}

export interface TourInput<W> {
  touches: Touch[][];
  /** The length of the way between two points inside the area; the straight line by default. */
  dist?: (p: Pt, q: Pt) => number;
  /** The ways to sew section i starting at side `from` (the ends of that row). */
  ways(i: number, from: 0 | 1): Way<W>[];
}

const straight = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Parts of the graph: the sections each part holds. */
function parts(touches: Touch[][]): number[][] {
  const seen = new Uint8Array(touches.length);
  const out: number[][] = [];
  for (let i = 0; i < touches.length; i++) {
    if (seen[i]) continue;
    const part = [i];
    seen[i] = 1;
    for (let j = 0; j < part.length; j++) {
      for (const t of touches[part[j]]) {
        if (!seen[t.to]) {
          seen[t.to] = 1;
          part.push(t.to);
        }
      }
    }
    out.push(part);
  }
  return out;
}

/** A touch between two sections of a part, from both sides. */
type Edge = { a: number; b: number; ta: Touch; tb: Touch };

function edgesOf(part: number[], touches: Touch[][]): Edge[] {
  const out: Edge[] = [];
  for (const a of part) {
    for (const ta of touches[a]) {
      if (ta.side !== 1) continue;
      const tb = touches[ta.to].find((x) => x.to === a && x.side === 0)!;
      out.push({ a, b: ta.to, ta, tb });
    }
  }
  return out;
}

/** The tree of these edges: for each section, the touches to its neighbours. */
function treeOf(part: number[], edges: Edge[]): Map<number, Touch[]> {
  const tree = new Map<number, Touch[]>(part.map((i) => [i, []]));
  for (const e of edges) {
    tree.get(e.a)!.push(e.ta);
    tree.get(e.b)!.push(e.tb);
  }
  return tree;
}

/** Whether these edges hold the part together (with as many edges as a tree has, then a tree). */
function connects(part: number[], edges: Edge[]): boolean {
  const up = new Map(part.map((i) => [i, i]));
  const find = (i: number): number => (up.get(i) === i ? i : find(up.get(i)!));
  let n = part.length;
  for (const e of edges) {
    const [x, y] = [find(e.a), find(e.b)];
    if (x !== y) {
      up.set(x, y);
      n--;
    }
  }
  return n === 1;
}

/** Up to this many spanning trees of a part with holes are tried. */
const TREES = 400;

/**
 * Spanning trees of a part. Each hole closes one cycle; leaving out one touch of every cycle gives
 * a tree, and every choice is tried while they are few. The widest tree (keeping the longest
 * touches, where hidden ways are roomiest) comes first.
 */
function spanningTrees(part: number[], touches: Touch[][]): Map<number, Touch[]>[] {
  const edges = edgesOf(part, touches).sort((x, y) => y.ta.width - x.ta.width);
  const drop = edges.length - (part.length - 1);
  // Kruskal by width: the widest tree.
  const widest: Edge[] = [];
  for (const e of edges) if (!sameSide(part, widest, e)) widest.push(e);
  const trees = [treeOf(part, widest)];
  if (drop <= 0) return trees;
  let count = 1;
  for (let i = 0; i < drop; i++) count = (count * (edges.length - i)) / (i + 1);
  if (count > TREES * 4) return trees;
  const pick = (from: number, left: number, out: Edge[]) => {
    if (trees.length >= TREES) return;
    if (!left) {
      const kept = edges.filter((e) => !out.includes(e));
      if (connects(part, kept)) trees.push(treeOf(part, kept));
      return;
    }
    for (let i = from; i <= edges.length - left; i++) pick(i + 1, left - 1, [...out, edges[i]]);
  };
  pick(0, drop, []);
  return trees;
}

/** Whether adding e to these edges would close a cycle. */
function sameSide(part: number[], edges: Edge[], e: Edge): boolean {
  const up = new Map(part.map((i) => [i, i]));
  const find = (i: number): number => (up.get(i) === i ? i : find(up.get(i)!));
  for (const x of edges) up.set(find(x.a), find(x.b));
  return find(e.a) === find(e.b);
}

export interface Step<W> {
  i: number;
  from: 0 | 1;
  w: W;
}

/**
 * The postorder tour of a tree from `root`, sewn starting at side `from`, entered at `pos`:
 * the sections in sewing order and the straight length of the ways between them.
 */
function postorder<W>(tree: Map<number, Touch[]>, ways: TourInput<W>['ways'], dist: (p: Pt, q: Pt) => number, root: number, from: 0 | 1, pos: Pt, finish?: (p: Pt) => number): { steps: Step<W>[]; cost: number; pos: Pt } {
  const steps: Step<W>[] = [];
  let cost = 0;
  const visit = (s: number, start: 0 | 1, parent: number) => {
    const end = (1 - start) as 0 | 1;
    // Branches on the side the section ends first, then those on the side it starts: the needle
    // ends up where the section begins. Each group nearest first.
    for (const side of [end, start]) {
      const todo = tree.get(s)!.filter((t) => t.to !== parent && t.side === side);
      while (todo.length) {
        let bi = 0;
        for (let i = 1; i < todo.length; i++) if (dist(pos, todo[i].at) < dist(pos, todo[bi].at)) bi = i;
        const t = todo.splice(bi, 1)[0];
        // The branch touches this section across its side t.side; it ends there, so starts on the other.
        visit(t.to, t.side, s);
      }
    }
    // The root, sewn last, also by where it leaves the needle.
    const tail = (w: Way<W>) => dist(pos, w.p) + (s === root && finish ? finish(w.exit) : 0);
    let best: Way<W> | null = null;
    for (const w of ways(s, start)) if (!best || tail(w) < tail(best)) best = w;
    cost += dist(pos, best!.p);
    pos = best!.exit;
    steps.push({ i: s, from: start, w: best!.w });
  };
  visit(root, from, -1);
  return { steps, cost, pos };
}

/** The cheapest tree tour of one part from `pos` (with `end`, the way on there counts too). */
function tourPart<W>(part: number[], input: TourInput<W>, pos: Pt, end?: (p: Pt) => number): { steps: Step<W>[]; cost: number; pos: Pt } {
  let best: { steps: Step<W>[]; cost: number; pos: Pt } | null = null;
  for (const tree of spanningTrees(part, input.touches)) {
    for (const root of part) {
      for (const from of [0, 1] as const) {
        const t = postorder(tree, input.ways, input.dist ?? straight, root, from, pos, end);
        const c = t.cost + (end ? end(t.pos) : 0);
        if (!best || c < best.cost) best = { ...t, cost: c };
      }
    }
  }
  return best!;
}

/** Up to this many parts, every order of them is tried. */
const ORDER_ALL = 5;

/**
 * The tour of all sections from `start`. With `end`, what ending at a point costs; `jump`, what a
 * way between parts costs on top of its length (they are often a trim apart).
 */
export function tour<W>(input: TourInput<W>, start: Pt, end?: (p: Pt) => number, jump = 0): Step<W>[] {
  const ps = parts(input.touches);
  if (ps.length === 1) return tourPart(ps[0], input, start, end).steps;
  // Several parts: every order of a few, else nearest part next.
  const run = (order: number[][]) => {
    let pos = start;
    let cost = 0;
    const steps: Step<W>[] = [];
    order.forEach((part, k) => {
      const t = tourPart(part, input, pos, k === order.length - 1 ? end : undefined);
      cost += t.cost + (k ? jump : 0);
      steps.push(...t.steps);
      pos = t.pos;
    });
    return { steps, cost };
  };
  if (ps.length <= ORDER_ALL) {
    let best: { steps: Step<W>[]; cost: number } | null = null;
    const perm = (left: number[][], done: number[][]) => {
      if (!left.length) {
        const r = run(done);
        if (!best || r.cost < best.cost) best = r;
        return;
      }
      left.forEach((p, i) => perm([...left.slice(0, i), ...left.slice(i + 1)], [...done, p]));
    };
    perm(ps, []);
    return best!.steps;
  }
  const left = ps.slice();
  const order: number[][] = [];
  let pos = start;
  while (left.length) {
    let bi = 0;
    let bt: ReturnType<typeof tourPart<W>> | null = null;
    left.forEach((part, i) => {
      const t = tourPart(part, input, pos);
      if (!bt || t.cost < bt.cost) {
        bt = t;
        bi = i;
      }
    });
    order.push(left.splice(bi, 1)[0]);
    pos = bt!.pos;
  }
  return run(order).steps;
}
