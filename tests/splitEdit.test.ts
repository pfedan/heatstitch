import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cutLinesBetween, stripsOfAreas, stripsOfOutline } from '../src/digitize/rungs';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { bestChain, forget, keepShape, remember, remembered, rememberedIn, restoreRemembered, reversedRails, satinRuns, sectionView, type Rails } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { transformRemembered } from '../src/model/transform';
import { parsePattern } from '../src/parsers';
import { RungTool } from '../src/ui/rungTool';
import { strayRails } from './helpers/torture';

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

describe('Leeren on a satin cut from a fill', () => {
  const SATIN = { spacing: 0.4, edge: 0, short: false, underlay: true, tolerance: 0.15 };
  const open = () => {
    const changes: Rails[][][] = [];
    const said: string[] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: (k) => said.push(k) });
    tool.openSatin([cutM()]);
    tool.satin = SATIN;
    const draw = (a: Pt, b: Pt, cut = false) => {
      tool.setCutMode(cut);
      tool.down(a[0], a[1], 10);
      tool.dragTo(b[0], b[1]);
      tool.up();
    };
    return { tool, changes, said, draw };
  };
  /** Each edge the tool draws lies on the m's outline (no rails between its columns). */
  const onOutline = (edges: Pt[][]) => edges.flat().every(([x, y]) => M.some((q, i) => i > 0 && segDist([x, y], M[i - 1], q) < 1e-6));

  it('shows the satin by its outline and cut lines only, no rails between its columns', () => {
    const { tool } = open();
    expect(tool.columns.length).toBe(4);
    expect(tool.edges.length).toBe(1);
    expect(onOutline(tool.edges)).toBe(true);
  });

  it('leaves the area alone: no columns, no seams, nothing sewn and nothing marked', () => {
    const { tool, changes } = open();
    tool.clear();
    expect(changes.length).toBe(0);
    expect(tool.columns.length).toBe(0);
    expect(tool.cutLines.length + tool.lines.length).toBe(0);
    expect(tool.edges.length).toBe(1);
    expect(onOutline(tool.edges)).toBe(true);
    expect(tool.problems).toEqual([]);
    expect(tool.count).toBe(0);
  });

  it('sews anew once the lines drawn on the area make columns, as one change', () => {
    const { tool, changes, said, draw } = open();
    tool.clear();
    for (const [a, b] of CUTS) draw(a, b, true);
    // Cut lines alone make no column yet: shown, not said, and nothing sewn.
    expect(changes.length).toBe(0);
    expect(said).toEqual([]);
    expect(tool.problems.length).toBeGreaterThan(0);
    for (const [a, b] of LINES.slice(0, 3)) draw(a, b);
    expect(changes.length).toBe(0);
    draw(...LINES[3]);
    expect(changes.length).toBe(1);
    const part = changes[0][0];
    expect(part.length).toBe(4);
    expect(part.find((c) => c.split)!.split!.cuts.length).toBe(3);
    expect(strayRails(part)).toBe(0);
    // Back in sections, with the lines drawn as rungs of the columns.
    expect(tool.columns.length).toBe(4);
    expect(tool.lines.length).toBe(0);
    expect(tool.count).toBe(4);
  });

  it('takes Vorschlagen on the area alone', () => {
    const { tool, changes } = open();
    tool.clear();
    tool.suggestIn(LINES, CUTS);
    expect(changes.length).toBe(1);
    expect(changes[0][0].length).toBe(4);
    expect(strayRails(changes[0][0])).toBe(0);
  });

  it('a line drawn on the area alone can be taken away again', () => {
    const { tool, draw } = open();
    tool.clear();
    for (const [a, b] of CUTS) draw(a, b, true);
    draw(...LINES[0]);
    expect(tool.lines.length).toBe(1);
    expect(tool.deleteSelected()).toBe(true);
    expect(tool.lines.length).toBe(0);
    expect(tool.cutLines.length).toBe(3);
  });

  it('the torture test tells a seam left without its cut line', () => {
    const cols = cutM();
    expect(strayRails(cols)).toBe(0);
    // As Leeren left it before: the columns kept, their cut lines gone.
    cols[0].split = { ...cols[0].split!, cuts: [] };
    expect(strayRails(cols)).toBeGreaterThan(0);
  });
});

describe('a satin of several pieces (as read from a stitch file)', () => {
  const SATIN = { spacing: 0.4, edge: 0, short: false, underlay: true, tolerance: 0.15 };
  /** A bar 4 mm wide beside the m, as a second piece. */
  const BAR = poly([40, 0], [44, 0], [44, 20], [40, 20], [40, 0]);
  const BAR_LINES: [Pt, Pt][] = [
    [[39, 5], [45, 5]],
    [[39, 15], [45, 15]],
  ];
  const bar = (): Rails[] => {
    const made = stripsOfOutline(BAR, BAR_LINES, []);
    return [{ ...made.strips[0], chain: 0, split: { outlines: [BAR], holes: [], cuts: [] } }];
  };
  const open = () => {
    const changes: Rails[][][] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: () => {} });
    tool.openSatin([cutM(), bar()]);
    tool.satin = SATIN;
    const draw = (a: Pt, b: Pt, cut = false) => {
      tool.setCutMode(cut);
      tool.down(a[0], a[1], 10);
      tool.dragTo(b[0], b[1]);
      tool.up();
    };
    return { tool, changes, draw };
  };

  it('opens with every piece in sections of its own area, no rails', () => {
    // Read from stitches: no areas known yet.
    const read = [cutM(), bar()].map((part) => part.map(({ split: _s, ...c }) => c));
    const view = sectionView(read, undefined);
    expect(view.every((part) => part.some((c) => c.split))).toBe(true);
    const { tool } = open();
    expect(tool.sectionParts).toEqual([0, 1]);
    expect(tool.edges.length).toBe(2);
  });

  it('gives each piece its own cut lines: one drawn on the bar cuts the bar only', () => {
    const { changes, draw } = open();
    draw([39, 10], [45, 10], true);
    expect(changes.length).toBe(1);
    const [m, b] = changes[0];
    expect(m.length).toBe(4);
    expect(m.find((c) => c.split)!.split!.cuts.length).toBe(3);
    expect(b.length).toBe(2);
    expect(b.find((c) => c.split)!.split!.cuts.length).toBe(1);
    expect(strayRails(b)).toBe(0);
  });

  it('Leeren clears every piece; lines on one piece sew it, the other stays as sewn', () => {
    const { tool, changes, draw } = open();
    const sewnM = cutM();
    tool.clear();
    expect(tool.columns.length).toBe(0);
    expect(tool.edges.length).toBe(2);
    expect(changes.length).toBe(0);
    draw(...BAR_LINES[0]);
    expect(changes.length).toBe(1);
    const [m, b] = changes[0];
    expect(m.map((c) => c.left)).toEqual(sewnM.map((c) => c.left));
    expect(b.length).toBe(1);
    // The m stays cleared in the tool: only its area, until lines are drawn on it.
    expect(tool.columns.length).toBe(1);
    expect(tool.edges.length).toBe(2);
  });

  it('Vorschlagen on all pieces is one change', () => {
    const { tool, changes } = open();
    tool.clear();
    expect(tool.suggestParts([
      { part: 0, lines: LINES, cuts: CUTS },
      { part: 1, lines: BAR_LINES, cuts: [] },
    ])).toBe(true);
    expect(changes.length).toBe(1);
    expect(changes[0][0].length).toBe(4);
    expect(changes[0][1].length).toBe(1);
    expect(tool.columns.length).toBe(5);
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
      const stored = JSON.parse(JSON.stringify(rememberedIn(p, objs)));
      forget(p, o);
      restoreRemembered(p, stored);
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

describe('the way between the parts of a chain', () => {
  it('runs along the middle of a column in running stitches, not a stitch at every point', () => {
    // A U cut at both legs: the way from one leg to the other goes along the bar.
    const U = poly([0, 0], [14, 0], [14, 16], [10, 16], [10, 4], [4, 4], [4, 16], [0, 16], [0, 0]);
    const made = stripsOfOutline(U, [[[-1, 10], [5, 10]], [[9, 10], [15, 10]], [[7, -1], [7, 5]]], [[[-1, 4], [5, 4]], [[9, 4], [15, 4]]]);
    expect(made.strips.length).toBe(3);
    const run = satinRuns(made.strips.map((r) => ({ ...r, chain: 0 })), { spacing: 0.4, edge: 0, short: false, underlay: true, tolerance: 0.15 })[0];
    const tiny = run.filter((p, i) => i && Math.hypot(p[0] - run[i - 1][0], p[1] - run[i - 1][1]) < 0.3).length;
    // Was close to 200, one for each point of the middle line.
    expect(tiny).toBeLessThan(10);
  });

  it('goes under the parts still to be sewn, not across the fabric, however they are turned and mirrored', () => {
    const U = poly([0, 0], [14, 0], [14, 16], [10, 16], [10, 4], [4, 4], [4, 16], [0, 16], [0, 0]);
    const made = stripsOfOutline(U, [[[-1, 10], [5, 10]], [[9, 10], [15, 10]], [[7, -1], [7, 5]]], [[[-1, 4], [5, 4]], [[9, 4], [15, 4]]]);
    const inU = (q: Pt) => {
      let c = false;
      for (let i = 0, j = U.length - 1; i < U.length; j = i++) if (U[i][1] > q[1] !== U[j][1] > q[1] && q[0] < ((U[j][0] - U[i][0]) * (q[1] - U[i][1])) / (U[j][1] - U[i][1]) + U[i][0]) c = !c;
      return c;
    };
    const n = made.strips.length;
    for (let m = 0; m < 1 << (2 * n); m++) {
      const cols = made.strips.map((r, k) => ({ ...((m >> k) & 1 ? reversedRails(r) : r), chain: 0, mirror: !!((m >> (n + k)) & 1) }));
      const run = satinRuns(cols, { spacing: 0.4, edge: 0, short: false, underlay: false, tolerance: 0.15 })[0];
      // Stitch length off the U (a way across the gap between its legs was up to 6 mm).
      let off = 0;
      for (let i = 1; i < run.length; i++) {
        const [a, b] = [run[i - 1], run[i]];
        for (let j = 0; j < 4; j++) if (!inU([a[0] + ((b[0] - a[0]) * (j + 0.5)) / 4, a[1] + ((b[1] - a[1]) * (j + 0.5)) / 4])) off += Math.hypot(b[0] - a[0], b[1] - a[1]) / 4;
      }
      expect(off).toBeLessThan(0.5);
    }
  });

  it('stays so with parts turned round and mirrored', () => {
    const U = poly([0, 0], [14, 0], [14, 16], [10, 16], [10, 4], [4, 4], [4, 16], [0, 16], [0, 0]);
    const made = stripsOfOutline(U, [[[-1, 10], [5, 10]], [[9, 10], [15, 10]], [[7, -1], [7, 5]]], [[[-1, 4], [5, 4]], [[9, 4], [15, 4]]]);
    const n = made.strips.length;
    for (let m = 0; m < 1 << (2 * n); m++) {
      for (const underlay of [true, false]) {
        const cols = made.strips.map((r, k) => ({ ...((m >> k) & 1 ? reversedRails(r) : r), chain: 0, mirror: !!((m >> (n + k)) & 1) }));
        const run = satinRuns(cols, { spacing: 0.4, edge: 0, short: false, underlay, tolerance: 0.15 })[0];
        const tiny = run.filter((p, i) => i && Math.hypot(p[0] - run[i - 1][0], p[1] - run[i - 1][1]) < 0.3).length;
        expect(tiny).toBeLessThan(10);
      }
    }
  });
});

describe('cut lines lost', () => {
  it('are found again where the columns meet inside the fill, and cut it the same way', () => {
    const cols = cutM();
    const cuts = cutLinesBetween(cols, [M], []);
    expect(cuts.length).toBe(3);
    // Each where one was drawn (at y 16), from edge to edge.
    for (const [a, b] of cuts) {
      expect(Math.abs(a[1] - 16) + Math.abs(b[1] - 16)).toBeLessThan(0.1);
      expect(Math.abs(a[0] - b[0])).toBeGreaterThan(4.5);
    }
    const again = stripsOfOutline(M, LINES, cuts);
    expect(again.strips.length).toBe(cols.length);
    const centreX = (r: Rails) => [...r.left, ...r.right].reduce((a, p) => a + p[0], 0) / (r.left.length + r.right.length);
    again.strips.forEach((r) => expect(Math.min(...cols.map((c) => Math.abs(centreY(c) - centreY(r)) + Math.abs(centreX(c) - centreX(r))))).toBeLessThan(0.5));
  });

  it('are none on a column that only meets the edge', () => {
    const square = poly([0, 0], [20, 0], [20, 4], [0, 4], [0, 0]);
    const made = stripsOfOutline(square, [[[10, -1], [10, 5]]], []);
    expect(cutLinesBetween(made.strips, [square], [])).toEqual([]);
  });
});

describe('the best order of a chain', () => {
  const inM = (q: Pt) => {
    let c = false;
    for (let i = 0, j = M.length - 1; i < M.length; j = i++) if (M[i][1] > q[1] !== M[j][1] > q[1] && q[0] < ((M[j][0] - M[i][0]) * (q[1] - M[i][1])) / (M[j][1] - M[i][1]) + M[i][0]) c = !c;
    return c;
  };
  const S = { spacing: 0.4, edge: 0, short: false, underlay: true, tolerance: 0.15 };
  /** Stitch length off the m. */
  const off = (cols: Rails[]) => {
    const run = satinRuns(cols, S)[0];
    let v = 0;
    for (let i = 1; i < run.length; i++) {
      const [a, b] = [run[i - 1], run[i]];
      for (let j = 0; j < 4; j++) if (!inM([a[0] + ((b[0] - a[0]) * (j + 0.5)) / 4, a[1] + ((b[1] - a[1]) * (j + 0.5)) / 4])) v += Math.hypot(b[0] - a[0], b[1] - a[1]) / 4;
    }
    return v;
  };

  it('keeps the ways off the fabric however the parts were turned and mirrored', () => {
    const cols = cutM();
    const n = cols.length;
    let tried = 0;
    for (let m = 0; m < 1 << (2 * n) && tried < 3; m++) {
      const start = cols.map((r, k) => ({ ...((m >> k) & 1 ? reversedRails(r) : r), mirror: !!((m >> (n + k)) & 1) }));
      if (off(start) < 1) continue;
      tried++;
      const best = bestChain(start, S);
      expect(best.length).toBe(n);
      expect(off(best)).toBeLessThan(0.5);
      // The same parts, all still one chain.
      expect(best.every((c) => c.chain === 0)).toBe(true);
      expect(new Set(best.map((c) => Math.round(centreY(c) * 10) + Math.round(c.left.reduce((a, p) => a + p[0], 0) / c.left.length) * 1000)).size).toBe(n);
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('leaves a chain alone that is already best', () => {
    const cols = cutM();
    const best = bestChain(cols, S);
    expect(bestChain(best, S)).toEqual(best);
  });
});

function segDist(q: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}
