import { describe, expect, it } from 'vitest';
import { bandEdges, bandGrip, draggedWidth, BAND_MAX, BAND_MIN } from '../src/shape/band';
import type { Form } from '../src/shape/path';

const line: Form = {
  paths: [
    {
      closed: false,
      nodes: [
        { p: [0, 0], a: [0, 0], b: [0, 0], smooth: false },
        { p: [20, 0], a: [20, 0], b: [20, 0], smooth: false },
      ],
    },
  ],
};

describe('band of a satin line', () => {
  it('puts its edges half the width to either side', () => {
    const [left, right] = bandEdges(line, 6);
    expect(left.every((q) => Math.abs(Math.abs(q[1]) - 3) < 1e-9)).toBe(true);
    expect(right.every((q) => Math.abs(Math.abs(q[1]) - 3) < 1e-9)).toBe(true);
    expect(Math.sign(left[0][1])).toBe(-Math.sign(right[0][1]));
  });

  it('has its grip halfway along, on an edge', () => {
    const g = bandGrip(line, 6)!;
    expect(g.mid[0]).toBeCloseTo(10);
    expect(Math.abs(g.at[1])).toBeCloseTo(3);
  });

  it('keeps its grip off a node halfway along (a line bent in its middle)', () => {
    const bent: Form = { paths: [{ closed: false, nodes: ([[0, 0], [10, -6], [20, 0]] as [number, number][]).map((p) => ({ p, a: p, b: p, smooth: false })) }] };
    const g = bandGrip(bent, 2)!;
    const off = Math.min(...bent.paths[0].nodes.map((n) => Math.hypot(n.p[0] - g.mid[0], n.p[1] - g.mid[1])));
    expect(off).toBeGreaterThan(5);
  });

  it('reads the width across the line, whatever the pointer does along it', () => {
    const g = bandGrip(line, 6)!;
    expect(draggedWidth(g, [10, 4])).toBe(8);
    expect(draggedWidth(g, [14, -4])).toBe(8);
    expect(draggedWidth(g, [10, 0])).toBe(BAND_MIN);
    expect(draggedWidth(g, [10, 99])).toBe(BAND_MAX);
  });
});

describe('band of an area border', () => {
  // A 20 mm square from the middle of a side, run round either way (halfway is the middle of the opposite side).
  const square = (ccw: boolean): Form => {
    const pts: [number, number][] = ccw
      ? [[10, 0], [20, 0], [20, 20], [0, 20], [0, 0]]
      : [[10, 0], [0, 0], [0, 20], [20, 20], [20, 0]];
    return { paths: [{ closed: true, nodes: pts.map((p) => ({ p, a: p, b: p, smooth: false })) }] };
  };

  it('puts the grip on the outer edge, whichever way the outline runs', () => {
    for (const ccw of [true, false]) {
      const g = bandGrip(square(ccw), 2)!;
      const out = Math.max(Math.abs(g.at[0] - 10), Math.abs(g.at[1] - 10));
      expect(out).toBeCloseTo(11);
    }
  });

  it('moves the band outside by the border offset', () => {
    for (const ccw of [true, false]) {
      const g = bandGrip(square(ccw), 2, 1)!;
      expect(Math.max(Math.abs(g.mid[0] - 10), Math.abs(g.mid[1] - 10))).toBeCloseTo(11);
    }
  });
});
