//! Constrained Delaunay triangulation of closed outlines (outsides and holes), for the medial axis
//! (see digitize/medial.rs).
//!
//! Points are inserted one by one and the triangulation kept Delaunay by Lawson flips; the outline
//! segments are then forced in by flipping the edges they cross (Sloan 1993) and the Delaunay
//! property restored around them, never flipping a segment. The triangles inside are those reached
//! from outside across an odd number of segments (even-odd, as areaLoops reads outsides and holes).
//!
//! The predicates are exact: coordinates are snapped to a grid of SNAP mm, small enough to change
//! nothing visible and coarse enough that orientation is exact in integers; the in-circle test is
//! filtered in doubles (Shewchuk's error bound) and decided in 128-bit integers when the filter is
//! unsure.

use std::collections::VecDeque;

use serde::Serialize;

use crate::geom::Pt;
use crate::js::{IdMap, round};

/// Grid the coordinates are snapped to (mm).
const SNAP: f64 = 1e-4;
const EPS: f64 = f64::EPSILON / 2.0;
/// Shewchuk's static error bound of the in-circle determinant in doubles.
const ICC_BOUND: f64 = (10.0 + 96.0 * EPS) * EPS;

#[derive(Clone, Debug, Default, Serialize)]
pub struct Triangulation {
    /// The points as snapped (mm); duplicates of an earlier point are left out (see `index`).
    pub points: Vec<Pt>,
    /// Per input point (outlines one after the other), its index in `points`.
    pub index: Vec<usize>,
    /// Three point indices per triangle, counterclockwise (y up) or clockwise on screen (y down).
    pub tris: Vec<usize>,
    /// Per half-edge (3 per triangle, edge k of triangle t from tris[3t+k] to the next): the twin half-edge, or -1.
    pub twin: Vec<i64>,
    /// Per half-edge: whether it is an outline segment.
    pub fixed: Vec<bool>,
}

#[inline]
fn next(e: usize) -> usize {
    if e % 3 == 2 { e - 2 } else { e + 1 }
}
#[inline]
fn prev(e: usize) -> usize {
    if e.is_multiple_of(3) { e + 2 } else { e - 1 }
}

const NONE: usize = usize::MAX;

struct Mesh {
    x: Vec<i64>,
    y: Vec<i64>,
    tris: Vec<usize>,
    twin: Vec<usize>,
    fixed: Vec<bool>,
    /// An edge leaving each point, to walk round it.
    out: Vec<usize>,
    last: usize,
}

impl Mesh {
    fn orient(&self, a: usize, b: usize, c: usize) -> i64 {
        (self.x[b] - self.x[a]) * (self.y[c] - self.y[a])
            - (self.y[b] - self.y[a]) * (self.x[c] - self.x[a])
    }

    /// Whether d lies inside the circle through a, b, c (counterclockwise).
    fn in_circle(&self, a: usize, b: usize, c: usize, d: usize) -> bool {
        let (xd, yd) = (self.x[d], self.y[d]);
        let (adx, ady) = (self.x[a] - xd, self.y[a] - yd);
        let (bdx, bdy) = (self.x[b] - xd, self.y[b] - yd);
        let (cdx, cdy) = (self.x[c] - xd, self.y[c] - yd);
        let [fax, fay, fbx, fby, fcx, fcy] = [adx, ady, bdx, bdy, cdx, cdy].map(|v| v as f64);
        let al = fax * fax + fay * fay;
        let bl = fbx * fbx + fby * fby;
        let cl = fcx * fcx + fcy * fcy;
        let det = al * (fbx * fcy - fcx * fby)
            + bl * (fcx * fay - fax * fcy)
            + cl * (fax * fby - fbx * fay);
        let perm = al * ((fbx * fcy).abs() + (fcx * fby).abs())
            + bl * ((fcx * fay).abs() + (fax * fcy).abs())
            + cl * ((fax * fby).abs() + (fbx * fay).abs());
        if det.abs() > ICC_BOUND * perm {
            return det > 0.0;
        }
        let [ax, ay, bx, by, cx, cy] = [adx, ady, bdx, bdy, cdx, cdy].map(i128::from);
        let exact = (ax * ax + ay * ay) * (bx * cy - cx * by)
            + (bx * bx + by * by) * (cx * ay - ax * cy)
            + (cx * cx + cy * cy) * (ax * by - bx * ay);
        exact > 0
    }

    fn link(&mut self, a: usize, b: usize) {
        self.twin[a] = b;
        if b != NONE {
            self.twin[b] = a;
        }
    }

    fn set_fixed(&mut self, e: usize, f: bool) {
        self.fixed[e] = f;
        if self.twin[e] != NONE {
            let t = self.twin[e];
            self.fixed[t] = f;
        }
    }

    fn add_tri(&mut self, a: usize, b: usize, c: usize) -> usize {
        let t = self.tris.len();
        self.tris.extend([a, b, c]);
        self.twin.extend([NONE; 3]);
        self.fixed.extend([false; 3]);
        self.out[a] = t;
        self.out[b] = t + 1;
        self.out[c] = t + 2;
        t
    }

    /// Edge e (a to b, w opposite) and its twin (b to a, x opposite) become the edge from w to x.
    fn flip(&mut self, a0: usize) {
        let b0 = self.twin[a0];
        let (a1, a2, b1, b2) = (next(a0), prev(a0), next(b0), prev(b0));
        let (u, v, w, x) = (self.tris[a0], self.tris[a1], self.tris[a2], self.tris[b2]);
        let (ta2, ta1, tb1, tb2) = (self.twin[a2], self.twin[a1], self.twin[b1], self.twin[b2]);
        let (fa2, fa1, fb1, fb2) = (
            self.fixed[a2],
            self.fixed[a1],
            self.fixed[b1],
            self.fixed[b2],
        );
        self.tris[a0] = w;
        self.tris[a1] = u;
        self.tris[a2] = x;
        self.tris[b0] = x;
        self.tris[b1] = v;
        self.tris[b2] = w;
        self.link(a0, ta2);
        self.fixed[a0] = fa2;
        self.link(a1, tb1);
        self.fixed[a1] = fb1;
        self.link(b0, tb2);
        self.fixed[b0] = fb2;
        self.link(b1, ta1);
        self.fixed[b1] = fa1;
        self.link(a2, b2);
        self.fixed[a2] = false;
        self.fixed[b2] = false;
        self.out[w] = a0;
        self.out[u] = a1;
        self.out[x] = b0;
        self.out[v] = b1;
    }

    /// Lawson: flip edges whose opposite point lies in the circle, never a segment.
    fn legalize(&mut self, mut stack: Vec<usize>) {
        while let Some(e) = stack.pop() {
            let f = self.twin[e];
            if f == NONE || self.fixed[e] {
                continue;
            }
            let (u, v, w, x) = (
                self.tris[e],
                self.tris[next(e)],
                self.tris[prev(e)],
                self.tris[prev(f)],
            );
            if !self.in_circle(u, v, w, x) {
                continue;
            }
            self.flip(e);
            // After the flip the old outer edges sit at a1 and b0 (see flip).
            stack.push(next(e));
            stack.push(f);
        }
    }

    /// Point location by walking from the last triangle toward p (terminates on a Delaunay triangulation).
    fn locate(&self, p: usize) -> Option<(usize, bool)> {
        let mut t = self.last;
        for _ in 0..4 * self.tris.len() + 100 {
            let mut moved = false;
            let mut on = NONE;
            for k in 0..3 {
                let e = t + k;
                let o = self.orient(self.tris[e], self.tris[next(e)], p);
                if o < 0 && self.twin[e] != NONE {
                    t = self.twin[e] - self.twin[e] % 3;
                    moved = true;
                    break;
                }
                if o == 0 {
                    on = e;
                }
            }
            if !moved {
                return Some(if on != NONE { (on, true) } else { (t, false) });
            }
        }
        None
    }

    fn insert(&mut self, p: usize) -> Result<(), String> {
        let (e, on) = self.locate(p).ok_or("triangulate: point not found")?;
        if !on {
            // Split the triangle in three: (a, b, p) keeps its slot, (b, c, p) and (c, a, p) are new.
            let t = e;
            let (a, b, c) = (self.tris[t], self.tris[t + 1], self.tris[t + 2]);
            let (tb, tc) = (self.twin[t + 1], self.twin[t + 2]);
            let (fb, fc) = (self.fixed[t + 1], self.fixed[t + 2]);
            self.tris[t + 2] = p;
            let t1 = self.add_tri(b, c, p);
            let t2 = self.add_tri(c, a, p);
            self.link(t1, tb);
            self.fixed[t1] = fb;
            self.link(t2, tc);
            self.fixed[t2] = fc;
            self.link(t + 1, t1 + 2);
            self.link(t1 + 1, t2 + 2);
            self.link(t2 + 1, t + 2);
            self.fixed[t + 1] = false;
            self.fixed[t + 2] = false;
            self.out[a] = t;
            self.out[b] = t1;
            self.out[c] = t2;
            self.out[p] = t + 2;
            self.last = t;
            self.legalize(vec![t, t1, t2]);
            return Ok(());
        }
        // On edge e (a to b, c opposite), its twin (b to a, d opposite): four triangles round p.
        let f = self.twin[e];
        let was_fixed = self.fixed[e];
        let (a, b, c) = (self.tris[e], self.tris[next(e)], self.tris[prev(e)]);
        let (tbc, tca) = (self.twin[next(e)], self.twin[prev(e)]);
        let (fbc, fca) = (self.fixed[next(e)], self.fixed[prev(e)]);
        // Triangle of e becomes (a, p, c); new (p, b, c).
        self.tris[next(e)] = p;
        let t1 = self.add_tri(p, b, c);
        self.link(t1 + 1, tbc);
        self.fixed[t1 + 1] = fbc;
        self.link(next(e), t1 + 2);
        self.fixed[next(e)] = false;
        self.fixed[t1 + 2] = false;
        self.link(prev(e), tca);
        self.fixed[prev(e)] = fca;
        self.out[a] = e;
        self.out[c] = t1 + 2;
        self.out[b] = t1 + 1;
        self.out[p] = t1;
        let mut legal = vec![prev(e), t1 + 1];
        if f != NONE {
            let d = self.tris[prev(f)];
            let (tad, tdb) = (self.twin[next(f)], self.twin[prev(f)]);
            let (fad, fdb) = (self.fixed[next(f)], self.fixed[prev(f)]);
            // Twin (b, a, d) becomes (b, p, d); new (p, a, d).
            self.tris[next(f)] = p;
            let t2 = self.add_tri(p, a, d);
            self.link(t2 + 1, tad);
            self.fixed[t2 + 1] = fad;
            self.link(next(f), t2 + 2);
            self.fixed[next(f)] = false;
            self.fixed[t2 + 2] = false;
            self.link(prev(f), tdb);
            self.fixed[prev(f)] = fdb;
            // The two halves of the old edge: a to p (in e) with p to a (in t2), p to b (t1) with b to p (f).
            self.link(e, t2);
            self.link(t1, f);
            for h in [e, t2, t1, f] {
                self.fixed[h] = was_fixed;
            }
            self.out[d] = t2 + 2;
            legal.push(t2 + 1);
            legal.push(prev(f));
        } else {
            self.link(e, NONE);
            self.link(t1, NONE);
        }
        self.last = e - e % 3;
        self.legalize(legal);
        Ok(())
    }

    /// The half-edge from a to b, or NONE.
    fn edge_from(&self, a: usize, b: usize) -> usize {
        let start = self.out[a];
        let mut e = start;
        let mut done = false;
        for _ in 0..self.tris.len() {
            if self.tris[next(e)] == b {
                return e;
            }
            let t = self.twin[prev(e)];
            if t == NONE {
                break;
            }
            e = t;
            if e == start {
                done = true;
                break;
            }
        }
        if done {
            return NONE;
        }
        // At the hull: round the other way too.
        e = start;
        for _ in 0..self.tris.len() {
            let t = self.twin[e];
            if t == NONE {
                return NONE;
            }
            e = next(t);
            if self.tris[next(e)] == b {
                return e;
            }
            if e == start {
                return NONE;
            }
        }
        NONE
    }

    /// Whether a lies on the segment from s on (not behind s).
    fn dot_ahead(&self, s: usize, t: usize, a: usize) -> bool {
        let d = (self.x[a] - self.x[s]) * (self.x[t] - self.x[s])
            + (self.y[a] - self.y[s]) * (self.y[t] - self.y[s]);
        let l = (self.x[t] - self.x[s]).pow(2) + (self.y[t] - self.y[s]).pow(2);
        d > 0 && d < l
    }

    /// Forcing a segment in (Sloan): the edges crossing it flipped until none does.
    fn force(&mut self, s: usize, t: usize, depth: u32) {
        if s == t || depth > 50 {
            return;
        }
        let have = self.edge_from(s, t);
        if have != NONE {
            return self.set_fixed(have, true);
        }
        // The triangle at s that the segment leaves through, and the edges it crosses on to t.
        let mut crossing: VecDeque<(usize, usize)> = VecDeque::new();
        let mut e = self.out[s];
        let mut found = NONE;
        for _ in 0..self.tris.len() {
            let a = self.tris[next(e)];
            let b = self.tris[prev(e)];
            let oa = self.orient(s, t, a);
            let ob = self.orient(s, t, b);
            // A point on the way: the segment split there.
            if oa == 0 && self.dot_ahead(s, t, a) {
                self.force(s, a, depth + 1);
                self.force(a, t, depth + 1);
                return;
            }
            if oa < 0 && ob > 0 {
                found = next(e);
                break;
            }
            e = self.twin[prev(e)];
            if e == NONE || e == self.out[s] {
                break;
            }
        }
        if found == NONE {
            return;
        }
        let mut cur = found;
        for _ in 0..self.tris.len() {
            crossing.push_back((self.tris[cur], self.tris[next(cur)]));
            let f = self.twin[cur];
            if f == NONE {
                return;
            }
            let c = self.tris[prev(f)];
            if c == t {
                break;
            }
            let oc = self.orient(s, t, c);
            if oc == 0 {
                self.force(s, c, depth + 1);
                self.force(c, t, depth + 1);
                return;
            }
            cur = if oc < 0 { prev(f) } else { next(f) };
        }
        let mut queue = crossing;
        let mut made: Vec<(usize, usize)> = Vec::new();
        let mut guard = 0;
        while guard < 100000 {
            let Some((a, b)) = queue.pop_front() else {
                break;
            };
            guard += 1;
            let e = self.edge_from(a, b);
            if e == NONE {
                continue;
            }
            let w = self.tris[prev(e)];
            let x = self.tris[prev(self.twin[e])];
            // Only a convex quadrilateral can be flipped.
            if (self.orient(w, x, a).signum() * self.orient(w, x, b).signum()) >= 0 {
                queue.push_back((a, b));
                continue;
            }
            self.flip(e);
            let crosses = w != s
                && w != t
                && x != s
                && x != t
                && self.orient(s, t, w).signum() * self.orient(s, t, x).signum() < 0;
            if crosses {
                queue.push_back((w, x));
            } else {
                made.push((w, x));
            }
        }
        let se = self.edge_from(s, t);
        if se != NONE {
            self.set_fixed(se, true);
        }
        // Delaunay again round the new edges, the segment kept (Sloan: only new edges need checking).
        let mut changed = true;
        let mut guard = 0;
        while changed && guard < 100 {
            changed = false;
            guard += 1;
            for i in 0..made.len() {
                let e = self.edge_from(made[i].0, made[i].1);
                if e == NONE || self.fixed[e] || self.twin[e] == NONE {
                    continue;
                }
                if self.in_circle(
                    self.tris[e],
                    self.tris[next(e)],
                    self.tris[prev(e)],
                    self.tris[prev(self.twin[e])],
                ) {
                    self.flip(e);
                    // The new diagonal sits at prev(e), from x to w (see flip).
                    made[i] = (self.tris[prev(e)], self.tris[e]);
                    changed = true;
                }
            }
        }
    }
}

/// The triangles inside closed outlines `loops` (each a list of points, closing on itself). Nothing
/// for less than three points. Self-crossing outlines are triangulated as far as they go; a segment
/// through another point is split there.
pub fn triangulate(loops: &[Vec<Pt>]) -> Result<Triangulation, String> {
    // Snapped to integers on the grid, relative to the middle of the box: exact orientation.
    let (mut x0, mut y0, mut x1, mut y1) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for l in loops {
        for &[x, y] in l {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    let cx = round((x0 + x1) / 2.0 / SNAP);
    let cy = round((y0 + y1) / 2.0 / SNAP);
    let mut xs: Vec<i64> = Vec::new();
    let mut ys: Vec<i64> = Vec::new();
    let mut key: IdMap<(i64, i64), usize> = IdMap::default();
    let mut index = Vec::new();
    let mut segs: Vec<(usize, usize)> = Vec::new();
    for l in loops {
        let mut ids: Vec<usize> = Vec::new();
        for &[x, y] in l {
            let ix = (round(x / SNAP) - cx) as i64;
            let iy = (round(y / SNAP) - cy) as i64;
            let id = *key.entry((ix, iy)).or_insert_with(|| {
                xs.push(ix);
                ys.push(iy);
                xs.len() - 1
            });
            index.push(id);
            if ids.last() != Some(&id) {
                ids.push(id);
            }
        }
        while ids.len() > 1 && ids[0] == ids[ids.len() - 1] {
            ids.pop();
        }
        if ids.len() < 3 {
            continue;
        }
        for i in 0..ids.len() {
            segs.push((ids[i], ids[(i + 1) % ids.len()]));
        }
    }
    let n = xs.len();
    let points: Vec<Pt> = (0..n)
        .map(|i| [(xs[i] as f64 + cx) * SNAP, (ys[i] as f64 + cy) * SNAP])
        .collect();
    if n < 3 {
        return Ok(Triangulation {
            points,
            index,
            ..Default::default()
        });
    }

    // A triangle round everything, far enough to stay outside every circle that matters, near
    // enough that orientation stays exact.
    let span = (x1 - x0).max(y1 - y0) / SNAP + 10.0;
    let far = (span * 3.0).ceil() as i64;
    xs.extend([-far, far, 0]);
    ys.extend([-far, -far, far]);
    let mut out = vec![NONE; n + 3];
    out[n] = 0;
    out[n + 1] = 1;
    out[n + 2] = 2;
    let mut m = Mesh {
        x: xs,
        y: ys,
        tris: vec![n, n + 1, n + 2],
        twin: vec![NONE; 3],
        fixed: vec![false; 3],
        out,
        last: 0,
    };

    // Points in the order of a Hilbert curve, so each walk is short.
    let mut order: Vec<usize> = (0..n).collect();
    let h: Vec<u64> = (0..n)
        .map(|i| hilbert(m.x[i] as f64, m.y[i] as f64, span))
        .collect();
    order.sort_by_key(|&i| h[i]);
    for p in order {
        m.insert(p)?;
    }
    for (a, b) in segs {
        m.force(a, b, 0);
    }

    // Inside: reached from the far triangle across an odd number of segments (each triangle at its
    // least count: breadth first within a count, then across segments to the next).
    let tt = m.tris.len() / 3;
    let mut depth = vec![-1i64; tt];
    let mut level = vec![m.out[n] / 3];
    depth[level[0]] = 0;
    let mut d = 0;
    while !level.is_empty() {
        let mut across = Vec::new();
        let mut head = 0;
        while head < level.len() {
            let t = level[head];
            head += 1;
            for k in 0..3 {
                let f = m.twin[3 * t + k];
                if f == NONE {
                    continue;
                }
                let u = f / 3;
                if depth[u] >= 0 {
                    continue;
                }
                if m.fixed[3 * t + k] {
                    across.push(u);
                    continue;
                }
                depth[u] = d;
                level.push(u);
            }
        }
        level = Vec::new();
        for u in across {
            if depth[u] >= 0 {
                continue;
            }
            depth[u] = d + 1;
            level.push(u);
        }
        d += 1;
    }
    let keep: Vec<usize> = (0..tt)
        .filter(|&t| depth[t] % 2 == 1 && (0..3).all(|k| m.tris[3 * t + k] < n))
        .collect();
    let mut new_of = vec![NONE; tt];
    for (i, &t) in keep.iter().enumerate() {
        new_of[t] = i;
    }
    let mut kt = Vec::with_capacity(keep.len() * 3);
    let mut kw = Vec::with_capacity(keep.len() * 3);
    let mut kf = Vec::with_capacity(keep.len() * 3);
    for &t in &keep {
        for k in 0..3 {
            let e = 3 * t + k;
            kt.push(m.tris[e]);
            let f = m.twin[e];
            let u = if f != NONE { new_of[f / 3] } else { NONE };
            kw.push(if u != NONE {
                (3 * u + f % 3) as i64
            } else {
                -1
            });
            kf.push(m.fixed[e]);
        }
    }
    Ok(Triangulation {
        points,
        index,
        tris: kt,
        twin: kw,
        fixed: kf,
    })
}

/// Position of (x, y) on a Hilbert curve over the square of side 2·span round the middle.
fn hilbert(x: f64, y: f64, span: f64) -> u64 {
    const N: i64 = 1 << 16;
    let mut ix = ((((x + span) / (2.0 * span)) * N as f64).floor() as i64).clamp(0, N - 1);
    let mut iy = ((((y + span) / (2.0 * span)) * N as f64).floor() as i64).clamp(0, N - 1);
    let mut d: u64 = 0;
    let mut s = N >> 1;
    while s > 0 {
        let rx = i64::from((ix & s) > 0);
        let ry = i64::from((iy & s) > 0);
        d += (s * s * ((3 * rx) ^ ry)) as u64;
        if ry == 0 {
            if rx == 1 {
                ix = s - 1 - ix;
                iy = s - 1 - iy;
            }
            std::mem::swap(&mut ix, &mut iy);
        }
        s >>= 1;
    }
    d
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn area(t: &Triangulation) -> f64 {
        let mut a = 0.0;
        for c in t.tris.chunks_exact(3) {
            let [p, q, r] = [t.points[c[0]], t.points[c[1]], t.points[c[2]]];
            a += ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2.0;
        }
        a
    }

    pub fn ring(cx: f64, cy: f64, r: f64, n: usize, turn: f64) -> Vec<Pt> {
        (0..n)
            .map(|i| {
                let a = turn * std::f64::consts::TAU * i as f64 / n as f64;
                [cx + r * a.cos(), cy + r * a.sin()]
            })
            .collect()
    }

    /// Points along a polygon's edges every `step`.
    pub fn sampled(poly: &[Pt], step: f64) -> Vec<Pt> {
        let mut out = vec![];
        for i in 0..poly.len() {
            let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
            let k = ((b[0] - a[0]).hypot(b[1] - a[1]) / step).round().max(1.0) as usize;
            for j in 0..k {
                out.push([
                    a[0] + (b[0] - a[0]) * j as f64 / k as f64,
                    a[1] + (b[1] - a[1]) * j as f64 / k as f64,
                ]);
            }
        }
        out
    }

    /// Whether no point lies inside the circle of a triangle it can see across an unfixed edge.
    pub fn locally_delaunay(t: &Triangulation) -> bool {
        let p = &t.points;
        for e in 0..t.tris.len() {
            let f = t.twin[e];
            if f < 0 || t.fixed[e] {
                continue;
            }
            let f = f as usize;
            let base = e - e % 3;
            let [a, b, c] = [p[t.tris[base]], p[t.tris[base + 1]], p[t.tris[base + 2]]];
            let d = p[t.tris[f - f % 3 + (f % 3 + 2) % 3]];
            let m: Vec<[f64; 3]> = [a, b, c]
                .iter()
                .map(|q| {
                    [
                        q[0] - d[0],
                        q[1] - d[1],
                        (q[0] - d[0]).powi(2) + (q[1] - d[1]).powi(2),
                    ]
                })
                .collect();
            let det = m[0][2] * (m[1][0] * m[2][1] - m[2][0] * m[1][1])
                + m[1][2] * (m[2][0] * m[0][1] - m[0][0] * m[2][1])
                + m[2][2] * (m[0][0] * m[1][1] - m[1][0] * m[0][1]);
            if det > 1e-9 {
                return false;
            }
        }
        true
    }

    #[test]
    fn fills_a_square_with_a_hole_and_nothing_else() {
        let t = triangulate(&[
            sampled(&[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]], 0.5),
            ring(5.0, 5.0, 2.0, 40, 1.0),
        ])
        .unwrap();
        let hole = 20.0 * 2.0 * 2.0 * (std::f64::consts::TAU / 40.0).sin();
        assert!((area(&t).abs() - (100.0 - hole)).abs() < 0.005);
        assert!(locally_delaunay(&t));
    }

    #[test]
    fn keeps_every_segment_of_a_thin_sharp_star() {
        let star: Vec<Pt> = (0..10)
            .map(|i| {
                let a = -std::f64::consts::FRAC_PI_2 + i as f64 * std::f64::consts::PI / 5.0;
                let r = if i % 2 == 1 { 2.0 } else { 19.0 };
                [r * a.cos(), r * a.sin()]
            })
            .collect();
        let pts = sampled(&star, 0.2);
        let t = triangulate(std::slice::from_ref(&pts)).unwrap();
        assert_eq!(t.fixed.iter().filter(|f| **f).count(), pts.len());
        assert!(locally_delaunay(&t));
    }

    #[test]
    fn points_on_a_circle_collinear_points_and_nesting() {
        let t = triangulate(&[ring(0.0, 0.0, 5.0, 200, 1.0)]).unwrap();
        assert_eq!(t.tris.len() / 3, 198);
        let bx = triangulate(&[sampled(
            &[[0.0, 0.0], [30.0, 0.0], [30.0, 1.0], [0.0, 1.0]],
            0.1,
        )])
        .unwrap();
        assert!((area(&bx).abs() - 30.0).abs() < 0.005);
        let t = triangulate(&[
            ring(0.0, 0.0, 10.0, 60, 1.0),
            ring(0.0, 0.0, 6.0, 60, -1.0),
            ring(0.0, 0.0, 3.0, 60, 1.0),
        ])
        .unwrap();
        let ra = |r: f64| 30.0 * r * r * (std::f64::consts::TAU / 60.0).sin();
        assert!((area(&t).abs() - (ra(10.0) - ra(6.0) + ra(3.0))).abs() < 0.005);
    }

    #[test]
    fn duplicates_and_too_few_points() {
        let t = triangulate(&[vec![[0.0, 0.0], [1.0, 0.0]]]).unwrap();
        assert!(t.tris.is_empty());
        let t = triangulate(&[vec![
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
            [0.0, 0.0],
        ]])
        .unwrap();
        assert_eq!(t.points.len(), 4);
        assert_eq!(t.index, vec![0, 1, 1, 2, 3, 0]);
        assert!((area(&t).abs() - 1.0).abs() < 1e-9);
    }
}
