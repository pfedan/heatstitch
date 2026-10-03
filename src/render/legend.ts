import { lutCss } from './colormap';

export interface LegendTick {
  value: number;
  color: string;
}

export interface LegendSpec {
  max: number;
  /** Fixed markers on the bar, e.g. the validation thresholds. */
  ticks: LegendTick[];
  unit: string;
  title: string;
  /** Text colour for labels. */
  ink: string;
}

const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));

/** Title and max on top, colour bar labelled from 0, with optional coloured ticks. Occupies w x LEGEND_HEIGHT at (x, y). */
export function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, spec: LegendSpec): void {
  const barH = 12;
  const top = y + 16;
  ctx.save();
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = spec.ink;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${spec.title} (${spec.unit})`, x, y + 11);
  ctx.textAlign = 'right';
  ctx.fillText(`≥ ${fmt(spec.max)}`, x + w, y + 11);

  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  for (let i = 0; i <= 16; i++) grad.addColorStop(i / 16, lutCss(i / 16));
  ctx.fillStyle = grad;
  ctx.fillRect(x, top, w, barH);

  for (const tick of spec.ticks) {
    if (tick.value > spec.max) continue;
    const tx = x + (tick.value / spec.max) * w;
    ctx.fillStyle = tick.color;
    ctx.fillRect(tx - 1.5, top - 3, 3, barH + 6);
  }

  ctx.fillStyle = spec.ink;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('0', x, top + barH + 4);
  ctx.textAlign = 'center';
  for (const tick of spec.ticks) {
    if (tick.value > spec.max * 0.96 || tick.value < spec.max * 0.06) continue;
    ctx.fillStyle = tick.color;
    ctx.fillText(fmt(tick.value), x + (tick.value / spec.max) * w, top + barH + 4);
  }
  ctx.restore();
}

export const LEGEND_HEIGHT = 46;
