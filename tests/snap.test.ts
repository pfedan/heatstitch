import { describe, expect, it } from 'vitest';
import { snapMove } from '../src/ui/frameTool';

const box = { minX: 0, minY: 0, maxX: 10, maxY: 4 };

describe('snapping a moved frame', () => {
  it('pulls the nearest edge or middle onto a target close by', () => {
    // Middle at 5 + 14.7 = 19.7, a target at 20: it snaps there.
    const s = snapMove(box, 14.7, 0.3, { xs: [20, 40], ys: [50] }, 0.5);
    expect(s.dx).toBeCloseTo(15);
    expect(s.x).toBe(20);
    expect(s.dy).toBeCloseTo(0.3);
    expect(s.y).toBeNull();
  });

  it('takes the left or right edge as well, whichever is nearest', () => {
    const s = snapMove(box, 29.8, 10.1, { xs: [40, 20], ys: [14] }, 0.5);
    // Right edge 10 + 29.8 = 39.8 to 40; bottom 4 + 10.1 = 14.1 to 14.
    expect(s.dx).toBeCloseTo(30);
    expect(s.dy).toBeCloseTo(10);
    expect([s.x, s.y]).toEqual([40, 14]);
  });

  it('moves freely when nothing is within reach', () => {
    const s = snapMove(box, 3, 3, { xs: [30], ys: [30] }, 0.5);
    expect(s).toEqual({ dx: 3, dy: 3, x: null, y: null });
  });
});
