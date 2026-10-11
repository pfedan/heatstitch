import { hoopFit, type Hoop } from '../model/hoop';
import type { Bounds } from '../model/pattern';
import type { Viewport } from './viewport';

/** Corner radius of the drawn sewing field, mm. */
const RADIUS_MM = 6;

/** Where the machine puts the middle of the hoop: the middle of the design (mm). */
export const hoopCenter = (b: Bounds): [number, number] => [(b.minX + b.maxX) / 20, (b.minY + b.maxY) / 20];

/**
 * The sewing field centered on the design (or on `at`, mm), turned when the design only fits that
 * way (mm).
 */
export function hoopRect(b: Bounds, hoop: Hoop, at?: readonly [number, number] | null): { x: number; y: number; w: number; h: number; fits: boolean } {
  const f = hoopFit(b, hoop);
  const [w, h] = f.turned ? [hoop.h, hoop.w] : [hoop.w, hoop.h];
  const [cx, cy] = at ?? hoopCenter(b);
  return { x: cx - w / 2, y: cy - h / 2, w, h, fits: f.fits || f.turned };
}

/**
 * The sewing field of the chosen hoop as a dashed rounded line with a small cross in its middle,
 * around `at` when given (mm). When the design sticks out, the line turns red and the part outside
 * is tinted.
 */
export function drawHoop(ctx: CanvasRenderingContext2D, vp: Viewport, b: Bounds, hoop: Hoop, at?: readonly [number, number] | null): void {
  const r = hoopRect(b, hoop, at);
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

/** How long the drawn hoop takes to follow the design's middle after a change (ms). */
const GLIDE_MS = 220;

/**
 * Where the hoop is drawn. It stays where it is while an object is dragged (its stitches are only a
 * preview then), so the object moves and not the stage; once the change is made, the hoop glides
 * to the new middle of the design. A lone object dragged would otherwise carry the hoop along with
 * it, which looks just like moving the view.
 */
export class HoopGlide {
  private shown: [number, number] | null = null;
  private from: [number, number] = [0, 0];
  private to: [number, number] = [0, 0];
  private t0 = 0;
  private of: unknown = null;

  /**
   * The middle to draw the hoop around for the made design with bounds `b` (`of` names the design:
   * another one is shown at once), and whether it is still on its way there.
   */
  at(b: Bounds, of: unknown, now: number, still: boolean): { at: [number, number]; moving: boolean } {
    const target = hoopCenter(b);
    if (!this.shown || of !== this.of || still) {
      this.of = of;
      this.shown = this.from = this.to = target;
      return { at: target, moving: false };
    }
    if (target[0] !== this.to[0] || target[1] !== this.to[1]) {
      this.from = this.shown;
      this.to = target;
      this.t0 = now;
    }
    const k = Math.min(1, Math.max(0, (now - this.t0) / GLIDE_MS));
    const e = 1 - (1 - k) ** 3;
    this.shown = [this.from[0] + (this.to[0] - this.from[0]) * e, this.from[1] + (this.to[1] - this.from[1]) * e];
    return { at: this.shown, moving: k < 1 };
  }
}
