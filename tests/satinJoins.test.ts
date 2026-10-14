import { describe, expect, it } from 'vitest';
import { lineRails } from '../src/digitize/border';
import { underlayOf, underTier, type Column } from '../src/digitize/satin';
import { CAP_DEG, cornerStyle, strokeRails } from '../src/digitize/satinJoins';
import type { Pt } from '../src/digitize/skeleton';
import { satinOf, type PathStitch } from '../src/model/along';
import { lineStitches, lineStitchFor } from '../src/model/line';
import { isLineStitch, satinRuns } from '../src/model/restitch';
import { flatten } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';

const ID = [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A straight column `w` wide and `len` long along x, sampled every 0.1 mm. */
function straight(w: number, len = 30): Column {
  const center: Pt[] = [];
  for (let x = 0; x <= len + 1e-9; x += 0.1) center.push([x, 0]);
  return { center, left: center.map(([x]) => [x, -w / 2]), right: center.map(([x]) => [x, w / 2]), width: w };
}

/** The needle points of a satin line along `d`, `w` wide, without underlay. */
function satin(d: string, w: number, st: Partial<PathStitch> = {}): Pt[] {
  const p = parsePath(d, ID).paths[0];
  const s: PathStitch = { type: 'satin', width: w, ...st };
  return satinRuns([strokeRails(flatten(p), p.closed, w, s.corner, s.ends)], { ...satinOf(s, true), underlay: false }).flat();
}

describe('satin underlay by width', () => {
  it('goes up in tiers: none, middle, edge run, edge run and zigzag, crossed', () => {
    expect([0.8, 2, 4, 8, 12].map((w) => underTier(w))).toEqual(['none', 'center', 'contour', 'zigzag', 'cross']);
    // Limits belong to the wider tier ("under 3 mm" a walk along the middle).
    expect([1, 3, 6, 10].map((w) => underTier(w))).toEqual(['center', 'contour', 'zigzag', 'cross']);
    // Stretchy fabric is held in both diagonals from 6 mm.
    expect([2, 4, 6, 8].map((w) => underTier(w, true))).toEqual(['center', 'contour', 'cross', 'cross']);
  });

  it('sews each tier as it says', () => {
    const run = (w: number, stretch = false) => underlayOf(straight(w), 'auto', 0.15, undefined, false, stretch);
    expect(run(0.8).pts).toEqual([]);
    // Middle: on the centerline, out to the far end.
    const mid = run(2);
    expect(mid.atEnd).toBe(true);
    expect(mid.pts.every(([, y]) => Math.abs(y) < 1e-6)).toBe(true);
    // Edge run: inside both rails, out and back, nothing across.
    const edge = run(4);
    expect(edge.atEnd).toBe(false);
    expect(edge.pts.every(([, y]) => Math.abs(Math.abs(y) - 1.6) < 1e-6)).toBe(true);
    // Edge run and one zigzag to the far end; crossed: the zigzag back again.
    const zig = run(8);
    const cross = run(12);
    expect(zig.atEnd).toBe(true);
    expect(cross.atEnd).toBe(false);
    const across = (pts: Pt[]) => pts.filter((q, i) => i && Math.abs(q[1] - pts[i - 1][1]) > 2).length;
    expect(across(cross.pts)).toBeGreaterThan(1.8 * across(zig.pts));
    // On stretchy fabric an 8 mm column is crossed already.
    expect(across(run(8, true).pts)).toBeGreaterThan(1.8 * across(zig.pts));
  });

  it('follows the width along a column, back to its start', () => {
    // 2 mm wide for 15 mm, then 8 mm: a walk along the middle, then edge run and zigzag.
    const c = straight(2);
    c.left = c.center.map(([x]) => [x, x < 15 ? -1 : -4]);
    c.right = c.center.map(([x]) => [x, x < 15 ? 1 : 4]);
    const u = underlayOf(c, 'auto', 0.15);
    expect(u.atEnd).toBe(false);
    expect(dist(u.pts[0], u.pts[u.pts.length - 1])).toBeLessThan(0.5);
    expect(u.pts.filter(([x]) => x < 14).every(([, y]) => Math.abs(y) < 1e-6)).toBe(true);
    expect(u.pts.some(([x, y]) => x > 16 && Math.abs(y) > 3)).toBe(true);
  });
});

describe('satin corners', () => {
  // A right angle, 4 mm wide: the corner at (20, 0), the inner corner at (18, 2).
  const L = 'M0 0 L20 0 L20 20';
  const inner: Pt = [18, 2];

  it('leave curves as they were', () => {
    const p = flatten(parsePath('M0 0 C10 -10 20 10 30 0', ID).paths[0]);
    expect(strokeRails(p, false, 4)).toEqual(lineRails(p, false, 4));
    expect(cornerStyle('miter', CAP_DEG - 1)).toBe('miter');
    expect(cornerStyle('miter', CAP_DEG)).toBe('cap');
  });

  it('no longer pile up on the inside of a corner', () => {
    const near = (pts: Pt[]) => pts.filter((q) => dist(q, inner) < 0.3).length;
    // The rails as before fold over the inside of the corner.
    const before = satinRuns([lineRails(flatten(parsePath(L, ID).paths[0]), false, 4)], { ...satinOf({ type: 'satin', width: 4 }, true), underlay: false }).flat();
    const now = satin(L, 4);
    expect(near(now)).toBeLessThan(near(before) / 2);
    // Every needle point inside the stroke as SVG draws it with this join.
    expect(now.every(([x, y]) => x >= -0.05 && x <= 22.05 && y >= -2.05 && y <= 20.05 && !(x < 17.95 && y > 2.05))).toBe(true);
  });

  it('take the outside corner in its form', () => {
    const corner: Pt = [22, -2];
    const reach = (pts: Pt[]) => Math.min(...pts.map((q) => dist(q, corner)));
    // Pointed: the outer corner reached; capped: cut off half a width out from the corner point;
    // round: never further than half a width from it.
    expect(reach(satin(L, 4))).toBeLessThan(0.3);
    const cap = satin(L, 4, { corner: 'cap' });
    expect(reach(cap)).toBeGreaterThan(Math.SQRT2 * 2 - 2 * Math.cos(Math.PI / 4) - 0.2);
    expect(cap.filter(([x, y]) => x > 20 && y < 0).every(([x, y]) => x - 20 + (0 - y) <= 2 * Math.SQRT2 + 0.05)).toBe(true);
    const round = satin(L, 4, { corner: 'round' });
    expect(round.filter(([x, y]) => x > 20 && y < 0).every((q) => dist(q, [20, 0]) <= 2.05)).toBe(true);
  });

  it('lapped: each side straight, the second over the end of the first', () => {
    const pts = satin(L, 4, { corner: 'overlap' });
    // The first side square to its line up to the far edge of the second (x 22), the second from
    // its far edge (y -2): no stitch turns across the corner.
    const stitches = pts.slice(1).map((q, i) => [q[0] - pts[i][0], q[1] - pts[i][1]] as Pt).filter((v) => Math.hypot(...v) > 1);
    // Every stitch square across one side or the other, one stitch on between them.
    expect(stitches.filter(([dx, dy]) => Math.min(Math.abs(dx), Math.abs(dy)) > Math.hypot(dx, dy) / 4).length).toBeLessThanOrEqual(1);
    // The last stitch across the first side lies before the first across the second.
    const lastV = stitches.map(([dx, dy]) => Math.abs(dy) > Math.abs(dx)).lastIndexOf(true);
    const firstH = stitches.findIndex(([dx, dy]) => Math.abs(dx) > Math.abs(dy));
    expect(lastV).toBeLessThan(firstH);
    expect(Math.max(...pts.map(([x]) => x))).toBeCloseTo(22, 1);
  });

  it('keep a closed line closed, its corners all treated', () => {
    const p = parsePath('M0 0 L20 0 L20 20 L0 20 Z', ID).paths[0];
    const r = strokeRails(flatten(p), true, 4, 'round');
    expect(dist(r.left[0], r.left[r.left.length - 1])).toBeLessThan(1e-9);
    // Rounded outside at all four corners: nothing beyond half a width from the corner point.
    const pts = satin('M0 0 L20 0 L20 20 L0 20 Z', 4, { corner: 'round' });
    for (const c of [[0, 0], [20, 0], [20, 20], [0, 20]] as Pt[]) {
      const out = pts.filter(([x, y]) => (x - c[0]) * (c[0] - 10) > 0 && (y - c[1]) * (c[1] - 10) > 0);
      expect(out.every((q) => dist(q, c) <= 2.05)).toBe(true);
    }
  });
});

describe('satin ends', () => {
  const line = 'M0 0 L20 0';
  it('end flat, half a width on square, or half round', () => {
    expect(Math.min(...satin(line, 4).map(([x]) => x))).toBeGreaterThan(-0.05);
    expect(Math.min(...satin(line, 4, { ends: 'square' }).map(([x]) => x))).toBeCloseTo(-2, 1);
    const round = satin(line, 4, { ends: 'round' });
    const tip = round.filter(([x]) => x < 0);
    expect(tip.length).toBeGreaterThan(3);
    expect(tip.every((q) => dist(q, [0, 0]) <= 2.05)).toBe(true);
    expect(Math.max(...round.map(([x]) => x))).toBeGreaterThan(21);
  });

  it('come from an SVG stroke and are kept with the line', () => {
    const st = lineStitchFor(3, 0.15, { ends: 'round', corner: 'cap', underCross: true });
    expect(st).toMatchObject({ type: 'satin', ends: 'round', corner: 'cap', underCross: true });
    // The defaults are not written down.
    expect(lineStitchFor(3, 0.15, { ends: 'flat', corner: 'miter' })).toEqual({ type: 'satin', width: 3, tolerance: 0.15 });
    expect(isLineStitch(st)).toBe(true);
    expect(isLineStitch({ ...st, corner: 'bevel' })).toBe(false);
    expect(isLineStitch({ ...st, ends: 'butt' })).toBe(false);
    // Sewn both ways round, the ends stay round at both ends.
    const form = parsePath(line, ID);
    const there = lineStitches(form, st).flat();
    const back = lineStitches(form, st, true).flat();
    for (const pts of [there, back]) {
      expect(Math.min(...pts.map(([x]) => x))).toBeLessThan(-1);
      expect(Math.max(...pts.map(([x]) => x))).toBeGreaterThan(21);
    }
  });
});
