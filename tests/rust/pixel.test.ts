import { describe, expect, it } from 'vitest';
import * as rsCrop from '../../src/image/crop';
import * as rsFilters from '../../src/image/filters';
import * as rsLabels from '../../src/image/labels';
import * as rsOrient from '../../src/image/orientation';
import * as rsPrepare from '../../src/image/prepare';
import * as rsQuantize from '../../src/image/quantize';
import * as rsRaster from '../../src/image/raster';
import * as rsThreads from '../../src/image/threadMatch';
import { BLACK, BLUE, RED, WHITE, YELLOW, rng, shape, type Rgba } from '../helpers/images';
import { readPng } from './png';
import * as tsCrop from './ts/crop';
import * as tsFilters from './ts/filters';
import * as tsLabels from './ts/labels';
import * as tsOrient from './ts/orientation';
import * as tsPrepare from './ts/prepare';
import * as tsQuantize from './ts/quantize';
import * as tsRaster from './ts/raster';
import * as tsThreads from './ts/threadMatch';
import type { Raster } from '../../src/image/raster';

/**
 * Stage 1a: the pixel work of the image assistant in the Rust core against the TypeScript it
 * replaces (tests/rust/ts), on the same pictures. The algorithms are the same, so the results are
 * too: pixels, labels and threads exactly; floats up to their last bits (the math library of
 * WebAssembly against V8's), within the tolerances stated below.
 */

const GREEN: Rgba = [40, 160, 70, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

/** A logo: disc, square, thin ring and a bar, anti-aliased, on white. */
const logo = (outside: Rgba = WHITE) =>
  shape(
    320,
    240,
    (x, y) => {
      const d = Math.hypot(x - 90, y - 110);
      if (d < 60) return d < 30 ? YELLOW : RED;
      if (Math.abs(d - 75) < 1.2) return BLACK;
      if (x > 190 && x < 290 && y > 60 && y < 170) return BLUE;
      if (x > 30 && x < 300 && y > 200 && y < 206) return GREEN;
      return null;
    },
    outside,
  );

/** A photo-like picture: gradients, noise and soft-edged blobs. */
function photo(w = 300, h = 220): Raster {
  const r = rng(7);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const blob = Math.max(0, 1 - Math.hypot(x - 100, y - 90) / 70);
      const blob2 = Math.max(0, 1 - Math.hypot(x - 210, y - 140) / 50);
      const n = (r() - 0.5) * 24;
      const i = (y * w + x) * 4;
      data[i] = 60 + (x / w) * 120 + blob * 120 + n;
      data[i + 1] = 90 + (y / h) * 80 - blob * 40 + blob2 * 100 + n;
      data[i + 2] = 150 - (x / w) * 60 + blob2 * 60 + n;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const icon = () => readPng(new URL('../../public/pwa-512.png', import.meta.url));

const pictures: [string, () => Raster][] = [
  ['logo', () => logo()],
  ['logo on transparent', () => logo(CLEAR)],
  ['photo', () => photo()],
  ['app icon (PNG)', icon],
];

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

/** A palette with its floats rounded: the core's math library differs from V8's in the last bits. */
const rounded = (p: rsPrepare.PaletteEntry[]) =>
  p.map((e) => ({ ...e, lab: e.lab.map((v) => +v.toFixed(9)), deltaE: +e.deltaE.toFixed(9), areaMm2: +e.areaMm2.toFixed(9) }));

/** Share of entries that differ. */
const differ = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n / a.length;
};

describe('raster and filters', () => {
  for (const [name, make] of pictures) {
    it(`resamples and converts ${name} alike`, () => {
      const src = make();
      for (const [w, h] of [
        [Math.round(src.width / 2.7), Math.round(src.height / 2.7)],
        [src.width * 2 + 3, src.height * 2 - 5],
      ]) {
        const a = tsRaster.resizeArea(src, w, h);
        const b = rsRaster.resizeArea(src, w, h);
        expect(differ(a.data, b.data)).toBe(0);
      }
      const la = tsRaster.toLab(src);
      const lb = rsRaster.toLab(src);
      expect(maxDiff(la.lab, lb.lab)).toBeLessThan(1e-3);
      expect(lb.opaque).toEqual(la.opaque);
      expect(rsFilters.looksLikePhoto(src)).toBe(tsFilters.looksLikePhoto(src));
      expect(rsQuantize.graphicPalette(src)).toEqual(tsQuantize.graphicPalette(src));
      expect(rsCrop.contentCrop(src.data, src.width, src.height)).toEqual(tsCrop.contentCrop(src.data, src.width, src.height));
    });
  }

  it('smooths and finds the orientation alike', () => {
    const img = tsRaster.toLab(photo());
    expect(maxDiff(rsFilters.bilateral(img, 3, 2.5, 8).lab, tsFilters.bilateral(img, 3, 2.5, 8).lab)).toBeLessThan(1e-3);
    for (const sigma of [2, 6]) {
      const a = tsOrient.orientation(img, sigma);
      const b = rsOrient.orientation(img, sigma);
      expect(maxDiff(a.c, b.c)).toBeLessThan(1e-4);
      expect(maxDiff(a.s, b.s)).toBeLessThan(1e-4);
    }
  });
});

describe('quantize and labels', () => {
  for (const [name, make] of pictures) {
    it(`quantizes ${name} alike`, () => {
      const img = tsRaster.toLab(make());
      for (const maxColors of [2, 6, 12]) {
        const a = tsQuantize.quantize(img, { maxColors });
        const b = rsQuantize.quantize(img, { maxColors });
        expect(b.centers.length).toBe(a.centers.length);
        expect(maxDiff(b.centers.flat(), a.centers.flat())).toBeLessThan(1e-6);
        expect(differ(b.labels, a.labels)).toBe(0);
      }
    });
  }

  it('cleans label maps alike', () => {
    const src = photo();
    const img = tsRaster.toLab(src);
    const { labels, centers } = tsQuantize.quantize(img, { maxColors: 8 });
    const { width: w, height: h } = src;
    const ca = tsLabels.components(labels, w, h);
    expect(rsLabels.components(labels, w, h)).toEqual(ca);
    expect(rsLabels.bands(ca, labels, w, h, 0.1)).toEqual(tsLabels.bands(ca, labels, w, h, 0.1));
    expect(rsLabels.modeFilter(labels, w, h)).toEqual(tsLabels.modeFilter(labels, w, h));
    for (const [minArea, pxMm] of [[30, undefined], [300, 0.1], [2000, 0.05]] as const) {
      expect(rsLabels.mergeSmall(labels, w, h, minArea, pxMm)).toEqual(tsLabels.mergeSmall(labels, w, h, minArea, pxMm));
    }
    const near = (s: number, a: number, b: number) => (s + a + b) % 3 !== 0 && centers[s][0] > Math.min(centers[a][0], centers[b][0]);
    for (const width of [3, 6]) expect(rsLabels.removeSeams(labels, w, h, width, near)).toEqual(tsLabels.removeSeams(labels, w, h, width, near));
    const l = tsQuantize.quantize(tsRaster.toLab(logo()), { maxColors: 6 }).labels;
    expect(rsLabels.removeBackground(l, 320, 240)).toEqual(tsLabels.removeBackground(l, 320, 240));
    expect(rsLabels.removeBackground(l, 320, 240)[0]).toBe(rsQuantize.NONE);
  });

  it('matches threads alike', () => {
    const r = rng(3);
    for (let n = 1; n <= 10; n++) {
      const colors = Array.from({ length: n }, () => [r() * 100, (r() - 0.5) * 120, (r() - 0.5) * 120] as [number, number, number]);
      const weights = colors.map(() => r());
      for (const wts of [undefined, weights]) {
        const a = tsThreads.matchThreads(colors, wts);
        const b = rsThreads.matchThreads(colors, wts);
        expect(b.map((m) => m.thread)).toEqual(a.map((m) => m.thread));
        expect(maxDiff(b.map((m) => m.deltaE), a.map((m) => m.deltaE))).toBeLessThan(1e-9);
      }
    }
  });

  it('cuts labels alike', () => {
    const full = { width: 97, height: 61, labels: Uint8Array.from({ length: 97 * 61 }, (_, i) => (i * 7) % 13), colors: [] };
    for (const c of [undefined, { x: 0.1, y: 0.2, w: 0.5, h: 0.7 }]) {
      expect(rsCrop.cutLabels(full, c, 140, 33)).toEqual(tsCrop.cutLabels(full, c, 140, 33));
    }
  });
});

describe('prepare', () => {
  const strokes: rsPrepare.Stroke[] = [
    { points: [[0.1, 0.1], [0.3, 0.15], [0.35, 0.3]], radius: 0.02, color: [10, 10, 10] },
    { points: [[0.6, 0.6]], radius: 0.05, color: null },
  ];
  const cases: [string, () => Raster, Partial<rsPrepare.PrepareOptions>, rsPrepare.ColorEdit[], rsPrepare.Stroke[]][] = [
    ['logo', () => logo(), { widthMm: 40 }, [], []],
    ['logo, own colors, painted', () => logo(), { widthMm: 30, threads: false }, [], strokes],
    ['logo on transparent', () => logo(CLEAR), { widthMm: 50, maxColors: 4 }, [], []],
    ['photo, smoothed', () => photo(), { widthMm: 45, smooth: 2, maxColors: 8 }, [], strokes],
    ['photo, many colors, background kept', () => photo(), { widthMm: 35, maxColors: 14, background: false, minAreaMm2: 1 }, [], []],
    ['app icon', icon, { widthMm: 60 }, [], []],
  ];
  for (const [name, make, opts, edits, paint] of cases) {
    it(`prepares ${name} alike`, () => {
      const src = make();
      const o = { ...rsPrepare.DEFAULT_PREPARE, ...opts };
      const a = new tsPrepare.Preparer(src).run(o, edits, paint);
      const b = new rsPrepare.Preparer(src).run(o, edits, paint);
      expect([b.width, b.height, b.pxMm]).toEqual([a.width, a.height, a.pxMm]);
      expect(rounded(b.palette)).toEqual(rounded(a.palette));
      expect(differ(b.labels, a.labels)).toBe(0);
      expect(maxDiff(b.orient!.c, a.orient!.c)).toBeLessThan(1e-4);
    });
  }

  it('applies color changes alike', () => {
    const src = logo();
    const o = { ...rsPrepare.DEFAULT_PREPARE, widthMm: 40 };
    const first = new tsPrepare.Preparer(src).run(o);
    const [p0, p1, p2] = first.palette;
    const edits: rsPrepare.ColorEdit[] = [
      { from: p0.source, skip: true },
      { from: p1.source, merge: p2.source },
      { from: p2.source, thread: { r: 1, g: 2, b: 3, name: 'Own', brand: 'X', catalog: '7' } },
    ];
    const a = new tsPrepare.Preparer(src).run(o, edits, strokes);
    const b = new rsPrepare.Preparer(src).run(o, edits, strokes);
    expect(rounded(b.palette)).toEqual(rounded(a.palette));
    expect(differ(b.labels, a.labels)).toBe(0);
  });

  it('takes the exact regions of a vector image alike', () => {
    const src = logo();
    const { w, h } = rsPrepare.workingSize(40, src.width, src.height);
    const q = tsQuantize.quantize(tsRaster.toLab(tsRaster.resizeArea(src, w, h)), { maxColors: 5 });
    const exact = { width: w, height: h, labels: q.labels, colors: [[230, 20, 30], [250, 210, 20], [255, 255, 255], [15, 15, 15], [20, 60, 170]] as [number, number, number][] };
    for (const threads of [true, false]) {
      const o = { ...rsPrepare.DEFAULT_PREPARE, widthMm: 40, threads };
      const a = new tsPrepare.Preparer(src).run(o, [], [], exact);
      const b = new rsPrepare.Preparer(src).run(o, [], [], exact);
      expect(rounded(b.palette)).toEqual(rounded(a.palette));
      expect(b.ofSource).toEqual(a.ofSource);
      expect(differ(b.labels, a.labels)).toBe(0);
    }
  });

  it('keeps the stages it may keep', () => {
    const p = new rsPrepare.Preparer(photo());
    const o = { ...rsPrepare.DEFAULT_PREPARE, widthMm: 30 };
    const a = p.run(o);
    const b = p.run({ ...o, minAreaMm2: 6 });
    expect(b.orient).toBe(a.orient);
    expect(new Set(b.labels).size).toBeLessThanOrEqual(new Set(a.labels).size);
  });
});
