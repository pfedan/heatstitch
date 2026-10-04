/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled
 * Functions", Theory of Computing 8, 2012): two passes of the 1D lower envelope of parabolas, linear
 * in the number of pixels.
 */

const BIG = 1e20;

/** Squared 1D distance transform of f (length n) into d; v, z are scratch buffers. */
function edt1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -BIG;
  z[1] = BIG;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = BIG;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Distance (pixels) from every pixel to the nearest seed pixel (`seed[i]` set). Without seeds all
 * distances are huge. With `border`, the ring of pixels just outside the image counts as seeds.
 */
export function distanceToSeeds(seed: Uint8Array, w: number, h: number, border = false): Float32Array {
  const pad = border ? 1 : 0;
  const W = w + 2 * pad;
  const H = h + 2 * pad;
  const g = new Float64Array(W * H).fill(BIG);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ix = x - pad;
      const iy = y - pad;
      const outside = ix < 0 || iy < 0 || ix >= w || iy >= h;
      if (outside || seed[iy * w + ix]) g[y * W + x] = 0;
    }
  }
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = g[y * W + x];
    edt1d(f, d, v, z, H);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x];
    edt1d(f, d, v, z, W);
    for (let x = 0; x < W; x++) g[y * W + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(g[(y + pad) * W + x + pad]);
  return out;
}

/** Distance from every inside pixel (mask set) to the nearest outside pixel; outside the image is outside. */
export function distanceInside(mask: Uint8Array, w: number, h: number): Float32Array {
  const outside = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) outside[i] = mask[i] ? 0 : 1;
  return distanceToSeeds(outside, w, h, true);
}
