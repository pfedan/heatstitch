import { distanceInside, distanceToSeeds } from '../image/edt';

/**
 * One connected color region, in its own pixel window, with a signed distance field.
 *
 * The field (negative inside, in mm) is what the stitch generators work on instead of traced
 * polygons: fill rows end where it crosses zero, satin rails are found by casting rays to its zero
 * level, underlay insets are its level sets. Its zero level lies halfway between inside and outside
 * pixel centers, so two neighbouring regions share the same boundary. A light blur rounds the pixel
 * steps (Ink/Stitch smooths traced outlines for the same reason).
 */
export interface Region {
  label: number;
  /** Window in image pixels; the mask has a margin of empty pixels around the region. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  pxMm: number;
  /** Region pixels (without the overlap into neighbours). */
  mask: Uint8Array;
  /** Distance of each region pixel to the nearest pixel outside, in pixels. */
  inside: Float32Array;
  /** Signed distance in mm, negative inside, of the region grown by the overlap. */
  sdf: Float32Array;
  /** Signed distance in mm of the region itself (for satin and running stitch). */
  sdfBase: Float32Array;
  areaMm2: number;
}

const MARGIN = 6;

function signedField(mask: Uint8Array, w: number, h: number, pxMm: number): Float32Array {
  const dIn = distanceInside(mask, w, h);
  const dOut = distanceToSeeds(mask, w, h);
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = (mask[i] ? -(dIn[i] - 0.5) : dOut[i] - 0.5) * pxMm;
  return blur(f, w, h, 0.7);
}

/** Separable Gaussian blur with sigma in pixels. */
function blur(f: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(2.5 * sigma);
  const k = Float32Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const tmp = new Float32Array(f.length);
  const out = new Float32Array(f.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let ws = 0;
      for (let j = -r; j <= r; j++) {
        const xx = Math.min(w - 1, Math.max(0, x + j));
        s += f[y * w + xx] * k[j + r];
        ws += k[j + r];
      }
      tmp[y * w + x] = s / ws;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let ws = 0;
      for (let j = -r; j <= r; j++) {
        const yy = Math.min(h - 1, Math.max(0, y + j));
        s += tmp[yy * w + x] * k[j + r];
        ws += k[j + r];
      }
      out[y * w + x] = s / ws;
    }
  }
  return out;
}

/**
 * Builds the region for component `comp`. `grow` (mm) extends the fill field into neighbouring
 * pixels for which `growInto(label)` holds: objects sewn earlier reach a little under the ones sewn
 * later, so no fabric shows between them.
 */
export function buildRegion(
  compMap: Int32Array,
  labels: Uint8Array,
  imgW: number,
  comp: number,
  label: number,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  imgH: number,
  pxMm: number,
  grow: number,
  growInto: (label: number) => boolean,
): Region {
  const growPx = Math.ceil(grow / pxMm);
  const m = MARGIN + growPx;
  const x0 = bbox.minX - m;
  const y0 = bbox.minY - m;
  const w = bbox.maxX - bbox.minX + 1 + 2 * m;
  const h = bbox.maxY - bbox.minY + 1 + 2 * m;
  const mask = new Uint8Array(w * h);
  let area = 0;
  for (let y = 0; y < h; y++) {
    const iy = y + y0;
    if (iy < 0 || iy >= imgH) continue;
    for (let x = 0; x < w; x++) {
      const ix = x + x0;
      if (ix < 0 || ix >= imgW) continue;
      if (compMap[iy * imgW + ix] === comp) {
        mask[y * w + x] = 1;
        area++;
      }
    }
  }
  const inside = distanceInside(mask, w, h);
  const sdfBase = signedField(mask, w, h, pxMm);
  let sdf = sdfBase;
  if (growPx > 0) {
    const dOut = distanceToSeeds(mask, w, h);
    const grown = mask.slice();
    for (let y = 0; y < h; y++) {
      const iy = y + y0;
      if (iy < 0 || iy >= imgH) continue;
      for (let x = 0; x < w; x++) {
        const ix = x + x0;
        const i = y * w + x;
        if (ix < 0 || ix >= imgW || grown[i] || dOut[i] * pxMm > grow) continue;
        if (growInto(labels[iy * imgW + ix])) grown[i] = 1;
      }
    }
    sdf = signedField(grown, w, h, pxMm);
  }
  return { label, x0, y0, w, h, pxMm, mask, inside, sdf, sdfBase, areaMm2: area * pxMm * pxMm };
}

/** Bilinear sample of a field at image mm coordinates; far outside the window is "outside". */
export function sample(r: Region, field: Float32Array, xMm: number, yMm: number): number {
  const u = xMm / r.pxMm - 0.5 - r.x0;
  const v = yMm / r.pxMm - 0.5 - r.y0;
  if (u < 0 || v < 0 || u > r.w - 1 || v > r.h - 1) return 10;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const i1 = Math.min(r.w - 1, i + 1);
  const j1 = Math.min(r.h - 1, j + 1);
  const a = field[j * r.w + i];
  const b = field[j * r.w + i1];
  const c = field[j1 * r.w + i];
  const d = field[j1 * r.w + i1];
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

/** Image mm coordinates of the center of window pixel (x, y). */
export const pixelMm = (r: Region, x: number, y: number): [number, number] => [(x + r.x0 + 0.5) * r.pxMm, (y + r.y0 + 0.5) * r.pxMm];
