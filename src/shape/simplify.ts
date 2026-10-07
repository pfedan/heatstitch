import type { Pt } from '../digitize/skeleton';
import { bezier, segment, segments, type Form, type Node, type Path } from './path';
import { fitCubic } from './vectorize';

/**
 * Deviations tried one after the other (mm): a press of "Vereinfachen" takes the smallest that saves
 * nodes, so pressing again simplifies further.
 */
export const SIMPLIFY_STEPS = [0.3, 0.6, 1.2];
/** Sample distance along the curves when fitting them again (mm). */
const SAMPLE = 0.05;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: Pt, b: Pt): [number, number] => {
  const l = dist(a, b) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};

export const nodeCount = (f: Form): number => f.paths.reduce((a, p) => a + p.nodes.length, 0);

/**
 * The form with fewer nodes, at most `tol` mm from the old outline: the curves between corners are
 * fitted anew, corners stay where they are and stay corners. Null when that saves no node.
 */
export function simplifyForm(f: Form, tol: number): Form | null {
  const out: Form = { ...f, paths: f.paths.map((p) => simplifyPath(p, tol)) };
  return nodeCount(out) < nodeCount(f) ? out : null;
}

/** The form simplified with the first step of SIMPLIFY_STEPS that saves nodes, or null. */
export function simplifyMore(f: Form): Form | null {
  for (const tol of SIMPLIFY_STEPS) {
    const s = simplifyForm(f, tol);
    if (s) return s;
  }
  return null;
}

/** Points along segments `from` up to (not including) `to` of path `p`, about SAMPLE apart. */
function sample(p: Path, from: number, to: number): Pt[] {
  const n = p.nodes.length;
  const pts: Pt[] = [p.nodes[from].p];
  for (let k = from; k !== to; k = (k + 1) % n) {
    const c = segment(p, k);
    const len = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
    const steps = Math.min(2000, Math.max(2, Math.ceil(len / SAMPLE)));
    for (let i = 1; i <= steps; i++) pts.push(bezier(c, i / steps));
  }
  return pts;
}

/** Whether all points lie within `tol` of the straight line from the first to the last. */
function straight(pts: Pt[], tol: number): boolean {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const l = dist(a, b);
  if (l < 1e-9) return false;
  return pts.every((q) => Math.abs((b[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (b[1] - a[1])) / l <= tol);
}

function simplifyPath(p: Path, tol: number): Path {
  const n = p.nodes.length;
  if (n < 3 || segments(p) < 2) return p;
  // Runs between corners are fitted as one; a round loop is cut in two to have ends to fit between.
  let breaks = p.nodes.flatMap((nd, i) => (nd.smooth ? [] : [i]));
  if (!p.closed) breaks = [...new Set([0, ...breaks, n - 1])];
  else if (breaks.length === 0) breaks = [0, Math.floor(n / 2)];
  else if (breaks.length === 1) breaks = [breaks[0], (breaks[0] + Math.floor(n / 2)) % n].sort((a, b) => a - b);
  const runs = p.closed ? breaks.length : breaks.length - 1;
  const nodes: Node[] = [];
  for (let r = 0; r < runs; r++) {
    const s = breaks[r];
    const e = breaks[(r + 1) % breaks.length];
    const pts = sample(p, s, e);
    const curves: [Pt, Pt, Pt, Pt][] = straight(pts, tol)
      ? [[pts[0], pts[0], pts[pts.length - 1], pts[pts.length - 1]]]
      : fitCubic(pts, unit(pts[0], pts[1]), unit(pts[pts.length - 1], pts[pts.length - 2]), tol);
    for (const [p0, c1, c2, p3] of curves) {
      const last = nodes[nodes.length - 1];
      if (last && dist(last.p, p0) < 1e-9) last.b = c1;
      else nodes.push({ p: p0, a: p.closed || r ? p0 : p.nodes[0].a, b: c1, smooth: p.nodes[s].smooth });
      nodes.push({ p: p3, a: c2, b: p3, smooth: true });
    }
    nodes[nodes.length - 1].smooth = p.nodes[e].smooth;
  }
  if (p.closed) {
    // The last node is the first one again.
    const end = nodes.pop()!;
    nodes[0].a = end.a;
  } else nodes[nodes.length - 1].b = p.nodes[n - 1].b;
  return { closed: p.closed, nodes };
}
