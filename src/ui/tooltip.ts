import type { DensityGrid } from '../density/grid';
import { formatNumber, t, type Key } from '../i18n';
import { sampleGrid } from '../render/heatmap';
import { sampleCell } from '../render/validationOverlay';
import type { Viewport } from '../render/viewport';
import type { Settings } from '../settings';
import { densityLimits } from '../validation/thresholds';
import { CAUTION, CRITICAL, type ValidationResult } from '../validation/validate';

const LEVEL_KEY: Record<number, Key> = { [CAUTION]: 'level.caution', [CRITICAL]: 'level.critical' };

const line = (text: string, className = '') => Object.assign(document.createElement('div'), { textContent: text, className });

/**
 * First line: displayed density and world position under the cursor. Second line: the validation
 * check value of that cell with the limits that apply to it (they depend on its satin share).
 */
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
  const lines = [line(`${formatNumber(v, 2)} ${unit} · ${t('tooltip.pos')} ${formatNumber(x, 1)} / ${formatNumber(y, 1)} mm`)];

  const i = validation ? sampleCell(validation, x, y) : null;
  let level = 0;
  if (validation && i !== null) {
    const m = validation.measurement;
    level = validation.level[i];
    if (m.density[i] > 0.05 || level) {
      const [caution, critical] = densityLimits(validation.thresholds, m.satin[i]);
      const parts = [
        t('tooltip.check', { v: formatNumber(m.density[i], 1) }),
        t('tooltip.limits', { caution: formatNumber(caution, 1), critical: formatNumber(critical, 1) }),
      ];
      if (validation.thresholds.holes && m.holes[i]) parts.push(t('tooltip.holes', { v: m.holes[i] }));
      if (m.shorts[i]) parts.push(t('tooltip.shorts', { v: m.shorts[i] }));
      const check = line(parts.join(' · '), 'check');
      if (LEVEL_KEY[level]) check.prepend(Object.assign(document.createElement('b'), { textContent: `${t(LEVEL_KEY[level])} ` }));
      lines.push(check);
    }
  }
  el.replaceChildren(...lines);
  el.dataset.level = String(level);
  el.hidden = false;
  const flip = sx > stageW - el.offsetWidth - 30;
  el.style.left = `${flip ? sx - 12 - el.offsetWidth : sx + 14}px`;
  el.style.top = `${sy + 14}px`;
}
