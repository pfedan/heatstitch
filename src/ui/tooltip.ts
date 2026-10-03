import type { DensityGrid } from '../density/grid';
import { formatNumber, t } from '../i18n';
import { sampleGrid } from '../render/heatmap';
import type { Viewport } from '../render/viewport';
import type { Settings } from '../settings';

/** Shows world position and density under the cursor; hides when outside the grid. */
export function updateTooltip(
  el: HTMLElement,
  sx: number,
  sy: number,
  stageW: number,
  vp: Viewport,
  grid: DensityGrid | null,
  s: Settings,
): void {
  if (!grid) {
    el.hidden = true;
    return;
  }
  const [x, y] = vp.toWorld(sx, sy);
  const v = sampleGrid(grid, x, y);
  if (v === null) {
    el.hidden = true;
    return;
  }
  const unit = t(s.metric === 'thread' ? 'unit.thread' : 'unit.penetrations');
  const warn = v > s.scales[s.metric].warn ? ' ⚠' : '';
  el.textContent = `${formatNumber(v, 2)} ${unit}${warn} · ${t('tooltip.pos')} ${formatNumber(x, 1)} / ${formatNumber(y, 1)} mm`;
  el.hidden = false;
  const flip = sx > stageW - 260;
  el.style.left = `${flip ? sx - 12 - el.offsetWidth : sx + 14}px`;
  el.style.top = `${sy + 14}px`;
}
