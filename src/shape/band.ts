import type { Pt } from '../digitize/skeleton';
import { core } from '../wasm/core';
import type { Form } from './path';

/**
 * The satin band of a line or border as the editor draws it: its two edges and the grip its width is
 * dragged by. Edges and grip are computed by the Rust core (core/src/shape/band.rs).
 */

/** Satin width a line can be given by dragging its band (mm). */
export const BAND_MIN = 0.8;
export const BAND_MAX = 20;

/**
 * The two edges of a band `w` mm wide along each path: a line sewn as satin, or the satin border of
 * an area lying `offset` mm outside its edge.
 */
export function bandEdges(f: Form, w: number, offset = 0): Pt[][] {
  return core().bandEdges(f, w, offset) as Pt[][];
}

/**
 * Where the width grip sits: halfway along the first path, on its left edge (outer edge when it is
 * closed), off the nodes. `mid` is the band's middle there and `n` the direction across it, to
 * measure a dragged width from.
 */
export function bandGrip(f: Form, w: number, offset = 0): { at: Pt; mid: Pt; n: Pt } | null {
  return core().bandGrip(f, w, offset) as { at: Pt; mid: Pt; n: Pt } | null;
}

/** The width a drag of the grip to `q` gives: twice its distance across the line, rounded to 0.1 mm. */
export function draggedWidth(g: { mid: Pt; n: Pt }, q: Pt): number {
  const d = Math.abs((q[0] - g.mid[0]) * g.n[0] + (q[1] - g.mid[1]) * g.n[1]);
  return Math.min(BAND_MAX, Math.max(BAND_MIN, Math.round(20 * d) / 10));
}
