import type { Pt } from '../digitize/skeleton';
import { flatten, type Form, type Path } from '../shape/path';
import { bandForm, offsetForm } from '../shape/ops';
import { addLine } from './addShape';
import { guessArea, guessLine, geoUse, lineGeoOf, sewnAlong } from './geo';
import { lineSettings, lineStitchFor } from './line';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import { STITCH, type Pattern } from './pattern';
import { borderOf, keepShape, remembered } from './restitch';
import { stitchKinds } from './sequence';
import { stitchesBefore } from './transform';
import { reorder } from './order';
import type { PathStitch } from './along';

/**
 * "Kontur drumherum": a line around objects at a distance, as an object of its own (proposal
 * "Vektorwerkzeuge" 3.3). What it goes round is what the objects cover as curves (areas, lines with
 * the width they are sewn in, satins between their rails); the contour is that grown by the distance
 * (Clipper2, curves fitted again, see offsetForm). Afterwards it is a line like any other.
 */

/** Distance a new contour gets (mm). */
export const CONTOUR_GAP = 2;
/** Width a running or triple stitch covers (mm): about its thread. */
export const THREAD_MM = 0.4;
/** Distances the field and the grip allow (mm). */
export const GAP_MIN = -20;
export const GAP_MAX = 50;

/** Width across a line sewn with `st` (mm): what lies on the fabric, centered on the line. */
function lineWidth(st: PathStitch): number {
  const pull = st.type === 'satin' ? 2 * (st.pull ?? 0) : 0;
  switch (st.type) {
    case 'satin':
    case 'zigzag':
    case 'motif':
      return Math.max(THREAD_MM, st.width + pull);
    // An E stitch reaches out to one side only: the band on both sides covers it either way.
    case 'e':
      return Math.max(THREAD_MM, 2 * st.width);
    default:
      return THREAD_MM;
  }
}

/** The columns of a satin as closed rings, all one way round (they add up where they overlap). */
function columnRings(p: Pattern, o: SewObject, kinds: Uint8Array): Form | null {
  const cols = keepShape(p, o, kinds).columns?.flat() ?? [];
  const paths: Path[] = [];
  for (const c of cols) {
    if (c.left.length < 2 || c.right.length < 2) continue;
    const ring: Pt[] = [...c.left, ...c.right.slice().reverse()];
    let twice = 0;
    for (let i = 0; i < ring.length; i++) twice += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1];
    const pts = twice < 0 ? ring.reverse() : ring;
    paths.push({ closed: true, nodes: pts.map((q) => ({ p: q, a: q, b: q, smooth: false })) });
  }
  return paths.length ? { paths, nonzero: true } : null;
}

/**
 * What object `o` covers on the fabric, as curves: its area (with a satin border around it), the
 * band of a line in the width it is sewn, else the columns of a satin. Null when none is known.
 */
export function coverForm(p: Pattern, o: SewObject, kinds: Uint8Array): Form | null {
  const m = remembered(p, o);
  if (sewnAlong(p, o)) {
    const line = guessLine(p, o, kinds);
    return line && bandForm(line, lineWidth(lineSettings(p, o, kinds)), false);
  }
  if (geoUse(m) === 'band') return bandForm(m!.geo!, m!.fill!.lineWidth!, false);
  const area = guessArea(p, o, kinds);
  if (area) {
    // A border sewn with the fill reaches out by its offset and half its width.
    const b = borderOf(m);
    const reach = b ? (b.offset ?? 0) + lineWidth(b) / 2 : 0;
    return reach > 0.001 ? offsetForm(area, reach, 0, false) : area;
  }
  return columnRings(p, o, kinds);
}

/** What the objects `which` cover together, as one form; `missing` counts those with nothing known. */
export function contourSource(p: Pattern, which: number[], kinds = stitchKinds(p)): { source: Form; missing: number } | null {
  const objs = sewObjects(p, kinds);
  const forms: Form[] = [];
  let missing = 0;
  for (const i of which) {
    const f = objs[i] && coverForm(p, objs[i], kinds);
    if (f?.paths.length) forms.push(f);
    else missing++;
  }
  if (!forms.length) return null;
  // Each settled on its own first (a satin's rings add up, an area's holes stay by its own rule),
  // then all joined. Kept as polygons: only the contour is fitted, so its error is that one fit's.
  const settled = forms.map((f) => offsetForm(f, 0, 0, false)).filter((f): f is Form => !!f);
  const source = offsetForm({ paths: settled.flatMap((f) => f.paths), nonzero: true }, 0, 0, false);
  return source ? { source, missing } : null;
}

/** Holes of a contour smaller than this are left out (mm²): gaps between objects, too small to sew round. */
export const MIN_HOLE = 10;

/** Twice the signed area of a path, as flattened. */
function twiceArea(path: Path): number {
  const pts = flatten(path, 0.1);
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
  return a;
}

/**
 * The contour `d` mm outside `source` (inside when negative); null when nothing is left. Its holes
 * (inside a ring, the counter of an O) stay, but not small ones where objects nearly meet.
 */
export function contourAt(source: Form, d: number): Form | null {
  const f = offsetForm(source, d);
  if (!f) return null;
  const areas = f.paths.map(twiceArea);
  // Clipper turns all outlines one way and all holes the other: the largest is an outline.
  const big = areas.reduce((k, a, i) => (Math.abs(a) > Math.abs(areas[k]) ? i : k), 0);
  const outer = Math.sign(areas[big]);
  const paths = f.paths.filter((_, i) => Math.sign(areas[i]) === outer || Math.abs(areas[i]) / 2 >= MIN_HOLE);
  return { ...f, paths };
}

export interface Contoured {
  pattern: Pattern;
  /** The new contour. */
  index: number;
  source: Form;
  /** Objects with nothing known to go round. */
  missing: number;
}

/**
 * A contour `d` mm around the objects `which` (one for all of them), sewn as running stitch in the
 * thread of the first, right after the last of them. Null when there is nothing to go round, or
 * nothing left at that distance. Needs `loadOps()`.
 */
export function addContour(p: Pattern, which: number[], d: number, options: { trimMm: number; tolerance?: number }): Contoured | null {
  const sel = [...new Set(which)].sort((a, b) => a - b);
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  if (!sel.length || sel.some((o) => !objs[o])) return null;
  const s = contourSource(p, sel, kinds);
  const form = s && contourAt(s.source, d);
  if (!s || !form) return null;
  const r = addLine(p, form, lineStitchFor(0, options.tolerance), objs[sel[0]].color, sel[sel.length - 1], options);
  if (!r) return null;
  const index = sewObjects(r.pattern).findIndex((o) => stitchesBefore(r.pattern, o.first) === r.start);
  return index < 0 ? null : { pattern: r.pattern, index, source: s.source, missing: s.missing };
}

/**
 * How far a point lies outside `source` (mm; negative inside): its distance to the nearest edge,
 * signed by whether the form encloses it. What the grip of a contour reads. The form is flattened
 * once, for many points.
 */
export function gapReader(source: Form): (q: Pt) => number {
  const ways = source.paths.map((path) => ({ closed: path.closed, pts: flatten(path, 0.02) })).filter((w) => w.pts.length > 1);
  return (q) => {
    let best = Infinity;
    let winding = 0;
    let crossings = 0;
    for (const { closed, pts } of ways) {
      const n = pts.length;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
        best = Math.min(best, Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy));
        if (!closed) continue;
        // Ray to the right: crossings (even-odd) and their sense (nonzero).
        if (a[1] <= q[1] !== b[1] <= q[1]) {
          const x = a[0] + ((q[1] - a[1]) / dy) * dx;
          if (x > q[0]) {
            crossings++;
            winding += dy > 0 ? 1 : -1;
          }
        }
      }
    }
    const inside = source.nonzero ? winding !== 0 : crossings % 2 === 1;
    return inside ? -best : best;
  };
}

/** How far point `q` lies outside `source` (see gapReader), for one point. */
export const gapAt = (source: Form, q: Pt): number => gapReader(source)(q);

/** Stitches of an object looked at, at most, to tell whether an area covers it. */
const SAMPLE = 200;

/** Whether the closed paths of `area` enclose every stitch of `o`. */
function encloses(p: Pattern, area: Form, o: SewObject): boolean {
  const at: number[] = [];
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) at.push(i);
  if (!at.length) return false;
  const gap = gapReader(area);
  const step = Math.max(1, Math.ceil(at.length / SAMPLE));
  for (let k = 0; k < at.length; k += step) if (gap([p.x[at[k]] / 10, p.y[at[k]] / 10]) > 0) return false;
  return gap([p.x[at[at.length - 1]] / 10, p.y[at[at.length - 1]] / 10]) <= 0;
}

/**
 * Line `index` moved before the objects sewn earlier that its closed paths enclose completely, so
 * that once it is a fill it lies under them instead of covering them (a contour filled as the
 * ground of a patch). Null when it encloses none of them. Its id stays; `covered` counts them.
 */
export function behindCovered(p: Pattern, index: number, trimMm: number): { pattern: Pattern; index: number; covered: number } | null {
  const objs = sewObjects(p);
  const o = objs[index];
  const geo = o && lineGeoOf(remembered(p, o));
  const area = geo && { paths: geo.paths.filter((x) => x.closed && x.nodes.length > 2) };
  if (!area?.paths.length) return null;
  const covered = objs.slice(0, index).filter((x) => encloses(p, area, x));
  if (!covered.length) return null;
  const order = objs.map((x) => x.index).filter((i) => i !== index);
  order.splice(covered[0].index, 0, index);
  const starts: number[] = [];
  const next = reorder(p, objs, order, trimMm, starts, { whole: true });
  if (next === p) return null;
  rememberObjects(next, starts);
  const at = sewObjects(next).findIndex((x) => x.id === o.id);
  return at < 0 ? null : { pattern: next, index: at, covered: covered.length };
}
