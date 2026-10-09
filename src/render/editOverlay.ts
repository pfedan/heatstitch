import { t } from '../i18n';
import { STITCH, type Pattern } from '../model/pattern';
import type { EditView, PenPreview } from '../ui/editor';
import { SHORT_STITCH_MM } from '../validation/thresholds';
import { DST_MAX_DELTA } from '../writers/dst';
import type { Viewport } from './viewport';

/** Needle penetrations are drawn once the view is zoomed in at least this far (px per mm). */
export const POINTS_MIN_SCALE = 6;
/** Beyond this many visible points the dots are skipped (they would only form a grey carpet). */
const MAX_POINTS = 20000;
const ACCENT = '#e0559e';
/** Penetrations before and after the focused one whose stitches are shown, fading with the distance. */
export const CONTEXT = 6;

/** Penetration dots, selection, hover ring and rubber band of the stitch editor. */
export function drawEditOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, view: EditView, w: number, h: number): void {
  const s = vp.scale / 10;
  const ox = vp.offsetX;
  const oy = vp.offsetY;
  const visible = (x: number, y: number) => x >= -8 && y >= -8 && x <= w + 8 && y <= h + 8;
  ctx.save();

  // Within an object its penetrations are always drawn; otherwise once zoomed in far enough.
  const range = view.range;
  if (range || vp.scale >= POINTS_MIN_SCALE) {
    const pts: number[] = [];
    const end = range ? Math.min(range.last, p.cmd.length - 1) : p.cmd.length - 1;
    for (let i = range?.first ?? 0; i <= end && pts.length < 2 * MAX_POINTS; i++) {
      if (p.cmd[i] !== STITCH) continue;
      const x = p.x[i] * s + ox;
      const y = p.y[i] * s + oy;
      if (visible(x, y)) pts.push(x, y);
    }
    if (pts.length < 2 * MAX_POINTS) {
      const r = Math.min(2.5, Math.max(range ? 1 : 1.2, vp.scale / 12));
      ctx.beginPath();
      for (let k = 0; k < pts.length; k += 2) {
        ctx.moveTo(pts[k] + r, pts[k + 1]);
        ctx.arc(pts[k], pts[k + 1], r, 0, Math.PI * 2);
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
  }

  // The way of the thread around the focused penetration, then where the object starts and ends:
  // under the selection, so a selected point stays on top.
  if (view.focus >= 0 && view.focus < p.cmd.length && p.cmd[view.focus] === STITCH) drawContext(ctx, vp, p, view.focus, range, view.selection.has(view.focus) ? 1 : 0.6);
  if (view.ends) drawEnds(ctx, vp, p, view.ends.first, view.ends.end, view.pen ? -1 : view.grab, w, h);

  if (view.selection.size) {
    ctx.beginPath();
    for (const i of view.selection) {
      if (i >= p.cmd.length) continue;
      const x = p.x[i] * s + ox;
      const y = p.y[i] * s + oy;
      if (!visible(x, y)) continue;
      ctx.moveTo(x + 4, y);
      ctx.arc(x, y, 4, 0, Math.PI * 2);
    }
    ctx.fillStyle = ACCENT;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }

  if (view.hover >= 0 && view.hover < p.cmd.length) {
    const x = p.x[view.hover] * s + ox;
    const y = p.y[view.hover] * s + oy;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (view.grab >= 0 && view.grab < p.cmd.length && p.cmd[view.grab] === STITCH) drawLengths(ctx, vp, p, view.grab, view.formatMm);
  if (view.pen) drawPen(ctx, vp, view.pen, view.formatMm);

  if (view.band) drawBand(ctx, vp, view.band);
  ctx.restore();
}

/** A rubber band (world mm) being dragged to select what lies inside it. */
export function drawBand(ctx: CanvasRenderingContext2D, vp: Viewport, band: { x0: number; y0: number; x1: number; y1: number }): void {
  const [x0, y0] = vp.toScreen(band.x0, band.y0);
  const [x1, y1] = vp.toScreen(band.x1, band.y1);
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(224, 85, 158, 0.15)';
  ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.restore();
}

/**
 * The lengths of the stitches into and out of penetration `i`, next to it: amber when shorter than
 * a short stitch, red when longer than a machine can make in one stitch.
 */
function drawLengths(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, i: number, format: (mm: number) => string): void {
  const lens: number[] = [];
  if (i > 0 && p.cmd[i - 1] === STITCH) lens.push(Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10);
  if (i + 1 < p.cmd.length && p.cmd[i + 1] === STITCH) lens.push(Math.hypot(p.x[i + 1] - p.x[i], p.y[i + 1] - p.y[i]) / 10);
  if (!lens.length) return;
  const [x, y] = vp.toScreen(p.x[i] / 10, p.y[i] / 10);
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const parts = lens.map((mm) => ({ text: format(mm), color: mm * 10 > DST_MAX_DELTA ? '#ff5d5d' : mm < SHORT_STITCH_MM ? '#ffb340' : '#ffffff' }));
  const sep = ' · ';
  const widths = parts.map((pt) => ctx.measureText(pt.text).width);
  const sepW = ctx.measureText(sep).width;
  const w = widths.reduce((a, b) => a + b, 0) + sepW * (parts.length - 1) + 12;
  const h = 20;
  const bx = x + 12;
  const by = y - h - 8;
  ctx.fillStyle = 'rgba(20, 16, 24, 0.85)';
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 5);
  ctx.fill();
  let tx = bx + 6;
  parts.forEach((pt, k) => {
    if (k) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(sep, tx, by + h / 2);
      tx += sepW;
    }
    ctx.fillStyle = pt.color;
    ctx.fillText(pt.text, tx, by + h / 2);
    tx += widths[k];
  });
}

/**
 * The stitches into and out of penetration `i` and a few more on either side in sewing order, in
 * the accent, fading with the distance, with a small arrow for the direction the thread runs; the
 * points they join get a ring. `strength` softens the whole for a mere hover.
 */
function drawContext(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, i: number, range: { first: number; last: number } | null, strength: number): void {
  const lo = range?.first ?? 0;
  const hi = Math.min(range?.last ?? p.cmd.length - 1, p.cmd.length - 1);
  // The penetrations around i, in order, each with its distance from i.
  const pts: { j: number; d: number }[] = [{ j: i, d: 0 }];
  for (let j = i - 1, d = 1; j >= lo && d <= CONTEXT; j--) if (p.cmd[j] === STITCH) pts.unshift({ j, d: d++ });
  for (let j = i + 1, d = 1; j <= hi && d <= CONTEXT; j++) if (p.cmd[j] === STITCH) pts.push({ j, d: d++ });
  const at = (j: number) => vp.toScreen(p.x[j] / 10, p.y[j] / 10);
  const alpha = (d: number) => strength * (1 - (d - 1) / (CONTEXT + 1));
  ctx.save();
  ctx.lineCap = 'round';
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const d = Math.max(a.d, b.d);
    const [x0, y0] = at(a.j);
    const [x1, y1] = at(b.j);
    // Records between them (a jump or a trim): the thread was carried, not sewn.
    const carried = b.j - a.j > 1;
    ctx.globalAlpha = alpha(d);
    ctx.setLineDash(carried ? [4, 4] : []);
    // A dark halo keeps the line readable on any thread color; the two stitches at the point itself
    // are in the accent, the others white.
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = 'rgba(20, 16, 24, 0.75)';
    ctx.lineWidth = d === 1 ? 6 : 4.5;
    ctx.stroke();
    ctx.strokeStyle = d === 1 ? ACCENT : '#ffffff';
    ctx.lineWidth = d === 1 ? 3 : 2;
    ctx.stroke();
    ctx.setLineDash([]);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len > 22) drawArrow(ctx, (x0 + x1) / 2, (y0 + y1) / 2, Math.atan2(y1 - y0, x1 - x0), d === 1 ? '#ffffff' : ACCENT);
  }
  ctx.lineWidth = 1.5;
  for (const { j, d } of pts) {
    if (!d) continue;
    const [x, y] = at(j);
    ctx.globalAlpha = alpha(d);
    ctx.beginPath();
    ctx.arc(x, y, d === 1 ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = ACCENT;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A small arrow head at (x, y) pointing at angle `a`: the direction the thread runs. */
function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, color: string): void {
  const s = 5;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
  ctx.lineTo(x + Math.cos(a + 2.4) * s, y + Math.sin(a + 2.4) * s);
  ctx.lineTo(x + Math.cos(a - 2.4) * s, y + Math.sin(a - 2.4) * s);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(20, 16, 24, 0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Where the object starts (a round mark with a play sign, pointing along its first stitch) and where
 * its thread ends (a square stop mark), each with a word: told by shape and word, not only by color.
 */
function drawEnds(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, first: number, end: number, grab: number, w: number, h: number): void {
  if (first >= p.cmd.length || end >= p.cmd.length) return;
  const [sx, sy] = vp.toScreen(p.x[first] / 10, p.y[first] / 10);
  const [ex, ey] = vp.toScreen(p.x[end] / 10, p.y[end] / 10);
  // The direction of the first stitch that goes somewhere (a tie-in barely moves).
  let dir = 0;
  for (let j = first + 1; j < p.cmd.length && j <= end; j++) {
    if (p.cmd[j] !== STITCH) continue;
    const [x, y] = vp.toScreen(p.x[j] / 10, p.y[j] / 10);
    if (Math.hypot(x - sx, y - sy) > 6) {
      dir = Math.atan2(y - sy, x - sx);
      break;
    }
  }
  const r = 8;
  const seen = (x: number, y: number) => x >= -r && y >= -r && x <= w + r && y <= h + r;
  ctx.save();
  // Start: a disc with a play sign.
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(20, 16, 24, 0.85)';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  const tr = 4.2;
  ctx.moveTo(sx + Math.cos(dir) * tr * 1.15, sy + Math.sin(dir) * tr * 1.15);
  ctx.lineTo(sx + Math.cos(dir + 2.2) * tr, sy + Math.sin(dir + 2.2) * tr);
  ctx.lineTo(sx + Math.cos(dir - 2.2) * tr, sy + Math.sin(dir - 2.2) * tr);
  ctx.closePath();
  ctx.fillStyle = ACCENT;
  ctx.fill();
  // End: a square with a stop sign. Where both are on one spot, the end stands a little aside.
  const same = Math.hypot(ex - sx, ey - sy) < 2 * r;
  const qx = same ? ex + 2 * r : ex;
  const qy = ey;
  ctx.beginPath();
  ctx.rect(qx - r + 1, qy - r + 1, 2 * r - 2, 2 * r - 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ACCENT;
  ctx.fillRect(qx - 3, qy - 3, 6, 6);
  // Their words on the side away from the other mark, so they do not cover each other; to the left
  // of a mark whose stitch lengths are shown (they stand to the upper right).
  const away = (x: number, y: number, ox: number, oy: number): [number, number] => {
    const a = Math.atan2(y - oy, x - ox);
    return [Math.cos(a) || 1, Math.sin(a)];
  };
  // A word that would leave the stage (or go under the tools at its bottom) goes to the side instead.
  const inside = (x: number, y: number, d: [number, number]): [number, number] => {
    const [dx, dy] = d;
    const ty = y + dy * (r + 26);
    const tx = x + dx * (r + 60);
    // (The bars over the stage reach about 100 px down, the tools at its foot about 130 px up.)
    if (ty < 100 || ty > h - 130 || tx < 10 || tx > w - 10) return [x > w - 90 ? -1 : 1, 0];
    return d;
  };
  const [ux, uy] = inside(sx, sy, same || grab === first ? [-1, 0] : away(sx, sy, ex, ey));
  const [vx, vy] = inside(qx, qy, same ? [1, 0] : grab === end ? [-1, 0] : away(ex, ey, sx, sy));
  if (seen(sx, sy)) chip(ctx, t('stitches.start'), sx + ux * (r + 6), sy + uy * (r + 6), ux, uy);
  if (seen(qx, qy)) chip(ctx, t('stitches.end'), qx + vx * (r + 6), qy + vy * (r + 6), vx, vy);
  ctx.restore();
}

/** A small dark label with `text` beside (x, y), on the side the direction (ux, uy) points to. */
function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ux: number, uy: number, color = '#ffffff'): void {
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 12;
  const h = 20;
  const cx = x + (ux * w) / 2;
  const cy = y + (uy * h) / 2;
  ctx.fillStyle = 'rgba(20, 16, 24, 0.85)';
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 5);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, cx - w / 2 + 6, cy);
}

/**
 * Setting stitches one by one: the stitch a click would sew, from the current penetration to the
 * pointer, with its length (or the even steps it is sewn in), and where the thread goes on after it.
 */
function drawPen(ctx: CanvasRenderingContext2D, vp: Viewport, pen: PenPreview, format: (mm: number) => string): void {
  const [ax, ay] = vp.toScreen(pen.from[0] / 10, pen.from[1] / 10);
  const [bx, by] = vp.toScreen(pen.to[0] / 10, pen.to[1] / 10);
  ctx.save();
  ctx.lineCap = 'round';
  if (pen.next) {
    const [nx, ny] = vp.toScreen(pen.next[0] / 10, pen.next[1] / 10);
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = 'rgba(20, 16, 24, 0.7)';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // The steps of a long stitch, as the needle will make them.
  for (let k = 1; k < pen.pieces; k++) {
    const x = ax + ((bx - ax) * k) / pen.pieces;
    const y = ay + ((by - ay) * k) / pen.pieces;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(bx, by, pen.snapped ? 6 : 4, 0, Math.PI * 2);
  ctx.fillStyle = pen.snapped ? 'rgba(255, 255, 255, 0.25)' : ACCENT;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  const mm = Math.hypot(pen.to[0] - pen.from[0], pen.to[1] - pen.from[1]) / 10;
  const each = mm / pen.pieces;
  const text = pen.pieces > 1 ? `${pen.pieces} × ${format(each)}` : format(mm);
  const color = mm > 0 && each < SHORT_STITCH_MM ? '#ffb340' : '#ffffff';
  chip(ctx, text, bx + 12, by - 18, 1, 0, color);
  ctx.restore();
}
