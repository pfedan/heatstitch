import { loadCatalogs } from './threads/catalog';
import './style.css';
import './areas/cleanup/cleanup.css';
import { WorkerClient } from './density/client';
import { detectLang, docsUrl, formatNumber, getLang, onLangChange, pageLang, setLang, t, type Lang } from './i18n';
import { gridToCanvas } from './render/heatmap';
import { drawLegend } from './render/legend';
import { hoopRect } from './render/hoop';
import { drawScene, type Scene } from './render/scene';
import { validationToCanvas } from './render/validationOverlay';
import { Viewport } from './render/viewport';
import { loadSettings, materialOf, saveSettings } from './settings';
import { bindControls, type ChangeKind } from './ui/controls';
import { Editor } from './ui/editor';
import { keepObjects, type HandChange } from './model/handEdit';
import { exportPng } from './ui/export';
import { FileList, type LoadedFile } from './ui/fileList';
import { bindHoop } from './ui/hoopPanel';
import { scaling } from './shape/path';
import { scaleBlocked } from './model/reshape';
import { legendSpec } from './ui/legendSpec';
import { bindProfile } from './ui/profilePanel';
import { renderStats } from './ui/stats';
import { ValidationPanel } from './ui/validationPanel';
import { acknowledgementOf, settledBy, type Acknowledgement } from './validation/acks';
import type { ValidationResult, Zone } from './validation/validate';
import { POINTS_MIN_SCALE } from './render/editOverlay';
import { drawDivider, drawPanels } from './render/compare';
import { STITCH, type Pattern, type ThreadColor } from './model/pattern';
import type { Measurement } from './validation/measure';
import { initUpdateNotice } from './ui/updateNotice';
import { bindFileIo } from './app/fileIo';
import { writePattern } from './writers';
import { parsePattern } from './parsers';
import { ImageMode } from './ui/imageMode';
import { sweep } from './render/light';
import { classify } from './validation/validate';
import {
  FILL,
  SATIN,
  TIE_STITCH,
} from './model/sequence';
import { stitchAt } from './render/flow';
import type { Mode } from './settings';
import { isGuessed, isOpenPattern, openOnPurpose, remembered, rememberedIn, rememberShapes } from './model/restitch';
import { drawAside, drawDrawing } from './render/shapeOverlay';
import type { LeftOut } from './ui/imageMode';
import { asideOf, storeAside, type AsideShape } from './model/aside';
import { type Digitized } from './digitize/digitize';
import { numberInColor, rememberObjects, sewObjects } from './model/objects';
import { isLine, reversible } from './model/reverse';
import { Player } from './ui/player';
import { installPanelResize } from './ui/panelResize';
import type { Key } from './i18n';
import type { Sequence } from './app/types';
import { ui } from './app/state';
import { bindRungs } from './app/rungs';
import { bindPointer } from './app/pointer';
import { bindKeys } from './app/keys';
import { bindLight } from './app/light';
import { bindShapes } from './app/shapes';
import { bindDrawing } from './app/drawing';
import { bindAside } from './app/aside';
import { bindLettering } from './app/lettering';
import { bindCorrection } from './app/correction';
import { bindOrder } from './app/order';
import { bindStitches } from './app/stitches';
import { bindObjects } from './app/objects';
import { bindScene } from './app/scene';
import { initShell } from './shell/setup';
import { initStitchArea } from './areas/stitches';
import { initDesign } from './areas/design';
import { initReady } from './areas/ready';
import { initShapes, refreshShapes } from './areas/shapes';
import { runCommand } from './shell/commands';
import { initCheck } from './areas/check/check';
import { initAmpel } from './areas/ampel/ampel';
import { initResponsive } from './areas/responsive/responsive';
import type { ZoneDecision } from './ui/validationPanel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

initUpdateNotice($('update-notice'));
const stage = $<HTMLElement>('stage');
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
const legend = $<HTMLCanvasElement>('legend');
const tooltip = $<HTMLElement>('tooltip');
const empty = $<HTMLElement>('empty');
const exportBtn = $<HTMLButtonElement>('export');

const settings = loadSettings();
const vp = new Viewport();
// Two workers so a long validation never delays heatmap updates; corrections share the validator.
const density = new WorkerClient();
const validator = new WorkerClient();
/** Original validation overlay, cached like `validationImg`. */
let origValidationImg: { v: ValidationResult; acks: Acknowledgement[]; img: HTMLCanvasElement } | null = null;

const stageBg = () => getComputedStyle(stage).backgroundColor;

/** Validation overlay image, rebuilt when the active file's classification changes. */
let validationImg: { v: ValidationResult; acks: Acknowledgement[]; img: HTMLCanvasElement } | null = null;

const files = new FileList(
  $<HTMLUListElement>('file-list'),
  (f) => {
    if (f) adoptMaterial(f);
    ui.grid = null;
    ui.gridImg = null;
    ui.origGrid = null;
    ui.origGridImg = null;
    ui.origKey = null;
    ui.hoverZone = ui.selectedZone = null;
    ui.correctMessage = null;
    editor.reset();
    resetFlow();
    if (f?.pattern && !ui.keepView) fitView(f);
    recompute();
  },
  (p) => validator.measure(p, openOnPurpose(p, seq(p).objects) ?? undefined),
  (f) => {
    if (f === files.active) redraw();
  },
  () => materialOf(settings),
);

/** Per zone of `v`: whether it still counts with the active file's decisions. */
const countedFor = (v: ValidationResult | null | undefined): boolean[] | null =>
  v ? v.zones.map((z) => !settledBy(z, files.active?.acks)) : null;

function activeValidationImg(): HTMLCanvasElement | null {
  const f = files.active;
  const v = f?.validation;
  if (!f || !v) return null;
  if (validationImg?.v !== v || validationImg.acks !== f.acks) validationImg = { v, acks: f.acks, img: validationToCanvas(v, countedFor(v)) };
  return validationImg.img;
}

const scene = (): Scene => ({
  pattern: (settings.mode === 'flow' ? ui.flowPreview : null) ?? editor.preview ?? files.active?.pattern ?? null,
  flow: flowScene(),
  markers: settings.mode === 'density' && files.active?.pattern && !editor.preview ? seq(files.active.pattern).markers : null,
  grid: ui.grid,
  gridImg: ui.gridImg,
  validation: files.active?.validation ?? null,
  validationImg: activeValidationImg(),
  counted: countedFor(files.active?.validation),
  highlight: ui.planHover ? { bbox: ui.planHover } : settings.showValidation ? (ui.hoverZone ?? ui.selectedZone) : null,
  settings,
  vp,
  edit: editor.active ? editor : null,
});

/** True while the comparison view has something to compare. */
const showCompare = () => ui.comparing && FileList.changed(files.active);

/** The original pattern with its own heatmap and markings, for the left side of the divider. */
function originalScene(): Scene {
  const f = files.active!;
  const v = f.originalValidation ?? null;
  if (v && (origValidationImg?.v !== v || origValidationImg.acks !== f.acks)) {
    origValidationImg = { v, acks: f.acks, img: validationToCanvas(v, countedFor(v)) };
  }
  return {
    pattern: f.original ?? null,
    grid: ui.origGrid,
    gridImg: ui.origGridImg,
    validation: v,
    validationImg: v ? origValidationImg!.img : null,
    counted: countedFor(v),
    highlight: null,
    settings,
    vp,
    edit: null,
  };
}

const panel = new ValidationPanel($('validation'), $('findings-sum'), {
  onZone: (z) => selectZone(z),
  onHover: (z) => {
    ui.hoverZone = z;
    redraw();
  },
  onStep: (dir) => stepZone(dir),
  onDecide: (z, d) => decideZone(z, d),
});

/** One decision per zone: the new one replaces whatever was stored for it. */
function decideZone(z: Zone, d: ZoneDecision): void {
  const f = files.active;
  if (!f) return;
  const rest = f.acks.filter((a) => a !== acknowledgementOf(z, f.acks));
  const bbox = { ...z.bbox };
  files.setAcks(f, d === 'ack' ? [...rest, { bbox, reason: 'manual' }] : d === 'reopen' ? [...rest, { bbox, reason: 'reopened' }] : rest);
  redraw();
}

installPanelResize($('layout'), settings.panels, () => saveSettings(settings));

// Ablauf mode ------------------------------------------------------------------

const { NO_COLORS, NO_RANGE, flowScene, overOf, playerModel, resetFlow, seq, seqCache, styleFor } = bindScene({
  get files() {
    return files;
  },
  get frameTool() {
    return frameTool;
  },
  get layers() {
    return layers;
  },
  get orderCard() {
    return orderCard;
  },
  get player() {
    return player;
  },
  get rungTool() {
    return rungTool;
  },
  get settings() {
    return settings;
  },
  get shapeTool() {
    return shapeTool;
  },
  get stitchInfo() {
    return stitchInfo;
  },
});

const player = new Player(settings, () => {
  saveSettings(settings);
  redraw();
});

const { colorList, layers, mergeBlocked, objectName, objectPanel, selectObjects } = bindObjects({
  offerShapeBack,
  get commitTransform() {
    return commitTransform;
  },
  get knockoutObjects() {
    return knockoutObjects;
  },
  get orderCard() {
    return orderCard;
  },
  get objectInfo() {
    return objectInfo;
  },
  get drawTool() {
    return drawTool;
  },
  get applyEdit() {
    return applyEdit;
  },
  get applyRestitched() {
    return applyRestitched;
  },
  get closeRungs() {
    return closeRungs;
  },
  get closeShape() {
    return closeShape;
  },
  get deleteSelected() {
    return deleteSelected;
  },
  get duplicateSelected() {
    return duplicateSelected;
  },
  get copySelected() {
    return copySelected;
  },
  get pasteCopied() {
    return pasteCopied;
  },
  get canPaste() {
    return canPaste;
  },
  get editor() {
    return editor;
  },
  get enterShape() {
    return enterShape;
  },
  get files() {
    return files;
  },
  get frameObjects() {
    return frameObjects;
  },
  get history() {
    return history;
  },
  get letteringsOf() {
    return letteringsOf;
  },
  get mirrorSelected() {
    return mirrorSelected;
  },
  get orderStats() {
    return orderStats;
  },
  get overOf() {
    return overOf;
  },
  get putAside() {
    return putAside;
  },
  get redraw() {
    return redraw;
  },
  get rungTool() {
    return rungTool;
  },
  get seq() {
    return seq;
  },
  get setEditing() {
    return setEditing;
  },
  get settings() {
    return settings;
  },
  get shapeTarget() {
    return shapeTarget;
  },
  get showBand() {
    return showBand;
  },
  get shapeTool() {
    return shapeTool;
  },
  get showObjectMenu() {
    return showObjectMenu;
  },
  get subtractSelected() {
    return subtractSelected;
  },
  get takeShapes() {
    return takeShapes;
  },
  get followKnockouts() {
    return followKnockouts;
  },
  get updateLevel() {
    return updateLevel;
  },
});

const { applyRestitched, convertSettings, looseObjects, stitchInfo, stitchPanel } = bindStitches({
  get objectPanel() {
    return objectPanel;
  },
  get applyEdit() {
    return applyEdit;
  },
  get takeShapes() {
    return takeShapes;
  },
  get closeRungs() {
    return closeRungs;
  },
  get files() {
    return files;
  },
  get isLineObject() {
    return isLineObject;
  },
  get knockoutObjects() {
    return knockoutObjects;
  },
  get layers() {
    return layers;
  },
  get redraw() {
    return redraw;
  },
  get rungTool() {
    return rungTool;
  },
  get selectObjects() {
    return selectObjects;
  },
  get seq() {
    return seq;
  },
  get seqCache() {
    return seqCache;
  },
  get settings() {
    return settings;
  },
  get sewAlongLines() {
    return sewAlongLines;
  },
  get suggestLines() {
    return suggestLines;
  },
  get sewLine() {
    return sewLine;
  },
  get sewLineAgain() {
    return sewLineAgain;
  },
  get convertToSatin() {
    return convertToSatin;
  },
  get toggleGuides() {
    return toggleGuides;
  },
  get togglePoints() {
    return togglePoints;
  },
  get toggleRungs() {
    return toggleRungs;
  },
});

// Rungs -------------------------------------------------------------------------------------------

const { closeRungs, convertToSatin, rungInfo, rungTool, sewAlongLines, suggestLines, syncRungs, toggleGuides, togglePoints, toggleRungs } = bindRungs({
  get applyRestitched() {
    return applyRestitched;
  },
  get convertSettings() {
    return convertSettings;
  },
  get editor() {
    return editor;
  },
  get files() {
    return files;
  },
  get layers() {
    return layers;
  },
  get redraw() {
    return redraw;
  },
  get seq() {
    return seq;
  },
  get setEditing() {
    return setEditing;
  },
  get settings() {
    return settings;
  },
  get stage() {
    return stage;
  },
  get stitchInfo() {
    return stitchInfo;
  },
  get stitchPanel() {
    return stitchPanel;
  },
});

// Shapes and the frame ---------------------------------------------------------------------------

const { canPaste, closeShape, copySelected, deleteSelected, duplicateSelected, pasteCopied, enterShape, followKnockouts, isLineObject, mirrorSelected, sewLine, sewLineAgain, shapeTarget, shapeTool, showBand, subtractSelected, syncShape, takeShapes } = bindShapes({
  get applyEdit() {
    return applyEdit;
  },
  get applyRestitched() {
    return applyRestitched;
  },
  get closeRungs() {
    return closeRungs;
  },
  get commitTransform() {
    return commitTransform;
  },
  get editor() {
    return editor;
  },
  get enterObject() {
    return enterObject;
  },
  get files() {
    return files;
  },
  get frameObjects() {
    return frameObjects;
  },
  get frameTool() {
    return frameTool;
  },
  get layers() {
    return layers;
  },
  get objectName() {
    return objectName;
  },
  get recompute() {
    return recompute;
  },
  get redraw() {
    return redraw;
  },
  get selectObjects() {
    return selectObjects;
  },
  get seq() {
    return seq;
  },
  get settings() {
    return settings;
  },
  get syncPlayer() {
    return syncPlayer;
  },
  get updateLevel() {
    return updateLevel;
  },
  get vp() {
    return vp;
  },
});

// Shapes not sewn: switched off or guides ---------------------------------------

const { asidePanel, putAside } = bindAside({
  get applyEdit() {
    return applyEdit;
  },
  get history() {
    return history;
  },
  get files() {
    return files;
  },
  get frameObjects() {
    return frameObjects;
  },
  get layers() {
    return layers;
  },
  get redraw() {
    return redraw;
  },
  get seq() {
    return seq;
  },
  get settings() {
    return settings;
  },
  get takeShapes() {
    return takeShapes;
  },
});

// Drawing new shapes ---------------------------------------------------------

const { commitTransform, drawTool, frameObjects, frameTool, knockoutObjects, setDrawing, syncFrame, updateOverlapCard } = bindDrawing({
  get addDigitized() {
    return addDigitized;
  },
  get applyEdit() {
    return applyEdit;
  },
  get closeRungs() {
    return closeRungs;
  },
  get closeShape() {
    return closeShape;
  },
  get editor() {
    return editor;
  },
  get files() {
    return files;
  },
  get followKnockouts() {
    return followKnockouts;
  },
  get layers() {
    return layers;
  },
  get openSelectedForm() {
    return openSelectedForm;
  },
  get orderCard() {
    return orderCard;
  },
  get redraw() {
    return redraw;
  },
  get rungTool() {
    return rungTool;
  },
  get selectObjects() {
    return selectObjects;
  },
  get seq() {
    return seq;
  },
  get setEditing() {
    return setEditing;
  },
  get setLetterMode() {
    return setLetterMode;
  },
  get settings() {
    return settings;
  },
  get shapeTool() {
    return shapeTool;
  },
  get stage() {
    return stage;
  },
  get transformLettering() {
    return transformLettering;
  },
  get updateLevel() {
    return updateLevel;
  },
});

// Lettering ---------------------------------------------------------------------------------------

const { drawLetterBoxes, letterDown, letterDragTo, letterMoved, letterUp, letteringInfo, letteringNames, letteringPanel, letteringsOf, newLettering, setLetterMode, syncLettering, transformLettering } = bindLettering({
  get applyEdit() {
    return applyEdit;
  },
  get ctx() {
    return ctx;
  },
  get drawTool() {
    return drawTool;
  },
  get files() {
    return files;
  },
  get layers() {
    return layers;
  },
  get recompute() {
    return recompute;
  },
  get redraw() {
    return redraw;
  },
  get selectObjects() {
    return selectObjects;
  },
  get seq() {
    return seq;
  },
  get setDrawing() {
    return setDrawing;
  },
  get setMode() {
    return setMode;
  },
  get settings() {
    return settings;
  },
  get syncPlayer() {
    return syncPlayer;
  },
  get updateLevel() {
    return updateLevel;
  },
  get vp() {
    return vp;
  },
});

// Stitch order and jumps: src/app/order.ts; then the Ablauf tooltip and the modes ----------

const { jumpsPanel, orderCard, orderStats, stepJump } = bindOrder({
  get applyEdit() {
    return applyEdit;
  },
  get files() {
    return files;
  },
  get layers() {
    return layers;
  },
  get overOf() {
    return overOf;
  },
  get redraw() {
    return redraw;
  },
  get seq() {
    return seq;
  },
  get settings() {
    return settings;
  },
  get vp() {
    return vp;
  },
});

const KIND_KEY: Record<number, Key> = { [SATIN]: 'kind.satin', [FILL]: 'kind.fill', [TIE_STITCH]: 'kind.tie' };

/** Ablauf tooltip: number, kind and length of the stitch under the pointer. */
function flowTooltip(sx: number, sy: number): void {
  const p = files.active?.pattern;
  if (!p) {
    tooltip.hidden = true;
    return;
  }
  // On a section that cannot be sewn yet: what it still needs, in place of the stitch.
  const problem = rungTool.active ? rungTool.problems[rungTool.problemHover] : undefined;
  if (problem) {
    tooltip.replaceChildren(Object.assign(document.createElement('div'), { textContent: t(problem.key) }));
    tooltip.dataset.level = '2';
    tooltip.hidden = false;
    const flip = sx > ui.stageW - tooltip.offsetWidth - 30;
    tooltip.style.left = `${flip ? sx - 12 - tooltip.offsetWidth : sx + 14}px`;
    tooltip.style.top = `${sy + 14}px`;
    return;
  }
  const st = styleFor(p);
  const [x, y] = vp.toWorld(sx, sy);
  const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / vp.scale), st.limit, st.alpha);
  if (i < 0) {
    tooltip.hidden = true;
    return;
  }
  const q = seq(p);
  const len = Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;
  const kind = t(KIND_KEY[q.kinds[i]] ?? 'kind.running');
  tooltip.replaceChildren(
    Object.assign(document.createElement('div'), {
      textContent: t('tooltip.stitch', { i: formatNumber(q.numbers[i]), kind, len: formatNumber(len, 1) }),
    }),
  );
  tooltip.dataset.level = '0';
  tooltip.hidden = false;
  const flip = sx > ui.stageW - tooltip.offsetWidth - 30;
  tooltip.style.left = `${flip ? sx - 12 - tooltip.offsetWidth : sx + 14}px`;
  tooltip.style.top = `${sy + 14}px`;
}

function setMode(mode: Mode): void {
  const previous = document.body.dataset.mode;
  settings.mode = mode;
  saveSettings(settings);
  document.body.dataset.mode = mode;
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((i) => (i.checked = i.value === mode));
  // The level (objects or stitches) stays when switching between Ablauf and Dichte.
  if (mode === 'image' && editor.active) setEditing(false);
  else editor.reset();
  if (mode !== 'flow') {
    closeShape();
    frameTool.close();
  }
  if (mode !== 'density') {
    ui.comparing = false;
    ui.hoverZone = null;
  }
  if (mode === 'flow' && ui.formLevel) openSelectedForm();
  if (mode !== 'flow') {
    if (drawTool.active) setDrawing(null);
    player.pause();
    if (!player.complete) player.set(Number.MAX_SAFE_INTEGER);
  }
  controls.refresh();
  updateLevel();
  tooltip.hidden = true;
  // The image and the loaded file have their own place on the stage.
  if ((previous === 'image') !== (mode === 'image')) fitView();
  recompute();
}
document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((i) =>
  i.addEventListener('change', () => {
    if (i.checked) setMode(i.value as Mode);
  }),
);

function objectInfo(p: Pattern, q: Sequence) {
  const over = overOf(q, p);
  const selected = [...ui.selectedObjects].sort((a, b) => a - b);
  return {
    objects: q.objects,
    selected,
    layering: selected.map((o) => ({ below: over[o].length, above: over.filter((l) => l.includes(o)).length })),
    numbers: selected.map((o) => numberInColor(q.objects, q.objects[o])),
    hand: selected.map((o) => remembered(p, q.objects[o])?.hand ?? 0),
    editing: editor.active && ui.editObject !== null && selected.length === 1 && selected[0] === ui.editObject ? { selection: editor.selection.size } : null,
    shapeable: selected.length === 1 && (stitchInfo(p, q).free?.on ? !!shapeTarget(p, q, selected[0]) : !!stitchInfo(p, q).measured.fill || !!stitchInfo(p, q).measured.satin || (!!q.objects[selected[0]] && isLineObject(p, q.objects[selected[0]]))),
    shaping: shapeTool.active && selected.length === 1 && selected[0] === ui.shapeObject ? { nodes: shapeTool.count, smooth: shapeTool.selectedSmooth, ...(shapeTool.band !== null ? { kind: 'band' as const } : shapeTool.rails ? { kind: 'rails' as const } : {}), ...(q.objects[selected[0]] && isLineObject(p, q.objects[selected[0]]) ? { line: { closed: shapeTool.closed } } : {}) } : null,
    frame: frameTool.active ? { canScale: frameTool.canScale } : null,
    mergeBlocked: selected.length > 1 ? mergeBlocked(selected.map((o) => q.objects[o])) : null,
    reversible: selected.some((o) => reversible(q.objects[o]) || isLine(p, q.objects[o])),
    subtractable: selected.length > 1 && selected.every((o) => q.objects[o].kind === 'fill'),
    ...blendOf(p, q, selected),
  };
}

/** The one selected fill can blend into a second thread when it knows its area and is not a line (an empty fill shows as one). */
function blendOf(p: Pattern, q: Sequence, selected: number[]): { blend?: ThreadColor } {
  if (selected.length !== 1 || editor.active) return {};
  const o = q.objects[selected[0]];
  const known = o && remembered(p, o);
  return known?.fill && known.region && !known.asLine && !known.blendOf && known.fill.pattern !== 'none' && !isOpenPattern(known.fill.pattern) ? { blend: o.color } : {};
}

// Rendering ------------------------------------------------------------------

let frame = 0;
/** What the check area draws on the stage (src/areas/check). */
let checkArea: { draw: (ctx: CanvasRenderingContext2D) => void } | null = null;
/** The traffic light "Klappt das?" (src/areas/ampel). */
let ampel: { update: () => void } | null = null;
function redraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (settings.mode === 'image') {
      imageMode.draw(ctx, ui.stageW, ui.stageH, vp, stageBg());
      empty.hidden = imageMode.hasImage;
      return;
    }
    syncRungs();
    syncShape();
    syncLettering();
    syncFrame();
    drawScene(ctx, ui.stageW, ui.stageH, scene(), stageBg());
    const aside = settings.mode === 'flow' ? asideOf(files.active?.pattern) : [];
    if (aside.length) drawAside(ctx, vp, aside, ui.hoverAside);
    if (ui.asideShown !== aside) {
      ui.asideShown = aside;
      asidePanel.update(aside);
    }
    if (drawTool.preview && settings.mode === 'flow')
      drawDrawing(ctx, vp, drawTool.preview, { nodes: drawTool.kind === 'pen' || drawTool.kind === 'cut' ? drawTool.count : 0, closing: drawTool.closing, size: drawTool.size });
    if (ui.letterMode) drawLetterBoxes();
    drawPlanCompare();
    checkArea?.draw(ctx);
    ampel?.update();
    if (showCompare()) {
      const x = Math.round(ui.split * ui.stageW);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, ui.stageH);
      ctx.clip();
      drawScene(ctx, ui.stageW, ui.stageH, originalScene(), stageBg());
      ctx.restore();
      drawDivider(ctx, x, ui.stageH, t('compare.original'), t('compare.current'));
    }
    const active = files.active;
    empty.hidden = !!active?.pattern || drawTool.active;
    exportBtn.disabled = !active?.pattern;
    $('file-actions').hidden = !active?.pattern;
    // Jumps and trims belong to a design: nothing to say on the start page.
    $('jumps-panel').hidden = !active?.pattern;
    if (settings.mode === 'density') drawLegendCanvas();
    renderStats($('stats'), active, ui.grid, settings, ui.computing);
    design.render();
    ready.render();
    const p = active?.pattern ?? null;
    const q = p ? seq(p) : null;
    $('player').hidden = !p;
    $('color-list').hidden = !q?.blocks.length;
    if (p) colorList.update(p);
    if (settings.mode === 'flow') {
      const current = p && !player.complete ? seq(p).markers.colorStarts.filter((i) => q!.numbers[i] <= Math.max(1, player.pos)).length - 1 : null;
      layers.update(
        {
          blocks: q?.blocks ?? [],
          objects: q?.objects ?? [],
          selected: ui.selectedObjects,
          hidden: ui.hiddenBlocks,
          focus: ui.focusBlock,
          current,
          original: active?.original?.colors ?? NO_COLORS,
          blank: !!p && !q!.objects.length,
          format: active?.pattern?.format ?? 'pes',
          names: p && q ? letteringNames(p, q) : undefined,
          guessed: p && q ? (q.guessed ??= new Set(q.objects.filter((o) => isGuessed(p, o)).map((o) => o.index))) : undefined,
          loose: p && q ? looseOf(p, q) : undefined,
        },
        getLang(),
      );
      const objects = !ui.lettering && p && q && ui.selectedObjects.size;
      objectPanel.update(objects ? objectInfo(p, q) : null, getLang());
      stitchPanel.update(objects ? { ...stitchInfo(p, q), ...rungInfo(p, q), blend: !!blendOf(p, q, [...ui.selectedObjects]).blend } : null);
      updateOverlapCard();
      letteringPanel.update(ui.lettering && q ? letteringInfo(q) : null, getLang());
      if (ui.focusText && ui.lettering) {
        letteringPanel.focusText(true);
        ui.focusText = false;
      }
      $<HTMLButtonElement>('order-optimize').disabled = !q || q.objects.length < 2;
    }
    refreshShapes();
    panel.update(active, ui.selectedZone);
    // Jumps and trims show in Gestalten and in Prüfen.
    jumpsPanel.update({ list: q?.transitions ?? [], selected: ui.selectedJump, lang: getLang() });
    // Proposals belong to the version they were worked out on.
    if (ui.planState && (ui.planState.file !== active || ui.planState.pattern !== active?.pattern)) {
      ui.planState = null;
      ui.planHover = null;
      ui.planPreview = null;
      if (ui.correctMessage?.kind === 'plan') ui.correctMessage = null;
    }
    hoopPanel.refresh(active?.pattern?.bounds, active?.original?.hoop);
    correctPanel.update({
      file: active,
      zoneSelected: !!ui.selectedZone,
      comparing: ui.comparing,
      message: ui.correctMessage,
    });
    stitchArea.refresh();
  });
}

function drawLegendCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = legend.clientWidth;
  const h = legend.clientHeight;
  legend.width = Math.round(w * dpr);
  legend.height = Math.round(h * dpr);
  const lctx = legend.getContext('2d')!;
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lctx.clearRect(0, 0, w, h);
  drawLegend(lctx, 10, 2, w - 20, legendSpec(settings));
}

function rebuildGridImage(): void {
  const max = settings.scales[settings.metric].max;
  ui.gridImg = ui.grid ? gridToCanvas(ui.grid, max) : null;
  ui.origGridImg = ui.origGrid ? gridToCanvas(ui.origGrid, max) : null;
}

let debounce = 0;
function recompute(): void {
  clearTimeout(debounce);
  const pattern = files.active?.pattern;
  if (!pattern || settings.mode !== 'density') {
    ui.computing = false;
    redraw();
    return;
  }
  ui.computing = true;
  redraw();
  debounce = window.setTimeout(async () => {
    const { metric, cellMm, blurMm, includeJumps } = settings;
    const seq = ++ui.densitySeq;
    try {
      const g = await density.density(pattern, { metric, cellMm, blurMm, includeJumps });
      // A newer request or another file supersedes this result.
      if (seq !== ui.densitySeq || files.active?.pattern !== pattern) return;
      ui.grid = g;
      // The comparison needs the original's heatmap with the same settings.
      const f = files.active;
      const opts = JSON.stringify([metric, cellMm, blurMm, includeJumps]);
      if (showCompare() && f?.original && (ui.origKey?.p !== f.original || ui.origKey.opts !== opts)) {
        const og = await density.density(f.original, { metric, cellMm, blurMm, includeJumps });
        if (seq !== ui.densitySeq || files.active !== f) return;
        ui.origGrid = og;
        ui.origKey = { p: f.original, opts };
      }
      ui.computing = false;
      rebuildGridImage();
    } catch (err) {
      console.error(err);
      ui.computing = false;
    }
    redraw();
  }, 60);
}

function selectZone(z: Zone): void {
  const pad = 4; // mm of context around the zone
  const b = z.bbox;
  ui.selectedZone = z;
  if (!settings.showValidation) {
    settings.showValidation = true;
    saveSettings(settings);
    controls.refresh();
  }
  vp.fit(b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad, ui.stageW, ui.stageH);
  redraw();
}

/** Jumps to the next (dir 1) or previous (dir -1) zone the findings list shows, worst first. */
function stepZone(dir: 1 | -1): void {
  const all = files.active?.validation?.zones;
  if (!all) return;
  const zones = panel.visible(all);
  if (!zones.length) return;
  const i = ui.selectedZone ? zones.indexOf(ui.selectedZone) : -1;
  selectZone(zones[i < 0 ? (dir > 0 ? 0 : zones.length - 1) : (i + dir + zones.length) % zones.length]);
}

function fitView(f: LoadedFile | null = files.active): void {
  if (settings.mode === 'image') {
    const a = freeArea();
    imageMode.fit(vp, a.w, a.h);
    vp.pan(a.x, a.y);
    redraw();
    return;
  }
  const b = f?.pattern?.bounds;
  if (!b) return;
  // Right after a switch (from Bild umwandeln, say) the stage has its new size and the player is
  // due, but neither the resize observer nor the next frame has caught up: fit measures what will show.
  if (stage.clientWidth !== ui.stageW || stage.clientHeight !== ui.stageH) resize();
  $('player').hidden = false;
  const a = freeArea();
  // With a hoop chosen, fit shows the whole sewing field so the room left is visible.
  const m = f?.material.hoop ? hoopRect(b, f.material.hoop) : null;
  if (m) vp.fit(Math.min(m.x, b.minX / 10), Math.min(m.y, b.minY / 10), Math.max(m.x + m.w, b.maxX / 10), Math.max(m.y + m.h, b.maxY / 10), a.w, a.h, 56);
  // A new, empty design without a hoop: 10 x 10 cm to draw into, not a point blown up.
  else if (!f!.pattern!.cmd.includes(STITCH)) vp.fit(-50, -50, 50, 50, a.w, a.h);
  else vp.fit(b.minX / 10, b.minY / 10, b.maxX / 10, b.maxY / 10, a.w, a.h);
  vp.pan(a.x, a.y);
  redraw();
}

/** The part of the stage the tools on it leave free (less the fit margin they may share): fit puts the design there. */
function freeArea(): { x: number; y: number; w: number; h: number } {
  const s = stage.getBoundingClientRect();
  const box = (sel: string) => {
    const r = stage.querySelector(sel)?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r : null;
  };
  const bar = box('.stage-bar');
  const draw = box('.draw-tools');
  const player = box('.player');
  const inset = (v: number) => Math.max(0, v - 16);
  const top = bar ? inset(bar.bottom - s.top) : 0;
  const left = draw ? inset(draw.right - s.left) : 0;
  const bottom = player ? inset(s.bottom - player.top) : 0;
  return { x: left, y: top, w: Math.max(1, ui.stageW - left), h: Math.max(1, ui.stageH - top - bottom) };
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const first = ui.stageW === 0;
  ui.stageW = stage.clientWidth;
  ui.stageH = stage.clientHeight;
  canvas.width = Math.round(ui.stageW * dpr);
  canvas.height = Math.round(ui.stageH * dpr);
  if (first) fitView();
  redraw();
}
new ResizeObserver(resize).observe(stage);

// Correction and editing -----------------------------------------------------

/** Stores an edited pattern for the active file (one undo step) and refreshes everything. */
function applyEdit(p: Pattern, measurement?: Measurement): void {
  const f = files.active;
  if (!f?.pattern) return;
  ui.hoverZone = ui.selectedZone = null;
  files.setPattern(f, p, { measurement });
  syncPlayer();
  recompute();
}

/** After an edit, undo or redo: the player follows the new version and stays where it was. */
function syncPlayer(): void {
  player.setModel(playerModel(files.active?.pattern ?? null), true);
  ui.hoverJump = null;
  if (ui.selectedJump !== null && ui.selectedJump >= (files.active?.pattern ? seq(files.active.pattern).transitions.length : 0)) ui.selectedJump = null;
  const blocks = files.active?.pattern ? seq(files.active.pattern).blocks.length : 0;
  const objs = files.active?.pattern ? seq(files.active.pattern).objects.length : 0;
  if ([...ui.selectedObjects].some((o) => o >= objs)) ui.selectedObjects = new Set();
  if (ui.editObject !== null && ui.editObject >= objs) ui.editObject = null;
  ui.hoverObject = null;
  if (orderCard.isOpen) orderCard.close(true);
  if ([...ui.hiddenBlocks].some((b) => b >= blocks) || (ui.focusBlock ?? -1) >= blocks) {
    ui.hiddenBlocks = new Set();
    ui.focusBlock = null;
  }
}

const editor = new Editor({
  pattern: () => files.active?.pattern ?? null,
  commit: (p, change) => commitHand(p, change),
  range: () => {
    if (settings.mode !== 'flow') return null;
    const p = files.active?.pattern;
    const o = p && ui.editObject !== null ? seq(p).objects[ui.editObject] : undefined;
    return o ? { first: o.first, last: o.last } : NO_RANGE;
  },
  ends: () => {
    const p = files.active?.pattern;
    const o = p && settings.mode === 'flow' && ui.editObject !== null ? seq(p).objects[ui.editObject] : undefined;
    return o ? { first: o.first, end: o.last - o.tieOff, last: o.last } : null;
  },
  reveal: (i) => revealRecord(i),
  penChanged: () => updateLevel(),
  redraw,
  changed: redraw,
});

/** An edit made point by point: the objects it touched keep what they remember (see keepObjects). */
function commitHand(next: Pattern, change: HandChange | null): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p) return;
  if (!change) return applyEdit(next);
  const was = ui.editObject !== null ? seq(p).objects[ui.editObject] : undefined;
  const wasFree = !!(was && remembered(p, was)?.free);
  const moved = keepObjects(p, next, change, seq);
  const editing = ui.editObject !== null && moved.has(ui.editObject) ? moved.get(ui.editObject)! : ui.editObject;
  applyEdit(next);
  files.setObjects(f, rememberedIn(next, seq(next).objects));
  // The first change by hand looses the object from its shape: the way back is offered right here.
  const now = editing !== null && editing >= 0 ? seq(next).objects[editing] : undefined;
  if (now && !wasFree && remembered(next, now)?.free) sayShapeBack(now.id);
  if (ui.editObject !== null) {
    ui.editObject = editing !== null && editing >= 0 ? editing : null;
    ui.selectedObjects = ui.editObject !== null ? new Set([ui.editObject]) : new Set();
  }
  ui.selectionKey++;
  updateLevel();
  redraw();
}

/** The objects loosed from their shape; the same set while they stay the same, so the list is not built anew. */
function looseOf(p: Pattern, q: Sequence): ReadonlySet<number> {
  const list = q.objects.filter((o) => remembered(p, o)?.free).map((o) => o.index);
  const key = list.join(',');
  if (q.loose?.key !== key) q.loose = { key, set: new Set(list) };
  return q.loose.set;
}

/** Says that object `id` is loosed from its shape, with the button that sews it from its shape again. */
function sayShapeBack(id: number): void {
  layers.say({
    text: t('free.byHand'),
    action: {
      label: t('free.back'),
      title: t('free.back.hint'),
      run: () => {
        const q = files.active?.pattern;
        const o = q ? seq(q).objects.findIndex((x) => x.id === id) : -1;
        if (o < 0) return;
        ui.selectedObjects = new Set([o]);
        looseObjects(false);
      },
    },
  });
}

/** Object `o` (loosed from its shape) is selected, and sewing it from its shape again is offered. */
function offerShapeBack(o: number): void {
  const p = files.active?.pattern;
  const obj = p ? seq(p).objects[o] : undefined;
  if (!obj) return;
  selectObjects([o], false);
  sayShapeBack(obj.id);
}

/** The penetrations of object `o` are edited (Ablauf). `fit` zooms in when it is small on the stage. */
function enterObject(o: number, fit: boolean): void {
  const p = files.active?.pattern;
  const obj = p ? seq(p).objects[o] : undefined;
  if (!obj) return;
  if (shapeTool.active) closeShape();
  if (drawTool.active) setDrawing(null);
  ui.formLevel = false;
  if (!editor.active) editor.setActive(true);
  else editor.reset();
  ui.editObject = o;
  if (!ui.selectedObjects.has(o) || ui.selectedObjects.size !== 1) selectObjects([o], false);
  // The bar over the stage changes with the level: it is laid out before the free room is measured.
  updateLevel();
  stitchArea?.refresh();
  if (fit) {
    const w = ((obj.maxX - obj.minX) / 10) * vp.scale;
    const h = ((obj.maxY - obj.minY) / 10) * vp.scale;
    if (Math.max(w / ui.stageW, h / ui.stageH) < 0.4) {
      // Into the room the bars over the stage leave free, so its start and end are not under them.
      const [top, bottom] = stageInsets();
      vp.fit(obj.minX / 10, obj.minY / 10, obj.maxX / 10, obj.maxY / 10, ui.stageW, ui.stageH - top - bottom, 60);
      vp.pan(0, top);
    }
  }
  redraw();
}

/** How far the bars over the stage reach down from its top, and the view bar and player up from its bottom (CSS px). */
function stageInsets(): [number, number] {
  const box = stage.getBoundingClientRect();
  let low = box.top;
  for (const el of stage.querySelectorAll<HTMLElement>('.stage-top > *')) {
    const r = el.getBoundingClientRect();
    if (r.height && getComputedStyle(el).display !== 'none') low = Math.max(low, r.bottom);
  }
  // The view bar at the foot of the stage and the player under it.
  let high = box.bottom;
  for (const el of [$('player'), ...stage.querySelectorAll<HTMLElement>('#stage-foot > *')]) {
    const r = el.getBoundingClientRect();
    if (r.height && r.top < box.bottom && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden') high = Math.min(high, r.top);
  }
  return [low - box.top, Math.max(0, box.bottom - high)];
}

/** Pans so that record `i` is on the stage (not under the tools or the player). */
function revealRecord(i: number): void {
  const p = files.active?.pattern;
  if (!p) return;
  const [sx, sy] = vp.toScreen(p.x[i] / 10, p.y[i] / 10);
  const m = 80;
  // Not under the bars over the stage either.
  const [top, bottom] = stageInsets();
  const t = Math.max(m, top + 40);
  const b = Math.max(m, bottom + 40);
  const dx = sx < m ? m - sx : sx > ui.stageW - m ? ui.stageW - m - sx : 0;
  const dy = sy < t ? t - sy : sy > ui.stageH - b ? ui.stageH - b - sy : 0;
  if (dx || dy) vp.pan(dx, dy);
  redraw();
}

function setEditing(on: boolean): void {
  if (on) {
    ui.formLevel = false;
    if (drawTool.active) setDrawing(null);
    closeRungs();
    closeShape();
  }
  if (on && settings.mode === 'flow' && ui.selectedObjects.size === 1) return enterObject([...ui.selectedObjects][0], true);
  editor.setActive(on);
  ui.editObject = null;
  updateLevel();
  redraw();
}

/** Level switch, where the user is and what the keys do. */
function updateLevel(): void {
  const on = editor.active;
  const shaping = shapeTool.active;
  const level = on ? 'stitches' : ui.formLevel && settings.mode === 'flow' ? 'shape' : 'objects';
  stage.classList.toggle('editing', on);
  stage.classList.toggle('stitch-pen', on && editor.penOn);
  stage.classList.toggle('shaping', shaping);
  stage.classList.toggle('form-level', ui.formLevel && !on && settings.mode === 'flow');
  document.querySelectorAll<HTMLInputElement>('input[name="level"]').forEach((i) => (i.checked = i.value === level));
  const flow = settings.mode === 'flow';
  refreshShapes();
  const mode = settings.mode;
  // Fingers have no wheel, Shift or keys: on a touch screen the hint says the gestures, and only
  // where no bar over the stage says what to do already.
  if (matchMedia('(pointer: coarse)').matches) {
    const base = !drawTool.kind && !on && !shaping && !ui.formLevel && !ui.lettering;
    $('canvas-hint').textContent = mode === 'image' ? t('responsive.hint.view') : !base ? '' : flow ? t('responsive.hint.flow') : t('responsive.hint.check');
    return;
  }
  $('canvas-hint').textContent = t(
    mode === 'image'
      ? 'canvas.hint.image'
      : drawTool.kind && flow
        ? `canvas.hint.draw.${drawTool.kind}`
      : on
        ? editor.penOn
          ? 'canvas.hint.pen'
          : flow
          ? 'canvas.hint.flowEdit'
          : 'canvas.hint.edit'
        : shaping
          ? 'canvas.hint.shape'
          : flow && ui.formLevel && !ui.lettering
            ? 'canvas.hint.form'
          : flow && ui.letterMode
            ? 'canvas.hint.letters'
            : flow && ui.lettering
              ? 'canvas.hint.lettering'
              : flow
                ? 'canvas.hint.flow'
                : 'canvas.hint',
  );
}

function setComparing(on: boolean): void {
  ui.comparing = on;
  if (on) recompute();
  redraw();
}

/** Undo, redo or revert: indices change, so the selection is dropped. */
function history(step: 'undo' | 'redo' | 'revert'): void {
  if (settings.mode === 'image') {
    if (step === 'undo') imageMode.undo();
    else if (step === 'redo') imageMode.redo();
    return;
  }
  const f = files.active;
  if (!f) return;
  if (step === 'undo') files.undo(f);
  else if (step === 'redo') files.redo(f);
  else files.revert(f);
  editor.reset();
  ui.hoverZone = ui.selectedZone = null;
  ui.correctMessage = null;
  ui.lettering = null;
  ui.letterMode = false;
  // A kept selection shows the settings of the stitches as they are again (the panels read them anew).
  ui.selectionKey++;
  syncPlayer();
  recompute();
}

const { correctPanel, drawPlanCompare, inPlanFrame, movePlanSplit, pinPlan, tuneToFabric, planFix, applyPlan, discardPlan, busy, planShown, planTicked } = bindCorrection({
  get applyEdit() {
    return applyEdit;
  },
  get ctx() {
    return ctx;
  },
  get density() {
    return density;
  },
  get editor() {
    return editor;
  },
  get files() {
    return files;
  },
  get history() {
    return history;
  },
  get redraw() {
    return redraw;
  },
  get scene() {
    return scene;
  },
  get seq() {
    return seq;
  },
  get setComparing() {
    return setComparing;
  },
  get settings() {
    return settings;
  },
  get stageBg() {
    return stageBg;
  },
  get validator() {
    return validator;
  },
  get vp() {
    return vp;
  },
});
files.onRename = (f) => {
  correctPanel.forgetName(f);
  redraw();
};

// Controls, language, export --------------------------------------------------

const controls = bindControls(settings, (kind: ChangeKind) => {
  saveSettings(settings);
  // The fabric color and thread width belong to the design.
  storeMaterial();
  if (kind === 'density') recompute();
  else if (kind === 'style') redraw();
  else {
    rebuildGridImage();
    redraw();
  }
});

const hoopPanel = bindHoop(
  settings,
  () => {
    saveSettings(settings);
    storeMaterial();
    fitView();
  },
  () => fitToHoop(),
);

/** Room left free on each side when a design is made to fit its hoop (mm). */
const HOOP_FIT_MARGIN = 1;

/** The whole design made smaller, evenly, until it fits the hoop with HOOP_FIT_MARGIN all round (one undo step). */
function fitToHoop(): void {
  const p = files.active?.pattern;
  const hoop = settings.hoop;
  if (!p || !hoop || settings.mode === 'image') return;
  const b = p.bounds;
  const w = (b.maxX - b.minX) / 10;
  const h = (b.maxY - b.minY) / 10;
  const s = Math.floor(Math.min((hoop.w - 2 * HOOP_FIT_MARGIN) / w, (hoop.h - 2 * HOOP_FIT_MARGIN) / h) * 1000) / 1000;
  if (!(s > 0 && s < 1)) return;
  const q = seq(p);
  // Objects of a file that are fill and satin at once cannot be scaled as one.
  if (q.objects.some((o) => scaleBlocked(p, o, q.kinds))) return layers.say(t('hoop.fit.blocked'), true);
  const all = q.objects.map((o) => o.index);
  if (!commitTransform(scaling(s, s, (b.minX + b.maxX) / 20, (b.minY + b.maxY) / 20), all)) return;
  layers.say(t('hoop.fitted', { pct: formatNumber(Math.round(s * 100)) }) + ' ' + t('object.undo'));
  fitView();
}

const profile = bindProfile(settings, () => {
  saveSettings(settings);
  // Classification is cheap: the design is re-checked instantly against the new limits.
  storeMaterial();
  // Another fabric: what suits it better is offered, never changed silently.
  tuneToFabric(true);
  imageMode.profileChanged();
  controls.refresh();
  ui.hoverZone = ui.selectedZone = null;
  tooltip.hidden = true;
  redraw();
});

const imageMode = new ImageMode({
  settings,
  save: () => saveSettings(settings),
  redraw,
  fit: () => fitView(),
  reveal: (first) => {
    if (first) shine();
    else if (settings.realistic && settings.liveLight && settings.image.view === 'stitches') sweep(redraw);
  },
  validate: async (p) => classify(await validator.measure(p, openOnPurpose(p, seq(p).objects) ?? undefined), settings.profile, settings.checks),
  takeOver: async (d, name) => {
    await addDigitized(d, name);
    setMode('flow');
  },
  mode: () => settings.mode,
  setMode: (m) => setMode(m),
});

/**
 * Adds stitches made from an image to the file list, with the objects as the Image mode sewed them
 * (it trims inside some, between pieces of a fill) and the exact areas of its fills.
 */
async function addDigitized(d: Digitized & { leftOut?: LeftOut[] }, name: string): Promise<void> {
  const data = writePattern(d.pattern, 'pes');
  const added = parsePattern(data, `${name}.pes`);
  rememberObjects(added, d.starts);
  const objs = sewObjects(added);
  rememberShapes(added, objs, d.starts, d.objects.map((o) => o.shape), d.objects);
  // Shapes left out on the way in wait under "Not sewn", where it was: at the very back.
  const aside: AsideShape[] = (d.leftOut ?? []).map((s, k) => ({ id: k + 1, role: 'off', kind: 'fill', color: s.color, after: -1, form: s.form, reason: s.reason }));
  await files.addWithObjects(`${name}.pes`, data.slice().buffer, rememberedIn(added, objs), storeAside(aside), undefined, true);
  if (aside.some((a) => a.reason === 'background')) layers.say(t('aside.backgroundFound'));
}

// Living thread: the light of the realistic view follows the pointer or the tilt of a phone -------

const { shine, threadsShown } = bindLight({
  get controls() {
    return controls;
  },
  get editor() {
    return editor;
  },
  get imageMode() {
    return imageMode;
  },
  get redraw() {
    return redraw;
  },
  get settings() {
    return settings;
  },
});

const langSelect = $<HTMLSelectElement>('lang');
// Every part that writes text itself follows a language change on its own (onLangChange); here
// only what this file writes. The mode, the selection and the hand edit stay as they are.
onLangChange(() => {
  langSelect.value = getLang();
  updateLevel();
  tooltip.hidden = true;
  tooltip.replaceChildren();
  redraw();
});
langSelect.addEventListener('change', () => {
  settings.lang = langSelect.value as Lang;
  saveSettings(settings);
  setLang(settings.lang);
});
// The guide in the app's language; under de/ the app starts in German, whatever was set before.
onLangChange(() => ($<HTMLAnchorElement>('doc-link').href = docsUrl(getLang())));
setLang(detectLang(pageLang() ?? settings.lang));
setMode(settings.mode);

$('fit').addEventListener('click', () => fitView());
document.querySelectorAll<HTMLInputElement>('input[name="level"]').forEach((i) =>
  i.addEventListener('change', () => {
    if (!i.checked) return;
    if (i.value === 'shape') return setFormLevel(true);
    setFormLevel(false);
    setEditing(i.value === 'stitches');
  }),
);

/**
 * Level Form on or off. On: the drawing tools show and the one selected object shows its outline;
 * off: drawing stops and the outline closes (the selection stays).
 */
function setFormLevel(on: boolean): void {
  ui.formLevel = on;
  if (on) {
    if (editor.active) {
      editor.setActive(false);
      ui.editObject = null;
    }
    closeRungs();
    openSelectedForm();
  } else {
    if (drawTool.active) setDrawing(null);
    closeShape();
  }
  updateLevel();
  redraw();
}

/** Level Form: the outline of the one selected object, when it has one that can be edited. */
function openSelectedForm(): void {
  const p = files.active?.pattern;
  const o = ui.selectedObjects.size === 1 ? [...ui.selectedObjects][0] : null;
  if (!ui.formLevel || settings.mode !== 'flow' || drawTool.active || ui.letterMode) return;
  if (p && o !== null && o !== ui.shapeObject && shapeTarget(p, seq(p), o)) enterShape(o, false);
}
exportBtn.addEventListener('click', () => {
  const f = files.active;
  if (f?.pattern) exportPng({ ...scene(), edit: null }, ui.stageW, ui.stageH, stageBg(), FileList.baseName(f) || 'pattern');
});

// Opening and saving files and projects: src/app/fileIo.ts

const { adoptMaterial, storeMaterial } = bindFileIo({
  get setFormLevel() {
    return setFormLevel;
  },
  files,
  settings,
  imageMode,
  profile,
  controls,
  correctPanel,
  redraw,
  seq,
  setMode,
  addDigitized,
});

// Keyboard shortcuts --------------------------------------------------------

bindKeys({
  get selectObjects() {
    return selectObjects;
  },
  get setFormLevel() {
    return setFormLevel;
  },
  get closeRungs() {
    return closeRungs;
  },
  get closeShape() {
    return closeShape;
  },
  get commitTransform() {
    return commitTransform;
  },
  get controls() {
    return controls;
  },
  // Through the commands, so the keys follow the same rule and say the same as the menus.
  get deleteSelected() {
    return () => runCommand('object.delete');
  },
  get drawTool() {
    return drawTool;
  },
  get copySelected() {
    return () => runCommand('object.copy');
  },
  get duplicateSelected() {
    return (inPlace?: boolean) => runCommand(inPlace ? 'object.duplicateInPlace' : 'object.duplicate');
  },
  get pasteCopied() {
    return () => runCommand('object.paste');
  },
  get editor() {
    return editor;
  },
  get enterObject() {
    return enterObject;
  },
  get enterShape() {
    return enterShape;
  },
  get files() {
    return files;
  },
  get fitView() {
    return fitView;
  },
  get frameObjects() {
    return frameObjects;
  },
  get frameTool() {
    return frameTool;
  },
  get history() {
    return history;
  },
  get letterMoved() {
    return letterMoved;
  },
  get newLettering() {
    return newLettering;
  },
  get orderCard() {
    return orderCard;
  },
  get pinPlan() {
    return pinPlan;
  },
  get player() {
    return player;
  },
  get redraw() {
    return redraw;
  },
  get revealRecord() {
    return revealRecord;
  },
  get rungTool() {
    return rungTool;
  },
  get setComparing() {
    return setComparing;
  },
  get setDrawing() {
    return setDrawing;
  },
  get setEditing() {
    return setEditing;
  },
  get setLetterMode() {
    return setLetterMode;
  },
  get setMode() {
    return setMode;
  },
  get settings() {
    return settings;
  },
  get shapeTool() {
    return shapeTool;
  },
  get stepJump() {
    return stepJump;
  },
  get stepZone() {
    return stepZone;
  },
  get toggleGuides() {
    return toggleGuides;
  },
  get toggleRungs() {
    return toggleRungs;
  },
});

// Zoom, pan, pinch, tooltip ---------------------------------------------------

const { showObjectMenu } = bindPointer({
  get canvas() {
    return canvas;
  },
  get closeShape() {
    return closeShape;
  },
  get drawTool() {
    return drawTool;
  },
  get editor() {
    return editor;
  },
  get enterObject() {
    return enterObject;
  },
  get enterShape() {
    return enterShape;
  },
  get files() {
    return files;
  },
  get fitView() {
    return fitView;
  },
  get flowTooltip() {
    return flowTooltip;
  },
  get frameTool() {
    return frameTool;
  },
  get imageMode() {
    return imageMode;
  },
  get inPlanFrame() {
    return inPlanFrame;
  },
  get letterDown() {
    return letterDown;
  },
  get letterDragTo() {
    return letterDragTo;
  },
  get letterUp() {
    return letterUp;
  },
  get letteringsOf() {
    return letteringsOf;
  },
  get movePlanSplit() {
    return movePlanSplit;
  },
  get orderCard() {
    return orderCard;
  },
  get redraw() {
    return redraw;
  },
  get rungTool() {
    return rungTool;
  },
  get selectObjects() {
    return selectObjects;
  },
  get seq() {
    return seq;
  },
  get setEditing() {
    return setEditing;
  },
  get settings() {
    return settings;
  },
  get shapeTool() {
    return shapeTool;
  },
  get showCompare() {
    return showCompare;
  },
  get stage() {
    return stage;
  },
  get styleFor() {
    return styleFor;
  },
  get threadsShown() {
    return threadsShown;
  },
  get tooltip() {
    return tooltip;
  },
  get vp() {
    return vp;
  },
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);

initShell({ files, mode: () => settings.mode, setMode });
initResponsive();
const stitchArea = initStitchArea({ files, settings, editor, rungTool, stitchPanel, closeRungs, toggleRungs, toggleGuides, togglePoints, sewAlongLines, suggestLines, setEditing, enterObject, revealRecord, pointsVisible: () => vp.scale >= POINTS_MIN_SCALE, redraw });
const design = initDesign({ files, settings, player, vp, stage, fitView, fitToHoop, redraw, applyEdit });
const ready = initReady({
  files,
  settings,
  setMode,
  minLetterMm: (p) => {
    const hs = letteringsOf(p, seq(p)).flatMap((l) => (l ? [l.height] : []));
    return hs.length ? Math.min(...hs) : null;
  },
});
initShapes({ settings, setMode, files, seq, objectName, drawTool, setDrawing, shapeTool, enterShape, shapeTarget, isLineObject, frameTool, editor, setEditing, setFormLevel, newLettering, setLetterMode, letteringPanel, selectObjects, redraw });
checkArea = initCheck({
  settings,
  files,
  setMode,
  redraw,
  vp,
  seq,
  findings: panel,
  stepZone,
  decideZone,
  setComparing,
  correction: { planFix, applyPlan, discardPlan, tuneToFabric, pinPlan, busy, planShown, planTicked },
  jumps: jumpsPanel,
  stepJump,
});
ampel = initAmpel({
  settings,
  files,
  seq,
  validator,
  setMode,
  redraw,
  selectZone,
  commit: (p, m) => {
    const f = files.active;
    if (!f) return;
    editor.reset();
    applyEdit(p, m);
    files.setObjects(f, rememberedIn(p, seq(p).objects));
  },
  undo: () => history('undo'),
  busy,
  drawCompare: (cv, box, before, after, labels) => {
    // Before and after side by side, each fitted whole, stitches as they will sew (no heatmap).
    const w = cv.clientWidth;
    const hh = cv.clientHeight;
    if (!w || !hh) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hh * dpr);
    const c = cv.getContext('2d');
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 1.5;
    const b = { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
    const gap = 6;
    const pw = (w - gap) / 2;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const scale = Math.min(pw / bw, hh / bh);
    const look = { ...settings, overlay: true, opacity: 1, showValidation: false, hoop: null };
    const panel = (x: number, pattern: Pattern, label: string) => {
      const pvp = new Viewport();
      pvp.scale = scale;
      pvp.offsetX = x + (pw - bw * scale) / 2 - b.minX * scale;
      pvp.offsetY = (hh - bh * scale) / 2 - b.minY * scale;
      const sc: Scene = { pattern, grid: null, gridImg: null, validation: null, validationImg: null, counted: null, highlight: null, settings: look, vp: pvp, edit: null };
      return { rect: { x0: x, y0: 0, x1: x + pw, y1: hh }, scene: sc, label };
    };
    drawPanels(c, w, hh, [panel(0, before, labels[0]), panel(pw + gap, after, labels[1])], stageBg());
  },
});

files.render();
redraw();
void files.restore();
void imageMode.restore();
// The thread catalogs name the numbers of the threads in the list (Brother's too).
void loadCatalogs()
  .then(() => {
    layers.refresh();
    redraw();
  })
  .catch((err) => console.warn('No thread catalogs', err));

$('fabric-tune').addEventListener('click', () => tuneToFabric());
