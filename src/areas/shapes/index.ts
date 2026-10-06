import './shapes.css';
import { formatNumber, onLangChange, t, type Key } from '../../i18n';
import type { Mode, Settings } from '../../settings';
import type { Pattern } from '../../model/pattern';
import type { SewObject } from '../../model/objects';
import type { Form } from '../../shape/path';
import type { Sequence } from '../../app/types';
import type { DrawKind, DrawTool } from '../../ui/drawTool';
import type { Editor } from '../../ui/editor';
import type { FrameTool } from '../../ui/frameTool';
import type { LetteringPanel } from '../../ui/letteringPanel';
import type { ShapeTool } from '../../ui/shapeTool';
import { FileList } from '../../ui/fileList';
import { ui } from '../../app/state';
import { STORAGE_NS } from '../../storage/namespace';
import { canRun, command, getCommand, keyLabel, runCommand } from '../../shell/commands';
import { h, icon } from '../../shell/h';
import { showMenu, toast } from '../../shell/ui';

/** What the area "shapes" needs from the rest of the app. */
export interface ShapesAreaApp {
  readonly settings: Settings;
  readonly setMode: (m: Mode) => void;
  readonly files: FileList;
  readonly seq: (p: Pattern) => Sequence;
  readonly objectName: (q: Sequence, i: number) => string;
  readonly drawTool: DrawTool;
  readonly setDrawing: (kind: DrawKind | null) => void;
  readonly shapeTool: ShapeTool;
  readonly enterShape: (o: number, fit: boolean) => void;
  readonly shapeTarget: (p: Pattern, q: Sequence, o: number) => Form | null;
  readonly isLineObject: (p: Pattern, o: SewObject) => boolean;
  readonly frameTool: FrameTool;
  readonly editor: Editor;
  readonly setEditing: (on: boolean) => void;
  readonly setFormLevel: (on: boolean) => void;
  readonly newLettering: () => Promise<void>;
  readonly setLetterMode: (on: boolean) => void;
  readonly letteringPanel: LetteringPanel;
  readonly selectObjects: (objs: number[], toggle: boolean) => void;
  readonly redraw: () => void;
}

/** From this many nodes on, an outline offers to be simplified (traced outlines come with many). */
const SIMPLIFY_FROM = 12;
const SNAP_KEY = `${STORAGE_NS}.shapes.snap`;

let refreshHook: (() => void) | null = null;

/** Brings the tool rail, the breadcrumb and the tool options up to date (cheap when nothing changed). */
export function refreshShapes(): void {
  refreshHook?.();
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Area C of the new interface: the tool rail (select, shapes, path, freehand, text), the options of
 * the active tool over the stage, the breadcrumb of the levels (design › object › Form or Stiche)
 * and the commands for drawing, outlines, the frame's snapping and lettering.
 */
export function initShapes(app: ShapesAreaApp): void {
  const flow = () => app.settings.mode === 'flow';
  const pattern = () => app.files.active?.pattern ?? null;
  const one = (): number | null => (ui.selectedObjects.size === 1 ? [...ui.selectedObjects][0] : null);
  const shapeLevel = () => flow() && ui.formLevel && !app.editor.active;
  const deeper = () => ui.letterMode || app.editor.active || shapeLevel();

  // Snapping of the frame: on unless switched off, remembered in this browser.
  try {
    app.frameTool.snap = localStorage.getItem(SNAP_KEY) !== 'off';
  } catch {
    /* no storage: snapping stays on */
  }

  // Commands --------------------------------------------------------------------------------------

  const DRAW: Key = 'shell.group.draw';
  const LEVEL: Key = 'shapes.group.level';
  const SHAPE: Key = 'shapes.group.shape';
  const LETTER: Key = 'shapes.group.lettering';
  const done = () => app.redraw();

  command({ id: 'tool.select', label: 'shapes.tool.select', group: DRAW, icon: 'pointer', keys: ['V'], when: () => flow() && !ui.letterMode, run: () => app.setDrawing(null) });
  const TOOLS: [DrawKind, Key, string][] = [
    ['rect', 'shapes.tool.rect', 'M'],
    ['ellipse', 'shapes.tool.ellipse', 'O'],
    ['pen', 'shapes.tool.pen', 'B'],
    ['free', 'shapes.tool.free', 'P'],
  ];
  for (const [kind, label, key] of TOOLS) {
    command({
      id: `draw.${kind}`,
      label,
      group: DRAW,
      keys: [key],
      // Drawing belongs to the level Form; picking a tool goes there from any level.
      when: () => app.settings.mode !== 'image',
      run: () => {
        if (!flow()) app.setMode('flow');
        app.setDrawing(app.drawTool.kind === kind ? null : kind);
      },
    });
  }
  command({
    id: 'draw.square',
    label: 'shapes.cmd.square',
    group: DRAW,
    when: () => app.drawTool.kind === 'rect' || app.drawTool.kind === 'ellipse',
    run: () => {
      app.drawTool.square = !app.drawTool.square;
      refresh();
    },
  });
  command({
    id: 'draw.center',
    label: 'shapes.cmd.center',
    group: DRAW,
    when: () => app.drawTool.kind === 'rect' || app.drawTool.kind === 'ellipse',
    run: () => {
      app.drawTool.fromCenter = !app.drawTool.fromCenter;
      refresh();
    },
  });
  const pen = (n: number) => () => flow() && app.drawTool.kind === 'pen' && app.drawTool.count >= n;
  command({ id: 'draw.undoNode', label: 'shapes.draw.undoNode', group: DRAW, keys: ['Delete'], bind: false, when: pen(1), run: () => void app.drawTool.removeLast() });
  command({ id: 'draw.finishLine', label: 'shapes.draw.finishLine', group: DRAW, keys: ['Enter'], bind: false, when: pen(2), run: () => app.drawTool.finish(false) });
  command({ id: 'draw.closeArea', label: 'shapes.draw.closeArea', group: DRAW, when: pen(3), run: () => app.drawTool.finish(true) });
  command({
    id: 'draw.cancel',
    label: 'shapes.draw.cancel',
    group: DRAW,
    keys: ['Escape'],
    bind: false,
    when: () => flow() && app.drawTool.busy,
    run: () => {
      app.drawTool.cancel();
      done();
    },
  });

  // Levels: Objekte, Form, Stiche; the breadcrumb and Esc go back, a double-click or Enter deeper.
  command({
    id: 'level.objects',
    label: 'shapes.cmd.level.objects',
    group: LEVEL,
    when: () => app.settings.mode !== 'image' && deeper(),
    run: () => {
      if (ui.letterMode) app.setLetterMode(false);
      if (ui.formLevel) app.setFormLevel(false);
      if (app.editor.active) app.setEditing(false);
    },
  });
  command({
    id: 'level.shape',
    label: 'shapes.cmd.level.shape',
    group: LEVEL,
    // Enter on one selected object is object.openShape (src/areas/objects).
    when: () => {
      if (!flow() || ui.lettering || (shapeLevel() && (app.shapeTool.active || one() === null))) return false;
      const p = pattern();
      const o = one();
      return o === null || (!!p && !!app.shapeTarget(p, app.seq(p), o));
    },
    run: () => {
      const o = one();
      if (o !== null) app.enterShape(o, true);
      else app.setFormLevel(true);
    },
  });
  command({
    id: 'level.stitches',
    label: 'shapes.cmd.level.stitches',
    group: LEVEL,
    // The key E and the command search: edit.stitches (src/areas/stitches); this one is for the crumb's menu.
    palette: false,
    when: () => app.settings.mode !== 'image' && !!pattern() && !app.editor.active && !ui.lettering,
    run: () => app.setEditing(true),
  });
  command({
    id: 'level.up',
    label: 'shapes.cmd.levelUp',
    group: LEVEL,
    keys: ['Escape'],
    bind: false,
    when: () => app.settings.mode !== 'image' && deeper(),
    run: () => {
      if (ui.letterMode) app.setLetterMode(false);
      else if (app.editor.active) app.setEditing(false);
      else app.setFormLevel(false);
    },
  });

  // The outline of the one selected object (level Form).
  const shaping = () => flow() && app.shapeTool.active;
  const lineOpen = (closed: boolean) => () => {
    const p = pattern();
    const o = ui.shapeObject;
    if (!shaping() || !p || o === null) return false;
    const obj = app.seq(p).objects[o];
    return !!obj && app.isLineObject(p, obj) && app.shapeTool.closed === closed && app.shapeTool.count >= 2;
  };
  command({ id: 'shape.nodeDelete', label: 'shape.node.delete', group: SHAPE, keys: ['Delete'], bind: false, when: () => shaping() && app.shapeTool.selectedSmooth !== null, run: () => void app.shapeTool.deleteSelected() });
  command({ id: 'shape.cornerToggle', label: 'shapes.cmd.corner', group: SHAPE, keys: ['C'], bind: false, when: () => shaping() && app.shapeTool.selectedSmooth !== null, run: () => void app.shapeTool.toggleSmooth() });
  command({
    id: 'shape.simplify',
    label: 'shape.simplify',
    group: SHAPE,
    when: () => shaping() && app.shapeTool.count >= SIMPLIFY_FROM,
    run: () => {
      const r = app.shapeTool.simplify();
      if (!r) return toast(t('shape.simplify.none'));
      toast(t('shape.simplified', { before: formatNumber(r.before), after: formatNumber(r.after) }), { label: t('edit.undo'), run: () => runCommand('edit.undo') });
      app.shapeTool.commit();
    },
  });
  command({ id: 'shape.closeLine', label: 'shape.line.close', group: SHAPE, when: lineOpen(false), run: () => void app.shapeTool.toggleClosed() });
  command({ id: 'shape.openLine', label: 'shape.line.open', group: SHAPE, when: lineOpen(true), run: () => void app.shapeTool.toggleClosed() });
  command({
    id: 'frame.snap',
    label: 'shapes.cmd.snap',
    group: SHAPE,
    when: flow,
    run: () => {
      app.frameTool.snap = !app.frameTool.snap;
      try {
        localStorage.setItem(SNAP_KEY, app.frameTool.snap ? 'on' : 'off');
      } catch {
        /* kept for this visit only */
      }
      refresh();
    },
  });

  // Lettering.
  command({ id: 'lettering.new', label: 'lettering.tool', group: LETTER, keys: ['T'], bind: false, when: () => app.settings.mode !== 'image', run: () => void app.newLettering() });
  command({ id: 'lettering.letters', label: 'lettering.letters', group: LETTER, keys: ['Enter'], bind: false, when: () => flow() && !!ui.lettering, run: () => app.setLetterMode(!ui.letterMode) });
  command({ id: 'lettering.editText', label: 'shapes.cmd.editText', group: LETTER, when: () => flow() && !!ui.lettering && !ui.letterMode, run: () => app.letteringPanel.focusText(false) });
  command({ id: 'lettering.font', label: 'shapes.cmd.font', group: LETTER, when: () => flow() && !!ui.lettering, run: () => app.letteringPanel.openFonts() });
  command({ id: 'lettering.release', label: 'lettering.release', group: LETTER, when: () => flow() && !!ui.lettering, run: () => app.letteringPanel.release() });

  // Tool rail ---------------------------------------------------------------------------------------

  const rail = document.querySelector<HTMLElement>('.toolrail')!;
  const railButtons = [...rail.querySelectorAll<HTMLButtonElement>('[data-command]')];
  for (const b of railButtons) b.addEventListener('click', () => runCommand(b.dataset.command!));
  const HINTS: Record<string, Key> = {
    'tool.select': 'shapes.tool.select.hint',
    'draw.rect': 'shapes.tool.rect.hint',
    'draw.ellipse': 'shapes.tool.ellipse.hint',
    'draw.pen': 'shapes.tool.pen.hint',
    'draw.free': 'shapes.tool.free.hint',
    'lettering.new': 'shapes.tool.text.hint',
  };
  const railTitles = () => {
    rail.setAttribute('aria-label', t('shapes.rail'));
    for (const b of railButtons) {
      const c = getCommand(b.dataset.command!);
      if (!c) continue;
      const key = c.keys?.[0];
      const hint = HINTS[c.id];
      b.title = `${hint ? t(hint) : t(c.label)}${key ? ` (${keyLabel(key)})` : ''}`;
      b.setAttribute('aria-label', c.id === 'lettering.new' ? t('shapes.tool.text') : t(c.label));
    }
  };

  // Breadcrumb ---------------------------------------------------------------------------------------

  const crumb = $('edit-crumb');
  let crumbKey = '';

  /** Name of the object(s) being worked on, short: "Füllung 3", "Schriftzug »Blume«", "3 Objekte". */
  function selectionName(q: Sequence): string | null {
    if (app.drawTool.active) return null;
    if (ui.lettering) {
      const text = ui.lettering.l.text.replace(/\s+/g, ' ').trim();
      return t('lettering.name', { text: text.length > 20 ? `${text.slice(0, 19)}…` : text });
    }
    const o = app.editor.active ? ui.editObject : ui.shapeObject ?? one();
    if (o !== null && q.objects[o]) return app.objectName(q, o).replace(/\s*\(.*\)$/, '');
    if (app.editor.active) return null;
    const n = ui.selectedObjects.size;
    return n > 1 ? t('shapes.crumb.objects', { n: formatNumber(n) }) : null;
  }

  function levelName(): string | null {
    if (ui.letterMode) return t('shapes.crumb.letters');
    if (app.editor.active) return t('level.stitches');
    if (shapeLevel()) return app.drawTool.kind ? t('shapes.crumb.draw') : t('level.shape');
    return null;
  }

  function renderCrumb(): void {
    const f = app.files.active;
    const p = f?.pattern ?? null;
    const shown = app.settings.mode !== 'image' && (!!p || app.drawTool.active);
    const q = p ? app.seq(p) : null;
    const design = f && p ? FileList.displayName(f) : null;
    const sel = q ? selectionName(q) : null;
    const level = levelName();
    const key = [shown, design, sel, level, app.settings.mode, deeper(), ui.selectedObjects.size].join('|');
    if (key === crumbKey) return;
    crumbKey = key;
    crumb.hidden = !shown;
    if (!shown) return crumb.replaceChildren();
    const parts: HTMLElement[] = [];
    const sep = () => h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›');
    const last = (text: string, title?: string) => h('span', { class: 'crumb-here', 'aria-current': 'location', title: title ?? '' }, text);
    const anySelected = ui.selectedObjects.size > 0 || deeper();
    if (design) {
      parts.push(
        anySelected
          ? h('button', {
              type: 'button',
              class: 'crumb-link',
              title: t('shapes.crumb.top'),
              onclick: () => {
                runCommand('level.objects');
                app.selectObjects([], false);
                done();
              },
            }, design)
          : last(design),
      );
    }
    if (sel) {
      if (parts.length) parts.push(sep());
      parts.push(level ? h('button', { type: 'button', class: 'crumb-link', title: t('shapes.crumb.up'), onclick: () => runCommand('level.objects') }, sel) : last(sel));
    }
    // The last crumb is the level itself, as the button that switches it ("Form ▾"): the menu
    // belongs to the level, not to the design name before it.
    const here = level ?? t('level.objects');
    const pick = app.editor.active && ui.editObject === null ? `${t('level.pick')}. ` : '';
    const menu = h(
      'button',
      {
        type: 'button',
        class: 'crumb-levels',
        title: pick + t('shapes.crumb.level', { level: here }),
        'aria-label': t('shapes.crumb.level', { level: here }),
        'aria-haspopup': 'menu',
        onclick: () => showMenu(['level.objects', 'level.shape', 'level.stitches', ...(ui.lettering ? ['-', 'lettering.letters'] : []), '-', 'level.up'], menu, t('shapes.crumb.levels')),
      },
      h('span', { class: 'crumb-level' }, here),
      icon('chevron-down'),
    );
    if (p) {
      if (parts.length) parts.push(sep());
      parts.push(menu);
    } else if (level) {
      if (parts.length) parts.push(sep());
      parts.push(last(level));
    }
    crumb.setAttribute('aria-label', t('shapes.crumb.label'));
    crumb.replaceChildren(...parts);
  }

  // Tool options over the stage ----------------------------------------------------------------------

  const bar = $('tool-options');
  let barKey = '';

  type Item = { kind: 'title'; text: string; title?: string } | { kind: 'hint'; text: string } | { kind: 'cmd'; id: string; text?: string; toggle?: boolean; on?: boolean; primary?: boolean } | { kind: 'sep' };

  function barItems(): Item[] {
    if (!flow()) return [];
    const snap: Item = { kind: 'cmd', id: 'frame.snap', text: t('shapes.snap'), toggle: true, on: app.frameTool.snap };
    const d = app.drawTool;
    if (d.kind === 'rect' || d.kind === 'ellipse') {
      return [
        { kind: 'title', text: t(d.kind === 'rect' ? 'shapes.tool.rect' : 'shapes.tool.ellipse'), title: t(d.kind === 'rect' ? 'draw.rect.hint' : 'draw.ellipse.hint') },
        { kind: 'cmd', id: 'draw.square', text: t(d.kind === 'rect' ? 'shapes.opt.square' : 'shapes.opt.circle'), toggle: true, on: d.square },
        { kind: 'cmd', id: 'draw.center', text: t('shapes.opt.center'), toggle: true, on: d.fromCenter },
        { kind: 'hint', text: t('shapes.opt.drag') },
      ];
    }
    if (d.kind === 'pen') {
      return [
        { kind: 'title', text: t('shapes.tool.pen'), title: t('draw.pen.hint') },
        // Before the first node the hint says what to do; then the ways to go on.
        ...(d.count
          ? ([
              { kind: 'cmd', id: 'draw.undoNode' },
              { kind: 'cmd', id: 'draw.closeArea' },
              { kind: 'cmd', id: 'draw.finishLine' },
              { kind: 'cmd', id: 'draw.cancel' },
            ] as Item[])
          : [{ kind: 'hint', text: t('shapes.opt.pen') } as Item]),
      ];
    }
    if (d.kind === 'free') return [{ kind: 'title', text: t('shapes.tool.free'), title: t('draw.free.hint') }, { kind: 'hint', text: t('shapes.opt.free') }];
    if (ui.letterMode) return [{ kind: 'title', text: t('shapes.crumb.letters'), title: t('lettering.letters.how') }, { kind: 'hint', text: t('shapes.opt.letters') }, { kind: 'cmd', id: 'lettering.letters', text: t('lettering.letters.done') }];
    const s = app.shapeTool;
    if (s.active) {
      const items: Item[] = [
        { kind: 'title', text: t('shapes.shape.title'), title: t(s.band !== null ? 'shape.hint.band' : s.rails ? 'shape.hint.rails' : 'shape.hint') },
        { kind: 'hint', text: `${t('shape.nodes', { n: formatNumber(s.count) })} · ${s.selectedSmooth === null ? t('shape.none') : t(s.selectedSmooth ? 'shape.node.smooth' : 'shape.node.corner')}` },
        { kind: 'cmd', id: 'shape.nodeDelete' },
        { kind: 'cmd', id: 'shape.cornerToggle', text: t(s.selectedSmooth ? 'shape.node.corner' : 'shape.node.smooth') },
      ];
      if (s.count >= SIMPLIFY_FROM) items.push({ kind: 'cmd', id: 'shape.simplify' });
      if (canRun('shape.closeLine')) items.push({ kind: 'cmd', id: 'shape.closeLine' });
      if (canRun('shape.openLine')) items.push({ kind: 'cmd', id: 'shape.openLine' });
      // Fertig as in the bar of the stitches by hand: back to the objects (as Esc). The level Stiche
      // is in the crumb's menu and on the key E.
      items.push({ kind: 'sep' }, snap, { kind: 'cmd', id: 'level.up', text: t('object.editDone'), primary: true });
      return items;
    }
    if (ui.lettering) return [{ kind: 'title', text: t('lettering.title'), title: t('canvas.hint.lettering') }, { kind: 'cmd', id: 'lettering.letters' }, snap, { kind: 'hint', text: t('shapes.opt.lettering') }];
    if (app.frameTool.active) return [snap, { kind: 'hint', text: t(matchMedia('(pointer: coarse)').matches ? 'responsive.opt.frame' : 'shapes.opt.frame') }];
    if (shapeLevel() && !app.editor.active) return [{ kind: 'title', text: t('level.shape') }, { kind: 'hint', text: t('shapes.opt.formPick') }];
    return [];
  }

  function renderBar(): void {
    const items = barItems();
    const key = JSON.stringify(items.map((i) => (i.kind === 'cmd' ? [i.id, i.text, i.on, canRun(i.id)] : i)));
    if (key === barKey) return;
    barKey = key;
    bar.hidden = !items.length;
    bar.setAttribute('aria-label', t('shapes.opt.label'));
    bar.replaceChildren(
      ...items.map((i) => {
        if (i.kind === 'title') return h('span', { class: 'opt-title', title: i.title ?? '' }, i.text);
        if (i.kind === 'hint') return h('span', { class: 'opt-hint' }, i.text);
        if (i.kind === 'sep') return h('span', { class: 'opt-sep', 'aria-hidden': 'true' });
        const c = getCommand(i.id)!;
        const key = c.keys?.[0];
        const hint = i.id === 'frame.snap' ? t('shapes.snap.hint') : i.id === 'draw.square' ? t('shapes.opt.square.hint') : i.id === 'draw.center' ? t('shapes.opt.center.hint') : t(c.label);
        return h(
          'button',
          {
            type: 'button',
            class: `opt${i.toggle ? ' opt-toggle' : ''}${i.primary ? ' primary' : ''}`,
            disabled: !canRun(c),
            title: `${hint}${key ? ` (${keyLabel(key)})` : ''}`,
            'aria-pressed': i.toggle ? String(!!i.on) : undefined,
            onclick: () => runCommand(i.id),
          },
          i.toggle ? h('span', { class: 'opt-check', 'aria-hidden': 'true' }) : null,
          i.text ?? t(c.label),
        );
      }),
    );
  }

  function refresh(): void {
    for (const b of railButtons) {
      const id = b.dataset.command!;
      if (id === 'tool.select') b.setAttribute('aria-pressed', String(!app.drawTool.kind));
      else if (id.startsWith('draw.')) b.setAttribute('aria-pressed', String(app.drawTool.kind === id.slice(5)));
    }
    renderCrumb();
    renderBar();
  }

  onLangChange(() => {
    crumbKey = barKey = '';
    railTitles();
    refresh();
  });
  railTitles();
  refreshHook = refresh;
  refresh();
}
