import type { FileList } from '../ui/fileList';
import type { LayersPanel } from '../ui/layersPanel';
import type { Measurement } from '../validation/measure';
import type { Pattern } from '../model/pattern';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import { AsidePanel } from '../ui/asidePanel';
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
  readonly layers: LayersPanel;
  readonly redraw: () => void;
  readonly seq: (p: Pattern) => Sequence;
  readonly settings: Settings;
  readonly takeShapes: (next: Pattern, select: number[]) => void;
}

/** Shapes not sewn: switched off or kept as guides. */
export function bindAside(app: AsideApp) {
  const asidePanel = new AsidePanel({
    sew: (id) => {
      const p = app.files.active?.pattern;
      if (!p) return;
      const r = sewAgain(p, id, { ...digitizeDefaults(app.settings.profile), trimMm: app.settings.trimMm });
      if (!r) return app.layers.say(t('aside.failed'), true);
      const mine = app.seq(r.pattern).objects.findIndex((o) => stitchesBefore(r.pattern, o.first) === r.start);
      ui.hoverAside = null;
      app.takeShapes(r.pattern, mine >= 0 ? [mine] : []);
      app.layers.say(t('aside.done.sewn'));
    },
    role: (id, role) => {
      const p = app.files.active?.pattern;
      const next = p && setAsideRole(p, id, role);
      if (next) app.applyEdit(next);
    },
    drop: (id) => {
      const p = app.files.active?.pattern;
      const next = p && dropAside(p, id);
      if (!next) return;
      ui.hoverAside = null;
      app.applyEdit(next);
      app.layers.say(t('aside.done.dropped'));
    },
    hover: (id) => {
      if (ui.hoverAside === id) return;
      ui.hoverAside = id;
      app.redraw();
    },
  });

  /** The selected objects kept, but not sewn. */
  function putAside(role: AsideRole): void {
    const p = app.files.active?.pattern;
    const sel = app.frameObjects();
    if (!p || !sel.length) return;
    const next = setAside(p, sel, role, app.settings.trimMm);
    if (!next) return app.layers.say(t('aside.last'), true);
    app.takeShapes(next, []);
    const one = sel.length === 1;
    app.layers.say(role === 'guide' ? (one ? t('aside.done.guide') : t('aside.done.guideMany', { n: sel.length })) : one ? t('aside.done.off') : t('aside.done.offMany', { n: sel.length }));
  }

  return { asidePanel, putAside };
}
