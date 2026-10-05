import { describe, expect, it } from 'vitest';
import { fillRegion } from '../src/digitize/fill';
import { cutAway } from '../src/model/covers';
import { rasterize } from '../src/shape/rasterize';
import { parsePath, rectPath } from '../src/shape/svgPath';
import type { Mat } from '../src/shape/path';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const rect = (x: number, y: number, w: number, h: number) => rasterize(parsePath(rectPath(x, y, w, h, 0, 0), ID))!;

describe('what lies on top', () => {
  it('leaves out a satin on top up to a share of its width', () => {
    const base = rect(0, 0, 20, 20);
    const satin = rect(-1, 8, 22, 4);
    const left = cutAway(base, [{ region: satin, overlap: 4 * 0.3 }])!;
    // 4 mm wide, 1.2 mm overlap from each side: 1.6 mm of the strip left out.
    expect(left.areaMm2).toBeCloseTo(400 - 20 * 1.6, -1);
    expect(cutAway(base, [{ region: satin, overlap: 0.2 }])!.areaMm2).toBeLessThan(left.areaMm2);
  });

  it('sews no underlay where the area is covered, the rows still everywhere', () => {
    const base = rect(0, 0, 20, 20);
    const under = cutAway(base, [{ region: rect(-1, -1, 12, 22), overlap: 0.5 }])!;
    const p = { spacing: 0.4, stitch: 4, angle: 0, pull: 0, underlay: true, tolerance: 0.15 };
    const all = fillRegion(base, p, [0, 0])!;
    const part = fillRegion(base, { ...p, underArea: under }, [0, 0])!;
    const underPts = (r: typeof all) => r.runs.flat().slice(0, r.under ?? 0);
    expect(underPts(all).some(([x]) => x < 9)).toBe(true);
    expect(underPts(part).filter(([x]) => x < 10).length).toBeLessThan(underPts(all).filter(([x]) => x < 10).length * 0.2);
    expect(underPts(part).length).toBeGreaterThan(0);
  });
});
