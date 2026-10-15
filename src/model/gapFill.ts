import type { Pt } from '../digitize/skeleton';
import { flatten, type Form } from '../shape/path';
import type { Obstacle } from '../shape/ops';
import { geoUse, guessGeo, sewnAlong } from './geo';
import type { SewObject } from './objects';
import type { Pattern } from './pattern';
import { remembered } from './restitch';
import { stitchKinds } from './sequence';

/** How wide a running stitch line counts as an obstacle (mm): one thread. */
const RUN_WIDTH = 0.4;

/**
 * What stands in the way of the Flächen-Werkzeug (see gapAt in shape/ops): the shapes of the
 * objects `objs` as they are sewn, an area as its area, a band and a line as the width of their
 * thread. Objects without a form are traced from their stitches (guessGeo).
 */
export function obstaclesOf(p: Pattern, objs: readonly SewObject[]): Obstacle[] {
  const kinds = stitchKinds(p);
  return objs.flatMap((o): Obstacle[] => {
    const m = remembered(p, o);
    const use = geoUse(m);
    if (use === 'area') return [{ form: m!.geo!, line: false, width: 0 }];
    if (use === 'band') return [{ form: m!.geo!, line: true, width: m!.fill!.lineWidth ?? RUN_WIDTH }];
    if (use === 'line') {
      const st = m!.line!;
      return [{ form: m!.geo!, line: true, width: st.type === 'run' ? RUN_WIDTH : Math.max(RUN_WIDTH, st.width) }];
    }
    const geo = guessGeo(p, o, kinds);
    if (!geo) return [];
    return [sewnAlong(p, o) ? { form: geo, line: true, width: RUN_WIDTH } : { form: geo, line: false, width: 0 }];
  });
}

const boxOf = (f: Form): [number, number, number, number] | null => {
  const pts: Pt[] = f.paths.flatMap((q) => flatten(q, 0.2));
  if (!pts.length) return null;
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/**
 * Where a new area `form` goes in the sewing order (insertObject's `after`): just before the first
 * object it borders on, so it lies under the shapes around it and their edges cover the seam; at the
 * end when it borders on none. `reach`: how far away a shape still borders on it (mm).
 */
export function gapPlace(form: Form, obstacles: readonly Obstacle[], reach: number): number | null {
  const b = boxOf(form);
  if (!b) return null;
  const k = obstacles.findIndex((o) => {
    const c = boxOf(o.form);
    const r = reach + (o.line ? o.width / 2 : 0);
    return !!c && c[0] - r <= b[2] && c[2] + r >= b[0] && c[1] - r <= b[3] && c[3] + r >= b[1];
  });
  return k < 0 ? null : k - 1;
}
