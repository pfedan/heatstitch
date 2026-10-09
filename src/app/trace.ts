import { encodeTrace } from '../image/trace';
import { STITCH, type Pattern } from '../model/pattern';
import { placeTrace, sizedTrace, traceOf, withTrace, TRACE_VIEW, type StoredTrace, type Trace, type TraceView } from '../model/trace';
import { traceImage, type TraceScene } from '../render/trace';
import type { Settings } from '../settings';
import type { FileList, LoadedFile } from '../ui/fileList';
import { decode } from '../ui/imageMode';
import { TraceTool } from '../ui/traceTool';

/** What bindTrace needs from the rest of the app. */
export interface TraceApp {
  readonly files: FileList;
  readonly settings: Settings;
  readonly applyEdit: (p: Pattern) => void;
  readonly redraw: () => void;
  /** Starts an empty design (and makes it the active one). */
  readonly newDesign: () => Promise<void>;
  /** True while another tool owns the pointer (drawing, letters, rungs, an outline). */
  readonly busy: () => boolean;
}

/** The middle of the stitches, or the origin (where an empty design's hoop lies). */
function middleOf(p: Pattern): [number, number] {
  if (!p.cmd.includes(STITCH)) return [0, 0];
  const b = p.bounds;
  return [(b.minX + b.maxX) / 20, (b.minY + b.maxY) / 20];
}

/**
 * The tracing image of the active design: laying one (from a file or the picture of the Bild
 * mode), showing, locking and removing it, and the tool that moves and sizes it on the canvas.
 */
export function bindTrace(app: TraceApp) {
  const active = () => app.files.active;
  const view = (): TraceView => active()?.traceView ?? TRACE_VIEW;
  const shown = (): Trace | null => {
    const f = active();
    return f?.pattern && f.traceView.shown ? traceOf(f.pattern) : null;
  };

  const movable = () => (app.settings.mode === 'flow' && !view().locked && !app.busy() ? shown() : null);
  const traceTool = new TraceTool({
    movable,
    commit: (t) => {
      const p = active()?.pattern;
      if (p) app.applyEdit(withTrace(p, t));
    },
  });

  /** The opacity while its slider is dragged (stored when let go). */
  let opacityPreview: number | null = null;

  /** The image as the canvas shows it now, or null. */
  function traceScene(): TraceScene | null {
    const t = traceTool.preview ?? shown();
    if (!t) return null;
    const frame = !!movable();
    return { trace: t, img: traceImage(t, app.redraw), opacity: opacityPreview ?? view().opacity, frame, hover: frame ? traceTool.hover : null, dragging: traceTool.dragging };
  }

  /** Lays the design `f` a new tracing image (one undo step), with `view`. */
  function lay(f: LoadedFile, t: Trace, v: TraceView): void {
    if (!f.pattern) return;
    traceTool.cancel();
    if (app.files.active !== f) return;
    app.files.setTraceView(f, v);
    app.applyEdit(withTrace(f.pattern, t));
  }

  /**
   * Lays `picture` under the active design (a new empty one when there is none): `size` mm when
   * known, else as large as fits the hoop; centered on the stitches. Shown and free to move.
   */
  async function layPicture(picture: HTMLCanvasElement, name: string, size?: [number, number]): Promise<void> {
    const enc = await encodeTrace(picture);
    if (!active()?.pattern) await app.newDesign();
    const f = active();
    if (!f?.pattern) return;
    const center = middleOf(f.pattern);
    const place = size
      ? { x: center[0] - size[0] / 2, y: center[1] - size[1] / 2, w: size[0], h: size[1] }
      : placeTrace(enc.aspect, center, f.material.hoop);
    // A new picture keeps how strongly the design shows its picture.
    lay(f, { name, type: enc.type, data: enc.data, ...place }, { ...f.traceView, shown: true, locked: false });
  }

  /** Lays an image file under the active design. Throws when it cannot be read as a picture. */
  async function layFile(file: File): Promise<void> {
    const picture = await decode(file);
    await layPicture(picture, file.name.replace(/\.[^.]+$/, ''));
  }

  /**
   * The picture a design was made from, as its tracing image: exactly under its stitches (the Bild
   * mode sews around the middle of the picture), locked and hidden, so the design looks as before.
   */
  async function sourceTrace(picture: HTMLCanvasElement, name: string, size: [number, number]): Promise<StoredTrace> {
    const enc = await encodeTrace(picture);
    const [w, h] = size;
    return { name, type: enc.type, data: enc.data, x: -w / 2, y: -h / 2, w, h, shown: false, locked: true };
  }

  function setView(v: Partial<TraceView>): void {
    const f = active();
    if (!f) return;
    traceTool.cancel();
    app.files.setTraceView(f, v);
    app.redraw();
  }

  /** Shows the image with `opacity` while its slider moves; `done` keeps it for the design (no undo step, like the eye). */
  function setOpacity(opacity: number, done: boolean): void {
    opacityPreview = done ? null : opacity;
    if (done) setView({ opacity });
    else app.redraw();
  }

  /** Takes the tracing image away (one undo step). */
  function remove(): void {
    const p = active()?.pattern;
    if (!p || !traceOf(p)) return;
    traceTool.cancel();
    app.applyEdit(withTrace(p, null));
  }

  /** Shows the image `w` mm wide about its middle while the width is typed; `done` lays it so (one undo step). */
  function resize(w: number, done: boolean): void {
    const p = active()?.pattern;
    const t = p && traceOf(p);
    if (!p || !t || !(w > 0)) return;
    const sized = sizedTrace(t, w);
    traceTool.cancel();
    if (!done) {
      traceTool.preview = sized;
      app.redraw();
    } else if (sized.w !== t.w) app.applyEdit(withTrace(p, sized));
    else app.redraw();
  }

  /** The shown image's corners for fitting the view, or null. */
  const bounds = (): { minX: number; minY: number; maxX: number; maxY: number } | null => {
    const t = shown();
    return t ? { minX: t.x, minY: t.y, maxX: t.x + t.w, maxY: t.y + t.h } : null;
  };

  return { traceTool, traceScene, layPicture, layFile, sourceTrace, setView, setOpacity, remove, resize, bounds };
}

export type TraceControl = ReturnType<typeof bindTrace>;
