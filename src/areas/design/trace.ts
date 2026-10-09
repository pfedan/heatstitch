import { formatNumber, onLangChange, t, type Key } from '../../i18n';
import { traceOf, TRACE_MAX_MM, TRACE_MIN_MM, type Trace } from '../../model/trace';
import type { TraceControl } from '../../app/trace';
import { command } from '../../shell/commands';
import { h, icon, swap } from '../../shell/h';
import { toast } from '../../shell/ui';
import type { FileList } from '../../ui/fileList';
import type { Settings } from '../../settings';

export interface TraceSectionApp {
  readonly files: FileList;
  readonly settings: Settings;
  readonly trace: TraceControl;
  readonly fitView: () => void;
}

/** A small picture of the image for its row, made once per image. */
const thumbs = new WeakMap<Uint8Array, string>();
const thumbOf = (tr: Trace): string => {
  let url = thumbs.get(tr.data);
  if (!url) {
    url = URL.createObjectURL(new Blob([tr.data as BlobPart], { type: tr.type }));
    thumbs.set(tr.data, url);
  }
  return url;
};

/**
 * The section "Vorlage" of the design page: the tracing image of the design with its eye, lock and
 * remove buttons and its width, or a button to choose one. Its commands, too.
 */
export function createTraceSection(app: TraceSectionApp): { el: HTMLElement; render: (force?: boolean) => string } {
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const choose = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      await app.trace.layFile(f);
      app.fitView();
    } catch (err) {
      console.error('Reading the tracing image failed', err);
      toast(t('design.trace.failed', { name: f.name }));
    }
  };
  file.addEventListener('change', () => void choose());
  const pick = () => file.click();

  const el = h('div', { class: 'trace-panel' });
  const current = () => {
    const f = app.files.active;
    return f?.pattern ? traceOf(f.pattern) : null;
  };
  const view = () => app.files.active?.traceView;

  const iconButton = (id: string, name: string, label: Key, onclick: () => void, pressed?: boolean) =>
    h(
      'button',
      { type: 'button', class: 'icon trace-btn', 'data-command': id, title: t(label), 'aria-label': t(label), ...(pressed === undefined ? {} : { 'aria-pressed': String(pressed) }), onclick },
      icon(name),
    );

  const width = h('input', { type: 'number', min: TRACE_MIN_MM, max: TRACE_MAX_MM, step: 1, 'aria-label': t('design.trace.width') });
  width.addEventListener('input', () => app.trace.resize(Number(width.value), false));
  width.addEventListener('change', () => app.trace.resize(Number(width.value), true));

  /** What the section shows was drawn for; it is drawn anew only when that changes (not every frame). */
  let drawn: { tr: Trace | null; shown?: boolean; locked?: boolean; mode: string; sum: string } | null = null;

  /** Fills the section; returns what its head says while it is closed. */
  const render = (force = false): string => {
    const tr = current();
    const v = view();
    if (!force && drawn && drawn.tr === tr && drawn.shown === v?.shown && drawn.locked === v?.locked && drawn.mode === app.settings.mode) return drawn.sum;
    const sum = draw(tr);
    drawn = { tr, shown: v?.shown, locked: v?.locked, mode: app.settings.mode, sum };
    return sum;
  };

  const draw = (tr: Trace | null): string => {
    const v = view();
    if (!tr || !v) {
      swap(el,
        h('p', { class: 'trace-hint' }, t('design.trace.hint')),
        h('button', { type: 'button', class: 'trace-add', title: t('design.trace.add.hint'), onclick: pick }, icon('trace-image'), h('span', null, t('design.trace.add'))),
        file,
      );
      return t('design.trace.none');
    }
    // The width field keeps what is being typed into it.
    if (document.activeElement !== width) width.value = String(Math.round(tr.w));
    width.setAttribute('aria-label', t('design.trace.width'));
    const size = `${formatNumber(Math.round(tr.w))} × ${formatNumber(Math.round(tr.h))} mm`;
    swap(
      el,
      h(
        'div',
        { class: 'trace-row' },
        h('img', { class: 'trace-thumb', src: thumbOf(tr), alt: '' }),
        h('div', { class: 'trace-meta' }, h('span', { class: 'trace-name', title: tr.name }, tr.name || t('design.trace.title')), h('span', { class: 'trace-size' }, size)),
        h(
          'div',
          { class: 'trace-tools' },
          iconButton('design.trace.toggle', v.shown ? 'eye' : 'eye-off', v.shown ? 'design.trace.hide' : 'design.trace.show', () => app.trace.setView({ shown: !v.shown }), !v.shown),
          iconButton('design.trace.lock', v.locked ? 'lock' : 'unlock', v.locked ? 'design.trace.unlock' : 'design.trace.lock', () => app.trace.setView({ locked: !v.locked }), v.locked),
          iconButton('design.trace.remove', 'trash', 'design.trace.remove', () => app.trace.remove()),
        ),
      ),
      h('label', { class: 'trace-width' }, h('span', null, t('design.trace.width')), width, h('span', null, 'mm')),
      ...(v.shown && !v.locked && app.settings.mode === 'flow' ? [h('p', { class: 'trace-note' }, t('design.trace.free'))] : []),
      h('button', { type: 'button', class: 'link trace-replace', onclick: pick }, t('design.trace.replace')),
      file,
    );
    return v.shown ? t('design.trace.shown') : t('design.trace.hidden');
  };
  onLangChange(() => render(true));

  // Commands -------------------------------------------------------------------------------------

  const D = 'design.group.design' as const;
  const open = () => !!app.files.active?.pattern && app.settings.mode !== 'image';
  const has = () => open() && !!current();
  command({ id: 'design.trace.add', label: 'design.cmd.trace.add', group: D, icon: 'trace-image', when: open, run: pick });
  command({ id: 'design.trace.toggle', label: 'design.cmd.trace.toggle', group: D, icon: 'eye', keys: ['Shift+B'], when: has, run: () => app.trace.setView({ shown: !view()!.shown }) });
  command({ id: 'design.trace.lock', label: 'design.cmd.trace.lock', group: D, icon: 'lock', when: has, run: () => app.trace.setView({ locked: !view()!.locked }) });
  command({ id: 'design.trace.remove', label: 'design.cmd.trace.remove', group: D, icon: 'trash', when: has, run: () => app.trace.remove() });

  return { el, render };
}
