import type { CorrectionFocus, CorrectionReport } from '../correct/auto';
import type { Visibility } from '../correct/plan';
import type { ObjectKind } from '../model/objects';
import type { Fixed } from '../model/restitch';
import type { Reason } from '../validation/zones';
import { fixText } from './fixText';
import { KIND_ICON } from './layersPanel';
import { formatNumber, getLang, t, type Key } from '../i18n';
import { patternStats, type Pattern, type PatternStats } from '../model/pattern';
import type { ValidationResult } from '../validation/validate';
import type { Settings } from '../settings';
import { cleanName, isOutputFormat, suggestedName, type OutputFormat } from '../writers';
import { FileList, type LoadedFile } from './fileList';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface CorrectHooks {
  /** Work out proposals for the whole design or the selected zone. */
  plan: (scope: 'all' | 'zone') => void;
  /** Tick or untick a proposal (`fine`: the fine correction on the stitches). */
  check: (ids: number[] | 'fine', on: boolean) => void;
  /** Tick all proposals (and the fine correction) or none. */
  checkAll: (on: boolean) => void;
  /** Take over the ticked proposals, or drop them all. */
  applyPlan: () => void;
  discardPlan: () => void;
  /** The pointer is over a proposal (null: no longer), or it was clicked. */
  hoverProposal: (ids: number[] | null) => void;
  /** Where across its row the pointer is (0 left, 1 right): the comparison's line goes there. */
  splitProposal: (at: number) => void;
  showProposal: (ids: number[]) => void;
  toggleCompare: () => void;
  deleteSelection: () => void;
  thinSelection: (share: number) => void;
  undo: () => void;
  redo: () => void;
  revert: () => void;
  /** Saves the open file; `name` is the file name without extension (also the design name in the header). */
  save: (format: OutputFormat, name: string) => void;
  /** Correction options changed (settings need saving). */
  optionsChanged: () => void;
}

/** Outcome line(s) shown under the correction buttons. */
export type CorrectMessage =
  | { kind: 'busy' }
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'plan'; plan: PlanView }
  | { kind: 'applied'; done: number; before: Cells; after: Cells | null; fine?: CorrectionReport; open: number }
  | { kind: 'report'; report: CorrectionReport }
  | { kind: 'text'; text: string }
  | null;

export interface Cells {
  critical: number;
  caution: number;
}

/** A proposal as the card shows it. */
export interface PlanRow {
  /** The proposals it stands for: the same change on several objects is one row. */
  ids: number[];
  /** The object's name as in the list of objects, and its thread. */
  name: string;
  color: string;
  kind: ObjectKind;
  visibility: Visibility;
  changes: Fixed[];
  knockout?: boolean;
  reasons: Reason[];
  hand: number;
  checked: boolean;
  /** Held on the canvas for comparing (its name was clicked). */
  pinned?: boolean;
}

export interface PlanView {
  /** A heading of its own (tuning to the fabric), instead of the count of proposals. */
  title?: string;
  rows: PlanRow[];
  /** Places left for the fine correction on the stitches (shape not certain, or nothing else helped). */
  fine: number;
  fineChecked: boolean;
  /** Objects left out because they are locked. */
  locked: number;
  before: Cells;
  /** With the ticked-by-default proposals (null while measured). */
  after: Cells | null;
}

export interface CorrectState {
  file: LoadedFile | null;
  zoneSelected: boolean;
  editing: boolean;
  comparing: boolean;
  selection: number;
  /** Penetrations are visible at the current zoom. */
  pointsVisible: boolean;
  message: CorrectMessage;
}

/** Correction options, auto-fix, manual edit tools, undo and save. */
export class CorrectPanel {
  private goal = document.querySelectorAll<HTMLInputElement>('input[name="fix-goal"]');
  private focus = document.querySelectorAll<HTMLInputElement>('input[name="fix-focus"]');
  private focusHint = $<HTMLElement>('fix-focus-hint');
  private fixAll = $<HTMLButtonElement>('fix-all');
  private fixZone = $<HTMLButtonElement>('fix-zone');
  private report = $<HTMLElement>('fix-report');
  private editOff = $<HTMLElement>('edit-off-hint');
  private tools = $<HTMLElement>('edit-tools');
  private selInfo = $<HTMLElement>('sel-info');
  private selDelete = $<HTMLButtonElement>('sel-delete');
  private selThin = $<HTMLButtonElement>('sel-thin');
  private thinShare = $<HTMLSelectElement>('thin-share');
  private undoBtn = $<HTMLButtonElement>('undo');
  private redoBtn = $<HTMLButtonElement>('redo');
  private revertBtn = $<HTMLButtonElement>('revert');
  private saveFormat = $<HTMLSelectElement>('save-format');
  private saveFile = $<HTMLButtonElement>('save-file');
  private saveName = $<HTMLInputElement>('save-name');
  private saveExt = $<HTMLElement>('save-ext');
  /** Names typed per file; other files show the suggestion. */
  private names = new WeakMap<object, string>();
  private compareToggle = $<HTMLButtonElement>('compare-toggle');
  private compareTable = $<HTMLTableElement>('compare-table');
  private last: CorrectState | null = null;
  private stats = new WeakMap<Pattern, PatternStats>();
  private compareKey: unknown[] = [];
  private shown: unknown[] = [];
  private hooks: CorrectHooks;

  constructor(
    private s: Settings,
    hooks: CorrectHooks,
  ) {
    const c = s.correction;
    this.goal.forEach((r) => {
      r.checked = r.value === c.goal;
      r.addEventListener('change', () => {
        if (r.checked) c.goal = r.value as typeof c.goal;
        hooks.optionsChanged();
      });
    });
    this.focus.forEach((r) => {
      r.checked = r.value === c.focus;
      r.addEventListener('change', () => {
        if (r.checked) c.focus = r.value as CorrectionFocus;
        hooks.optionsChanged();
        if (this.last) this.update(this.last);
      });
    });
    this.fixAll.addEventListener('click', () => hooks.plan('all'));
    this.fixZone.addEventListener('click', () => hooks.plan('zone'));
    this.hooks = hooks;
    this.compareToggle.addEventListener('click', () => hooks.toggleCompare());
    this.selDelete.addEventListener('click', () => hooks.deleteSelection());
    this.selThin.addEventListener('click', () => hooks.thinSelection(Number(this.thinShare.value)));
    this.undoBtn.addEventListener('click', () => hooks.undo());
    this.redoBtn.addEventListener('click', () => hooks.redo());
    this.revertBtn.addEventListener('click', () => hooks.revert());
    // The choice is remembered: someone with a Janome machine saves JEF every time.
    this.saveFormat.addEventListener('change', () => {
      if (isOutputFormat(this.saveFormat.value)) s.saveFormat = this.saveFormat.value;
      this.saveExt.textContent = `.${this.saveFormat.value}`;
      hooks.optionsChanged();
    });
    this.saveName.addEventListener('input', () => {
      const f = this.last?.file;
      if (f) this.names.set(f, this.saveName.value);
    });
    const save = () => {
      const f = this.last?.file;
      if (!f || !isOutputFormat(this.saveFormat.value)) return;
      const name = cleanName(this.saveName.value) || suggestedName(f.fileName, FileList.edited(f) && !FileList.blank(f));
      hooks.save(this.saveFormat.value, name);
    };
    this.saveFile.addEventListener('click', save);
    this.saveName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
  }

  /** Shows the correction options again after they were changed elsewhere (a project was opened). */
  sync(): void {
    this.goal.forEach((r) => (r.checked = r.value === this.s.correction.goal));
    this.focus.forEach((r) => (r.checked = r.value === this.s.correction.focus));
  }

  update(st: CorrectState): void {
    this.last = st;
    const f = st.file;
    const loaded = !!f?.pattern;
    const busy = st.message?.kind === 'busy' || st.message?.kind === 'progress';
    this.fixAll.disabled = !loaded || busy;
    this.fixZone.disabled = !loaded || busy || !st.zoneSelected;
    const hint: Record<CorrectionFocus, Key> = {
      both: 'correct.focus.both.hint',
      thread: 'correct.focus.thread.hint',
      holes: 'correct.focus.holes.hint',
    };
    this.focusHint.textContent = t(hint[this.s.correction.focus]);
    this.fixAll.textContent = busy ? t('plan.running') : t('correct.all');

    this.editOff.hidden = st.editing;
    this.tools.hidden = !st.editing;
    this.selInfo.textContent = !st.pointsVisible
      ? t('edit.zoom')
      : st.selection
        ? t(st.selection === 1 ? 'edit.selection.one' : 'edit.selection', { n: formatNumber(st.selection) })
        : t('edit.none');
    this.selDelete.disabled = this.selThin.disabled = !st.selection || busy;
    this.thinShare.setAttribute('aria-label', t('edit.thin'));

    this.undoBtn.disabled = !f?.undo.length || busy;
    this.redoBtn.disabled = !f?.redo.length || busy;
    this.revertBtn.disabled = busy;
    this.revertBtn.hidden = !FileList.edited(f) || FileList.blank(f);
    this.saveFile.disabled = this.saveFormat.disabled = this.saveName.disabled = !loaded || busy;
    // Until a format was chosen, the open file's own format is offered.
    const own = f?.pattern?.format;
    this.saveFormat.value = this.s.saveFormat ?? (isOutputFormat(own) ? own : 'pes');
    this.saveExt.textContent = `.${this.saveFormat.value}`;
    const name = f ? (this.names.get(f) ?? suggestedName(f.fileName, FileList.edited(f) && !FileList.blank(f))) : '';
    if (document.activeElement !== this.saveName && this.saveName.value !== name) this.saveName.value = name;

    // Drawn anew only when the message changed: the canvas redraws while the pointer is on a row.
    const shown = [st.message, getLang()];
    if (shown.some((k, i) => k !== this.shown[i])) {
      this.shown = shown;
      this.report.replaceChildren(...this.message(st.message));
    }

    const edited = FileList.edited(f);
    this.compareToggle.disabled = !edited;
    this.compareToggle.textContent = t(st.comparing && edited ? 'compare.stop' : 'compare.start');
    this.compareToggle.setAttribute('aria-pressed', String(st.comparing && edited));
    this.compareToggle.classList.toggle('primary', st.comparing && edited);
    this.compareTable.hidden = !edited;
    const key = [f, f?.pattern, f?.validation, f?.originalValidation, getLang()];
    if (key.some((k, i) => k !== this.compareKey[i])) {
      this.compareKey = key;
      if (edited && f) this.renderComparison(f);
      else this.compareTable.replaceChildren();
    }
  }

  private statsOf(p: Pattern): PatternStats {
    let s = this.stats.get(p);
    if (!s) this.stats.set(p, (s = patternStats(p)));
    return s;
  }

  /** Key figures of the original next to the current version; lower is better except for stitches. */
  private renderComparison(f: LoadedFile): void {
    const a = this.statsOf(f.original!);
    const b = this.statsOf(f.pattern!);
    const va: ValidationResult | undefined = f.originalValidation;
    const vb: ValidationResult | undefined = f.validation;
    const rows: [Key, number | undefined, number | undefined, number, string, boolean][] = [
      ['compare.stitches', a.stitches, b.stitches, 0, '', false],
      ['compare.thread', a.threadLength / 1000, b.threadLength / 1000, 2, ' m', true],
      ['compare.critical', va?.criticalCells, vb?.criticalCells, 0, ' mm²', true],
      ['compare.caution', va?.cautionCells, vb?.cautionCells, 0, ' mm²', true],
      ['compare.maxDensity', va?.maxDensity, vb?.maxDensity, 1, ' mm/mm²', true],
    ];
    const cell = (tag: 'th' | 'td', text: string, cls = '') => Object.assign(document.createElement(tag), { textContent: text, className: cls });
    const head = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.append(cell('th', ''), cell('th', t('compare.original')), cell('th', t('compare.current')));
    head.append(hr);
    const body = document.createElement('tbody');
    for (const [key, x, y, digits, unit, lowerBetter] of rows) {
      const fmt = (v: number | undefined) => (v === undefined ? t('compare.pending') : formatNumber(v, digits) + unit);
      const tr = document.createElement('tr');
      const cls = !lowerBetter || x === undefined || y === undefined || Math.abs(x - y) < 10 ** -digits / 2 ? '' : y < x ? 'better' : 'worse';
      tr.append(cell('th', t(key)), cell('td', fmt(x)), cell('td', fmt(y), cls));
      body.append(tr);
    }
    const caption = document.createElement('caption');
    caption.textContent = t('compare.hint');
    this.compareTable.replaceChildren(caption, head, body);
  }

  private message(m: CorrectMessage): HTMLElement[] {
    const p = (text: string, cls = '') => Object.assign(document.createElement('p'), { textContent: text, className: cls });
    if (!m) return [];
    if (m.kind === 'busy') return [p(t('correct.running'), 'muted pending')];
    if (m.kind === 'progress') return [p(m.total ? t('plan.progress', { a: formatNumber(Math.min(m.total, m.done + 1)), b: formatNumber(m.total) }) : t('plan.running'), 'muted pending')];
    if (m.kind === 'text') return [p(m.text)];
    if (m.kind === 'plan') return this.planCard(m.plan);
    if (m.kind === 'applied') return this.applied(m);
    const r = m.report;
    const changed = r.stitchesBefore !== r.stitchesAfter || r.pulledBack + r.shortened + r.moved + r.respaced > 0;
    if (!changed && !r.practice && !r.acknowledged) {
      const clean = r.before.criticalZones + r.before.cautionZones === 0;
      return [p(t(clean ? 'correct.nothing' : 'correct.noChange'))];
    }
    const out = [
      p(
        t('correct.result', {
          // Validation cells are 1 x 1 mm.
          c0: formatNumber(r.before.criticalCells),
          c1: formatNumber(r.after.criticalCells),
          w0: formatNumber(r.before.cautionCells),
          w1: formatNumber(r.after.cautionCells),
        }),
        'strong',
      ),
    ];
    const items: [Key, number][] = [
      ['correct.item.pull', r.pulledBack],
      ['correct.item.short', r.shortened],
      ['correct.item.resp', r.respaced],
      ['correct.item.hidden', r.hiddenRows],
      ['correct.item.clean', r.zeroLength + r.merged],
      ['correct.item.moved', r.moved],
    ];
    const list = items.filter(([, n]) => n > 0).map(([k, n]) => t(k, { n: formatNumber(n) }));
    if (list.length) out.push(p(t('correct.changes', { list: list.join(', ') })));
    if (changed) {
      out.push(
        p(
          `${t('correct.stitches', { a: formatNumber(r.stitchesBefore), b: formatNumber(r.stitchesAfter) })} ${t('correct.thread', {
            a: formatNumber(r.threadBefore / 1000, 1),
            b: formatNumber(r.threadAfter / 1000, 1),
          })}`,
        ),
      );
    }
    if (r.practice) out.push(p(t('correct.practice', { n: r.practice }), 'muted small'));
    if (r.acknowledged) out.push(p(t('correct.acknowledged', { n: r.acknowledged }), 'muted small'));
    if (r.manual) out.push(p(t('correct.left', { n: r.manual }), 'muted small'));
    return out;
  }

  /** The proposals: one row per change, ticked or not, and the buttons to take them over. */
  private planCard(v: PlanView): HTMLElement[] {
    const p = (text: string, cls = '') => Object.assign(document.createElement('p'), { textContent: text, className: cls });
    const out: HTMLElement[] = [];
    if (!v.rows.length && !v.fine) {
      out.push(p(v.title ?? t(v.before.critical + v.before.caution ? 'plan.none' : 'correct.nothing')));
      if (v.locked) out.push(p(t('plan.locked', { n: v.locked }), 'muted small'));
      return out;
    }
    const objects = v.rows.reduce((a, r) => a + r.ids.length, 0);
    out.push(p(v.title ?? t(objects === 1 ? 'plan.head.one' : 'plan.head', { n: formatNumber(objects) }), 'strong'));
    if (v.after) {
      out.push(
        p(
          t('plan.result', {
            c0: formatNumber(v.before.critical),
            c1: formatNumber(v.after.critical),
            w0: formatNumber(v.before.caution),
            w1: formatNumber(v.after.caution),
          }),
          'muted small',
        ),
      );
    }
    out.push(p(t('plan.hover'), 'muted small'));
    // Pick all or none at once (none is ticked at first).
    const pick = document.createElement('div');
    pick.className = 'plan-pick';
    for (const [key, on] of [['plan.all', true], ['plan.noneChecked', false]] as const) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'link small', textContent: t(key) });
      b.addEventListener('click', () => this.hooks.checkAll(on));
      pick.append(b);
    }
    out.push(pick);
    const list = document.createElement('ul');
    list.className = 'plan-list';
    for (const r of v.rows) list.append(this.planRow(r));
    if (v.fine) {
      const li = document.createElement('li');
      li.className = 'plan-row';
      const l = Object.assign(document.createElement('label'), { className: 'check' });
      const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: v.fineChecked });
      i.addEventListener('change', () => this.hooks.check('fine', i.checked));
      l.append(i, Object.assign(document.createElement('span'), { className: 'plan-name', textContent: t('plan.fine') }));
      li.append(l, p(t(v.fine === 1 ? 'plan.fine.text.one' : 'plan.fine.text', { n: formatNumber(v.fine) }), 'muted small plan-change'));
      list.append(li);
    }
    out.push(list);
    if (v.locked) out.push(p(t('plan.locked', { n: v.locked }), 'muted small'));
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const take = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: t('plan.apply') });
    take.disabled = !v.rows.some((r) => r.checked) && !(v.fine && v.fineChecked);
    take.addEventListener('click', () => this.hooks.applyPlan());
    const drop = Object.assign(document.createElement('button'), { type: 'button', textContent: t('plan.discard') });
    drop.addEventListener('click', () => this.hooks.discardPlan());
    buttons.append(take, drop);
    out.push(buttons);
    out.push(p(t('plan.note'), 'muted small'));
    return out;
  }

  private planRow(r: PlanRow): HTMLElement {
    const li = document.createElement('li');
    li.className = `plan-row ${r.visibility}${r.pinned ? ' pinned' : ''}`;
    const top = document.createElement('div');
    top.className = 'plan-top';
    const l = Object.assign(document.createElement('label'), { className: 'check' });
    const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: r.checked });
    i.addEventListener('change', () => this.hooks.check(r.ids, i.checked));
    const name = Object.assign(document.createElement('button'), { type: 'button', className: 'link plan-name', title: t('plan.show') });
    name.setAttribute('aria-pressed', String(!!r.pinned));
    const sw = Object.assign(document.createElement('span'), { className: 'swatch' });
    sw.style.background = r.color;
    const icon = Object.assign(document.createElement('span'), { className: `kind-icon kind-${r.kind}`, innerHTML: KIND_ICON[r.kind] });
    name.append(sw, icon, r.name);
    name.addEventListener('click', () => this.hooks.showProposal(r.ids));
    l.append(i);
    const vis = Object.assign(document.createElement('span'), {
      className: `plan-vis ${r.visibility}`,
      textContent: r.hand ? t('plan.hand', { n: formatNumber(r.hand) }) : t(`plan.vis.${r.visibility}` as Key),
      title: t(`plan.vis.${r.visibility}.hint` as Key),
    });
    top.append(l, name, vis);
    li.append(top);
    const changes = [...r.changes.map(fixText), ...(r.knockout ? [fixText({ field: 'knockout', from: false, to: true })] : [])];
    const why = r.reasons.map((x) => t(`validation.reason.${x}` as Key)).join(', ');
    li.append(Object.assign(document.createElement('p'), { className: 'small plan-change', textContent: changes.join(' · ') }));
    if (why) li.append(Object.assign(document.createElement('p'), { className: 'muted small plan-change', textContent: t('plan.against', { list: why }) }));
    // Moving sideways over the row moves the line between before and after.
    const split = (e: MouseEvent) => {
      const b = li.getBoundingClientRect();
      this.hooks.splitProposal((e.clientX - b.left) / Math.max(1, b.width));
    };
    li.addEventListener('mouseenter', (e) => {
      this.hooks.hoverProposal(r.ids);
      split(e);
    });
    li.addEventListener('mousemove', split);
    li.addEventListener('mouseleave', () => this.hooks.hoverProposal(null));
    return li;
  }

  private applied(m: Extract<CorrectMessage, { kind: 'applied' }>): HTMLElement[] {
    const p = (text: string, cls = '') => Object.assign(document.createElement('p'), { textContent: text, className: cls });
    const out = [p(t(m.done === 1 ? 'plan.applied.one' : 'plan.applied', { n: formatNumber(m.done) }), 'strong')];
    if (m.after) {
      out.push(
        p(
          t('correct.result', {
            c0: formatNumber(m.before.critical),
            c1: formatNumber(m.after.critical),
            w0: formatNumber(m.before.caution),
            w1: formatNumber(m.after.caution),
          }),
        ),
      );
    }
    if (m.fine) {
      const r = m.fine;
      const items: [Key, number][] = [
        ['correct.item.pull', r.pulledBack],
        ['correct.item.short', r.shortened],
        ['correct.item.resp', r.respaced],
        ['correct.item.hidden', r.hiddenRows],
        ['correct.item.clean', r.zeroLength + r.merged],
        ['correct.item.moved', r.moved],
      ];
      const list = items.filter(([, n]) => n > 0).map(([k, n]) => t(k, { n: formatNumber(n) }));
      if (list.length) out.push(p(t('plan.fineDone', { list: list.join(', ') }), 'small'));
    }
    if (m.open) out.push(p(t('correct.left', { n: m.open }), 'muted small'));
    out.push(p(t('plan.undo'), 'muted small'));
    return out;
  }
}
