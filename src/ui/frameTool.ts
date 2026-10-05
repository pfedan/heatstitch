import type { Pt } from '../digitize/skeleton';
import { apply, IDENTITY, rotation, scaling, translation, type Mat } from '../shape/path';

/** Pick radius of the handles, CSS pixels. */
const PICK_PX = 10;
/** Distance of the turn handle above the frame, CSS pixels. */
export const TURN_PX = 26;

export type FramePart = 'move' | 'turn' | 0 | 1 | 2 | 3;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FrameView {
  box: Box;
  /** The map while dragging (identity otherwise). */
  m: Mat;
  canScale: boolean;
  hover: FramePart | null;
  /** What is being dragged, for the label. */
  dragging: FramePart | null;
  /** Turn so far (degrees), for the label. */
  turn: number;
}

export interface FrameHooks {
  /** Shown while dragging (`final` false) or taken over (true). */
  change: (m: Mat, final: boolean) => void;
}

/** Corners in the order top left, top right, bottom right, bottom left. */
export const corners = (b: Box): Pt[] => [
  [b.minX, b.minY],
  [b.maxX, b.minY],
  [b.maxX, b.maxY],
  [b.minX, b.maxY],
];

/**
 * A frame around the selected object: dragging inside moves it, a corner scales it (the opposite
 * corner stays; same in both directions unless Shift), the handle above it turns it around its
 * middle (Shift: in steps of 15°). Coordinates are world millimetres.
 */
export class FrameTool implements FrameView {
  active = false;
  box: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  m: Mat = IDENTITY;
  canScale = true;
  hover: FramePart | null = null;
  dragging: FramePart | null = null;
  turn = 0;
  private from: Pt = [0, 0];
  private moved = false;

  constructor(private hooks: FrameHooks) {}

  open(box: Box, canScale: boolean): void {
    this.active = true;
    this.box = box;
    this.canScale = canScale;
    if (!this.dragging) this.m = IDENTITY;
  }

  close(): void {
    this.active = false;
    this.dragging = null;
    this.hover = null;
    this.m = IDENTITY;
  }

  pickAt(x: number, y: number, scale: number): FramePart | null {
    if (!this.active) return null;
    const r = PICK_PX / scale;
    const b = this.box;
    const cx = (b.minX + b.maxX) / 2;
    if (Math.hypot(x - cx, y - (b.minY - TURN_PX / scale)) < r) return 'turn';
    if (this.canScale) {
      const k = corners(b).findIndex(([px, py]) => Math.hypot(x - px, y - py) < r);
      if (k >= 0) return k as 0 | 1 | 2 | 3;
    }
    const m = 4 / scale;
    if (x >= b.minX - m && x <= b.maxX + m && y >= b.minY - m && y <= b.maxY + m) return 'move';
    return null;
  }

  /** Starts a drag on the frame; null when the pointer is not on it. */
  down(x: number, y: number, scale: number): FramePart | null {
    const part = this.pickAt(x, y, scale);
    if (part === null) return null;
    this.dragging = part;
    this.from = [x, y];
    this.moved = false;
    this.m = IDENTITY;
    this.turn = 0;
    return part;
  }

  dragTo(x: number, y: number, shift: boolean, scale: number): boolean {
    const part = this.dragging;
    if (part === null) return false;
    const [fx, fy] = this.from;
    // A press that moves less than a few pixels stays a click.
    if (!this.moved && Math.hypot(x - fx, y - fy) * scale < 3) return true;
    this.moved = true;
    const b = this.box;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    if (part === 'move') {
      let dx = Math.round((x - fx) * 10) / 10;
      let dy = Math.round((y - fy) * 10) / 10;
      // Shift keeps it on one line.
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      this.m = translation(dx, dy);
    } else if (part === 'turn') {
      let deg = ((Math.atan2(y - cy, x - cx) - Math.atan2(fy - cy, fx - cx)) * 180) / Math.PI;
      deg = ((deg + 540) % 360) - 180;
      deg = shift ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10;
      this.turn = deg;
      this.m = rotation(deg, cx, cy);
    } else {
      const c = corners(b);
      const [gx, gy] = c[part];
      const [ax, ay] = c[(part + 2) % 4];
      const w = gx - ax;
      const h = gy - ay;
      let sx = Math.abs(w) > 1e-6 ? (x - ax) / w : 1;
      let sy = Math.abs(h) > 1e-6 ? (y - ay) / h : 1;
      if (!shift) {
        // Same in both directions: along the diagonal.
        const s = ((x - ax) * w + (y - ay) * h) / (w * w + h * h);
        sx = sy = s;
      }
      sx = Math.max(0.05, Math.round(sx * 1000) / 1000);
      sy = Math.max(0.05, Math.round(sy * 1000) / 1000);
      this.m = scaling(sx, sy, ax, ay);
    }
    this.hooks.change(this.m, false);
    return true;
  }

  /** Ends a drag; true when it was one (not a click). */
  up(): boolean {
    const was = this.dragging !== null && this.moved;
    const m = this.m;
    this.dragging = null;
    this.moved = false;
    if (was) this.hooks.change(m, true);
    this.m = IDENTITY;
    this.turn = 0;
    return was;
  }

  cancel(): void {
    this.dragging = null;
    this.moved = false;
    this.m = IDENTITY;
    this.turn = 0;
  }

  hoverAt(x: number, y: number, scale: number): boolean {
    const h = this.pickAt(x, y, scale);
    if (h === this.hover) return false;
    this.hover = h;
    return true;
  }

  /** The frame's corners after the current map. */
  mappedCorners(): Pt[] {
    return corners(this.box).map((q) => apply(this.m, q));
  }
}
