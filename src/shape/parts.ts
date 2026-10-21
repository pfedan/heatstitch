import { core } from '../wasm/core';
import type { Form } from './path';
import { JOIN_SNAP_MM } from './join';

/**
 * The parts a form falls into ("In Teile trennen" on a known form), each a form of its own, in the
 * order of their first path.
 *
 * A line (`area` false): the paths that touch, cross or come within `reach` mm of each other
 * anywhere along their curves stay together, also through other paths: the connected parts of the
 * drawing, the same ones redwork sews without a jump (see digitize/redwork.ts, REDWORK_GAP).
 *
 * An area: each outer loop with its holes (as Inkscape's "Split path", not "Break apart", which
 * makes holes shapes of their own). Loops that cross are one part; a hole goes with the smallest
 * loop around it, an island in a hole is a part of its own. Open paths beside the area go with
 * the part they lie in, else with the first.
 */
export function formParts(f: Form, area: boolean, reach = JOIN_SNAP_MM): Form[] {
  // The core finds which paths go together (core/src/shape/parts.rs); the parts keep the path objects.
  if (f.paths.length < 2) return [f];
  const groups = core().formParts(f, area, reach) as number[][];
  return groups.map((g) => ({ ...(f.nonzero ? { nonzero: true } : {}), paths: g.map((k) => f.paths[k]) }));
}
