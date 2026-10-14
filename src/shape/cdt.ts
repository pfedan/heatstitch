/**
 * Constrained Delaunay triangulation of closed outlines (outsides and holes), for the medial axis
 * (see digitize/medial.ts).
 *
 * Points are inserted one by one and the triangulation kept Delaunay by Lawson flips; the outline
 * segments are then forced in by flipping the edges they cross (Sloan 1993) and the Delaunay
 * property restored around them, never flipping a segment. The triangles inside are those reached
 * from outside across an odd number of segments (even-odd, as areaLoops reads outsides and holes).
 *
 * The predicates are exact: coordinates are snapped to a grid of SNAP mm, small enough to change
 * nothing visible and coarse enough that orientation is exact in doubles; the in-circle test is
 * filtered in doubles (Shewchuk's error bound) and decided in BigInt when the filter is unsure.
 */

export type Pt = [number, number];

/** Grid the coordinates are snapped to (mm). */
const SNAP = 1e-4;
const EPS = 2 ** -53;
/** Shewchuk's static error bound of the in-circle determinant in doubles. */
const ICC_BOUND = (10 + 96 * EPS) * EPS;

export interface Triangulation {
  /** The points as snapped (mm); duplicates of an earlier point are left out (see `index`). */
  points: Pt[];
  /** Per input point (outlines one after the other), its index in `points`. */
  index: number[];
  /** Three point indices per triangle, counterclockwise (y up) or clockwise on screen (y down). */
  tris: number[];
  /** Per half-edge (3 per triangle, edge k of triangle t from tris[3t+k] to the next): the twin half-edge, or -1. */
  twin: number[];
  /** Per half-edge: whether it is an outline segment. */
  fixed: boolean[];
}

const next = (e: number) => (e % 3 === 2 ? e - 2 : e + 1);
const prev = (e: number) => (e % 3 === 0 ? e + 2 : e - 1);

/**
 * The triangles inside closed outlines `loops` (each a list of points, closing on itself). Nothing
 * for less than three points. Self-crossing outlines are triangulated as far as they go; a segment
 * through another point is split there.
 */
export function triangulate(loops: Pt[][]): Triangulation {
  // Snapped to integers on the grid, relative to the middle of the box: exact orientation.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of loops) for (const [x, y] of l) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const cx = Math.round((x0 + x1) / 2 / SNAP);
  const cy = Math.round((y0 + y1) / 2 / SNAP);
  const X: number[] = [];
  const Y: number[] = [];
  const key = new Map<string, number>();
  const index: number[] = [];
  const segs: [number, number][] = [];
  for (const l of loops) {
    const ids: number[] = [];
    for (const [x, y] of l) {
      const ix = Math.round(x / SNAP) - cx;
      const iy = Math.round(y / SNAP) - cy;
      const k = `${ix},${iy}`;
      let id = key.get(k);
      if (id === undefined) {
        key.set(k, (id = X.length));
        X.push(ix);
        Y.push(iy);
      }
      index.push(id);
      if (ids[ids.length - 1] !== id) ids.push(id);
    }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (ids.length < 3) continue;
    for (let i = 0; i < ids.length; i++) segs.push([ids[i], ids[(i + 1) % ids.length]]);
  }
  const n = X.length;
  const points: Pt[] = X.map((x, i) => [(x + cx) * SNAP, (Y[i] + cy) * SNAP]);
  if (n < 3) return { points, index, tris: [], twin: [], fixed: [] };

  // A triangle round everything, far enough to stay outside every circle that matters, near
  // enough that orientation stays exact (products below 2^53).
  const span = Math.max(x1 - x0, y1 - y0) / SNAP + 10;
  const far = Math.ceil(span * 3);
  X.push(-far, far, 0);
  Y.push(-far, -far, far);
  const tris: number[] = [n, n + 1, n + 2];
  const twin: number[] = [-1, -1, -1];
  const fixed: boolean[] = [false, false, false];
  // An edge leaving each point, to walk round it.
  const out = new Int32Array(n + 3).fill(-1);
  out[n] = 0;
  out[n + 1] = 1;
  out[n + 2] = 2;

  const orient = (a: number, b: number, c: number) => (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]);
  // Whether d lies inside the circle through a, b, c (counterclockwise).
  const inCircle = (a: number, b: number, c: number, d: number): boolean => {
    const adx = X[a] - X[d];
    const ady = Y[a] - Y[d];
    const bdx = X[b] - X[d];
    const bdy = Y[b] - Y[d];
    const cdx = X[c] - X[d];
    const cdy = Y[c] - Y[d];
    const al = adx * adx + ady * ady;
    const bl = bdx * bdx + bdy * bdy;
    const cl = cdx * cdx + cdy * cdy;
    const det = al * (bdx * cdy - cdx * bdy) + bl * (cdx * ady - adx * cdy) + cl * (adx * bdy - bdx * ady);
    const perm = al * (Math.abs(bdx * cdy) + Math.abs(cdx * bdy)) + bl * (Math.abs(cdx * ady) + Math.abs(adx * cdy)) + cl * (Math.abs(adx * bdy) + Math.abs(bdx * ady));
    if (Math.abs(det) > ICC_BOUND * perm) return det > 0;
    const [Ax, Ay, Bx, By, Cx, Cy] = [adx, ady, bdx, bdy, cdx, cdy].map(BigInt);
    const exact = (Ax * Ax + Ay * Ay) * (Bx * Cy - Cx * By) + (Bx * Bx + By * By) * (Cx * Ay - Ax * Cy) + (Cx * Cx + Cy * Cy) * (Ax * By - Bx * Ay);
    return exact > 0n;
  };

  const link = (a: number, b: number) => {
    twin[a] = b;
    if (b >= 0) twin[b] = a;
  };
  const setFixed = (e: number, f: boolean) => {
    fixed[e] = f;
    if (twin[e] >= 0) fixed[twin[e]] = f;
  };
  const addTri = (a: number, b: number, c: number): number => {
    const t = tris.length;
    tris.push(a, b, c);
    twin.push(-1, -1, -1);
    fixed.push(false, false, false);
    out[a] = t;
    out[b] = t + 1;
    out[c] = t + 2;
    return t;
  };

  // Edge e (a to b, w opposite) and its twin (b to a, x opposite) become the edge from w to x.
  const flip = (a0: number) => {
    const b0 = twin[a0];
    const [a1, a2, b1, b2] = [next(a0), prev(a0), next(b0), prev(b0)];
    const [u, v, w, x] = [tris[a0], tris[a1], tris[a2], tris[b2]];
    const [ta2, ta1, tb1, tb2] = [twin[a2], twin[a1], twin[b1], twin[b2]];
    const [fa2, fa1, fb1, fb2] = [fixed[a2], fixed[a1], fixed[b1], fixed[b2]];
    tris[a0] = w;
    tris[a1] = u;
    tris[a2] = x;
    tris[b0] = x;
    tris[b1] = v;
    tris[b2] = w;
    link(a0, ta2);
    fixed[a0] = fa2;
    link(a1, tb1);
    fixed[a1] = fb1;
    link(b0, tb2);
    fixed[b0] = fb2;
    link(b1, ta1);
    fixed[b1] = fa1;
    link(a2, b2);
    fixed[a2] = fixed[b2] = false;
    out[w] = a0;
    out[u] = a1;
    out[x] = b0;
    out[v] = b1;
  };

  // Lawson: flip edges whose opposite point lies in the circle, never a segment.
  const legalize = (start: number[]) => {
    const stack = start.slice();
    while (stack.length) {
      const e = stack.pop()!;
      const f = twin[e];
      if (f < 0 || fixed[e]) continue;
      const [u, v, w, x] = [tris[e], tris[next(e)], tris[prev(e)], tris[prev(f)]];
      if (!inCircle(u, v, w, x)) continue;
      flip(e);
      // After the flip the old outer edges sit at a1 and b0 (see flip).
      stack.push(next(e), f);
    }
  };

  // Point location by walking from the last triangle toward p (terminates on a Delaunay triangulation).
  let last = 0;
  const locate = (p: number): { e: number; on: boolean } => {
    let t = last;
    for (let guard = 0; guard < 4 * tris.length + 100; guard++) {
      let moved = false;
      let on = -1;
      for (let k = 0; k < 3; k++) {
        const e = t + k;
        const o = orient(tris[e], tris[next(e)], p);
        if (o < 0 && twin[e] >= 0) {
          t = twin[e] - (twin[e] % 3);
          moved = true;
          break;
        }
        if (o === 0) on = e;
      }
      if (!moved) return { e: on >= 0 ? on : t, on: on >= 0 };
    }
    throw new Error('triangulate: point not found');
  };

  const insert = (p: number) => {
    const { e, on } = locate(p);
    if (!on) {
      // Split the triangle in three: (a, b, p) keeps its slot, (b, c, p) and (c, a, p) are new.
      const t = e;
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
      const [tb, tc] = [twin[t + 1], twin[t + 2]];
      const [fb, fc] = [fixed[t + 1], fixed[t + 2]];
      tris[t + 2] = p;
      const t1 = addTri(b, c, p);
      const t2 = addTri(c, a, p);
      link(t1, tb);
      fixed[t1] = fb;
      link(t2, tc);
      fixed[t2] = fc;
      link(t + 1, t1 + 2);
      link(t1 + 1, t2 + 2);
      link(t2 + 1, t + 2);
      fixed[t + 1] = fixed[t + 2] = false;
      out[a] = t;
      out[b] = t1;
      out[c] = t2;
      out[p] = t + 2;
      last = t;
      legalize([t, t1, t2]);
      return;
    }
    // On edge e (a to b, c opposite), its twin (b to a, d opposite): four triangles round p.
    const f = twin[e];
    const wasFixed = fixed[e];
    const [a, b, c] = [tris[e], tris[next(e)], tris[prev(e)]];
    const [tbc, tca] = [twin[next(e)], twin[prev(e)]];
    const [fbc, fca] = [fixed[next(e)], fixed[prev(e)]];
    // Triangle of e becomes (a, p, c); new (p, b, c).
    tris[next(e)] = p;
    const t1 = addTri(p, b, c);
    link(t1 + 1, tbc);
    fixed[t1 + 1] = fbc;
    link(next(e), t1 + 2);
    fixed[next(e)] = false;
    fixed[t1 + 2] = false;
    link(prev(e), tca);
    fixed[prev(e)] = fca;
    out[a] = e;
    out[c] = t1 + 2;
    out[b] = t1 + 1;
    out[p] = t1;
    const legal = [prev(e), t1 + 1];
    if (f >= 0) {
      const d = tris[prev(f)];
      const [tad, tdb] = [twin[next(f)], twin[prev(f)]];
      const [fad, fdb] = [fixed[next(f)], fixed[prev(f)]];
      // Twin (b, a, d) becomes (b, p, d); new (p, a, d).
      tris[next(f)] = p;
      const t2 = addTri(p, a, d);
      link(t2 + 1, tad);
      fixed[t2 + 1] = fad;
      link(next(f), t2 + 2);
      fixed[next(f)] = fixed[t2 + 2] = false;
      link(prev(f), tdb);
      fixed[prev(f)] = fdb;
      // The two halves of the old edge: a to p (in e) with p to a (in t2), p to b (t1) with b to p (f).
      link(e, t2);
      link(t1, f);
      fixed[e] = fixed[t2] = fixed[t1] = fixed[f] = wasFixed;
      out[d] = t2 + 2;
      legal.push(t2 + 1, prev(f));
    } else {
      link(e, -1);
      link(t1, -1);
    }
    last = e - (e % 3);
    legalize(legal);
  };

  // Points in the order of a Hilbert curve, so each walk is short.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => hilbert(X[a], Y[a], span) - hilbert(X[b], Y[b], span));
  for (const p of order) insert(p);

  // The half-edge from a to b, or -1.
  const edgeFrom = (a: number, b: number): number => {
    const start = out[a];
    let e = start;
    for (let guard = 0; guard < tris.length; guard++) {
      if (tris[next(e)] === b) return e;
      const t = twin[prev(e)];
      if (t < 0) break;
      e = t;
      if (e === start) return -1;
    }
    // At the hull: round the other way too.
    e = start;
    for (let guard = 0; guard < tris.length; guard++) {
      const t = twin[e];
      if (t < 0) return -1;
      e = next(t);
      if (tris[next(e)] === b) return e;
      if (e === start) return -1;
    }
    return -1;
  };

  // Forcing a segment in (Sloan): the edges crossing it flipped until none does.
  const force = (s: number, t: number, depth = 0): void => {
    if (s === t || depth > 50) return;
    const have = edgeFrom(s, t);
    if (have >= 0) return setFixed(have, true);
    // The triangle at s that the segment leaves through, and the edges it crosses on to t.
    const crossing: [number, number][] = [];
    let e = out[s];
    let found = -1;
    for (let guard = 0; guard < tris.length; guard++) {
      const a = tris[next(e)];
      const b = tris[prev(e)];
      const oa = orient(s, t, a);
      const ob = orient(s, t, b);
      // A point on the way: the segment split there.
      if (oa === 0 && dotAhead(s, t, a)) {
        force(s, a, depth + 1);
        force(a, t, depth + 1);
        return;
      }
      if (oa < 0 && ob > 0) {
        found = next(e);
        break;
      }
      e = twin[prev(e)];
      if (e < 0 || e === out[s]) break;
    }
    if (found < 0) return;
    let cur = found;
    for (let guard = 0; guard < tris.length; guard++) {
      crossing.push([tris[cur], tris[next(cur)]]);
      const f = twin[cur];
      if (f < 0) return;
      const c = tris[prev(f)];
      if (c === t) break;
      const oc = orient(s, t, c);
      if (oc === 0) {
        force(s, c, depth + 1);
        force(c, t, depth + 1);
        return;
      }
      cur = oc < 0 ? prev(f) : next(f);
    }
    const queue = crossing;
    const made: [number, number][] = [];
    for (let guard = 0; queue.length && guard < 100000; guard++) {
      const [a, b] = queue.shift()!;
      const e = edgeFrom(a, b);
      if (e < 0) continue;
      const w = tris[prev(e)];
      const x = tris[prev(twin[e])];
      // Only a convex quadrilateral can be flipped.
      if (!(orient(w, x, a) * orient(w, x, b) < 0)) {
        queue.push([a, b]);
        continue;
      }
      flip(e);
      const crosses = w !== s && w !== t && x !== s && x !== t && orient(s, t, w) * orient(s, t, x) < 0;
      if (crosses) queue.push([w, x]);
      else made.push([w, x]);
    }
    const se = edgeFrom(s, t);
    if (se >= 0) setFixed(se, true);
    // Delaunay again round the new edges, the segment kept (Sloan: only new edges need checking).
    for (let changed = true, guard = 0; changed && guard < 100; guard++) {
      changed = false;
      for (let i = 0; i < made.length; i++) {
        const e = edgeFrom(made[i][0], made[i][1]);
        if (e < 0 || fixed[e] || twin[e] < 0) continue;
        if (inCircle(tris[e], tris[next(e)], tris[prev(e)], tris[prev(twin[e])])) {
          flip(e);
          // The new diagonal sits at prev(e), from x to w (see flip).
          made[i] = [tris[prev(e)], tris[e]];
          changed = true;
        }
      }
    }
  };
  // Whether a lies on the segment from s on (not behind s).
  const dotAhead = (s: number, t: number, a: number) => {
    const d = (X[a] - X[s]) * (X[t] - X[s]) + (Y[a] - Y[s]) * (Y[t] - Y[s]);
    const l = (X[t] - X[s]) ** 2 + (Y[t] - Y[s]) ** 2;
    return d > 0 && d < l;
  };
  for (const [a, b] of segs) force(a, b);

  // Inside: reached from the far triangle across an odd number of segments (each triangle at its
  // least count: breadth first within a count, then across segments to the next).
  const T = tris.length / 3;
  const depth = new Int32Array(T).fill(-1);
  let level = [(out[n] - (out[n] % 3)) / 3];
  depth[level[0]] = 0;
  for (let d = 0; level.length; d++) {
    const across: number[] = [];
    for (let head = 0; head < level.length; head++) {
      const t = level[head];
      for (let k = 0; k < 3; k++) {
        const f = twin[3 * t + k];
        if (f < 0) continue;
        const u = (f - (f % 3)) / 3;
        if (depth[u] >= 0) continue;
        if (fixed[3 * t + k]) {
          across.push(u);
          continue;
        }
        depth[u] = d;
        level.push(u);
      }
    }
    level = [];
    for (const u of across) {
      if (depth[u] >= 0) continue;
      depth[u] = d + 1;
      level.push(u);
    }
  }
  const keep: number[] = [];
  for (let t = 0; t < T; t++) if (depth[t] % 2 === 1 && tris[3 * t] < n && tris[3 * t + 1] < n && tris[3 * t + 2] < n) keep.push(t);
  const newOf = new Int32Array(T).fill(-1);
  keep.forEach((t, i) => (newOf[t] = i));
  const kt: number[] = [];
  const kw: number[] = [];
  const kf: boolean[] = [];
  for (const t of keep) {
    for (let k = 0; k < 3; k++) {
      const e = 3 * t + k;
      kt.push(tris[e]);
      const f = twin[e];
      const u = f >= 0 ? newOf[(f - (f % 3)) / 3] : -1;
      kw.push(u >= 0 ? 3 * u + (f % 3) : -1);
      kf.push(fixed[e]);
    }
  }
  return { points, index, tris: kt, twin: kw, fixed: kf };
}

/** Position of (x, y) on a Hilbert curve over the square of side 2·span round the middle. */
function hilbert(x: number, y: number, span: number): number {
  const N = 1 << 16;
  let ix = Math.min(N - 1, Math.max(0, Math.floor(((x + span) / (2 * span)) * N)));
  let iy = Math.min(N - 1, Math.max(0, Math.floor(((y + span) / (2 * span)) * N)));
  let d = 0;
  for (let s = N >> 1; s > 0; s >>= 1) {
    const rx = (ix & s) > 0 ? 1 : 0;
    const ry = (iy & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        ix = s - 1 - ix;
        iy = s - 1 - iy;
      }
      [ix, iy] = [iy, ix];
    }
  }
  return d;
}
