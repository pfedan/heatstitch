import { describe, expect, it } from 'vitest';
import { drawMmGrid, gridFade, gridInk, parseRgb } from '../src/render/mmGrid';
import { Viewport } from '../src/render/viewport';

/** A 2D context that records the lines of each stroke, in device pixels. */
function recorder(w: number, h: number, dpr: number) {
  const strokes: { width: number; style: string; xs: number[]; ys: number[] }[] = [];
  let xs: number[] = [];
  let ys: number[] = [];
  let last: [number, number] = [0, 0];
  const ctx = {
    canvas: { width: w * dpr, height: h * dpr },
    lineWidth: 1,
    strokeStyle: '',
    getTransform: () => ({ a: dpr, d: dpr, e: 0, f: 0 }),
    setTransform() {},
    save() {},
    restore() {},
    beginPath() {
      xs = [];
      ys = [];
    },
    moveTo(x: number, y: number) {
      last = [x, y];
    },
    lineTo(x: number, y: number) {
      if (x === last[0]) xs.push(x);
      if (y === last[1]) ys.push(y);
    },
    stroke() {
      strokes.push({ width: ctx.lineWidth, style: String(ctx.strokeStyle), xs, ys });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

describe('millimetre paper', () => {
  it('reads the colors the stage gives', () => {
    expect(parseRgb('rgb(243, 239, 230)')).toEqual([243, 239, 230]);
    expect(parseRgb('rgba(27, 27, 29, 1)')).toEqual([27, 27, 29]);
    expect(parseRgb('#9b2430')).toEqual([155, 36, 48]);
    expect(parseRgb('transparent')).toBeNull();
  });

  it('draws darker lines on light paper and lighter ones on dark paper, in its hue', () => {
    const light = gridInk('#f3efe6').rgb;
    expect(Math.max(...light)).toBeLessThan(100);
    // Warm paper, warm lines: red stays above blue.
    expect(light[0]).toBeGreaterThan(light[2]);
    const dark = gridInk('#1f2b47').rgb;
    expect(Math.min(...dark)).toBeGreaterThan(180);
    expect(dark[2]).toBeGreaterThan(dark[0]);
  });

  it('leaves out lines that close up on screen, and fades them in', () => {
    expect(gridFade(2)).toBe(0);
    expect(gridFade(5)).toBeGreaterThan(0);
    expect(gridFade(5)).toBeLessThan(1);
    expect(gridFade(20)).toBe(1);
  });

  it('puts a strong line through the middle of the design, each line once, on whole pixels', () => {
    const vp = new Viewport();
    vp.scale = 10; // 10 px per mm
    vp.offsetX = 0;
    vp.offsetY = 0;
    const { ctx, strokes } = recorder(400, 300, 2);
    // Middle at 12.3 mm, 7 mm: strong lines at 2.3, 12.3, 22.3, 32.3 mm.
    drawMmGrid(ctx, vp, 400, 300, [12.3, 7], '#ffffff');
    expect(strokes).toHaveLength(3);
    const [strong, medium, thin] = strokes;
    expect(strong.width).toBeGreaterThan(medium.width);
    expect(medium.width).toBeGreaterThanOrEqual(thin.width);
    // 12.3 mm at 10 px/mm and 2 device px per px; a 3 px line sits on a half pixel.
    expect(strong.xs.some((x) => Math.abs(x - 246.5) < 1e-9)).toBe(true);
    expect(strong.ys.some((y) => Math.abs(y - 140.5) < 1e-9)).toBe(true);
    // 5 mm beside the middle is a medium line, not drawn twice.
    expect(medium.xs.some((x) => Math.abs(x - 346) < 1)).toBe(true);
    const all = [...strong.xs, ...medium.xs, ...thin.xs];
    expect(new Set(all.map(Math.round)).size).toBe(all.length);
    // One line per millimetre across 40 mm of width.
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(all.length).toBeLessThanOrEqual(42);
  });

  it('shows only the strong lines when the view is far out', () => {
    const vp = new Viewport();
    vp.scale = 0.5; // 1 mm is half a pixel, 10 mm five
    const { ctx, strokes } = recorder(400, 300, 1);
    drawMmGrid(ctx, vp, 400, 300, [0, 0], '#ffffff');
    expect(strokes).toHaveLength(1);
  });
});
