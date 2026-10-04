import type { Metric } from '../density/grid';
import { formatNumber, t, type Key } from '../i18n';
import { FILL, RUNNING, SATIN, TIE_STITCH } from '../model/sequence';
import { KIND_COLORS, LENGTH_COLORS, LONG_MM, MAX_MM, ORDER_CSS } from '../render/flow';
import type { ColorBy, Marks, Settings } from '../settings';
import { SHORT_STITCH_MM } from '../validation/thresholds';

/** 'density' needs a recompute in the worker, 'style' new stitch colors, 'render' only a redraw. */
export type ChangeKind = 'density' | 'style' | 'render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rgb = (c: { r: number; g: number; b: number }) => `rgb(${c.r}, ${c.g}, ${c.b})`;

/** Heatmap, coloring, display and marker controls of the sidebar. */
export function bindControls(s: Settings, onChange: (kind: ChangeKind) => void): { refresh: () => void } {
  const metricInputs = document.querySelectorAll<HTMLInputElement>('input[name="metric"]');
  const colorBy = document.querySelectorAll<HTMLInputElement>('input[name="color-by"]');
  const markInputs = document.querySelectorAll<HTMLInputElement>('input[data-mark]');
  const cell = $<HTMLInputElement>('cell');
  const blur = $<HTMLInputElement>('blur');
  const max = $<HTMLInputElement>('max');
  const showValidation = $<HTMLInputElement>('show-validation');
  const includeJumps = $<HTMLInputElement>('include-jumps');
  const overlay = $<HTMLInputElement>('overlay');
  const opacity = $<HTMLInputElement>('opacity');
  const realistic = $<HTMLInputElement>('realistic');
  const threadWidth = $<HTMLInputElement>('thread-width');
  const spm = $<HTMLSelectElement>('machine-spm');
  const key = $<HTMLElement>('color-key');

  const renderKey = () => {
    const item = (color: string, text: string) => {
      const li = document.createElement('li');
      const sw = Object.assign(document.createElement('span'), { className: 'sw' });
      sw.style.background = color;
      li.append(sw, text);
      return li;
    };
    const list = document.createElement('ul');
    const note = (k: Key) => Object.assign(document.createElement('p'), { className: 'muted small', textContent: t(k) });
    if (s.colorBy === 'thread') return key.replaceChildren(note('colorBy.thread.hint'));
    if (s.colorBy === 'order') {
      const bar = Object.assign(document.createElement('div'), { className: 'gradient' });
      bar.style.background = ORDER_CSS;
      const ends = document.createElement('div');
      ends.className = 'gradient-ends';
      ends.append(Object.assign(document.createElement('span'), { textContent: t('colorBy.order.early') }), Object.assign(document.createElement('span'), { textContent: t('colorBy.order.late') }));
      return key.replaceChildren(bar, ends);
    }
    if (s.colorBy === 'kind') {
      const kinds: [number, Key][] = [
        [SATIN, 'kind.satin'],
        [FILL, 'kind.fill'],
        [RUNNING, 'kind.running'],
        [TIE_STITCH, 'kind.tie'],
      ];
      list.append(...kinds.map(([k, label]) => item(rgb(KIND_COLORS[k]), t(label))));
      return key.replaceChildren(list, note('kind.hint'));
    }
    list.append(
      item(rgb(LENGTH_COLORS.short), t('length.short', { v: formatNumber(SHORT_STITCH_MM, 1) })),
      item(rgb(LENGTH_COLORS.normal), t('length.normal')),
      item(rgb(LENGTH_COLORS.long), t('length.long', { v: formatNumber(LONG_MM) })),
      item(rgb(LENGTH_COLORS.max), t('length.max', { v: formatNumber(MAX_MM, 1) })),
      item(rgb(LENGTH_COLORS.tie), t('length.tie')),
    );
    key.replaceChildren(list);
  };

  const refresh = () => {
    metricInputs.forEach((i) => (i.checked = i.value === s.metric));
    colorBy.forEach((i) => (i.checked = i.value === s.colorBy));
    markInputs.forEach((i) => {
      i.checked = s.marks[i.dataset.mark as keyof Marks];
      // On the heatmap the markers come with the stitch plan.
      i.disabled = s.mode === 'density' && !s.overlay;
    });
    cell.value = String(s.cellMm);
    blur.value = String(s.blurMm);
    // Leave the number field alone while the user is typing in it.
    if (document.activeElement !== max) max.value = String(s.scales[s.metric].max);
    showValidation.checked = s.showValidation;
    includeJumps.checked = s.includeJumps;
    includeJumps.disabled = s.metric !== 'thread';
    overlay.checked = s.overlay;
    opacity.value = String(s.opacity);
    opacity.disabled = !s.overlay;
    realistic.checked = s.realistic;
    threadWidth.value = String(s.threadMm);
    threadWidth.disabled = !s.realistic;
    spm.value = String(s.machineSpm);
    $('cell-out').textContent = `${formatNumber(s.cellMm, 2)} mm`;
    $('blur-out').textContent = s.blurMm > 0 ? `${formatNumber(s.blurMm, 1)} mm` : t('controls.off');
    $('thread-width-out').textContent = `${formatNumber(s.threadMm, 2)} mm`;
    $('opacity-out').textContent = `${Math.round(s.opacity * 100)} %`;
    $('unit-hint').textContent = t(s.metric === 'thread' ? 'unit.thread' : 'unit.penetrations');
    renderKey();
  };

  const on = (el: HTMLElement, ev: string, fn: () => ChangeKind) =>
    el.addEventListener(ev, () => {
      const kind = fn();
      refresh();
      onChange(kind);
    });

  metricInputs.forEach((i) =>
    on(i, 'change', () => {
      s.metric = i.value as Metric;
      return 'density';
    }),
  );
  colorBy.forEach((i) => on(i, 'change', () => ((s.colorBy = i.value as ColorBy), 'style')));
  markInputs.forEach((i) => on(i, 'change', () => ((s.marks = { ...s.marks, [i.dataset.mark as keyof Marks]: i.checked }), 'render')));
  on(cell, 'input', () => ((s.cellMm = Number(cell.value)), 'density'));
  on(blur, 'input', () => ((s.blurMm = Number(blur.value)), 'density'));
  on(includeJumps, 'change', () => ((s.includeJumps = includeJumps.checked), 'density'));
  on(max, 'input', () => {
    const v = Number(max.value);
    if (v > 0) s.scales[s.metric].max = v;
    return 'render';
  });
  on(showValidation, 'change', () => ((s.showValidation = showValidation.checked), 'render'));
  on(overlay, 'change', () => ((s.overlay = overlay.checked), 'render'));
  on(opacity, 'input', () => ((s.opacity = Number(opacity.value)), 'render'));
  on(realistic, 'change', () => ((s.realistic = realistic.checked), 'render'));
  on(threadWidth, 'input', () => ((s.threadMm = Number(threadWidth.value)), 'render'));
  on(spm, 'change', () => ((s.machineSpm = Number(spm.value)), 'render'));

  // Collapsible sidebar sections remember whether they are open.
  document.querySelectorAll<HTMLDetailsElement>('details[data-section]').forEach((d) => {
    const id = d.dataset.section!;
    d.open = s.sections[id] ?? false;
    d.addEventListener('toggle', () => {
      s.sections = { ...s.sections, [id]: d.open };
      onChange('render');
    });
  });

  refresh();
  return { refresh };
}
