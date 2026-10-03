import { thinSweeps } from '../correct/thin';
import { moveRecords, nearestStitch, removeStitches, stitchesInRect } from '../model/edit';
import { type Pattern } from '../model/pattern';
import { POINTS_MIN_SCALE } from '../render/editOverlay';
import { tagShortStitches, TIE } from '../validation/shortStitches';

/** Pick radius around the pointer, CSS pixels. */
const PICK_PX = 8;

export interface EditView {
  selection: ReadonlySet<number>;
  /** Stitch under the pointer, or -1. */
  hover: number;
  /** Rubber band in world mm while selecting a rectangle. */
  band: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface EditorHooks {
  /** The active file's pattern. */
  pattern: () => Pattern | null;
  /** Stores an edited pattern (one undo step). */
  commit: (p: Pattern) => void;
  redraw: () => void;
  /** Selection or mode changed (panel texts). */
  changed: () => void;
}

type Drag =
  | { mode: 'move'; x: number; y: number; base: Pattern; indices: number[] }
  | { mode: 'band'; additive: boolean }
  | { mode: 'pan'; sx: number; sy: number; moved: boolean };

/**
 * Manual stitch editing: pick, box-select, drag, nudge with the arrow keys, delete and thin.
 * Coordinates passed in are world millimetres; the pattern uses 0.1 mm.
 */
export class Editor implements EditView {
  active = false;
  selection = new Set<number>();
  hover = -1;
  band: EditView['band'] = null;
  /** Pattern shown while a drag is in progress. */
  preview: Pattern | null = null;
  private drag: Drag | null = null;

  constructor(private hooks: EditorHooks) {}

  setActive(on: boolean): void {
    this.active = on;
    this.reset();
  }

  /** Forgets selection and drag state (indices change with every structural edit). */
  reset(): void {
    this.selection.clear();
    this.hover = -1;
    this.band = null;
    this.preview = null;
    this.drag = null;
    this.hooks.changed();
  }

  /** Stitch under the pointer; only once the penetrations are drawn (zoomed in far enough). */
  private pick(x: number, y: number, scale: number): number {
    const p = this.hooks.pattern();
    return p && scale >= POINTS_MIN_SCALE ? nearestStitch(p, x * 10, y * 10, (PICK_PX / scale) * 10) : -1;
  }

  /** Abandons a drag (a second finger started a pinch). */
  cancel(): void {
    this.drag = null;
    this.preview = null;
    this.band = null;
  }

  /** Pointer pressed at world (x, y). Returns 'pan' when the caller should pan instead. */
  down(x: number, y: number, sx: number, sy: number, shift: boolean, scale: number): 'move' | 'band' | 'pan' {
    const p = this.hooks.pattern();
    if (!this.active || !p) return 'pan';
    const hit = this.pick(x, y, scale);
    if (hit >= 0) {
      if (shift) {
        if (this.selection.has(hit)) this.selection.delete(hit);
        else this.selection.add(hit);
      } else if (!this.selection.has(hit)) {
        this.selection = new Set([hit]);
      }
      this.hooks.changed();
      this.drag = { mode: 'move', x, y, base: p, indices: [...this.selection] };
      return 'move';
    }
    if (shift) {
      this.drag = { mode: 'band', additive: true };
      this.band = { x0: x, y0: y, x1: x, y1: y };
      return 'band';
    }
    this.drag = { mode: 'pan', sx, sy, moved: false };
    return 'pan';
  }

  /** Pointer moved with the button held. Returns true if the editor consumed it. */
  dragTo(x: number, y: number, sx: number, sy: number): boolean {
    const d = this.drag;
    if (!d) return false;
    if (d.mode === 'pan') {
      if (Math.hypot(sx - d.sx, sy - d.sy) > 3) d.moved = true;
      return false;
    }
    if (d.mode === 'band' && this.band) {
      this.band.x1 = x;
      this.band.y1 = y;
    } else if (d.mode === 'move') {
      const dx = Math.round((x - d.x) * 10);
      const dy = Math.round((y - d.y) * 10);
      this.preview = dx || dy ? moveRecords(d.base, d.indices, dx, dy) : null;
    }
    this.hooks.redraw();
    return true;
  }

  up(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'move' && this.preview) {
      const p = this.preview;
      this.preview = null;
      this.hooks.commit(p);
    } else if (d.mode === 'band' && this.band) {
      const p = this.hooks.pattern();
      const b = this.band;
      this.band = null;
      if (p) for (const i of stitchesInRect(p, b.x0 * 10, b.y0 * 10, b.x1 * 10, b.y1 * 10)) this.selection.add(i);
      this.hooks.changed();
    } else if (d.mode === 'pan' && !d.moved && this.selection.size) {
      this.selection.clear();
      this.hooks.changed();
    }
    this.hooks.redraw();
  }

  /** Hover highlight; returns true if it changed. */
  hoverAt(x: number, y: number, scale: number): boolean {
    const h = this.active ? this.pick(x, y, scale) : -1;
    if (h === this.hover) return false;
    this.hover = h;
    return true;
  }

  /** Moves the selection by (dx, dy) in 0.1 mm. */
  nudge(dx: number, dy: number): void {
    const p = this.hooks.pattern();
    if (!p || !this.selection.size) return;
    this.hooks.commit(moveRecords(p, this.selection, dx, dy));
  }

  deleteSelection(): void {
    const p = this.hooks.pattern();
    if (!p || !this.selection.size) return;
    const mask = new Uint8Array(p.cmd.length);
    for (const i of this.selection) mask[i] = 1;
    const next = removeStitches(p, mask);
    this.selection.clear();
    this.hooks.commit(next);
    this.hooks.changed();
  }

  /**
   * Thins the rows and zigzags inside the selection by `share` (0.25 removes every fourth row pair).
   * Returns the number of stitches removed.
   */
  thinSelection(share: number): number {
    const p = this.hooks.pattern();
    if (!p || !this.selection.size) return 0;
    const tags = tagShortStitches(p);
    const sel = this.selection;
    const r = thinSweeps(p, {
      needAt: (i) => (sel.has(i) ? share : 0),
      protect: tags.map((t) => (t === TIE ? 1 : 0)),
    });
    if (r.removed) {
      this.selection.clear();
      this.hooks.commit(r.pattern);
      this.hooks.changed();
    }
    return r.removed;
  }

  selectAll(): void {
    const p = this.hooks.pattern();
    if (!p) return;
    this.selection = new Set(stitchesInRect(p, -1e9, -1e9, 1e9, 1e9));
    this.hooks.changed();
    this.hooks.redraw();
  }
}
