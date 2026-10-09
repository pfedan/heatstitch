import './measure.css';
import { onLangChange } from '../../i18n';
import type { Settings } from '../../settings';
import { command, commandTitle, getCommand, runCommand } from '../../shell/commands';
import type { MeasureTool } from '../../ui/measureTool';
import { ScaleBar } from '../../ui/scaleBar';
import type { Viewport } from '../../render/viewport';

/** What the area needs from the rest of the app. */
export interface MeasureApp {
  readonly settings: Settings;
  readonly vp: Viewport;
  readonly stage: HTMLElement;
  readonly measure: MeasureTool;
  /** Leaves a drawing tool, so only one tool has the pointer. */
  readonly stopDrawing: () => void;
  readonly redraw: () => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Measuring on the stage: the tool Messen (button in the view bar, key L) for the distance between
 * two points, and the scale bar at the foot of the stage, switched in the view menu. Neither
 * changes the design.
 */
export function initMeasure(app: MeasureApp): { render: () => void } {
  const m = app.measure;
  const V = 'shell.group.view' as const;
  const button = $<HTMLButtonElement>('measure-toggle');
  const bar = new ScaleBar($('scale-bar'));

  const set = (on: boolean) => {
    if (on === m.active) return;
    if (on) {
      app.stopDrawing();
      m.start();
    } else m.stop();
    app.redraw();
  };
  command({ id: 'tool.measure', label: 'measure.tool', group: V, icon: 'ruler', keys: ['L'], when: () => app.settings.mode !== 'image', run: () => set(!m.active) });
  command({
    id: 'measure.clear',
    label: 'measure.clear',
    group: V,
    keys: ['Escape'],
    bind: false,
    when: () => m.active && m.busy,
    run: () => {
      m.clear();
      app.redraw();
    },
  });
  command({ id: 'view.scaleBar', label: 'measure.cmd.scale', group: V, run: () => $('scale-bar-show').click() });
  button.addEventListener('click', () => runCommand('tool.measure'));

  const titles = () => {
    button.title = commandTitle({ ...getCommand('tool.measure')!, label: 'measure.tool.hint' });
    bar.update(app.vp.scale, true);
  };
  onLangChange(titles);
  titles();

  const render = () => {
    // Bild has no tool to measure with; the tool ends when it is left for Bild.
    if (m.active && app.settings.mode === 'image') m.stop();
    button.setAttribute('aria-pressed', String(m.active));
    button.disabled = app.settings.mode === 'image';
    app.stage.classList.toggle('measuring', m.active);
    bar.root.hidden = !app.settings.scaleBar;
    if (app.settings.scaleBar) bar.update(app.vp.scale);
  };
  return { render };
}
