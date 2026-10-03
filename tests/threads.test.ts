import { describe, expect, it } from 'vitest';
import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH } from '../src/model/pattern';
import { colorRuns, threadWidthMm } from '../src/render/threads';
import { buildInstances } from '../src/render/threadsGl';

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

describe('threadWidthMm', () => {
  it('scales the 0.4 mm reference width with the thread weight', () => {
    expect(threadWidthMm({ fabric: 'woven', thread: '40' })).toBeCloseTo(0.4);
    expect(threadWidthMm({ fabric: 'woven', thread: '12' })).toBeCloseTo(0.8);
    expect(threadWidthMm({ fabric: 'woven', thread: '60' })).toBeLessThan(0.4);
  });
});

describe('buildInstances', () => {
  it('packs one segment and one color per stitch in sewing order', () => {
    const b = new PatternBuilder();
    b.add(0, 0, STITCH);
    b.add(10, 0, STITCH);
    b.mark(COLOR_CHANGE);
    b.add(0, 10, STITCH);
    b.add(0, 10, STITCH);
    const { segs, colors, count } = buildInstances(b.build('inst', 'dst', [{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }]));
    expect(count).toBe(2);
    expect(Array.from(segs)).toEqual([0, 0, 10, 0, 10, 10, 10, 20]);
    expect(Array.from(colors.subarray(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(colors.subarray(4, 7))).toEqual([0, 0, 1]);
  });
});
