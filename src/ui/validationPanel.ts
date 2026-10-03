import { formatNumber, getLang, t, type Key } from '../i18n';
import { openWorst, settledBy } from '../validation/acks';
import { densityExcess } from '../validation/practice';
import { fabricOf } from '../validation/profiles';
import { CAUTION, CRITICAL, type Level, type Reason, type ValidationResult, type Zone } from '../validation/validate';
import type { LoadedFile } from './fileList';

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

/** The key figure per reason, e.g. "max 9.8 mm/mm²", and how far the density lies over its limit. */
function figures(z: Zone, v: ValidationResult): string[] {
  return z.reasons.map((r) => {
    if (r === 'density') {
      const fig = t('validation.fig.density', { v: formatNumber(z.maxDensity, 1) });
      // Critical zones only: how close a call it is.
      const pct = Math.round(densityExcess(z, v.thresholds) * 100);
      return z.level === CRITICAL && pct >= 0 ? `${fig} (${t('validation.fig.excess', { v: `+${pct}` })})` : fig;
    }
    if (r === 'shortStitches') return t('validation.fig.shortStitches', { v: z.maxShorts });
    return t('validation.fig.perforation', { v: z.maxHoles });
  });
}

/** Checks that apply to the material: perforation only on perforation-sensitive fabrics. */
const applicableChecks = (v: ValidationResult): Reason[] =>
  (Object.keys(REASON_KEY) as Reason[]).filter((r) => r !== 'perforation' || fabricOf(v.profile).perforation);

/** Share of the stitched area in zones that still count. */
function share(v: ValidationResult, counted: boolean[]): string {
  if (!v.stitchedCells) return '';
  let flagged = 0;
  for (let i = 0; i < v.zoneOf.length; i++) if (v.zoneOf[i] >= 0 && counted[v.zoneOf[i]]) flagged++;
  const pct = (flagged / v.stitchedCells) * 100;
  return t('validation.share', { pct: pct > 0 && pct < 1 ? '< 1' : formatNumber(pct) });
}

/** Which zones the list shows: all, the open ones of one level, or those that do not count. */
export type ZoneFilter = 'all' | typeof CAUTION | typeof CRITICAL | 'settled';

/** What the user decided about a zone from the list. */
export type ZoneDecision = 'ack' | 'unack' | 'reopen' | 'keep';

export interface PanelHooks {
  /** A zone was clicked. */
  onZone: (z: Zone) => void;
  /** The pointer or focus entered (zone) or left (null) a zone entry. */
  onHover: (z: Zone | null) => void;
  /** Previous (-1) or next (1) zone within the current filter. */
  onStep: (dir: 1 | -1) => void;
  /** Acknowledge a zone or undo that, or count a zone that is normal in practice after all or undo that. */
  onDecide: (z: Zone, d: ZoneDecision) => void;
}

/**
 * Verdict, level filter, zone stepper and a scrolling zone list, plus the compact chip on the
 * canvas that stands in for the panel while it is hidden. Rebuilds only when its inputs change.
 */
export class ValidationPanel {
  private filter: ZoneFilter = 'all';
  private file: LoadedFile | null = null;
  private selected: Zone | null = null;
  private last: unknown[] = [];

  constructor(
    private root: HTMLElement,
    private chip: HTMLElement,
    private hooks: PanelHooks,
  ) {}

  /** The zones the list shows, in list order; stepping with n / Shift+n walks these. */
  visible(zones: Zone[]): Zone[] {
    const acks = this.file?.acks;
    const settled = (z: Zone) => !!settledBy(z, acks);
    // Open zones first; those that do not count follow, dimmed.
    if (this.filter === 'all') return [...zones.filter((z) => !settled(z)), ...zones.filter(settled)];
    if (this.filter === 'settled') return zones.filter(settled);
    return zones.filter((z) => z.level === this.filter && !settled(z));
  }

  update(file: LoadedFile | null, selected: Zone | null): void {
    // A new file starts unfiltered, so its zones are never hidden by a choice made for another.
    if (file !== this.file) this.filter = 'all';
    this.file = file;
    this.selected = selected;
    const key = [file, file?.pattern, file?.validation, file?.acks, getLang(), this.filter, selected];
    if (key.length === this.last.length && key.every((k, i) => k === this.last[i])) return;
    this.last = key;
    // Keep the list where the user scrolled it; the selected entry is scrolled into view below.
    const scroll = this.root.querySelector('.val-zones')?.scrollTop ?? 0;
    this.root.replaceChildren(...this.build(file, selected));
    this.renderChip(file);
    const list = this.root.querySelector('.val-zones');
    if (list) list.scrollTop = scroll;
    this.root.querySelector('.val-zone.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private renderChip(file: LoadedFile | null): void {
    const v = file?.pattern ? file.validation : null;
    if (!v) {
      this.chip.replaceChildren(t('findings.title'));
      return;
    }
    const open = v.zones.filter((z) => !settledBy(z, file!.acks));
    const critical = open.filter((z) => z.level === CRITICAL).length;
    const caution = open.length - critical;
    const worst = openWorst(v.zones, file!.acks) as Level;
    this.chip.replaceChildren(
      el('span', `dot ${LEVEL_CLASS[worst]}`),
      el('strong', '', t(VERDICT_KEY[worst])),
      ...(open.length ? [el('span', '', t('validation.counts', { critical, caution }))] : []),
    );
  }

  private build(file: LoadedFile | null, selected: Zone | null): HTMLElement[] {
    if (!file?.pattern) return [el('p', 'muted', t('validation.noFile'))];
    const v = file.validation;
    if (!v) return [el('p', 'muted pending', t('validation.pending'))];

    const applicable = applicableChecks(v);
    const off = applicable.filter((r) => !v.checks[r]);
    if (off.length === applicable.length) return [el('p', 'muted', t('validation.noChecks'))];

    // Findings that are normal in practice or acknowledged do not count towards the verdict.
    const worst = openWorst(v.zones, file.acks) as Level;
    const by = v.zones.map((z) => settledBy(z, file.acks));
    const practice = by.filter((b) => b === 'practice').length;
    const acked = by.filter((b) => b === 'manual').length;
    const verdict = el('div', `verdict ${LEVEL_CLASS[worst]}`);
    const head = el('div', 'verdict-head');
    head.append(el('strong', '', t(VERDICT_KEY[worst])));
    if (worst) head.append(el('span', '', share(v, by.map((b) => !b))));
    verdict.append(head, el('p', '', t(worst === 0 && v.zones.length ? 'validation.msg.safeSettled' : MSG_KEY[worst])));
    if (practice || acked) {
      const list = [
        ...(practice ? [t('validation.practiceN', { n: practice })] : []),
        ...(acked ? [t('validation.ackedN', { n: acked })] : []),
      ].join(', ');
      verdict.append(el('p', 'counts', t('validation.notCounted', { list })));
    }
    if (off.length) {
      const list = off.map((r) => t(REASON_KEY[r])).join(', ');
      verdict.append(el('p', 'counts', t('validation.checksOff', { list })));
    }
    const parts: HTMLElement[] = [verdict];
    if (!v.zones.length) return parts;

    parts.push(this.toolbar(v.zones, file, selected));
    const shown = this.visible(v.zones);
    if (!shown.length) {
      parts.push(el('p', 'muted small', t('findings.empty')));
      return parts;
    }
    const list = el('ol', 'val-zones');
    for (const z of shown) {
      const settled = settledBy(z, file.acks);
      const reopened = !settled && !!z.practice;
      const btn = el('button', `val-zone ${LEVEL_CLASS[z.level]}${settled ? ' acked' : ''}${z === selected ? ' selected' : ''}`);
      btn.type = 'button';
      const top = el('span', 'z-top');
      top.append(
        el('span', 'dot'),
        el('span', 'lvl', t(z.level === CRITICAL ? 'level.critical' : 'level.caution')),
        el('span', 'why', z.reasons.map((r) => t(REASON_KEY[r])).join(', ')),
        el('span', 'num', `#${v.zones.indexOf(z) + 1}`),
      );
      const meta = [`${formatNumber(z.areaMm2)} mm²`, ...figures(z, v)];
      btn.append(top, el('span', 'meta', meta.join(' · ')));
      if (z.practice || settled) {
        const note = settled === 'manual' ? t('findings.manual') : t(`findings.practice.${z.practice!}` as Key);
        btn.append(el('span', 'meta note', reopened ? `${note} · ${t('findings.reopened')}` : note));
      }
      btn.addEventListener('click', () => this.hooks.onZone(z));
      btn.addEventListener('pointerenter', () => this.hooks.onHover(z));
      btn.addEventListener('pointerleave', () => this.hooks.onHover(null));
      btn.addEventListener('focus', () => this.hooks.onHover(z));
      btn.addEventListener('blur', () => this.hooks.onHover(null));
      // Manual acknowledgement wins; a zone that is normal in practice can be reopened instead.
      const [d, label, hint]: [ZoneDecision, Key, Key] =
        settled === 'manual'
          ? ['unack', 'findings.unack', 'findings.unack']
          : settled === 'practice'
            ? ['reopen', 'findings.reopen', 'findings.reopen.hint']
            : reopened
              ? ['keep', 'findings.keep', 'findings.keep']
              : ['ack', 'findings.ack', 'findings.ack.hint'];
      const toggle = el('button', 'z-ack', t(label));
      toggle.type = 'button';
      toggle.title = t(hint);
      toggle.addEventListener('click', () => this.hooks.onDecide(z, d));
      const li = el('li');
      li.append(btn, toggle);
      list.append(li);
    }
    parts.push(list, el('p', 'muted small', t('validation.zoneHint')));
    return parts;
  }

  /** Level filter chips with counts, and the previous / position / next stepper. */
  private toolbar(zones: Zone[], file: LoadedFile, selected: Zone | null): HTMLElement {
    const bar = el('div', 'findings-bar');
    const chips = el('div', 'f-chips');
    chips.setAttribute('role', 'radiogroup');
    const open = zones.filter((z) => !settledBy(z, file.acks));
    const settled = zones.length - open.length;
    const options: [ZoneFilter, string, number][] = [
      ['all', t('findings.all'), zones.length],
      [CRITICAL, t('level.critical'), open.filter((z) => z.level === CRITICAL).length],
      [CAUTION, t('level.caution'), open.filter((z) => z.level === CAUTION).length],
    ];
    if (settled || this.filter === 'settled') options.push(['settled', t('findings.settled'), settled]);
    for (const [f, label, n] of options) {
      const b = el('button', `f-chip${f === 'all' ? '' : f === 'settled' ? ' acked' : ` ${LEVEL_CLASS[f]}`}`);
      b.type = 'button';
      b.dataset.level = String(f);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(f === this.filter));
      b.disabled = !n && f !== this.filter;
      if (f !== 'all' && f !== 'settled') b.append(el('span', 'dot'));
      b.append(label, el('span', 'n', String(n)));
      b.addEventListener('click', () => {
        this.filter = f;
        this.update(this.file, this.selected);
      });
      chips.append(b);
    }

    const shown = this.visible(zones);
    const i = selected ? shown.indexOf(selected) : -1;
    const nav = el('div', 'f-nav');
    const prev = el('button', 'icon', '‹');
    const next = el('button', 'icon', '›');
    prev.type = next.type = 'button';
    prev.title = t('findings.prev');
    next.title = t('findings.next');
    prev.setAttribute('aria-label', prev.title);
    next.setAttribute('aria-label', next.title);
    prev.disabled = next.disabled = !shown.length;
    prev.addEventListener('click', () => this.hooks.onStep(-1));
    next.addEventListener('click', () => this.hooks.onStep(1));
    const pos = el('span', 'pos', i < 0 ? t('findings.count', { n: shown.length }) : t('findings.pos', { i: i + 1, n: shown.length }));
    nav.append(prev, pos, next);

    bar.append(chips, nav);
    return bar;
  }
}
