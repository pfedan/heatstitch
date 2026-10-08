import type { ExactLabels, Stroke } from './prepare';

/**
 * Zuschneiden: the part of the picture that becomes the design, a rectangle as shares (0..1) of the
 * picture as opened. The picture itself stays whole, so the cut can be widened again later.
 */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a drag on the frame grabbed it: an edge, a corner or the inside (move). */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | 'move';

/** Smallest side of a cut, as a share of the picture. */
export const MIN_CROP = 0.03;

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The cut, or the whole picture. */
export const cropOf = (c: Crop | undefined): Crop => c ?? FULL;

/** True for (nearly) the whole picture: no cut. */
export function isFull(c: Crop | undefined): boolean {
  if (!c) return true;
  const e = 1e-4;
  return c.x < e && c.y < e && c.x + c.w > 1 - e && c.y + c.h > 1 - e;
}

/** A cut read from storage or a project file: inside the picture and not too small, else none. */
export function readCrop(v: unknown): Crop | undefined {
  const c = v as Partial<Crop> | null;
  if (!c || typeof c !== 'object') return undefined;
  const nums = [c.x, c.y, c.w, c.h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  const x = clamp(c.x!, 0, 1 - MIN_CROP);
  const y = clamp(c.y!, 0, 1 - MIN_CROP);
  const out = { x, y, w: clamp(c.w!, MIN_CROP, 1 - x), h: clamp(c.h!, MIN_CROP, 1 - y) };
  return isFull(out) ? undefined : out;
}

/**
 * The cut after dragging `handle` by (dx, dy), shares of the picture. Edges stop at the picture
 * and at the smallest size; the inside moves the whole cut, which stays inside the picture.
 */
export function dragCrop(c: Crop, handle: CropHandle, dx: number, dy: number): Crop {
  if (handle === 'move') return { ...c, x: clamp(c.x + dx, 0, 1 - c.w), y: clamp(c.y + dy, 0, 1 - c.h) };
  let x0 = c.x;
  let y0 = c.y;
  let x1 = c.x + c.w;
  let y1 = c.y + c.h;
  if (handle.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN_CROP);
  if (handle.includes('e')) x1 = clamp(x1 + dx, x0 + MIN_CROP, 1);
  if (handle.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN_CROP);
  if (handle.includes('s')) y1 = clamp(y1 + dy, y0 + MIN_CROP, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The handle at (px, py), shares of the picture; `tx`, `ty` is how near counts (also as shares).
 * Corners before edges, the inside moves only a real cut (on the whole picture a drag pans).
 */
export function cropHandleAt(c: Crop, px: number, py: number, tx: number, ty: number): CropHandle | null {
  const x1 = c.x + c.w;
  const y1 = c.y + c.h;
  const inX = px > c.x - tx && px < x1 + tx;
  const inY = py > c.y - ty && py < y1 + ty;
  if (!inX || !inY) return null;
  const n = Math.abs(py - c.y) < ty;
  const s = !n && Math.abs(py - y1) < ty;
  const w = Math.abs(px - c.x) < tx;
  const e = !w && Math.abs(px - x1) < tx;
  const v = n ? 'n' : s ? 's' : '';
  const h = w ? 'w' : e ? 'e' : '';
  if (v || h) return (v + h) as CropHandle;
  return isFull(c) ? null : 'move';
}

/** The cut in whole pixels of a picture of W × H, at least one pixel. */
export function cropPixels(c: Crop | undefined, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const k = cropOf(c);
  const x = clamp(Math.round(k.x * W), 0, W - 1);
  const y = clamp(Math.round(k.y * H), 0, H - 1);
  return { x, y, w: clamp(Math.round((k.x + k.w) * W) - x, 1, W - x), h: clamp(Math.round((k.y + k.h) * H) - y, 1, H - y) };
}

/**
 * A brush stroke painted on the cut `from`, moved onto the cut `to`: it stays on the same spot of
 * the picture. Strokes keep their points as shares of the cut and the radius as a share of its width.
 */
export function moveStroke(s: Stroke, from: Crop | undefined, to: Crop | undefined): Stroke {
  const a = cropOf(from);
  const b = cropOf(to);
  return {
    ...s,
    points: s.points.map(([x, y]) => [(a.x + x * a.w - b.x) / b.w, (a.y + y * a.h - b.y) / b.h]),
    radius: (s.radius * a.w) / b.w,
  };
}

/**
 * The part of the picture that differs from its background, as a cut with a small margin; none when
 * the picture has no plain background or the motif fills it. The background is the color of the
 * corners when at least three of them agree; transparent pixels count as background too.
 */
export function contentCrop(data: Uint8ClampedArray, W: number, H: number): Crop | undefined {
  if (W < 4 || H < 4) return undefined;
  const at = (x: number, y: number) => (y * W + x) * 4;
  const corners = [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)];
  const near = (i: number, j: number) =>
    (data[i + 3] < 16 && data[j + 3] < 16) ||
    (Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) < 48 && Math.abs(data[i + 3] - data[j + 3]) < 48);
  const bg = corners.find((i) => corners.filter((j) => near(i, j)).length >= 3);
  if (bg === undefined) return undefined;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (near(at(x, y), bg)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return undefined;
  // A margin of 2 % of the motif keeps its edge stitches clear of the cut.
  const m = Math.ceil(0.02 * Math.max(x1 - x0 + 1, y1 - y0 + 1));
  const c = readCrop({ x: Math.max(0, x0 - m) / W, y: Math.max(0, y0 - m) / H, w: (Math.min(W, x1 + 1 + m) - Math.max(0, x0 - m)) / W, h: (Math.min(H, y1 + 1 + m) - Math.max(0, y0 - m)) / H });
  return c;
}

/**
 * The regions of a vector picture drawn whole, cut to `c` and brought to w × h (nearest pixel).
 */
export function cutLabels(full: ExactLabels, c: Crop | undefined, w: number, h: number): ExactLabels {
  const k = cropOf(c);
  const labels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(full.height - 1, Math.floor((k.y + ((y + 0.5) / h) * k.h) * full.height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(full.width - 1, Math.floor((k.x + ((x + 0.5) / w) * k.w) * full.width));
      labels[y * w + x] = full.labels[sy * full.width + sx];
    }
  }
  return { width: w, height: h, labels, colors: full.colors };
}
