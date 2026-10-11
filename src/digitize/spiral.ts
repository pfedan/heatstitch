import type { FillParams, FillResult } from './fill';
import type { Region } from './region';
import { ringFill } from './rings';
import type { Pt } from './skeleton';

/**
 * Spiral fill: one line that winds from the edge to the middle, its turns one spacing apart all
 * round, in any shape (see rings.ts). A shape that branches (a dumbbell) or has holes gets a spiral
 * per branch, joined under rows still to come. Null only when the shape is too small for a ring.
 */
export function spiralFill(r: Region, p: FillParams, start: Pt): FillResult | null {
  const res = ringFill(r, p, start, 'spiral', -45);
  return res && { ...res, angle: 0 };
}
