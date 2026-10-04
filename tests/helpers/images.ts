import type { Raster } from '../../src/image/raster';

export type Rgba = [number, number, number, number];

/** Raster from a function of the pixel center (x + 0.5, y + 0.5). */
export function raster(w: number, h: number, at: (x: number, y: number) => Rgba): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(at(x + 0.5, y + 0.5), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

/**
 * Supersampled shape: each pixel is the mix of `inside` and `outside` by the share of 4 x 4
 * subsamples where `test` holds, like an anti-aliased drawing.
 */
export function shape(w: number, h: number, test: (x: number, y: number) => Rgba | null, outside: Rgba): Raster {
  return raster(w, h, (cx, cy) => {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const c = test(cx - 0.5 + (sx + 0.5) / 4, cy - 0.5 + (sy + 0.5) / 4) ?? outside;
        for (let k = 0; k < 4; k++) acc[k] += c[k] / 16;
      }
    }
    return acc.map(Math.round) as Rgba;
  });
}

/** Deterministic pseudo-random numbers (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WHITE: Rgba = [255, 255, 255, 255];
export const RED: Rgba = [220, 30, 40, 255];
export const BLUE: Rgba = [20, 60, 170, 255];
export const BLACK: Rgba = [15, 15, 15, 255];
export const YELLOW: Rgba = [250, 210, 20, 255];
