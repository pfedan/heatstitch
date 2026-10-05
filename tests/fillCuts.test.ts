import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripsOfOutline } from '../src/digitize/rungs';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { forget, keepShape, measureSatin, remember, remembered, rememberedIn, restitch, restoreRemembered, reversedRails, satinRuns, type Rails, type SatinSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { transformRemembered } from '../src/model/transform';
import { parsePattern } from '../src/parsers';
import { BADGE, RungTool } from '../src/ui/rungTool';

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: false, underlay: true, tolerance: 0.15 };

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

/** The outline of an m as a fill (y up): three legs 4 mm wide under a bar 4 mm high. */
const M = poly([0, 0], [4, 0], [4, 16], [13, 16], [13, 0], [17, 0], [17, 16], [26, 16], [26, 0], [30, 0], [30, 20], [0, 20], [0, 0]);
/** Cut lines where the legs meet the bar. */
const CUTS: [Pt, Pt][] = [
  [[-1, 16], [5, 16]],
  [[12, 16], [18, 16]],
  [[25, 16], [31, 16]],
];
/** A line across each leg and one across the bar. */
const LINES: [Pt, Pt][] = [
  [[-1, 8], [5, 8]],
  [[12, 8], [18, 8]],
  [[25, 8], [31, 8]],
  [[15, 15], [15, 21]],
];

const len = (r: Pt[]) => r.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0), 0);

describe('a fill cut into columns by Trennlinien', () => {
  it('makes a column of each part, the legs across and the bar along', () => {
    const { strips, parts, bad } = stripsOfOutline(M, LINES, CUTS);
    expect(bad).toBe(-1);
    expect(parts.length).toBe(4);
    expect(strips.length).toBe(4);
    for (const s of strips) {
      const ratio = Math.max(len(s.left), len(s.right)) / Math.min(len(s.left), len(s.right));
      expect(ratio).toBeLessThan(2);
    }
    // Each leg's column runs up and down (rails 16 mm long), the bar's along it.
    const legs = strips.filter((s) => Math.abs(len(s.left) - 16) < 1);
    expect(legs.length).toBe(3);
  });

  it('sews the parts beyond first, each part where its parent starts', () => {
    const { strips } = stripsOfOutline(M, LINES, CUTS);
    // The bar is the last but one (two legs hang off it) or the last; the root leg sewn last.
    const bar = strips.findIndex((s) => Math.abs(len(s.left) - 16) >= 1);
    expect(bar).toBe(strips.length - 2);
    // Each leg off the bar starts at its top (the cut line), the root leg at its foot.
    const mid = (s: (typeof strips)[0]): Pt => [(s.left[0][0] + s.right[0][0]) / 2, (s.left[0][1] + s.right[0][1]) / 2];
    for (let k = 0; k < bar; k++) expect(mid(strips[k])[1]).toBeCloseTo(16, 0);
    expect(mid(strips[strips.length - 1])[1]).toBeCloseTo(0, 0);
  });

  it('never travels across the fabric between the legs', () => {
    const { strips } = stripsOfOutline(M, LINES, CUTS);
    for (const underlay of [true, false]) {
      const run = satinRuns(strips.map((s) => ({ ...s, chain: 0 })), { ...SATIN, underlay })[0];
      // Between the legs below the bar there is no fabric to sew on.
      const gap = (q: Pt) => q[1] < 15.7 && ((q[0] > 4.3 && q[0] < 12.7) || (q[0] > 17.3 && q[0] < 25.7));
      for (let i = 1; i < run.length; i++) {
        for (const t of [0.25, 0.5, 0.75]) {
          const q: Pt = [run[i - 1][0] + (run[i][0] - run[i - 1][0]) * t, run[i - 1][1] + (run[i][1] - run[i - 1][1]) * t];
          expect(gap(q), `stitch ${i} at ${q.map((v) => v.toFixed(1))}`).toBe(false);
        }
      }
    }
  });

  it('sews the columns of one chain as one run, every part covered', () => {
    const { strips } = stripsOfOutline(M, LINES, CUTS);
    const rails: Rails[] = strips.map((s) => ({ ...s, chain: 0 }));
    const runs = satinRuns(rails, SATIN);
    expect(runs.length).toBe(1);
    const run = runs[0];
    const hit = (x: number, y: number) => run.some(([px, py]) => Math.abs(px - x) < 0.3 && Math.abs(py - y) < 0.6);
    // Stitches out to both sides of each leg, and of the bar.
    for (const x of [0, 4, 13, 17, 26, 30]) expect(hit(x, 8)).toBe(true);
    expect(hit(8, 20) && hit(8, 16)).toBe(true);
    // Not in a chain: a run each (with trims between them).
    expect(satinRuns(strips, SATIN).length).toBe(4);
  });

  it('keeps the chain when the columns are turned round', () => {
    const { strips } = stripsOfOutline(M, LINES, CUTS);
    expect(reversedRails({ ...strips[0], chain: 3 }).chain).toBe(3);
  });

  it('says which part makes no column', () => {
    const { bad, parts } = stripsOfOutline(M, LINES.slice(0, 3), CUTS);
    expect(bad).toBeGreaterThanOrEqual(0);
    // The bar (20 mm up) has no line across it.
    expect(Math.max(...parts[bad].map((p) => p[1]))).toBeCloseTo(20);
  });

  it('draws cut lines on a fill with the switch and with Shift', () => {
    let changed = 0;
    const tool = new RungTool({ change: () => {}, lines: () => changed++, guides: () => {}, redraw: () => {}, say: () => {} });
    tool.openFill(M);
    const draw = (a: Pt, b: Pt, shift = false) => {
      tool.down(a[0], a[1], 10, shift);
      tool.dragTo(b[0], b[1]);
      tool.up();
    };
    draw([-1, 8], [5, 8]);
    draw([-1, 16], [5, 16], true);
    tool.setCutMode(true);
    draw([12, 16], [18, 16]);
    draw([12, 8], [18, 8], true);
    expect(tool.lines.length).toBe(2);
    expect(tool.cutLines.length).toBe(2);
    expect(changed).toBe(4);
    tool.showBad(M);
    expect(tool.bad).not.toBeNull();
    // Selected and removed: the cut line drawn last but one.
    tool.down(15, 16, 10);
    tool.up();
    expect(tool.selected?.cut).toBe(true);
    tool.deleteSelected();
    expect(tool.cutLines.length).toBe(1);
    expect(tool.bad).toBeNull();
  });
});

describe('order, direction and trims of chained columns on the canvas', () => {
  const open = () => {
    const changes: Rails[][][] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: () => {} });
    const { strips } = stripsOfOutline(M, LINES, CUTS);
    tool.openSatin([strips.map((s) => ({ ...s, chain: 0 }))]);
    // Clicks on a column's control, 10 px to the mm.
    const click = (n: number, what: 'number' | 'arrow' | 'scissors') => {
      const b = tool.badges.find((x) => x.n === n)!;
      const along = what === 'arrow' ? BADGE.arrow : BADGE.number;
      const across = what === 'scissors' ? BADGE.scissors : 0;
      tool.down(b.at[0] + (b.dir[0] * along - b.dir[1] * across) / 10, b.at[1] + (b.dir[1] * along + b.dir[0] * across) / 10, 10);
      tool.up();
    };
    return { tool, changes, strips, click };
  };

  it('numbers the columns in the order they are sewn, scissors from the second on', () => {
    const { tool } = open();
    expect(tool.badges.map((b) => b.n)).toEqual([1, 2, 3, 4]);
    expect(tool.badges.map((b) => b.trim)).toEqual([null, false, false, false]);
  });

  it('sews a column one place earlier, turns it round, sets and takes away a trim', () => {
    const { tool, changes, strips, click } = open();
    click(2, 'number');
    expect(changes.length).toBe(1);
    expect(changes[0][0][0].left).toEqual(strips[1].left);
    expect(changes[0][0][1].left).toEqual(strips[0].left);
    click(1, 'arrow');
    expect(changes[1][0][0].left).toEqual(strips[1].right.slice().reverse());
    click(3, 'scissors');
    expect(changes[2][0].map((c) => c.chain)).toEqual([0, 0, 1, 1]);
    expect(tool.badges.map((b) => b.trim)).toEqual([null, false, true, false]);
    // Sewn as two runs now, the trim between them.
    expect(satinRuns(changes[2][0], SATIN).length).toBe(2);
    click(3, 'scissors');
    expect(changes[3][0].map((c) => c.chain)).toEqual([0, 0, 0, 0]);
    expect(satinRuns(changes[3][0], SATIN).length).toBe(1);
  });
});

describe('chained columns with the rest of the app', () => {
  it('are stored with the project, mapped with the object and sewn again as one', () => {
    const f = 'demos/letters.pes';
    const p = parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin')!;
    const shape = keepShape(p, o, kinds);
    const columns = shape.columns!.map((part) => part.map((c) => ({ ...c, chain: 0 })));
    remember(p, o, { ...shape, columns, read: false });
    try {
      const stored = JSON.parse(JSON.stringify(rememberedIn(p, objs).find((x) => x.columns)));
      forget(p, o);
      restoreRemembered([stored]);
      expect(remembered(p, o)?.columns?.flat().every((c) => c.chain === 0)).toBe(true);
      const mirrored = transformRemembered(remembered(p, o)!, [-1, 0, 0, 1, 0, 0]);
      expect(mirrored.columns!.flat().every((c) => c.chain === 0)).toBe(true);
      const r = restitch(p, objs, [o.index], (_o, an, known) => {
        const part = an.parts.find((pt) => pt.kind === 'satin');
        return part ? { kind: 'satin', s: known?.satin ?? measureSatin(p, part, kinds) } : null;
      }, kinds, 2);
      expect(r.failed).toEqual([]);
      expect(r.memory[0].columns?.flat().every((c) => c.chain === 0)).toBe(true);
    } finally {
      forget(p, o);
    }
  });
});
