import './design.css';
import { applyI18n, formatNumber, onLangChange, t, type Key } from '../../i18n';
import type { Measurement } from '../../validation/measure';
import { hoopFit } from '../../model/hoop';
import type { Pattern } from '../../model/pattern';
import type { Viewport } from '../../render/viewport';
import type { Settings } from '../../settings';
import { canRun, command, commandTitle, getCommand } from '../../shell/commands';
import { popover } from '../../shell/popover';
import { section, showMenu } from '../../shell/ui';
import { BACKGROUNDS } from '../../ui/controls';
import type { FileList } from '../../ui/fileList';
import type { Player } from '../../ui/player';
import { addIcons } from './icons';
import { createThreads } from './threads';
import { createTraceSection } from './trace';
import type { TraceControl } from '../../app/trace';

/** What the area needs from the rest of the app. */
export interface DesignApp {
  readonly files: FileList;
  readonly settings: Settings;
  readonly player: Player;
  readonly vp: Viewport;
  readonly stage: HTMLElement;
  readonly fitView: () => void;
  readonly fitToHoop: () => void;
  readonly redraw: () => void;
  readonly applyEdit: (p: Pattern, m?: Measurement) => void;
  readonly trace: TraceControl;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** CSS pixels per mm at actual size (96 px per inch): the zoom of 100 %. */
const REAL_SCALE = 96 / 25.4;
const ZOOM_STEP = 1.25;

/**
 * Area "design" (Stickmuster und Ansicht): the design page of the inspector (hoop, material,
 * threads, figures), the view bar on the stage with its menu, the player at the foot of the stage,
 * and the commands for all of them.
 */
export function initDesign(app: DesignApp): { render: () => void } {
  addIcons();
  const s = app.settings;
  const pattern = () => app.files.active?.pattern ?? null;
  const mode = () => s.mode;

  // Design page ----------------------------------------------------------------------------------

  const page = $('design-page');
  const titled = (d: HTMLDetailsElement, key: Key) => {
    d.querySelector<HTMLElement>('.sec-title')!.dataset.i18n = key;
    return d;
  };
  const summary = () => Object.assign(document.createElement('span'), { className: 'sec-sum' });
  const sums = { hoop: summary(), trace: summary(), material: summary(), threads: summary(), stats: summary() };
  const threads = createThreads(app);
  const trace = createTraceSection(app);
  const secs = {
    hoop: titled(section('design.hoop', 'hoop.title', [$('hoop-panel')], { extra: sums.hoop }), 'hoop.title'),
    trace: titled(section('design.trace', 'design.trace.title', [trace.el], { extra: sums.trace }), 'design.trace.title'),
    material: titled(section('design.material', 'profile.title', [$('material-panel')], { extra: sums.material }), 'profile.title'),
    threads: titled(section('design.threads', 'design.threads.title', [threads.el], { extra: sums.threads }), 'design.threads.title'),
    stats: titled(section('design.stats', 'stats.title', [$('stats-panel')], { extra: sums.stats }), 'stats.title'),
  };
  secs.threads.dataset.mode = 'flow';
  // The tracing image is only drawn in Ablauf (Gestalten).
  secs.trace.dataset.mode = 'flow';
  const empty = Object.assign(document.createElement('p'), { className: 'insp-empty muted design-empty' });
  empty.dataset.i18n = 'design.empty';
  page.replaceChildren(empty, secs.hoop, secs.trace, secs.material, secs.threads, secs.stats);
  applyI18n(page);

  /** Shows the design page with one section open and in view, focusing `focus` in it. */
  const reveal = (sec: HTMLDetailsElement, focus?: string) => {
    if (mode() === 'flow') document.querySelector<HTMLButtonElement>('#insp-tabs [data-tab="design"]')?.click();
    sec.open = true;
    sec.scrollIntoView({ block: 'nearest' });
    if (focus) $(focus)?.focus({ preventScroll: true });
  };

  // View bar and its menu ------------------------------------------------------------------------

  // The menu lies on the page, not in the stage, so a small stage does not cut it off; it opens
  // upwards from the bar, its right edge on the bar's.
  const pop = $('view-pop');
  document.body.append(pop);
  const placePop = () => {
    const r = $('view-bar').getBoundingClientRect();
    pop.style.bottom = `${Math.max(8, innerHeight - r.top + 8)}px`;
    pop.style.left = `${Math.max(8, Math.min(r.right, innerWidth - 8) - pop.offsetWidth)}px`;
  };
  const viewPop = popover($('view-button'), pop, { onOpen: placePop });
  window.addEventListener('resize', () => viewPop.isOpen() && placePop());
  const zoomBtn = $<HTMLButtonElement>('zoom-button');
  zoomBtn.addEventListener('click', () => {
    const r = zoomBtn.getBoundingClientRect();
    showMenu(['view.zoomIn', 'view.zoomOut', 'view.zoomReal', '-', 'view.fit'], { x: r.left, y: r.top }, t('design.view.title'));
    // The menu opens upwards: the bar sits at the foot of the stage.
    const menu = document.querySelector<HTMLElement>('body > .menu:last-of-type');
    if (menu) {
      menu.style.top = `${Math.max(8, r.top - menu.offsetHeight - 6)}px`;
      menu.style.left = `${Math.max(8, $('view-bar').getBoundingClientRect().right - menu.offsetWidth)}px`;
    }
  });
  const zoomAt = (factor: number) => {
    app.vp.zoomAt(app.stage.clientWidth / 2, app.stage.clientHeight / 2, factor);
    app.redraw();
  };
  const viewable = () => !!pattern() || mode() === 'image';

  // The hint and the view bar stand on the player; folded or hidden, it takes no room.
  const playerEl = app.player.root;
  const playerRoom = () => {
    const h = playerEl.classList.contains('folded') ? 0 : playerEl.offsetHeight;
    app.stage.style.setProperty('--player-h', `${h}px`);
  };
  new ResizeObserver(playerRoom).observe(playerEl);

  // Commands -------------------------------------------------------------------------------------

  const V = 'shell.group.view' as const;
  const P = 'design.group.player' as const;
  const D = 'design.group.design' as const;
  const click = (sel: string) => () => document.querySelector<HTMLElement>(sel)?.click();
  const flow = () => mode() === 'flow';
  const enabled = (sel: string) => () => {
    const el = document.querySelector<HTMLInputElement>(sel);
    return !!el && !el.disabled;
  };

  command({ id: 'view.menu', label: 'design.cmd.viewMenu', group: V, icon: 'eye', run: () => viewPop.open() });
  command({ id: 'view.realistic', label: 'design.cmd.realistic', group: V, run: click('#realistic') });
  command({ id: 'view.liveLight', label: 'design.cmd.liveLight', group: V, when: enabled('#live-light'), run: click('#live-light') });
  command({ id: 'view.shapes', label: 'design.cmd.shapes', group: V, icon: 'view-shapes', keys: ['S'], bind: false, when: flow, run: click('#shapes-seg [aria-pressed="false"]') });
  for (const by of ['thread', 'order', 'kind', 'length'] as const) {
    command({
      id: `view.colorBy.${by}`,
      label: `design.cmd.colorBy.${by}`,
      group: V,
      when: () => flow() && s.colorBy !== by,
      run: click(`input[name="color-by"][value="${by}"]`),
    });
  }
  // The frame's commands for marks and fit, pointed at this area's controls.
  command({ id: 'view.spot', label: 'design.cmd.spot', group: V, icon: 'spot', keys: ['A'], bind: false, when: () => mode() === 'flow', run: click('#spot-toggle') });
  command({ id: 'view.marks', label: 'design.cmd.marks', group: V, icon: 'marks', keys: ['H'], bind: false, when: () => mode() !== 'image', run: click('#marks-toggle') });
  for (const id of ['jumps', 'threads', 'trims', 'colors', 'ends', 'points'] as const) {
    const box = `input[data-mark="${id}"]`;
    command({
      id: `view.mark.${id}`,
      label: `design.cmd.mark.${id}`,
      group: V,
      when: () => mode() !== 'image' && (id !== 'threads' || flow()) && enabled(box)(),
      run: click(box),
    });
  }
  command({ id: 'view.fit', label: 'design.cmd.fit', group: V, icon: 'fit', keys: ['F'], bind: false, when: viewable, run: () => app.fitView() });
  command({ id: 'view.zoomIn', label: 'design.cmd.zoomIn', group: V, keys: ['+'], when: viewable, run: () => zoomAt(ZOOM_STEP) });
  command({ id: 'view.zoomOut', label: 'design.cmd.zoomOut', group: V, keys: ['-'], when: viewable, run: () => zoomAt(1 / ZOOM_STEP) });
  command({ id: 'view.zoomReal', label: 'design.cmd.zoomReal', group: V, keys: ['0'], when: viewable, run: () => zoomAt(REAL_SCALE / app.vp.scale) });
  command({
    id: 'view.background',
    label: 'design.cmd.background',
    group: V,
    run: () => {
      viewPop.open();
      document.querySelector<HTMLElement>('#bg-swatches [aria-pressed="true"], #bg-swatches .bg-own')?.focus();
    },
  });
  command({
    id: 'view.backgroundNext',
    label: 'design.cmd.backgroundNext',
    group: V,
    run: () => {
      const i = BACKGROUNDS.findIndex(([c]) => c === s.background);
      document.querySelectorAll<HTMLElement>('#bg-swatches .bg-sw')[(i + 1) % BACKGROUNDS.length]?.click();
    },
  });

  const playable = () => flow() && app.player.hasStitches;
  command({ id: 'player.play', label: 'design.cmd.play', group: P, icon: 'play', keys: ['Space'], bind: false, when: playable, run: () => app.player.toggle() });
  command({ id: 'player.prev', label: 'design.cmd.prev', group: P, keys: [','], bind: false, when: playable, run: () => app.player.step(-1) });
  command({ id: 'player.next', label: 'design.cmd.next', group: P, keys: ['.'], bind: false, when: playable, run: () => app.player.step(1) });
  command({ id: 'player.prev100', label: 'design.cmd.prev100', group: P, keys: ['Shift+,'], bind: false, when: playable, run: () => app.player.step(-100) });
  command({ id: 'player.next100', label: 'design.cmd.next100', group: P, keys: ['Shift+.'], bind: false, when: playable, run: () => app.player.step(100) });
  command({ id: 'player.start', label: 'design.cmd.start', group: P, keys: ['Home'], bind: false, when: playable, run: () => app.player.set(0) });
  command({ id: 'player.end', label: 'design.cmd.end', group: P, keys: ['End'], bind: false, when: playable, run: () => app.player.set(Number.MAX_SAFE_INTEGER) });
  command({ id: 'player.blockPrev', label: 'design.cmd.blockPrev', group: P, when: playable, run: () => app.player.block(-1) });
  command({ id: 'player.blockNext', label: 'design.cmd.blockNext', group: P, when: playable, run: () => app.player.block(1) });
  command({ id: 'player.fold', label: 'design.cmd.playerFold', group: P, when: () => flow() && !!pattern(), run: () => app.player.fold(!app.player.folded) });
  command({
    id: 'player.speed',
    label: 'design.cmd.speed',
    group: P,
    when: playable,
    run: () => {
      const speeds = [1, 10, 50, 250];
      const sel = $<HTMLSelectElement>('player-speed');
      sel.value = String(speeds[(speeds.indexOf(s.playSpeed) + 1) % speeds.length]);
      sel.dispatchEvent(new Event('change'));
    },
  });

  const designOpen = () => !!pattern() && mode() !== 'image';
  command({ id: 'design.hoop', label: 'design.cmd.hoop', group: D, when: designOpen, run: () => reveal(secs.hoop, 'hoop') });
  command({
    id: 'design.hoopFit',
    label: 'design.cmd.hoopFit',
    group: D,
    when: () => {
      const p = pattern();
      if (!p || !s.hoop || mode() === 'image') return false;
      const f = hoopFit(p.bounds, s.hoop);
      return !f.fits && !f.turned;
    },
    run: () => app.fitToHoop(),
  });
  command({ id: 'design.traceSection', label: 'design.cmd.traceSection', group: D, when: () => designOpen() && flow(), run: () => reveal(secs.trace) });
  command({ id: 'design.material', label: 'design.cmd.material', group: D, when: designOpen, run: () => reveal(secs.material, 'fabric') });
  command({ id: 'design.threads', label: 'design.cmd.threads', group: D, when: () => designOpen() && flow(), run: () => reveal(secs.threads) });
  command({ id: 'design.brand', label: 'design.cmd.brand', group: D, when: () => flow() && threads.canSwitch(), run: () => threads.switchAll() });
  command({ id: 'design.stats', label: 'design.cmd.stats', group: D, when: designOpen, run: () => reveal(secs.stats) });
  command({
    id: 'layout.resetColumns',
    label: 'design.cmd.resetColumns',
    group: 'shell.group.general',
    run: () => document.querySelectorAll('.resizer').forEach((r) => r.dispatchEvent(new MouseEvent('dblclick'))),
  });
  command({
    id: 'app.update',
    label: 'design.cmd.update',
    group: 'shell.group.general',
    when: () => !$('update-notice').hidden,
    run: click('#update-notice [data-update="reload"]'),
  });

  // Titles with keys -----------------------------------------------------------------------------

  const titles = () => {
    $('fit').title = commandTitle(getCommand('view.fit')!);
  };
  onLangChange(titles);
  titles();

  // Rendering --------------------------------------------------------------------------------------

  const render = () => {
    const f = app.files.active;
    const p = f?.pattern ?? null;
    page.classList.toggle('none', !p);
    $('zoom-out').textContent = `${formatNumber(Math.round((app.vp.scale / REAL_SCALE) * 100))} %`;
    zoomBtn.disabled = !viewable();
    $<HTMLButtonElement>('fit').disabled = !canRun('view.fit');
    if (!p) return;

    // What each section holds, in its head, so a closed section still tells.
    const b = p.bounds;
    const fit = s.hoop ? hoopFit(b, s.hoop) : null;
    sums.hoop.textContent = s.hoop ? `${s.hoop.w} × ${s.hoop.h}` : t('hoop.none');
    sums.hoop.classList.toggle('bad', !!fit && !fit.fits);
    sums.material.textContent = `${t(`fabric.${s.profile.fabric}` as Key).split(',')[0]}, ${s.profile.thread} wt`;
    sums.threads.textContent = threads.render(p);
    sums.trace.textContent = trace.render();
    const st = f!.stats;
    sums.stats.textContent = st ? `${formatNumber(st.stitches)} ${t('stats.stitches')}` : '';
  };

  return { render };
}
