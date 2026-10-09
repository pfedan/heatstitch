import type { DensityGrid } from '../density/grid';
import { drawTrace, drawTraceFrame, type TraceScene } from './trace';
import { STITCH, type Pattern } from '../model/pattern';
import type { Markers, Transition } from '../model/sequence';
import { shownMarks, type Settings } from '../settings';
import type { EditView } from '../ui/editor';
import type { ValidationResult, Zone } from '../validation/validate';
import { drawBand, drawEditOverlay } from './editOverlay';
import { drawRungOverlay } from './rungOverlay';
import type { RungView } from '../ui/rungTool';
import { drawAreas, drawFrame, drawShapeOverlay, type FlatArea } from './shapeOverlay';
import type { ShapeView } from '../ui/shapeTool';
import type { FrameView } from '../ui/frameTool';
import type { Pt } from '../digitize/skeleton';
import { drawFlatStitches, drawJumps, drawMarkers, drawNeedle, drawOutlines, drawTransition, drawContour, drawUnderlay, type StitchStyle } from './flow';
import { drawHeatmap } from './heatmap';
import { drawStitches } from './stitches';
import { drawThreads } from './threads';
import { drawFabric } from './fabricGl';
import { drawHoop } from './hoop';
import { drawValidation, drawZoneHighlight, type Counted } from './validationOverlay';
import type { Viewport } from './viewport';

/** What the Ablauf mode adds: per-stitch colors and visibility, symbols, the jump in focus. */
/** Fill area of a selected object, as recognized (mm polylines). */
export interface ShapeOutline {
  lines: [number, number][][];
  /** Its edges are a guess (drawn in amber). */
  approximate: boolean;
  /** The stitches are loosed from it: it rests (drawn thin and grey). */
  resting?: boolean;
}

export interface FlowScene {
  style: StitchStyle;
  markers: Markers;
  /** Jumps hovered (drawn lighter) and selected in the list. */
  hover: Transition | null;
  selected: Transition | null;
  /** Record the needle is at while the player stands before the end, else -1. */
  needle: number;
  /** Fill areas of the selected objects. */
  outlines?: ShapeOutline[];
  /** Underlay of the selected objects, shown while its settings are pointed at (per record). */
  under?: Uint8Array | null;
  /** The lines the borders of the selected fills lie on (mm), shown while their settings are pointed at. */
  contour?: Pt[][] | null;
  /** The rung tool, while it is on. */
  rungs?: RungView | null;
  /** The outline of the fill being reshaped (level Form), with the handles shown. */
  shape?: { view: ShapeView; handles: { path: number; i: number; part: 'a' | 'b' }[] } | null;
  /** The frame around the one selected object (level Objects), with its corners as dragged. */
  frame?: { view: FrameView; mapped: Pt[] } | null;
  /** Objects drawn as flat areas instead of their stitches (their stitches have alpha 0). */
  areas?: FlatArea[] | null;
  /** Rubber band (mm) selecting the objects inside it, while it is dragged. */
  band?: { x0: number; y0: number; x1: number; y1: number } | null;
  /** The design's tracing image, while it is shown. */
  trace?: TraceScene | null;
}

/** The stitches of one object on their own, and which records are its underlay. */
export interface FocusStitches {
  pattern: Pattern;
  under: Uint8Array | null;
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
  highlight: Pick<Zone, 'bbox'> | null;
  settings: Settings;
  vp: Viewport;
  /** Stitch editor state; the stitch plan and needle penetrations are shown while it is set. */
  edit?: EditView | null;
  /** Set in the Ablauf mode: no heatmap, the stitch plan in full. */
  flow?: FlowScene | null;
  /** Symbols in the density mode (all stitches shown). */
  markers?: Markers | null;
  /**
   * Stitches to show clearly on a dimmed heatmap (the objects a proposal changes), with their
   * underlay marked (records set in `under`).
   */
  focus?: FocusStitches[] | null;
}

/**
 * Draws the scene in CSS pixel coordinates. Density mode: heatmap, validation overlay and the
 * optional stitch plan on top. Ablauf mode: the stitch plan in full with its symbols.
 */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, background: string): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  const { pattern, settings: s, vp, flow } = scene;
  if (s.realistic && s.fabricLook) drawFabric(ctx, vp, s.profile.fabric, background);
  if (flow) {
    if (!pattern) return;
    const st = flow.style;
    if (flow.trace) drawTrace(ctx, vp, flow.trace);
    if (flow.areas?.length) drawAreas(ctx, vp, flow.areas);
    if (!s.realistic || !drawThreads(ctx, vp, pattern, 1, s.threadMm, st)) drawFlatStitches(ctx, vp, pattern, st, 1);
    const marks = shownMarks(s);
    if (marks.jumps) drawJumps(ctx, vp, pattern, st.limit, st.alpha, st.carried?.jumps);
    drawMarkers(ctx, vp, pattern, { markers: flow.markers, marks, limit: st.limit, alpha: st.alpha }, w, h);
    if (s.hoop) drawHoop(ctx, vp, pattern.bounds, s.hoop);
    if (flow.trace) drawTraceFrame(ctx, vp, flow.trace);
    if (flow.hover && flow.hover !== flow.selected) drawTransition(ctx, vp, pattern, flow.hover, false);
    if (flow.selected) drawTransition(ctx, vp, pattern, flow.selected, true);
    if (flow.outlines?.length) drawOutlines(ctx, vp, flow.outlines);
    if (flow.contour) drawContour(ctx, vp, flow.contour);
    if (flow.under) drawUnderlay(ctx, vp, pattern, flow.under);
    if (flow.rungs) drawRungOverlay(ctx, vp, flow.rungs);
    if (flow.frame) drawFrame(ctx, vp, flow.frame.view, flow.frame.mapped);
    if (flow.shape) drawShapeOverlay(ctx, vp, flow.shape.view, flow.shape.handles);
    if (flow.needle >= 0) drawNeedle(ctx, vp, pattern, flow.needle);
    if (flow.band) drawBand(ctx, vp, flow.band);
    if (scene.edit) drawEditOverlay(ctx, vp, pattern, scene.edit, w, h);
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
    const marks = shownMarks(s);
    if (marks.jumps) drawJumps(ctx, vp, pattern, end);
    if (scene.markers) drawMarkers(ctx, vp, pattern, { markers: scene.markers, marks: { ...marks, points: marks.points && !edit }, limit: end }, w, h);
  }
  if (scene.focus?.length) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    for (const f of scene.focus) {
      if (!s.realistic || !drawThreads(ctx, vp, f.pattern, 1, s.threadMm)) drawStitches(ctx, vp, f.pattern, 1, false);
      if (f.under) drawUnderlay(ctx, vp, f.pattern, f.under);
      drawPoints(ctx, vp, f.pattern);
    }
  }
  if (pattern && s.hoop) drawHoop(ctx, vp, pattern.bounds, s.hoop);
  if (scene.highlight) drawZoneHighlight(ctx, vp, scene.highlight);
  if (pattern && edit) drawEditOverlay(ctx, vp, pattern, edit, w, h);
}

/** The needle points of `p` as small dots, so stitch lengths and spacing can be told apart. */
function drawPoints(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern): void {
  const r = Math.min(2, Math.max(0.8, vp.scale * 0.08));
  ctx.save();
  ctx.fillStyle = 'rgba(13, 11, 16, 0.85)';
  ctx.beginPath();
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.cmd[i] !== STITCH) continue;
    const [x, y] = vp.toScreen(p.x[i] / 10, p.y[i] / 10);
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}
