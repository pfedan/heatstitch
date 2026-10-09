import type { Trace } from '../model/trace';
import type { Viewport } from './viewport';

/**
 * The tracing image under the stitches, and its frame while it can be moved. The picture is
 * dimmed by a fixed amount, as embroidery programs do with their backdrops: enough to draw along,
 * never so strong that it competes with the stitches.
 */

const ACCENT = '#e0559e';
/** How much of the picture shows. */
export const TRACE_ALPHA = 0.5;

/** Which part of the frame the pointer is on: the inside (move) or a corner (0..3: top left, top right, bottom right, bottom left). */
export type TracePart = 'move' | 0 | 1 | 2 | 3;

export interface TraceScene {
  trace: Trace;
  /** The decoded picture; null while it is being decoded. */
  img: CanvasImageSource | null;
  /** Shown with its frame (not locked). */
  frame: boolean;
  hover: TracePart | null;
  dragging: TracePart | null;
}

const decoded = new WeakMap<Uint8Array, ImageBitmap | 'pending' | 'failed'>();

/**
 * The picture of `t`, decoded once per image (all versions that keep the image share its bytes).
 * Null while it is decoded; `ready` is called when it is.
 */
export function traceImage(t: Trace, ready: () => void): ImageBitmap | null {
  const got = decoded.get(t.data);
  if (got instanceof ImageBitmap) return got;
  if (got) return null;
  decoded.set(t.data, 'pending');
  createImageBitmap(new Blob([t.data as BlobPart], { type: t.type }))
    .then((img) => {
      decoded.set(t.data, img);
      ready();
    })
    .catch(() => decoded.set(t.data, 'failed'));
  return null;
}

/** The corners of the image in mm, clockwise from top left. */
export const traceCorners = (t: Pick<Trace, 'x' | 'y' | 'w' | 'h'>): [number, number][] => [
  [t.x, t.y],
  [t.x + t.w, t.y],
  [t.x + t.w, t.y + t.h],
  [t.x, t.y + t.h],
];

export function drawTrace(ctx: CanvasRenderingContext2D, vp: Viewport, s: TraceScene): void {
  if (!s.img) return;
  const t = s.trace;
  const [x, y] = vp.toScreen(t.x, t.y);
  ctx.save();
  ctx.globalAlpha = TRACE_ALPHA;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s.img, x, y, t.w * vp.scale, t.h * vp.scale);
  ctx.restore();
}

/** The frame of a movable image: dashed like the frame of objects, with square handles at the corners. */
export function drawTraceFrame(ctx: CanvasRenderingContext2D, vp: Viewport, s: TraceScene): void {
  if (!s.frame) return;
  const pts = traceCorners(s.trace).map(([x, y]) => vp.toScreen(x, y));
  const moving = s.hover === 'move' || s.dragging === 'move';
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = moving ? ACCENT : '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.setLineDash([]);
  pts.forEach(([x, y], k) => {
    const on = s.hover === k || s.dragging === k;
    const r = on ? 6 : 5;
    ctx.beginPath();
    ctx.rect(x - r, y - r, 2 * r, 2 * r);
    ctx.fillStyle = on ? ACCENT : '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}
