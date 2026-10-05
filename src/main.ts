import './style.css';
import { WorkerClient } from './density/client';
import { applyI18n, detectLang, formatNumber, getLang, setLang, t, type Lang } from './i18n';
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
import { legendSpec } from './ui/legendSpec';
import { bindProfile } from './ui/profilePanel';
import { renderStats } from './ui/stats';
import { ValidationPanel } from './ui/validationPanel';
import { acknowledgementOf, settledBy, type Acknowledgement } from './validation/acks';
import type { ValidationResult, Zone } from './validation/validate';
import { POINTS_MIN_SCALE } from './render/editOverlay';
import { drawDivider } from './render/compare';
import type { Pattern, ThreadColor } from './model/pattern';
import type { Measurement } from './validation/measure';
import { initUpdateNotice } from './ui/updateNotice';
import { bindFileIo } from './app/fileIo';
import { writePattern } from './writers';
import { parsePattern } from './parsers';
import { ImageMode } from './ui/imageMode';
import { sweep } from './render/light';
import { classify } from './validation/validate';
import {
  colorBlocks,
  markers as findMarkers,
  recordOfStitch,
  sewingSeconds,
  stitchKinds,
  stitchNumbers,
  transitions,
  FILL,
  SATIN,
  TIE_STITCH,
  carriedJumps,
} from './model/sequence';
import { COLOR_CHANGE, STITCH, TRIM } from './model/pattern';
import { stitchAlpha, stitchAt, stitchColors, type StitchStyle } from './render/flow';
import type { FlowScene } from './render/scene';
import type { Mode } from './settings';
import { type Highlight } from './ui/stitchPanel';
import { borderRanges } from './model/border';
import { analyze, openOnPurpose, remembered, rememberedIn, rememberShapes, underlayRanges, type RestitchResult } from './model/restitch';
import type { Pt } from './digitize/skeleton';
import { drawAside, drawDrawing, type FlatArea } from './render/shapeOverlay';
import type { LeftOut } from './ui/imageMode';
import { borderLines } from './model/along';
import { asideOf, storeAside, type AsideShape } from './model/aside';
import { formOf } from './model/reshape';
import { wholeOf } from './model/knockout';
import { type Form } from './shape/path';
import { type Digitized } from './digitize/digitize';
import { numberInColor, overlaps, rememberObjects, sewObjects, type SewObject } from './model/objects';
import { reversible } from './model/reverse';
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
const showCompare = () => ui.comparing && FileList.edited(files.active);

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
  onDecide: (z, d) => {
    const f = files.active;
    if (!f) return;
    // One decision per zone: the new one replaces whatever was stored for it.
    const rest = f.acks.filter((a) => a !== acknowledgementOf(z, f.acks));
    const bbox = { ...z.bbox };
    files.setAcks(f, d === 'ack' ? [...rest, { bbox, reason: 'manual' }] : d === 'reopen' ? [...rest, { bbox, reason: 'reopened' }] : rest);
    redraw();
  },
});

installPanelResize($('layout'), settings.panels, () => saveSettings(settings));

// Ablauf mode ------------------------------------------------------------------

const seqCache = new WeakMap<Pattern, Sequence>();
function seq(p: Pattern): Sequence {
  let q = seqCache.get(p);
  if (q) return q;
  const numbers = stitchNumbers(p);
  const trimsAt: number[] = [];
  const colorsAt: number[] = [];
  let cut = true;
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.cmd[i] === TRIM && !cut) trimsAt.push(numbers[i]);
    else if (p.cmd[i] === COLOR_CHANGE) colorsAt.push(numbers[i]);
    if (p.cmd[i] === TRIM) cut = true;
    else if (p.cmd[i] === STITCH) cut = false;
  }
  const kinds = stitchKinds(p);
  const objects = sewObjects(p, kinds);
  // A fill with a satin border in its thread has more satin than fill thread, and stays a fill.
  for (const o of objects) if (o.kind === 'satin' && remembered(p, o)?.borderAt) o.kind = 'fill';
  const objectAt = new Int32Array(p.cmd.length).fill(-1);
  for (const o of objects) objectAt.fill(o.index, o.first, o.last + 1);
  q = {
    blocks: colorBlocks(p),
    kinds,
    objects,
    objectAt,
    markers: findMarkers(p),
    transitions: transitions(p),
    numbers,
    total: numbers.length ? numbers[numbers.length - 1] : 0,
    colors: {},
    trimsAt,
    colorsAt,
  };
  seqCache.set(p, q);
  return q;
}

let alphaCache: { p: Pattern; hidden: ReadonlySet<number>; focus: number | null; objects: ReadonlySet<number> | null; a: Float32Array } | null = null;
let underCache: { p: Pattern; key: number; what: Highlight; mask: Uint8Array | null } | null = null;
/** Nothing to pick: in the Ablauf mode the first click on the stitches chooses the object. */
const NO_RANGE = { first: 0, last: -1 };
/** One empty list, so the colors list is not rebuilt on every redraw (it compares by identity). */
const NO_COLORS: readonly ThreadColor[] = [];

const overOf = (q: Sequence, p: Pattern) => (q.over ??= overlaps(p, q.objects));

function resetFlow(): void {
  ui.hiddenBlocks = new Set();
  ui.focusBlock = ui.hoverBlock = ui.selectedJump = ui.hoverJump = ui.hoverObject = ui.editObject = null;
  ui.selectedObjects = new Set();
  ui.selectionKey++;
  ui.flowPreview = null;
  layers.collapse();
  orderCard.close(false);
  player.pause();
  const p = files.active?.pattern;
  player.setModel(playerModel(p ?? null));
}

const count = (sorted: number[], k: number) => {
  let n = 0;
  for (const v of sorted) if (v <= k) n++;
  return n;
};

function playerModel(p: Pattern | null) {
  if (!p) return { total: 0, blockStarts: [], sections: [], timeAt: () => 0 };
  const q = seq(p);
  let at = 0;
  const sections = q.blocks.map((b) => {
    const start = at;
    at += b.stitches;
    return { start, end: at, color: `rgb(${b.color.r}, ${b.color.g}, ${b.color.b})` };
  });
  return {
    total: q.total,
    sections,
    blockStarts: q.markers.colorStarts.map((i) => q.numbers[i]),
    timeAt: (k: number) => sewingSeconds(k, count(q.trimsAt, k), count(q.colorsAt, k), settings.machineSpm),
  };
}

/** The underlay or the border of the selected objects, per record (null while it is not shown). */
function underMask(p: Pattern): Uint8Array | null {
  if (!ui.highlight || !ui.selectedObjects.size) return null;
  if (underCache?.p === p && underCache.key === ui.selectionKey && underCache.what === ui.highlight) return underCache.mask;
  const q = seq(p);
  const mask = new Uint8Array(p.cmd.length);
  const r = ui.previewResult?.pattern === p ? ui.previewResult : null;
  if (r) {
    // A preview: the new stitches of each object, its first `under` of them.
    // A preview: the new stitches of each object, its first `under` of them, or the ones from
    // where its border starts.
    r.starts.forEach((a, k) => {
      const m = r.memory[k];
      const skip = m?.underFrom ?? 0;
      const [s, e] = ui.highlight === 'under' ? [skip + 1, skip + (m?.under ?? 0)] : [(m?.borderAt ?? Infinity) + 1, r.ends[k] - a];
      if (!(e >= s)) return;
      const from = recordOfStitch(q.numbers, a + s);
      const to = recordOfStitch(q.numbers, a + e);
      for (let i = from; i <= to; i++) mask[i] = 1;
    });
  } else {
    for (const o of ui.selectedObjects) {
      const obj = q.objects[o];
      if (!obj) continue;
      const ranges = ui.highlight === 'under' ? underlayRanges(p, obj, q.kinds) : borderRanges(p, q.objects, obj);
      for (const [a, b] of ranges) for (let i = a; i <= b; i++) mask[i] = 1;
    }
  }
  // Nothing to show (no underlay): the stitches stay as they are.
  const any = mask.includes(1) ? mask : null;
  underCache = { p, key: ui.selectionKey, what: ui.highlight, mask: any };
  return any;
}

/** The line the border of each selected fill lies on (mm), while the border settings are pointed at. */
let contourCache: { p: Pattern; key: number; r: RestitchResult | null; lines: Pt[][] | null } | null = null;
function contourLines(p: Pattern): Pt[][] | null {
  const r = ui.previewResult?.pattern === p ? ui.previewResult : null;
  if (contourCache?.p === p && contourCache.key === ui.selectionKey && contourCache.r === r) return contourCache.lines;
  const q = seq(p);
  const out: Pt[][] = [];
  for (const o of ui.selectedObjects) {
    const obj = q.objects[o];
    if (!obj || obj.kind !== 'fill') continue;
    const m = remembered(p, obj);
    // A fill read from the file: its area as recognized.
    const region = m?.region ?? analyze(p, obj, q.kinds).fill;
    if (!region) continue;
    // While a change is previewed, the border where it would go.
    const b = r ? r.memory[0]?.fill?.border : m?.fill?.border;
    // Without the edges shapes on top cut: no border goes there.
    out.push(...borderLines(region, b?.offset ?? 0, wholeOf(region, m)).map((l) => l.line));
  }
  contourCache = { p, key: ui.selectionKey, r, lines: out.length ? out : null };
  return contourCache.lines;
}

function styleFor(p: Pattern): StitchStyle {
  const q = seq(p);
  const rgb = (q.colors[settings.colorBy] ??= stitchColors(p, settings.colorBy, q.kinds));
  const focus = ui.hoverBlock ?? ui.focusBlock;
  // A hovered object wins over the selection, the selection over a highlighted color.
  const shown = ui.hoverObject !== null ? new Set([ui.hoverObject]) : ui.selectedObjects.size ? ui.selectedObjects : null;
  const under = ui.hoverObject === null ? underMask(p) : null;
  const objKey = shown && ui.hoverObject !== null ? `h${ui.hoverObject}` : under ? under : shown;
  if (alphaCache?.p !== p || alphaCache.hidden !== ui.hiddenBlocks || alphaCache.focus !== focus || (alphaCache.objects as unknown) !== objKey) {
    const a = stitchAlpha(p, ui.hiddenBlocks, shown ? null : focus);
    if (shown) {
      for (let i = 0; i < a.length; i++) if (a[i] > 0 && !shown.has(q.objectAt[i])) a[i] = 0.15;
    }
    // The underlay shown: the rows over it fade, so it can be seen through them.
    if (under) for (let i = 0; i < a.length; i++) if (a[i] === 1 && !under[i]) a[i] = 0.3;
    alphaCache = { p, hidden: ui.hiddenBlocks, focus, objects: objKey as ReadonlySet<number> | null, a };
  }
  const limit = player.complete ? p.cmd.length - 1 : recordOfStitch(q.numbers, player.pos);
  const carried = settings.marks.threads ? (q.carried ??= carriedJumps(p, q.transitions)) : null;
  return { rgb, alpha: alphaCache.a, limit, carried };
}

/** Fills with a known shape, per pattern: drawn as flat areas in the view "Shapes instead of stitches". */
const shapeCache = new WeakMap<Pattern, { o: SewObject; form: Form }[]>();
function shapesOf(p: Pattern): { o: SewObject; form: Form }[] {
  let list = shapeCache.get(p);
  if (!list) {
    const q = seq(p);
    list = [];
    for (const o of q.objects) {
      if (o.kind !== 'fill') continue;
      const form = formOf(p, o, q.kinds);
      if (form?.paths.some((x) => x.closed)) list.push({ o, form });
    }
    shapeCache.set(p, list);
  }
  return list;
}

let flatAlpha: { from: Float32Array; a: Float32Array } | null = null;

/** The style with the stitches of objects shown as areas left out, and those areas. */
function asAreas(p: Pattern, style: StitchStyle): { style: StitchStyle; areas: FlatArea[] } {
  const list = shapesOf(p);
  if (flatAlpha?.from !== style.alpha) {
    const a = style.alpha.slice();
    for (const { o } of list) a.fill(0, o.first, o.last + 1);
    flatAlpha = { from: style.alpha, a };
  }
  const areas = list.filter(({ o }) => o.first <= style.limit).map(({ o, form }) => ({ form, color: o.color, alpha: style.alpha[o.first] }));
  return { style: { ...style, alpha: flatAlpha.a }, areas };
}

function flowScene(): FlowScene | null {
  const p = ui.flowPreview ?? files.active?.pattern;
  if (settings.mode !== 'flow' || !p) return null;
  const q = seq(p);
  const plain = styleFor(p);
  const flat = settings.shapesView ? asAreas(p, plain) : null;
  const style = flat?.style ?? plain;
  return {
    style,
    areas: flat?.areas ?? null,
    markers: q.markers,
    hover: ui.hoverJump !== null ? (q.transitions[ui.hoverJump] ?? null) : null,
    selected: ui.selectedJump !== null ? (q.transitions[ui.selectedJump] ?? null) : null,
    needle: player.complete ? -1 : style.limit,
    // The areas as recognized on the file itself, also while a change is previewed (not while
    // their shape is edited or the object is dragged: those show their own outline).
    outlines: files.active?.pattern && ui.selectedObjects.size && !shapeTool.active && frameTool.dragging === null ? stitchInfo(files.active.pattern, seq(files.active.pattern)).outlines : undefined,
    under: ui.hoverObject === null ? underMask(p) : null,
    contour: ui.hoverObject === null && ui.highlight === 'border' ? contourLines(p) : null,
    rungs: rungTool.active ? rungTool : null,
    shape: shapeTool.active ? { view: shapeTool, handles: shapeTool.handles() } : null,
    frame: frameTool.active ? { view: frameTool, mapped: frameTool.mappedCorners() } : null,
  };
}

const player = new Player(settings, () => {
  saveSettings(settings);
  redraw();
});

const { layers, mergeBlocked, objectName, objectPanel, selectObjects } = bindObjects({
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
  get updateLevel() {
    return updateLevel;
  },
});

const { applyRestitched, convertSettings, stitchInfo, stitchPanel } = bindStitches({
  get applyEdit() {
    return applyEdit;
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
  get sewLine() {
    return sewLine;
  },
  get sewLineAgain() {
    return sewLineAgain;
  },
  get toggleGuides() {
    return toggleGuides;
  },
  get toggleRungs() {
    return toggleRungs;
  },
});

// Rungs -------------------------------------------------------------------------------------------

const { closeRungs, rungInfo, rungTool, sewAlongLines, syncRungs, toggleGuides, toggleRungs } = bindRungs({
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

const { closeShape, deleteSelected, duplicateSelected, enterShape, followKnockouts, isLineObject, mirrorSelected, sewLine, sewLineAgain, shapeTarget, shapeTool, subtractSelected, syncShape, takeShapes } = bindShapes({
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
  if (mode !== 'flow') {
    if (drawTool.active) setDrawing(null);
    player.pause();
    if (!player.complete) player.set(Number.MAX_SAFE_INTEGER);
  }
  controls.refresh();
  updateLevel();
  empty.textContent = t(mode === 'flow' ? 'canvas.empty.flow' : mode === 'image' ? 'canvas.empty.image' : 'canvas.empty');
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
    shapeable: selected.length === 1 && !stitchInfo(p, q).free?.on && (!!stitchInfo(p, q).measured.fill || (!!q.objects[selected[0]] && isLineObject(p, q.objects[selected[0]]))),
    shaping: shapeTool.active && selected.length === 1 && selected[0] === ui.shapeObject ? { nodes: shapeTool.count, smooth: shapeTool.selectedSmooth, ...(q.objects[selected[0]] && isLineObject(p, q.objects[selected[0]]) ? { line: { closed: shapeTool.closed } } : {}) } : null,
    frame: frameTool.active ? { canScale: frameTool.canScale } : null,
    mergeBlocked: selected.length > 1 ? mergeBlocked(selected.map((o) => q.objects[o])) : null,
    reversible: selected.some((o) => reversible(q.objects[o])),
    subtractable: selected.length > 1 && selected.every((o) => q.objects[o].kind === 'fill'),
  };
}

// Rendering ------------------------------------------------------------------

let frame = 0;
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
      drawDrawing(ctx, vp, drawTool.preview, { nodes: drawTool.kind === 'pen' ? drawTool.count : 0, closing: drawTool.closing, size: drawTool.size });
    if (ui.letterMode) drawLetterBoxes();
    drawPlanCompare();
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
    if (settings.mode === 'density') drawLegendCanvas();
    renderStats($('stats'), active, ui.grid, settings, ui.computing);
    const p = active?.pattern ?? null;
    const q = p ? seq(p) : null;
    $('player').hidden = !p;
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
          format: active?.pattern?.format ?? 'pes',
          names: p && q ? letteringNames(p, q) : undefined,
        },
        getLang(),
      );
      jumpsPanel.update({ list: q?.transitions ?? [], selected: ui.selectedJump, lang: getLang() });
      const objects = !ui.lettering && p && q && ui.selectedObjects.size;
      objectPanel.update(objects ? objectInfo(p, q) : null, getLang());
      stitchPanel.update(objects ? { ...stitchInfo(p, q), ...rungInfo(p, q) } : null);
      updateOverlapCard();
      letteringPanel.update(ui.lettering && q ? letteringInfo(q) : null, getLang());
      if (ui.focusText && ui.lettering) {
        letteringPanel.focusText(true);
        ui.focusText = false;
      }
      $<HTMLButtonElement>('order-optimize').disabled = !q || q.objects.length < 2;
    }
    panel.update(active, ui.selectedZone);
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
      editing: editor.active,
      comparing: ui.comparing,
      selection: editor.selection.size,
      pointsVisible: vp.scale >= POINTS_MIN_SCALE,
      message: ui.correctMessage,
    });
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
    imageMode.fit(vp, ui.stageW, ui.stageH);
    redraw();
    return;
  }
  const b = f?.pattern?.bounds;
  if (!b) return;
  // With a hoop chosen, fit shows the whole sewing field so the room left is visible.
  const m = f?.material.hoop ? hoopRect(b, f.material.hoop) : null;
  if (m) vp.fit(Math.min(m.x, b.minX / 10), Math.min(m.y, b.minY / 10), Math.max(m.x + m.w, b.maxX / 10), Math.max(m.y + m.h, b.maxY / 10), ui.stageW, ui.stageH, 56);
  else vp.fit(b.minX / 10, b.minY / 10, b.maxX / 10, b.maxY / 10, ui.stageW, ui.stageH);
  redraw();
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
  redraw,
  changed: redraw,
});

/** An edit made point by point: the objects it touched keep what they remember (see keepObjects). */
function commitHand(next: Pattern, change: HandChange | null): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p) return;
  if (!change) return applyEdit(next);
  const moved = keepObjects(p, next, change, seq);
  const editing = ui.editObject !== null && moved.has(ui.editObject) ? moved.get(ui.editObject)! : ui.editObject;
  applyEdit(next);
  files.setObjects(f, rememberedIn(next, seq(next).objects));
  if (ui.editObject !== null) {
    ui.editObject = editing !== null && editing >= 0 ? editing : null;
    ui.selectedObjects = ui.editObject !== null ? new Set([ui.editObject]) : new Set();
  }
  ui.selectionKey++;
  updateLevel();
  redraw();
}

/** The penetrations of object `o` are edited (Ablauf). `fit` zooms in when it is small on the stage. */
function enterObject(o: number, fit: boolean): void {
  const p = files.active?.pattern;
  const obj = p ? seq(p).objects[o] : undefined;
  if (!obj) return;
  if (shapeTool.active) closeShape();
  if (!editor.active) editor.setActive(true);
  else editor.reset();
  ui.editObject = o;
  if (!ui.selectedObjects.has(o) || ui.selectedObjects.size !== 1) selectObjects([o], false);
  if (fit) {
    const w = ((obj.maxX - obj.minX) / 10) * vp.scale;
    const h = ((obj.maxY - obj.minY) / 10) * vp.scale;
    if (Math.max(w / ui.stageW, h / ui.stageH) < 0.4) vp.fit(obj.minX / 10, obj.minY / 10, obj.maxX / 10, obj.maxY / 10, ui.stageW, ui.stageH, 60);
  }
  updateLevel();
  redraw();
}

/** Pans so that record `i` is on the stage (not under the tools or the player). */
function revealRecord(i: number): void {
  const p = files.active?.pattern;
  if (!p) return;
  const [sx, sy] = vp.toScreen(p.x[i] / 10, p.y[i] / 10);
  const m = 80;
  const dx = sx < m ? m - sx : sx > ui.stageW - m ? ui.stageW - m - sx : 0;
  const dy = sy < m ? m - sy : sy > ui.stageH - m ? ui.stageH - m - sy : 0;
  if (dx || dy) vp.pan(dx, dy);
  redraw();
}

function setEditing(on: boolean): void {
  if (on) closeRungs();
  if (on) closeShape();
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
  const level = on ? 'stitches' : shaping ? 'shape' : 'objects';
  stage.classList.toggle('editing', on);
  stage.classList.toggle('shaping', shaping);
  document.querySelectorAll<HTMLInputElement>('input[name="level"]').forEach((i) => (i.checked = i.value === level));
  const crumb = $('edit-crumb');
  const p = files.active?.pattern;
  const flow = settings.mode === 'flow';
  crumb.hidden = !(on || shaping) || !flow;
  if (on && flow) {
    const q = p ? seq(p) : null;
    crumb.textContent = q && ui.editObject !== null && q.objects[ui.editObject] ? t('level.in', { name: objectName(q, ui.editObject) }) : t('level.pick');
  } else if (shaping && flow) {
    const q = p ? seq(p) : null;
    crumb.textContent = q && ui.shapeObject !== null && q.objects[ui.shapeObject] ? t('level.inShape', { name: objectName(q, ui.shapeObject) }) : '';
  }
  const mode = settings.mode;
  $('canvas-hint').textContent = t(
    mode === 'image'
      ? 'canvas.hint.image'
      : drawTool.kind && flow
        ? `canvas.hint.draw.${drawTool.kind}`
      : on
        ? flow
          ? 'canvas.hint.flowEdit'
          : 'canvas.hint.edit'
        : shaping
          ? 'canvas.hint.shape'
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
  syncPlayer();
  recompute();
}

const { correctPanel, drawPlanCompare, inPlanFrame, movePlanSplit, pinPlan, tuneToFabric } = bindCorrection({
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

const hoopPanel = bindHoop(settings, () => {
  saveSettings(settings);
  storeMaterial();
  fitView();
});

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
  await files.addWithObjects(`${name}.pes`, data.slice().buffer, rememberedIn(added, objs), storeAside(aside));
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
const applyLang = (l: Lang) => {
  setLang(l);
  langSelect.value = l;
  controls.refresh();
  profile.refresh();
  files.render();
  player.render();
  imageMode.render();
  setMode(settings.mode);
  redraw();
};
langSelect.addEventListener('change', () => {
  settings.lang = langSelect.value as Lang;
  saveSettings(settings);
  applyLang(settings.lang);
  ui.asideShown = null;
  redraw();
});
applyLang(detectLang(settings.lang));
applyI18n(document.body);

$('fit').addEventListener('click', () => fitView());
document.querySelectorAll<HTMLInputElement>('input[name="level"]').forEach((i) =>
  i.addEventListener('change', () => {
    if (!i.checked) return;
    if (i.value === 'shape') return chooseShapeLevel();
    closeShape();
    setEditing(i.value === 'stitches');
  }),
);

/** Level Form from the switch: the selected object's outline, or a hint to pick one with a fill. */
function chooseShapeLevel(): void {
  const p = files.active?.pattern;
  const o = ui.selectedObjects.size === 1 ? [...ui.selectedObjects][0] : null;
  if (p && o !== null && shapeTarget(p, seq(p), o)) return enterShape(o, true);
  layers.say(t(o === null ? 'shape.pick' : 'shape.noFill'), true);
  updateLevel();
  redraw();
}
exportBtn.addEventListener('click', () => {
  const p = files.active?.pattern;
  if (p) exportPng({ ...scene(), edit: null }, ui.stageW, ui.stageH, stageBg(), p.name || 'pattern');
});

// Opening and saving files and projects: src/app/fileIo.ts

const { adoptMaterial, storeMaterial } = bindFileIo({
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
  get deleteSelected() {
    return deleteSelected;
  },
  get drawTool() {
    return drawTool;
  },
  get duplicateSelected() {
    return duplicateSelected;
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
  get objectInfo() {
    return objectInfo;
  },
  get objectPanel() {
    return objectPanel;
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

files.render();
redraw();
void files.restore();
void imageMode.restore();

$('fabric-tune').addEventListener('click', () => tuneToFabric());
