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
import type { MeasureTool } from '../../ui/measureTool';
import { FileList } from '../../ui/fileList';
import { canSplit } from '../../model/splitFill';
import { remembered } from '../../model/restitch';
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
  readonly measure: MeasureTool;
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

/**
 * Icons of the options bar, drawn like the tool rail's (20 × 20, stroked; `node` squares filled):
 * for the steps on nodes and paths, whose words would crowd the bar on a phone.
 */
const ICON = {
  nodeDelete: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 16C5 9.5 7.5 6.8 10 5.8" /><rect x="9.6" y="3.4" width="3.6" height="3.6" rx=".6" class="node" /><path d="M13 12l4.5 4.5M17.5 12 13 16.5" /></svg>',
  corner: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 16.5 10 4.5l6.5 12" /><rect x="8.3" y="2.8" width="3.4" height="3.4" rx=".5" class="node" /></svg>',
  smooth: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 16C4.5 7 15.5 7 16.5 16" /><path d="M4 9.25h12" stroke-dasharray="1.4 1.6" /><rect x="8.3" y="7.55" width="3.4" height="3.4" rx=".5" class="node" /></svg>',
  simplify: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 12l2.5-4 2 3 2.5-5 2 4 2.5-5 3.5 3" opacity=".45" /><path d="M2.5 16C7 9 12.5 9 17.5 12" /></svg>',
  pathOpen: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10.5 4H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9.5" /><rect x="9.3" y="2.3" width="3.4" height="3.4" rx=".5" class="node" /><rect x="14.3" y="7.8" width="3.4" height="3.4" rx=".5" class="node" /></svg>',
  pathClose: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10.5 4H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9.5" /><path d="M12.8 4H14a2 2 0 0 1 2 2v1.6" stroke-dasharray="1.3 1.3" /><rect x="9.3" y="2.3" width="3.4" height="3.4" rx=".5" class="node" /><rect x="14.3" y="7.8" width="3.4" height="3.4" rx=".5" class="node" /></svg>',
  snap: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 3.5H8v6a2 2 0 0 0 4 0v-6h3.5v6a5.5 5.5 0 0 1-11 0z" /><path d="M4.5 6.5H8M12 6.5h3.5" /></svg>',
  back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 15l4-7 3.5 4" /><rect x="1.8" y="13.8" width="2.4" height="2.4" rx=".4" class="node" /><rect x="5.8" y="6.8" width="2.4" height="2.4" rx=".4" class="node" /><path d="M17.5 12h-5M14.5 9.5 12 12l2.5 2.5" /></svg>',
  cancel: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>',
};
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
  // Zerteilen: a cut across the selected fills (src/model/splitFill). Not a new shape, so it keeps the
  // level and the selection; it can run while a fill is selected, and stays on for further cuts.
  let cutCache: { p: Pattern | null; key: number; ok: boolean } | null = null;
  const fillSelected = () => {
    const p = pattern();
    if (cutCache?.p !== p || cutCache.key !== ui.selectionKey) cutCache = { p, key: ui.selectionKey, ok: !!p && [...ui.selectedObjects].some((o) => canSplit(p, o)) };
    return cutCache.ok;
  };
  command({
    id: 'draw.cut',
    label: 'shapes.tool.cut',
    group: SHAPE,
    icon: 'obj-cut',
    keys: ['X'],
    when: () => flow() && !ui.letterMode && !app.editor.active && (app.drawTool.kind === 'cut' || fillSelected()),
    run: () => app.setDrawing(app.drawTool.kind === 'cut' ? null : 'cut'),
  });
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
  const pen = (n: number) => () => flow() && (app.drawTool.kind === 'pen' || app.drawTool.kind === 'cut') && app.drawTool.count >= n;
  command({ id: 'draw.undoNode', label: 'shapes.draw.undoNode', group: DRAW, keys: ['Delete'], bind: false, when: pen(1), run: () => void app.drawTool.removeLast() });
  command({ id: 'draw.finishLine', label: 'shapes.draw.finishLine', group: DRAW, keys: ['Enter'], bind: false, when: pen(2), run: () => app.drawTool.finish(false) });
  command({ id: 'draw.closeArea', label: 'shapes.draw.closeArea', group: DRAW, when: () => pen(3)() && app.drawTool.kind === 'pen', run: () => app.drawTool.finish(true) });
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
  /**
   * The object on the level Form is a line (else a fill), or null when its paths cannot be opened
   * or closed. A path is a path whatever it is sewn with: a fill whose last closed one is opened is
   * sewn as a line, a band is a line already (its width the fill).
   */
  const shapedLine = (): boolean | null => {
    const p = pattern();
    const o = ui.shapeObject;
    if (!shaping() || !p || o === null) return null;
    const obj = app.seq(p).objects[o];
    if (!obj) return null;
    if (app.isLineObject(p, obj)) return true;
    return obj.kind === 'fill' && app.shapeTool.band === null ? false : null;
  };
  const lineOpen = (closed: boolean) => () => shapedLine() !== null && app.shapeTool.closed === closed && app.shapeTool.count >= 2;
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
  command({
    id: 'shape.closeLine',
    label: 'shape.path.close',
    group: SHAPE,
    when: lineOpen(false),
    run: () => {
      // Closed, a line can be filled: said where it is found. A fill sewn as a line since its path
      // was opened says it as it is sewn again, with Wieder füllen.
      const p = pattern();
      const obj = p && ui.shapeObject !== null ? app.seq(p).objects[ui.shapeObject] : undefined;
      const tell = shapedLine() && !(p && obj && remembered(p, obj)?.kept?.fill);
      if (app.shapeTool.toggleClosed() && tell) toast(t('shape.line.closed'));
    },
  });
  command({ id: 'shape.openLine', label: 'shape.path.open', group: SHAPE, when: lineOpen(true), run: () => void app.shapeTool.toggleClosed() });
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
    'draw.cut': 'shapes.tool.cut.hint',
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
    // The design's name stands in the top bar already; the crumb starts at what is chosen in it.
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

  type Item = { kind: 'title'; text: string; title?: string } | { kind: 'hint'; text: string } | { kind: 'cmd'; id: string; text?: string; toggle?: boolean; on?: boolean; primary?: boolean; icon?: string; tip?: string } | { kind: 'sep' };

  function barItems(): Item[] {
    if (app.measure.active && app.settings.mode !== 'image') return measureItems();
    if (!flow()) return [];
    const snap: Item = { kind: 'cmd', id: 'frame.snap', text: t('shapes.snap'), toggle: true, on: app.frameTool.snap, icon: ICON.snap };
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
              { kind: 'cmd', id: 'draw.undoNode', icon: ICON.back },
              { kind: 'cmd', id: 'draw.closeArea' },
              { kind: 'cmd', id: 'draw.finishLine' },
              { kind: 'cmd', id: 'draw.cancel', icon: ICON.cancel },
            ] as Item[])
          : [{ kind: 'hint', text: t('shapes.opt.pen') } as Item]),
      ];
    }
    if (d.kind === 'cut') {
      return [
        { kind: 'title', text: t('shapes.tool.cut'), title: t('shapes.tool.cut.hint') },
        ...(d.count
          ? ([
              { kind: 'cmd', id: 'draw.undoNode', icon: ICON.back },
              { kind: 'cmd', id: 'draw.finishLine', text: t('shapes.cut.finish'), primary: d.count >= 2 },
              { kind: 'cmd', id: 'draw.cancel', icon: ICON.cancel },
            ] as Item[])
          : ([{ kind: 'hint', text: t('shapes.opt.cut') }, { kind: 'sep' }, { kind: 'cmd', id: 'tool.select', text: t('object.editDone'), primary: true }] as Item[])),
      ];
    }
    if (d.kind === 'free') return [{ kind: 'title', text: t('shapes.tool.free'), title: t('draw.free.hint') }, { kind: 'hint', text: t('shapes.opt.free') }];
    if (ui.letterMode) return [{ kind: 'title', text: t('shapes.crumb.letters'), title: t('lettering.letters.how') }, { kind: 'hint', text: t('shapes.opt.letters') }, { kind: 'cmd', id: 'lettering.letters', text: t('lettering.letters.done') }];
    const s = app.shapeTool;
    if (s.active) {
      const items: Item[] = [
        { kind: 'title', text: t('shapes.shape.title'), title: t(s.band !== null ? 'shape.hint.band' : 'shape.hint') },
        { kind: 'hint', text: `${t('shape.nodes', { n: formatNumber(s.count) })} · ${s.selectedSmooth === null ? t('shape.none') : t(s.selectedSmooth ? 'shape.node.smooth' : 'shape.node.corner')}` },
        { kind: 'cmd', id: 'shape.nodeDelete', icon: ICON.nodeDelete },
        // What a tap makes of the selected node.
        s.selectedSmooth ? { kind: 'cmd', id: 'shape.cornerToggle', icon: ICON.corner, tip: t('shape.node.toCorner') } : { kind: 'cmd', id: 'shape.cornerToggle', icon: ICON.smooth, tip: t('shape.node.toSmooth') },
      ];
      if (s.count >= SIMPLIFY_FROM) items.push({ kind: 'cmd', id: 'shape.simplify', icon: ICON.simplify, tip: t('shape.simplify.hint') });
      if (canRun('shape.closeLine')) items.push({ kind: 'cmd', id: 'shape.closeLine', icon: ICON.pathClose, tip: t('shape.path.close.hint') });
      if (canRun('shape.openLine')) items.push({ kind: 'cmd', id: 'shape.openLine', icon: ICON.pathOpen, tip: t('shape.path.open.hint') });
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

  /** Messen: how to measure, then the parts of the distance; Fertig ends the tool. */
  function measureItems(): Item[] {
    const m = app.measure;
    const r = m.result;
    const touch = matchMedia('(pointer: coarse)').matches;
    const mm = (v: number) => formatNumber(v, 1);
    // On a phone the parts come short, so Fertig stays in sight.
    const hint = r && !m.open ? t(matchMedia('(max-width: 760px)').matches ? 'measure.result.short' : 'measure.result', { dx: mm(r.dx), dy: mm(r.dy), a: formatNumber(Math.round(r.angle) % 180) }) : t(m.open ? (touch ? 'measure.next.touch' : 'measure.next') : touch ? 'measure.how.touch' : 'measure.how');
    return [
      { kind: 'title', text: t('measure.tool'), title: t('measure.tool.hint') },
      { kind: 'hint', text: hint },
      { kind: 'sep' },
      { kind: 'cmd', id: 'tool.measure', text: t('object.editDone'), primary: true },
    ];
  }

  function renderBar(): void {
    const items = barItems();
    const key = JSON.stringify(items.map((i) => (i.kind === 'cmd' ? [i.id, i.text, i.on, i.icon, canRun(i.id)] : i)));
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
        const hint = i.tip ?? (i.id === 'frame.snap' ? t('shapes.snap.hint') : i.id === 'draw.square' ? t('shapes.opt.square.hint') : i.id === 'draw.center' ? t('shapes.opt.center.hint') : t(c.label));
        const b = h(
          'button',
          {
            type: 'button',
            class: `opt${i.toggle ? ' opt-toggle' : ''}${i.primary ? ' primary' : ''}${i.icon ? ' opt-icon' : ''}`,
            disabled: !canRun(c),
            title: `${hint}${key ? ` (${keyLabel(key)})` : ''}`,
            'aria-pressed': i.toggle ? String(!!i.on) : undefined,
            // An icon only: its words are the name (and the tooltip says what it does).
            'aria-label': i.icon ? (i.text ?? t(c.label)) : undefined,
            onclick: () => runCommand(i.id),
          },
          i.toggle && !i.icon ? h('span', { class: 'opt-check', 'aria-hidden': 'true' }) : null,
          i.icon ? null : (i.text ?? t(c.label)),
        );
        if (i.icon) b.insertAdjacentHTML('beforeend', i.icon);
        return b;
      }),
    );
  }

  function refresh(): void {
    for (const b of railButtons) {
      const id = b.dataset.command!;
      if (id === 'tool.select') b.setAttribute('aria-pressed', String(!app.drawTool.kind && !app.measure.active));
      else if (id.startsWith('draw.')) b.setAttribute('aria-pressed', String(app.drawTool.kind === id.slice(5)));
      if (id === 'draw.cut') b.disabled = !canRun(id);
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
