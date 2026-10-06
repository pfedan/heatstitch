import type { CorrectionReport } from '../correct/auto';
import type { Editor } from '../ui/editor';
import type { FileList } from '../ui/fileList';
import type { FocusStitches, Scene } from '../render/scene';
import type { Measurement } from '../validation/measure';
import type { PlanPreview, Sequence } from './types';
import type { WorkerClient } from '../density/client';
import { Viewport } from '../render/viewport';
import { cssColor } from '../ui/threadPicker';
import { downloadPattern } from '../writers';
import { drawBeforeAfter, drawPanels } from '../render/compare';
import { gridToCanvas } from '../render/heatmap';
import { kindLabel } from '../ui/layersPanel';
import { numberInColor } from '../model/objects';
import { openOnPurpose, underlayRanges, holdMemory, rememberedIn } from '../model/restitch';
import { saveSettings, type Settings } from '../settings';
import { settledBy } from '../validation/acks';
import { syncBorders } from '../model/border';
import { t, type Key, formatNumber } from '../i18n';
import { type Cells, type PlanRow, type PlanView, CorrectPanel } from '../ui/correctPanel';
import { type Pattern, computeBounds } from '../model/pattern';
import { type Plan, planFabric, planCorrection, fineZones, applyProposals, type Box, wanted } from '../correct/plan';
import { type ValidationResult, classify } from '../validation/validate';
import { ui } from './state';

/** What bindCorrection needs from the rest of the app. */
export interface CorrectionApp {
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly ctx: CanvasRenderingContext2D;
  readonly density: WorkerClient;
  readonly editor: Editor;
  readonly files: FileList;
  readonly history: (step: 'undo' | 'redo' | 'revert') => void;
  readonly redraw: () => void;
  readonly scene: () => Scene;
  readonly seq: (p: Pattern) => Sequence;
  readonly setComparing: (on: boolean) => void;
  readonly settings: Settings;
  readonly stageBg: () => string;
  readonly validator: WorkerClient;
  readonly vp: Viewport;
}

/** Correction: proposals for the findings, their before and after preview, and applying them. */
export function bindCorrection(app: CorrectionApp) {
  const cellsOf = (v: ValidationResult): Cells => ({ critical: v.criticalCells, caution: v.cautionCells });
  const measured = async (p: Pattern) => classify(await app.validator.measure(p, openOnPurpose(p, app.seq(p).objects) ?? undefined), app.settings.profile, app.settings.checks);

  /** The card's view of `planState` after a box was ticked or not. */
  function planMessage(): void {
    const st = ui.planState;
    if (!st) return;
    st.view = {
      ...st.view,
      rows: st.view.rows.map((r) => ({ ...r, checked: r.ids.every((id) => st.checked.has(id)), pinned: !!ui.planPin && r.ids.join() === ui.planPin.join() })),
      fineChecked: st.fineOn,
    };
    ui.correctMessage = { kind: 'plan', plan: st.view };
  }

  /** The proposals as the card's rows: the same change on several objects of a kind is one row ("Steppstich 3, 4, 7"). */
  function planRows(p: Pattern, proposals: Plan['proposals']): PlanRow[] {
    const objs = app.seq(p).objects;
    const rows: PlanRow[] = [];
    const nameOf = (i: number) => `${numberInColor(objs.filter((y) => y.block === objs[i].block), objs[i])}`;
    for (const x of proposals) {
      const sig = JSON.stringify([x.kind, x.visibility, x.hand > 0, x.knockout, x.reasons, objs[x.index].color, x.changes.map((c) => [c.field, c.to])]);
      const same = rows.find((r) => (r as PlanRow & { sig?: string }).sig === sig);
      if (same) {
        same.ids.push(x.id);
        same.name += `, ${nameOf(x.index)}`;
        same.hand += x.hand;
        // Different values before: only the new one is said.
        same.changes = same.changes.map((c, k) => (c.from === x.changes[k]?.from ? c : { ...c, from: '' }));
        continue;
      }
      rows.push(
        Object.assign(
          {
            ids: [x.id],
            name: `${kindLabel(x.kind)} ${nameOf(x.index)}`,
            color: cssColor(objs[x.index].color),
            kind: x.kind,
            visibility: x.visibility,
            changes: x.changes.map((c) => ({ ...c })),
            knockout: x.knockout,
            reasons: x.reasons,
            hand: x.hand,
            checked: x.checked,
          },
          { sig },
        ),
      );
    }
    return rows;
  }

  /**
   * "Auf Stoff abstimmen": the settings that suit the material better, as proposals in the
   * correction card (nothing changes before they are taken over). `quiet`: say nothing when none.
   */
  function tuneToFabric(quiet = false): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p || ui.correctMessage?.kind === 'busy' || ui.correctMessage?.kind === 'progress') return;
    const proposals = planFabric(p, app.settings.profile);
    const name = t(`fabric.${app.settings.profile.fabric}` as Key);
    if (!proposals.length) {
      if (quiet) return;
      ui.planState = null;
      ui.correctMessage = { kind: 'text', text: t('tune.none', { fabric: name }) };
      return app.redraw();
    }
    const plan: Plan = { proposals, fine: [], locked: 0, pattern: p };
    const v = f.validation;
    const view: PlanView = {
      title: t(proposals.length === 1 ? 'tune.head.one' : 'tune.head', { n: formatNumber(proposals.length), fabric: name }),
      rows: planRows(p, proposals),
      fine: 0,
      fineChecked: false,
      locked: 0,
      before: v ? cellsOf(v) : { critical: 0, caution: 0 },
      after: null,
    };
    ui.planState = { file: f, pattern: p, plan, checked: new Set(), fine: [], fineOn: false, view };
    planMessage();
    app.redraw();
  }

  /**
   * Shows proposals worked out elsewhere (the traffic light's visible rest) in the correction card,
   * unticked, with their before and after preview; nothing changes before they are taken over.
   */
  function offerPlan(plan: Plan, title: string): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p || !plan.proposals.length || busy()) return;
    const v = f.validation;
    const view: PlanView = { title, rows: planRows(p, plan.proposals), fine: 0, fineChecked: false, locked: plan.locked, before: v ? cellsOf(v) : { critical: 0, caution: 0 }, after: null };
    ui.planState = { file: f, pattern: p, plan: { ...plan, pattern: p }, checked: new Set(), fine: [], fineOn: false, view };
    planMessage();
    app.redraw();
  }

  /** Works out proposals for the whole design or the selected zone; nothing changes yet. */
  async function planFix(scope: 'all' | 'zone'): Promise<void> {
    const f = app.files.active;
    const p = f?.pattern;
    const v = f?.validation;
    if (!f || !p || !v || ui.correctMessage?.kind === 'busy' || ui.correctMessage?.kind === 'progress') return;
    const z = ui.selectedZone;
    const pad = 1; // mm around the zone
    const region = scope === 'zone' && z ? { minX: z.bbox.minX - pad, minY: z.bbox.minY - pad, maxX: z.bbox.maxX + pad, maxY: z.bbox.maxY + pad } : undefined;
    ui.planState = null;
    ui.planHover = null;
    ui.planPreview = null;
    const stale = () => app.files.active !== f || f.pattern !== p;
    ui.correctMessage = { kind: 'progress', done: 0, total: 0 };
    app.redraw();
    try {
      const opt = { ...app.settings.correction, region, acks: f.acks, trimMm: app.settings.trimMm };
      const plan = await planCorrection(p, v, app.settings.profile, app.settings.checks, {
        ...opt,
        stale,
        progress: async (done, total) => {
          if (ui.correctMessage?.kind !== 'progress' || ui.correctMessage.done !== done || ui.correctMessage.total !== total) {
            ui.correctMessage = { kind: 'progress', done, total };
            app.redraw();
          }
          await new Promise((r) => setTimeout(r, 0));
        },
      });
      if (stale()) return;
      const after = plan.proposals.length ? await measured(plan.pattern) : v;
      if (stale()) return;
      const fine = fineZones(p, after, plan.proposals, opt);
      const rows = planRows(p, plan.proposals);
      const view: PlanView = { rows, fine: fine.length, fineChecked: false, locked: plan.locked, before: cellsOf(v), after: plan.proposals.length ? cellsOf(after) : null };
      ui.planState = { file: f, pattern: p, plan, checked: new Set(), fine, fineOn: false, view };
      planMessage();
    } catch (err) {
      console.error(err);
      ui.correctMessage = { kind: 'text', text: t('correct.error', { msg: err instanceof Error ? err.message : String(err) }) };
    }
    app.redraw();
  }

  /**
   * The stitches of the objects `which` (sewing order), each as a pattern of its own with its
   * underlay marked (read from what the objects remember, so while that is there).
   */
  function objectStitches(p: Pattern, which: number[], under: boolean): FocusStitches[] {
    const q = app.seq(p);
    return [...new Set(which)].flatMap((i) => {
      const o = q.objects[i];
      if (!o) return [];
      const x = p.x.slice(o.first, o.last + 1);
      const y = p.y.slice(o.first, o.last + 1);
      const cmd = p.cmd.slice(o.first, o.last + 1);
      const mask = new Uint8Array(cmd.length);
      if (under) for (const [a, b] of underlayRanges(p, o, q.kinds)) for (let k = a; k <= b; k++) if (k >= o.first && k <= o.last) mask[k - o.first] = 1;
      return [{ pattern: { name: p.name, format: p.format, x, y, cmd, colors: [o.color], bounds: computeBounds(x, y, cmd) }, under: mask.includes(1) ? mask : null }];
    });
  }

  /** Previews of the proposals by their ids, for the plan they belong to. */
  let planPreviews: { plan: Plan; byIds: Map<string, PlanPreview | null> } | null = null;
  /** Where the line between before and after lies in the object's frame (0 left, 1 right). */
  let planSplit = 0.5;
  /** The frame of the comparison on the screen as last drawn, and whether its line is being dragged. */
  let planFrame: { x0: number; y0: number; x1: number; y1: number } | null = null;

  /** Holds the proposals `ids` for comparing, or lets go (null). */
  function pinPlan(ids: number[] | null): void {
    ui.planPin = ids;
    ui.planHover = ids && proposalsBox(ids);
    showPlanPreview(ids);
    planMessage();
    app.redraw();
  }

  /** Inside the frame of the comparison on the screen. */
  const inPlanFrame = (sx: number, sy: number) => !!planFrame && sx >= planFrame.x0 && sx <= planFrame.x1 && sy >= planFrame.y0 && sy <= planFrame.y1;

  /** The line between before and after follows `sx` (kept a little inside the frame). */
  function movePlanSplit(sx: number): void {
    if (!planFrame) return;
    planSplit = Math.min(0.97, Math.max(0.03, (sx - planFrame.x0) / Math.max(1, planFrame.x1 - planFrame.x0)));
    app.redraw();
  }

  /**
   * Shows the proposals `ids` taken over on the canvas, without changing anything: the stitches at
   * once, their heatmap when it is worked out. Null: back to the design as it is.
   */
  function showPlanPreview(ids: number[] | null): void {
    const st = ui.planState;
    ui.planPreview = null;
    if (!st || !ids || app.files.active !== st.file || st.file.pattern !== st.pattern) return;
    if (planPreviews?.plan !== st.plan) planPreviews = { plan: st.plan, byIds: new Map() };
    const key = ids.join(',');
    const cache = planPreviews.byIds;
    if (!cache.has(key)) {
      const chosen = st.plan.proposals.filter((x) => ids.includes(x.id));
      // Sewn for a look only: what the objects remember stays as it is.
      const release = holdMemory();
      const which = chosen.map((x) => x.index);
      // The underlay is marked only where the proposal changes it (elsewhere it would only cover the change).
      const under = chosen.some((x) => x.changes.some((c) => UNDER_FIELDS.has(c.field)));
      let pv: PlanPreview | null = null;
      try {
        const pattern = applyProposals(st.pattern, chosen, app.settings.trimMm)?.pattern ?? null;
        // Its underlay is read from what the new stitches remember, before that is let go.
        if (pattern) pv = { pattern, img: null, before: [], focus: objectStitches(pattern, which, under) };
      } finally {
        release();
      }
      if (pv) pv.before = objectStitches(st.pattern, which, under);
      cache.set(key, pv);
      if (pv) {
        const { metric, cellMm, blurMm, includeJumps } = app.settings;
        void app.density
          .density(pv.pattern, { metric, cellMm, blurMm, includeJumps })
          .then((g) => {
            pv.img = gridToCanvas(g, app.settings.scales[metric].max);
            if (ui.planPreview === pv) app.redraw();
          })
          .catch((err) => console.error(err));
      }
    }
    ui.planPreview = cache.get(key) ?? null;
  }

  /** Settings of the underlay: a proposal changing one of them shows the underlay in its preview. */
  const UNDER_FIELDS = new Set(['underlay', 'underCross', 'under', 'underCover']);

  /** Below this size on the screen (CSS pixels), before and after are also shown whole side by side. */
  const SIDE_BELOW = 240;

  /** Top of the side-by-side comparison on the canvas (below the canvas tools), CSS pixels. */
  const LOUPE_TOP = 56;

  /**
   * The proposal under the pointer, before and after side by side in its object's frame (left as
   * it is, right as it would be: stitches clear on their heatmap, underlay marked), and both whole
   * side by side at the top left of the canvas.
   */
  function drawPlanCompare(): void {
    const pv = ui.planPreview;
    const b = ui.planHover;
    planFrame = null;
    if (!pv || !b || app.settings.mode !== 'density' || ui.planState?.file !== app.files.active) return;
    const pad = 1.5; // mm, as the frame of a zone
    const box = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    const before: Scene = { ...app.scene(), validation: null, validationImg: null, counted: null, highlight: null, markers: null, focus: pv.before };
    const after: Scene = { ...before, pattern: pv.pattern, gridImg: pv.img ?? ui.gridImg, focus: pv.focus };
    const labels: [string, string] = [t('plan.before'), t('plan.after')];
    const [x0, y0] = app.vp.toScreen(box.minX, box.minY);
    const [x1, y1] = app.vp.toScreen(box.maxX, box.maxY);
    drawBeforeAfter(app.ctx, ui.stageW, ui.stageH, { x0, y0, x1, y1 }, before, after, app.stageBg(), labels, planSplit);
    planFrame = { x0, y0, x1, y1 };
    if (Math.min(x1 - x0, y1 - y0) >= SIDE_BELOW) return;
    // Small: before and after side by side, each whole and enlarged, at the top left (or the top
    // right when the object lies there): the difference at a glance.
    const gap = 6;
    const pw = Math.min(220, (ui.stageW - 24 - gap) / 2);
    const ph = Math.min(260, ui.stageH - 80);
    const scale = Math.min(pw / (box.maxX - box.minX), ph / (box.maxY - box.minY));
    const w = (box.maxX - box.minX) * scale;
    const h = (box.maxY - box.minY) * scale;
    const panel = (x: number, sc: Scene, label: string) => {
      const pvp = new Viewport();
      pvp.scale = scale;
      pvp.offsetX = x - box.minX * scale;
      pvp.offsetY = LOUPE_TOP - box.minY * scale;
      return { rect: { x0: x, y0: LOUPE_TOP, x1: x + w, y1: LOUPE_TOP + h }, scene: { ...sc, vp: pvp }, label };
    };
    const total = 2 * w + gap;
    const left = !(x0 < 12 + total + 12 && y0 < LOUPE_TOP + h + 12);
    const sx = left ? 12 : ui.stageW - 12 - total;
    drawPanels(app.ctx, ui.stageW, ui.stageH, [panel(sx, before, labels[0]), panel(sx + w + gap, after, labels[1])], app.stageBg());
  }

  /** Where the objects of the proposals `ids` lie, together (mm). */
  function proposalsBox(ids: number[]): Box | null {
    const bs = (ui.planState?.plan.proposals ?? []).filter((x) => ids.includes(x.id)).map((x) => x.box);
    if (!bs.length) return null;
    return { minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) };
  }

  /** Adds up the fine corrections of several places. */
  function addReports(a: CorrectionReport | undefined, b: CorrectionReport): CorrectionReport {
    if (!a) return b;
    const sum = { ...a };
    for (const k of ['zeroLength', 'merged', 'pulledBack', 'shortened', 'hiddenRows', 'respaced', 'respacedRows', 'moved'] as const) sum[k] = a[k] + b[k];
    return sum;
  }

  /** Takes over the ticked proposals and the fine correction, as one step to undo. */
  async function applyPlan(): Promise<void> {
    const st = ui.planState;
    const f = app.files.active;
    if (!st || !f || st.file !== f || f.pattern !== st.pattern) {
      ui.planState = null;
      ui.correctMessage = null;
      return app.redraw();
    }
    const chosen = st.plan.proposals.filter((x) => st.checked.has(x.id));
    ui.correctMessage = { kind: 'busy' };
    ui.planHover = null;
    ui.planPreview = null;
    app.redraw();
    try {
      let p = st.pattern;
      let done = 0;
      const r = chosen.length ? applyProposals(p, chosen, app.settings.trimMm) : null;
      if (r) {
        p = syncBorders(r.pattern, app.settings.trimMm);
        done = r.done;
      }
      let fine: CorrectionReport | undefined;
      if (st.fineOn) {
        for (const b of st.fine) {
          const pad = 1;
          const c = await app.validator.correct(p, app.settings.profile, app.settings.checks, { ...app.settings.correction, region: { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, acks: f.acks });
          if (c.pattern !== p) {
            p = c.pattern;
            fine = addReports(fine, c.report);
          }
        }
      }
      if (app.files.active !== f || f.pattern !== st.pattern) return;
      ui.planState = null;
      if (p === st.pattern) {
        ui.correctMessage = { kind: 'text', text: t('correct.noChange') };
        return app.redraw();
      }
      app.editor.reset();
      app.applyEdit(p);
      app.files.setObjects(f, rememberedIn(p, app.seq(p).objects));
      const after = await measured(p);
      const open = after.zones.filter((z) => !z.practice && !settledBy(z, f.acks) && wanted(z, app.settings.correction).length).length;
      ui.correctMessage = { kind: 'applied', done, before: st.view.before, after: cellsOf(after), fine, open };
    } catch (err) {
      console.error(err);
      ui.correctMessage = { kind: 'text', text: t('correct.error', { msg: err instanceof Error ? err.message : String(err) }) };
    }
    app.redraw();
  }

  const correctPanel = new CorrectPanel(app.settings, {
    plan: (scope) => void planFix(scope),
    tune: () => tuneToFabric(),
    check: (ids, on) => {
      const st = ui.planState;
      if (!st) return;
      if (ids === 'fine') st.fineOn = on;
      else for (const id of ids) on ? st.checked.add(id) : st.checked.delete(id);
      planMessage();
      app.redraw();
    },
    applyPlan: () => void applyPlan(),
    discardPlan,
    checkAll: (on) => {
      const st = ui.planState;
      if (!st) return;
      st.checked = new Set(on ? st.plan.proposals.map((x) => x.id) : []);
      st.fineOn = on && st.fine.length > 0;
      planMessage();
      app.redraw();
    },
    hoverProposal: (ids) => {
      // Away from the list, the held proposal comes back.
      const show = ids ?? ui.planPin;
      ui.planHover = show && proposalsBox(show);
      showPlanPreview(show);
      app.redraw();
    },
    splitProposal: (at) => {
      planSplit = Math.min(0.97, Math.max(0.03, at));
      app.redraw();
    },
    showProposal: (ids) => {
      // A second click lets go; otherwise it is held and the view goes to it.
      if (ui.planPin?.join() === ids.join()) return pinPlan(null);
      const b = proposalsBox(ids);
      if (!b) return;
      const pad = 4;
      app.vp.fit(b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad, ui.stageW, ui.stageH);
      pinPlan(ids);
    },
    toggleCompare: () => app.setComparing(!ui.comparing),
    deleteSelection: () => app.editor.deleteSelection(),
    thinSelection: (share) => {
      if (!app.editor.thinSelection(share)) ui.correctMessage = { kind: 'text', text: t('edit.thin.none') };
      app.redraw();
    },
    undo: () => app.history('undo'),
    redo: () => app.history('redo'),
    revert: () => app.history('revert'),
    save: (format, name) => {
      const f = app.files.active;
      if (f?.pattern) downloadPattern({ ...f.pattern, name }, format, `${name}.${format}`, { hoop: f.material.hoop });
    },
    optionsChanged: () => saveSettings(app.settings),
  });

  /** Drops the proposals. */
  function discardPlan(): void {
    ui.planState = null;
    ui.planHover = null;
    ui.planPreview = null;
    ui.planPin = null;
    ui.correctMessage = null;
    app.redraw();
  }

  /** Whether proposals are shown, and whether any of them is ticked. */
  const busy = () => ui.correctMessage?.kind === 'busy' || ui.correctMessage?.kind === 'progress';
  const planShown = () => !!ui.planState && ui.planState.file === app.files.active;
  const planTicked = () => planShown() && (ui.planState!.checked.size > 0 || (ui.planState!.fineOn && ui.planState!.fine.length > 0));

  return { correctPanel, drawPlanCompare, inPlanFrame, movePlanSplit, pinPlan, tuneToFabric, planFix, applyPlan, discardPlan, offerPlan, busy, planShown, planTicked };
}
