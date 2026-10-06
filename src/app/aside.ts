import type { FileList } from '../ui/fileList';
import type { LayersPanel } from '../ui/layersPanel';
import type { Measurement } from '../validation/measure';
import type { Pattern } from '../model/pattern';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import { AsidePanel, asideMenuIds } from '../ui/asidePanel';
import { menuAt } from '../ui/objectMenu';
import { registerAsideCommands } from '../areas/objects/commands';
import { digitizeDefaults } from '../digitize/digitize';
import { sewAgain, setAsideRole, dropAside, type AsideRole, setAside } from '../model/aside';
import { stitchesBefore } from '../model/transform';
import { t } from '../i18n';
import { ui } from './state';

/** What bindAside needs from the rest of the app. */
export interface AsideApp {
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly files: FileList;
  readonly frameObjects: () => number[];
  readonly history: (step: 'undo' | 'redo' | 'revert') => void;
  readonly layers: LayersPanel;
  readonly redraw: () => void;
  readonly seq: (p: Pattern) => Sequence;
  readonly settings: Settings;
  readonly takeShapes: (next: Pattern, select: number[]) => void;
}

/** Shapes not sewn: switched off or kept as guides. */
export function bindAside(app: AsideApp) {
  /** The shape the commands for "not sewn" work on: the one whose row was used last. */
  let target: number | null = null;
  const shapes = () => (app.settings.mode === 'flow' ? (ui.asideShown ?? []) : []);
  const find = (id: number) => shapes().find((a) => a.id === id) ?? null;

  /** Takes back the edit just made, if it is still the latest one. */
  const undoable = () => {
    const f = app.files.active;
    const p = f?.pattern;
    return () => {
      if (f && app.files.active === f && f.pattern === p) app.history('undo');
    };
  };

  function sew(id: number): void {
    const p = app.files.active?.pattern;
    if (!p) return;
    const r = sewAgain(p, id, { ...digitizeDefaults(app.settings.profile), trimMm: app.settings.trimMm });
    if (!r) return app.layers.say(t('aside.failed'), true);
    const mine = app.seq(r.pattern).objects.findIndex((o) => stitchesBefore(r.pattern, o.first) === r.start);
    ui.hoverAside = null;
    app.takeShapes(r.pattern, mine >= 0 ? [mine] : []);
    app.layers.say({ text: t('aside.done.sewn'), undo: undoable() });
  }

  function role(id: number, r: AsideRole): void {
    const p = app.files.active?.pattern;
    const next = p && setAsideRole(p, id, r);
    if (next) app.applyEdit(next);
  }

  function drop(id: number): void {
    const p = app.files.active?.pattern;
    const next = p && dropAside(p, id);
    if (!next) return;
    ui.hoverAside = null;
    app.applyEdit(next);
    app.layers.say({ text: t('aside.done.dropped'), undo: undoable() });
  }

  registerAsideCommands({
    flow: () => app.settings.mode === 'flow' && !!app.files.active?.pattern,
    target: () => (target !== null && find(target) ? target : null),
    roleOf: (id) => find(id)?.role ?? null,
    sew,
    role,
    drop,
  });

  const asidePanel = new AsidePanel({
    hover: (id) => {
      if (ui.hoverAside === id) return;
      ui.hoverAside = id;
      app.redraw();
    },
    target: (id) => (target = id),
    menu: (id, at) => {
      const a = find(id);
      if (!a) return;
      target = id;
      menuAt(asideMenuIds(a.role), at, t('objects.aside.menu'));
    },
  });

  /** The selected objects kept, but not sewn. */
  function putAside(role: AsideRole): void {
    const p = app.files.active?.pattern;
    const sel = app.frameObjects();
    if (!p || !sel.length) return;
    const next = setAside(p, sel, role, app.settings.trimMm);
    if (!next) return;
    app.takeShapes(next, []);
    const one = sel.length === 1;
    app.layers.say(role === 'guide' ? (one ? t('aside.done.guide') : t('aside.done.guideMany', { n: sel.length })) : one ? t('aside.done.off') : t('aside.done.offMany', { n: sel.length }));
  }

  return { asidePanel, putAside };
}
