import { innerStops } from './applique';
import { nextVersion, type Pattern, type ThreadColor } from './pattern';

/**
 * The pattern with another thread color for one color block. Blocks without an own entry so far
 * (files listing fewer colors than blocks) get the color they showed until now.
 */
export function recolor(p: Pattern, block: number, color: ThreadColor): Pattern {
  const last = p.colors[p.colors.length - 1] ?? { r: 128, g: 128, b: 128 };
  const colors = Array.from({ length: Math.max(p.colors.length, block + 1) }, (_, i) => p.colors[i] ?? last);
  for (const b of threadBlocks(p, block, colors.length)) colors[b] = { ...color };
  return nextVersion(p, { colors });
}

/**
 * The color blocks that change with block `block` when it is recolored: an appliqué stops inside,
 * in its own thread, and the blocks it goes on in take the thread with it.
 */
export function threadBlocks(p: Pattern, block: number, count = Math.max(p.colors.length, block + 1)): number[] {
  const inner = innerStops(p);
  let b = block;
  while (b > 0 && inner.has(b)) b--;
  const out: number[] = [];
  do out.push(b++);
  while (inner.has(b) && b < count);
  return out;
}

export const sameColor = (a: ThreadColor | undefined, b: ThreadColor | undefined): boolean =>
  !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b && a.name === b.name;
