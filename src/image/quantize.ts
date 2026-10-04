import { deltaE2000, type Lab } from './color';
import type { LabImage } from './raster';

/**
 * Color quantization for embroidery: few colors, flat regions, no dithering.
 *
 * Weighted k-means on a Lab histogram, which Celebi ("Improving the performance of k-means for
 * color quantization", Image Vis. Comput. 29(4), 2011) found the most effective and among the
 * fastest methods; unlike Wu or median cut alone it keeps small but distinct regions (his example:
 * the whites of the eyes). Pixels are weighted by a simple saliency term (local contrast and
 * chroma), so small accents get a cluster of their own. The number of colors is the user's maximum,
 * reduced while two clusters are nearly the same color or a tiny cluster is not distinctive.
 */

/** Pixels that are not quantized (transparent). */
export const NONE = 255;

export interface QuantizeOptions {
  /** Upper bound for the number of colors (2 to 16). */
  maxColors: number;
}

export interface Quantized {
  centers: Lab[];
  /** Cluster per pixel, NONE for transparent pixels. */
  labels: Uint8Array;
}

/** Clusters closer than this (CIEDE2000) are one color. */
const MERGE_DE = 6;
/** Clusters below this share of the pixels are dropped unless they are distinctive. */
const MIN_SHARE = 0.004;
/** A small cluster this far from every other one is an accent worth keeping. */
const ACCENT_DE = 22;
/** Weight of the saliency term (1 + ALPHA * saliency per pixel). */
const ALPHA = 3;

interface Bin {
  l: number;
  a: number;
  b: number;
  w: number;
  /** Pixel count, for the share of each cluster. */
  n: number;
}

/** Local contrast against a 7 x 7 box mean, plus chroma; 0 to 1. */
function saliency(img: LabImage): Float32Array {
  const { width: w, height: h, lab } = img;
  const r = 3;
  // Separable box mean of the three channels.
  const tmp = new Float32Array(lab.length);
  const mean = new Float32Array(lab.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = x0; k <= x1; k++) s += lab[(y * w + k) * 3 + c];
        tmp[(y * w + x) * 3 + c] = s / (x1 - x0 + 1);
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = y0; k <= y1; k++) s += tmp[(k * w + x) * 3 + c];
        mean[(y * w + x) * 3 + c] = s / (y1 - y0 + 1);
      }
    }
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.hypot(lab[i * 3] - mean[i * 3], lab[i * 3 + 1] - mean[i * 3 + 1], lab[i * 3 + 2] - mean[i * 3 + 2]);
    const chroma = Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2]);
    out[i] = Math.min(1, d / 25 + 0.3 * Math.min(1, chroma / 60));
  }
  return out;
}

function histogram(img: LabImage): Bin[] {
  const { lab, opaque } = img;
  const sal = saliency(img);
  const bins = new Map<number, Bin>();
  for (let i = 0; i < opaque.length; i++) {
    if (!opaque[i]) continue;
    const L = lab[i * 3];
    const A = lab[i * 3 + 1];
    const B = lab[i * 3 + 2];
    // 3 units of lightness, 4 of a and b: below what a thread palette can tell apart.
    const key = (Math.round(L / 3) * 128 + Math.round(A / 4) + 64) * 128 + Math.round(B / 4) + 64;
    const wt = 1 + ALPHA * sal[i];
    let bin = bins.get(key);
    if (!bin) bins.set(key, (bin = { l: 0, a: 0, b: 0, w: 0, n: 0 }));
    bin.l += L * wt;
    bin.a += A * wt;
    bin.b += B * wt;
    bin.w += wt;
    bin.n++;
  }
  const out = [...bins.values()];
  for (const b of out) {
    b.l /= b.w;
    b.a /= b.w;
    b.b /= b.w;
  }
  return out;
}

const d2 = (b: Bin, c: Lab) => (b.l - c[0]) ** 2 + (b.a - c[1]) ** 2 + (b.b - c[2]) ** 2;

function nearest(b: Bin, centers: Lab[]): number {
  let best = 0;
  let bd = Infinity;
  for (let k = 0; k < centers.length; k++) {
    const d = d2(b, centers[k]);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** Lloyd iterations on the weighted bins; empty clusters are removed. */
function lloyd(bins: Bin[], centers: Lab[], iterations: number): Lab[] {
  for (let it = 0; it < iterations; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const b of bins) {
      const s = sum[nearest(b, centers)];
      s[0] += b.l * b.w;
      s[1] += b.a * b.w;
      s[2] += b.b * b.w;
      s[3] += b.w;
    }
    let moved = 0;
    const next: Lab[] = [];
    sum.forEach((s, k) => {
      if (s[3] <= 0) return;
      const c: Lab = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      moved = Math.max(moved, Math.hypot(c[0] - centers[k][0], c[1] - centers[k][1], c[2] - centers[k][2]));
      next.push(c);
    });
    centers = next;
    if (moved < 0.05) break;
  }
  return centers;
}

/**
 * Deterministic seeding in the spirit of k-means++: start with the heaviest bin, then repeatedly
 * take the bin with the largest weight times squared distance to its nearest seed.
 */
function seed(bins: Bin[], k: number): Lab[] {
  let first = bins[0];
  for (const b of bins) if (b.w > first.w) first = b;
  const centers: Lab[] = [[first.l, first.a, first.b]];
  const dist = bins.map((b) => d2(b, centers[0]));
  while (centers.length < k) {
    let best = -1;
    let bs = 0;
    for (let i = 0; i < bins.length; i++) {
      const s = bins[i].w * dist[i];
      if (s > bs) {
        bs = s;
        best = i;
      }
    }
    if (best < 0) break;
    const c: Lab = [bins[best].l, bins[best].a, bins[best].b];
    centers.push(c);
    for (let i = 0; i < bins.length; i++) dist[i] = Math.min(dist[i], d2(bins[i], c));
  }
  return centers;
}

/** Pixel share per cluster. */
function shares(bins: Bin[], centers: Lab[]): number[] {
  const n = centers.map(() => 0);
  let total = 0;
  for (const b of bins) {
    n[nearest(b, centers)] += b.n;
    total += b.n;
  }
  return n.map((v) => v / Math.max(1, total));
}

/** Merges near-identical clusters and drops tiny ones that are not distinctive. */
function reduce(bins: Bin[], centers: Lab[]): Lab[] {
  for (let guard = 0; guard < 32 && centers.length > 1; guard++) {
    const share = shares(bins, centers);
    let mi = -1;
    let mj = -1;
    let md = Infinity;
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const d = deltaE2000(centers[i], centers[j]);
        if (d < md) {
          md = d;
          mi = i;
          mj = j;
        }
      }
    }
    if (md < MERGE_DE) {
      const wi = share[mi];
      const wj = share[mj];
      const t = wi + wj > 0 ? wj / (wi + wj) : 0.5;
      const c = centers[mi].map((v, k) => v + (centers[mj][k] - v) * t) as Lab;
      centers = centers.filter((_, k) => k !== mi && k !== mj).concat([c]);
      centers = lloyd(bins, centers, 3);
      continue;
    }
    let drop = -1;
    for (let i = 0; i < centers.length; i++) {
      if (share[i] >= MIN_SHARE || (drop >= 0 && share[i] >= share[drop])) continue;
      const distinct = centers.every((c, j) => j === i || deltaE2000(c, centers[i]) > ACCENT_DE);
      if (!distinct) drop = i;
    }
    if (drop < 0) break;
    centers = lloyd(bins, centers.filter((_, k) => k !== drop), 3);
  }
  return centers;
}

/** Index of the nearest center per pixel (Euclidean in Lab). */
export function assign(img: LabImage, centers: Lab[]): Uint8Array {
  const { lab, opaque } = img;
  const out = new Uint8Array(opaque.length).fill(NONE);
  for (let i = 0; i < opaque.length; i++) {
    if (!opaque[i]) continue;
    const L = lab[i * 3];
    const A = lab[i * 3 + 1];
    const B = lab[i * 3 + 2];
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < centers.length; k++) {
      const c = centers[k];
      const d = (L - c[0]) ** 2 + (A - c[1]) ** 2 + (B - c[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    out[i] = best;
  }
  return out;
}

export function quantize(img: LabImage, o: QuantizeOptions): Quantized {
  const bins = histogram(img);
  if (!bins.length) return { centers: [], labels: new Uint8Array(img.opaque.length).fill(NONE) };
  const k = Math.max(1, Math.min(16, Math.round(o.maxColors), bins.length));
  const centers = reduce(bins, lloyd(bins, seed(bins, k), 30));
  return { centers, labels: assign(img, centers) };
}
