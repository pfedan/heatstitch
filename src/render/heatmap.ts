import type { DensityGrid } from '../density/grid';
import { LUT, LUT_SIZE, WARN_COLOR } from './colormap';
import type { Viewport } from './viewport';

/** Rasterises the grid into a canvas with one pixel per cell, mapping 0..max onto the LUT. */
export function gridToCanvas(g: DensityGrid, max: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = g.cols;
  c.height = g.rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(g.cols, g.rows);
  const px = img.data;
  const scale = max > 0 ? (LUT_SIZE - 1) / max : 0;
  // Values below 0.5 % of the scale stay transparent.
  const floor = max * 0.005;
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i];
    if (v <= floor) continue;
    const li = Math.min(LUT_SIZE - 1, Math.round(v * scale)) * 4;
    px[i * 4] = LUT[li];
    px[i * 4 + 1] = LUT[li + 1];
    px[i * 4 + 2] = LUT[li + 2];
    px[i * 4 + 3] = LUT[li + 3];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function drawHeatmap(ctx: CanvasRenderingContext2D, vp: Viewport, g: DensityGrid, img: HTMLCanvasElement, smooth: boolean): void {
  const [x, y] = vp.toScreen(g.originX, g.originY);
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(img, x, y, g.cols * g.cellMm * vp.scale, g.rows * g.cellMm * vp.scale);
  ctx.restore();
}

/** Outlines the cells above `threshold` (boundary edges only). */
export function drawThresholdContour(ctx: CanvasRenderingContext2D, vp: Viewport, g: DensityGrid, threshold: number): void {
  const { cols, rows, data, cellMm } = g;
  const above = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < cols && cy < rows && data[cy * cols + cx] > threshold;
  const s = cellMm * vp.scale;
  const [ox, oy] = vp.toScreen(g.originX, g.originY);
  ctx.save();
  ctx.beginPath();
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!above(cx, cy)) continue;
      const x0 = ox + cx * s;
      const y0 = oy + cy * s;
      if (!above(cx, cy - 1)) (ctx.moveTo(x0, y0), ctx.lineTo(x0 + s, y0));
      if (!above(cx, cy + 1)) (ctx.moveTo(x0, y0 + s), ctx.lineTo(x0 + s, y0 + s));
      if (!above(cx - 1, cy)) (ctx.moveTo(x0, y0), ctx.lineTo(x0, y0 + s));
      if (!above(cx + 1, cy)) (ctx.moveTo(x0 + s, y0), ctx.lineTo(x0 + s, y0 + s));
    }
  }
  ctx.strokeStyle = WARN_COLOR;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** Looks up the grid value at a world position (mm), or null outside the grid. */
export function sampleGrid(g: DensityGrid, x: number, y: number): number | null {
  const cx = Math.floor((x - g.originX) / g.cellMm);
  const cy = Math.floor((y - g.originY) / g.cellMm);
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return null;
  return g.data[cy * g.cols + cx];
}
