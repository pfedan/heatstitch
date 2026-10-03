import { CAUTION, CRITICAL, type ValidationResult, type Zone } from '../validation/validate';
import type { Viewport } from './viewport';

export const CAUTION_COLOR = '#FFA500';
export const CRITICAL_COLOR = '#FF0000';
const CAUTION_RGBA = [255, 165, 0, 115]; // ~45 %
const CRITICAL_RGBA = [255, 0, 0, 140]; // ~55 %

/** One pixel per 1 mm validation cell, Safe cells transparent. */
export function validationToCanvas(v: ValidationResult): HTMLCanvasElement {
  const { cols, rows } = v.measurement;
  const c = document.createElement('canvas');
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
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
  const m = v.measurement;
  const [ox, oy] = vp.toScreen(m.originX, m.originY);
  const s = m.cellMm * vp.scale;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, ox, oy, m.cols * s, m.rows * s);

  // Outline each level in its own colour over a dark halo, so Caution stays visible on orange heat.
  const { cols, rows } = m;
  const { level } = v;
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

/** Dashed frame around a zone (hovered in the list or selected), with some breathing room. */
export function drawZoneHighlight(ctx: CanvasRenderingContext2D, vp: Viewport, z: Zone): void {
  const pad = 1.5; // mm
  const [x0, y0] = vp.toScreen(z.bbox.minX - pad, z.bbox.minY - pad);
  const [x1, y1] = vp.toScreen(z.bbox.maxX + pad, z.bbox.maxY + pad);
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

/** Index of the validation cell at a world position (mm), or null outside the grid. */
export function sampleCell(v: ValidationResult, x: number, y: number): number | null {
  const m = v.measurement;
  const cx = Math.floor((x - m.originX) / m.cellMm);
  const cy = Math.floor((y - m.originY) / m.cellMm);
  if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return null;
  return cy * m.cols + cx;
}
