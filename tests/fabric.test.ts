import { describe, expect, it } from 'vitest';
import { fabricDetail, parseColor } from '../src/render/fabricGl';

describe('fabric', () => {
  it('reads the stage color as computed by the browser or as hex', () => {
    expect(parseColor('rgb(31, 43, 71)')).toEqual([31, 43, 71]);
    expect(parseColor('#ece4d4')).toEqual([236, 228, 212]);
    expect(parseColor('transparent')).toBeNull();
  });

  it('shows the yarns down to about a pixel and a half per yarn', () => {
    expect(fabricDetail(0.5)).toBe(0);
    expect(fabricDetail(1)).toBeGreaterThan(0);
    expect(fabricDetail(1)).toBeLessThan(1);
    expect(fabricDetail(1.5)).toBe(1);
  });
});
