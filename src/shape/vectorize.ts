import type { Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { core } from '../wasm/core';
import type { Form } from './path';

/**
 * Regions and drawn lines as curves, computed by the Rust core (core/src/shape/vectorize.rs).
 *
 * Largest distance of the curves from the traced outline (mm): rastered again, the area stays
 * within about 1 % of the pixels it came from, with few enough nodes to grab. Areas read from
 * stitches have ragged row ends anyway; they get the coarser READ_TOLERANCE.
 */
export const FIT_TOLERANCE = 0.15;
export const READ_TOLERANCE = 0.25;

type V = [number, number];
type Cubic = [Pt, Pt, Pt, Pt];

/**
 * The area of a region as curves: its outline (holes included) traced and fitted with cubic
 * curves, corners kept sharp. Raster it again with `rasterize` to get (nearly) the same pixels.
 */
export function vectorize(r: Region, tol = FIT_TOLERANCE): Form {
  return core().vectorize(r.sdfBase, r.w, r.h, r.x0, r.y0, r.pxMm, tol) as Form;
}

function flatPoints(pts: Pt[]): Float64Array {
  const flat = new Float64Array(2 * pts.length);
  pts.forEach(([x, y], i) => {
    flat[2 * i] = x;
    flat[2 * i + 1] = y;
  });
  return flat;
}

function cubics(flat: Float64Array): Cubic[] {
  const out: Cubic[] = [];
  for (let i = 0; i + 8 <= flat.length; i += 8)
    out.push([
      [flat[i], flat[i + 1]],
      [flat[i + 2], flat[i + 3]],
      [flat[i + 4], flat[i + 5]],
      [flat[i + 6], flat[i + 7]],
    ]);
  return out;
}

/**
 * Cubic curves through `pts` (Schneider's algorithm, Graphics Gems 1990): one curve fitted by
 * least squares with the given end directions, split at the worst point until every point lies
 * within `tol`. With `between`, also the curve between two points lies within `tol` of the straight
 * piece joining them: Schneider measures at the points only, and a curve over few points can bulge
 * out between them (a short piece next to a corner, say).
 */
export function fitCubic(pts: Pt[], t1: V, t2: V, tol: number, between = false): Cubic[] {
  return cubics(core().fitCubic(flatPoints(pts), Float64Array.from(t1), Float64Array.from(t2), tol, between));
}

/**
 * The one cubic that follows `pts` best with the given end directions, however far off it lies:
 * Schneider's least squares fit with Newton steps on the parameters, the best of the tries kept.
 */
export function fitSingleCubic(pts: Pt[], t1: V, t2: V): Cubic {
  return cubics(core().fitSingleCubic(flatPoints(pts), Float64Array.from(t1), Float64Array.from(t2)))[0];
}
