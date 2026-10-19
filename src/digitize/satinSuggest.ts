import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import { regionIn, type Region } from './region';
import type { Cut, Rung } from './rungs';
import type { Rails, SatinSettings } from '../model/restitch';
import { flatPts } from './satin';
import type { Graph, Pt } from './skeleton';

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
 * - `parts`: any other area cut along its medial axis into arms, hubs and bends (a star too wide
 *   for the spikes planner, a block U, a ring, a blob with holes; see satinInner).
 * - `wide`: too wide or too blotchy for satin; nothing is suggested.
 *
 * Planned by the core (core/src/digitize/satin_suggest.rs), a whole area per call. The class of a
 * skeleton (classify, offersSections) is told here: it needs nothing but the graph at hand.
 */

export type ShapeClass = 'strokes' | 'dot' | 'pointed' | 'spikes' | 'frame' | 'leaf' | 'drop' | 'crescent' | 'parts' | 'wide';

export interface SatinSuggestion {
  kind: ShapeClass;
  cuts: [Pt, Pt][];
  lines: [Pt, Pt][];
  /** Whether the lines make columns of every part (else the tool shows which part fails). */
  ok: boolean;
}

/** Widest column the strokes planner makes (mm), as the image conversion's satin limit. */
const STROKE_MAX = 7;

const median = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};
const lengthOf = (pts: Pt[]) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : a), 0);
const segsFlat = (lines: [Pt, Pt][]): Float64Array => flatPts(lines.flat());

/** The outsides and holes of an area (tiny specks left out), as the satin tool reads them. */
export function areaLoops(area: Region): { outsides: Pt[][]; holes: Pt[][] } {
  const flat = core().areaLoops(area.sdfBase, area.x0, area.y0, area.w, area.h, area.pxMm);
  const outsides: Pt[][] = [];
  const holes: Pt[][] = [];
  const n = flat[0];
  for (let i = 1, k = 0; i < flat.length; k++) {
    const len = flat[i++];
    const line: Pt[] = new Array(len);
    for (let j = 0; j < len; j++, i += 2) line[j] = [flat[i], flat[i + 1]];
    (k < n ? outsides : holes).push(line);
  }
  return { outsides, holes };
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

/**
 * A suggestion for the fill area (null when the area is empty); `max` is the longest stitch of a
 * shape's columns (mm); `columns`: a compact shape as a column where one fits, not a fan;
 * `crossings`: a thick place where three lines meet planned as a shape too, not only a blot.
 * `graph`: the area's skeleton, when known.
 */
export function suggestSatin(area: Region, graph?: Graph, max = STROKE_MAX, columns = false, crossings = true): SatinSuggestion | null {
  return core().suggestSatin(regionIn(area), graph ?? null, max, columns, crossings) as SatinSuggestion | null;
}

/** Whether a column runs across a hole (its middle through the hole for 2 mm, not round it). */
export function covers(strips: { left: Pt[]; right: Pt[]; rungs: Rung[] }[], holes: Pt[][]): boolean {
  const h = flatLines(holes);
  return core().stripsCover(
    strips.map((s) => ({ left: s.left, right: s.right, rungs: s.rungs })),
    h.flat,
    h.lens,
  );
}

/**
 * The cut lines in an order that opens the holes one after another: a cut from the edge into a
 * hole first, then from that hole into the next (stripsOfOutline opens holes in the order given).
 */
export function bridgeOrder(cuts: [Pt, Pt][], outsides: Pt[][], holes: Pt[][]): [Pt, Pt][] {
  const o = flatLines(outsides);
  const h = flatLines(holes);
  return [...core().bridgeOrder(segsFlat(cuts), o.flat, o.lens, h.flat, h.lens)].map((k) => cuts[k]);
}

/** A column as withSplit reads it (see Rails in model/restitch). */
interface SplitColumn {
  left: Pt[];
  right: Pt[];
  split?: { outlines: Pt[][]; holes: Pt[][]; cuts: Cut[] };
}

/**
 * A satin that does not know how it was cut (see Rails.split), made from a fill or read from
 * stitches: the area from its shape, the cut lines where its columns end inside it (against another
 * column, not at the edge). So every satin opens in sections of its area, and the cut lines can always be moved, drawn or taken away again, and the columns made anew.
 * `part`: the part that is the area, else the first whose columns lie in it.
 */
export function withSplit<C extends SplitColumn>(columns: C[][], area: Region, part?: number): C[][] {
  if (columns.some((part) => part.some((r) => r.split))) return columns;
  const all = columns.flat();
  const l = flatLines(all.map((c) => c.left));
  const r = flatLines(all.map((c) => c.right));
  const parts = Uint32Array.from(columns, (pt) => pt.length);
  const s = core().splitOf(l.flat, l.lens, r.flat, r.lens, parts, area.sdfBase, area.x0, area.y0, area.w, area.h, area.pxMm, part ?? -1) as {
    part: number;
    outlines: Pt[][];
    holes: Pt[][];
    cuts: [Pt, Pt][];
  } | null;
  if (!s) return columns;
  const split = { outlines: s.outlines, holes: s.holes, cuts: s.cuts };
  return columns.map((pt, j) => (j === s.part ? pt.map((c, i) => (i ? c : { ...c, split })) : pt));
}

/**
 * A suggestion around cut lines drawn by hand: those stay; a suggested cut line that crosses one
 * or comes near it goes, as does a line across that crosses one. When the parts then make no
 * columns, the cut lines by hand alone with the lines across, if they do.
 */
export function aroundCuts(s: { lines: [Pt, Pt][]; cuts: [Pt, Pt][] }, own: Cut[], outsides: Pt[][], holes: Pt[][]): { lines: [Pt, Pt][]; cuts: Cut[]; ok: boolean } {
  const c = flatLines(own);
  const o = flatLines(outsides);
  const h = flatLines(holes);
  return core().aroundCuts(segsFlat(s.lines), segsFlat(s.cuts), c.flat, c.lens, o.flat, o.lens, h.flat, h.lens) as { lines: [Pt, Pt][]; cuts: Cut[]; ok: boolean };
}

/** What the core makes of an area along lines and cut lines (see satin_suggest::Along). */
type Along = { columns: { columns: Rails[]; outsides: Pt[][]; holes: Pt[][] } } | { hole: Pt[] } | { bad: Pt[] } | 'notStrip' | null;

/**
 * The columns a fill makes along lines across it and cut lines (see stripsOfAreas): parts cut
 * apart each a column, sewn on one into the next; areas apart each a chain of their own. Or what
 * stops it: a hole no cut line opens, a part no line crosses, lines that make no strip.
 */
export function columnsAlong(area: Region, lines: [Pt, Pt][], cuts: Cut[]): { columns: Rails[] } | { hole: Pt[] } | { bad: Pt[] } | { notStrip: true } | null {
  const c = flatLines(cuts);
  const made = core().columnsAlong(area.sdfBase, area.x0, area.y0, area.w, area.h, area.pxMm, segsFlat(lines), c.flat, c.lens) as Along;
  if (!made) return null;
  if (made === 'notStrip') return { notStrip: true };
  if (!('columns' in made)) return made;
  const { columns, outsides, holes } = made.columns;
  // The fill and its cut lines kept: the cut lines can be moved later (see Rails.split).
  columns[0].split = { outlines: outsides, holes, cuts: cuts.map((c) => c.map((p) => [p[0], p[1]] as Pt)) };
  return { columns };
}

/**
 * The columns "Vorschlagen" makes of an area for a satin with these settings (lines across, cut
 * where it branches), each chain in the order that hides the ways between its parts best (see
 * inChainOrder in model/reshape), the fill and its cut lines kept on the first; null when none fit.
 */
export function suggestedColumns(area: Region, satin: SatinSettings): Rails[] | null {
  const made = core().suggestedColumns(regionIn(area), satin) as { columns: Rails[]; outlines: Pt[][]; holes: Pt[][]; cuts: [Pt, Pt][] } | null;
  if (!made) return null;
  const { columns, outlines, holes, cuts } = made;
  if (columns.length) columns[0].split = { outlines, holes, cuts };
  return columns;
}
