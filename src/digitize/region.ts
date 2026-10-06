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

/**
 * Signed fields of the last masks: sewing an object anew (another spacing, the correction trying
 * variants, a border following its fill) rasters the same area again and again, and the distance
 * transforms are the costly part. Found by size and content; callers get a copy.
 */
const fields: { w: number; h: number; pxMm: number; hash: number; mask: Uint8Array; field: Float32Array }[] = [];
const FIELDS = 12;

function maskHash(mask: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < mask.length; i++) if (mask[i]) h = Math.imul(h ^ i, 16777619);
  return h >>> 0;
}

export function signedField(mask: Uint8Array, w: number, h: number, pxMm: number): Float32Array {
  const hash = maskHash(mask);
  const hit = fields.find((c) => c.w === w && c.h === h && c.pxMm === pxMm && c.hash === hash && sameMask(c.mask, mask));
  if (hit) return hit.field.slice();
  const field = computeField(mask, w, h, pxMm);
  fields.unshift({ w, h, pxMm, hash, mask: mask.slice(), field: field.slice() });
  if (fields.length > FIELDS) fields.pop();
  return field;
}

function sameMask(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!a[i] !== !b[i]) return false;
  return true;
}

function computeField(mask: Uint8Array, w: number, h: number, pxMm: number): Float32Array {
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

/**
 * Outline of a region: the zero level of its own signed distance, as closed polylines in mm
 * (marching squares between pixel centers, the crossings interpolated); with `level`, the line
 * that far outside (+) or inside (-) the edge of `field`.
 */
export function outline(r: Region, level = 0, field = r.sdfBase): [number, number][][] {
  const { w, h } = r;
  const f = level ? field.map((v) => v - level) : field;
  // Edges between neighbouring pixel centers carry the crossing points: horizontal edge (x, y)
  // to (x + 1, y) has id 2 * (y * w + x), vertical edge (x, y) to (x, y + 1) the id after it.
  const point = (id: number): [number, number] => {
    const k = id >> 1;
    const x = k % w;
    const y = (k - x) / w;
    const a = f[k];
    const b = id & 1 ? f[k + w] : f[k + 1];
    const t = a === b ? 0.5 : a / (a - b);
    const px = id & 1 ? x : x + t;
    const py = id & 1 ? y + t : y;
    return [(px + r.x0 + 0.5) * r.pxMm, (py + r.y0 + 0.5) * r.pxMm];
  };
  const next = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    next.set(a, [...(next.get(a) ?? []), b]);
    next.set(b, [...(next.get(b) ?? []), a]);
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const k = y * w + x;
      const c = (f[k] < 0 ? 1 : 0) | (f[k + 1] < 0 ? 2 : 0) | (f[k + w + 1] < 0 ? 4 : 0) | (f[k + w] < 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const top = 2 * k;
      const bottom = 2 * (k + w);
      const left = 2 * k + 1;
      const right = 2 * (k + 1) + 1;
      // Edges whose two ends lie on different sides, paired around the cell.
      const cut = [top, right, bottom, left].filter((_, e) => {
        const corners = [
          [1, 2],
          [2, 4],
          [8, 4],
          [1, 8],
        ][e];
        return !(c & corners[0]) !== !(c & corners[1]);
      });
      if (cut.length === 2) link(cut[0], cut[1]);
      else if (cut.length === 4) {
        link(cut[0], cut[1]);
        link(cut[2], cut[3]);
      }
    }
  }
  const out: [number, number][][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const line: [number, number][] = [];
    let prev = -1;
    let cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      line.push(point(cur));
      const n: number[] = next.get(cur) ?? [];
      const to = n[0] !== prev ? n[0] : n[1];
      prev = cur;
      cur = to;
    }
    if (line.length > 2) {
      line.push(line[0]);
      out.push(line);
    }
  }
  return out;
}

/**
 * The region grown (`mm` > 0) or shrunk (`mm` < 0) on all sides by that distance (Ink/Stitch's
 * expand): its window gets wider by as much, and its fields are made anew. Null when nothing is
 * left of it.
 */
export function expandRegion(r: Region, mm: number): Region | null {
  if (Math.abs(mm) < 1e-3) return r;
  const pad = mm > 0 ? Math.ceil(mm / r.pxMm) + 1 : 0;
  const w = r.w + 2 * pad;
  const h = r.h + 2 * pad;
  const own = new Uint8Array(w * h);
  // From the area the fill covers now (its field, which may reach a little under neighbours).
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) own[(y + pad) * w + x + pad] = r.sdf[y * r.w + x] < 0 ? 1 : 0;
  const d = mm > 0 ? distanceToSeeds(own, w, h) : distanceInside(own, w, h);
  const limit = Math.abs(mm) / r.pxMm;
  const mask = new Uint8Array(w * h);
  let area = 0;
  for (let i = 0; i < mask.length; i++) {
    // Pixel centers lie half a pixel from the seeds' edges.
    const on = mm > 0 ? own[i] === 1 || d[i] - 0.5 <= limit : own[i] === 1 && d[i] - 0.5 > limit;
    if (!on) continue;
    mask[i] = 1;
    area++;
  }
  if (!area) return null;
  const sdf = signedField(mask, w, h, r.pxMm);
  return { label: r.label, x0: r.x0 - pad, y0: r.y0 - pad, w, h, pxMm: r.pxMm, mask, inside: distanceInside(mask, w, h), sdf, sdfBase: sdf, areaMm2: area * r.pxMm * r.pxMm };
}
