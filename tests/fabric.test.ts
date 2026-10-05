import { describe, expect, it } from 'vitest';
import { fabricDetail, parseColor } from '../src/render/fabricGl';

describe('fabric', () => {
  it('reads the stage color as computed by the browser or as hex', () => {
    expect(parseColor('rgb(31, 43, 71)')).toEqual([31, 43, 71]);
    expect(parseColor('#ece4d4')).toEqual([236, 228, 212]);
    expect(parseColor('transparent')).toBeNull();
  });

  it('fades the yarn relief in only once a yarn spans a few pixels', () => {
    expect(fabricDetail(1)).toBe(0);
    expect(fabricDetail(4)).toBeGreaterThan(0);
    expect(fabricDetail(4)).toBeLessThan(1);
    expect(fabricDetail(10)).toBe(1);
  });
});
