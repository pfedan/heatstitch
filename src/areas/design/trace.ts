import { formatNumber, onLangChange, t, type Key } from '../../i18n';
import { traceOf, TRACE_MAX_MM, TRACE_MIN_MM, TRACE_OPACITY, TRACE_OPACITY_MAX, TRACE_OPACITY_MIN, type Trace } from '../../model/trace';
import type { TraceControl } from '../../app/trace';
import { command } from '../../shell/commands';
import { h, icon, swap } from '../../shell/h';
import { slider, toast } from '../../shell/ui';
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

  // The opacity slider is made once, so dragging it survives the section being drawn anew.
  const percent = (v: number) => `${formatNumber(Math.round(v * 100))} %`;
  const opacity = slider({
    label: t('design.trace.opacity'),
    min: TRACE_OPACITY_MIN,
    max: TRACE_OPACITY_MAX,
    step: 0.05,
    value: TRACE_OPACITY,
    format: percent,
    auto: { on: true, hint: t('design.trace.opacity.reset'), reset: () => setOpacity(TRACE_OPACITY) },
    oninput: (v) => app.trace.setOpacity(v, false),
    onchange: (v) => setOpacity(v),
  });
  opacity.classList.add('trace-opacity');
  const opacityInput = opacity.querySelector('input')!;
  const setOpacity = (v: number) => {
    app.trace.setOpacity(v, true);
    showOpacity(v);
  };
  /** The slider, its value and its dot (on while the default is used) for `v`. */
  const showOpacity = (v: number) => {
    if (document.activeElement !== opacityInput) opacityInput.value = String(v);
    opacity.querySelector('output')!.textContent = percent(v);
    const dot = opacity.querySelector<HTMLButtonElement>('.auto-dot')!;
    const on = Math.abs(v - TRACE_OPACITY) < 1e-6;
    dot.classList.toggle('on', on);
    dot.disabled = on;
  };
  onLangChange(() => {
    opacity.querySelector('.label > span')!.textContent = t('design.trace.opacity');
    const dot = opacity.querySelector<HTMLButtonElement>('.auto-dot')!;
    dot.title = t('design.trace.opacity.reset');
    dot.setAttribute('aria-label', t('design.trace.opacity.reset'));
  });

  /** What the section shows was drawn for; it is drawn anew only when that changes (not every frame). */
  let drawn: { tr: Trace | null; shown?: boolean; locked?: boolean; opacity?: number; mode: string; sum: string } | null = null;

  /** Fills the section; returns what its head says while it is closed. */
  const render = (force = false): string => {
    const tr = current();
    const v = view();
    if (!force && drawn && drawn.tr === tr && drawn.shown === v?.shown && drawn.locked === v?.locked && drawn.opacity === v?.opacity && drawn.mode === app.settings.mode) return drawn.sum;
    const sum = draw(tr);
    drawn = { tr, shown: v?.shown, locked: v?.locked, opacity: v?.opacity, mode: app.settings.mode, sum };
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
    showOpacity(v.opacity);
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
      opacity,
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
