import { drawScene, type Scene } from './scene';

/** Grab distance around the divider, CSS pixels. */
export const DIVIDER_GRAB_PX = 10;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, align: 'left' | 'right'): void {
  ctx.font = '600 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 16;
  const bx = align === 'left' ? Math.max(4, x - w - 10) : x + 10;
  ctx.fillStyle = 'rgba(13, 11, 16, 0.75)';
  ctx.beginPath();
  ctx.roundRect(bx, 12, w, 22, 6);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 8, 23);
}

/** The split line of the comparison view with its handle and side labels. */
export function drawDivider(ctx: CanvasRenderingContext2D, x: number, h: number, left: string, right: string): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x - 2, 0, 4, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 1, 0, 2, h);
  const cy = h / 2;
  ctx.beginPath();
  ctx.arc(x, cy, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Arrows pointing left and right.
  ctx.fillStyle = '#2a2530';
  ctx.beginPath();
  ctx.moveTo(x - 9, cy);
  ctx.lineTo(x - 3, cy - 5);
  ctx.lineTo(x - 3, cy + 5);
  ctx.moveTo(x + 9, cy);
  ctx.lineTo(x + 3, cy - 5);
  ctx.lineTo(x + 3, cy + 5);
  ctx.fill();
  label(ctx, left, x, 'left');
  label(ctx, right, x, 'right');
  ctx.restore();
}

/** A rectangle on the screen (CSS pixels). */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Before and after side by side inside `r`: the left half drawn from `before`, the right half
 * from `after`, with a divider, a frame and the two labels at the top.
 */
export function drawBeforeAfter(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  r: ScreenRect,
  before: Scene,
  after: Scene,
  background: string,
  labels: [string, string],
  at = 0.5,
): void {
  const mid = Math.round(r.x0 + (r.x1 - r.x0) * at);
  for (const [scene, a, b] of [
    [before, r.x0, mid],
    [after, mid, r.x1],
  ] as const) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(a, r.y0, b - a, r.y1 - r.y0);
    ctx.clip();
    drawScene(ctx, w, h, scene, background);
    ctx.restore();
  }
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(mid - 2, r.y0, 4, r.y1 - r.y0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(mid - 1, r.y0, 2, r.y1 - r.y0);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const top = Math.max(r.y0 + 6, 4);
  for (const [text, side] of [
    [labels[0], 'left'],
    [labels[1], 'right'],
  ] as const) {
    const tw = ctx.measureText(text).width + 12;
    const bx = side === 'left' ? mid - tw - 6 : mid + 6;
    ctx.fillStyle = 'rgba(13, 11, 16, 0.8)';
    ctx.beginPath();
    ctx.roundRect(bx, top, tw, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, bx + 6, top + 9);
  }
  ctx.restore();
}

/** One side of a comparison: where on the screen, what is drawn there, and its label. */
export interface Panel {
  rect: ScreenRect;
  scene: Scene;
  label: string;
}

/** Scenes in panels of their own (each clipped to its rectangle), framed and labelled at the top. */
export function drawPanels(ctx: CanvasRenderingContext2D, w: number, h: number, panels: Panel[], background: string): void {
  for (const { rect: r, scene, label: text } of panels) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.clip();
    drawScene(ctx, w, h, scene, background);
    ctx.restore();
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(13, 11, 16, 0.8)';
    ctx.beginPath();
    ctx.roundRect(r.x0 + 6, r.y0 + 6, tw, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, r.x0 + 12, r.y0 + 15);
    ctx.restore();
  }
}
