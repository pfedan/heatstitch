import { formatNumber, t, type Key } from '../i18n';
import type { Transition } from '../model/sequence';
import type { Settings } from '../settings';

export type JumpFilter = 'all' | 'uncut' | 'cut';

export interface JumpHooks {
  select: (index: number | null) => void;
  hover: (index: number | null) => void;
  step: (dir: 1 | -1) => void;
  /** Cut (true) or carry (false) the given jumps; indices into the full list. */
  apply: (indices: number[], cut: boolean) => void;
  limitChanged: () => void;
}

export interface JumpState {
  list: Transition[];
  selected: number | null;
  /** Lengths are rounded to 0.1 mm in the texts. */
  lang: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

const tied = (j: Transition) => j.tieOff > 0 && j.tieIn > 0;

/**
 * Jumps between stitch runs of one color: a summary with a warning for long untrimmed ones, the
 * rule "trim from X mm on", a filtered list in sewing order and the actions for the selected one.
 */
export class JumpsPanel {
  private root = document.getElementById('jumps') as HTMLElement;
  private filter: JumpFilter = 'all';
  private key: unknown[] = [];
  private last: JumpState | null = null;

  constructor(
    private s: Settings,
    private hooks: JumpHooks,
  ) {}

  /** Indices (into the full list) the current filter shows. */
  visible(list: Transition[]): number[] {
    return list.flatMap((j, i) => (this.filter === 'all' || (this.filter === 'cut') === j.trimmed ? [i] : []));
  }

  update(st: JumpState, force = false): void {
    const key = [st.list, st.selected, st.lang, this.filter, this.s.trimMm];
    if (!force && key.every((k, i) => k === this.key[i])) return;
    this.key = key;
    this.last = st;
    const { list } = st;
    if (!list.length) {
      this.root.replaceChildren(el('p', 'muted small', t('jumps.none')));
      return;
    }
    const cut = list.filter((j) => j.trimmed).length;
    const limit = this.s.trimMm;
    const longUncut = list.filter((j) => !j.trimmed && j.lengthMm >= limit).length;
    const toCut = list.flatMap((j, i) => (j.lengthMm >= limit && !j.trimmed ? [i] : []));
    const toCarry = list.flatMap((j, i) => (j.lengthMm < limit && (j.trimmed || j.tieIn || j.tieOff) ? [i] : []));

    const head = el('div', 'jumps-head');
    const nav = el('div', 'f-nav');
    const prev = el('button', 'icon', '‹');
    prev.title = t('jumps.prev');
    prev.addEventListener('click', () => this.hooks.step(-1));
    const next = el('button', 'icon', '›');
    next.title = t('jumps.next');
    next.addEventListener('click', () => this.hooks.step(1));
    nav.append(prev, next);
    head.append(el('p', 'jumps-summary', t('jumps.summary', { n: list.length, cut })), nav);
    const out: HTMLElement[] = [head];
    if (longUncut) out.push(el('p', 'jumps-warn', t('jumps.longUncut', { n: longUncut, v: formatNumber(limit, 1) })));

    // The rule: one length, two directions. Folded away unless asked for or needed.
    const rule = el('details', 'jumps-rule section');
    rule.open = (this.s.sections.jumpRule ?? false) || longUncut > 0;
    rule.addEventListener('toggle', () => {
      this.s.sections = { ...this.s.sections, jumpRule: rule.open };
      this.hooks.limitChanged();
    });
    rule.append(el('summary', '', t('jumps.rule')));
    const lab = el('label', 'field row-inline');
    lab.append(el('span', 'label', t('jumps.limit')));
    const input = Object.assign(el('input'), { type: 'number', min: '0.5', max: '50', step: '0.5', value: String(limit) });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (v > 0) {
        this.s.trimMm = v;
        this.hooks.limitChanged();
        if (this.last) this.update(this.last, true);
      }
    });
    lab.append(input, el('span', 'label', 'mm'));
    const btns = el('div', 'buttons');
    const cutBtn = el('button', '', t('jumps.cutFrom', { n: toCut.length }));
    cutBtn.title = t('jumps.cutFrom.hint');
    cutBtn.disabled = !toCut.length;
    cutBtn.addEventListener('click', () => this.hooks.apply(toCut, true));
    const carryBtn = el('button', '', t('jumps.carryBelow', { n: toCarry.length }));
    carryBtn.title = t('jumps.carryBelow.hint');
    carryBtn.disabled = !toCarry.length;
    carryBtn.addEventListener('click', () => this.hooks.apply(toCarry, false));
    btns.append(cutBtn, carryBtn);
    rule.append(lab, btns);
    out.push(rule);

    // Filter chips and stepper.
    const bar = el('div', 'findings-bar');
    const chips = el('div', 'f-chips');
    chips.setAttribute('role', 'radiogroup');
    const counts: Record<JumpFilter, number> = { all: list.length, uncut: list.length - cut, cut };
    (['all', 'uncut', 'cut'] as JumpFilter[]).forEach((f) => {
      const b = el('button', 'f-chip');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(this.filter === f));
      b.append(t(`jumps.filter.${f}` as Key), el('span', 'n', String(counts[f])));
      b.addEventListener('click', () => {
        this.filter = f;
        if (this.last) this.update(this.last, true);
      });
      chips.append(b);
    });
    bar.append(chips);
    out.push(bar);

    const shown = this.visible(list);
    const ul = el('ul', 'jump-list');
    ul.addEventListener('mouseleave', () => this.hooks.hover(null));
    if (!shown.length) ul.append(el('li', 'muted small', t('jumps.empty')));
    for (const i of shown) ul.append(this.item(list[i], i, st.selected === i));
    out.push(ul, el('p', 'muted small', t('jumps.hint')));
    this.root.replaceChildren(...out);
    ul.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private item(j: Transition, i: number, selected: boolean): HTMLLIElement {
    const li = el('li', `jump ${j.trimmed ? 'cut' : 'carried'}${selected ? ' selected' : ''}`);
    const top = el('div', 'j-top');
    top.append(
      el('span', 'j-icon', j.trimmed ? '✂' : '⤳'),
      el('span', 'j-name', t('jumps.item', { n: i + 1 })),
      el('span', 'num', `${formatNumber(j.lengthMm, 1)} mm`),
    );
    const states = [t(j.trimmed ? 'jumps.state.cut' : 'jumps.state.carried')];
    if (j.trimmed) states.push(t(tied(j) ? 'jumps.state.tied' : 'jumps.state.untied'));
    const meta = el('div', 'meta', `${t('jumps.color', { n: j.block + 1 })} · ${states.join(', ')}`);
    li.append(top, meta);
    li.addEventListener('click', () => this.hooks.select(selected ? null : i));
    li.addEventListener('mouseenter', () => this.hooks.hover(i));
    if (selected) {
      const acts = el('div', 'buttons j-actions');
      const add = (k: Key, cut: boolean, primary = false) => {
        const b = el('button', primary ? 'primary' : '', t(k));
        b.type = 'button';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hooks.apply([i], cut);
        });
        acts.append(b);
      };
      if (!j.trimmed) add('jumps.cut', true, true);
      else {
        if (!tied(j)) add('jumps.tie', true, true);
        add('jumps.carry', false);
      }
      li.append(acts);
    }
    return li;
  }
}
