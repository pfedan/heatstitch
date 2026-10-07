import { buildRegion, pixelMm, type Region } from './region';
import { insideOf } from './rungs';
import type { Branch, Graph, Pt } from './skeleton';

/**
 * Compact shapes for "Vorschlagen" (see satinSuggest): areas that are no line but are sewn as satin
 * the way a digitizer would, each by its own planner. They are found on their own (a fill that is
 * a dot or a triangle) and inside a drawing of lines (the nose on the mouth, the pupil on the ring
 * of the eye: a thick place the lines run into). There they are cut off where the line starts and
 * planned apart from the lines.
 *
 * - `dot`: a round area. Up to the satin limit one column across; wider (up to DOT_MAX) cut in two
 *   halves along its long axis (through a hole in it, as the highlight in a pupil), each sewn
 *   square to the cut, so no stitch is longer than the half.
 * - `pointed`: an area with corners (a triangle, a nose). The lines across fan out from the corner
 *   that keeps the stitches shortest to the edge opposite it.
 * - `leaf` and `drop`: a long round area pointed at both ends or at one. Sewn as a dot is (one
 *   column, or halves cut along its middle as the vein of a leaf); the halves of a leaf slant
 *   toward its tip, as the veins do.
 */

export type BlobKind = 'dot' | 'pointed' | 'leaf' | 'drop';

export interface ShapePlan {
  kind: BlobKind;
  cuts: [Pt, Pt][];
  lines: [Pt, Pt][];
}

/** Widest round area cut into two halves (mm). */
export const DOT_MAX = 12;
/** A place this many times the half width of the lines (and 0.6 mm more) is a thick place. */
const THICK = 1.8;
/** A bend sharper than this (degrees, over CORNER_ARM either side) is a corner of the outline. */
const CORNER_DEG = 55;
const CORNER_ARM = 0.7;
/** Grid the shape of a thick place is sampled on (mm). */
const STEP = 0.15;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const norm = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const perp = (v: Pt): Pt => [-v[1], v[0]];
const median = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};
const lengthOf = (pts: Pt[]) => pts.reduce((a, p, i) => (i ? a + dist(p, pts[i - 1]) : a), 0);

/** Whether a point lies on the area: inside one of its outsides and in none of its holes. */
export function materialOf(outsides: Pt[][], holes: Pt[][]): (q: Pt) => boolean {
  const outs = outsides.map(insideOf);
  const ins = holes.map(insideOf);
  return (q) => outs.some((f) => f(q)) && !ins.some((f) => f(q));
}

/**
 * The holes that lie in a thick place rather than between lines (the highlight in a pupil): round,
 * and the area around them at least as thick as they are wide. Thick places are found with these
 * filled, so a highlight does not turn the pupil around it into lines.
 */
export function smallHoles(g: Graph, holes: Pt[][]): Pt[][] {
  const pts = g.branches.flatMap((b) => b.pts.map((p, i) => ({ p, r: b.r[i] })));
  return holes.filter((hole) => {
    const c = centroid(hole);
    const area = Math.abs(hole.reduce((a, p, i) => a + p[0] * hole[(i + 1) % hole.length][1] - hole[(i + 1) % hole.length][0] * p[1], 0)) / 2;
    const far = Math.max(...hole.map((q) => dist(q, c)));
    if (area < 0.5 * Math.PI * far * far) return false;
    const R = Math.sqrt(area / Math.PI);
    return pts.some((d) => d.r >= R && dist(d.p, c) < R + 1.5 * d.r);
  });
}

/** The area with these holes filled. */
export function filled(area: Region, holes: Pt[][]): Region {
  const { w, h } = area;
  const tests = holes.map(insideOf);
  const comp = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (area.mask[i] || tests.some((f) => f(pixelMm(area, x, y)))) comp[i] = 1;
    }
  }
  const r = buildRegion(comp, new Uint8Array(w * h), w, 1, 1, { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 }, h, area.pxMm, 0, () => false);
  return { ...r, x0: r.x0 + area.x0, y0: r.y0 + area.y0 };
}

/** A thick place inside a drawing of lines: the disks of its centerline and where lines leave it. */
export interface Blob {
  disks: { p: Pt; r: number }[];
  /** Where a line leaves it: the point on the line's centerline, its direction there and half width. */
  attach: { p: Pt; t: Pt; r: number }[];
}

/**
 * The thick places of a drawing of lines, the cut lines that part them from the lines, and what is
 * left of the lines (a graph for planStrokes). Null when there is none.
 */
export function splitBlobs(g: Graph): { blobs: Blob[]; cuts: [Pt, Pt][]; strokes: Graph } | null {
  const all = g.branches.flatMap((b) => b.r);
  if (!all.length) return null;
  const h = median(all);
  const tau = Math.max(THICK * h, h + 0.6);
  // The thick points, grouped where their disks overlap.
  const thick: { p: Pt; r: number }[] = [];
  for (const b of g.branches) b.pts.forEach((p, i) => b.r[i] >= tau && thick.push({ p, r: b.r[i] }));
  if (!thick.length) return null;
  const root = thick.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < thick.length; i++) {
    for (let j = i + 1; j < thick.length; j++) {
      if (dist(thick[i].p, thick[j].p) < thick[i].r + thick[j].r) root[find(i)] = find(j);
    }
  }
  const groups = new Map<number, { p: Pt; r: number }[]>();
  thick.forEach((d, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), d]));
  const clusters = [...groups.values()];
  const maxR = clusters.map((c) => Math.max(...c.map((d) => d.r)));
  // The circle each thick place fills about (its disks reach its edge all round).
  const circle = clusters.map((c) => {
    let [x, y, w] = [0, 0, 0];
    for (const d of c) [x, y, w] = [x + d.p[0] * d.r, y + d.p[1] * d.r, w + d.r];
    const o: Pt = [x / w, y / w];
    return { o, R: Math.max(...c.map((d) => dist(o, d.p) + d.r)) };
  });
  /** The thick place a centerline point belongs to (-1: none). */
  const near = (q: Pt, r: number) => clusters.findIndex((c) => c.some((d) => dist(q, d.p) < d.r + 0.25 * r));

  const degree = new Map<number, number>();
  for (const b of g.branches) {
    degree.set(b.a, (degree.get(b.a) ?? 0) + 1);
    degree.set(b.b, (degree.get(b.b) ?? 0) + 1);
  }
  const blobs: Blob[] = clusters.map((c) => ({ disks: c.slice(), attach: [] }));
  const nodes = g.nodes.slice();
  const branches: Branch[] = [];
  const cuts: [Pt, Pt][] = [];
  for (const b0 of g.branches) {
    let b = b0;
    let at = b.pts.map((p, i) => near(p, b.r[i]));
    if (at.every((x) => x < 0)) {
      branches.push(b);
      continue;
    }
    // A ring through a thick place: walked from a point in it, so the rest is one piece.
    if (b.a === b.b) {
      const k = at.findIndex((x) => x >= 0);
      b = { ...b, pts: [...b.pts.slice(k), ...b.pts.slice(1, k + 1)], r: [...b.r.slice(k), ...b.r.slice(1, k + 1)] };
      at = [...at.slice(k), ...at.slice(1, k + 1)];
    }
    // The pieces outside the thick places.
    let i = 0;
    while (i < b.pts.length) {
      if (at[i] >= 0) {
        blobs[at[i]].disks.push({ p: b.pts[i], r: b.r[i] });
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < b.pts.length && at[j + 1] < 0) j++;
      const from = i > 0 ? at[i - 1] : -1;
      const to = j + 1 < b.pts.length ? at[j + 1] : -1;
      const pts = b.pts.slice(i, j + 1);
      const r = b.r.slice(i, j + 1);
      const len = lengthOf(pts);
      const free = (i === 0 && degree.get(b.a) === 1) || (j === b.pts.length - 1 && degree.get(b.b) === 1);
      const owner = from >= 0 ? from : to;
      // A short piece into a corner, a short neck between two sides of the same thick place, or a
      // piece within its round (beside a hole in it): part of the thick place.
      const within = owner >= 0 && pts.every((p, k) => dist(p, circle[owner].o) + 0.5 * r[k] <= circle[owner].R + 0.2);
      if (owner >= 0 && (within || (((free && (from < 0 || to < 0)) || from === to) && len < 1.5 * maxR[owner]))) {
        pts.forEach((p, k) => blobs[owner].disks.push({ p, r: r[k] }));
        i = j + 1;
        continue;
      }
      // A line leaving a thick place starts where it stops getting thinner.
      const half = median(r);
      let s = 0;
      let e = pts.length - 1;
      if (from >= 0) while (s < e / 2 && r[s] > 1.2 * half) s++;
      if (to >= 0) while (e > Math.max(s, (pts.length - 1) / 2) && r[e] > 1.2 * half) e--;
      for (let k = 0; k < s; k++) blobs[from].disks.push({ p: pts[k], r: r[k] });
      for (let k = e + 1; k < pts.length; k++) blobs[to].disks.push({ p: pts[k], r: r[k] });
      const piece = { pts: pts.slice(s, e + 1), r: r.slice(s, e + 1) };
      if (piece.pts.length < 2) {
        i = j + 1;
        continue;
      }
      const end = (k: number, inward: number, blob: number) => {
        const p = piece.pts[k];
        const t = norm(sub(piece.pts[Math.max(0, Math.min(piece.pts.length - 1, k + inward * 3))], p));
        blobs[blob].attach.push({ p, t, r: piece.r[k] });
        const w = piece.r[k] * 1.25 + 0.3;
        cuts.push([add(p, perp(t), -w), add(p, perp(t), w)]);
        nodes.push({ p, r: piece.r[k] });
        return nodes.length - 1;
      };
      const a = from >= 0 ? end(0, 1, from) : i === 0 ? b.a : b.b;
      const z = to >= 0 ? end(piece.pts.length - 1, -1, to) : j === b.pts.length - 1 ? b.b : b.a;
      branches.push({ a, b: z, pts: piece.pts, r: piece.r });
      i = j + 1;
    }
  }
  return { blobs, cuts, strokes: { nodes, branches } };
}

/** The shape to plan: points of it on a grid, and the stretches of the outline around it. */
export interface Shape {
  samples: Pt[];
  /** Outline points of the shape, as stretches in order (for its corners). */
  outline: Pt[][];
  /** Holes lying inside the shape. */
  holes: Pt[][];
  /** Where lines leave it (see Blob). */
  attach: { p: Pt; t: Pt; r: number }[];
}

/** A whole area as a shape. */
export function wholeShape(outsides: Pt[][], holes: Pt[][], material: (q: Pt) => boolean): Shape {
  // Each ring walked on a little past its start, so a corner at the start has arms both sides.
  const wrap = (r: Pt[]) => {
    const out = r.slice();
    for (let i = 1, l = 0; i < r.length && l < 2; i++) {
      l += dist(r[i - 1], r[i]);
      out.push(r[i]);
    }
    return out;
  };
  return { samples: grid(outsides.flat(), material), outline: [...outsides, ...holes].map(wrap), holes, attach: [] };
}

/**
 * A thick place as a shape: the part of the area nearer to its disks than to the lines left
 * (`lines`: the centerlines of what is left, see splitBlobs), so its corners count too.
 */
export function blobShape(blob: Blob, lines: Graph, outsides: Pt[][], holes: Pt[][], material: (q: Pt) => boolean): Shape {
  const disks = blob.disks.filter((_, k) => k % 2 === 0);
  const reach = Math.max(...disks.map((d) => d.r));
  // Corners reach out up to about twice the widest disk beyond it (a narrow triangle further).
  const m = 3 * reach;
  const box = disks.flatMap((d) => [add(d.p, [m, m]), add(d.p, [-m, -m])]);
  const [x0, x1, y0, y1] = [Math.min(...box.map((p) => p[0])), Math.max(...box.map((p) => p[0])), Math.min(...box.map((p) => p[1])), Math.max(...box.map((p) => p[1]))];
  const within = (q: Pt) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
  const others = lines.branches.flatMap((b) => b.pts.map((p, i) => ({ p, r: b.r[i] }))).filter((d, k) => k % 2 === 0 && d.p[0] > x0 - m && d.p[0] < x1 + m && d.p[1] > y0 - m && d.p[1] < y1 + m);
  // Nearest by how far outside a disk it lies (the medial disks cover the area).
  const gap = (q: Pt, ds: { p: Pt; r: number }[]) => ds.reduce((m, d) => Math.min(m, dist(q, d.p) - d.r), Infinity);
  const mine = (q: Pt) => within(q) && gap(q, disks) <= gap(q, others);
  const samples = grid(box, (q) => material(q) && mine(q));
  const outline: Pt[][] = [];
  for (const ring of [...outsides, ...holes]) {
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    for (const q of ring) {
      if (mine(q)) run.push(q);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    // A stretch running over the start of the outline is one.
    if (run.length && runs.length && runs[0][0] === ring[0]) runs[0] = [...run, ...runs[0]];
    else if (run.length) runs.push(run);
    outline.push(...runs);
  }
  // Holes it surrounds (most of their outline nearer to it than to the lines).
  return { samples, outline, holes: holes.filter((hole) => hole.filter(mine).length > 0.7 * hole.length), attach: blob.attach };
}

/** Points on a grid over the box of `box` that `keep` keeps. */
export function grid(box: Pt[], keep: (q: Pt) => boolean): Pt[] {
  const xs = box.map((p) => p[0]);
  const ys = box.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out: Pt[] = [];
  for (let y = y0 + STEP / 2; y < y1; y += STEP) for (let x = x0 + STEP / 2; x < x1; x += STEP) if (keep([x, y])) out.push([x, y]);
  return out;
}

/**
 * The sharp bends of the shape's outline: corners sticking out (the area lies inside the bend) and
 * notches (cutting in, as at the top of a heart).
 */
export function corners(s: Shape, material: (q: Pt) => boolean): { out: Pt[]; notches: Pt[] } {
  const found: { p: Pt; deg: number; convex: boolean }[] = [];
  for (const run of s.outline) {
    const cum = [0];
    for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + dist(run[i - 1], run[i]));
    const turn = (i: number) => {
      let a = i;
      let b = i;
      while (a > 0 && cum[i] - cum[a] < CORNER_ARM) a--;
      while (b < run.length - 1 && cum[b] - cum[i] < CORNER_ARM) b++;
      if (cum[i] - cum[a] < CORNER_ARM * 0.7 || cum[b] - cum[i] < CORNER_ARM * 0.7) return null;
      const din = norm(sub(run[i], run[a]));
      const dout = norm(sub(run[b], run[i]));
      const deg = (Math.acos(Math.max(-1, Math.min(1, dot(din, dout)))) * 180) / Math.PI;
      // Sticking out where the area lies between the arms: the middle of the two arm ends is on it.
      const m: Pt = [(run[a][0] + run[b][0]) / 2, (run[a][1] + run[b][1]) / 2];
      return { deg, convex: material(add(run[i], norm(sub(m, run[i])), 0.15)) };
    };
    const ts = run.map((_, i) => turn(i));
    for (let i = 0; i < run.length; i++) {
      const t = ts[i];
      if (!t || t.deg < CORNER_DEG) continue;
      if ((ts[i - 1]?.deg ?? 0) > t.deg || (ts[i + 1]?.deg ?? 0) > t.deg) continue;
      const close = found.find((f) => f.convex === t.convex && dist(f.p, run[i]) < 1.2);
      if (close) {
        if (t.deg > close.deg) [close.p, close.deg] = [run[i], t.deg];
      } else found.push({ p: run[i], deg: t.deg, convex: t.convex });
    }
  }
  return { out: found.filter((f) => f.convex).map((f) => f.p), notches: found.filter((f) => !f.convex).map((f) => f.p) };
}

/** A plan and its longest stitch (mm). */
type Option = { plan: ShapePlan; longest: number };

/** Where a fan can start: a corner, or the end of a line leaving the shape (spread along it). */
interface Tip {
  p: Pt;
  along?: Pt;
  w?: number;
}

/**
 * Cut lines and lines across for a compact shape: a dot or a pointed area (see the top), or null
 * when it fits neither within the satin limit `max` (mm). A fan is preferred unless a column
 * across keeps the stitches clearly shorter.
 */
export function planShape(s: Shape, material: (q: Pt) => boolean, max: number, split = true, column = false): ShapePlan | null {
  if (s.samples.length < 8) return null;
  const { out, notches } = corners(s, material);
  // A heart: cut from its notch to the corner opposite, each half planned on its own.
  if (split && notches.length === 1 && out.length && !s.holes.length && !s.attach.length) {
    const halves = planHalves(s, notches[0], out, material, max);
    if (halves) return halves;
  }
  const tips: Tip[] = [...out.map((p) => ({ p })), ...s.attach.map((a) => ({ p: a.p, along: perp(a.t), w: a.r * 0.7 }))];
  const fan = tips.length && !s.holes.length ? planFan(s, tips, material, max) : null;
  const col = planDot(s, material, max, out);
  // A column where it fits, unless asked for, or three corners at most (a fan suits a triangle, not a square).
  if (col && (column || out.length > 3)) return col.plan;
  if (col && col.plan.kind !== 'dot') return col.plan;
  if (fan && (!col || col.longest >= 0.6 * fan.longest)) return fan.plan;
  return col?.plan ?? null;
}

function planHalves(s: Shape, notch: Pt, out: Pt[], material: (q: Pt) => boolean, max: number): ShapePlan | null {
  const tip = out.reduce((a, b) => (dist(b, notch) > dist(a, notch) ? b : a));
  const d = norm(sub(tip, notch));
  const n = perp(d);
  const plans: ShapePlan[] = [];
  for (const sgn of [-1, 1]) {
    const on = (q: Pt) => sgn * dot(sub(q, notch), n) > 0;
    const half: Shape = { samples: s.samples.filter(on), outline: s.outline.map((r) => r.filter(on)).filter((r) => r.length > 2), holes: [], attach: [] };
    const p = planShape(half, (q) => material(q) && on(q), max, false);
    if (!p) return null;
    plans.push(p);
  }
  return { kind: 'pointed', cuts: [[add(notch, d, -0.3), add(tip, d, 0.3)], ...plans.flatMap((p) => p.cuts)], lines: plans.flatMap((p) => p.lines) };
}

/** Lines across fanning out from the corner that keeps the stitches shortest. */
function planFan(s: Shape, tips: Tip[], material: (q: Pt) => boolean, max: number): Option | null {
  const far = (a: Pt) => s.samples.reduce((m, q) => Math.max(m, dist(a, q)), 0);
  let tip = tips[0];
  let reach = far(tip.p);
  for (const t of tips.slice(1)) {
    const f = far(t.p);
    if (f < reach) [tip, reach] = [t, f];
  }
  if (reach > max) return null;
  const apex = tip.p;
  // The directions the shape lies in, seen from the corner.
  const c = centroid(s.samples);
  const toward = norm(sub(c, apex));
  const side = perp(toward);
  const angles = s.samples.filter((q) => dist(q, apex) > 0.3).map((q) => Math.atan2(dot(sub(q, apex), side), dot(sub(q, apex), toward))).sort((a, b) => a - b);
  if (angles.length < 8) return null;
  const lo = angles[Math.floor(angles.length * 0.02)];
  const hi = angles[Math.ceil(angles.length * 0.98) - 1];
  const span = hi - lo;
  // A shape seen within a narrow angle is a line; seen from a point on a round edge (nearly half
  // round), it has no corner there to fan from.
  if (span < (25 * Math.PI) / 180 || span > (140 * Math.PI) / 180) return null;
  const n = Math.max(3, Math.min(7, Math.round(span / ((25 * Math.PI) / 180)) + 1));
  // The lines start a little apart, in the order they fan out, so they meet the outline one after
  // another (at one point the satin tool could not tell their order).
  const along = tip.along && dot(tip.along, side) < 0 ? ([-tip.along[0], -tip.along[1]] as Pt) : (tip.along ?? side);
  const w = tip.w ?? 0.25;
  const lines: [Pt, Pt][] = [];
  for (let k = 0; k < n; k++) {
    const f = 0.12 + (0.76 * k) / (n - 1);
    const a = lo + span * f;
    const d = norm(add([toward[0] * Math.cos(a), toward[1] * Math.cos(a)], side, Math.sin(a)));
    const from = add(apex, along, w * (2 * f - 1));
    // From just outside the corner to beyond the edge opposite it, along the shape.
    let end = 0;
    for (let t = 0.1; t <= reach + 0.2; t += 0.05) if (material(add(from, d, t))) end = t;
    if (end < 0.4) continue;
    lines.push([add(from, d, -0.4), add(from, d, end + 0.4)]);
  }
  return lines.length >= 3 ? { plan: { kind: 'pointed', cuts: [], lines }, longest: reach } : null;
}

/** A round area: one column across, or two halves cut along it (through a hole in it). */
function planDot(s: Shape, material: (q: Pt) => boolean, max: number, tips: Pt[] = []): Option | null {
  if (s.holes.length > 1) return null;
  const c = centroid(s.samples);
  // The long axis (of the second moments).
  let [sxx, syy, sxy] = [0, 0, 0];
  for (const q of s.samples) {
    const [x, y] = sub(q, c);
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const axis: Pt = [Math.cos(ang), Math.sin(ang)];
  const extent = (o: Pt, v: Pt) => {
    let [lo, hi] = [Infinity, -Infinity];
    for (const q of s.samples) {
      const x = dot(sub(q, o), v);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    return [lo - STEP / 2, hi + STEP / 2];
  };
  const [ulo, uhi] = extent(c, axis);
  const [nlo, nhi] = extent(c, perp(axis));
  // Round enough: covers about half its box or more (a triangle just so).
  if (s.samples.length * STEP * STEP < 0.45 * (uhi - ulo) * (nhi - nlo)) return null;
  // Long, with a corner at an end of its long way or at both: a drop or a leaf.
  const ends = [ulo, uhi].map((e) => tips.some((t) => Math.abs(dot(sub(t, c), axis) - e) < 0.6 && Math.abs(dot(sub(t, c), perp(axis))) < 0.25 * (nhi - nlo)));
  const kind: BlobKind = s.holes.length || uhi - ulo < 1.4 * (nhi - nlo) ? 'dot' : ends[0] && ends[1] ? 'leaf' : ends[0] || ends[1] ? 'drop' : 'dot';
  const hole = s.holes[0];
  if (!hole && nhi - nlo <= max) {
    // One column across, along the long axis.
    const n = perp(axis);
    const lines: [Pt, Pt][] = [];
    const m = uhi - ulo > 1.3 * (nhi - nlo) ? 3 : 1;
    for (let k = 1; k <= m; k++) {
      const p = add(c, axis, ulo + ((uhi - ulo) * k) / (m + 1));
      lines.push([add(p, n, nlo - 0.4), add(p, n, nhi + 0.4)]);
    }
    return { plan: { kind, cuts: [], lines }, longest: nhi - nlo };
  }
  // Two halves, cut along a line through the middle (through the hole): the long axis, else the
  // way that keeps the halves narrowest with the cut clear of the lines leaving the shape.
  const base = hole ? centroid(hole) : c;
  // A leaf: cut along its vein, the halves slanting toward the tip at the far end of its axis.
  if (kind === 'leaf') {
    const h = halves(s, material, base, axis, false, extent, Math.PI / 3, max);
    if (h && h.longest <= max) return { ...h, plan: { ...h.plan, kind } };
  }
  const ways: Pt[] = [axis];
  for (let k = 1; k < 12; k++) ways.push([Math.cos(ang + (k * Math.PI) / 12), Math.sin(ang + (k * Math.PI) / 12)]);
  let best: Option | null = null;
  for (const u of ways) {
    const h = halves(s, material, base, u, !!hole, extent);
    if (h && (!best || h.longest < best.longest - 0.05)) best = h;
  }
  return best && best.longest <= max ? { ...best, plan: { ...best.plan, kind: kind === 'leaf' ? 'dot' : kind } } : null;
}

/** A material stretch along a ray: where it starts and ends (mm from o), or null. */
function run(material: (q: Pt) => boolean, o: Pt, d: Pt, to: number): [number, number] | null {
  let a: number | null = null;
  let b = 0;
  for (let t = 0; t <= to; t += 0.05) {
    const on = material(add(o, d, t));
    if (on && a === null) a = t;
    if (on) b = t;
    if (!on && a !== null) break;
  }
  return a === null ? null : [a, b];
}

/** Two halves cut along the line through `base` in direction u, lines square to the cut. */
function halves(s: Shape, material: (q: Pt) => boolean, base: Pt, u: Pt, hole: boolean, extent: (o: Pt, v: Pt) => number[], slant = Math.PI / 2, max = Infinity): Option | null {
  const n = perp(u);
  const [ulo, uhi] = extent(base, u);
  const [nlo, nhi] = extent(base, n);
  if (nhi - nlo > DOT_MAX) return null;
  const cuts: [Pt, Pt][] = [];
  const ends: Pt[] = [];
  for (const sgn of [-1, 1]) {
    const d: Pt = [u[0] * sgn, u[1] * sgn];
    const r = run(material, base, d, (sgn < 0 ? -ulo : uhi) + 1);
    if (!r) return null;
    ends.push(add(base, d, r[1]));
    if (hole) cuts.push([add(base, d, r[0] - 0.3), add(base, d, r[1] + 0.3)]);
  }
  if (!hole) cuts.push([add(ends[0], u, -0.4), add(ends[1], u, 0.4)]);
  // Clear of where lines leave the shape (their cut lines lie there).
  const clear = (p: Pt) => s.attach.every((a) => dist(a.p, p) > a.r * 1.25 + 0.8);
  if (!ends.every(clear)) return null;
  // Slanting (a leaf's veins) where the stitches stay within max so, else square to the cut.
  const half = Math.max(-nlo, nhi);
  const a = half / Math.sin(slant) <= max ? slant : Math.PI / 2;
  const lines: [Pt, Pt][] = [];
  for (const f of [0.15, 0.32, 0.5, 0.68, 0.85]) {
    const p = add(base, u, ulo + (uhi - ulo) * f);
    for (const sgn of [-1, 1]) {
      const d = norm(add([n[0] * sgn * Math.sin(a), n[1] * sgn * Math.sin(a)], u, Math.cos(a)));
      const r = run(material, p, d, (sgn < 0 ? -nlo : nhi) / Math.sin(a) + 1);
      if (!r || r[1] - r[0] < 0.4) continue;
      lines.push([add(p, d, r[0] > 0.1 ? r[0] - 0.3 : -0.3), add(p, d, r[1] + 0.3)]);
    }
  }
  return { plan: { kind: 'dot', cuts, lines }, longest: half / Math.sin(a) };
}

const centroid = (pts: Pt[]): Pt => {
  let [x, y] = [0, 0];
  for (const p of pts) [x, y] = [x + p[0], y + p[1]];
  return [x / pts.length, y / pts.length];
};
