import { describe, expect, it } from 'vitest';
import { clamp, fit, zoomAt, type Frame } from '../src/docsImageView';

const frame: Frame = { W: 400, H: 800, w: 400, h: 250, max: 6 };

describe('guide picture view', () => {
  it('fits a picture into the screen without enlarging it', () => {
    expect(fit(400, 800, 1280, 800)).toEqual({ w: 400, h: 250 });
    expect(fit(1920, 1080, 660, 700)).toEqual({ w: 660, h: 700 });
  });

  it('centers the fitted picture and keeps the scale between 1 and max', () => {
    expect(clamp({ s: 0.5, x: 99, y: 99 }, frame)).toEqual({ s: 1, x: 0, y: 275 });
    expect(clamp({ s: 10, x: 0, y: 0 }, frame).s).toBe(6);
  });

  it('keeps the point under the fingers in place while zooming', () => {
    const start = clamp({ s: 1, x: 0, y: 0 }, frame);
    const v = zoomAt(start, frame, 2, 100, 400);
    const before = { x: (100 - start.x) / start.s, y: (400 - start.y) / start.s };
    expect(v.x + before.x * v.s).toBeCloseTo(100);
    expect(v.y + before.y * v.s).toBeCloseTo(400);
  });

  it('never pans a zoomed picture away from the screen edges', () => {
    const v = clamp({ s: 4, x: 500, y: -5000 }, frame);
    expect(v.x).toBe(0);
    expect(v.y).toBe(800 - 250 * 4);
  });
});
