import './style.css';
import { WorkerClient } from './density/client';
import type { DensityGrid } from './density/grid';
import { applyI18n, detectLang, formatNumber, getLang, setLang, t, type Lang } from './i18n';
import { gridToCanvas } from './render/heatmap';
import { drawLegend } from './render/legend';
import { hoopRect } from './render/hoop';
import { drawScene, type FocusStitches, type Scene } from './render/scene';
import { validationToCanvas } from './render/validationOverlay';
import { Viewport } from './render/viewport';
import { loadSettings, materialOf, saveSettings } from './settings';
import { bindControls, type ChangeKind } from './ui/controls';
import { cssColor } from './ui/threadPicker';
import { SATIN_SHARE } from './model/covers';
import { CorrectPanel, type Cells, type CorrectMessage, type PlanRow, type PlanView } from './ui/correctPanel';
import { applyProposals, currentSettings, fineZones, planCorrection, planFabric, wanted, type Box, type Plan } from './correct/plan';
import type { CorrectionReport } from './correct/auto';
import { Editor } from './ui/editor';
import { keepObjects, type HandChange } from './model/handEdit';
import { exportPng } from './ui/export';
import { FileList, type LoadedFile } from './ui/fileList';
import { bindHoop } from './ui/hoopPanel';
import { legendSpec } from './ui/legendSpec';
import { bindProfile } from './ui/profilePanel';
import { renderStats } from './ui/stats';
import { updateTooltip } from './ui/tooltip';
import { ValidationPanel } from './ui/validationPanel';
import { acknowledgementOf, settledBy, type Acknowledgement } from './validation/acks';
import type { ValidationResult, Zone } from './validation/validate';
import { POINTS_MIN_SCALE } from './render/editOverlay';
import { DIVIDER_GRAB_PX, drawBeforeAfter, drawDivider, drawPanels } from './render/compare';
import type { Pattern, ThreadColor } from './model/pattern';
import type { Measurement } from './validation/measure';
import { initUpdateNotice } from './ui/updateNotice';
import { bindFileIo } from './app/fileIo';
import { downloadPattern, writePattern } from './writers';
import { parsePattern } from './parsers';
import { ImageMode } from './ui/imageMode';
import { lightFromPointer, lightFromTilt, sweep } from './render/light';
import { classify } from './validation/validate';
import { setTrims } from './model/jumps';
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
  type CarriedJumps,
  type ColorBlock,
  type Markers,
  type Transition,
} from './model/sequence';
import { recolor, sameColor } from './model/recolor';
import { COLOR_CHANGE, computeBounds, patternStats, STITCH, TRIM } from './model/pattern';
import { stitchAlpha, stitchAt, stitchColors, transitionAt, type StitchStyle } from './render/flow';
import type { FlowScene, ShapeOutline } from './render/scene';
import type { Mode } from './settings';
import { JumpsPanel } from './ui/jumpsPanel';
import { blockName, kindLabel, LayersPanel, LONG_PRESS_MS } from './ui/layersPanel';
import { ObjectMenu } from './ui/objectMenu';
import { ObjectPanel, OrderCard } from './ui/objectPanel';
import { StitchPanel, type Highlight, type StitchInfo } from './ui/stitchPanel';
import { borderRanges, syncBorders } from './model/border';
import { analyze, forget, holdMemory, keepShape, openOnPurpose, objectKey, measureFill, measureRun, measureSatin, remember, remembered, type Rails, rememberedIn, rememberShapes, restitch, shapeTrust, unionRegion, underlayRanges, type Remembered, type Settings as RestitchSettings, type ShapeTrust, type RestitchResult } from './model/restitch';
import { outline } from './digitize/region';
import { railsFromOutline } from './digitize/rungs';
import type { Pt } from './digitize/skeleton';
import { RungTool } from './ui/rungTool';
import { ShapeTool } from './ui/shapeTool';
import { DrawTool, type DrawKind } from './ui/drawTool';
import { nearestThread } from './image/prepare';
import { rgbToLab } from './image/color';
import { drawAside, drawDrawing, type FlatArea } from './render/shapeOverlay';
import { AsidePanel } from './ui/asidePanel';
import type { LeftOut } from './ui/imageMode';
import { addShape, type NewShape } from './model/addShape';
import { fillToLine, lineOf, lineSettings, lineToFill, resewLine } from './model/line';
import { borderLines, type PathStitch } from './model/along';
import { asideOf, dropAside, sewAgain, setAside, setAsideRole, storeAside, type AsideRole, type AsideShape } from './model/aside';
import { deleteObjects, duplicateObject, mirrorMatrix, recolorObjects, subtractTop, unionForm } from './model/shapeOps';
import { stitchesBefore } from './model/transform';
import { FrameTool } from './ui/frameTool';
import { formOf, reshapeFill, scaleBlocked, transformSewObject } from './model/reshape';
import { isCovered, overlapsIn, refreshKnockouts, setKnockout, setOverlapShare, wholeArea, wholeOf } from './model/knockout';
import { transformObject } from './model/transform';
import { apply, translation, type Form, type Mat } from './shape/path';
import { fontNow, loadCatalog, loadFont, type Catalog } from './lettering/font';
import { followText, layout, LETTERING_DEFAULTS, type Lettering } from './lettering/layout';
import { letteringObjects, letteringOf, placeLettering, withoutObjects } from './lettering/place';
import { sewLettering } from './lettering/sew';
import { LetteringPanel } from './ui/letteringPanel';
import { digitizeDefaults, digitizeShapes, isStroke, pullFor, SATIN_MAX, type Digitized } from './digitize/digitize';
import { recommendedSpacing } from './validation/profiles';
import { numberInColor, overlaps, rememberObjects, sewObjects, splitObject, type SewObject } from './model/objects';
import { conflicts, moveStats, optimizePlan, reorder, violations, weigh } from './model/order';
import { autoReversible, reverseObjects, reversible } from './model/reverse';
import { Player } from './ui/player';
import { installPanelResize } from './ui/panelResize';
import type { Key } from './i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * State several parts of the app read and change: selection, hover, the views on the stage and what
 * is being edited. One object, so the parts can live in their own modules (plans/stabilitaet.md).
 */
const ui = {
  correctMessage: null as CorrectMessage,
  /** Comparison view: original left of the divider, current version right of it. */
  comparing: false,
  /** Divider position as a share of the stage width. */
  split: 0.5,
  splitDrag: false,
  origGrid: null as DensityGrid | null,
  /** Pattern and options `origGrid` was computed for. */
  origKey: null as { p: Pattern; opts: string } | null,
  origGridImg: null as HTMLCanvasElement | null,
  densitySeq: 0,
  grid: null as DensityGrid | null,
  gridImg: null as HTMLCanvasElement | null,
  computing: false,
  stageW: 0,
  stageH: 0,
  /** Zone hovered in the list (wins) or last jumped to; both are framed on the canvas. */
  hoverZone: null as Zone | null,
  selectedZone: null as Zone | null,
  /** Color blocks hidden or highlighted in the list (cleared for another file). */
  hiddenBlocks: new Set() as ReadonlySet<number>,
  focusBlock: null as number | null,
  selectedJump: null as number | null,
  hoverJump: null as number | null,
  /** Selected objects (by index in sewing order) and the one hovered in the list. */
  selectedObjects: new Set() as ReadonlySet<number>,
  /** Counts selections made by the user; the stitch settings are measured again for each. */
  selectionKey: 0,
  /** New stitches shown while a stitch setting is being dragged, not applied yet. */
  flowPreview: null as Pattern | null,
  hoverObject: null as number | null,
  /** Object whose penetrations are edited in the Ablauf mode (the level "Stitches"), or null. */
  editObject: null as number | null,
  /** Parts of each object, measured stitch settings per selection (cached per pattern and selection). */
  stitchCache: null as { p: Pattern; key: number; info: StitchInfo } | null,
  /** The object the rung tool works on, and the pattern its columns were read from. */
  rungObject: null as number | null,
  /** The object whose fill outline is edited (level Form), and the pattern its form was read from. */
  shapeObject: null as number | null,
  shapePattern: null as Pattern | null,
  /** Shape aside hovered in its list, shown on the canvas. */
  hoverAside: null as number | null,
  asideShown: null as AsideShape[] | null,
  /** The next file opened keeps the view (a design started by drawing stays where it was drawn). */
  keepView: false,
  /**
   * The lettering chosen (all its objects are selected), as last set: while its font is still
   * loading, ahead of its stitches. `recorded`: this edit already has its undo step; `sewn`: the
   * settings its stitches were made with.
   */
  lettering: null as { l: Lettering; f: LoadedFile; recorded: boolean; sewn: string } | null,
  /** Moving single letters (the letter level), and the letter chosen there (its place in the text). */
  letterMode: false,
  letterAt: null as number | null,
  /** A letter being dragged: its place, where the drag started (mm) and its offset then. */
  letterDrag: null as { at: number; from: [number, number]; dx: number; dy: number; moved: boolean } | null,
  /** The text field gets the focus once the card shows (a new lettering). */
  focusText: false,
  /** Proposals worked out for the active file, until they are taken over or the file changes. */
  planState: null as { file: LoadedFile; pattern: Pattern; plan: Plan; checked: Set<number>; fine: Box[]; fineOn: boolean; view: PlanView } | null,
  /** The object of the proposal under the pointer (mm), outlined on the canvas. */
  planHover: null as Box | null,
  /** The preview shown on the canvas now (the pointer is on its row, or it is held). */
  planPreview: null as PlanPreview | null,
  /** The proposals held for comparing (their name was clicked): shown while the pointer is elsewhere. */
  planPin: null as number[] | null,
  planDrag: false,
};
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

/** Everything the Ablauf mode derives from one pattern, computed once per version. */
interface Sequence {
  blocks: ColorBlock[];
  kinds: Uint8Array;
  markers: Markers;
  transitions: Transition[];
  numbers: Uint32Array;
  total: number;
  colors: Partial<Record<string, Uint8Array>>;
  /** Trims and color changes up to each stitch number, for the time estimate. */
  trimsAt: number[];
  colorsAt: number[];
  /** Jumps without a trim, built the first time they are drawn as thread. */
  carried?: CarriedJumps;
  objects: SewObject[];
  /** Objects each object lies on (built when first needed). */
  over?: number[][];
  /** Object of each record (-1 between objects). */
  objectAt: Int32Array;
  /** The lettering each object belongs to (built when first needed). */
  letterings?: (Lettering | undefined)[];
  /** Their names in the list, per language. */
  letteringNames?: { lang: string; names: ReadonlyMap<number, string> | undefined };
}
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

let hoverBlock: number | null = null;
let alphaCache: { p: Pattern; hidden: ReadonlySet<number>; focus: number | null; objects: ReadonlySet<number> | null; a: Float32Array } | null = null;
/** The pointer is on the underlay or border settings: that part of the selected objects is shown. */
let highlight: Highlight | null = null;
/** The restitch behind `flowPreview` (it knows where the new underlay ends). */
let previewResult: RestitchResult | null = null;
let underCache: { p: Pattern; key: number; what: Highlight; mask: Uint8Array | null } | null = null;
/** Nothing to pick: in the Ablauf mode the first click on the stitches chooses the object. */
const NO_RANGE = { first: 0, last: -1 };
/** One empty list, so the colors list is not rebuilt on every redraw (it compares by identity). */
const NO_COLORS: readonly ThreadColor[] = [];

const overOf = (q: Sequence, p: Pattern) => (q.over ??= overlaps(p, q.objects));

function resetFlow(): void {
  ui.hiddenBlocks = new Set();
  ui.focusBlock = hoverBlock = ui.selectedJump = ui.hoverJump = ui.hoverObject = ui.editObject = null;
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
  if (!highlight || !ui.selectedObjects.size) return null;
  if (underCache?.p === p && underCache.key === ui.selectionKey && underCache.what === highlight) return underCache.mask;
  const q = seq(p);
  const mask = new Uint8Array(p.cmd.length);
  const r = previewResult?.pattern === p ? previewResult : null;
  if (r) {
    // A preview: the new stitches of each object, its first `under` of them.
    // A preview: the new stitches of each object, its first `under` of them, or the ones from
    // where its border starts.
    r.starts.forEach((a, k) => {
      const m = r.memory[k];
      const skip = m?.underFrom ?? 0;
      const [s, e] = highlight === 'under' ? [skip + 1, skip + (m?.under ?? 0)] : [(m?.borderAt ?? Infinity) + 1, r.ends[k] - a];
      if (!(e >= s)) return;
      const from = recordOfStitch(q.numbers, a + s);
      const to = recordOfStitch(q.numbers, a + e);
      for (let i = from; i <= to; i++) mask[i] = 1;
    });
  } else {
    for (const o of ui.selectedObjects) {
      const obj = q.objects[o];
      if (!obj) continue;
      const ranges = highlight === 'under' ? underlayRanges(p, obj, q.kinds) : borderRanges(p, q.objects, obj);
      for (const [a, b] of ranges) for (let i = a; i <= b; i++) mask[i] = 1;
    }
  }
  // Nothing to show (no underlay): the stitches stay as they are.
  const any = mask.includes(1) ? mask : null;
  underCache = { p, key: ui.selectionKey, what: highlight, mask: any };
  return any;
}

/** The line the border of each selected fill lies on (mm), while the border settings are pointed at. */
let contourCache: { p: Pattern; key: number; r: RestitchResult | null; lines: Pt[][] | null } | null = null;
function contourLines(p: Pattern): Pt[][] | null {
  const r = previewResult?.pattern === p ? previewResult : null;
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
  const focus = hoverBlock ?? ui.focusBlock;
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
    contour: ui.hoverObject === null && highlight === 'border' ? contourLines(p) : null,
    rungs: rungTool.active ? rungTool : null,
    shape: shapeTool.active ? { view: shapeTool, handles: shapeTool.handles() } : null,
    frame: frameTool.active ? { view: frameTool, mapped: frameTool.mappedCorners() } : null,
  };
}

const player = new Player(settings, () => {
  saveSettings(settings);
  redraw();
});

const layers = new LayersPanel({
  toggle: (b) => {
    const next = new Set(ui.hiddenBlocks);
    if (!next.delete(b)) next.add(b);
    ui.hiddenBlocks = next;
    if (ui.focusBlock === b) ui.focusBlock = null;
    redraw();
  },
  focus: (b, sticky) => {
    if (sticky) {
      ui.focusBlock = b;
      hoverBlock = null;
    } else hoverBlock = b;
    redraw();
  },
  showAll: () => {
    ui.hiddenBlocks = new Set();
    ui.focusBlock = hoverBlock = null;
    redraw();
  },
  // Only the colors change, so the density measurement still holds.
  recolor: (b, color) => {
    const f = files.active;
    if (f?.pattern) applyEdit(recolor(f.pattern, b, color), f.measurement);
  },
  select: (objs, toggle) => selectObjects(objs, toggle),
  hover: (o) => {
    if (ui.hoverObject === o) return;
    ui.hoverObject = o;
    redraw();
  },
  move: (order, moved, into) => moveObjects(order, moved, into),
  menu: (o, x, y) => void showObjectMenu(o, x, y),
});

/** Name of an object as the list shows it: kind and number within its color. */
function objectName(q: Sequence, i: number): string {
  const o = q.objects[i];
  const k = numberInColor(q.objects, o);
  return `${kindLabel(o.kind)} ${k} (${blockName({ index: o.block, color: o.color })})`;
}

/**
 * What a new order puts on top that lay underneath before (null: nothing): the first moved object
 * sewn before something it lies on, or after something lying on it, and whether it is covered now.
 */
function coverConflict(q: Sequence, p: Pattern, order: number[], moved: ReadonlySet<number>): { a: number; c: number; covered: boolean } | null {
  const over = overOf(q, p);
  const bad = violations(order, over);
  if (!bad.length) return null;
  const a = order[bad.find((k) => moved.has(order[k])) ?? bad[0]];
  const c = conflicts(order, over, a)[0];
  // `a` lies on `c` but now comes first: `c` covers it. Otherwise `a` now covers `c`.
  return c === undefined ? null : { a, c, covered: over[a].includes(c) };
}

/** The warning for a conflict, with the objects named by `name` (as the list shows them after the edit). */
function coverWarning(w: { a: number; c: number; covered: boolean } | null, name: (o: number) => string): string | null {
  if (!w) return null;
  return t(w.covered ? 'object.coveredBy' : 'object.covers', { a: name(w.a), b: name(w.c) });
}

function selectObjects(objs: number[], toggle: boolean): void {
  let next: Set<number>;
  if (toggle) {
    next = new Set(ui.selectedObjects);
    for (const o of objs) if (!next.delete(o)) next.add(o);
  } else next = new Set(objs);
  // A lettering is chosen as a whole: all its objects, or none of them.
  const p0 = files.active?.pattern;
  if (p0) {
    const q0 = seq(p0);
    const all = letteringsOf(p0, q0);
    for (const o of objs) {
      const id = all[o]?.id;
      if (!id) continue;
      all.forEach((l, k) => {
        if (l?.id !== id) return;
        if (next.has(o)) next.add(k);
        else next.delete(k);
      });
    }
  }
  ui.selectedObjects = next;
  ui.selectionKey++;
  ui.flowPreview = null;
  if (next.size) ui.focusBlock = null;
  if (rungTool.active && (next.size !== 1 || !next.has(ui.rungObject!))) closeRungs();
  // While editing an outline, choosing another object goes on with that one's (or back to the objects).
  if (shapeTool.active && (next.size !== 1 || !next.has(ui.shapeObject!))) {
    const one = next.size === 1 ? [...next][0] : null;
    const p = files.active?.pattern;
    const form = one !== null && p ? shapeTarget(p, seq(p), one) : null;
    if (form && one !== null && p) {
      shapeTool.open(form);
      ui.shapeObject = one;
      ui.shapePattern = p;
    } else closeShape();
  }
  // While editing points, choosing another object (in the list too) goes on with that one.
  if (editor.active && settings.mode === 'flow') {
    const one = next.size === 1 ? [...next][0] : null;
    if (one !== ui.editObject) {
      editor.reset();
      ui.editObject = one;
      updateLevel();
    }
  }
  layers.reveal([...next]);
  redraw();
  if (next.size) requestAnimationFrame(() => $('object-panel').scrollIntoView({ block: 'nearest' }));
}

/**
 * Sews the objects in `order` (an edit that can be undone). With `into`, the moved objects take
 * the thread of that color block. Also a place where an object comes to lie over what lay on it
 * is taken (a shared edge often is all of it): the message says so, undo goes back. The moved
 * objects stay selected.
 */
function moveObjects(order: number[], moved: number[], into: number | null = null): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p) return;
  const q = seq(p);
  const movedSet = new Set(moved);
  const target = into === null ? undefined : q.blocks[into];
  const recolored = target ? moved.filter((o) => !sameColor(q.objects[o].color, target.color)) : [];
  const starts: number[] = [];
  const next = reorder(p, q.objects, order, settings.trimMm, starts, { into: new Map(recolored.map((o) => [o, into!])) });
  if (next === p) return;
  const conflict = coverConflict(q, p, order, movedSet);
  const keepHidden = ui.hiddenBlocks.size;
  applyEdit(next, f.measurement);
  if (keepHidden) ui.hiddenBlocks = new Set();
  // The objects are found again by their first stitch; the moved ones stay selected.
  const nq = seq(next);
  const now = (o: number) => nq.objectAt[recordOfStitch(nq.numbers, starts[order.indexOf(o)] + 1)];
  const nameNow = (o: number) => (now(o) >= 0 ? objectName(nq, now(o)) : objectName(q, o));
  const warning = coverWarning(conflict, nameNow);
  ui.selectedObjects = new Set(moved.map(now).filter((o) => o >= 0));
  ui.selectionKey++;
  layers.reveal([...ui.selectedObjects]);
  const undo = t('object.undo');
  if (target && recolored.length) {
    const own = q.objects[recolored[0]];
    const ownColors = new Set(recolored.map((o) => q.objects[o].block));
    const one = now(recolored[0]);
    const what = recolored.length > 1 ? t('object.many', { n: recolored.length }) : one >= 0 ? `${kindLabel(nq.objects[one].kind)} ${numberInColor(nq.objects, nq.objects[one])}` : objectName(q, recolored[0]);
    layers.say({
      text: [warning, t('object.movedInto', { a: what, color: blockName(target) }), undo].filter(Boolean).join(' ') + ' ',
      warn: !!warning,
      // The other way to read the drop: sewn at that time, but in its own thread.
      action: {
        label: ownColors.size === 1 ? t('object.keepColor', { color: blockName({ index: own.block, color: own.color }) }) : t('object.keepColors'),
        title: t('object.keepColor.hint'),
        run: () => {
          if (files.active !== f || f.pattern !== next) return;
          history('undo');
          moveObjects(order, moved, null);
        },
      },
    });
  } else layers.say({ text: [warning, t(warning ? 'object.movedAnyway' : 'object.moved'), undo].filter(Boolean).join(' '), warn: !!warning });
  redraw();
}

/**
 * Sews the selected objects as one: they move to where the first one is sewn (as when moving
 * them, also where that puts one over what lay on it, with a warning), and fills become one area,
 * sewn anew with the first one's settings.
 */
function mergeObjects(): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p || ui.selectedObjects.size < 2) return;
  const q = seq(p);
  const sel = [...ui.selectedObjects].sort((a, b) => a - b);
  const objs = sel.map((o) => q.objects[o]);
  if (mergeBlocked(objs)) return;
  const set = new Set(sel);
  const order = [...q.objects.keys()].filter((o) => o < sel[0] || (o > sel[0] && !set.has(o)));
  order.splice(sel[0], 0, ...sel);
  const warning = coverWarning(coverConflict(q, p, order, set), (o) => objectName(q, o));
  const done = (n: number) => layers.say({ text: [warning, t('object.merged', { n })].filter(Boolean).join(' '), warn: !!warning });
  const starts: number[] = [];
  const next = reorder(p, q.objects, order, settings.trimMm, starts);
  // A new pattern also when nothing moved: undo goes back to the one that shows them apart.
  const target: Pattern = next === p ? { ...p } : next;
  const k = sel[0];
  rememberObjects(target, [starts[k]], starts[k + sel.length] ?? Infinity);
  const nq = seq(target);
  const merged = nq.objectAt[recordOfStitch(nq.numbers, starts[k] + 1)];
  const fills = objs.every((o) => o.kind === 'fill');
  const fill = fills ? (remembered(p, objs[0])?.fill ?? measureFill(p, analyze(p, objs[0], q.kinds))) : null;
  // Fills with curves become one outline (editable as a shape), the others one area.
  const forms = fills ? objs.map((o) => remembered(p, o)?.form) : [];
  const form = forms.length && forms.every(Boolean) ? unionForm(forms as Form[]) : null;
  const area = form ? wholeArea(form) : fills ? unionRegion(objs.flatMap((o) => remembered(p, o)?.region ?? analyze(p, o, q.kinds).fill ?? [])) : null;
  if (merged >= 0 && fill && area) {
    remember(target, nq.objects[merged], form ? { region: area, fill, form } : { region: area, fill });
    const r = restitch(target, nq.objects, [merged], { kind: 'fill', s: fill }, nq.kinds, settings.trimMm);
    if (r.starts.length) {
      ui.selectedObjects = new Set([merged]);
      applyRestitched(r, 'stitch.failed', true);
      if (form) layers.say(t('object.joined', { n: sel.length }));
      else done(sel.length);
      return;
    }
  }
  applyEdit(target);
  if (merged >= 0) ui.selectedObjects = new Set([merged]);
  ui.selectionKey++;
  done(sel.length);
  redraw();
}

/**
 * Sews the selected satins and fills from the other side (new stitches, an edit that can be
 * undone), and says what that saved in trims or travel.
 */
function reverseSelected(): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p || !ui.selectedObjects.size) return;
  const q = seq(p);
  const which = [...ui.selectedObjects].sort((a, b) => a - b).filter((o) => reversible(q.objects[o]));
  if (!which.length) return;
  const r = reverseObjects(p, q.objects, which, q.kinds, settings.trimMm);
  const failed = r.failed.length;
  const failText = failed ? t(failed === 1 ? 'object.reverse.failed.one' : 'object.reverse.failed', { n: failed }) : null;
  if (!r.starts.length) {
    layers.say(failText ?? '', true);
    return;
  }
  const before = orderStats(p);
  applyRestitched({ ...r, failed: [] }, 'stitch.failed');
  const now = files.active?.pattern;
  if (!now) return;
  const after = orderStats(now);
  const dt = before.trims - after.trims;
  const saved = dt > 0 ? t(dt === 1 ? 'order.fewerTrims.one' : 'order.fewerTrims', { n: dt }) : after.travelMm < before.travelMm - 1 ? t('order.shorterTravel') : null;
  const done = saved ? t('object.reversedSaves', { what: saved }) : t('object.reversed');
  layers.say({ text: [failText, done, t('object.undo')].filter(Boolean).join(' '), warn: !!failText });
}

/** Why the objects cannot be sewn as one, or null. */
function mergeBlocked(objs: SewObject[]): Key | null {
  if (objs.some((o) => o.block !== objs[0].block)) return 'object.merge.color';
  const together = objs.every((o, k) => !k || o.index === objs[k - 1].index + 1);
  if (!together && objs.some((o) => o.kind !== 'fill')) return 'object.merge.kind';
  return null;
}

/** Shows the selected object as its sections, each one an object. */
function splitSelected(): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p || ui.selectedObjects.size !== 1) return;
  const o = seq(p).objects[[...ui.selectedObjects][0]];
  if (!o || o.sections < 2) return;
  // A copy of the stitches: undo goes back to the pattern that still shows one object.
  const next: Pattern = { ...p };
  splitObject(next, o);
  applyEdit(next);
  const nq = seq(next);
  ui.selectedObjects = new Set(nq.objects.flatMap((x, i) => (x.first >= o.first && x.last <= o.last ? [i] : [])));
  ui.selectionKey++;
  layers.reveal([...ui.selectedObjects]);
  layers.say(t('object.splitDone', { n: ui.selectedObjects.size }));
  redraw();
}

const objectPanel = new ObjectPanel({
  merge: () => mergeObjects(),
  duplicate: () => duplicateSelected(),
  mirror: (axis) => mirrorSelected(axis),
  subtract: () => subtractSelected(),
  remove: () => deleteSelected(),
  aside: (role) => putAside(role),
  thread: (c) => {
    const p = files.active?.pattern;
    const sel = frameObjects();
    const next = p && recolorObjects(p, sel, c, settings.trimMm);
    if (!next) return;
    const q = seq(next);
    // The objects keep their place in the order, so their indices stay.
    takeShapes(next, sel.filter((o) => o < q.objects.length));
  },
  split: splitSelected,
  step: (dir) => {
    const p = files.active?.pattern;
    if (!p || ui.selectedObjects.size !== 1) return;
    const o = [...ui.selectedObjects][0];
    const n = seq(p).objects.length;
    const k = o + dir;
    if (k < 0 || k >= n) return;
    const order = Array.from({ length: n }, (_, i) => i);
    order[o] = k;
    order[k] = o;
    moveObjects(order, [o]);
  },
  reverse: () => reverseSelected(),
  clear: () => {
    if (editor.active) setEditing(false);
    ui.selectedObjects = new Set();
    ui.selectionKey++;
    ui.flowPreview = null;
    redraw();
  },
  editStitches: (on) => setEditing(on),
  editShape: (on) => {
    if (!on) return closeShape();
    if (ui.selectedObjects.size === 1) enterShape([...ui.selectedObjects][0], true);
  },
  deleteNode: () => shapeTool.deleteSelected(),
  toggleNode: () => shapeTool.toggleSmooth(),
  closeLine: () => shapeTool.toggleClosed(),
  deleteSelection: () => editor.deleteSelection(),
  splitStitch: () => editor.splitSelected(),
});

function stitchInfo(p: Pattern, q: Sequence): StitchInfo {
  if (ui.stitchCache?.p === p && ui.stitchCache.key === ui.selectionKey) return ui.stitchCache.info;
  const measured: StitchInfo['measured'] = {};
  const counts: StitchInfo['counts'] = {};
  const shapes: ShapeOutline[] = [];
  let worst: ShapeTrust | undefined;
  const rank: Record<ShapeTrust, number> = { kept: 0, good: 1, approximate: 2 };
  let stroke = true;
  let depth: number | undefined;
  for (const o of [...ui.selectedObjects].sort((a, b) => a - b)) {
    const obj = q.objects[o];
    if (!obj) continue;
    const seen = new Set<string>();
    const an = analyze(p, obj, q.kinds);
    for (const [j, pt] of an.parts.entries()) {
      // A run between two fill pieces is travel inside the fill, not a run of its own.
      if (pt.kind === 'run' && an.parts[j - 1]?.kind === 'fill' && an.parts[j + 1]?.kind === 'fill' && !an.parts[j + 1].border) continue;
      if (!seen.has(pt.kind)) counts[pt.kind] = (counts[pt.kind] ?? 0) + 1;
      seen.add(pt.kind);
      if (pt.kind === 'fill') measured.fill ??= remembered(p, obj)?.fill ?? measureFill(p, an);
      else if (pt.kind === 'satin') measured.satin ??= remembered(p, obj)?.satin ?? measureSatin(p, pt, q.kinds);
      else measured.run ??= measureRun(p, pt);
    }
    if (an.fill) {
      const trust = shapeTrust(p, obj, an, (remembered(p, obj)?.fill ?? measureFill(p, an)).spacing);
      if (!worst || rank[trust] > rank[worst]) worst = trust;
      shapes.push({ lines: outline(an.fill), approximate: trust === 'approximate', resting: !!remembered(p, obj)?.free });
      let deep = 0;
      for (const v of an.fill.sdf) if (-v > deep) deep = -v;
      depth = Math.min(depth ?? Infinity, deep);
      // Satin needs a stroke: narrow, about even in width (the same test as in Image mode).
      if (stroke && an.parts.some((pt) => pt.kind === 'fill')) stroke = !!isStroke(remembered(p, obj)?.shape ?? an.fill, SATIN_MAX);
    }
  }
  const hand = [...ui.selectedObjects].reduce((a, o) => a + (q.objects[o] ? (remembered(p, q.objects[o])?.hand ?? 0) : 0), 0);
  const firstFill = [...ui.selectedObjects].sort((a, b) => a - b).find((o) => q.objects[o]?.kind === 'fill') ?? [...ui.selectedObjects][0];
  // Fills with curves can leave out what lies on top.
  const shaped = [...ui.selectedObjects].map((o) => q.objects[o]).filter((obj) => obj && remembered(p, obj)?.form);
  const ons = new Set(shaped.map((obj) => !!remembered(p, obj)?.knockout));
  const knockout: StitchInfo['knockout'] = shaped.length
    ? { on: ons.size > 1 ? 'mixed' : ons.has(true), covered: shaped.some((obj) => isCovered(p, q.objects, obj)), share: remembered(p, shaped[0])?.overlapShare ?? SATIN_SHARE }
    : undefined;
  const locks = new Set([...ui.selectedObjects].map((o) => !!(q.objects[o] && remembered(p, q.objects[o])?.lock)));
  const lock = locks.size > 1 ? 'mixed' : locks.has(true);
  const free = freeOf(p, q);
  const fixed = ui.selectedObjects.size === 1 && q.objects[[...ui.selectedObjects][0]] ? remembered(p, q.objects[[...ui.selectedObjects][0]])?.fixed : undefined;
  const firstOf = (k: string) => [...ui.selectedObjects].sort((a, b) => a - b).map((o) => q.objects[o]).find((obj) => obj?.kind === k);
  const fillObj = firstOf('fill');
  const fabricPull = {
    fill: fillObj ? pullFor(settings.profile, 'fill', analyze(p, fillObj, q.kinds).fill?.areaMm2).edge : undefined,
    satin: pullFor(settings.profile, 'satin'),
  };
  const info: StitchInfo = { key: ui.selectionKey, lock, free, fixed, fabricPull, hand, measured, counts, recommended: recommendedSpacing(settings.profile), shape: worst, outlines: shapes, toSatin: stroke, knockout, depth, color: q.objects[firstFill]?.color };
  const runs = [...ui.selectedObjects].map((o) => q.objects[o]).filter((obj) => obj?.kind === 'run');
  if (runs.length && runs.every((obj) => remembered(p, obj)?.path)) info.line = true;
  const one = ui.selectedObjects.size === 1 ? q.objects[[...ui.selectedObjects][0]] : undefined;
  if (one && isLineObject(p, one)) info.path = { st: lineSettings(p, one, q.kinds), traced: !remembered(p, one)?.path };
  if (one && remembered(p, one)?.asLine) info.asLine = true;
  const link = ui.selectedObjects.size === 1 && q.objects[firstFill] ? remembered(p, q.objects[firstFill])?.outline : undefined;
  if (link) {
    const fill = q.objects.findIndex((o) => remembered(p, o)?.fill?.border?.link === link);
    info.outline = { fill: fill >= 0 ? fill : null };
  }
  ui.stitchCache = { p, key: ui.selectionKey, info };
  return info;
}

/** Whether an object has a shape of its own its stitches can be loosed from (and sewn from again). */
const loosable = (m: Remembered | undefined): boolean => !!m && !m.read && !m.lettering && !m.outline && !!(m.region || m.form || m.path || m.columns);

/**
 * The selected objects loosed from their shape (`on`), or sewn from their resting shape again with
 * their own settings. The stitches loosed stay loosed for undo.
 */
function looseObjects(on: boolean): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p) return;
  const q = seq(p);
  const objs = [...ui.selectedObjects].sort((a, b) => a - b).flatMap((o) => (q.objects[o] ? [q.objects[o]] : []));
  if (on) {
    let n = 0;
    for (const obj of objs) {
      const mem = remembered(p, obj);
      if (!mem || mem.free || !loosable(mem)) continue;
      remember(p, obj, { ...mem, free: true });
      n++;
    }
    if (!n) return;
    closeRungs();
    files.setObjects(f, rememberedIn(p, q.objects));
    ui.selectionKey++;
    ui.stitchCache = null;
    layers.say(t('free.done', { n }));
    return redraw();
  }
  const freed = objs.flatMap((obj) => {
    const mem = remembered(p, obj);
    return mem?.free ? [{ obj, mem }] : [];
  });
  if (!freed.length) return;
  for (const { obj, mem } of freed) remember(p, obj, { ...mem, free: undefined });
  const r = restitch(p, q.objects, freed.map((x) => x.obj.index), (o) => currentSettings(p, o, q.kinds), q.kinds, settings.trimMm);
  // The loosed stitches stay loosed: undo brings them back as they were.
  for (const { obj, mem } of freed) remember(p, obj, mem);
  applyRestitched(r, 'free.failed', true);
}

/** Whether the selected objects' stitches are loosed from their shape, and whether any can be. */
function freeOf(p: Pattern, q: Sequence): StitchInfo['free'] {
  const mems = [...ui.selectedObjects].map((o) => (q.objects[o] ? remembered(p, q.objects[o]) : undefined));
  const frees = new Set(mems.map((m) => !!m?.free));
  return { on: frees.size > 1 ? 'mixed' : frees.has(true), can: mems.some(loosable) };
}

/** The active pattern with new stitches for the selected objects. */
function restitched(s: RestitchSettings) {
  const p = files.active?.pattern;
  if (!p || !ui.selectedObjects.size) return null;
  const q = seq(p);
  return restitch(p, q.objects, [...ui.selectedObjects].sort((a, b) => a - b), s, q.kinds, settings.trimMm);
}

/**
 * Takes over new stitches for the selected objects; `failed` is said for objects left as they
 * were. With `remeasure` (another kind of stitch), the panel measures the objects again.
 */
function applyRestitched(r: RestitchResult | null, failed: Key, remeasure = false): void {
  const f = files.active;
  ui.flowPreview = null;
  if (!f || !r) return redraw();
  const say = () => {
    if (r.failed.length) layers.say(t(failed, { n: r.failed.length }), true);
  };
  if (!r.starts.length) {
    // Nothing could be sewn this way: the panel goes back to what the objects have.
    ui.selectionKey++;
    say();
    return redraw();
  }
  const key = ui.selectionKey;
  // Each object stays one, also where its new stitches are trimmed inside.
  r.starts.forEach((a, k) => rememberObjects(r.pattern, [a], r.ends[k]));
  // The same objects stay selected (found by their first stitch), and the settings stay as set.
  const nq = seq(r.pattern);
  // An object can come out in several pieces (new trims inside): all of them stay selected.
  const sel = new Set<number>();
  r.starts.forEach((a, k) => {
    const pieces = new Set<number>();
    for (let n = a + 1; n <= r.ends[k]; n++) {
      const o = nq.objectAt[recordOfStitch(nq.numbers, n)];
      if (o >= 0) pieces.add(o);
    }
    for (const o of pieces) sel.add(o);
    // An object that stayed one keeps its shape and settings for the next edit.
    if (pieces.size === 1) remember(r.pattern, nq.objects[[...pieces][0]], r.memory[k]);
  });
  // What the objects remember can change their kind (a fill with a satin border).
  seqCache.delete(r.pattern);
  // Borders in a thread of their own follow their fills; the selection is found again by its stitches.
  const p = syncBorders(r.pattern, settings.trimMm, dropLinks);
  dropLinks = new Set();
  let selNow = sel;
  if (p !== r.pattern) {
    const keys = new Set([...sel].map((o) => objectKey(r.pattern, nq.objects[o])));
    const pq = seq(p);
    selNow = new Set(pq.objects.flatMap((o, i) => (keys.has(objectKey(p, o)) ? [i] : [])));
  }
  applyEdit(p);
  files.setObjects(f, rememberedIn(p, seq(p).objects));
  if (selNow.size) ui.selectedObjects = selNow;
  ui.selectionKey = remeasure ? key + 1 : key;
  // New stitches have a shape they can be loosed from.
  ui.stitchCache = ui.stitchCache && !remeasure && p === r.pattern ? { ...ui.stitchCache, p, info: { ...ui.stitchCache.info, free: freeOf(p, seq(p)) } } : null;
  say();
  redraw();
}

/** Links of borders in their own thread that the next new stitches may take away (their fill was changed). */
let dropLinks: ReadonlySet<string> = new Set();

/** Settings to start from when the selected objects change from one kind of stitch to the other. */
function convertSettings(to: 'fill' | 'satin', info: StitchInfo): RestitchSettings | null {
  if (to === 'satin') {
    const f = info.measured.fill;
    if (!f) return null;
    return { kind: 'satin', s: { spacing: f.spacing, edge: digitizeDefaults(settings.profile).pull, short: true, underlay: f.underlay, tolerance: f.tolerance } };
  }
  const s = info.measured.satin;
  if (!s) return null;
  const spacing = s.spacing;
  return { kind: 'fill', s: { pattern: 'tatami', spacing, spacingEnd: Math.min(1.2, Math.round(spacing * 250) / 100), offset: 0.25, angle: NaN, stitch: 4, underlay: s.underlay, edge: 0, tolerance: s.tolerance } };
}

const stitchPanel = new StitchPanel($('object-stitches'), {
  preview: (s) => {
    previewResult = s ? restitched(s) : null;
    ui.flowPreview = previewResult?.pattern ?? null;
    redraw();
  },
  apply: (s) => {
    const pat = s.kind === 'fill' ? s.s.pattern : null;
    const p = files.active?.pattern;
    if (p) {
      const q = seq(p);
      dropLinks = new Set([...ui.selectedObjects].flatMap((o) => (q.objects[o] ? [remembered(p, q.objects[o])?.fill?.border?.link ?? ''] : [])).filter(Boolean));
    }
    applyRestitched(restitched(s), pat === 'spiral' ? 'stitch.failedSpiral' : pat === 'contour' || pat === 'follow' ? 'stitch.failedCurved' : pat === 'guided' ? 'stitch.guide.failed' : 'stitch.failed');
  },
  convert: (to) => {
    const p = files.active?.pattern;
    if (!p || !ui.selectedObjects.size) return;
    const one = ui.selectedObjects.size === 1 ? [...ui.selectedObjects][0] : -1;
    // A wide line: as a fill of its area, and back to the line it was.
    if (to === 'line') {
      if (one >= 0) sewLineAgain(one);
      return;
    }
    if (to === 'fill' && one >= 0 && remembered(p, seq(p).objects[one])?.path) {
      const d = digitizeDefaults(settings.profile);
      const fill = { pattern: 'tatami' as const, spacing: d.spacing, spacingEnd: Math.min(1.2, Math.round(d.spacing * 250) / 100), offset: 0.25, angle: NaN, stitch: d.stitch, underlay: d.underlay, edge: 0, tolerance: d.tolerance };
      const r = lineToFill(p, one, fill, settings.trimMm);
      applyRestitched(r, 'stitch.failed', true);
      if (r?.starts.length) layers.say(t('stitch.lineFilled'));
      return;
    }
    const s = convertSettings(to, stitchInfo(p, seq(p)));
    if (!s) return;
    const q = seq(p);
    const r = restitch(p, q.objects, [...ui.selectedObjects].sort((a, b) => a - b), s, q.kinds, settings.trimMm, to === 'satin' ? 'fill' : 'satin');
    applyRestitched(r, to === 'satin' ? 'stitch.toSatin.failed' : 'stitch.failed', true);
  },
  direction: (a) => {
    if (a === 'tool') return toggleRungs();
    if (!rungTool.active || rungTool.mode !== 'satin') return;
    if (a === 'corners') rungTool.corners();
    else if (a === 'sections') rungTool.sections();
    else if (a === 'even') rungTool.even();
    else rungTool.follow();
  },
  spacingHere: (v) => rungTool.setSpacingHere(v),
  draw: (a) => (a === 'tool' ? toggleRungs() : sewAlongLines()),
  guide: (a) => {
    if (a === 'tool') return toggleGuides();
    if (rungTool.mode === 'guide') closeRungs();
  },
  line: (st, final) => {
    if (ui.selectedObjects.size === 1) sewLine([...ui.selectedObjects][0], null, st, final);
  },
  knockout: (on) => knockoutObjects([...ui.selectedObjects].sort((a, b) => a - b), on),
  overlapShare: (share) => {
    const f = files.active;
    const p = f?.pattern;
    if (!f || !p) return;
    const r = setOverlapShare(p, [...ui.selectedObjects].sort((a, b) => a - b), share, settings.trimMm);
    if (!r) return;
    const sel = ui.selectedObjects;
    if (r.pattern !== p) applyEdit(r.pattern);
    files.setObjects(f, rememberedIn(r.pattern, seq(r.pattern).objects));
    ui.selectedObjects = sel;
    ui.selectionKey++;
    ui.stitchCache = null;
    redraw();
  },
  free: (on) => looseObjects(on),
  lock: (on) => {
    const p = files.active?.pattern;
    if (!p) return;
    const q = seq(p);
    for (const o of ui.selectedObjects) {
      const obj = q.objects[o];
      if (!obj) continue;
      const mem = remembered(p, obj);
      if (!mem && !on) continue;
      remember(p, obj, { ...(mem ?? { region: null }), lock: on || undefined });
    }
    if (files.active) files.setObjects(files.active, rememberedIn(p, q.objects));
    ui.selectionKey++;
    ui.stitchCache = null;
    redraw();
  },
  highlight: (what) => {
    highlight = what;
    redraw();
  },
  outline: (a) => {
    const p = files.active?.pattern;
    if (!p || ui.selectedObjects.size !== 1) return;
    const q = seq(p);
    const own = q.objects[[...ui.selectedObjects][0]];
    const mem = own && remembered(p, own);
    const link = mem?.outline;
    if (!link) return;
    const fill = q.objects.findIndex((o) => remembered(p, o)?.fill?.border?.link === link);
    if (a === 'fill') {
      if (fill >= 0) selectObjects([fill], false);
      layers.reveal([...ui.selectedObjects]);
      return redraw();
    }
    // Its own object from now on: the fill forgets its border, the border its fill.
    const fm = fill >= 0 ? remembered(p, q.objects[fill]) : undefined;
    if (fm?.fill) remember(p, q.objects[fill], { ...fm, fill: { ...fm.fill, border: undefined } });
    remember(p, own, { ...mem, outline: undefined, border: undefined });
    if (files.active) files.setObjects(files.active, rememberedIn(p, q.objects));
    ui.selectionKey++;
    ui.stitchCache = null;
    layers.say(t('stitch.outline.detached'));
    redraw();
  },
});

// Rungs -------------------------------------------------------------------------------------------

let rungPattern: Pattern | null = null;

const rungTool = new RungTool({
  change: (columns, final) => {
    if (final) applyRungs(columns);
    else if (!rungFrame) {
      rungFrame = requestAnimationFrame(() => {
        rungFrame = 0;
        ui.flowPreview = rungTool.active ? (withRungs(rungTool.mode === 'satin' ? pendingColumns : null)?.pattern ?? null) : null;
        redraw();
      });
    }
    if (!final) pendingColumns = columns;
  },
  lines: () => redraw(),
  guides: (g) => stitchPanel.setGuides(g),
  redraw: () => redraw(),
  say: (key) => {
    layers.say(t(key), true);
    redraw();
  },
});
let rungFrame = 0;
let pendingColumns: Rails[][] | null = null;

/** The one selected object, if the rung tool can work on it: a satin with columns, or a fill with an area. */
function rungTarget(p: Pattern, q: Sequence): { o: number; mode: 'satin' | 'fill' } | null {
  if (settings.mode !== 'flow' || ui.selectedObjects.size !== 1) return null;
  const o = [...ui.selectedObjects][0];
  const obj = q.objects[o];
  if (!obj) return null;
  const an = analyze(p, obj, q.kinds);
  if (an.parts.some((pt) => pt.kind === 'satin')) return { o, mode: 'satin' };
  if (an.fill) return { o, mode: 'fill' };
  return null;
}

/** What the stitch panel shows about the rung tool. */
function rungInfo(p: Pattern, q: Sequence): Pick<StitchInfo, 'direction' | 'draw' | 'guide'> {
  const single = ui.selectedObjects.size === 1;
  const on = rungTool.active && ui.rungObject !== null && ui.selectedObjects.has(ui.rungObject);
  const out: Pick<StitchInfo, 'direction' | 'draw' | 'guide'> = {};
  const info = stitchInfo(p, q);
  if (info.measured.satin) {
    let rungs: number | null = null;
    if (on && rungTool.mode === 'satin') rungs = rungTool.count;
    else if (single) {
      const cols = remembered(p, q.objects[[...ui.selectedObjects][0]])?.columns?.flat() ?? [];
      rungs = cols.some((c) => c.rungs) ? cols.reduce((a, c) => a + (c.rungs?.length ?? 0), 0) : null;
    }
    let cuts = 0;
    if (on && rungTool.mode === 'satin') cuts = rungTool.columns.reduce((a, c) => a + c.cuts.length, 0);
    else if (single) cuts = (remembered(p, q.objects[[...ui.selectedObjects][0]])?.columns?.flat() ?? []).reduce((a, c) => a + (c.cuts?.length ?? 0), 0);
    const here = on && rungTool.mode === 'satin' ? rungTool.spacingHere : undefined;
    out.direction = { tool: on && rungTool.mode === 'satin', rungs, single, cuts, ...(here !== undefined ? { spacingHere: here } : {}) };
  }
  if (info.measured.fill && !info.measured.satin) out.draw = { tool: on && rungTool.mode === 'fill', lines: on ? rungTool.lines.length : 0, single };
  if (info.measured.fill) out.guide = { tool: on && rungTool.mode === 'guide', single };
  return out;
}

/** Outline of the one selected object's fill (its longest loop), or null when it has no fill. */
function fillLoop(p: Pattern, q: Sequence, o: number): Pt[] | null {
  const obj = q.objects[o];
  const an = obj && analyze(p, obj, q.kinds);
  if (!an?.fill) return null;
  const area = remembered(p, obj)?.shape ?? an.fill;
  const loops = outline(area);
  return loops.reduce((a, b) => (b.length > a.length ? b : a), [] as [number, number][]) as Pt[];
}

/** The guide line tool on or off for the one selected fill (key G). */
function toggleGuides(): void {
  if (rungTool.active) {
    const was = rungTool.mode;
    closeRungs();
    if (was === 'guide') return;
  }
  const p = files.active?.pattern;
  if (!p || settings.mode !== 'flow' || ui.selectedObjects.size !== 1) return;
  const q = seq(p);
  const o = [...ui.selectedObjects][0];
  const loop = fillLoop(p, q, o);
  if (!loop) return;
  if (editor.active) setEditing(false);
  rungTool.openGuides(loop, remembered(p, q.objects[o])?.fill?.guides ?? []);
  ui.rungObject = o;
  rungPattern = p;
  stage.classList.add('rungs');
  redraw();
}

/** The rung tool on or off for the selected object (key R). */
function toggleRungs(): void {
  if (rungTool.active) return closeRungs();
  const p = files.active?.pattern;
  if (!p) return;
  const q = seq(p);
  const target = rungTarget(p, q);
  if (!target) return;
  if (editor.active) setEditing(false);
  const obj = q.objects[target.o];
  if (target.mode === 'satin') {
    const columns = keepShape(p, obj, q.kinds).columns;
    if (!columns?.length) return layers.say(t('stitch.direction.miss'), true);
    rungTool.openSatin(columns);
  } else {
    const an = analyze(p, obj, q.kinds);
    const area = remembered(p, obj)?.shape ?? an.fill;
    if (!area) return;
    // The longest outline is the outside; holes are covered by the satin anyway.
    const loops = outline(area);
    const loop = loops.reduce((a, b) => (b.length > a.length ? b : a), [] as [number, number][]);
    rungTool.openFill(loop as Pt[]);
  }
  ui.rungObject = target.o;
  rungPattern = p;
  stage.classList.add('rungs');
  redraw();
}

function closeRungs(): void {
  if (!rungTool.active) return;
  rungTool.close();
  ui.rungObject = null;
  rungPattern = null;
  pendingColumns = null;
  ui.flowPreview = null;
  stage.classList.remove('rungs');
  redraw();
}

/** Keeps the rung tool on its object: after new stitches its columns are read again; it closes when the object is gone. */
function syncRungs(): void {
  if (!rungTool.active) return;
  const p = files.active?.pattern;
  if (!p || settings.mode !== 'flow' || ui.selectedObjects.size !== 1) return closeRungs();
  if (p === rungPattern) return;
  const q = seq(p);
  const o = [...ui.selectedObjects][0];
  if (rungTool.mode === 'guide') {
    // The fill sewn anew along the guide lines: the tool stays on it.
    if (!q.objects[o] || !fillLoop(p, q, o)) return closeRungs();
    // After an undo the lines are the ones the stitches were made with.
    const guides = remembered(p, q.objects[o])?.fill?.guides;
    if (guides) rungTool.guides = guides.map((g) => g.slice());
    ui.rungObject = o;
    rungPattern = p;
    return;
  }
  const obj = q.objects[o];
  const columns = obj && rungTool.mode === 'satin' ? keepShape(p, obj, q.kinds).columns : null;
  if (!columns?.length) return closeRungs();
  rungTool.setColumns(columns);
  ui.rungObject = o;
  rungPattern = p;
}

/**
 * New stitches for the rung tool's object along `columns` (rails with their rungs), in its own
 * satin settings; with `keep`, the columns stay remembered for the old stitches (to show them
 * while dragging, they are put back).
 */
function withRungs(columns: Rails[][] | null, keep = false) {
  const p = files.active?.pattern;
  if (!p || ui.rungObject === null || !columns) return null;
  const q = seq(p);
  const obj = q.objects[ui.rungObject];
  if (!obj) return null;
  const before = remembered(p, obj);
  const shape = keepShape(p, obj, q.kinds);
  remember(p, obj, { ...shape, columns, read: false });
  const r = restitch(
    p,
    q.objects,
    [ui.rungObject],
    (_o, an, known) => {
      const part = an.parts.find((pt) => pt.kind === 'satin');
      return part ? { kind: 'satin', s: known?.satin ?? measureSatin(p, part, q.kinds) } : null;
    },
    q.kinds,
    settings.trimMm,
  );
  if (!keep || !r.starts.length) forget(p, obj, before);
  return r;
}

function applyRungs(columns: Rails[][]): void {
  pendingColumns = null;
  cancelAnimationFrame(rungFrame);
  rungFrame = 0;
  applyRestitched(withRungs(columns, true), 'stitch.failed');
}

/** Sews the selected fill as satin along the lines drawn across it. */
function sewAlongLines(): void {
  const p = files.active?.pattern;
  if (!p || ui.rungObject === null || rungTool.mode !== 'fill') return;
  const q = seq(p);
  const obj = q.objects[ui.rungObject];
  const an = obj && analyze(p, obj, q.kinds);
  const area = an && (remembered(p, obj)?.shape ?? an.fill);
  if (!area) return;
  const loops = outline(area);
  const loop = loops.reduce((a, b) => (b.length > a.length ? b : a), [] as [number, number][]) as Pt[];
  const rails = railsFromOutline(loop, rungTool.lines);
  if (!rails) return layers.say(t('stitch.draw.notStrip'), true);
  const s = convertSettings('satin', stitchInfo(p, q));
  if (!s) return;
  const o = ui.rungObject;
  closeRungs();
  const r = restitch(p, q.objects, [o], s, q.kinds, settings.trimMm, 'fill', false, new Map([[o, [rails]]]));
  applyRestitched(r, 'stitch.toSatin.failed', true);
}

// Shapes and the frame ---------------------------------------------------------------------------

const shapeTool = new ShapeTool({
  change: (form) => commitShape(form),
  redraw: () => redraw(),
  say: (key) => {
    layers.say(t(key), true);
    redraw();
  },
});

/**
 * Objects sewn along a line: drawn or SVG lines (their curves are known) and running stitches of a
 * file (their curve is traced); not the borders of fills and not letters.
 */
function isLineObject(p: Pattern, o: SewObject): boolean {
  const m = remembered(p, o);
  if (m?.path) return true;
  return o.kind === 'run' && !m?.outline && !m?.lettering;
}

/** The one selected object of the Ablauf mode, when it has a fill whose outline can be edited, or is a line. */
function shapeTarget(p: Pattern, q: Sequence, o: number): Form | null {
  const obj = q.objects[o];
  // Stitches loosed from their shape are edited as stitches; the shape rests.
  if (!obj || remembered(p, obj)?.free) return null;
  return isLineObject(p, obj) ? lineOf(p, obj, q.kinds) : formOf(p, obj, q.kinds);
}

/**
 * Line `o` sewn anew along `path` with `st` (one undo step), or only shown while settings are
 * being changed (`final` false).
 */
function sewLine(o: number, path: Form | null, st: PathStitch | null, final: boolean): boolean {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p) return false;
  const q = seq(p);
  const obj = q.objects[o];
  if (!obj) return false;
  const line = path ?? lineOf(p, obj, q.kinds);
  if (!line) return false;
  const r = resewLine(p, o, line, st ?? lineSettings(p, obj, q.kinds), settings.trimMm);
  if (!final) {
    ui.flowPreview = r?.pattern ?? null;
    redraw();
    return !!r;
  }
  ui.flowPreview = null;
  if (!r) {
    layers.say(t('stitch.failed', { n: 1 }), true);
    redraw();
    return false;
  }
  const hand = remembered(p, obj)?.hand ?? 0;
  applyEdit(r.pattern);
  files.setObjects(f, rememberedIn(r.pattern, seq(r.pattern).objects));
  ui.selectedObjects = new Set([o]);
  ui.selectionKey++;
  ui.stitchCache = null;
  if (hand) layers.say(t('shape.handReplaced', { n: formatNumber(hand) }));
  followKnockouts();
  redraw();
  return true;
}

/** A fill that was a wide line sewn as that line again. */
function sewLineAgain(o: number): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p) return;
  const r = fillToLine(p, o, settings.trimMm);
  if (!r) return layers.say(t('stitch.failed', { n: 1 }), true);
  ui.flowPreview = null;
  applyEdit(r.pattern);
  files.setObjects(f, rememberedIn(r.pattern, seq(r.pattern).objects));
  ui.selectedObjects = new Set([o]);
  ui.selectionKey++;
  ui.stitchCache = null;
  followKnockouts();
  redraw();
}

/** Edits the outline of object `o` (level Form); objects without a fill go to their stitches. */
function enterShape(o: number, fit: boolean): void {
  const p = files.active?.pattern;
  if (!p || settings.mode !== 'flow') return;
  const q = seq(p);
  const form = shapeTarget(p, q, o);
  if (!form) return enterObject(o, fit);
  closeRungs();
  if (editor.active) {
    editor.setActive(false);
    ui.editObject = null;
  }
  if (!ui.selectedObjects.has(o) || ui.selectedObjects.size !== 1) selectObjects([o], false);
  shapeTool.open(form);
  ui.shapeObject = o;
  ui.shapePattern = p;
  frameTool.close();
  const obj = q.objects[o];
  if (fit) {
    const w = ((obj.maxX - obj.minX) / 10) * vp.scale;
    const h = ((obj.maxY - obj.minY) / 10) * vp.scale;
    if (Math.max(w / ui.stageW, h / ui.stageH) < 0.4) vp.fit(obj.minX / 10, obj.minY / 10, obj.maxX / 10, obj.maxY / 10, ui.stageW, ui.stageH, 60);
  }
  updateLevel();
  redraw();
}

function closeShape(): void {
  if (!shapeTool.active) return;
  shapeTool.close();
  ui.shapeObject = null;
  ui.shapePattern = null;
  updateLevel();
  redraw();
}

/** Keeps the shape tool on its object after new stitches, undo or redo; it closes when the object has no fill any more. */
function syncShape(): void {
  if (!shapeTool.active) return;
  const p = files.active?.pattern;
  if (!p || settings.mode !== 'flow' || ui.selectedObjects.size !== 1) return closeShape();
  if (p === ui.shapePattern) return;
  const q = seq(p);
  const o = [...ui.selectedObjects][0];
  const form = shapeTarget(p, q, o);
  if (!form) return closeShape();
  shapeTool.setForm(form);
  ui.shapeObject = o;
  ui.shapePattern = p;
}

/** The fill sewn anew in its changed outline (one undo step). */
function commitShape(form: Form): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p || ui.shapeObject === null) return;
  const q = seq(p);
  const obj = q.objects[ui.shapeObject];
  if (!obj) return;
  if (isLineObject(p, obj)) {
    if (!sewLine(ui.shapeObject, form, null, true)) shapeTool.setForm(shapeTarget(p, q, ui.shapeObject) ?? form);
    return;
  }
  const hand = remembered(p, obj)?.hand ?? 0;
  const r = reshapeFill(p, q.objects, obj, q.kinds, form, settings.trimMm);
  if (!r || !r.starts.length) {
    // Nothing to fill there (too small, or the outline crosses itself away): back to the old one.
    shapeTool.setForm(shapeTarget(p, q, ui.shapeObject) ?? form);
    layers.say(t('shape.failed'), true);
    return redraw();
  }
  applyRestitched(r, 'shape.failed', true);
  if (hand) layers.say(t('shape.handReplaced', { n: formatNumber(hand) }));
  followKnockouts();
}

/**
 * After shapes changed: fills that leave out what lies on top are sewn anew where that changed, in
 * the same undo step as the change.
 */
function followKnockouts(): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p) return;
  const r = refreshKnockouts(p, settings.trimMm);
  if (!r) return;
  const sel = ui.selectedObjects;
  files.setPattern(f, r.pattern, { record: false });
  syncPlayer();
  recompute();
  files.setObjects(f, rememberedIn(r.pattern, seq(r.pattern).objects));
  ui.selectedObjects = sel;
  ui.selectionKey++;
  const q = seq(r.pattern);
  layers.say(t('knockout.followed', { list: r.changed.map((o) => (q.objects[o] ? objectName(q, o) : '')).filter(Boolean).join(', ') }));
  redraw();
}

// Objects as shapes: delete, duplicate, mirror, cut out ------------------------

/** Takes over a pattern made from the objects, selecting `select` in it. */
function takeShapes(next: Pattern, select: number[]): void {
  const f = files.active;
  if (!f) return;
  applyEdit(next);
  files.setObjects(f, rememberedIn(next, seq(next).objects));
  ui.selectedObjects = new Set(select);
  ui.selectionKey++;
  followKnockouts();
  redraw();
}

function deleteSelected(): void {
  const p = files.active?.pattern;
  const sel = frameObjects();
  if (!p || !sel.length) return;
  const next = deleteObjects(p, sel, settings.trimMm);
  if (!next) return layers.say(t('object.deleteLast'), true);
  takeShapes(next, []);
  layers.say(sel.length === 1 ? t('object.deleted.one') : t('object.deleted', { n: sel.length }));
}

function duplicateSelected(): void {
  const p = files.active?.pattern;
  const sel = frameObjects();
  if (!p || sel.length !== 1) return;
  const r = duplicateObject(p, sel[0], settings.trimMm);
  if (!r) return layers.say(t('frame.failed'), true);
  takeShapes(r.pattern, [r.index]);
  layers.say(t('object.duplicated'));
}

function mirrorSelected(axis: 'x' | 'y'): void {
  const p = files.active?.pattern;
  const sel = frameObjects();
  if (!p || !sel.length) return;
  const objs = sel.map((o) => seq(p).objects[o]);
  const box = {
    minX: Math.min(...objs.map((o) => o.minX)) / 10,
    minY: Math.min(...objs.map((o) => o.minY)) / 10,
    maxX: Math.max(...objs.map((o) => o.maxX)) / 10,
    maxY: Math.max(...objs.map((o) => o.maxY)) / 10,
  };
  commitTransform(mirrorMatrix(axis, box));
  layers.say(t('object.mirrored'));
}

function subtractSelected(): void {
  const p = files.active?.pattern;
  const sel = frameObjects();
  if (!p || sel.length < 2) return;
  const r = subtractTop(p, sel, settings.trimMm);
  if (!r) return layers.say(t('object.subtract.nothing'), true);
  takeShapes(r.pattern, r.cut);
  const q = seq(r.pattern);
  const list = r.cut.map((o) => (q.objects[o] ? objectName(q, o) : '')).filter(Boolean).join(', ');
  layers.say([list ? t('object.subtracted', { list }) : '', r.covered ? t('object.subtracted.covered') : ''].filter(Boolean).join(' '));
}

// Shapes not sewn: switched off or guides ---------------------------------------

const asidePanel = new AsidePanel({
  sew: (id) => {
    const p = files.active?.pattern;
    if (!p) return;
    const r = sewAgain(p, id, { ...digitizeDefaults(settings.profile), trimMm: settings.trimMm });
    if (!r) return layers.say(t('aside.failed'), true);
    const mine = seq(r.pattern).objects.findIndex((o) => stitchesBefore(r.pattern, o.first) === r.start);
    ui.hoverAside = null;
    takeShapes(r.pattern, mine >= 0 ? [mine] : []);
    layers.say(t('aside.done.sewn'));
  },
  role: (id, role) => {
    const p = files.active?.pattern;
    const next = p && setAsideRole(p, id, role);
    if (next) applyEdit(next);
  },
  drop: (id) => {
    const p = files.active?.pattern;
    const next = p && dropAside(p, id);
    if (!next) return;
    ui.hoverAside = null;
    applyEdit(next);
    layers.say(t('aside.done.dropped'));
  },
  hover: (id) => {
    if (ui.hoverAside === id) return;
    ui.hoverAside = id;
    redraw();
  },
});

/** The selected objects kept, but not sewn. */
function putAside(role: AsideRole): void {
  const p = files.active?.pattern;
  const sel = frameObjects();
  if (!p || !sel.length) return;
  const next = setAside(p, sel, role, settings.trimMm);
  if (!next) return layers.say(t('aside.last'), true);
  takeShapes(next, []);
  const one = sel.length === 1;
  layers.say(role === 'guide' ? (one ? t('aside.done.guide') : t('aside.done.guideMany', { n: sel.length })) : one ? t('aside.done.off') : t('aside.done.offMany', { n: sel.length }));
}

// Drawing new shapes ---------------------------------------------------------

/** A thread for the first shape of a new design: a Brother orange, clear on dark and light fabric. */
const FIRST_THREAD: ThreadColor = nearestThread(rgbToLab(240, 140, 40)).thread;

const drawTool = new DrawTool({ done: (s) => void drawn(s), redraw });
const drawButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-draw]')];

/** Picks a drawing tool, or none. */
function setDrawing(kind: DrawKind | null): void {
  if (kind && settings.mode !== 'flow') return;
  if (kind) {
    if (editor.active) setEditing(false);
    if (shapeTool.active) closeShape();
    if (rungTool.active) closeRungs();
    if (ui.letterMode) setLetterMode(false);
  }
  drawTool.start(kind);
  for (const b of drawButtons) b.setAttribute('aria-pressed', String(b.dataset.draw === kind));
  stage.classList.toggle('drawing', !!kind);
  updateLevel();
  redraw();
}
drawButtons.forEach((b) => b.addEventListener('click', () => setDrawing(drawTool.kind === b.dataset.draw ? null : (b.dataset.draw as DrawKind))));

/** A shape is drawn: sewn in the thread of the selected object right after it, else after the last one. */
/** No stitches yet. */
const EMPTY: Pattern = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as unknown as Pattern;

/** The first shape of a new design; a line keeps its curves to be sewn along. */
function firstShape(shape: NewShape, options: ReturnType<typeof digitizeDefaults> & { trimMm: number }): Digitized | null {
  const line = shape.kind === 'stroke' ? addShape(EMPTY, shape, FIRST_THREAD, null, options) : null;
  if (line) return { pattern: line.pattern, objects: [{ kind: 'run', label: 0, areaMm2: 0, path: shape.form }], starts: [0] };
  const d = digitizeShapes([{ color: 0, ...shape }], [FIRST_THREAD], options, { w: 0, h: 0 }, false, 'shape');
  return d.objects.length ? d : null;
}

async function drawn(shape: NewShape): Promise<void> {
  const f = files.active;
  const p = f?.pattern ?? null;
  const options = { ...digitizeDefaults(settings.profile), trimMm: settings.trimMm };
  if (!f || !p) {
    // Nothing open yet: the shape starts a new design.
    const d = firstShape(shape, options);
    if (!d) return layers.say(t('draw.failed'), true);
    ui.keepView = true;
    await addDigitized(d, t('draw.newName'));
    ui.keepView = false;
    selectObjects([0], false);
    return;
  }
  const q = seq(p);
  const sel = [...ui.selectedObjects].sort((a, b) => a - b);
  const after = sel.length ? sel[sel.length - 1] : q.objects.length ? q.objects.length - 1 : null;
  const color = after !== null ? q.objects[after].color : FIRST_THREAD;
  const r = addShape(p, shape, color, after, options);
  if (!r) return layers.say(t('draw.failed'), true);
  applyEdit(r.pattern);
  files.setObjects(f, rememberedIn(r.pattern, seq(r.pattern).objects));
  const nq = seq(r.pattern);
  const mine = nq.objects.findIndex((o) => stitchesBefore(r.pattern, o.first) === r.start);
  followKnockouts();
  if (mine >= 0) selectObjects([mine], false);
  layers.say(t(shape.kind === 'fill' ? 'draw.done.fill' : 'draw.done.line'));
  redraw();
}

// The card that offers leaving out what lies on top, when shapes overlap (never done unasked).
let overlapCache: { p: Pattern; list: number[] } | null = null;
/** Files whose overlaps the user chose to keep as they are. */
const overlapKept = new WeakSet<object>();

function overlapping(p: Pattern): number[] {
  if (overlapCache?.p !== p) overlapCache = { p, list: overlapsIn(p, seq(p).objects) };
  return overlapCache.list;
}

function updateOverlapCard(): void {
  const f = files.active;
  const p = f?.pattern;
  const list = f && p && settings.mode === 'flow' && !overlapKept.has(f) && !shapeTool.active ? overlapping(p) : [];
  const card = $('overlap-card');
  card.hidden = !list.length;
  if (list.length) $('overlap-text').textContent = t(list.length === 1 ? 'knockout.card.one' : 'knockout.card', { n: formatNumber(list.length) });
}

$('overlap-cut').addEventListener('click', () => {
  const p = files.active?.pattern;
  if (p) knockoutObjects(overlapping(p), true);
});
$('overlap-keep').addEventListener('click', () => {
  if (files.active) overlapKept.add(files.active);
  layers.say(t('knockout.card.kept'));
  redraw();
});

/** Turns leaving out what lies on top on or off for the objects `which`, as one undo step. */
function knockoutObjects(which: number[], on: boolean): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p) return;
  const r = setKnockout(p, which, on, settings.trimMm);
  if (!r) return;
  const sel = ui.selectedObjects;
  applyEdit(r.pattern);
  files.setObjects(f, rememberedIn(r.pattern, seq(r.pattern).objects));
  ui.selectedObjects = sel;
  ui.selectionKey++;
  layers.say(t(on ? 'knockout.done' : 'knockout.undone', { n: formatNumber(r.changed) }) + ' ' + t('object.undo'));
  redraw();
}

// The frame around the one selected object (level Objects): move, turn, scale.
let frameFrame = 0;
let pendingFrame: Mat | null = null;

const frameTool = new FrameTool({
  change: (m, final) => {
    if (final) {
      pendingFrame = null;
      cancelAnimationFrame(frameFrame);
      frameFrame = 0;
      ui.flowPreview = null;
      return commitTransform(m);
    }
    pendingFrame = m;
    if (frameFrame) return;
    frameFrame = requestAnimationFrame(() => {
      frameFrame = 0;
      const p = files.active?.pattern;
      // The stitches dragged along as they are; scaling sews them anew when let go. The last
      // object first, so the records of the ones before stay where they are.
      let next = p ?? null;
      if (p && pendingFrame) for (const o of frameObjects().reverse()) next = transformObject(next!, seq(p).objects[o], pendingFrame).pattern;
      ui.flowPreview = next !== p ? next : null;
      redraw();
    });
  },
});

/** The objects the frame is on: the selected ones in the Ablauf mode, level Objects (in sewing order). */
function frameObjects(): number[] {
  if (settings.mode !== 'flow' || !ui.selectedObjects.size || editor.active || shapeTool.active || rungTool.active || orderCard.isOpen || ui.letterMode) return [];
  const n = files.active?.pattern ? seq(files.active.pattern).objects.length : 0;
  return [...ui.selectedObjects].filter((o) => o < n).sort((a, b) => a - b);
}

/** Puts the frame around the selected objects (or takes it away). */
let frameKey: { p: Pattern; sel: ReadonlySet<number> } | null = null;
function syncFrame(): void {
  const p = files.active?.pattern;
  const sel = frameObjects();
  if (!p || !sel.length) {
    if (frameTool.active) frameTool.close();
    frameKey = null;
    return;
  }
  if (frameTool.dragging !== null || (frameTool.active && frameKey?.p === p && frameKey.sel === ui.selectedObjects)) return;
  frameKey = { p, sel: ui.selectedObjects };
  const q = seq(p);
  const objs = sel.map((o) => q.objects[o]);
  const box = {
    minX: Math.min(...objs.map((o) => o.minX)) / 10,
    minY: Math.min(...objs.map((o) => o.minY)) / 10,
    maxX: Math.max(...objs.map((o) => o.maxX)) / 10,
    maxY: Math.max(...objs.map((o) => o.maxY)) / 10,
  };
  frameTool.open(box, objs.every((o) => scaleBlocked(p, o, q.kinds) === null));
}

/** The selected objects moved, turned or scaled by `m` together (one undo step). */
function commitTransform(m: Mat): void {
  const f = files.active;
  const p = f?.pattern;
  const sel = frameObjects();
  if (!f || !p || !sel.length) return redraw();
  // A lettering keeps its text: it is set anew where the frame put it.
  if (ui.lettering) return transformLettering(m);
  let cur = p;
  let hand = 0;
  let restitched = false;
  // The last object first: the ones before keep their records. The objects stay as many as they were.
  for (const o of [...sel].reverse()) {
    const q = seq(cur);
    const obj = q.objects[o];
    hand += remembered(cur, obj)?.hand ?? 0;
    const r = obj && transformSewObject(cur, q.objects, obj, q.kinds, m, settings.trimMm);
    if (!r) {
      layers.say(t('frame.failed'), true);
      return redraw();
    }
    restitched ||= r.restitched;
    cur = r.pattern;
  }
  // Borders in a thread of their own go along (sewn anew on the moved area).
  const keys = new Set(sel.map((o) => objectKey(cur, seq(cur).objects[o])));
  const synced = syncBorders(cur, settings.trimMm);
  applyEdit(synced);
  const nq = seq(synced);
  files.setObjects(f, rememberedIn(synced, nq.objects));
  ui.selectedObjects = synced !== cur ? new Set(nq.objects.flatMap((o, i) => (keys.has(objectKey(synced, o)) ? [i] : []))) : nq.objects.length === seq(p).objects.length ? new Set(sel) : new Set();
  ui.selectionKey++;
  if (restitched && hand) layers.say(t('shape.handReplaced', { n: formatNumber(hand) }));
  followKnockouts();
  redraw();
}

// Lettering ---------------------------------------------------------------------------------------

/** The fonts that come with the app (loaded on start, the fonts themselves when first used). */
let catalog: Catalog | null = null;
void loadCatalog()
  .then((c) => {
    catalog = c;
    redraw();
  })
  .catch((err) => console.warn('No font catalog', err));

/** The font a new lettering starts with: the one used last. */
let lastFont = 'barstitch_regular';
/** A red that shows on light and dark fabric alike, for a lettering in a new design. */
const LETTERING_RED: ThreadColor = { r: 237, g: 23, b: 31, name: 'Red', pecIndex: 5 };

const letteringsOf = (p: Pattern, q: Sequence) => (q.letterings ??= q.objects.map((o) => letteringOf(p, o)));

/** The lettering all selected objects belong to, if they do. */
function selectedLettering(p: Pattern, q: Sequence): Lettering | null {
  if (settings.mode !== 'flow' || !ui.selectedObjects.size) return null;
  const all = letteringsOf(p, q);
  let l: Lettering | null = null;
  for (const o of ui.selectedObjects) {
    const x = all[o];
    if (!x || (l && x.id !== l.id)) return null;
    l = x;
  }
  return l;
}

/** Follows the selection: the card is on while a lettering is chosen, with its font loaded. */
function syncLettering(): void {
  const f = files.active;
  const p = f?.pattern;
  const l = p ? selectedLettering(p, seq(p)) : null;
  const was = !!ui.lettering;
  const wasLetters = ui.letterMode;
  if (!l || !f) {
    ui.lettering = null;
    ui.letterMode = false;
    ui.letterAt = null;
  } else if (!ui.lettering || ui.lettering.l.id !== l.id || ui.lettering.f !== f) {
    ui.lettering = { l, f, recorded: false, sewn: JSON.stringify(l) };
    ui.letterMode = false;
    ui.letterAt = null;
  }
  if (ui.lettering && !fontNow(ui.lettering.l.font)) {
    const want = ui.lettering.l.font;
    void loadFont(want)
      .then(() => redraw())
      .catch(() => layers.say(t('lettering.loadFailed'), true));
  }
  if (was !== !!ui.lettering || wasLetters !== ui.letterMode) updateLevel();
}

/** What the card shows about the chosen lettering. */
function letteringInfo(q: Sequence) {
  const objs = [...ui.selectedObjects].map((o) => q.objects[o]).filter(Boolean);
  const l = ui.lettering!.l;
  return {
    lettering: l,
    font: fontNow(l.font) ?? null,
    catalog,
    width: (Math.max(...objs.map((o) => o.maxX)) - Math.min(...objs.map((o) => o.minX))) / 10,
    height: (Math.max(...objs.map((o) => o.maxY)) - Math.min(...objs.map((o) => o.minY))) / 10,
    stitches: objs.reduce((a, o) => a + o.stitches, 0),
    letters: ui.letterMode,
    letter: ui.letterAt,
  };
}

/** Names of lettering objects in the list: the text, numbered when it is sewn in pieces. */
function letteringNames(p: Pattern, q: Sequence): ReadonlyMap<number, string> | undefined {
  if (q.letteringNames?.lang !== getLang()) q.letteringNames = { lang: getLang(), names: namesOf(p, q) };
  return q.letteringNames.names;
}

function namesOf(p: Pattern, q: Sequence): ReadonlyMap<number, string> | undefined {
  const all = letteringsOf(p, q);
  if (!all.some(Boolean)) return undefined;
  const names = new Map<number, string>();
  const pieces = new Map<string, number[]>();
  all.forEach((l, o) => {
    if (l) pieces.set(l.id, [...(pieces.get(l.id) ?? []), o]);
  });
  for (const list of pieces.values()) {
    const l = all[list[0]]!;
    const one = l.text.replace(/\s+/g, ' ').trim();
    const text = one.length > 20 ? `${one.slice(0, 19)}…` : one;
    list.forEach((o, k) => names.set(o, t('lettering.name', { text }) + (list.length > 1 ? ` ${k + 1}` : '')));
  }
  return names;
}

/** A new lettering: under the design (or as a new design), its text selected to type over. */
async function newLettering(): Promise<void> {
  if (settings.mode !== 'flow') setMode('flow');
  if (drawTool.active) setDrawing(null);
  let font;
  try {
    font = await loadFont(lastFont);
  } catch {
    layers.say(t('lettering.loadFailed'), true);
    return;
  }
  const f = files.active;
  const p = f?.pattern ?? null;
  const height = Math.max(font.min * font.cap, Math.min(15, font.max * font.cap));
  const b = p?.bounds;
  const colors = p?.colors ?? [];
  const l: Lettering = {
    ...LETTERING_DEFAULTS,
    id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text: t('lettering.new'),
    font: font.id,
    height: Math.round(height * 2) / 2,
    align: 'center',
    // Under the design, in its last thread (no color change for it).
    x: b ? Math.round((b.minX + b.maxX) / 20) : 0,
    y: b ? Math.round(b.maxY / 10 + 6 + height) : 0,
    color: { ...(colors[colors.length - 1] ?? LETTERING_RED) },
  };
  const sewn = sewLettering(font, l, settings.trimMm);
  if (!f || !p) {
    // A new design of the lettering alone.
    const placed = placeLettering(null, [], sewn, l, t('lettering.title'));
    if (!placed) return;
    const data = writePattern(placed.pattern, 'pes');
    await files.addWithObjects(`${t('lettering.title')}.pes`, data.slice().buffer, rememberedIn(placed.pattern, sewObjects(placed.pattern)));
    const np = files.active?.pattern;
    if (!np) return;
    const nb = np.bounds;
    const cx = (nb.minX + nb.maxX) / 20;
    const cy = (nb.minY + nb.maxY) / 20;
    vp.fit(cx - 50, cy - 35, cx + 50, cy + 35, ui.stageW, ui.stageH);
    ui.selectedObjects = new Set(letteringObjects(np, seq(np).objects, l.id).map((o) => o.index));
  } else {
    const placed = placeLettering(p, [], sewn, l);
    if (!placed) return;
    applyEdit(placed.pattern);
    files.setObjects(f, rememberedIn(placed.pattern, seq(placed.pattern).objects));
    ui.selectedObjects = new Set(placed.objects.map((o) => o.index));
    keepInView(placed.pattern, placed.objects);
  }
  ui.selectionKey++;
  ui.focusText = true;
  layers.reveal([...ui.selectedObjects]);
  redraw();
}
$('lettering-new').addEventListener('click', () => void newLettering());

/**
 * The chosen lettering changed in the card or by the frame: its stitches are made anew in its
 * place. Changes while typing or dragging a slider are one undo step, ended by `final`.
 */
function changeLettering(next: Lettering, final: boolean): void {
  const cur = ui.lettering;
  if (!cur) return;
  // Moved letters stay with their letters when the text changes.
  if (next.text !== cur.l.text && next.letters.length) next = { ...next, letters: followText(cur.l.text, next.text, next.letters) };
  cur.l = next;
  lastFont = next.font;
  const font = fontNow(next.font);
  if (!font) {
    void loadFont(next.font)
      .then(() => {
        if (ui.lettering === cur) sewLetteringNow(cur, final);
      })
      .catch(() => layers.say(t('lettering.loadFailed'), true));
    return redraw();
  }
  sewLetteringNow(cur, final);
}

function sewLetteringNow(cur: NonNullable<typeof ui.lettering>, final: boolean): void {
  const f = cur.f;
  const p = f.pattern;
  const font = fontNow(cur.l.font);
  if (files.active !== f || !p || !font) return;
  const key = JSON.stringify(cur.l);
  if (key === cur.sewn) {
    if (final) cur.recorded = false;
    return redraw();
  }
  const q = seq(p);
  const old = letteringObjects(p, q.objects, cur.l.id);
  const sewn = sewLettering(font, cur.l, settings.trimMm);
  let next: Pattern | null;
  let mine: number[] = [];
  if (sewn.recs.length) {
    const placed = placeLettering(p, old, sewn, cur.l);
    next = placed?.pattern ?? null;
    mine = placed?.objects.map((o) => o.index) ?? [];
  } else {
    // No text: the letters go once the text field is left empty (and come back with undo).
    if (!final) return redraw();
    next = withoutObjects(p, old);
  }
  if (!next) return redraw();
  ui.hoverZone = ui.selectedZone = null;
  files.setPattern(f, next, { record: !cur.recorded });
  cur.recorded = !final;
  cur.sewn = key;
  syncPlayer();
  recompute();
  files.setObjects(f, rememberedIn(next, seq(next).objects));
  ui.selectedObjects = new Set(mine);
  ui.selectionKey++;
  if (final) keepInView(next, mine.map((o) => seq(next).objects[o]));
  redraw();
}

/** Shows the whole design when the lettering went (partly) off the stage, or under the tools. */
function keepInView(p: Pattern, objs: SewObject[]): void {
  if (!objs.length) return;
  const [ax, ay] = vp.toScreen(Math.min(...objs.map((o) => o.minX)) / 10, Math.min(...objs.map((o) => o.minY)) / 10);
  const [bx, by] = vp.toScreen(Math.max(...objs.map((o) => o.maxX)) / 10, Math.max(...objs.map((o) => o.maxY)) / 10);
  if (ax >= 20 && ay >= 60 && bx <= ui.stageW - 20 && by <= ui.stageH - 110) return;
  const b = p.bounds;
  vp.fit(b.minX / 10, b.minY / 10, b.maxX / 10, b.maxY / 10, ui.stageW, ui.stageH);
}

/** The frame moved, turned or scaled the lettering: its place, angle and size follow. */
function transformLettering(m: Mat): void {
  const l = ui.lettering!.l;
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const turn = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const [x, y] = apply(m, [l.x, l.y]);
  const angle = ((((l.angle + turn) % 360) + 540) % 360) - 180;
  const round = (v: number, k = 100) => Math.round(v * k) / k;
  changeLettering(
    {
      ...l,
      x: round(x),
      y: round(y),
      angle: round(angle, 10),
      height: round(l.height * s),
      radius: round(l.radius * s),
      spacing: round(l.spacing * s),
      wordSpacing: round(l.wordSpacing * s),
      letters: l.letters.map((o) => ({ ...o, dx: round(o.dx * s), dy: round(o.dy * s) })),
    },
    true,
  );
}

/** The letters become ordinary objects: they forget their lettering. */
function releaseLettering(): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p || !ui.lettering) return;
  const q = seq(p);
  for (const o of letteringObjects(p, q.objects, ui.lettering.l.id)) {
    const { lettering: _, ...rest } = remembered(p, o)!;
    remember(p, o, rest);
  }
  q.letterings = undefined;
  q.letteringNames = undefined;
  files.setObjects(f, rememberedIn(p, q.objects));
  ui.lettering = null;
  ui.letterMode = false;
  ui.selectionKey++;
  layers.say(t('lettering.released'));
  updateLevel();
  redraw();
}

function setLetterMode(on: boolean): void {
  ui.letterMode = on && !!ui.lettering;
  ui.letterAt = null;
  ui.letterDrag = null;
  updateLevel();
  redraw();
}

const letteringPanel = new LetteringPanel({
  change: (next, final) => changeLettering(next, final),
  close: () => selectObjects([], false),
  letters: (on) => setLetterMode(on),
  release: () => releaseLettering(),
  hoop: () => settings.hoop,
});

/** The letters of the chosen lettering where they are now, or null while its font loads. */
function letterLayout() {
  const font = ui.lettering && fontNow(ui.lettering.l.font);
  return font ? layout(font, ui.lettering!.l) : null;
}

/** The letter whose box contains the point (mm), or null. */
function letterHit(x: number, y: number, pad: number): number | null {
  const lay = letterLayout();
  if (!lay) return null;
  for (const pl of lay.letters) {
    if (!pl.glyph) continue;
    // Inside the (turned) box: on the same side of all four edges.
    const b = pl.box;
    let sign = 0;
    let inside = true;
    for (let k = 0; k < 4 && inside; k++) {
      const [ax, ay] = b[k];
      const [bx, by] = b[(k + 1) % 4];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const c = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len;
      if (Math.abs(c) <= pad) continue;
      if (sign && Math.sign(c) !== sign) inside = false;
      sign = Math.sign(c);
    }
    if (inside) return pl.at;
  }
  return null;
}

/** A letter's offset moved by `wx`, `wy` (mm on the design), turned into the lettering's frame. */
function letterMoved(at: number, dx0: number, dy0: number, wx: number, wy: number, final: boolean): void {
  const l = ui.lettering!.l;
  const r = (-l.angle * Math.PI) / 180;
  const dx = Math.round((dx0 + wx * Math.cos(r) - wy * Math.sin(r)) * 100) / 100;
  const dy = Math.round((dy0 + wx * Math.sin(r) + wy * Math.cos(r)) * 100) / 100;
  const ch = [...l.text][at] ?? '';
  const old = l.letters.find((o) => o.at === at) ?? { at, ch, dx: 0, dy: 0, rot: 0 };
  const rest = l.letters.filter((o) => o.at !== at);
  const moved = { ...old, dx, dy };
  changeLettering({ ...l, letters: moved.dx || moved.dy || moved.rot ? [...rest, moved] : rest }, final);
}

let letterFrame = 0;
let pendingLetter: [number, number] | null = null;

function letterDown(x: number, y: number): boolean {
  const at = letterHit(x, y, 4 / vp.scale);
  if (at === null) return false;
  const o = ui.lettering!.l.letters.find((v) => v.at === at);
  ui.letterDrag = { at, from: [x, y], dx: o?.dx ?? 0, dy: o?.dy ?? 0, moved: false };
  if (ui.letterAt !== at) {
    ui.letterAt = at;
    redraw();
  }
  return true;
}

function letterDragTo(x: number, y: number): boolean {
  const d = ui.letterDrag;
  if (!d) return false;
  if (!d.moved && Math.hypot(x - d.from[0], y - d.from[1]) * vp.scale < 3) return true;
  d.moved = true;
  pendingLetter = [x - d.from[0], y - d.from[1]];
  if (!letterFrame) {
    letterFrame = requestAnimationFrame(() => {
      letterFrame = 0;
      if (ui.letterDrag && pendingLetter) letterMoved(ui.letterDrag.at, ui.letterDrag.dx, ui.letterDrag.dy, ...pendingLetter, false);
    });
  }
  return true;
}

function letterUp(): void {
  const d = ui.letterDrag;
  ui.letterDrag = null;
  cancelAnimationFrame(letterFrame);
  letterFrame = 0;
  if (d?.moved && pendingLetter) letterMoved(d.at, d.dx, d.dy, ...pendingLetter, true);
  pendingLetter = null;
}

/** The letter boxes over the stitches while single letters are moved; the chosen one stands out. */
function drawLetterBoxes(): void {
  const lay = letterLayout();
  if (!lay) return;
  ctx.save();
  ctx.lineWidth = 1;
  for (const pl of lay.letters) {
    if (!pl.glyph) continue;
    const on = pl.at === ui.letterAt;
    ctx.strokeStyle = on ? '#ffd23f' : 'rgba(255, 255, 255, 0.55)';
    ctx.setLineDash(on ? [] : [3, 3]);
    ctx.lineWidth = on ? 1.5 : 1;
    ctx.beginPath();
    pl.box.forEach(([x, y], k) => {
      const [sx, sy] = vp.toScreen(x, y);
      if (k) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

/** Color changes and trims as the statistics count them, travel between objects. */
function orderStats(p: Pattern) {
  const st = patternStats(p);
  return { colorChanges: st.colorChanges, trims: st.trims, travelMm: moveStats(p).travelMm };
}

/**
 * The pattern "Optimize order" found for the active one, kept while its card is open, with the
 * objects sewn from the other side in it (what to remember about their new stitches).
 */
let pendingOrder: { p: Pattern; next: Pattern; reversed: { start: number; end: number; memory: Remembered }[] } | null = null;

/**
 * The best order for `p` with the options of the card. With "Reverse direction", satins and fills
 * may also be sewn from the other side; that plan is taken when its real result (after the new
 * stitches) is better than the best order without it.
 */
function bestOrder(p: Pattern): NonNullable<typeof pendingOrder> | null {
  const q = seq(p);
  const over = overOf(q, p);
  const opts = { ...settings.order, trimMm: settings.trimMm };
  const plain = optimizePlan(p, q.objects, over, opts);
  const plainNext = plain.order.some((o, k) => o !== k) ? reorder(p, q.objects, plain.order, settings.trimMm) : p;
  const best = plainNext === p ? null : { p, next: plainNext, reversed: [] };
  if (!settings.order.reverse) return best;
  const may = q.objects.map((o) => autoReversible(p, o));
  // Objects that turn out not to be reversible (stitches outside their shape) are planned without.
  for (let round = 0; round < 3; round++) {
    const plan = optimizePlan(p, q.objects, over, opts, may);
    if (!plan.flip.length) return best;
    const r = reverseObjects(p, q.objects, plan.flip, q.kinds, settings.trimMm, plan.order);
    if (r.pattern === p) {
      if (!r.failed.length) return best;
      for (const o of r.failed) may[o] = false;
      continue;
    }
    // Taken only for a real saving: the new stitches change more than the order does.
    if (weigh(orderStats(r.pattern)) >= weigh(orderStats(plainNext)) - 2) return best;
    return { p, next: r.pattern, reversed: r.starts.map((start, k) => ({ start, end: r.ends[k], memory: r.memory[k] })) };
  }
  return best;
}

const orderCard = new OrderCard(settings, {
  preview: () => {
    const p = files.active?.pattern;
    if (!p) return null;
    pendingOrder = bestOrder(p);
    const next = pendingOrder?.next ?? p;
    const before = orderStats(p);
    const after = orderStats(next);
    const secs = (x: Pattern, c: typeof before) => sewingSeconds(seq(x).total, c.trims, c.colorChanges, settings.machineSpm);
    return { before, after, beforeSeconds: secs(p, before), afterSeconds: secs(next, after), changed: next !== p, reversed: pendingOrder?.reversed.length ?? 0 };
  },
  apply: () => {
    const f = files.active;
    const p = f?.pattern;
    if (!f || !p || pendingOrder?.p !== p) return;
    const before = orderStats(p);
    const { next, reversed } = pendingOrder;
    pendingOrder = null;
    // Objects sewn anew from the other side remember their shape and settings, as after any new stitches.
    if (reversed.length) {
      const nq = seq(next);
      for (const r of reversed) {
        const o = nq.objectAt[recordOfStitch(nq.numbers, r.start + 1)];
        if (o >= 0) remember(next, nq.objects[o], r.memory);
      }
      files.setObjects(f, rememberedIn(next, nq.objects));
    }
    ui.selectedObjects = new Set();
    ui.hiddenBlocks = new Set();
    ui.focusBlock = null;
    // New stitches need a new density measurement; a new order alone does not.
    applyEdit(next, reversed.length ? undefined : f.measurement);
    const after = orderStats(next);
    const parts: string[] = [];
    const dc = before.colorChanges - after.colorChanges;
    const dt = before.trims - after.trims;
    if (dc > 0) parts.push(t(dc === 1 ? 'order.fewerColors.one' : 'order.fewerColors', { n: dc }));
    if (dt > 0) parts.push(t(dt === 1 ? 'order.fewerTrims.one' : 'order.fewerTrims', { n: dt }));
    if (!parts.length) parts.push(t('order.shorterTravel'));
    layers.say(t('order.applied', { what: parts.join(', ') }));
  },
  cancel: () => {
    pendingOrder = null;
  },
  saved: () => saveSettings(settings),
});

/** Frames the jump with a few millimetres around it. */
function showJump(k: number): void {
  const p = files.active?.pattern;
  const j = p && seq(p).transitions[k];
  if (!p || !j) return;
  // At least 25 mm across, so the jump is seen in its surroundings.
  const cx = (p.x[j.from] + p.x[j.to]) / 20;
  const cy = (p.y[j.from] + p.y[j.to]) / 20;
  const half = Math.max(12.5, Math.abs(p.x[j.from] - p.x[j.to]) / 20 + 4, Math.abs(p.y[j.from] - p.y[j.to]) / 20 + 4);
  vp.fit(cx - half, cy - half, cx + half, cy + half, ui.stageW, ui.stageH);
}

function selectJump(k: number | null): void {
  ui.selectedJump = k;
  if (k !== null) showJump(k);
  redraw();
}

const jumpsPanel = new JumpsPanel(settings, {
  select: selectJump,
  hover: (k) => {
    ui.hoverJump = k;
    redraw();
  },
  step: (dir) => stepJump(dir),
  apply: (indices, cut) => {
    const f = files.active;
    const p = f?.pattern;
    if (!f || !p) return;
    const list = seq(p).transitions;
    const next = setTrims(p, indices.map((i) => list[i]), cut);
    if (next === p) return;
    const keep = ui.selectedJump;
    applyEdit(next);
    // The jumps stay the same ones in the same order, so the selection carries over.
    ui.selectedJump = keep;
    redraw();
  },
  limitChanged: () => {
    saveSettings(settings);
    redraw();
  },
});

function stepJump(dir: 1 | -1): void {
  const p = files.active?.pattern;
  if (!p) return;
  const shown = jumpsPanel.visible(seq(p).transitions);
  if (!shown.length) return;
  const i = ui.selectedJump !== null ? shown.indexOf(ui.selectedJump) : -1;
  selectJump(shown[i < 0 ? (dir > 0 ? 0 : shown.length - 1) : (i + dir + shown.length) % shown.length]);
}

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

const cellsOf = (v: ValidationResult): Cells => ({ critical: v.criticalCells, caution: v.cautionCells });
const measured = async (p: Pattern) => classify(await validator.measure(p, openOnPurpose(p, seq(p).objects) ?? undefined), settings.profile, settings.checks);

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
  const objs = seq(p).objects;
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
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p || ui.correctMessage?.kind === 'busy' || ui.correctMessage?.kind === 'progress') return;
  const proposals = planFabric(p, settings.profile);
  const name = t(`fabric.${settings.profile.fabric}` as Key);
  if (!proposals.length) {
    if (quiet) return;
    ui.planState = null;
    ui.correctMessage = { kind: 'text', text: t('tune.none', { fabric: name }) };
    return redraw();
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
  redraw();
}

/** Works out proposals for the whole design or the selected zone; nothing changes yet. */
async function planFix(scope: 'all' | 'zone'): Promise<void> {
  const f = files.active;
  const p = f?.pattern;
  const v = f?.validation;
  if (!f || !p || !v || ui.correctMessage?.kind === 'busy' || ui.correctMessage?.kind === 'progress') return;
  const z = ui.selectedZone;
  const pad = 1; // mm around the zone
  const region = scope === 'zone' && z ? { minX: z.bbox.minX - pad, minY: z.bbox.minY - pad, maxX: z.bbox.maxX + pad, maxY: z.bbox.maxY + pad } : undefined;
  ui.planState = null;
  ui.planHover = null;
  ui.planPreview = null;
  const stale = () => files.active !== f || f.pattern !== p;
  ui.correctMessage = { kind: 'progress', done: 0, total: 0 };
  redraw();
  try {
    const opt = { ...settings.correction, region, acks: f.acks, trimMm: settings.trimMm };
    const plan = await planCorrection(p, v, settings.profile, settings.checks, {
      ...opt,
      stale,
      progress: async (done, total) => {
        if (ui.correctMessage?.kind !== 'progress' || ui.correctMessage.done !== done || ui.correctMessage.total !== total) {
          ui.correctMessage = { kind: 'progress', done, total };
          redraw();
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
  redraw();
}

/**
 * The stitches of the objects `which` (sewing order), each as a pattern of its own with its
 * underlay marked (read from what the objects remember, so while that is there).
 */
function objectStitches(p: Pattern, which: number[], under: boolean): FocusStitches[] {
  const q = seq(p);
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

/** A proposal taken over only for a look: its stitches and their heatmap (once worked out). */
interface PlanPreview {
  pattern: Pattern;
  img: HTMLCanvasElement | null;
  /** The stitches of the objects it changes, each on its own: as they are and as they would be. */
  before: FocusStitches[];
  focus: FocusStitches[];
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
  redraw();
}

/** Inside the frame of the comparison on the screen. */
const inPlanFrame = (sx: number, sy: number) => !!planFrame && sx >= planFrame.x0 && sx <= planFrame.x1 && sy >= planFrame.y0 && sy <= planFrame.y1;

/** The line between before and after follows `sx` (kept a little inside the frame). */
function movePlanSplit(sx: number): void {
  if (!planFrame) return;
  planSplit = Math.min(0.97, Math.max(0.03, (sx - planFrame.x0) / Math.max(1, planFrame.x1 - planFrame.x0)));
  redraw();
}

/**
 * Shows the proposals `ids` taken over on the canvas, without changing anything: the stitches at
 * once, their heatmap when it is worked out. Null: back to the design as it is.
 */
function showPlanPreview(ids: number[] | null): void {
  const st = ui.planState;
  ui.planPreview = null;
  if (!st || !ids || files.active !== st.file || st.file.pattern !== st.pattern) return;
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
      const pattern = applyProposals(st.pattern, chosen, settings.trimMm)?.pattern ?? null;
      // Its underlay is read from what the new stitches remember, before that is let go.
      if (pattern) pv = { pattern, img: null, before: [], focus: objectStitches(pattern, which, under) };
    } finally {
      release();
    }
    if (pv) pv.before = objectStitches(st.pattern, which, under);
    cache.set(key, pv);
    if (pv) {
      const { metric, cellMm, blurMm, includeJumps } = settings;
      void density
        .density(pv.pattern, { metric, cellMm, blurMm, includeJumps })
        .then((g) => {
          pv.img = gridToCanvas(g, settings.scales[metric].max);
          if (ui.planPreview === pv) redraw();
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
  if (!pv || !b || settings.mode !== 'density' || ui.planState?.file !== files.active) return;
  const pad = 1.5; // mm, as the frame of a zone
  const box = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  const before: Scene = { ...scene(), validation: null, validationImg: null, counted: null, highlight: null, markers: null, focus: pv.before };
  const after: Scene = { ...before, pattern: pv.pattern, gridImg: pv.img ?? ui.gridImg, focus: pv.focus };
  const labels: [string, string] = [t('plan.before'), t('plan.after')];
  const [x0, y0] = vp.toScreen(box.minX, box.minY);
  const [x1, y1] = vp.toScreen(box.maxX, box.maxY);
  drawBeforeAfter(ctx, ui.stageW, ui.stageH, { x0, y0, x1, y1 }, before, after, stageBg(), labels, planSplit);
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
  drawPanels(ctx, ui.stageW, ui.stageH, [panel(sx, before, labels[0]), panel(sx + w + gap, after, labels[1])], stageBg());
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
  const f = files.active;
  if (!st || !f || st.file !== f || f.pattern !== st.pattern) {
    ui.planState = null;
    ui.correctMessage = null;
    return redraw();
  }
  const chosen = st.plan.proposals.filter((x) => st.checked.has(x.id));
  ui.correctMessage = { kind: 'busy' };
  ui.planHover = null;
  ui.planPreview = null;
  redraw();
  try {
    let p = st.pattern;
    let done = 0;
    const r = chosen.length ? applyProposals(p, chosen, settings.trimMm) : null;
    if (r) {
      p = syncBorders(r.pattern, settings.trimMm);
      done = r.done;
    }
    let fine: CorrectionReport | undefined;
    if (st.fineOn) {
      for (const b of st.fine) {
        const pad = 1;
        const c = await validator.correct(p, settings.profile, settings.checks, { ...settings.correction, region: { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, acks: f.acks });
        if (c.pattern !== p) {
          p = c.pattern;
          fine = addReports(fine, c.report);
        }
      }
    }
    if (files.active !== f || f.pattern !== st.pattern) return;
    ui.planState = null;
    if (p === st.pattern) {
      ui.correctMessage = { kind: 'text', text: t('correct.noChange') };
      return redraw();
    }
    editor.reset();
    applyEdit(p);
    files.setObjects(f, rememberedIn(p, seq(p).objects));
    const after = await measured(p);
    const open = after.zones.filter((z) => !z.practice && !settledBy(z, f.acks) && wanted(z, settings.correction).length).length;
    ui.correctMessage = { kind: 'applied', done, before: st.view.before, after: cellsOf(after), fine, open };
  } catch (err) {
    console.error(err);
    ui.correctMessage = { kind: 'text', text: t('correct.error', { msg: err instanceof Error ? err.message : String(err) }) };
  }
  redraw();
}

const correctPanel = new CorrectPanel(settings, {
  plan: (scope) => void planFix(scope),
  check: (ids, on) => {
    const st = ui.planState;
    if (!st) return;
    if (ids === 'fine') st.fineOn = on;
    else for (const id of ids) on ? st.checked.add(id) : st.checked.delete(id);
    planMessage();
    redraw();
  },
  applyPlan: () => void applyPlan(),
  discardPlan: () => {
    ui.planState = null;
    ui.planHover = null;
    ui.planPreview = null;
    ui.correctMessage = null;
    redraw();
  },
  checkAll: (on) => {
    const st = ui.planState;
    if (!st) return;
    st.checked = new Set(on ? st.plan.proposals.map((x) => x.id) : []);
    st.fineOn = on && st.fine.length > 0;
    planMessage();
    redraw();
  },
  hoverProposal: (ids) => {
    // Away from the list, the held proposal comes back.
    const show = ids ?? ui.planPin;
    ui.planHover = show && proposalsBox(show);
    showPlanPreview(show);
    redraw();
  },
  splitProposal: (at) => {
    planSplit = Math.min(0.97, Math.max(0.03, at));
    redraw();
  },
  showProposal: (ids) => {
    // A second click lets go; otherwise it is held and the view goes to it.
    if (ui.planPin?.join() === ids.join()) return pinPlan(null);
    const b = proposalsBox(ids);
    if (!b) return;
    const pad = 4;
    vp.fit(b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad, ui.stageW, ui.stageH);
    pinPlan(ids);
  },
  toggleCompare: () => setComparing(!ui.comparing),
  deleteSelection: () => editor.deleteSelection(),
  thinSelection: (share) => {
    if (!editor.thinSelection(share)) ui.correctMessage = { kind: 'text', text: t('edit.thin.none') };
    redraw();
  },
  undo: () => history('undo'),
  redo: () => history('redo'),
  revert: () => history('revert'),
  save: (format, name) => {
    const f = files.active;
    if (f?.pattern) downloadPattern({ ...f.pattern, name }, format, `${name}.${format}`, { hoop: f.material.hoop });
  },
  optionsChanged: () => saveSettings(settings),
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

/** Whether the canvas shows realistic threads right now. */
const threadsShown = () =>
  settings.realistic &&
  (settings.mode === 'flow' || (settings.mode === 'density' && (settings.overlay || editor.active)) || (settings.mode === 'image' && settings.image.view === 'stitches'));

let tiltListening = false;
function listenTilt(): void {
  if (tiltListening) return;
  tiltListening = true;
  window.addEventListener('deviceorientation', (e) => {
    if (e.beta === null || e.gamma === null || !settings.liveLight || !threadsShown()) return;
    lightFromTilt(e.beta, e.gamma);
    redraw();
  });
}
/** iOS asks before a page may read the tilt, and only from a tap. */
const tiltPermission = (window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined)?.requestPermission;
async function allowTilt(): Promise<void> {
  if (!tiltPermission) return listenTilt();
  try {
    if ((await tiltPermission.call(window.DeviceOrientationEvent)) === 'granted') {
      listenTilt();
      $('allow-tilt').hidden = true;
    }
  } catch {
    // Refused or not over HTTPS: the pointer still moves the light.
  }
}
if ('DeviceOrientationEvent' in window && !tiltPermission) listenTilt();
$('allow-tilt').hidden = !tiltPermission;
$('allow-tilt').addEventListener('click', () => void allowTilt());

/** Shows the converted image as sewn thread and lets the light go round once. */
function shine(): void {
  settings.realistic = true;
  settings.liveLight = true;
  settings.image.view = 'stitches';
  saveSettings(settings);
  controls.refresh();
  imageMode.render();
  sweep(redraw);
}
$('image-shine').addEventListener('click', () => {
  void allowTilt();
  shine();
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

/** Keys for the drawing tools (as in common drawing programs, where free of other uses here). */
const DRAW_KEYS: Record<string, DrawKind> = { m: 'rect', o: 'ellipse', b: 'pen', p: 'free' };

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && ['z', 'Z', 'y'].includes(e.key)) {
    e.preventDefault();
    history(e.key === 'y' || e.shiftKey ? 'redo' : 'undo');
    return;
  }
  if (mod && !e.altKey && (e.key === 'd' || e.key === 'D') && settings.mode === 'flow' && frameObjects().length === 1) {
    e.preventDefault();
    duplicateSelected();
    return;
  }
  if (mod && e.key === 'a' && editor.active) {
    e.preventDefault();
    editor.selectAll();
    return;
  }
  if (mod || e.altKey) return;
  if (e.key === 'Escape' && ui.planPin) return pinPlan(null);
  if (drawTool.active && settings.mode === 'flow') {
    if (e.key === 'Escape') {
      if (drawTool.busy) {
        drawTool.cancel();
        redraw();
      } else setDrawing(null);
      return;
    }
    if (e.key === 'Enter' && drawTool.busy) {
      e.preventDefault();
      return drawTool.finish(false);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && drawTool.removeLast()) {
      e.preventDefault();
      return;
    }
  }
  if (settings.mode === 'flow' && !e.shiftKey && e.key in DRAW_KEYS) {
    const kind = DRAW_KEYS[e.key];
    return setDrawing(drawTool.kind === kind ? null : kind);
  }
  if (shapeTool.active && settings.mode === 'flow') {
    const step = e.shiftKey ? 0.5 : 0.1;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key in arrows && shapeTool.selected) {
      e.preventDefault();
      shapeTool.nudge(...arrows[e.key]);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && shapeTool.deleteSelected()) {
      e.preventDefault();
      return;
    }
    if (e.key === 'c' && shapeTool.toggleSmooth()) return;
    if (e.key === 'Escape') {
      if (shapeTool.selected) {
        shapeTool.selected = null;
        redraw();
      } else closeShape();
      return;
    }
    if (e.key === 'Enter' && ui.shapeObject !== null) return enterObject(ui.shapeObject, false);
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && settings.mode === 'flow' && !drawTool.busy && frameObjects().length) {
    e.preventDefault();
    return deleteSelected();
  }
  // One object chosen (level Objects): the arrow keys move it, Enter goes into its outline.
  if (frameTool.active && settings.mode === 'flow' && !(e.target as HTMLElement).closest('button')) {
    const step = e.shiftKey ? 1 : 0.1;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key in arrows) {
      e.preventDefault();
      commitTransform(translation(...arrows[e.key]));
      return;
    }
  }
  if (ui.lettering && settings.mode === 'flow' && !(e.target as HTMLElement).closest('button')) {
    if (ui.letterMode) {
      const step = e.shiftKey ? 1 : 0.1;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (e.key in arrows && ui.letterAt !== null) {
        e.preventDefault();
        const o = ui.lettering.l.letters.find((v) => v.at === ui.letterAt);
        letterMoved(ui.letterAt, o?.dx ?? 0, o?.dy ?? 0, ...arrows[e.key], true);
        return;
      }
      if (e.key === 'Escape') {
        if (ui.letterAt !== null) {
          ui.letterAt = null;
          redraw();
        } else setLetterMode(false);
        return;
      }
      if (e.key === 'Enter') return;
    } else if (e.key === 'Enter') return setLetterMode(true);
    if (e.key === 'e' || e.key === 'r' || e.key === 'g') return;
  }
  if (rungTool.active && settings.mode === 'flow') {
    if ((e.key === 'Delete' || e.key === 'Backspace') && rungTool.deleteSelected()) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (rungTool.selected) {
        rungTool.selected = null;
        redraw();
      } else closeRungs();
      return;
    }
  }
  if (editor.active && editor.selection.size) {
    const step = e.shiftKey ? 5 : 1; // 0.1 mm, with Shift 0.5 mm
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (e.key in arrows) {
      e.preventDefault();
      editor.nudge(...arrows[e.key]);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      editor.deleteSelection();
      return;
    }
    if (e.key === 'Escape') {
      editor.selection.clear();
      redraw();
      return;
    }
    if (e.key === 'i') {
      editor.splitSelected();
      return;
    }
  }
  if (e.key === '1' || e.key === '2' || e.key === '3') {
    setMode(e.key === '1' ? 'flow' : e.key === '2' ? 'density' : 'image');
    return;
  }
  if (settings.mode === 'image') {
    if (e.key === 'f') fitView();
    return;
  }
  if (settings.mode === 'flow') {
    if ((e.target as HTMLElement).closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === 'e') {
      closeRungs();
      return setEditing(!editor.active);
    }
    if (e.key === 'r') return toggleRungs();
    if (e.key === 'g') return toggleGuides();
    if (e.key === 't' && !editor.active && !shapeTool.active && !rungTool.active) return void newLettering();
    if (editor.active) {
      if (e.key === 'Escape') return setEditing(false);
      if (e.key === ',' || e.key === '.') {
        e.preventDefault();
        const i = editor.step(e.key === '.' ? 1 : -1);
        if (i >= 0) revealRecord(i);
        return;
      }
    } else if (e.key === 'Enter' && ui.selectedObjects.size === 1) return enterShape([...ui.selectedObjects][0], true);
    if (e.key === ' ') {
      e.preventDefault();
      player.toggle();
    } else if (e.key === ',' || e.key === '.') player.step((e.key === '.' ? 1 : -1) * (e.shiftKey ? 100 : 1));
    else if (e.key === 'Home') player.set(0);
    else if (e.key === 'End') player.set(Number.MAX_SAFE_INTEGER);
    else if (e.key === 'n') stepJump(1);
    else if (e.key === 'N') stepJump(-1);
    else if (e.key === 'ArrowDown' || e.key === 'j') files.step(1);
    else if (e.key === 'ArrowUp' || e.key === 'k') files.step(-1);
    else if (e.key === 'f') fitView();
    else if (e.key === 'Escape') {
      if (orderCard.isOpen) orderCard.close(true);
      else if (ui.selectedObjects.size) ui.selectedObjects = new Set();
      else ui.selectedJump = ui.focusBlock = null;
      redraw();
    }
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'j') files.step(1);
  else if (e.key === 'ArrowUp' || e.key === 'k') files.step(-1);
  else if (e.key === 'f') fitView();
  else if (e.key === 'e') setEditing(!editor.active);
  else if (e.key === 'c' && FileList.edited(files.active)) setComparing(!ui.comparing);
  else if (e.key === 'n') stepZone(1);
  else if (e.key === 'N') stepZone(-1);
  else if (e.key === 'v') {
    settings.showValidation = !settings.showValidation;
    saveSettings(settings);
    controls.refresh();
    redraw();
  } else if (e.key === 'Escape' && ui.selectedZone) {
    ui.selectedZone = null;
    redraw();
  } else if (e.key === 'Escape' && editor.active) setEditing(false);
});

// Zoom, pan, pinch, tooltip ---------------------------------------------------

const local = (e: { clientX: number; clientY: number }): [number, number] => {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [sx, sy] = local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    vp.zoomAt(sx, sy, Math.exp(-delta * 0.0015));
    showTooltip(sx, sy);
    redraw();
  },
  { passive: false },
);

/** Tooltip for the side of the divider the pointer is on. */
function showTooltip(sx: number, sy: number): void {
  if (settings.mode === 'image') return;
  if (settings.mode === 'flow') return flowTooltip(sx, sy);
  const left = showCompare() && sx < ui.split * ui.stageW;
  const f = files.active;
  updateTooltip(tooltip, sx, sy, ui.stageW, vp, left ? ui.origGrid : ui.grid, settings, (left ? f?.originalValidation : f?.validation) ?? null);
}

const nearDivider = (sx: number) => showCompare() && Math.abs(sx - ui.split * ui.stageW) <= DIVIDER_GRAB_PX;

const pointers = new Map<number, [number, number]>();
let pinchDist = 0;
/** Where a one-finger or mouse press started, to tell a click from a drag. */
let pressAt: [number, number] | null = null;
/** What the press started as: a point drag, a rectangle or panning (a click when it did not move). */
let pressMode: 'move' | 'band' | 'pan' | 'frame' = 'pan';
/** Pointer painting a brush stroke in the Bild mode, or null. */
let painting: number | null = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const pos = local(e);
  pointers.set(e.pointerId, pos);
  pressAt = pointers.size === 1 ? pos : null;
  let mode: 'move' | 'band' | 'pan' | 'frame' = 'pan';
  if (settings.mode === 'image' && imageMode.painting && pointers.size === 1 && e.button === 0) {
    painting = e.pointerId;
    imageMode.paintDown(...vp.toWorld(pos[0], pos[1]));
    return;
  }
  // A second finger while painting means zooming: the stroke is dropped.
  if (painting !== null) {
    painting = null;
    imageMode.paintCancel();
  }
  // On the comparison of a proposal: the line between before and after follows the finger or mouse.
  if (pointers.size === 1 && e.button === 0 && inPlanFrame(pos[0], pos[1])) {
    ui.planDrag = true;
    movePlanSplit(pos[0]);
    return;
  }
  if (pointers.size === 1 && e.button === 0 && nearDivider(pos[0])) {
    ui.splitDrag = true;
    stage.classList.add('splitting');
    return;
  }
  if (pointers.size === 1 && e.button === 0) {
    const [wx, wy] = vp.toWorld(pos[0], pos[1]);
    const flow = settings.mode === 'flow';
    if (drawTool.active && flow) {
      drawTool.down(wx, wy, vp.scale);
      mode = 'move';
    } else if (ui.letterMode && flow) mode = letterDown(wx, wy) ? 'move' : 'pan';
    else if (rungTool.active && flow) mode = rungTool.down(wx, wy, vp.scale, e.shiftKey);
    else if (shapeTool.active && flow) mode = shapeTool.down(wx, wy, vp.scale);
    else if (frameTool.active && flow && frameTool.down(wx, wy, vp.scale) !== null) mode = 'frame';
    else mode = editor.down(wx, wy, pos[0], pos[1], e.shiftKey, vp.scale);
  }
  pressMode = mode;
  cancelLongPress();
  if (e.pointerType === 'touch' && pointers.size === 1 && settings.mode === 'flow') {
    const at = pos;
    const { clientX, clientY } = e;
    longPress = {
      at,
      timer: window.setTimeout(() => {
        longPress = null;
        if (objectMenu.isOpen || !pointers.size || !openObjectMenu(at, clientX, clientY)) return;
        // The finger lifted after this is no click, and nothing it started goes on.
        pressAt = null;
        editor.cancel();
        frameTool.cancel();
        ui.flowPreview = null;
        redraw();
      }, LONG_PRESS_MS),
    };
  }
  if (mode === 'pan') canvas.classList.add('panning');
  if (pointers.size === 2) {
    editor.cancel();
    rungTool.cancel();
    shapeTool.cancel();
    drawTool.abortPress();
    ui.letterDrag = null;
    if (frameTool.dragging !== null) {
      frameTool.cancel();
      ui.flowPreview = null;
    }
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  redraw();
});

canvas.addEventListener('pointermove', (e) => {
  const pos = local(e);
  const prev = pointers.get(e.pointerId);
  const [wx, wy] = vp.toWorld(pos[0], pos[1]);
  if (settings.mode === 'image') {
    if (painting === e.pointerId) {
      imageMode.paintMove(wx, wy);
      return;
    }
    imageMode.hover(wx, wy);
    if (!prev && imageMode.painting) redraw();
  }
  if (settings.liveLight && e.pointerType === 'mouse' && threadsShown()) {
    lightFromPointer(pos[0], pos[1], ui.stageW, ui.stageH);
    redraw();
  }
  if (ui.splitDrag) {
    ui.split = Math.min(0.98, Math.max(0.02, pos[0] / ui.stageW));
    redraw();
    return;
  }
  // A mouse over the comparison moves its line as it goes; a finger drags it.
  if (ui.planDrag || (!prev && e.pointerType === 'mouse' && inPlanFrame(pos[0], pos[1]))) {
    movePlanSplit(pos[0]);
    // The density tip would cover the comparison, so it stays away here.
    tooltip.hidden = true;
    canvas.classList.remove('on-divider');
    return;
  }
  canvas.classList.toggle('on-divider', !prev && nearDivider(pos[0]));
  if (longPress && (pointers.size > 1 || Math.hypot(pos[0] - longPress.at[0], pos[1] - longPress.at[1]) > 8)) cancelLongPress();
  // With the menu open after a long press, the finger moves nothing until it is lifted.
  if (prev && objectMenu.isOpen && e.pointerType === 'touch') return;
  if (prev) {
    if (pointers.size === 1) {
      if (!drawTool.dragTo(wx, wy, e.shiftKey, e.altKey) && !letterDragTo(wx, wy) && !rungTool.dragTo(wx, wy) && !shapeTool.dragTo(wx, wy) && !frameTool.dragTo(wx, wy, e.shiftKey, vp.scale) && !editor.dragTo(wx, wy, pos[0], pos[1])) vp.pan(pos[0] - prev[0], pos[1] - prev[1]);
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, pos);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDist > 0) vp.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinchDist);
      pinchDist = d;
    }
    pointers.set(e.pointerId, pos);
    redraw();
  } else if (
    drawTool.active
      ? drawTool.hoverAt(wx, wy, vp.scale)
      : rungTool.active
      ? rungTool.hoverAt(wx, wy, vp.scale)
      : shapeTool.active
        ? shapeTool.hoverAt(wx, wy, vp.scale)
        : (frameTool.active && frameTool.hoverAt(wx, wy, vp.scale)) || editor.hoverAt(wx, wy, vp.scale)
  )
    redraw();
  if (!prev) canvas.classList.toggle('on-frame', frameTool.active && frameTool.hover !== null);
  if (e.pointerType === 'mouse' || pointers.size <= 1) showTooltip(pos[0], pos[1]);
});

/** Whether a click at `pos` (on the stage) hits stitches outside the selection. */
function clickedOther(p: Pattern, pos: [number, number]): boolean {
  const st = styleFor(p);
  const [x, y] = vp.toWorld(pos[0], pos[1]);
  const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / vp.scale), st.limit, st.alpha);
  return i >= 0 && !ui.selectedObjects.has(seq(p).objectAt[i]);
}

const endPointer = (e: PointerEvent) => {
  const pos = local(e);
  cancelLongPress();
  if (painting === e.pointerId) {
    painting = null;
    pointers.delete(e.pointerId);
    if (e.type === 'pointerup') imageMode.paintUp();
    else imageMode.paintCancel();
    return;
  }
  // A press on the frame that did not move is a click like any other.
  const frameClick = pressMode === 'frame' && frameTool.dragging !== null && !frameTool.up();
  if (pressMode === 'frame' && !frameClick) pressMode = 'move';
  if (pressAt && e.type === 'pointerup' && e.button === 0 && settings.mode === 'flow' && (pressMode === 'pan' || frameClick) && !rungTool.active && Math.hypot(pos[0] - pressAt[0], pos[1] - pressAt[1]) < 4) {
    const p = files.active?.pattern;
    if (p && ui.letterMode && !clickedOther(p, pos)) {
      // Moving single letters: a click beside the letters lets go of the chosen one.
      if (ui.letterAt !== null) {
        ui.letterAt = null;
        redraw();
      }
    } else if (p && shapeTool.active) {
      // Editing an outline: a click on another object goes on with its outline, a click beside it back to the objects.
      const st = styleFor(p);
      const [x, y] = vp.toWorld(pos[0], pos[1]);
      const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / vp.scale), st.limit, st.alpha);
      const o = i >= 0 ? seq(p).objectAt[i] : -1;
      if (o >= 0 && o !== ui.shapeObject && !shapeTool.near(x, y, vp.scale)) enterShape(o, false);
      else if (o < 0 && !shapeTool.selected && !shapeTool.near(x, y, vp.scale)) closeShape();
      else if (shapeTool.selected) {
        shapeTool.selected = null;
        redraw();
      }
    } else if (p && editor.active) {
      // Editing stitches: a click on another object goes on with that one, a click beside the
      // stitches (with no point selected) goes back to the objects.
      const st = styleFor(p);
      const [x, y] = vp.toWorld(pos[0], pos[1]);
      const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / vp.scale), st.limit, st.alpha);
      const o = i >= 0 ? seq(p).objectAt[i] : -1;
      if (o >= 0 && o !== ui.editObject) enterObject(o, ui.editObject === null);
      else if (o < 0 && !editor.selection.size) setEditing(false);
    } else if (p) {
      const q = seq(p);
      const k = transitionAt(p, q.transitions, vp, pos[0], pos[1]);
      if (k >= 0 || ui.selectedJump !== null) {
        ui.selectedJump = k >= 0 ? k : null;
        redraw();
      }
      if (k < 0) {
        // A click on stitches selects their object, a click beside them clears the selection.
        const st = styleFor(p);
        const [x, y] = vp.toWorld(pos[0], pos[1]);
        const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / vp.scale), st.limit, st.alpha);
        const o = i >= 0 ? q.objectAt[i] : -1;
        const add = e.shiftKey || e.ctrlKey || e.metaKey;
        if (o >= 0) selectObjects([o], add);
        else if (!add && ui.selectedObjects.size) selectObjects([], false);
      }
    }
  }
  pressAt = null;
  ui.planDrag = false;
  if (ui.splitDrag) {
    ui.splitDrag = false;
    stage.classList.remove('splitting');
  }
  if (pointers.size === 1 && pointers.has(e.pointerId)) {
    drawTool.up(...vp.toWorld(pos[0], pos[1]), e.shiftKey, e.altKey);
    letterUp();
    rungTool.up();
    shapeTool.up();
    if (frameTool.dragging !== null) frameTool.up();
    editor.up();
  }
  pointers.delete(e.pointerId);
  pinchDist = 0;
  if (!pointers.size) canvas.classList.remove('panning');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (e) => {
  drawTool.abortPress();
  ui.letterDrag = null;
  editor.cancel();
  rungTool.cancel();
  shapeTool.cancel();
  frameTool.cancel();
  ui.flowPreview = null;
  endPointer(e);
});
canvas.addEventListener('pointerleave', () => {
  tooltip.hidden = true;
  if (settings.mode === 'image') {
    imageMode.leave();
    redraw();
  }
});
// The object actions at the pointer: right click, or a long press on a touch screen.
const objectMenu = new ObjectMenu();
let longPress: { timer: number; at: [number, number] } | null = null;

function cancelLongPress(): void {
  if (longPress) clearTimeout(longPress.timer);
  longPress = null;
}

/** Opens the menu for the object under `pos` (on the stage), selecting it first; false when there is none. */
function openObjectMenu(pos: [number, number], clientX: number, clientY: number): boolean {
  const p = files.active?.pattern;
  if (!p || settings.mode !== 'flow' || editor.active || shapeTool.active || rungTool.active || drawTool.active || orderCard.isOpen || ui.letterMode) return false;
  const st = styleFor(p);
  const [x, y] = vp.toWorld(pos[0], pos[1]);
  const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / vp.scale), st.limit, st.alpha);
  const o = i >= 0 ? seq(p).objectAt[i] : -1;
  return o >= 0 && showObjectMenu(o, clientX, clientY);
}

/** Opens the menu for object `o` (on the canvas or in the list), selecting it first unless it is selected. */
function showObjectMenu(o: number, clientX: number, clientY: number): boolean {
  const p = files.active?.pattern;
  if (!p || settings.mode !== 'flow' || editor.active || shapeTool.active || rungTool.active || drawTool.active || orderCard.isOpen || ui.letterMode) return false;
  // On a selected object the menu is for the whole selection, on another one for that one.
  if (!ui.selectedObjects.has(o)) selectObjects([o], false);
  redraw();
  if (ui.lettering || !ui.selectedObjects.size) return false;
  objectMenu.open(clientX, clientY, objectPanel.actions(objectInfo(p, seq(p))), t('object.menu'));
  return objectMenu.isOpen;
}

canvas.addEventListener('contextmenu', (e) => {
  // The right button pans while painting.
  if (settings.mode === 'image') return e.preventDefault();
  // A long press opened it already (some browsers send this after a long press too).
  if (objectMenu.isOpen) return e.preventDefault();
  cancelLongPress();
  if (openObjectMenu(local(e), e.clientX, e.clientY)) e.preventDefault();
});
canvas.addEventListener('dblclick', (e) => {
  const pos = local(e);
  const [x, y] = vp.toWorld(pos[0], pos[1]);
  if (drawTool.active) {
    // The pen ends an open line; the other tools ignore it.
    drawTool.finish(false);
    return;
  }
  if (rungTool.active) return;
  if (shapeTool.active) {
    shapeTool.insertAt(x, y, vp.scale);
    return;
  }
  if (editor.active) {
    editor.insertAt(x, y, vp.scale);
    return;
  }
  const p = files.active?.pattern;
  if (settings.mode === 'flow' && p) {
    // A double-click on an object opens its outline (a fill) or its stitches.
    const st = styleFor(p);
    const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / vp.scale), st.limit, st.alpha);
    const o = i >= 0 ? seq(p).objectAt[i] : -1;
    // A lettering opens its text; one of its letters, while they are moved, nothing more.
    if (o >= 0 && letteringsOf(p, seq(p))[o]) {
      if (!ui.letterMode) {
        if (!ui.selectedObjects.has(o)) selectObjects([o], false);
        ui.focusText = true;
        redraw();
      }
      return;
    }
    if (o >= 0) return enterShape(o, true);
  }
  fitView();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);

files.render();
redraw();
void files.restore();
void imageMode.restore();

$('fabric-tune').addEventListener('click', () => tuneToFabric());
