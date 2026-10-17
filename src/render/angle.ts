import type { Pt } from '../digitize/skeleton';
import type { Viewport } from './viewport';

const ACCENT = '#e0559e';

/**
 * The line drawn across a fill for the direction of its rows: light over a dark halo, a dot at
 * each end, and the angle on a dark label beside the end being dragged (kept on the stage).
 */
export function drawAngle(ctx: CanvasRenderingContext2D, vp: Viewport, m: { a: Pt | null; b: Pt | null; angle: number | null }, w: number, h: number): void {
  if (!m.a || !m.b || m.angle === null) return;
  const [ax, ay] = vp.toScreen(m.a[0], m.a[1]);
  const [bx, by] = vp.toScreen(m.b[0], m.b[1]);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.75;
  ctx.stroke();
  for (const [x, y] of [
    [ax, ay],
    [bx, by],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
  const text = `${m.angle}°`;
  ctx.font = '600 12px system-ui, sans-serif';
  const tw = ctx.measureText(text).width + 14;
  const th = 22;
  // Ahead of the pointer, along the line, so the finger or the cursor does not cover it.
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let lx = bx + ((bx - ax) / len) * (tw / 2 + 12);
  let ly = by + ((by - ay) / len) * (th / 2 + 12);
  lx = Math.min(w - tw / 2 - 4, Math.max(tw / 2 + 4, lx));
  ly = Math.min(h - th / 2 - 4, Math.max(th / 2 + 4, ly));
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.beginPath();
  ctx.roundRect(lx - tw / 2, ly - th / 2, tw, th, 6);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx, ly);
  ctx.restore();
}
