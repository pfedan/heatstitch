import type { Metric } from '../density/grid';
import { formatNumber, onLangChange, t, type Key } from '../i18n';
import { COLOR_SECONDS, FILL, RUNNING, SATIN, TIE_STITCH } from '../model/sequence';
import { KIND_COLORS, LENGTH_COLORS, LONG_MM, MAX_MM, ORDER_CSS } from '../render/flow';
import type { ColorBy, Marks, Settings } from '../settings';
import { FABRICS } from '../validation/profiles';
import { SHORT_STITCH_MM } from '../validation/thresholds';

/** 'density' needs a recompute in the worker, 'style' new stitch colors, 'render' only a redraw. */
export type ChangeKind = 'density' | 'style' | 'render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rgb = (c: { r: number; g: number; b: number }) => `rgb(${c.r}, ${c.g}, ${c.b})`;

/** Fabric colors offered for the background; null is the theme's own. */
export const BACKGROUNDS: [string | null, Key][] = [
  [null, 'bg.default'],
  ['#ffffff', 'bg.white'],
  ['#ece4d4', 'bg.natural'],
  ['#b9b9bd', 'bg.gray'],
  ['#1b1b1d', 'bg.black'],
  ['#1f2b47', 'bg.navy'],
  ['#9b2430', 'bg.red'],
];

/** What the view button on the stage says: the look that is on. */
function viewName(s: Settings): string {
  // Shapes first: they replace the stitches, realistic or not, and the stage should say so.
  if (s.mode === 'flow' && s.shapesView) return t('design.view.shapes');
  if (s.realistic && (s.mode === 'flow' || s.mode === 'image' || s.overlay)) return t('design.view.realistic');
  if (s.mode !== 'flow') return t('design.view.title');
  if (s.colorBy !== 'thread') return t(`colorBy.${s.colorBy}` as Key);
  return t('design.view.stitches');
}

/** Heatmap controls of the inspector, and the coloring, display and marker controls of the view menu on the stage. */
export function bindControls(s: Settings, onChange: (kind: ChangeKind) => void): { refresh: () => void } {
  const metricInputs = document.querySelectorAll<HTMLInputElement>('input[name="metric"]');
  const colorBy = document.querySelectorAll<HTMLInputElement>('input[name="color-by"]');
  const markInputs = document.querySelectorAll<HTMLInputElement>('input[data-mark]');
  const marksToggle = $<HTMLButtonElement>('marks-toggle');
  const shapesSeg = document.querySelectorAll<HTMLButtonElement>('#shapes-seg button');
  const marksBox = document.querySelector<HTMLElement>('fieldset.marks')!;
  const cell = $<HTMLInputElement>('cell');
  const blur = $<HTMLInputElement>('blur');
  const max = $<HTMLInputElement>('max');
  const showValidation = $<HTMLInputElement>('show-validation');
  const includeJumps = $<HTMLInputElement>('include-jumps');
  const overlay = $<HTMLInputElement>('overlay');
  const opacity = $<HTMLInputElement>('opacity');
  const realistic = $<HTMLInputElement>('realistic');
  const shapesView = $<HTMLInputElement>('shapes-view');
  const scaleBar = $<HTMLInputElement>('scale-bar-show');
  const threadWidth = $<HTMLInputElement>('thread-width');
  const liveLight = $<HTMLInputElement>('live-light');
  const fabricLook = $<HTMLSelectElement>('fabric-look');
  const spm = $<HTMLSelectElement>('machine-spm');
  const key = $<HTMLElement>('color-key');
  const stage = $<HTMLElement>('stage');
  const bgBox = $<HTMLElement>('bg-swatches');
  const bgButtons = BACKGROUNDS.map(([color, label]) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'bg-sw', title: t(label) });
    b.dataset.i18nTitle = b.dataset.i18nAria = label;
    b.setAttribute('aria-label', t(label));
    if (color) b.style.background = color;
    else b.classList.add('bg-theme');
    b.addEventListener('click', () => {
      s.background = color;
      refresh();
      onChange('render');
    });
    return [color, b] as const;
  });
  const bgOwn = Object.assign(document.createElement('input'), { type: 'color', className: 'bg-own' });
  bgOwn.dataset.i18nTitle = bgOwn.dataset.i18nAria = 'bg.own';
  bgOwn.title = t('bg.own');
  bgOwn.setAttribute('aria-label', t('bg.own'));
  // While the color is chosen the stage follows; it is saved when the picker closes.
  bgOwn.addEventListener('input', () => {
    s.background = bgOwn.value.toLowerCase();
    refresh();
    onChange('render');
  });
  bgBox.append(...bgButtons.map(([, b]) => b), bgOwn);

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
    // Thread colors need no key: they are the colors of the list.
    if (s.colorBy === 'thread') return key.replaceChildren();
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
    marksToggle.setAttribute('aria-pressed', String(s.marksOn));
    marksToggle.title = t(s.marksOn ? 'design.view.marksOn' : 'design.view.marksOff');
    shapesSeg.forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.shapes === 'on') === s.shapesView)));
    $('view-name').textContent = viewName(s);
    $('realistic-sub').classList.toggle('off', !s.realistic);
    marksBox.classList.toggle('all-off', !s.marksOn);
    marksBox.querySelector('legend')!.dataset.off = t('marks.allOff');
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
    shapesView.checked = s.shapesView;
    scaleBar.checked = s.scaleBar;
    threadWidth.value = String(s.threadMm);
    threadWidth.disabled = !s.realistic;
    liveLight.checked = s.liveLight;
    liveLight.disabled = !s.realistic;
    fabricLook.replaceChildren(
      new Option(t('controls.fabric.flat'), 'flat'),
      ...FABRICS.map((f) => new Option(t(`fabric.${f.id}` as Key), f.id)),
    );
    fabricLook.value = s.fabricLook ? s.profile.fabric : 'flat';
    fabricLook.disabled = !s.realistic;
    spm.value = String(s.machineSpm);
    $<HTMLInputElement>('trim-seconds').value = String(s.trimSeconds);
    $<HTMLInputElement>('color-seconds').value = String(s.colorSeconds);
    // Up to 15 s counts as a machine that changes by itself.
    const needles = s.colorSeconds <= 15 ? 'multi' : 'single';
    document.querySelectorAll<HTMLInputElement>('input[name="machine-needles"]').forEach((r) => (r.checked = r.value === needles));
    $('cell-out').textContent = `${formatNumber(s.cellMm, 2)} mm`;
    $('blur-out').textContent = s.blurMm > 0 ? `${formatNumber(s.blurMm, 1)} mm` : t('controls.off');
    $('thread-width-out').textContent = `${formatNumber(s.threadMm, 2)} mm`;
    stage.style.setProperty('--stage', s.background ?? '');
    if (!s.background) stage.style.removeProperty('--stage');
    let named: Key | null = null;
    for (const [color, b] of bgButtons) {
      const pressed = color === s.background;
      b.setAttribute('aria-pressed', String(pressed));
      if (pressed) named = BACKGROUNDS.find(([c]) => c === color)![1];
    }
    bgOwn.classList.toggle('on', !named);
    if (s.background) bgOwn.value = s.background;
    $('bg-out').textContent = named ? t(named) : (s.background ?? '');
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
  markInputs.forEach((i) =>
    on(i, 'change', () => {
      s.marks = { ...s.marks, [i.dataset.mark as keyof Marks]: i.checked };
      // Choosing a marker shows it, so the global switch comes back on.
      if (i.checked) s.marksOn = true;
      return 'render';
    }),
  );
  shapesSeg.forEach((b) => on(b, 'click', () => ((s.shapesView = b.dataset.shapes === 'on'), 'render')));
  on(marksToggle, 'click', () => ((s.marksOn = !s.marksOn), 'render'));
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
  on(shapesView, 'change', () => ((s.shapesView = shapesView.checked), 'render'));
  on(scaleBar, 'change', () => ((s.scaleBar = scaleBar.checked), 'render'));
  on(threadWidth, 'input', () => ((s.threadMm = Number(threadWidth.value)), 'render'));
  on(liveLight, 'change', () => ((s.liveLight = liveLight.checked), 'render'));
  fabricLook.addEventListener('change', () => {
    s.fabricLook = fabricLook.value !== 'flat';
    if (s.fabricLook && fabricLook.value !== s.profile.fabric) {
      // The fabric shown is the material of the profile: picking one here switches the profile (and so
      // the checks and stitch defaults) just like the picker in the Dichte mode.
      const profileFabric = $<HTMLSelectElement>('fabric');
      profileFabric.value = fabricLook.value;
      profileFabric.dispatchEvent(new Event('change'));
    }
    refresh();
    onChange('render');
  });
  on(spm, 'change', () => ((s.machineSpm = Number(spm.value)), 'render'));
  // Trim and thread change times: picking the machine sets the usual thread change time.
  const trimSec = $<HTMLInputElement>('trim-seconds');
  const colorSec = $<HTMLInputElement>('color-seconds');
  const seconds = (i: HTMLInputElement, max: number, d: number) => {
    const v = Number(i.value.replace(',', '.'));
    return Number.isFinite(v) && v >= 0 ? Math.min(max, v) : d;
  };
  on(trimSec, 'change', () => ((s.trimSeconds = seconds(trimSec, 60, s.trimSeconds)), refresh(), 'render'));
  on(colorSec, 'change', () => ((s.colorSeconds = seconds(colorSec, 300, s.colorSeconds)), refresh(), 'render'));
  document.querySelectorAll<HTMLInputElement>('input[name="machine-needles"]').forEach((r) =>
    on(r, 'change', () => ((s.colorSeconds = COLOR_SECONDS[r.value as 'single' | 'multi']), refresh(), 'render')),
  );

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
  onLangChange(refresh);
  return { refresh };
}
