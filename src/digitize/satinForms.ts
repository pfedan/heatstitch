import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import type { Pt } from './skeleton';

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

