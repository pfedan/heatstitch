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
import { SATIN_SHARE } from './model/covers';
import { currentSettings } from './correct/plan';
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
} from './model/sequence';
import { recolor, sameColor } from './model/recolor';
import { COLOR_CHANGE, patternStats, STITCH, TRIM } from './model/pattern';
import { stitchAlpha, stitchAt, stitchColors, type StitchStyle } from './render/flow';
import type { FlowScene, ShapeOutline } from './render/scene';
import type { Mode } from './settings';
import { JumpsPanel } from './ui/jumpsPanel';
import { blockName, kindLabel, LayersPanel } from './ui/layersPanel';
import { ObjectPanel, OrderCard } from './ui/objectPanel';
import { StitchPanel, type Highlight, type StitchInfo } from './ui/stitchPanel';
import { borderRanges, syncBorders } from './model/border';
import { analyze, openOnPurpose, objectKey, measureFill, measureRun, measureSatin, remember, remembered, rememberedIn, rememberShapes, restitch, shapeTrust, unionRegion, underlayRanges, type Remembered, type Settings as RestitchSettings, type ShapeTrust, type RestitchResult } from './model/restitch';
import { outline } from './digitize/region';
import type { Pt } from './digitize/skeleton';
import { drawAside, drawDrawing, type FlatArea } from './render/shapeOverlay';
import type { LeftOut } from './ui/imageMode';
import { lineSettings, lineToFill } from './model/line';
import { borderLines } from './model/along';
import { asideOf, storeAside, type AsideShape } from './model/aside';
import { recolorObjects, unionForm } from './model/shapeOps';
import { formOf } from './model/reshape';
import { isCovered, setOverlapShare, wholeArea, wholeOf } from './model/knockout';
import { type Form } from './shape/path';
import { digitizeDefaults, isStroke, pullFor, SATIN_MAX, type Digitized } from './digitize/digitize';
import { recommendedSpacing } from './validation/profiles';
import { numberInColor, overlaps, rememberObjects, sewObjects, splitObject, type SewObject } from './model/objects';
import { conflicts, moveStats, optimizePlan, reorder, violations, weigh } from './model/order';
import { autoReversible, reverseObjects, reversible } from './model/reverse';
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
  // New stitches have a shape they can be loosed from; the outlines follow a changed area (a
  // fill along a line gets wider), the measured values stay as set in the panel.
  const kept = ui.stitchCache && !remeasure && p === r.pattern ? ui.stitchCache.info : null;
  ui.stitchCache = null;
  if (kept) ui.stitchCache = { p, key: ui.selectionKey, info: { ...kept, free: freeOf(p, seq(p)), outlines: stitchInfo(p, seq(p)).outlines } };
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

// Stitch order, jumps, the Ablauf tooltip and the modes ---------------------------

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
