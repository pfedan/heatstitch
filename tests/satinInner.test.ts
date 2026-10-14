import { describe, expect, it } from 'vitest';
import { buildRegion, type Region } from '../src/digitize/region';
import { medialAxis } from '../src/digitize/medial';
import { inside } from '../src/digitize/rungs';
import { planInner } from '../src/digitize/satinInner';
import { columnsAlong, suggestSatin } from '../src/digitize/satinSuggest';
import type { Pt } from '../src/digitize/skeleton';
import { satinRuns, travelOf, type Rails, type SatinSettings } from '../src/model/restitch';
import { inChainOrder } from '../src/model/reshape';

const PX = 0.1;
const W = 500;

/** A region from a test on pixel centers (mm), in a 50 × 50 mm window. */
function region(f: (x: number, y: number) => boolean): Region {
  const comp = new Int32Array(W * W);
  let [minX, minY, maxX, maxY] = [W, W, 0, 0];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!f((x + 0.5) * PX, (y + 0.5) * PX)) continue;
      comp[y * W + x] = 1;
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  return buildRegion(comp, new Uint8Array(W * W), W, 1, 1, { minX, minY, maxX, maxY }, W, PX, 0, () => false);
}
const area = (outside: Pt[], holes: Pt[][] = []) => region((x, y) => inside(outside, [x, y]) && !holes.some((h) => inside(h, [x, y])));

/** A five-pointed star `size` mm wide (tip to tip), its points R from the middle and its notches at 0.382 R. */
const star = (cx: number, cy: number, size: number): Pt[] => {
  const R = size / 2 / Math.cos((18 * Math.PI) / 180);
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.382 * R : R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });
};
const circle = (cx: number, cy: number, r: number, n = 90): Pt[] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as Pt);
/** A block U: legs 12 mm wide, a bar 10 mm high, 40 × 30 mm. */
const U: Pt[] = [[5, 5], [45, 5], [45, 35], [33, 35], [33, 15], [17, 15], [17, 35], [5, 35]];
/** A blob with three holes. */
const blob = (): { outside: Pt[]; holes: Pt[][] } => ({
  outside: Array.from({ length: 120 }, (_, i) => {
    const t = (2 * Math.PI * i) / 120;
    const r = 17 + 3 * Math.cos(3 * t);
    return [25 + r * Math.cos(t), 25 + r * Math.sin(t)] as Pt;
  }),
  holes: [0, 1, 2].map((k) => circle(25 + 8 * Math.cos((2 * Math.PI * k) / 3 + 1), 25 + 8 * Math.sin((2 * Math.PI * k) / 3 + 1), 2.5, 36)),
});

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: true, underlay: true, tolerance: 0.15 };

/** The suggestion for an area, its columns in sewing order and how they are sewn. */
function sewn(r: Region) {
  const s = suggestSatin(r)!;
  const made = s.ok ? columnsAlong(r, s.lines, s.cuts) : null;
  const columns: Rails[] = made && 'columns' in made ? inChainOrder(made.columns, SATIN) : [];
  return { s, columns, runs: columns.length ? satinRuns(columns, SATIN) : [] };
}

/** The longest stitch of runs (mm). */
const longest = (runs: Pt[][]) => Math.max(...runs.flatMap((r) => r.slice(1).map((p, i) => Math.hypot(p[0] - r[i][0], p[1] - r[i][1]))));

describe('medial axis on the vector outline', () => {
  it('finds the five arms of a star meeting in its middle', () => {
    const ax = medialAxis([star(25, 25, 38)]);
    expect(ax.branches.length).toBe(5);
    const hub = ax.nodes.find((n) => ax.branches.filter((b) => b.a === ax.nodes.indexOf(n) || b.b === ax.nodes.indexOf(n)).length === 5)!;
    expect(Math.hypot(hub.p[0] - 25, hub.p[1] - 25)).toBeLessThan(0.3);
    // The largest circle in the middle touches the five notches.
    expect(hub.r).toBeCloseTo(0.382 * (19 / Math.cos((18 * Math.PI) / 180)), 0);
  });

  it('prunes the corners of a rectangle and keeps the corners of a U as bends', () => {
    const rect = medialAxis([[[0, 0], [20, 0], [20, 10], [0, 10]]]);
    expect(rect.branches.length).toBe(1);
    const u = medialAxis([U]);
    expect(u.branches.length).toBe(3);
    // The two top corners are bends that remember the corner outside.
    expect(u.nodes.filter((n) => n.tips.length).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps one loop round each hole', () => {
    const ring = medialAxis([circle(25, 25, 15)], [circle(25, 25, 8)]);
    expect(ring.branches.length).toBe(1);
    expect(ring.branches[0].a).toBe(ring.branches[0].b);
    // The loop runs in the middle of the ring.
    for (const p of ring.branches[0].pts) expect(Math.abs(Math.hypot(p[0] - 25, p[1] - 25) - 11.5)).toBeLessThan(0.2);
    const { outside, holes } = blob();
    const ax = medialAxis([outside], holes);
    // Euler: the axis of an area with three holes has three independent loops.
    expect(ax.branches.length - ax.nodes.length + 1).toBe(3);
  });

  it('gives the same axis mirrored', () => {
    const a = medialAxis([star(25, 25, 38)]);
    const b = medialAxis([star(25, 25, 38).map(([x, y]) => [50 - x, y] as Pt).reverse()]);
    expect([b.nodes.length, b.branches.length]).toEqual([a.nodes.length, a.branches.length]);
  });
});

describe('satin over a whole area along its axis', () => {
  it('sews a 38 mm star as five arms and a middle, in one run', () => {
    const { s, columns, runs } = sewn(area(star(25, 25, 38)));
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('parts');
    expect(s.cuts.length).toBe(5);
    expect(columns.length).toBe(6);
    // One run without trims: the way between the columns stays under later ones.
    expect(runs.length).toBe(1);
    const t = travelOf(columns, SATIN);
    expect(t.visible).toBeLessThan(1);
  });

  it('stitches each arm of the star across it', () => {
    const plan = planInner([star(25, 25, 38)], [], 7)!;
    // Lines across an arm stand square to the line from the middle to its point.
    const tips = star(25, 25, 38).filter((_, i) => i % 2 === 0);
    for (const [a, b] of plan.lines) {
      const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (Math.hypot(m[0] - 25, m[1] - 25) < 9) continue;
      const tip = tips.reduce((best, t) => (Math.hypot(t[0] - m[0], t[1] - m[1]) < Math.hypot(best[0] - m[0], best[1] - m[1]) ? t : best));
      const axis: Pt = [tip[0] - 25, tip[1] - 25];
      const d: Pt = [b[0] - a[0], b[1] - a[1]];
      const cos = Math.abs(axis[0] * d[0] + axis[1] * d[1]) / Math.hypot(...axis) / Math.hypot(...d);
      expect(cos).toBeLessThan(0.1);
    }
  });

  it('cuts a block U on the miter at its two corners', () => {
    const { s, columns, runs } = sewn(area(U));
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('parts');
    expect(s.cuts.length).toBe(2);
    expect(columns.length).toBe(3);
    expect(runs.length).toBe(1);
    // Each cut runs from an outer corner to the inner one.
    for (const [a, b] of s.cuts) {
      const outer = [a, b].some((p) => Math.hypot(p[0] - 5, p[1] - 5) < 0.6 || Math.hypot(p[0] - 45, p[1] - 5) < 0.6);
      const inner = [a, b].some((p) => Math.hypot(p[0] - 17, p[1] - 15) < 0.6 || Math.hypot(p[0] - 33, p[1] - 15) < 0.6);
      expect(outer && inner).toBe(true);
    }
  });

  it('sews a wide ring as one column round it', () => {
    const { s, columns, runs } = sewn(area(circle(25, 25, 15), [circle(25, 25, 5)]));
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('parts');
    expect(columns.length).toBe(1);
    expect(runs.length).toBe(1);
    // Stitches across the ring, not along: none longer than its width and a little more.
    expect(longest(satinRuns(columns, { ...SATIN, underlay: false }))).toBeLessThan(10.6);
  });

  it('cuts a blob with three holes into columns sewn in one run', () => {
    const { outside, holes } = blob();
    const { s, columns, runs } = sewn(area(outside, holes));
    expect(s.ok).toBe(true);
    expect(columns.length).toBeGreaterThanOrEqual(3);
    expect(runs.length).toBe(1);
  });

  it('leaves a disc and a square to the fill', () => {
    expect(planInner([circle(25, 25, 12)], [], 7)).toBeNull();
    expect(planInner([[[5, 5], [35, 5], [35, 35], [5, 35]]], [], 7)).toBeNull();
  });
});
