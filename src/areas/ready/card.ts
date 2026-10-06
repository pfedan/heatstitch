import { formatNumber, t, type Key } from '../../i18n';
import { h, icon } from '../../shell/h';
import { DESIGN_RULES, type Basis, type Card, type Line, type Params } from './recipes';

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
  /** The marks the card uses (rule of thumb, disputed), for its legend. */
  marks: Basis[];
}

const fmt = (p?: Params): Params | undefined =>
  p && Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? formatNumber(v, Number.isInteger(v) ? 0 : 1) : v]));

const say = (l: Line): string => t(l.text, fmt(l.params));

/**
 * The card in the current language. `machineSpm` is the speed set for the time estimates; when it
 * is above the recommendation, the speed row says so.
 */
export function cardView(c: Card, machineSpm?: number): CardView {
  const s = c.stabilizer;
  const stabNotes: Note[] = [];
  if (c.stronger) stabNotes.push({ text: say(c.stronger), basis: c.stronger.basis });
  if (s.gsm) stabNotes.push({ text: t('ready.gsm', { a: s.gsm[0], b: s.gsm[1] }) });
  const needleNotes: Note[] = [];
  if (c.needle.alt) needleNotes.push({ text: t(c.needle.alt) });
  if (c.threadNeedle) needleNotes.push({ text: t(c.threadNeedle.text), basis: c.threadNeedle.basis });
  const sp = c.speed;
  const speedNotes: Note[] = [];
  if (sp.why) speedNotes.push({ text: t(sp.why) });
  if (sp.maxSpm !== null && machineSpm && machineSpm > sp.maxSpm) speedNotes.push({ text: t('ready.speed.over', { spm: formatNumber(machineSpm) }) });
  speedNotes.push({ text: t('ready.speed.metallic', { n: formatNumber(DESIGN_RULES.metallicSpm) }), basis: 'rule' });
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
    {
      id: 'speed',
      icon: 'ready-speed',
      label: t('ready.row.speed'),
      value: sp.maxSpm === null ? t('ready.speed.machine') : t('ready.speed.max', { n: formatNumber(sp.maxSpm) }),
      basis: sp.basis,
      notes: speedNotes,
    },
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
  const hints = c.hints.map((x) => ({ level: x.level, text: say(x), basis: x.basis }));
  const hooping = { text: t(c.hooping.text), basis: c.hooping.basis };
  const tips = c.tips.map((x) => ({ text: t(x.text), basis: x.basis }));
  const used = new Set<Basis | undefined>([...rows.flatMap((r) => [r.basis, ...r.notes.map((n) => n.basis)]), ...hints.map((x) => x.basis), hooping.basis, ...tips.map((x) => x.basis)]);
  const marks = MARKED.filter((b) => used.has(b));
  return { rows, hints, hooping, tips, summary, marks };
}

/** Bases that carry a mark, in the order of the legend; sourced values carry none. */
const MARKED: Basis[] = ['rule', 'disputed'];

/** Symbol of a mark (icons.ts). */
export const markIcon = (b: Basis): string => `ready-${b}`;

/**
 * The quiet mark after a value that is a rule of thumb or disputed: a small symbol, its meaning in
 * the legend under the card, on hover and for screen readers.
 */
export function basisTag(b: Basis | undefined): HTMLElement | null {
  if (!b || b === 'source') return null;
  return h(
    'span',
    { class: `ready-mark ${b}`, role: 'img', 'aria-label': t(`ready.basis.${b}` as Key), title: `${t(`ready.basis.${b}` as Key)}: ${t(`ready.basis.${b}.hint` as Key)}` },
    icon(markIcon(b)),
  );
}

/** A text with its mark, the mark kept on one line with the last word. */
function marked(text: string, b: Basis | undefined): (string | HTMLElement)[] {
  const tag = basisTag(b);
  if (!tag) return [text];
  const cut = text.lastIndexOf(' ') + 1;
  return [text.slice(0, cut), h('span', { class: 'ready-nowrap' }, text.slice(cut), tag)];
}

/** The legend of the marks the card uses, and that everything on it is a starting point. */
function legend(marks: Basis[]): HTMLElement {
  return h(
    'div',
    { class: 'ready-foot' },
    marks.length
      ? h(
          'p',
          { class: 'ready-legend' },
          marks.map((b) => h('span', null, icon(markIcon(b)), t(`ready.legend.${b}` as Key))),
          h('span', null, t('ready.legend.source')),
        )
      : null,
    h('p', null, t('ready.note')),
  );
}


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
          h('span', { class: 'ready-value' }, marked(r.value, r.basis)),
          r.notes.map((n) => h('small', { class: 'ready-note' }, marked(n.text, n.basis))),
        ),
      ),
    ),
  );
  const hints = v.hints.length
    ? h(
        'ul',
        { class: 'ready-hints' },
        v.hints.map((x) => h('li', { class: x.level }, icon(x.level === 'warn' ? 'ready-alert' : 'ready-tip'), h('span', null, marked(x.text, x.basis)))),
      )
    : null;
  const more = h(
    'details',
    { class: 'ready-more' },
    h('summary', null, t('ready.more')),
    h('p', { class: 'ready-hooping' }, icon('ready-hoop'), h('span', null, marked(v.hooping.text, v.hooping.basis))),
    h(
      'ul',
      { class: 'ready-tips' },
      v.tips.map((x) => h('li', null, icon('ready-tip'), h('span', null, marked(x.text, x.basis)))),
    ),
  );
  more.open = opts.foldOpen;
  more.addEventListener('toggle', () => opts.onFold(more.open));
  return [rows, hints, more, legend(v.marks)].filter((n): n is NonNullable<typeof n> => !!n);
}
