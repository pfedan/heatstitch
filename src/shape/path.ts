import type { Pt } from '../digitize/skeleton';

/**
 * A node of a path: its point and the two handles of the curves next to it (in: towards the node
 * before, out: towards the next). A handle on the node itself makes that side straight. A smooth
 * node keeps its handles on one line, so the outline has no corner there.
 */
export interface Node {
  p: Pt;
  a: Pt;
  b: Pt;
  smooth: boolean;
}

/** Nodes joined by cubic curves; closed paths also join the last node to the first. */
export interface Path {
  nodes: Node[];
  closed: boolean;
}

/**
 * A shape as vectors, in world millimetres (0.1 mm records / 10). An area is one or more closed
 * paths, filled even-odd: a path inside another is a hole. Shapes from SVG files may fill by the
 * nonzero rule instead (paths running the same way add up rather than cut holes).
 */
export interface Form {
  paths: Path[];
  nonzero?: boolean;
}

/** Affine map x' = a x + c y + e, y' = b x + d y + f. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export const apply = (m: Mat, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** `m` after `n` (first n, then m). */
export const compose = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export const translation = (dx: number, dy: number): Mat => [1, 0, 0, 1, dx, dy];

/** Turned by `deg` (clockwise on screen, y points down) around (cx, cy). */
export function rotation(deg: number, cx: number, cy: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

export const scaling = (sx: number, sy: number, cx: number, cy: number): Mat => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];

/** Turn of a map in degrees, and whether it mirrors. */
export function turnOf(m: Mat): { deg: number; mirror: boolean } {
  return { deg: (Math.atan2(m[1], m[0]) * 180) / Math.PI, mirror: m[0] * m[3] - m[1] * m[2] < 0 };
}

export const cloneForm = (f: Form): Form => ({
  ...(f.nonzero ? { nonzero: true } : {}),
  paths: f.paths.map((p) => ({ closed: p.closed, nodes: p.nodes.map((n) => ({ p: [...n.p] as Pt, a: [...n.a] as Pt, b: [...n.b] as Pt, smooth: n.smooth })) })),
});

export function transformForm(f: Form, m: Mat): Form {
  return {
    ...(f.nonzero ? { nonzero: true } : {}),
    paths: f.paths.map((p) => ({ closed: p.closed, nodes: p.nodes.map((n) => ({ p: apply(m, n.p), a: apply(m, n.a), b: apply(m, n.b), smooth: n.smooth })) })),
  };
}

/** Number of curves of a path. */
export const segments = (p: Path): number => (p.closed ? p.nodes.length : Math.max(0, p.nodes.length - 1));

/** Control points of curve `k` of a path. */
export function segment(p: Path, k: number): [Pt, Pt, Pt, Pt] {
  const s = p.nodes[k];
  const e = p.nodes[(k + 1) % p.nodes.length];
  return [s.p, s.b, e.a, e.p];
}

export function bezier([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const straight = (c: [Pt, Pt, Pt, Pt]) => dist(c[0], c[1]) < 1e-9 && dist(c[2], c[3]) < 1e-9;

/** Points along a path, about `step` mm apart on curves (straight sides are one line). */
export function flatten(p: Path, step = 0.1): Pt[] {
  if (!p.nodes.length) return [];
  const out: Pt[] = [p.nodes[0].p];
  for (let k = 0; k < segments(p); k++) {
    const c = segment(p, k);
    const n = straight(c) ? 1 : Math.min(400, Math.max(2, Math.ceil((dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3])) / step)));
    for (let i = 1; i <= n; i++) out.push(bezier(c, i / n));
  }
  return out;
}

export function bounds(f: Form): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of f.paths) {
    for (const [x, y] of flatten(p, 0.2)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/** Whether a point lies inside a closed polyline (even-odd). */
export function insidePoly(pts: Pt[], [x, y]: Pt): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Area enclosed (mm², even-odd: a path inside an odd number of others is a hole). */
export function formArea(f: Form): number {
  const polys = f.paths.filter((p) => p.closed).map((p) => flatten(p));
  let sum = 0;
  polys.forEach((pts, k) => {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
    const depth = polys.filter((q, m) => m !== k && insidePoly(q, pts[0])).length;
    sum += (depth % 2 ? -1 : 1) * Math.abs(a / 2);
  });
  return Math.abs(sum);
}

/** Nearest point on any curve of the form: path, curve, parameter and distance. */
export function nearestOnForm(f: Form, q: Pt): { path: number; seg: number; t: number; d: number } | null {
  let best: { path: number; seg: number; t: number; d: number } | null = null;
  f.paths.forEach((p, pi) => {
    for (let k = 0; k < segments(p); k++) {
      const c = segment(p, k);
      const n = straight(c) ? 1 : 48;
      let prev = c[0];
      for (let i = 1; i <= n; i++) {
        const cur = straight(c) ? c[3] : bezier(c, i / n);
        // Nearest on this little line, its parameter mapped back onto the curve.
        const dx = cur[0] - prev[0];
        const dy = cur[1] - prev[1];
        const l2 = dx * dx + dy * dy;
        const u = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - prev[0]) * dx + (q[1] - prev[1]) * dy) / l2)) : 0;
        const d = Math.hypot(prev[0] + u * dx - q[0], prev[1] + u * dy - q[1]);
        if (!best || d < best.d) best = { path: pi, seg: k, t: (i - 1 + u) / n, d };
        prev = cur;
      }
    }
  });
  return best;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** A new node on curve `seg` of path `path` at parameter `t`; the outline stays exactly as it was. */
export function insertNode(f: Form, path: number, seg: number, t: number): { form: Form; node: number } {
  const g = cloneForm(f);
  const p = g.paths[path];
  const [p0, p1, p2, p3] = segment(p, seg);
  const s = p.nodes[seg];
  const e = p.nodes[(seg + 1) % p.nodes.length];
  if (straight([p0, p1, p2, p3])) {
    const m = lerp(p0, p3, t);
    p.nodes.splice(seg + 1, 0, { p: m, a: [...m] as Pt, b: [...m] as Pt, smooth: false });
    return { form: g, node: seg + 1 };
  }
  // de Casteljau: the curve split in two at t.
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const m = lerp(ab, bc, t);
  s.b = a;
  e.a = c;
  p.nodes.splice(seg + 1, 0, { p: m, a: ab, b: bc, smooth: true });
  return { form: g, node: seg + 1 };
}

/** The form without node `i` of path `path` (null when the path would be too short to keep). */
export function removeNode(f: Form, path: number, i: number): Form | null {
  const g = cloneForm(f);
  const p = g.paths[path];
  if (p.nodes.length <= (p.closed ? 3 : 2)) {
    if (g.paths.length < 2) return null;
    g.paths.splice(path, 1);
    return g;
  }
  p.nodes.splice(i, 1);
  return g;
}

/** Moves a node with its handles. */
export function moveNode(f: Form, path: number, i: number, to: Pt): Form {
  const g = cloneForm(f);
  const n = g.paths[path].nodes[i];
  const dx = to[0] - n.p[0];
  const dy = to[1] - n.p[1];
  for (const q of [n.p, n.a, n.b]) {
    q[0] += dx;
    q[1] += dy;
  }
  return g;
}

/** Moves handle `which` of a node; a smooth node turns its other handle along (keeping its length). */
export function moveHandle(f: Form, path: number, i: number, which: 'a' | 'b', to: Pt): Form {
  const g = cloneForm(f);
  const n = g.paths[path].nodes[i];
  n[which] = [...to] as Pt;
  if (n.smooth) {
    const other = which === 'a' ? 'b' : 'a';
    const len = dist(n.p, n[other]);
    const d = dist(n.p, to);
    if (len > 1e-9 && d > 1e-9) n[other] = [n.p[0] - ((to[0] - n.p[0]) / d) * len, n.p[1] - ((to[1] - n.p[1]) / d) * len];
  }
  return g;
}

/**
 * A node made round (handles along the line between its neighbours, a third of the way to each)
 * or a corner (handles on the node: straight sides).
 */
export function setSmooth(f: Form, path: number, i: number, smooth: boolean): Form {
  const g = cloneForm(f);
  const p = g.paths[path];
  const n = p.nodes[i];
  n.smooth = smooth;
  if (!smooth) {
    n.a = [...n.p] as Pt;
    n.b = [...n.p] as Pt;
    return g;
  }
  const k = p.nodes.length;
  const prev = p.closed || i > 0 ? p.nodes[(i - 1 + k) % k].p : null;
  const next = p.closed || i < k - 1 ? p.nodes[(i + 1) % k].p : null;
  const from = prev ?? n.p;
  const to = next ?? n.p;
  const tx = to[0] - from[0];
  const ty = to[1] - from[1];
  const tl = Math.hypot(tx, ty);
  if (tl < 1e-9) return g;
  const la = prev ? dist(prev, n.p) / 3 : 0;
  const lb = next ? dist(next, n.p) / 3 : 0;
  n.a = [n.p[0] - (tx / tl) * la, n.p[1] - (ty / tl) * la];
  n.b = [n.p[0] + (tx / tl) * lb, n.p[1] + (ty / tl) * lb];
  return g;
}

// Stored as plain numbers ------------------------------------------------------------------

/** A path as it is stored: 7 numbers per node (point, in handle, out handle, smooth 0/1). */
export interface StoredPath {
  c: boolean;
  n: number[];
  /** On the first path: the form fills by the nonzero rule. */
  z?: 1;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function storeForm(f: Form): StoredPath[] {
  return f.paths.map((p, k) => ({ c: p.closed, n: p.nodes.flatMap((n) => [...n.p, ...n.a, ...n.b, n.smooth ? 1 : 0].map(round)), ...(k === 0 && f.nonzero ? { z: 1 as const } : {}) }));
}

/** A stored form back, or null when malformed. */
export function formFrom(list: unknown): Form | null {
  if (!Array.isArray(list) || !list.length) return null;
  const paths: Path[] = [];
  for (const e of list as StoredPath[]) {
    const n = e?.n;
    if (typeof e?.c !== 'boolean' || !Array.isArray(n) || n.length % 7 || n.length < 14 || !n.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    const nodes: Node[] = [];
    for (let i = 0; i < n.length; i += 7) nodes.push({ p: [n[i], n[i + 1]], a: [n[i + 2], n[i + 3]], b: [n[i + 4], n[i + 5]], smooth: n[i + 6] === 1 });
    paths.push({ closed: e.c, nodes });
  }
  return (list as StoredPath[])[0].z === 1 ? { paths, nonzero: true } : { paths };
}
