import { onLangChange, t } from '../i18n';
import type { AsideRole, AsideShape } from '../model/aside';
import { KIND_ICON, kindLabel } from './layersPanel';
import { cssColor } from './threadPicker';

export interface AsideHooks {
  /** Sew shape `id` again at its place. */
  sew: (id: number) => void;
  role: (id: number, role: AsideRole) => void;
  drop: (id: number) => void;
  /** Shape `id` hovered in the list (shown on the canvas), or none. */
  hover: (id: number | null) => void;
}

/** A dashed line: a guide. */
const GUIDE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13L14 3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="2.4 2" stroke-linecap="round"/></svg>';

/** The name of a shape aside: what it is and its number among them. */
export const asideName = (a: AsideShape, k: number) => `${kindLabel(a.kind)} ${k + 1}`;

/**
 * The block "Not sewn" under the list of colors and objects: shapes switched off or kept as guides,
 * and shapes left out when the file came in. Each can be sewn again, turned into the other role or
 * deleted. Closed until it is opened; it opens by itself when a shape goes aside.
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
    this.summary.textContent = t('aside.title', { n: list.length });
    this.list.replaceChildren(...list.map((a, k) => this.row(a, k)));
  }

  private row(a: AsideShape, k: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = `layer aside-row ${a.role}`;
    li.addEventListener('mouseenter', () => this.hooks.hover(a.id));
    const icon = document.createElement('span');
    icon.className = `kind-icon kind-${a.kind}`;
    icon.innerHTML = a.role === 'guide' ? GUIDE_ICON : KIND_ICON[a.kind];
    const sw = document.createElement('span');
    sw.className = 'mini-sw';
    sw.style.background = cssColor(a.color);
    const text = document.createElement('span');
    text.className = 'layer-text';
    const name = Object.assign(document.createElement('span'), { className: 'layer-name', textContent: asideName(a, k) });
    const why = Object.assign(document.createElement('span'), {
      className: 'layer-meta',
      textContent: t(a.reason === 'background' ? 'aside.background' : a.role === 'guide' ? 'aside.guide' : 'aside.off'),
    });
    if (a.reason === 'background') li.title = t('aside.background.hint');
    text.append(name, why);
    const button = (label: string, hint: string, run: () => void, cls = '') => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: `small ${cls}`.trim(), textContent: label, title: hint });
      b.addEventListener('click', run);
      return b;
    };
    const other: AsideRole = a.role === 'guide' ? 'off' : 'guide';
    const actions = document.createElement('span');
    actions.className = 'aside-actions';
    actions.append(
      button(t('aside.sew'), t('aside.sew.hint'), () => this.hooks.sew(a.id)),
      button(t(other === 'guide' ? 'aside.toGuide' : 'aside.toOff'), t(other === 'guide' ? 'aside.toGuide.hint' : 'aside.toOff.hint'), () => this.hooks.role(a.id, other)),
    );
    const drop = button('×', t('aside.drop.hint'), () => this.hooks.drop(a.id), 'icon');
    drop.setAttribute('aria-label', t('aside.drop.hint'));
    li.append(icon, sw, text, drop, actions);
    return li;
  }
}
