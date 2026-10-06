import type { Pt } from '../digitize/skeleton';
import { transformForm, type Form } from '../shape/path';
import type { PathStitch } from './along';
import type { ThreadColor } from './pattern';

/**
 * The shadow of a line: the line once more, a little beside it in a thread of its own, sewn before
 * it so the line lies on top. Like the border of a fill it is an object of its own linked to its
 * line (`LineShadow.link`, the object's `shadowOf`); syncShadows (border.ts) keeps it fitting the
 * line. Its offset is a direction on screen, so it stays where the light puts it when the line is
 * turned or mirrored.
 */

/** Where the shadow falls: down right, down left, up right, up left. */
export type ShadowDir = 'se' | 'sw' | 'ne' | 'nw';
export const SHADOW_DIRS: ShadowDir[] = ['se', 'sw', 'ne', 'nw'];

export interface LineShadow {
  color: ThreadColor;
  link: string;
  dir: ShadowDir;
  /** How far it lies from the line (mm), along both axes. */
  dist: number;
}

export const SHADOW_DIST: [number, number] = [0.3, 3];
export const SHADOW_DEFAULT_DIST = 0.8;
/** The thread a new shadow starts with: dark grey. */
export const SHADOW_COLOR: ThreadColor = { r: 64, g: 64, b: 64 };

export function shadowOffset(s: LineShadow): Pt {
  return [s.dir === 'se' || s.dir === 'ne' ? s.dist : -s.dist, s.dir === 'se' || s.dir === 'sw' ? s.dist : -s.dist];
}

/** The curve the shadow of line `path` is sewn along. */
export function shadowPath(path: Form, s: LineShadow): Form {
  const [dx, dy] = shadowOffset(s);
  return transformForm(path, [1, 0, 0, 1, dx, dy]);
}

/** How the shadow is sewn: as its line (with its echo), without a shadow of its own. */
export function shadowStitch(st: PathStitch): PathStitch {
  const { shadow: _s, ...rest } = st;
  return rest;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const byte = (v: unknown) => finite(v) && v >= 0 && v <= 255;

export function isShadow(x: unknown): x is LineShadow {
  const s = x as LineShadow | null;
  return !!s && typeof s.link === 'string' && SHADOW_DIRS.includes(s.dir) && finite(s.dist) && s.dist >= SHADOW_DIST[0] && s.dist <= SHADOW_DIST[1] && !!s.color && byte(s.color.r) && byte(s.color.g) && byte(s.color.b);
}
