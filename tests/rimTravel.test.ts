import { describe, expect, it } from 'vitest';
import { fillRegion, type FillParams } from '../src/digitize/fill';
import { expandRegion } from '../src/digitize/region';
import { cutAway } from '../src/model/covers';
import { rasterize } from '../src/shape/rasterize';
import { parsePath, ellipsePath } from '../src/shape/svgPath';

// The travel grid keeping off the strip beside row ends is tested in core/src/digitize/travel_grid.rs.

describe('order of the sections where parts are left out', () => {
  // A cherry with its highlight left out, the needle starting just below the highlight (where the
  // underlay ended in the app): the order and the ends the sections are entered at keep every way
  // between them under rows still to come or the highlight, so the fill needs no trim.
  const ID: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  const whole = rasterize(parsePath(ellipsePath(11, 16.5, 9, 9), ID))!;
  const hole = rasterize(parsePath(ellipsePath(11, 12.5, 2.6, 1.8), ID))!;
  const area = cutAway(whole, [{ region: hole, overlap: 0.2 }])!;
  const travel = expandRegion(whole, 0.5)!;
  for (const angle of [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5]) {
    it(`sews the cherry in one go at ${angle}°`, () => {
      const p: FillParams = { spacing: 0.4, stitch: 4, pull: 0, underlay: false, tolerance: 0.15, travel, offRowEnds: true, whole, end: [-10.3, 11.8], angle };
      const res = fillRegion(area, p, [11.6, 15])!;
      expect(res.runs.length).toBe(1);
      // Every row is sewn: as many stitches as without the plan, give or take the travel.
      const plain = fillRegion(area, { ...p, whole: undefined }, [11.6, 15])!;
      const n = (r: typeof res) => r.runs.reduce((a, x) => a + x.length, 0);
      expect(Math.abs(n(res) - n(plain))).toBeLessThan(n(plain) * 0.1);
    });
  }
});
