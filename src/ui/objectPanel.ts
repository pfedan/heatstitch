import { formatNumber, getLang, onLangChange, t, type Key } from '../i18n';
import type { SewObject } from '../model/objects';
import type { OrderCost } from '../model/order';
import type { Settings } from '../settings';
import { KIND_ICON, kindLabel } from './layersPanel';
import { cssColor, ThreadPicker } from './threadPicker';
import { sameColor } from '../model/recolor';
import type { ThreadColor } from '../model/pattern';
import { canRun, commandTitle, getCommand, runCommand } from '../shell/commands';
import { h, icon } from '../shell/h';
import { objectMenu, showOrderMenu } from './objectMenu';

/** Nodes from which an outline offers to be simplified. */
const SIMPLIFY_FROM = 12;

export interface ObjectInfo {
  objects: SewObject[];
  selected: number[];
  /** Per selected object: how many objects it lies on, and how many lie on it. */
  layering: { below: number; above: number }[];
  /** Number of each selected object within its color block (1-based). */
  numbers: number[];
  /** Per selected object: points changed by hand since it was last given new stitches. */
  hand: number[];
  /** Its points are being edited (one object), and how many of them are selected. */
  editing: { selection: number } | null;
  /** The one selected object has a fill whose outline can be edited. */
  shapeable: boolean;
  /** Its outline is being edited: nodes, and whether the selected one is round (null: none selected). */
  shaping: { nodes: number; smooth: boolean | null; line?: { closed: boolean }; kind?: 'band' | 'rails' } | null;
  /** The frame is on the one selected object; whether it can be scaled. */
  frame: { canScale: boolean } | null;
  /** Why the selected objects cannot be sewn as one (several selected), or null. */
  mergeBlocked: Key | null;
  /** Some of the selected objects can be sewn from the other side (satins and fills). */
  reversible: boolean;
  /** Several fills are selected: the one on top can be cut out of the others. */
  subtractable: boolean;
  /** The one selected object is a fill that can blend into a second thread: its thread. */
  blend?: ThreadColor;
}

export interface ObjectHooks {
  clear: () => void;
  /** Start or stop editing the points of the selected object. */
  editStitches: (on: boolean) => void;
  /** Stop editing the outline of the selected object. */
  closeShape: () => void;
  deleteNode: () => void;
  /** The selected node round or a corner. */
  toggleNode: () => void;
  /** The outline with fewer nodes. */
  simplify: () => void;
  /** A line on the level Shape: closed, or opened again. */
  closeLine: () => void;
  deleteSelection: () => void;
  /** Split the stitch to the selected point in two. */
  splitStitch: () => void;
  /** The selected objects scaled by sx, sy about their middle. */
  resize: (sx: number, sy: number) => void;
  /** The selected objects moved by dx, dy (mm). */
  move: (dx: number, dy: number) => void;
  /** The selected objects sewn in another thread. */
  thread: (c: ThreadColor) => void;
  /** The one selected fill fades out, and a copy in `c` fades in on the same area: a color blend. */
  blend: (c: ThreadColor) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Size and middle in mm of the stitches of these objects. */
function box(objs: SewObject[]): { w: number; h: number; cx: number; cy: number } {
  const minX = Math.min(...objs.map((o) => o.minX));
  const maxX = Math.max(...objs.map((o) => o.maxX));
  const minY = Math.min(...objs.map((o) => o.minY));
  const maxY = Math.max(...objs.map((o) => o.maxY));
  return { w: (maxX - minX) / 10, h: (maxY - minY) / 10, cx: (minX + maxX) / 20, cy: (minY + maxY) / 20 };
}

/** A button that runs a command: its icon, its label and key as the hint, disabled by its rule. */
function commandButton(id: string, opts: { text?: boolean; cls?: string } = {}): HTMLButtonElement | null {
  const c = getCommand(id);
  if (!c) return null;
  const b = h(
    'button',
    {
      type: 'button',
      class: `${opts.text ? 'obj-text-btn' : 'icon obj-icon-btn'} ${opts.cls ?? ''}`.trim(),
      title: commandTitle(c),
      'aria-label': t(c.label),
      'data-command': id,
      disabled: !canRun(c),
      onclick: () => runCommand(id),
    },
    opts.text ? h('span', null, t(c.label)) : c.icon ? icon(c.icon) : null,
  );
  return b;
}

/**
 * The top of the object page: what is selected (name, kind, thread), its size and place, where it
 * is sewn, and a row of buttons for the object commands; below come the stitch settings
 * (#object-stitches). Editing the outline or the points shows their tools instead of the buttons.
 * Explanations are hints on the elements, not paragraphs.
 */
export class ObjectPanel {
  private panel = $<HTMLElement>('object-panel');
  private body = $<HTMLElement>('object-body');
  private msg = $<HTMLElement>('object-msg');
  private key: unknown[] = [];
  /** Typed sizes keep the proportions. */
  private keepRatio = true;
  private picker = new ThreadPicker('.thread-sw');
  private info: ObjectInfo | null = null;

  constructor(private hooks: ObjectHooks) {
    onLangChange(() => {
      this.key = [];
      this.update(this.info, getLang());
    });
  }

  /** What the panel shows now (null: nothing selected, or a lettering). */
  get current(): ObjectInfo | null {
    return this.info;
  }

  /** Draws the buttons again at the next update (what the commands allow may have changed). */
  refresh(): void {
    this.key = [];
  }

  update(info: ObjectInfo | null, lang: string): void {
    this.info = info;
    const key = [info?.objects, info?.selected.join(), info?.hand.join(), info?.editing?.selection ?? -1, info?.shapeable, info?.shaping?.nodes ?? -1, info?.shaping?.smooth, info?.shaping?.line?.closed, info?.shaping?.kind, info?.frame?.canScale, !!info?.frame, info?.blend, info?.mergeBlocked, info?.reversible, lang];
    if (key.every((k, i) => k === this.key[i])) return;
    this.key = key;
    this.msg.hidden = true;
    if (!info || !info.selected.length) {
      this.panel.hidden = true;
      this.picker.close();
      return;
    }
    this.panel.hidden = false;
    const sel = info.selected.map((i) => info.objects[i]);
    const parts: (HTMLElement | null)[] = [this.head(info, sel), this.facts(info, sel), this.geometry(info, sel)];
    if (info.editing) parts.push(this.stitchTools(info.editing));
    else if (info.shaping) parts.push(this.shapeTools(info.shaping));
    else parts.push(this.toolbar(), this.more(info, sel));
    this.body.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  }

  /** Kind, name and thread of the selection, with the button that clears it. */
  private head(info: ObjectInfo, sel: SewObject[]): HTMLElement {
    const one = sel.length === 1 ? sel[0] : null;
    const kind = h('span', { class: `kind-icon kind-${one?.kind ?? 'many'}` });
    if (one) kind.innerHTML = KIND_ICON[one.kind];
    else kind.append(icon('obj-duplicate'));
    const title = one ? `${kindLabel(one.kind)} ${info.numbers[0]}` : t('object.many', { n: sel.length });
    // The thread: one swatch per thread of the selection, a click chooses another for all of them.
    const colors: ThreadColor[] = [];
    for (const o of sel) if (!colors.some((c) => sameColor(c, o.color))) colors.push(o.color);
    const colorName = one ? `${one.block + 1}. ${one.color.name || t('layers.unnamed', { n: one.block + 1 })}` : colors.length === 1 ? (colors[0].name ?? '') : '';
    const chip = h(
      'button',
      {
        type: 'button',
        class: 'obj-thread thread-sw',
        title: t('object.thread.hint'),
        'aria-label': `${t('object.thread.hint')}: ${colorName}`,
        disabled: !canRun('object.color'),
        onclick: () => runCommand('object.color'),
      },
      h('span', { class: 'obj-swatches' }, colors.slice(0, 4).map((c) => {
        const s = h('span', { class: 'obj-swatch' });
        s.style.background = cssColor(c);
        return s;
      })),
      colorName ? h('span', { class: 'obj-thread-name' }, colorName) : null,
    );
    const close = h('button', { type: 'button', id: 'object-close', class: 'icon', title: t('object.clear'), 'aria-label': t('object.clear'), onclick: () => this.hooks.clear() }, icon('obj-close'));
    return h('div', { class: 'obj-head' }, kind, h('div', { class: 'obj-title' }, h('strong', null, title), chip), close);
  }

  /** Stitches and thread, where it is sewn and what it lies on; parts and changes by hand. */
  private facts(info: ObjectInfo, sel: SewObject[]): HTMLElement {
    const stitches = sel.reduce((a, o) => a + o.stitches, 0);
    const thread = sel.reduce((a, o) => a + o.threadMm, 0);
    const lines: string[] = [t('objects.facts', { stitches: formatNumber(stitches), thread: formatNumber(thread / 1000, 2) })];
    if (sel.length === 1) {
      const o = sel[0];
      const l = info.layering[0];
      lines.push(`${t('objects.sewn', { k: o.index + 1, n: info.objects.length })} · ${l.below || l.above ? t('objects.lies', { below: l.below, above: l.above }) : t('objects.liesNone')}`);
      const extra: string[] = [];
      if (o.sections > 1) extra.push(`${t('object.sections')}: ${t('object.sectionsValue', { n: o.sections })}`);
      if (info.hand[0]) extra.push(t(info.hand[0] === 1 ? 'object.handValue.one' : 'object.handValue', { n: formatNumber(info.hand[0]) }));
      if (extra.length) lines.push(extra.join(' · '));
    }
    const hand = info.hand.reduce((x, y) => x + y, 0);
    const out = h('div', { class: 'obj-facts' }, lines.map((s) => h('p', null, s)));
    // Merging sews the fills anew: what was changed by hand is said before, not after.
    if (sel.length > 1 && hand && !info.mergeBlocked) out.append(h('p', { class: 'obj-warn' }, t(hand === 1 ? 'object.mergeHand.one' : 'object.mergeHand', { n: formatNumber(hand) })));
    return out;
  }

  /**
   * Size and middle of the selection. With the frame on it they can be typed: a size scales about
   * the middle (the lock keeps the proportions), a middle moves it.
   */
  private geometry(info: ObjectInfo, sel: SewObject[]): HTMLElement {
    const b = box(sel);
    const hint = info.frame && !info.frame.canScale ? `${t('objects.geom.hint')}\n${t('objects.geom.mixed')}` : t('objects.geom.hint');
    const field = (v: number, label: string, onset: (v: number) => void, opts: { min?: number; disabled?: boolean } = {}) => {
      // Text, not a number field: the value reads with the decimal comma in German, and a comma or a point can be typed.
      const shown = formatNumber(v, 1);
      const i = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: false, value: shown, title: label, 'aria-label': label, disabled: !!opts.disabled });
      const read = () => Number(i.value.trim().replace(/\s/g, '').replace(',', '.'));
      i.addEventListener('change', () => {
        const n = read();
        if (Number.isFinite(n) && i.value.trim() !== shown && (opts.min === undefined || n >= opts.min)) onset(n);
        else i.value = shown;
      });
      i.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          i.value = shown;
          i.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          // A step of 0.1 mm (1 mm with Shift), as a number field would.
          e.preventDefault();
          const n = read();
          if (!Number.isFinite(n)) return;
          i.value = formatNumber(n + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1), 1);
          i.dispatchEvent(new Event('change'));
        }
      });
      return i;
    };
    const editable = !!info.frame;
    const canScale = !!info.frame?.canScale;
    const typed = (which: 'w' | 'h', v: number) => {
      const old = which === 'w' ? b.w : b.h;
      if (!(v >= 1 && v <= 1000) || old <= 0.05 || Math.abs(v - old) < 0.05) return;
      const s = v / old;
      // The other side follows when the lock is on; a side that has no extent (a straight line) stays.
      const sx = which === 'w' ? s : this.keepRatio && b.w > 0.05 ? s : 1;
      const sy = which === 'h' ? s : this.keepRatio && b.h > 0.05 ? s : 1;
      this.hooks.resize(sx, sy);
    };
    const moved = (which: 'x' | 'y', v: number) => {
      const d = v - (which === 'x' ? b.cx : b.cy);
      if (Math.abs(d) < 0.05 || Math.abs(v) > 1000) return;
      this.hooks.move(which === 'x' ? d : 0, which === 'y' ? d : 0);
    };
    const lock = h('button', { type: 'button', class: 'icon size-lock', title: t('object.size.lock'), 'aria-label': t('object.size.lock'), 'aria-pressed': String(this.keepRatio), disabled: !canScale }, icon('obj-link'));
    lock.addEventListener('click', () => {
      this.keepRatio = !this.keepRatio;
      lock.setAttribute('aria-pressed', String(this.keepRatio));
    });
    const unit = () => h('span', { class: 'obj-unit' }, 'mm');
    const times = () => h('span', { class: 'obj-x', 'aria-hidden': 'true' }, '×');
    return h(
      'div',
      { class: `obj-geom${editable ? '' : ' readonly'}`, title: hint },
      h('span', { class: 'obj-geom-label' }, t('objects.size')),
      h('span', { class: 'obj-geom-fields' }, field(b.w, t('object.size.w'), (v) => typed('w', v), { min: 1, disabled: !canScale }), times(), field(b.h, t('object.size.h'), (v) => typed('h', v), { min: 1, disabled: !canScale }), unit(), lock),
      h('span', { class: 'obj-geom-label', title: t('objects.pos.hint') }, t('objects.pos')),
      h('span', { class: 'obj-geom-fields', title: t('objects.pos.hint') }, field(b.cx, t('objects.pos.x'), (v) => moved('x', v), { disabled: !editable }), h('span', { class: 'obj-x', 'aria-hidden': 'true' }, ' '), field(b.cy, t('objects.pos.y'), (v) => moved('y', v), { disabled: !editable }), unit(), h('span', { class: 'obj-lock-space' })),
    );
  }

  /** The object commands as a row of icon buttons; the rest in the menu behind "…". */
  private toolbar(): HTMLElement {
    const order = h('button', { type: 'button', class: 'icon obj-icon-btn', title: t('objects.orderMenu'), 'aria-label': t('objects.orderMenu'), 'aria-haspopup': 'menu', onclick: () => showOrderMenu(order) }, icon('obj-order'));
    const more = h('button', { type: 'button', class: 'icon obj-icon-btn', title: t('objects.more'), 'aria-label': t('objects.more'), 'aria-haspopup': 'menu', onclick: () => objectMenu.open(more) }, icon('more'));
    const ids = ['object.duplicate', 'object.mirrorH', 'object.mirrorV', '|', 'object.earlier', 'object.later', 'order', '|', 'object.delete', 'more'];
    return h(
      'div',
      { class: 'obj-toolbar', role: 'toolbar', 'aria-label': t('object.menu') },
      ids.map((id) => (id === '|' ? h('span', { class: 'obj-sep', 'aria-hidden': 'true' }) : id === 'order' ? order : id === 'more' ? more : commandButton(id))),
    );
  }

  /** Bigger steps that apply to this selection only: its outline, its points, parts, merging, cutting. */
  private more(info: ObjectInfo, sel: SewObject[]): HTMLElement | null {
    const out: HTMLElement[] = [];
    const add = (id: string) => {
      if (canRun(id)) out.push(commandButton(id, { text: true })!);
    };
    if (sel.length === 1) {
      add('object.openShape');
      add('object.openStitches');
      add('object.split');
      add('object.blend');
      add('object.reverse');
    } else {
      // Shown also when it cannot be: the reason is its hint.
      const b = commandButton('object.combine', { text: true });
      if (b && info.mergeBlocked) b.title = t(info.mergeBlocked);
      if (b) out.push(b);
      add('object.subtract');
      add('object.reverse');
    }
    return out.length ? h('div', { class: 'obj-actions' }, out) : null;
  }

  /** The thread picker for the selection, at `anchor` (the thread chip when none is given). */
  pickColor(anchor?: HTMLElement): void {
    const one = this.info?.selected.length ? this.info.objects[this.info.selected[0]] : null;
    const at = anchor ?? this.anchor();
    if (!one || !at) return;
    this.picker.toggle(at, {
      key: `object-${this.info!.selected.join('-')}`,
      title: t('object.thread.hint'),
      current: one.color,
      note: t('object.thread.note'),
      onPick: (c) => this.hooks.thread(c),
    });
  }

  /** The thread picker for the second color of a blend, at `anchor` (also used by the stitch panel). */
  pickBlend(anchor?: HTMLElement, fill = this.info?.blend): void {
    const at = anchor ?? this.anchor();
    if (!fill || !at) return;
    this.picker.toggle(at, {
      key: 'blend',
      title: t('object.blend.pick'),
      current: fill,
      note: t('object.blend.note'),
      onPick: (c) => {
        if (!sameColor(c, fill)) this.hooks.blend(c);
      },
    });
  }

  /** Where a picker opened by a command goes: the thread chip, or the selected row of the list. */
  private anchor(): HTMLElement | null {
    const chip = this.body.querySelector<HTMLElement>('.obj-thread');
    if (chip && chip.offsetParent) return chip;
    const row = this.info ? document.querySelector<HTMLElement>(`#layer-list [data-object="${this.info.selected[0]}"]`) : null;
    return row?.offsetParent ? row : chip;
  }

  /** Editing the outline of the one selected object: nodes, delete, corner or round, simplify. */
  private shapeTools(sh: { nodes: number; smooth: boolean | null; line?: { closed: boolean }; kind?: 'band' | 'rails' }): HTMLElement {
    const button = (label: string, run: () => void, opts: { primary?: boolean; disabled?: boolean; title?: string } = {}) =>
      h('button', { type: 'button', class: opts.primary ? 'primary' : '', disabled: !!opts.disabled, title: opts.title ?? '', onclick: run }, label);
    const hint = [t('shape.hint'), sh.kind ? t(`shape.hint.${sh.kind}`) : ''].filter(Boolean).join(' ');
    const row = h(
      'div',
      { class: 'row-buttons' },
      button(t('shape.node.delete'), () => this.hooks.deleteNode(), { disabled: sh.smooth === null }),
      button(sh.smooth ? t('shape.node.corner') : t('shape.node.smooth'), () => this.hooks.toggleNode(), { disabled: sh.smooth === null, title: t('shape.node.kind') }),
      // Traced outlines come with many nodes; fewer are easier to grab.
      sh.nodes >= SIMPLIFY_FROM ? button(t('shape.simplify'), () => this.hooks.simplify(), { title: t('shape.simplify.hint') }) : null,
      sh.line ? button(t(sh.line.closed ? 'shape.line.open' : 'shape.line.close'), () => this.hooks.closeLine(), { title: t(sh.line.closed ? 'shape.line.open.hint' : 'shape.line.close.hint') }) : null,
      button(t('object.editDone'), () => this.hooks.closeShape(), { primary: true }),
    );
    return h(
      'div',
      { class: 'object-edit', title: hint },
      h('p', { class: 'sel-info' }, `${t('shape.nodes', { n: formatNumber(sh.nodes) })} · ${sh.smooth === null ? t('shape.none') : t(sh.smooth ? 'shape.node.smooth' : 'shape.node.corner')}`),
      row,
    );
  }

  /** Editing the points of the one selected object: what is selected, delete, split, done. */
  private stitchTools(ed: { selection: number }): HTMLElement {
    const button = (label: string, run: () => void, opts: { primary?: boolean; disabled?: boolean; title?: string } = {}) =>
      h('button', { type: 'button', class: opts.primary ? 'primary' : '', disabled: !!opts.disabled, title: opts.title ?? '', onclick: run }, label);
    return h(
      'div',
      { class: 'object-edit', title: t('object.editHint') },
      h('p', { class: 'sel-info' }, ed.selection ? t(ed.selection === 1 ? 'edit.selection.one' : 'edit.selection', { n: formatNumber(ed.selection) }) : t('edit.none')),
      h(
        'div',
        { class: 'row-buttons' },
        button(t('edit.delete'), () => this.hooks.deleteSelection(), { disabled: !ed.selection }),
        button(t('edit.split'), () => this.hooks.splitStitch(), { disabled: ed.selection !== 1, title: t('edit.split.hint') }),
        button(t('object.editDone'), () => this.hooks.editStitches(false), { primary: true }),
      ),
    );
  }
}

export interface OrderPreview {
  before: OrderCost;
  after: OrderCost;
  beforeSeconds: number;
  afterSeconds: number;
  /** A better order was found. */
  changed: boolean;
  /** Objects sewn from the other side in it (with new stitches). */
  reversed: number;
}

export interface OrderHooks {
  /** Works out the best order with the current options (null: nothing loaded). */
  preview: () => OrderPreview | null;
  apply: () => void;
  /** The card was closed without applying. */
  cancel: () => void;
  saved: () => void;
}

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
};

/**
 * "Optimize order": a card that shows what a better order would save (color changes, trims, travel,
 * sewing time) before anything changes, with the two things it may do as options.
 */
export class OrderCard {
  private btn = $<HTMLButtonElement>('order-optimize');
  private card = $<HTMLElement>('order-card');

  constructor(
    private settings: Settings,
    private hooks: OrderHooks,
  ) {
    this.btn.addEventListener('click', () => (this.card.hidden ? this.show() : this.close(true)));
    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close(true);
    });
    onLangChange(() => this.isOpen && this.show());
  }

  get isOpen(): boolean {
    return !this.card.hidden;
  }

  close(cancelled: boolean): void {
    if (this.card.hidden) return;
    this.card.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
    if (cancelled) this.hooks.cancel();
  }

  /** Recomputes the card for the current file (after an option or the file changed). */
  show(): void {
    const pv = this.hooks.preview();
    if (!pv) return this.close(false);
    this.card.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    const o = this.settings.order;
    const title = Object.assign(document.createElement('p'), {
      className: 'order-title',
      textContent: t(pv.changed ? 'order.found' : 'order.same'),
    });
    const table = document.createElement('table');
    table.className = 'order-table';
    const line = (label: string, a: number, b: number, fmt: (v: number) => string) => {
      const tr = document.createElement('tr');
      const better = b < a - 1e-6;
      const worse = b > a + 1e-6;
      tr.append(
        Object.assign(document.createElement('th'), { textContent: label }),
        Object.assign(document.createElement('td'), { textContent: fmt(a) }),
        Object.assign(document.createElement('td'), { className: 'arrow', textContent: '→' }),
        Object.assign(document.createElement('td'), { className: better ? 'better' : worse ? 'worse' : '', textContent: fmt(b) }),
      );
      table.append(tr);
    };
    const int = (v: number) => formatNumber(v);
    const meters = (v: number) => (v >= 1000 ? `${formatNumber(v / 1000, 2)} m` : `${formatNumber(v / 10, 1)} cm`);
    line(t('order.colors'), pv.before.colorChanges, pv.after.colorChanges, int);
    line(t('order.trims'), pv.before.trims, pv.after.trims, int);
    line(t('order.travel'), pv.before.travelMm, pv.after.travelMm, meters);
    line(t('order.time'), pv.beforeSeconds, pv.afterSeconds, clock);

    const opts = document.createElement('div');
    opts.className = 'order-opts';
    const check = (key: 'combineColors' | 'shortestWays' | 'reverse', label: string, hint: string) => {
      const l = Object.assign(document.createElement('label'), { className: 'check', title: hint });
      const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: o[key] });
      i.addEventListener('change', () => {
        o[key] = i.checked;
        this.hooks.saved();
        this.show();
      });
      l.append(i, Object.assign(document.createElement('span'), { textContent: label }));
      return l;
    };
    opts.append(
      check('combineColors', t('order.combine'), t('order.combine.hint')),
      check('shortestWays', t('order.shortest'), t('order.shortest.hint')),
      check('reverse', t('order.reverse'), t('order.reverse.hint')),
    );

    const noteText = !pv.reversed ? t('order.note') : pv.reversed === 1 ? t('order.noteReversed.one') : t('order.noteReversed', { n: pv.reversed });
    const note = Object.assign(document.createElement('p'), { className: 'muted small', textContent: noteText });
    const buttons = document.createElement('div');
    buttons.className = 'row-buttons';
    const apply = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: t('order.apply'), disabled: !pv.changed });
    apply.addEventListener('click', () => {
      this.close(false);
      this.hooks.apply();
    });
    const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: t(pv.changed ? 'order.cancel' : 'order.close') });
    cancel.addEventListener('click', () => this.close(true));
    buttons.append(apply, cancel);
    this.card.replaceChildren(title, table, opts, note, buttons);
    (pv.changed ? apply : cancel).focus({ preventScroll: true });
  }
}
