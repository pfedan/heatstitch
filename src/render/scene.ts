import type { DensityGrid } from '../density/grid';
import type { Pattern } from '../model/pattern';
import type { Settings } from '../settings';
import type { EditView } from '../ui/editor';
import type { ValidationResult, Zone } from '../validation/validate';
import { drawEditOverlay } from './editOverlay';
import { drawHeatmap } from './heatmap';
import { drawStitches } from './stitches';
import { drawThreads } from './threads';
import { drawValidation, drawZoneHighlight, type Counted } from './validationOverlay';
import type { Viewport } from './viewport';

export interface Scene {
  pattern: Pattern | null;
  grid: DensityGrid | null;
  /** Grid rasterised with the current scale maximum. */
  gridImg: HTMLCanvasElement | null;
  validation: ValidationResult | null;
  validationImg: HTMLCanvasElement | null;
  /** Per zone: whether it counts (zones normal in practice or acknowledged are drawn faintly). */
  counted: Counted;
  /** Zone hovered in the list or selected, framed on the canvas. */
  highlight: Zone | null;
  settings: Settings;
  vp: Viewport;
  /** Stitch editor state; the stitch plan and needle penetrations are shown while it is set. */
  edit?: EditView | null;
}

/** Draws heatmap, validation overlay and optional stitch overlay in CSS pixel coordinates. */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, background: string): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  const { pattern, grid, gridImg, validation, validationImg, settings: s, vp } = scene;
  if (grid && gridImg) drawHeatmap(ctx, vp, grid, gridImg, s.blurMm > 0);
  if (s.showValidation && validation && validationImg) drawValidation(ctx, vp, validation, validationImg, scene.counted);
  // While editing, the stitch plan is always shown so the penetrations have context.
  const edit = scene.edit;
  const opacity = edit ? Math.max(0.85, s.overlay ? s.opacity : 0) : s.overlay ? s.opacity : 0;
  if (pattern && opacity > 0 && s.realistic && drawThreads(ctx, vp, pattern, opacity, s.threadMm)) {
    if (s.showJumps) drawStitches(ctx, vp, pattern, 0, true);
  } else if (pattern && (opacity > 0 || s.showJumps)) {
    drawStitches(ctx, vp, pattern, opacity, s.showJumps);
  }
  if (scene.highlight) drawZoneHighlight(ctx, vp, scene.highlight);
  if (pattern && edit) drawEditOverlay(ctx, vp, pattern, edit, w, h);
}
