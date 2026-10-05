import { hoopFit, type Hoop } from '../model/hoop';
import type { Bounds } from '../model/pattern';
import type { Viewport } from './viewport';

/** Corner radius of the drawn sewing field, mm. */
const RADIUS_MM = 6;

/** The sewing field centered on the design, turned when the design only fits that way (mm). */
export function hoopRect(b: Bounds, hoop: Hoop): { x: number; y: number; w: number; h: number; fits: boolean } {
  const f = hoopFit(b, hoop);
  const [w, h] = f.turned ? [hoop.h, hoop.w] : [hoop.w, hoop.h];
  const cx = (b.minX + b.maxX) / 20;
  const cy = (b.minY + b.maxY) / 20;
  return { x: cx - w / 2, y: cy - h / 2, w, h, fits: f.fits || f.turned };
}

/**
 * The sewing field of the chosen hoop as a dashed rounded line with a small cross in its middle.
 * When the design sticks out, the line turns red and the part outside is tinted.
 */
export function drawHoop(ctx: CanvasRenderingContext2D, vp: Viewport, b: Bounds, hoop: Hoop): void {
  const r = hoopRect(b, hoop);
  const [x0, y0] = vp.toScreen(r.x, r.y);
  const [x1, y1] = vp.toScreen(r.x + r.w, r.y + r.h);
  const rad = Math.min(RADIUS_MM * vp.scale, (x1 - x0) / 4, (y1 - y0) / 4);
  const field = new Path2D();
  field.roundRect(x0, y0, x1 - x0, y1 - y0, rad);
  ctx.save();
  if (!r.fits) {
    const [bx0, by0] = vp.toScreen(b.minX / 10, b.minY / 10);
    const [bx1, by1] = vp.toScreen(b.maxX / 10, b.maxY / 10);
    const out = new Path2D();
    out.rect(bx0, by0, bx1 - bx0, by1 - by0);
    out.addPath(field);
    ctx.fillStyle = 'rgba(220, 38, 38, 0.22)';
    ctx.fill(out, 'evenodd');
  }
  const color = r.fits ? 'rgba(40, 40, 48, 0.85)' : 'rgba(220, 38, 38, 0.95)';
  // A light halo keeps the line readable on dark fabric and on dark threads.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.stroke(field);
  ctx.lineWidth = r.fits ? 1.25 : 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = color;
  ctx.stroke(field);
  ctx.setLineDash([]);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const c = 6;
  ctx.beginPath();
  ctx.moveTo(cx - c, cy);
  ctx.lineTo(cx + c, cy);
  ctx.moveTo(cx, cy - c);
  ctx.lineTo(cx, cy + c);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.stroke();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}
