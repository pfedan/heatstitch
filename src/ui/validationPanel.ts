import { formatNumber, getLang, t, type Key } from '../i18n';
import { fabricOf } from '../validation/profiles';
import { CAUTION, CRITICAL, type Level, type Reason, type ValidationResult, type Zone } from '../validation/validate';
import type { LoadedFile } from './fileList';

const COLLAPSED = 6;

const LEVEL_CLASS = ['safe', 'caution', 'critical'] as const;
const VERDICT_KEY: Record<Level, Key> = {
  0: 'validation.verdict.safe',
  1: 'validation.verdict.caution',
  2: 'validation.verdict.critical',
};
const MSG_KEY: Record<Level, Key> = { 0: 'validation.msg.safe', 1: 'validation.msg.caution', 2: 'validation.msg.critical' };
const REASON_KEY: Record<Reason, Key> = {
  density: 'validation.reason.density',
  shortStitches: 'validation.reason.shortStitches',
  perforation: 'validation.reason.perforation',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

/** The key figure per reason, e.g. "max 9.8 mm/mm²". */
function figures(z: Zone): string[] {
  return z.reasons.map((r) => {
    if (r === 'density') return t('validation.fig.density', { v: formatNumber(z.maxDensity, 1) });
    if (r === 'shortStitches') return t('validation.fig.shortStitches', { v: z.maxShorts });
    return t('validation.fig.perforation', { v: z.maxHoles });
  });
}

/** Checks that apply to the material: perforation only on perforation-sensitive fabrics. */
const applicableChecks = (v: ValidationResult): Reason[] =>
  (Object.keys(REASON_KEY) as Reason[]).filter((r) => r !== 'perforation' || fabricOf(v.profile).perforation);

function share(v: ValidationResult): string {
  if (!v.stitchedCells) return '';
  const pct = ((v.cautionCells + v.criticalCells) / v.stitchedCells) * 100;
  return t('validation.share', { pct: pct > 0 && pct < 1 ? '< 1' : formatNumber(pct) });
}

export interface PanelHooks {
  /** A zone was clicked. */
  onZone: (z: Zone) => void;
  /** The pointer or focus entered (zone) or left (null) a zone entry. */
  onHover: (z: Zone | null) => void;
}

/** Verdict, zone counts and a clickable zone list. Rebuilds only when its inputs change. */
export class ValidationPanel {
  private expanded = false;
  private last: unknown[] = [];

  constructor(
    private root: HTMLElement,
    private hooks: PanelHooks,
  ) {}

  update(file: LoadedFile | null, selected: Zone | null): void {
    const key = [file, file?.pattern, file?.validation, getLang(), this.expanded, selected];
    if (key.length === this.last.length && key.every((k, i) => k === this.last[i])) return;
    this.last = key;
    this.root.replaceChildren(...this.build(file, selected));
  }

  private build(file: LoadedFile | null, selected: Zone | null): HTMLElement[] {
    if (!file?.pattern) return [el('p', 'muted', t('validation.noFile'))];
    const v = file.validation;
    if (!v) return [el('p', 'muted pending', t('validation.pending'))];

    const applicable = applicableChecks(v);
    const off = applicable.filter((r) => !v.checks[r]);
    if (off.length === applicable.length) return [el('p', 'muted', t('validation.noChecks'))];

    const critical = v.zones.filter((z) => z.level === CRITICAL).length;
    const caution = v.zones.filter((z) => z.level === CAUTION).length;
    const verdict = el('div', `verdict ${LEVEL_CLASS[v.worst]}`);
    const head = el('div', 'verdict-head');
    head.append(el('strong', '', t(VERDICT_KEY[v.worst])));
    if (v.worst) head.append(el('span', '', share(v)));
    verdict.append(head, el('p', '', t(MSG_KEY[v.worst])));
    if (v.zones.length) verdict.append(el('p', 'counts', t('validation.counts', { critical, caution })));
    if (off.length) {
      const list = off.map((r) => t(REASON_KEY[r])).join(', ');
      verdict.append(el('p', 'counts', t('validation.checksOff', { list })));
    }
    const parts: HTMLElement[] = [verdict];
    if (!v.zones.length) return parts;

    const list = el('ul', 'val-zones');
    const shown = this.expanded ? v.zones : v.zones.slice(0, COLLAPSED);
    for (const z of shown) {
      const btn = el('button', `val-zone ${LEVEL_CLASS[z.level]}${z === selected ? ' selected' : ''}`);
      btn.type = 'button';
      const top = el('span', 'z-top');
      top.append(
        el('span', 'dot'),
        el('span', 'lvl', t(z.level === CRITICAL ? 'level.critical' : 'level.caution')),
        el('span', 'why', z.reasons.map((r) => t(REASON_KEY[r])).join(', ')),
      );
      btn.append(top, el('span', 'meta', [`${formatNumber(z.areaMm2)} mm²`, ...figures(z)].join(' · ')));
      btn.addEventListener('click', () => this.hooks.onZone(z));
      btn.addEventListener('pointerenter', () => this.hooks.onHover(z));
      btn.addEventListener('pointerleave', () => this.hooks.onHover(null));
      btn.addEventListener('focus', () => this.hooks.onHover(z));
      btn.addEventListener('blur', () => this.hooks.onHover(null));
      const li = el('li');
      li.append(btn);
      list.append(li);
    }
    parts.push(list);
    if (v.zones.length > COLLAPSED) {
      const more = el(
        'button',
        'link',
        this.expanded ? t('validation.less') : t('validation.more', { n: v.zones.length - COLLAPSED }),
      );
      more.type = 'button';
      more.addEventListener('click', () => {
        this.expanded = !this.expanded;
        this.update(file, selected);
      });
      parts.push(more);
    }
    parts.push(el('p', 'muted small', t('validation.zoneHint')));
    return parts;
  }
}
