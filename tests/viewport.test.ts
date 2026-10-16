import { describe, expect, it } from 'vitest';
import { Viewport } from '../src/render/viewport';

describe('Viewport', () => {
  it('keeps the middle of the stage when the stage changes size', () => {
    const vp = new Viewport();
    // Fitted into the narrower Gestalten stage, then Prüfen widens it by the side panel.
    vp.fit(0, 0, 84, 84, 611, 860);
    const before = vp.toWorld(611 / 2, 860 / 2);
    vp.resized(611, 860, 960, 860);
    const after = vp.toWorld(960 / 2, 860 / 2);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    expect(vp.scale).toBeCloseTo(Math.min((611 - 48) / 84, (860 - 48) / 84), 9);
  });

  it('a change and its way back leave the view as it was', () => {
    const vp = new Viewport();
    vp.fit(-10, -5, 30, 25, 800, 600);
    const { offsetX, offsetY } = vp;
    vp.resized(800, 600, 1200, 500);
    vp.resized(1200, 500, 800, 600);
    expect(vp.offsetX).toBeCloseTo(offsetX, 9);
    expect(vp.offsetY).toBeCloseTo(offsetY, 9);
  });
});
