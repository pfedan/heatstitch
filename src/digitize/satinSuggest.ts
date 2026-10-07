import { outline, type Region } from './region';
import { cutLinesBetween, inside, stripsOfAreas } from './rungs';
import { skeleton, type Branch, type Graph, type Pt } from './skeleton';

/**
 * "Vorschlagen" in the satin tool: a fill made into satin columns the way a digitizer would cut it
 * by hand. First the shape is classified, then the planner of its class sets the cut lines
 * (Trennlinien, where a column ends) and the lines across (Querlinien, the direction of the
 * stitches). The result is what the tool draws by hand, so it can be changed there afterwards.
 *
 * Classes so far:
 * - `strokes`: a drawing of lines, branching and closing into rings (an outline of a figure,
 *   lettering drawn with a pen). Planned like a hand digitizer does:
 *   - at a junction the line that goes on straightest runs through; the others end on its edge
 *     with a cut line along it,
 *   - short spurs (the toe marks of a paw) stay on their column, with a line across along them,
 *   - a line closed into a ring is opened once, at its sharpest bend,
 *   - lines across where the column bends (every 30°) and a fan of three at sharp corners.
 * - `wide`: too wide or too blotchy for satin; nothing is suggested.
 */

export type ShapeClass = 'strokes' | 'wide';

export interface SatinSuggestion {
  kind: ShapeClass;
  cuts: [Pt, Pt][];
  lines: [Pt, Pt][];
  /** Whether the lines make columns of every part (else the tool shows which part fails). */
  ok: boolean;
}

/** Widest column the strokes planner makes (mm), as the image conversion's satin limit. */
const STROKE_MAX = 7;
/** An end branch reaching less than this many of its half widths beyond the line it hangs from stays on its column. */
const SPUR = 4;
/** A line across every this much turn of the column (degrees). */
const TURN_STEP = 30;
/** Bends sharper than this (degrees, within about a column width) get a fan of three lines. */
const CORNER = 40;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const median = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};
const lengthOf = (pts: Pt[]) => pts.reduce((a, p, i) => (i ? a + dist(p, pts[i - 1]) : a), 0);
const area2 = (ring: Pt[]) => ring.reduce((a, p, i) => a + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0);

/** The outsides and holes of an area (tiny specks left out), as the satin tool reads them. */
export function areaLoops(area: Region): { outsides: Pt[][]; holes: Pt[][] } {
  const loops = (outline(area) as Pt[][]).filter((l) => l.length > 2 && Math.abs(area2(l)) > 0.5);
  // Inside an even number of others: an outside; an odd number: a hole.
  const depth = (l: Pt[]) => loops.filter((o) => o !== l && inside(o, l[0])).length;
  return { outsides: loops.filter((l) => depth(l) % 2 === 0), holes: loops.filter((l) => depth(l) % 2 === 1) };
}

/** The class of a shape by its skeleton: lines of about even width, or anything else. */
export function classify(g: Graph): ShapeClass {
  if (!g.branches.length) return 'wide';
  const rs = g.branches.flatMap((b) => b.r);
  const len = g.branches.reduce((a, b) => a + lengthOf(b.pts), 0);
  const w = 2 * median(rs);
  // A stroke: narrow enough for satin, much longer than wide.
  const wide = rs.filter((r) => 2 * r > STROKE_MAX).length > rs.length * 0.05;
  return !wide && len > 3 * w ? 'strokes' : 'wide';
}

/**
 * Whether sections are worth offering for an area with this skeleton: a drawing of lines that
 * branches or closes into a ring (a single line is a satin column as it is).
 */
export function offersSections(g: Graph): boolean {
  if (classify(g) !== 'strokes') return false;
  const degree = new Map<number, number>();
  for (const b of g.branches) {
    if (b.a === b.b) return true;
    degree.set(b.a, (degree.get(b.a) ?? 0) + 1);
    degree.set(b.b, (degree.get(b.b) ?? 0) + 1);
  }
  return [...degree.values()].some((d) => d >= 3);
}

/** A suggestion for the fill area (null when the area is empty). */
export function suggestSatin(area: Region, graph?: Graph): SatinSuggestion | null {
  const { outsides, holes } = areaLoops(area);
  if (!outsides.length) return null;
  const g = graph ?? skeleton(area);
  const kind = classify(g);
  if (kind !== 'strokes') return { kind, cuts: [], lines: [], ok: false };
  const { cuts, lines } = planStrokes(g, [...outsides, ...holes]);
  const ordered = bridgeOrder(cuts, outsides, holes);
  let made = stripsOfAreas(outsides, lines, ordered, holes);
  // A hole still closed (a ring of one line with a ring inside, say): opened where it comes closest.
  let tries = 0;
  while (made.hole >= 0 && tries++ < holes.length) {
    const cut = openHole(g, holes[made.hole]);
    if (!cut) break;
    ordered.push(cut);
    made = stripsOfAreas(outsides, lines, bridgeOrder(ordered, outsides, holes), holes);
  }
  return { kind, cuts: bridgeOrder(ordered, outsides, holes), lines, ok: made.hole < 0 && !made.bad };
}

/** A branch end at a junction: the branch and whether it leaves from its end b. */
interface End {
  br: number;
  atB: boolean;
}

/** Points of a branch walked away from the end given. */
const away = (b: Branch, atB: boolean): Pt[] => (atB ? b.pts.slice().reverse() : b.pts);
const radiiAway = (b: Branch, atB: boolean): number[] => (atB ? b.r.slice().reverse() : b.r);

/** The point `s` mm along the line. */
function pointAlong(pts: Pt[], s: number): Pt {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (acc + l >= s) return add(pts[i - 1], sub(pts[i], pts[i - 1]), l ? (s - acc) / l : 0);
    acc += l;
  }
  return pts[pts.length - 1];
}

/** Nearest point of a line to q: the distance and the direction of the line there. */
function nearest(pts: Pt[], q: Pt): { d: number; t: Pt } {
  let best = { d: Infinity, t: [1, 0] as Pt };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const v = sub(pts[i], a);
    const l2 = dot(v, v);
    const t = l2 ? Math.min(1, Math.max(0, dot(sub(q, a), v) / l2)) : 0;
    const d = dist(add(a, v, t), q);
    if (d < best.d) best = { d, t: norm(v) };
  }
  return best;
}

/**
 * Cut lines and lines across for a drawing of lines (see the class `strokes`). Junctions closer
 * together than their widths are one (two whiskers crossing a cheek a little apart).
 */
export function planStrokes(g: Graph, rings: Pt[][]): { cuts: [Pt, Pt][]; lines: [Pt, Pt][] } {
  const B = g.branches;
  // Junctions joined by a branch shorter than their widths are one junction.
  const root = g.nodes.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const inner = new Set<number>();
  B.forEach((b, k) => {
    if (b.a !== b.b && lengthOf(b.pts) < g.nodes[b.a].r + g.nodes[b.b].r) {
      root[find(b.a)] = find(b.b);
      inner.add(k);
    }
  });
  const ends = new Map<number, End[]>();
  B.forEach((b, k) => {
    if (inner.has(k)) return;
    for (const atB of [false, true]) {
      const n = find(atB ? b.b : b.a);
      ends.set(n, [...(ends.get(n) ?? []), { br: k, atB }]);
    }
  });
  const degree = (n: number) => ends.get(find(n))?.length ?? 0;
  const lenOf = B.map((b) => lengthOf(b.pts));
  const halfOf = B.map((b) => median(b.r));
  // Direction a branch leaves its junction in, over a stretch about as long as the junction is wide.
  const leaving = (e: End): Pt => {
    const b = B[e.br];
    const pts = away(b, e.atB);
    const s = Math.min(lenOf[e.br] * 0.5, Math.max(1.5, 2.5 * halfOf[e.br]));
    return norm(sub(pointAlong(pts, s), pts[0]));
  };
  const key = (e: End) => `${e.br}${e.atB ? 'b' : 'a'}`;
  const partner = new Map<string, End>();
  const cuts: [Pt, Pt][] = [];
  const lines: [Pt, Pt][] = [];
  const spurs = new Set<number>();
  /** Where a stroke is cut short of its junction end: the distance along it from that end. */
  const trimmed = new Map<string, number>();
  /** Places along strokes that already have a line across (spur bases). */
  const taken: Pt[] = [];

  for (const [n, es] of ends) {
    if (es.length < 2) continue;
    // The two ends that go on straightest run through.
    let best: [number, number] = [-1, -1];
    let bestCos = Infinity;
    const dirs = es.map(leaving);
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        if (es[i].br === es[j].br && B[es[i].br].a === B[es[i].br].b && es.length > 2) continue;
        const c = dot(dirs[i], dirs[j]);
        if (c < bestCos) {
          bestCos = c;
          best = [i, j];
        }
      }
    }
    if (best[0] < 0) continue;
    const [i, j] = best;
    partner.set(key(es[i]), es[j]);
    partner.set(key(es[j]), es[i]);
    if (es.length === 2) continue;
    const rThrough = median([...radiiAway(B[es[i].br], es[i].atB).slice(0, 20), ...radiiAway(B[es[j].br], es[j].atB).slice(0, 20)]);
    // Short spurs stay on the column: a line across along each, from its tip.
    const kept: number[] = [];
    es.forEach((e, k) => {
      const b = B[e.br];
      const far = e.atB ? b.a : b.b;
      // A spur: a free end, short beyond the edge of the through line, not a line crossing it
      // (one going on straight on the other side, as a whisker over a cheek).
      const crossing = es.some((_, x) => x !== k && dot(dirs[x], dirs[k]) < -0.94);
      if (k !== i && k !== j && b.a !== b.b && degree(far) === 1 && !crossing && lenOf[e.br] - rThrough < SPUR * halfOf[e.br]) {
        spurs.add(e.br);
        const pts = away(b, e.atB);
        const tip = pts[pts.length - 1];
        const base = pts[0];
        lines.push([tip, add(base, norm(sub(base, tip)), rThrough * 0.8)]);
        taken.push(base);
      } else kept.push(k);
    });
    // The others end on the edge of the through line: a cut line between the inner corners of
    // the outline either side of them (where the edge of the line turns into the next one).
    const center = g.nodes[n].p;
    const angle = (d: Pt) => Math.atan2(d[1], d[0]);
    const round = kept.slice().sort((x, y) => angle(dirs[x]) - angle(dirs[y]));
    const reach = 3 * g.nodes[n].r + 1.5;
    const near = rings.flatMap((r) => r.filter((q) => dist(q, center) < reach));
    /** The outline point nearest the junction between the directions of ends x and y (counterclockwise from x). */
    const corner = (x: number, y: number): Pt | null => {
      const a0 = angle(dirs[x]);
      let span = angle(dirs[y]) - a0;
      while (span <= 0) span += 2 * Math.PI;
      let best: Pt | null = null;
      for (const q of near) {
        let u = angle(sub(q, center)) - a0;
        while (u < 0) u += 2 * Math.PI;
        if (u <= 0.02 || u >= span - 0.02) continue;
        if (!best || dist(q, center) < dist(best, center)) best = q;
      }
      return best;
    };
    for (const k of kept) {
      if (k === i || k === j) continue;
      const e = es[k];
      const pts = away(B[e.br], e.atB);
      const at = round.indexOf(k);
      const cw = round[(at + round.length - 1) % round.length];
      const ccw = round[(at + 1) % round.length];
      const p = corner(cw, k);
      const q = corner(k, ccw);
      let cut: [Pt, Pt];
      if (p && q && dist(p, q) > 0.2) {
        const d = norm(sub(q, p));
        cut = [add(p, d, -0.3), add(q, d, 0.3)];
      } else {
        // No corners found: square across the branch a junction's width out.
        const c = pointAlong(pts, Math.min(lenOf[e.br] * 0.5, g.nodes[n].r + 0.2));
        const d = dirs[k];
        const w = halfOf[e.br] * 1.2 + 0.3;
        cut = [add(c, [-d[1], d[0]], -w), add(c, [-d[1], d[0]], w)];
      }
      cuts.push(cut);
      // Where along the branch the cut lies (lines across keep clear of it).
      const m = add(cut[0], sub(cut[1], cut[0]), 0.5);
      let s = 0;
      let bestS = 0;
      let bestD = Infinity;
      for (let q2 = 0; q2 < pts.length; q2++) {
        if (q2) s += dist(pts[q2], pts[q2 - 1]);
        const d2 = dist(pts[q2], m);
        if (d2 < bestD) {
          bestD = d2;
          bestS = s;
        }
      }
      trimmed.set(key(e), bestS);
    }
  }

  // The strokes: branches joined where they run through a junction.
  const used = new Set<number>([...inner, ...spurs]);
  const strokes: { pts: Pt[]; r: number[]; closed: boolean; from: number; to: number }[] = [];
  const walk = (start: End) => {
    const pts: Pt[] = [];
    const r: number[] = [];
    let e: End | undefined = start;
    const from = trimmed.get(key(start)) ?? 0;
    let to = 0;
    let closed = false;
    while (e && !used.has(e.br)) {
      used.add(e.br);
      const b = B[e.br];
      pts.push(...away(b, e.atB));
      r.push(...radiiAway(b, e.atB));
      const out: End = { br: e.br, atB: !e.atB };
      to = trimmed.get(key(out)) ?? 0;
      e = partner.get(key(out));
      if (e && e.br === start.br && e.atB === start.atB) closed = true;
    }
    if (pts.length > 1) strokes.push({ pts, r, closed, from, to });
  };
  // From the ends first (free or cut), then what is left: closed rings.
  B.forEach((_, k) => {
    if (used.has(k)) return;
    for (const atB of [false, true]) {
      const e = { br: k, atB };
      if (!partner.has(key(e)) && !used.has(k)) walk(e);
    }
  });
  B.forEach((_, k) => !used.has(k) && walk({ br: k, atB: false }));

  for (const st of strokes) {
    const half = median(st.r);
    const w = 2 * half;
    const n = st.pts.length;
    // Only the stretch the column covers: from where it starts after a cut to where it ends.
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(st.pts[i - 1], st.pts[i]));
    const total = cum[n - 1];
    const lo = st.from + half + 0.4;
    const hi = total - st.to - half - 0.4;
    const heading = (i: number, h: number): Pt => {
      let a = i;
      let b = i;
      while (a > 0 && cum[i] - cum[a] < h) a--;
      while (b < n - 1 && cum[b] - cum[i] < h) b++;
      return norm(sub(st.pts[b], st.pts[a]));
    };
    const turnAt = (i: number, h: number) => {
      let a = i;
      let b = i;
      while (a > 0 && cum[i] - cum[a] < h) a--;
      while (b < n - 1 && cum[b] - cum[i] < h) b++;
      const din = norm(sub(st.pts[i], st.pts[a]));
      const dout = norm(sub(st.pts[b], st.pts[i]));
      return { deg: (Math.acos(Math.max(-1, Math.min(1, dot(din, dout)))) * 180) / Math.PI, din, dout };
    };
    const across = (p: Pt, d: Pt): [Pt, Pt] => [add(p, d, -half * 0.6), add(p, d, half * 0.6)];
    const placed: number[] = [];
    const free = (s: number, gap: number) => placed.every((x) => Math.abs(x - s) >= gap) && taken.every((q) => dist(q, pointAlong(st.pts, s)) >= w * 1.2);
    // A closed ring is opened once, at its sharpest bend.
    if (st.closed) {
      let k = 0;
      let most = -1;
      for (let i = 0; i < n; i++) {
        const t = turnAt(i, Math.max(0.6, w)).deg;
        if (t > most) {
          most = t;
          k = i;
        }
      }
      const tt = turnAt(k, Math.max(0.6, w));
      const d = norm(add(tt.din, tt.dout));
      const nrm: Pt = [-d[1], d[0]];
      cuts.push([add(st.pts[k], nrm, -(half * 1.2 + 0.3)), add(st.pts[k], nrm, half * 1.2 + 0.3)]);
      // Lines across measured from the opening.
      const rot = [...st.pts.slice(k), ...st.pts.slice(1, k + 1)];
      const rr = [...st.r.slice(k), ...st.r.slice(1, k + 1)];
      strokes.push({ pts: rot, r: rr, closed: false, from: half + 0.1, to: half + 0.1 });
      continue;
    }
    if (hi <= lo) {
      // Too short for more: one line across in the middle.
      const i = cum.findIndex((c) => c >= (st.from + total - st.to) / 2);
      const k = Math.max(0, Math.min(n - 1, i));
      const h = heading(k, Math.max(0.3, half));
      lines.push(across(st.pts[k], [-h[1], h[0]]));
      continue;
    }
    // Sharp bends: a line along the bisector and one square to the column about a width either side.
    const hc = Math.max(0.6, w * 0.6);
    const corners: number[] = [];
    for (let i = 1; i < n - 1; i++) {
      if (cum[i] < lo || cum[i] > hi) continue;
      const t = turnAt(i, hc).deg;
      if (t < CORNER) continue;
      if (t >= turnAt(i - 1, hc).deg && t >= turnAt(i + 1, hc).deg) {
        if (corners.length && cum[i] - cum[corners[corners.length - 1]] < w * 1.5) {
          if (t > turnAt(corners[corners.length - 1], hc).deg) corners[corners.length - 1] = i;
        } else corners.push(i);
      }
    }
    for (const i of corners) {
      const tt = turnAt(i, hc);
      const bis = norm(sub(tt.din, tt.dout));
      if (free(cum[i], w * 0.8)) {
        lines.push(across(st.pts[i], Math.hypot(bis[0], bis[1]) > 0.1 ? bis : [-tt.din[1], tt.din[0]]));
        placed.push(cum[i]);
      }
      for (const side of [-1, 1]) {
        const s = cum[i] + side * w * 1.1;
        if (s < lo || s > hi || !free(s, w * 0.8)) continue;
        const k = cum.findIndex((c) => c >= s);
        const h = heading(k, Math.max(0.3, half));
        lines.push(across(st.pts[k], [-h[1], h[0]]));
        placed.push(s);
      }
    }
    // Along the rest: a line each time the column has turned by TURN_STEP since the last one.
    let lastDir: Pt | null = null;
    let lastS = -Infinity;
    for (let i = 0; i < n; i++) {
      const s = cum[i];
      if (s < lo || s > hi) continue;
      const h = heading(i, Math.max(0.3, w));
      if (!lastDir) {
        lastDir = h;
        lastS = s;
        continue;
      }
      // A corner's lines count as lines along the way.
      const pc = placed.find((x) => x <= s && x > lastS);
      if (pc !== undefined) {
        lastDir = heading(cum.findIndex((c) => c >= pc), Math.max(0.3, w));
        lastS = pc;
      }
      const turned = (Math.acos(Math.max(-1, Math.min(1, dot(h, lastDir)))) * 180) / Math.PI;
      if (turned >= TURN_STEP && s - lastS >= w * 1.5 && free(s, w * 1.5)) {
        lines.push(across(st.pts[i], [-h[1], h[0]]));
        placed.push(s);
        lastDir = h;
        lastS = s;
      }
    }
    // Every column needs a line across: one in the middle if none.
    if (!placed.length) {
      // In the middle, or where it keeps farthest from the lines along spurs.
      let mid = (lo + hi) / 2;
      const spurs = taken.filter((q) => nearest(st.pts, q).d < w);
      if (spurs.length) {
        let far = -1;
        for (let x = lo; x <= hi; x += 0.2) {
          const p = pointAlong(st.pts, x);
          const d = Math.min(...spurs.map((q) => dist(p, q)));
          if (d > far) [far, mid] = [d, x];
        }
        if (far < w * 1.2) continue;
      }
      const k = cum.findIndex((c) => c >= mid);
      const h = heading(k, Math.max(0.3, w));
      lines.push(across(st.pts[k], [-h[1], h[0]]));
    }
  }
  return { cuts, lines };
}

/** Which ring a cut line reaches first either side of its middle: -1 the outside, else a hole. */
function cutEnds(cut: [Pt, Pt], outsides: Pt[][], holes: Pt[][]): [number, number] {
  const [a, b] = cut;
  const m = add(a, sub(b, a), 0.5);
  const d = norm(sub(b, a));
  const hit = (dir: number) => {
    let best = { ring: -1, t: Infinity };
    const rings = [...outsides.map((r) => ({ r, k: -1 })), ...holes.map((r, k) => ({ r, k }))];
    for (const { r, k } of rings) {
      for (let i = 1; i < r.length; i++) {
        const p = r[i - 1];
        const q = sub(r[i], p);
        const den = d[0] * dir * q[1] - d[1] * dir * q[0];
        if (Math.abs(den) < 1e-12) continue;
        const w = sub(p, m);
        const t = (w[0] * q[1] - w[1] * q[0]) / den;
        const u = (w[0] * d[1] * dir - w[1] * d[0] * dir) / den;
        if (t > 0 && u >= 0 && u <= 1 && t < best.t) best = { ring: k, t };
      }
    }
    return best.ring;
  };
  return [hit(-1), hit(1)];
}

/**
 * The cut lines in an order that opens the holes one after another: a cut from the edge into a
 * hole first, then from that hole into the next (stripsOfOutline opens holes in the order given).
 */
export function bridgeOrder(cuts: [Pt, Pt][], outsides: Pt[][], holes: Pt[][]): [Pt, Pt][] {
  const ends = cuts.map((c) => cutEnds(c, outsides, holes));
  const open = new Set<number>([-1]);
  const done = new Set<number>();
  const out: [Pt, Pt][] = [];
  for (let changed = true; changed; ) {
    changed = false;
    ends.forEach(([x, y], k) => {
      if (done.has(k)) return;
      if ((open.has(x) && !open.has(y)) || (open.has(y) && !open.has(x))) {
        out.push(cuts[k]);
        done.add(k);
        open.add(x);
        open.add(y);
        changed = true;
      }
    });
  }
  cuts.forEach((c, k) => !done.has(k) && out.push(c));
  return out;
}

/** A cut line across the line nearest to a hole that is still closed. */
function openHole(g: Graph, hole: Pt[]): [Pt, Pt] | null {
  let best: { b: Branch; i: number; d: number } | null = null;
  for (const b of g.branches) {
    for (let i = 1; i < b.pts.length - 1; i++) {
      const d = nearest(hole, b.pts[i]).d - b.r[i];
      if (!best || d < best.d) best = { b, i, d };
    }
  }
  if (!best) return null;
  const { b, i } = best;
  const t = norm(sub(b.pts[Math.min(b.pts.length - 1, i + 3)], b.pts[Math.max(0, i - 3)]));
  const n: Pt = [-t[1], t[0]];
  const w = b.r[i] * 1.2 + 0.3;
  return [add(b.pts[i], n, -w), add(b.pts[i], n, w)];
}

/** A column as withSplit reads it (see Rails in model/restitch). */
interface SplitColumn {
  left: Pt[];
  right: Pt[];
  split?: { outlines: Pt[][]; holes: Pt[][]; cuts: [Pt, Pt][] };
}

/**
 * A satin that does not know how it was cut (see Rails.split), made from a fill or read from
 * stitches: the area from its shape, the cut lines where its columns end inside it (against another
 * column, not at the edge). So every satin opens in sections of its area, and the cut lines can always be moved, drawn or taken away again, and the columns made anew.
 */
export function withSplit<C extends SplitColumn>(columns: C[][], area: Region, part?: number): C[][] {
  if (columns.some((part) => part.some((r) => r.split))) return columns;
  const { outsides, holes } = areaLoops(area);
  if (!outsides.length) return columns;
  const within = (q: Pt) => outsides.some((o) => inside(o, q)) && !holes.some((h) => inside(h, q));
  // Between the rails at a share of the way along: a short or twisted column (read from an
  // image) can have its middle just outside its own area, so a quarter or three on is as good.
  const at = (c: C, share: number): Pt => {
    const i = Math.round((c.left.length - 1) * share);
    const j = Math.min(i, c.right.length - 1);
    return [(c.left[i][0] + c.right[j][0]) / 2, (c.left[i][1] + c.right[j][1]) / 2];
  };
  // The part that is the area: its columns lie in it (one in ten may miss, read from an image a
  // tiny column can lie across its own edge).
  const inArea = (c: C) => c.left.length > 1 && c.right.length > 1 && [0.5, 0.25, 0.75].some((sh) => within(at(c, sh)));
  // `part` given: that one (its area read from its own rails, so it lies in it however it was read).
  const k = part ?? columns.findIndex((pt) => pt.length > 0 && pt.filter((c) => !inArea(c)).length <= Math.floor(pt.length / 10));
  if (k < 0) return columns;
  const cuts = cutLinesBetween(columns[k], outsides, holes);
  return columns.map((part, j) => (j === k ? part.map((c, i) => (i ? c : { ...c, split: { outlines: outsides, holes, cuts } })) : part));
}
