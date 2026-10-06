import { formatNumber, getLang, onLangChange, t, type Key } from '../i18n';
import { numberInColor, type ObjectKind, type SewObject } from '../model/objects';
import type { FileFormat, ThreadColor } from '../model/pattern';
import { sameColor } from '../model/recolor';
import type { ColorBlock } from '../model/sequence';
import { threadCode, threadNumber } from '../threads/catalog';
import { cssColor as css, hexColor as hex, ThreadPicker } from './threadPicker';
import { toast } from '../shell/ui';
import { h, icon } from '../shell/h';

export interface LayerHooks {
  /** Show or hide a color block. */
  toggle: (block: number) => void;
  /** Highlight one block (null: none); `sticky` comes from a click, otherwise from hovering. */
  focus: (block: number | null, sticky: boolean) => void;
  showAll: () => void;
  /** Give a color block another thread color (an edit that can be undone). */
  recolor: (block: number, color: ThreadColor) => void;
  /** Select objects (replacing the selection, or adding/removing with `toggle`); empty clears. */
  select: (objects: number[], toggle: boolean) => void;
  /** Object under the pointer in the list (null: none). */
  hover: (object: number | null) => void;
  /**
   * Sew the objects in this order; with `into`, the moved objects take the thread of that color
   * block (they are sewn as part of it), otherwise they keep their own.
   */
  move: (order: number[], moved: number[], into: number | null) => void;
  /** The menu of object actions for object `o`, at the page position (right click, long press). */
  menu: (o: number, x: number, y: number) => void;
  /** The menu of a color block, at the page position or under its button. */
  colorMenu: (block: number, at: { x: number; y: number } | HTMLElement) => void;
}

/** A message under the list: what happened, as a warning or not, and an action that goes with it. */
export interface Notice {
  text: string;
  warn?: boolean;
  action?: { label: string; title?: string; run: () => void };
  /** Takes the edit back; offered as "Undo" with the message. */
  undo?: () => void;
}

export interface LayerState {
  blocks: ColorBlock[];
  objects: SewObject[];
  selected: ReadonlySet<number>;
  hidden: ReadonlySet<number>;
  focus: number | null;
  /** Block the player's needle is in, marked in the list. */
  current: number | null;
  /** Colors of the blocks as loaded, offered to go back to. */
  original: readonly ThreadColor[];
  /** A design is open but has no stitches yet (started empty). */
  blank?: boolean;
  format: FileFormat;
  /** Names of objects that have one of their own (letterings). */
  names?: ReadonlyMap<number, string>;
  /** Objects whose shape and stitch type are only guessed from their stitches. */
  guessed?: ReadonlySet<number>;
}

/** Every object of the design is only guessed from its stitches. */
const allGuessed = (st: LayerState) => !!st.objects.length && st.guessed?.size === st.objects.length;

/** How long a finger rests on a row to open its menu (ms). */
export const LONG_PRESS_MS = 500;

const KIND_KEY: Record<ObjectKind, Key> = { fill: 'object.fill', satin: 'object.satin', run: 'object.run' };

/** Small pictures of the three kinds: rows, a zigzag column, a dashed line. */
export const KIND_ICON: Record<ObjectKind, string> = {
  fill: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h12" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>',
  satin:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l10 2.4L3 6.8l10 2.4L3 11.6 13 14" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  run: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12c3-1 3-7 6-8s3 5 6 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="2.6 1.8" stroke-linecap="round"/></svg>',
};

export const kindLabel = (k: ObjectKind) => t(KIND_KEY[k]);

/** A color block as the list names it: its number and thread name. */
export const blockName = (b: Pick<ColorBlock, 'index' | 'color'>) => `${b.index + 1}. ${b.color.name || t('layers.unnamed', { n: b.index + 1 })}`;

/** What is dragged in the list: one object (or the selection it belongs to), or a whole color block. */
type Drag = { objects: number[]; block: number | null };

/**
 * The color blocks in sewing order, each opening to the objects sewn in it. A color row: a click
 * opens it, the swatch picks another thread, and on hover (always on touch) buttons highlight or
 * hide it and open its menu. An object row: hover shows it on the canvas, a click selects it (Shift
 * or Ctrl adds), a right click, a long press or its button opens the object menu. Colors and
 * objects can be dragged to another place in the order, or moved by the order commands.
 */
export class LayersPanel {
  private list = document.getElementById('layer-list') as HTMLUListElement;
  private reset = document.getElementById('layers-reset') as HTMLButtonElement;
  private note = document.getElementById('layer-note') as HTMLParagraphElement;
  private key: unknown[] = [];
  private picker = new ThreadPicker('.layer .sw');
  /** Color blocks shown open, by index. */
  private open = new Set<number>();
  private st: LayerState | null = null;
  private drag: Drag | null = null;
  /** Objects to show at the next update. */
  private revealing: number[] | null = null;
  /** The last update that came during a drag. */
  private pending: [LayerState, string] | null = null;
  private noteTimer = 0;

  constructor(private hooks: LayerHooks) {
    this.reset.addEventListener('click', () => hooks.showAll());
    this.list.addEventListener('mouseleave', () => {
      hooks.focus(null, false);
      hooks.hover(null);
    });
    this.list.addEventListener('dragover', (e) => this.dragOver(e));
    this.list.addEventListener('dragleave', (e) => {
      if (!this.list.contains(e.relatedTarget as Node)) this.clearDrop();
    });
    this.list.addEventListener('drop', (e) => this.dropped(e));
    // Also outside Ablauf, where the list shows but is not updated.
    onLangChange(() => {
      if (!this.st) return;
      this.key = [];
      this.update(this.st, getLang());
    });
  }

  /**
   * Opens the color blocks of these objects and scrolls the first into view, at the next update:
   * after an edit the objects are only known by their new indices then.
   */
  reveal(objects: number[]): void {
    this.revealing = objects.length ? objects : null;
  }

  /** Builds the rows again at the next update (the thread numbers became known). */
  refresh(): void {
    this.key = [];
  }

  /** Forgets which colors were open (another file). */
  collapse(): void {
    this.open.clear();
    this.key = [];
  }

  /** While set, say() hands its notice here instead of showing it (see capture). */
  private catcher: ((n: Notice) => void) | null = null;

  /** Runs `fn` and returns what it said instead of showing it, to show it with more (an undo). */
  capture(fn: () => void): Notice | null {
    let said: Notice | null = null;
    const before = this.catcher;
    this.catcher = (n) => (said = n);
    try {
      fn();
    } finally {
      this.catcher = before;
    }
    return said;
  }

  /**
   * Says what happened. A plain message is a short note at the bottom of the stage (with "Undo"
   * when the notice brings one); a warning or a message with its own action stays under the list,
   * near what it is about, a while longer.
   */
  say(n: string | Notice, error = false): void {
    const notice: Notice = typeof n === 'string' ? { text: n, warn: error } : n;
    if (this.catcher) return this.catcher(notice);
    if (!notice.text) return;
    const a = notice.action;
    if (!a && !notice.warn) {
      const undo = notice.undo;
      toast(notice.text, undo ? { label: t('objects.undo'), run: undo } : undefined);
      return;
    }
    window.clearTimeout(this.noteTimer);
    this.note.replaceChildren(document.createTextNode(notice.text));
    if (a) {
      const btn = h('button', { type: 'button', class: 'link', title: a.title ?? '', onclick: () => {
        this.note.hidden = true;
        a.run();
      } }, a.label);
      this.note.append(' ', btn);
    }
    this.note.classList.toggle('error', !!notice.warn);
    this.note.hidden = false;
    this.noteTimer = window.setTimeout(() => (this.note.hidden = true), a ? 15000 : 9000);
  }

  update(st: LayerState, lang: string): void {
    // Rebuilding the rows while one is dragged would take the drag away; it waits for the drop.
    if (this.drag) {
      this.pending = [st, lang];
      return;
    }
    const show = this.revealing;
    this.revealing = null;
    for (const o of show ?? []) {
      const b = st.objects[o]?.block;
      if (b !== undefined && !this.open.has(b)) {
        this.open.add(b);
        this.key = [];
      }
    }
    if (show) requestAnimationFrame(() => this.list.querySelector<HTMLElement>(`[data-object="${show[0]}"]`)?.scrollIntoView({ block: 'nearest' }));
    const key = [st.blocks, st.objects, st.selected, st.hidden, st.focus, st.current, lang, st.original, st.names, st.blank, st.guessed];
    if (key.every((k, i) => k === this.key[i])) return;
    this.key = key;
    this.st = st;
    this.picker.close();
    this.reset.hidden = !st.hidden.size && st.focus === null;
    if (!st.blocks.length) {
      this.list.replaceChildren(h('li', { class: 'muted layers-empty' }, t(st.blank ? 'layers.blank' : 'layers.empty')));
      return;
    }
    // The row with the keyboard focus keeps it when the rows are built anew.
    const had = document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = had?.closest<HTMLElement>('.layer')?.dataset;
    const focusPart = had?.dataset.part;
    const rows: HTMLLIElement[] = [];
    for (const b of st.blocks) {
      const objs = st.objects.filter((o) => o.block === b.index);
      rows.push(this.colorRow(b, objs, st));
      if (this.open.has(b.index)) for (const o of objs) rows.push(this.objectRow(o, objs, st));
    }
    // A file from elsewhere: all of it is guessed, said once instead of on every row.
    if (allGuessed(st)) rows.push(h('li', { class: 'muted layers-guessed', title: t('object.guessedHint') }, t('layers.allGuessed')));
    this.list.replaceChildren(...rows);
    if (focusKey) {
      const sel = focusKey.object !== undefined ? `[data-object="${focusKey.object}"]` : `[data-block="${focusKey.block}"]`;
      const row = this.list.querySelector<HTMLElement>(sel);
      (focusPart ? row?.querySelector<HTMLElement>(`[data-part="${focusPart}"]`) : row)?.focus({ preventScroll: true });
    }
  }

  /** Opens or closes the objects of every color. */
  openAll(on: boolean): void {
    const st = this.st;
    if (!st) return;
    this.open = new Set(on ? st.blocks.map((b) => b.index) : []);
    this.key = [];
    this.update(st, getLang());
  }

  /** The color row's swatch, to open a thread picker next to (also from a command). */
  recolor(b: number): void {
    const st = this.st;
    const block = st?.blocks[b];
    const sw = this.list.querySelector<HTMLElement>(`[data-block="${b}"] .sw`);
    if (st && block && sw) this.openPicker(block, st, sw);
  }

  private toggleOpen(b: number): void {
    if (!this.open.delete(b)) this.open.add(b);
    this.key = [];
    if (this.st) this.update(this.st, getLang());
  }

  private colorRow(b: ColorBlock, objs: SewObject[], st: LayerState): HTMLLIElement {
    const hidden = st.hidden.has(b.index);
    const focused = st.focus === b.index;
    const isOpen = this.open.has(b.index);
    const stop = (fn: () => void) => (e: Event) => {
      e.stopPropagation();
      fn();
    };
    const openLabel = t(isOpen ? 'layers.close' : 'layers.open', { n: objs.length });
    const chev = h('button', { type: 'button', class: 'icon chev', 'data-part': 'chev', title: openLabel, 'aria-label': openLabel, 'aria-expanded': String(isOpen), onclick: stop(() => this.toggleOpen(b.index)) });
    const sw = h('button', { type: 'button', class: 'sw', 'data-part': 'sw', title: t('layers.recolor'), 'aria-label': t('layers.recolor'), 'aria-haspopup': 'dialog', onclick: stop(() => this.openPicker(b, st, sw)) });
    sw.style.background = css(b.color);
    // The thread number first: it is what one buys; the brand and the count of objects after it.
    const num = threadNumber(b.color);
    const code = num && b.color.brand ? `${num} · ${b.color.brand}` : threadCode(b.color);
    const count = t('objects.color.count', { n: objs.length });
    const eyeLabel = t(hidden ? 'layers.show' : 'layers.hide');
    const eye = h('button', { type: 'button', class: 'icon eye', 'data-part': 'eye', title: eyeLabel, 'aria-label': eyeLabel, 'aria-pressed': String(hidden), onclick: stop(() => this.hooks.toggle(b.index)) }, icon(hidden ? 'obj-aside' : 'obj-eye'));
    const focusLabel = t(focused ? 'objects.color.unfocus' : 'objects.color.focus');
    const spot = h('button', { type: 'button', class: 'icon spot', 'data-part': 'spot', title: focusLabel, 'aria-label': focusLabel, 'aria-pressed': String(focused), onclick: stop(() => this.hooks.focus(focused ? null : b.index, true)) }, icon('obj-focus'));
    const more = h('button', { type: 'button', class: 'icon row-more', 'data-part': 'more', title: t('objects.color.menu'), 'aria-label': t('objects.color.menu'), 'aria-haspopup': 'menu', onclick: stop(() => this.hooks.colorMenu(b.index, more)) }, icon('more'));
    const parts = [t('layers.meta', { stitches: formatNumber(b.stitches), thread: formatNumber(b.threadMm / 1000, 1) })];
    if (b.trims) parts.push(t('layers.trims', { n: b.trims }));
    const li = h(
      'li',
      {
        class: `layer color-row${hidden ? ' hidden-layer' : ''}${focused ? ' focused' : ''}${st.current === b.index ? ' current' : ''}${isOpen ? ' open' : ''}`,
        'data-block': String(b.index),
        title: parts.join(' · '),
        draggable: st.blocks.length > 1,
        onclick: () => this.toggleOpen(b.index),
        onmouseenter: () => {
          this.hooks.hover(null);
          this.hooks.focus(b.index, false);
        },
        oncontextmenu: (e: Event) => {
          e.preventDefault();
          const m = e as MouseEvent;
          this.hooks.colorMenu(b.index, { x: m.clientX, y: m.clientY });
        },
      },
      chev,
      sw,
      h(
        'span',
        { class: 'layer-text' },
        h('span', { class: 'layer-name' }, h('span', { class: 'layer-num' }, `${b.index + 1}`), b.color.name || t('layers.unnamed', { n: b.index + 1 })),
        h('span', { class: 'layer-sub' }, code ? `${code} · ${count}` : count),
      ),
      h('span', { class: 'layer-tools' }, spot, eye, more),
      h('span', { class: 'layer-meta' }, formatNumber(b.stitches)),
    );
    this.longPress(li, (x, y) => this.hooks.colorMenu(b.index, { x, y }));
    li.addEventListener('dragstart', (e) => this.dragStart(e, { objects: objs.map((o) => o.index), block: b.index }, li));
    li.addEventListener('dragend', () => this.dragEnd());
    return li;
  }

  private objectRow(o: SewObject, siblings: SewObject[], st: LayerState): HTMLLIElement {
    const selected = st.selected.has(o.index);
    const kind = h('span', { class: `kind-icon kind-${o.kind}` });
    kind.innerHTML = KIND_ICON[o.kind];
    // Made here or guessed: only marked where both are in one design. About equal: a sign, said in full by the hint.
    const guessed = st.guessed?.has(o.index) && !allGuessed(st) ? h('span', { class: 'layer-guessed', title: t('object.guessedHint'), 'aria-label': t('object.guessed') }, '≈') : null;
    const more = h(
      'button',
      {
        type: 'button',
        class: 'icon row-more',
        'data-part': 'more',
        tabindex: -1,
        title: t('objects.row.more'),
        'aria-label': t('objects.row.more'),
        'aria-haspopup': 'menu',
        onclick: (e: Event) => {
          e.stopPropagation();
          const r = more.getBoundingClientRect();
          this.hooks.menu(o.index, r.left, r.bottom + 4);
        },
      },
      icon('more'),
    );
    // After a long press the finger lifted is no click (it would leave only this object selected).
    let held = false;
    const li = h(
      'li',
      {
        class: `layer object${selected ? ' selected' : ''}${st.hidden.has(o.block) ? ' hidden-layer' : ''}`,
        'data-object': String(o.index),
        draggable: st.objects.length > 1,
        tabindex: 0,
        role: 'button',
        'aria-pressed': String(selected),
        title: t('object.rowHint'),
        onclick: (e: Event) => {
          e.stopPropagation();
          if (held) return void (held = false);
          const m = e as MouseEvent;
          this.hooks.select([o.index], m.shiftKey || m.ctrlKey || m.metaKey);
        },
        onkeydown: (e: Event) => {
          const k = e as KeyboardEvent;
          // The menu key or Shift+F10 opens the actions of the row, as a right click does.
          if (k.key === 'ContextMenu' || (k.key === 'F10' && k.shiftKey)) {
            k.preventDefault();
            const r = li.getBoundingClientRect();
            this.hooks.menu(o.index, r.left + 24, r.bottom);
            return;
          }
          if (k.key !== 'Enter' && k.key !== ' ') return;
          k.preventDefault();
          k.stopPropagation();
          this.hooks.select([o.index], k.shiftKey || k.ctrlKey || k.metaKey);
        },
        onmouseenter: () => {
          this.hooks.focus(null, false);
          this.hooks.hover(o.index);
        },
        oncontextmenu: (e: Event) => {
          e.preventDefault();
          const m = e as MouseEvent;
          this.hooks.menu(o.index, m.clientX, m.clientY);
        },
      },
      kind,
      h('span', { class: 'layer-name' }, st.names?.get(o.index) ?? `${kindLabel(o.kind)} ${numberInColor(siblings, o)}`),
      guessed,
      more,
      h('span', { class: 'layer-meta' }, formatNumber(o.stitches)),
    );
    li.addEventListener('dragstart', (e) => {
      // Dragging a selected object takes the whole selection along.
      const objs = selected ? [...st.selected].sort((a, b) => a - b) : [o.index];
      this.dragStart(e, { objects: objs, block: null }, li);
    });
    li.addEventListener('dragend', () => this.dragEnd());
    this.longPress(li, (x, y) => {
      held = true;
      this.hooks.menu(o.index, x, y);
    });
    return li;
  }

  /** A long press on a touch screen, where no context menu comes (as on iOS). */
  private longPress(li: HTMLElement, fire: (x: number, y: number) => void): void {
    let press = 0;
    let at: [number, number] = [0, 0];
    const stop = () => {
      clearTimeout(press);
      press = 0;
    };
    li.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      at = [e.clientX, e.clientY];
      stop();
      press = window.setTimeout(() => {
        press = 0;
        fire(at[0], at[1]);
      }, LONG_PRESS_MS);
    });
    li.addEventListener('pointermove', (e) => {
      if (press && Math.hypot(e.clientX - at[0], e.clientY - at[1]) > 8) stop();
    });
    li.addEventListener('pointerup', stop);
    li.addEventListener('pointercancel', stop);
  }

  private dragStart(e: DragEvent, d: Drag, li: HTMLLIElement): void {
    this.drag = d;
    e.dataTransfer?.setData('text/plain', d.objects.join(','));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
    this.list.classList.add('drag-active');
    this.hooks.hover(null);
    this.hooks.focus(null, false);
  }

  private dragEnd(): void {
    this.drag = null;
    this.list.classList.remove('drag-active');
    const pending = this.pending;
    this.pending = null;
    if (pending) this.update(...pending);
    this.list.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    this.clearDrop();
  }

  private clearDrop(): void {
    this.list.querySelectorAll<HTMLElement>('.drop-before, .drop-after').forEach((el) => {
      el.classList.remove('drop-before', 'drop-after', 'drop-own');
      delete el.dataset.drop;
      el.style.removeProperty('--drop-color');
    });
  }

  /**
   * The color block of another thread the dragged objects are dropped into on this row: a drop
   * between the objects of a color (or at its start) is in it. A drop on a color row's edge,
   * between two colors, is in none.
   */
  private intoBlock(row: HTMLElement, lowerHalf: boolean): number | null {
    const st = this.st;
    const d = this.drag;
    if (!st || !d || d.block !== null) return null;
    let b: number | null = null;
    if (row.dataset.object !== undefined) b = st.objects[Number(row.dataset.object)].block;
    else if (lowerHalf && this.open.has(Number(row.dataset.block))) b = Number(row.dataset.block);
    if (b === null) return null;
    const color = st.blocks[b]?.color;
    return color && d.objects.some((o) => !sameColor(st.objects[o].color, color)) ? b : null;
  }

  /**
   * Where a drop at this pointer position puts the dragged objects: before which object (by
   * index; objects.length for the end), the row the line is drawn at, the color block of another
   * thread it lies in (`among`), and the one whose thread they take (`into`, null: their own).
   * Among another color they take its thread, unless dropped in the front third of the list or
   * with Alt: then they are sewn there in their own.
   */
  private target(e: DragEvent): { before: number; row: HTMLElement; after: boolean; among: number | null; into: number | null } | null {
    const tg = this.place(e);
    if (!tg) return null;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.layer')!;
    const lower = e.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    const among = this.intoBlock(row, lower);
    const list = this.list.getBoundingClientRect();
    const keep = e.altKey || e.clientX < list.left + list.width / 3;
    return { ...tg, among, into: keep ? null : among };
  }

  private place(e: DragEvent): { before: number; row: HTMLElement; after: boolean } | null {
    const st = this.st;
    const d = this.drag;
    if (!st || !d) return null;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.layer');
    if (!row) return null;
    const r = row.getBoundingClientRect();
    const lower = e.clientY > r.top + r.height / 2;
    const blockObjs = (b: number) => st.objects.filter((o) => o.block === b);
    if (row.dataset.object !== undefined && d.block === null) {
      const o = Number(row.dataset.object);
      return { before: lower ? o + 1 : o, row, after: lower };
    }
    // Over a color row, or dragging a whole color: only between colors.
    const b = row.dataset.block !== undefined ? Number(row.dataset.block) : st.objects[Number(row.dataset.object)].block;
    const objs = blockObjs(b);
    if (!objs.length) return null;
    // The lower half of an open color row means the start of that color, for a single object.
    if (lower && d.block === null && this.open.has(b) && row.dataset.block !== undefined) return { before: objs[0].index, row, after: true };
    const before = lower ? objs[objs.length - 1].index + 1 : objs[0].index;
    const lastRow = lower && this.open.has(b) ? (this.list.querySelector<HTMLElement>(`[data-object="${objs[objs.length - 1].index}"]`) ?? row) : row;
    return { before, row: lastRow, after: lower };
  }

  /** The order with the dragged objects moved in front of object `before`. */
  private orderFor(before: number): number[] | null {
    const st = this.st;
    const d = this.drag;
    if (!st || !d) return null;
    const moving = new Set(d.objects);
    const rest = st.objects.map((o) => o.index).filter((i) => !moving.has(i));
    const at = rest.filter((i) => i < before).length;
    const order = [...rest.slice(0, at), ...d.objects, ...rest.slice(at)];
    return order.every((o, k) => o === k) ? null : order;
  }

  private dragOver(e: DragEvent): void {
    if (!this.drag) return;
    const tg = this.target(e);
    this.clearDrop();
    if (!tg) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    tg.row.classList.add(tg.after ? 'drop-after' : 'drop-before');
    // Says on the line which thread the dropped objects are sewn in.
    const st = this.st!;
    const own = st.objects[this.drag.objects[0]];
    const ownColors = new Set(this.drag.objects.map((o) => st.objects[o].block));
    if (tg.into !== null) {
      const b = st.blocks[tg.into];
      tg.row.dataset.drop = t('layers.dropInto', { color: blockName(b) });
      tg.row.style.setProperty('--drop-color', css(b.color));
    } else if (tg.among !== null) {
      tg.row.dataset.drop = t('layers.dropOwn', { color: ownColors.size === 1 ? blockName(st.blocks[own.block]) : t('layers.dropOwnMany') });
      tg.row.style.setProperty('--drop-color', css(own.color));
    }
    // The label sits on the side that chooses it: front third own thread, further right the new one.
    tg.row.classList.toggle('drop-own', tg.among !== null && tg.into === null);
  }

  private dropped(e: DragEvent): void {
    const tg = this.target(e);
    const d = this.drag;
    const order = tg ? this.orderFor(tg.before) : null;
    this.dragEnd();
    if (!tg || !d) return;
    e.preventDefault();
    if (!order && tg.into === null) return;
    this.hooks.move(order ?? this.st!.objects.map((o) => o.index), d.objects, tg.into);
  }

  closePicker(): void {
    this.picker.close();
  }

  /**
   * The thread colors of the Brother palette (what PES files store), the original color of the
   * block when it was changed, and a free color.
   */
  private openPicker(b: ColorBlock, st: LayerState, anchor: HTMLElement): void {
    const orig = st.original[b.index];
    this.picker.toggle(anchor, {
      key: `block-${b.index}`,
      title: t('layers.recolorTitle', { n: b.index + 1 }),
      current: b.color,
      original: orig && !sameColor(orig, b.color) ? { color: orig, label: t('layers.original', { name: orig.name ?? hex(orig) }) } : null,
      note: colorNote(st.format),
      onPick: (c: ThreadColor) => {
        if (!sameColor(c, b.color)) this.hooks.recolor(b.index, c);
      },
    });
  }
}

/** What the open file's format does with a thread color. */
function colorNote(format: FileFormat): string {
  if (format === 'pes' || format === 'pec') return t('layers.colorNote.pes');
  if (format === 'jef' || format === 'vp3') return t(`layers.colorNote.${format}`);
  return t('layers.colorNote.none', { format: format.toUpperCase() });
}
