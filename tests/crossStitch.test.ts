import { describe, expect, it } from 'vitest';
import { crossCells, onGrid } from '../src/digitize/deco';
import { setKnockout } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import { JUMP, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { crossGridOf, remembered } from '../src/model/restitch';
import { Design, THREADS } from './helpers/demoProject';

/**
 * Cross stitch fills on the design's grid: shapes on top that are cross stitch too take their
 * cells, the crosses below reach right up to them (no gap, no cell crossed twice), and nothing but
 * the crosses' diagonals is sewn.
 */
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
const CROSS = { pattern: 'cross' as const, deco: { size: 2.3 } };

/** A 40 × 30 mm cross stitch with a smaller one on top whose edges are not on the grid. */
function design(): { d: Design; big: number; top: number } {
  const d = new Design('Kreuz', { fabric: 'woven', thread: '40' });
  const big = d.fill(rect(10, 10, 40, 30), THREADS.yellow, CROSS);
  const top = d.fill(rect(21.7, 17.4, 15.2, 11.9), THREADS.navy, CROSS);
  return { d, big, top };
}

const cellsOf = (p: Pattern, index: number) => {
  const m = remembered(p, sewObjects(p)[index])!;
  return new Set(crossCells(m.region!, crossGridOf(m.fill!)!).map((c) => c.join(',')));
};

describe('cross stitch on the design grid', () => {
  it('leaves the cells of a cross stitch on top and reaches right up to them', () => {
    const { d, big, top } = design();
    const whole = cellsOf(d.p, big);
    const on = setKnockout(d.p, [big], true, d.T)!.pattern;
    const below = cellsOf(on, big);
    const above = cellsOf(on, top);
    expect(above.size).toBeGreaterThan(20);
    expect([...below].filter((c) => above.has(c))).toEqual([]);
    // No cell of the big area is lost: every one is crossed by one of them.
    expect([...whole].filter((c) => !below.has(c) && !above.has(c))).toEqual([]);
  });

  it('sews only along the diagonals of its crosses, with no jump between them', () => {
    const { d, big } = design();
    const p = setKnockout(d.p, [big], true, d.T)!.pattern;
    const o = sewObjects(p)[big];
    const m = remembered(p, o)!;
    const at = onGrid(crossGridOf(m.fill!)!);
    let jumps = 0;
    for (let i = o.first + 1; i <= o.last; i++) {
      if (p.cmd[i] === JUMP && p.cmd[i - 1] === STITCH && p.cmd[i + 1] === STITCH) jumps++;
      if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
      const a = at([p.x[i - 1] / 10, p.y[i - 1] / 10]);
      const b = at([p.x[i] / 10, p.y[i] / 10]);
      const dx = Math.abs(b[0] - a[0]);
      const dy = Math.abs(b[1] - a[1]);
      // Lock stitches are short pieces along a diagonal; rounding to 0.1 mm moves a point a little.
      if (dx + dy < 0.3) continue;
      expect(Math.abs(dx - dy), `stitch ${i}`).toBeLessThan(0.06);
    }
    expect(jumps).toBe(0);
    // The ring around the square on top is one connected area: sewn in one go.
    let trims = 0;
    for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === TRIM) trims++;
    expect(trims).toBe(0);
  });
});
