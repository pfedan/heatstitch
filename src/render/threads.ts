import { COLOR_CHANGE, STITCH, type Pattern, type ThreadColor } from '../model/pattern';
import type { Viewport } from './viewport';

/** Visual thread width in mm for the realistic view; a 40 wt thread lies about this wide. */
const THREAD_MM = 0.4;
/** Below this on-screen thread width the shading is invisible, so the flat renderer is used. */
export const MIN_REALISTIC_PX = 2;
/** Light from the upper left, in screen coordinates (y down). */
const LIGHT_X = -Math.SQRT1_2;
const LIGHT_Y = -Math.SQRT1_2;

export interface ColorRun {
  color: ThreadColor;
  /** Stitch segments in 0.1 mm as x1, y1, x2, y2 quadruples, in sewing order. */
  segs: Float32Array;
}

const GREY: ThreadColor = { r: 128, g: 128, b: 128 };

/** Splits the stitch records into one run of segments per color block. */
export function colorRuns(p: Pattern): ColorRun[] {
  const runs: ColorRun[] = [];
  let block = 0;
  let buf: number[] = [];
  const flush = () => {
    if (buf.length) runs.push({ color: p.colors[block] ?? p.colors[p.colors.length - 1] ?? GREY, segs: new Float32Array(buf) });
    buf = [];
  };
  let prevStitch = false;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === STITCH) {
      if (prevStitch && (p.x[i] !== p.x[i - 1] || p.y[i] !== p.y[i - 1])) buf.push(p.x[i - 1], p.y[i - 1], p.x[i], p.y[i]);
      prevStitch = true;
    } else {
      if (c === COLOR_CHANGE) {
        flush();
        block++;
      }
      prevStitch = false;
    }
  }
  flush();
  return runs;
}

const rgb = (c: ThreadColor, f: number, white = 0) => {
  const m = (v: number) => Math.round(Math.min(255, v * f + (255 - v * f) * white));
  return `rgb(${m(c.r)}, ${m(c.g)}, ${m(c.b)})`;
};

let layer: HTMLCanvasElement | null = null;
let cached: { p: Pattern; runs: ColorRun[] } | null = null;

/**
 * Draws every stitch as a lit, rounded thread: a soft drop shadow, a dark rim, the thread body
 * and a sheen shifted towards the light. Each color block is drawn completely before the next,
 * so later blocks sit on top as on the fabric. Ends are pulled in a little so the needle holes
 * between stitches stay visible. Drawn at full strength into a layer, then composited with
 * `opacity` so overlapping passes don't show through each other.
 */
export function drawThreads(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, opacity: number): void {
  if (cached?.p !== p) cached = { p, runs: colorRuns(p) };
  const runs = cached.runs;

  const { width: cw, height: ch } = ctx.canvas;
  layer ??= document.createElement('canvas');
  if (layer.width !== cw || layer.height !== ch) {
    layer.width = cw;
    layer.height = ch;
  }
  const lc = layer.getContext('2d')!;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, cw, ch);
  lc.setTransform(ctx.getTransform());
  lc.lineCap = 'round';

  const w = THREAD_MM * vp.scale;
  const s = vp.scale / 10;
  const ox = vp.offsetX;
  const oy = vp.offsetY;
  const sh = w * 0.3;
  // Gap left at each needle hole, and how far the sheen is pulled in further.
  const inset = w * 0.25;
  const sheenInset = w * 0.6;
  const sheenShift = w * 0.17;

  /** Appends every segment, shortened by `cut` at both ends and shifted by (dx, dy) or towards the light. */
  const path = (segs: Float32Array, cut: number, dx: number, dy: number, lightShift: number) => {
    lc.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      const x1 = segs[i] * s + ox;
      const y1 = segs[i + 1] * s + oy;
      const x2 = segs[i + 2] * s + ox;
      const y2 = segs[i + 3] * s + oy;
      const ex = x2 - x1;
      const ey = y2 - y1;
      const len = Math.hypot(ex, ey);
      const ux = ex / len;
      const uy = ey / len;
      const c = Math.min(cut, len * 0.45);
      let sx = dx;
      let sy = dy;
      if (lightShift) {
        // Unit normal, flipped to face the light.
        let nx = -uy;
        let ny = ux;
        if (nx * LIGHT_X + ny * LIGHT_Y < 0) (nx = -nx), (ny = -ny);
        sx += nx * lightShift;
        sy += ny * lightShift;
      }
      lc.moveTo(x1 + ux * c + sx, y1 + uy * c + sy);
      lc.lineTo(x2 - ux * c + sx, y2 - uy * c + sy);
    }
  };

  for (const { color, segs } of runs) {
    path(segs, inset, sh, sh, 0);
    lc.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    lc.lineWidth = w;
    lc.stroke();

    path(segs, inset, 0, 0, 0);
    lc.strokeStyle = rgb(color, 0.55);
    lc.lineWidth = w;
    lc.stroke();
    lc.strokeStyle = rgb(color, 1);
    lc.lineWidth = w * 0.7;
    lc.stroke();

    path(segs, sheenInset, 0, 0, sheenShift);
    lc.strokeStyle = rgb(color, 1, 0.45);
    lc.lineWidth = w * 0.22;
    lc.stroke();
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/** True when threads are drawn wide enough on screen for the realistic shading to show. */
export function realisticVisible(vp: Viewport): boolean {
  return THREAD_MM * vp.scale >= MIN_REALISTIC_PX;
}
