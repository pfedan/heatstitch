import { innerStops } from './applique';
import { nextVersion, type Pattern, type ThreadColor } from './pattern';

/**
 * The pattern with another thread color for one color block. Blocks without an own entry so far
 * (files listing fewer colors than blocks) get the color they showed until now.
 */
export function recolor(p: Pattern, block: number, color: ThreadColor): Pattern {
  const last = p.colors[p.colors.length - 1] ?? { r: 128, g: 128, b: 128 };
  const colors = Array.from({ length: Math.max(p.colors.length, block + 1) }, (_, i) => p.colors[i] ?? last);
  // An appliqué stops inside, in its own thread: the blocks it goes on in take the thread with it.
  const inner = innerStops(p);
  let b = block;
  while (b > 0 && inner.has(b)) b--;
  do colors[b++] = { ...color };
  while (inner.has(b) && b < colors.length);
  return nextVersion(p, { colors });
}

export const sameColor = (a: ThreadColor | undefined, b: ThreadColor | undefined): boolean =>
  !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b && a.name === b.name;
