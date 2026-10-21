import type { Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { FABRICS, type FabricId } from '../material/fabrics';
import { segment, segments, type Form } from '../shape/path';
import { FIT_TOLERANCE, vectorize } from '../shape/vectorize';
import type { PathStitch } from './along';
import { tableOf } from './objects';
import { blockIndex } from './sequence';
import { COLOR_CHANGE, STITCH, type Pattern, type ThreadColor } from './pattern';

/**
 * Appliqué as one object: a piece of fabric sewn on instead of a fill. The machine sews it in three
 * parts with a stop between them, all in one thread (a stop in the same color, see blockKeys):
 *
 * 1. the placement line, a running stitch on the outline, then a stop: the fabric is laid on;
 * 2. the tack-down line, a running stitch a little inside the outline, then a stop: the fabric
 *    sticking out is cut off close to it;
 * 3. the cover edge over the cut edge: a satin centered on the outline, an E stitch with its
 *    edge on the outline and its prongs inward, or a running stitch over the tack-down (once, more
 *    often or as bean stitch, as a line's): a raw edge, for felt and fabrics that do not fray.
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
  /**
   * Whether the placement line is sewn (absent: it is). Without it the fabric is laid on before the
   * tack-down, cut to shape or a generous patch (on a backing a line is hard to place on, such as
   * water-soluble stabilizer): the machine stops before the appliqué for it.
   */
  place?: boolean;
  /** How far the placement line lies inside the outline (mm, APPLIQUE_INSETS; absent: on it). */
  placeIn?: number;
  /** How far the tack-down lies inside the outline (mm, APPLIQUE_INSETS; absent: as the edge asks, see tackInset). */
  tackIn?: number;
  /** The tack-down: a running stitch, its length, how often or as bean stitch (absent: once, TACK_STITCH long). */
  tack?: PathStitch;
  /**
   * The cover edge: a satin over the cut edge, an E stitch (blanket stitch) along it, or none: a
   * raw edge, held by the tack-down alone (felt, fabrics that do not fray). Without one the machine
   * stops after the appliqué to cut the fabric.
   */
  edge: 'satin' | 'e' | 'none';
  /** Width of the cover edge (mm); kept while there is none, so it comes back. */
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
export const TACK_STITCH = 2;
/** How far the tack-down of a raw edge lies inside the cut edge (mm): it holds the edge without the needle tearing it. */
export const RAW_INSET = 1.5;

/** How far placement line and tack-down can be set inside the outline (mm). */
export const APPLIQUE_INSETS: [number, number] = [0, 5];

/**
 * How far the tack-down lies inside the outline (mm): as set, else as the edge asks. Under a cover:
 * hidden with room to spare on both sides, 0.3 of its width, between 0.5 and 1 mm (the fabric is
 * cut close outside it). A raw edge: RAW_INSET.
 */
export const tackInset = (s: Pick<AppliqueSettings, 'edge' | 'width' | 'tackIn'>): number =>
  s.tackIn ?? (s.edge === 'none' ? RAW_INSET : Math.min(1, Math.max(0.5, s.width * 0.3)));

/** How far the placement line lies inside the outline (mm): as set, else on it. */
export const placeInset = (s: Pick<AppliqueSettings, 'placeIn'>): number => s.placeIn ?? 0;

/** A tack-down as a new one is: once along, TACK_STITCH long. */
export const APPLIQUE_TACK: PathStitch = { type: 'run', width: 0, length: TACK_STITCH };

/** The running stitch of the tack-down, as sewn: a running or triple stitch along its line. */
export function tackOf(s: Pick<AppliqueSettings, 'tack'>): PathStitch {
  const r = s.tack ?? APPLIQUE_TACK;
  return { type: r.type === 'triple' ? 'triple' : 'run', width: 0, length: r.length ?? TACK_STITCH, ...(r.repeat ? { repeat: r.repeat } : {}) };
}

/** An appliqué of `color` as a new one is: cotton in the thread's color, placement line, a satin edge. */
export const appliqueDefaults = (color: ThreadColor): AppliqueSettings => ({ edge: 'satin', width: APPLIQUE_WIDTH, fabric: 'woven', color: { r: color.r, g: color.g, b: color.b } });

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A running stitch as stored, back (a running or triple stitch); null when it does not hold. */
function runFrom(v: unknown): PathStitch | null {
  const r = v as PathStitch | undefined;
  return r && typeof r === 'object' && (r.type === 'run' || r.type === 'triple') && finite(r.length ?? 1) && (r.length ?? 1) > 0 && finite(r.repeat ?? 1) ? tackOf({ tack: r }) : null;
}

/**
 * Settings as stored, back; null when they do not hold. A running edge over the tack-down (stored
 * before there was a raw edge) is a raw edge whose tack-down is sewn as that edge was.
 */
export function appliqueFrom(v: unknown): AppliqueSettings | null {
  const s = v as (Omit<AppliqueSettings, 'edge'> & { edge: AppliqueSettings['edge'] | 'run'; run?: unknown }) | null;
  if (!s || typeof s !== 'object') return null;
  if (s.edge !== 'satin' && s.edge !== 'e' && s.edge !== 'none' && s.edge !== 'run') return null;
  if (!finite(s.width) || s.width <= 0) return null;
  if (s.fabric !== 'felt' && !FABRICS.some((f) => f.id === s.fabric)) return null;
  const c = s.color;
  if (!c || ![c.r, c.g, c.b].every(finite)) return null;
  const tack = s.edge === 'run' ? (runFrom(s.run) ?? APPLIQUE_TACK) : runFrom(s.tack);
  const plain = tack && tack.type === 'run' && !tack.repeat && tack.length === TACK_STITCH;
  const inset = (v: unknown) => (finite(v) ? Math.min(APPLIQUE_INSETS[1], Math.max(APPLIQUE_INSETS[0], v)) : undefined);
  const [placeIn, tackIn] = [inset(s.placeIn), inset(s.tackIn)];
  return {
    ...(s.place === false ? { place: false } : {}),
    ...(placeIn !== undefined ? { placeIn } : {}),
    ...(tackIn !== undefined ? { tackIn } : {}),
    ...(tack && !plain ? { tack } : {}),
    edge: s.edge === 'run' ? 'none' : s.edge,
    width: Math.min(APPLIQUE_WIDTHS[1], Math.max(APPLIQUE_WIDTHS[0], s.width)),
    fabric: s.fabric,
    color: { r: c.r, g: c.g, b: c.b },
  };
}

/**
 * The settings as stored (a copy), as appliqueFrom reads them back from the project file, so a
 * design is the same after save and open.
 */
export const storeApplique = (s: AppliqueSettings): AppliqueSettings => appliqueFrom(s)!;

/** How many stops lie inside an appliqué sewn with `s`: after the placement line, and before the cover (core/src/model/applique.rs). */
export const innerStopCount = (s: AppliqueSettings): number => (s.place === false ? 0 : 1) + (s.edge === 'none' ? 0 : 1);

/** Runs the machine stops before (the fabric laid on, cut off): see objectRecords. */
export const stopBefore = new WeakSet<Pt[]>();

/**
 * The stops an appliqué sewn with `s` needs between it and its neighbours in the same thread: one
 * before it to lay the fabric on (no placement line), one after it to cut the fabric off a raw
 * edge (no cover).
 */
export function stopsAround(s: AppliqueSettings | undefined): { before: boolean; after: boolean } {
  return { before: !!s && s.place === false, after: !!s && s.edge === 'none' };
}

/** What a stop of the machine is for: laying the fabric on (over its placement line, or before an appliqué without one), or cutting it off. */
export type Stop = 'place' | 'lay' | 'trim';

/**
 * The stops of appliqués of `p`, by the color block they open: inside each, the first for laying
 * the fabric on, the next for cutting it; between it and its neighbours in the same thread, the
 * one before the fabric is laid on without a placement line, and the one after a raw edge to cut it (stopsAround).
 * A change of thread there is a stop too, but no block of the appliqué's.
 */
export function appliqueStops(p: Pattern): Map<number, Stop> {
  const out = new Map<number, Stop>();
  const entries = tableOf(p).entries.filter((e) => e.memory?.applique);
  if (!entries.length) return out;
  const blocks = blockIndex(p);
  /** The block a stop at record `i` opens, when it is one in the same thread. */
  const sameThread = (i: number) => {
    const b = blocks[i] + 1;
    const [c, d] = [p.colors[b], p.colors[b - 1]];
    return c && d && c.r === d.r && c.g === d.g && c.b === d.b && c.name === d.name ? b : -1;
  };
  for (const e of entries) {
    const s = e.memory!.applique!;
    let n = 0;
    for (let i = e.first + 1; i < e.last; i++) if (p.cmd[i] === COLOR_CHANGE) out.set(blocks[i] + 1, n++ === 0 && s.place !== false ? 'place' : 'trim');
    const around = stopsAround(s);
    if (around.before) {
      let i = e.first - 1;
      while (i >= 0 && p.cmd[i] !== STITCH && p.cmd[i] !== COLOR_CHANGE) i--;
      const b = i >= 0 && p.cmd[i] === COLOR_CHANGE ? sameThread(i) : -1;
      if (b > 0) out.set(b, 'lay');
    }
    if (around.after) {
      let i = e.last + 1;
      while (i < p.cmd.length && p.cmd[i] !== STITCH && p.cmd[i] !== COLOR_CHANGE) i++;
      const b = i < p.cmd.length && p.cmd[i] === COLOR_CHANGE ? sameThread(i) : -1;
      if (b > 0) out.set(b, 'trim');
    }
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
    const s = m.applique;
    const stops = stopsIn(p, e.first, e.last);
    const form = cutForm(m);
    if (!form || stops.length !== innerStopCount(s) + (s.edge === 'none' && stops.length === 2 ? 1 : 0)) continue;
    // Without a placement line the fabric is laid on before the appliqué (at the stop there, if it has one).
    let before = e.first - 1;
    while (before > 0 && p.cmd[before] !== STITCH && p.cmd[before] !== COLOR_CHANGE) before--;
    const place = s.place === false ? Math.max(0, p.cmd[before] === COLOR_CHANGE ? before : e.first - 1) : stops[0];
    // A raw edge is cut after its tack-down (at the stop there, if it has one).
    let after = e.last + 1;
    while (after < p.cmd.length - 1 && p.cmd[after] !== STITCH && p.cmd[after] !== COLOR_CHANGE) after++;
    const trim = s.edge !== 'none' || stops.length === 2 ? stops[stops.length - 1] : p.cmd[after] === COLOR_CHANGE ? after : e.last;
    out.push({ first: e.first, last: e.last, place, trim, form, fabric: s.fabric, color: s.color });
  }
  return out;
}
