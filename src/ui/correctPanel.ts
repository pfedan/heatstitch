import type { CorrectionReport } from '../correct/auto';
import { formatNumber, t } from '../i18n';
import type { Settings } from '../settings';
import type { OutputFormat } from '../writers';
import { FileList, type LoadedFile } from './fileList';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface CorrectHooks {
  /** Run the automatic correction on the whole design or the selected zone. */
  autoFix: (scope: 'all' | 'zone') => void;
  toggleEdit: () => void;
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
  selection: number;
  /** Penetrations are visible at the current zoom. */
  pointsVisible: boolean;
  message: CorrectMessage;
}

/** Correction options, auto-fix, manual edit tools, undo and save. */
export class CorrectPanel {
  private goal = document.querySelectorAll<HTMLInputElement>('input[name="fix-goal"]');
  private thin = $<HTMLInputElement>('fix-thin');
  private shorts = $<HTMLInputElement>('fix-shorts');
  private nudge = $<HTMLInputElement>('fix-nudge');
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
  private last: CorrectState | null = null;

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
    for (const [box, key] of [
      [this.thin, 'thin'],
      [this.shorts, 'shorts'],
      [this.nudge, 'nudge'],
    ] as const) {
      box.checked = c[key];
      box.addEventListener('change', () => {
        c[key] = box.checked;
        hooks.optionsChanged();
        if (this.last) this.update(this.last);
      });
    }
    this.fixAll.addEventListener('click', () => hooks.autoFix('all'));
    this.fixZone.addEventListener('click', () => hooks.autoFix('zone'));
    this.editToggle.addEventListener('click', () => hooks.toggleEdit());
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
    const anyFix = this.s.correction.thin || this.s.correction.shorts || this.s.correction.nudge;
    this.fixAll.disabled = !loaded || busy || !anyFix;
    this.fixZone.disabled = !loaded || busy || !anyFix || !st.zoneSelected;
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
  }

  private message(m: CorrectMessage): HTMLElement[] {
    const p = (text: string, cls = '') => Object.assign(document.createElement('p'), { textContent: text, className: cls });
    if (!m) return [];
    if (m.kind === 'busy') return [p(t('correct.running'), 'muted pending')];
    if (m.kind === 'text') return [p(m.text)];
    const r = m.report;
    const removed = r.stitchesBefore - r.stitchesAfter;
    if (!removed && !r.moved) {
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
      p(
        t('correct.removed', {
          n: formatNumber(removed),
          thin: formatNumber(r.thinned),
          short: formatNumber(r.merged),
          zero: formatNumber(r.zeroLength),
          moved: formatNumber(r.moved),
        }),
      ),
      p(t('correct.thread', { a: formatNumber(r.threadBefore / 1000, 1), b: formatNumber(r.threadAfter / 1000, 1) })),
    ];
    const goalCaution = this.s.correction.goal === 'caution';
    const left = r.after.criticalZones + (goalCaution ? r.after.cautionZones : 0);
    if (left) out.push(p(t('correct.left'), 'muted small'));
    return out;
  }
}
