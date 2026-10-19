import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import { flatPts } from './satin';
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
 *
 * Planned by the core (core/src/digitize/satin_forms.rs), a whole area per call.
 */

export type FormKind = 'spikes' | 'frame';

/**
 * The cut lines at the corners of an area: spikes cut off at their bases, bands cut on the miter
 * where they turn a corner. `max` is the widest column (mm); `material` the area's (see materialOf),
 * the core makes its own from the outlines.
 */
export function cornerCuts(outsides: Pt[][], holes: Pt[][], _material: (q: Pt) => boolean, max: number): { cuts: [Pt, Pt][]; spikes: number; miters: number; tips: Pt[][] } {
  const o = flatLines(outsides);
  const h = flatLines(holes);
  return core().formCornerCuts(o.flat, o.lens, h.flat, h.lens, max) as { cuts: [Pt, Pt][]; spikes: number; miters: number; tips: Pt[][] };
}

type Strokes = (part: Graph, rings: Pt[][]) => { cuts: [Pt, Pt][]; lines: [Pt, Pt][] };

/** What the core plans for a part: lines across, or a curved stroke for `strokes` (planStrokes). */
type PartPlan = { cuts: [Pt, Pt][]; lines: [Pt, Pt][] } | { graph: Graph; ring: Pt[] };

/**
 * Lines across for each part the cut lines leave: a column along it where it is long (by the
 * area's centerline `g` within it), else as a compact shape. Null when a part fits neither.
 */
export function planParts(outsides: Pt[][], holes: Pt[][], cuts: [Pt, Pt][], tips: Pt[][], g: Graph, max: number, strokes: Strokes): { cuts: [Pt, Pt][]; lines: [Pt, Pt][] } | null {
  const o = flatLines(outsides);
  const h = flatLines(holes);
  const t = flatLines(tips);
  const plans = core().planParts(o.flat, o.lens, h.flat, h.lens, flatPts(cuts.flat()), t.flat, t.lens, g, max) as PartPlan[] | null;
  if (!plans) return null;
  const lines: [Pt, Pt][] = [];
  const more: [Pt, Pt][] = [];
  for (const p of plans) {
    const plan = 'graph' in p ? strokes(p.graph, [p.ring]) : p;
    lines.push(...plan.lines);
    more.push(...plan.cuts);
  }
  return { cuts: [...cuts, ...more], lines };
}
