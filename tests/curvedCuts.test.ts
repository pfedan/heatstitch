import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cutLine, cutPath, partsOf, stripsOfAreas, stripsOfOutline } from '../src/digitize/rungs';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { forget, keepShape, remember, remembered, rememberedIn, restoreRemembered, type Rails } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { transformRemembered } from '../src/model/transform';
import { parsePattern } from '../src/parsers';
import { RungTool } from '../src/ui/rungTool';
import { strayRails } from './helpers/torture';

/** Area of a closed outline (absolute). */
const area = (r: Pt[]) => {
  let a = 0;
  for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1];
  return Math.abs(a / 2);
};

/** A leaf bent along an arc (radius 30 mm round (0, -30)), 12 mm wide in the middle, pointed at both ends. */
const R = 30;
const SPAN = 0.6;
const vein = (t: number): Pt => {
  const th = -SPAN + 2 * SPAN * t;
  return [R * Math.sin(th), R * Math.cos(th) - R];
};
const normal = (t: number): Pt => {
  const th = -SPAN + 2 * SPAN * t;
  return [Math.sin(th), Math.cos(th)];
};
const halfWidth = (t: number) => 6 * Math.pow(Math.sin(Math.PI * t), 0.8);
const LEAF: Pt[] = (() => {
  const n = 120;
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const [x, y] = vein(t);
    const [nx, ny] = normal(t);
    out.push([x + nx * halfWidth(t), y + ny * halfWidth(t)]);
  }
  for (let k = n - 1; k >= 1; k--) {
    const t = k / n;
    const [x, y] = vein(t);
    const [nx, ny] = normal(t);
    out.push([x - nx * halfWidth(t), y - ny * halfWidth(t)]);
  }
  out.push(out[0]);
  return out;
})();

/** The vein as a Trennlinie: three points on it, drawn a little short of the tips. */
const VEIN_CUT: Pt[] = [vein(0.04), vein(0.5), vein(0.96)];

/** Distance from q to the vein (the arc). */
const offVein = (q: Pt) => Math.abs(Math.hypot(q[0], q[1] + R) - R);

/** Lines across each half of the leaf, from the vein out to its edge, slanted towards the tip (as a leaf's satin is). */
const ACROSS: [Pt, Pt][] = [0.2, 0.35, 0.5, 0.65, 0.8].flatMap((t) => {
  const v = vein(t);
  const out = vein(Math.min(1, t + 0.05));
  const [nx, ny] = normal(t);
  const w = halfWidth(t) * 0.7;
  return [1, -1].map((s) => [v, [out[0] + nx * w * s, out[1] + ny * w * s]] as [Pt, Pt]);
});

describe('bent cut lines (Trennlinien)', () => {
  it('a straight cut line is cut along as it is', () => {
    const c: Pt[] = [
      [0, 0],
      [5, 5],
    ];
    expect(cutLine(c)).toBe(c);
    expect(cutPath(c).nodes.every((n) => !n.smooth)).toBe(true);
  });

  it('bends smoothly through its points, round at the middle ones', () => {
    const p = cutPath(VEIN_CUT);
    expect(p.nodes.map((n) => n.smooth)).toEqual([false, true, false]);
    const line = cutLine(VEIN_CUT);
    expect(line.length).toBeGreaterThan(20);
    // Through the three points on the arc, close to the arc in between.
    expect(Math.max(...line.map(offVein))).toBeLessThan(0.3);
  });

  it('works out the curve anew when its points move in place', () => {
    const c: Pt[] = [
      [0, 0],
      [5, 2],
      [10, 0],
    ];
    const before = cutLine(c).map((p) => [p[0], p[1]]);
    c[1] = [5, 4];
    const after = cutLine(c);
    expect(Math.max(...after.map((p) => p[1]))).toBeGreaterThan(Math.max(...before.map((p) => p[1])) + 1);
  });

  it('cuts a leaf along its bent vein into two halves', () => {
    const p = partsOf(LEAF, [VEIN_CUT]);
    expect(p.parts.length).toBe(2);
    // The edge between the halves follows the vein, not a straight line from tip to stem.
    expect(p.edges[0].length).toBeGreaterThan(20);
    expect(Math.max(...p.edges[0].map(offVein))).toBeLessThan(0.3);
    const [a, b] = p.parts.map(area);
    expect(Math.abs(a + b - area(LEAF))).toBeLessThan(1e-6 * area(LEAF) + 1e-3);
    // Each half as large as the area between the vein and its edge (the outer half is larger).
    const half = (side: number) => {
      const ring: Pt[] = [];
      for (let k = 0; k <= 120; k++) {
        const t = k / 120;
        const [x, y] = vein(t);
        const [nx, ny] = normal(t);
        ring.push([x + nx * halfWidth(t) * side, y + ny * halfWidth(t) * side]);
      }
      for (let k = 119; k >= 0; k--) ring.push(vein(k / 120));
      return area(ring);
    };
    const want = [half(1), half(-1)].sort((x, y) => x - y);
    [a, b].sort((x, y) => x - y).forEach((x, i) => expect(Math.abs(x - want[i]) / want[i]).toBeLessThan(0.01));
  });

  it('sews each half as satin from the vein out to the edge', () => {
    const made = stripsOfAreas([LEAF], ACROSS, [VEIN_CUT]);
    expect(made.bad).toBeNull();
    expect(made.hole).toBe(-1);
    const strips = made.areas.flat();
    expect(strips.length).toBe(2);
    for (const s of strips) {
      // One rail is the vein (away from the pointed ends, where both rails meet).
      const inner = (rail: Pt[]) => rail.slice(Math.floor(rail.length * 0.15), Math.ceil(rail.length * 0.85));
      const onVein = [s.left, s.right].map((r) => Math.max(...inner(r).map(offVein)));
      expect(Math.min(...onVein)).toBeLessThan(0.35);
      expect(Math.max(...onVein)).toBeGreaterThan(2);
    }
  });

  it('a straight cut line drawn as three points in a row cuts as the straight one', () => {
    const square: Pt[] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
      [0, 0],
    ];
    const straight = partsOf(square, [
      [
        [10, -1],
        [10, 11],
      ],
    ]);
    const three = partsOf(square, [
      [
        [10, -1],
        [10, 5],
        [10, 11],
      ],
    ]);
    expect(three.parts.map(area).sort()).toEqual(straight.parts.map(area).sort().map((a) => expect.closeTo(a, 6)));
  });

  it('opens a hole along a bent cut line from the edge', () => {
    const square = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ];
    const O = square(0, 0, 20, 20);
    const H = square(7, 7, 13, 13);
    // From the left edge in an arch down into the hole.
    const cut: Pt[] = [
      [1, 15],
      [5, 17],
      [9, 12],
    ];
    const p = partsOf(O, [cut], [H]);
    expect(p.open.length).toBe(0);
    expect(p.edges[0].length).toBeGreaterThan(5);
    // The ring now goes round the hole too: its area is the square's less the hole's.
    expect(area(p.parts[0])).toBeCloseTo(400 - 36, 3);
    const made = stripsOfOutline(O, [[[10, 21], [10, 12]], [[12, 10], [21, 10]], [[10, -1], [10, 8]]], [cut], [H]);
    expect(made.hole).toBe(-1);
    expect(made.strips.length).toBe(1);
  });
});

function tool(changes: Rails[][][] = [], said: string[] = []) {
  return new RungTool({ change: (c, final) => final && changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: (k) => said.push(k) });
}

describe('bending a cut line in the satin tool', () => {
  it('on a fill: dragged in its middle it bends there, Entf on that point straightens it again', () => {
    const t = tool();
    t.openFill(LEAF, { outlines: [LEAF], holes: [] });
    // Drawn as a straight line from near the tip to near the stem.
    const [a, b] = [vein(0.04), vein(0.96)];
    t.down(...a, 20, true);
    t.dragTo(...b);
    t.up();
    expect(t.cutLines.length).toBe(1);
    expect(t.cutLines[0].length).toBe(2);
    // Grabbed in its middle and pulled onto the vein.
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    t.down(...m, 20);
    t.dragTo(...vein(0.5));
    t.up();
    expect(t.cutLines[0]).toEqual([a, vein(0.5), b]);
    expect(t.selected).toEqual({ col: -1, i: 0, end: -1, cut: true, node: 1 });
    // A click alone (no drag) on the line adds no point.
    const q = cutLine(t.cutLines[0])[10];
    t.down(...q, 20);
    t.up();
    expect(t.cutLines[0].length).toBe(3);
    // The point it bends at, picked and deleted: straight again.
    t.selected = { col: -1, i: 0, end: -1, cut: true, node: 1 };
    expect(t.deleteSelected()).toBe(true);
    expect(t.cutLines[0]).toEqual([a, b]);
  });

  it('on a satin cut from an area: the area is cut anew along the bent line, as one change', () => {
    // A bar 30 x 10 cut across in the middle, a line across each half along it.
    const bar: Pt[] = [
      [0, 0],
      [30, 0],
      [30, 10],
      [0, 10],
      [0, 0],
    ];
    const cut: Pt[] = [
      [15, -1],
      [15, 11],
    ];
    const lines: [Pt, Pt][] = [
      [[5, 5], [12, 5]],
      [[18, 5], [25, 5]],
    ];
    const made = stripsOfAreas([bar], lines, [cut]);
    const cols: Rails[] = made.areas.flat().map((r) => ({ ...r, chain: 0 }));
    cols[0].split = { outlines: [bar], holes: [], cuts: [cut] };
    const changes: Rails[][][] = [];
    const t = tool(changes);
    t.openSatin([cols]);
    // Grabbed beside its middle, where a part's controls are (where its satin starts).
    t.down(15, 3, 20);
    t.dragTo(18, 5);
    t.up();
    expect(changes.length).toBe(1);
    const now = changes[0][0];
    expect(now.length).toBe(2);
    expect(now.find((c) => c.split)!.split!.cuts).toEqual([[[15, -1], [18, 5], [15, 11]]]);
    // The parts meet along the curve: the left one reaches past x = 15 in the middle, its edge on the cut line.
    const xs = now.flatMap((c) => [...c.left, ...c.right]).filter((q) => Math.abs(q[1] - 5) < 0.3).map((q) => q[0]);
    expect(Math.max(...xs.filter((x) => x < 25 && x > 10))).toBeGreaterThan(17.5);
    expect(strayRails(now)).toBe(0);
  });

  it('on the leaf: the point a cut line bends at dragged onto the vein, each half sews out from the vein', () => {
    // Bent, but not quite on the vein yet: its middle 1.5 mm inside.
    const off: Pt = [vein(0.5)[0], vein(0.5)[1] - 1.5];
    const start: Pt[] = [vein(0.04), off, vein(0.96)];
    const made = stripsOfAreas([LEAF], ACROSS, [start]);
    expect(made.bad).toBeNull();
    const cols: Rails[] = made.areas.flat().map((r) => ({ ...r, chain: 0 }));
    cols[0].split = { outlines: [LEAF], holes: [], cuts: [start] };
    const changes: Rails[][][] = [];
    const t = tool(changes);
    t.openSatin([cols]);
    t.down(...off, 20);
    t.dragTo(...vein(0.5));
    t.up();
    expect(changes.length).toBe(1);
    const now = changes[0][0];
    expect(now.find((c) => c.split)!.split!.cuts[0]).toEqual(VEIN_CUT);
    for (const c of now) {
      const inner = (rail: Pt[]) => rail.slice(Math.floor(rail.length * 0.15), Math.ceil(rail.length * 0.85));
      expect(Math.min(...[c.left, c.right].map((r) => Math.max(...inner(r).map(offVein))))).toBeLessThan(0.35);
    }
    expect(strayRails(now)).toBe(0);
  });

  it('a satin with a bent cut line is stored with the project and mirrored with the object', () => {
    const f = 'demos/letters.pes';
    const p = parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin')!;
    const shape = keepShape(p, o, kinds);
    const bent: Pt[][] = [VEIN_CUT, [[0, 0], [1, 1]]];
    const columns = shape.columns!.map((part) => part.map((c, k) => ({ ...c, chain: 0, ...(k ? {} : { split: { outlines: [LEAF], holes: [], cuts: bent } }) })));
    remember(p, o, { ...shape, columns, read: false });
    try {
      const stored = JSON.parse(JSON.stringify(rememberedIn(p, objs)));
      forget(p, o);
      restoreRemembered(p, stored);
      const split = remembered(p, o)?.columns?.flat().find((c) => c.split)?.split;
      expect(split?.cuts).toEqual(bent);
      const mirrored = transformRemembered(remembered(p, o)!, [-1, 0, 0, 1, 0, 0]).columns!.flat().find((c) => c.split)!.split!;
      expect(mirrored.cuts[0].map(([x, y]) => [x, y])).toEqual(VEIN_CUT.map(([x, y]) => [-x === 0 ? 0 : -x, y]));
    } finally {
      forget(p, o);
    }
  });

  it('straight cut lines are stored as before (four numbers each, nothing more)', () => {
    const f = 'demos/letters.pes';
    const p = parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin')!;
    const shape = keepShape(p, o, kinds);
    const columns = shape.columns!.map((part) => part.map((c, k) => ({ ...c, chain: 0, ...(k ? {} : { split: { outlines: [LEAF], holes: [], cuts: [[[0, 0], [1, 1]] as Pt[]] } }) })));
    remember(p, o, { ...shape, columns, read: false });
    try {
      const json = JSON.stringify(rememberedIn(p, objs));
      expect(json).toContain('"cuts":[0,0,1,1]');
      expect(json).not.toContain('"points"');
    } finally {
      forget(p, o);
    }
  });
});
