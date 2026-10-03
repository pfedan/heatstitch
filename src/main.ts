import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { WorkerClient } from './density/client';
import type { DensityGrid } from './density/grid';
import { applyI18n, detectLang, setLang, type Lang } from './i18n';
import { gridToCanvas } from './render/heatmap';
import { drawLegend } from './render/legend';
import { drawScene, type Scene } from './render/scene';
import { validationToCanvas } from './render/validationOverlay';
import { Viewport } from './render/viewport';
import { loadSettings, saveSettings } from './settings';
import { bindControls, type ChangeKind } from './ui/controls';
import { exportPng } from './ui/export';
import { FileList, type LoadedFile } from './ui/fileList';
import { legendSpec } from './ui/legendSpec';
import { renderStats } from './ui/stats';
import { updateTooltip } from './ui/tooltip';
import { renderValidation } from './ui/validationPanel';

registerSW({ immediate: true });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLElement>('stage');
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
const legend = $<HTMLCanvasElement>('legend');
const tooltip = $<HTMLElement>('tooltip');
const empty = $<HTMLElement>('empty');
const exportBtn = $<HTMLButtonElement>('export');

const settings = loadSettings();
const vp = new Viewport();
// Two workers so a long validation never delays heatmap updates.
const density = new WorkerClient();
const validator = new WorkerClient();
let densitySeq = 0;
let grid: DensityGrid | null = null;
let gridImg: HTMLCanvasElement | null = null;
let computing = false;
let stageW = 0;
let stageH = 0;

const stageBg = () => getComputedStyle(stage).backgroundColor;

/** Validation overlay image, rebuilt when the active file or its validation changes. */
let validationImg: { file: LoadedFile; img: HTMLCanvasElement } | null = null;

const files = new FileList(
  $<HTMLUListElement>('file-list'),
  (f) => {
    grid = null;
    gridImg = null;
    if (f?.pattern) fitView(f);
    recompute();
  },
  (p) => validator.validate(p),
  (f) => {
    if (f === files.active) redraw();
  },
);

function activeValidationImg(): HTMLCanvasElement | null {
  const f = files.active;
  if (!f?.validation) return null;
  if (validationImg?.file !== f) validationImg = { file: f, img: validationToCanvas(f.validation) };
  return validationImg.img;
}

const scene = (): Scene => ({
  pattern: files.active?.pattern ?? null,
  grid,
  gridImg,
  validation: files.active?.validation ?? null,
  validationImg: activeValidationImg(),
  settings,
  vp,
});

// Rendering ------------------------------------------------------------------

let frame = 0;
function redraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, stageW, stageH, scene(), stageBg());
    const active = files.active;
    empty.hidden = !!active?.pattern;
    exportBtn.disabled = !active?.pattern;
    drawLegendCanvas();
    renderStats($('stats'), $('swatches'), active, grid, settings, computing);
    renderValidation($('validation'), active, zoomToZone);
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
  gridImg = grid ? gridToCanvas(grid, settings.scales[settings.metric].max) : null;
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
      computing = false;
      rebuildGridImage();
    } catch (err) {
      console.error(err);
      computing = false;
    }
    redraw();
  }, 60);
}

function zoomToZone(z: { bbox: { minX: number; minY: number; maxX: number; maxY: number } }): void {
  const pad = 4; // mm of context around the zone
  const b = z.bbox;
  vp.fit(b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad, stageW, stageH);
  redraw();
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

// Controls, language, export --------------------------------------------------

const controls = bindControls(settings, (kind: ChangeKind) => {
  saveSettings(settings);
  if (kind === 'density') recompute();
  else {
    rebuildGridImage();
    redraw();
  }
});

const langSelect = $<HTMLSelectElement>('lang');
const applyLang = (l: Lang) => {
  setLang(l);
  langSelect.value = l;
  controls.refresh();
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
  if (p) exportPng(scene(), stageW, stageH, stageBg(), p.name || 'pattern');
});

// File input and drag & drop --------------------------------------------------

const input = $<HTMLInputElement>('file-input');
input.addEventListener('change', () => {
  if (input.files) void files.add(input.files);
  input.value = '';
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
  if (e.key === 'ArrowDown' || e.key === 'j') files.step(1);
  else if (e.key === 'ArrowUp' || e.key === 'k') files.step(-1);
  else if (e.key === 'f') fitView();
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
    updateTooltip(tooltip, sx, sy, stageW, vp, grid, settings, files.active?.validation ?? null);
    redraw();
  },
  { passive: false },
);

const pointers = new Map<number, [number, number]>();
let pinchDist = 0;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  canvas.classList.add('panning');
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const pos = local(e);
  const prev = pointers.get(e.pointerId);
  if (prev) {
    if (pointers.size === 1) {
      vp.pan(pos[0] - prev[0], pos[1] - prev[1]);
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, pos);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDist > 0) vp.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinchDist);
      pinchDist = d;
    }
    pointers.set(e.pointerId, pos);
    redraw();
  }
  if (e.pointerType === 'mouse' || pointers.size <= 1) updateTooltip(tooltip, pos[0], pos[1], stageW, vp, grid, settings, files.active?.validation ?? null);
});

const endPointer = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  pinchDist = 0;
  if (!pointers.size) canvas.classList.remove('panning');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => (tooltip.hidden = true));
canvas.addEventListener('dblclick', () => fitView());

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);

files.render();
redraw();
