import type { LabImage } from './raster';

/**
 * Local direction of the image's own structure: hair, fur, grain, the strokes of a drawing. The
 * structure tensor (the smoothed outer product of the gradient; Förstner & Gülch 1987, Bigün &
 * Granlund 1987) has its main eigenvector across edges; the direction along them is the one that
 * stitches should follow, as in coherence-enhancing and flow-based image abstraction (Weickert
 * 1999; Kang, Lee & Chui, "Coherent Line Drawing", 2007).
 *
 * The result is a line field (directions without a sign) in the doubled-angle form: per pixel
 * (cos 2θ, sin 2θ) of the direction along the structure, scaled by its coherence (0 to 1).
 * Doubled angles can be averaged and smoothed directly.
 */
export interface Orientation {
  width: number;
  height: number;
  /** Coherence times cos 2θ, sin 2θ of the direction along the structure (y down). */
  c: Float32Array;
  s: Float32Array;
}

/** Separable box blur, repeated three times (close to a Gaussian of sigma ≈ r). */
function blur(f: Float32Array, w: number, h: number, r: number): Float32Array {
  let src: Float32Array = f;
  const tmp = new Float32Array(f.length);
  let dst: Float32Array = new Float32Array(f.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1);
        acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    if (pass === 0) {
      src = dst;
      dst = new Float32Array(f.length);
    } else [src, dst] = [dst, src];
  }
  return src;
}

/**
 * Gradient energy (summed squared Sobel responses of L, a, b) below which an area counts as flat:
 * about 2.5 Lab units per pixel, below what a thread color change could show.
 */
const FLAT = 400;

/**
 * Structure tensor orientation of the image, integrated over about `sigma` pixels. Gradients come
 * from all three Lab channels (Di Zenzo), so a border between two colors of equal lightness counts.
 */
export function orientation(img: LabImage, sigma: number): Orientation {
  const { width: w, height: h, lab } = img;
  const jxx = new Float32Array(w * h);
  const jxy = new Float32Array(w * h);
  const jyy = new Float32Array(w * h);
  const at = (x: number, y: number, c: number) => lab[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 3 + c];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let xx = 0;
      let xy = 0;
      let yy = 0;
      for (let c = 0; c < 3; c++) {
        // Sobel.
        const gx =
          at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c);
        const gy =
          at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c);
        xx += gx * gx;
        xy += gx * gy;
        yy += gy * gy;
      }
      const i = y * w + x;
      jxx[i] = xx;
      jxy[i] = xy;
      jyy[i] = yy;
    }
  }
  const r = Math.max(1, Math.round(sigma / 1.7));
  const bxx = blur(jxx, w, h, r);
  const bxy = blur(jxy, w, h, r);
  const byy = blur(jyy, w, h, r);
  const c = new Float32Array(w * h);
  const s = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // Doubled angle of the gradient direction is (jxx - jyy, 2 jxy); the structure runs at right
    // angles to it, which negates the doubled-angle vector. Its length is λ1 - λ2; divided by
    // λ1 + λ2 it is the coherence (0: no preferred direction, 1: one clear direction), whatever
    // the contrast, so fine shading counts as much as hard edges. Flat areas (λ1 + λ2 under
    // FLAT) have no direction.
    const dc = -(bxx[i] - byy[i]);
    const ds = -2 * bxy[i];
    const energy = bxx[i] + byy[i];
    if (energy <= 0) continue;
    const k = Math.min(1, energy / FLAT) / energy;
    c[i] = dc * k;
    s[i] = ds * k;
  }
  return { width: w, height: h, c, s };
}
