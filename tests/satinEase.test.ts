import { describe, expect, it } from 'vitest';
import { peakDensity } from '../src/digitize/measure';
import { buildRegion, type Region } from '../src/digitize/region';
import { inside, stripsOfAreas } from '../src/digitize/rungs';
import { easePiles } from '../src/digitize/satinEase';
import { areaLoops, suggestSatin } from '../src/digitize/satinSuggest';
import type { Pt } from '../src/digitize/skeleton';
import { satinRuns, type SatinSettings } from '../src/model/restitch';

const PX = 0.1;
const W = 600;

function region(f: (x: number, y: number) => boolean): Region {
  const comp = new Int32Array(W * W).fill(-1);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (f((x + 0.5) * PX, (y + 0.5) * PX)) comp[y * W + x] = 0;
  return buildRegion(comp, new Uint8Array(W * W), W, 0, 0, { minX: 0, minY: 0, maxX: W - 1, maxY: W - 1 }, W, PX, 0, () => false);
}

const disk = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) < r;
const polygon = (p: Pt[]) => (x: number, y: number) => inside(p, [x, y]);
const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: true, underlay: false, tolerance: 0.15 };

/** The satin of a plan: null when its lines make no columns. */
function sewn(r: Region, plan: { cuts: [Pt, Pt][]; lines: [Pt, Pt][] }): Pt[][] | null {
  const { outsides, holes } = areaLoops(r);
  const made = stripsOfAreas(outsides, plan.lines, plan.cuts, holes);
  if (made.bad || made.hole >= 0) return null;
  return satinRuns(made.areas.flatMap((strips, a) => strips.map((x) => ({ ...x, chain: a }))), SATIN);
}

describe('easePiles: cuts where a satin in sections piles up', () => {
  // A loop with a wedge beside it, thick where it meets the loop, and a line leaving it.
  const r = region((x, y) => (disk(30, 24, 3.2)(x, y) && !disk(30, 24, 2)(x, y)) || polygon([[16, 28], [30, 26], [34, 32], [16, 29.4]])(x, y) || polygon([[32, 30], [45, 34], [45, 35.2], [32, 31.4]])(x, y));
  const plan = suggestSatin(r)!;

  it('leaves a plan alone that does not pile up', () => {
    expect(plan.ok).toBe(true);
    expect(easePiles(r, plan, SATIN, 7)).toBe(plan);
  });

  it('cuts through the densest spot while that eases it, the columns still whole', () => {
    const before = peakDensity(sewn(r, plan)!);
    const eased = easePiles(r, plan, SATIN, 7, before * 0.9);
    expect(eased.cuts.length).toBeGreaterThan(plan.cuts.length);
    expect(eased.lines).toEqual(plan.lines);
    const runs = sewn(r, eased);
    expect(runs).not.toBeNull();
    expect(peakDensity(runs!)).toBeLessThan(before);
    // Each cut no longer than a satin stitch may be.
    for (const [a, b] of eased.cuts.slice(plan.cuts.length)) expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(7 + 0.7);
  });
});
