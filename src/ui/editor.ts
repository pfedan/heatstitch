import { thinByHand } from '../correct/thinHand';
import { formatNumber } from '../i18n';
import { insertStitch, moveRecords, nearestSegment, nearestStitch, removeStitches, stitchesInRect, type RecordRange } from '../model/edit';
import type { HandChange } from '../model/handEdit';
import { STITCH, type Pattern } from '../model/pattern';
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
  /** Records editing is limited to (the object worked on), or null for all. */
  range: RecordRange | null;
  /** Penetration whose stitch lengths are labelled (the one dragged, or the only one selected), or -1. */
  grab: number;
  /** A length in mm as the label shows it. */
  formatMm: (mm: number) => string;
}

export interface EditorHooks {
  /** The active file's pattern. */
  pattern: () => Pattern | null;
  /** Stores an edited pattern (one undo step); `change` is null for edits not made point by point. */
  commit: (p: Pattern, change: HandChange | null) => void;
  /** Records editing is limited to, or null for all. */
  range: () => RecordRange | null;
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
  private grabbed = -1;
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

  formatMm = (mm: number): string => `${formatNumber(mm, 1)} mm`;

  get range(): RecordRange | null {
    return this.active ? this.hooks.range() : null;
  }

  get grab(): number {
    if (this.drag?.mode === 'move') return this.grabbed;
    return this.selection.size === 1 ? [...this.selection][0] : -1;
  }

  /**
   * Stitch under the pointer; only where the penetrations are drawn (zoomed in far enough, or
   * always within an object).
   */
  private pick(x: number, y: number, scale: number): number {
    const p = this.hooks.pattern();
    const range = this.range;
    return p && (range || scale >= POINTS_MIN_SCALE) ? nearestStitch(p, x * 10, y * 10, (PICK_PX / scale) * 10, range) : -1;
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
      this.grabbed = hit;
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
      this.hooks.commit(p, { moved: d.indices });
    } else if (d.mode === 'band' && this.band) {
      const p = this.hooks.pattern();
      const b = this.band;
      this.band = null;
      if (p) for (const i of stitchesInRect(p, b.x0 * 10, b.y0 * 10, b.x1 * 10, b.y1 * 10, this.range)) this.selection.add(i);
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
    this.hooks.commit(moveRecords(p, this.selection, dx, dy), { moved: [...this.selection] });
  }

  /**
   * A new penetration on the stitch nearest to world (x, y): the stitch is split there and the new
   * point selected. Returns false when no stitch is near.
   */
  insertAt(x: number, y: number, scale: number): boolean {
    const p = this.hooks.pattern();
    if (!this.active || !p) return false;
    const hit = nearestSegment(p, x * 10, y * 10, (PICK_PX / scale) * 10, this.range);
    if (!hit) return false;
    const next = insertStitch(p, hit.at, hit.x, hit.y);
    this.hooks.commit(next, { inserted: hit.at });
    this.selection = new Set([hit.at]);
    this.hooks.changed();
    return true;
  }

  /** Splits the stitch ending at the only selected penetration in the middle. */
  splitSelected(): boolean {
    const p = this.hooks.pattern();
    if (!p || this.selection.size !== 1) return false;
    const i = [...this.selection][0];
    if (i < 1 || p.cmd[i - 1] !== STITCH || p.cmd[i] !== STITCH) return false;
    const next = insertStitch(p, i, Math.round((p.x[i - 1] + p.x[i]) / 2), Math.round((p.y[i - 1] + p.y[i]) / 2));
    this.hooks.commit(next, { inserted: i });
    this.selection = new Set([i]);
    this.hooks.changed();
    return true;
  }

  /** Selects the penetration before or after the selected one in sewing order (within the range). */
  step(dir: number): number {
    const p = this.hooks.pattern();
    if (!p) return -1;
    const range = this.range;
    const lo = range?.first ?? 0;
    const hi = Math.min(range?.last ?? p.cmd.length - 1, p.cmd.length - 1);
    const sel = [...this.selection];
    let i = sel.length ? (dir > 0 ? Math.max(...sel) : Math.min(...sel)) : dir > 0 ? lo - 1 : hi + 1;
    do i += dir;
    while (i >= lo && i <= hi && p.cmd[i] !== STITCH);
    if (i < lo || i > hi) return -1;
    this.selection = new Set([i]);
    this.hooks.changed();
    return i;
  }

  deleteSelection(): void {
    const p = this.hooks.pattern();
    if (!p || !this.selection.size) return;
    const mask = new Uint8Array(p.cmd.length);
    for (const i of this.selection) mask[i] = 1;
    const next = removeStitches(p, mask);
    const removed = [...this.selection];
    this.selection.clear();
    this.hooks.commit(next, { removed });
    this.hooks.changed();
  }

  /**
   * Thins out the selection by `share` (see thinByHand): rows and zigzags spread at a wider
   * spacing, lines with longer stitches. Returns the number of stitches removed.
   */
  thinSelection(share: number): number {
    const p = this.hooks.pattern();
    if (!p || !this.selection.size) return 0;
    const tags = tagShortStitches(p);
    const sel = this.selection;
    const r = thinByHand(p, {
      needAt: (i) => (sel.has(i) ? share : 0),
      protect: tags.map((t) => (t === TIE ? 1 : 0)),
    });
    if (r.removed) {
      // Said as points removed, so the objects thinned stay what they were (one object each).
      const removed: number[] = [];
      r.mask.forEach((m, i) => m && removed.push(i));
      this.selection.clear();
      this.hooks.commit(r.pattern, { removed });
      this.hooks.changed();
    }
    return r.removed;
  }

  selectAll(): void {
    const p = this.hooks.pattern();
    if (!p) return;
    this.selection = new Set(stitchesInRect(p, -1e9, -1e9, 1e9, 1e9, this.range));
    this.hooks.changed();
    this.hooks.redraw();
  }
}
