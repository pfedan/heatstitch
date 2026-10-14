import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { forget, keepShape, sectionView, remember, remembered, rememberedIn, restoreRemembered, reversedRails, satinRuns, sectionPlan, type Rails, type SatinSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { transformRemembered } from '../src/model/transform';
import { parsePattern } from '../src/parsers';
import { decodeProject } from '../src/storage/project';
import { fromStored } from '../src/storage/fileStore';
import { RungTool } from '../src/ui/rungTool';
import { clickControl, joinsOf, type Control } from './helpers/satinView';
import { checkSatinOrder } from './helpers/torture';

const PLAIN: SatinSettings = { spacing: 0.4, edge: 0, short: false, underlay: false, tolerance: 0.15 };
const UNDER: SatinSettings = { ...PLAIN, underlay: true, under: 'center' };

const line = (a: Pt, b: Pt): Pt[] => Array.from({ length: 61 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / 60, a[1] + ((b[1] - a[1]) * k) / 60] as Pt);
/** A bar 30 mm long, 4 mm wide, cut in three at 10 and 20 mm. */
const bar = (): Rails => ({ left: line([0, 0], [30, 0]), right: line([0, 4], [30, 4]), rungs: [], cuts: [[10, 10], [20, 20]] });

/** Where along the bar (x) the satin stitches of a run lie (stitches right across it), in order. */
const xs = (run: Pt[]) => run.flatMap((q, i) => (i && Math.abs(q[1] - run[i - 1][1]) > 3 ? [(q[0] + run[i - 1][0]) / 2] : []));

describe('order, direction and trims of the sections of a column', () => {
  it('sews as before without a plan, and says so', () => {
    expect(sectionPlan(bar(), PLAIN).map((x) => [x.sec, x.flip])).toEqual([[0, false], [1, false], [2, false]]);
    const back = sectionPlan(bar(), UNDER);
    expect(back.every((x) => x.flip) || back.every((x) => !x.flip)).toBe(true);
  });

  for (const s of [PLAIN, UNDER]) {
    it(`sews the satin in the order and directions of the plan (${s.underlay ? 'with' : 'without'} underlay)`, () => {
      const r = { ...bar(), plan: [{ sec: 2, flip: true, trim: false }, { sec: 0, flip: false, trim: false }, { sec: 1, flip: true, trim: false }] };
      const runs = satinRuns([r], s);
      expect(runs.length).toBe(1);
      // The satin's x along the run: the last section's backwards first, then the first forwards, then the middle backwards.
      const satin = xs(runs[0]);
      const firstIn3 = satin.findIndex((v) => v > 20.5);
      const firstIn1 = satin.findIndex((v) => v < 9.5);
      const firstIn2 = satin.findIndex((v) => v > 10.5 && v < 19.5);
      expect(firstIn3).toBeLessThan(firstIn1);
      expect(firstIn1).toBeLessThan(firstIn2);
      // Turned round: the last section from its end, the middle one too; the first forwards.
      const in3 = satin.filter((v) => v > 20.5);
      const in1 = satin.filter((v) => v < 9.5);
      const in2 = satin.filter((v) => v > 10.5 && v < 19.5);
      expect(in3[0]).toBeGreaterThan(in3[in3.length - 1]);
      expect(in1[0]).toBeLessThan(in1[in1.length - 1]);
      expect(in2[0]).toBeGreaterThan(in2[in2.length - 1]);
    });
  }

  it('trims where the plan says: a run for each stretch', () => {
    const r = { ...bar(), plan: [{ sec: 0, flip: false, trim: false }, { sec: 1, flip: false, trim: true }, { sec: 2, flip: false, trim: false }] };
    expect(satinRuns([r], PLAIN).length).toBe(2);
  });

  it('turns the plan round with the column', () => {
    const r = { ...bar(), plan: [{ sec: 0, flip: false, trim: false }, { sec: 2, flip: true, trim: true }, { sec: 1, flip: false, trim: false }] };
    expect(reversedRails(r).plan).toEqual([{ sec: 1, flip: false, trim: false }, { sec: 0, flip: true, trim: false }, { sec: 2, flip: false, trim: true }]);
  });

  it('is set with the controls on the canvas', () => {
    const changes: Rails[][][] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: () => {} });
    tool.openSatin([[bar()]]);
    tool.satin = PLAIN;
    expect(tool.badges.map((b) => [b.n, b.step])).toEqual([[1, 0], [2, 1], [3, 2]]);
    expect(joinsOf(tool)).toEqual(['way', 'way']);
    const click = (n: number, what: Control) => clickControl(tool, n, what);
    click(2, 'number');
    expect(changes[0][0][0].plan!.map((x) => x.sec)).toEqual([1, 0, 2]);
    tool.setColumns(changes[0]);
    click(1, 'arrow');
    expect(changes[1][0][0].plan![0]).toEqual({ sec: 1, flip: true, trim: false });
    tool.setColumns(changes[1]);
    click(3, 'scissors');
    expect(changes[2][0][0].plan!.map((x) => x.trim)).toEqual([false, false, true]);
    // A cut line more: the order is made anew.
    tool.setColumns([[{ ...changes[2][0][0], cuts: [[5, 5], [10, 10], [20, 20]] }]]);
    expect(tool.badges.length).toBe(4);
  });

  it('is stored with the project and mapped with the object', () => {
    const f = 'demos/letters.pes';
    const p = parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin')!;
    const shape = keepShape(p, o, kinds);
    const plan = [{ sec: 0, flip: true, trim: false }];
    const columns = shape.columns!.map((part, k) => part.map((c, j) => (k === 0 && j === 0 ? { ...c, plan } : c)));
    remember(p, o, { ...shape, columns, read: false });
    try {
      const stored = JSON.parse(JSON.stringify(rememberedIn(p, objs)));
      forget(p, o);
      restoreRemembered(p, stored);
      expect(remembered(p, o)?.columns?.[0][0].plan).toEqual(plan);
      expect(transformRemembered(remembered(p, o)!, [-1, 0, 0, 1, 0, 0]).columns![0][0].plan).toEqual(plan);
    } finally {
      forget(p, o);
    }
  });
});

describe('places of the columns of a satin read from stitches', () => {
  // An L read from a file: two columns, not chained (each sewn as a run of its own), one area.
  const across = (): Rails => ({ left: line([0, 0], [20, 0]), right: line([0, 4], [16, 4]) });
  const down = (): Rails => ({ left: line([20, 0], [20, 24]), right: line([16, 4], [16, 24]) });

  it('numbers every column in the order it is sewn, as when the part was chained', () => {
    const view = sectionView([[across(), down()]], undefined);
    expect(view[0].length).toBe(2);
    expect(view[0][0].split).toBeDefined();
    expect(view[0].every((c) => c.chain === undefined)).toBe(true);
    const changes: Rails[][][] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: () => {} });
    tool.openSatin(view);
    tool.satin = PLAIN;
    expect(tool.badges.map((b) => [b.n, b.lone])).toEqual([[1, undefined], [2, undefined]]);
    // Each sewn as a run of its own: they meet, so the second goes on where the first ends or jumps there.
    expect(joinsOf(tool).length).toBe(1);
    // Moved one place earlier: the order of the part changes, its area stays with the first column.
    clickControl(tool, 2, 'number');
    const part = changes[0][0];
    expect(part[0].left).toEqual(down().left);
    // The area was only read from the rails to show them: not given back as if it were known.
    expect(view[0][0].split?.read).toBe(true);
    expect(part.some((c) => c.split)).toBe(false);
    expect(sectionView([part], undefined)[0][0].split).toBeDefined();
    expect(part.some((c) => 'chain' in c)).toBe(false);
  });

  it('holds for Daniel\'s cat, read from a PES file', async () => {
    const proj = await decodeProject(new Uint8Array(readFileSync(new URL('./fixtures/cat-outline-sections.heatstitch', import.meta.url))));
    const f = proj.files[0];
    const original = parsePattern(f.data, f.name);
    const p = fromStored(original, f.working) ?? original;
    restoreRemembered(p, f.objects);
    checkSatinOrder(p);
  }, 120_000);
});
