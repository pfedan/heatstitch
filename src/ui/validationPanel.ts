import { formatNumber, t } from '../i18n';
import { CAUTION, CRITICAL, type Zone } from '../validation/validate';
import type { LoadedFile } from './fileList';

const MAX_LISTED = 8;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

/** Zone counts, the matching warning messages and a clickable list of zones. */
export function renderValidation(root: HTMLElement, file: LoadedFile | null, onZone: (z: Zone) => void): void {
  if (!file?.pattern) {
    root.replaceChildren();
    return;
  }
  const v = file.validation;
  if (!v) {
    root.replaceChildren(el('p', 'muted', t('validation.pending')));
    return;
  }
  const critical = v.zones.filter((z) => z.level === CRITICAL).length;
  const caution = v.zones.filter((z) => z.level === CAUTION).length;

  const counts = el('div', 'val-counts');
  const tile = (n: number, cls: string, label: string) => {
    const d = el('div', `val-count ${cls}${n ? '' : ' zero'}`);
    d.append(el('strong', '', String(n)), el('span', '', label));
    return d;
  };
  counts.append(tile(critical, 'critical', t('validation.criticalZones')), tile(caution, 'caution', t('validation.cautionZones')));

  const parts: HTMLElement[] = [counts];
  if (critical) parts.push(el('p', 'val-msg critical', t('validation.criticalMsg')));
  if (caution) parts.push(el('p', 'val-msg caution', t('validation.cautionMsg')));
  if (!critical && !caution) parts.push(el('p', 'val-msg safe', t('validation.safe')));

  if (v.zones.length) {
    const list = el('ul', 'val-zones');
    for (const z of v.zones.slice(0, MAX_LISTED)) {
      const li = el('li');
      const btn = el('button', `val-zone ${z.level === CRITICAL ? 'critical' : 'caution'}`);
      btn.type = 'button';
      const reasons = z.reasons.map((r) => t(r === 'density' ? 'validation.reason.density' : 'validation.reason.shortStitches'));
      btn.append(
        el('span', 'dot'),
        el('span', 'lvl', t(z.level === CRITICAL ? 'level.critical' : 'level.caution')),
        el('span', 'meta', `${formatNumber(z.areaMm2)} mm² · max ${formatNumber(z.maxDensity, 1)} · ${reasons.join(', ')}`),
      );
      btn.addEventListener('click', () => onZone(z));
      li.append(btn);
      list.append(li);
    }
    parts.push(list);
    if (v.zones.length > MAX_LISTED) parts.push(el('p', 'muted', `+ ${v.zones.length - MAX_LISTED} ${t('validation.more')}`));
    parts.push(el('p', 'muted small', t('validation.zoneHint')));
  }
  root.replaceChildren(...parts);
}
