import { outline, type Region } from './region';
import { inside, stripsOfAreas } from './rungs';
import { cornerCuts, planParts } from './satinForms';
import { blobShape, filled, materialOf, planShape, smallHoles, splitBlobs, wholeShape } from './satinShapes';
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
 *   - a line closed into a ring is opened once, square across where it runs straightest,
 *   - lines across where the column bends (every 30°) and a fan of three at sharp corners.
 *   A thick place the lines run into (a nose on the mouth, a pupil on the ring of an eye) is cut
 *   off where the lines start and planned as a compact shape of its own (see satinShapes).
 * - `dot`: a round area, one column across or (up to 12 mm) two halves (see satinShapes).
 * - `pointed`: an area with corners (a triangle), lines across fanning from a corner (see satinShapes).
 * - `leaf`, `drop`: a long round area pointed at both ends or one, sewn as a dot (see satinShapes).
 * - `crescent`: a line pointed at both ends bending round (a moon), sewn as one column turning.
 * - `spikes`: points standing off a body (a star, the bars of an E), each cut off at its base.
 * - `frame`: a band turning corners (a frame, a block letter), cut on the miter (see satinForms).
 * - `wide`: too wide or too blotchy for satin; nothing is suggested.
 */

export type ShapeClass = 'strokes' | 'dot' | 'pointed' | 'spikes' | 'frame' | 'leaf' | 'drop' | 'crescent' | 'wide';

export interface SatinSuggestion {
  kind: ShapeClass;
  cuts: [Pt, Pt][];
  lines: [Pt, Pt][];
  /** Whether the lines make columns of every part (else the tool shows which part fails). */
  ok: boolean;
}

/** Widest column the strokes planner makes (mm), as the image conversion's satin limit. */
const STROKE_MAX = 7;
/** Lines at least this wide (mm) are cut on the miter at sharp corners rather than turned there. */
const MITER_MIN = 1.5;
/** An end branch reaching less than this many of its half widths beyond the line it hangs from stays on its column. */
const SPUR = 4;
/** A line across every this much turn of the column (degrees). */
const TURN_STEP = 30;
/** Bends sharper than this (degrees, within about a column width) get a fan of three lines. */
const CORNER = 40;
/** Bends sharper than this (degrees) are cut along their bisector instead (a mitre). */
const SHARP = 110;

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
/** Whether segments ab and cd cross away from their ends (two cut lines from one corner meet there). */
const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const r = sub(b, a);
  const q = sub(d, c);
  const den = r[0] * q[1] - r[1] * q[0];
  if (Math.abs(den) < 1e-12) return false;
  const w = sub(c, a);
  const t = (w[0] * q[1] - w[1] * q[0]) / den;
  const u = (w[0] * r[1] - w[1] * r[0]) / den;
  const mt = 0.6 / Math.hypot(r[0], r[1]);
  const mu = 0.6 / Math.hypot(q[0], q[1]);
  return t > mt && t < 1 - mt && u > mu && u < 1 - mu;
};
/** Distance from q to the segment from a to b. */
const toSegment = (q: Pt, a: Pt, b: Pt) => {
  const v = sub(b, a);
  const l2 = dot(v, v);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), v) / l2)) : 0;
  return dist(q, add(a, v, t));
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
export function classify(g: Graph, max = STROKE_MAX): ShapeClass {
  if (!g.branches.length) return 'wide';
  const rs = g.branches.flatMap((b) => b.r);
  const len = g.branches.reduce((a, b) => a + lengthOf(b.pts), 0);
  const w = 2 * median(rs);
  // A stroke: narrow enough for satin, much longer than wide.
  const wide = rs.filter((r) => 2 * r > max).length > rs.length * 0.05;
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

/** A suggestion for the fill area (null when the area is empty); `max` is the longest stitch of a shape's columns (mm). */
export function suggestSatin(area: Region, graph?: Graph, max = STROKE_MAX): SatinSuggestion | null {
  const { outsides, holes } = areaLoops(area);
  if (!outsides.length) return null;
  const g = graph ?? skeleton(area);
  const kind = classify(g, max);
  const material = materialOf(outsides, holes);
  // Corners to cut at (spikes, miters): on an area, or on lines wide enough that a turn would pile up.
  if (kind !== 'strokes' || 2 * median(g.branches.flatMap((b) => b.r)) >= MITER_MIN) {
    const made = atCorners(g, outsides, holes, material, max);
    if (made) return made;
  }
  if (kind !== 'strokes') {
    // No lines: the area as a whole may be a dot or a pointed shape.
    const plan = outsides.length === 1 ? planShape(wholeShape(outsides, holes, material), material, max) : null;
    return plan ? finish(g, plan.kind, plan.cuts, plan.lines, outsides, holes) : { kind: 'wide', cuts: [], lines: [], ok: false };
  }
  // Thick places in the lines planned on their own, the lines without them.
  const small = smallHoles(g, holes);
  const split = splitBlobs(small.length ? skeleton(filled(area, small)) : g);
  const plans = split?.blobs.map((b) => planShape(blobShape(b, split.strokes, outsides, holes, material), material, max));
  if (split && plans?.every((p) => p)) {
    const strokes = split.strokes.branches.length ? planStrokes(split.strokes, [...outsides, ...holes]) : { cuts: [], lines: [] };
    const only = !split.strokes.branches.length && plans.length === 1 ? plans[0]!.kind : kind;
    const made = finish(g, only, [...split.cuts, ...plans.flatMap((p) => p!.cuts), ...strokes.cuts], [...plans.flatMap((p) => p!.lines), ...strokes.lines], outsides, holes);
    if (made.ok) return made;
  }
  // Cut lines that cross are kept first (each forks off a line of its own); if that makes no
  // columns, the later of two is left out (a crossing seen as two forks, a sliver between them).
  const first = plan(g, outsides, holes, false);
  const made: SatinSuggestion = { kind: crescent(g) ? 'crescent' : kind, ...(first.ok ? first : [plan(g, outsides, holes, true)].find((x) => x.ok) ?? first) };
  if (outsides.length !== 1 || !compact(g, outsides[0])) return made;
  // Lines round a hole in a compact shape: a shape after all (a dot with a highlight off its middle).
  const whole = planShape(wholeShape(outsides, holes, material), material, max);
  const other = whole && finish(g, whole.kind, whole.cuts, whole.lines, outsides, holes);
  return other?.ok ? other : made;
}

/** The area cut at its corners (see satinForms), or null when it has none to cut at or makes no columns so. */
function atCorners(g: Graph, outsides: Pt[][], holes: Pt[][], material: (q: Pt) => boolean, max: number): SatinSuggestion | null {
  const c = cornerCuts(outsides, holes, material, max);
  if (!c.cuts.length) return null;
  const p = planParts(outsides, holes, c.cuts, c.tips, g, max, planStrokes);
  if (!p) return null;
  const made = finish(g, c.spikes >= c.miters ? 'spikes' : 'frame', p.cuts, p.lines, outsides, holes);
  return made.ok ? made : null;
}

/** One line pointed at both ends, bending round by more than a quarter turn: a crescent (a moon). */
function crescent(g: Graph): boolean {
  if (g.branches.length !== 1 || g.branches[0].a === g.branches[0].b) return false;
  const { pts, r } = g.branches[0];
  if (pts.length < 20) return false;
  const half = median(r);
  const k = Math.max(3, Math.round(pts.length / 8));
  const t0 = norm(sub(pts[k], pts[0]));
  const t1 = norm(sub(pts[pts.length - 1], pts[pts.length - 1 - k]));
  const pointed = (rs: number[]) => Math.min(...rs) < 0.5 * half;
  return pointed(r.slice(0, k)) && pointed(r.slice(-k)) && dot(t0, t1) < Math.cos((100 * Math.PI) / 180);
}

/** Thick against its size (a dot with a hole), not a drawing of thin lines. */
function compact(g: Graph, outside: Pt[]): boolean {
  const xs = outside.map((p) => p[0]);
  const ys = outside.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return median(g.branches.flatMap((b) => b.r)) >= 0.15 * size;
}

/** A plan of this kind made into columns (see columns). */
function finish(g: Graph, kind: ShapeClass, cuts: [Pt, Pt][], lines: [Pt, Pt][], outsides: Pt[][], holes: Pt[][]): SatinSuggestion {
  return { kind, ...columns(g, cuts, lines, outsides, holes) };
}

/** Lines across the strokes of the centerline; `apart`: of two cut lines that cross, the later left out. */
function plan(g: Graph, outsides: Pt[][], holes: Pt[][], apart: boolean): { cuts: [Pt, Pt][]; lines: [Pt, Pt][]; ok: boolean } {
  const { cuts, lines } = planStrokes(g, [...outsides, ...holes], apart);
  // A dot apart from the rest (its centerline hardly a line): one line across its narrow way.
  for (const o of outsides) {
    if (lines.some(([a, b]) => inside(o, add(a, sub(b, a), 0.5)))) continue;
    const line = across(o);
    if (line) lines.push(line);
  }
  return columns(g, cuts, lines, outsides, holes);
}

/** The cut lines in the order that opens the holes, a hole still closed opened, lines that mislead left out, and whether all make columns. */
function columns(g: Graph, cuts: [Pt, Pt][], lines: [Pt, Pt][], outsides: Pt[][], holes: Pt[][]): { cuts: [Pt, Pt][]; lines: [Pt, Pt][]; ok: boolean } {
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
  // A part that makes no column: a line across it that misleads (one through the tip of a hole,
  // say) is left out, as long as that helps.
  const cutsNow = bridgeOrder(ordered, outsides, holes);
  for (let guard = 0; made.bad && guard < 8; guard++) {
    const bad = made.bad;
    const same = (b: Pt[] | null) => !!b && b.length === bad.length && dist(b[0], bad[0]) < 1e-6;
    const mine = (l: [Pt, Pt]) => inside(bad, add(l[0], sub(l[1], l[0]), 0.5));
    const k = lines.findIndex((l) => mine(l) && !same(stripsOfAreas(outsides, lines.filter((x) => x !== l), cutsNow, holes).bad));
    if (k >= 0) {
      lines.splice(k, 1);
    } else {
      // Several that do not go together: the part's lines taken one by one, each kept that fits.
      const rest = lines.filter((l) => !mine(l));
      const kept: [Pt, Pt][] = [];
      for (const l of lines.filter(mine)) if (!same(stripsOfAreas(outsides, [...rest, ...kept, l], cutsNow, holes).bad)) kept.push(l);
      if (!kept.length) break;
      lines.splice(0, lines.length, ...rest, ...kept);
    }
    made = stripsOfAreas(outsides, lines, cutsNow, holes);
  }
  return { cuts: cutsNow, lines, ok: made.hole < 0 && !made.bad };
}

/** A line across a small outline through its middle, its narrow way (along its least spread). */
function across(ring: Pt[]): [Pt, Pt] | null {
  if (ring.length < 3) return null;
  const c: Pt = [0, 0];
  for (const p of ring) [c[0], c[1]] = [c[0] + p[0] / ring.length, c[1] + p[1] / ring.length];
  let [xx, xy, yy] = [0, 0, 0];
  for (const p of ring) {
    const [dx, dy] = sub(p, c);
    [xx, xy, yy] = [xx + dx * dx, xy + dx * dy, yy + dy * dy];
  }
  // The direction of least spread (the eigenvector of the smaller eigenvalue).
  const a = 0.5 * Math.atan2(2 * xy, xx - yy) + Math.PI / 2;
  const d: Pt = [Math.cos(a), Math.sin(a)];
  const reach = Math.max(...ring.map((p) => dist(p, c))) + 0.5;
  return [add(c, d, -reach), add(c, d, reach)];
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
export function planStrokes(g: Graph, rings: Pt[][], apart = false): { cuts: [Pt, Pt][]; lines: [Pt, Pt][] } {
  const B = g.branches;
  // Junctions joined by a branch shorter than their widths are one junction.
  const root = g.nodes.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const inner = new Set<number>();
  B.forEach((b, k) => {
    if (b.a !== b.b && lengthOf(b.pts) < 0.75 * (g.nodes[b.a].r + g.nodes[b.b].r)) {
      root[find(b.a)] = find(b.b);
      inner.add(k);
    }
  });
  const lenOf = B.map((b) => lengthOf(b.pts));
  const halfOf = B.map((b) => median(b.r));
  // Direction a branch leaves its junction in, over a stretch about as long as the junction is wide.
  const leaving = (e: End): Pt => {
    const b = B[e.br];
    const pts = away(b, e.atB);
    const s = Math.min(lenOf[e.br] * 0.5, Math.max(1.5, 2.5 * halfOf[e.br]));
    return norm(sub(pointAlong(pts, s), pts[0]));
  };
  const endsOf = () => {
    const m = new Map<number, End[]>();
    B.forEach((b, k) => {
      if (inner.has(k)) return;
      for (const atB of [false, true]) {
        const n = find(atB ? b.b : b.a);
        m.set(n, [...(m.get(n) ?? []), { br: k, atB }]);
      }
    });
    return m;
  };
  let ends = endsOf();
  // Two forks of three a little further apart that make a crossing (each line going on straight
  // through the other fork) are one junction too: one line runs through, the other is cut.
  const straight = (a: End, b: End) => dot(leaving(a), leaving(b)) < -0.8;
  B.forEach((b, k) => {
    const [u, v] = [find(b.a), find(b.b)];
    if (inner.has(k) || u === v || lenOf[k] > 2 * (g.nodes[b.a].r + g.nodes[b.b].r)) return;
    const U = (ends.get(u) ?? []).filter((e) => e.br !== k);
    const V = (ends.get(v) ?? []).filter((e) => e.br !== k);
    // (Not when another branch joins the two as well: that is a ring, not a crossing.)
    if (U.length !== 2 || V.length !== 2 || U.some((e) => V.some((f) => f.br === e.br))) return;
    if ((straight(U[0], V[0]) && straight(U[1], V[1])) || (straight(U[0], V[1]) && straight(U[1], V[0]))) {
      root[u] = v;
      inner.add(k);
      ends = endsOf();
    }
  });
  const degree = (n: number) => ends.get(find(n))?.length ?? 0;
  const loop = (e: End) => find(B[e.br].a) === find(B[e.br].b);
  // A cut line just past a hole it does not end on pinches off the line round the hole.
  const pinch = (p: Pt, q: Pt) => rings.some((r) => !r.includes(p) && !r.includes(q) && r.some((h) => toSegment(h, p, q) < 0.4));
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
        // A loop's ends never run through (round the loop the line would come back against its
        // own side): both are cut where they leave, the loop a piece of its own.
        if (es.length > 2 && (loop(es[i]) || loop(es[j]))) continue;
        // (Of two lines crossing, both going on about straight, the wider runs through.)
        const d = dot(dirs[i], dirs[j]);
        const c = es.length > 3 && d < -0.8 ? -2 - Math.min(halfOf[es[i].br], halfOf[es[j].br]) : d;
        if (c < bestCos) {
          bestCos = c;
          best = [i, j];
        }
      }
    }
    // A loop and a single line: the loop closes on itself into a ring, the line cut off at it.
    if (best[0] < 0) {
      const a = es.findIndex(loop);
      const b = es.findIndex((e, k) => k !== a && e.br === es[a]?.br);
      if (a >= 0 && b >= 0) best = [a, b];
    }
    const [i, j] = best;
    if (i >= 0) {
      partner.set(key(es[i]), es[j]);
      partner.set(key(es[j]), es[i]);
    }
    if (es.length === 2) continue;
    // (Its half width along it: near a junction the skeleton's radius swells.)
    const rThrough = Math.min(
      median((i >= 0 ? [es[i], es[j]] : es).flatMap((e) => radiiAway(B[e.br], e.atB).slice(0, 20))),
      Math.max(...(i >= 0 ? [es[i], es[j]] : es).map((e) => halfOf[e.br])),
    );
    // Short spurs stay on the column: a line across along each, from its tip.
    const kept: number[] = [];
    es.forEach((e, k) => {
      const b = B[e.br];
      const far = e.atB ? b.a : b.b;
      // A spur: a free end, short beyond the edge of the through line (at most about three times
      // its half width), not a line crossing it (one going on straight on the other side, as a
      // whisker over a cheek).
      const crossing = es.some((_, x) => x !== k && dot(dirs[x], dirs[k]) < -0.94);
      if (k !== i && k !== j && b.a !== b.b && degree(far) === 1 && !crossing && lenOf[e.br] - rThrough < Math.min(SPUR * halfOf[e.br], 3 * rThrough)) {
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
    const angle = (d: Pt) => Math.atan2(d[1], d[0]);
    const round = kept.slice().sort((x, y) => angle(dirs[x]) - angle(dirs[y]));
    /**
     * The outline point nearest `center` between the directions of ends x and y (counterclockwise
     * from x). Seen from where the end being cut leaves (in junctions merged from a few, the
     * merged middle can lie off to the side).
     */
    const corner = (center: Pt, reach: number, x: number, y: number, k: number): Pt | null => {
      // Between the two ends of a loop: the nearest point of the hole it goes round (a little
      // toward the end being cut, so the cuts of both ends do not meet in one point).
      if (es[x].br === es[y].br) {
        const loop = B[es[x].br].pts;
        const hole = rings.find((r) => inside(loop, r[0]));
        if (hole) {
          const near = Math.min(...hole.map((q) => dist(q, center)));
          const toward = pointAlong(away(B[es[k].br], es[k].atB), 1.5);
          let best = hole[0];
          for (const q of hole) if (dist(q, center) < near + 0.5 && dist(q, toward) < dist(best, toward)) best = q;
          return best;
        }
      }
      // The ends' directions as seen from `center` (in a merged junction they leave elsewhere).
      const seen = (z: number) => {
        const e = es[z];
        const pts = away(B[e.br], e.atB);
        return angle(sub(pointAlong(pts, Math.min(lenOf[e.br] * 0.5, Math.max(1.5, 2.5 * halfOf[e.br]))), center));
      };
      const a0 = seen(x);
      // (Not on the hole of a loop here: that lies between the loop's own two ends.)
      const loops = es.filter(loop).map((e) => B[e.br].pts);
      let span = seen(y) - a0;
      while (span <= 0) span += 2 * Math.PI;
      let best: Pt | null = null;
      for (const r of rings) {
        if (loops.some((l) => inside(l, r[0]))) continue;
        for (const q of r) {
          if (dist(q, center) >= reach) continue;
          let u = angle(sub(q, center)) - a0;
          while (u < 0) u += 2 * Math.PI;
          if (u <= 0.02 || u >= span - 0.02) continue;
          if (!best || dist(q, center) < dist(best, center)) best = q;
        }
      }
      return best;
    };
    // A cut between corners stays on the area (not across a hole or a notch between them).
    const within = (p: Pt, q: Pt) => {
      for (let t = 0.1; t < 0.95; t += 0.1) {
        const m = add(p, sub(q, p), t);
        if (rings.filter((r) => inside(r, m)).length % 2 === 0) return false;
      }
      return true;
    };
    for (const k of kept) {
      if (k === i || k === j) continue;
      const e = es[k];
      const pts = away(B[e.br], e.atB);
      // A short link already cut at its other junction: its rest stays on this one's column (a
      // second cut would leave a sliver between the two).
      const b = B[e.br];
      if (trimmed.has(key({ br: e.br, atB: !e.atB })) && lenOf[e.br] < 1.5 * (g.nodes[b.a].r + g.nodes[b.b].r)) {
        spurs.add(e.br);
        continue;
      }
      const at = round.indexOf(k);
      const cw = round[(at + round.length - 1) % round.length];
      const ccw = round[(at + 1) % round.length];
      const own = g.nodes[e.atB ? B[e.br].b : B[e.br].a];
      const p = corner(own.p, 3 * own.r + 1.5, cw, k, k);
      const q = corner(own.p, 3 * own.r + 1.5, k, ccw, k);
      let cut: [Pt, Pt];
      if (p && q && dist(p, q) > 0.2 && within(p, q) && !pinch(p, q)) {
        const d = norm(sub(q, p));
        cut = [add(p, d, -0.3), add(q, d, 0.3)];
      } else {
        // No corners found: square across the branch a junction's width out.
        const c = pointAlong(pts, Math.min(lenOf[e.br] * 0.5, Math.max(g.nodes[n].r + 0.2, own.r + halfOf[e.br])));
        const d = dirs[k];
        const w = halfOf[e.br] * 1.2 + 0.3;
        cut = [add(c, [-d[1], d[0]], -w), add(c, [-d[1], d[0]], w)];
      }
      // Two junctions close together can find the same corners: one cut is enough.
      // (With `apart`, also one crossing it: between them would be a sliver.)
      const twin = cuts.some(([a, b]) => Math.min(dist(a, cut[0]) + dist(b, cut[1]), dist(a, cut[1]) + dist(b, cut[0])) < 1 || (apart && cross(a, b, cut[0], cut[1])));
      if (!twin) cuts.push(cut);
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
    // A closed ring is opened once, square across where it runs straightest (its corners then
    // lie inside the column, fanned like any other).
    if (st.closed) {
      let k = 0;
      let least = Infinity;
      // Not at a junction on it (where a line leaves, cut off there already).
      const forks = g.nodes.filter((_, x) => degree(x) > 2);
      const clear = st.pts.map((q) => forks.every((f) => dist(q, f.p) >= f.r + w));
      for (let i = 0; i < n; i++) {
        if (!clear[i] && clear.some((c) => c)) continue;
        const t = turnAt(i, Math.max(1, 1.5 * w)).deg;
        if (t < least) {
          least = t;
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
      const l = Math.min(5 * half, (half / Math.max(0.3, Math.cos((tt.deg * Math.PI) / 360))) * 1.1 + 0.3);
      if (tt.deg >= SHARP && Math.hypot(bis[0], bis[1]) > 0.1 && !pinch(add(st.pts[i], bis, -l), add(st.pts[i], bis, l))) {
        // Too sharp to fan (the stitches would pile up in the inner corner): cut along the
        // bisector, a mitre, with a line across either side.
        cuts.push([add(st.pts[i], bis, -l), add(st.pts[i], bis, l)]);
        placed.push(cum[i]);
      } else if (free(cum[i], w * 0.8)) {
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
