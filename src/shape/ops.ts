import type { Pt } from '../digitize/skeleton';
import { bezier, insertNode, segment, segments, type Form, type Node, type Path } from './path';
import { fitCubic } from './vectorize';

/**
 * Operations on forms as vectors: areas joined and cut exactly on their curves (paper.js), and
 * areas grown or shrunk by a distance (Clipper2, curves fitted again). Both libraries load on first
 * use (`loadOps`); the functions below need them loaded and throw otherwise.
 *
 * Chosen by measurement on 102 forms of the demo project and the SVG examples (proposal
 * "Vektorwerkzeuge", project files vektormodell/vektorwerkzeuge.md): joining with paper.js is within
 * 0.001 mm of a 1 µm reference in 199 of 199 cases and keeps the nodes where they were; the pixel
 * way before was 0.15 mm off in the median and up to 2.5 mm. Offsetting with Clipper2 is within
 * 0.036 mm in 234 of 234 cases, where offsetting the curves directly (paperjs-offset, Skia's
 * stroker) gave wrong shapes once the distance passes a curve's radius.
 */

import type { Paths64 } from 'clipper2-ts';

// paper-core is paper.js without its canvas and script parts; its types are those of 'paper'.
type PaperScope = typeof import('paper');
type Clipper = typeof import('clipper2-ts');

let paper: PaperScope | null = null;
let clipper: Clipper | null = null;
let loading: Promise<void> | null = null;

/** Loads both libraries (once). */
export function loadOps(): Promise<void> {
  loading ??= Promise.all([import('paper/dist/paper-core.js'), import('clipper2-ts')]).then(([p, c]) => {
    paper = (p as unknown as { default: PaperScope }).default ?? (p as unknown as PaperScope);
    // Geometry only: a scope without a canvas.
    paper.setup(new paper.Size(1, 1));
    clipper = c;
  });
  return loading;
}

/** Whether the operations can run now. */
export const opsReady = (): boolean => !!paper && !!clipper;

function needPaper(): PaperScope {
  if (!paper) throw new Error('shape ops not loaded: await loadOps() first');
  return paper;
}

function needClipper(): Clipper {
  if (!clipper) throw new Error('shape ops not loaded: await loadOps() first');
  return clipper;
}

// Joining and cutting --------------------------------------------------------------------------

type PathItem = InstanceType<PaperScope['PathItem']>;

function toPaper(f: Form): PathItem {
  const P = needPaper();
  const cp = new P.CompoundPath({ insert: false });
  cp.fillRule = f.nonzero ? 'nonzero' : 'evenodd';
  for (const p of f.paths) {
    if (!p.closed || p.nodes.length < 2) continue;
    const segs = p.nodes.map((n) => new P.Segment(new P.Point(n.p[0], n.p[1]), new P.Point(n.a[0] - n.p[0], n.a[1] - n.p[1]), new P.Point(n.b[0] - n.p[0], n.b[1] - n.p[1])));
    cp.addChild(new P.Path({ segments: segs, closed: true, insert: false }));
  }
  return cp;
}

const key = (p: Pt) => `${p[0]},${p[1]}`;

/** A result back as a form; nodes that were nodes of `from` keep whether they were smooth. */
function fromPaper(item: PathItem, from: Form[]): Form | null {
  const smooth = new Map<string, boolean>();
  for (const f of from) for (const p of f.paths) for (const n of p.nodes) smooth.set(key(n.p), n.smooth);
  const kids = ('children' in item && item.children ? item.children : [item]) as InstanceType<PaperScope['Path']>[];
  const paths: Path[] = [];
  for (const k of kids) {
    if (k.segments.length < 2) continue;
    const nodes = k.segments.map((s: InstanceType<PaperScope['Segment']>): Node => {
      const p: Pt = [s.point.x, s.point.y];
      const a: Pt = [p[0] + s.handleIn.x, p[1] + s.handleIn.y];
      const b: Pt = [p[0] + s.handleOut.x, p[1] + s.handleOut.y];
      const known = smooth.get(key(p));
      return { p, a, b, smooth: known ?? (!s.handleIn.isZero() && !s.handleOut.isZero() && s.handleIn.isCollinear(s.handleOut)) };
    });
    paths.push({ closed: true, nodes });
  }
  return paths.length ? { paths } : null;
}

/** The areas of the forms as one (their closed paths; each fills by its own rule). Null when empty. */
export function unionForms(forms: Form[]): Form | null {
  const closed = forms.filter((f) => f.paths.some((p) => p.closed && p.nodes.length > 1));
  if (!closed.length) return null;
  let acc = toPaper(closed[0]);
  for (const f of closed.slice(1)) acc = acc.unite(toPaper(f), { insert: false });
  return fromPaper(acc, closed);
}

/** The area of `a` without the area of `b`; null when nothing is left. */
export function subtractForm(a: Form, b: Form): Form | null {
  return fromPaper(toPaper(a).subtract(toPaper(b), { insert: false }), [a, b]);
}

/** Area enclosed by a form as paper.js measures it (mm², even-odd or nonzero as the form says). */
export function areaOfForm(f: Form): number {
  // Paper adds the children's signed areas: settle crossings and holes by the form's rule first.
  // (Both are in paper.js 0.12, not in its typings.)
  type Settled = { resolveCrossings(): Settled; reorient(nonZero: boolean, clockwise: boolean): Settled; area: number };
  const item = (toPaper(f) as unknown as Settled).resolveCrossings().reorient(!!f.nonzero, true);
  return Math.abs(item.area);
}

// Crossings -------------------------------------------------------------------------------------

/** One path as paper.js sees it, open or closed. */
function pathToPaper(p: Path): InstanceType<PaperScope['Path']> {
  const P = needPaper();
  const segs = p.nodes.map((n) => new P.Segment(new P.Point(n.p[0], n.p[1]), new P.Point(n.a[0] - n.p[0], n.a[1] - n.p[1]), new P.Point(n.b[0] - n.p[0], n.b[1] - n.p[1])));
  return new P.Path({ segments: segs, closed: p.closed, insert: false });
}

/** A crossing this near a node is that node (curve time). */
const AT_NODE = 1e-4;

/**
 * The form with a node wherever its paths cross (themselves or each other), the curves split
 * exactly there so the outline stays as it was; null when nothing crosses. Touching without
 * crossing does not count.
 */
export function withCrossingNodes(f: Form): { form: Form; added: number } | null {
  const items = f.paths.map((p) => (p.nodes.length >= 2 ? pathToPaper(p) : null));
  type Loc = { seg: number; t: number };
  const at: Loc[][] = f.paths.map(() => []);
  type CurveLoc = { index: number; time: number; intersection: CurveLoc | null };
  const crossings = (a: unknown, b: unknown) => (a as { getCrossings(b: unknown): CurveLoc[] }).getCrossings(b);
  for (let i = 0; i < items.length; i++) {
    if (!items[i]) continue;
    for (let j = i; j < items.length; j++) {
      if (!items[j]) continue;
      for (const loc of crossings(items[i], items[j])) {
        at[i].push({ seg: loc.index, t: loc.time });
        // (Crossing itself, both places are on this path.)
        if (loc.intersection) at[j].push({ seg: loc.intersection.index, t: loc.intersection.time });
      }
    }
  }
  let form = f;
  let added = 0;
  at.forEach((locs, k) => {
    // From the last curve back, and within a curve from its end back: the earlier places keep their curve and time.
    const sorted = locs.filter((l) => l.t > AT_NODE && l.t < 1 - AT_NODE).sort((x, y) => y.seg - x.seg || y.t - x.t);
    let seg = -1;
    let upper = 1;
    let last = Infinity;
    for (const l of sorted) {
      if (l.seg !== seg) {
        seg = l.seg;
        upper = 1;
        last = Infinity;
      }
      // A crossing met twice (a path crossing itself is found from both sides).
      if (Math.abs(l.t - last) < AT_NODE) continue;
      form = insertNode(form, k, l.seg, l.t / upper).form;
      upper = l.t;
      last = l.t;
      added++;
    }
  });
  return added ? { form, added } : null;
}

// Offsetting ------------------------------------------------------------------------------------

/** Clipper works in integers: 0.1 µm. */
const SCALE = 1e4;
/** Largest distance of the polygons from the curves, and of the round joins from a circle (mm). */
const FLAT = 0.01;
/** Largest distance of the fitted curves from the offset polygon (mm). */
const FIT = 0.03;
/** Turn at a polygon point that makes a corner of the fitted curves (degrees). */
const CORNER_DEG = 35;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: Pt, b: Pt): [number, number] => {
  const l = dist(a, b) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};

/** Points of a path, at most `tol` from its curves (Wang's bound on the steps per curve). */
function flattened(p: Path, tol: number): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < segments(p); k++) {
    const c = segment(p, k);
    const ddx = Math.max(Math.abs(c[0][0] - 2 * c[1][0] + c[2][0]), Math.abs(c[1][0] - 2 * c[2][0] + c[3][0]));
    const ddy = Math.max(Math.abs(c[0][1] - 2 * c[1][1] + c[2][1]), Math.abs(c[1][1] - 2 * c[2][1] + c[3][1]));
    const n = Math.min(2000, Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.hypot(ddx, ddy)) / tol))));
    for (let i = 0; i < n; i++) out.push(bezier(c, i / n));
  }
  if (!p.closed && p.nodes.length) out.push(p.nodes[p.nodes.length - 1].p);
  return out;
}

const toInt = (pts: Pt[]) => pts.map(([x, y]) => ({ x: Math.round(x * SCALE), y: Math.round(y * SCALE) }));

/**
 * The area of `f` grown by `d` mm (shrunk when negative), round at the corners. Lines (open paths)
 * count with `lineWidth`: their band grows by `d` too. Null when nothing is left.
 */
export function offsetForm(f: Form, d: number, lineWidth = 0): Form | null {
  const C = needClipper();
  // Offsetting reads holes from the turning sense of the paths: settle the fill rule first.
  const c = new C.Clipper64();
  c.addSubject(f.paths.filter((p) => p.closed && p.nodes.length > 1).map((p) => toInt(flattened(p, FLAT))));
  const areas: Paths64 = [];
  c.execute(C.ClipType.Union, f.nonzero ? C.FillRule.NonZero : C.FillRule.EvenOdd, areas);
  const parts: Paths64 = [];
  if (areas.length) {
    const o = new C.ClipperOffset(2, FLAT * SCALE);
    o.addPaths(areas, C.JoinType.Round, C.EndType.Polygon);
    o.execute(d * SCALE, parts);
  }
  const open = f.paths.filter((p) => !p.closed && p.nodes.length > 1);
  if (open.length && lineWidth / 2 + d > 0) {
    const o = new C.ClipperOffset(2, FLAT * SCALE);
    for (const p of open) o.addPath(toInt(flattened(p, FLAT)), C.JoinType.Round, C.EndType.Round);
    const bands: Paths64 = [];
    o.execute((lineWidth / 2 + d) * SCALE, bands);
    parts.push(...bands);
  }
  if (!parts.length) return null;
  const u = new C.Clipper64();
  u.addSubject(parts);
  const sol: Paths64 = [];
  u.execute(C.ClipType.Union, C.FillRule.NonZero, sol);
  const paths = sol.filter((r) => r.length > 2).map((r) => fitRing(r.map((q) => [q.x / SCALE, q.y / SCALE] as Pt)));
  return paths.length ? { paths } : null;
}

/** A closed polygon as curves: sharp turns stay corners, the rest is fitted within FIT. */
function fitRing(raw: Pt[]): Path {
  // The fit checks its error only at the points: long straight edges get points in between.
  const pts: Pt[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const b = raw[(i + 1) % raw.length];
    const k = Math.max(1, Math.ceil(dist(a, b) / 0.2));
    for (let j = 0; j < k; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  const n = pts.length;
  const turn = (i: number) => {
    const v1 = unit(pts[(i - 1 + n) % n], pts[i]);
    const v2 = unit(pts[i], pts[(i + 1) % n]);
    return Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1])));
  };
  const limit = (CORNER_DEG * Math.PI) / 180;
  let breaks = pts.map((_, i) => i).filter((i) => turn(i) > limit);
  const corner = new Set(breaks);
  // A round loop is cut in two to have ends to fit between.
  if (breaks.length === 0) breaks = [0, Math.floor(n / 2)];
  else if (breaks.length === 1) breaks = [breaks[0], (breaks[0] + Math.floor(n / 2)) % n].sort((a, b) => a - b);
  const tangent = (i: number, side: 'in' | 'out'): [number, number] =>
    corner.has(i) ? (side === 'out' ? unit(pts[i], pts[(i + 1) % n]) : unit(pts[(i - 1 + n) % n], pts[i])) : unit(pts[(i - 1 + n) % n], pts[(i + 1) % n]);
  const curves: [Pt, Pt, Pt, Pt][] = [];
  const sharp: boolean[] = [];
  for (let b = 0; b < breaks.length; b++) {
    const s = breaks[b];
    const e = breaks[(b + 1) % breaks.length];
    const run: Pt[] = [];
    for (let i = s; ; i = (i + 1) % n) {
      run.push(pts[i]);
      if (i === e && run.length > 1) break;
    }
    const t2 = tangent(e, 'in');
    fitCubic(run, tangent(s, 'out'), [-t2[0], -t2[1]], FIT).forEach((c, k) => {
      curves.push(c as [Pt, Pt, Pt, Pt]);
      sharp.push(k === 0 && corner.has(s));
    });
  }
  const m = curves.length;
  return { closed: true, nodes: curves.map((c, i) => ({ p: c[0], a: curves[(i - 1 + m) % m][2], b: c[1], smooth: !sharp[i] })) };
}
