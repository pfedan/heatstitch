import './style.css';
import { WorkerClient } from './density/client';
import type { DensityGrid } from './density/grid';
import { applyI18n, detectLang, formatNumber, getLang, setLang, t, type Lang } from './i18n';
import { gridToCanvas } from './render/heatmap';
import { drawLegend } from './render/legend';
import { drawScene, type Scene } from './render/scene';
import { validationToCanvas } from './render/validationOverlay';
import { Viewport } from './render/viewport';
import { loadSettings, saveSettings } from './settings';
import { bindControls, type ChangeKind } from './ui/controls';
import { CorrectPanel, type CorrectMessage } from './ui/correctPanel';
import { Editor } from './ui/editor';
import { keepObjects, type HandChange } from './model/handEdit';
import { exportPng } from './ui/export';
import { FileList, type LoadedFile } from './ui/fileList';
import { legendSpec } from './ui/legendSpec';
import { bindProfile } from './ui/profilePanel';
import { renderStats } from './ui/stats';
import { updateTooltip } from './ui/tooltip';
import { ValidationPanel } from './ui/validationPanel';
import { acknowledgementOf, settledBy, type Acknowledgement } from './validation/acks';
import type { ValidationResult, Zone } from './validation/validate';
import { POINTS_MIN_SCALE } from './render/editOverlay';
import { DIVIDER_GRAB_PX, drawDivider } from './render/compare';
import type { Pattern, ThreadColor } from './model/pattern';
import type { Measurement } from './validation/measure';
import { initUpdateNotice } from './ui/updateNotice';
import { toStored } from './storage/fileStore';
import { downloadPattern, outputFileName, writePattern } from './writers';
import { parsePattern } from './parsers';
import { digitizeSvg, ImageMode } from './ui/imageMode';
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
import { COLOR_CHANGE, patternStats, STITCH, TRIM } from './model/pattern';
import { stitchAlpha, stitchAt, stitchColors, transitionAt, type StitchStyle } from './render/flow';
import type { FlowScene, ShapeOutline } from './render/scene';
import type { Mode } from './settings';
import { JumpsPanel } from './ui/jumpsPanel';
import { blockName, kindLabel, LayersPanel } from './ui/layersPanel';
import { ObjectPanel, OrderCard } from './ui/objectPanel';
import { StitchPanel, type StitchInfo } from './ui/stitchPanel';
import { analyze, forget, keepShape, measureFill, measureRun, measureSatin, remember, remembered, type Rails, rememberedIn, rememberShapes, restitch, shapeTrust, unionRegion, type Remembered, type Settings as RestitchSettings, type ShapeTrust, type RestitchResult } from './model/restitch';
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
import { asideOf, dropAside, sewAgain, setAside, setAsideRole, storeAside, type AsideRole, type AsideShape } from './model/aside';
import { deleteObjects, duplicateObject, mirrorMatrix, subtractTop, unionForm } from './model/shapeOps';
import { stitchesBefore } from './model/transform';
import { FrameTool } from './ui/frameTool';
import { formOf, reshapeFill, scaleBlocked, transformSewObject } from './model/reshape';
import { isCovered, overlapsIn, refreshKnockouts, setKnockout, wholeArea } from './model/knockout';
import { transformObject } from './model/transform';
import { translation, type Form, type Mat } from './shape/path';
import { digitizeDefaults, digitizeShapes, isStroke, SATIN_MAX, type Digitized } from './digitize/digitize';
import { recommendedSpacing } from './validation/profiles';
import { numberInColor, overlaps, rememberObjects, sewObjects, splitObject, type SewObject } from './model/objects';
import { conflicts, moveStats, optimizePlan, reorder, violations, weigh } from './model/order';
import { autoReversible, reverseObjects, reversible } from './model/reverse';
import { Player } from './ui/player';
import { installPanelResize } from './ui/panelResize';
import type { Key } from './i18n';
import { decodeProject, encodeProject, isProjectName, PROJECT_EXT, PROJECT_MIME, projectSettings, ProjectError, type Project, type ProjectSettings } from './storage/project';
import { threadWidthMm } from './validation/profiles';

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
let correctMessage: CorrectMessage = null;
/** Comparison view: original left of the divider, current version right of it. */
let comparing = false;
/** Divider position as a share of the stage width. */
let split = 0.5;
let splitDrag = false;
let origGrid: DensityGrid | null = null;
/** Pattern and options `origGrid` was computed for. */
let origKey: { p: Pattern; opts: string } | null = null;
let origGridImg: HTMLCanvasElement | null = null;
/** Original validation overlay, cached like `validationImg`. */
let origValidationImg: { v: ValidationResult; acks: Acknowledgement[]; img: HTMLCanvasElement } | null = null;
let densitySeq = 0;
let grid: DensityGrid | null = null;
let gridImg: HTMLCanvasElement | null = null;
let computing = false;
let stageW = 0;
let stageH = 0;

const stageBg = () => getComputedStyle(stage).backgroundColor;

/** Validation overlay image, rebuilt when the active file's classification changes. */
let validationImg: { v: ValidationResult; acks: Acknowledgement[]; img: HTMLCanvasElement } | null = null;
/** Zone hovered in the list (wins) or last jumped to; both are framed on the canvas. */
let hoverZone: Zone | null = null;
let selectedZone: Zone | null = null;

const files = new FileList(
  $<HTMLUListElement>('file-list'),
  (f) => {
    grid = null;
    gridImg = null;
    origGrid = null;
    origGridImg = null;
    origKey = null;
    hoverZone = selectedZone = null;
    correctMessage = null;
    editor.reset();
    resetFlow();
    if (f?.pattern && !keepView) fitView(f);
    recompute();
  },
  (p) => validator.measure(p),
  (f) => {
    if (f === files.active) redraw();
  },
  settings.profile,
  settings.checks,
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
  pattern: (settings.mode === 'flow' ? flowPreview : null) ?? editor.preview ?? files.active?.pattern ?? null,
  flow: flowScene(),
  markers: settings.mode === 'density' && files.active?.pattern && !editor.preview ? seq(files.active.pattern).markers : null,
  grid,
  gridImg,
  validation: files.active?.validation ?? null,
  validationImg: activeValidationImg(),
  counted: countedFor(files.active?.validation),
  highlight: settings.showValidation ? (hoverZone ?? selectedZone) : null,
  settings,
  vp,
  edit: editor.active ? editor : null,
});

/** True while the comparison view has something to compare. */
const showCompare = () => comparing && FileList.edited(files.active);

/** The original pattern with its own heatmap and markings, for the left side of the divider. */
function originalScene(): Scene {
  const f = files.active!;
  const v = f.originalValidation ?? null;
  if (v && (origValidationImg?.v !== v || origValidationImg.acks !== f.acks)) {
    origValidationImg = { v, acks: f.acks, img: validationToCanvas(v, countedFor(v)) };
  }
  return {
    pattern: f.original ?? null,
    grid: origGrid,
    gridImg: origGridImg,
    validation: v,
    validationImg: v ? origValidationImg!.img : null,
    counted: countedFor(v),
    highlight: null,
    settings,
    vp,
    edit: null,
  };
}

const panel = new ValidationPanel($('validation'), $('findings-open'), {
  onZone: (z) => selectZone(z),
  onHover: (z) => {
    hoverZone = z;
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

/** Shows or hides the findings (the Correction panel stays in the column); while hidden a chip on the canvas reopens them. */
function setFindingsOpen(open: boolean): void {
  settings.findingsOpen = open;
  saveSettings(settings);
  $('layout').classList.toggle('findings-closed', !open);
  $('findings-open').hidden = open;
}
$('findings-close').addEventListener('click', () => setFindingsOpen(false));
$('findings-open').addEventListener('click', () => setFindingsOpen(true));
setFindingsOpen(settings.findingsOpen);
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

/** Color blocks hidden or highlighted in the list (cleared for another file). */
let hiddenBlocks: ReadonlySet<number> = new Set();
let focusBlock: number | null = null;
let hoverBlock: number | null = null;
let selectedJump: number | null = null;
let hoverJump: number | null = null;
let alphaCache: { p: Pattern; hidden: ReadonlySet<number>; focus: number | null; objects: ReadonlySet<number> | null; a: Float32Array } | null = null;
/** Selected objects (by index in sewing order) and the one hovered in the list. */
let selectedObjects: ReadonlySet<number> = new Set();
/** Counts selections made by the user; the stitch settings are measured again for each. */
let selectionKey = 0;
/** New stitches shown while a stitch setting is being dragged, not applied yet. */
let flowPreview: Pattern | null = null;
let hoverObject: number | null = null;
/** Object whose penetrations are edited in the Ablauf mode (the level "Stitches"), or null. */
let editObject: number | null = null;
/** Nothing to pick: in the Ablauf mode the first click on the stitches chooses the object. */
const NO_RANGE = { first: 0, last: -1 };
/** One empty list, so the colors list is not rebuilt on every redraw (it compares by identity). */
const NO_COLORS: readonly ThreadColor[] = [];

const overOf = (q: Sequence, p: Pattern) => (q.over ??= overlaps(p, q.objects));

function resetFlow(): void {
  hiddenBlocks = new Set();
  focusBlock = hoverBlock = selectedJump = hoverJump = hoverObject = editObject = null;
  selectedObjects = new Set();
  selectionKey++;
  flowPreview = null;
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

function styleFor(p: Pattern): StitchStyle {
  const q = seq(p);
  const rgb = (q.colors[settings.colorBy] ??= stitchColors(p, settings.colorBy, q.kinds));
  const focus = hoverBlock ?? focusBlock;
  // A hovered object wins over the selection, the selection over a highlighted color.
  const shown = hoverObject !== null ? new Set([hoverObject]) : selectedObjects.size ? selectedObjects : null;
  const objKey = shown && hoverObject !== null ? `h${hoverObject}` : shown;
  if (alphaCache?.p !== p || alphaCache.hidden !== hiddenBlocks || alphaCache.focus !== focus || (alphaCache.objects as unknown) !== objKey) {
    const a = stitchAlpha(p, hiddenBlocks, shown ? null : focus);
    if (shown) {
      for (let i = 0; i < a.length; i++) if (a[i] > 0 && !shown.has(q.objectAt[i])) a[i] = 0.15;
    }
    alphaCache = { p, hidden: hiddenBlocks, focus, objects: objKey as ReadonlySet<number> | null, a };
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
  const p = flowPreview ?? files.active?.pattern;
  if (settings.mode !== 'flow' || !p) return null;
  const q = seq(p);
  const plain = styleFor(p);
  const flat = settings.shapesView ? asAreas(p, plain) : null;
  const style = flat?.style ?? plain;
  return {
    style,
    areas: flat?.areas ?? null,
    markers: q.markers,
    hover: hoverJump !== null ? (q.transitions[hoverJump] ?? null) : null,
    selected: selectedJump !== null ? (q.transitions[selectedJump] ?? null) : null,
    needle: player.complete ? -1 : style.limit,
    // The areas as recognized on the file itself, also while a change is previewed (not while
    // their shape is edited or the object is dragged: those show their own outline).
    outlines: files.active?.pattern && selectedObjects.size && !shapeTool.active && frameTool.dragging === null ? stitchInfo(files.active.pattern, seq(files.active.pattern)).outlines : undefined,
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
    const next = new Set(hiddenBlocks);
    if (!next.delete(b)) next.add(b);
    hiddenBlocks = next;
    if (focusBlock === b) focusBlock = null;
    redraw();
  },
  focus: (b, sticky) => {
    if (sticky) {
      focusBlock = b;
      hoverBlock = null;
    } else hoverBlock = b;
    redraw();
  },
  showAll: () => {
    hiddenBlocks = new Set();
    focusBlock = hoverBlock = null;
    redraw();
  },
  // Only the colors change, so the density measurement still holds.
  recolor: (b, color) => {
    const f = files.active;
    if (f?.pattern) applyEdit(recolor(f.pattern, b, color), f.measurement);
  },
  select: (objs, toggle) => selectObjects(objs, toggle),
  hover: (o) => {
    if (hoverObject === o) return;
    hoverObject = o;
    redraw();
  },
  move: (order, moved, into) => moveObjects(order, moved, into),
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
    next = new Set(selectedObjects);
    for (const o of objs) if (!next.delete(o)) next.add(o);
  } else next = new Set(objs);
  selectedObjects = next;
  selectionKey++;
  flowPreview = null;
  if (next.size) focusBlock = null;
  if (rungTool.active && (next.size !== 1 || !next.has(rungObject!))) closeRungs();
  // While editing an outline, choosing another object goes on with that one's (or back to the objects).
  if (shapeTool.active && (next.size !== 1 || !next.has(shapeObject!))) {
    const one = next.size === 1 ? [...next][0] : null;
    const p = files.active?.pattern;
    const form = one !== null && p ? shapeTarget(p, seq(p), one) : null;
    if (form && one !== null && p) {
      shapeTool.open(form);
      shapeObject = one;
      shapePattern = p;
    } else closeShape();
  }
  // While editing points, choosing another object (in the list too) goes on with that one.
  if (editor.active && settings.mode === 'flow') {
    const one = next.size === 1 ? [...next][0] : null;
    if (one !== editObject) {
      editor.reset();
      editObject = one;
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
  const keepHidden = hiddenBlocks.size;
  applyEdit(next, f.measurement);
  if (keepHidden) hiddenBlocks = new Set();
  // The objects are found again by their first stitch; the moved ones stay selected.
  const nq = seq(next);
  const now = (o: number) => nq.objectAt[recordOfStitch(nq.numbers, starts[order.indexOf(o)] + 1)];
  const nameNow = (o: number) => (now(o) >= 0 ? objectName(nq, now(o)) : objectName(q, o));
  const warning = coverWarning(conflict, nameNow);
  selectedObjects = new Set(moved.map(now).filter((o) => o >= 0));
  selectionKey++;
  layers.reveal([...selectedObjects]);
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
  if (!f || !p || selectedObjects.size < 2) return;
  const q = seq(p);
  const sel = [...selectedObjects].sort((a, b) => a - b);
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
      selectedObjects = new Set([merged]);
      applyRestitched(r, 'stitch.failed', true);
      if (form) layers.say(t('object.joined', { n: sel.length }));
      else done(sel.length);
      return;
    }
  }
  applyEdit(target);
  if (merged >= 0) selectedObjects = new Set([merged]);
  selectionKey++;
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
  if (!f || !p || !selectedObjects.size) return;
  const q = seq(p);
  const which = [...selectedObjects].sort((a, b) => a - b).filter((o) => reversible(q.objects[o]));
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
  if (!f || !p || selectedObjects.size !== 1) return;
  const o = seq(p).objects[[...selectedObjects][0]];
  if (!o || o.sections < 2) return;
  // A copy of the stitches: undo goes back to the pattern that still shows one object.
  const next: Pattern = { ...p };
  splitObject(next, o);
  applyEdit(next);
  const nq = seq(next);
  selectedObjects = new Set(nq.objects.flatMap((x, i) => (x.first >= o.first && x.last <= o.last ? [i] : [])));
  selectionKey++;
  layers.reveal([...selectedObjects]);
  layers.say(t('object.splitDone', { n: selectedObjects.size }));
  redraw();
}

const objectPanel = new ObjectPanel({
  merge: () => mergeObjects(),
  duplicate: () => duplicateSelected(),
  mirror: (axis) => mirrorSelected(axis),
  subtract: () => subtractSelected(),
  remove: () => deleteSelected(),
  aside: (role) => putAside(role),
  split: splitSelected,
  step: (dir) => {
    const p = files.active?.pattern;
    if (!p || selectedObjects.size !== 1) return;
    const o = [...selectedObjects][0];
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
    selectedObjects = new Set();
    selectionKey++;
    flowPreview = null;
    redraw();
  },
  editStitches: (on) => setEditing(on),
  editShape: (on) => {
    if (!on) return closeShape();
    if (selectedObjects.size === 1) enterShape([...selectedObjects][0], true);
  },
  deleteNode: () => shapeTool.deleteSelected(),
  toggleNode: () => shapeTool.toggleSmooth(),
  deleteSelection: () => editor.deleteSelection(),
  splitStitch: () => editor.splitSelected(),
});

/** Parts of each object, measured stitch settings per selection (cached per pattern and selection). */
let stitchCache: { p: Pattern; key: number; info: StitchInfo } | null = null;

function stitchInfo(p: Pattern, q: Sequence): StitchInfo {
  if (stitchCache?.p === p && stitchCache.key === selectionKey) return stitchCache.info;
  const measured: StitchInfo['measured'] = {};
  const counts: StitchInfo['counts'] = {};
  const shapes: ShapeOutline[] = [];
  let worst: ShapeTrust | undefined;
  const rank: Record<ShapeTrust, number> = { kept: 0, good: 1, approximate: 2 };
  let stroke = true;
  for (const o of [...selectedObjects].sort((a, b) => a - b)) {
    const obj = q.objects[o];
    if (!obj) continue;
    const seen = new Set<string>();
    const an = analyze(p, obj, q.kinds);
    for (const [j, pt] of an.parts.entries()) {
      // A run between two fill pieces is travel inside the fill, not a run of its own.
      if (pt.kind === 'run' && an.parts[j - 1]?.kind === 'fill' && an.parts[j + 1]?.kind === 'fill') continue;
      if (!seen.has(pt.kind)) counts[pt.kind] = (counts[pt.kind] ?? 0) + 1;
      seen.add(pt.kind);
      if (pt.kind === 'fill') measured.fill ??= remembered(p, obj)?.fill ?? measureFill(p, an);
      else if (pt.kind === 'satin') measured.satin ??= remembered(p, obj)?.satin ?? measureSatin(p, pt, q.kinds);
      else measured.run ??= measureRun(p, pt);
    }
    if (an.fill) {
      const trust = shapeTrust(p, obj, an, (remembered(p, obj)?.fill ?? measureFill(p, an)).spacing);
      if (!worst || rank[trust] > rank[worst]) worst = trust;
      shapes.push({ lines: outline(an.fill), approximate: trust === 'approximate' });
      // Satin needs a stroke: narrow, about even in width (the same test as in Image mode).
      if (stroke && an.parts.some((pt) => pt.kind === 'fill')) stroke = !!isStroke(remembered(p, obj)?.shape ?? an.fill, SATIN_MAX);
    }
  }
  const hand = [...selectedObjects].reduce((a, o) => a + (q.objects[o] ? (remembered(p, q.objects[o])?.hand ?? 0) : 0), 0);
  // Fills with curves can leave out what lies on top.
  const shaped = [...selectedObjects].map((o) => q.objects[o]).filter((obj) => obj && remembered(p, obj)?.form);
  const ons = new Set(shaped.map((obj) => !!remembered(p, obj)?.knockout));
  const knockout: StitchInfo['knockout'] = shaped.length
    ? { on: ons.size > 1 ? 'mixed' : ons.has(true), covered: shaped.some((obj) => isCovered(p, q.objects, obj)) }
    : undefined;
  const info: StitchInfo = { key: selectionKey, hand, measured, counts, recommended: recommendedSpacing(settings.profile), shape: worst, outlines: shapes, toSatin: stroke, knockout };
  stitchCache = { p, key: selectionKey, info };
  return info;
}

/** The active pattern with new stitches for the selected objects. */
function restitched(s: RestitchSettings) {
  const p = files.active?.pattern;
  if (!p || !selectedObjects.size) return null;
  const q = seq(p);
  return restitch(p, q.objects, [...selectedObjects].sort((a, b) => a - b), s, q.kinds, settings.trimMm);
}

/**
 * Takes over new stitches for the selected objects; `failed` is said for objects left as they
 * were. With `remeasure` (another kind of stitch), the panel measures the objects again.
 */
function applyRestitched(r: RestitchResult | null, failed: Key, remeasure = false): void {
  const f = files.active;
  flowPreview = null;
  if (!f || !r) return redraw();
  const say = () => {
    if (r.failed.length) layers.say(t(failed, { n: r.failed.length }), true);
  };
  if (!r.starts.length) {
    // Nothing could be sewn this way: the panel goes back to what the objects have.
    selectionKey++;
    say();
    return redraw();
  }
  const key = selectionKey;
  // Each object stays one, also where its new stitches are trimmed inside.
  r.starts.forEach((a, k) => rememberObjects(r.pattern, [a], r.ends[k]));
  applyEdit(r.pattern);
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
  files.setObjects(f, rememberedIn(r.pattern, nq.objects));
  if (sel.size) selectedObjects = sel;
  selectionKey = remeasure ? key + 1 : key;
  stitchCache = stitchCache && !remeasure ? { ...stitchCache, p: r.pattern } : null;
  say();
  redraw();
}

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
    flowPreview = s ? (restitched(s)?.pattern ?? null) : null;
    redraw();
  },
  apply: (s) => {
    const pat = s.kind === 'fill' ? s.s.pattern : null;
    applyRestitched(restitched(s), pat === 'spiral' ? 'stitch.failedSpiral' : pat === 'contour' || pat === 'follow' ? 'stitch.failedCurved' : pat === 'guided' ? 'stitch.guide.failed' : 'stitch.failed');
  },
  convert: (to) => {
    const p = files.active?.pattern;
    if (!p || !selectedObjects.size) return;
    const s = convertSettings(to, stitchInfo(p, seq(p)));
    if (!s) return;
    const q = seq(p);
    const r = restitch(p, q.objects, [...selectedObjects].sort((a, b) => a - b), s, q.kinds, settings.trimMm, to === 'satin' ? 'fill' : 'satin');
    applyRestitched(r, to === 'satin' ? 'stitch.toSatin.failed' : 'stitch.failed', true);
  },
  direction: (a) => {
    if (a === 'tool') return toggleRungs();
    if (!rungTool.active || rungTool.mode !== 'satin') return;
    if (a === 'corners') rungTool.corners();
    else if (a === 'even') rungTool.even();
    else rungTool.follow();
  },
  draw: (a) => (a === 'tool' ? toggleRungs() : sewAlongLines()),
  guide: (a) => {
    if (a === 'tool') return toggleGuides();
    if (rungTool.mode === 'guide') closeRungs();
  },
  knockout: (on) => knockoutObjects([...selectedObjects].sort((a, b) => a - b), on),
});

// Rungs -------------------------------------------------------------------------------------------

/** The object the rung tool works on, and the pattern its columns were read from. */
let rungObject: number | null = null;
let rungPattern: Pattern | null = null;

const rungTool = new RungTool({
  change: (columns, final) => {
    if (final) applyRungs(columns);
    else if (!rungFrame) {
      rungFrame = requestAnimationFrame(() => {
        rungFrame = 0;
        flowPreview = rungTool.active ? (withRungs(rungTool.mode === 'satin' ? pendingColumns : null)?.pattern ?? null) : null;
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
  if (settings.mode !== 'flow' || selectedObjects.size !== 1) return null;
  const o = [...selectedObjects][0];
  const obj = q.objects[o];
  if (!obj) return null;
  const an = analyze(p, obj, q.kinds);
  if (an.parts.some((pt) => pt.kind === 'satin')) return { o, mode: 'satin' };
  if (an.fill) return { o, mode: 'fill' };
  return null;
}

/** What the stitch panel shows about the rung tool. */
function rungInfo(p: Pattern, q: Sequence): Pick<StitchInfo, 'direction' | 'draw' | 'guide'> {
  const single = selectedObjects.size === 1;
  const on = rungTool.active && rungObject !== null && selectedObjects.has(rungObject);
  const out: Pick<StitchInfo, 'direction' | 'draw' | 'guide'> = {};
  const info = stitchInfo(p, q);
  if (info.measured.satin) {
    let rungs: number | null = null;
    if (on && rungTool.mode === 'satin') rungs = rungTool.count;
    else if (single) {
      const cols = remembered(p, q.objects[[...selectedObjects][0]])?.columns?.flat() ?? [];
      rungs = cols.some((c) => c.rungs) ? cols.reduce((a, c) => a + (c.rungs?.length ?? 0), 0) : null;
    }
    out.direction = { tool: on && rungTool.mode === 'satin', rungs, single };
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
  if (!p || settings.mode !== 'flow' || selectedObjects.size !== 1) return;
  const q = seq(p);
  const o = [...selectedObjects][0];
  const loop = fillLoop(p, q, o);
  if (!loop) return;
  if (editor.active) setEditing(false);
  rungTool.openGuides(loop, remembered(p, q.objects[o])?.fill?.guides ?? []);
  rungObject = o;
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
  rungObject = target.o;
  rungPattern = p;
  stage.classList.add('rungs');
  redraw();
}

function closeRungs(): void {
  if (!rungTool.active) return;
  rungTool.close();
  rungObject = null;
  rungPattern = null;
  pendingColumns = null;
  flowPreview = null;
  stage.classList.remove('rungs');
  redraw();
}

/** Keeps the rung tool on its object: after new stitches its columns are read again; it closes when the object is gone. */
function syncRungs(): void {
  if (!rungTool.active) return;
  const p = files.active?.pattern;
  if (!p || settings.mode !== 'flow' || selectedObjects.size !== 1) return closeRungs();
  if (p === rungPattern) return;
  const q = seq(p);
  const o = [...selectedObjects][0];
  if (rungTool.mode === 'guide') {
    // The fill sewn anew along the guide lines: the tool stays on it.
    if (!q.objects[o] || !fillLoop(p, q, o)) return closeRungs();
    // After an undo the lines are the ones the stitches were made with.
    const guides = remembered(p, q.objects[o])?.fill?.guides;
    if (guides) rungTool.guides = guides.map((g) => g.slice());
    rungObject = o;
    rungPattern = p;
    return;
  }
  const obj = q.objects[o];
  const columns = obj && rungTool.mode === 'satin' ? keepShape(p, obj, q.kinds).columns : null;
  if (!columns?.length) return closeRungs();
  rungTool.setColumns(columns);
  rungObject = o;
  rungPattern = p;
}

/**
 * New stitches for the rung tool's object along `columns` (rails with their rungs), in its own
 * satin settings; with `keep`, the columns stay remembered for the old stitches (to show them
 * while dragging, they are put back).
 */
function withRungs(columns: Rails[][] | null, keep = false) {
  const p = files.active?.pattern;
  if (!p || rungObject === null || !columns) return null;
  const q = seq(p);
  const obj = q.objects[rungObject];
  if (!obj) return null;
  const before = remembered(p, obj);
  const shape = keepShape(p, obj, q.kinds);
  remember(p, obj, { ...shape, columns, read: false });
  const r = restitch(
    p,
    q.objects,
    [rungObject],
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
  if (!p || rungObject === null || rungTool.mode !== 'fill') return;
  const q = seq(p);
  const obj = q.objects[rungObject];
  const an = obj && analyze(p, obj, q.kinds);
  const area = an && (remembered(p, obj)?.shape ?? an.fill);
  if (!area) return;
  const loops = outline(area);
  const loop = loops.reduce((a, b) => (b.length > a.length ? b : a), [] as [number, number][]) as Pt[];
  const rails = railsFromOutline(loop, rungTool.lines);
  if (!rails) return layers.say(t('stitch.draw.notStrip'), true);
  const s = convertSettings('satin', stitchInfo(p, q));
  if (!s) return;
  const o = rungObject;
  closeRungs();
  const r = restitch(p, q.objects, [o], s, q.kinds, settings.trimMm, 'fill', false, new Map([[o, [rails]]]));
  applyRestitched(r, 'stitch.toSatin.failed', true);
}

// Shapes and the frame ---------------------------------------------------------------------------

/** The object whose fill outline is edited (level Form), and the pattern its form was read from. */
let shapeObject: number | null = null;
let shapePattern: Pattern | null = null;

const shapeTool = new ShapeTool({
  change: (form) => commitShape(form),
  redraw: () => redraw(),
  say: (key) => {
    layers.say(t(key), true);
    redraw();
  },
});

/** The one selected object of the Ablauf mode, when it has a fill whose outline can be edited. */
function shapeTarget(p: Pattern, q: Sequence, o: number): Form | null {
  const obj = q.objects[o];
  return obj ? formOf(p, obj, q.kinds) : null;
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
    editObject = null;
  }
  if (!selectedObjects.has(o) || selectedObjects.size !== 1) selectObjects([o], false);
  shapeTool.open(form);
  shapeObject = o;
  shapePattern = p;
  frameTool.close();
  const obj = q.objects[o];
  if (fit) {
    const w = ((obj.maxX - obj.minX) / 10) * vp.scale;
    const h = ((obj.maxY - obj.minY) / 10) * vp.scale;
    if (Math.max(w / stageW, h / stageH) < 0.4) vp.fit(obj.minX / 10, obj.minY / 10, obj.maxX / 10, obj.maxY / 10, stageW, stageH, 60);
  }
  updateLevel();
  redraw();
}

function closeShape(): void {
  if (!shapeTool.active) return;
  shapeTool.close();
  shapeObject = null;
  shapePattern = null;
  updateLevel();
  redraw();
}

/** Keeps the shape tool on its object after new stitches, undo or redo; it closes when the object has no fill any more. */
function syncShape(): void {
  if (!shapeTool.active) return;
  const p = files.active?.pattern;
  if (!p || settings.mode !== 'flow' || selectedObjects.size !== 1) return closeShape();
  if (p === shapePattern) return;
  const q = seq(p);
  const o = [...selectedObjects][0];
  const form = shapeTarget(p, q, o);
  if (!form) return closeShape();
  shapeTool.setForm(form);
  shapeObject = o;
  shapePattern = p;
}

/** The fill sewn anew in its changed outline (one undo step). */
function commitShape(form: Form): void {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p || shapeObject === null) return;
  const q = seq(p);
  const obj = q.objects[shapeObject];
  if (!obj) return;
  const hand = remembered(p, obj)?.hand ?? 0;
  const r = reshapeFill(p, q.objects, obj, q.kinds, form, settings.trimMm);
  if (!r || !r.starts.length) {
    // Nothing to fill there (too small, or the outline crosses itself away): back to the old one.
    shapeTool.setForm(shapeTarget(p, q, shapeObject) ?? form);
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
  const sel = selectedObjects;
  files.setPattern(f, r.pattern, { record: false });
  syncPlayer();
  recompute();
  files.setObjects(f, rememberedIn(r.pattern, seq(r.pattern).objects));
  selectedObjects = sel;
  selectionKey++;
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
  selectedObjects = new Set(select);
  selectionKey++;
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

/** Shape aside hovered in its list, shown on the canvas. */
let hoverAside: number | null = null;
let asideShown: AsideShape[] | null = null;

const asidePanel = new AsidePanel({
  sew: (id) => {
    const p = files.active?.pattern;
    if (!p) return;
    const r = sewAgain(p, id, { ...digitizeDefaults(settings.profile), trimMm: settings.trimMm });
    if (!r) return layers.say(t('aside.failed'), true);
    const mine = seq(r.pattern).objects.findIndex((o) => stitchesBefore(r.pattern, o.first) === r.start);
    hoverAside = null;
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
    hoverAside = null;
    applyEdit(next);
    layers.say(t('aside.done.dropped'));
  },
  hover: (id) => {
    if (hoverAside === id) return;
    hoverAside = id;
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
/** The next file opened keeps the view (a design started by drawing stays where it was drawn). */
let keepView = false;

const drawTool = new DrawTool({ done: (s) => void drawn(s), redraw });
const drawButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-draw]')];

/** Picks a drawing tool, or none. */
function setDrawing(kind: DrawKind | null): void {
  if (kind && settings.mode !== 'flow') return;
  if (kind) {
    if (editor.active) setEditing(false);
    if (shapeTool.active) closeShape();
    if (rungTool.active) closeRungs();
  }
  drawTool.start(kind);
  for (const b of drawButtons) b.setAttribute('aria-pressed', String(b.dataset.draw === kind));
  stage.classList.toggle('drawing', !!kind);
  updateLevel();
  redraw();
}
drawButtons.forEach((b) => b.addEventListener('click', () => setDrawing(drawTool.kind === b.dataset.draw ? null : (b.dataset.draw as DrawKind))));

/** A shape is drawn: sewn in the thread of the selected object right after it, else after the last one. */
async function drawn(shape: NewShape): Promise<void> {
  const f = files.active;
  const p = f?.pattern ?? null;
  const options = { ...digitizeDefaults(settings.profile), trimMm: settings.trimMm };
  if (!f || !p) {
    // Nothing open yet: the shape starts a new design.
    const d = digitizeShapes([{ color: 0, ...shape }], [FIRST_THREAD], options, { w: 0, h: 0 }, false, 'shape');
    if (!d.objects.length) return layers.say(t('draw.failed'), true);
    keepView = true;
    await addDigitized(d, t('draw.newName'));
    keepView = false;
    selectObjects([0], false);
    return;
  }
  const q = seq(p);
  const sel = [...selectedObjects].sort((a, b) => a - b);
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
  const sel = selectedObjects;
  applyEdit(r.pattern);
  files.setObjects(f, rememberedIn(r.pattern, seq(r.pattern).objects));
  selectedObjects = sel;
  selectionKey++;
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
      flowPreview = null;
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
      flowPreview = next !== p ? next : null;
      redraw();
    });
  },
});

/** The objects the frame is on: the selected ones in the Ablauf mode, level Objects (in sewing order). */
function frameObjects(): number[] {
  if (settings.mode !== 'flow' || !selectedObjects.size || editor.active || shapeTool.active || rungTool.active || orderCard.isOpen) return [];
  const n = files.active?.pattern ? seq(files.active.pattern).objects.length : 0;
  return [...selectedObjects].filter((o) => o < n).sort((a, b) => a - b);
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
  if (frameTool.dragging !== null || (frameTool.active && frameKey?.p === p && frameKey.sel === selectedObjects)) return;
  frameKey = { p, sel: selectedObjects };
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
  applyEdit(cur);
  const nq = seq(cur);
  files.setObjects(f, rememberedIn(cur, nq.objects));
  selectedObjects = nq.objects.length === seq(p).objects.length ? new Set(sel) : new Set();
  selectionKey++;
  if (restitched && hand) layers.say(t('shape.handReplaced', { n: formatNumber(hand) }));
  followKnockouts();
  redraw();
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
    selectedObjects = new Set();
    hiddenBlocks = new Set();
    focusBlock = null;
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
  vp.fit(cx - half, cy - half, cx + half, cy + half, stageW, stageH);
}

function selectJump(k: number | null): void {
  selectedJump = k;
  if (k !== null) showJump(k);
  redraw();
}

const jumpsPanel = new JumpsPanel(settings, {
  select: selectJump,
  hover: (k) => {
    hoverJump = k;
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
    const keep = selectedJump;
    applyEdit(next);
    // The jumps stay the same ones in the same order, so the selection carries over.
    selectedJump = keep;
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
  const i = selectedJump !== null ? shown.indexOf(selectedJump) : -1;
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
  const flip = sx > stageW - tooltip.offsetWidth - 30;
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
    comparing = false;
    hoverZone = null;
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
  const selected = [...selectedObjects].sort((a, b) => a - b);
  return {
    objects: q.objects,
    selected,
    layering: selected.map((o) => ({ below: over[o].length, above: over.filter((l) => l.includes(o)).length })),
    numbers: selected.map((o) => numberInColor(q.objects, q.objects[o])),
    hand: selected.map((o) => remembered(p, q.objects[o])?.hand ?? 0),
    editing: editor.active && editObject !== null && selected.length === 1 && selected[0] === editObject ? { selection: editor.selection.size } : null,
    shapeable: selected.length === 1 && !!stitchInfo(p, q).measured.fill,
    shaping: shapeTool.active && selected.length === 1 && selected[0] === shapeObject ? { nodes: shapeTool.count, smooth: shapeTool.selectedSmooth } : null,
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
      imageMode.draw(ctx, stageW, stageH, vp, stageBg());
      empty.hidden = imageMode.hasImage;
      return;
    }
    syncRungs();
    syncShape();
    syncFrame();
    drawScene(ctx, stageW, stageH, scene(), stageBg());
    const aside = settings.mode === 'flow' ? asideOf(files.active?.pattern) : [];
    if (aside.length) drawAside(ctx, vp, aside, hoverAside);
    if (asideShown !== aside) {
      asideShown = aside;
      asidePanel.update(aside);
    }
    if (drawTool.preview && settings.mode === 'flow')
      drawDrawing(ctx, vp, drawTool.preview, { nodes: drawTool.kind === 'pen' ? drawTool.count : 0, closing: drawTool.closing, size: drawTool.size });
    if (showCompare()) {
      const x = Math.round(split * stageW);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, stageH);
      ctx.clip();
      drawScene(ctx, stageW, stageH, originalScene(), stageBg());
      ctx.restore();
      drawDivider(ctx, x, stageH, t('compare.original'), t('compare.current'));
    }
    const active = files.active;
    empty.hidden = !!active?.pattern || drawTool.active;
    exportBtn.disabled = !active?.pattern;
    $('file-actions').hidden = !active?.pattern;
    if (settings.mode === 'density') drawLegendCanvas();
    renderStats($('stats'), active, grid, settings, computing);
    const p = active?.pattern ?? null;
    const q = p ? seq(p) : null;
    $('player').hidden = !p;
    if (settings.mode === 'flow') {
      const current = p && !player.complete ? seq(p).markers.colorStarts.filter((i) => q!.numbers[i] <= Math.max(1, player.pos)).length - 1 : null;
      layers.update(
        {
          blocks: q?.blocks ?? [],
          objects: q?.objects ?? [],
          selected: selectedObjects,
          hidden: hiddenBlocks,
          focus: focusBlock,
          current,
          original: active?.original?.colors ?? NO_COLORS,
          format: active?.pattern?.format ?? 'pes',
        },
        getLang(),
      );
      jumpsPanel.update({ list: q?.transitions ?? [], selected: selectedJump, lang: getLang() });
      objectPanel.update(p && q && selectedObjects.size ? objectInfo(p, q) : null, getLang());
      stitchPanel.update(p && q && selectedObjects.size ? { ...stitchInfo(p, q), ...rungInfo(p, q) } : null);
      updateOverlapCard();
      $<HTMLButtonElement>('order-optimize').disabled = !q || q.objects.length < 2;
    }
    panel.update(active, selectedZone);
    correctPanel.update({
      file: active,
      zoneSelected: !!selectedZone,
      editing: editor.active,
      comparing,
      selection: editor.selection.size,
      pointsVisible: vp.scale >= POINTS_MIN_SCALE,
      message: correctMessage,
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
  gridImg = grid ? gridToCanvas(grid, max) : null;
  origGridImg = origGrid ? gridToCanvas(origGrid, max) : null;
}

let debounce = 0;
function recompute(): void {
  clearTimeout(debounce);
  const pattern = files.active?.pattern;
  if (!pattern || settings.mode !== 'density') {
    computing = false;
    redraw();
    return;
  }
  computing = true;
  redraw();
  debounce = window.setTimeout(async () => {
    const { metric, cellMm, blurMm, includeJumps } = settings;
    const seq = ++densitySeq;
    try {
      const g = await density.density(pattern, { metric, cellMm, blurMm, includeJumps });
      // A newer request or another file supersedes this result.
      if (seq !== densitySeq || files.active?.pattern !== pattern) return;
      grid = g;
      // The comparison needs the original's heatmap with the same settings.
      const f = files.active;
      const opts = JSON.stringify([metric, cellMm, blurMm, includeJumps]);
      if (showCompare() && f?.original && (origKey?.p !== f.original || origKey.opts !== opts)) {
        const og = await density.density(f.original, { metric, cellMm, blurMm, includeJumps });
        if (seq !== densitySeq || files.active !== f) return;
        origGrid = og;
        origKey = { p: f.original, opts };
      }
      computing = false;
      rebuildGridImage();
    } catch (err) {
      console.error(err);
      computing = false;
    }
    redraw();
  }, 60);
}

function selectZone(z: Zone): void {
  const pad = 4; // mm of context around the zone
  const b = z.bbox;
  selectedZone = z;
  if (!settings.showValidation) {
    settings.showValidation = true;
    saveSettings(settings);
    controls.refresh();
  }
  vp.fit(b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad, stageW, stageH);
  redraw();
}

/** Jumps to the next (dir 1) or previous (dir -1) zone the findings list shows, worst first. */
function stepZone(dir: 1 | -1): void {
  const all = files.active?.validation?.zones;
  if (!all) return;
  const zones = panel.visible(all);
  if (!zones.length) return;
  const i = selectedZone ? zones.indexOf(selectedZone) : -1;
  selectZone(zones[i < 0 ? (dir > 0 ? 0 : zones.length - 1) : (i + dir + zones.length) % zones.length]);
}

function fitView(f: LoadedFile | null = files.active): void {
  if (settings.mode === 'image') {
    imageMode.fit(vp, stageW, stageH);
    redraw();
    return;
  }
  const b = f?.pattern?.bounds;
  if (!b) return;
  vp.fit(b.minX / 10, b.minY / 10, b.maxX / 10, b.maxY / 10, stageW, stageH);
  redraw();
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const first = stageW === 0;
  stageW = stage.clientWidth;
  stageH = stage.clientHeight;
  canvas.width = Math.round(stageW * dpr);
  canvas.height = Math.round(stageH * dpr);
  if (first) fitView();
  redraw();
}
new ResizeObserver(resize).observe(stage);

// Correction and editing -----------------------------------------------------

/** Stores an edited pattern for the active file (one undo step) and refreshes everything. */
function applyEdit(p: Pattern, measurement?: Measurement): void {
  const f = files.active;
  if (!f?.pattern) return;
  hoverZone = selectedZone = null;
  files.setPattern(f, p, { measurement });
  syncPlayer();
  recompute();
}

/** After an edit, undo or redo: the player follows the new version and stays where it was. */
function syncPlayer(): void {
  player.setModel(playerModel(files.active?.pattern ?? null), true);
  hoverJump = null;
  if (selectedJump !== null && selectedJump >= (files.active?.pattern ? seq(files.active.pattern).transitions.length : 0)) selectedJump = null;
  const blocks = files.active?.pattern ? seq(files.active.pattern).blocks.length : 0;
  const objs = files.active?.pattern ? seq(files.active.pattern).objects.length : 0;
  if ([...selectedObjects].some((o) => o >= objs)) selectedObjects = new Set();
  if (editObject !== null && editObject >= objs) editObject = null;
  hoverObject = null;
  if (orderCard.isOpen) orderCard.close(true);
  if ([...hiddenBlocks].some((b) => b >= blocks) || (focusBlock ?? -1) >= blocks) {
    hiddenBlocks = new Set();
    focusBlock = null;
  }
}

const editor = new Editor({
  pattern: () => files.active?.pattern ?? null,
  commit: (p, change) => commitHand(p, change),
  range: () => {
    if (settings.mode !== 'flow') return null;
    const p = files.active?.pattern;
    const o = p && editObject !== null ? seq(p).objects[editObject] : undefined;
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
  const editing = editObject !== null && moved.has(editObject) ? moved.get(editObject)! : editObject;
  applyEdit(next);
  files.setObjects(f, rememberedIn(next, seq(next).objects));
  if (editObject !== null) {
    editObject = editing !== null && editing >= 0 ? editing : null;
    selectedObjects = editObject !== null ? new Set([editObject]) : new Set();
  }
  selectionKey++;
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
  editObject = o;
  if (!selectedObjects.has(o) || selectedObjects.size !== 1) selectObjects([o], false);
  if (fit) {
    const w = ((obj.maxX - obj.minX) / 10) * vp.scale;
    const h = ((obj.maxY - obj.minY) / 10) * vp.scale;
    if (Math.max(w / stageW, h / stageH) < 0.4) vp.fit(obj.minX / 10, obj.minY / 10, obj.maxX / 10, obj.maxY / 10, stageW, stageH, 60);
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
  const dx = sx < m ? m - sx : sx > stageW - m ? stageW - m - sx : 0;
  const dy = sy < m ? m - sy : sy > stageH - m ? stageH - m - sy : 0;
  if (dx || dy) vp.pan(dx, dy);
  redraw();
}

function setEditing(on: boolean): void {
  if (on) closeRungs();
  if (on) closeShape();
  if (on && settings.mode === 'flow' && selectedObjects.size === 1) return enterObject([...selectedObjects][0], true);
  editor.setActive(on);
  editObject = null;
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
    crumb.textContent = q && editObject !== null && q.objects[editObject] ? t('level.in', { name: objectName(q, editObject) }) : t('level.pick');
  } else if (shaping && flow) {
    const q = p ? seq(p) : null;
    crumb.textContent = q && shapeObject !== null && q.objects[shapeObject] ? t('level.inShape', { name: objectName(q, shapeObject) }) : '';
  }
  const mode = settings.mode;
  $('canvas-hint').textContent = t(
    mode === 'image' ? 'canvas.hint.image' : drawTool.kind && flow ? `canvas.hint.draw.${drawTool.kind}` : on ? (flow ? 'canvas.hint.flowEdit' : 'canvas.hint.edit') : shaping ? 'canvas.hint.shape' : flow ? 'canvas.hint.flow' : 'canvas.hint',
  );
}

function setComparing(on: boolean): void {
  comparing = on;
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
  hoverZone = selectedZone = null;
  correctMessage = null;
  syncPlayer();
  recompute();
}

async function autoFix(scope: 'all' | 'zone'): Promise<void> {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p || correctMessage?.kind === 'busy') return;
  const z = selectedZone;
  const pad = 1; // mm around the zone
  const region = scope === 'zone' && z
    ? { minX: z.bbox.minX - pad, minY: z.bbox.minY - pad, maxX: z.bbox.maxX + pad, maxY: z.bbox.maxY + pad }
    : undefined;
  correctMessage = { kind: 'busy' };
  redraw();
  try {
    const r = await validator.correct(p, settings.profile, settings.checks, { ...settings.correction, region, acks: f.acks });
    if (files.active !== f || f.pattern !== p) return; // the user moved on meanwhile
    correctMessage = { kind: 'report', report: r.report };
    editor.reset();
    if (r.pattern !== p) applyEdit(r.pattern, r.measurement);
  } catch (err) {
    correctMessage = { kind: 'text', text: t('correct.error', { msg: err instanceof Error ? err.message : String(err) }) };
  }
  redraw();
}

const correctPanel = new CorrectPanel(settings, {
  autoFix: (scope) => void autoFix(scope),
  toggleCompare: () => setComparing(!comparing),
  deleteSelection: () => editor.deleteSelection(),
  thinSelection: (share) => {
    if (!editor.thinSelection(share)) correctMessage = { kind: 'text', text: t('edit.thin.none') };
    redraw();
  },
  undo: () => history('undo'),
  redo: () => history('redo'),
  revert: () => history('revert'),
  save: (format) => {
    const f = files.active;
    if (f?.pattern) downloadPattern(f.pattern, format, outputFileName(f.fileName, format, FileList.edited(f)));
  },
  optionsChanged: () => saveSettings(settings),
});

// Controls, language, export --------------------------------------------------

const controls = bindControls(settings, (kind: ChangeKind) => {
  saveSettings(settings);
  if (kind === 'density') recompute();
  else if (kind === 'style') redraw();
  else {
    rebuildGridImage();
    redraw();
  }
});

const profile = bindProfile(settings, () => {
  saveSettings(settings);
  // Classification is cheap: every file is re-checked instantly against the new limits.
  files.setProfile(settings.profile, settings.checks);
  imageMode.profileChanged();
  controls.refresh();
  hoverZone = selectedZone = null;
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
  validate: async (p) => classify(await validator.measure(p), settings.profile, settings.checks),
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
  asideShown = null;
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
  const o = selectedObjects.size === 1 ? [...selectedObjects][0] : null;
  if (p && o !== null && shapeTarget(p, seq(p), o)) return enterShape(o, true);
  layers.say(t(o === null ? 'shape.pick' : 'shape.noFill'), true);
  updateLevel();
  redraw();
}
exportBtn.addEventListener('click', () => {
  const p = files.active?.pattern;
  if (p) exportPng({ ...scene(), edit: null }, stageW, stageH, stageBg(), p.name || 'pattern');
});

// File input and drag & drop --------------------------------------------------

const input = $<HTMLInputElement>('file-input');
input.addEventListener('change', () => {
  if (input.files) void openFiles(input.files);
  input.value = '';
});

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

/** Embroidery files go to the file list, an image to the Bild mode, a project opens everything it holds. */
const isSvgFile = (f: File) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);

async function openFiles(list: Iterable<File>): Promise<void> {
  const all = [...list];
  for (const f of all.filter((f) => isProjectName(f.name))) await openProject(f);
  const image = all.find((f) => f.type.startsWith('image/') || IMAGE_FILE.test(f.name));
  const rest = all.filter((f) => f !== image && !isProjectName(f.name) && !f.type.startsWith('image/') && !IMAGE_FILE.test(f.name));
  if (image && isSvgFile(image)) {
    // An SVG of shapes opens as stitches in Ablauf, every shape whole; the Bild mode only for SVGs
    // that are pictures (embedded photos, many colors).
    try {
      const d = await digitizeSvg(image, settings.image.prepare, digitizeDefaults(settings.profile));
      await addDigitized(d, image.name.replace(/\.svg$/i, ''));
      setMode('flow');
    } catch {
      setMode('image');
      void imageMode.load(image);
    }
  } else if (image) {
    setMode('image');
    void imageMode.load(image);
  }
  return rest.length ? files.add(rest) : Promise.resolve();
}

// Project files ---------------------------------------------------------------

/** Name of the project file: after the active design, else the image. */
function projectName(): string {
  const base = files.active?.fileName.replace(/\.[^.]+$/, '') || imageMode.snapshot()?.image.name.replace(/\.[^.]+$/, '') || 'heatstitch';
  return `${base}${PROJECT_EXT}`;
}

/** Everything open in the app as a project: the files with their edits, the image and the design settings. */
function currentProject(): Project {
  const list = files.files.filter((f) => f.pattern && f.data);
  const active = list.findIndex((f) => f === files.active);
  const snap = imageMode.snapshot();
  return {
    files: list.map((f) => ({
      name: f.fileName,
      data: f.data!,
      ...(FileList.edited(f) ? { working: toStored(f.pattern!) } : {}),
      acks: f.acks,
      objects: rememberedIn(f.pattern!, seq(f.pattern!).objects),
      ...(asideOf(f.pattern).length ? { aside: storeAside(asideOf(f.pattern)) } : {}),
    })),
    active: active >= 0 ? active : null,
    image: snap && { name: snap.image.name, type: snap.image.type, data: new Uint8Array(snap.image.data), work: snap.work },
    settings: projectSettings(settings),
  };
}

async function saveProject(): Promise<void> {
  const bytes = await encodeProject(currentProject());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: PROJECT_MIME }));
  a.download = projectName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('save-project').addEventListener('click', () => void saveProject());
$('image-save-project').addEventListener('click', () => void saveProject());

/** Takes over the material, checks, correction and order options of a project (and its image's, if it has one). */
function applyProjectSettings(s: ProjectSettings, withImage: boolean): void {
  if (s.profile.thread !== settings.profile.thread) settings.threadMm = threadWidthMm(s.profile);
  settings.profile = s.profile;
  settings.checks = s.checks;
  // The panels keep these objects, so they change in place.
  Object.assign(settings.correction, s.correction);
  Object.assign(settings.order, s.order);
  settings.trimMm = s.trimMm;
  settings.machineSpm = s.machineSpm;
  if (s.background !== undefined) settings.background = s.background;
  if (withImage) {
    Object.assign(settings.image.prepare, s.image.prepare);
    for (const k of Object.keys(settings.image.stitch)) delete settings.image.stitch[k as keyof typeof settings.image.stitch];
    Object.assign(settings.image.stitch, s.image.stitch);
  }
  saveSettings(settings);
  files.setProfile(settings.profile, settings.checks);
  profile.refresh();
  controls.refresh();
  correctPanel.sync();
  imageMode.profileChanged();
}

async function openProject(file: File): Promise<void> {
  let project: Project;
  try {
    project = await decodeProject(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    console.warn('Could not open the project', err);
    files.addError(file.name, t(err instanceof ProjectError && err.reason === 'newer' ? 'project.error.newer' : 'project.error.invalid'));
    if (settings.mode === 'image') setMode('flow');
    return;
  }
  applyProjectSettings(project.settings, !!project.image);
  if (project.image) await imageMode.open({ ...project.image, data: project.image.data.slice().buffer }, project.image.work);
  if (project.files.length) {
    await files.addProject(project.files, project.active);
    if (settings.mode === 'image') setMode('flow');
  } else if (project.image) setMode('image');
  redraw();
}

const exampleSelect = $<HTMLSelectElement>('load-example');
exampleSelect.addEventListener('change', async () => {
  const path = exampleSelect.value;
  exampleSelect.value = '';
  if (!path) return;
  const name = path.split('/').pop()!;
  const svg = name.endsWith('.svg');
  // An SVG example is sewn first, which takes a moment: the list says so meanwhile.
  const label = exampleSelect.options[0];
  if (svg) {
    exampleSelect.disabled = true;
    label.textContent = t('files.example.loading');
  }
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = new File([await res.blob()], name, svg ? { type: 'image/svg+xml' } : undefined);
    if (svg) {
      const d = await digitizeSvg(file, settings.image.prepare, digitizeDefaults(settings.profile));
      await addDigitized(d, name.replace(/\.svg$/, ''));
    } else await files.add([file]);
  } catch (err) {
    console.error('Loading the example failed', err);
  } finally {
    exampleSelect.disabled = false;
    label.textContent = t('files.example');
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++dragDepth === 1) document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (e.dataTransfer?.files.length) void openFiles(e.dataTransfer.files);
});

// Installed PWA opened via "Open with" on a .dst/.pes file (manifest file_handlers).
interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}
const launchQueue = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } })
  .launchQueue;
launchQueue?.setConsumer(async (params) => {
  if (params.files.length) void openFiles(await Promise.all(params.files.map((h) => h.getFile())));
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
    if (e.key === 'Enter' && shapeObject !== null) return enterObject(shapeObject, false);
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
    if (editor.active) {
      if (e.key === 'Escape') return setEditing(false);
      if (e.key === ',' || e.key === '.') {
        e.preventDefault();
        const i = editor.step(e.key === '.' ? 1 : -1);
        if (i >= 0) revealRecord(i);
        return;
      }
    } else if (e.key === 'Enter' && selectedObjects.size === 1) return enterShape([...selectedObjects][0], true);
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
      else if (selectedObjects.size) selectedObjects = new Set();
      else selectedJump = focusBlock = null;
      redraw();
    }
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'j') files.step(1);
  else if (e.key === 'ArrowUp' || e.key === 'k') files.step(-1);
  else if (e.key === 'f') fitView();
  else if (e.key === 'e') setEditing(!editor.active);
  else if (e.key === 'c' && FileList.edited(files.active)) setComparing(!comparing);
  else if (e.key === 'n') stepZone(1);
  else if (e.key === 'N') stepZone(-1);
  else if (e.key === 'v') {
    settings.showValidation = !settings.showValidation;
    saveSettings(settings);
    controls.refresh();
    redraw();
  } else if (e.key === 'Escape' && selectedZone) {
    selectedZone = null;
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
  const left = showCompare() && sx < split * stageW;
  const f = files.active;
  updateTooltip(tooltip, sx, sy, stageW, vp, left ? origGrid : grid, settings, (left ? f?.originalValidation : f?.validation) ?? null);
}

const nearDivider = (sx: number) => showCompare() && Math.abs(sx - split * stageW) <= DIVIDER_GRAB_PX;

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
  if (pointers.size === 1 && e.button === 0 && nearDivider(pos[0])) {
    splitDrag = true;
    stage.classList.add('splitting');
    return;
  }
  if (pointers.size === 1 && e.button === 0) {
    const [wx, wy] = vp.toWorld(pos[0], pos[1]);
    const flow = settings.mode === 'flow';
    if (drawTool.active && flow) {
      drawTool.down(wx, wy, vp.scale);
      mode = 'move';
    } else if (rungTool.active && flow) mode = rungTool.down(wx, wy, vp.scale);
    else if (shapeTool.active && flow) mode = shapeTool.down(wx, wy, vp.scale);
    else if (frameTool.active && flow && frameTool.down(wx, wy, vp.scale) !== null) mode = 'frame';
    else mode = editor.down(wx, wy, pos[0], pos[1], e.shiftKey, vp.scale);
  }
  pressMode = mode;
  if (mode === 'pan') canvas.classList.add('panning');
  if (pointers.size === 2) {
    editor.cancel();
    rungTool.cancel();
    shapeTool.cancel();
    drawTool.abortPress();
    if (frameTool.dragging !== null) {
      frameTool.cancel();
      flowPreview = null;
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
    lightFromPointer(pos[0], pos[1], stageW, stageH);
    redraw();
  }
  if (splitDrag) {
    split = Math.min(0.98, Math.max(0.02, pos[0] / stageW));
    redraw();
    return;
  }
  canvas.classList.toggle('on-divider', !prev && nearDivider(pos[0]));
  if (prev) {
    if (pointers.size === 1) {
      if (!drawTool.dragTo(wx, wy, e.shiftKey, e.altKey) && !rungTool.dragTo(wx, wy) && !shapeTool.dragTo(wx, wy) && !frameTool.dragTo(wx, wy, e.shiftKey, vp.scale) && !editor.dragTo(wx, wy, pos[0], pos[1])) vp.pan(pos[0] - prev[0], pos[1] - prev[1]);
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

const endPointer = (e: PointerEvent) => {
  const pos = local(e);
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
  if (pressAt && e.type === 'pointerup' && settings.mode === 'flow' && (pressMode === 'pan' || frameClick) && !rungTool.active && Math.hypot(pos[0] - pressAt[0], pos[1] - pressAt[1]) < 4) {
    const p = files.active?.pattern;
    if (p && shapeTool.active) {
      // Editing an outline: a click on another object goes on with its outline, a click beside it back to the objects.
      const st = styleFor(p);
      const [x, y] = vp.toWorld(pos[0], pos[1]);
      const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / vp.scale), st.limit, st.alpha);
      const o = i >= 0 ? seq(p).objectAt[i] : -1;
      if (o >= 0 && o !== shapeObject && !shapeTool.near(x, y, vp.scale)) enterShape(o, false);
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
      if (o >= 0 && o !== editObject) enterObject(o, editObject === null);
      else if (o < 0 && !editor.selection.size) setEditing(false);
    } else if (p) {
      const q = seq(p);
      const k = transitionAt(p, q.transitions, vp, pos[0], pos[1]);
      if (k >= 0 || selectedJump !== null) {
        selectedJump = k >= 0 ? k : null;
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
        else if (!add && selectedObjects.size) selectObjects([], false);
      }
    }
  }
  pressAt = null;
  if (splitDrag) {
    splitDrag = false;
    stage.classList.remove('splitting');
  }
  if (pointers.size === 1 && pointers.has(e.pointerId)) {
    drawTool.up(...vp.toWorld(pos[0], pos[1]), e.shiftKey, e.altKey);
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
  editor.cancel();
  rungTool.cancel();
  shapeTool.cancel();
  frameTool.cancel();
  flowPreview = null;
  endPointer(e);
});
canvas.addEventListener('pointerleave', () => {
  tooltip.hidden = true;
  if (settings.mode === 'image') {
    imageMode.leave();
    redraw();
  }
});
// The right button pans while painting.
canvas.addEventListener('contextmenu', (e) => {
  if (settings.mode === 'image') e.preventDefault();
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
    if (o >= 0) return enterShape(o, true);
  }
  fitView();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);

files.render();
redraw();
void files.restore();
void imageMode.restore();
