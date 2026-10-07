import { formatNumber, getLang, onLangChange, t, type Key } from '../i18n';
import type { SewObject } from '../model/objects';
import type { OrderCost } from '../model/order';
import type { Settings } from '../settings';
import { KIND_ICON, kindLabel } from './layersPanel';
import { cssColor, ThreadPicker } from './threadPicker';
import { sameColor } from '../model/recolor';
import type { ThreadColor } from '../model/pattern';


/** A chain link: the typed sizes keep their proportions. */
const SIZE_LOCK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5 L11.5 8.5" /><path d="M9 6.5 L11 4.5 A2.5 2.5 0 0 1 15.5 9 L13.5 11" /><path d="M11 13.5 L9 15.5 A2.5 2.5 0 0 1 4.5 11 L6.5 9" /></svg>';

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
  /** Sew the selected object one place earlier (-1) or later (1). */
  step: (dir: -1 | 1) => void;
  /** Sew the selected objects as one. */
  merge: () => void;
  /** Show the selected object as its pieces, each one an object. */
  split: () => void;
  /** Sew the selected satins and fills from the other side. */
  reverse: () => void;
  clear: () => void;
  /** Start or stop editing the points of the selected object. */
  editStitches: (on: boolean) => void;
  /** Start or stop editing the outline of the selected object. */
  editShape: (on: boolean) => void;
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
  /** The selected object once more, beside it. */
  duplicate: () => void;
  /** The selected objects mirrored left to right (x) or top to bottom (y). */
  mirror: (axis: 'x' | 'y') => void;
  /** The top one of the selected fills cut out of the others. */
  subtract: () => void;
  /** The selected objects scaled by sx, sy about their middle. */
  resize: (sx: number, sy: number) => void;
  /** The selected objects deleted. */
  remove: () => void;
  /** The selected objects sewn in another thread. */
  thread: (c: ThreadColor) => void;
  /** The one selected fill fades out, and a copy in `c` fades in on the same area: a color blend. */
  blend: (c: ThreadColor) => void;
  /** The selected objects kept but not sewn: switched off, or as guides. */
  aside: (role: 'off' | 'guide') => void;
}

/** One thing to do with the selected objects, as a button or a menu entry. */
export interface ObjectAction {
  icon: string;
  label: string;
  hint: string;
  /** Runs it; `anchor` is the button or menu entry, for a popup that opens next to it. */
  run: (anchor: HTMLElement) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Two arrows in opposite directions: start and end swap. */
const icon = (path: string) =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const SHAPE_ICONS = {
  duplicate: icon('<rect x="2.5" y="2.5" width="8" height="8" rx="1"/><rect x="5.5" y="5.5" width="8" height="8" rx="1"/>'),
  mirrorX: icon('<path d="M8 1.5v13" stroke-dasharray="1.5 1.5"/><path d="M6 4L2 12h4zM10 4l4 8h-4z"/>'),
  mirrorY: icon('<path d="M1.5 8h13" stroke-dasharray="1.5 1.5"/><path d="M4 6l8-4v4zM4 10l8 4v-4z"/>'),
  subtract: icon('<path d="M2.5 2.5h8v3.2a4.5 4.5 0 0 0-4.8 4.8H2.5z"/><circle cx="10" cy="10" r="3.5" stroke-dasharray="1.5 1.5"/>'),
  remove: icon('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/>'),
  off: icon('<path d="M11.5 1.5L4.5 14.5"/><ellipse cx="10.6" cy="3.2" rx="0.5" ry="1"/><path d="M2 2l12 12"/>'),
  guide: icon('<path d="M2 13L14 3" stroke-dasharray="2.4 2"/>'),
  blend: icon('<path d="M2.5 3.5h11M2.5 6h11M2.5 9h11"/><path d="M2.5 11.5h11M2.5 13.5h11" opacity=".5"/>'),
};

const REVERSE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13"/></svg>';

/** Size in mm of an object's stitches. */
const sizeOf = (o: SewObject) => [(o.maxX - o.minX) / 10, (o.maxY - o.minY) / 10];

/**
 * The selected objects: what they are, where in the order they are sewn, what they lie on, and
 * buttons to sew one earlier or later (the keyboard and touch way of dragging it in the list).
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
    $('object-close').addEventListener('click', () => hooks.clear());
    onLangChange(() => {
      this.key = [];
      this.update(this.info, getLang());
    });
  }

  update(info: ObjectInfo | null, lang: string): void {
    this.info = info;
    const key = [info?.objects, info?.selected.join(), info?.hand.join(), info?.editing?.selection ?? -1, info?.shapeable, info?.shaping?.nodes ?? -1, info?.shaping?.smooth, info?.shaping?.line?.closed, info?.shaping?.kind, info?.frame?.canScale, lang];
    if (key.every((k, i) => k === this.key[i])) return;
    this.key = key;
    this.msg.hidden = true;
    if (!info || !info.selected.length) {
      this.panel.hidden = true;
      return;
    }
    this.panel.hidden = false;
    const sel = info.selected.map((i) => info.objects[i]);
    const head = document.createElement('div');
    head.className = 'object-head';
    const dl = document.createElement('dl');
    dl.className = 'stats';
    const row = (k: string, v: string) => {
      dl.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
    };
    const stitches = sel.reduce((a, o) => a + o.stitches, 0);
    const thread = sel.reduce((a, o) => a + o.threadMm, 0);
    if (sel.length === 1) {
      const o = sel[0];
      const icon = document.createElement('span');
      icon.className = `kind-icon kind-${o.kind}`;
      icon.innerHTML = KIND_ICON[o.kind];
      const title = Object.assign(document.createElement('strong'), { textContent: `${kindLabel(o.kind)} ${info.numbers[0]}` });
      const sw = Object.assign(document.createElement('button'), { type: 'button', className: 'mini-sw thread-sw', title: t('object.thread.hint') });
      sw.setAttribute('aria-label', t('object.thread.hint'));
      sw.style.background = cssColor(o.color);
      sw.addEventListener('click', () =>
        this.picker.toggle(sw, {
          key: `object-${o.index}`,
          title: t('object.thread.hint'),
          current: o.color,
          note: t('object.thread.note'),
          onPick: (c) => this.hooks.thread(c),
        }),
      );
      const color = Object.assign(document.createElement('span'), {
        className: 'muted',
        textContent: `${o.block + 1}. ${o.color.name || t('layers.unnamed', { n: o.block + 1 })}`,
      });
      head.append(icon, title, sw, color);
      const [w, h] = sizeOf(o);
      row(t('object.stitches'), formatNumber(o.stitches));
      row(t('object.thread'), `${formatNumber(o.threadMm / 1000, 2)} m`);
      if (!info.frame?.canScale) row(t('object.size'), `${formatNumber(w, 1)} × ${formatNumber(h, 1)} mm`);
      else this.sizeRow(dl, w, h);
      if (o.sections > 1) row(t('object.sections'), t('object.sectionsValue', { n: o.sections }));
      if (info.hand[0]) row(t('object.hand'), t(info.hand[0] === 1 ? 'object.handValue.one' : 'object.handValue', { n: formatNumber(info.hand[0]) }));
      row(t('object.position'), t('object.positionOf', { k: o.index + 1, n: info.objects.length }));
      const l = info.layering[0];
      row(t('object.layering'), l.below || l.above ? t('object.layeringValue', { below: l.below, above: l.above }) : t('object.layeringNone'));
    } else {
      head.append(Object.assign(document.createElement('strong'), { textContent: t('object.many', { n: sel.length }) }));
      row(t('object.stitches'), formatNumber(stitches));
      row(t('object.thread'), `${formatNumber(thread / 1000, 2)} m`);
      const w = (Math.max(...sel.map((o) => o.maxX)) - Math.min(...sel.map((o) => o.minX))) / 10;
      const h = (Math.max(...sel.map((o) => o.maxY)) - Math.min(...sel.map((o) => o.minY))) / 10;
      if (!info.frame?.canScale) row(t('object.size'), `${formatNumber(w, 1)} × ${formatNumber(h, 1)} mm`);
      else this.sizeRow(dl, w, h);
    }
    const actions = document.createElement('div');
    actions.className = 'row-buttons';
    const extraRows: HTMLElement[] = [];
    if (sel.length === 1) {
      const o = sel[0];
      const btn = (label: string, dir: -1 | 1, disabled: boolean) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, disabled });
        b.addEventListener('click', () => this.hooks.step(dir));
        return b;
      };
      actions.append(btn(t('object.earlier'), -1, o.index === 0), btn(t('object.later'), 1, o.index === info.objects.length - 1));
      if (o.sections > 1) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'wide', textContent: t('object.split'), title: t('object.split.hint') });
        b.addEventListener('click', () => this.hooks.split());
        actions.append(b);
      }
    } else {
      const why = info.mergeBlocked;
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: t('object.merge'), title: t(why ?? 'object.merge.hint'), disabled: !!why });
      b.addEventListener('click', () => this.hooks.merge());
      actions.append(b);
    }
    const hand = info.hand.reduce((x, y) => x + y, 0);
    if (info.reversible && !info.editing) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'wide reverse' });
      b.title = hand ? `${t('object.reverse.hint')}\n${t('stitch.hand', { n: formatNumber(hand) })}` : t('object.reverse.hint');
      b.innerHTML = REVERSE_ICON;
      b.append(t('object.reverse'));
      b.addEventListener('click', () => this.hooks.reverse());
      actions.append(b);
    }
    const shapeActions = this.actions(info);
    if (shapeActions.length) {
      const shapeRow = document.createElement('div');
      shapeRow.className = 'row-buttons shape-actions';
      for (const a of shapeActions) {
        const b = Object.assign(document.createElement('button'), { type: 'button', title: a.hint });
        b.innerHTML = a.icon;
        b.setAttribute('aria-label', a.label);
        b.addEventListener('click', () => a.run(b));
        shapeRow.append(b);
      }
      extraRows.push(shapeRow);
    }
    const handNote =
      sel.length > 1 && hand && !info.mergeBlocked
        ? [Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('object.mergeHand', { n: formatNumber(hand) }) })]
        : [];
    const hint = Object.assign(document.createElement('p'), {
      className: 'muted small',
      textContent: [t(info.editing ? 'object.editHint' : info.shaping ? 'shape.hint' : sel.length === 1 ? 'object.hint' : 'object.hintMany'), info.shaping?.kind ? t(`shape.hint.${info.shaping.kind}`) : ''].filter(Boolean).join(' '),
    });
    const frameHint = info.frame
      ? [Object.assign(document.createElement('p'), { className: 'muted small', textContent: info.frame.canScale ? t('object.frameHint') : `${t('object.frameHint')} ${t('object.frameMixed')}` })]
      : [];
    const tools = sel.length !== 1 ? [] : info.shaping ? [this.shapeTools(info.shaping)] : [this.stitchTools(info)];
    this.body.replaceChildren(head, dl, ...(actions.childElementCount ? [actions] : []), ...extraRows, ...handNote, ...tools, ...frameHint, hint);
  }

  /** The thread picker for the second color of a blend, at `anchor` (also used by the stitch panel). */
  pickBlend(anchor: HTMLElement, fill = this.info?.blend): void {
    if (!fill) return;
    this.picker.toggle(anchor, {
      key: 'blend',
      title: t('object.blend.pick'),
      current: fill,
      note: t('object.blend.note'),
      onPick: (c) => {
        if (!sameColor(c, fill)) this.hooks.blend(c);
      },
    });
  }

  /**
   * What can be done with the selected objects as shapes: duplicate, cut out, mirror, put aside,
   * delete. The same actions in the panel and in the menu on the canvas (right click, long press).
   */
  actions(info: ObjectInfo): ObjectAction[] {
    if (info.editing || info.shaping || !info.selected.length) return [];
    const out: ObjectAction[] = [];
    const add = (icon: string, label: string, hint: string, run: (anchor: HTMLElement) => void) => out.push({ icon, label, hint, run });
    add(SHAPE_ICONS.duplicate, t('object.duplicate'), t('object.duplicate.hint'), () => this.hooks.duplicate());
    if (info.blend) add(SHAPE_ICONS.blend, t('object.blend'), t('object.blend.hint'), (anchor) => this.pickBlend(anchor, info.blend));
    if (info.subtractable) add(SHAPE_ICONS.subtract, t('object.subtract'), t('object.subtract.hint'), () => this.hooks.subtract());
    add(SHAPE_ICONS.mirrorX, t('object.mirrorX.short'), t('object.mirrorX'), () => this.hooks.mirror('x'));
    add(SHAPE_ICONS.mirrorY, t('object.mirrorY.short'), t('object.mirrorY'), () => this.hooks.mirror('y'));
    if (info.objects.length > info.selected.length) {
      add(SHAPE_ICONS.off, t('object.off'), t('object.off.hint'), () => this.hooks.aside('off'));
      add(SHAPE_ICONS.guide, t('object.guide'), t('object.guide.hint'), () => this.hooks.aside('guide'));
      add(SHAPE_ICONS.remove, t('object.delete'), t('object.delete.hint'), () => this.hooks.remove());
    }
    return out;
  }

  /**
   * The size of the selection as two fields (mm) to type in, with a lock that keeps the proportions.
   * A typed size scales the selection about its middle, as the frame does.
   */
  private sizeRow(dl: HTMLElement, w: number, h: number): void {
    const dd = Object.assign(document.createElement('dd'), { className: 'size-edit' });
    const field = (v: number, label: string) => {
      const i = Object.assign(document.createElement('input'), { type: 'number', min: '1', max: '1000', step: '0.1', value: v.toFixed(1), title: label });
      i.setAttribute('aria-label', label);
      return i;
    };
    const iw = field(w, t('object.size.w'));
    const ih = field(h, t('object.size.h'));
    const lock = Object.assign(document.createElement('button'), { type: 'button', className: 'size-lock', title: t('object.size.lock') });
    lock.setAttribute('aria-label', t('object.size.lock'));
    lock.innerHTML = SIZE_LOCK;
    const showLock = () => lock.setAttribute('aria-pressed', String(this.keepRatio));
    showLock();
    lock.addEventListener('click', () => {
      this.keepRatio = !this.keepRatio;
      showLock();
    });
    const typed = (which: 'w' | 'h') => {
      const v = Number((which === 'w' ? iw : ih).value);
      const old = which === 'w' ? w : h;
      if (!(v >= 1 && v <= 1000) || old <= 0.05 || Math.abs(v - old) < 0.05) return;
      const s = v / old;
      // The other side follows when the lock is on; a side that has no extent (a straight line) stays.
      const sx = which === 'w' ? s : this.keepRatio && w > 0.05 ? s : 1;
      const sy = which === 'h' ? s : this.keepRatio && h > 0.05 ? s : 1;
      this.hooks.resize(sx, sy);
    };
    iw.addEventListener('change', () => typed('w'));
    ih.addEventListener('change', () => typed('h'));
    dd.append(iw, document.createTextNode('×'), ih, document.createTextNode('mm'), lock);
    dl.append(Object.assign(document.createElement('dt'), { textContent: t('object.size') }), dd);
  }

  /** Editing the outline of the one selected object: nodes, delete, corner or round, simplify. */
  private shapeTools(sh: { nodes: number; smooth: boolean | null; line?: { closed: boolean } }): HTMLElement {
    const box = document.createElement('div');
    box.className = 'object-edit';
    const button = (label: string, run: () => void, opts: { primary?: boolean; disabled?: boolean; title?: string } = {}) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, disabled: !!opts.disabled, title: opts.title ?? '' });
      if (opts.primary) b.className = 'primary';
      b.addEventListener('click', run);
      return b;
    };
    box.append(Object.assign(document.createElement('p'), { className: 'sel-info', textContent: `${t('shape.nodes', { n: formatNumber(sh.nodes) })} · ${sh.smooth === null ? t('shape.none') : t(sh.smooth ? 'shape.node.smooth' : 'shape.node.corner')}` }));
    const row = document.createElement('div');
    row.className = 'row-buttons';
    row.append(
      button(t('shape.node.delete'), () => this.hooks.deleteNode(), { disabled: sh.smooth === null }),
      button(sh.smooth ? t('shape.node.corner') : t('shape.node.smooth'), () => this.hooks.toggleNode(), { disabled: sh.smooth === null, title: t('shape.node.kind') }),
    );
    // Traced outlines come with many nodes; fewer are easier to grab.
    if (sh.nodes >= SIMPLIFY_FROM) row.append(button(t('shape.simplify'), () => this.hooks.simplify(), { title: t('shape.simplify.hint') }));
    box.append(row);
    if (sh.line) {
      const close = button(t(sh.line.closed ? 'shape.line.open' : 'shape.line.close'), () => this.hooks.closeLine(), { title: t(sh.line.closed ? 'shape.line.open.hint' : 'shape.line.close.hint') });
      const more = document.createElement('div');
      more.className = 'row-buttons';
      more.append(close);
      box.append(more);
    }
    return box;
  }

  /** Editing the points of the one selected object: start, what is selected, delete, split, done. */
  private stitchTools(info: ObjectInfo): HTMLElement {
    const box = document.createElement('div');
    box.className = 'object-edit';
    const button = (label: string, run: () => void, opts: { primary?: boolean; disabled?: boolean; title?: string } = {}) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, disabled: !!opts.disabled, title: opts.title ?? '' });
      if (opts.primary) b.className = 'primary';
      b.addEventListener('click', run);
      return b;
    };
    const ed = info.editing;
    if (!ed) {
      const row = document.createElement('div');
      row.className = 'row-buttons';
      if (info.shapeable) row.append(button(t('object.editShape'), () => this.hooks.editShape(true), { title: t('level.shape.hint') }));
      row.append(button(t('object.editStitches'), () => this.hooks.editStitches(true), { title: t('level.stitches.hint') }));
      box.append(row);
      return box;
    }
    box.append(Object.assign(document.createElement('p'), { className: 'sel-info', textContent: ed.selection ? t(ed.selection === 1 ? 'edit.selection.one' : 'edit.selection', { n: formatNumber(ed.selection) }) : t('edit.none') }));
    const row = document.createElement('div');
    row.className = 'row-buttons';
    row.append(
      button(t('edit.delete'), () => this.hooks.deleteSelection(), { disabled: !ed.selection }),
      button(t('edit.split'), () => this.hooks.splitStitch(), { disabled: ed.selection !== 1, title: t('edit.split.hint') }),
      button(t('object.editDone'), () => this.hooks.editStitches(false), { primary: true }),
    );
    box.append(row);
    return box;
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
