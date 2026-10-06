import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripsOfAreas, stripsOfOutline } from '../src/digitize/rungs';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { forget, keepShape, remember, remembered, rememberedIn, restoreRemembered, satinRuns, type Rails } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { transformRemembered } from '../src/model/transform';
import { parsePattern } from '../src/parsers';
import { RungTool } from '../src/ui/rungTool';

/** Points every ~0.5 mm along the corners given. */
function poly(...corners: Pt[]): Pt[] {
  const out: Pt[] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const [a, b] = [corners[i - 1], corners[i]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** An m as a fill (y up): three legs 4 mm wide under a bar 4 mm high. */
const M = poly([0, 0], [4, 0], [4, 16], [13, 16], [13, 0], [17, 0], [17, 16], [26, 16], [26, 0], [30, 0], [30, 20], [0, 20], [0, 0]);
const CUTS: [Pt, Pt][] = [
  [[-1, 16], [5, 16]],
  [[12, 16], [18, 16]],
  [[25, 16], [31, 16]],
];
const LINES: [Pt, Pt][] = [
  [[-1, 8], [5, 8]],
  [[12, 8], [18, 8]],
  [[25, 8], [31, 8]],
  [[15, 15], [15, 21]],
];

/** The m sewn as satin from the fill, as sewAlongLines makes it. */
function cutM(): Rails[] {
  const made = stripsOfOutline(M, LINES, CUTS);
  const cols: Rails[] = made.strips.map((r) => ({ ...r, chain: 0 }));
  cols[0].split = { outlines: [M], holes: [], cuts: CUTS.map(([a, b]) => [a, b] as [Pt, Pt]) };
  return cols;
}

const centreY = (r: Rails) => [...r.left, ...r.right].reduce((a, p) => a + p[1], 0) / (r.left.length + r.right.length);

describe('cut lines of a satin cut from a fill', () => {
  it('show again on the satin and cut the fill anew when moved', () => {
    const changes: Rails[][][] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: () => {} });
    tool.openSatin([cutM()]);
    expect(tool.cutLines.length).toBe(3);
    const before = tool.columns.map((c) => c.rails);
    // The left end of the first cut line moved down 4 mm: the first leg ends lower, the bar is longer there.
    tool.down(-1, 16, 10);
    tool.dragTo(-1, 12);
    tool.up();
    expect(changes.length).toBe(1);
    const cols = changes[0][0];
    expect(cols.length).toBe(4);
    expect(cols.filter((c) => c.split).length).toBe(1);
    expect(cols.find((c) => c.split)!.split!.cuts[0][0]).toEqual([-1, 12]);
    // Same order as before: each part where its old one was, all still one chain.
    cols.forEach((c, k) => expect(Math.abs(centreY(c) - centreY(before[k]))).toBeLessThan(2.5));
    expect(cols.every((c) => c.chain === 0)).toBe(true);
    // The tool shows the new parts and the moved line.
    expect(tool.cutLines[0][0]).toEqual([-1, 12]);
  });

  it('keeps the stitches and shows the hole when the cut line opening it is removed', () => {
    const square = (x0: number, y0: number, x1: number, y1: number) => poly([x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]);
    const O = square(0, 0, 20, 20);
    const H = square(5, 5, 15, 15);
    const cut: [Pt, Pt] = [[-1, 10], [6, 10]];
    const made = stripsOfOutline(O, [[[10, 21], [10, 14]], [[14, 10], [21, 10]], [[10, -1], [10, 6]]], [cut], [H]);
    expect(made.strips.length).toBe(1);
    const changes: Rails[][][] = [];
    const said: string[] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: (k) => said.push(k) });
    tool.openSatin([[{ ...made.strips[0], chain: 0, split: { outlines: [O], holes: [H], cuts: [cut] } }]]);
    tool.down(-0.5, 10, 10);
    tool.up();
    expect(tool.deleteSelected()).toBe(true);
    expect(changes.length).toBe(0);
    expect(tool.bad).toBe(H);
    expect(said).toEqual(['stitch.draw.openHole']);
  });

  it('a new cut line drawn on the satin cuts the fill too, once the new part has a rung', () => {
    const changes: Rails[][][] = [];
    const said: string[] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: (k) => said.push(k) });
    tool.openSatin([cutM()]);
    const draw = (a: Pt, b: Pt) => {
      tool.down(a[0], a[1], 10);
      tool.dragTo(b[0], b[1]);
      tool.up();
    };
    // Across the first leg, below its rung: the foot has no rung yet.
    tool.setCutMode(true);
    draw([-0.5, 4], [4.5, 4]);
    expect(changes.length).toBe(0);
    expect(said).toEqual(['stitch.draw.notStripPart']);
    expect(tool.cutLines.length).toBe(4);
    // A rung across the foot: now it fits.
    tool.setCutMode(false);
    draw([-0.5, 2], [4.5, 2]);
    expect(changes.length).toBe(1);
    expect(changes[0][0].length).toBe(5);
    expect(changes[0][0].find((c) => c.split)!.split!.cuts.length).toBe(4);
  });
});

describe('the fill a satin was cut from, with the rest of the app', () => {
  it('is stored with the project and mapped with the object, mirrors too', () => {
    const f = 'demos/letters.pes';
    const p = parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin')!;
    const shape = keepShape(p, o, kinds);
    const columns = shape.columns!.map((part) => part.map((c, k) => ({ ...c, chain: 0, ...(k ? {} : { split: { outlines: [M], holes: [M.slice(0, 5)], cuts: CUTS }, mirror: true, plan: [{ sec: 0, flip: false, trim: true, mirror: true }] }) })));
    remember(p, o, { ...shape, columns, read: false });
    try {
      const stored = JSON.parse(JSON.stringify(rememberedIn(p, objs).find((x) => x.columns)));
      forget(p, o);
      restoreRemembered([stored]);
      const split = remembered(p, o)?.columns?.flat().find((c) => c.split)?.split;
      expect(split?.outlines).toEqual([M]);
      expect(split?.holes).toEqual([M.slice(0, 5)]);
      expect(split?.cuts).toEqual(CUTS);
      // Mirrored, as a whole and in its plan.
      const first = remembered(p, o)?.columns?.flat().find((c) => c.split);
      expect(first?.mirror).toBe(true);
      expect(first?.plan).toEqual([{ sec: 0, flip: false, trim: true, mirror: true }]);
      const mirrored = transformRemembered(remembered(p, o)!, [-1, 0, 0, 1, 0, 0]).columns!.flat().find((c) => c.split)!.split!;
      expect(mirrored.cuts[0]).toEqual([[1, 16], [-5, 16]]);
      expect(mirrored.outlines[0][1][0]).toBeCloseTo(-M[1][0]);
    } finally {
      forget(p, o);
    }
  });
});

describe('the far end of a part', () => {
  it('is sewn to its edge: the rails of a long leg reach its foot', () => {
    // A stem 4 mm wide and 14 mm long, its rung near the top, the bowl cut off at its side.
    const R = poly([0, 0], [4, 0], [4, 10], [8, 10], [8, 14], [0, 14], [0, 0]);
    const made = stripsOfOutline(R, [[[-1, 13], [5, 13]], [[6, 9], [6, 15]]], [[[4, 9], [4, 15]]]);
    expect(made.bad).toBe(-1);
    const stem = made.strips.find((s) => [...s.left, ...s.right].every((p) => p[0] <= 4.01))!;
    const low = (r: Pt[]) => Math.min(r[0][1], r[r.length - 1][1]);
    // Its foot at y 0: both rails go down to it (5 % of the leg would leave 0.7 mm).
    expect(low(stem.left)).toBeLessThan(0.2);
    expect(low(stem.right)).toBeLessThan(0.2);
  });
});

describe('areas apart, as the dot and the stem of an i', () => {
  const stem = poly([0, 0], [3, 0], [3, 10], [0, 10], [0, 0]);
  const dot = poly([0, 12], [3, 12], [3, 15], [0, 15], [0, 12]);

  it('each make columns of their own, a trim between them', () => {
    const made = stripsOfAreas([stem, dot], [[[-1, 5], [4, 5]], [[-1, 13.5], [4, 13.5]]], []);
    expect(made.bad).toBeNull();
    expect(made.areas.map((a) => a.length)).toEqual([1, 1]);
    const cols: Rails[] = made.areas.flatMap((strips, a) => strips.map((r) => ({ ...r, chain: a })));
    // Two chains: two runs, the machine trims between them.
    expect(satinRuns(cols, { spacing: 0.4, edge: 0, short: false, underlay: true, tolerance: 0.15 }).length).toBe(2);
  });

  it('say the area that has no line across it', () => {
    const made = stripsOfAreas([stem, dot], [[[-1, 5], [4, 5]]], []);
    expect(made.bad).not.toBeNull();
    expect(Math.min(...made.bad!.map((p) => p[1]))).toBeGreaterThan(11);
  });
});
