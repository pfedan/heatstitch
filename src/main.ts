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
import { recolor } from './model/recolor';
import { COLOR_CHANGE, patternStats, STITCH, TRIM } from './model/pattern';
import { stitchAlpha, stitchAt, stitchColors, transitionAt, type StitchStyle } from './render/flow';
import type { FlowScene, ShapeOutline } from './render/scene';
import type { Mode } from './settings';
import { JumpsPanel } from './ui/jumpsPanel';
import { type Blocked, kindLabel, LayersPanel } from './ui/layersPanel';
import { ObjectPanel, OrderCard } from './ui/objectPanel';
import { StitchPanel, type StitchInfo } from './ui/stitchPanel';
import { analyze, measureFill, measureRun, measureSatin, remember, remembered, rememberedIn, rememberShapes, restitch, shapeTrust, unionRegion, type Settings as RestitchSettings, type ShapeTrust, type RestitchResult } from './model/restitch';
import { outline } from './digitize/region';
import { digitizeDefaults, isStroke, SATIN_MAX } from './digitize/digitize';
import { recommendedSpacing } from './validation/profiles';
import { numberInColor, overlaps, rememberObjects, sewObjects, splitObject, type SewObject } from './model/objects';
import { conflicts, moveStats, optimizeOrder, reorder, violations } from './model/order';
import { Player } from './ui/player';
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
    if (f?.pattern) fitView(f);
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
/** One empty list, so the colors list is not rebuilt on every redraw (it compares by identity). */
const NO_COLORS: readonly ThreadColor[] = [];

const overOf = (q: Sequence, p: Pattern) => (q.over ??= overlaps(p, q.objects));

function resetFlow(): void {
  hiddenBlocks = new Set();
  focusBlock = hoverBlock = selectedJump = hoverJump = hoverObject = null;
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

function flowScene(): FlowScene | null {
  const p = flowPreview ?? files.active?.pattern;
  if (settings.mode !== 'flow' || !p) return null;
  const q = seq(p);
  const style = styleFor(p);
  return {
    style,
    markers: q.markers,
    hover: hoverJump !== null ? (q.transitions[hoverJump] ?? null) : null,
    selected: selectedJump !== null ? (q.transitions[selectedJump] ?? null) : null,
    needle: player.complete ? -1 : style.limit,
    // The areas as recognized on the file itself, also while a change is previewed.
    outlines: files.active?.pattern && selectedObjects.size ? stitchInfo(files.active.pattern, seq(files.active.pattern)).outlines : undefined,
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
  move: (order, moved) => moveObjects(order, moved),
});

/** Name of an object as the list shows it: kind and number within its color. */
function objectName(q: Sequence, i: number): string {
  const o = q.objects[i];
  const k = numberInColor(q.objects, o);
  return `${kindLabel(o.kind)} ${k} (${o.block + 1}. ${o.color.name || t('layers.unnamed', { n: o.block + 1 })})`;
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
  layers.reveal([...next]);
  redraw();
  if (next.size) requestAnimationFrame(() => $('object-panel').scrollIntoView({ block: 'nearest' }));
}

/**
 * Sews the objects in `order` (an edit that can be undone), unless that puts an object before
 * something it lies on; then the reason is returned. The moved objects stay selected.
 */
function moveObjects(order: number[], moved: number[], force = false): Blocked | null {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p) return null;
  const q = seq(p);
  const over = overOf(q, p);
  const bad = force ? [] : violations(order, over);
  if (bad.length) {
    const movedSet = new Set(moved);
    const a = order[bad.find((k) => movedSet.has(order[k])) ?? bad[0]];
    const c = conflicts(order, over, a)[0];
    const blocked = (text: string): Blocked => ({ text, force: () => void moveObjects(order, moved, true) });
    if (c === undefined) return blocked(t('object.blocked', { a: objectName(q, a), b: '?' }));
    // The two objects are shown, so it is clear where they overlap.
    selectedObjects = new Set([a, c]);
    selectionKey++;
    focusBlock = null;
    layers.reveal([a, c]);
    redraw();
    return blocked(over[a].includes(c) ? t('object.blocked', { a: objectName(q, a), b: objectName(q, c) }) : t('object.blockedUnder', { a: objectName(q, a), b: objectName(q, c) }));
  }
  const starts: number[] = [];
  const next = reorder(p, q.objects, order, settings.trimMm, starts);
  if (next === p) return null;
  const keepHidden = hiddenBlocks.size;
  applyEdit(next, f.measurement);
  if (keepHidden) hiddenBlocks = new Set();
  // The moved objects stay selected: found again by their first stitch.
  const nq = seq(next);
  const movedSet = new Set(moved);
  selectedObjects = new Set(order.flatMap((o, k) => (movedSet.has(o) ? [nq.objectAt[recordOfStitch(nq.numbers, starts[k] + 1)]] : [])).filter((o) => o >= 0));
  layers.reveal([...selectedObjects]);
  layers.say(t('object.moved'));
  redraw();
  return null;
}

/**
 * Sews the selected objects as one: they move to where the first one is sewn (if the layers allow
 * it, as when moving them), and fills become one area, sewn anew with the first one's settings.
 */
function mergeObjects(force = false): Blocked | null {
  const f = files.active;
  const p = f?.pattern;
  if (!f || !p || selectedObjects.size < 2) return null;
  const q = seq(p);
  const sel = [...selectedObjects].sort((a, b) => a - b);
  const objs = sel.map((o) => q.objects[o]);
  if (mergeBlocked(objs)) return null;
  const set = new Set(sel);
  const order = [...q.objects.keys()].filter((o) => o < sel[0] || (o > sel[0] && !set.has(o)));
  order.splice(sel[0], 0, ...sel);
  const over = overOf(q, p);
  const bad = force ? [] : violations(order, over);
  if (bad.length) {
    const a = order[bad.find((k) => set.has(order[k])) ?? bad[0]];
    const c = conflicts(order, over, a)[0];
    const text = c === undefined ? t('object.blocked', { a: objectName(q, a), b: '?' }) : over[a].includes(c) ? t('object.blocked', { a: objectName(q, a), b: objectName(q, c) }) : t('object.blockedUnder', { a: objectName(q, a), b: objectName(q, c) });
    return { text, force: () => void mergeObjects(true) };
  }
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
  const area = fills ? unionRegion(objs.flatMap((o) => remembered(p, o)?.region ?? analyze(p, o, q.kinds).fill ?? [])) : null;
  if (merged >= 0 && fill && area) {
    remember(target, nq.objects[merged], { region: area, fill });
    const r = restitch(target, nq.objects, [merged], { kind: 'fill', s: fill }, nq.kinds, settings.trimMm);
    if (r.starts.length) {
      selectedObjects = new Set([merged]);
      applyRestitched(r, 'stitch.failed', true);
      layers.say(t('object.merged', { n: sel.length }));
      return null;
    }
  }
  applyEdit(target);
  if (merged >= 0) selectedObjects = new Set([merged]);
  selectionKey++;
  layers.say(t('object.merged', { n: sel.length }));
  redraw();
  return null;
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
  split: splitSelected,
  step: (dir) => {
    const p = files.active?.pattern;
    if (!p || selectedObjects.size !== 1) return null;
    const o = [...selectedObjects][0];
    const n = seq(p).objects.length;
    const k = o + dir;
    if (k < 0 || k >= n) return null;
    const order = Array.from({ length: n }, (_, i) => i);
    order[o] = k;
    order[k] = o;
    return moveObjects(order, [o]);
  },
  clear: () => {
    selectedObjects = new Set();
    selectionKey++;
    flowPreview = null;
    redraw();
  },
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
  const info: StitchInfo = { key: selectionKey, measured, counts, recommended: recommendedSpacing(settings.profile), shape: worst, outlines: shapes, toSatin: stroke };
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
    applyRestitched(restitched(s), pat === 'spiral' ? 'stitch.failedSpiral' : pat === 'contour' || pat === 'follow' ? 'stitch.failedCurved' : 'stitch.failed');
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
});

/** Color changes and trims as the statistics count them, travel between objects. */
function orderStats(p: Pattern) {
  const st = patternStats(p);
  return { colorChanges: st.colorChanges, trims: st.trims, travelMm: moveStats(p).travelMm };
}

/** The order "Optimize order" found for the active pattern, kept while its card is open. */
let pendingOrder: { p: Pattern; order: number[] } | null = null;

const orderCard = new OrderCard(settings, {
  preview: () => {
    const p = files.active?.pattern;
    if (!p) return null;
    const q = seq(p);
    const order = optimizeOrder(p, q.objects, overOf(q, p), { ...settings.order, trimMm: settings.trimMm });
    const changed = order.some((o, k) => o !== k);
    const next = changed ? reorder(p, q.objects, order, settings.trimMm) : p;
    pendingOrder = changed ? { p, order } : null;
    const before = orderStats(p);
    const after = orderStats(next);
    const secs = (x: Pattern, c: typeof before) => sewingSeconds(seq(x).total, c.trims, c.colorChanges, settings.machineSpm);
    return { before, after, beforeSeconds: secs(p, before), afterSeconds: secs(next, after), changed: changed && next !== p };
  },
  apply: () => {
    const f = files.active;
    const p = f?.pattern;
    if (!f || !p || pendingOrder?.p !== p) return;
    const before = orderStats(p);
    const next = reorder(p, seq(p).objects, pendingOrder.order, settings.trimMm);
    pendingOrder = null;
    selectedObjects = new Set();
    hiddenBlocks = new Set();
    focusBlock = null;
    applyEdit(next, f.measurement);
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
  if (mode !== 'density') {
    if (editor.active) setEditing(false);
    comparing = false;
    hoverZone = null;
  }
  if (mode !== 'flow') {
    player.pause();
    if (!player.complete) player.set(Number.MAX_SAFE_INTEGER);
  }
  controls.refresh();
  $('canvas-hint').textContent = t(mode === 'flow' ? 'canvas.hint.flow' : mode === 'image' ? 'canvas.hint.image' : 'canvas.hint');
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
    mergeBlocked: selected.length > 1 ? mergeBlocked(selected.map((o) => q.objects[o])) : null,
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
    drawScene(ctx, stageW, stageH, scene(), stageBg());
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
    empty.hidden = !!active?.pattern;
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
      stitchPanel.update(p && q && selectedObjects.size ? stitchInfo(p, q) : null);
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
  hoverObject = null;
  if (orderCard.isOpen) orderCard.close(true);
  if ([...hiddenBlocks].some((b) => b >= blocks) || (focusBlock ?? -1) >= blocks) {
    hiddenBlocks = new Set();
    focusBlock = null;
  }
}

const editor = new Editor({
  pattern: () => files.active?.pattern ?? null,
  commit: (p) => applyEdit(p),
  redraw,
  changed: redraw,
});

function setComparing(on: boolean): void {
  comparing = on;
  if (on) recompute();
  redraw();
}

function setEditing(on: boolean): void {
  editor.setActive(on);
  stage.classList.toggle('editing', on);
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
  toggleEdit: () => setEditing(!editor.active),
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
    // The objects as the Image mode sewed them (it trims inside some, between pieces of a fill),
    // with the exact areas of its fills.
    const data = writePattern(d.pattern, 'pes');
    const added = parsePattern(data, `${name}.pes`);
    rememberObjects(added, d.starts);
    const objs = sewObjects(added);
    rememberShapes(added, objs, d.starts, d.objects.map((o) => o.shape));
    await files.addWithObjects(`${name}.pes`, data.slice().buffer, rememberedIn(added, objs));
    setMode('flow');
  },
});

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
});
applyLang(detectLang(settings.lang));
applyI18n(document.body);

$('fit').addEventListener('click', () => fitView());
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
async function openFiles(list: Iterable<File>): Promise<void> {
  const all = [...list];
  for (const f of all.filter((f) => isProjectName(f.name))) await openProject(f);
  const image = all.find((f) => f.type.startsWith('image/') || IMAGE_FILE.test(f.name));
  const rest = all.filter((f) => f !== image && !isProjectName(f.name) && !f.type.startsWith('image/') && !IMAGE_FILE.test(f.name));
  if (image) {
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
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await files.add([new File([await res.blob()], path.split('/').pop()!)]);
  } catch (err) {
    console.error('Loading the example failed', err);
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

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && ['z', 'Z', 'y'].includes(e.key)) {
    e.preventDefault();
    history(e.key === 'y' || e.shiftKey ? 'redo' : 'undo');
    return;
  }
  if (mod && e.key === 'a' && editor.active) {
    e.preventDefault();
    editor.selectAll();
    return;
  }
  if (mod || e.altKey) return;
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
/** Pointer painting a brush stroke in the Bild mode, or null. */
let painting: number | null = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const pos = local(e);
  pointers.set(e.pointerId, pos);
  pressAt = pointers.size === 1 ? pos : null;
  let mode: 'move' | 'band' | 'pan' = 'pan';
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
    mode = editor.down(wx, wy, pos[0], pos[1], e.shiftKey, vp.scale);
  }
  if (mode === 'pan') canvas.classList.add('panning');
  if (pointers.size === 2) {
    editor.cancel();
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
      if (!editor.dragTo(wx, wy, pos[0], pos[1])) vp.pan(pos[0] - prev[0], pos[1] - prev[1]);
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, pos);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDist > 0) vp.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinchDist);
      pinchDist = d;
    }
    pointers.set(e.pointerId, pos);
    redraw();
  } else if (editor.hoverAt(wx, wy, vp.scale)) redraw();
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
  if (pressAt && e.type === 'pointerup' && settings.mode === 'flow' && Math.hypot(pos[0] - pressAt[0], pos[1] - pressAt[1]) < 4) {
    const p = files.active?.pattern;
    if (p) {
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
  if (pointers.size === 1 && pointers.has(e.pointerId)) editor.up();
  pointers.delete(e.pointerId);
  pinchDist = 0;
  if (!pointers.size) canvas.classList.remove('panning');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (e) => {
  editor.cancel();
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
canvas.addEventListener('dblclick', () => {
  if (!editor.active) fitView();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);

files.render();
redraw();
void files.restore();
void imageMode.restore();
