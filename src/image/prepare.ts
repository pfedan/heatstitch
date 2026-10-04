import type { ThreadColor } from '../model/pattern';
import { pecThreads } from '../parsers/pecPalette';
import { deltaE2000, labToRgb, rgbToLab, type Lab, type Rgb } from './color';
import { bilateral } from './filters';
import { mergeSmall, modeFilter, removeBackground, removeSeams } from './labels';
import { orientation, type Orientation } from './orientation';
import { NONE, quantize, type Quantized } from './quantize';
import { resizeArea, toLab, type LabImage, type Raster } from './raster';

/**
 * Turns any image into an image that can be embroidered: a few flat thread colors, regions large
 * enough to sew, no anti-aliasing seams, the background left out. Stages, each cached for the next
 * change of a later setting:
 *
 * 1. Resample to the working resolution and convert to Lab; smooth photos edge-preservingly.
 * 2. Quantize to at most `maxColors` colors.
 * 3. Match threads, apply the user's color changes and brush strokes, remove the background,
 *    clean up the regions.
 */

export interface PrepareOptions {
  /** Width of the design in mm; the height follows the image's aspect ratio. */
  widthMm: number;
  /** Most thread colors (2 to 16). */
  maxColors: number;
  /** Smoothing passes for photos (0 = off). */
  smooth: number;
  /** Regions below this area (mm²) are merged into their neighbours. */
  minAreaMm2: number;
  /** Leave the border-connected background unsewn. */
  background: boolean;
  /** Use the nearest Brother thread colors instead of the image's own colors. */
  threads: boolean;
}

export const DEFAULT_PREPARE: PrepareOptions = {
  widthMm: 80,
  maxColors: 6,
  smooth: 0,
  minAreaMm2: 3,
  background: true,
  threads: true,
};

/** A user's change to one color of the quantized image, keyed by the color it was found as. */
export interface ColorEdit {
  /** Color of the cluster as quantized (before thread matching). */
  from: Rgb;
  /** Not sewn, merged into another color (by its quantized color), or sewn with another thread. */
  skip?: boolean;
  merge?: Rgb;
  thread?: ThreadColor;
}

/** A brush stroke in image coordinates (0..1 of the width for x, of the height for y). */
export interface Stroke {
  points: [number, number][];
  /** Brush radius as a share of the image width. */
  radius: number;
  /**
   * Color painted with, as the `source` of a palette entry (so a later thread change of that color
   * applies to the painted pixels too); null erases (not sewn).
   */
  color: Rgb | null;
}

export interface PaletteEntry {
  /** Color shown and sewn. */
  thread: ThreadColor;
  lab: Lab;
  /** Color the cluster was quantized as, the key for color edits; equal to the thread for painted colors. */
  source: Rgb;
  /** CIEDE2000 between the image color and the thread (0 without thread matching). */
  deltaE: number;
  /** Area in mm² (also for skipped colors). */
  areaMm2: number;
  sew: boolean;
}

export interface Prepared {
  width: number;
  height: number;
  /** Millimetres per pixel. */
  pxMm: number;
  /** Palette index per pixel, NONE where nothing is sewn. */
  labels: Uint8Array;
  palette: PaletteEntry[];
  /** Direction of the image's own structure (fur, strands, strokes), for the stitch direction. */
  orient?: Orientation;
}

/** Working resolution: 0.1 mm per pixel, coarser for designs over 120 mm so the image stays near 1200 px. */
export function workingPxMm(widthMm: number, heightMm: number): number {
  return Math.max(0.1, Math.max(widthMm, heightMm) / 1200);
}

const THREADS = pecThreads().map((t) => ({ t, lab: rgbToLab(t.r, t.g, t.b) }));

/** Nearest Brother thread by CIEDE2000. */
export function nearestThread(lab: Lab): { thread: ThreadColor; deltaE: number } {
  let best = THREADS[0];
  let bd = Infinity;
  for (const c of THREADS) {
    const d = deltaE2000(lab, c.lab);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return { thread: best.t, deltaE: bd };
}

const sameRgb = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Index of the entry whose source color matches `c` (within a small CIEDE2000 tolerance). */
function findSource(palette: { source: Rgb }[], c: Rgb, tolerance = 8): number {
  const lab = rgbToLab(...c);
  let best = -1;
  let bd = tolerance;
  palette.forEach((p, i) => {
    if (sameRgb(p.source, c)) {
      best = i;
      bd = -1;
    }
    if (bd < 0) return;
    const d = deltaE2000(lab, rgbToLab(...p.source));
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/**
 * Palette entry each stroke paints with: the entry with the stroke's color as its source, else a new
 * entry (thread matched like the clusters). NONE for erasing.
 */
function strokeLabels(palette: PaletteEntry[], strokes: Stroke[], threads: boolean): number[] {
  return strokes.map((s) => {
    if (!s.color) return NONE;
    const i = findSource(palette, s.color, 3);
    if (i >= 0) return i;
    if (palette.length >= NONE) return NONE;
    const lab = rgbToLab(...s.color);
    const near = threads ? nearestThread(lab) : null;
    const thread: ThreadColor = near?.thread ?? { r: s.color[0], g: s.color[1], b: s.color[2] };
    palette.push({ thread, lab: rgbToLab(thread.r, thread.g, thread.b), source: s.color, deltaE: near?.deltaE ?? 0, areaMm2: 0, sew: true });
    return palette.length - 1;
  });
}

/** Paints the strokes into the label map, each with its label. */
function paint(labels: Uint8Array, w: number, h: number, strokes: Stroke[], labelOf: number[]): void {
  strokes.forEach((s, si) => {
    const label = labelOf[si];
    const r = s.radius * w;
    const r2 = r * r;
    const stamp = (cx: number, cy: number) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) labels[y * w + x] = label;
        }
      }
    };
    for (let i = 0; i < s.points.length; i++) {
      const [x1, y1] = [s.points[i][0] * w, s.points[i][1] * h];
      const [x0, y0] = i > 0 ? [s.points[i - 1][0] * w, s.points[i - 1][1] * h] : [x1, y1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(0.5, r / 2)));
      for (let k = i > 0 ? 1 : 0; k <= steps; k++) stamp(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
    }
  });
}

/** Keeps the expensive stages of the last run and recomputes only what a change needs. */
export class Preparer {
  private smoothed: { key: string; img: LabImage; pxMm: number; orient: Orientation } | null = null;
  private quantized: { key: string; q: Quantized } | null = null;

  constructor(private source: Raster) {}

  run(o: PrepareOptions, edits: ColorEdit[] = [], strokes: Stroke[] = []): Prepared {
    const src = this.source;
    const heightMm = (o.widthMm * src.height) / src.width;
    const pxMm = workingPxMm(o.widthMm, heightMm);
    const w = Math.max(1, Math.round(o.widthMm / pxMm));
    const h = Math.max(1, Math.round(heightMm / pxMm));

    const smoothKey = `${w}x${h}:${o.smooth}`;
    if (this.smoothed?.key !== smoothKey) {
      let img = toLab(resizeArea(src, w, h));
      // The direction of fur and strands comes from the image before smoothing flattens them,
      // integrated over about 1 mm.
      const orient = orientation(img, 1 / pxMm);
      // 0.4 mm spatial sigma: texture finer than the thread is flattened, edges stay.
      if (o.smooth > 0) img = bilateral(img, Math.round(o.smooth), Math.max(1, 0.4 / pxMm), 8);
      this.smoothed = { key: smoothKey, img, pxMm, orient };
      this.quantized = null;
    }
    const img = this.smoothed.img;
    const qKey = `${o.maxColors}`;
    if (this.quantized?.key !== qKey) this.quantized = { key: qKey, q: quantize(img, { maxColors: o.maxColors }) };
    const { centers, labels: raw } = this.quantized.q;
    return { ...finish(img, pxMm, centers, raw, o, edits, strokes), orient: this.smoothed.orient };
  }
}

function finish(
  img: LabImage,
  pxMm: number,
  centers: Lab[],
  raw: Uint8Array,
  o: PrepareOptions,
  edits: ColorEdit[],
  strokes: Stroke[],
): Prepared {
  const { width: w, height: h } = img;
  // Clusters, then thread matching: clusters that land on the same thread become one color.
  let palette: PaletteEntry[] = [];
  const map = new Uint8Array(256).fill(NONE);
  centers.forEach((lab, k) => {
    const source = labToRgb(...lab);
    let entry: PaletteEntry;
    if (o.threads) {
      const { thread, deltaE } = nearestThread(lab);
      const same = palette.findIndex((p) => p.thread.pecIndex === thread.pecIndex);
      if (same >= 0) {
        map[k] = same;
        return;
      }
      entry = { thread, lab: rgbToLab(thread.r, thread.g, thread.b), source, deltaE, areaMm2: 0, sew: true };
    } else {
      entry = { thread: { r: source[0], g: source[1], b: source[2] }, lab, source, deltaE: 0, areaMm2: 0, sew: true };
    }
    map[k] = palette.length;
    palette.push(entry);
  });

  // Painted colors join the palette before the color changes, so those apply to them as well.
  const painted = strokeLabels(palette, strokes, o.threads);

  // The user's color changes: another thread, merging, skipping.
  const merged = new Uint8Array(256).fill(NONE);
  for (const e of edits) {
    const i = findSource(palette, e.from);
    if (i < 0) continue;
    if (e.thread) {
      palette[i].thread = e.thread;
      palette[i].lab = rgbToLab(e.thread.r, e.thread.g, e.thread.b);
      palette[i].deltaE = deltaE2000(rgbToLab(...palette[i].source), palette[i].lab);
    }
    if (e.merge) {
      const j = findSource(palette, e.merge);
      if (j >= 0 && j !== i) merged[i] = j;
    }
    if (e.skip) palette[i].sew = false;
  }
  const resolve = (k: number) => {
    for (let guard = 0; guard < 16 && merged[k] !== NONE; guard++) k = merged[k];
    return k;
  };

  let labels: Uint8Array = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) labels[i] = raw[i] === NONE ? NONE : resolve(map[raw[i]]);

  // Painted strokes count before the cleanup (so regions form around them) and after it (so they win).
  const paintLabels = painted.map((l) => (l === NONE ? NONE : resolve(l)));
  paint(labels, w, h, strokes, paintLabels);
  labels = modeFilter(labels, w, h);
  const labOf = (k: number) => (k === NONE ? null : palette[k].lab);
  // Seams of anti-aliasing: at most 0.5 mm wide, colored between their two neighbours.
  labels = removeSeams(labels, w, h, 0.5 / pxMm, (s, a, b) => {
    const [ls, la, lb] = [labOf(s), labOf(a), labOf(b)];
    if (!ls || !la || !lb) return false;
    return distanceToSegment(ls, la, lb) < 12;
  });
  // After the seams, so the seams along the background's edge go too.
  if (o.background) labels = removeBackground(labels, w, h);
  labels = mergeSmall(labels, w, h, Math.max(1, o.minAreaMm2 / (pxMm * pxMm)));
  labels = modeFilter(labels, w, h);
  if (strokes.length) paint(labels, w, h, strokes, paintLabels);

  // Areas, then the colors that are not sewn.
  const counts = new Array(palette.length).fill(0);
  for (const l of labels) if (l !== NONE) counts[l]++;
  palette.forEach((p, i) => (p.areaMm2 = counts[i] * pxMm * pxMm));
  for (let i = 0; i < labels.length; i++) if (labels[i] !== NONE && !palette[labels[i]].sew) labels[i] = NONE;

  // Drop colors without pixels, unless the user skipped them (they stay listed to switch them back on).
  const keep = palette.map((p, i) => counts[i] > 0 || !p.sew);
  const index = new Uint8Array(256).fill(NONE);
  palette = palette.filter((_, i) => {
    if (!keep[i]) return false;
    index[i] = keep.slice(0, i).filter(Boolean).length;
    return true;
  });
  for (let i = 0; i < labels.length; i++) if (labels[i] !== NONE) labels[i] = index[labels[i]];
  return { width: w, height: h, pxMm, labels, palette };
}

/** Euclidean distance in Lab from p to the segment a-b. */
function distanceToSegment(p: Lab, a: Lab, b: Lab): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = l2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
}

export { NONE };
