import type { DensityGrid } from '../density/grid';
import type { Pattern } from '../model/pattern';
import type { Settings } from '../settings';
import type { ValidationResult, Zone } from '../validation/validate';
import { drawHeatmap } from './heatmap';
import { drawStitches } from './stitches';
import { drawValidation, drawZoneHighlight } from './validationOverlay';
import type { Viewport } from './viewport';

export interface Scene {
  pattern: Pattern | null;
  grid: DensityGrid | null;
  /** Grid rasterised with the current scale maximum. */
  gridImg: HTMLCanvasElement | null;
  validation: ValidationResult | null;
  validationImg: HTMLCanvasElement | null;
  /** Zone hovered in the list or selected, framed on the canvas. */
  highlight: Zone | null;
  settings: Settings;
  vp: Viewport;
}

/** Draws heatmap, validation overlay and optional stitch overlay in CSS pixel coordinates. */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, background: string): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  const { pattern, grid, gridImg, validation, validationImg, settings: s, vp } = scene;
  if (grid && gridImg) drawHeatmap(ctx, vp, grid, gridImg, s.blurMm > 0);
  if (s.showValidation && validation && validationImg) drawValidation(ctx, vp, validation, validationImg);
  if (pattern && (s.overlay || s.showJumps)) drawStitches(ctx, vp, pattern, s.overlay ? s.opacity : 0, s.showJumps);
  if (scene.highlight) drawZoneHighlight(ctx, vp, scene.highlight);
}
