import { thinByHand } from '../correct/thinHand';
import { formatNumber } from '../i18n';
import { atThreadEnd, insertStitch, moveRecords, nearestSegment, nearestStitch, removeStitches, sewOn, stitchesInRect, stitchesTo, type RecordRange, type ThreadEnds } from '../model/edit';
import type { HandChange } from '../model/handEdit';
import { STITCH, type Pattern } from '../model/pattern';
import { POINTS_MIN_SCALE } from '../render/editOverlay';
import { tagShortStitches, TIE } from '../validation/shortStitches';
import { DST_MAX_DELTA } from '../writers/dst';

/** Pick radius around the pointer, CSS pixels. */
const PICK_PX = 8;
/** A stitch on the stitches themselves (not on a point) picks within this many pixels. */
const LINE_PX = 5;
/** Longest stitch set by hand in one go (0.1 mm): longer clicks are sewn in even steps, as a machine can sew them. */
export const HAND_MAX = DST_MAX_DELTA - 1;

/** What a click would sew while stitches are set one by one: from where, to where, and what follows. */
export interface PenPreview {
  /** The penetration sewn from (0.1 mm). */
  from: [number, number];
  /** Where the click puts the new one (0.1 mm); on an existing point when it snapped to it. */
  to: [number, number];
  snapped: boolean;
  /** Stitches the way is sewn in (more than 1 where it is longer than a machine stitch). */
  pieces: number;
  /** The penetration the thread goes on to afterwards, when the new one goes in between (0.1 mm). */
  next: [number, number] | null;
}

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
  /** Start and thread end of the object worked on, or null. */
  ends: ThreadEnds | null;
  /** Penetration whose way in and out is shown softly (the only one selected, or the one under the pointer), or -1. */
  focus: number;
  /** Setting stitches one by one: what a click would sew, or null. */
  pen: PenPreview | null;
}

export interface EditorHooks {
  /** The active file's pattern. */
  pattern: () => Pattern | null;
  /** Stores an edited pattern (one undo step); `change` is null for edits not made point by point. */
  commit: (p: Pattern, change: HandChange | null) => void;
  /** Records editing is limited to, or null for all. */
  range: () => RecordRange | null;
  /** Start and thread end of the object worked on (null without one). */
  ends?: () => ThreadEnds | null;
  /** Brings record `i` into view. */
  reveal?: (i: number) => void;
  /** Stitching on was turned on or off. */
  penChanged?: () => void;
  redraw: () => void;
  /** Selection or mode changed (panel texts). */
  changed: () => void;
}

type Drag =
  | { mode: 'move'; x: number; y: number; base: Pattern; indices: number[] }
  | { mode: 'band'; additive: boolean }
  | { mode: 'pan'; sx: number; sy: number; moved: boolean }
  | { mode: 'place'; x: number; y: number; sx: number; sy: number; scale: number; moved: boolean };

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
  /** Setting stitches one by one: each click sews a new penetration after the current one. */
  penOn = false;
  /** Pointer position (world 0.1 mm) and zoom, for the preview of the next stitch. */
  private cursor: { x: number; y: number; scale: number } | null = null;
  private grabbed = -1;
  private drag: Drag | null = null;
  /**
   * The thread end this editor sewed on to last, and how many records of tie-off follow it: known
   * from what was done, so the next click goes on from there even where the stitches, read anew,
   * would draw the line between stitches and tie-off elsewhere.
   */
  private tail: { at: number; span: number } | null = null;

  constructor(private hooks: EditorHooks) {}

  setActive(on: boolean): void {
    this.active = on;
    this.penOn = false;
    this.reset();
  }

  /** Turns setting stitches one by one on or off. */
  setPen(on: boolean): void {
    this.penOn = on && this.active;
    this.drag = null;
    this.hover = -1;
    this.hooks.penChanged?.();
    this.hooks.changed();
  }

  /** Forgets selection and drag state (indices change with every structural edit). */
  reset(): void {
    this.selection.clear();
    this.hover = -1;
    this.band = null;
    this.preview = null;
    this.drag = null;
    this.tail = null;
    this.hooks.changed();
  }

  formatMm = (mm: number): string => `${formatNumber(mm, 1)} mm`;

  get range(): RecordRange | null {
    return this.active ? this.hooks.range() : null;
  }

  get grab(): number {
    if (this.drag?.mode === 'move') return this.grabbed;
    if (this.penOn) return -1;
    return this.selection.size === 1 ? [...this.selection][0] : -1;
  }

  get ends(): ThreadEnds | null {
    return this.active ? (this.hooks.ends?.() ?? null) : null;
  }

  get focus(): number {
    if (this.drag?.mode === 'move') return -1;
    if (this.selection.size === 1) return [...this.selection][0];
    return this.penOn ? -1 : this.hover;
  }

  /**
   * Stitch under the pointer; only where the penetrations are drawn (zoomed in far enough, or
   * always within an object). Beside the points a click on a stitch itself takes its nearer end.
   */
  private pick(x: number, y: number, scale: number): number {
    const p = this.hooks.pattern();
    const range = this.range;
    if (!p || !(range || scale >= POINTS_MIN_SCALE)) return -1;
    const i = nearestStitch(p, x * 10, y * 10, (PICK_PX / scale) * 10, range);
    if (i >= 0) return i;
    const s = nearestSegment(p, x * 10, y * 10, (LINE_PX / scale) * 10, range);
    if (!s) return -1;
    const a = s.at - 1;
    return Math.hypot(p.x[a] - s.x, p.y[a] - s.y) < Math.hypot(p.x[s.at] - s.x, p.y[s.at] - s.y) ? a : s.at;
  }

  /** The penetration a new stitch is sewn from: the only one selected, else the thread end of the object. */
  anchor(): number {
    const p = this.hooks.pattern();
    if (!p) return -1;
    if (this.selection.size === 1) {
      const i = [...this.selection][0];
      return i < p.cmd.length && p.cmd[i] === STITCH ? i : -1;
    }
    return this.selection.size ? -1 : (this.ends?.end ?? -1);
  }

  /**
   * Where a click at (x, y) (0.1 mm) sets the next penetration: on an existing one within reach (the
   * thread goes into the same hole), else right there.
   */
  private target(x: number, y: number, scale: number, from: number): { x: number; y: number; snapped: boolean } {
    const p = this.hooks.pattern()!;
    const i = nearestStitch(p, x, y, (PICK_PX / scale) * 10, this.range);
    if (i >= 0 && i !== from) return { x: p.x[i], y: p.y[i], snapped: true };
    return { x: Math.round(x), y: Math.round(y), snapped: false };
  }

  /** The thread end at record `a` and its tie-off, when a new stitch after `a` continues the thread (see atThreadEnd). */
  private endAt(p: Pattern, a: number): { end: number; tie: number[] } | null {
    const t = this.tail;
    if (t && a === t.at && t.at + t.span < p.cmd.length) {
      const tie: number[] = [];
      for (let i = t.at + 1; i <= t.at + t.span; i++) if (p.cmd[i] === STITCH) tie.push(i);
      return { end: a, tie };
    }
    return atThreadEnd(p, a, this.ends);
  }

  get pen(): PenPreview | null {
    const p = this.hooks.pattern();
    const c = this.cursor;
    if (!this.penOn || !p || !c || this.drag?.mode === 'place' && this.drag.moved) return null;
    const a = this.anchor();
    if (a < 0) return null;
    const to = this.target(c.x, c.y, c.scale, a);
    const end = this.endAt(p, a);
    const from = end ? end.end : a;
    const pieces = stitchesTo(p.x[from], p.y[from], to.x, to.y, HAND_MAX).length;
    const after = end ? -1 : from + 1;
    const next = after > 0 && after < p.cmd.length && p.cmd[after] === STITCH ? ([p.x[after], p.y[after]] as [number, number]) : null;
    return { from: [p.x[from], p.y[from]], to: [to.x, to.y], snapped: to.snapped, pieces, next };
  }

  /**
   * Sews a new penetration where world (x, y) is (see target), after the current one (anchor); a
   * stitch longer than a machine can make is sewn in even steps. At the thread end the tie-off goes
   * along. The new penetration is the current one then, so the next click goes on from it.
   */
  placeAt(x: number, y: number, scale: number): boolean {
    const p = this.hooks.pattern();
    if (!this.active || !p) return false;
    let a = this.anchor();
    if (a < 0) return false;
    const end = this.endAt(p, a);
    if (end) a = end.end;
    const to = this.target(x * 10, y * 10, scale, a);
    if (to.x === p.x[a] && to.y === p.y[a]) return false;
    const pts = stitchesTo(p.x[a], p.y[a], to.x, to.y, HAND_MAX);
    const next = sewOn(p, a, pts, end?.tie);
    const span = end ? (end.tie.length ? end.tie[end.tie.length - 1] - end.end : 0) : 0;
    this.hooks.commit(next, { inserted: a + 1, count: pts.length });
    const i = a + pts.length;
    this.selection = new Set([i]);
    this.tail = end ? { at: i, span } : null;
    this.hooks.changed();
    this.hooks.reveal?.(i);
    return true;
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
    if (this.penOn && !shift) {
      // A click sews; a drag moves the view (see dragTo).
      this.drag = { mode: 'place', x, y, sx, sy, scale, moved: false };
      return 'move';
    }
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
    if (d.mode === 'pan' || d.mode === 'place') {
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
    if (d.mode === 'place') {
      if (!d.moved) this.placeAt(d.x, d.y, d.scale);
    } else if (d.mode === 'move' && this.preview) {
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
    this.cursor = this.active ? { x: x * 10, y: y * 10, scale } : null;
    const h = this.active && !this.penOn ? this.pick(x, y, scale) : -1;
    if (h === this.hover) return this.penOn;
    this.hover = h;
    return true;
  }

  /** The pointer left the stage: no preview of the next stitch. */
  leave(): void {
    this.cursor = null;
    this.hover = -1;
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

  /** Selects the first penetration of the object, or the one where its thread ends. */
  toEnd(which: 'first' | 'end'): number {
    const e = this.ends;
    if (!e) return -1;
    const i = which === 'first' ? e.first : e.end;
    this.selection = new Set([i]);
    this.hooks.changed();
    return i;
  }

  /** Selects the penetration `dir` steps before or after the selected one in sewing order (within the range). */
  step(dir: number, n = 1): number {
    let at = -1;
    for (let k = 0; k < n; k++) {
      const i = this.step1(dir);
      if (i < 0) break;
      at = i;
    }
    return at;
  }

  private step1(dir: number): number {
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

  /**
   * Deletes the selected penetrations; their neighbours are joined. When the thread end goes, its
   * tie-off moves to the penetration before, so the thread stays locked where it now ends. While
   * stitches are set one by one, the one before is the current one then (as a pen takes back its
   * last point).
   */
  deleteSelection(): void {
    let p = this.hooks.pattern();
    if (!p || !this.selection.size) return;
    const removed = [...this.selection].sort((a, b) => a - b);
    const ends = this.ends;
    const t = this.tail;
    const one = removed.length === 1 ? removed[0] : -1;
    const end = t && one === t.at ? this.endAt(p, one) : ends && this.selection.has(ends.end) ? atThreadEnd(p, ends.end, ends) : null;
    let before = removed[0] - 1;
    while (before >= 0 && (p.cmd[before] !== STITCH || this.selection.has(before))) before--;
    const first = this.range?.first ?? 0;
    if (end?.tie.length && before >= first) p = moveRecords(p, end.tie, p.x[before] - p.x[end.end], p.y[before] - p.y[end.end]);
    // The thread now ends at the one before, the same tie-off after it (the deleted record is gone).
    this.tail = end && before === end.end - 1 && before >= first ? { at: before, span: end.tie.length ? end.tie[end.tie.length - 1] - end.end : 0 } : null;
    const mask = new Uint8Array(p.cmd.length);
    for (const i of this.selection) mask[i] = 1;
    const next = removeStitches(p, mask);
    this.selection.clear();
    this.hooks.commit(next, { removed });
    if (this.penOn && removed.length === 1 && before >= (this.range?.first ?? 0) && this.hooks.pattern()?.cmd[before] === STITCH) this.selection.add(before);
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
