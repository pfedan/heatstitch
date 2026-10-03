import type { DensityGrid } from '../density/grid';
import type { Pattern } from '../model/pattern';
import type { Settings } from '../settings';
import { drawHeatmap, drawThresholdContour } from './heatmap';
import { drawStitches } from './stitches';
import type { Viewport } from './viewport';

export interface Scene {
  pattern: Pattern | null;
  grid: DensityGrid | null;
  /** Grid rasterised with the current scale maximum. */
  gridImg: HTMLCanvasElement | null;
  settings: Settings;
  vp: Viewport;
}

/** Draws heatmap, warning contour and optional stitch overlay in CSS pixel coordinates. */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, background: string): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  const { pattern, grid, gridImg, settings: s, vp } = scene;
  if (grid && gridImg) {
    drawHeatmap(ctx, vp, grid, gridImg, s.blurMm > 0);
    drawThresholdContour(ctx, vp, grid, s.scales[s.metric].warn);
  }
  if (pattern && (s.overlay || s.showJumps)) drawStitches(ctx, vp, pattern, s.overlay ? s.opacity : 0, s.showJumps);
}
