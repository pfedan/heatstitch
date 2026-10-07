import './stitches.css';
import { formatNumber, onLangChange, t, type Key } from '../../i18n';
import type { Editor } from '../../ui/editor';
import type { FileList } from '../../ui/fileList';
import type { RungTool } from '../../ui/rungTool';
import type { StitchPanel } from '../../ui/stitchPanel';
import type { Settings } from '../../settings';
import { ui } from '../../app/state';
import { canRun, command, commandTitle, getCommand, keyLabel, runCommand } from '../../shell/commands';
import { h } from '../../shell/h';
import { showMenu, toast, type MenuItem } from '../../shell/ui';
import { effect } from '../../shell/signal';
import { setThinShare, THIN_SHARES, thinShare } from './state';

/** What the area "Stiche" needs from the rest of the app. */
export interface StitchAreaApp {
  readonly files: FileList;
  readonly settings: Settings;
  readonly editor: Editor;
  readonly rungTool: RungTool;
  readonly stitchPanel: StitchPanel;
  readonly closeRungs: () => void;
  readonly toggleRungs: () => void;
  readonly toggleGuides: () => void;
  readonly togglePoints: () => void;
  readonly sewAlongLines: () => void;
  readonly suggestLines: () => void;
  readonly setEditing: (on: boolean) => void;
  readonly enterObject: (o: number, fit: boolean) => void;
  readonly revealRecord: (i: number) => void;
  /** Whether single needle points can be picked where the pointer is (zoomed in far enough). */
  readonly pointsVisible: () => boolean;
  readonly redraw: () => void;
}

const G: Key = 'stitches.group';
const POINTED = ['rays', 'circles', 'swirl'];

/** Small icons of the area, drawn like the tool rail's (20 × 20, stroked). */
const ICON = {
  direction:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 15.5C6 9 9.5 5.5 16.5 3.5" /><path d="M6.5 17.5C9 11.5 12 8.5 17.5 7" /><path d="M5 12.6l3.6 2.3M7.6 9.2l3.3 2.6M10.8 6.4l2.8 3" /></svg>',
  hand: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 15l4-9 4 9 4-9" /><circle cx="3" cy="15" r="1.6" class="node" /><circle cx="7" cy="6" r="1.6" class="node" /><circle cx="11" cy="15" r="1.6" class="node" /><circle cx="15" cy="6" r="1.6" class="node" /></svg>',
  prev: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 5l-5 5 5 5" /></svg>',
  next: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5l5 5-5 5" /></svg>',
  help: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M8 8a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.4M10 13.6v.1" /></svg>',
  wand: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 16.5l9-9" /><path d="M11 6l3 3" /><path d="M15 2.5v3M13.5 4h3M16.5 9.5v2M15.5 10.5h2M7.5 3v2M6.5 4h2" /></svg>',
  more: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1.2" /><circle cx="10" cy="10" r="1.2" /><circle cx="15" cy="10" r="1.2" /></svg>',
};

/**
 * The area "Stiche" of the new interface: its commands (stitch types, the direction and guide
 * line tools, stitches by hand), the options bar over the stage while one of its tools is on, and
 * its two tools in the tool rail.
 */
export function initStitchArea(app: StitchAreaApp): { refresh: () => void } {
  const panel = app.stitchPanel;
  const rt = app.rungTool;
  const ed = app.editor;
  const flow = () => app.settings.mode === 'flow';
  const info = () => (flow() ? panel.current : null);
  const one = () => ui.selectedObjects.size === 1;
  const rungsOn = () => rt.active && flow();
  const undoAction = () => ({ label: t('edit.undo'), run: () => void runCommand('edit.undo') });

  // Stitch types -------------------------------------------------------------------------------------
  for (const [k, label] of [['fill', 'stitches.cmd.kindFill'], ['satin', 'stitches.cmd.kindSatin'], ['line', 'stitches.cmd.kindLine']] as const) {
    command({ id: `stitch.kind.${k}`, label, group: G, when: () => flow() && panel.canConvert(k), run: () => panel.convert(k) });
  }
  command({ id: 'stitch.reroll', label: 'stitches.cmd.reroll', group: G, when: () => flow() && panel.canReroll(), run: () => panel.reroll() });

  // Direction, guide lines, points ----------------------------------------------------------------------
  const directionFor = () => {
    const i = info();
    return !!i && one() && !i.free?.on && !i.outline && ((!!i.direction?.single && panel.shownKind === 'satin') || (!!i.draw?.single && !i.asLine && panel.shownKind === 'fill'));
  };
  command({
    id: 'stitch.direction',
    label: 'stitches.cmd.direction',
    group: G,
    keys: ['R'],
    bind: false,
    when: () => (rungsOn() && (rt.mode === 'satin' || rt.mode === 'fill')) || directionFor(),
    run: () => app.toggleRungs(),
  });
  command({
    id: 'stitch.guides',
    label: 'stitches.cmd.guides',
    group: G,
    keys: ['G'],
    bind: false,
    when: () => (rungsOn() && rt.mode === 'guide') || (!!info()?.guide?.single && !info()?.free?.on && !info()?.outline && panel.shownKind === 'fill'),
    run: () => app.toggleGuides(),
  });
  command({
    id: 'stitch.points',
    label: 'stitches.cmd.points',
    group: G,
    when: () => (rungsOn() && rt.mode === 'points') || (!!info()?.points?.single && POINTED.includes(panel.fillPattern ?? '')),
    run: () => app.togglePoints(),
  });
  const drawing = () => rungsOn() && (rt.mode === 'satin' || rt.mode === 'fill');
  command({ id: 'stitch.pen.rung', label: 'stitches.cmd.penRung', group: G, when: () => drawing() && rt.cutMode, run: () => rt.setCutMode(false) });
  command({ id: 'stitch.pen.cut', label: 'stitches.cmd.penCut', group: G, when: () => drawing() && !rt.cutMode, run: () => rt.setCutMode(true) });
  command({ id: 'stitch.pen.toggle', label: 'stitches.cmd.penToggle', group: G, keys: ['T'], bind: false, when: drawing, run: () => rt.setCutMode(!rt.cutMode), palette: false });
  const satinTool = () => rungsOn() && rt.mode === 'satin';
  const dir = () => info()?.direction;
  command({ id: 'stitch.rungs.corners', label: 'stitches.cmd.corners', group: G, when: satinTool, run: () => rt.corners() });
  command({ id: 'stitch.rungs.sections', label: 'stitches.cmd.sections', group: G, when: satinTool, run: () => rt.sections() });
  command({ id: 'stitch.rungs.order', label: 'stitches.cmd.order', group: G, when: () => satinTool() && rt.chained, run: () => rt.bestOrder() });
  command({ id: 'stitch.rungs.even', label: 'stitches.cmd.even', group: G, when: () => satinTool() && dir()?.rungs !== 0, run: () => rt.even() });
  command({ id: 'stitch.rungs.follow', label: 'stitches.cmd.follow', group: G, when: () => satinTool() && dir()?.rungs !== null, run: () => rt.follow() });
  command({
    id: 'stitch.rungs.sew',
    label: 'stitches.cmd.sew',
    group: G,
    when: () => rungsOn() && rt.mode === 'fill' && rt.lines.length >= (rt.cutLines.length ? 1 : 2),
    run: () => app.sewAlongLines(),
  });
  command({ id: 'stitch.rungs.suggest', label: 'stitches.cmd.suggest', group: G, when: () => rungsOn() && (rt.mode === 'fill' || rt.sectioned), run: () => app.suggestLines() });
  command({ id: 'stitch.tool.done', label: 'stitches.cmd.toolDone', group: G, keys: ['Escape'], bind: false, when: rungsOn, run: () => app.closeRungs() });

  // What the selected objects are: left out of the correction, loosed, knocked out, linked -------------
  command({ id: 'stitch.lock', label: 'stitches.cmd.lock', group: G, when: () => !!info(), run: () => panel.lock(info()!.lock !== true) });
  command({ id: 'stitch.release', label: 'stitches.cmd.release', group: G, when: () => !!info()?.free?.can && info()?.free?.on !== true, run: () => panel.free(true) });
  command({ id: 'stitch.restitch', label: 'stitches.cmd.restitch', group: G, when: () => !!info()?.free?.on, run: () => panel.free(false) });
  command({ id: 'stitch.knockout', label: 'stitches.cmd.knockout', group: G, when: () => !!info()?.knockout && !info()?.free?.on, run: () => panel.knockout(info()!.knockout!.on !== true) });
  command({ id: 'stitch.parent', label: 'stitches.cmd.parent', group: G, when: () => info()?.outline?.fill != null, run: () => panel.outline('fill') });
  command({ id: 'stitch.detach', label: 'stitches.cmd.detach', group: G, when: () => !!info()?.outline, run: () => panel.outline('detach') });

  // Stitches by hand -----------------------------------------------------------------------------------
  const hasPattern = () => !!app.files.active?.pattern && app.settings.mode !== 'image';
  command({
    id: 'edit.stitches',
    label: 'stitches.cmd.edit',
    group: G,
    keys: ['E'],
    bind: false,
    when: () => hasPattern() && (ed.active || !info()?.outline),
    run: () => app.setEditing(!ed.active),
  });
  // Esc leaves the stitches as level.up (src/areas/shapes) says; this is the bar's "Fertig".
  command({ id: 'edit.done', label: 'stitches.cmd.editDone', group: G, when: () => ed.active, run: () => app.setEditing(false) });
  command({ id: 'edit.selectAll', label: 'stitches.cmd.selectAll', group: G, keys: ['Mod+A'], bind: false, when: () => ed.active, run: () => ed.selectAll() });
  command({
    id: 'edit.delete',
    label: 'stitches.cmd.delete',
    group: G,
    // Bound here (not in src/app/keys.ts), so the key also says what was deleted, with the way back.
    keys: ['Delete', 'Backspace'],
    when: () => (ed.active && ed.selection.size > 0) || (rungsOn() && !!rt.selected),
    run: () => {
      if (ed.active && ed.selection.size) {
        const n = ed.selection.size;
        ed.deleteSelection();
        toast(t('stitches.deleted', { n: formatNumber(n) }), undoAction());
      } else if (rt.deleteSelected()) app.redraw();
    },
  });
  command({ id: 'edit.split', label: 'stitches.cmd.split', group: G, keys: ['I'], bind: false, when: () => ed.active && ed.selection.size === 1, run: () => void ed.splitSelected() });
  command({
    id: 'edit.thin',
    label: 'stitches.cmd.thin',
    group: G,
    when: () => (ed.active && ed.selection.size > 0) || (!ed.active && flow() && one() && !!info() && !info()?.outline),
    run: () => thin(),
  });
  const step = (dir: 1 | -1) => {
    const i = ed.step(dir);
    if (i >= 0) app.revealRecord(i);
  };
  command({ id: 'edit.prev', label: 'stitches.cmd.prev', group: G, keys: [','], bind: false, when: () => ed.active, run: () => step(-1) });
  command({ id: 'edit.next', label: 'stitches.cmd.next', group: G, keys: ['.'], bind: false, when: () => ed.active, run: () => step(1) });

  /**
   * Thins out the rows and zigzags of the selected needle points, or (from the object page) of the
   * whole selected object, by the share chosen; one undo step, said in a note with the way back.
   */
  function thin(): void {
    const share = thinShare.peek();
    let n = 0;
    if (ed.active) n = ed.thinSelection(share);
    else {
      const o = [...ui.selectedObjects][0];
      app.enterObject(o, false);
      ed.selectAll();
      n = ed.thinSelection(share);
      app.setEditing(false);
    }
    if (n) toast(t('stitches.thin.done', { n: formatNumber(n) }), undoAction());
    else toast(t('edit.thin.none'));
  }

  // The options bar over the stage ------------------------------------------------------------------
  const bar = h('div', { class: 'stitch-bar', role: 'toolbar', 'aria-label': t('stitches.bar.label'), hidden: true });
  document.querySelector('#stage .stage-top')?.appendChild(bar);
  let barKey = '';

  /**
   * A button that runs a command: disabled when it cannot run, its key in the hint. With `more`,
   * it moves into the menu "…" of the bar when the stage is too narrow (higher numbers go first).
   */
  const cmdButton = (id: string, text: Key | null, opts: { icon?: string; primary?: boolean; hint?: Key; pressed?: boolean; more?: number } = {}) => {
    const c = getCommand(id)!;
    const b = h('button', {
      type: 'button',
      class: `bar-btn ${opts.primary ? 'primary' : ''} ${text ? '' : 'icon-only'}`,
      title: opts.hint ? `${t(opts.hint)}${c.keys?.[0] ? ` (${keyLabel(c.keys[0])})` : ''}` : commandTitle(c),
      disabled: !canRun(c),
    });
    if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
    if (!text) b.setAttribute('aria-label', t(c.label));
    if (opts.icon) b.insertAdjacentHTML('beforeend', opts.icon);
    if (text) b.append(h('span', null, t(text)));
    b.addEventListener('click', () => {
      runCommand(id);
    });
    return opts.more ? spare(b, opts.more, id) : b;
  };
  /** Marks a part of the bar that may give way on a narrow stage: into the menu "…" as `cmd`, or just hidden. */
  const spare = <T extends HTMLElement>(el: T, more: number, cmd?: string): T => {
    el.dataset.more = String(more);
    if (cmd) el.dataset.cmd = cmd;
    return el;
  };
  const sep = () => h('span', { class: 'bar-sep', 'aria-hidden': 'true' });
  const title = (text: Key) => h('span', { class: 'bar-title' }, t(text));
  const state = (text: string, more?: number) => {
    const el = h('span', { class: 'bar-state' }, text);
    return more ? spare(el, more) : el;
  };
  const help = (text: Key, more = 4) => {
    const b = h('button', { type: 'button', class: 'bar-btn icon-only', title: t(text), 'aria-label': t('stitches.bar.help') });
    b.innerHTML = ICON.help;
    b.addEventListener('click', () => toast(t(text)));
    b.dataset.label = t('stitches.bar.help');
    return spare(b, more);
  };
  /** Querlinie | Trennlinie: what a line drawn makes. */
  const pen = () => {
    const seg = h('div', { class: 'segmented bar-seg', role: 'radiogroup', 'aria-label': t('stitch.pen') });
    for (const v of ['rung', 'cut'] as const) {
      const on = (v === 'cut') === rt.cutMode;
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'active' : '', title: `${t(`stitch.pen.${v}.hint`)}` }, t(`stitch.pen.${v}`));
      b.addEventListener('click', () => runCommand(`stitch.pen.${v}`));
      seg.append(b);
    }
    return seg;
  };
  /** The share of "Ausdünnen" as three small buttons. */
  const shares = () => {
    const seg = h('div', { class: 'segmented bar-seg', role: 'radiogroup', 'aria-label': t('stitches.thin.share') });
    for (const [v, text] of THIN_SHARES) {
      const on = v === thinShare.peek();
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'active' : '', title: t('stitches.thin.share') }, text);
      b.addEventListener('click', () => setThinShare(v));
      seg.append(b);
    }
    return seg;
  };

  function barState(): string {
    const mode = app.settings.mode;
    if (mode === 'image') return '';
    if (ed.active) return JSON.stringify(['edit', ed.selection.size, ed.range !== null, app.pointsVisible(), thinShare(), mode]);
    if (!rungsOn()) return '';
    const d = dir();
    return JSON.stringify([rt.mode, rt.cutMode, rt.lines.length, rt.cutLines.length, rt.guides.length, d?.rungs, d?.cuts, d?.spacingHere, d?.chain, rt.chained, !!rt.selected, info()?.measured.fill?.pattern]);
  }

  function renderBar(): void {
    const items: HTMLElement[] = [];
    // Same rules as barState: nothing in Bild, the line tools only while one is on.
    const tool = rungsOn() ? rt.mode : null;
    if (app.settings.mode === 'image') {
      /* Bild draws no stitches */
    } else if (ed.active) {
      const n = ed.selection.size;
      const seen = ed.range !== null || app.pointsVisible();
      // The crumb over the stage already says "› Stiche": the bar starts with what is selected.
      items.push(
        state(n ? t(n === 1 ? 'edit.selection.one' : 'edit.selection', { n: formatNumber(n) }) : seen ? t('edit.none') : t('stitches.bar.zoom')),
        sep(),
        cmdButton('edit.selectAll', 'stitches.bar.all', { more: 3 }),
        cmdButton('edit.delete', 'edit.delete'),
        cmdButton('edit.split', 'edit.split', { hint: 'edit.split.hint', more: 4 }),
        sep(),
        spare(h('span', { class: 'bar-group' }, cmdButton('edit.thin', 'edit.thin'), shares()), 5, 'edit.thin'),
        sep(),
        cmdButton('edit.prev', null, { icon: ICON.prev, more: 6 }),
        cmdButton('edit.next', null, { icon: ICON.next, more: 6 }),
        help(app.settings.mode === 'flow' ? 'canvas.hint.flowEdit' : 'edit.hint', 7),
        cmdButton('edit.done', 'object.editDone', { primary: true }),
      );
    } else if (tool === 'satin') {
      const d = dir();
      const what = !d ? '' : d.rungs === null ? t('stitches.bar.follow') : d.rungs === 0 ? t('stitches.bar.even') : t('stitches.bar.rungs', { n: d.rungs });
      items.push(title('stitches.bar.direction'), state(d?.cuts ? `${what} · ${t('stitches.bar.cuts', { n: d.cuts + 1 })}` : what, 3), sep(), pen(), sep());
      // In sections of its area one suggestion does it all (cut lines and rungs); read in columns only, the corners and sections.
      if (rt.sectioned) items.push(cmdButton('stitch.rungs.suggest', 'stitches.bar.suggest', { icon: ICON.wand, hint: 'stitch.suggest.hint', more: 5 }));
      else items.push(cmdButton('stitch.rungs.corners', 'stitches.bar.corners', { hint: 'stitch.direction.corners.hint', more: 5 }), cmdButton('stitch.rungs.sections', 'stitches.bar.sections', { hint: 'stitch.sections.hint', more: 6 }));
      if (rt.chained) items.push(cmdButton('stitch.rungs.order', 'stitches.bar.order', { hint: 'stitch.order.best.hint', more: 7 }));
      items.push(cmdButton('stitch.rungs.even', 'stitches.bar.remove', { hint: 'stitch.direction.even.hint', more: 8 }), cmdButton('stitch.rungs.follow', 'stitch.direction.follow.button', { hint: 'stitch.direction.follow.hint', more: 9 }));
      if (d?.spacingHere !== undefined) items.push(sep(), spacingHere(d.spacingHere));
      items.push(help(d?.chain ? 'stitch.direction.chain' : 'stitch.direction.help'), cmdButton('stitch.tool.done', 'stitch.direction.done', { primary: true }));
    } else if (tool === 'fill') {
      items.push(
        title('stitches.bar.toSatin'),
        state(t('stitches.bar.rungs', { n: rt.lines.length }) + (rt.cutLines.length ? ` · ${t('stitches.bar.cuts', { n: rt.cutLines.length + 1 })}` : '')),
        sep(),
        pen(),
        sep(),
        cmdButton('stitch.rungs.suggest', 'stitches.bar.suggest', { icon: ICON.wand, hint: 'stitch.suggest.hint' }),
        help(rt.cutLines.length ? 'stitch.draw.parts' : 'stitch.draw.help'),
        cmdButton('stitch.tool.done', 'stitch.draw.cancel'),
        cmdButton('stitch.rungs.sew', 'stitch.draw.sew', { primary: true, hint: 'stitch.draw.hint' }),
      );
    } else if (tool === 'guide') {
      const n = rt.guides.length;
      items.push(title('stitches.bar.guides'), state(n ? t(n === 1 ? 'stitch.guide.one' : 'stitch.guide.count', { n }).replace(/\.$/, '') : t('stitches.guides.none')), help('stitch.guide.help'), cmdButton('stitch.tool.done', 'stitch.direction.done', { primary: true }));
    } else if (tool === 'points') {
      const pattern = panel.fillPattern;
      items.push(
        title('stitches.bar.points'),
        state(pattern && POINTED.includes(pattern) ? t(`stitch.points.${pattern}` as Key) : ''),
        help(pattern === 'swirl' ? 'stitch.points.help.swirl' : 'stitch.points.help'),
        cmdButton('stitch.tool.done', 'stitch.direction.done', { primary: true }),
      );
    }
    bar.setAttribute('aria-label', t('stitches.bar.label'));
    // The menu "…" stands before the primary button at the end, for what does not fit (fit()).
    const last = items[items.length - 1];
    if (last?.classList.contains('primary')) items.splice(items.length - 1, 0, moreButton);
    else if (items.length) items.push(moreButton);
    bar.replaceChildren(...items);
    bar.hidden = !items.length;
    fit();
  }

  /** "…": the parts of the bar that gave way on a narrow stage, as a menu of their commands. */
  const moreButton = h('button', { type: 'button', class: 'bar-btn icon-only bar-more', 'aria-haspopup': 'menu' });
  moreButton.innerHTML = ICON.more;
  moreButton.addEventListener('click', () => {
    const gone = [...bar.querySelectorAll<HTMLElement>(':scope > .bar-off')];
    const items: MenuItem[] = [];
    for (const el of gone) {
      if (el.dataset.cmd) items.push(el.dataset.cmd);
      else if (el.dataset.label) items.push({ label: el.dataset.label, run: () => el.click() });
    }
    showMenu(items, moreButton, t('stitches.bar.more'));
  });

  /**
   * Keeps the bar on one line: while it is wider than the stage, the parts marked as spare give way,
   * the highest number first, into the menu "…" (or out of sight, for a mere state text).
   */
  function fit(): void {
    if (bar.hidden) return;
    const spares = [...bar.querySelectorAll<HTMLElement>(':scope > [data-more]')];
    for (const el of spares) el.classList.remove('bar-off');
    moreButton.classList.add('bar-off');
    spares.sort((a, b) => Number(b.dataset.more) - Number(a.dataset.more));
    const over = () => bar.scrollWidth > bar.clientWidth + 1;
    for (const el of spares) {
      if (!over()) break;
      el.classList.add('bar-off');
      if (el.dataset.cmd || el.dataset.label) moreButton.classList.remove('bar-off');
    }
    // No two lines in a row where the parts between them gave way.
    let afterSep = true;
    for (const el of bar.children) {
      if (el.classList.contains('bar-sep')) {
        el.classList.toggle('bar-off', afterSep);
        afterSep = true;
      } else if (!el.classList.contains('bar-off')) afterSep = false;
    }
    moreButton.title = moreButton.ariaLabel = t('stitches.bar.more');
  }
  new ResizeObserver(() => fit()).observe(document.querySelector('#stage') ?? bar);

  /** The spacing at the selected rung: empty keeps the column's. */
  function spacingHere(v: number | null): HTMLElement {
    const i = h('input', { type: 'text', inputMode: 'decimal', class: 'bar-number', placeholder: t('stitch.spacingHere.column'), value: v === null ? '' : formatNumber(v, 2), 'aria-label': t('stitch.spacingHere') });
    i.addEventListener('change', () => {
      const n = Number(i.value.replace(',', '.'));
      rt.setSpacingHere(i.value.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : Math.min(1.5, Math.max(0.2, n)));
      app.redraw();
    });
    return h('label', { class: 'bar-group', title: t('stitch.spacingHere.hint') }, h('span', { class: 'bar-label' }, t('stitch.spacingHere')), i, h('span', { class: 'bar-label' }, 'mm'));
  }

  // The two tools of the area in the tool rail ------------------------------------------------------
  const rail = document.querySelector<HTMLElement>('.toolrail');
  const railDirection = h('button', { type: 'button', class: 'tool rail-stitches', id: 'tool-direction', 'aria-pressed': 'false' });
  railDirection.innerHTML = ICON.direction;
  railDirection.addEventListener('click', () => {
    // Pressed again it closes whichever line tool is on.
    if (rungsOn()) app.closeRungs();
    else runCommand('stitch.direction');
  });
  const railHand = h('button', { type: 'button', class: 'tool rail-stitches', id: 'tool-stitches', 'aria-pressed': 'false' });
  railHand.innerHTML = ICON.hand;
  railHand.addEventListener('click', () => runCommand('edit.stitches'));
  if (rail) rail.append(h('span', { class: 'rail-sep', 'aria-hidden': 'true' }), railDirection, railHand);

  let railKey = '';
  function refreshRail(force = false): void {
    const key = JSON.stringify([rungsOn(), ed.active, canRun('stitch.direction'), canRun('edit.stitches')]);
    if (key === railKey && !force) return;
    railKey = key;
    const d = getCommand('stitch.direction')!;
    const e = getCommand('edit.stitches')!;
    railDirection.setAttribute('aria-pressed', String(rungsOn()));
    railDirection.disabled = !rungsOn() && !canRun(d);
    railDirection.title = t('stitch.direction.tool.hint');
    railDirection.setAttribute('aria-label', t('stitches.cmd.direction'));
    railHand.setAttribute('aria-pressed', String(ed.active));
    railHand.disabled = !canRun(e);
    railHand.title = commandTitle(e);
    railHand.setAttribute('aria-label', t('stitches.cmd.edit'));
  }

  function refresh(): void {
    refreshRail();
    const key = barState();
    if (key === barKey) return;
    barKey = key;
    renderBar();
  }

  onLangChange(() => {
    bar.setAttribute('aria-label', t('stitches.bar.label'));
    barKey = '';
    refreshRail(true);
    refresh();
  });
  // Bild draws no stitches: the bar goes with the mode.
  new MutationObserver(() => refresh()).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
  // A share picked in the object page shows in the bar too.
  effect(() => {
    thinShare();
    barKey = '';
    queueMicrotask(refresh);
  });
  refresh();
  return { refresh };
}
