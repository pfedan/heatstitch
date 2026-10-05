import { addRung, cornerCuts, cornerRungs, cumulative, pointAt, project, rungFromLine, rungRange, seedRungs, type Rung } from '../digitize/rungs';
import { pathLength } from '../digitize/fill';
import { simplify } from '../digitize/run';
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
  /** Cut lines: the column is sewn in sections there (see Rails.cuts). */
  cuts: Rung[];
  /** Spacing set at rungs: distance along the left rail and spacing (mm). */
  spacings: [number, number][];
  /** The rungs are the column's own (false: suggested from its stitches, nothing set yet). */
  own: boolean;
  /** The column as it came, to give back what was not changed. */
  rails: Rails;
}

export interface RungPick {
  /** Column (satin) or -1 (lines drawn across a fill, guide lines). */
  col: number;
  i: number;
  /** End picked: 0 on the left rail (or the line's start), 1 on the right, -1 the line itself. */
  end: 0 | 1 | -1;
  /** A cut line of the column, not a rung. */
  cut?: boolean;
}

export type RungMode = 'satin' | 'fill' | 'guide';

export interface RungView {
  mode: RungMode;
  columns: RungColumn[];
  /** Lines drawn across a fill. */
  lines: [Pt, Pt][];
  /** Guide lines drawn on a fill (its rows follow them). */
  guides: Pt[][];
  /** The guide line being drawn. */
  sketch: Pt[] | null;
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
  /** Guide lines changed: the fill is sewn anew along them. */
  guides: (guides: Pt[][]) => void;
  redraw: () => void;
  /** Says why something did not work. */
  say: (key: 'stitch.direction.miss' | 'stitch.direction.cross' | 'stitch.direction.cornersNone' | 'stitch.sections.none') => void;
}

type Drag = { kind: 'end'; pick: RungPick } | { kind: 'draw'; cut: boolean } | { kind: 'sketch' } | null;

/**
 * Rungs on the canvas: lines across a satin column that set the direction of its stitches (dragged
 * across it to add one, its ends slid along the rails), or lines drawn across a fill to sew it as
 * satin along them, or guide lines drawn freehand on a fill for its rows to follow. Coordinates are
 * world millimetres.
 */
export class RungTool implements RungView {
  active = false;
  mode: RungMode = 'satin';
  columns: RungColumn[] = [];
  /** Which satin part each column belongs to, to give the columns back per part. */
  private parts: number[] = [];
  lines: [Pt, Pt][] = [];
  guides: Pt[][] = [];
  sketch: Pt[] | null = null;
  /** Pick radius of the last press, to thin the sketch. */
  private sketchStep = 0.2;
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

  /** Starts drawing guide lines on a fill with this outline, `guides` drawn already. */
  openGuides(loop: Pt[], guides: Pt[][]): void {
    this.active = true;
    this.mode = 'guide';
    this.columns = [];
    this.parts = [];
    this.lines = [];
    this.guides = guides.map((g) => g.slice());
    this.loop = loop;
    this.selected = null;
  }

  close(): void {
    this.active = false;
    this.columns = [];
    this.lines = [];
    this.guides = [];
    this.sketch = null;
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
        this.columns.push({
          left: r.left,
          right: r.right,
          cl: cumulative(r.left),
          cr: cumulative(r.right),
          rungs: r.rungs ?? seedRungs(r.left, r.right),
          cuts: (r.cuts ?? []).map((x) => [x[0], x[1]] as Rung),
          spacings: (r.spacings ?? []).map((x) => [x[0], x[1]] as [number, number]),
          own: !!r.rungs,
          rails: r,
        });
      }),
    );
    const s = this.selected;
    if (s && (s.col >= this.columns.length || s.i >= (s.cut ? this.columns[s.col].cuts : this.columns[s.col].rungs).length)) this.selected = null;
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
      const base: Rails = c.own ? { left: c.left, right: c.right, rungs: c.rungs.map((r) => [r[0], r[1]] as Rung) } : { left: c.rails.left, right: c.rails.right, ...(c.rails.rungs ? { rungs: c.rails.rungs } : {}) };
      if (c.cuts.length) base.cuts = c.cuts.map((r) => [r[0], r[1]] as Rung);
      if (c.spacings.length) base.spacings = c.spacings.map((r) => [r[0], r[1]] as [number, number]);
      (out[this.parts[k]] ??= []).push(base);
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
    const consider = (col: number, i: number, a: Pt, b: Pt, cut = false) => {
      const tag = cut ? { cut: true } : {};
      for (const [end, p] of [[0, a], [1, b]] as const) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d <= reachEnd && (!best || d < best.d)) best = { pick: { col, i, end, ...tag }, d };
      }
      if (best && best.pick.end !== -1) return;
      const d = segDist(q, a, b);
      if (d <= reachLine && (!best || d < best.d)) best = { pick: { col, i, end: -1, ...tag }, d };
    };
    if (this.mode === 'satin') {
      this.columns.forEach((c, k) => c.rungs.forEach((r, i) => consider(k, i, ...this.ends(c, r))));
      this.columns.forEach((c, k) => c.cuts.forEach((r, i) => consider(k, i, ...this.ends(c, r), true)));
    }
    else if (this.mode === 'fill') this.lines.forEach(([a, b], i) => consider(-1, i, a, b));
    else {
      this.guides.forEach((g, i) => {
        for (let k = 1; k < g.length; k++) {
          const d = segDist(q, g[k - 1], g[k]);
          if (d <= reachLine && (!best || d < best.d)) best = { pick: { col: -1, i, end: -1 }, d };
        }
      });
    }
    return (best as { pick: RungPick } | null)?.pick ?? null;
  }

  /** Whether a line may start here: on or near a column, or near the fill. */
  private near(x: number, y: number): boolean {
    const q: Pt = [x, y];
    if (this.mode !== 'satin') {
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

  /**
   * Pointer pressed: an end to drag, a rung to select, or a new line to draw (with `cut`, Shift held
   * on a satin: a cut line). Returns 'pan' when not taken.
   */
  down(x: number, y: number, scale: number, cut = false): 'move' | 'pan' {
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
    if (this.mode === 'guide') {
      this.drag = { kind: 'sketch' };
      this.sketch = [[x, y]];
      this.sketchStep = 3 / scale;
      return 'move';
    }
    this.drag = { kind: 'draw', cut: cut && this.mode === 'satin' };
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
    else if (d.kind === 'sketch' && this.sketch) {
      const l = this.sketch[this.sketch.length - 1];
      if (Math.hypot(x - l[0], y - l[1]) >= this.sketchStep) this.sketch.push([x, y]);
    } else if (d.kind === 'end') {
      const { col, i, end } = d.pick;
      if (this.mode === 'fill') this.lines[i][end as 0 | 1] = [x, y];
      else {
        const c = this.columns[col];
        const list = d.pick.cut ? c.cuts : c.rungs;
        const [lo, hi] = rungRange(list, i, end as 0 | 1, c.cl[c.cl.length - 1], c.cr[c.cr.length - 1]);
        const s = project(end === 0 ? c.left : c.right, end === 0 ? c.cl : c.cr, [x, y], lo, hi).s;
        const was = list[i][0];
        list[i] = end === 0 ? [s, list[i][1]] : [list[i][0], s];
        // A spacing set at the rung goes along with it.
        if (!d.pick.cut && end === 0) for (const sp of c.spacings) if (Math.abs(sp[0] - was) < 0.05) sp[0] = s;
        if (!d.pick.cut) c.own = true;
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
    } else if (d.kind === 'sketch' && this.sketch) {
      const line = simplify(this.sketch, this.sketchStep / 3);
      this.sketch = null;
      if (pathLength(line) < 1) return this.hooks.redraw();
      this.guides.push(line);
      this.selected = { col: -1, i: this.guides.length - 1, end: -1 };
      this.hooks.guides(this.guides.map((g) => g.slice()));
    } else if (d.kind === 'draw' && this.draft) {
      const [a, b] = this.draft;
      this.draft = null;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) return this.hooks.redraw();
      if (this.mode === 'fill') {
        this.lines.push([a, b]);
        this.selected = { col: -1, i: this.lines.length - 1, end: -1 };
        this.hooks.lines();
      } else this.addFromLine(a, b, d.cut);
    }
    this.hooks.redraw();
  }

  /** A rung from a line drawn across a column: in the first column whose two rails it meets. */
  private addFromLine(a: Pt, b: Pt, cut = false): void {
    let crossed = false;
    for (const [k, c] of this.columns.entries()) {
      const r = rungFromLine(c.left, c.right, a, b);
      if (!r) continue;
      const next = addRung(cut ? c.cuts : c.rungs, r, c.cl[c.cl.length - 1], c.cr[c.cr.length - 1]);
      if (!next) {
        crossed = true;
        continue;
      }
      if (cut) c.cuts = next;
      else {
        c.rungs = next;
        c.own = true;
      }
      this.selected = { col: k, i: next.findIndex((x) => x[0] === r[0] && x[1] === r[1]), end: -1, ...(cut ? { cut: true } : {}) };
      this.hooks.change(this.result(), true);
      return;
    }
    this.hooks.say(crossed ? 'stitch.direction.cross' : 'stitch.direction.miss');
  }

  /** Abandons a drag (a second finger started a pinch). */
  cancel(): void {
    this.drag = null;
    this.draft = null;
    this.sketch = null;
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
    } else if (this.mode === 'guide') {
      this.guides.splice(s.i, 1);
      this.hooks.guides(this.guides.map((g) => g.slice()));
    } else if (s.cut) {
      const c = this.columns[s.col];
      c.cuts = c.cuts.filter((_, i) => i !== s.i);
      this.hooks.change(this.result(), true);
    } else {
      const c = this.columns[s.col];
      const at = c.rungs[s.i][0];
      c.rungs = c.rungs.filter((_, i) => i !== s.i);
      c.spacings = c.spacings.filter(([x]) => Math.abs(x - at) >= 0.05);
      c.own = true;
      this.hooks.change(this.result(), true);
    }
    this.hooks.redraw();
    return true;
  }

  /** All guide lines removed. */
  clearGuides(): void {
    if (!this.guides.length) return;
    this.guides = [];
    this.selected = null;
    this.hooks.guides([]);
    this.hooks.redraw();
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

  /** Cut lines at the sharp corners of each column, those there kept; says so when there are none. */
  sections(): void {
    let changed = false;
    for (const c of this.columns) {
      const la = c.cl[c.cl.length - 1];
      const lb = c.cr[c.cr.length - 1];
      let cuts = c.cuts;
      for (const r of cornerCuts(c.left, c.right, c.own ? c.rungs : (c.rails.rungs ?? []))) {
        const next = addRung(cuts, r, la, lb);
        if (next) cuts = next;
      }
      if (cuts.length === c.cuts.length) continue;
      c.cuts = cuts;
      changed = true;
    }
    this.selected = null;
    if (changed) this.hooks.change(this.result(), true);
    else this.hooks.say('stitch.sections.none');
  }

  /** The spacing set at the selected rung (mm), or null when it keeps the column's. */
  get spacingHere(): number | null | undefined {
    const s = this.selected;
    if (!s || s.cut || s.col < 0 || this.mode !== 'satin') return undefined;
    const c = this.columns[s.col];
    const at = c.rungs[s.i]?.[0];
    if (at === undefined) return undefined;
    return c.spacings.find(([x]) => Math.abs(x - at) < 0.05)?.[1] ?? null;
  }

  /** Sets the spacing at the selected rung (null: as the column). */
  setSpacingHere(v: number | null): void {
    const s = this.selected;
    if (!s || s.cut || s.col < 0) return;
    const c = this.columns[s.col];
    const at = c.rungs[s.i]?.[0];
    if (at === undefined) return;
    c.spacings = c.spacings.filter(([x]) => Math.abs(x - at) >= 0.05);
    if (v !== null) c.spacings.push([at, v]);
    c.spacings.sort((a, b) => a[0] - b[0]);
    // The rung becomes the column's own: its place must stay where the spacing was set.
    c.own = true;
    this.hooks.change(this.result(), true);
  }

  /** No rungs: even from end to end. */
  even(): void {
    for (const c of this.columns) {
      c.rungs = [];
      c.spacings = [];
      c.own = true;
    }
    this.selected = null;
    this.hooks.change(this.result(), true);
  }

  /** Back to the direction of the stitches (no rungs set). */
  follow(): void {
    const out: Rails[][] = [];
    this.columns.forEach((c, k) => (out[this.parts[k]] ??= []).push({ left: c.left, right: c.right, ...(c.cuts.length ? { cuts: c.cuts } : {}) }));
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
