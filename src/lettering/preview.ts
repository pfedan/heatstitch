import { apply } from '../shape/path';
import type { Font } from './font';
import { layout, type Layout, type Lettering } from './layout';

/**
 * The letters as flat shapes (satin columns filled between their rails, running stitch as a thin
 * line, fills as areas): quick to draw, for the font list and while stitches are still coming.
 */
export function drawLetters(ctx: CanvasRenderingContext2D, lay: Layout, toScreen: (x: number, y: number) => [number, number], color: string, line: number): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = line;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const p of lay.letters) {
    if (!p.glyph) continue;
    const pt = (x: number, y: number) => toScreen(...apply(p.m, [x, y]));
    for (const e of p.glyph.e) {
      ctx.beginPath();
      if (e.k === 's') {
        for (let k = 0; k + 1 < e.l.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, ...pt(e.l[k], e.l[k + 1]));
        for (let k = e.r.length - 2; k >= 0; k -= 2) ctx.lineTo(...pt(e.r[k], e.r[k + 1]));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (e.k === 'r') {
        for (let k = 0; k + 1 < e.d.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, ...pt(e.d[k], e.d[k + 1]));
        ctx.stroke();
      } else {
        for (const loop of e.d) {
          for (let k = 0; k + 1 < loop.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, ...pt(loop[k], loop[k + 1]));
          ctx.closePath();
        }
        ctx.fill('evenodd');
      }
    }
  }
  ctx.restore();
}

/** A sample of `text` in `font`, fitted into the canvas (its CSS size), for the font list. */
export function drawSample(canvas: HTMLCanvasElement, font: Font, text: string, color: string): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const l: Lettering = {
    id: 'sample',
    text: text.split('\n')[0] || font.name,
    font: font.id,
    height: 10,
    align: 'left',
    spacing: 0,
    wordSpacing: 0,
    lineSpacing: 1,
    shape: 'line',
    radius: 40,
    x: 0,
    y: 0,
    angle: 0,
    color: { r: 0, g: 0, b: 0 },
    back: false,
    density: 1,
    underlay: true,
    letters: [],
  };
  const lay = layout(font, l);
  // Every font at the same height of its capitals, on one baseline; long text runs out at the right.
  const k = (h * 0.56) / 10;
  const ox = 4 - lay.minX * k;
  const oy = h * 0.74;
  drawLetters(ctx, lay, (x, y) => [ox + x * k, oy + y * k], color, Math.max(0.6, 0.25 * k));
}
