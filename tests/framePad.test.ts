import { describe, expect, it } from 'vitest';
import { FrameTool } from '../src/ui/frameTool';
import type { Mat } from '../src/shape/path';

describe('the frame standing off the outline (level Form)', () => {
  const tool = (pad: number) => {
    const maps: Mat[] = [];
    const t = new FrameTool({ change: (m) => void maps.push(m), pad: () => pad });
    t.open({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, true);
    return { t, maps };
  };

  it('draws and picks its corners the gap away from the box, so a node on a corner stays free', () => {
    const { t } = tool(12);
    // 4 px per mm: 12 px are 3 mm.
    expect(t.shown(4)).toEqual({ minX: -3, minY: -3, maxX: 23, maxY: 13 });
    expect(t.pickAt(-3, -3, 4)).toBe(0);
    expect(t.pickAt(0, 0, 4)).toBe('move');
    expect(tool(0).t.shown(4)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
  });

  it('a corner dragged scales from where it was pressed, not from the drawn corner', () => {
    const { t, maps } = tool(12);
    t.down(23, 13, 4);
    // Moved by half the box: 1.5 times as big, around the opposite corner.
    t.dragTo(33, 18, false, 4);
    expect(maps.at(-1)).toEqual([1.5, 0, 0, 1.5, 0, 0]);
  });
});
