import type { Region } from '../digitize/region';
import { knockOut } from '../shape/rasterize';
import { appliqueArea, fillArea } from './geo';
import { cutKey, wholeArea } from './knockout';
import { sewObjects, type SewObject } from './objects';
import type { Pattern } from './pattern';
import { remembered, type Remembered } from './restitch';
import { bounds } from '../shape/path';

/**
 * Appliqués next to each other share their edge: where a later appliqué with a cover lies on the
 * edge of an earlier one, or touches it, the earlier one sews no cover there. The later one's cover goes over
 * both cut edges, in its thread (the sewing order decides whose); else two satins lie side by side
 * or on each other, too thick and stiff. This is Wilcom's "partial appliqué": the cover of the piece
 * below is left out where pieces overlap, its placement, tack-down and cut stay whole.
 *
 * Computed, never stored in the shape: when the later piece moves away the earlier one gets its
 * whole cover again (refreshKnockouts), as fills leave out what lies on top (knockout.ts).
 */

/** How much a satin cover is kept from reaching the edge of a piece beside it (mm): it hides that edge with room to spare. */
const SHARE_MARGIN = 0.3;

/**
 * How far from a later piece with settings `s` an edge is still hidden under its cover (mm): a satin
 * centered on its outline reaches half its width beyond it; an E stitch only hides what lies under
 * its fabric.
 */
const reachOver = (m: Remembered): number => (m.applique?.edge === 'satin' ? Math.max(0, m.applique.width / 2 - SHARE_MARGIN) : 0);

/**
 * The area of appliqué `o` of `p` (remembering `m`) whose own edge its cover is sewn on: its area
 * without where later appliqués hide its edge; null when none do (or it has no cover).
 */
export function sharedArea(p: Pattern, objs: SewObject[], o: SewObject, m: Remembered | null | undefined = remembered(p, o)): Region | null {
  const area = m?.applique && m.applique.edge !== 'none' ? (m.region ?? fillArea(m)) : null;
  if (!area) return null;
  // Its window (mm), to pass by pieces far from it.
  const [x0, y0, x1, y1] = [area.x0 * area.pxMm, area.y0 * area.pxMm, (area.x0 + area.w) * area.pxMm, (area.y0 + area.h) * area.pxMm];
  let cur: Region | null = area;
  for (const x of objs) {
    if (x.index <= o.index || !cur) continue;
    const mx = remembered(p, x);
    // A raw edge doubles nothing: the piece below keeps its whole cover.
    const f = mx?.applique && mx.applique.edge !== 'none' ? appliqueArea(mx) : null;
    const b = f && bounds(f);
    if (!b) continue;
    const t = reachOver(mx!);
    if (b.minX - t > x1 || b.maxX + t < x0 || b.minY - t > y1 || b.maxY + t < y0) continue;
    const r = wholeArea(f!, area.pxMm);
    if (r) cur = knockOut(cur, [r], -t);
  }
  return cur === area ? null : cur;
}

/** The name of the shared area appliqué `o` is sewn with, as Remembered.cut keeps it ('' for none). */
export const sharedKey = (p: Pattern, objs: SewObject[], o: SewObject, m?: Remembered | null): string => cutKey(sharedArea(p, objs, o, m));

/** Whether appliqué `o` of `p` was sewn with the edges it shares now. */
export const sharesAsSewn = (p: Pattern, objs: SewObject[] = sewObjects(p), o: SewObject, m = remembered(p, o)): boolean => !m?.applique || m.free || (m.cut ?? '') === sharedKey(p, objs, o, m);
