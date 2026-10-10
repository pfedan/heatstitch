import { describe, expect, it } from 'vitest';
import { angleSnapped, measured, MeasureTool, type MeasureHooks } from '../src/ui/measureTool';
import { scaleStep } from '../src/ui/scaleBar';
import type { Pt } from '../src/digitize/skeleton';

const tool = (snap: MeasureHooks['snap'] = () => null) => {
  const m = new MeasureTool({ snap, redraw: () => {} });
  m.start();
  return m;
};

describe('scale bar', () => {
  it('steps through 1, 2.5 and 5 in every power of ten, as long as two parts fit', () => {
    const at = (pxPerMm: number) => scaleStep(pxPerMm, 120);
    expect(at(400)).toBe(0.1);
    expect(at(200)).toBe(0.25);
    expect(at(100)).toBe(0.5);
    expect(at(40)).toBe(1);
    expect(at(20)).toBe(2.5);
    expect(at(10)).toBe(5);
    expect(at(6)).toBe(10);
    expect(at(2.4)).toBe(25);
    expect(at(1.2)).toBe(50);
    expect(at(0.6)).toBe(100);
    expect(at(0.05)).toBe(1000);
  });

  it('never draws the bar wider than its room, at any zoom of the stage', () => {
    for (let s = 0.05; s <= 400; s *= 1.07) {
      const step = scaleStep(s, 120);
      // At the highest zoom even 0.1 mm parts are 40 px each.
      expect(2 * step * s).toBeLessThanOrEqual(120 + 1e-9);
      const m = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
      expect([1, 2.5, 5].some((k) => Math.abs(m - k) < 1e-9)).toBe(true);
      // Never less than 40 % of the room, except at the smallest step.
      if (step > 0.1) expect(2 * step * s).toBeGreaterThanOrEqual(0.4 * 120 - 1e-9);
    }
  });
});

describe('measuring', () => {
  it('gives length, parts and the angle as a fill turns its rows (clockwise, 0 to 180)', () => {
    const r = measured([0, 0], [30, 40]);
    expect(r.length).toBeCloseTo(50);
    expect([r.dx, r.dy]).toEqual([30, 40]);
    expect(r.angle).toBeCloseTo(53.13, 1);
    expect(measured([30, 40], [0, 0]).angle).toBeCloseTo(53.13, 1);
    expect(measured([0, 0], [-10, 0]).angle).toBe(0);
    expect(measured([0, 0], [10, -10]).angle).toBeCloseTo(135);
  });

  it('measures a drag from where it is pressed to where it is let go', () => {
    const m = tool();
    m.down(10, 10, 4);
    m.dragTo(20, 10);
    m.dragTo(40, 50);
    m.up();
    expect(m.open).toBe(false);
    expect(m.result!.length).toBeCloseTo(50);
  });

  it('measures two clicks: the second end follows the pointer until the second click', () => {
    const m = tool();
    m.down(0, 0, 4);
    m.up();
    expect(m.open).toBe(true);
    expect(m.result).toBeNull();
    m.hoverAt(3, 4, 4);
    expect(m.result!.length).toBeCloseTo(5);
    m.down(6, 8, 4);
    m.up();
    expect(m.open).toBe(false);
    expect(m.result!.length).toBeCloseTo(10);
    // The finished line no longer follows the pointer.
    m.hoverAt(50, 50, 4);
    expect(m.result!.length).toBeCloseTo(10);
  });

  it('a second click on the first end keeps waiting for the other end', () => {
    const m = tool();
    m.down(5, 5, 4);
    m.up();
    m.down(5, 5, 4);
    m.up();
    expect(m.open).toBe(true);
    expect(m.b).toBeNull();
  });

  it('moves an end of the finished line when pressed near it, and starts anew elsewhere', () => {
    const m = tool();
    m.down(0, 0, 4);
    m.dragTo(10, 0);
    m.up();
    // 1 mm at 4 px/mm is 4 px: within reach of the end at (10, 0).
    m.down(10.5, 0.5, 4);
    m.dragTo(20, 0);
    m.up();
    expect(m.a).toEqual([0, 0]);
    expect(m.result!.length).toBeCloseTo(20);
    m.down(50, 50, 4);
    m.dragTo(53, 54);
    m.up();
    expect(m.a).toEqual([50, 50]);
    expect(m.result!.length).toBeCloseTo(5);
  });

  it('a press that turns into a pinch leaves the measurement as it was', () => {
    const m = tool();
    m.down(0, 0, 4);
    m.dragTo(10, 0);
    m.up();
    m.down(30, 30, 4);
    m.dragTo(40, 40);
    m.abortPress();
    expect(m.a).toEqual([0, 0]);
    expect(m.b).toEqual([10, 0]);
    expect(m.dragging).toBe(false);
  });

  it('snaps an end to the needle point near it, unless Alt is held; Shift holds 15 degree steps', () => {
    const needle: Pt = [10, 10];
    const m = tool((x, y, reach) => (Math.hypot(x - needle[0], y - needle[1]) <= reach ? needle : null));
    m.down(9.5, 9.6, 4);
    expect(m.a).toEqual(needle);
    expect(m.snapAt).toEqual(needle);
    m.dragTo(20, 10, { alt: true });
    m.dragTo(30, 10.2, { alt: true });
    m.up();
    expect(m.b).toEqual([30, 10.2]);
    m.down(30, 10.2, 4);
    m.dragTo(40, 11, { shift: true });
    m.up();
    // As long as drawn, turned onto the nearest 15 degree step (0 degrees here).
    expect(m.b![1]).toBeCloseTo(10);
    expect(m.result!.length).toBeCloseTo(Math.hypot(30, 1));
    expect(angleSnapped([0, 0], [10, 2.5])[1]).toBeCloseTo(Math.hypot(10, 2.5) * Math.sin(Math.PI / 12));
  });

  it('Esc drops the measurement first, ending the tool clears it too', () => {
    const m = tool();
    m.down(0, 0, 4);
    m.dragTo(5, 0);
    m.up();
    expect(m.busy).toBe(true);
    m.clear();
    expect(m.busy).toBe(false);
    expect(m.active).toBe(true);
    m.down(0, 0, 4);
    m.up();
    m.stop();
    expect(m.active).toBe(false);
    expect(m.a).toBeNull();
  });
});
