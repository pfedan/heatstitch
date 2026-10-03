import type { DensityGrid } from '../density/grid';
import { formatNumber, t, type Key } from '../i18n';
import { sampleGrid } from '../render/heatmap';
import { sampleLevel } from '../render/validationOverlay';
import type { Viewport } from '../render/viewport';
import type { Settings } from '../settings';
import { CAUTION, CRITICAL, type ValidationResult } from '../validation/validate';

const LEVEL_KEY: Record<number, Key> = { [CAUTION]: 'level.caution', [CRITICAL]: 'level.critical' };

/** Shows the displayed density, the validation level and the world position under the cursor. */
export function updateTooltip(
  el: HTMLElement,
  sx: number,
  sy: number,
  stageW: number,
  vp: Viewport,
  grid: DensityGrid | null,
  s: Settings,
  validation: ValidationResult | null,
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
  const level = validation ? sampleLevel(validation, x, y) : null;
  const levelText = level !== null && LEVEL_KEY[level] ? ` · ${t(LEVEL_KEY[level])}` : '';
  el.textContent = `${formatNumber(v, 2)} ${unit}${levelText} · ${t('tooltip.pos')} ${formatNumber(x, 1)} / ${formatNumber(y, 1)} mm`;
  el.dataset.level = String(level ?? 0);
  el.hidden = false;
  const flip = sx > stageW - 300;
  el.style.left = `${flip ? sx - 12 - el.offsetWidth : sx + 14}px`;
  el.style.top = `${sy + 14}px`;
}
