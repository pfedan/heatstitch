import { describe, expect, it } from 'vitest';
import { underlayOf, type Column } from '../src/digitize/satin';
import type { Pt } from '../src/digitize/skeleton';

// A straight column 30 mm long and 6 mm wide, its rails at y = 0 and y = 6.
const n = 31;
const col: Column = {
  center: Array.from({ length: n }, (_, i): Pt => [i, 3]),
  left: Array.from({ length: n }, (_, i): Pt => [i, 0]),
  right: Array.from({ length: n }, (_, i): Pt => [i, 6]),
  width: 6,
};
/** How close the underlay comes to a rail (mm). */
const nearest = (pts: Pt[]) => Math.min(...pts.map(([, y]) => Math.min(y, 6 - y)));

describe('satin underlay inset', () => {
  it('keeps 0.4 mm inside the rails by default', () => {
    expect(nearest(underlayOf(col, 'contour').pts)).toBeCloseTo(0.4, 1);
  });

  it('keeps inside by the set mm or share of the width', () => {
    expect(nearest(underlayOf(col, 'contour', undefined, { mm: 1.2 }).pts)).toBeCloseTo(1.2, 1);
    expect(nearest(underlayOf(col, 'zigzag', undefined, { mm: 1.2 }).pts)).toBeCloseTo(1.2, 1);
    // 25 % of 6 mm; the share wins over mm.
    expect(nearest(underlayOf(col, 'both', undefined, { mm: 1.2, share: 0.25 }).pts)).toBeCloseTo(1.5, 1);
  });
});
