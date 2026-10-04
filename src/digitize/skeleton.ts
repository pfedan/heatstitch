import { pixelMm, type Region } from './region';

/**
 * Centerlines of narrow regions, for satin columns and running stitch.
 *
 * Thinning in the order of the distance transform (as scikit-image's medial_axis): pixels are
 * removed from the outside in, only where removing them keeps the region 8-connected, and line ends
 * are kept. The result lies on the ridge of the distance field and keeps the topology (a ring stays
 * a ring). The pixel skeleton becomes a graph of nodes (ends, junctions) and branches; side branches
 * that are short against the local width (spurs from corners and outline noise) are pruned, the
 * criterion the Goldman patent and the integer medial axis pruning (Hesselink & Roerdink 2008) use.
 */

export type Pt = [number, number];

export interface Branch {
  /** Node indices at both ends (equal for a closed loop). */
  a: number;
  b: number;
  /** Centerline in image mm from node a to node b. */
  pts: Pt[];
  /** Half width (mm) at each point. */
  r: number[];
}

export interface Graph {
  nodes: { p: Pt; r: number }[];
  branches: Branch[];
}

// Neighbour offsets, counterclockwise from east: x1..x8 of the connectivity number.
const NX = [1, 1, 0, -1, -1, -1, 0, 1];
const NY = [0, -1, -1, -1, 0, 1, 1, 1];

/** Yokoi 8-connectivity number per neighbourhood byte: 1 means removing the pixel keeps the topology. */
const SIMPLE = (() => {
  const t = new Uint8Array(256);
  for (let m = 0; m < 256; m++) {
    const x = (k: number) => 1 - ((m >> (k % 8)) & 1);
    let n = 0;
    for (const k of [0, 2, 4, 6]) n += x(k) - x(k) * x(k + 1) * x(k + 2);
    t[m] = n === 1 ? 1 : 0;
  }
  return t;
})();

function neighbourByte(s: Uint8Array, w: number, i: number): number {
  const x = i % w;
  const y = (i - x) / w;
  let m = 0;
  for (let k = 0; k < 8; k++) if (s[(y + NY[k]) * w + x + NX[k]]) m |= 1 << k;
  return m;
}

const bits = (m: number) => {
  let c = 0;
  for (; m; m &= m - 1) c++;
  return c;
};

/** One-pixel skeleton of the region mask (the mask has an empty margin, so no bounds checks). */
export function thin(r: Region): Uint8Array {
  const s = r.mask.slice();
  const order: number[] = [];
  for (let i = 0; i < s.length; i++) if (s[i]) order.push(i);
  order.sort((a, b) => r.inside[a] - r.inside[b]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const i of order) {
      if (!s[i]) continue;
      const m = neighbourByte(s, r.w, i);
      if (bits(m) <= 1 || !SIMPLE[m]) continue;
      s[i] = 0;
      changed = true;
    }
  }
  return s;
}

/** Turns the pixel skeleton into nodes and branches (pixel indices). */
function trace(s: Uint8Array, w: number): { nodes: number[][]; edges: { a: number; b: number; px: number[] }[] } {
  const deg = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) if (s[i]) deg[i] = bits(neighbourByte(s, w, i));
  // Node pixels: ends and junctions; touching junction pixels form one node.
  const nodeOf = new Int32Array(s.length).fill(-1);
  const nodes: number[][] = [];
  for (let i = 0; i < s.length; i++) {
    if (!s[i] || nodeOf[i] >= 0 || deg[i] === 2) continue;
    const id = nodes.length;
    const cluster = [i];
    nodeOf[i] = id;
    if (deg[i] >= 3) {
      for (let k = 0; k < cluster.length; k++) {
        const p = cluster[k];
        for (let d = 0; d < 8; d++) {
          const q = p + NY[d] * w + NX[d];
          if (s[q] && deg[q] >= 3 && nodeOf[q] < 0) {
            nodeOf[q] = id;
            cluster.push(q);
          }
        }
      }
    }
    nodes.push(cluster);
  }
  const used = new Uint8Array(s.length);
  const edges: { a: number; b: number; px: number[] }[] = [];
  const seenDirect = new Set<string>();
  const walk = (start: number, from: number, node: number) => {
    const px = [start];
    used[start] = 1;
    let prev = from;
    let cur = start;
    for (;;) {
      let next = -1;
      // Prefer the 4-neighbours so diagonal staircases are not cut short twice.
      for (const d of [0, 2, 4, 6, 1, 3, 5, 7]) {
        const q = cur + NY[d] * w + NX[d];
        if (!s[q] || q === prev || (nodeOf[q] === node && px.length === 1 && q === from)) continue;
        if (nodeOf[q] >= 0 && !(nodeOf[q] === node && px.length < 2)) {
          next = q;
          break;
        }
        if (nodeOf[q] < 0 && !used[q]) {
          next = q;
          break;
        }
      }
      if (next < 0) return null;
      if (nodeOf[next] >= 0) return { b: nodeOf[next], px };
      used[next] = 1;
      px.push(next);
      prev = cur;
      cur = next;
    }
  };
  nodes.forEach((cluster, id) => {
    for (const p of cluster) {
      for (let d = 0; d < 8; d++) {
        const q = p + NY[d] * w + NX[d];
        if (!s[q] || nodeOf[q] === id) continue;
        if (nodeOf[q] >= 0) {
          const key = id < nodeOf[q] ? `${id},${nodeOf[q]}` : `${nodeOf[q]},${id}`;
          if (!seenDirect.has(key)) {
            seenDirect.add(key);
            edges.push({ a: id, b: nodeOf[q], px: [] });
          }
          continue;
        }
        if (used[q]) continue;
        const r = walk(q, p, id);
        if (r) edges.push({ a: id, b: r.b, px: r.px });
      }
    }
  });
  // What is left are rings without any node: start a node anywhere on them.
  for (let i = 0; i < s.length; i++) {
    if (!s[i] || used[i] || nodeOf[i] >= 0) continue;
    const id = nodes.length;
    nodes.push([i]);
    nodeOf[i] = id;
    const px: number[] = [];
    let prev = i;
    let cur = i;
    for (;;) {
      let next = -1;
      for (const d of [0, 2, 4, 6, 1, 3, 5, 7]) {
        const q = cur + NY[d] * w + NX[d];
        if (s[q] && q !== prev && !used[q] && nodeOf[q] < 0) {
          next = q;
          break;
        }
      }
      if (next < 0) break;
      used[next] = 1;
      px.push(next);
      prev = cur;
      cur = next;
    }
    edges.push({ a: id, b: id, px });
  }
  return { nodes, edges };
}

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

function length(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/**
 * Gaussian smoothing over `sigma` points (the points are about evenly spaced). Open polylines keep
 * their ends, and the window shrinks symmetrically towards them; a closed loop wraps around (its
 * last point repeats the first).
 */
export function smooth(pts: Pt[], sigma: number, closed: boolean): Pt[] {
  const n = closed ? pts.length - 1 : pts.length;
  if (n < 3) return pts.slice();
  const K = Math.ceil(2.5 * sigma);
  const out = pts.slice(0, n).map((p, i): Pt => {
    if (!closed && (i === 0 || i === n - 1)) return p;
    const k = closed ? K : Math.min(K, i, n - 1 - i);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let j = -k; j <= k; j++) {
      const q = pts[closed ? (((i + j) % n) + n) % n : i + j];
      const wt = Math.exp(-(j * j) / (2 * sigma * sigma));
      sx += q[0] * wt;
      sy += q[1] * wt;
      sw += wt;
    }
    return [sx / sw, sy / sw];
  });
  if (closed) out.push(out[0]);
  return out;
}

/**
 * Skeleton graph of the region in image mm: pruned and smoothed, each branch with its half width.
 */
export function skeleton(r: Region): Graph {
  const s = thin(r);
  const { nodes: pixNodes, edges } = trace(s, r.w);
  const center = (cluster: number[]): Pt => {
    let x = 0;
    let y = 0;
    for (const i of cluster) {
      const [px, py] = pixelMm(r, i % r.w, Math.floor(i / r.w));
      x += px;
      y += py;
    }
    return [x / cluster.length, y / cluster.length];
  };
  const half = (i: number) => Math.max(0.5, r.inside[i] - 0.5) * r.pxMm;
  const nodes = pixNodes.map((c) => ({ p: center(c), r: Math.max(...c.map(half)) }));
  let branches: Branch[] = edges.map((e) => {
    const pts: Pt[] = [nodes[e.a].p, ...e.px.map((i) => pixelMm(r, i % r.w, Math.floor(i / r.w))), nodes[e.b].p];
    return { a: e.a, b: e.b, pts, r: [nodes[e.a].r, ...e.px.map(half), nodes[e.b].r] };
  });

  // Prune spurs: an end branch shorter than 1.5 local radii of its junction plus two pixels.
  for (let changed = true; changed; ) {
    changed = false;
    const degree = new Array(nodes.length).fill(0);
    for (const b of branches) {
      degree[b.a]++;
      degree[b.b]++;
    }
    const keep: Branch[] = [];
    for (const b of branches) {
      if (b.a === b.b) {
        keep.push(b);
        continue;
      }
      const endA = degree[b.a] === 1;
      const endB = degree[b.b] === 1;
      const junction = endA && !endB ? b.b : endB && !endA ? b.a : -1;
      if (junction >= 0 && length(b.pts) < 1.5 * nodes[junction].r + 2 * r.pxMm) {
        degree[b.a]--;
        degree[b.b]--;
        changed = true;
        continue;
      }
      keep.push(b);
    }
    branches = keep;
    // Join the two branches at nodes that are left with degree 2.
    for (let n = 0; n < nodes.length; n++) {
      const at = branches.filter((b) => b.a === n || b.b === n);
      if (at.length !== 2 || at[0] === at[1] || at.some((b) => b.a === b.b)) continue;
      const [p, q] = at;
      const pIn = p.b === n ? p : reverse(p);
      const qOut = q.a === n ? q : reverse(q);
      const joined: Branch = { a: pIn.a, b: qOut.b, pts: [...pIn.pts, ...qOut.pts.slice(1)], r: [...pIn.r, ...qOut.r.slice(1)] };
      branches = branches.filter((b) => b !== p && b !== q).concat([joined]);
      changed = true;
    }
  }
  // Thinning can run a line end out into one corner of the shape (a thin diagonal tail). Free ends
  // lose their thin tail; the satin extends them along their direction to the edge again.
  const degree = new Array(nodes.length).fill(0);
  for (const b of branches) {
    degree[b.a]++;
    degree[b.b]++;
  }
  branches = branches.map((b) => (b.a === b.b ? b : trimTails(b, degree[b.a] === 1, degree[b.b] === 1)));
  // Smooth the centerlines and resample them evenly (0.1 mm).
  branches = branches.map((b) => {
    const closed = b.a === b.b;
    const sm = smooth(b.pts, 0.35 / r.pxMm, closed);
    return resample(sm, smooth1(b.r, 3), 0.1);
  }).map((x, k) => ({ ...branches[k], pts: x.pts, r: x.r }));
  return { nodes, branches };
}

/** Drops points at free ends where the branch is thinner than half its median width. */
function trimTails(b: Branch, freeA: boolean, freeB: boolean): Branch {
  const sorted = b.r.slice().sort((x, y) => x - y);
  const limit = sorted[sorted.length >> 1] / 2;
  // At most a third of the branch from each end.
  const most = Math.floor(b.pts.length / 3);
  let i = 0;
  let j = b.pts.length - 1;
  if (freeA) while (i < most && b.r[i] < limit) i++;
  if (freeB) while (b.pts.length - 1 - j < most && b.r[j] < limit) j--;
  if (j - i < 1) return b;
  return { ...b, pts: b.pts.slice(i, j + 1), r: b.r.slice(i, j + 1) };
}

export function reverse(b: Branch): Branch {
  return { a: b.b, b: b.a, pts: b.pts.slice().reverse(), r: b.r.slice().reverse() };
}

/** Moving average over 2k+1 values. */
function smooth1(v: number[], k: number): number[] {
  return v.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(v.length - 1, i + k); j++) {
      s += v[j];
      n++;
    }
    return s / n;
  });
}

/** Resamples a polyline (with a value per point) at even arc length steps. */
export function resample(pts: Pt[], vals: number[], step: number): { pts: Pt[]; r: number[] } {
  if (pts.length < 2) return { pts: pts.slice(), r: vals.slice() };
  const total = length(pts);
  const n = Math.max(1, Math.round(total / step));
  const out: Pt[] = [pts[0]];
  const r: number[] = [vals[0]];
  let seg = 0;
  let segStart = 0;
  let segLen = dist(pts[0], pts[1]);
  for (let k = 1; k <= n; k++) {
    const s = (k / n) * total;
    while (seg < pts.length - 2 && segStart + segLen < s) {
      segStart += segLen;
      seg++;
      segLen = dist(pts[seg], pts[seg + 1]);
    }
    const t = segLen > 0 ? Math.min(1, (s - segStart) / segLen) : 0;
    const a = pts[seg];
    const b = pts[seg + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    r.push(vals[seg] + (vals[seg + 1] - vals[seg]) * t);
  }
  return { pts: out, r };
}

export { length as polylineLength };
