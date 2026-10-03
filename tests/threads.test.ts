import { describe, expect, it } from 'vitest';
import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH } from '../src/model/pattern';
import { colorRuns } from '../src/render/threads';

describe('colorRuns', () => {
  it('splits stitches into one run per color and skips jumps and zero-length stitches', () => {
    const b = new PatternBuilder();
    b.add(0, 0, STITCH);
    b.add(10, 0, STITCH);
    b.add(0, 0, STITCH);
    b.add(0, 10, STITCH);
    b.add(50, 0, JUMP);
    b.add(10, 0, STITCH);
    b.add(10, 0, STITCH);
    b.mark(COLOR_CHANGE);
    b.add(0, 20, STITCH);
    b.add(0, 20, STITCH);
    const red = { r: 255, g: 0, b: 0 };
    const runs = colorRuns(b.build('runs', 'dst', [red]));
    expect(runs).toHaveLength(2);
    expect(Array.from(runs[0].segs)).toEqual([0, 0, 10, 0, 10, 0, 10, 10, 70, 10, 80, 10]);
    expect(Array.from(runs[1].segs)).toEqual([80, 30, 80, 50]);
    // Blocks without a palette entry reuse the last color, like the flat renderer.
    expect(runs[1].color).toBe(red);
  });
});
