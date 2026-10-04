import { COLOR_CHANGE, STITCH, type Pattern, type ThreadColor } from '../model/pattern';
import type { StitchStyle } from './flow';
import { GlThreadRenderer } from './threadsGl';
import type { Viewport } from './viewport';


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

let gl: GlThreadRenderer | null = null;
/** Set once WebGL2 turned out to be unavailable, so the flat renderer is used from then on. */
let unavailable = false;

function renderer(): GlThreadRenderer | null {
  if (unavailable) return null;
  if (gl && !gl.lost) return gl;
  try {
    gl = new GlThreadRenderer(document.createElement('canvas'));
  } catch {
    unavailable = true;
    gl = null;
  }
  return gl;
}

/**
 * Draws every stitch as a lit, round thread with WebGL (see threadsGl.ts) into a layer that is
 * composited with `opacity`, so overlapping passes don't show through each other. Returns false
 * when WebGL2 is not available; the caller then draws flat lines.
 */
export function drawThreads(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  p: Pattern,
  opacity: number,
  threadMm: number,
  style?: StitchStyle,
): boolean {
  const r = renderer();
  if (!r) return false;
  const { width: cw, height: ch } = ctx.canvas;
  r.draw(p, vp, ctx.getTransform().a, cw, ch, threadMm, style);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.drawImage(r.canvas, 0, 0);
  ctx.restore();
  return true;
}
