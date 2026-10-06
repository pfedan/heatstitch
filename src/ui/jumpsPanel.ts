import { formatNumber, getLang, onLangChange, t, type Key } from '../i18n';
import type { Transition } from '../model/sequence';
import type { Settings } from '../settings';
import { commandTitle, getCommand } from '../shell/commands';

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

/** What can be done to the selected jump. */
export type JumpAction = 'cut' | 'tie' | 'carry';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

const tied = (j: Transition) => j.tieOff > 0 && j.tieIn > 0;

/** The title of a command with its keys; in Prüfen n steps through the findings, so the key is left out there. */
const titleOf = (id: string, fallback: Key) => {
  const c = getCommand(id);
  if (!c) return t(fallback);
  return document.body.dataset.mode === 'density' ? t(c.label) : commandTitle(c);
};

/**
 * Jumps between stitch runs of one color, in a section that folds away: a summary with a warning
 * for long untrimmed ones, the rule "trim from X mm on", a filtered list in sewing order and the
 * actions for the selected one. Shown in Gestalten and in Prüfen; open by default in Gestalten only.
 */
export class JumpsPanel {
  private root = document.getElementById('jumps') as HTMLElement;
  private box = document.getElementById('jumps-panel') as HTMLDetailsElement | null;
  private sum = document.getElementById('jumps-sum');
  private filter: JumpFilter = 'all';
  private key: unknown[] = [];
  private last: JumpState | null = null;
  private mode = '';

  constructor(
    private s: Settings,
    private hooks: JumpHooks,
  ) {
    // Also outside Ablauf, where the list shows but is not updated.
    onLangChange(() => this.last && this.update({ ...this.last, lang: getLang() }, true));
    // Open or closed is remembered per mode: a long list should not push the findings away.
    const syncOpen = () => {
      this.mode = document.body.dataset.mode ?? 'flow';
      if (this.box) this.box.open = this.s.sections[`jumps.${this.mode}`] ?? this.mode === 'flow';
    };
    syncOpen();
    new MutationObserver(syncOpen).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
    this.box?.addEventListener('toggle', () => {
      const id = `jumps.${this.mode}`;
      if (this.s.sections[id] === this.box!.open) return;
      this.s.sections = { ...this.s.sections, [id]: this.box!.open };
      this.hooks.limitChanged();
    });
  }

  /** Indices (into the full list) the current filter shows. */
  visible(list: Transition[]): number[] {
    return list.flatMap((j, i) => (this.filter === 'all' || (this.filter === 'cut') === j.trimmed ? [i] : []));
  }

  /** Jumps the rule would trim (from the limit on, not trimmed yet) and carry (shorter, trimmed or tied). */
  private rule(list: Transition[]): { toCut: number[]; toCarry: number[] } {
    const limit = this.s.trimMm;
    return {
      toCut: list.flatMap((j, i) => (j.lengthMm >= limit && !j.trimmed ? [i] : [])),
      toCarry: list.flatMap((j, i) => (j.lengthMm < limit && (j.trimmed || j.tieIn || j.tieOff) ? [i] : [])),
    };
  }

  /** How many jumps "trim from the limit" and "do not trim below" would change. */
  counts(): { toCut: number; toCarry: number } {
    const r = this.rule(this.last?.list ?? []);
    return { toCut: r.toCut.length, toCarry: r.toCarry.length };
  }

  /** Trims every jump from the limit on (true) or carries every shorter one (false). */
  applyRule(cut: boolean): void {
    const r = this.rule(this.last?.list ?? []);
    const which = cut ? r.toCut : r.toCarry;
    if (which.length) this.hooks.apply(which, cut);
  }

  /** The actions the selected jump offers. */
  actions(): JumpAction[] {
    const i = this.last?.selected;
    const j = i !== null && i !== undefined ? this.last!.list[i] : undefined;
    if (!j) return [];
    return j.trimmed ? [...(tied(j) ? [] : (['tie'] as const)), 'carry'] : ['cut'];
  }

  /** Runs an action on the selected jump. */
  act(a: JumpAction): void {
    const i = this.last?.selected;
    if (i === null || i === undefined || !this.actions().includes(a)) return;
    this.hooks.apply([i], a !== 'carry');
  }

  update(st: JumpState, force = false): void {
    const key = [st.list, st.selected, st.lang, this.filter, this.s.trimMm, document.body.dataset.mode];
    if (!force && key.every((k, i) => k === this.key[i])) return;
    this.key = key;
    this.last = st;
    const { list } = st;
    const cut = list.filter((j) => j.trimmed).length;
    const limit = this.s.trimMm;
    const longUncut = list.filter((j) => !j.trimmed && j.lengthMm >= limit).length;
    // The section's line: how many, a dot when long ones are not trimmed. It stays one short line
    // next to the title; how many lie loose is its hint.
    const said = cut === list.length ? t('check.jumps.sum.all', { n: list.length }) : t('check.jumps.sum', { n: list.length, u: list.length - cut });
    if (this.sum) this.sum.title = list.length ? said : '';
    this.sum?.replaceChildren(...(list.length ? [...(longUncut ? [el('span', 'dot caution')] : []), el('span', '', formatNumber(list.length))] : []));
    if (!list.length) {
      this.root.replaceChildren(el('p', 'muted small', t('jumps.none')));
      return;
    }
    const { toCut, toCarry } = this.rule(list);

    // Summary and stepper on one line.
    const shown = this.visible(list);
    const at = st.selected !== null ? shown.indexOf(st.selected) : -1;
    const head = el('div', 'jumps-head');
    const nav = el('div', 'f-nav');
    const prev = el('button', 'icon', '‹');
    const next = el('button', 'icon', '›');
    prev.type = next.type = 'button';
    prev.title = titleOf('jumps.prev', 'jumps.prev');
    next.title = titleOf('jumps.next', 'jumps.next');
    prev.setAttribute('aria-label', prev.title);
    next.setAttribute('aria-label', next.title);
    prev.disabled = next.disabled = !shown.length;
    prev.addEventListener('click', () => this.hooks.step(-1));
    next.addEventListener('click', () => this.hooks.step(1));
    nav.append(prev, el('span', 'pos', at < 0 ? String(shown.length) : t('findings.pos', { i: at + 1, n: shown.length })), next);
    head.append(el('p', 'jumps-summary', t('jumps.summary', { n: list.length, cut })), nav);
    const out: HTMLElement[] = [head];
    if (longUncut) out.push(el('p', 'jumps-warn', t('jumps.longUncut', { n: longUncut, v: formatNumber(limit, 1) })));

    // The rule: one length, two directions, all on one line.
    const rule = el('div', 'jumps-rule');
    rule.title = t('jumps.rule');
    const lab = el('label', 'jumps-limit');
    lab.title = t('jumps.limit');
    const input = Object.assign(el('input'), { type: 'number', min: '0.5', max: '50', step: '0.5', value: String(limit) });
    input.setAttribute('aria-label', t('jumps.limit'));
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (v > 0) {
        this.s.trimMm = v;
        this.hooks.limitChanged();
        if (this.last) this.update(this.last, true);
      }
    });
    lab.append(el('span', '', t('check.jumps.from')), input, el('span', 'unit', 'mm'));
    const cutBtn = el('button', '', t('jumps.cutFrom', { n: toCut.length }));
    cutBtn.type = 'button';
    cutBtn.title = t('jumps.cutFrom.hint');
    cutBtn.disabled = !toCut.length;
    cutBtn.addEventListener('click', () => this.applyRule(true));
    const carryBtn = el('button', '', t('jumps.carryBelow', { n: toCarry.length }));
    carryBtn.type = 'button';
    carryBtn.title = t('jumps.carryBelow.hint');
    carryBtn.disabled = !toCarry.length;
    carryBtn.addEventListener('click', () => this.applyRule(false));
    // Only what would change something is offered.
    rule.append(lab, ...(toCut.length ? [cutBtn] : []), ...(toCarry.length ? [carryBtn] : []));
    out.push(rule);

    // Filter chips.
    const chips = el('div', 'f-chips');
    chips.setAttribute('role', 'radiogroup');
    const counts: Record<JumpFilter, number> = { all: list.length, uncut: list.length - cut, cut };
    (['all', 'uncut', 'cut'] as JumpFilter[]).forEach((f) => {
      const b = el('button', 'f-chip');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(this.filter === f));
      if (!counts[f] && f !== this.filter && f !== 'all') return;
      b.append(t(`jumps.filter.${f}` as Key), el('span', 'n', String(counts[f])));
      b.addEventListener('click', () => {
        this.filter = f;
        if (this.last) this.update(this.last, true);
      });
      chips.append(b);
    });
    out.push(chips);

    const ul = el('ul', 'jump-list');
    ul.title = t('jumps.hint');
    ul.addEventListener('mouseleave', () => this.hooks.hover(null));
    if (!shown.length) ul.append(el('li', 'muted small', t('jumps.empty')));
    for (const i of shown) ul.append(this.item(list[i], i, st.selected === i));
    out.push(ul);
    // Keep the list where it was scrolled; the selected one comes into view.
    const scroll = this.root.querySelector('.jump-list')?.scrollTop ?? 0;
    this.root.replaceChildren(...out);
    ul.scrollTop = scroll;
    ul.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private item(j: Transition, i: number, selected: boolean): HTMLLIElement {
    const li = el('li', `jump ${j.trimmed ? 'cut' : 'carried'}${selected ? ' selected' : ''}`);
    const states = [t(j.trimmed ? 'jumps.state.cut' : 'jumps.state.carried')];
    if (j.trimmed) states.push(t(tied(j) ? 'jumps.state.tied' : 'jumps.state.untied'));
    const top = el('div', 'j-top');
    top.append(
      el('span', 'j-icon', j.trimmed ? '✂' : '⤳'),
      el('span', 'j-name', t('jumps.item', { n: i + 1 })),
      el('span', 'j-meta', t('jumps.color', { n: j.block + 1 })),
      el('span', 'num', `${formatNumber(j.lengthMm, 1)} mm`),
    );
    li.title = states.join(', ');
    li.append(top);
    li.addEventListener('click', () => this.hooks.select(selected ? null : i));
    li.addEventListener('mouseenter', () => this.hooks.hover(i));
    if (selected) {
      const acts = el('div', 'j-actions');
      acts.append(el('span', 'meta', states.join(', ')));
      const add = (k: Key, cmd: string, cut: boolean, primary = false) => {
        const b = el('button', primary ? 'primary' : '', t(k));
        b.type = 'button';
        b.title = titleOf(cmd, k);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hooks.apply([i], cut);
        });
        acts.append(b);
      };
      if (!j.trimmed) add('jumps.cut', 'jumps.cut', true, true);
      else {
        if (!tied(j)) add('jumps.tie', 'jumps.tie', true, true);
        add('jumps.carry', 'jumps.carry', false);
      }
      li.append(acts);
    }
    return li;
  }
}
