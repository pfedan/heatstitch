import type { CorrectionFocus, CorrectionReport } from '../correct/auto';
import { formatNumber, getLang, t, type Key } from '../i18n';
import { patternStats, type Pattern, type PatternStats } from '../model/pattern';
import type { ValidationResult } from '../validation/validate';
import type { Settings } from '../settings';
import type { OutputFormat } from '../writers';
import { FileList, type LoadedFile } from './fileList';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface CorrectHooks {
  /** Run the automatic correction on the whole design or the selected zone. */
  autoFix: (scope: 'all' | 'zone') => void;
  toggleEdit: () => void;
  toggleCompare: () => void;
  deleteSelection: () => void;
  thinSelection: (share: number) => void;
  undo: () => void;
  redo: () => void;
  revert: () => void;
  save: (format: OutputFormat) => void;
  /** Correction options changed (settings need saving). */
  optionsChanged: () => void;
}

/** Outcome line(s) shown under the correction buttons. */
export type CorrectMessage =
  | { kind: 'busy' }
  | { kind: 'report'; report: CorrectionReport }
  | { kind: 'text'; text: string }
  | null;

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
  private editToggle = $<HTMLButtonElement>('edit-toggle');
  private tools = $<HTMLElement>('edit-tools');
  private selInfo = $<HTMLElement>('sel-info');
  private selDelete = $<HTMLButtonElement>('sel-delete');
  private selThin = $<HTMLButtonElement>('sel-thin');
  private thinShare = $<HTMLSelectElement>('thin-share');
  private undoBtn = $<HTMLButtonElement>('undo');
  private redoBtn = $<HTMLButtonElement>('redo');
  private revertBtn = $<HTMLButtonElement>('revert');
  private saveDst = $<HTMLButtonElement>('save-dst');
  private savePes = $<HTMLButtonElement>('save-pes');
  private compareToggle = $<HTMLButtonElement>('compare-toggle');
  private compareTable = $<HTMLTableElement>('compare-table');
  private last: CorrectState | null = null;
  private stats = new WeakMap<Pattern, PatternStats>();
  private compareKey: unknown[] = [];

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
    this.fixAll.addEventListener('click', () => hooks.autoFix('all'));
    this.fixZone.addEventListener('click', () => hooks.autoFix('zone'));
    this.editToggle.addEventListener('click', () => hooks.toggleEdit());
    this.compareToggle.addEventListener('click', () => hooks.toggleCompare());
    this.selDelete.addEventListener('click', () => hooks.deleteSelection());
    this.selThin.addEventListener('click', () => hooks.thinSelection(Number(this.thinShare.value)));
    this.undoBtn.addEventListener('click', () => hooks.undo());
    this.redoBtn.addEventListener('click', () => hooks.redo());
    this.revertBtn.addEventListener('click', () => hooks.revert());
    this.saveDst.addEventListener('click', () => hooks.save('dst'));
    this.savePes.addEventListener('click', () => hooks.save('pes'));
  }

  update(st: CorrectState): void {
    this.last = st;
    const f = st.file;
    const loaded = !!f?.pattern;
    const busy = st.message?.kind === 'busy';
    this.fixAll.disabled = !loaded || busy;
    this.fixZone.disabled = !loaded || busy || !st.zoneSelected;
    const hint: Record<CorrectionFocus, Key> = {
      both: 'correct.focus.both.hint',
      thread: 'correct.focus.thread.hint',
      holes: 'correct.focus.holes.hint',
    };
    this.focusHint.textContent = t(hint[this.s.correction.focus]);
    this.fixAll.textContent = busy ? t('correct.running') : t('correct.all');

    this.editToggle.disabled = !loaded;
    this.editToggle.textContent = t(st.editing ? 'edit.stop' : 'edit.start');
    this.editToggle.setAttribute('aria-pressed', String(st.editing));
    this.editToggle.classList.toggle('primary', st.editing);
    this.tools.hidden = !st.editing;
    this.selInfo.textContent = !st.pointsVisible
      ? t('edit.zoom')
      : st.selection
        ? t('edit.selection', { n: formatNumber(st.selection) })
        : t('edit.none');
    this.selDelete.disabled = this.selThin.disabled = !st.selection || busy;
    this.thinShare.setAttribute('aria-label', t('edit.thin'));

    this.undoBtn.disabled = !f?.undo.length || busy;
    this.redoBtn.disabled = !f?.redo.length || busy;
    this.revertBtn.disabled = !FileList.edited(f) || busy;
    this.saveDst.disabled = this.savePes.disabled = !loaded || busy;

    this.report.replaceChildren(...this.message(st.message));

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
    if (m.kind === 'text') return [p(m.text)];
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
}
