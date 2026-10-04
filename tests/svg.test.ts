import { describe, expect, it } from 'vitest';
import { digitize, digitizeDefaults } from '../src/digitize/digitize';
import { DEFAULT_PREPARE, NONE, Preparer, workingSize, type ExactLabels } from '../src/image/prepare';
import type { Rgb } from '../src/image/color';
import { cssRgb, gradientColor, labelsFromPasses, lengthMm, lengthPx } from '../src/image/svg';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { raster } from './helpers/images';

describe('svg sizes and colors', () => {
  it('reads absolute lengths in mm and leaves pixel sizes without a physical size', () => {
    expect(lengthMm('70mm')).toBe(70);
    expect(lengthMm('2.5cm')).toBe(25);
    expect(lengthMm('1in')).toBeCloseTo(25.4);
    expect(lengthMm('72pt')).toBeCloseTo(25.4);
    expect(lengthMm('400')).toBeNull();
    expect(lengthMm('400px')).toBeNull();
    expect(lengthMm('100%')).toBeNull();
    expect(lengthMm(null)).toBeNull();
    expect(lengthPx('400')).toBe(400);
    expect(lengthPx('25.4mm')).toBeCloseTo(96);
  });

  it('parses computed colors and drops transparent ones', () => {
    expect(cssRgb('rgb(230, 57, 70)')).toEqual({ rgb: [230, 57, 70], alpha: 1 });
    expect(cssRgb('rgba(0, 0, 0, 0)')).toBeNull();
    expect(cssRgb('rgb(10 20 30 / 50%)')?.alpha).toBeCloseTo(0.5);
    expect(cssRgb('none')).toBeNull();
  });

  it('gives a gradient the mean color of its stops', () => {
    expect(gradientColor([{ offset: 0, rgb: [255, 0, 0] }, { offset: 1, rgb: [0, 0, 255] }])).toEqual([128, 0, 128]);
    // A stop that covers most of the length counts most.
    const c = gradientColor([{ offset: 0.9, rgb: [0, 0, 0] }, { offset: 1, rgb: [250, 250, 250] }])!;
    expect(c[0]).toBeLessThan(30);
    expect(gradientColor([])).toBeNull();
  });
});

describe('svg regions', () => {
  it('gives each pixel the color that covers most of it', () => {
    // Two pixels per drawing; colors 0..2 in the first, 3 in the second.
    const pass0 = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0]);
    const pass1 = new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
    const labels = labelsFromPasses([pass0, pass1], 4, 3);
    expect([...labels]).toEqual([0, 3, NONE]);
    // A pixel covered less than half stays unsewn; an edge pixel goes to the larger share.
    const edge = new Uint8ClampedArray([200, 55, 0, 255, 0, 0, 255, 100]);
    expect([...labelsFromPasses([edge], 3, 2)]).toEqual([0, NONE]);
  });

  /** Exact labels at the working size: a band of each of `n` colors, and a line one pixel wide. */
  function design(n: number, widthMm: number): { prep: Preparer; exact: ExactLabels; colors: Rgb[] } {
    const src = raster(400, 200, () => [255, 255, 255, 255]);
    const { w, h } = workingSize(widthMm, src.width, src.height);
    const colors: Rgb[] = Array.from({ length: n }, (_, i) => [(i * 37) % 256, (i * 91 + 40) % 256, (i * 53 + 90) % 256]);
    colors.push([0, 0, 0]);
    const labels = new Uint8Array(w * h).fill(NONE);
    for (let y = Math.round(h * 0.2); y < Math.round(h * 0.8); y++) {
      for (let x = Math.round(w * 0.05); x < Math.round(w * 0.95); x++) labels[y * w + x] = Math.min(n - 1, Math.floor(((x - w * 0.05) / (w * 0.9)) * n));
    }
    // A thin black line across the bands, 4 pixels wide (0.4 mm).
    for (let y = Math.round(h / 2); y < Math.round(h / 2) + 4; y++) for (let x = Math.round(w * 0.1); x < Math.round(w * 0.9); x++) labels[y * w + x] = n;
    return { prep: new Preparer(src), exact: { width: w, height: h, labels, colors }, colors };
  }

  it('keeps every color of the file and its fine lines, without reducing or cleaning up', () => {
    const { prep, exact, colors } = design(10, 80);
    const p = prep.run({ ...DEFAULT_PREPARE, widthMm: 80, maxColors: 4, threads: false }, [], [], exact);
    expect(p.palette.length).toBe(11);
    // The file's own colors, exactly.
    expect(p.palette.map((e) => e.source)).toEqual(colors);
    expect(p.palette.map((e) => [e.thread.r, e.thread.g, e.thread.b])).toEqual(colors);
    const line = p.palette.findIndex((e) => e.source.every((v) => v === 0));
    expect(p.palette[line].areaMm2).toBeCloseTo(0.4 * 64, 0);
    // No regions found in the image below: the labels are the ones given.
    expect(p.orient).toBeUndefined();
  });

  it('sews the bands as fills and the line as running stitch', () => {
    const { prep, exact } = design(3, 80);
    const p = prep.run({ ...DEFAULT_PREPARE, widthMm: 80, threads: false }, [], [], exact);
    const d = digitize(p, digitizeDefaults(DEFAULT_PROFILE));
    expect(d.pattern.colors.length).toBe(4);
    // The line cuts the middle band in two; the outer bands reach round its ends.
    expect(d.objects.filter((o) => o.kind === 'fill').length).toBe(4);
    expect(d.objects.filter((o) => o.kind === 'run').map((o) => o.label)).toEqual([3]);
  });

  it('applies color changes keyed by the file colors', () => {
    const { prep, exact, colors } = design(3, 80);
    const opts = { ...DEFAULT_PREPARE, widthMm: 80, threads: false };
    const p = prep.run(opts, [{ from: colors[1], skip: true }, { from: colors[2], merge: colors[0] }], [], exact);
    const sewn = p.palette.filter((e) => e.sew && e.areaMm2 > 0).map((e) => e.source);
    expect(sewn).toEqual([colors[0], colors[3]]);
  });
});
