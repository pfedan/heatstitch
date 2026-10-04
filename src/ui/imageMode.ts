import { ImageClient } from '../digitize/client';
import { digitizeDefaults, type DigitizeOptions, type Digitized } from '../digitize/digitize';
import { formatNumber, t, type Key } from '../i18n';
import { NONE, type ColorEdit, type Prepared, type Stroke } from '../image/prepare';
import type { Raster } from '../image/raster';
import type { Rgb } from '../image/color';
import { patternStats, type Pattern, type ThreadColor } from '../model/pattern';
import { sewingSeconds } from '../model/sequence';
import { drawStitches } from '../render/stitches';
import { drawThreads } from '../render/threads';
import type { Viewport } from '../render/viewport';
import type { ImageView, Settings } from '../settings';
import { CAUTION, CRITICAL, type ValidationResult } from '../validation/validate';
import { fabricLabel, threadLabel } from './profilePanel';
import { loadImage, saveImage, saveWork } from '../storage/imageStore';
import { cssColor, ThreadPicker } from './threadPicker';

/**
 * The Bild mode: an image becomes a stitch file in two steps.
 *
 * 1. Preparation: size, number of colors, smoothing for photos, smallest region, background and
 *    thread matching; then the user's own changes: per color another thread, merge into another
 *    color, leave out; and brush strokes that paint a color or erase.
 * 2. Stitches: fill, satin and running stitch with the material's spacing and compensation.
 *
 * Both run in a worker; every change starts a new run and older results are dropped. The result is
 * checked against the material like any loaded file, and "Take over" adds it to the file list.
 */

export interface ImageHooks {
  settings: Settings;
  save: () => void;
  redraw: () => void;
  /** Fit the view to the image, after loading. */
  fit: () => void;
  /** The first stitches of a newly opened image are there; `first` for the very first image. */
  reveal: (first: boolean) => void;
  validate: (p: Pattern) => Promise<ValidationResult>;
  takeOver: (p: Pattern, name: string) => Promise<void>;
}

type Tool = 'none' | 'paint' | 'erase';

interface Work {
  edits: ColorEdit[];
  strokes: Stroke[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Longest side of the image handed to the worker (pixels). */
const SOURCE_MAX = 1600;
const ANGLES = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];

const rgbOf = (c: ThreadColor): Rgb => [c.r, c.g, c.b];
const same = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Draws the image into a canvas, at most SOURCE_MAX on its longer side (vector images at that size). */
async function decode(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    const vector = file.type === 'image/svg+xml';
    if (!w || !h) w = h = SOURCE_MAX;
    const scale = vector ? SOURCE_MAX / Math.max(w, h) : Math.min(1, SOURCE_MAX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const c = canvas.getContext('2d')!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class ImageMode {
  private client = new ImageClient();
  private picker = new ThreadPicker('.image-color .sw');
  private source: HTMLCanvasElement | null = null;
  private name = '';
  private work: Work = { edits: [], strokes: [] };
  private undoStack: Work[] = [];
  private redoStack: Work[] = [];
  private prepared: Prepared | null = null;
  private preparedImg: HTMLCanvasElement | null = null;
  private result: Digitized | null = null;
  private validation: ValidationResult | null = null;
  private busy: 'prepare' | 'stitches' | null = null;
  private error = '';
  /** Counts loaded images, so results for an earlier one are dropped. */
  private generation = 0;
  /** Counts calls of `load`: only the image chosen last is kept when decoding overlaps. */
  private loads = 0;
  /** The next stitches are the first of a newly opened image. */
  private revealPending = false;
  private needPrepare = false;
  private needStitches = false;
  private running = false;
  private timer = 0;
  private tool: Tool = 'none';
  /** Palette index painted with. */
  private brushColor = 0;
  private stroke: Stroke | null = null;
  private cursor: [number, number] | null = null;

  constructor(private h: ImageHooks) {
    const s = h.settings.image;
    const input = $<HTMLInputElement>('image-input');
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void this.load(f);
      input.value = '';
    });
    $('image-example').addEventListener('click', async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}examples/image-example.svg`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await this.load(new File([await res.blob()], 'image-example.svg', { type: 'image/svg+xml' }));
      } catch (err) {
        console.error('Loading the example image failed', err);
      }
    });

    // Sliders apply while dragging, typed numbers once they are complete.
    const num = (id: string, read: (v: number) => void, kind: 'prepare' | 'stitches') => {
      const el = $<HTMLInputElement>(id);
      el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
        const v = parseFloat(el.value);
        if (!Number.isFinite(v)) return;
        read(v);
        this.changed(kind);
      });
    };
    num('image-width', (v) => (s.prepare.widthMm = Math.min(400, Math.max(10, v))), 'prepare');
    num('image-colors', (v) => (s.prepare.maxColors = v), 'prepare');
    num('image-smooth', (v) => (s.prepare.smooth = v), 'prepare');
    num('image-min-area', (v) => (s.prepare.minAreaMm2 = v), 'prepare');
    num('image-spacing', (v) => (s.stitch.spacing = s.stitch.satinSpacing = Math.min(1.5, Math.max(0.2, v))), 'stitches');
    num('image-satin-max', (v) => (s.stitch.satinMax = v), 'stitches');
    num('image-pull', (v) => (s.stitch.pull = Math.min(1, Math.max(0, v))), 'stitches');
    const check = (id: string, read: (v: boolean) => void, kind: 'prepare' | 'stitches') => {
      const el = $<HTMLInputElement>(id);
      el.addEventListener('change', () => {
        read(el.checked);
        this.changed(kind);
      });
    };
    check('image-background', (v) => (s.prepare.background = v), 'prepare');
    check('image-threads', (v) => (s.prepare.threads = v), 'prepare');
    check('image-underlay', (v) => (s.stitch.underlay = v), 'stitches');
    const angle = $<HTMLSelectElement>('image-angle');
    angle.addEventListener('change', () => {
      // Following the image is the default; "straight" switches it off, a number fixes the angle.
      delete s.stitch.angle;
      delete s.stitch.flow;
      if (angle.value === 'auto') s.stitch.flow = false;
      else if (angle.value !== 'flow') s.stitch.angle = Number(angle.value);
      this.changed('stitches');
    });
    $('image-stitch-reset').addEventListener('click', () => {
      s.stitch = {};
      this.changed('stitches');
    });

    document.querySelectorAll<HTMLInputElement>('input[name="image-view"]').forEach((el) =>
      el.addEventListener('change', () => {
        if (!el.checked) return;
        s.view = el.value as ImageView;
        h.save();
        this.render();
        h.redraw();
      }),
    );
    document.querySelectorAll<HTMLInputElement>('input[name="image-tool"]').forEach((el) =>
      el.addEventListener('change', () => {
        if (el.checked) this.setTool(el.value as Tool);
      }),
    );
    const brush = $<HTMLInputElement>('image-brush');
    brush.addEventListener('input', () => {
      s.brushMm = parseFloat(brush.value) || s.brushMm;
      h.save();
      this.render();
    });
    $('image-strokes-undo').addEventListener('click', () => this.undo());
    $('image-strokes-clear').addEventListener('click', () => {
      if (!this.work.strokes.length) return;
      this.commit({ ...this.work, strokes: [] });
    });
    const copy = $<HTMLButtonElement>('image-ai-copy');
    copy.addEventListener('click', async () => {
      const text = $<HTMLTextAreaElement>('image-ai-prompt');
      try {
        await navigator.clipboard.writeText(text.value);
        copy.textContent = t('image.ai.copied');
      } catch {
        // No clipboard access: the text is selected, so Ctrl+C copies it.
        text.select();
        copy.textContent = t('image.ai.select');
      }
      setTimeout(() => (copy.textContent = t('image.ai.copy')), 2500);
    });
    $('image-take').addEventListener('click', async () => {
      const p = this.result?.pattern;
      if (!p) return;
      await h.takeOver(p, this.name || 'image');
    });
    this.render();
  }

  get hasImage(): boolean {
    return !!this.source;
  }

  get painting(): boolean {
    return this.tool !== 'none' && !!this.prepared;
  }

  /** Size of the design in mm (the prepared image's, else from the settings). */
  private sizeMm(): [number, number] {
    if (this.prepared) return [this.prepared.width * this.prepared.pxMm, this.prepared.height * this.prepared.pxMm];
    const w = this.h.settings.image.prepare.widthMm;
    return this.source ? [w, (w * this.source.height) / this.source.width] : [w, w];
  }

  /** Fits the image into the stage. */
  fit(vp: Viewport, w: number, h: number): void {
    const [W, H] = this.sizeMm();
    vp.fit(-W / 2, -H / 2, W / 2, H / 2, w, h);
  }

  /** The image of the last session, with its changes. */
  async restore(): Promise<void> {
    const before = this.loads;
    const stored = await loadImage();
    // An image opened meanwhile wins over the stored one.
    if (!stored || this.loads !== before) return;
    const { image, work } = stored;
    await this.load(new File([image.data], image.name, { type: image.type }), work);
  }

  /** Opens an image; `work` restores stored changes (and keeps the stored settings). */
  async load(file: File, work?: Work): Promise<void> {
    const token = ++this.loads;
    let canvas: HTMLCanvasElement;
    try {
      canvas = await decode(file);
      if (token !== this.loads) return;
    } catch (err) {
      if (token !== this.loads) return;
      this.error = t('image.error.load', { msg: err instanceof Error ? err.message : String(err) });
      this.render();
      return;
    }
    this.generation++;
    this.source = canvas;
    this.revealPending = !work;
    this.name = file.name.replace(/\.[^.]+$/, '') || 'image';
    this.work = work ?? { edits: [], strokes: [] };
    this.undoStack = [];
    this.redoStack = [];
    this.prepared = null;
    this.preparedImg = null;
    this.result = null;
    this.validation = null;
    this.error = '';
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const raster: Raster = { width: data.width, height: data.height, data: data.data };
    let photo: boolean;
    try {
      photo = await this.client.load(raster);
    } catch (err) {
      this.source = null;
      this.error = t('image.error.load', { msg: err instanceof Error ? err.message : String(err) });
      this.render();
      this.h.redraw();
      return;
    }
    if (!work) {
      // Photos need smoothing to form regions; graphics keep their edges.
      this.h.settings.image.prepare.smooth = photo ? 3 : 0;
      this.h.save();
      void saveImage({ name: file.name, type: file.type, data: await file.arrayBuffer() });
    }
    this.render();
    this.h.fit();
    this.run('prepare', 0);
  }

  /** A setting changed: save, then prepare again or only redo the stitches. */
  private changed(kind: 'prepare' | 'stitches'): void {
    this.h.save();
    this.render();
    this.run(kind, 150);
  }

  /** The material changed: its spacing and compensation apply to the stitches. */
  profileChanged(): void {
    this.render();
    if (this.prepared) this.run('stitches', 0);
  }

  private options(): DigitizeOptions {
    return { ...digitizeDefaults(this.h.settings.profile), ...this.h.settings.image.stitch };
  }

  /**
   * Asks for new results. One job runs at a time in the worker; changes made meanwhile are
   * collected and computed with the newest settings once it is done.
   */
  private run(kind: 'prepare' | 'stitches', delay: number): void {
    if (!this.source) return;
    if (kind === 'prepare' || !this.prepared) this.needPrepare = true;
    this.needStitches = true;
    this.busy = this.needPrepare ? 'prepare' : 'stitches';
    this.render();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.pump(), delay);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    const stale = () => gen !== this.generation;
    try {
      while (!stale() && (this.needPrepare || this.needStitches)) {
        if (this.needPrepare) {
          this.needPrepare = false;
          const p = await this.client.prepare(this.h.settings.image.prepare, this.work.edits, this.work.strokes);
          if (stale() || this.needPrepare) continue;
          this.prepared = p;
          this.preparedImg = labelsToCanvas(p);
          this.brushColor = Math.min(this.brushColor, Math.max(0, p.palette.length - 1));
          this.busy = 'stitches';
          this.render();
          this.h.redraw();
        }
        this.needStitches = false;
        const d = await this.client.digitize(this.options(), this.name);
        if (stale() || this.needPrepare || this.needStitches) continue;
        this.result = d;
        this.validation = null;
        this.busy = null;
        this.error = '';
        this.render();
        this.h.redraw();
        if (this.revealPending) {
          this.revealPending = false;
          const first = !this.h.settings.image.introDone;
          this.h.settings.image.introDone = true;
          this.h.save();
          this.h.reveal(first);
        }
        const v = await this.h.validate(d.pattern);
        if (this.result !== d) continue;
        this.validation = v;
        this.render();
      }
    } catch (err) {
      if (!stale()) {
        this.needPrepare = this.needStitches = false;
        this.busy = null;
        this.error = t('image.error.convert', { msg: err instanceof Error ? err.message : String(err) });
        this.render();
      }
    } finally {
      this.running = false;
      // A new image arrived while this one was computed.
      if (this.needPrepare || this.needStitches) void this.pump();
    }
  }

  /** Changes edits or strokes as one undo step. */
  private commit(next: Work): void {
    this.undoStack.push(this.work);
    this.redoStack = [];
    this.setWork(next);
  }

  private setWork(w: Work): void {
    this.work = w;
    void saveWork(w);
    this.run('prepare', 0);
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.work);
    this.setWork(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.work);
    this.setWork(next);
  }

  private edit(from: Rgb, change: Omit<ColorEdit, 'from'>): void {
    const rest = this.work.edits.filter((e) => !same(e.from, from));
    const old = this.work.edits.find((e) => same(e.from, from));
    const merged: ColorEdit = { ...old, ...change, from };
    if (!merged.skip) delete merged.skip;
    if (!merged.merge) delete merged.merge;
    this.commit({ ...this.work, edits: [...rest, merged] });
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    document.querySelectorAll<HTMLInputElement>('input[name="image-tool"]').forEach((el) => (el.checked = el.value === tool));
    document.getElementById('stage')?.classList.toggle('painting', tool !== 'none');
    this.render();
    this.h.redraw();
  }

  // Painting ------------------------------------------------------------------

  /** Image coordinates (0..1) of a world point. */
  private toImage(x: number, y: number): [number, number] {
    const [W, H] = this.sizeMm();
    return [(x + W / 2) / W, (y + H / 2) / H];
  }

  hover(x: number, y: number): void {
    this.cursor = this.tool === 'none' ? null : [x, y];
  }

  leave(): void {
    this.cursor = null;
  }

  paintDown(x: number, y: number): void {
    const p = this.prepared;
    if (!p) return;
    const [W] = this.sizeMm();
    const entry = p.palette[this.brushColor];
    const color = this.tool === 'erase' || !entry ? null : entry.source;
    this.stroke = { points: [this.toImage(x, y)], radius: this.h.settings.image.brushMm / 2 / W, color };
    this.preview();
  }

  paintMove(x: number, y: number): void {
    this.cursor = [x, y];
    if (!this.stroke) return;
    this.stroke.points.push(this.toImage(x, y));
    this.preview();
  }

  /** Drops the stroke being painted (a second finger, a cancelled touch). */
  paintCancel(): void {
    if (!this.stroke) return;
    this.stroke = null;
    if (this.prepared) this.preparedImg = labelsToCanvas(this.prepared);
    this.h.redraw();
  }

  paintUp(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    this.commit({ ...this.work, strokes: [...this.work.strokes, s] });
  }

  /** Draws the stroke so far into the prepared image, until the worker's result replaces it. */
  private preview(): void {
    const s = this.stroke;
    const img = this.preparedImg;
    if (!s || !img) return;
    const c = img.getContext('2d')!;
    c.save();
    const entry = s.color && this.prepared?.palette[this.brushColor];
    if (s.color) c.strokeStyle = c.fillStyle = entry ? cssColor(entry.thread) : `rgb(${s.color.join(',')})`;
    else c.globalCompositeOperation = 'destination-out';
    c.lineCap = c.lineJoin = 'round';
    c.lineWidth = s.radius * 2 * img.width;
    c.beginPath();
    s.points.forEach(([x, y], i) => (i ? c.lineTo(x * img.width, y * img.height) : c.moveTo(x * img.width, y * img.height)));
    if (s.points.length === 1) c.lineTo(s.points[0][0] * img.width + 0.01, s.points[0][1] * img.height);
    c.stroke();
    c.restore();
    this.h.redraw();
  }

  // Drawing -------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport, background: string): void {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    if (!this.source) return;
    const [W, H] = this.sizeMm();
    const [x0, y0] = vp.toScreen(-W / 2, -H / 2);
    const view = this.h.settings.image.view;
    ctx.save();
    if (view === 'original' || !this.preparedImg) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.source, x0, y0, W * vp.scale, H * vp.scale);
    } else {
      // Pixels of the prepared image are 0.1 mm or more: shown as they are when zoomed in.
      ctx.imageSmoothingEnabled = vp.scale * this.prepared!.pxMm < 3;
      if (view === 'stitches' && this.result) ctx.globalAlpha = 0.25;
      ctx.drawImage(this.preparedImg, x0, y0, W * vp.scale, H * vp.scale);
    }
    ctx.restore();
    const p = this.result?.pattern;
    if (view === 'stitches' && p && !this.stroke) {
      const s = this.h.settings;
      if (!s.realistic || !drawThreads(ctx, vp, p, 1, s.threadMm)) drawStitches(ctx, vp, p, 1, s.marks.jumps);
    }
    // Outline of the design area and the brush.
    ctx.save();
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x0, y0, W * vp.scale, H * vp.scale);
    ctx.restore();
    if (this.cursor && this.tool !== 'none') {
      const [cx, cy] = vp.toScreen(...this.cursor);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, (this.h.settings.image.brushMm / 2) * vp.scale), 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Panels --------------------------------------------------------------------

  /** Writes the settings into the controls and re-renders the color list and the result. */
  render(): void {
    const s = this.h.settings.image;
    const o = this.options();
    const setVal = (id: string, v: number | string) => {
      const el = $<HTMLInputElement>(id);
      if (document.activeElement !== el) el.value = String(v);
    };
    const out = (id: string, text: string) => ($<HTMLOutputElement>(id).textContent = text);
    setVal('image-width', s.prepare.widthMm);
    const [W, H] = this.sizeMm();
    out('image-height', this.source ? t('image.size', { w: formatNumber(W, 0), h: formatNumber(H, 0) }) : '');
    setVal('image-colors', s.prepare.maxColors);
    out('image-colors-out', String(s.prepare.maxColors));
    setVal('image-smooth', s.prepare.smooth);
    out('image-smooth-out', s.prepare.smooth ? String(s.prepare.smooth) : t('controls.off'));
    setVal('image-min-area', s.prepare.minAreaMm2);
    out('image-min-area-out', `${formatNumber(s.prepare.minAreaMm2, 1)} mm²`);
    $<HTMLInputElement>('image-background').checked = s.prepare.background;
    $<HTMLInputElement>('image-threads').checked = s.prepare.threads;
    setVal('image-spacing', o.spacing);
    setVal('image-pull', o.pull);
    setVal('image-satin-max', o.satinMax);
    out('image-satin-max-out', `${formatNumber(o.satinMax, 1)} mm`);
    $<HTMLInputElement>('image-underlay').checked = o.underlay;
    const angle = $<HTMLSelectElement>('image-angle');
    if (!angle.options.length) {
      angle.append(new Option('', 'flow'), new Option('', 'auto'), ...ANGLES.map((a) => new Option(`${a}°`, String(a))));
    }
    angle.options[0].text = t('image.angle.flow');
    angle.options[1].text = t('image.angle.auto');
    angle.value = o.angle !== null ? String(o.angle) : o.flow ? 'flow' : 'auto';
    $('image-stitch-reset').hidden = !Object.keys(s.stitch).length;
    $('image-material').textContent = t('image.material', { fabric: fabricLabel(this.h.settings.profile), thread: threadLabel(this.h.settings.profile) });
    document.querySelectorAll<HTMLInputElement>('input[name="image-view"]').forEach((el) => (el.checked = el.value === s.view));
    setVal('image-brush', s.brushMm);
    out('image-brush-out', `${formatNumber(s.brushMm, 1)} mm`);
    $<HTMLButtonElement>('image-strokes-undo').disabled = !this.undoStack.length;
    $<HTMLButtonElement>('image-strokes-clear').disabled = !this.work.strokes.length;
    // The prompt for preparing the image with one's own AI, with this design's size and colors:
    // 1 mm in the embroidery as a share of the image width is the smallest detail worth keeping.
    $<HTMLTextAreaElement>('image-ai-prompt').value = t('image.ai.text', {
      w: formatNumber(s.prepare.widthMm, 0),
      n: s.prepare.maxColors,
      d: formatNumber(Math.max(0.2, 100 / s.prepare.widthMm), 1),
    });
    $('image-brush-hint').textContent = t(this.tool === 'none' ? 'image.brush.hint' : this.tool === 'paint' ? 'image.brush.paint' : 'image.brush.erase');

    const info = $('image-info');
    info.textContent = this.error || (this.source ? t('image.info', { name: this.name, w: this.source.width, h: this.source.height }) : '');
    info.classList.toggle('error', !!this.error);
    this.renderPalette();
    this.renderResult();
  }

  private renderPalette(): void {
    const list = $<HTMLUListElement>('image-palette');
    const p = this.prepared;
    if (!p) {
      list.replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: t(this.source ? 'image.busy' : 'image.none') }));
      return;
    }
    const sewn = p.palette.filter((e) => e.sew);
    list.replaceChildren(
      ...p.palette.map((e, i) => {
        const li = document.createElement('li');
        li.className = 'image-color';
        li.classList.toggle('skipped', !e.sew);
        li.classList.toggle('brush', this.tool === 'paint' && i === this.brushColor);

        const sew = Object.assign(document.createElement('input'), { type: 'checkbox', checked: e.sew, title: t('image.color.sew') });
        sew.addEventListener('change', () => this.edit(e.source, { skip: !sew.checked }));

        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'sw';
        sw.style.background = cssColor(e.thread);
        sw.title = t('image.color.thread');
        sw.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.picker.toggle(sw, {
            key: `image-${i}`,
            title: t('image.color.thread'),
            current: e.thread,
            onPick: (c) => this.edit(e.source, { thread: c }),
          });
        });

        const text = document.createElement('span');
        text.className = 'image-color-text';
        const name = document.createElement('span');
        name.className = 'image-color-name';
        name.textContent = e.thread.name ?? `#${rgbOf(e.thread).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        const meta = document.createElement('span');
        meta.className = 'image-color-meta';
        meta.textContent = `${formatNumber(e.areaMm2, 0)} mm²`;
        text.append(name, meta);
        if (e.deltaE > 10) {
          const warn = Object.assign(document.createElement('span'), { className: 'image-color-warn', textContent: '≠', title: t('image.color.far', { de: formatNumber(e.deltaE, 0) }) });
          text.append(warn);
        }

        const merge = document.createElement('select');
        merge.title = t('image.color.merge');
        merge.setAttribute('aria-label', merge.title);
        merge.append(new Option('→', ''));
        for (const other of sewn) {
          if (other === e) continue;
          merge.append(new Option(other.thread.name ?? '#', p.palette.indexOf(other).toString()));
        }
        merge.addEventListener('change', () => {
          const j = Number(merge.value);
          if (merge.value !== '' && p.palette[j]) this.edit(e.source, { merge: p.palette[j].source });
        });

        li.append(sew, sw, text, merge);
        li.addEventListener('click', (ev) => {
          if ((ev.target as Element).closest('input, select, button')) return;
          this.brushColor = i;
          if (this.tool !== 'paint') this.setTool('paint');
          else this.render();
        });
        return li;
      }),
    );
  }

  private renderResult(): void {
    const dl = $<HTMLDListElement>('image-result');
    const verdict = $('image-verdict');
    const take = $<HTMLButtonElement>('image-take');
    const d = this.result;
    take.disabled = !d || !!this.busy;
    $('image-shine').hidden = !d;
    const busyText = this.busy === 'prepare' ? t('image.busy.prepare') : this.busy === 'stitches' ? t('image.busy.stitches') : '';
    $('image-status').textContent = busyText;
    if (!d) {
      dl.replaceChildren();
      verdict.replaceChildren();
      return;
    }
    const st = patternStats(d.pattern);
    const count = (k: string) => d.objects.filter((o) => o.kind === k).length;
    const rows: [Key, string][] = [
      ['stats.stitches', formatNumber(st.stitches)],
      ['stats.size', `${formatNumber(st.widthMm, 1)} × ${formatNumber(st.heightMm, 1)} mm`],
      ['image.result.colors', formatNumber(d.pattern.colors.length)],
      ['image.result.objects', t('image.result.kinds', { fill: count('fill'), satin: count('satin'), run: count('run') })],
      ...(d.objects.some((o) => o.curved) ? [['image.result.curved', formatNumber(d.objects.filter((o) => o.curved).length)] as [Key, string]] : []),
      ['stats.trims', formatNumber(st.trims)],
      ['image.result.time', t('image.result.minutes', { m: formatNumber(sewingSeconds(st.stitches, st.trims, st.colorChanges, this.h.settings.machineSpm) / 60, 0) })],
    ];
    dl.replaceChildren(
      ...rows.flatMap(([k, v]) => [Object.assign(document.createElement('dt'), { textContent: t(k) }), Object.assign(document.createElement('dd'), { textContent: v })]),
    );
    const v = this.validation;
    if (!v) {
      verdict.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('validation.pending') }));
      return;
    }
    const open = v.zones.filter((z) => !z.practice);
    const worst = open.some((z) => z.level === CRITICAL) ? CRITICAL : open.some((z) => z.level === CAUTION) ? CAUTION : 0;
    const cls = ['safe', 'caution', 'critical'][worst];
    const box = Object.assign(document.createElement('div'), { className: `verdict ${cls}` });
    const head = Object.assign(document.createElement('div'), { className: 'verdict-head' });
    head.textContent = t((['validation.verdict.safe', 'validation.verdict.caution', 'validation.verdict.critical'] as const)[worst]);
    box.append(head, Object.assign(document.createElement('p'), { textContent: t(worst ? 'image.verdict.findings' : 'image.verdict.safe', { n: open.length }) }));
    verdict.replaceChildren(box);
  }
}

/** The prepared image as a canvas: thread colors, unsewn pixels transparent. */
function labelsToCanvas(p: Prepared): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  const c = canvas.getContext('2d')!;
  const img = c.createImageData(p.width, p.height);
  for (let i = 0; i < p.labels.length; i++) {
    const l = p.labels[i];
    if (l === NONE) continue;
    const t = p.palette[l].thread;
    img.data[i * 4] = t.r;
    img.data[i * 4 + 1] = t.g;
    img.data[i * 4 + 2] = t.b;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return canvas;
}
