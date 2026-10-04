import { formatNumber, t, type Key } from '../i18n';
import type { ObjectKind } from '../model/objects';
import type { FillPattern, FillSettings, RunSettings, SatinSettings, Settings } from '../model/restitch';
import { KIND_ICON, kindLabel } from './layersPanel';

/**
 * Stitch settings of the selected objects: per kind of stitch the values that matter for it. The
 * values start as measured on the first selected object; moving a slider shows the result on the
 * canvas at once, letting go applies it (one undo step).
 */

export interface StitchInfo {
  /** Changes when the user selects something else, so the values are measured again. */
  key: number;
  /** Kinds among the selected objects, and what the first object of each kind has now. */
  measured: Partial<{ fill: FillSettings; satin: SatinSettings; run: RunSettings }>;
  /** Recommended fill spacing for the material (mm). */
  recommended: [number, number];
  /** How many selected objects have stitches of each kind. */
  counts: Partial<Record<ObjectKind, number>>;
}

export interface StitchHooks {
  preview: (s: Settings | null) => void;
  apply: (s: Settings) => void;
}

const KINDS: ObjectKind[] = ['fill', 'satin', 'run'];

const PATTERNS: FillPattern[] = ['tatami', 'gradient', 'contour', 'spiral', 'follow'];

/** Small pictures of the fill patterns (24 × 24, drawn with the current color). */
const PATTERN_ICON: Record<FillPattern, string> = {
  tatami: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h7m3 0h8M3 9.5h4m3 0h11M3 14h9m3 0h6M3 18.5h2m3 0h13"/></svg>',
  gradient: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3.5h18M3 6h18M3 9h18M3 13h18M3 18.5h18"/></svg>',
  contour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M11 11h2v2h-2z"/></svg>',
  spiral: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 12c0-1 1.5-1.2 2-.2.8 1.6-1 3.2-2.6 3-2.6-.3-3.4-3.6-1.8-5.6 2.2-2.8 6.6-1.8 7.6 1.4 1.3 4-2.2 7.6-6 7.2-4.4-.4-7-5-5.6-9C7 5 11.6 3 15.6 4.2"/></svg>',
  follow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 6c5-3 9 3 18 0M3 11c5-3 9 3 18 0M3 16c5-3 9 3 18 0M3 21c5-3 9 3 18 0"/></svg>',
};

/** Longest stitch for contour and spiral rows (mm). */
const CURVED_STITCH = 2.5;

const OFFSETS: [number, string][] = [
  [0.5, '1/2'],
  [1 / 3, '1/3'],
  [0.25, '1/4'],
  [0.2, '1/5'],
];

interface SliderDef {
  label: Key;
  hint?: Key;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  fmt: (v: number) => string;
  /** Range to mark on the track (recommended). */
  band?: [number, number];
  /** Extra line under the value. */
  note?: (v: number) => string;
}

export class StitchPanel {
  private key = -1;
  private kind: ObjectKind = 'fill';
  private draft: Partial<{ fill: FillSettings; satin: SatinSettings; run: RunSettings }> = {};
  private info: StitchInfo | null = null;
  private frame = 0;

  constructor(
    private root: HTMLElement,
    private hooks: StitchHooks,
  ) {}

  update(info: StitchInfo | null): void {
    this.info = info;
    if (!info || !Object.keys(info.measured).length) {
      this.root.replaceChildren();
      this.key = -1;
      return;
    }
    if (info.key === this.key) return;
    this.key = info.key;
    this.draft = structuredClone(info.measured);
    if (!info.measured[this.kind]) this.kind = KINDS.find((k) => info.measured[k])!;
    this.render();
  }

  private settings(): Settings {
    if (this.kind === 'fill') return { kind: 'fill', s: { ...this.draft.fill! } };
    if (this.kind === 'satin') return { kind: 'satin', s: { ...this.draft.satin! } };
    return { kind: 'run', s: { ...this.draft.run! } };
  }

  private changed(final: boolean): void {
    if (final) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.hooks.apply(this.settings());
      return;
    }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.hooks.preview(this.settings());
    });
  }

  private render(): void {
    const info = this.info!;
    const head = document.createElement('div');
    head.className = 'stitch-head';
    const h = Object.assign(document.createElement('h3'), { textContent: t('stitch.title') });
    head.append(h);
    const present = KINDS.filter((k) => info.measured[k]);
    const parts: HTMLElement[] = [head];
    if (present.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'segmented stitch-tabs';
      tabs.setAttribute('role', 'tablist');
      for (const k of present) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(k === this.kind));
        b.className = k === this.kind ? 'active' : '';
        b.innerHTML = `<span class="kind-icon">${KIND_ICON[k]}</span>`;
        b.append(kindLabel(k));
        b.addEventListener('click', () => {
          this.kind = k;
          this.hooks.preview(null);
          this.render();
        });
        tabs.append(b);
      }
      parts.push(tabs);
    } else {
      h.innerHTML = '';
      h.append(Object.assign(document.createElement('span'), { className: 'kind-icon', innerHTML: KIND_ICON[this.kind] }), t('stitch.titleOf', { kind: kindLabel(this.kind) }));
    }
    const n = info.counts[this.kind] ?? 0;
    if (n > 1) parts.push(Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('stitch.many', { n }) }));
    parts.push(...this.controls());
    const note = Object.assign(document.createElement('p'), { className: 'muted small stitch-note', textContent: t('stitch.note') });
    parts.push(note);
    this.root.replaceChildren(...parts);
  }

  private controls(): HTMLElement[] {
    const mm = (d: number) => (v: number) => `${formatNumber(v, d)} mm`;
    const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 2)} mm`;
    if (this.kind === 'fill') {
      const s = this.draft.fill!;
      const density = (label: Key, get: () => number, set: (v: number) => void) =>
        this.slider({
          label,
          hint: 'stitch.density.hint',
          min: 0.2,
          max: 1.2,
          step: 0.01,
          get,
          set,
          fmt: mm(2),
          band: this.info!.recommended,
          note: (v) => t('stitch.densityNote', { d: formatNumber(1 / v, 1) }),
        });
      const out: HTMLElement[] = [this.patterns(s)];
      if (s.pattern === 'gradient') {
        out.push(
          density('stitch.densityFrom', () => s.spacing, (v) => (s.spacing = v)),
          density('stitch.densityTo', () => s.spacingEnd, (v) => (s.spacingEnd = v)),
        );
      } else out.push(density('stitch.density', () => s.spacing, (v) => (s.spacing = v)));
      if (s.pattern === 'tatami' || s.pattern === 'gradient') out.push(this.angle(s));
      out.push(this.slider({ label: 'stitch.length', hint: 'stitch.length.hint', min: 1.5, max: 7, step: 0.1, get: () => s.stitch, set: (v) => (s.stitch = v), fmt: mm(1) }));
      if (s.pattern === 'tatami') out.push(this.offsets(s));
      out.push(
        this.slider({ label: 'stitch.edge', hint: 'stitch.edge.hint', min: -0.4, max: 0.6, step: 0.05, get: () => s.edge, set: (v) => (s.edge = v), fmt: signed }),
        this.check('stitch.underlay', 'stitch.underlay.fill', () => s.underlay, (v) => (s.underlay = v)),
      );
      return out;
    }
    if (this.kind === 'satin') {
      const s = this.draft.satin!;
      return [
        this.slider({ label: 'stitch.density', hint: 'stitch.satinDensity.hint', min: 0.2, max: 1, step: 0.01, get: () => s.spacing, set: (v) => (s.spacing = v), fmt: mm(2), band: this.info!.recommended }),
        this.slider({ label: 'stitch.width', hint: 'stitch.width.hint', min: -0.4, max: 0.6, step: 0.05, get: () => s.edge, set: (v) => (s.edge = v), fmt: signed }),
        this.check('stitch.short', 'stitch.short.hint', () => s.short, (v) => (s.short = v)),
        this.check('stitch.underlay', 'stitch.underlay.satin', () => s.underlay, (v) => (s.underlay = v)),
      ];
    }
    const s = this.draft.run!;
    return [
      this.slider({ label: 'stitch.length', hint: 'stitch.runLength.hint', min: 1, max: 6, step: 0.1, get: () => s.stitch, set: (v) => (s.stitch = v), fmt: mm(1) }),
      this.check('stitch.triple', 'stitch.triple.hint', () => s.triple, (v) => (s.triple = v)),
    ];
  }

  private slider(d: SliderDef): HTMLElement {
    const label = document.createElement('label');
    label.className = 'field stitch-field';
    if (d.hint) label.title = t(d.hint);
    const top = document.createElement('span');
    top.className = 'label';
    const out = document.createElement('output');
    top.append(t(d.label), ' ', out);
    const input = Object.assign(document.createElement('input'), { type: 'range', min: String(d.min), max: String(d.max), step: String(d.step), value: String(d.get()) });
    let track: HTMLElement = input;
    if (d.band) {
      // A green strip under the track marks the recommended range.
      const a = Math.max(0, ((d.band[0] - d.min) / (d.max - d.min)) * 100);
      const b = Math.min(100, ((d.band[1] - d.min) / (d.max - d.min)) * 100);
      track = Object.assign(document.createElement('span'), { className: 'band-track', title: t('stitch.band', { a: formatNumber(d.band[0], 2), b: formatNumber(d.band[1], 2) }) });
      const band = Object.assign(document.createElement('span'), { className: 'band' });
      band.style.left = `${a}%`;
      band.style.width = `${Math.max(0, b - a)}%`;
      track.append(input, band);
    }
    const note = document.createElement('span');
    note.className = 'muted small';
    const show = () => {
      out.textContent = d.fmt(d.get());
      if (d.note) note.textContent = d.note(d.get());
    };
    show();
    input.addEventListener('input', () => {
      d.set(parseFloat(input.value));
      show();
      this.changed(false);
    });
    input.addEventListener('change', () => this.changed(true));
    label.append(top, track);
    if (d.note) label.append(note);
    return label;
  }

  /** The fill patterns as small pictures; picking one applies it. */
  private patterns(s: FillSettings): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.pattern') });
    const row = document.createElement('div');
    row.className = 'pattern-tiles';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('stitch.pattern'));
    for (const pat of PATTERNS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pattern-tile' + (pat === s.pattern ? ' active' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(pat === s.pattern));
      b.title = t(`stitch.pattern.${pat}.hint` as Key);
      b.innerHTML = PATTERN_ICON[pat];
      b.append(Object.assign(document.createElement('span'), { textContent: t(`stitch.pattern.${pat}` as Key) }));
      b.addEventListener('click', () => {
        if (s.pattern === pat) return;
        s.pattern = pat;
        // Rings and spirals bend all the way: shorter stitches follow the curve without cutting it.
        if (pat === 'contour' || pat === 'spiral') s.stitch = Math.min(s.stitch, CURVED_STITCH);
        this.render();
        this.changed(true);
      });
      row.append(b);
    }
    const hint = Object.assign(document.createElement('span'), { className: 'muted small', textContent: t(`stitch.pattern.${s.pattern}.hint` as Key) });
    wrap.append(label, row, hint);
    return wrap;
  }

  /** Tatami offset: how far the needle points shift from row to row. */
  private offsets(s: FillSettings): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field';
    wrap.title = t('stitch.offset.hint');
    const label = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.offset') });
    const row = document.createElement('div');
    row.className = 'segmented offset-buttons';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('stitch.offset'));
    const options: [number, string][] = [...OFFSETS, [0, t('stitch.offset.random')]];
    for (const [v, text] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      const on = Math.abs(s.offset - v) < 1e-3;
      b.className = on ? 'active' : '';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.textContent = text;
      b.addEventListener('click', () => {
        if (Math.abs(s.offset - v) < 1e-3) return;
        s.offset = v;
        this.render();
        this.changed(true);
      });
      row.append(b);
    }
    wrap.append(label, row);
    return wrap;
  }

  /** Angle: a dial that shows the row direction, and a slider. */
  private angle(s: FillSettings): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'field stitch-field';
    wrap.title = t('stitch.angle.hint');
    const top = document.createElement('span');
    top.className = 'label';
    const out = document.createElement('output');
    top.append(t('stitch.angle'), ' ', out);
    const row = document.createElement('span');
    row.className = 'angle-row';
    const dial = document.createElement('span');
    dial.className = 'angle-dial';
    dial.setAttribute('aria-hidden', 'true');
    const needle = document.createElement('span');
    dial.append(needle);
    const input = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '175', step: '5', value: String(Math.round(s.angle / 5) * 5 % 180) });
    const show = () => {
      out.textContent = `${Math.round(s.angle)}°`;
      // Screen y points down, so the rows' angle turns clockwise.
      needle.style.transform = `rotate(${s.angle}deg)`;
    };
    show();
    input.addEventListener('input', () => {
      s.angle = parseFloat(input.value);
      show();
      this.changed(false);
    });
    input.addEventListener('change', () => this.changed(true));
    row.append(dial, input);
    wrap.append(top, row);
    return wrap;
  }

  private check(label: Key, hint: Key, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const l = Object.assign(document.createElement('label'), { className: 'check', title: t(hint) });
    const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: get() });
    i.addEventListener('change', () => {
      set(i.checked);
      this.changed(true);
    });
    l.append(i, Object.assign(document.createElement('span'), { textContent: t(label) }));
    return l;
  }
}
