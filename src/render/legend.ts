import { lutCss, WARN_COLOR } from './colormap';

export interface LegendSpec {
  max: number;
  warn: number;
  unit: string;
  title: string;
  /** Text colour for labels. */
  ink: string;
}

const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));

/** Horizontal colour bar with ticks at 0, warn and max. Occupies w x LEGEND_HEIGHT at (x, y). */
export function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, spec: LegendSpec): void {
  const barH = 12;
  const top = y + 16;
  ctx.save();
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = spec.ink;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${spec.title} (${spec.unit})`, x, y + 11);

  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  for (let i = 0; i <= 16; i++) grad.addColorStop(i / 16, lutCss(i / 16));
  ctx.fillStyle = grad;
  ctx.fillRect(x, top, w, barH);

  const wx = x + Math.min(1, spec.warn / spec.max) * w;
  ctx.fillStyle = WARN_COLOR;
  ctx.fillRect(wx - 1, top - 3, 2, barH + 6);

  ctx.fillStyle = spec.ink;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('0', x, top + barH + 4);
  ctx.textAlign = 'right';
  ctx.fillText(`≥ ${fmt(spec.max)}`, x + w, top + barH + 4);
  if (spec.warn < spec.max * 0.85 && spec.warn > spec.max * 0.1) {
    ctx.textAlign = 'center';
    ctx.fillStyle = WARN_COLOR;
    ctx.fillText(fmt(spec.warn), wx, top + barH + 4);
  }
  ctx.restore();
}

export const LEGEND_HEIGHT = 46;
