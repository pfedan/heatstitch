import { movedTrace, sizedTrace, type Trace } from '../model/trace';
import { traceCorners, type TracePart } from '../render/trace';

/** How near a corner the pointer grabs it (screen pixels). */
const PICK_PX = 9;

export interface TraceToolHost {
  /** The tracing image that can be moved now, or null (none, hidden, locked or another tool at work). */
  movable(): Trace | null;
  /** Lays the image where it was dragged to (one undo step). */
  commit(t: Trace): void;
}

/**
 * Moving and sizing the tracing image on the canvas while it is not locked: a drag inside it moves
 * it, a drag at a corner sizes it about the opposite corner, keeping its aspect ratio. Objects
 * under the pointer go first; only the corners lie above them.
 */
export class TraceTool {
  hover: TracePart | null = null;
  dragging: TracePart | null = null;
  /** The image as dragged so far, while a drag is under way. */
  preview: Trace | null = null;
  private from: { x: number; y: number; t: Trace } | null = null;

  constructor(private host: TraceToolHost) {}

  /** The image as it is shown now: as dragged, else as it lies. */
  current(): Trace | null {
    return this.preview ?? this.host.movable();
  }

  /** The part of the image at the point: a corner, the inside (unless an object lies there), or null. */
  pickAt(x: number, y: number, scale: number, objectHere: () => boolean): TracePart | null {
    const t = this.host.movable();
    if (!t) return null;
    const reach = PICK_PX / scale;
    const k = traceCorners(t).findIndex(([cx, cy]) => Math.abs(x - cx) <= reach && Math.abs(y - cy) <= reach);
    if (k >= 0) return k as TracePart;
    return x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h && !objectHere() ? 'move' : null;
  }

  /** Starts a drag when the press is on the image; true when it took the press. */
  down(x: number, y: number, scale: number, objectHere: () => boolean): boolean {
    const part = this.pickAt(x, y, scale, objectHere);
    const t = this.host.movable();
    if (part === null || !t) return false;
    this.dragging = part;
    this.from = { x, y, t };
    this.preview = null;
    return true;
  }

  dragTo(x: number, y: number): boolean {
    if (this.dragging === null || !this.from) return false;
    const { t } = this.from;
    if (this.dragging === 'move') {
      this.preview = movedTrace(t, x - this.from.x, y - this.from.y);
      return true;
    }
    // The opposite corner stays; the image grows to reach the pointer on its longer way.
    const k = this.dragging;
    const [ox, oy] = traceCorners(t)[(k + 2) % 4];
    const aspect = t.h / t.w;
    const want = Math.max(Math.abs(x - ox), Math.abs(y - oy) / aspect);
    const sized = sizedTrace(t, want);
    const right = k === 1 || k === 2;
    const down = k === 2 || k === 3;
    this.preview = { ...sized, x: right ? ox : ox - sized.w, y: down ? oy : oy - sized.h };
    return true;
  }

  /** Ends the drag; true when the image moved (and was laid there). */
  up(): boolean {
    const t = this.preview;
    const was = this.from?.t;
    this.cancel();
    if (!t || !was || (t.x === was.x && t.y === was.y && t.w === was.w && t.h === was.h)) return false;
    this.host.commit(t);
    return true;
  }

  cancel(): void {
    this.dragging = null;
    this.preview = null;
    this.from = null;
  }

  /** Follows the pointer; true when what it is over changed. */
  hoverAt(x: number, y: number, scale: number, objectHere: () => boolean): boolean {
    const part = this.pickAt(x, y, scale, objectHere);
    if (part === this.hover) return false;
    this.hover = part;
    return true;
  }

  /** The cursor for the part under the pointer. */
  cursor(): string {
    const p = this.dragging ?? this.hover;
    if (p === null) return '';
    if (p === 'move') return 'move';
    return p === 0 || p === 2 ? 'nwse-resize' : 'nesw-resize';
  }
}
