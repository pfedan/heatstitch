import { STITCH, type Pattern } from '../model/pattern';
import type { EditView } from '../ui/editor';
import type { Viewport } from './viewport';

/** Needle penetrations are drawn once the view is zoomed in at least this far (px per mm). */
export const POINTS_MIN_SCALE = 6;
/** Beyond this many visible points the dots are skipped (they would only form a grey carpet). */
const MAX_POINTS = 20000;
const ACCENT = '#e0559e';

/** Penetration dots, selection, hover ring and rubber band of the stitch editor. */
export function drawEditOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, view: EditView, w: number, h: number): void {
  const s = vp.scale / 10;
  const ox = vp.offsetX;
  const oy = vp.offsetY;
  const visible = (x: number, y: number) => x >= -8 && y >= -8 && x <= w + 8 && y <= h + 8;
  ctx.save();

  if (vp.scale >= POINTS_MIN_SCALE) {
    const pts: number[] = [];
    for (let i = 0; i < p.cmd.length && pts.length < 2 * MAX_POINTS; i++) {
      if (p.cmd[i] !== STITCH) continue;
      const x = p.x[i] * s + ox;
      const y = p.y[i] * s + oy;
      if (visible(x, y)) pts.push(x, y);
    }
    if (pts.length < 2 * MAX_POINTS) {
      const r = Math.min(2.5, Math.max(1.2, vp.scale / 12));
      ctx.beginPath();
      for (let k = 0; k < pts.length; k += 2) {
        ctx.moveTo(pts[k] + r, pts[k + 1]);
        ctx.arc(pts[k], pts[k + 1], r, 0, Math.PI * 2);
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
  }

  if (view.selection.size) {
    ctx.beginPath();
    for (const i of view.selection) {
      if (i >= p.cmd.length) continue;
      const x = p.x[i] * s + ox;
      const y = p.y[i] * s + oy;
      if (!visible(x, y)) continue;
      ctx.moveTo(x + 4, y);
      ctx.arc(x, y, 4, 0, Math.PI * 2);
    }
    ctx.fillStyle = ACCENT;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }

  if (view.hover >= 0 && view.hover < p.cmd.length) {
    const x = p.x[view.hover] * s + ox;
    const y = p.y[view.hover] * s + oy;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (view.band) {
    const [x0, y0] = vp.toScreen(view.band.x0, view.band.y0);
    const [x1, y1] = vp.toScreen(view.band.x1, view.band.y1);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(224, 85, 158, 0.15)';
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
  ctx.restore();
}
