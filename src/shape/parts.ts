import type { Pt } from '../digitize/skeleton';
import { flatten, type Form, type Path } from './path';
import { JOIN_SNAP_MM } from './join';

/** Sample distance along the curves (mm). */
const STEP = 0.2;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Distance from `q` to the segment from `a` to `b`. */
function toSegment(q: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const l = vx * vx + vy * vy;
  const t = l > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / l)) : 0;
  return Math.hypot(q[0] - a[0] - t * vx, q[1] - a[1] - t * vy);
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Whether the segments a-b and c-d cross (proper or touching). */
function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Distance between the segments a-b and c-d (0 where they cross). */
function segDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (crosses(a, b, c, d)) return 0;
  return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
}

class UnionFind {
  private up: number[];
  constructor(n: number) {
    this.up = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.up[i] !== i) i = this.up[i] = this.up[this.up[i]];
    return i;
  }
  join(a: number, b: number): void {
    this.up[this.find(a)] = this.find(b);
  }
}

/** The polyline of each path (a closed one ends where it starts). */
function polylines(f: Form): Pt[][] {
  return f.paths.map((p) => {
    const pts = flatten(p, STEP);
    return p.closed && pts.length > 1 ? [...pts, pts[0]] : pts;
  });
}

/**
 * Pairs of paths that come within `reach` of each other anywhere along their curves (crossing,
 * touching, an end on the middle of another), found with a grid of cells `cell` wide.
 */
function touchingPairs(lines: Pt[][], reach: number, cell = 2): [number, number][] {
  const cells = new Map<string, [number, number][]>();
  lines.forEach((pts, k) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const x0 = Math.floor((Math.min(a[0], b[0]) - reach) / cell);
      const x1 = Math.floor((Math.max(a[0], b[0]) + reach) / cell);
      const y0 = Math.floor((Math.min(a[1], b[1]) - reach) / cell);
      const y1 = Math.floor((Math.max(a[1], b[1]) + reach) / cell);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const list = cells.get(key);
          if (list) list.push([k, i]);
          else cells.set(key, [[k, i]]);
        }
    }
  });
  const found = new Set<string>();
  const out: [number, number][] = [];
  for (const list of cells.values())
    for (let u = 0; u < list.length; u++)
      for (let v = u + 1; v < list.length; v++) {
        const [k, i] = list[u];
        const [m, j] = list[v];
        if (k === m) continue;
        const key = k < m ? `${k},${m}` : `${m},${k}`;
        if (found.has(key)) continue;
        if (segDist(lines[k][i], lines[k][i + 1], lines[m][j], lines[m][j + 1]) <= reach) {
          found.add(key);
          out.push([k, m]);
        }
      }
  return out;
}

/** Whether `q` lies inside the closed polyline `pts`, and the winding number around it. */
function winding(pts: Pt[], [x, y]: Pt): number {
  let w = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    if (a[1] <= y) {
      if (b[1] > y && cross(a, b, [x, y]) > 0) w++;
    } else if (b[1] <= y && cross(a, b, [x, y]) < 0) w--;
  }
  return w;
}

/** Whether the form fills point `q` by its rule. */
function filledAt(f: Form, lines: Pt[][], q: Pt): boolean {
  let n = 0;
  f.paths.forEach((p, k) => {
    if (!p.closed) return;
    const w = winding(lines[k], q);
    n += f.nonzero ? w : w & 1;
  });
  return f.nonzero ? n !== 0 : (n & 1) === 1;
}

/**
 * Whether closed path `k` is a hole: just inside it the form is not filled, just outside it is.
 * Tried across its longest piece, which lies clear of its own corners.
 */
function isHole(f: Form, lines: Pt[][], k: number): boolean {
  const pts = lines[k];
  let best = 0;
  let at = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = dist(pts[i], pts[i + 1]);
    if (d > best) [best, at] = [d, i];
  }
  if (best < 1e-6) return false;
  const [a, b] = [pts[at], pts[at + 1]];
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const e = Math.min(0.01, best / 4);
  const nx = (-(b[1] - a[1]) / best) * e;
  const ny = ((b[0] - a[0]) / best) * e;
  const l: Pt = [m[0] + nx, m[1] + ny];
  const r: Pt = [m[0] - nx, m[1] - ny];
  const inside = winding(pts, l) !== 0 ? l : r;
  const outside = inside === l ? r : l;
  return !filledAt(f, lines, inside) && filledAt(f, lines, outside);
}

/** Area enclosed by a closed polyline (absolute). */
function polyArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return Math.abs(s / 2);
}

/**
 * The parts a form falls into ("In Teile trennen" on a known form), each a form of its own, in the
 * order of their first path.
 *
 * A line (`area` false): the paths that touch, cross or come within `reach` mm of each other
 * anywhere along their curves stay together, also through other paths: the connected parts of the
 * drawing, the same ones redwork sews without a jump (see digitize/redwork.ts, REDWORK_GAP).
 *
 * An area: each outer loop with its holes (as Inkscape's "Split path", not "Break apart", which
 * makes holes shapes of their own). Loops that cross are one part; a hole goes with the smallest
 * loop around it, an island in a hole is a part of its own. Open paths beside the area go with
 * the part they lie in, else with the first.
 */
export function formParts(f: Form, area: boolean, reach = JOIN_SNAP_MM): Form[] {
  const n = f.paths.length;
  if (n < 2) return [f];
  const lines = polylines(f);
  const uf = new UnionFind(n);
  if (!area) {
    for (const [a, b] of touchingPairs(lines, reach)) uf.join(a, b);
  } else {
    const closed = f.paths.flatMap((p, k) => (p.closed && lines[k].length > 3 ? [k] : []));
    const closedSet = new Set(closed);
    for (const [a, b] of touchingPairs(lines, 0)) if (closedSet.has(a) && closedSet.has(b)) uf.join(a, b);
    const size = new Map(closed.map((k) => [k, polyArea(lines[k])]));
    const around = (k: number, q: Pt) => closed.filter((j) => j !== k && winding(lines[j], q) !== 0).sort((x, y) => size.get(x)! - size.get(y)!)[0];
    for (const k of closed) {
      if (!isHole(f, lines, k)) continue;
      const j = around(k, lines[k][0]);
      if (j !== undefined) uf.join(k, j);
    }
    // Open paths: with the part they lie in.
    const first = closed[0];
    f.paths.forEach((_, k) => {
      if (closedSet.has(k) || !lines[k].length) return;
      const q = lines[k][Math.floor(lines[k].length / 2)];
      const j = around(k, q) ?? first;
      if (j !== undefined) uf.join(k, j);
    });
  }
  const groups = new Map<number, Path[]>();
  f.paths.forEach((p, k) => {
    const r = uf.find(k);
    const g = groups.get(r);
    if (g) g.push(p);
    else groups.set(r, [p]);
  });
  return [...groups.values()].map((paths) => ({ ...(f.nonzero ? { nonzero: true } : {}), paths }));
}
