import { describe, expect, it } from 'vitest';
import { EDGE_RUN_STITCH, merged, SHORTEST } from '../src/digitize/fill';
import { expandRegion, sample } from '../src/digitize/region';
import type { Pt } from '../src/digitize/skeleton';
import { fillRuns, TRAVEL_REACH, type FillSettings } from '../src/model/restitch';
import { rasterize } from '../src/shape/rasterize';
import { ellipsePath, parsePath } from '../src/shape/svgPath';
import { shownTravel } from './helpers/travel';

const ID = [1, 0, 0, 1, 0, 0] as const;
/** Shapes whose rows split into several sections: arms, teeth, holes, points. */
const SHAPES: Record<string, string> = {
  U: 'M0 0 L30 0 L30 30 L20 30 L20 10 L10 10 L10 30 L0 30 Z',
  comb: 'M0 0 L40 0 L40 30 L34 30 L34 8 L26 8 L26 30 L20 30 L20 8 L12 8 L12 30 L6 30 L6 8 L0 8 Z',
  holes: `${ellipsePath(20, 20, 18, 14)} ${ellipsePath(12, 16, 3, 3)} ${ellipsePath(26, 14, 3, 3)} ${ellipsePath(20, 26, 3, 3)}`,
  star: (() => {
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 9 : 23;
      pts.push(`${30 + r * Math.cos(a)} ${30 + r * Math.sin(a)}`);
    }
    return `M${pts.join(' L')} Z`;
  })(),
};
const BASE: FillSettings = { pattern: 'tatami', spacing: 0.4, spacingEnd: 1, offset: 0.25, angle: 0, stitch: 4, underlay: true, edge: 0.2, tolerance: 0.15 };
const area = (d: string) => rasterize(parsePath(d, [...ID]), 0.1)!;
const lengths = (run: Pt[]) => run.slice(1).map((q, i) => Math.hypot(q[0] - run[i][0], q[1] - run[i][1]));

describe('tatami in one go', () => {
  it('sews every shape in one run, its travel hidden under rows still to come', () => {
    for (const [name, d] of Object.entries(SHAPES)) {
      const r = area(d);
      const travel = expandRegion(r, TRAVEL_REACH)!;
      for (const angle of [0, 45, 90, 135]) {
        const res = fillRuns(r, { ...BASE, angle }, { start: [0, 0], travel })!;
        expect(res.runs.length, `${name} ${angle}°`).toBe(1);
        expect(shownTravel(res.runs, res.travel ?? [], BASE.spacing), `${name} ${angle}°`).toBeLessThan(3);
      }
    }
  });

  it('leaves no stitch in the rows shorter than a stitch may be', () => {
    const r = area(SHAPES.star);
    for (const angle of [0, 30, 72]) {
      const res = fillRuns(r, { ...BASE, angle, underlay: false }, { start: [30, 7] })!;
      const travel = new Set((res.travel ?? []).flatMap(([a, b]) => Array.from({ length: b - a }, (_, i) => a + i + 1)));
      const ls = lengths(res.runs.flat()).filter((_, i) => !travel.has(i + 1));
      expect(Math.min(...ls), `${angle}°`).toBeGreaterThan(SHORTEST - 0.01);
    }
  });

  it('merges a short stitch into the next, keeping both ends', () => {
    const pts: Pt[] = [[0, 0], [4, 0], [4.2, 0], [8, 0], [8, 0.3]];
    expect(merged(pts, SHORTEST)).toEqual([[0, 0], [4, 0], [8, 0.3]]);
    expect(merged([[0, 0], [0.1, 0]], SHORTEST)).toEqual([[0, 0], [0.1, 0]]);
  });
});

describe('row ends', () => {
  const r = area(SHAPES.star);
  const turns = (s: Partial<FillSettings>) => {
    const res = fillRuns(r, { ...BASE, angle: 20, underlay: false, ...s }, { start: [30, 7] })!;
    // Needle points on the outline (within the width of a row), where the rows turn.
    return res.runs.flat().filter((p) => Math.abs(sample(r, r.sdf, p[0], p[1])) < BASE.spacing / 2).length;
  };

  it('along the edge: the turns follow the outline, about as many as standard', () => {
    const standard = turns({});
    const edge = turns({ rowEnds: 'edge' });
    expect(edge).toBeGreaterThan(standard * 0.9);
  });

  it('diagonal: about half the needle points at the edge', () => {
    const standard = turns({});
    const diagonal = turns({ rowEnds: 'diagonal' });
    expect(diagonal).toBeLessThan(standard * 0.7);
    expect(diagonal).toBeGreaterThan(standard * 0.3);
  });

  it('only on tatami and gradient rows', () => {
    const a = fillRuns(r, { ...BASE, pattern: 'contour', underlay: false }, { start: [30, 7] })!;
    const b = fillRuns(r, { ...BASE, pattern: 'contour', underlay: false, rowEnds: 'diagonal' }, { start: [30, 7] })!;
    expect(b.runs).toEqual(a.runs);
  });
});

describe('edge run', () => {
  it('runs just inside the edge before the underlay, in its own stitch length', () => {
    const r = area(SHAPES.holes);
    const plain = fillRuns(r, BASE, { start: [2, 20] })!;
    const res = fillRuns(r, { ...BASE, underEdge: true }, { start: [2, 20] })!;
    expect(res.under!).toBeGreaterThan(plain.under!);
    const first = res.runs.flat().slice(0, 40);
    for (const p of first) expect(sample(r, r.sdf, p[0], p[1])).toBeLessThan(0);
    const ls = lengths(first).filter((l) => l > 0.5);
    expect(ls.filter((l) => Math.abs(l - EDGE_RUN_STITCH) < 0.3).length).toBeGreaterThan(ls.length * 0.7);
  });
});
