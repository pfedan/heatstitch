import type { DensityGrid } from '../density/grid';
import type { Pattern } from '../model/pattern';
import type { Markers, Transition } from '../model/sequence';
import type { Settings } from '../settings';
import type { EditView } from '../ui/editor';
import type { ValidationResult, Zone } from '../validation/validate';
import { drawEditOverlay } from './editOverlay';
import { drawFlatStitches, drawJumps, drawMarkers, drawNeedle, drawTransition, type StitchStyle } from './flow';
import { drawHeatmap } from './heatmap';
import { drawStitches } from './stitches';
import { drawThreads } from './threads';
import { drawValidation, drawZoneHighlight, type Counted } from './validationOverlay';
import type { Viewport } from './viewport';

/** What the Ablauf mode adds: per-stitch colors and visibility, symbols, the jump in focus. */
export interface FlowScene {
  style: StitchStyle;
  markers: Markers;
  /** Jumps hovered (drawn lighter) and selected in the list. */
  hover: Transition | null;
  selected: Transition | null;
  /** Record the needle is at while the player stands before the end, else -1. */
  needle: number;
}

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
  /** Set in the Ablauf mode: no heatmap, the stitch plan in full. */
  flow?: FlowScene | null;
  /** Symbols in the density mode (all stitches shown). */
  markers?: Markers | null;
}

/**
 * Draws the scene in CSS pixel coordinates. Density mode: heatmap, validation overlay and the
 * optional stitch plan on top. Ablauf mode: the stitch plan in full with its symbols.
 */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, background: string): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  const { pattern, settings: s, vp, flow } = scene;
  if (flow) {
    if (!pattern) return;
    const st = flow.style;
    if (!s.realistic || !drawThreads(ctx, vp, pattern, 1, s.threadMm, st)) drawFlatStitches(ctx, vp, pattern, st, 1);
    if (s.marks.jumps) drawJumps(ctx, vp, pattern, st.limit, st.alpha, st.carried?.jumps);
    drawMarkers(ctx, vp, pattern, { markers: flow.markers, marks: s.marks, limit: st.limit, alpha: st.alpha }, w, h);
    if (flow.hover && flow.hover !== flow.selected) drawTransition(ctx, vp, pattern, flow.hover, false);
    if (flow.selected) drawTransition(ctx, vp, pattern, flow.selected, true);
    if (flow.needle >= 0) drawNeedle(ctx, vp, pattern, flow.needle);
    return;
  }

  const { grid, gridImg, validation, validationImg } = scene;
  if (grid && gridImg) drawHeatmap(ctx, vp, grid, gridImg, s.blurMm > 0);
  if (s.showValidation && validation && validationImg) drawValidation(ctx, vp, validation, validationImg, scene.counted);
  // While editing, the stitch plan is always shown so the penetrations have context.
  const edit = scene.edit;
  const opacity = edit ? Math.max(0.85, s.overlay ? s.opacity : 0) : s.overlay ? s.opacity : 0;
  if (pattern && opacity > 0) {
    if (!s.realistic || !drawThreads(ctx, vp, pattern, opacity, s.threadMm)) drawStitches(ctx, vp, pattern, opacity, false);
  }
  // Markers belong to the stitch plan: shown with it, not on the bare heatmap.
  if (pattern && opacity > 0) {
    const end = pattern.cmd.length - 1;
    if (s.marks.jumps) drawJumps(ctx, vp, pattern, end);
    if (scene.markers) drawMarkers(ctx, vp, pattern, { markers: scene.markers, marks: { ...s.marks, points: s.marks.points && !edit }, limit: end }, w, h);
  }
  if (scene.highlight) drawZoneHighlight(ctx, vp, scene.highlight);
  if (pattern && edit) drawEditOverlay(ctx, vp, pattern, edit, w, h);
}
