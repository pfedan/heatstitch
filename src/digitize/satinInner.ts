import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import type { Axis } from './medial';
import type { Pt } from './skeleton';

/**
 * Satin over a whole area (a star, a block letter, a ring, a blob with holes), cut into columns
 * along its medial axis (see medial.ts) the way a digitizer cuts it:
 *
 * - each branch of the axis is a column, its stitches along the ribs of the axis (the lines where
 *   the largest circles touch the outline), so they run square across an arm and fan where it bends;
 * - where branches meet, the two that go on straightest run through as one column if their widths
 *   go together (the stem and one arm of a Y, the bar of a T); every other branch ends on it, cut
 *   along the junction's own triangle (from notch to notch). Where none goes on straight (the
 *   middle of a star) the junction is a hub: a column of its own, all arms cut off at its edge;
 * - a sharp bend between two long sides (the corner of a U) is cut on the miter, from the pruned
 *   corner outside to the notch inside;
 * - a ring without branches is opened once.
 *
 * The result is cut lines and lines across, as the satin tool draws them by hand (see
 * satinSuggest), so the existing machinery makes the columns, sews them in one chain and the user
 * can change them afterwards.
 */

export interface InnerPlan {
  cuts: [Pt, Pt][];
  lines: [Pt, Pt][];
  /** The axis it was planned on (for opening a hole still closed, see satinSuggest). */
  axis: Axis;
}

/**
 * Cut lines and lines across for the area; null when it has no axis to cut along or is too wide for
 * satin. Computed by the core (core/src/digitize/satin_inner.rs).
 */
export function planInner(outsides: Pt[][], holes: Pt[][], max: number): InnerPlan | null {
  const { flat, lens } = flatLines([...outsides, ...holes]);
  return (core().planInner(flat, lens, outsides.length, max) as InnerPlan | null) ?? null;
}
