import { formatNumber, t } from '../i18n';
import type { ColorBlock } from '../model/sequence';

export interface LayerHooks {
  /** Show or hide a color block. */
  toggle: (block: number) => void;
  /** Highlight one block (null: none); `sticky` comes from a click, otherwise from hovering. */
  focus: (block: number | null, sticky: boolean) => void;
  showAll: () => void;
}

export interface LayerState {
  blocks: ColorBlock[];
  hidden: ReadonlySet<number>;
  focus: number | null;
  /** Block the player's needle is in, marked in the list. */
  current: number | null;
}

/**
 * The color blocks in sewing order, as layers: an eye to hide one, a click to highlight it (the
 * others fade), hovering previews the highlight.
 */
export class LayersPanel {
  private list = document.getElementById('layer-list') as HTMLUListElement;
  private reset = document.getElementById('layers-reset') as HTMLButtonElement;
  private key: unknown[] = [];

  constructor(private hooks: LayerHooks) {
    this.reset.addEventListener('click', () => hooks.showAll());
    this.list.addEventListener('mouseleave', () => hooks.focus(null, false));
  }

  update(st: LayerState, lang: string): void {
    const key = [st.blocks, st.hidden, st.focus, st.current, lang];
    if (key.every((k, i) => k === this.key[i])) return;
    this.key = key;
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

    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = `rgb(${b.color.r}, ${b.color.g}, ${b.color.b})`;

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
}
