import { formatNumber, t } from '../i18n';
import type { ThreadColor } from '../model/pattern';
import { sameColor } from '../model/recolor';
import type { ColorBlock } from '../model/sequence';
import { pecThreads } from '../parsers/pecPalette';

export interface LayerHooks {
  /** Show or hide a color block. */
  toggle: (block: number) => void;
  /** Highlight one block (null: none); `sticky` comes from a click, otherwise from hovering. */
  focus: (block: number | null, sticky: boolean) => void;
  showAll: () => void;
  /** Give a color block another thread color (an edit that can be undone). */
  recolor: (block: number, color: ThreadColor) => void;
}

export interface LayerState {
  blocks: ColorBlock[];
  hidden: ReadonlySet<number>;
  focus: number | null;
  /** Block the player's needle is in, marked in the list. */
  current: number | null;
  /** Colors of the blocks as loaded, offered to go back to. */
  original: readonly ThreadColor[];
  format: 'dst' | 'pes';
}

const css = (c: ThreadColor) => `rgb(${c.r}, ${c.g}, ${c.b})`;
const hex = (c: ThreadColor) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * The color blocks in sewing order, as layers: an eye to hide one, a click to highlight it (the
 * others fade), hovering previews the highlight.
 */
export class LayersPanel {
  private list = document.getElementById('layer-list') as HTMLUListElement;
  private reset = document.getElementById('layers-reset') as HTMLButtonElement;
  private key: unknown[] = [];
  private pop: HTMLElement | null = null;

  constructor(private hooks: LayerHooks) {
    this.reset.addEventListener('click', () => hooks.showAll());
    this.list.addEventListener('mouseleave', () => hooks.focus(null, false));
    document.addEventListener('pointerdown', (e) => {
      if (this.pop && !this.pop.contains(e.target as Node) && !(e.target as Element).closest?.('.layer .sw')) this.closePicker();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pop) {
        e.stopPropagation();
        this.closePicker();
      }
    }, true);
    window.addEventListener('resize', () => this.closePicker());
  }

  update(st: LayerState, lang: string): void {
    const key = [st.blocks, st.hidden, st.focus, st.current, lang, st.original];
    if (key.every((k, i) => k === this.key[i])) return;
    this.key = key;
    this.closePicker();
    this.reset.hidden = !st.hidden.size && st.focus === null;
    if (!st.blocks.length) {
      this.list.replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: t('layers.empty') }));
      return;
    }
    this.list.replaceChildren(...st.blocks.map((b) => this.item(b, st)));
  }

  private item(b: ColorBlock, st: LayerState): HTMLLIElement {
    const hidden = st.hidden.has(b.index);
    const li = document.createElement('li');
    li.className = 'layer';
    li.classList.toggle('hidden-layer', hidden);
    li.classList.toggle('focused', st.focus === b.index);
    li.classList.toggle('current', st.current === b.index);

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'icon eye';
    eye.textContent = hidden ? '◌' : '◉';
    eye.title = t(hidden ? 'layers.show' : 'layers.hide');
    eye.setAttribute('aria-pressed', String(!hidden));
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hooks.toggle(b.index);
    });

    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'sw';
    sw.style.background = css(b.color);
    sw.title = t('layers.recolor');
    sw.setAttribute('aria-label', t('layers.recolor'));
    sw.setAttribute('aria-haspopup', 'dialog');
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.pop?.dataset.block === String(b.index)) this.closePicker();
      else this.openPicker(b, st, sw);
    });

    const text = document.createElement('span');
    text.className = 'layer-text';
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = `${b.index + 1}. ${b.color.name || t('layers.unnamed', { n: b.index + 1 })}`;
    const parts = [t('layers.meta', { stitches: formatNumber(b.stitches), thread: formatNumber(b.threadMm / 1000, 1) })];
    if (b.trims) parts.push(t('layers.trims', { n: b.trims }));
    const meta = document.createElement('span');
    meta.className = 'layer-meta';
    meta.textContent = formatNumber(b.stitches);
    text.append(name);
    li.title = `${parts.join(' · ')}\n${t('layers.focus')}`;

    li.append(eye, sw, text, meta);
    li.addEventListener('click', () => this.hooks.focus(st.focus === b.index ? null : b.index, true));
    li.addEventListener('mouseenter', () => this.hooks.focus(b.index, false));
    return li;
  }

  closePicker(): void {
    this.pop?.remove();
    this.pop = null;
  }

  /**
   * The thread colors of the Brother palette (what PES files store), the original color of the
   * block when it was changed, and a free color.
   */
  private openPicker(b: ColorBlock, st: LayerState, anchor: HTMLElement): void {
    this.closePicker();
    const pop = document.createElement('div');
    pop.className = 'color-pop';
    pop.dataset.block = String(b.index);
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', t('layers.recolorTitle', { n: b.index + 1 }));
    const pick = (c: ThreadColor) => {
      this.closePicker();
      if (!sameColor(c, b.color)) this.hooks.recolor(b.index, c);
    };
    const swatch = (c: ThreadColor, current: boolean) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pick';
      btn.style.background = css(c);
      btn.title = c.name ?? hex(c);
      btn.setAttribute('aria-label', btn.title);
      if (current) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => pick(c));
      return btn;
    };

    const head = document.createElement('div');
    head.className = 'color-pop-head';
    head.textContent = t('layers.recolorTitle', { n: b.index + 1 });
    pop.append(head);

    const orig = st.original[b.index];
    if (orig && !sameColor(orig, b.color)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'color-pop-orig';
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = css(orig);
      row.append(sw, t('layers.original', { name: orig.name ?? hex(orig) }));
      row.addEventListener('click', () => pick(orig));
      pop.append(row);
    }

    const grid = document.createElement('div');
    grid.className = 'color-grid';
    const threads = pecThreads();
    let marked = false;
    for (const c of threads) {
      const cur: boolean = !marked && c.r === b.color.r && c.g === b.color.g && c.b === b.color.b;
      marked ||= cur;
      grid.append(swatch(c, cur));
    }
    pop.append(grid);

    const own = document.createElement('label');
    own.className = 'color-pop-own';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = hex(b.color);
    input.addEventListener('change', () => {
      const v = input.value;
      pick({ r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16) });
    });
    own.append(input, t('layers.ownColor'));
    pop.append(own);

    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = t(st.format === 'pes' ? 'layers.colorNote.pes' : 'layers.colorNote.dst');
    pop.append(note);

    document.body.append(pop);
    this.pop = pop;
    // Next to the swatch, kept on screen.
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const below = r.bottom + 6;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    (pop.querySelector<HTMLElement>('[aria-current]') ?? pop.querySelector<HTMLElement>('.pick'))?.focus();
  }
}
