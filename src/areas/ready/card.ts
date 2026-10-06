import { formatNumber, t, type Key } from '../../i18n';
import { h, icon } from '../../shell/h';
import type { Basis, Card, Line, Params } from './recipes';

/** One line under a value: what it is and how firm. */
export interface Note {
  text: string;
  basis?: Basis;
}

export interface RowView {
  id: 'stab' | 'topping' | 'needle' | 'thread' | 'speed' | 'hoop';
  icon: string;
  label: string;
  value: string;
  basis?: Basis;
  notes: Note[];
  /** Speed only: 3 normal, 2 somewhat slower, 1 slow. */
  step?: number;
}

/** The card with every text in the current language, for the inspector and the stitch sheet. */
export interface CardView {
  rows: RowView[];
  hints: (Note & { level: 'info' | 'warn' })[];
  /** How to hoop, in full. */
  hooping: Note;
  tips: Note[];
  /** Short, for a section head or a line in the save popover. */
  summary: string;
}

const fmt = (p?: Params): Params | undefined =>
  p && Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? formatNumber(v, Number.isInteger(v) ? 0 : 1) : v]));

const say = (l: Line): string => t(l.text, fmt(l.params));

export function cardView(c: Card): CardView {
  const s = c.stabilizer;
  const stabNotes: Note[] = [];
  if (c.stronger) stabNotes.push({ text: say(c.stronger) });
  if (s.gsm) stabNotes.push({ text: t('ready.gsm', { a: s.gsm[0], b: s.gsm[1] }) });
  const needleNotes: Note[] = [];
  if (c.needle.alt) needleNotes.push({ text: t(c.needle.alt) });
  if (c.threadNeedle) needleNotes.push({ text: t(c.threadNeedle.text), basis: c.threadNeedle.basis });
  const step = c.speed.step === 'normal' ? 3 : c.speed.step === 'reduced' ? 2 : 1;
  const rows: RowView[] = [
    { id: 'stab', icon: 'ready-stab', label: t('ready.row.stab'), value: t(s.text), basis: s.basis, notes: stabNotes },
    { id: 'topping', icon: 'ready-topping', label: t('ready.row.topping'), value: t(c.topping.text), basis: c.topping.basis, notes: [] },
    {
      id: 'needle',
      icon: 'ready-needle',
      label: t('ready.row.needle'),
      value: c.needle.size ? `${t(c.needle.text)} ${c.needle.size}` : t(c.needle.text),
      basis: c.needle.basis,
      notes: needleNotes,
    },
    {
      id: 'thread',
      icon: 'ready-thread',
      label: t('ready.row.thread'),
      value: t(`ready.thread.w${c.thread}` as Key),
      notes: [{ text: t(c.threadNote.text), basis: c.threadNote.basis }],
    },
    { id: 'speed', icon: 'ready-speed', label: t('ready.row.speed'), value: t(c.speed.text), basis: c.speed.basis, notes: [], step },
    {
      id: 'hoop',
      icon: c.hooping.method === 'float' ? 'ready-float' : 'ready-hoop',
      label: t('ready.row.hoop'),
      value: t(`ready.method.${c.hooping.method}` as Key),
      basis: c.hooping.basis,
      notes: [],
    },
  ];
  const needle = c.needle.size ?? (c.fabric === 'leather' ? '80/12' : '');
  const summary = [
    t(`ready.kind.${s.kind}` as Key) + (c.extraLayers ? ` ${t('ready.short.layers', { n: c.extraLayers })}` : ''),
    needle && t('ready.short.needle', { size: needle }),
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    rows,
    hints: c.hints.map((x) => ({ level: x.level, text: say(x), basis: x.basis })),
    hooping: { text: t(c.hooping.text), basis: c.hooping.basis },
    tips: c.tips.map((x) => ({ text: t(x.text), basis: x.basis })),
    summary,
  };
}

/** The small mark after a value that is a rule of thumb or disputed; sourced values carry none. */
export function basisTag(b: Basis | undefined): HTMLElement | null {
  if (!b || b === 'source') return null;
  return h('span', { class: `ready-tag ${b}`, title: t(`ready.basis.${b}.hint` as Key) }, t(`ready.basis.${b}` as Key));
}

const meter = (step: number) =>
  h('span', { class: 'ready-meter', 'data-step': String(step), 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));

/** The card as the inspector shows it: six short rows, notes, then tips folded away. */
export function renderCard(v: CardView, opts: { foldOpen: boolean; onFold: (open: boolean) => void }): HTMLElement[] {
  const rows = h(
    'dl',
    { class: 'ready-rows' },
    v.rows.map((r) =>
      h(
        'div',
        { class: `ready-row ready-${r.id}` },
        h('dt', null, icon(r.icon), h('span', null, r.label)),
        h(
          'dd',
          { title: r.basis ? t(`ready.basis.${r.basis}.hint` as Key) : '' },
          h('span', { class: 'ready-value' }, r.step ? meter(r.step) : null, r.value, basisTag(r.basis)),
          r.notes.map((n) => h('small', { class: 'ready-note' }, n.text, basisTag(n.basis))),
        ),
      ),
    ),
  );
  const hints = v.hints.length
    ? h(
        'ul',
        { class: 'ready-hints' },
        v.hints.map((x) => h('li', { class: x.level }, icon(x.level === 'warn' ? 'ready-alert' : 'ready-tip'), h('span', null, x.text, basisTag(x.basis)))),
      )
    : null;
  const more = h(
    'details',
    { class: 'ready-more' },
    h('summary', null, t('ready.more')),
    h('p', { class: 'ready-hooping' }, icon('ready-hoop'), h('span', null, v.hooping.text, basisTag(v.hooping.basis))),
    h(
      'ul',
      { class: 'ready-tips' },
      v.tips.map((x) => h('li', null, icon('ready-tip'), h('span', null, x.text, basisTag(x.basis)))),
    ),
    h('p', { class: 'ready-legend' }, t('ready.legend')),
  );
  more.open = opts.foldOpen;
  more.addEventListener('toggle', () => opts.onFold(more.open));
  const note = h('p', { class: 'ready-foot' }, t('ready.note'));
  return [rows, hints, more, note].filter((n): n is NonNullable<typeof n> => !!n);
}
