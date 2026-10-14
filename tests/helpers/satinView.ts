import type { Pt } from '../../src/digitize/skeleton';
import { BADGE, type RungTool } from '../../src/ui/rungTool';

export type Control = 'number' | 'arrow' | 'mirror' | 'scissors';

/** Where a control of piece n (from 1, in the first part) sits at `scale`: its number, arrow, mirror, or the scissors of the join before it. */
export function controlAt(tool: RungTool, n: number, what: Control, scale = 10, part = 0): Pt {
  const k = tool.badges.findIndex((x) => x.part === part && x.n === n);
  const b = tool.badges[k];
  const layout = tool.layout(scale);
  if (what === 'number') return layout.numbers[k]!;
  if (what === 'scissors') return layout.scissors[tool.links.findIndex((l) => l.part === part && l.i === b.i)];
  const along = what === 'arrow' ? BADGE.arrow : BADGE.mirror;
  return [b.at[0] + (b.dir[0] * along) / scale, b.at[1] + (b.dir[1] * along) / scale];
}

/** A click on a control of piece n (see controlAt). */
export function clickControl(tool: RungTool, n: number, what: Control, scale = 10, part = 0): void {
  const at = controlAt(tool, n, what, scale, part);
  // Pointed at first, as a mouse does: the scissors of a way show only then (see scissorsOn).
  tool.hoverAt(...at, scale);
  tool.down(...at, scale);
  tool.up();
}

/** Piece n's number dragged onto piece m's (in the first part). */
export function dragNumber(tool: RungTool, n: number, m: number, scale = 10, part = 0): void {
  const to = controlAt(tool, m, 'number', scale, part);
  const from = controlAt(tool, n, 'number', scale, part);
  tool.hoverAt(...from, scale);
  tool.down(...from, scale);
  tool.dragTo(...to);
  tool.up();
}

/** What joins each piece of the first part to the one before (from the second). */
export const joinsOf = (tool: RungTool, part = 0) => tool.links.filter((l) => l.part === part).map((l) => l.join);
