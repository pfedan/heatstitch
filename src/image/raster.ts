import { rgbToLab } from './color';

/** RGBA pixels, row by row; the same layout as ImageData, so it works in workers and tests. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Image in CIELAB, three floats per pixel, with a mask of the opaque pixels. */
export interface LabImage {
  width: number;
  height: number;
  lab: Float32Array;
  opaque: Uint8Array;
}

/** Pixels with less alpha are transparent: never sewn. */
export const ALPHA_MIN = 128;

/**
 * Area-average resampling to w x h (box filter over the source footprint of each target pixel).
 * Color is averaged with alpha as weight, so transparent pixels do not darken the edges.
 */
export function resizeArea(src: Raster, w: number, h: number): Raster {
  const { width: sw, height: sh, data: s } = src;
  if (sw === w && sh === h) return { width: w, height: h, data: s.slice() };
  // Enlarging with a box would copy each source pixel into a block, and every edge would come out
  // as a staircase of those blocks; interpolation keeps the edge where the source's anti-aliasing puts it.
  if (w > sw || h > sh) return resizeCubic(src, w, h);
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = sw / w;
  const fy = sh / h;
  for (let ty = 0; ty < h; ty++) {
    const y0 = ty * fy;
    const y1 = Math.min(sh, y0 + fy);
    for (let tx = 0; tx < w; tx++) {
      const x0 = tx * fx;
      const x1 = Math.min(sw, x0 + fx);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < y1; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < x1; x++) {
          const wgt = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
          const i = (y * sw + x) * 4;
          const al = s[i + 3] * wgt;
          r += s[i] * al;
          g += s[i + 1] * al;
          b += s[i + 2] * al;
          a += al;
          area += wgt;
        }
      }
      const o = (ty * w + tx) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = area > 0 ? a / area : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Mitchell-Netravali cubic (B = C = 1/3): smooth, with hardly any ringing at hard edges. */
function mitchell(x: number): number {
  x = Math.abs(x);
  if (x < 1) return (7 * x ** 3 - 12 * x ** 2 + 16 / 3) / 6;
  if (x < 2) return ((-7 / 3) * x ** 3 + 12 * x ** 2 - 20 * x + 32 / 3) / 6;
  return 0;
}

/** Taps and weights of each target position along one axis (source pixels clamped at the border). */
function cubicTaps(sn: number, n: number): { at: Int32Array; wt: Float32Array } {
  const at = new Int32Array(n * 4);
  const wt = new Float32Array(n * 4);
  const f = sn / n;
  for (let t = 0; t < n; t++) {
    const c = (t + 0.5) * f - 0.5;
    const i0 = Math.floor(c) - 1;
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const wgt = mitchell(c - (i0 + k));
      at[t * 4 + k] = Math.min(sn - 1, Math.max(0, i0 + k));
      wt[t * 4 + k] = wgt;
      sum += wgt;
    }
    for (let k = 0; k < 4; k++) wt[t * 4 + k] /= sum;
  }
  return { at, wt };
}

/**
 * Separable cubic resampling, for enlarging. Color is interpolated premultiplied by alpha, so
 * transparent pixels do not darken the edges.
 */
function resizeCubic(src: Raster, w: number, h: number): Raster {
  const { width: sw, height: sh, data: s } = src;
  const xs = cubicTaps(sw, w);
  const ys = cubicTaps(sh, h);
  // Rows first: sh rows of w premultiplied pixels.
  const tmp = new Float32Array(sh * w * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < 4; k++) {
        const i = (y * sw + xs.at[x * 4 + k]) * 4;
        const al = s[i + 3] * xs.wt[x * 4 + k];
        r += s[i] * al;
        g += s[i + 1] * al;
        b += s[i + 2] * al;
        a += al;
      }
      const o = (y * w + x) * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = a;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < 4; k++) {
        const i = (ys.at[y * 4 + k] * w + x) * 4;
        const wgt = ys.wt[y * 4 + k];
        r += tmp[i] * wgt;
        g += tmp[i + 1] * wgt;
        b += tmp[i + 2] * wgt;
        a += tmp[i + 3] * wgt;
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a;
    }
  }
  return { width: w, height: h, data: out };
}

/** Converts to Lab; a cache per 15-bit color keeps photos fast. */
export function toLab(src: Raster): LabImage {
  const n = src.width * src.height;
  const lab = new Float32Array(n * 3);
  const opaque = new Uint8Array(n);
  const cache = new Map<number, [number, number, number]>();
  const d = src.data;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    opaque[i] = d[i * 4 + 3] >= ALPHA_MIN ? 1 : 0;
    const key = (r << 16) | (g << 8) | b;
    let v = cache.get(key);
    if (!v) {
      v = rgbToLab(r, g, b);
      if (cache.size < 1 << 18) cache.set(key, v);
    }
    lab[i * 3] = v[0];
    lab[i * 3 + 1] = v[1];
    lab[i * 3 + 2] = v[2];
  }
  return { width: src.width, height: src.height, lab, opaque };
}
