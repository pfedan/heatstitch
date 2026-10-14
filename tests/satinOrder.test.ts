import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { analyze, keepShape, measureSatin, remembered, restoreRemembered, satinRuns, sectionView, type Rails, type SatinSettings } from '../src/model/restitch';
import { cutStep, moveStep, partSteps, turnStep } from '../src/model/satinOrder';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { fromStored } from '../src/storage/fileStore';
import { decodeProject } from '../src/storage/project';
import { RungTool } from '../src/ui/rungTool';
import { clickControl, dragNumber, joinsOf } from './helpers/satinView';

const PLAIN: SatinSettings = { spacing: 0.4, edge: 0, short: false, underlay: false, tolerance: 0.15 };
const UNDER: SatinSettings = { ...PLAIN, underlay: true, under: 'center' };

const line = (a: Pt, b: Pt): Pt[] => Array.from({ length: 41 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / 40, a[1] + ((b[1] - a[1]) * k) / 40] as Pt);
/** A bar 3 mm wide from x0 to x1 at height y. */
const bar = (x0: number, x1: number, y = 0): Rails => ({ left: line([x0, y], [x1, y]), right: line([x0, y + 3], [x1, y + 3]) });
const ids = (part: Rails[]) => part.map((c) => c.chain);

describe('the order of a satin part', () => {
  it('reads a chain: a way through the satin between its columns, a trim between chains', () => {
    const part = [{ ...bar(0, 10), chain: 0 }, { ...bar(10, 20), chain: 0 }, { ...bar(20, 30), chain: 1 }];
    for (const s of [PLAIN, UNDER]) {
      const steps = partSteps(part, s, 3);
      expect(steps.map((x) => [x.col, x.join])).toEqual([[0, 'first'], [1, 'way'], [2, 'trim']]);
      expect(steps.every((x, i) => !i || x.cuttable)).toBe(true);
      // The way goes where the thread goes: from where one column's run ends to where the next one's starts.
      const runs = satinRuns(part, s);
      expect(steps[2].way).toEqual([runs[0][runs[0].length - 1], runs[1][0]]);
    }
  });

  it('reads columns sewn each as a run of its own: near ones jump, far ones are trimmed', () => {
    // Each sewn from its start to its far corner: 3.04 mm from one to the next.
    const part = [bar(0, 10), bar(10.5, 20), bar(40, 50)];
    expect(partSteps(part, PLAIN, 3).map((x) => x.join)).toEqual(['first', 'trim', 'trim']);
    const steps = partSteps(part, PLAIN, 5);
    expect(steps.map((x) => x.join)).toEqual(['first', 'jump', 'trim']);
    // Across the fabric to the far one, but trimmed: nothing stays in sight.
    expect(steps[2].shows).toBe(0);
  });

  it('reads the sections of a column: one after the other, a trim where its plan has one', () => {
    const r: Rails = { ...bar(0, 30), rungs: [], cuts: [[10, 10], [20, 20]] };
    expect(partSteps([r], PLAIN, 3).map((x) => [x.step, x.join, x.cuttable])).toEqual([[0, 'first', false], [1, 'way', true], [2, 'way', true]]);
    const cut = cutStep([r], partSteps([r], PLAIN, 3), 2, PLAIN)!;
    expect(cut[0].plan!.map((x) => x.trim)).toEqual([false, false, true]);
    expect(partSteps(cut, PLAIN, 3).map((x) => x.join)).toEqual(['first', 'way', 'trim']);
  });

  it('marks a way that stays in sight', () => {
    // Two columns apart in one chain: the way between them crosses the fabric.
    const part = [{ ...bar(0, 10), chain: 0 }, { ...bar(0, 10, 10), chain: 0 }];
    expect(partSteps(part, PLAIN, 3)[1].shows).toBeGreaterThan(5);
    // Side by side, as a fill's strips, the next starting where the last one ended: the way lies under it.
    const near = [{ ...bar(0, 10), chain: 0 }, { ...bar(0, 10, -3), chain: 0 }];
    expect(partSteps(near, PLAIN, 3)[1].shows).toBeLessThan(1);
  });

  it('moves a piece to another place, the trims staying between the same places', () => {
    const part = [{ ...bar(0, 10), chain: 0 }, { ...bar(10, 20), chain: 0 }, { ...bar(20, 30), chain: 1 }, { ...bar(30, 40), chain: 1 }];
    const moved = moveStep(part, partSteps(part, PLAIN, 3), 3, 0, PLAIN)!;
    expect(moved.map((c) => c.left[0][0])).toEqual([30, 0, 10, 20]);
    expect(ids(moved)).toEqual([0, 0, 1, 1]);
    expect(moveStep(part, partSteps(part, PLAIN, 3), 1, 1, PLAIN)).toBeNull();
  });

  it('puts a part read from a file in chains at its first trim, the other joins as they are sewn', () => {
    const part = [bar(0, 10), bar(10.5, 20), bar(40, 50), bar(50.5, 60)];
    const steps = partSteps(part, PLAIN, 5);
    expect(steps.map((x) => x.join)).toEqual(['first', 'jump', 'trim', 'jump']);
    const cut = cutStep(part, steps, 1, PLAIN)!;
    expect(ids(cut)).toEqual([0, 1, 2, 2]);
    expect(partSteps(cut, PLAIN, 5).map((x) => x.join)).toEqual(['first', 'trim', 'trim', 'way']);
    // And the trim taken away again: one chain from the first to the second.
    const back = cutStep(cut, partSteps(cut, PLAIN, 5), 1, PLAIN)!;
    expect(ids(back)).toEqual([0, 0, 1, 1]);
  });

  it('turns a piece round', () => {
    const part = [{ ...bar(0, 10), chain: 0 }, { ...bar(10, 20), chain: 0 }];
    const turned = turnStep(part, partSteps(part, PLAIN, 3), 1, PLAIN);
    expect(turned[1].left[0]).toEqual(part[1].right[part[1].right.length - 1]);
  });
});

describe('the order on the canvas', () => {
  const open = (part: Rails[]) => {
    const changes: Rails[][][] = [];
    const tool = new RungTool({ change: (c) => changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: () => {}, trimMm: () => 3 });
    tool.openSatin([part]);
    tool.satin = PLAIN;
    return { tool, changes };
  };

  it('moves a piece by dragging its number onto another', () => {
    const { tool, changes } = open([{ ...bar(0, 10), chain: 0 }, { ...bar(10, 20), chain: 0 }, { ...bar(20, 30), chain: 0 }]);
    dragNumber(tool, 3, 1);
    expect(changes.length).toBe(1);
    expect(changes[0][0].map((c) => c.left[0][0])).toEqual([20, 0, 10]);
  });

  it('cuts a join with its scissors and sews it through again', () => {
    const { tool, changes } = open([{ ...bar(0, 10), chain: 0 }, { ...bar(0, 10, -3), chain: 0 }]);
    expect(joinsOf(tool)).toEqual(['way']);
    // The scissors of a way show only while it is pointed at.
    expect(tool.scissorsOn(tool.links[0])).toBe(false);
    clickControl(tool, 2, 'scissors');
    expect(ids(changes[0][0])).toEqual([0, 1]);
    expect(joinsOf(tool)).toEqual(['trim']);
    // A trim keeps its scissors in sight.
    expect(tool.scissorsOn(tool.links[0])).toBe(true);
    clickControl(tool, 2, 'scissors');
    expect(ids(changes[1][0])).toEqual([0, 0]);
  });

  it('puts the numbers of pieces that lie close apart', () => {
    // Three short columns next to each other, zoomed out: their middles lie under one number.
    const { tool } = open([{ ...bar(0, 1), chain: 0 }, { ...bar(1, 2), chain: 0 }, { ...bar(2, 3), chain: 0 }]);
    const scale = 4;
    const { numbers } = tool.layout(scale);
    for (let a = 0; a < numbers.length; a++)
      for (let b = a + 1; b < numbers.length; b++) expect(Math.hypot(numbers[a]![0] - numbers[b]![0], numbers[a]![1] - numbers[b]![1]) * scale).toBeGreaterThanOrEqual(16);
  });

  it('shows every column of Daniel\'s cat outline with the way to the next', async () => {
    const proj = await decodeProject(new Uint8Array(readFileSync(new URL('./fixtures/cat-outline-sections.heatstitch', import.meta.url))));
    const f = proj.files[0];
    const original = parsePattern(f.data, f.name);
    const p = fromStored(original, f.working) ?? original;
    restoreRemembered(p, f.objects);
    const kinds = stitchKinds(p);
    const o = sewObjects(p, kinds).find((x) => x.index === 20)!;
    const read = analyze(p, o, kinds).parts.find((pt) => pt.kind === 'satin')!;
    const satin = remembered(p, o)?.satin ?? measureSatin(p, read, kinds);
    const shape = keepShape(p, o, kinds);
    const view = sectionView(shape.columns!, shape.shape);
    const steps = partSteps(view[0], satin, 3);
    expect(steps.length).toBe(12);
    // Read from the file: what the stitches do, trims where the digitizer trimmed.
    expect(steps.slice(1).every((x) => x.join === 'trim' || x.join === 'jump' || x.join === 'way')).toBe(true);
    expect(steps.filter((x) => x.join === 'trim').length).toBeGreaterThan(5);
    // The stitches as before: reading the steps changes nothing.
    expect(satinRuns(view[0], satin, [])).toEqual(satinRuns(view[0], satin));
  }, 60_000);
});
