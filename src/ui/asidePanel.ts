import { onLangChange, t } from '../i18n';
import type { AsideRole, AsideShape } from '../model/aside';
import { runCommand } from '../shell/commands';
import { h, icon } from '../shell/h';
import { KIND_ICON, kindLabel, LONG_PRESS_MS } from './layersPanel';
import { cssColor } from './threadPicker';

export interface AsideHooks {
  /** Shape `id` hovered in the list (shown on the canvas), or none. */
  hover: (id: number | null) => void;
  /** The menu of shape `id`, at the page position or under its button. */
  menu: (id: number, at: { x: number; y: number } | HTMLElement) => void;
  /** The shape the commands work on (its row was used). */
  target: (id: number) => void;
}

/** A dashed line: a guide. */
const GUIDE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13L14 3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="2.4 2" stroke-linecap="round"/></svg>';

/** The name of a shape aside: what it is and its number among them. */
export const asideName = (a: AsideShape, k: number) => `${kindLabel(a.kind)} ${k + 1}`;

/**
 * The group "Not sewn" at the end of the list of colors and objects: shapes switched off or kept
 * as guides, and shapes left out when the file came in. Each row sews its shape again with one
 * click; its menu (right click, long press, its button) turns it into the other role or deletes
 * it. Closed until it is opened; it opens by itself when a shape goes aside.
 */
export class AsidePanel {
  private root = document.getElementById('aside-block') as HTMLDetailsElement;
  private summary = this.root.querySelector('summary')!;
  private list = this.root.querySelector('ul')!;
  private count = 0;
  private shown: AsideShape[] = [];

  constructor(private hooks: AsideHooks) {
    this.list.addEventListener('mouseleave', () => hooks.hover(null));
    onLangChange(() => this.update(this.shown));
  }

  update(list: AsideShape[]): void {
    this.root.hidden = !list.length;
    // A shape newly put aside shows where it went.
    if (list.length > this.count) this.root.open = true;
    this.count = list.length;
    this.shown = list;
    this.summary.replaceChildren(icon('obj-chevron'), h('span', { class: 'aside-title' }, t('aside.title', { n: list.length })));
    this.list.replaceChildren(...list.map((a, k) => this.row(a, k)));
  }

  private row(a: AsideShape, k: number): HTMLLIElement {
    const kind = h('span', { class: `kind-icon kind-${a.kind}` });
    kind.innerHTML = a.role === 'guide' ? GUIDE_ICON : KIND_ICON[a.kind];
    const sw = h('span', { class: 'mini-sw' });
    sw.style.background = cssColor(a.color);
    const why = t(a.reason === 'background' ? 'aside.background' : a.role === 'guide' ? 'aside.guide' : 'aside.off');
    // The buttons run the commands for this shape: it becomes their target first.
    const act = (id: string) => () => {
      this.hooks.target(a.id);
      runCommand(id);
    };
    const sewBtn = h('button', { type: 'button', class: 'aside-sew', title: t('aside.sew.hint'), onclick: (e: Event) => (e.stopPropagation(), act('aside.sew')()) }, t('aside.sew'));
    const more = h(
      'button',
      {
        type: 'button',
        class: 'icon row-more',
        title: t('objects.aside.menu'),
        'aria-label': t('objects.aside.menu'),
        'aria-haspopup': 'menu',
        onclick: (e: Event) => {
          e.stopPropagation();
          this.hooks.menu(a.id, more);
        },
      },
      icon('more'),
    );
    const li = h(
      'li',
      {
        class: `layer aside-row ${a.role}`,
        title: a.reason === 'background' ? t('aside.background.hint') : '',
        onmouseenter: () => this.hooks.hover(a.id),
        oncontextmenu: (e: Event) => {
          e.preventDefault();
          const m = e as MouseEvent;
          this.hooks.menu(a.id, { x: m.clientX, y: m.clientY });
        },
      },
      kind,
      sw,
      h('span', { class: 'layer-text' }, h('span', { class: 'layer-name' }, asideName(a, k)), h('span', { class: 'layer-sub' }, why)),
      sewBtn,
      more,
    );
    // A long press on a touch screen opens the menu too.
    let press = 0;
    let at = { x: 0, y: 0 };
    li.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      at = { x: e.clientX, y: e.clientY };
      clearTimeout(press);
      press = window.setTimeout(() => this.hooks.menu(a.id, at), LONG_PRESS_MS);
    });
    li.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - at.x, e.clientY - at.y) > 8) clearTimeout(press);
    });
    for (const ev of ['pointerup', 'pointercancel'] as const) li.addEventListener(ev, () => clearTimeout(press));
    return li;
  }
}

/** The entries of the menu of a shape "not sewn": its other role, sew, delete for good. */
export function asideMenuIds(role: AsideRole): string[] {
  return ['aside.sew', role === 'guide' ? 'aside.toOff' : 'aside.toGuide', '-', 'aside.drop'];
}
