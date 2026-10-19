export function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Separable Gaussian blur with zero padding; preserves the sum as long as values sit >= 3 sigma from the edge. */
export function gaussianBlur(src: Float32Array, cols: number, rows: number, sigma: number): Float32Array {
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      let s = 0;
      const lo = Math.max(-r, -x);
      const hi = Math.min(r, cols - 1 - x);
      for (let i = lo; i <= hi; i++) s += src[row + x + i] * k[i + r];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < rows; y++) {
    const lo = Math.max(-r, -y);
    const hi = Math.min(r, rows - 1 - y);
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let i = lo; i <= hi; i++) s += tmp[(y + i) * cols + x] * k[i + r];
      out[y * cols + x] = s;
    }
  }
  return out;
}
