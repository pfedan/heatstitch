import './style.css';
import { WorkerClient } from './density/client';
import type { DensityGrid } from './density/grid';
import { applyI18n, detectLang, setLang, t, type Lang } from './i18n';
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
import type { Pattern } from './model/pattern';
import type { Measurement } from './validation/measure';
import { initUpdateNotice } from './ui/updateNotice';
import { downloadPattern, outputFileName } from './writers';

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
  pattern: editor.preview ?? files.active?.pattern ?? null,
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

// Rendering ------------------------------------------------------------------

let frame = 0;
function redraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    drawLegendCanvas();
    renderStats($('stats'), $('swatches'), active, grid, settings, computing);
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
  if (!pattern) {
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
  recompute();
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
  const f = files.active;
  if (!f) return;
  if (step === 'undo') files.undo(f);
  else if (step === 'redo') files.redo(f);
  else files.revert(f);
  editor.reset();
  hoverZone = selectedZone = null;
  correctMessage = null;
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
  else {
    rebuildGridImage();
    redraw();
  }
});

const profile = bindProfile(settings, () => {
  saveSettings(settings);
  // Classification is cheap: every file is re-checked instantly against the new limits.
  files.setProfile(settings.profile, settings.checks);
  controls.refresh();
  hoverZone = selectedZone = null;
  tooltip.hidden = true;
  redraw();
});

const langSelect = $<HTMLSelectElement>('lang');
const applyLang = (l: Lang) => {
  setLang(l);
  langSelect.value = l;
  controls.refresh();
  profile.refresh();
  files.render();
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
  if (input.files) void files.add(input.files);
  input.value = '';
});

const EXAMPLE_FILE = 'cat-60mm.pes';
$('load-example').addEventListener('click', async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}examples/${EXAMPLE_FILE}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await files.add([new File([await res.blob()], EXAMPLE_FILE)]);
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
  if (e.dataTransfer?.files.length) void files.add(e.dataTransfer.files);
});

// Installed PWA opened via "Open with" on a .dst/.pes file (manifest file_handlers).
interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}
const launchQueue = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } })
  .launchQueue;
launchQueue?.setConsumer(async (params) => {
  if (params.files.length) void files.add(await Promise.all(params.files.map((h) => h.getFile())));
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
  const left = showCompare() && sx < split * stageW;
  const f = files.active;
  updateTooltip(tooltip, sx, sy, stageW, vp, left ? origGrid : grid, settings, (left ? f?.originalValidation : f?.validation) ?? null);
}

const nearDivider = (sx: number) => showCompare() && Math.abs(sx - split * stageW) <= DIVIDER_GRAB_PX;

const pointers = new Map<number, [number, number]>();
let pinchDist = 0;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const pos = local(e);
  pointers.set(e.pointerId, pos);
  let mode: 'move' | 'band' | 'pan' = 'pan';
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
canvas.addEventListener('pointerleave', () => (tooltip.hidden = true));
canvas.addEventListener('dblclick', () => {
  if (!editor.active) fitView();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);

files.render();
redraw();
void files.restore();
