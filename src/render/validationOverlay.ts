import { CAUTION, CRITICAL, type ValidationResult } from '../validation/validate';
import type { Viewport } from './viewport';

export const CAUTION_COLOR = '#FFA500';
export const CRITICAL_COLOR = '#FF0000';
const CAUTION_RGBA = [255, 165, 0, 115]; // ~45 %
const CRITICAL_RGBA = [255, 0, 0, 140]; // ~55 %

/** One pixel per 1 mm validation cell, Safe cells transparent. */
export function validationToCanvas(v: ValidationResult): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = v.cols;
  c.height = v.rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(v.cols, v.rows);
  for (let i = 0; i < v.level.length; i++) {
    const rgba = v.level[i] === CRITICAL ? CRITICAL_RGBA : v.level[i] === CAUTION ? CAUTION_RGBA : null;
    if (rgba) img.data.set(rgba, i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Semi-transparent cells plus a coloured outline per level. */
export function drawValidation(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  v: ValidationResult,
  img: HTMLCanvasElement,
): void {
  const [ox, oy] = vp.toScreen(v.originX, v.originY);
  const s = v.cellMm * vp.scale;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, ox, oy, v.cols * s, v.rows * s);

  // Outline each level in its own colour over a dark halo, so Caution stays visible on orange heat.
  const { cols, rows, level } = v;
  for (const [min, color] of [
    [CAUTION, CAUTION_COLOR],
    [CRITICAL, CRITICAL_COLOR],
  ] as const) {
    const inside = (cx: number, cy: number) =>
      cx >= 0 && cy >= 0 && cx < cols && cy < rows && level[cy * cols + cx] >= min;
    ctx.beginPath();
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (!inside(cx, cy)) continue;
        const x0 = ox + cx * s;
        const y0 = oy + cy * s;
        if (!inside(cx, cy - 1)) (ctx.moveTo(x0, y0), ctx.lineTo(x0 + s, y0));
        if (!inside(cx, cy + 1)) (ctx.moveTo(x0, y0 + s), ctx.lineTo(x0 + s, y0 + s));
        if (!inside(cx - 1, cy)) (ctx.moveTo(x0, y0), ctx.lineTo(x0, y0 + s));
        if (!inside(cx + 1, cy)) (ctx.moveTo(x0 + s, y0), ctx.lineTo(x0 + s, y0 + s));
      }
    }
    ctx.lineCap = 'square';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

/** Level of the validation cell at a world position (mm), or null outside the grid. */
export function sampleLevel(v: ValidationResult, x: number, y: number): number | null {
  const cx = Math.floor((x - v.originX) / v.cellMm);
  const cy = Math.floor((y - v.originY) / v.cellMm);
  if (cx < 0 || cy < 0 || cx >= v.cols || cy >= v.rows) return null;
  return v.level[cy * v.cols + cx];
}
