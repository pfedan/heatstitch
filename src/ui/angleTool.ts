import type { Pt } from '../digitize/skeleton';
import { angleSnapped } from './measureTool';

/** A press that moves less than this (CSS pixels) sets no angle: a line needs a length to point. */
const CLICK_PX = 5;

export interface AngleHooks {
  /** The angle the selected fills have now and how far it turns (180: rows, 360: a direction), or null when they have none. */
  current: () => { value: number; turn: 180 | 360 } | null;
  /** The rows at `angle` (degrees, clockwise on screen): shown while dragging (`final` false), then taken over. */
  set: (angle: number, final: boolean) => void;
  /** The drag was dropped: back to angle `was` (NaN: chosen automatically), nothing taken over. */
  restore: (was: number) => void;
  redraw: () => void;
}

/** The angle of the line from `a` to `b` (world mm, y down) in whole degrees, 0 to `turn` (exclusive), clockwise as the rows'. */
export function lineAngle(a: Pt, b: Pt, turn: 180 | 360): number {
  const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return ((Math.round(deg) % turn) + turn) % turn;
}

/**
 * Setting the direction of a fill's rows by a line drawn across it on the stage: the rows follow
 * the line while it is dragged and are taken over when it is let go, which ends the tool (one undo
 * step). Shift holds the line to steps of 15 degrees, Esc during the drag puts the angle back. The
 * dial in the panel stays the way to set it by keyboard. World mm.
 */
export class AngleTool {
  active = false;
  a: Pt | null = null;
  b: Pt | null = null;
  /** The angle the line sets, once it has a length. */
  angle: number | null = null;
  /** The angle before the drag, to go back to (NaN: automatic). */
  private was = NaN;
  private turn: 180 | 360 = 180;
  private scale = 1;
  private moved = false;

  constructor(private hooks: AngleHooks) {}

  /** On for the selected fills, when they have an angle to set. */
  start(): boolean {
    if (!this.hooks.current()) return false;
    this.active = true;
    this.clear();
    this.hooks.redraw();
    return true;
  }

  stop(): void {
    if (!this.active) return;
    this.cancel();
    this.active = false;
    this.hooks.redraw();
  }

  toggle(): void {
    if (this.active) this.stop();
    else this.start();
  }

  get dragging(): boolean {
    return this.a !== null;
  }

  down(x: number, y: number, scale: number): void {
    if (!this.active) return;
    const now = this.hooks.current();
    if (!now) return this.stop();
    this.was = now.value;
    this.turn = now.turn;
    this.scale = scale;
    this.a = [x, y];
    this.b = null;
    this.angle = null;
    this.moved = false;
    this.hooks.redraw();
  }

  dragTo(x: number, y: number, shift = false): boolean {
    if (!this.active || !this.a) return false;
    if (!this.moved && Math.hypot(x - this.a[0], y - this.a[1]) * this.scale < CLICK_PX) return true;
    this.moved = true;
    this.b = shift ? angleSnapped(this.a, [x, y]) : [x, y];
    const angle = lineAngle(this.a, this.b, this.turn);
    if (angle !== this.angle) {
      this.angle = angle;
      this.hooks.set(angle, false);
    }
    this.hooks.redraw();
    return true;
  }

  /** Let go: the angle is taken over and the tool ends; a mere click leaves it on. */
  up(): void {
    if (!this.active || !this.a) return;
    const angle = this.moved ? this.angle : null;
    this.clear();
    if (angle === null) return this.hooks.redraw();
    this.active = false;
    this.hooks.set(angle, true);
    this.hooks.redraw();
  }

  /** Esc or a second finger: the line goes and the rows go back to where they were; the tool stays. */
  cancel(): void {
    if (!this.a) return;
    const changed = this.angle !== null;
    this.clear();
    if (changed) this.hooks.restore(this.was);
    this.hooks.redraw();
  }

  private clear(): void {
    this.a = this.b = this.angle = null;
    this.moved = false;
  }
}
