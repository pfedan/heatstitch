import type { Metric } from '../density/grid';
import { formatNumber, t } from '../i18n';
import type { Settings } from '../settings';

/** 'density' needs a recompute in the worker, 'render' only a redraw. */
export type ChangeKind = 'density' | 'render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function bindControls(s: Settings, onChange: (kind: ChangeKind) => void): { refresh: () => void } {
  const metricInputs = document.querySelectorAll<HTMLInputElement>('input[name="metric"]');
  const cell = $<HTMLInputElement>('cell');
  const blur = $<HTMLInputElement>('blur');
  const max = $<HTMLInputElement>('max');
  const warn = $<HTMLInputElement>('warn');
  const includeJumps = $<HTMLInputElement>('include-jumps');
  const overlay = $<HTMLInputElement>('overlay');
  const opacity = $<HTMLInputElement>('opacity');
  const showJumps = $<HTMLInputElement>('show-jumps');

  const refresh = () => {
    metricInputs.forEach((i) => (i.checked = i.value === s.metric));
    cell.value = String(s.cellMm);
    blur.value = String(s.blurMm);
    // Leave a number field alone while the user is typing in it.
    if (document.activeElement !== max) max.value = String(s.scales[s.metric].max);
    if (document.activeElement !== warn) warn.value = String(s.scales[s.metric].warn);
    includeJumps.checked = s.includeJumps;
    includeJumps.disabled = s.metric !== 'thread';
    overlay.checked = s.overlay;
    opacity.value = String(s.opacity);
    opacity.disabled = !s.overlay;
    showJumps.checked = s.showJumps;
    $('cell-out').textContent = `${formatNumber(s.cellMm, 2)} mm`;
    $('blur-out').textContent = s.blurMm > 0 ? `${formatNumber(s.blurMm, 1)} mm` : t('controls.off');
    $('opacity-out').textContent = `${Math.round(s.opacity * 100)} %`;
    $('unit-hint').textContent = t(s.metric === 'thread' ? 'unit.thread' : 'unit.penetrations');
  };

  const on = (el: HTMLElement, ev: string, fn: () => ChangeKind) =>
    el.addEventListener(ev, () => {
      const kind = fn();
      refresh();
      onChange(kind);
    });

  metricInputs.forEach((i) =>
    on(i, 'change', () => {
      s.metric = i.value as Metric;
      return 'density';
    }),
  );
  on(cell, 'input', () => ((s.cellMm = Number(cell.value)), 'density'));
  on(blur, 'input', () => ((s.blurMm = Number(blur.value)), 'density'));
  on(includeJumps, 'change', () => ((s.includeJumps = includeJumps.checked), 'density'));
  on(max, 'input', () => {
    const v = Number(max.value);
    if (v > 0) s.scales[s.metric].max = v;
    return 'render';
  });
  on(warn, 'input', () => {
    const v = Number(warn.value);
    if (v >= 0) s.scales[s.metric].warn = v;
    return 'render';
  });
  on(overlay, 'change', () => ((s.overlay = overlay.checked), 'render'));
  on(opacity, 'input', () => ((s.opacity = Number(opacity.value)), 'render'));
  on(showJumps, 'change', () => ((s.showJumps = showJumps.checked), 'render'));

  refresh();
  return { refresh };
}
