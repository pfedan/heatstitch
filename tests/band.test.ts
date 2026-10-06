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

  it('reads the width across the line, whatever the pointer does along it', () => {
    const g = bandGrip(line, 6)!;
    expect(draggedWidth(g, [10, 4])).toBe(8);
    expect(draggedWidth(g, [14, -4])).toBe(8);
    expect(draggedWidth(g, [10, 0])).toBe(BAND_MIN);
    expect(draggedWidth(g, [10, 99])).toBe(BAND_MAX);
  });
});
