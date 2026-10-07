import { ImageClient } from '../digitize/client';
import { digitizeDefaults, shapesOrigin, type DigitizeOptions, type Digitized } from '../digitize/digitize';
import { formatNumber, onLangChange, t, type Key } from '../i18n';
import { nearestThread, NONE, workingSize, type ColorEdit, type PrepareOptions, type ExactLabels, type Prepared, type Stroke } from '../image/prepare';
import { readSvg, type SvgDesign, type SvgShape } from '../image/svg';
import { transformForm, type Form } from '../shape/path';
import { rasterize } from '../shape/rasterize';
import type { Raster } from '../image/raster';
import { rgbToLab, type Rgb } from '../image/color';
import { patternStats, type Pattern, type ThreadColor } from '../model/pattern';
import { sewingSeconds } from '../model/sequence';
import { drawStitches } from '../render/stitches';
import { drawThreads } from '../render/threads';
import { drawFabric } from '../render/fabricGl';
import type { Viewport } from '../render/viewport';
import { shownMarks, type ImageView, type Mode, type Settings } from '../settings';
import { CAUTION, CRITICAL, type ValidationResult } from '../validation/validate';
import { clearImage, loadImage, saveImage, saveWork, type StoredImage, type StoredWork } from '../storage/imageStore';
import { hoopShort } from './hoopPanel';
import { cssColor, ThreadPicker } from './threadPicker';
import { FABRICS, THREADS } from '../validation/profiles';
import { STORAGE_NS } from '../storage/namespace';
import { command, commandTitle, getCommand } from '../shell/commands';
import '../areas/image/image.css';

/**
 * Bild umwandeln: an assistant in three steps that turns a picture into a design.
 *
 * 1. Bild wählen: the picture, its width, the prompt for preparing it with one's own AI.
 * 2. Farben und Flächen: number of colors, smoothing for photos, smallest region, background and
 *    thread matching; then the user's own changes: per color another thread, merge into another
 *    color, leave out; and brush strokes that paint a color or erase.
 * 3. Stiche und Ergebnis: fill, satin and running stitch with the material's spacing and
 *    compensation, the numbers of the result and its check against the material.
 *
 * Preparing and stitching run in a worker; every change starts a new run and older results are
 * dropped. The steps only choose what is shown: every step can be opened at any time, the view of
 * the stage follows the step. "Übernehmen" adds the design to the list and goes back to Gestalten.
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
  /** Adds the design to the file list, with what is known about its objects. */
  takeOver: (d: Digitized, name: string) => Promise<void>;
  mode: () => Mode;
  setMode: (m: Mode) => void;
}

export type Step = 1 | 2 | 3;
/** What the stage shows in each step, until the user picks another view. */
const STEP_VIEW: Record<Step, ImageView> = { 1: 'original', 2: 'prepared', 3: 'stitches' };
const STEP_KEY = `${STORAGE_NS}.image.step`;

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

const isSvg = (file: File) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);

/**
 * An SVG file as shapes with exact colors (see svg.ts), drawn SOURCE_MAX on its longer side for the
 * original view; null when it is better treated as a picture.
 */
async function decodeSvg(file: File): Promise<{ canvas: HTMLCanvasElement; svg: SvgDesign } | null> {
  const svg = await readSvg(await file.text());
  if (!svg) return null;
  const [w, h] = svg.aspect <= 1 ? [SOURCE_MAX, SOURCE_MAX * svg.aspect] : [SOURCE_MAX / svg.aspect, SOURCE_MAX];
  try {
    return { canvas: await svg.picture(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))), svg };
  } catch (err) {
    svg.dispose();
    throw err;
  }
}

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

/**
 * Threads for the colors of a vector file: the nearest Brother threads (colors landing on the same
 * thread share it), or the colors themselves. `index` maps each color to its thread.
 */
function threadsFor(colors: Rgb[], brother: boolean): { threads: ThreadColor[]; index: number[] } {
  const threads: ThreadColor[] = [];
  const index = colors.map((c) => {
    const t = brother ? nearestThread(rgbToLab(...c)).thread : { r: c[0], g: c[1], b: c[2] };
    const same = threads.findIndex((x) => (brother ? x.pecIndex === t.pecIndex : x.r === t.r && x.g === t.g && x.b === t.b));
    if (same >= 0) return same;
    threads.push(t);
    return threads.length - 1;
  });
  return { threads, index };
}

/**
 * Stitches for an SVG file without opening it in the Bild mode (the examples of the file list): its
 * shapes at their size in the file, the stitch settings of the material. A worker of its own runs
 * it, so an image open in the Bild mode stays as it is.
 */
/** A shape of a file that is not sewn when it comes in (a background), with its thread. */
export interface LeftOut {
  form: Form;
  color: ThreadColor;
  reason: 'background';
}

/** Share of the whole design a background covers, and how fully it fills its own box. */
const BACKGROUND_COVER = 0.9;
const BACKGROUND_SOLID = 0.9;

/**
 * The shape at the very back when it is a background: a fill under everything else that covers
 * nearly the whole design and is (nearly) a plain rectangle, as many drawing programs export.
 * Sewing it would put a dense, stiff area under the whole design. -1 when there is none.
 */
export function backgroundOf(shapes: SvgShape[]): number {
  if (shapes.length < 2 || shapes[0].kind !== 'fill') return -1;
  const box = (f: Form) => {
    const pts = f.paths.flatMap((p) => p.nodes.map((n) => n.p));
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  };
  const all = shapes.map((s) => box(s.form));
  const total = {
    minX: Math.min(...all.map((b) => b.minX)),
    minY: Math.min(...all.map((b) => b.minY)),
    maxX: Math.max(...all.map((b) => b.maxX)),
    maxY: Math.max(...all.map((b) => b.maxY)),
  };
  const size = (b: typeof total) => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
  const own = all[0];
  if (size(own) < BACKGROUND_COVER * size(total)) return -1;
  const area = rasterize(shapes[0].form, 0.5)?.areaMm2 ?? 0;
  return area >= BACKGROUND_SOLID * size(own) ? 0 : -1;
}

export async function digitizeSvg(file: File, prepare: PrepareOptions, options: DigitizeOptions): Promise<Digitized & { leftOut?: LeftOut[] }> {
  const vector = await decodeSvg(file);
  if (!vector) throw new Error('not an SVG of shapes');
  const { canvas, svg } = vector;
  const client = new ImageClient();
  try {
    const widthMm = svg.widthMm ? Math.min(400, Math.max(10, svg.widthMm)) : prepare.widthMm;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    await client.load({ width: data.width, height: data.height, data: data.data });
    const name = file.name.replace(/\.[^.]+$/, '');
    // A file of plain shapes is sewn shape by shape, each whole; the rest goes the way of pictures.
    const all = svg.shapes(widthMm);
    if (all?.length) {
      const { threads, index } = threadsFor(svg.colors, prepare.threads);
      // A background is kept aside, not sewn (it can be sewn from the list "Not sewn").
      const bg = backgroundOf(all);
      const shapes = bg >= 0 ? all.filter((_, k) => k !== bg) : all;
      const mapped = shapes.map((s) => ({ ...s, color: index[s.color] }));
      const size = { w: widthMm, h: widthMm * svg.aspect };
      const d = await client.digitizeShapes(mapped, threads, options, size, false, name);
      if (bg < 0) return d;
      const [cx, cy] = shapesOrigin(size);
      // Its threads are only those of the shapes sewn; the background keeps its own color.
      const color = threadsFor([svg.colors[all[bg].color]], prepare.threads).threads[0];
      return { ...d, leftOut: [{ form: transformForm(all[bg].form, [1, 0, 0, 1, -cx, -cy]), color, reason: 'background' }] };
    }
    const { w, h, pxMm } = workingSize(widthMm, canvas.width, canvas.height);
    const exact = await svg.labels(w, h, pxMm);
    await client.prepare({ ...prepare, widthMm, smooth: 0 }, [], [], exact);
    return await client.digitize(options, name);
  } finally {
    client.dispose();
    svg.dispose();
  }
}

export class ImageMode {
  private client = new ImageClient();
  private picker = new ThreadPicker('.image-color .sw');
  private source: HTMLCanvasElement | null = null;
  /** The image as shapes and colors, for SVG files. */
  private svg: SvgDesign | null = null;
  /** Its regions at the last working size. */
  private exact: ExactLabels | null = null;
  private name = '';
  /** The image file as opened, for project files. */
  private file: StoredImage | null = null;
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
  /** The step of the assistant shown (kept over a reload while there is an image). */
  private step: Step = 1;
  /** The picture of the last session was looked for (until then the stored step stays). */
  private restored = false;
  /** A picture is being opened. */
  private loading = false;

  constructor(private h: ImageHooks) {
    onLangChange(() => this.render());
    const s = h.settings.image;
    const input = $<HTMLInputElement>('image-input');
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) {
        if (h.mode() !== 'image') h.setMode('image');
        void this.load(f);
      }
      input.value = '';
    });
    $('image-example').addEventListener('click', () => void this.loadExample());

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
    num('image-tolerance', (v) => (s.stitch.tolerance = v), 'stitches');
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
    $('image-strokes-redo').addEventListener('click', () => this.redo());
    $('image-strokes-clear').addEventListener('click', () => this.clearStrokes());
    $('image-ai-copy').addEventListener('click', () => void this.copyPrompt());
    $('image-clear').addEventListener('click', () => this.clear());
    $('image-take').addEventListener('click', () => void this.take());
    this.bindSteps();
    this.bindMaterial();
    this.registerCommands();
    this.render();
  }

  // The assistant ---------------------------------------------------------------

  /** The stepper over the stage, back and next under the settings, and the way out. */
  private bindSteps(): void {
    try {
      const v = Number(localStorage.getItem(STEP_KEY));
      if (v === 2 || v === 3) this.step = v;
    } catch {
      /* private mode: the assistant starts at step 1 */
    }
    document.querySelectorAll<HTMLButtonElement>('.image-stepper [data-goto]').forEach((b) =>
      b.addEventListener('click', () => this.goStep(Number(b.dataset.goto) as Step)),
    );
    $('image-back').addEventListener('click', () => this.goStep(Math.max(1, this.step - 1) as Step));
    $('image-next').addEventListener('click', () => this.goStep(Math.min(3, this.step + 1) as Step));
    $('image-cancel').addEventListener('click', () => this.cancel());
    // Opening the assistant without a picture starts at its beginning; leaving it puts the brush away.
    let mode = document.body.dataset.mode;
    new MutationObserver(() => {
      const now = document.body.dataset.mode;
      if (now === mode) return;
      mode = now;
      // A picture dropped from elsewhere starts the assistant anew; its load moves on to step 2.
      if (now === 'image' && this.loading) this.step = 1;
      else if (now === 'image' && this.restored && !this.source) this.goStep(1);
      else if (now !== 'image' && this.tool !== 'none') this.setTool('none');
    }).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
  }

  /** Shows a step of the assistant; the stage shows what the step is about. */
  goStep(n: Step, view = true): void {
    const was = this.step;
    this.step = n;
    try {
      localStorage.setItem(STEP_KEY, String(n));
    } catch {
      /* private mode: the step is just not kept */
    }
    if (view && this.h.settings.image.view !== STEP_VIEW[n]) {
      this.h.settings.image.view = STEP_VIEW[n];
      this.h.save();
    }
    // The brush belongs to step 2, where the colors are.
    if (n !== 2 && this.tool !== 'none') this.setTool('none');
    this.render();
    this.h.redraw();
    // The inspector comes and goes with step 1: the picture is fitted into the stage it leaves.
    if ((was === 1) !== (n === 1) && this.h.mode() === 'image') requestAnimationFrame(() => requestAnimationFrame(() => this.h.fit()));
    this.maybeReveal();
  }

  /** The first stitches of a newly opened picture are shown "as sewn" once the user reaches them. */
  private maybeReveal(): void {
    if (!this.revealPending || !this.result || this.step !== 3 || this.h.mode() !== 'image') return;
    this.revealPending = false;
    const first = !this.h.settings.image.introDone;
    this.h.settings.image.introDone = true;
    this.h.save();
    this.h.reveal(first);
  }

  /** Back to Gestalten; the picture and its changes stay for later. */
  private cancel(): void {
    this.setTool('none');
    this.h.setMode('flow');
  }

  /** The stitches become a design in the list, and the assistant closes. */
  private async take(): Promise<void> {
    const d = this.result;
    if (!d || this.busy) return;
    this.setTool('none');
    await this.h.takeOver(d, this.name || 'image');
  }

  private async loadExample(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}examples/image-example.svg`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this.load(new File([await res.blob()], 'image-example.svg', { type: 'image/svg+xml' }));
    } catch (err) {
      console.error('Loading the example image failed', err);
    }
  }

  private clearStrokes(): void {
    if (!this.work.strokes.length) return;
    this.commit({ ...this.work, strokes: [] });
  }

  private async copyPrompt(): Promise<void> {
    const copy = $<HTMLButtonElement>('image-ai-copy');
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
  }

  private setView(v: ImageView): void {
    this.h.settings.image.view = v;
    this.h.save();
    this.render();
    this.h.redraw();
  }

  /**
   * Fabric and thread in step 3: the same material as everywhere, so these pickers pass the choice
   * to the material panel, which stores it and tells everyone that needs it.
   */
  private bindMaterial(): void {
    for (const [mine, theirs] of [['image-fabric', 'fabric'], ['image-thread', 'thread']] as const) {
      const sel = $<HTMLSelectElement>(mine);
      sel.addEventListener('change', () => {
        const real = document.getElementById(theirs) as HTMLSelectElement | null;
        if (real) {
          real.value = sel.value;
          real.dispatchEvent(new Event('change'));
          return;
        }
        this.h.settings.profile = { ...this.h.settings.profile, [theirs]: sel.value };
        this.h.save();
        this.profileChanged();
      });
    }
  }

  /** Every action of the assistant as a command (buttons, command search, key overview). */
  private registerCommands(): void {
    const G = 'shell.image.start' as const;
    const inImage = () => this.h.mode() === 'image';
    const enter = () => {
      if (!inImage()) this.h.setMode('image');
    };
    command({
      id: 'image.open',
      label: 'image.open',
      group: G,
      run: () => {
        enter();
        $<HTMLInputElement>('image-input').click();
      },
    });
    command({
      id: 'image.example',
      label: 'image.example',
      group: G,
      run: () => {
        enter();
        void this.loadExample();
      },
    });
    const steps: [Step, Key][] = [[1, 'image.cmd.step1'], [2, 'image.cmd.step2'], [3, 'image.cmd.step3']];
    for (const [n, label] of steps) {
      command({
        id: `image.step${n}`,
        label,
        group: G,
        when: () => !inImage() || this.step !== n,
        run: () => {
          enter();
          this.goStep(n);
        },
      });
    }
    // Mod+Z and Mod+Shift+Z are edit.undo and edit.redo (src/app/keys.ts sends them here in Bild).
    command({ id: 'image.undoStroke', label: 'image.undo', group: G, when: () => inImage() && this.undoStack.length > 0, run: () => this.undo() });
    command({ id: 'image.redoStroke', label: 'image.redo', group: G, when: () => inImage() && this.redoStack.length > 0, run: () => this.redo() });
    const tools: [Tool, Key][] = [['paint', 'image.cmd.paint'], ['erase', 'image.cmd.erase'], ['none', 'image.cmd.none']];
    for (const [tool, label] of tools) {
      command({
        id: `image.brush.${tool}`,
        label,
        group: G,
        when: () => inImage() && !!this.prepared && this.tool !== tool,
        run: () => {
          if (tool !== 'none' && this.step !== 2) this.goStep(2);
          this.setTool(tool);
        },
      });
    }
    command({ id: 'image.strokes.clear', label: 'image.strokes.clear', group: G, when: () => inImage() && this.work.strokes.length > 0, run: () => this.clearStrokes() });
    command({ id: 'image.take', label: 'image.take', group: G, when: () => inImage() && !!this.result && !this.busy, run: () => void this.take() });
    command({ id: 'image.cancel', label: 'image.cancel', group: G, when: inImage, run: () => this.cancel() });
    command({ id: 'image.shine', label: 'image.shine', group: 'shell.group.view', when: () => inImage() && !!this.result, run: () => $('image-shine').click() });
    const views: [ImageView, Key][] = [['original', 'image.cmd.view.original'], ['prepared', 'image.cmd.view.prepared'], ['stitches', 'image.cmd.view.stitches']];
    for (const [v, label] of views) {
      command({ id: `image.view.${v}`, label, group: 'shell.group.view', when: () => inImage() && this.h.settings.image.view !== v, run: () => this.setView(v) });
    }
    command({ id: 'image.ai.copy', label: 'image.ai.copy', group: G, when: inImage, run: () => void this.copyPrompt() });
    command({ id: 'image.stitch.reset', label: 'image.stitch.reset', group: G, when: () => inImage() && Object.keys(this.h.settings.image.stitch).length > 0, run: () => $('image-stitch-reset').click() });
    command({ id: 'image.saveProject', label: 'image.saveProject', group: G, when: () => inImage() && !!this.source, run: () => $('image-save-project').click() });
    command({ id: 'image.clear', label: 'image.clear', group: G, when: () => inImage() && (!!this.source || !!this.error), run: () => this.clear() });
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
    try {
      const stored = await loadImage();
      // An image opened meanwhile wins over the stored one.
      if (!stored || this.loads !== before) return;
      const { image, work } = stored;
      await this.load(new File([image.data], image.name, { type: image.type }), work);
    } finally {
      this.restored = true;
      if (!this.source && this.step !== 1) this.goStep(1, this.h.mode() === 'image');
    }
  }

  /** The image with its color changes and brush strokes, or null without an image. */
  snapshot(): { image: StoredImage; work: StoredWork } | null {
    return this.source && this.file ? { image: this.file, work: structuredClone(this.work) } : null;
  }

  /** Opens the image of a project with its changes; it replaces the current one, also in storage. */
  async open(image: StoredImage, work: StoredWork): Promise<void> {
    await saveImage(image);
    await saveWork(work);
    await this.load(new File([image.data], image.name, { type: image.type }), work);
  }

  /** Opens an image; `work` restores stored changes (and keeps the stored settings). */
  async load(file: File, work?: Work): Promise<void> {
    this.loading = true;
    try {
      await this.read(file, work);
    } finally {
      this.loading = false;
    }
  }

  private async read(file: File, work?: Work): Promise<void> {
    const token = ++this.loads;
    let canvas: HTMLCanvasElement;
    let svg: SvgDesign | null = null;
    let bytes: ArrayBuffer;
    try {
      const [vector, data] = await Promise.all([isSvg(file) ? decodeSvg(file) : null, file.arrayBuffer()]);
      canvas = vector?.canvas ?? (await decode(file));
      svg = vector?.svg ?? null;
      bytes = data;
      if (token !== this.loads) {
        svg?.dispose();
        return;
      }
    } catch (err) {
      if (token !== this.loads) return;
      this.error = t('image.error.load', { msg: err instanceof Error ? err.message : String(err) });
      this.render();
      return;
    }
    this.generation++;
    this.source = canvas;
    this.svg?.dispose();
    this.svg = svg;
    this.exact = null;
    this.file = { name: file.name, type: file.type, data: bytes };
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
      this.svg?.dispose();
      this.svg = null;
      this.error = t('image.error.load', { msg: err instanceof Error ? err.message : String(err) });
      this.render();
      this.h.redraw();
      return;
    }
    if (!work) {
      // Photos need smoothing to form regions; graphics keep their edges.
      this.h.settings.image.prepare.smooth = photo && !svg ? 3 : 0;
      // An SVG with a size in mm, cm or inches is sewn at that size.
      if (svg?.widthMm) this.h.settings.image.prepare.widthMm = Math.round(Math.min(400, Math.max(10, svg.widthMm)) * 10) / 10;
      this.h.save();
      void saveImage({ name: file.name, type: file.type, data: bytes });
      // A new picture chosen in step 1 (or brought in from outside): on to its colors, the next
      // thing to look at. A later step the user chose while it was opened stays.
      if (this.step === 1) this.goStep(2);
    }
    this.render();
    this.h.fit();
    this.run('prepare', 0);
  }

  /** Takes the image out: the mode is empty again, also after a reload. Taken over designs stay. */
  clear(): void {
    if (!this.source && !this.error) return;
    // Loads and results still on their way belong to the image that is gone.
    this.loads++;
    this.generation++;
    clearTimeout(this.timer);
    this.needPrepare = this.needStitches = false;
    this.busy = null;
    this.source = null;
    this.svg?.dispose();
    this.svg = null;
    this.exact = null;
    this.file = null;
    this.name = '';
    this.work = { edits: [], strokes: [] };
    this.undoStack = [];
    this.redoStack = [];
    this.prepared = null;
    this.preparedImg = null;
    this.result = null;
    this.validation = null;
    this.error = '';
    this.stroke = null;
    this.setTool('none');
    void clearImage();
    this.goStep(1);
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
    return { ...digitizeDefaults(this.h.settings.profile), trimMm: this.h.settings.trimMm, ...this.h.settings.image.stitch };
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
          const exact = await this.exactLabels();
          if (stale() || this.needPrepare) continue;
          const p = await this.client.prepare(this.h.settings.image.prepare, this.work.edits, this.work.strokes, exact);
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
        this.maybeReveal();
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

  /** The SVG's regions at the current working size (drawn again when the size changes). */
  private async exactLabels(): Promise<ExactLabels | undefined> {
    const svg = this.svg;
    if (!svg || !this.source) return undefined;
    const { w, h, pxMm } = workingSize(this.h.settings.image.prepare.widthMm, this.source.width, this.source.height);
    if (this.exact?.width === w && this.exact.height === h) return this.exact;
    const exact = await svg.labels(w, h, pxMm);
    if (this.svg === svg) this.exact = exact;
    return exact;
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
    const st = this.h.settings;
    if (view === 'stitches' && this.result && st.realistic && st.fabricLook) drawFabric(ctx, vp, st.profile.fabric, background);
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
      if (!s.realistic || !drawThreads(ctx, vp, p, 1, s.threadMm)) drawStitches(ctx, vp, p, 1, shownMarks(s).jumps);
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
    const over = this.source ? hoopShort(W, H, this.h.settings.hoop) : '';
    out('image-height', this.source ? t('image.size', { w: formatNumber(W, 0), h: formatNumber(H, 0) }) + (over ? ` · ${over}` : '') : '');
    $('image-height').classList.toggle('hoop-over', !!over);
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
    setVal('image-tolerance', o.tolerance);
    out('image-tolerance-out', `${formatNumber(o.tolerance, 2)} mm`);
    $<HTMLInputElement>('image-underlay').checked = o.underlay;
    const angle = $<HTMLSelectElement>('image-angle');
    if (!angle.options.length) {
      angle.append(new Option('', 'flow'), new Option('', 'auto'), ...ANGLES.map((a) => new Option(`${a}°`, String(a))));
    }
    angle.options[0].text = t('image.angle.flow');
    angle.options[1].text = t('image.angle.auto');
    // Shapes of an SVG are flat, without structure to follow: their rows run straight.
    angle.options[0].hidden = !!this.svg;
    angle.value = o.angle !== null ? String(o.angle) : o.flow && !this.svg ? 'flow' : 'auto';
    $('image-stitch-reset').hidden = !Object.keys(s.stitch).length;
    this.renderMaterial();
    document.querySelectorAll<HTMLInputElement>('input[name="image-view"]').forEach((el) => (el.checked = el.value === s.view));
    setVal('image-brush', s.brushMm);
    out('image-brush-out', `${formatNumber(s.brushMm, 1)} mm`);
    for (const [id, cmd, has] of [
      ['image-strokes-undo', 'image.undoStroke', this.undoStack.length > 0],
      ['image-strokes-redo', 'image.redoStroke', this.redoStack.length > 0],
    ] as const) {
      const b = $<HTMLButtonElement>(id);
      b.disabled = !has;
      b.title = commandTitle(getCommand(cmd)!);
      b.setAttribute('aria-label', b.title);
    }
    $<HTMLButtonElement>('image-strokes-clear').disabled = !this.work.strokes.length;
    // The prompt for preparing the image with one's own AI, with this design's size and colors:
    // 1 mm in the embroidery as a share of the image width is the smallest detail worth keeping.
    $<HTMLTextAreaElement>('image-ai-prompt').value = t('image.ai.text', {
      w: formatNumber(s.prepare.widthMm, 0),
      n: s.prepare.maxColors,
      d: formatNumber(Math.max(0.2, 100 / s.prepare.widthMm), 1),
    });
    $('image-brush-hint').textContent = t(this.tool === 'none' ? 'image.brush.hint' : this.tool === 'paint' ? 'image.brush.paint' : 'image.brush.erase');

    // Colors and regions of an SVG come from the file: nothing to reduce or smooth.
    $('image-svg-note').hidden = !this.svg;
    $('image-colors-field').hidden = $('image-smooth-field').hidden = !!this.svg;
    const info = $('image-info');
    info.textContent =
      this.error ||
      (this.svg
        ? t('image.info.svg', { name: this.name, n: this.svg.colors.length })
        : this.source
          ? t('image.info', { name: this.name, w: this.source.width, h: this.source.height })
          : '');
    info.classList.toggle('error', !!this.error);
    $('image-file').hidden = !this.source && !this.error;
    $('image-drop').classList.toggle('compact', !!this.source);
    $('image-views').hidden = !this.source;
    $('image-save-project').hidden = !this.source;
    $('image-clear').hidden = !this.source && !this.error;
    this.renderSteps();
    this.renderPalette();
    this.renderResult();
  }

  /** The stepper, back, next and take over: where the user is and what is ready. */
  private renderSteps(): void {
    const n = this.step;
    document.body.dataset.imageStep = String(n);
    const ready: Record<Step, boolean> = { 1: !!this.source, 2: !!this.prepared, 3: !!this.result };
    document.querySelectorAll<HTMLButtonElement>('.image-stepper [data-goto]').forEach((b) => {
      const k = Number(b.dataset.goto) as Step;
      if (k === n) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('ready', ready[k]);
      b.title = t(`image.cmd.step${k}` as Key);
    });
    const back = $<HTMLButtonElement>('image-back');
    back.hidden = n === 1;
    const next = $<HTMLButtonElement>('image-next');
    next.hidden = n === 3;
    next.disabled = n === 1 && !this.source;
    next.title = next.disabled ? t('image.noImage') : t(`image.cmd.step${Math.min(3, n + 1)}` as Key);
    $('image-take').hidden = n !== 3;
    $('image-cancel').title = t('image.cancel.hint');
  }

  /** Fabric and thread of step 3 show the material in use. */
  private renderMaterial(): void {
    const p = this.h.settings.profile;
    const fill = (id: string, items: readonly { id: string }[], label: (id: string) => string, value: string) => {
      const sel = $<HTMLSelectElement>(id);
      if (sel.options.length !== items.length) sel.replaceChildren(...items.map((x) => new Option('', x.id)));
      items.forEach((x, i) => (sel.options[i].text = label(x.id)));
      sel.value = value;
    };
    fill('image-fabric', FABRICS, (id) => t(`fabric.${id}` as Key), p.fabric);
    fill('image-thread', THREADS, (id) => t(`thread.${id}` as Key), p.thread);
  }

  private renderPalette(): void {
    const list = $<HTMLUListElement>('image-palette');
    const p = this.prepared;
    if (!p) {
      list.replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: t(this.source ? 'image.busy' : 'image.noImage') }));
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
    // The status in the bar over the stage: what is being computed, or what went wrong.
    const status = $('image-status');
    status.textContent = busyText || this.error;
    status.classList.toggle('busy', !!busyText);
    status.classList.toggle('error', !busyText && !!this.error);
    $('image-take-hint').hidden = !d;
    if (!d) {
      dl.replaceChildren();
      verdict.replaceChildren(
        Object.assign(document.createElement('p'), { className: 'muted small', textContent: this.source ? this.error || t('image.busy') : t('image.noImage') }),
      );
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
      ['image.result.time', t('image.result.minutes', { m: formatNumber(sewingSeconds(st.stitches, st.trims, st.colorChanges, this.h.settings) / 60, 0) })],
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
    box.append(head, Object.assign(document.createElement('p'), { textContent: t(worst ? 'image.verdict.check' : 'image.verdict.safe', { n: open.length }) }));
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
