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

describe('double zigzag underlay', () => {
  const zz = underlayOf(col, 'zigzag').pts;
  const half = zz.length / 2;
  const out = zz.slice(0, half);
  const back = zz.slice(half).reverse();

  it('goes out and back over the same stations, each pass on the other side there', () => {
    expect(underlayOf(col, 'zigzag').atEnd).toBe(false);
    expect(zz.length % 2).toBe(0);
    // About every 1.5 mm along (the next point of the column from there), alternating sides.
    expect(out[1][0] - out[0][0]).toBeGreaterThanOrEqual(1.5);
    expect(out[1][0] - out[0][0]).toBeLessThanOrEqual(2);
    out.forEach((p, i) => {
      expect(back[i][0]).toBeCloseTo(p[0], 5);
      // Out on one rail, back on the other: the passes cross between stations.
      expect(Math.sign(back[i][1] - 3)).toBe(-Math.sign(p[1] - 3));
    });
    // Ends where it started.
    expect(zz[zz.length - 1][0]).toBeCloseTo(zz[0][0], 5);
  });

  it('keeps half the edge run inset by default, so it carries the satin edge beside it', () => {
    expect(nearest(zz)).toBeCloseTo(0.2, 2);
    expect(nearest(underlayOf(col, 'both').pts)).toBeCloseTo(0.2, 2);
  });

  it('is part of the automatic underlay of wide columns, which then ends at the start', () => {
    const u = underlayOf(col, 'auto');
    expect(u.atEnd).toBe(false);
    // At the start, on the other rail.
    expect(Math.abs(u.pts[0][0] - u.pts[u.pts.length - 1][0])).toBeLessThan(0.5);
  });

  it('walks narrow stretches of a tapering column out and back on the same holes', () => {
    // 40 mm long, from 2 mm wide to 8 mm wide.
    const m = 81;
    const taper: Column = {
      center: Array.from({ length: m }, (_, i): Pt => [i / 2, 0]),
      left: Array.from({ length: m }, (_, i): Pt => [i / 2, -(1 + (3 * i) / (m - 1))]),
      right: Array.from({ length: m }, (_, i): Pt => [i / 2, 1 + (3 * i) / (m - 1)]),
      width: 5,
    };
    const u = underlayOf(taper, 'auto');
    expect(u.atEnd).toBe(false);
    const first = u.pts[0];
    const last = u.pts[u.pts.length - 1];
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeLessThan(1e-9);
    // The far end is reached once, in the middle of the run.
    expect(Math.max(...u.pts.map(([x]) => x))).toBeGreaterThan(39);
  });
});
