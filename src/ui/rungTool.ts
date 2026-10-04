import { addRung, cornerRungs, cumulative, pointAt, project, rungFromLine, rungRange, seedRungs, type Rung } from '../digitize/rungs';
import type { Pt } from '../digitize/skeleton';
import type { Rails } from '../model/restitch';

/** Pick radius around the pointer for rung ends, CSS pixels; the line itself a little less. */
const PICK_END_PX = 10;
const PICK_LINE_PX = 6;

/** A satin column as the tool shows it: its rails and the rungs on it. */
export interface RungColumn {
  left: Pt[];
  right: Pt[];
  cl: number[];
  cr: number[];
  rungs: Rung[];
  /** The rungs are the column's own (false: suggested from its stitches, nothing set yet). */
  own: boolean;
  /** The column as it came, to give back what was not changed. */
  rails: Rails;
}

export interface RungPick {
  /** Column (satin) or -1 (lines drawn across a fill). */
  col: number;
  i: number;
  /** End picked: 0 on the left rail (or the line's start), 1 on the right, -1 the line itself. */
  end: 0 | 1 | -1;
}

export interface RungView {
  mode: 'satin' | 'fill';
  columns: RungColumn[];
  /** Lines drawn across a fill. */
  lines: [Pt, Pt][];
  selected: RungPick | null;
  hover: RungPick | null;
  /** The line being drawn. */
  draft: [Pt, Pt] | null;
}

export interface RungHooks {
  /** New rungs: shown at once (`final` false, while dragging) or taken over as one undo step. */
  change: (columns: Rails[][], final: boolean) => void;
  /** Lines across the fill changed (count shown in the panel). */
  lines: () => void;
  redraw: () => void;
  /** Says why something did not work. */
  say: (key: 'stitch.direction.miss' | 'stitch.direction.cross' | 'stitch.direction.cornersNone') => void;
}

type Drag = { kind: 'end'; pick: RungPick } | { kind: 'draw' } | null;

/**
 * Rungs on the canvas: lines across a satin column that set the direction of its stitches (dragged
 * across it to add one, its ends slid along the rails), or lines drawn across a fill to sew it as
 * satin along them. Coordinates are world millimetres.
 */
export class RungTool implements RungView {
  active = false;
  mode: 'satin' | 'fill' = 'satin';
  columns: RungColumn[] = [];
  /** Which satin part each column belongs to, to give the columns back per part. */
  private parts: number[] = [];
  lines: [Pt, Pt][] = [];
  /** Outline of the fill the lines are drawn on (to start a line only near it). */
  private loop: Pt[] = [];
  selected: RungPick | null = null;
  hover: RungPick | null = null;
  draft: [Pt, Pt] | null = null;
  private drag: Drag = null;

  constructor(private hooks: RungHooks) {}

  /** Starts on the satin columns of an object (rails per satin part). */
  openSatin(columns: Rails[][]): void {
    this.active = true;
    this.mode = 'satin';
    this.lines = [];
    this.selected = null;
    this.setColumns(columns);
  }

  /** Starts drawing lines across a fill with this outline. */
  openFill(loop: Pt[]): void {
    this.active = true;
    this.mode = 'fill';
    this.columns = [];
    this.parts = [];
    this.lines = [];
    this.loop = loop;
    this.selected = null;
  }

  close(): void {
    this.active = false;
    this.columns = [];
    this.lines = [];
    this.selected = this.hover = null;
    this.draft = null;
    this.drag = null;
  }

  /** The columns anew (after new stitches); the selection stays when the rungs are still there. */
  setColumns(columns: Rails[][]): void {
    this.parts = [];
    this.columns = [];
    columns.forEach((part, k) =>
      part.forEach((r) => {
        this.parts.push(k);
        this.columns.push({ left: r.left, right: r.right, cl: cumulative(r.left), cr: cumulative(r.right), rungs: r.rungs ?? seedRungs(r.left, r.right), own: !!r.rungs, rails: r });
      }),
    );
    const s = this.selected;
    if (s && (s.col >= this.columns.length || s.i >= this.columns[s.col].rungs.length)) this.selected = null;
  }

  /** How many rungs set the direction (null: the stitches' own, nothing set). */
  get count(): number | null {
    if (!this.columns.some((c) => c.own)) return null;
    return this.columns.reduce((a, c) => a + c.rungs.length, 0);
  }

  /** The columns per satin part, with the rungs as set now. */
  private result(): Rails[][] {
    const out: Rails[][] = [];
    this.columns.forEach((c, k) => {
      (out[this.parts[k]] ??= []).push(c.own ? { left: c.left, right: c.right, rungs: c.rungs.map((r) => [r[0], r[1]] as Rung) } : c.rails);
    });
    return out;
  }

  private ends(c: RungColumn, r: Rung): [Pt, Pt] {
    return [pointAt(c.left, c.cl, r[0]), pointAt(c.right, c.cr, r[1])];
  }

  /** The rung or line under the pointer (ends first), or null. */
  pick(x: number, y: number, scale: number): RungPick | null {
    const q: Pt = [x, y];
    const reachEnd = PICK_END_PX / scale;
    const reachLine = PICK_LINE_PX / scale;
    let best: { pick: RungPick; d: number } | null = null;
    const consider = (col: number, i: number, a: Pt, b: Pt) => {
      for (const [end, p] of [[0, a], [1, b]] as const) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d <= reachEnd && (!best || d < best.d)) best = { pick: { col, i, end }, d };
      }
      if (best && best.pick.end !== -1) return;
      const d = segDist(q, a, b);
      if (d <= reachLine && (!best || d < best.d)) best = { pick: { col, i, end: -1 }, d };
    };
    if (this.mode === 'satin') this.columns.forEach((c, k) => c.rungs.forEach((r, i) => consider(k, i, ...this.ends(c, r))));
    else this.lines.forEach(([a, b], i) => consider(-1, i, a, b));
    return (best as { pick: RungPick } | null)?.pick ?? null;
  }

  /** Whether a line may start here: on or near a column, or near the fill. */
  private near(x: number, y: number): boolean {
    const q: Pt = [x, y];
    if (this.mode === 'fill') {
      if (!this.loop.length) return true;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [px, py] of this.loop) {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
      return x >= minX - 5 && x <= maxX + 5 && y >= minY - 5 && y <= maxY + 5;
    }
    return this.columns.some((c) => {
      const a = project(c.left, c.cl, q);
      const b = project(c.right, c.cr, q);
      const w = Math.hypot(...sub(pointAt(c.left, c.cl, a.s), pointAt(c.right, c.cr, b.s)));
      return a.d + b.d <= w * 1.6 + 2;
    });
  }

  /** Pointer pressed: an end to drag, a rung to select, or a new line to draw. Returns 'pan' when not taken. */
  down(x: number, y: number, scale: number): 'move' | 'pan' {
    if (!this.active) return 'pan';
    const hit = this.pick(x, y, scale);
    if (hit) {
      this.selected = hit;
      this.drag = hit.end === -1 ? null : { kind: 'end', pick: hit };
      this.hooks.redraw();
      return 'move';
    }
    this.selected = null;
    if (!this.near(x, y)) {
      this.hooks.redraw();
      return 'pan';
    }
    this.drag = { kind: 'draw' };
    this.draft = [
      [x, y],
      [x, y],
    ];
    return 'move';
  }

  /** Pointer moved with the button held; true when the tool took it. */
  dragTo(x: number, y: number): boolean {
    const d = this.drag;
    if (!d) return false;
    if (d.kind === 'draw' && this.draft) this.draft[1] = [x, y];
    else if (d.kind === 'end') {
      const { col, i, end } = d.pick;
      if (this.mode === 'fill') this.lines[i][end as 0 | 1] = [x, y];
      else {
        const c = this.columns[col];
        const [lo, hi] = rungRange(c.rungs, i, end as 0 | 1, c.cl[c.cl.length - 1], c.cr[c.cr.length - 1]);
        const s = project(end === 0 ? c.left : c.right, end === 0 ? c.cl : c.cr, [x, y], lo, hi).s;
        c.rungs[i] = end === 0 ? [s, c.rungs[i][1]] : [c.rungs[i][0], s];
        c.own = true;
        this.hooks.change(this.result(), false);
      }
    }
    this.hooks.redraw();
    return true;
  }

  up(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'end') {
      if (this.mode === 'satin') this.hooks.change(this.result(), true);
      else this.hooks.lines();
    } else if (d.kind === 'draw' && this.draft) {
      const [a, b] = this.draft;
      this.draft = null;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) return this.hooks.redraw();
      if (this.mode === 'fill') {
        this.lines.push([a, b]);
        this.selected = { col: -1, i: this.lines.length - 1, end: -1 };
        this.hooks.lines();
      } else this.addFromLine(a, b);
    }
    this.hooks.redraw();
  }

  /** A rung from a line drawn across a column: in the first column whose two rails it meets. */
  private addFromLine(a: Pt, b: Pt): void {
    let crossed = false;
    for (const [k, c] of this.columns.entries()) {
      const r = rungFromLine(c.left, c.right, a, b);
      if (!r) continue;
      const next = addRung(c.rungs, r, c.cl[c.cl.length - 1], c.cr[c.cr.length - 1]);
      if (!next) {
        crossed = true;
        continue;
      }
      c.rungs = next;
      c.own = true;
      this.selected = { col: k, i: next.findIndex((x) => x[0] === r[0] && x[1] === r[1]), end: -1 };
      this.hooks.change(this.result(), true);
      return;
    }
    this.hooks.say(crossed ? 'stitch.direction.cross' : 'stitch.direction.miss');
  }

  /** Abandons a drag (a second finger started a pinch). */
  cancel(): void {
    this.drag = null;
    this.draft = null;
  }

  hoverAt(x: number, y: number, scale: number): boolean {
    const h = this.active ? this.pick(x, y, scale) : null;
    if (JSON.stringify(h) === JSON.stringify(this.hover)) return false;
    this.hover = h;
    return true;
  }

  /** Removes the selected rung or line; false when nothing is selected. */
  deleteSelected(): boolean {
    const s = this.selected;
    if (!s) return false;
    this.selected = null;
    if (this.mode === 'fill') {
      this.lines.splice(s.i, 1);
      this.hooks.lines();
    } else {
      const c = this.columns[s.col];
      c.rungs = c.rungs.filter((_, i) => i !== s.i);
      c.own = true;
      this.hooks.change(this.result(), true);
    }
    this.hooks.redraw();
    return true;
  }

  /** Rungs at the corners of each column, the others kept. */
  corners(): void {
    let changed = false;
    for (const c of this.columns) {
      const next = cornerRungs(c.left, c.right, c.rungs);
      if (JSON.stringify(next) === JSON.stringify(c.rungs)) continue;
      c.rungs = next;
      c.own = true;
      changed = true;
    }
    this.selected = null;
    if (changed) this.hooks.change(this.result(), true);
    else this.hooks.say('stitch.direction.cornersNone');
  }

  /** No rungs: even from end to end. */
  even(): void {
    for (const c of this.columns) {
      c.rungs = [];
      c.own = true;
    }
    this.selected = null;
    this.hooks.change(this.result(), true);
  }

  /** Back to the direction of the stitches (no rungs set). */
  follow(): void {
    const out: Rails[][] = [];
    this.columns.forEach((c, k) => (out[this.parts[k]] ??= []).push({ left: c.left, right: c.right }));
    this.selected = null;
    this.hooks.change(out, true);
  }
}

const sub = (a: Pt, b: Pt): [number, number] => [a[0] - b[0], a[1] - b[1]];

function segDist(q: Pt, a: Pt, b: Pt): number {
  const v = sub(b, a);
  const l2 = v[0] * v[0] + v[1] * v[1];
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * v[0] + (q[1] - a[1]) * v[1]) / l2)) : 0;
  return Math.hypot(q[0] - a[0] - v[0] * t, q[1] - a[1] - v[1] * t);
}
