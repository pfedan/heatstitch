import { formatNumber, getLang, onLangChange, t, type Key } from '../i18n';
import type { Catalog, Font, FontEntry, FontStyle } from '../lettering/font';
import { loadFont } from '../lettering/font';
import { missingIn, type Align, type Lettering, type LetteringShape } from '../lettering/layout';
import { drawSample } from '../lettering/preview';
import type { ThreadColor } from '../model/pattern';
import { cssColor, ThreadPicker } from './threadPicker';
import { section } from '../shell/ui';

export interface LetteringInfo {
  lettering: Lettering;
  font: Font | null;
  catalog: Catalog | null;
  /** Size of the letters (mm). */
  width: number;
  height: number;
  stitches: number;
  /** Moving single letters. */
  letters: boolean;
  /** The letter chosen in that mode (place in the text), or null. */
  letter: number | null;
}

export interface LetteringHooks {
  /** The lettering changed: `final` ends one step of undo (a slider let go, the text field left). */
  change: (next: Lettering, final: boolean) => void;
  close: () => void;
  /** Start or stop moving single letters. */
  letters: (on: boolean) => void;
  /** The letters become ordinary objects (the text is gone). */
  release: () => void;
  /** The hoop of the design, for a note when the lettering alone does not fit. */
  hoop: () => Hoop | null;
}

import type { Hoop } from '../model/hoop';
import { hoopShort } from './hoopPanel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const STYLES: FontStyle[] = ['sans', 'serif', 'script', 'display'];
const SHAPES: LetteringShape[] = ['line', 'arcUp', 'arcDown', 'circle'];
const ALIGNS: Align[] = ['left', 'center', 'right', 'block'];

const ALIGN_ICON: Record<Align, string> = {
  left: '<path d="M2 3.5h12M2 6.5h8M2 9.5h12M2 12.5h7"/>',
  center: '<path d="M2 3.5h12M4 6.5h8M2 9.5h12M4.5 12.5h7"/>',
  right: '<path d="M2 3.5h12M6 6.5h8M2 9.5h12M7 12.5h7"/>',
  block: '<path d="M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h12"/>',
};
const SHAPE_ICON: Record<LetteringShape, string> = {
  line: '<path d="M2 10.5h12"/><path d="M4 10V5.5M8 10V5.5M12 10V5.5" opacity=".55"/>',
  arcUp: '<path d="M2 12.5Q8 1.5 14 12.5"/>',
  arcDown: '<path d="M2 3.5Q8 14.5 14 3.5"/>',
  circle: '<circle cx="8" cy="8" r="5.5"/>',
};
const icon = (paths: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${paths}</svg>`;

/**
 * When the card is built anew: for another lettering, font, language or mode, or when the
 * radius field comes or goes with the shape; else only the values change.
 */
export function panelKey(info: LetteringInfo, fontsOpen: boolean, lang: string): string {
  const l = info.lettering;
  return [l.id, l.font, !!info.font, !!info.catalog, info.letters, info.letter, l.shape !== 'line', fontsOpen, lang].join('|');
}

/**
 * The card of a lettering: its text, font, height, alignment, shape and thread, with more
 * settings folded away. Its fields stay while the lettering is edited (the text field keeps the
 * focus while typing); only the values change.
 */
export class LetteringPanel {
  private panel = $<HTMLElement>('lettering-panel');
  private body = $<HTMLElement>('lettering-body');
  private info: LetteringInfo | null = null;
  private built = '';
  private picker = new ThreadPicker('.lettering-color');
  private fontsOpen = false;
  private refresh: (() => void)[] = [];
  private observer: IntersectionObserver | null = null;
  private samples = new Map<string, HTMLCanvasElement>();
  private textArea: HTMLTextAreaElement | null = null;
  private lang = '';
  /** What is typed in the font search; kept while the card is built anew (trying fonts). */
  private fontQuery = '';
  private search: HTMLInputElement | null = null;

  constructor(private hooks: LetteringHooks) {
    $('lettering-close').addEventListener('click', () => hooks.close());
    onLangChange(() => {
      this.built = '';
      this.update(this.info, getLang());
    });
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  update(info: LetteringInfo | null, lang: string): void {
    this.info = info;
    this.lang = lang;
    this.panel.hidden = !info;
    if (!info) {
      this.built = '';
      this.fontsOpen = false;
      return;
    }
    const key = panelKey(info, this.fontsOpen, lang);
    if (key !== this.built) {
      this.built = key;
      // Trying fonts with up and down builds the card anew: the list keeps the focus, or hands
      // it back to the font button once it closes.
      const inList = !!document.activeElement?.closest('.font-list');
      this.render();
      if (inList && this.fontsOpen) this.focusActiveFont();
      else if (inList) this.body.querySelector<HTMLElement>('.font-current')?.focus();
    } else for (const r of this.refresh) r();
  }

  private focusActiveFont(): void {
    const active = this.body.querySelector<HTMLElement>('.font-row.active');
    active?.scrollIntoView({ block: 'nearest' });
    active?.focus({ preventScroll: true });
  }

  /** Puts the cursor into the text (with all of it selected, for a new lettering). */
  focusText(selectAll: boolean, tries = 3): void {
    const ta = this.textArea;
    if (!ta) return;
    ta.focus();
    // The inspector may show the object page only a moment later: then once more.
    if (document.activeElement !== ta) {
      if (tries > 0) requestAnimationFrame(() => this.focusText(selectAll, tries - 1));
      return;
    }
    if (selectAll) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  /** Opens the font list with its search field focused. */
  openFonts(): void {
    if (!this.info) return;
    this.fontsOpen = true;
    this.built = '';
    this.update(this.info, this.lang);
    this.search?.focus();
  }

  /** The letters become ordinary objects (as the link at the end of the card). */
  release(): void {
    if (this.info) this.hooks.release();
  }

  private get l(): Lettering {
    return this.info!.lettering;
  }

  private set(change: Partial<Lettering>, final: boolean): void {
    this.hooks.change({ ...this.l, ...change }, final);
  }

  /**
   * Text first, then font, size, arc and spacing (what shapes a lettering); the rest in folding
   * groups: layout, thread and stitches, single letters.
   */
  private render(): void {
    const info = this.info!;
    this.refresh = [];
    this.observer?.disconnect();
    this.samples.clear();
    this.search = null;
    const parts: HTMLElement[] = [this.textField(), this.fontField()];
    if (this.fontsOpen && info.catalog) parts.push(this.fontList(info.catalog));
    parts.push(this.heightField(), this.shapeField());
    if (this.l.shape !== 'line') parts.push(this.radiusField());
    parts.push(this.spacingField());
    const mm = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 1)} mm`;
    parts.push(
      section('lettering.layout', 'shapes.lettering.layout', [
        this.alignField(),
        this.slider('lettering.wordSpacing', null, -4, 15, 0.1, () => this.l.wordSpacing, (v) => this.set({ wordSpacing: v }, false), mm),
        this.slider('lettering.lineSpacing', null, 0.5, 2.5, 0.05, () => this.l.lineSpacing, (v) => this.set({ lineSpacing: v }, false), (v) => `${formatNumber(v * 100, 0)} %`),
        this.slider('lettering.angle', null, -180, 180, 1, () => this.l.angle, (v) => this.set({ angle: v }, false), (v) => `${formatNumber(v, 0)}°`),
      ], { open: false }),
      section('lettering.stitch', 'shapes.lettering.stitch', this.stitchFields(), { open: true }),
    );
    const single = section('lettering.single', 'shapes.lettering.single', [this.lettersField()], { open: false });
    // Moving single letters shows its group, whatever was folded before.
    if (info.letters) single.open = true;
    parts.push(single);
    const release = Object.assign(document.createElement('button'), { type: 'button', className: 'link lettering-release', textContent: t('lettering.release'), title: t('lettering.release.hint') });
    release.addEventListener('click', () => this.hooks.release());
    parts.push(release);
    this.body.replaceChildren(...parts);
  }

  private field(label: Key, ...content: (HTMLElement | string)[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field';
    wrap.append(Object.assign(document.createElement('span'), { className: 'label', textContent: t(label) }), ...content);
    return wrap;
  }

  private textField(): HTMLElement {
    const ta = document.createElement('textarea');
    ta.className = 'lettering-text';
    ta.rows = Math.min(4, Math.max(1, this.l.text.split('\n').length));
    ta.value = this.l.text;
    ta.spellcheck = false;
    ta.setAttribute('aria-label', t('lettering.text'));
    ta.placeholder = t('lettering.text.placeholder');
    ta.addEventListener('input', () => {
      ta.rows = Math.min(4, Math.max(1, ta.value.split('\n').length));
      this.set({ text: ta.value }, false);
    });
    ta.addEventListener('change', () => this.set({ text: ta.value }, true));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ta.blur();
    });
    this.textArea = ta;
    const missing = document.createElement('div');
    missing.className = 'lettering-missing';
    missing.setAttribute('role', 'status');
    const show = () => {
      if (document.activeElement !== ta && ta.value !== this.l.text) ta.value = this.l.text;
      missing.replaceChildren();
      const font = this.info!.font;
      if (!font) return;
      const miss = missingIn(font, this.l.text);
      missing.hidden = !miss.length;
      if (!miss.length) return;
      missing.append(Object.assign(document.createElement('span'), { textContent: t('lettering.missing', { chars: miss.join(' ') }) }));
      // ß is often missing: written as ss it can still be sewn.
      if (miss.includes('ß') && !missingIn(font, 'ss').length) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: t('lettering.missing.ss') });
        b.addEventListener('click', () => this.set({ text: this.l.text.replace(/ß/g, 'ss') }, true));
        missing.append(' ', b);
      }
      const others = this.fontsWith(this.l.text).slice(0, 3);
      if (others.length) {
        missing.append(' ', t('lettering.missing.fonts'), ' ');
        others.forEach((e, k) => {
          const b = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: e.name });
          b.addEventListener('click', () => this.set({ font: e.id }, true));
          missing.append(...(k ? [', ', b] : [b]));
        });
      }
    };
    show();
    this.refresh.push(show);
    const wrap = this.field('lettering.text', ta, missing);
    return wrap;
  }

  /** Fonts that have every letter of `text`, those of the same style first. */
  private fontsWith(text: string): FontEntry[] {
    const cat = this.info!.catalog;
    if (!cat) return [];
    const chars = [...new Set(text.replace(/\s/g, ''))];
    const own = cat.fonts.find((f) => f.id === this.l.font);
    return cat.fonts
      .filter((f) => f.id !== this.l.font && chars.every((c) => f.chars.includes(c) || (f.cases === 'A' && f.chars.includes(c.toUpperCase())) || (f.cases === 'a' && f.chars.includes(c.toLowerCase()))))
      .sort((a, b) => Number(b.style === own?.style) - Number(a.style === own?.style));
  }

  private fontField(): HTMLElement {
    const entry = this.info!.catalog?.fonts.find((f) => f.id === this.l.font);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'font-current' + (this.fontsOpen ? ' open' : '');
    b.setAttribute('aria-expanded', String(this.fontsOpen));
    b.title = t('lettering.font.hint');
    const name = Object.assign(document.createElement('span'), { className: 'font-name', textContent: entry?.name ?? this.l.font });
    const arrow = Object.assign(document.createElement('span'), { className: 'font-arrow', textContent: this.fontsOpen ? '▴' : '▾', ariaHidden: 'true' });
    // The chosen font as a sample of the text, so the button shows what it is.
    const font = this.info!.font;
    const sample = Object.assign(document.createElement('canvas'), { className: 'font-sample font-current-sample' });
    sample.setAttribute('aria-hidden', 'true');
    if (font) requestAnimationFrame(() => drawSample(sample, font, this.l.text.trim() || t('lettering.text.placeholder'), getComputedStyle(document.body).color || '#222'));
    b.append(name, sample, arrow);
    b.addEventListener('click', () => {
      this.fontsOpen = !this.fontsOpen;
      this.built = '';
      this.update(this.info, this.lang);
      // The search takes the focus: type to narrow the list, down to the fonts.
      if (this.fontsOpen) this.search?.focus();
    });
    const parts: (HTMLElement | string)[] = [b];
    if (entry) {
      const lic = Object.assign(document.createElement('p'), { className: 'muted small font-license' });
      const link = Object.assign(document.createElement('a'), { href: `${import.meta.env.BASE_URL}fonts/licenses/${entry.id}.txt`, target: '_blank', rel: 'noopener', textContent: licenseName(entry.license) });
      lic.append(t('lettering.font.from'), ' ', link);
      parts.push(lic);
    }
    return this.field('lettering.font', ...parts);
  }

  /**
   * Every font with the text in it, by style, under a search field; rows draw themselves once they
   * scroll into view.
   */
  private fontList(cat: Catalog): HTMLElement {
    const box = document.createElement('div');
    box.className = 'font-picker';
    const search = Object.assign(document.createElement('input'), { type: 'search', className: 'font-search', value: this.fontQuery, placeholder: t('shapes.font.search'), spellcheck: false, autocomplete: 'off' });
    search.setAttribute('aria-label', t('shapes.font.search'));
    this.search = search;
    const none = Object.assign(document.createElement('p'), { className: 'muted small font-none', textContent: t('shapes.font.none'), hidden: true });
    const list = document.createElement('div');
    list.className = 'font-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', t('lettering.font'));
    const text = this.l.text.trim() || t('lettering.text.placeholder');
    const color = getComputedStyle(document.body).color || '#222';
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const c = e.target as HTMLCanvasElement;
          this.observer?.unobserve(c);
          void loadFont(c.dataset.font!).then((f) => drawSample(c, f, text, color)).catch(() => undefined);
        }
      },
      { root: list, rootMargin: '80px' },
    );
    const rows: HTMLButtonElement[] = [];
    for (const style of STYLES) {
      const fonts = cat.fonts.filter((f) => f.style === style);
      if (!fonts.length) continue;
      list.append(Object.assign(document.createElement('div'), { className: 'font-group', textContent: t(`lettering.style.${style}` as Key) }));
      for (const f of fonts) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'font-row' + (f.id === this.l.font ? ' active' : '');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(f.id === this.l.font));
        row.dataset.font = f.id;
        const canvas = Object.assign(document.createElement('canvas'), { className: 'font-sample' });
        canvas.dataset.font = f.id;
        canvas.setAttribute('aria-hidden', 'true');
        this.samples.set(f.id, canvas);
        this.observer.observe(canvas);
        const meta = document.createElement('span');
        meta.className = 'font-meta';
        meta.append(Object.assign(document.createElement('span'), { className: 'font-row-name', textContent: f.name }));
        const tags: string[] = [];
        const lacking = [...new Set(this.l.text.replace(/\s/g, ''))].filter((c) => !(f.chars.includes(c) || (f.cases === 'A' && f.chars.includes(c.toUpperCase())) || (f.cases === 'a' && f.chars.includes(c.toLowerCase()))));
        if (lacking.length) tags.push(t('lettering.tag.lacks', { chars: lacking.slice(0, 3).join(' ') }));
        if (f.cases === 'A') tags.push(t('lettering.tag.caps'));
        if (this.l.height < f.good[0] * 0.95) tags.push(t('lettering.tag.from', { mm: formatNumber(f.good[0], 0) }));
        else if (this.l.height > f.good[1] * 1.05) tags.push(t('lettering.tag.upto', { mm: formatNumber(f.good[1], 0) }));
        if (tags.length) meta.append(Object.assign(document.createElement('span'), { className: 'font-tags', textContent: tags.join(' · ') }));
        row.classList.toggle('lacking', lacking.length > 0);
        row.append(canvas, meta);
        row.addEventListener('click', () => {
          this.fontsOpen = false;
          this.set({ font: f.id }, true);
        });
        rows.push(row);
        list.append(row);
      }
    }
    const groups = [...list.querySelectorAll<HTMLElement>('.font-group')];
    const fold = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const visible = () => rows.filter((r) => !r.hidden);
    const filter = () => {
      const words = fold(search.value).split(/\s+/).filter(Boolean);
      for (const r of rows) {
        const f = cat.fonts.find((x) => x.id === r.dataset.font)!;
        const hay = fold(`${f.name} ${f.id} ${t(`lettering.style.${f.style}` as Key)}`);
        r.hidden = !words.every((w) => hay.includes(w));
      }
      // A style heading shows while one of its fonts does.
      for (const g of groups) {
        let n = g.nextElementSibling as HTMLElement | null;
        let any = false;
        while (n && !n.classList.contains('font-group')) {
          any ||= !n.hidden;
          n = n.nextElementSibling as HTMLElement | null;
        }
        g.hidden = !any;
      }
      none.hidden = visible().length > 0;
    };
    filter();
    const close = () => {
      this.fontsOpen = false;
      this.set({}, true);
    };
    search.addEventListener('input', () => {
      this.fontQuery = search.value;
      filter();
    });
    search.addEventListener('keydown', (e) => {
      const first = visible()[0];
      if (e.key === 'ArrowDown' && first) {
        e.preventDefault();
        e.stopPropagation();
        first.focus();
      } else if (e.key === 'Enter' && first) {
        e.preventDefault();
        this.fontsOpen = false;
        this.set({ font: first.dataset.font! }, true);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    });
    // Up and down try the fonts one after the other on the design; Enter keeps one.
    list.addEventListener('keydown', (e) => {
      const shown = visible();
      const i = shown.findIndex((r) => r === document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        // Not on to the page keys, where up and down step to the next design.
        e.stopPropagation();
        if (e.key === 'ArrowUp' && i <= 0) return search.focus();
        const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (!next) return;
        next.focus();
        rows.forEach((r) => r.classList.toggle('active', r === next));
        this.hooks.change({ ...this.l, font: next.dataset.font! }, false);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    });
    box.append(search, list, none);
    return box;
  }

  private heightField(): HTMLElement {
    const entry = this.info!.catalog?.fonts.find((f) => f.id === this.l.font);
    const num = Object.assign(document.createElement('input'), { type: 'number', min: '2', max: '300', step: '0.5', className: 'lettering-height' });
    num.setAttribute('aria-label', t('lettering.height'));
    const range = Object.assign(document.createElement('input'), { type: 'range', min: '3', max: '120', step: '0.5' });
    range.setAttribute('aria-label', t('lettering.height'));
    let track: HTMLElement = range;
    if (entry) {
      // The heights the font looks good at, as a strip under the track.
      const a = Math.max(0, ((entry.good[0] - 3) / 117) * 100);
      const b = Math.min(100, ((entry.good[1] - 3) / 117) * 100);
      track = Object.assign(document.createElement('span'), { className: 'band-track' });
      const band = Object.assign(document.createElement('span'), { className: 'band' });
      band.style.left = `${a}%`;
      band.style.width = `${Math.max(0, b - a)}%`;
      track.append(range, band);
    }
    const note = Object.assign(document.createElement('span'), { className: 'muted small lettering-height-note' });
    const show = () => {
      if (document.activeElement !== num) num.value = String(Math.round(this.l.height * 10) / 10);
      range.value = String(this.l.height);
      note.replaceChildren();
      if (!entry) return;
      const [lo, hi] = entry.good;
      const outside = this.l.height < lo * 0.95 ? 'small' : this.l.height > hi * 1.05 ? 'large' : null;
      note.classList.toggle('warn', !!outside);
      note.append(t(outside === 'small' ? 'lettering.height.small' : outside === 'large' ? 'lettering.height.large' : 'lettering.height.good', { a: formatNumber(lo, 0), b: formatNumber(hi, 0) }));
      if (outside) {
        // Fonts made for this height, with the same letters.
        const fit = this.fontsWith(this.l.text).filter((f) => this.l.height >= f.good[0] * 0.95 && this.l.height <= f.good[1] * 1.05).slice(0, 2);
        if (fit.length) {
          note.append(' ', t('lettering.height.try'), ' ');
          fit.forEach((f, k) => {
            const b = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: f.name });
            b.addEventListener('click', () => this.set({ font: f.id }, true));
            note.append(...(k ? [', ', b] : [b]));
          });
        }
      }
    };
    show();
    this.refresh.push(show);
    num.addEventListener('input', () => {
      const v = parseFloat(num.value.replace(',', '.'));
      if (v >= 2 && v <= 300) this.set({ height: v }, false);
    });
    num.addEventListener('change', () => this.set({}, true));
    range.addEventListener('input', () => this.set({ height: parseFloat(range.value) }, false));
    range.addEventListener('change', () => this.set({}, true));
    const row = document.createElement('div');
    row.className = 'lettering-height-row';
    row.append(num, Object.assign(document.createElement('span'), { textContent: 'mm', className: 'muted' }), track);
    const f = this.field('shapes.lettering.size', row, note, this.sizeLine());
    f.title = t('lettering.height.hint');
    num.title = t('lettering.height');
    return f;
  }

  private sizeLine(): HTMLElement {
    const p = Object.assign(document.createElement('p'), { className: 'muted small lettering-size' });
    const show = () => {
      const i = this.info!;
      const over = hoopShort(i.width, i.height, this.hooks.hoop());
      p.textContent = t('lettering.size', { w: formatNumber(i.width, 1), h: formatNumber(i.height, 1), n: formatNumber(i.stitches) }) + (over ? ` · ${over}` : '');
      p.classList.toggle('hoop-over', !!over);
    };
    show();
    this.refresh.push(show);
    return p;
  }

  private segmented<T extends string>(label: Key, values: readonly T[], get: () => T, name: (v: T) => Key, svg: Record<T, string>, set: (v: T) => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'segmented choice-row icons';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t(label));
    const buttons = values.map((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.title = t(name(v));
      b.setAttribute('aria-label', t(name(v)));
      b.innerHTML = icon(svg[v]);
      b.addEventListener('click', () => {
        if (v !== get()) set(v);
      });
      row.append(b);
      return b;
    });
    const show = () =>
      buttons.forEach((b, k) => {
        const on = values[k] === get();
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
      });
    show();
    this.refresh.push(show);
    return this.field(label, row);
  }

  private alignField(): HTMLElement {
    return this.segmented('lettering.align', ALIGNS, () => this.l.align, (v) => `lettering.align.${v}` as Key, ALIGN_ICON, (v) => this.set({ align: v }, true));
  }

  private shapeField(): HTMLElement {
    return this.segmented('shapes.lettering.arc', SHAPES, () => this.l.shape, (v) => `lettering.shape.${v}` as Key, SHAPE_ICON, (v) => {
      // A first arc as wide as the text is, so it bends noticeably but stays readable.
      const radius = this.l.shape === 'line' ? Math.max(15, Math.round(this.info!.width * 0.8)) : this.l.radius;
      this.set({ shape: v, radius }, true);
    });
  }

  private slider(label: Key, hint: Key | null, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'field stitch-field';
    if (hint) wrap.title = t(hint);
    const top = Object.assign(document.createElement('span'), { className: 'label' });
    const out = document.createElement('output');
    top.append(t(label), ' ', out);
    const input = Object.assign(document.createElement('input'), { type: 'range', min: String(min), max: String(max), step: String(step) });
    const show = () => {
      if (document.activeElement !== input) input.value = String(get());
      out.textContent = fmt(get());
    };
    show();
    this.refresh.push(show);
    input.addEventListener('input', () => set(parseFloat(input.value)));
    input.addEventListener('change', () => this.set({}, true));
    wrap.append(top, input);
    return wrap;
  }

  private radiusField(): HTMLElement {
    return this.slider('lettering.radius', 'lettering.radius.hint', 8, 200, 1, () => this.l.radius, (v) => this.set({ radius: v }, false), (v) => `${formatNumber(v, 0)} mm`);
  }

  private colorField(): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lettering-color swatch-button';
    const sw = Object.assign(document.createElement('span'), { className: 'swatch' });
    const name = document.createElement('span');
    const show = () => {
      sw.style.background = cssColor(this.l.color);
      name.textContent = this.l.color.name ?? t('lettering.color.own');
    };
    show();
    this.refresh.push(show);
    b.append(sw, name);
    b.addEventListener('click', () =>
      this.picker.toggle(b, {
        key: 'lettering',
        title: t('lettering.color'),
        current: this.l.color,
        onPick: (c: ThreadColor) => this.set({ color: c }, true),
      }),
    );
    return this.field('lettering.color', b);
  }

  private lettersField(): HTMLElement {
    const info = this.info!;
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field lettering-letters' + (info.letters ? ' on' : '');
    const b = Object.assign(document.createElement('button'), { type: 'button', className: info.letters ? 'primary small' : 'small', textContent: t(info.letters ? 'lettering.letters.done' : 'lettering.letters'), title: t('lettering.letters.hint') });
    b.setAttribute('aria-pressed', String(info.letters));
    b.addEventListener('click', () => this.hooks.letters(!info.letters));
    wrap.append(b);
    if (info.letters) {
      wrap.append(Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('lettering.letters.how') }));
      const at = info.letter;
      if (at !== null) {
        const o = this.l.letters.find((x) => x.at === at);
        wrap.append(
          this.slider('lettering.letter.turn', null, -90, 90, 1, () => this.l.letters.find((x) => x.at === at)?.rot ?? 0, (v) => this.setLetter(at, { rot: v }), (v) => `${formatNumber(v, 0)}°`),
        );
        if (o) {
          const r = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: t('lettering.letter.reset') });
          r.addEventListener('click', () => this.set({ letters: this.l.letters.filter((x) => x.at !== at) }, true));
          wrap.append(r);
        }
      }
    }
    if (this.l.letters.length) {
      const r = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: t('lettering.letters.reset', { n: this.l.letters.length }) });
      r.addEventListener('click', () => this.set({ letters: [] }, true));
      wrap.append(r);
    }
    return wrap;
  }

  private setLetter(at: number, change: { rot?: number }): void {
    const ch = [...this.l.text][at] ?? '';
    const old = this.l.letters.find((x) => x.at === at) ?? { at, ch, dx: 0, dy: 0, rot: 0 };
    const next = { ...old, ...change };
    this.set({ letters: [...this.l.letters.filter((x) => x.at !== at), next] }, false);
  }

  private spacingField(): HTMLElement {
    const mm = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 1)} mm`;
    return this.slider('lettering.spacing', 'lettering.spacing.hint', -3, 6, 0.1, () => this.l.spacing, (v) => this.set({ spacing: v }, false), mm);
  }

  /** Thread, density, underlay and the way back of the lines. */
  private stitchFields(): HTMLElement[] {
    const out: HTMLElement[] = [
      this.colorField(),
      this.slider(
        'lettering.density',
        'lettering.density.hint',
        70,
        140,
        5,
        () => Math.round(100 / this.l.density),
        (v) => this.set({ density: 100 / v }, false),
        (v) => `${formatNumber(v, 0)} %`,
      ),
      this.check('lettering.underlay', 'lettering.underlay.hint', () => this.l.underlay, (v) => this.set({ underlay: v }, true)),
    ];
    const font = this.info!.font;
    const back = this.check('lettering.back', 'lettering.back.hint', () => this.l.back, (v) => this.set({ back: v }, true));
    if (font && !font.rev) {
      back.classList.add('disabled');
      back.querySelector('input')!.disabled = true;
      back.title = t('lettering.back.not');
    }
    out.push(back);
    return out;
  }

  private check(label: Key, hint: Key, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const l = Object.assign(document.createElement('label'), { className: 'check', title: t(hint) });
    const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: get() });
    i.addEventListener('change', () => set(i.checked));
    this.refresh.push(() => (i.checked = get()));
    l.append(i, Object.assign(document.createElement('span'), { textContent: t(label) }));
    return l;
  }
}

function licenseName(id: string): string {
  return id === 'OFL-1.1' ? 'SIL Open Font License 1.1' : id === 'CC-BY-4.0' ? 'CC BY 4.0' : t('lettering.publicDomain');
}
