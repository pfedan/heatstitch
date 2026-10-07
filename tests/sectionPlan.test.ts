import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { forget, keepShape, remember, remembered, rememberedIn, restoreRemembered, reversedRails, satinRuns, sectionPlan, type Rails, type SatinSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { transformRemembered } from '../src/model/transform';
import { parsePattern } from '../src/parsers';
import { BADGE, RungTool } from '../src/ui/rungTool';

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
    expect(tool.badges.map((b) => [b.n, b.step, b.trim])).toEqual([[1, 0, null], [2, 1, false], [3, 2, false]]);
    const click = (n: number, what: 'number' | 'arrow' | 'scissors') => {
      const b = tool.badges.find((x) => x.n === n)!;
      const along = what === 'arrow' ? BADGE.arrow : BADGE.number;
      const across = what === 'scissors' ? BADGE.scissors : 0;
      tool.down(b.at[0] + (b.dir[0] * along - b.dir[1] * across) / 10, b.at[1] + (b.dir[1] * along + b.dir[0] * across) / 10, 10);
      tool.up();
    };
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
