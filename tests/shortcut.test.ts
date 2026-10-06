import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chordOf, cumulative, stripOfLoop } from '../src/digitize/rungs';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { forget, keepShape, measureSatin, remember, remembered, rememberedIn, restitch, restoreRemembered, reversedRails, satinRuns, sectionLoops, sectionsOf, type Rails, type SatinSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { transformRemembered } from '../src/model/transform';
import { parsePattern } from '../src/parsers';
import { RungTool } from '../src/ui/rungTool';

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: false, underlay: false, tolerance: 0.15 };

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

/**
 * An m as one column (y up): the outer rail over the top, the inner rail into both gaps and round
 * the middle leg; cut lines where the first and the second arch meet the legs.
 */
function m(): Rails {
  return {
    left: poly([0, 0], [0, 20], [30, 20], [30, 0]),
    right: poly([4, 0], [4, 16], [13, 16], [13, 0], [17, 0], [17, 16], [26, 16], [26, 0]),
    rungs: [],
    cuts: [
      [24, 16],
      [37, 16 + 9 + 16 + 4 + 16],
    ],
  };
}

describe('a section with its own rails (cut lines as shortcuts)', () => {
  it('finds the strip of a bar cut across, ending on the caps given', () => {
    const ring = poly([0, 0], [3, 0], [3, 20], [0, 20], [0, 0]);
    const cum = cumulative(ring);
    const total = cum[cum.length - 1];
    const chord = chordOf(ring, [-1, 10], [4, 10])!;
    expect(chord).not.toBeNull();
    const s = stripOfLoop(ring, [chord], [[0, 3], [23, 26]])!;
    expect(s).not.toBeNull();
    expect(total).toBeCloseTo(46);
    expect(s.ratio).toBeCloseTo(1, 1);
    expect(s.rungs.length).toBe(1);
  });

  it('cuts the m into three sections, the middle one round the middle leg', () => {
    const r = m();
    const loops = sectionLoops(r);
    expect(loops.length).toBe(3);
    const plain = sectionsOf(r);
    expect(plain.length).toBe(3);
    // Rungs across the middle leg: both ends on the inner rail.
    const free: [Pt, Pt][] = [
      [[12, 4], [18, 4]],
      [[12, 10], [18, 10]],
    ];
    const parts = sectionsOf({ ...r, spans: free });
    expect(parts.length).toBe(3);
    const mid = parts[1];
    // It starts at the first cut line (where the first section ends) and ends at the foot of the middle leg.
    const start: Pt = [(mid.left[0][0] + mid.right[0][0]) / 2, (mid.left[0][1] + mid.right[0][1]) / 2];
    const end: Pt = [(mid.left[mid.left.length - 1][0] + mid.right[mid.right.length - 1][0]) / 2, (mid.left[mid.left.length - 1][1] + mid.right[mid.right.length - 1][1]) / 2];
    expect(start[0]).toBeCloseTo(4, 0);
    expect(start[1]).toBeCloseTo(18, 0);
    expect(end[1]).toBeLessThan(0.5);
    expect(end[0]).toBeCloseTo(15, 0);
    // The second cut line is part of a rail now.
    const onCut2 = [mid.left, mid.right].some((rail) => rail.some((p, i) => i > 0 && Math.abs(p[0] - 17) < 1e-6 && Math.abs(rail[i - 1][0] - 17) < 1e-6 && Math.abs(Math.abs(p[1] - rail[i - 1][1]) - 4) < 1e-6));
    expect(onCut2).toBe(true);
  });

  it('sews the middle leg across, not fanned from the top', () => {
    const free: [Pt, Pt][] = [
      [[12, 4], [18, 4]],
      [[12, 10], [18, 10]],
    ];
    const run = satinRuns([{ ...m(), spans: free }], SATIN)[0];
    // Satin stitches inside the middle leg (both ends in it, away from its foot and top; the run out under it is shorter).
    let across = 0;
    let steep = 0;
    for (let i = 1; i < run.length; i++) {
      const [a, b] = [run[i - 1], run[i]];
      const inLeg = (p: Pt) => p[0] > 12.9 && p[0] < 17.1 && p[1] > 3 && p[1] < 12;
      if (!inLeg(a) || !inLeg(b) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 3) continue;
      if (Math.abs(b[1] - a[1]) < 1) across++;
      else steep++;
    }
    expect(across).toBeGreaterThan(10);
    expect(steep).toBe(0);
    // Without the free rungs the leg is fanned from the outer rail at the top.
    const before = satinRuns([m()], SATIN)[0];
    const inLegBefore = before.filter((p) => p[0] > 12.9 && p[0] < 17.1 && p[1] > 3 && p[1] < 12).length;
    expect(inLegBefore).toBeGreaterThan(0);
  });

  it('keeps the free rungs when the column is turned round, the sections the same', () => {
    const free: [Pt, Pt][] = [[[12, 6], [18, 6]]];
    const r = { ...m(), spans: free };
    const back = reversedRails(r);
    expect(back.spans).toEqual(free);
    expect(sectionsOf(back).length).toBe(3);
  });

  it('falls back to the plain section when the free rungs make no strip', () => {
    // Two rungs crossing each other.
    const free: [Pt, Pt][] = [
      [[12, 4], [18, 10]],
      [[12, 10], [18, 4]],
    ];
    const parts = sectionsOf({ ...m(), spans: free });
    expect(parts.length).toBe(3);
    expect(satinRuns([{ ...m(), spans: free }], SATIN)[0].length).toBeGreaterThan(50);
  });
});

/** The rung tool on the m, with what it hands on and says. */
function tool(r: Rails = m()) {
  const changes: Rails[][][] = [];
  const said: string[] = [];
  const t = new RungTool({ change: (c, final) => final && changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: (k) => said.push(k) });
  t.openSatin([[r]]);
  const draw = (a: Pt, b: Pt, shift = false) => {
    t.down(a[0], a[1], 10, shift);
    t.dragTo(b[0], b[1]);
    t.up();
  };
  return { t, changes, said, draw };
}

describe('drawing rungs and cut lines', () => {
  it('takes a line across the middle leg as a free rung of its section', () => {
    const { t, changes, draw } = tool();
    draw([12, 7], [18, 7]);
    const col = changes[changes.length - 1][0][0];
    expect(col.spans?.length).toBe(1);
    expect(col.cuts?.length).toBe(2);
    expect(t.selected?.span).toBe(true);
    expect(t.count).toBe(1);
  });

  it('still takes a line from rail to rail as a plain rung', () => {
    const { changes, draw } = tool();
    draw([-1, 8], [5, 8]);
    const col = changes[changes.length - 1][0][0];
    expect(col.rungs?.length).toBe(1);
    expect(col.spans).toBeUndefined();
  });

  it('asks for a cut line where a free rung would leave the column lopsided', () => {
    const { changes, said, draw } = tool({ ...m(), cuts: undefined });
    draw([12, 7], [18, 7]);
    expect(changes.length).toBe(0);
    expect(said).toEqual(['stitch.direction.needCut']);
  });

  it('draws cut lines with the switch, and the other kind with Shift', () => {
    const { t, changes, draw } = tool({ ...m(), cuts: undefined });
    t.setCutMode(true);
    draw([-1, 10], [5, 10]);
    expect(changes[changes.length - 1][0][0].cuts?.length).toBe(1);
    draw([-1, 5], [5, 5], true);
    const col = changes[changes.length - 1][0][0];
    expect(col.cuts?.length).toBe(1);
    expect(col.rungs?.length).toBe(1);
  });

  it('slides a free rung end along the section outline and removes it', () => {
    const { t, changes, draw } = tool();
    draw([12, 7], [18, 7]);
    const [a] = changes[changes.length - 1][0][0].spans![0];
    t.down(a[0], a[1], 10);
    t.dragTo(10, 9);
    t.up();
    const moved = changes[changes.length - 1][0][0].spans![0][0];
    // On the left side of the middle leg, a little higher.
    expect(moved[0]).toBeCloseTo(13, 5);
    expect(moved[1]).toBeCloseTo(9, 5);
    t.selected = { col: 0, i: 0, end: -1, span: true };
    expect(t.deleteSelected()).toBe(true);
    expect(changes[changes.length - 1][0][0].spans).toBeUndefined();
  });
});

describe('free rungs with the rest of the app', () => {
  const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

  it('are stored with the project, mapped with the object and sewn again', () => {
    const p = load('demos/letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin')!;
    const shape = keepShape(p, o, kinds);
    const col = shape.columns![0][0];
    // A free rung straight across the column's first stretch, as world points.
    const a = col.left[Math.floor(col.left.length / 4)];
    const b = col.right[Math.floor(col.right.length / 4)];
    const spans: [Pt, Pt][] = [[a, b]];
    const columns = shape.columns!.map((part, k) => part.map((c, j) => (k === 0 && j === 0 ? { ...c, rungs: c.rungs ?? [], spans } : c)));
    remember(p, o, { ...shape, columns, read: false });
    try {
      const stored = JSON.parse(JSON.stringify(rememberedIn(p, objs).find((x) => x.columns)));
      forget(p, o);
      restoreRemembered([stored]);
      expect(remembered(p, o)?.columns?.[0][0].spans).toEqual(spans);
      // Mirrored with the object: the rung ends go along.
      const mirrored = transformRemembered(remembered(p, o)!, [-1, 0, 0, 1, 0, 0]);
      expect(mirrored.columns![0][0].spans![0][0]).toEqual([-a[0], a[1]]);
      // Sewn again with them, nothing lost.
      const r = restitch(p, objs, [o.index], (_o, an, known) => {
        const part = an.parts.find((pt) => pt.kind === 'satin');
        return part ? { kind: 'satin', s: known?.satin ?? measureSatin(p, part, kinds) } : null;
      }, kinds, 2);
      expect(r.starts.length).toBe(1);
      expect(r.failed).toEqual([]);
      // What is remembered for the new stitches keeps them (undo and redo carry this along).
      expect(r.memory[0].columns?.[0][0].spans).toEqual(spans);
    } finally {
      forget(p, o);
    }
  });
});
