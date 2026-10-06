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
  /** Where a move snapped (world mm), drawn as a line across the stage; null: not snapped that way. */
  snapped: { x: number | null; y: number | null };
}

/** Lines a moved frame snaps to (world mm): edges and middles of the other objects, the middle of the rest. */
export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/** How near (screen pixels) an edge or middle has to come to a target to snap. */
export const SNAP_PX = 6;

/**
 * A move by (dx, dy) of `box`, its left, middle and right (top, middle, bottom) pulled onto the
 * nearest target within `reach` (mm) in each direction; `x`, `y` the target it hangs on.
 */
export function snapMove(box: Box, dx: number, dy: number, targets: SnapTargets, reach: number): { dx: number; dy: number; x: number | null; y: number | null } {
  const best = (sides: number[], d: number, list: number[]) => {
    let pick: { shift: number; at: number } | null = null;
    for (const s of sides) {
      for (const at of list) {
        const shift = at - (s + d);
        if (Math.abs(shift) <= reach && (!pick || Math.abs(shift) < Math.abs(pick.shift))) pick = { shift, at };
      }
    }
    return pick;
  };
  const sx = best([box.minX, (box.minX + box.maxX) / 2, box.maxX], dx, targets.xs);
  const sy = best([box.minY, (box.minY + box.maxY) / 2, box.maxY], dy, targets.ys);
  return { dx: dx + (sx?.shift ?? 0), dy: dy + (sy?.shift ?? 0), x: sx?.at ?? null, y: sy?.at ?? null };
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
  snapped: { x: number | null; y: number | null } = { x: null, y: null };
  /** What a move snaps to; none: it moves freely. */
  targets: SnapTargets | null = null;
  private from: Pt = [0, 0];
  private moved = false;

  constructor(private hooks: FrameHooks) {}

  open(box: Box, canScale: boolean, targets: SnapTargets | null = null): void {
    this.active = true;
    this.box = box;
    this.canScale = canScale;
    this.targets = targets;
    if (!this.dragging) this.m = IDENTITY;
  }

  close(): void {
    this.active = false;
    this.snapped = { x: null, y: null };
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

  /** `free` (Alt) moves without snapping. */
  dragTo(x: number, y: number, shift: boolean, scale: number, free = false): boolean {
    const part = this.dragging;
    if (part === null) return false;
    this.snapped = { x: null, y: null };
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
      if (this.targets && !free) {
        const s = snapMove(b, dx, dy, this.targets, SNAP_PX / scale);
        // Shift keeps the line it moves on.
        if (!shift || dx) dx = s.dx;
        if (!shift || dy) dy = s.dy;
        this.snapped = { x: !shift || dx ? s.x : null, y: !shift || dy ? s.y : null };
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
    this.snapped = { x: null, y: null };
    this.moved = false;
    if (was) this.hooks.change(m, true);
    this.m = IDENTITY;
    this.turn = 0;
    return was;
  }

  cancel(): void {
    this.dragging = null;
    this.snapped = { x: null, y: null };
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
