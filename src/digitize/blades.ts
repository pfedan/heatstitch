import { distanceInside, distanceToSeeds } from '../image/edt';
import { peakDensity } from './measure';
import { sample, signedField, type Region } from './region';
import { runStitch } from './run';
import { column, pairs, satinStitches, underlay, type Column, type SatinParams } from './satin';
import { polylineLength, reverse, type Branch, type Graph, type Pt } from './skeleton';

/**
 * Blades on a body: grass tufts, leaves on a stalk, flames. Their skeleton has long, narrow
 * branches (the blades) and short, wide ones where the blades meet (the body). As one satin
 * network the body's columns fan out from the junctions and cross each other, with fabric showing
 * between them; as one fill, the narrow blades get short, ragged rows. So the blades become satin
 * columns (underlay out to the tip, satin back), and the body a fill sewn after them: its rows lie
 * over the blades' starts and over the thread that runs from one blade to the next.
 */

export interface Blades {
  /** The body, filled after the blades: the region without them, reaching a little over their starts. */
  core: Region;
  /** Satin columns from the body out (oriented from their junction to the far end). */
  columns: Column[];
  /**
   * Row angle for the body (degrees): the direction of the blades' stitches where they start, so
   * the body's rows carry on the satin's sheen instead of standing against it.
   */
  angle: number;
}

/** A branch is a stroke (a blade) when it is this many times longer than wide. */
const STROKE = 1.5;
/** A blade ends at most this share of its widest part wide. */
const TAPER = 0.5;
/** Centerline points are 0.1 mm apart: a bend is measured over 0.5 mm on either side. */
const BEND_STEP = 5;
/** A blade starts after the last bend sharper than this (degrees over 1 mm). */
const BEND = 15;
/** The body reaches this far over the blades (mm), so no fabric shows where they start. */
const UNDER = 0.5;
/** Blades must make up this share of the region, so a blob with a few thin arms stays one fill. */
const BLADE_SHARE = 0.25;
/** Slivers of the body narrower than twice this along the blades' edges are left out (mm). */
const CLEAN = 0.3;
/** Smallest body (mm²); a smaller one is left to the satin network. */
const MIN_CORE_MM2 = 2;
/** Blades denser than this many times their nominal density somewhere are not used. */
const PEAK = 2.4;

/**
 * Splits a region into a body and satin blades, or null when it is no such shape: it needs at
 * least one junction and at least one blade. A network of strokes alone (a letter) stays a satin
 * network unless `networkOk` says that would pile up or leave fabric bare.
 */
export function splitBlades(
  r: Region,
  g: Graph,
  kind: 'fill' | 'satin',
  o: { satinMax: number; satinMin: number; overlap: number },
  satin: SatinParams,
  networkOk: () => boolean,
): Blades | null {
  const { satinMax, satinMin, overlap } = o;
  const degree = new Array(g.nodes.length).fill(0);
  for (const b of g.branches) {
    degree[b.a]++;
    degree[b.b]++;
  }
  if (!degree.some((d) => d >= 3)) return null;
  const strokes: Column[] = [];
  let stubs = 0;
  for (const b of g.branches) {
    if (b.a === b.b) return null;
    // Only branches with a free end are blades; between junctions is body (or a network of
    // strokes, which needs no body).
    if (degree[b.a] !== 1 && degree[b.b] !== 1) {
      stubs++;
      continue;
    }
    // From the junction out.
    const dir = degree[b.a] === 1 ? reverse(b) : b;
    // The blade starts where it leaves its junction (the inscribed circle there belongs to the
    // body): from inside it, the rungs would fan out over the body.
    const part = clip(dir, g.nodes[dir.a].p, g.nodes[dir.a].r);
    if (!part) {
      stubs++;
      continue;
    }
    const c = column(r, part, false, true);
    if (isBlade(c, satinMax, satinMin)) strokes.push(c);
    else stubs++;
  }
  // A network of strokes alone (a letter) is sewn as a satin network, as long as that works.
  if (!strokes.length || (!stubs && kind === 'satin' && networkOk())) return null;

  // The blades' area, each from UNDER past its start on, so the body reaches over it.
  const blade = new Uint8Array(r.mask.length);
  for (const c of strokes) paint(r, blade, bladeOutline(c, UNDER));
  let inBlades = 0;
  let total = 0;
  const coreMask = new Uint8Array(r.mask.length);
  for (let i = 0; i < r.mask.length; i++) {
    if (!r.mask[i]) continue;
    total++;
    if (blade[i]) inBlades++;
    else coreMask[i] = 1;
  }
  open(coreMask, r.w, r.h, Math.round(CLEAN / r.pxMm));
  let kept = 0;
  for (const m of coreMask) kept += m;
  const coreMm2 = kept * r.pxMm * r.pxMm;
  if (inBlades < BLADE_SHARE * total || coreMm2 < MIN_CORE_MM2) return null;

  const sats = strokes.map((c) => sewBlade(c, satin, false, 0.15));
  if (peakDensity(sats) > (PEAK * 2) / satin.spacing) return null;

  // The body's own edge, grown into later colors as the region is (its field), and by the
  // overlap onto the blades.
  const base = signedField(coreMask, r.w, r.h, r.pxMm);
  const sdf = base.map((v, i) => Math.max(r.sdf[i], v - overlap));
  const core: Region = { ...r, mask: coreMask, inside: distanceInside(coreMask, r.w, r.h), sdf, sdfBase: base, areaMm2: coreMm2 };
  return { core, columns: strokes, angle: stitchAngle(strokes) };
}

/**
 * A blade: long against its width, no wider than a satin may be, and tapering towards its end
 * (a grass blade, a leaf, a flame); a thread-thin tail counts too. The end of a long band, which
 * keeps its width, does not: it stays in the body's fill.
 */
function isBlade(c: Column, satinMax: number, satinMin: number): boolean {
  const w = c.left.map((p, i) => Math.hypot(p[0] - c.right[i][0], p[1] - c.right[i][1]));
  const at = (f: number) => w[Math.min(w.length - 1, Math.floor(f * w.length))];
  const sorted = w.slice().sort((x, y) => x - y);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0;
  if (polylineLength(c.center) < STROKE * c.width || p95 > satinMax) return false;
  return c.width < satinMin || at(0.9) <= TAPER * Math.max(at(0.1), at(0.3), at(0.5));
}

/** Mean direction of the columns' first stitches, as doubled angles weighted by width (degrees). */
function stitchAngle(cs: Column[]): number {
  let x = 0;
  let y = 0;
  for (const c of cs) {
    const i = Math.min(c.center.length - 1, 5);
    const dx = c.right[i][0] - c.left[i][0];
    const dy = c.right[i][1] - c.left[i][1];
    const a = 2 * Math.atan2(dy, dx);
    const w = Math.hypot(dx, dy);
    x += w * Math.cos(a);
    y += w * Math.sin(a);
  }
  return Math.round(((Math.atan2(y, x) / 2) * 180) / Math.PI);
}

/**
 * The blade part of a branch from its junction out: past the junction's inscribed circle (`ra`
 * around `pa`) and past the last sharp bend (where the branch turns from along the body into the
 * blade). Null when too little is left.
 */
function clip(b: Branch, pa: Pt, ra: number): Branch | null {
  const n = b.pts.length;
  let i = 0;
  while (i < n && dist(b.pts[i], pa) < ra) i++;
  for (let k = n - 1 - BEND_STEP; k >= i + BEND_STEP; k--) {
    if (turn(b.pts, k) > BEND) {
      i = k;
      break;
    }
  }
  if (n - i < 4) return null;
  return { ...b, pts: b.pts.slice(i), r: b.r.slice(i) };
}

/** Turn of the centerline at point k between the points BEND_STEP before and after (degrees). */
function turn(pts: Pt[], k: number): number {
  const a = pts[k - BEND_STEP];
  const m = pts[k];
  const c = pts[k + BEND_STEP];
  const d = Math.atan2(c[1] - m[1], c[0] - m[0]) - Math.atan2(m[1] - a[1], m[0] - a[0]);
  return Math.abs(((((d * 180) / Math.PI + 540) % 360) - 180));
}

/** Outline of a column from `skip` mm along its centerline on. */
function bladeOutline(c: Column, skip: number): Pt[] {
  let s = 0;
  let k = 0;
  while (k < c.center.length - 1 && s < skip) {
    s += Math.hypot(c.center[k + 1][0] - c.center[k][0], c.center[k + 1][1] - c.center[k][1]);
    k++;
  }
  return [...c.left.slice(k), ...c.right.slice(k).reverse()];
}

/** Morphological opening of a mask by a disc of radius k pixels, in place: thin slivers go. */
function open(mask: Uint8Array, w: number, h: number, k: number): void {
  if (k < 1) return;
  const din = distanceInside(mask, w, h);
  const seeds = Uint8Array.from(din, (d) => (d > k ? 1 : 0));
  const dout = distanceToSeeds(seeds, w, h);
  for (let i = 0; i < mask.length; i++) if (mask[i] && !seeds[i] && dout[i] > k) mask[i] = 0;
}

/** Marks the window pixels whose centers lie inside the polygon (even-odd). */
function paint(r: Region, out: Uint8Array, poly: Pt[]): void {
  if (poly.length < 3) return;
  for (let y = 0; y < r.h; y++) {
    const py = (y + r.y0 + 0.5) * r.pxMm;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      if (ay <= py === by <= py) continue;
      xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] / r.pxMm - 0.5 - r.x0));
      const to = Math.min(r.w - 1, Math.floor(xs[k + 1] / r.pxMm - 0.5 - r.x0));
      for (let x = from; x <= to; x++) out[y * r.w + x] = 1;
    }
  }
}

/** One blade: underlay out to the tip, satin back to the body. */
function sewBlade(c: Column, p: SatinParams, withUnderlay: boolean, tol: number): Pt[] {
  const rev: Column = { center: c.center.slice().reverse(), left: c.right.slice().reverse(), right: c.left.slice().reverse(), width: c.width };
  const out = withUnderlay ? underlay(c, tol) : runStitch(c.center, 2.5, tol);
  return [...out, ...satinStitches(pairs(rev, p), p)];
}

/**
 * The blades in one go from `start`: nearest first, each one out and back. Between blades the
 * thread runs straight across the body where it can (the body's fill covers it afterwards), else
 * the run breaks for a jump.
 */
export function sewBlades(b: Blades, start: Pt, p: SatinParams, withUnderlay: boolean, tol: number): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  let pos = start;
  const todo = b.columns.slice();
  while (todo.length) {
    let bi = 0;
    todo.forEach((c, i) => {
      if (dist(c.center[0], pos) < dist(todo[bi].center[0], pos)) bi = i;
    });
    const c = todo.splice(bi, 1)[0];
    const from = c.center[0];
    if (run.length && inside(b.core, pos, from)) run.push(...runStitch([pos, from], 2.5, tol).slice(1));
    else if (run.length) {
      runs.push(run);
      run = [];
    }
    for (const q of sewBlade(c, p, withUnderlay, tol)) if (!run.length || dist(run[run.length - 1], q) > 0.05) run.push(q);
    pos = run[run.length - 1];
  }
  if (run.length) runs.push(run);
  return runs;
}

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** The straight line from a to b stays inside the region. */
function inside(r: Region, a: Pt, b: Pt): boolean {
  const n = Math.max(1, Math.ceil(dist(a, b) / (r.pxMm / 2)));
  for (let k = 0; k <= n; k++) if (sample(r, r.sdf, a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n) > 0) return false;
  return true;
}
