import { describe, expect, it } from 'vitest';
import { deltaE2000, labToRgb, rgbToLab, type Lab } from '../src/image/color';
import { distanceInside } from '../src/image/edt';
import { looksLikePhoto } from '../src/image/filters';
import { orientation } from '../src/image/orientation';
import { components, mergeSmall, removeBackground, removeSeams } from '../src/image/labels';
import { DEFAULT_PREPARE, NONE, Preparer, type Stroke } from '../src/image/prepare';
import { graphicPalette, quantize } from '../src/image/quantize';
import { toLab } from '../src/image/raster';
import { BLACK, BLUE, RED, WHITE, YELLOW, raster, rng, shape, type Rgba } from './helpers/images';

describe('color', () => {
  // Sharma, Wu & Dalal 2005, supplementary test data (pairs 1, 2, 7, 17, 18, 25, 34).
  const pairs: [Lab, Lab, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  it('matches the CIEDE2000 reference data', () => {
    for (const [a, b, d] of pairs) {
      expect(deltaE2000(a, b)).toBeCloseTo(d, 3);
      expect(deltaE2000(b, a)).toBeCloseTo(d, 3);
    }
  });

  it('converts sRGB to Lab and back', () => {
    expect(rgbToLab(255, 255, 255)[0]).toBeCloseTo(100, 1);
    for (const c of [[0, 0, 0], [255, 0, 0], [12, 200, 99], [128, 128, 128]] as const) {
      expect(labToRgb(...rgbToLab(c[0], c[1], c[2]))).toEqual(c);
    }
  });
});

describe('distance transform', () => {
  it('measures the distance to the nearest outside pixel', () => {
    const w = 9;
    const mask = new Uint8Array(w * w).fill(1);
    const d = distanceInside(mask, w, w);
    // Outside the image counts as outside: the centre pixel is 5 pixels from the border ring.
    expect(d[4 * w + 4]).toBeCloseTo(5);
    expect(d[0]).toBeCloseTo(1);
    mask[4 * w + 4] = 0;
    expect(distanceInside(mask, w, w)[4 * w + 7]).toBeCloseTo(2);
  });
});

describe('orientation', () => {
  it('finds the direction along stripes', () => {
    // Vertical stripes: the structure runs up and down, 2θ = 180°, so cos 2θ is near -1.
    const img = toLab(raster(60, 60, (x) => (Math.sin(x / 2) > 0 ? RED : BLUE)));
    const o = orientation(img, 4);
    const i = 30 * 60 + 30;
    expect(o.c[i]).toBeLessThan(-0.9);
    expect(Math.abs(o.s[i])).toBeLessThan(0.2);
    // Diagonal stripes from top left to bottom right (y down): θ = 45°, sin 2θ near 1.
    const d = orientation(toLab(raster(60, 60, (x, y) => (Math.sin((x - y) / 2) > 0 ? RED : BLUE))), 4);
    expect(d.s[i]).toBeGreaterThan(0.9);
  });
});

describe('quantize', () => {
  it('finds the colors of a noisy three-color image, including a small accent', () => {
    const r = rng(1);
    const noisy = (c: Rgba): Rgba => [c[0] + (r() - 0.5) * 24, c[1] + (r() - 0.5) * 24, c[2] + (r() - 0.5) * 24, 255];
    // Mostly blue and yellow, a small red dot (under 1 %).
    const img = raster(100, 100, (x, y) => noisy(Math.hypot(x - 70, y - 30) < 5 ? RED : x < 50 ? BLUE : YELLOW));
    const q = quantize(toLab(img), { maxColors: 8 });
    expect(q.centers.length).toBe(3);
    for (const c of [RED, BLUE, YELLOW]) {
      const lab = rgbToLab(c[0], c[1], c[2]);
      expect(Math.min(...q.centers.map((k) => deltaE2000(k, lab)))).toBeLessThan(5);
    }
  });

  it('counts the colors a graphic has of its own, a fine line and a thin ring too', () => {
    // Anti-aliased on white: a cream disk in a green ring, on it a pink square with a dark diagonal
    // line about 2 px wide, and a yellow disk with an orange ring: seven colors, the line 0.3 %.
    const CREAM: Rgba = [244, 228, 188, 255];
    const PINK: Rgba = [226, 85, 125, 255];
    const DARK: Rgba = [168, 38, 79, 255];
    const ORANGE: Rgba = [217, 130, 43, 255];
    const GREEN: Rgba = [47, 93, 58, 255];
    const img = shape(
      300,
      300,
      (x, y) => {
        const d = Math.hypot(x - 150, y - 150);
        if (d > 140) return null;
        if (d > 130) return GREEN;
        const e = Math.hypot(x - 200, y - 200);
        if (e < 25) return e < 19 ? YELLOW : ORANGE;
        if (x > 60 && x < 160 && y > 60 && y < 160) return Math.abs(x - y) < 1.5 ? DARK : PINK;
        return CREAM;
      },
      WHITE,
    );
    const own = graphicPalette(img)!;
    expect(own).toHaveLength(7);
    for (const c of [WHITE, CREAM, PINK, DARK, YELLOW, ORANGE, GREEN]) expect(own).toContainEqual(c.slice(0, 3));
    // Kept exactly when allowed; clustered by area into fewer, the fine line goes.
    const lab = own.map((c) => rgbToLab(...c));
    expect(quantize(toLab(img), { maxColors: 7, palette: lab }).centers).toEqual(lab);
    expect(quantize(toLab(img), { maxColors: 16 }).centers.some((c) => deltaE2000(c, rgbToLab(...DARK.slice(0, 3) as [number, number, number])) < 5)).toBe(false);
    // A photo has none.
    const r = rng(3);
    expect(graphicPalette(raster(64, 64, () => [r() * 255, r() * 255, r() * 255, 255]))).toBeNull();
  });

  it('tells photos from graphics', () => {
    const r = rng(2);
    expect(looksLikePhoto(raster(64, 64, () => [r() * 255, r() * 255, r() * 255, 255]))).toBe(true);
    expect(looksLikePhoto(raster(64, 64, (x) => (x < 32 ? RED : BLUE)))).toBe(false);
  });
});

describe('label cleanup', () => {
  it('merges small regions into the neighbour with the longest border', () => {
    const w = 20;
    const labels = new Uint8Array(w * w);
    for (let i = 0; i < w * w; i++) labels[i] = i % w < 10 ? 0 : 1;
    labels[5 * w + 3] = 2; // speck inside 0
    labels[5 * w + 9] = 2; // speck on the border between 0 and 1
    const out = mergeSmall(labels, w, w, 3);
    expect(out[5 * w + 3]).toBe(0);
    expect(new Set(out)).toEqual(new Set([0, 1]));
    expect(components(out, w, w).label.length).toBe(2);
  });

  it('keeps a long narrow detail below the smallest area, but not a blot of the same area', () => {
    // 0.1 mm per pixel: a line 4 px (0.4 mm) wide and 50 px long (2 mm²) and a 14 x 14 px blot (about 2 mm²) on 0.
    const w = 100;
    const labels = new Uint8Array(w * w);
    for (let y = 20; y < 24; y++) for (let x = 20; x < 70; x++) labels[y * w + x] = 1;
    for (let y = 60; y < 74; y++) for (let x = 60; x < 74; x++) labels[y * w + x] = 2;
    const out = mergeSmall(labels, w, w, 3 / 0.01, 0.1);
    expect(out[22 * w + 40]).toBe(1);
    expect(out[66 * w + 66]).toBe(0);
    // Without the size in mm everything small is a speck, as before.
    expect(mergeSmall(labels, w, w, 3 / 0.01)[22 * w + 40]).toBe(0);
  });

  it('removes a seam that runs into a wide region of its own color', () => {
    // Left half 0, right half 1, a 2 px seam of 2 between them that widens into a block at the bottom.
    const w = 40;
    const labels = new Uint8Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) labels[y * w + x] = x < 19 ? 0 : x > 20 ? 1 : 2;
    for (let y = 30; y < w; y++) for (let x = 12; x < 28; x++) labels[y * w + x] = 2;
    const out = removeSeams(labels, w, w, 5, () => true);
    expect(out[10 * w + 19]).toBe(0);
    expect(out[10 * w + 20]).toBe(1);
    // The block itself is wide: it stays.
    expect(out[36 * w + 20]).toBe(2);
  });

  it('removes only the background connected to the border', () => {
    const w = 20;
    const labels = new Uint8Array(w * w); // 0 = white background
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) labels[y * w + x] = 1;
    labels[10 * w + 10] = 0; // white inside the design
    const out = removeBackground(labels, w, w);
    expect(out[0]).toBe(NONE);
    expect(out[10 * w + 10]).toBe(0);
    expect(out[6 * w + 6]).toBe(1);
  });
});

describe('prepare', () => {
  const opts = { ...DEFAULT_PREPARE, widthMm: 40 };

  it('turns an anti-aliased logo into flat thread colors without background', () => {
    // Red disk with a black ring around it, on white; 400 px for 40 mm.
    const img = shape(
      400,
      400,
      (x, y) => {
        const d = Math.hypot(x - 200, y - 200);
        return d < 120 ? RED : d < 150 ? BLACK : null;
      },
      WHITE,
    );
    const p = new Preparer(img).run(opts);
    expect(p.pxMm).toBeCloseTo(0.1);
    const sewn = p.palette.filter((e) => e.areaMm2 > 0);
    expect(sewn.length).toBe(2);
    // Corners are background, the centre is red, the ring black.
    expect(p.labels[0]).toBe(NONE);
    const at = (xMm: number, yMm: number) => p.palette[p.labels[Math.round(yMm / p.pxMm) * p.width + Math.round(xMm / p.pxMm)]];
    expect(at(20, 20).thread.r).toBeGreaterThan(150);
    expect(at(20, 20 + 13.5).thread.r).toBeLessThan(80);
    // Areas match the drawing (disk r = 12 mm, ring 12..15 mm), no seams left over.
    const red = at(20, 20);
    expect(red.areaMm2).toBeCloseTo(Math.PI * 144, -1);
    const ring = at(20, 33.5);
    expect(ring.areaMm2).toBeCloseTo(Math.PI * (225 - 144), -1);
    // Background (one region around the design), ring and disk.
    expect(components(p.labels, p.width, p.height).label.length).toBe(3);
  });

  it('measures the smallest area in mm at the size sewn', () => {
    // A 1/40 wide blot on red: 1 mm (1 mm²) at 40 mm, 2 mm (4 mm²) at 80 mm; the smallest area is 3 mm².
    const img = raster(400, 400, (x, y) => (Math.abs(x - 200) < 5 && Math.abs(y - 200) < 5 ? BLUE : RED));
    const blue = (widthMm: number) => new Preparer(img).run({ ...DEFAULT_PREPARE, widthMm, background: false }).palette.some((e) => e.thread.b > 120);
    expect(blue(40)).toBe(false);
    expect(blue(80)).toBe(true);
  });

  it('enlarges a small image without stair steps along its edges', () => {
    // 100 px for 40 mm: every source pixel becomes 4 x 4 working pixels.
    const img = shape(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 30 ? RED : null), WHITE);
    const p = new Preparer(img).run(opts);
    expect(p.width).toBe(400);
    const red = p.labels[200 * p.width + 200];
    // Distance of every edge pixel of the disk to the circle it was drawn as (r = 120 px).
    let worst = 0;
    for (let y = 1; y < p.height - 1; y++) {
      for (let x = 1; x < p.width - 1; x++) {
        const i = y * p.width + x;
        if (p.labels[i] !== red) continue;
        if (p.labels[i - 1] === red && p.labels[i + 1] === red && p.labels[i - p.width] === red && p.labels[i + p.width] === red) continue;
        worst = Math.max(worst, Math.abs(Math.hypot(x + 0.5 - 200, y + 0.5 - 200) - 120));
      }
    }
    // Copying source pixels into 4 px blocks leaves steps of up to 4 px; interpolated, the edge stays on the circle.
    expect(worst).toBeLessThan(1.6);
  });

  it('applies color edits and brush strokes', () => {
    const img = shape(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 60 ? RED : null), WHITE);
    const prep = new Preparer(img);
    const first = prep.run(opts);
    const red = first.palette.find((e) => e.areaMm2 > 0)!;
    // Skipping the red: nothing is sewn, the color stays listed.
    const skipped = prep.run(opts, [{ from: red.source, skip: true }]);
    expect(skipped.labels.every((l) => l === NONE)).toBe(true);
    expect(skipped.palette.some((e) => !e.sew)).toBe(true);
    // A blue stroke across the middle adds a color.
    const painted = prep.run(opts, [], [{ points: [[0.3, 0.5], [0.7, 0.5]], radius: 0.05, color: [BLUE[0], BLUE[1], BLUE[2]] }]);
    const blue = painted.palette.find((e) => e.source[0] === BLUE[0] && e.source[2] === BLUE[2]);
    expect(blue?.areaMm2).toBeGreaterThan(20);
    expect(painted.labels[(painted.height >> 1) * painted.width + (painted.width >> 1)]).toBe(painted.palette.indexOf(blue!));
  });

  it('keeps painted pixels with their color when its thread changes', () => {
    const img = shape(200, 200, (x, y) => (x < 100 ? RED : y < 100 ? BLUE : null), WHITE);
    const prep = new Preparer(img);
    const first = prep.run(opts);
    const red = first.palette.find((e) => e.thread.r > 150)!;
    // Paint red into the blue square, then give red another thread.
    const stroke: Stroke = { points: [[0.75, 0.25]], radius: 0.1, color: red.source };
    const other = { r: 120, g: 20, b: 60, name: 'Wine' };
    const p = prep.run(opts, [{ from: red.source, thread: other }], [stroke]);
    expect(p.palette.length).toBe(first.palette.length);
    const at = p.labels[Math.round(p.height * 0.25) * p.width + Math.round(p.width * 0.75)];
    expect(p.palette[at].thread).toEqual(other);
  });

  it('keeps the orientation when only the smallest area changes', () => {
    // A photo-like picture: gradients, noise and soft-edged blobs.
    const r = rng(7);
    const img = raster(300, 220, (x, y) => {
      const blob = Math.max(0, 1 - Math.hypot(x - 100, y - 90) / 70);
      const blob2 = Math.max(0, 1 - Math.hypot(x - 210, y - 140) / 50);
      const n = (r() - 0.5) * 24;
      return [60 + (x / 300) * 120 + blob * 120 + n, 90 + (y / 220) * 80 - blob * 40 + blob2 * 100 + n, 150 - (x / 300) * 60 + blob2 * 60 + n, 255];
    });
    const prep = new Preparer(img);
    const o = { ...DEFAULT_PREPARE, widthMm: 30 };
    const a = prep.run(o);
    const b = prep.run({ ...o, minAreaMm2: 6 });
    expect(b.orient).toBe(a.orient);
    expect(new Set(b.labels).size).toBeLessThanOrEqual(new Set(a.labels).size);
  });
});
