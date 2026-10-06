import './check.css';
import type { Mode, Settings } from '../../settings';
import type { FileList } from '../../ui/fileList';
import { FileList as Files } from '../../ui/fileList';
import type { JumpsPanel } from '../../ui/jumpsPanel';
import type { ValidationPanel, ZoneDecision } from '../../ui/validationPanel';
import type { Zone } from '../../validation/validate';
import type { Pattern } from '../../model/pattern';
import type { Sequence } from '../../app/types';
import type { Viewport } from '../../render/viewport';
import { drawTransition } from '../../render/flow';
import { settledBy } from '../../validation/acks';
import { command } from '../../shell/commands';
import { ui } from '../../app/state';
import { t } from '../../i18n';

/** What the check area needs from the rest of the app. */
export interface CheckApp {
  readonly settings: Settings;
  readonly files: FileList;
  readonly setMode: (m: Mode) => void;
  readonly redraw: () => void;
  readonly vp: Viewport;
  readonly seq: (p: Pattern) => Sequence;
  readonly findings: ValidationPanel;
  readonly stepZone: (dir: 1 | -1) => void;
  readonly decideZone: (z: Zone, d: ZoneDecision) => void;
  readonly setComparing: (on: boolean) => void;
  readonly correction: {
    planFix: (scope: 'all' | 'zone') => Promise<void>;
    applyPlan: () => Promise<void>;
    discardPlan: () => void;
    tuneToFabric: (quiet?: boolean) => void;
    pinPlan: (ids: number[] | null) => void;
    busy: () => boolean;
    planShown: () => boolean;
    planTicked: () => boolean;
  };
  readonly jumps: JumpsPanel;
  readonly stepJump: (dir: 1 | -1) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
/** Clicks a control of the area, so it changes and saves the setting as when used by hand. */
const press = (id: string) => $(id)?.click();

/**
 * The area "Prüfen": the commands of the check view (findings, correction, comparison, heatmap) and
 * of the jumps and trims, and what it draws on the stage. The panels themselves are
 * src/ui/validationPanel.ts, correctPanel.ts and jumpsPanel.ts; the markup is in index.html.
 */
export function initCheck(app: CheckApp): { draw: (ctx: CanvasRenderingContext2D) => void } {
  const G = 'check.group' as const;
  const density = () => app.settings.mode === 'density';
  const loaded = () => !!app.files.active?.pattern;
  const zones = () => app.files.active?.validation?.zones ?? [];
  const shownZones = () => app.findings.visible(zones());
  /** Opens the check view first when a command of it runs from elsewhere (command search). */
  const inCheck = (fn: () => void) => () => {
    if (!density()) app.setMode('density');
    fn();
  };
  const openZone = () => {
    const z = ui.selectedZone;
    return z && !settledBy(z, app.files.active?.acks) ? z : null;
  };

  // Findings
  command({ id: 'check.next', label: 'check.next', group: G, keys: ['N'], bind: false, when: () => density() && shownZones().length > 0, run: () => app.stepZone(1) });
  command({ id: 'check.prev', label: 'check.prev', group: G, keys: ['Shift+N'], bind: false, when: () => density() && shownZones().length > 0, run: () => app.stepZone(-1) });
  command({ id: 'check.markers', label: 'check.markers', group: G, keys: ['V'], bind: false, when: density, run: () => press('show-validation') });
  command({ id: 'check.ack', label: 'check.ack', group: G, when: () => density() && !!openZone(), run: () => app.decideZone(openZone()!, 'ack') });
  command({ id: 'check.clearZone', label: 'check.clearZone', group: G, keys: ['Escape'], bind: false, when: () => density() && !!ui.selectedZone, run: () => {
    ui.selectedZone = null;
    app.redraw();
  } });

  // Correction
  command({ id: 'check.fixAll', label: 'check.fixAll', group: G, when: () => loaded() && !app.correction.busy(), run: inCheck(() => void app.correction.planFix('all')) });
  command({ id: 'check.fixZone', label: 'check.fixZone', group: G, when: () => density() && !!ui.selectedZone && !app.correction.busy(), run: () => void app.correction.planFix('zone') });
  command({ id: 'check.tune', label: 'check.tune', group: G, when: () => loaded() && !app.correction.busy(), run: inCheck(() => app.correction.tuneToFabric()) });
  command({ id: 'check.apply', label: 'check.apply', group: G, when: () => density() && app.correction.planTicked() && !app.correction.busy(), run: () => void app.correction.applyPlan() });
  command({ id: 'check.discard', label: 'check.discard', group: G, when: () => app.correction.planShown(), run: () => app.correction.discardPlan() });
  command({ id: 'check.unpin', label: 'check.unpin', group: G, keys: ['Escape'], bind: false, when: () => !!ui.planPin, run: () => app.correction.pinPlan(null) });
  command({ id: 'check.compare', label: 'check.compare', group: G, keys: ['C'], bind: false, when: () => density() && Files.edited(app.files.active), run: () => app.setComparing(!ui.comparing) });

  // Heatmap
  command({ id: 'check.overlay', label: 'check.overlay', group: G, when: density, run: () => press('overlay') });
  command({ id: 'check.metric', label: 'check.metric', group: G, when: density, run: () => {
    const other = app.settings.metric === 'thread' ? 'penetrations' : 'thread';
    document.querySelector<HTMLInputElement>(`input[name="metric"][value="${other}"]`)?.click();
  } });

  // Jumps and trims: in Gestalten and in Prüfen.
  const jumpsHere = () => app.settings.mode !== 'image' && loaded() && !!app.files.active?.pattern && app.seq(app.files.active.pattern).transitions.length > 0;
  command({ id: 'jumps.next', label: 'check.jumps.next', group: G, keys: ['N'], bind: false, when: () => jumpsHere() && !density(), run: () => app.stepJump(1) });
  command({ id: 'jumps.prev', label: 'check.jumps.prev', group: G, keys: ['Shift+N'], bind: false, when: () => jumpsHere() && !density(), run: () => app.stepJump(-1) });
  command({ id: 'jumps.trimAll', label: 'check.jumps.trim', group: G, when: () => jumpsHere() && app.jumps.counts().toCut > 0, run: () => app.jumps.applyRule(true) });
  command({ id: 'jumps.carryBelow', label: 'check.jumps.carryBelow', group: G, when: () => jumpsHere() && app.jumps.counts().toCarry > 0, run: () => app.jumps.applyRule(false) });
  command({ id: 'jumps.cut', label: 'check.jumps.cut', group: G, when: () => app.jumps.actions().includes('cut'), run: () => app.jumps.act('cut') });
  command({ id: 'jumps.tie', label: 'check.jumps.tie', group: G, when: () => app.jumps.actions().includes('tie'), run: () => app.jumps.act('tie') });
  command({ id: 'jumps.carry', label: 'check.jumps.carry', group: G, when: () => app.jumps.actions().includes('carry'), run: () => app.jumps.act('carry') });

  return {
    /** In Prüfen the jump chosen or pointed at in the list shows on the heatmap too. */
    draw(ctx) {
      // The heatmap section's line says what it shows while it is folded away.
      const sum = $('heatmap-sum');
      const what = [t(app.settings.metric === 'thread' ? 'metric.thread' : 'metric.penetrations'), ...(app.settings.overlay ? [t('check.heatmap.plan')] : [])].join(' · ');
      if (sum && sum.textContent !== what) sum.textContent = what;
      const p = app.files.active?.pattern;
      if (!density() || !p) return;
      const list = app.seq(p).transitions;
      const sel = ui.selectedJump !== null ? list[ui.selectedJump] : undefined;
      const hov = ui.hoverJump !== null ? list[ui.hoverJump] : undefined;
      if (hov && hov !== sel) drawTransition(ctx, app.vp, p, hov, false);
      if (sel) drawTransition(ctx, app.vp, p, sel, true);
    },
  };
}
