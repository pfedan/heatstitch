import type { Pt } from '../digitize/skeleton';

/** A press this near an end of the measurement (CSS pixels) moves that end; a finger reaches further. */
const GRAB_PX = 10;
const GRAB_TOUCH_PX = 22;
/** A press that moves less than this (CSS pixels) is a click: the second click sets the other end. */
const CLICK_PX = 5;
/** With Shift, the line goes in steps of this angle (degrees), as the cut does. */
const SNAP_DEG = 15;

export interface MeasureHooks {
  /** The needle point near (x, y) to snap to (world mm), or null; `reach` is in mm. */
  snap: (x: number, y: number, reach: number) => Pt | null;
  redraw: () => void;
}

/** How the pointer is used: Shift for steps of 15 degrees, Alt for no snapping, a finger reaches further. */
export interface MeasureInput {
  shift?: boolean;
  alt?: boolean;
  touch?: boolean;
}

/** A measured distance: length, horizontal and vertical part (mm) and the angle to the horizontal (0 to 180 degrees, clockwise). */
export interface Measured {
  length: number;
  dx: number;
  dy: number;
  angle: number;
}

/** Length, parts and angle of the line from `a` to `b` (world mm, y down). */
export function measured(a: Pt, b: Pt): Measured {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  // As the angle of a fill's rows (src/ui/stitchPanel): y points down, so it turns clockwise.
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle < 0) angle += 180;
  if (angle >= 180 - 1e-9) angle = 0;
  return { length: Math.hypot(dx, dy), dx: Math.abs(dx), dy: Math.abs(dy), angle };
}

/** `to` turned around `from` to the nearest step of 15 degrees, keeping its distance. */
export function angleSnapped(from: Pt, to: Pt): Pt {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const step = (SNAP_DEG * Math.PI) / 180;
  const a = Math.round(Math.atan2(to[1] - from[1], to[0] - from[0]) / step) * step;
  return [from[0] + d * Math.cos(a), from[1] + d * Math.sin(a)];
}

/**
 * Measuring a distance on the stage: drag from one point to another, or click (tap) one and then
 * the other. The ends can be dragged afterwards; a press elsewhere starts a new measurement. From
 * the zoom on where needle points show, an end snaps to the needle point under the pointer (Alt:
 * not), Shift holds the line to steps of 15 degrees. Nothing in the design changes. World mm.
 */
export class MeasureTool {
  active = false;
  /** The ends of the measurement; b is null before the line has a length. */
  a: Pt | null = null;
  b: Pt | null = null;
  /** The first end is set by a click and the second follows the pointer until the next click. */
  open = false;
  /** The needle point the pointer snapped to, for a ring on the stage. */
  snapAt: Pt | null = null;
  /** What the press moves: a new line, or one end of the finished line. */
  private drag: 'new' | 'a' | 'b' | null = null;
  private pressAt: Pt | null = null;
  private moved = false;
  private scale = 1;
  /** The measurement before the press, for a press that turns into a pinch. */
  private before: { a: Pt | null; b: Pt | null; open: boolean } | null = null;

  constructor(private hooks: MeasureHooks) {}

  start(): void {
    this.active = true;
    this.clear();
  }

  stop(): void {
    this.active = false;
    this.clear();
  }

  /** Drops the measurement; the tool stays. */
  clear(): void {
    this.a = this.b = this.snapAt = this.pressAt = this.before = null;
    this.open = this.moved = false;
    this.drag = null;
  }

  /** Whether there is a measurement (or one being made) that Esc would drop first. */
  get busy(): boolean {
    return this.a !== null;
  }

  /** The finished or growing measurement, or null while there is no line yet. */
  get result(): Measured | null {
    return this.a && this.b ? measured(this.a, this.b) : null;
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  down(x: number, y: number, scale: number, o: MeasureInput = {}): void {
    if (!this.active) return;
    this.scale = scale;
    this.before = { a: this.a, b: this.b, open: this.open };
    this.pressAt = [x, y];
    this.moved = false;
    if (this.open && this.a) {
      // The second click: the end goes where it is pressed, and follows a drag until released.
      this.drag = 'b';
      this.b = this.place(x, y, this.a, o);
      return this.hooks.redraw();
    }
    const grab = ((o.touch ? GRAB_TOUCH_PX : GRAB_PX) / scale) ** 2;
    const d2 = (p: Pt | null) => (p ? (p[0] - x) ** 2 + (p[1] - y) ** 2 : Infinity);
    if (this.a && this.b && Math.min(d2(this.a), d2(this.b)) <= grab) {
      this.drag = d2(this.a) <= d2(this.b) ? 'a' : 'b';
      return this.hooks.redraw();
    }
    this.drag = 'new';
    this.a = this.place(x, y, null, o);
    this.b = null;
    this.open = false;
    this.hooks.redraw();
  }

  dragTo(x: number, y: number, o: MeasureInput = {}): boolean {
    if (!this.active || !this.drag) return false;
    if (!this.moved && this.pressAt && Math.hypot(x - this.pressAt[0], y - this.pressAt[1]) * this.scale < CLICK_PX) return true;
    this.moved = true;
    if (this.drag === 'a') this.a = this.place(x, y, this.b, o);
    else this.b = this.place(x, y, this.a, o);
    this.hooks.redraw();
    return true;
  }

  up(): void {
    if (!this.active || !this.drag) return;
    // A click without a drag sets the first end; the second click (or tap) sets the other.
    if (this.drag === 'new' && !this.moved) this.open = true;
    else if (this.drag === 'b' || this.drag === 'new') this.open = false;
    // The second click on the first end measures nothing: the line stays open.
    if (this.a && this.b && this.a[0] === this.b[0] && this.a[1] === this.b[1]) {
      this.b = null;
      this.open = true;
    }
    this.drag = null;
    this.pressAt = this.before = null;
    this.hooks.redraw();
  }

  /** The pointer moved without a press: the open end follows it, and the snap ring shows. */
  hoverAt(x: number, y: number, scale: number, o: MeasureInput = {}): boolean {
    if (!this.active || this.drag) return false;
    this.scale = scale;
    const had = this.snapAt;
    if (this.open && this.a) {
      this.b = this.place(x, y, this.a, o);
      return true;
    }
    this.place(x, y, null, o);
    return had !== this.snapAt && !(had && this.snapAt && had[0] === this.snapAt[0] && had[1] === this.snapAt[1]);
  }

  /** A second finger came: the press was for zooming, so the measurement goes back to before it. */
  abortPress(): void {
    if (!this.drag) return;
    if (this.before) ({ a: this.a, b: this.b, open: this.open } = this.before);
    this.drag = null;
    this.pressAt = this.before = null;
    this.snapAt = null;
  }

  /** Where an end goes for the pointer at (x, y): on a near needle point, or in a step of 15 degrees from `from`. */
  private place(x: number, y: number, from: Pt | null, o: MeasureInput): Pt {
    if (o.shift && from) {
      this.snapAt = null;
      return angleSnapped(from, [x, y]);
    }
    this.snapAt = o.alt ? null : this.hooks.snap(x, y, (o.touch ? GRAB_TOUCH_PX : GRAB_PX) / this.scale);
    return this.snapAt ?? [x, y];
  }
}
