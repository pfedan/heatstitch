import { JUMP, STITCH, type Pattern, type ThreadColor } from '../model/pattern';
import { blockIndex, FILL, RUNNING, SATIN, stitchKinds, TIE_STITCH, type CarriedJumps, type Markers, type Transition } from '../model/sequence';
import type { ColorBy, Marks } from '../settings';
import { SHORT_STITCH_MM } from '../validation/thresholds';
import type { Viewport } from './viewport';

/**
 * Per stitch color and visibility for the stitch plan, plus the symbols of the Ablauf mode
 * (trims, color changes, start and end, needle points, the needle while playing).
 */
export interface StitchStyle {
  /** r, g, b (0..255) of the stitch ending at each record. */
  rgb: Uint8Array;
  /** Opacity per record: 0 hides the stitch, 1 is normal, in between dims it. */
  alpha: Float32Array;
  /** Last record that is sewn; later records are not drawn (player). */
  limit: number;
  /** Jumps without a trim to draw as thread; without it they are left out. */
  carried?: CarriedJumps | null;
}

/** Stitches longer than this (mm) are long; from the DST maximum on, machines split them. */
export const LONG_MM = 7;
export const MAX_MM = 12.1;

export const KIND_COLORS: Record<number, ThreadColor> = {
  [SATIN]: { r: 86, g: 156, b: 255 },
  [FILL]: { r: 96, g: 200, b: 128 },
  [RUNNING]: { r: 242, g: 193, b: 78 },
  [TIE_STITCH]: { r: 150, g: 140, b: 160 },
};

export const LENGTH_COLORS = {
  tie: { r: 150, g: 140, b: 160 },
  short: { r: 255, g: 99, b: 99 },
  normal: { r: 200, g: 196, b: 210 },
  long: { r: 255, g: 166, b: 60 },
  max: { r: 232, g: 64, b: 251 },
} satisfies Record<string, ThreadColor>;

/** Order gradient: early stitches blue, late ones yellow (viridis stops). */
const ORDER_STOPS: [number, number, number][] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

export function orderColor(t: number): ThreadColor {
  const f = Math.min(1, Math.max(0, t)) * (ORDER_STOPS.length - 1);
  const i = Math.min(ORDER_STOPS.length - 2, Math.floor(f));
  const k = f - i;
  const [a, b] = [ORDER_STOPS[i], ORDER_STOPS[i + 1]];
  return { r: Math.round(a[0] + (b[0] - a[0]) * k), g: Math.round(a[1] + (b[1] - a[1]) * k), b: Math.round(a[2] + (b[2] - a[2]) * k) };
}

export const ORDER_CSS = `linear-gradient(90deg, ${ORDER_STOPS.map((c) => `rgb(${c.join(',')})`).join(', ')})`;

const GREY: ThreadColor = { r: 128, g: 128, b: 128 };
/** Jump threads in the kind and length colorings, which have no color of their own for them. */
const JUMP_THREAD: ThreadColor = { r: 128, g: 122, b: 138 };

/** Colors of every stitch for one way of coloring; cached by the caller per pattern. */
export function stitchColors(p: Pattern, by: ColorBy, kinds?: Uint8Array): Uint8Array {
  const n = p.cmd.length;
  const out = new Uint8Array(n * 3);
  const set = (i: number, c: ThreadColor) => {
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  };
  if (by === 'thread') {
    const blocks = blockIndex(p);
    for (let i = 0; i < n; i++) set(i, p.colors[blocks[i]] ?? p.colors[p.colors.length - 1] ?? GREY);
  } else if (by === 'order') {
    let total = 0;
    for (let i = 0; i < n; i++) if (p.cmd[i] === STITCH) total++;
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (p.cmd[i] === STITCH) k++;
      set(i, orderColor(total > 1 ? (k - 1) / (total - 1) : 0));
    }
  } else if (by === 'kind') {
    const kk = kinds ?? stitchKinds(p);
    for (let i = 0; i < n; i++) set(i, KIND_COLORS[kk[i]] ?? JUMP_THREAD);
  } else {
    const kk = kinds ?? stitchKinds(p);
    for (let i = 1; i < n; i++) {
      if (p.cmd[i] !== STITCH) continue;
      // The first stitch after a jump: only drawn as the thread of a jump that is not cut.
      if (p.cmd[i - 1] !== STITCH) {
        set(i, JUMP_THREAD);
        continue;
      }
      const mm = Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;
      const c =
        kk[i] === TIE_STITCH ? LENGTH_COLORS.tie
        : mm < SHORT_STITCH_MM ? LENGTH_COLORS.short
        : mm > MAX_MM ? LENGTH_COLORS.max
        : mm > LONG_MM ? LENGTH_COLORS.long
        : LENGTH_COLORS.normal;
      set(i, c);
    }
  }
  return out;
}

/** Opacity per record: hidden color blocks vanish, with a focused block the others fade. */
export function stitchAlpha(p: Pattern, hidden: ReadonlySet<number>, focus: number | null): Float32Array {
  const n = p.cmd.length;
  const out = new Float32Array(n).fill(1);
  if (!hidden.size && focus === null) return out;
  const blocks = blockIndex(p);
  for (let i = 0; i < n; i++) {
    const b = blocks[i];
    out[i] = hidden.has(b) ? 0 : focus !== null && b !== focus ? 0.15 : 1;
  }
  return out;
}

/** Flat stitch lines in per-stitch colors, drawn in sewing order up to the style's limit. */
export function drawFlatStitches(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, st: StitchStyle, opacity: number): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.75, 0.3 * vp.scale);
  const s = vp.scale / 10;
  const ox = vp.offsetX;
  const oy = vp.offsetY;
  let key = -1;
  let open = false;
  const flush = () => {
    if (open) ctx.stroke();
    open = false;
  };
  const end = Math.min(st.limit, p.cmd.length - 1);
  const carried = st.carried?.from;
  for (let i = 1; i <= end; i++) {
    const jumpFrom = carried ? carried[i] : -1;
    if (p.cmd[i] !== STITCH || (p.cmd[i - 1] !== STITCH && jumpFrom < 0)) continue;
    const a = st.alpha[i];
    if (a <= 0) continue;
    const k = (st.rgb[i * 3] << 16) | (st.rgb[i * 3 + 1] << 8) | st.rgb[i * 3 + 2];
    const kk = k * 8 + Math.round(a * 7);
    const j = jumpFrom >= 0 ? jumpFrom : i - 1;
    const x0 = p.x[j] * s + ox;
    const y0 = p.y[j] * s + oy;
    if (kk !== key) {
      flush();
      key = kk;
      ctx.strokeStyle = `rgb(${st.rgb[i * 3]}, ${st.rgb[i * 3 + 1]}, ${st.rgb[i * 3 + 2]})`;
      ctx.globalAlpha = opacity * a;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      open = true;
    } else if (jumpFrom >= 0 || p.cmd[i - 2] !== STITCH || st.alpha[i - 1] <= 0) ctx.moveTo(x0, y0);
    ctx.lineTo(p.x[i] * s + ox, p.y[i] * s + oy);
  }
  flush();
  ctx.restore();
}

/** Jump moves as dashed lines; `skip` leaves out the ones already drawn as thread. */
export function drawJumps(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  p: Pattern,
  limit: number,
  alpha?: Float32Array,
  skip?: Uint8Array,
): void {
  const s = vp.scale / 10;
  const ox = vp.offsetX;
  const oy = vp.offsetY;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#9a92a6';
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  const end = Math.min(limit, p.cmd.length - 1);
  for (let i = 1; i <= end; i++) {
    if (p.cmd[i] !== JUMP || (alpha && alpha[i] <= 0) || skip?.[i]) continue;
    ctx.moveTo(p.x[i - 1] * s + ox, p.y[i - 1] * s + oy);
    ctx.lineTo(p.x[i] * s + ox, p.y[i] * s + oy);
  }
  ctx.stroke();
  ctx.restore();
}

/** Needle points are drawn from this zoom on (px per mm), and only while few enough are visible. */
const POINTS_MIN_SCALE = 5;
const MAX_POINTS = 30000;

function drawPoints(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, limit: number, alpha: Float32Array | undefined, w: number, h: number): void {
  if (vp.scale < POINTS_MIN_SCALE) return;
  const s = vp.scale / 10;
  const pts: number[] = [];
  const end = Math.min(limit, p.cmd.length - 1);
  for (let i = 0; i <= end && pts.length < 2 * MAX_POINTS; i++) {
    if (p.cmd[i] !== STITCH || (alpha && alpha[i] <= 0)) continue;
    const x = p.x[i] * s + vp.offsetX;
    const y = p.y[i] * s + vp.offsetY;
    if (x >= -4 && y >= -4 && x <= w + 4 && y <= h + 4) pts.push(x, y);
  }
  if (pts.length >= 2 * MAX_POINTS) return;
  const r = Math.min(2.2, Math.max(1, vp.scale / 14));
  ctx.save();
  ctx.beginPath();
  for (let k = 0; k < pts.length; k += 2) {
    ctx.moveTo(pts[k] + r, pts[k + 1]);
    ctx.arc(pts[k], pts[k + 1], r, 0, Math.PI * 2);
  }
  ctx.fillStyle = 'rgba(10, 8, 14, 0.85)';
  ctx.fill();
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.stroke();
  ctx.restore();
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink = '#fff'): void {
  ctx.font = '600 10px system-ui, sans-serif';
  const w = Math.max(16, ctx.measureText(text).width + 8);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 8, w, 16, 8);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(13, 11, 16, 0.9)';
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

/** Light or dark text for a badge filled with color c. */
const inkFor = (c: ThreadColor) => (c.r * 0.299 + c.g * 0.587 + c.b * 0.114 > 150 ? '#14060d' : '#fff');

export interface MarkerScene {
  markers: Markers;
  marks: Marks;
  limit: number;
  alpha?: Float32Array;
}

/** Points, trims, color changes, start and end, on top of the stitches. */
export function drawMarkers(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, m: MarkerScene, w: number, h: number): void {
  const { markers: mk, marks, limit, alpha } = m;
  const s = vp.scale / 10;
  const at = (i: number): [number, number] => [p.x[i] * s + vp.offsetX, p.y[i] * s + vp.offsetY];
  const shown = (i: number) => i >= 0 && i <= limit && (!alpha || alpha[i] > 0);
  if (marks.points) drawPoints(ctx, vp, p, limit, alpha, w, h);
  ctx.save();
  if (marks.trims) {
    for (const i of mk.trims) {
      if (!shown(i)) continue;
      const [x, y] = at(i);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(13, 11, 16, 0.85)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✂', x, y + 0.5);
    }
  }
  if (marks.colors) {
    mk.colorStarts.forEach((i, k) => {
      if (!shown(i)) return;
      const [x, y] = at(i);
      const c = p.colors[k] ?? GREY;
      badge(ctx, x, y - 12, String(k + 1), `rgb(${c.r}, ${c.g}, ${c.b})`, inkFor(c));
    });
  }
  if (marks.ends) {
    if (shown(mk.start)) badge(ctx, ...at(mk.start), 'S', '#2e9e5b');
    if (mk.end >= 0 && mk.end <= limit) badge(ctx, ...at(mk.end), 'E', '#c4314b');
  }
  ctx.restore();
}

/** Where the needle is while the player stands before the end. */
export function drawNeedle(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, i: number): void {
  if (i < 0 || i >= p.cmd.length) return;
  const x = p.x[i] * (vp.scale / 10) + vp.offsetX;
  const y = p.y[i] * (vp.scale / 10) + vp.offsetY;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.moveTo(x - 15, y);
  ctx.lineTo(x - 5, y);
  ctx.moveTo(x + 5, y);
  ctx.lineTo(x + 15, y);
  ctx.moveTo(x, y - 15);
  ctx.lineTo(x, y - 5);
  ctx.moveTo(x, y + 5);
  ctx.lineTo(x, y + 15);
  ctx.stroke();
  ctx.restore();
}

/** The jump hovered or selected in the list: a bright line with both ends. */
export function drawTransition(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, t: Transition, strong: boolean): void {
  const s = vp.scale / 10;
  const [x0, y0] = [p.x[t.from] * s + vp.offsetX, p.y[t.from] * s + vp.offsetY];
  const [x1, y1] = [p.x[t.to] * s + vp.offsetX, p.y[t.to] * s + vp.offsetY];
  const color = t.trimmed ? '#6fd3ff' : '#ffb347';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(13, 11, 16, 0.85)';
  ctx.lineWidth = strong ? 7 : 5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = strong ? 3 : 2;
  ctx.setLineDash(t.trimmed ? [6, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, y] of [
    [x0, y0],
    [x1, y1],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, strong ? 5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(13, 11, 16, 0.9)';
    ctx.stroke();
  }
  ctx.restore();
}

/** Index of the transition whose line passes within `px` screen pixels of (sx, sy), or -1. */
export function transitionAt(p: Pattern, list: Transition[], vp: Viewport, sx: number, sy: number, px = 8): number {
  const s = vp.scale / 10;
  let best = -1;
  let bestD = px;
  list.forEach((t, k) => {
    const ax = p.x[t.from] * s + vp.offsetX;
    const ay = p.y[t.from] * s + vp.offsetY;
    const bx = p.x[t.to] * s + vp.offsetX;
    const by = p.y[t.to] * s + vp.offsetY;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.min(1, Math.max(0, ((sx - ax) * dx + (sy - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + u * dx - sx, ay + u * dy - sy);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/** Record of the stitch whose segment lies nearest to (x, y) (0.1 mm) within `maxDist`, or -1. */
export function stitchAt(p: Pattern, x: number, y: number, maxDist: number, limit: number, alpha?: Float32Array): number {
  let best = -1;
  let bestD = maxDist;
  const end = Math.min(limit, p.cmd.length - 1);
  for (let i = 1; i <= end; i++) {
    if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH || (alpha && alpha[i] <= 0)) continue;
    const ax = p.x[i - 1];
    const ay = p.y[i - 1];
    const dx = p.x[i] - ax;
    const dy = p.y[i] - ay;
    if (Math.abs(x - ax) > Math.abs(dx) + maxDist || Math.abs(y - ay) > Math.abs(dy) + maxDist) continue;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + u * dx - x, ay + u * dy - y);
    // Later stitches lie on top, so ties go to them.
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
