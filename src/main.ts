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
import { bindProfile } from './ui/profilePanel';
import { renderStats } from './ui/stats';
import { updateTooltip } from './ui/tooltip';
import { ValidationPanel } from './ui/validationPanel';
import type { ValidationResult, Zone } from './validation/validate';

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

/** Validation overlay image, rebuilt when the active file's classification changes. */
let validationImg: { v: ValidationResult; img: HTMLCanvasElement } | null = null;
/** Zone hovered in the list (wins) or last jumped to; both are framed on the canvas. */
let hoverZone: Zone | null = null;
let selectedZone: Zone | null = null;

const files = new FileList(
  $<HTMLUListElement>('file-list'),
  (f) => {
    grid = null;
    gridImg = null;
    hoverZone = selectedZone = null;
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

function activeValidationImg(): HTMLCanvasElement | null {
  const v = files.active?.validation;
  if (!v) return null;
  if (validationImg?.v !== v) validationImg = { v, img: validationToCanvas(v) };
  return validationImg.img;
}

const scene = (): Scene => ({
  pattern: files.active?.pattern ?? null,
  grid,
  gridImg,
  validation: files.active?.validation ?? null,
  validationImg: activeValidationImg(),
  highlight: settings.showValidation ? (hoverZone ?? selectedZone) : null,
  settings,
  vp,
});

const panel = new ValidationPanel($('validation'), $('findings-open'), {
  onZone: (z) => selectZone(z),
  onHover: (z) => {
    hoverZone = z;
    redraw();
  },
  onStep: (dir) => stepZone(dir),
});

/** Shows or hides the findings column; while hidden a chip on the canvas reopens it. */
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
    const active = files.active;
    empty.hidden = !!active?.pattern;
    exportBtn.disabled = !active?.pattern;
    drawLegendCanvas();
    renderStats($('stats'), $('swatches'), active, grid, settings, computing);
    panel.update(active, selectedZone);
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
  if (p) exportPng(scene(), stageW, stageH, stageBg(), p.name || 'pattern');
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
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'ArrowDown' || e.key === 'j') files.step(1);
  else if (e.key === 'ArrowUp' || e.key === 'k') files.step(-1);
  else if (e.key === 'f') fitView();
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
  }
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
void files.restore();
