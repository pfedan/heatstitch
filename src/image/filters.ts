import type { LabImage, Raster } from './raster';

/**
 * Edge-preserving smoothing for photos: a bilateral filter (Tomasi & Manduchi 1998) in Lab,
 * applied separably along rows and columns and iterated, as in real-time video abstraction
 * (Winnemöller, Olsen & Gooch 2006). Each pass averages over neighbours of similar color only,
 * so texture and noise flatten into regions while the edges between regions stay sharp.
 *
 * `sigmaS` is the spatial sigma in pixels, `sigmaR` the range sigma in Lab units.
 */
export function bilateral(img: LabImage, iterations: number, sigmaS: number, sigmaR: number): LabImage {
  const { width: w, height: h, opaque } = img;
  let src: Float32Array = img.lab;
  let dst: Float32Array = new Float32Array(src.length);
  const r = Math.max(1, Math.ceil(2 * sigmaS));
  const spatial = Float32Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigmaS * sigmaS)));
  // Range weights from a table: the exponential dominates the cost otherwise.
  const maxD2 = 9 * sigmaR * sigmaR;
  const LUT_SIZE = 1024;
  const lutScale = LUT_SIZE / maxD2;
  const lut = Float32Array.from({ length: LUT_SIZE }, (_, k) => Math.exp(-(k / lutScale) / (2 * sigmaR * sigmaR)));
  const pass = (horizontal: boolean) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const L = src[i * 3];
        const A = src[i * 3 + 1];
        const B = src[i * 3 + 2];
        if (!opaque[i]) {
          dst[i * 3] = L;
          dst[i * 3 + 1] = A;
          dst[i * 3 + 2] = B;
          continue;
        }
        let sl = 0;
        let sa = 0;
        let sb = 0;
        let sw = 0;
        for (let k = -r; k <= r; k++) {
          const qx = horizontal ? x + k : x;
          const qy = horizontal ? y : y + k;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx;
          if (!opaque[q]) continue;
          const ql = src[q * 3];
          const qa = src[q * 3 + 1];
          const qb = src[q * 3 + 2];
          const d2 = (ql - L) ** 2 + (qa - A) ** 2 + (qb - B) ** 2;
          if (d2 >= maxD2) continue;
          const wt = spatial[k + r] * lut[(d2 * lutScale) | 0];
          sl += ql * wt;
          sa += qa * wt;
          sb += qb * wt;
          sw += wt;
        }
        dst[i * 3] = sl / sw;
        dst[i * 3 + 1] = sa / sw;
        dst[i * 3 + 2] = sb / sw;
      }
    }
    [src, dst] = [dst, src];
  };
  for (let it = 0; it < iterations; it++) {
    pass(true);
    pass(false);
  }
  return { ...img, lab: src === img.lab ? src.slice() : src };
}

/**
 * Photo or graphic: in logos and clip art a few exact colors cover almost every pixel; in photos
 * no small set does. Used to suggest how much to smooth.
 */
export function looksLikePhoto(src: Raster): boolean {
  const counts = new Map<number, number>();
  const d = src.data;
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    opaque++;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!opaque) return false;
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, 16);
  return top.reduce((s, v) => s + v, 0) / opaque < 0.85;
}
