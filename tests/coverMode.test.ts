import { describe, expect, it } from 'vitest';
import { coverModeOf, setCoverMode, type CoverMode } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import type { Pattern } from '../src/model/pattern';
import { remembered } from '../src/model/restitch';
import { Design, THREADS } from './helpers/demoProject';

/**
 * What a fill does under objects sewn later is one choice in the stitch panel: everything sewn,
 * no underlay there, or all of it left out. Each change is one step, whatever it changes.
 */
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;

function design(): { d: Design; big: number } {
  const d = new Design('Darunter', { fabric: 'woven', thread: '40' });
  const big = d.fill(rect(10, 10, 60, 40), THREADS.yellow, { angle: 90 });
  d.fill(rect(30, 20, 15, 15), THREADS.navy, { angle: 0 });
  return { d, big };
}

const memory = (p: Pattern, i: number) => remembered(p, sewObjects(p)[i])!;
const stitches = (p: Pattern, i: number) => {
  const o = sewObjects(p)[i];
  return o.last - o.first + 1;
};

describe('the choice under later objects', () => {
  it('goes from any mode to any other in one step', () => {
    const { d, big } = design();
    const whole = stitches(d.p, big);
    const modes: CoverMode[] = ['under', 'out', 'all', 'out', 'under', 'all'];
    let p = d.p;
    const counts: Record<CoverMode, number[]> = { all: [], under: [], out: [] };
    for (const mode of modes) {
      const r = setCoverMode(p, [big], mode, d.T)!;
      expect(r, mode).not.toBeNull();
      p = r.pattern;
      const m = memory(p, big);
      expect(coverModeOf(m)).toBe(mode);
      // Leaving out keeps no underlay setting of its own under what lies on top.
      expect(!!m.knockout && !!m.fill?.underCover).toBe(false);
      counts[mode].push(stitches(p, big));
    }
    // Each mode sews the same stitches whichever way it was reached.
    for (const mode of ['all', 'under', 'out'] as const) expect(new Set(counts[mode]).size, mode).toBe(1);
    expect(counts.under[0]).toBeLessThan(whole);
    expect(counts.out[0]).toBeLessThan(counts.under[0]);
  });

  it('changes nothing when the mode is already set', () => {
    const { d, big } = design();
    expect(setCoverMode(d.p, [big], 'all', d.T)).toBeNull();
  });
});
