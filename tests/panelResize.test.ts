import { describe, expect, it } from 'vitest';
import { clampPanel, PANEL_LIMITS, STAGE_MIN } from '../src/ui/panelResize';

describe('clampPanel', () => {
  it('keeps a width inside the column limits', () => {
    expect(clampPanel('side', 100, 2000, 300)).toBe(PANEL_LIMITS.side.min);
    expect(clampPanel('side', 900, 2000, 300)).toBe(PANEL_LIMITS.side.max);
    expect(clampPanel('inspector', 401.6, 2000, 300)).toBe(402);
  });

  it('leaves the canvas its minimum width next to the other column', () => {
    expect(clampPanel('inspector', 600, 1100, 300)).toBe(1100 - 300 - STAGE_MIN);
  });

  it('never goes below the minimum, even in a narrow window', () => {
    expect(clampPanel('side', 400, 700, 300)).toBe(PANEL_LIMITS.side.min);
  });
});
