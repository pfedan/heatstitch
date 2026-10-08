import type { FileList } from '../ui/fileList';
import type { LayersPanel } from '../ui/layersPanel';
import type { Measurement } from '../validation/measure';
import type { Sequence } from './types';
import type { Viewport } from '../render/viewport';
import { JumpsPanel } from '../ui/jumpsPanel';
import { OrderCard } from '../ui/objectPanel';
import { bestOrder, orderSeconds, orderStats, type OrderChoice } from '../model/bestOrder';
import { saveSettings, type Settings } from '../settings';
import { setTrims } from '../model/jumps';
import { recordOfStitch } from '../model/sequence';
import { t } from '../i18n';
import type { Pattern } from '../model/pattern';
import { remember, rememberedIn } from '../model/restitch';
import { ui } from './state';

/** What bindOrder needs from the rest of the app. */
export interface OrderApp {
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly files: FileList;
  readonly layers: LayersPanel;
  readonly overOf: (q: Sequence, p: Pattern) => number[][];
  readonly redraw: () => void;
  readonly seq: (p: Pattern) => Sequence;
  readonly settings: Settings;
  readonly vp: Viewport;
}

/** The stitch order card (better order, fewer colors and trims) and the jumps and trims panel. */
export function bindOrder(app: OrderApp) {
  /**
   * The pattern "Optimize order" found for the active one, kept while its card is open, with the
   * objects sewn from the other side in it (what to remember about their new stitches).
   */
  let pendingOrder: (OrderChoice & { p: Pattern }) | null = null;

  /** The best order for `p` with the options of the card, never worse than `p` in what the card shows. */
  function findOrder(p: Pattern): NonNullable<typeof pendingOrder> | null {
    const q = app.seq(p);
    const found = bestOrder(p, { objects: q.objects, kinds: q.kinds, over: app.overOf(q, p) }, { ...app.settings.order, trimMm: app.settings.trimMm }, app.settings);
    return found && { ...found, p };
  }

  const orderCard = new OrderCard(app.settings, {
    preview: () => {
      const p = app.files.active?.pattern;
      if (!p) return null;
      pendingOrder = findOrder(p);
      const next = pendingOrder?.next ?? p;
      const before = orderStats(p);
      const after = orderStats(next);
      return { before, after, beforeSeconds: orderSeconds(p, before, app.settings), afterSeconds: orderSeconds(next, after, app.settings), changed: next !== p, reversed: pendingOrder?.reversed.length ?? 0 };
    },
    apply: () => {
      const f = app.files.active;
      const p = f?.pattern;
      if (!f || !p || pendingOrder?.p !== p) return;
      const before = orderStats(p);
      const { next, reversed } = pendingOrder;
      pendingOrder = null;
      // Objects sewn anew from the other side remember their shape and settings, as after any new stitches.
      if (reversed.length) {
        const nq = app.seq(next);
        for (const r of reversed) {
          const o = nq.objectAt[recordOfStitch(nq.numbers, r.start + 1)];
          if (o >= 0) remember(next, nq.objects[o], r.memory);
        }
        app.files.setObjects(f, rememberedIn(next, nq.objects));
      }
      ui.selectedObjects = new Set();
      ui.hiddenBlocks = new Set();
      ui.focusBlock = null;
      // New stitches need a new density measurement; a new order alone does not.
      app.applyEdit(next, reversed.length ? undefined : f.measurement);
      const after = orderStats(next);
      const parts: string[] = [];
      const dc = before.colorChanges - after.colorChanges;
      const dt = before.trims - after.trims;
      if (dc > 0) parts.push(t(dc === 1 ? 'order.fewerColors.one' : 'order.fewerColors', { n: dc }));
      if (dt > 0) parts.push(t(dt === 1 ? 'order.fewerTrims.one' : 'order.fewerTrims', { n: dt }));
      if (!parts.length) parts.push(t('order.shorterTravel'));
      app.layers.say(t('order.applied', { what: parts.join(', ') }));
    },
    cancel: () => {
      pendingOrder = null;
    },
    saved: () => saveSettings(app.settings),
  });

  /** Frames the jump with a few millimetres around it. */
  function showJump(k: number): void {
    const p = app.files.active?.pattern;
    const j = p && app.seq(p).transitions[k];
    if (!p || !j) return;
    // At least 25 mm across, so the jump is seen in its surroundings.
    const cx = (p.x[j.from] + p.x[j.to]) / 20;
    const cy = (p.y[j.from] + p.y[j.to]) / 20;
    const half = Math.max(12.5, Math.abs(p.x[j.from] - p.x[j.to]) / 20 + 4, Math.abs(p.y[j.from] - p.y[j.to]) / 20 + 4);
    app.vp.fit(cx - half, cy - half, cx + half, cy + half, ui.stageW, ui.stageH);
  }

  function selectJump(k: number | null): void {
    ui.selectedJump = k;
    if (k !== null) showJump(k);
    app.redraw();
  }

  const jumpsPanel = new JumpsPanel(app.settings, {
    select: selectJump,
    hover: (k) => {
      ui.hoverJump = k;
      app.redraw();
    },
    step: (dir) => stepJump(dir),
    apply: (indices, cut) => {
      const f = app.files.active;
      const p = f?.pattern;
      if (!f || !p) return;
      const list = app.seq(p).transitions;
      const next = setTrims(p, indices.map((i) => list[i]), cut);
      if (next === p) return;
      const keep = ui.selectedJump;
      app.applyEdit(next);
      // The jumps stay the same ones in the same order, so the selection carries over.
      ui.selectedJump = keep;
      app.redraw();
    },
    limitChanged: () => {
      saveSettings(app.settings);
      app.redraw();
    },
  });

  function stepJump(dir: 1 | -1): void {
    const p = app.files.active?.pattern;
    if (!p) return;
    const shown = jumpsPanel.visible(app.seq(p).transitions);
    if (!shown.length) return;
    const i = ui.selectedJump !== null ? shown.indexOf(ui.selectedJump) : -1;
    selectJump(shown[i < 0 ? (dir > 0 ? 0 : shown.length - 1) : (i + dir + shown.length) % shown.length]);
  }

  return { jumpsPanel, orderCard, orderStats, stepJump };
}
