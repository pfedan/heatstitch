import { core } from '../wasm/core';
import { coreParams, coreRegions, fillOf, type FillParams, type FillResult } from './fill';
import { regionIn, type Region } from './region';
import type { Pt } from './skeleton';

/**
 * Fills along the outline, one spacing apart everywhere: the contour fill (ring in ring) and the
 * spiral, for any shape.
 *
 * The rings are the level lines of the area's distance field, the first half a spacing inside the
 * edge (moved out by `pull`), each next one a spacing further in, so neighbouring rings lie exactly
 * one spacing apart all round (as in Ink/Stitch's contour fill and the offset curves of spiral
 * pocket milling). Each ring knows the ring it lies in (its parent, one spacing further out): a
 * tree, which branches where the shape gets narrow (a dumbbell) and has more roots where it has
 * holes.
 *
 * The sewn line runs from ring to ring without a step: ring k is sewn shifted by φ(f) spacings
 * along the field's gradient, where f is the share of the ring's length from its start. When φ
 * goes from -1/2 at the start to +1/2 at the end, the end of ring k lies exactly where ring k+1
 * begins (its start is one spacing further in on the same gradient line), and neighbouring turns
 * stay one spacing apart everywhere, as both are shifted alike. With φ = f - 1/2 the line is a
 * spiral: the ring to ring interpolation of spiral pocket milling (Held and Spielberger, "A smooth
 * spiral tool path for high speed machining of 2D pockets", 2009), here exact in the distance field
 * rather than between resampled polygons. With φ = 0 except a short ramp at both ends it is the
 * contour fill, whose rings pass on to the next one over a few millimetres instead of in one step
 * with a needle point sewn twice.
 *
 * Along the ridge in the middle no full spacing may be left for another line: the last line there
 * moves so that the gap across the ridge and the gap to the line before come out equal, rather than
 * leaving a strip of fabric or two lines on top of each other.
 *
 * Where the tree branches, the line goes on into one branch; every other branch is a spiral of its
 * own, sewn before the line passes it and from its middle outwards, so the needle reaches it and
 * leaves it under rows still to come (like the connected spirals of Zhao et al., "Connected Fermat
 * Spirals for Layered Fabrication", 2016, but with single spirals and hidden travel).
 *
 * Computed by the Rust core (core/src/digitize/rings.rs).
 */

export type RingMode = 'spiral' | 'contour';

/** Rings or a spiral (see above), with underlay at `angle` degrees; null when no ring fits. */
export function ringFill(r: Region, p: FillParams, start: Pt, mode: RingMode, angle: number): FillResult | null {
  return fillOf(core().ringFill(regionIn(r), coreParams(p), start[0], start[1], mode === 'spiral', angle, ...coreRegions(r, p)));
}
