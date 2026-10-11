import { describe, expect, it } from 'vitest';
import { pairs, type Column } from '../src/digitize/satin';
import type { Pt } from '../src/digitize/skeleton';

/** A column `w` wide bending round a half circle, its inner rail at radius `r` (its left one). */
function bend(r: number, w: number): Column {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const center: Pt[] = [];
  for (let a = 0; a <= Math.PI + 1e-9; a += 0.002) {
    const u: Pt = [Math.cos(a), Math.sin(a)];
    left.push([u[0] * r, u[1] * r]);
    right.push([u[0] * (r + w), u[1] * (r + w)]);
    center.push([u[0] * (r + w / 2), u[1] * (r + w / 2)]);
  }
  return { center, left, right, width: w };
}

/** How far each pair's left point lies in from the inner rail, as a share of the width. */
const insets = (_c: Column, ps: [Pt, Pt][], r: number) => ps.map(([a, b]) => (Math.hypot(a[0], a[1]) - r) / Math.max(1e-9, Math.hypot(b[0], b[1]) - r));

describe('short stitches', () => {
  const P = { spacing: 0.4, pull: 0, splitMm: 12 };

  it('take turns at 15 and 30 % in a tight curve, so the points spread over three lines', () => {
    const c = bend(1, 5);
    const k = insets(c, pairs(c, P), 1);
    const at = (v: number) => k.filter((x) => Math.abs(x - v) < 0.01).length;
    expect(at(0)).toBeGreaterThan(5);
    expect(at(0.15)).toBeGreaterThan(5);
    expect(at(0.3)).toBeGreaterThan(5);
    // On each line the points keep apart at least as far as the plain rail's would.
    for (const v of [0.15, 0.3]) {
      const line = pairs(c, P).filter((_, i) => Math.abs(k[i] - v) < 0.01).map(([a]) => a);
      for (let i = 1; i < line.length; i++) expect(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])).toBeGreaterThan(0.2);
    }
  });

  it('leave a gentle curve and a straight column as they are', () => {
    const c = bend(40, 4);
    expect(insets(c, pairs(c, P), 40).every((x) => x < 1e-6)).toBe(true);
  });

  it('follow the spacing on a looser satin: the inside may not get much denser than the outside', () => {
    // At 0.8 mm spacing the inner rail of a bend with 45 % of the outer radius gets points 0.36 mm
    // apart: more than 0.25 mm, yet over twice as dense as the outside.
    // (The last pair, at the very end, may come closer: not counted.)
    const n = (r: number, w: number) => insets(bend(r, w), pairs(bend(r, w), { ...P, spacing: 0.8 }), r).slice(0, -1).filter((x) => x > 0.01).length;
    expect(n(4.5, 5.5)).toBeGreaterThan(5);
    // At 55 % (0.44 mm apart) it is fine.
    expect(n(6.6, 5.4)).toBe(0);
  });

  it('can be turned off', () => {
    const c = bend(1, 5);
    expect(insets(c, pairs(c, { ...P, short: false }), 1).every((x) => x < 1e-6)).toBe(true);
  });

  it('never move in further than a third of the split length', () => {
    const c = bend(1, 12);
    const ps = pairs(c, { ...P, splitMm: 3 });
    for (const [a] of ps) expect(Math.hypot(a[0], a[1]) - 1).toBeLessThanOrEqual(1 + 1e-6);
  });
});
