import type { Pt } from '../digitize/skeleton';
import { formatNumber } from '../i18n';
import type { Measured } from '../ui/measureTool';
import type { Viewport } from './viewport';

const ACCENT = '#e0559e';
/** Half the length of the cross strokes at the ends (CSS pixels). */
const CAP = 7;

/**
 * A measurement on the stage: the line light over a dark halo with cross strokes at its ends, the
 * length on a dark label beside its middle (kept on the stage), and a ring on the needle point the
 * pointer snaps to.
 */
export function drawMeasure(ctx: CanvasRenderingContext2D, vp: Viewport, m: { a: Pt | null; b: Pt | null; snapAt: Pt | null; result: Measured | null }, w: number, h: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  if (m.a && m.b && m.result) {
    const [ax, ay] = vp.toScreen(m.a[0], m.a[1]);
    const [bx, by] = vp.toScreen(m.b[0], m.b[1]);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    // The unit normal, for the cross strokes and the side of the label.
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ]) {
      ctx.moveTo(x - nx * CAP, y - ny * CAP);
      ctx.lineTo(x + nx * CAP, y + ny * CAP);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.75;
    ctx.stroke();

    const text = `${formatNumber(m.result.length, 1)} mm`;
    ctx.font = '600 12px system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 14;
    const th = 22;
    // Beside the middle, on the upper side of the line; within the stage.
    const side = ny > 0 || (ny === 0 && nx < 0) ? -1 : 1;
    const off = 8 + Math.abs(nx) * (tw / 2) + Math.abs(ny) * (th / 2);
    let lx = (ax + bx) / 2 + side * nx * off;
    let ly = (ay + by) / 2 + side * ny * off;
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
  }
  for (const p of [m.a, m.b]) {
    if (!p) continue;
    const [x, y] = vp.toScreen(p[0], p[1]);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
  if (m.snapAt) {
    const [x, y] = vp.toScreen(m.snapAt[0], m.snapAt[1]);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}
