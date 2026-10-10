import type { Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { FABRICS, type FabricId } from '../material/fabrics';
import { segment, segments, type Form } from '../shape/path';
import { FIT_TOLERANCE, vectorize } from '../shape/vectorize';
import { borderStitches, type PathStitch } from './along';
import { tableOf } from './objects';
import { blockIndex } from './sequence';
import { COLOR_CHANGE, type Pattern, type ThreadColor } from './pattern';

/**
 * Appliqué as one object: a piece of fabric sewn on instead of a fill. The machine sews it in three
 * parts with a stop between them, all in one thread (a stop in the same color, see blockKeys):
 *
 * 1. the placement line, a running stitch on the outline, then a stop: the fabric is laid on;
 * 2. the tack-down line, a running stitch a little inside the outline, then a stop: the fabric
 *    sticking out is cut off close to it;
 * 3. the cover edge over the cut edge: a satin centered on the outline, or an E stitch with its
 *    edge on the outline and its prongs inward.
 *
 * This is how digitizing software builds appliqué (Bernina/Wilcom: placement line, tack-down,
 * cover stitch; buttery-stitches, MIT, sews the same three passes with the tack-down on the
 * placement line). The tack-down lies a little inside here, as the cover then hides it and the cut
 * edge with room to spare: Bernina's help keeps tack-down narrower than the cover, ABdigitizing
 * trims within 1 mm of the tack-down and covers with a 3.5 to 4.5 mm satin.
 *
 * In an embroidery file only the stitches and the stops are left; the fabric, its kind and color
 * are kept in the project file (Remembered.applique).
 */

/** Fabrics a piece can be cut from: the grounds of the material, and felt (see FabricLook). */
export type AppliqueFabric = FabricId | 'felt';

export interface AppliqueSettings {
  /** The cover edge: a satin over the cut edge, or an E stitch (blanket stitch) along it. */
  edge: 'satin' | 'e';
  /** Width of the cover edge (mm). */
  width: number;
  /** The fabric laid on, and its color. */
  fabric: AppliqueFabric;
  color: ThreadColor;
}

/** Fabrics offered for a piece, in the order the picker lists them (a cap is no fabric to cut). */
export const APPLIQUE_FABRICS: readonly AppliqueFabric[] = ['woven', 'felt', 'woven_heavy', 'knit', 'fleece', 'terry', 'light', 'sheer', 'leather'];

/** A satin edge 3 mm wide: in the 2.5 to 4 mm digitizing guides give for appliqué cover. */
export const APPLIQUE_WIDTH = 3;
export const APPLIQUE_WIDTHS: [number, number] = [1.5, 6];
/** Stitch length of placement and tack-down (mm): long enough to sew fast, short enough to follow curves. */
export const PLACE_STITCH = 2.5;
export const TACK_STITCH = 2;

/**
 * How far the tack-down lies inside the outline (mm): under the cover with room to spare on both
 * sides, 0.3 of its width, between 0.5 and 1 mm (the fabric is cut close outside it).
 */
export const tackInset = (width: number): number => Math.min(1, Math.max(0.5, width * 0.3));

/** An appliqué of `color` as a new one is: cotton in the thread's color, a satin edge. */
export const appliqueDefaults = (color: ThreadColor): AppliqueSettings => ({ edge: 'satin', width: APPLIQUE_WIDTH, fabric: 'woven', color: { r: color.r, g: color.g, b: color.b } });

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Settings as stored, back; null when they do not hold. */
export function appliqueFrom(v: unknown): AppliqueSettings | null {
  const s = v as AppliqueSettings | null;
  if (!s || typeof s !== 'object') return null;
  if (s.edge !== 'satin' && s.edge !== 'e') return null;
  if (!finite(s.width) || s.width <= 0) return null;
  if (s.fabric !== 'felt' && !FABRICS.some((f) => f.id === s.fabric)) return null;
  const c = s.color;
  if (!c || ![c.r, c.g, c.b].every(finite)) return null;
  return { edge: s.edge, width: Math.min(APPLIQUE_WIDTHS[1], Math.max(APPLIQUE_WIDTHS[0], s.width)), fabric: s.fabric, color: { r: c.r, g: c.g, b: c.b } };
}

/** The settings as stored (a copy). */
export const storeApplique = (s: AppliqueSettings): AppliqueSettings => ({ ...s, color: { r: s.color.r, g: s.color.g, b: s.color.b } });

/** Runs the machine stops before (the fabric laid on, cut off): see objectRecords. */
export const stopBefore = new WeakSet<Pt[]>();

/** The stitches along each part, as sewn from where the thread is (`from`). */
export interface AppliqueParts {
  place: Pt[][];
  tack: Pt[][];
  cover: Pt[][];
}

/** The stitches of the three parts of an appliqué on `area` (see the top of this file). */
export function appliqueParts(area: Region, s: AppliqueSettings, from: Pt): AppliqueParts {
  const place = borderStitches(area, { type: 'run', width: 0, length: PLACE_STITCH }, from);
  const end = (runs: Pt[][], or: Pt) => runs[runs.length - 1]?.[runs[runs.length - 1].length - 1] ?? or;
  const tack = borderStitches(area, { type: 'run', width: 0, length: TACK_STITCH, offset: -tackInset(s.width) }, end(place, from));
  // A shape too thin for the tack-down inside: it is sewn on the outline, over the placement line.
  const held = tack.length ? tack : borderStitches(area, { type: 'run', width: 0, length: TACK_STITCH }, end(place, from));
  const edge: PathStitch = s.edge === 'e' ? { type: 'e', width: s.width } : { type: 'satin', width: s.width };
  const cover = borderStitches(area, edge, end(held, from));
  return { place, tack: held, cover };
}

/** The runs of an appliqué in sewing order, the machine stopping before the tack-down and the cover. */
export function appliqueRuns(area: Region, s: AppliqueSettings, from: Pt): Pt[][] {
  const { place, tack, cover } = appliqueParts(area, s, from);
  if (!place.length || !tack.length || !cover.length) return [];
  stopBefore.add(tack[0]);
  stopBefore.add(cover[0]);
  return [...place, ...tack, ...cover];
}

/** What a stop of the machine is for: laying the fabric on, or cutting it off. */
export type Stop = 'place' | 'trim';

/**
 * The stops inside appliqués of `p`, by the color block they open: the first of each appliqué is
 * for laying the fabric on, the second for cutting it.
 */
export function appliqueStops(p: Pattern): Map<number, Stop> {
  const out = new Map<number, Stop>();
  const entries = tableOf(p).entries.filter((e) => e.memory?.applique);
  if (!entries.length) return out;
  const blocks = blockIndex(p);
  for (const e of entries) {
    let n = 0;
    for (let i = e.first + 1; i < e.last; i++) if (p.cmd[i] === COLOR_CHANGE) out.set(blocks[i] + 1, n++ === 0 ? 'place' : 'trim');
  }
  return out;
}

/** Color blocks that go on an object begun in an earlier block (a stop inside an appliqué). */
export function innerStops(p: Pattern): Set<number> {
  return new Set(appliqueStops(p).keys());
}

/** The record of the stop before each part of the appliqué from record `first` to `last`: [laid on, cut off]. */
export function stopsIn(p: Pattern, first: number, last: number): number[] {
  const out: number[] = [];
  for (let i = first; i <= last; i++) if (p.cmd[i] === COLOR_CHANGE) out.push(i);
  return out;
}

/** The outline a piece is cut along: its form as drawn, else its area traced. */
export function cutForm(m: { geo?: Form; region: Region | null }): Form | null {
  if (m.geo?.paths.some((x) => x.closed)) return { ...m.geo, paths: m.geo.paths.filter((x) => x.closed) };
  if (!m.region) return null;
  const f = vectorize(m.region, FIT_TOLERANCE);
  return f.paths.length ? f : null;
}

const n2 = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * The cutting templates of the pieces `forms` as an SVG at true size (1 mm = 1 mm, for a cutting plotter or
 * to print and cut by hand): one closed path per piece, black hairline, no fill; laid at the origin
 * with a 2 mm margin so the plotter's software places them where it likes.
 */
export function cutLinesSvg(forms: Form[]): string | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of forms) {
    for (const p of f.paths) {
      for (let k = 0; k < segments(p); k++) {
        for (const q of segment(p, k)) {
          minX = Math.min(minX, q[0]);
          minY = Math.min(minY, q[1]);
          maxX = Math.max(maxX, q[0]);
          maxY = Math.max(maxY, q[1]);
        }
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  const M = 2;
  const w = maxX - minX + 2 * M;
  const h = maxY - minY + 2 * M;
  const at = (q: Pt) => `${n2(q[0] - minX + M)} ${n2(q[1] - minY + M)}`;
  const paths = forms.map((f) => {
    const d = f.paths
      .filter((p) => p.closed && p.nodes.length)
      .map((p) => {
        let s = `M${at(p.nodes[0].p)}`;
        for (let k = 0; k < segments(p); k++) {
          const [, b, c, e] = segment(p, k);
          s += `C${at(b)} ${at(c)} ${at(e)}`;
        }
        return `${s}Z`;
      })
      .join('');
    return `<path d="${d}" fill="none" stroke="#000" stroke-width="0.1" fill-rule="${f.nonzero ? 'nonzero' : 'evenodd'}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n2(w)}mm" height="${n2(h)}mm" viewBox="0 0 ${n2(w)} ${n2(h)}">\n${paths.join('\n')}\n</svg>\n`;
}

/** An appliqué's piece of fabric, for the view: its records, the stops it is laid on and cut at, its outline. */
export interface Piece {
  first: number;
  last: number;
  /** The stop to lay the fabric on, and the one to cut it off (records). */
  place: number;
  trim: number;
  /** The outline it is cut along (mm). */
  form: Form;
  fabric: AppliqueFabric;
  color: ThreadColor;
}

/** The pieces of fabric of the appliqués of `p`, in sewing order. */
export function appliquePieces(p: Pattern): Piece[] {
  const out: Piece[] = [];
  for (const e of tableOf(p).entries) {
    const m = e.memory;
    if (!m?.applique) continue;
    const stops = stopsIn(p, e.first, e.last);
    const form = cutForm(m);
    if (stops.length !== 2 || !form) continue;
    out.push({ first: e.first, last: e.last, place: stops[0], trim: stops[1], form, fabric: m.applique.fabric, color: m.applique.color });
  }
  return out;
}
