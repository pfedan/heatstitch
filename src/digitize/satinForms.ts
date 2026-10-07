import { inside, insideOf, stripsOfOutline } from './rungs';
import { grid, planShape, type Shape } from './satinShapes';
import type { Graph, Pt } from './skeleton';

/**
 * Areas cut at their corners for "Vorschlagen" (see satinSuggest), as a digitizer cuts them by hand:
 *
 * - `spikes`: points standing off a body (a star, a grass tuft, the bars of an E standing off its
 *   stem). Each is cut off at its base, from the notch on one side to the notch on the other, and
 *   sewn as a column from the base to its tip; the body is planned on its own.
 * - `frame`: a band turning a corner with a corner outside and one inside (a frame, an L, the
 *   corners of a block letter). It is cut on the miter, from the outer corner to the inner one, so
 *   each side is a column of its own ending on the slant.
 *
 * Each part left is then planned as a column along it (a stroke, a bar, a spike) or as a compact
 * shape (a dot, a pointed area: see satinShapes).
 */

export type FormKind = 'spikes' | 'frame';

/** A sharp bend of an outline: where, how sharp, sticking out or cutting in, and the way into the area. */
interface Bend {
  p: Pt;
  /** Index on its ring. */
  i: number;
  /** Distance along its ring. */
  s: number;
  deg: number;
  convex: boolean;
  into: Pt;
  /** Turn over a short arm (degrees): a corner, not the round end of a line. */
  sharp: number;
}

/** A bend sharper than this (degrees, over BEND_ARM either side) is a corner. */
const BEND_DEG = 45;
const BEND_ARM = 1;
/** A spike's tip turns at least SHARP_DEG within SHARP_ARM either side (a round line end turns less). */
const SHARP_ARM = 0.4;
const SHARP_DEG = 70;
/** A miter runs within this angle of the bisectors of both its corners (degrees). */
const MITER_DEG = 25;
/** A spike sticks out at least this share of its base from it. */
const SPIKE_DEPTH = 0.8;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const norm = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const perp = (v: Pt): Pt => [-v[1], v[0]];
const deg = (a: Pt, b: Pt) => (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;

/** The corners of a closed outline, in order along it (`hole`: the material is outside it). */
function bends(ring: Pt[], material: (q: Pt) => boolean, hole = false): Bend[] {
  const pts = ring.length > 2 && dist(ring[0], ring[ring.length - 1]) < 1e-9 ? ring.slice(0, -1) : ring;
  const n = pts.length;
  if (n < 8) return [];
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i % n]));
  const total = cum[n];
  const at = (k: number) => pts[((k % n) + n) % n];
  let area = 0;
  for (let i = 0; i < n; i++) area += at(i)[0] * at(i + 1)[1] - at(i + 1)[0] * at(i)[1];
  const left = area > 0 !== hole;
  const turn = (i: number, arm = BEND_ARM) => {
    let a = i;
    let b = i;
    let la = 0;
    let lb = 0;
    while (la < arm && i - a < n / 2) la += dist(at(a), at(--a));
    while (lb < arm && b - i < n / 2) lb += dist(at(b), at(++b));
    const din = norm(sub(at(i), at(a)));
    const dout = norm(sub(at(b), at(i)));
    const m: Pt = [(at(a)[0] + at(b)[0]) / 2, (at(a)[1] + at(b)[1]) / 2];
    const toward = norm(sub(m, at(i)));
    // By which way the outline turns there (a thin tip may have no material a probe's length in).
    const cross = din[0] * dout[1] - din[1] * dout[0];
    const convex = Math.abs(cross) > 0.03 ? cross > 0 === left : material(add(at(i), toward, 0.15));
    return { deg: deg(din, dout), convex, into: convex ? toward : ([-toward[0], -toward[1]] as Pt) };
  };
  const ts = pts.map((_, i) => turn(i));
  const out: Bend[] = [];
  for (let i = 0; i < n; i++) {
    const t = ts[i];
    if (t.deg < BEND_DEG || ts[(i + n - 1) % n].deg > t.deg || ts[(i + 1) % n].deg >= t.deg) continue;
    const close = out.find((f) => f.convex === t.convex && Math.min(Math.abs(f.s - cum[i]), total - Math.abs(f.s - cum[i])) < 1.2);
    if (close) {
      if (t.deg > close.deg) Object.assign(close, { p: pts[i], i, s: cum[i], deg: t.deg, into: t.into });
    } else out.push({ p: pts[i], i, s: cum[i], ...t, sharp: 0 });
  }
  for (const b of out) b.sharp = turn(b.i, SHARP_ARM).deg;
  return out.sort((a, b) => a.s - b.s);
}

/** Whether the segment runs through the area, clear of its edge. */
function through(material: (q: Pt) => boolean, a: Pt, b: Pt, clear = 0.12): boolean {
  const n = perp(norm(sub(b, a)));
  for (let f = 0.1; f < 0.95; f += 0.1) {
    const q = add(a, sub(b, a), f);
    if (!material(q) || !material(add(q, n, clear)) || !material(add(q, n, -clear))) return false;
  }
  return true;
}

/** The point `s` along a closed outline (wrapping round). */
function along(ring: Pt[], s: number): Pt {
  const n = ring.length;
  let total = 0;
  for (let i = 1; i <= n; i++) total += dist(ring[i - 1], ring[i % n]);
  let x = ((s % total) + total) % total;
  for (let i = 1; i <= n; i++) {
    const l = dist(ring[i - 1], ring[i % n]);
    if (x <= l) return add(ring[i - 1], sub(ring[i % n], ring[i - 1]), l ? x / l : 0);
    x -= l;
  }
  return ring[0];
}

/**
 * The cut lines at the corners of an area: spikes cut off at their bases, bands cut on the miter
 * where they turn a corner. `max` is the widest column (mm).
 */
export function cornerCuts(outsides: Pt[][], holes: Pt[][], material: (q: Pt) => boolean, max: number): { cuts: [Pt, Pt][]; spikes: number; miters: number; tips: Pt[][] } {
  const cuts: [Pt, Pt][] = [];
  const used = new Set<Bend>();
  /** The corners of each spike, by the index of its cut line (the spikes' come first). */
  const tipsOf: Pt[][] = [];
  const all: Bend[] = [];
  for (const ring of outsides) {
    const bs = bends(ring, material);
    all.push(...bs);
    const notches = bs.filter((b) => !b.convex);
    if (notches.length < 2) continue;
    const pts = ring.length > 2 && dist(ring[0], ring[ring.length - 1]) < 1e-9 ? ring.slice(0, -1) : ring;
    let total = 0;
    for (let i = 1; i <= pts.length; i++) total += dist(pts[i - 1], pts[i % pts.length]);
    notches.forEach((a, k) => {
      const b = notches[(k + 1) % notches.length];
      const arc = (((b.s - a.s) % total) + total) % total;
      // Two notches: the spike is the shorter way round.
      if (notches.length === 2 && arc > total / 2) return;
      // Corners sticking out between the two notches: the spike.
      const tips = bs.filter((x) => x.convex && (((x.s - a.s) % total) + total) % total < arc);
      if (!tips.some((x) => x.sharp >= SHARP_DEG)) return;
      const base = dist(a.p, b.p);
      // Up to twice the widest column: a wider spike is cut along its middle too (see spikeLines).
      if (base > 2 * max || base < 0.4 || arc < 2.2 * base || !through(material, a.p, b.p)) return;
      let depth = 0;
      const u = norm(sub(b.p, a.p));
      for (let x = 0; x < arc; x += 0.2) depth = Math.max(depth, Math.abs(dot(sub(along(pts, a.s + x), a.p), perp(u))));
      if (depth < SPIKE_DEPTH * base) return;
      // A little in from the notches toward the spike, so two spikes side by side do not share an end.
      const p = along(pts, a.s + 0.15);
      const q = along(pts, b.s - 0.15);
      const d = norm(sub(q, p));
      cuts.push([add(p, d, -0.3), add(q, d, 0.3)]);
      used.add(a).add(b);
      tipsOf.push(tips.map((x) => x.p));
    });
  }
  for (const ring of holes) all.push(...bends(ring, material, true));
  // Miters: an outer corner and the inner corner facing it across the band.
  const outer = all.filter((b) => b.convex && b.deg >= 60);
  const inner = all.filter((b) => !b.convex && !used.has(b));
  const pairs: { o: Bend; n: Bend; d: number }[] = [];
  for (const o of outer) {
    for (const n of inner) {
      const v = sub(n.p, o.p);
      const d = Math.hypot(v[0], v[1]);
      if (d < 0.4 || d > 1.5 * max) continue;
      if (deg(v, o.into) > MITER_DEG || deg([-v[0], -v[1]], n.into) > MITER_DEG) continue;
      if (!through(material, o.p, n.p)) continue;
      pairs.push({ o, n, d });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  let miters = 0;
  for (const { o, n } of pairs) {
    if (used.has(o) || used.has(n)) continue;
    used.add(o).add(n);
    // From just beyond each corner, so the line crosses the outline there rather than grazing a vertex.
    const a = add(o.p, norm(o.into), -0.15);
    const b = add(n.p, norm(n.into), -0.15);
    const d = norm(sub(b, a));
    cuts.push([add(a, d, -0.3), add(b, d, 0.3)]);
    miters++;
  }
  return { cuts, spikes: tipsOf.length, miters, tips: tipsOf };
}

/**
 * Lines across for each part the cut lines leave: a column along it where it is long (by the
 * area's centerline `g` within it), else as a compact shape. Null when a part fits neither.
 */
export function planParts(outsides: Pt[][], holes: Pt[][], cuts: [Pt, Pt][], tips: Pt[][], g: Graph, max: number, strokes: Strokes): { cuts: [Pt, Pt][]; lines: [Pt, Pt][] } | null {
  const lines: [Pt, Pt][] = [];
  const more: [Pt, Pt][] = [];
  for (const o of outsides) {
    const mine = holes.filter((h) => inside(o, h[0]));
    const { parts, hole } = stripsOfOutline(o, [], cuts, mine);
    if (hole >= 0) return null;
    for (const part of parts) {
      // A spike: the part with its corners beyond the only cut line it has, a spike's base.
      const on = cuts.map((c, k) => ({ c, k })).filter(({ c }) => nearRing(part, add(c[0], sub(c[1], c[0]), 0.5)) < 0.05);
      const base = on.length === 1 && on[0].k < tips.length && tips[on[0].k].some((t) => nearRing(part, t) < 0.3) ? on[0].c : null;
      const plan = base ? spikeLines(part, base, max) : planPart(part, g, max, strokes);
      if (!plan) return null;
      lines.push(...plan.lines);
      more.push(...plan.cuts);
    }
  }
  return { cuts: [...cuts, ...more], lines };
}

type Strokes = (part: Graph, rings: Pt[][]) => { cuts: [Pt, Pt][]; lines: [Pt, Pt][] };

/** How far q lies from the outline. */
function nearRing(ring: Pt[], q: Pt): number {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const v = sub(ring[i], a);
    const l2 = dot(v, v);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), v) / l2)) : 0;
    best = Math.min(best, dist(add(a, v, t), q));
  }
  return best;
}

/**
 * A spike sewn from its base to its tip: lines along the base, a third and two thirds of the way
 * up. Wider at its base than `max`: cut along its middle from the tip, each half sewn across.
 */
function spikeLines(part: Pt[], base: [Pt, Pt], max: number): { cuts: [Pt, Pt][]; lines: [Pt, Pt][] } | null {
  const m = add(base[0], sub(base[1], base[0]), 0.5);
  const b = norm(sub(base[1], base[0]));
  // The tip: the middle of the farthest points (a flat end has many).
  const up = (q: Pt) => Math.abs(dot(sub(q, m), perp(b)));
  const far = Math.max(...part.map(up));
  const top = part.filter((q) => up(q) > far - 0.2);
  const tip: Pt = [top.reduce((s, q) => s + q[0], 0) / top.length, top.reduce((s, q) => s + q[1], 0) / top.length];
  // Up the spike, and across it.
  const n = norm(sub(tip, m));
  const u = perp(n);
  const h = dist(tip, m);
  const mine = insideOf(part);
  const split = dist(base[0], base[1]) > max;
  const lines: [Pt, Pt][] = [];
  for (const f of [0.3, 0.6]) {
    const o = add(m, n, h * f);
    let [lo, hi] = [Infinity, -Infinity];
    for (let t = -20; t <= 20; t += 0.05) if (mine(add(o, u, t))) [lo, hi] = [Math.min(lo, t), Math.max(hi, t)];
    if (hi - lo < 0.3) continue;
    // Through the middle of the spike at that height, or of each half.
    const at = split ? [lo + (0 - lo) / 2, hi / 2] : [(lo + hi) / 2];
    for (const t of at) {
      const c = add(o, u, t);
      if (mine(c)) lines.push([add(c, u, -0.2), add(c, u, 0.2)]);
    }
  }
  if (!lines.length) return null;
  return { cuts: split ? [[add(m, n, -0.3), add(tip, n, 0.3)]] : [], lines };
}

function planPart(part: Pt[], g: Graph, max: number, strokes: Strokes): { cuts: [Pt, Pt][]; lines: [Pt, Pt][] } | null {
  const mine = insideOf(part);
  // The centerline within the part, as pieces (a little in from where it leaves the part).
  const nodes: { p: Pt; r: number }[] = [];
  const branches: Graph['branches'] = [];
  for (const b of g.branches) {
    let run: number[] = [];
    const flush = () => {
      if (run.length > 2) {
        const pts = run.map((k) => b.pts[k]);
        const r = run.map((k) => b.r[k]);
        nodes.push({ p: pts[0], r: r[0] }, { p: pts[pts.length - 1], r: r[r.length - 1] });
        branches.push({ a: nodes.length - 2, b: nodes.length - 1, pts, r });
      }
      run = [];
    };
    b.pts.forEach((p, k) => (mine(p) ? run.push(k) : flush()));
    flush();
  }
  const samples = grid(part, mine);
  if (samples.length < 4) return { cuts: [], lines: [] };
  // Its long way (of the second moments) and how far it reaches along and across it.
  let [x, y] = [0, 0];
  for (const q of samples) [x, y] = [x + q[0], y + q[1]];
  const c: Pt = [x / samples.length, y / samples.length];
  let [sxx, syy, sxy] = [0, 0, 0];
  for (const q of samples) {
    const [u, v] = sub(q, c);
    [sxx, syy, sxy] = [sxx + u * u, syy + v * v, sxy + u * v];
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const u: Pt = [Math.cos(a), Math.sin(a)];
  const n = perp(u);
  let [ulo, uhi, nlo, nhi] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const q of samples) {
    const [du, dn] = [dot(sub(q, c), u), dot(sub(q, c), n)];
    [ulo, uhi, nlo, nhi] = [Math.min(ulo, du), Math.max(uhi, du), Math.min(nlo, dn), Math.max(nhi, dn)];
  }
  const [L, W] = [uhi - ulo, nhi - nlo];
  // Longer than wide (a bar, a spike): a column along it, lines square to its long way.
  if (L >= 1.15 * W && W <= max) {
    // Bending along its way (a curved stroke): lines square to its centerline as it turns.
    const main = branches.length ? branches.reduce((p, b) => (b.pts.length > p.pts.length ? b : p)) : null;
    if (main && main.pts.length > 10) {
      const t0 = sub(main.pts[Math.min(5, main.pts.length - 1)], main.pts[0]);
      const t1 = sub(main.pts[main.pts.length - 1], main.pts[Math.max(0, main.pts.length - 6)]);
      if (deg(t0, t1) > 30) return strokes({ nodes: [nodes[main.a], nodes[main.b]], branches: [{ ...main, a: 0, b: 1 }] }, [part]);
    }
    const k = L > 2.5 * W ? 3 : L > 1.6 * W ? 2 : 1;
    const lines: [Pt, Pt][] = [];
    for (let j = 1; j <= k; j++) {
      const p = add(c, u, ulo + (L * j) / (k + 1));
      if (mine(p)) lines.push([add(p, n, -0.3), add(p, n, 0.3)]);
    }
    if (lines.length) return { cuts: [], lines };
  }
  const s: Shape = { samples, outline: [part], holes: [], attach: [] };
  const plan = planShape(s, mine, max, true, true);
  if (plan) return { cuts: plan.cuts, lines: plan.lines };
  if (W > max) return null;
  return { cuts: [], lines: [[add(c, n, -0.3), add(c, n, 0.3)]] };
}
