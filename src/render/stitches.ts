import { COLOR_CHANGE, JUMP, STITCH, type Pattern } from '../model/pattern';
import type { Viewport } from './viewport';

/** Visual thread width in mm; clamped to at least one device pixel when zoomed out. */
const THREAD_MM = 0.3;

export function drawStitches(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  p: Pattern,
  opacity: number,
  showJumps: boolean,
): void {
  if (opacity <= 0 && !showJumps) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const width = Math.max(0.75, THREAD_MM * vp.scale);
  const s = vp.scale / 10;
  const ox = vp.offsetX;
  const oy = vp.offsetY;
  const jumps: number[] = [];

  let block = 0;
  let drawing = false;
  const flush = () => {
    if (!drawing) return;
    const c = p.colors[block] ?? p.colors[p.colors.length - 1] ?? { r: 128, g: 128, b: 128 };
    ctx.strokeStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
    ctx.stroke();
    drawing = false;
  };

  ctx.globalAlpha = opacity;
  ctx.lineWidth = width;
  let prevStitch = false;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    const x = p.x[i] * s + ox;
    const y = p.y[i] * s + oy;
    if (c === STITCH) {
      if (!drawing) {
        ctx.beginPath();
        drawing = true;
      }
      if (prevStitch) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      prevStitch = true;
    } else {
      if (c === JUMP && i > 0) jumps.push(p.x[i - 1] * s + ox, p.y[i - 1] * s + oy, x, y);
      if (c === COLOR_CHANGE) {
        flush();
        block++;
      }
      prevStitch = false;
    }
  }
  flush();

  if (showJumps && jumps.length) {
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#888';
    ctx.beginPath();
    for (let i = 0; i < jumps.length; i += 4) {
      ctx.moveTo(jumps[i], jumps[i + 1]);
      ctx.lineTo(jumps[i + 2], jumps[i + 3]);
    }
    ctx.stroke();
  }
  ctx.restore();
}
