import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { reversedRails, satinRuns, type Rails, type SatinSettings } from '../src/model/restitch';
import { BADGE, RungTool } from '../src/ui/rungTool';

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: false, underlay: false, tolerance: 0.15 };

/** Points every 0.5 mm from a to b. */
const line = (a: Pt, b: Pt): Pt[] => {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
  return Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n] as Pt);
};

/** A column 4 mm wide along x from 0 to 20: left rail at y 0, right rail at y 4. */
const COLUMN: Rails = { left: line([0, 0], [20, 0]), right: line([0, 4], [20, 4]), rungs: [] };

const side = (p: Pt) => (p[1] < 2 ? 'left' : 'right');

describe('a mirrored satin', () => {
  it('starts and ends on the other rail', () => {
    const plain = satinRuns([COLUMN], SATIN)[0];
    const mirrored = satinRuns([{ ...COLUMN, mirror: true }], SATIN)[0];
    expect([side(plain[0]), side(plain[plain.length - 1])]).toEqual(['left', 'right']);
    expect([side(mirrored[0]), side(mirrored[mirrored.length - 1])]).toEqual(['right', 'left']);
    // The same stitches across, only the other way round each time.
    expect(mirrored.length).toBe(plain.length);
  });

  it('with underlay sewn back: also the other way', () => {
    const s = { ...SATIN, underlay: true, under: 'center' as const };
    const plain = satinRuns([COLUMN], s)[0];
    const mirrored = satinRuns([{ ...COLUMN, mirror: true }], s)[0];
    expect(side(mirrored[mirrored.length - 1])).not.toBe(side(plain[plain.length - 1]));
  });

  it('mirrors one section of a column by its plan, the others stay', () => {
    const cut: Rails = { ...COLUMN, cuts: [[10, 10]] };
    const plan = [
      { sec: 0, flip: false, trim: false },
      { sec: 1, flip: false, trim: true, mirror: true },
    ];
    const runs = satinRuns([{ ...cut, plan }], SATIN);
    expect(runs.length).toBe(2);
    expect(side(runs[0][0])).toBe('left');
    expect(side(runs[1][0])).toBe('right');
    expect(side(runs[1][runs[1].length - 1])).toBe('left');
    // Walked from the other end the mirror stays with its section.
    expect(reversedRails({ ...cut, plan, mirror: true }).plan!.find((x) => x.sec === 0)!.mirror).toBe(true);
    expect(reversedRails({ ...COLUMN, mirror: true }).mirror).toBe(true);
  });
});

describe('the rung tool on a column on its own', () => {
  it('shows an arrow and the mirror where its satin starts, and mirrors it on a click', () => {
    const changes: Rails[][][] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: () => {} });
    tool.satin = SATIN;
    tool.openSatin([[COLUMN]]);
    const b = tool.badges;
    expect(b.length).toBe(1);
    expect(b[0].lone).toBe(true);
    expect(b[0].mirror).toBe(false);
    const scale = 10;
    const at = (along: number, across: number): Pt => [b[0].at[0] + (b[0].dir[0] * along - b[0].dir[1] * across) / scale, b[0].at[1] + (b[0].dir[1] * along + b[0].dir[0] * across) / scale];
    // No number to click: it has no place in an order.
    expect(tool.badgeAt(...at(BADGE.number, 0), scale)).toBeNull();
    expect(tool.badgeAt(...at(BADGE.number, -BADGE.scissors), scale)?.what).toBe('mirror');
    tool.down(...at(BADGE.number, -BADGE.scissors), scale);
    tool.up();
    expect(changes.length).toBe(1);
    expect(changes[0][0][0].mirror).toBe(true);
    // The arrow turns it round.
    tool.down(...at(BADGE.arrow, 0), scale);
    tool.up();
    expect(changes[1][0][0].left[0]).toEqual(COLUMN.right[COLUMN.right.length - 1]);
  });
});
