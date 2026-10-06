import { addRung, chordOf, cornerCuts, cornerRungs, cumulative, pointAt, project, rungFromLine, rungRange, seedRungs, type Rung } from '../digitize/rungs';
import { pathLength } from '../digitize/fill';
import { simplify } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import { reversedRails, sectionPlan, sectionsOf, spanSection, sectionLoops, sectionOfRung, type Rails, type SatinSettings, type SectionLoop, type SectionStep } from '../model/restitch';

/** Pick radius around the pointer for rung ends, CSS pixels; the line itself a little less. */
const PICK_END_PX = 10;
const PICK_LINE_PX = 6;

/**
 * Where a piece's controls sit, CSS pixels from where its satin starts along its direction (`dir`)
 * and across it: the number before the start, the arrow just inside, the scissors beside the number.
 */
export const BADGE = { number: -16, arrow: 9, scissors: 19, r: 8 };

/**
 * A piece sewn on its own as the tool shows it, with its place in the order and its controls: a
 * column of a chain (see Rails.chain) or a section of a column (see Rails.plan).
 */
export interface PieceBadge {
  /** The column (index in `columns`). */
  col: number;
  /** The section's step in the column's plan (a section, not a chained column). */
  step?: number;
  /** Place in the order the part's columns are sewn, from 1. */
  n: number;
  /** Where its satin starts, and the direction it goes from there (unit). */
  at: Pt;
  dir: Pt;
  /** Trimmed before it (null: the first of the part, nothing before). */
  trim: boolean | null;
}

export type BadgeHit = { col: number; step?: number; what: 'number' | 'arrow' | 'scissors' };

/**
 * A free rung is taken when the section's two new rails differ in length by at most this much (or
 * no more than its rails did before); beyond it the section would fan from one side, a cut line
 * is missing.
 */
const SPAN_RATIO = 2;

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
  /** Rungs drawn anywhere across a section, as world points (see Rails.spans). */
  spans: [Pt, Pt][];
  /** Order, directions and trims of its sections (see Rails.plan). */
  plan?: SectionStep[];
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
  /** A free rung of the column (see Rails.spans). */
  span?: boolean;
}

export type RungMode = 'satin' | 'fill' | 'guide' | 'points';

export interface RungView {
  mode: RungMode;
  columns: RungColumn[];
  /** Lines drawn across a fill. */
  lines: [Pt, Pt][];
  /** Cut lines drawn across a fill: its parts become columns of their own. */
  cutLines: [Pt, Pt][];
  /** The part of the fill that made no column, shown until the lines change. */
  bad: Pt[] | null;
  /** Guide lines drawn on a fill (its rows follow them). */
  guides: Pt[][];
  /** The guide line being drawn. */
  sketch: Pt[] | null;
  /** Points set on a fill: the middle of its rays or circles, the eyes of its swirls. */
  points: Pt[];
  selected: RungPick | null;
  hover: RungPick | null;
  /** The line being drawn. */
  draft: [Pt, Pt] | null;
  /** The line being drawn is a cut line. */
  draftCut: boolean;
  /** Order, direction and trims of the chained columns. */
  badges: PieceBadge[];
  /** The control under the pointer. */
  badgeHover: BadgeHit | null;
}

export interface RungHooks {
  /** New rungs: shown at once (`final` false, while dragging) or taken over as one undo step. */
  change: (columns: Rails[][], final: boolean) => void;
  /** Lines across the fill changed (count shown in the panel). */
  lines: () => void;
  /** Guide lines changed: the fill is sewn anew along them. */
  guides: (guides: Pt[][]) => void;
  /** Points moved, added or removed: the fill is sewn anew around them. */
  points?: (points: Pt[]) => void;
  redraw: () => void;
  /** Says why something did not work. */
  say: (key: 'stitch.direction.miss' | 'stitch.direction.cross' | 'stitch.direction.needCut' | 'stitch.direction.cornersNone' | 'stitch.sections.none') => void;
}

type Drag = { kind: 'end'; pick: RungPick; loop?: SectionLoop } | { kind: 'draw'; cut: boolean } | { kind: 'sketch' } | { kind: 'point'; i: number; moved: boolean } | null;

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
  cutLines: [Pt, Pt][] = [];
  bad: Pt[] | null = null;
  guides: Pt[][] = [];
  sketch: Pt[] | null = null;
  points: Pt[] = [];
  /** How many points the fill takes (one for rays and circles, up to three swirls). */
  private pointMax = 1;
  /** Pick radius of the last press, to thin the sketch. */
  private sketchStep = 0.2;
  /** Outline of the fill the lines are drawn on (to start a line only near it). */
  private loop: Pt[] = [];
  selected: RungPick | null = null;
  hover: RungPick | null = null;
  draft: [Pt, Pt] | null = null;
  draftCut = false;
  badgeHover: BadgeHit | null = null;
  /** The satin settings of the object (how its sections are sewn when no order is set). */
  satin: SatinSettings | null = null;
  /** Lines drawn across a satin or a fill are cut lines (Shift draws the other kind). */
  cutMode = false;
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
    this.cutLines = [];
    this.bad = null;
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

  /**
   * Starts setting points on a fill with this outline: `points` set already, at most `max`. With
   * one point a click moves it; with more a click adds one until there are `max`.
   */
  openPoints(loop: Pt[], points: Pt[], max: number): void {
    this.active = true;
    this.mode = 'points';
    this.columns = [];
    this.parts = [];
    this.lines = [];
    this.points = points.map((p) => [p[0], p[1]] as Pt);
    this.pointMax = max;
    this.loop = loop;
    this.selected = null;
  }

  close(): void {
    this.active = false;
    this.points = [];
    this.columns = [];
    this.lines = [];
    this.cutLines = [];
    this.bad = null;
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
          spans: (r.spans ?? []).map(([a, b]) => [a, b] as [Pt, Pt]),
          ...(r.plan ? { plan: r.plan.map((x) => ({ ...x })) } : {}),
          own: !!r.rungs,
          rails: r,
        });
      }),
    );
    const s = this.selected;
    if (s && s.col >= 0 && (s.col >= this.columns.length || s.i >= this.listOf(this.columns[s.col], s).length)) this.selected = null;
  }

  /** The list a pick is in: the column's cut lines, free rungs or rungs. */
  private listOf(c: RungColumn, s: RungPick): unknown[] {
    return s.cut ? c.cuts : s.span ? c.spans : c.rungs;
  }

  /** The list of lines across a fill a pick is in. */
  private fillList(s: RungPick): [Pt, Pt][] {
    return s.cut ? this.cutLines : this.lines;
  }

  /** Shows the part of the fill that made no column. */
  showBad(ring: Pt[]): void {
    this.bad = ring;
    this.hooks.redraw();
  }

  /** The lines across the fill changed. */
  private linesChanged(): void {
    this.bad = null;
    this.hooks.lines();
  }

  /** How many rungs set the direction (null: the stitches' own, nothing set). */
  get count(): number | null {
    if (!this.columns.some((c) => c.own)) return null;
    return this.columns.reduce((a, c) => a + c.rungs.length + c.spans.length, 0);
  }

  /**
   * The chained columns of each satin part with their place in the order (the satin of a chained
   * column goes from its end back to its start, see chainRun) and whether a trim comes before.
   */
  get badges(): PieceBadge[] {
    if (this.mode !== 'satin') return [];
    const out: PieceBadge[] = [];
    const byPart = new Map<number, number[]>();
    this.parts.forEach((p, k) => this.columns[k].rails.chain !== undefined && byPart.set(p, [...(byPart.get(p) ?? []), k]));
    for (const ks of byPart.values()) {
      if (ks.length < 2) continue;
      ks.forEach((k, i) => {
        const c = this.columns[k];
        const la = c.cl[c.cl.length - 1];
        const lb = c.cr[c.cr.length - 1];
        const at = mid(c.left[c.left.length - 1], c.right[c.right.length - 1]);
        const inward = mid(pointAt(c.left, c.cl, Math.max(0, la - 1)), pointAt(c.right, c.cr, Math.max(0, lb - 1)));
        const d = sub(inward, at);
        const l = Math.hypot(d[0], d[1]) || 1;
        out.push({ col: k, n: i + 1, at, dir: [d[0] / l, d[1] / l], trim: i ? this.columns[ks[i - 1]].rails.chain !== c.rails.chain : null });
      });
    }
    // Sections of a column: where the satin of each starts, in the order they are sewn.
    if (this.satin) {
      const res = this.result().flat();
      this.columns.forEach((c, k) => {
        if (c.rails.chain !== undefined || !c.cuts.length) return;
        const secs = sectionsOf(res[k]);
        if (secs.length < 2) return;
        sectionPlan(res[k], this.satin!).forEach((x, i, plan) => {
          const r = secs[x.sec];
          if (!r) return;
          const [a, b] = x.flip ? [r.left.slice().reverse(), r.right.slice().reverse()] : [r.left, r.right];
          const at = mid(a[0], b[0]);
          const ca = cumulative(a);
          const cb = cumulative(b);
          const inward = mid(pointAt(a, ca, Math.min(1, ca[ca.length - 1])), pointAt(b, cb, Math.min(1, cb[cb.length - 1])));
          const d = sub(inward, at);
          const l = Math.hypot(d[0], d[1]) || 1;
          out.push({ col: k, step: i, n: i + 1, at, dir: [d[0] / l, d[1] / l], trim: i ? plan[i].trim : null });
        });
      });
    }
    return out;
  }

  /** The control of a chained column under the pointer, or null. */
  badgeAt(x: number, y: number, scale: number): BadgeHit | null {
    const r = (BADGE.r + 2) / scale;
    for (const b of this.badges) {
      const [nx, ny] = [-b.dir[1], b.dir[0]];
      const spot = (along: number, across: number): Pt => [b.at[0] + (b.dir[0] * along + nx * across) / scale, b.at[1] + (b.dir[1] * along + ny * across) / scale];
      const near = (p: Pt) => Math.hypot(p[0] - x, p[1] - y) <= r;
      const at = b.step === undefined ? { col: b.col } : { col: b.col, step: b.step };
      if (near(spot(BADGE.number, 0))) return { ...at, what: 'number' };
      if (near(spot(BADGE.arrow, 0))) return { ...at, what: 'arrow' };
      if (b.trim !== null && near(spot(BADGE.number, BADGE.scissors))) return { ...at, what: 'scissors' };
    }
    return null;
  }

  /** A control clicked: the column turned round, sewn one place earlier, or a trim before it set or taken away. */
  private useBadge(h: BadgeHit): void {
    if (h.step !== undefined) return this.useSectionBadge(h, h.step);
    const out = this.result();
    const part = this.parts[h.col];
    const cols = out[part];
    const k = this.parts.slice(0, h.col).filter((p) => p === part).length;
    // Trims stay between the same places in the order: the chain numbers belong to the places.
    const ids = cols.map((c) => c.chain);
    if (h.what === 'arrow') cols[k] = reversedRails(cols[k]);
    else if (h.what === 'number') {
      if (k === 0) return;
      [cols[k - 1], cols[k]] = [cols[k], cols[k - 1]];
    } else if (k > 0) {
      const old = ids[k];
      const to = ids[k - 1] === old ? Math.max(...ids.map((x) => x ?? 0)) + 1 : ids[k - 1];
      for (let i = k; i < ids.length && ids[i] === old; i++) ids[i] = to;
    }
    cols.forEach((c, i) => (c.chain = ids[i]));
    this.selected = null;
    this.setColumns(out);
    this.hooks.change(out, true);
  }

  /** A section's control clicked: its step turned round, one place earlier, or trimmed before. */
  private useSectionBadge(h: BadgeHit, i: number): void {
    const c = this.columns[h.col];
    const r = this.result().flat()[h.col];
    if (!this.satin || !r) return;
    const plan = sectionPlan(r, this.satin);
    if (h.what === 'arrow') plan[i].flip = !plan[i].flip;
    else if (h.what === 'number') {
      if (i === 0) return;
      // The trims stay between the same places in the order.
      const [a, b] = [plan[i - 1], plan[i]];
      plan[i - 1] = { ...b, trim: a.trim };
      plan[i] = { ...a, trim: b.trim };
    } else if (i > 0) plan[i].trim = !plan[i].trim;
    c.plan = plan;
    this.selected = null;
    this.hooks.change(this.result(), true);
  }

  /** Lines drawn across a satin from now on are cut lines (true) or rungs. */
  setCutMode(on: boolean): void {
    this.cutMode = on;
    this.hooks.redraw();
  }

  /** The sections of a column as closed outlines, with its cut lines as they are now. */
  private loops(c: RungColumn): SectionLoop[] {
    return sectionLoops({ left: c.left, right: c.right, cuts: c.cuts });
  }

  /** The columns per satin part, with the rungs as set now. */
  private result(): Rails[][] {
    const out: Rails[][] = [];
    this.columns.forEach((c, k) => {
      const base: Rails = c.own ? { left: c.left, right: c.right, rungs: c.rungs.map((r) => [r[0], r[1]] as Rung) } : { left: c.rails.left, right: c.rails.right, ...(c.rails.rungs ? { rungs: c.rails.rungs } : {}) };
      if (c.cuts.length) base.cuts = c.cuts.map((r) => [r[0], r[1]] as Rung);
      if (c.spacings.length) base.spacings = c.spacings.map((r) => [r[0], r[1]] as [number, number]);
      if (c.spans.length) base.spans = c.spans.map(([a, b]) => [a, b] as [Pt, Pt]);
      if (c.rails.chain !== undefined) base.chain = c.rails.chain;
      // A plan for as many sections as there are now; with a cut line more or less it is made anew.
      if (c.plan && c.plan.length === c.cuts.length + 1) base.plan = c.plan.map((x) => ({ ...x }));
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
    const consider = (col: number, i: number, a: Pt, b: Pt, cut = false, free = false) => {
      const tag = cut ? { cut: true } : free ? { span: true } : {};
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
      this.columns.forEach((c, k) => c.spans.forEach(([a, b], i) => consider(k, i, a, b, false, true)));
      this.columns.forEach((c, k) => c.cuts.forEach((r, i) => consider(k, i, ...this.ends(c, r), true)));
    }
    else if (this.mode === 'fill') {
      this.lines.forEach(([a, b], i) => consider(-1, i, a, b));
      this.cutLines.forEach(([a, b], i) => consider(-1, i, a, b, true));
    }
    else if (this.mode === 'points') {
      this.points.forEach((p, i) => {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d <= reachEnd * 1.4 && (!best || d < best.d)) best = { pick: { col: -1, i, end: 0 }, d };
      });
    }
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

  /** Whether a point lies inside the fill's outline (even-odd); anywhere when there is none. */
  private inside(x: number, y: number): boolean {
    const l = this.loop;
    if (!l.length) return true;
    let inn = false;
    for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
      const [ax, ay] = l[i];
      const [bx, by] = l[j];
      if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inn = !inn;
    }
    return inn;
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
   * Pointer pressed: an end to drag, a rung to select, or a new line to draw (on a satin a cut line
   * when cutMode is on; `other`, Shift held, draws the other kind). Returns 'pan' when not taken.
   */
  down(x: number, y: number, scale: number, other = false): 'move' | 'pan' {
    if (!this.active) return 'pan';
    const cut = other !== this.cutMode;
    const badge = this.badgeAt(x, y, scale);
    if (badge) {
      this.useBadge(badge);
      this.hooks.redraw();
      return 'move';
    }
    const hit = this.pick(x, y, scale);
    if (this.mode === 'points') {
      if (hit) {
        this.selected = hit;
        this.drag = { kind: 'point', i: hit.i, moved: false };
        this.hooks.redraw();
        return 'move';
      }
      if (!this.inside(x, y)) {
        this.selected = null;
        this.hooks.redraw();
        return 'pan';
      }
      // A click on the fill: a new point while there is room, else the only one moves there.
      if (this.points.length < this.pointMax) this.points.push([x, y]);
      else if (this.pointMax === 1) this.points[0] = [x, y];
      else return 'pan';
      const i = this.pointMax === 1 ? 0 : this.points.length - 1;
      this.selected = { col: -1, i, end: 0 };
      this.drag = { kind: 'point', i, moved: true };
      this.hooks.redraw();
      return 'move';
    }
    if (hit) {
      this.selected = hit;
      let loop: SectionLoop | undefined;
      if (hit.span && hit.end !== -1) {
        const c = this.columns[hit.col];
        const loops = this.loops(c);
        loop = loops[sectionOfRung(loops, c.spans[hit.i])];
      }
      this.drag = hit.end === -1 || (hit.span && !loop) ? null : { kind: 'end', pick: hit, ...(loop ? { loop } : {}) };
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
    this.drag = { kind: 'draw', cut };
    this.draftCut = this.drag.cut;
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
    if (d.kind === 'point') {
      if (this.inside(x, y)) this.points[d.i] = [x, y];
      d.moved = true;
    } else if (d.kind === 'draw' && this.draft) this.draft[1] = [x, y];
    else if (d.kind === 'sketch' && this.sketch) {
      const l = this.sketch[this.sketch.length - 1];
      if (Math.hypot(x - l[0], y - l[1]) >= this.sketchStep) this.sketch.push([x, y]);
    } else if (d.kind === 'end') {
      const { col, i, end } = d.pick;
      if (this.mode === 'fill') this.fillList(d.pick)[i][end as 0 | 1] = [x, y];
      else if (d.pick.span && d.loop) {
        // Slid along the section's outline, wherever it goes.
        const c = this.columns[col];
        const { ring, cum } = d.loop;
        const q = pointAt(ring, cum, project(ring, cum, [x, y]).s);
        c.spans[i] = end === 0 ? [q, c.spans[i][1]] : [c.spans[i][0], q];
        this.hooks.change(this.result(), false);
      } else {
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
    if (d.kind === 'point') {
      if (d.moved) this.hooks.points?.(this.points.map((p) => [p[0], p[1]] as Pt));
    } else if (d.kind === 'end') {
      if (this.mode === 'satin') this.hooks.change(this.result(), true);
      else this.linesChanged();
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
      this.draftCut = false;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) return this.hooks.redraw();
      if (this.mode === 'fill') {
        const list = d.cut ? this.cutLines : this.lines;
        list.push([a, b]);
        this.selected = { col: -1, i: list.length - 1, end: -1, ...(d.cut ? { cut: true } : {}) };
        this.linesChanged();
      } else this.addFromLine(a, b, d.cut);
    }
    this.hooks.redraw();
  }

  /**
   * A rung from a line drawn across a column, in the section its middle lies in: from rail to rail
   * a plain rung; ending on a cut line or both ends on one rail a free rung, the section then sewn
   * as a column of its own (see Rails.spans). A cut line goes from rail to rail.
   */
  private addFromLine(a: Pt, b: Pt, cut = false): void {
    if (!cut) {
      for (const [k, c] of this.columns.entries()) {
        const loops = this.loops(c);
        for (const [sec, loop] of loops.entries()) {
          const chord = chordOf(loop.ring, a, b);
          if (!chord) continue;
          const left = (u: number) => u <= loop.end[0] + 1e-6;
          const right = (u: number) => u >= loop.end[1] - 1e-6 && u <= loop.start[0] + 1e-6;
          const [u, v] = chord;
          const hasSpans = c.spans.some((f) => sectionOfRung(loops, f) === sec);
          if (!hasSpans && ((left(u) && right(v)) || (left(v) && right(u)))) {
            const [ul, ur] = left(u) ? [u, v] : [v, u];
            const r: Rung = [loop.from[0] + ul, loop.to[1] - (ur - loop.end[1])];
            const next = addRung(c.rungs, r, c.cl[c.cl.length - 1], c.cr[c.cr.length - 1]);
            if (!next) return this.hooks.say('stitch.direction.cross');
            c.rungs = next;
            c.own = true;
            this.selected = { col: k, i: next.findIndex((x) => x[0] === r[0] && x[1] === r[1]), end: -1 };
            this.hooks.change(this.result(), true);
            return;
          }
          return this.addSpan(k, loops, sec, [pointAt(loop.ring, loop.cum, u), pointAt(loop.ring, loop.cum, v)]);
        }
      }
    }
    let crossed = false;
    for (const [k, c] of this.columns.entries()) {
      const r = rungFromLine(c.left, c.right, a, b);
      if (!r) continue;
      const next = addRung(cut ? c.cuts : c.rungs, r, c.cl[c.cl.length - 1], c.cr[c.cr.length - 1]);
      if (!next) {
        crossed = true;
        continue;
      }
      if (cut) {
        c.cuts = next;
        // The free rungs stay where they are drawn; a section without any is plain again.
      } else {
        c.rungs = next;
        c.own = true;
      }
      this.selected = { col: k, i: next.findIndex((x) => x[0] === r[0] && x[1] === r[1]), end: -1, ...(cut ? { cut: true } : {}) };
      this.hooks.change(this.result(), true);
      return;
    }
    this.hooks.say(crossed ? 'stitch.direction.cross' : 'stitch.direction.miss');
  }

  /**
   * A free rung across section `sec` of column k: the section's rungs become free ones (those that
   * still fit with it), so the section finds its own rails. Says so when it does not fit.
   */
  private addSpan(k: number, loops: SectionLoop[], sec: number, f: [Pt, Pt]): void {
    const c = this.columns[k];
    const loop = loops[sec];
    const mine = c.spans.filter((x) => sectionOfRung(loops, x) === sec);
    const l = loop.end[0];
    const r = loop.start[0] - loop.end[1];
    const most = Math.max(SPAN_RATIO, Math.max(l, r) / Math.max(1e-6, Math.min(l, r)));
    const fits = (set: [Pt, Pt][]) => {
      const own = spanSection(loop, [], set);
      return !!own && own.ratio <= most;
    };
    const tried = spanSection(loop, [], [...mine, f]);
    if (!tried || tried.ratio > most) return this.hooks.say(tried || !mine.length ? 'stitch.direction.needCut' : 'stitch.direction.cross');
    // The plain rungs in the section, as free rungs where they still fit.
    const inside = (r: Rung) => r[0] > loop.from[0] && r[0] < loop.to[0] && r[1] > loop.from[1] && r[1] < loop.to[1];
    const kept = [...mine, f];
    const plain = c.rungs.filter(inside);
    for (const r of plain) {
      const g = this.ends(c, r);
      if (fits([...kept, g])) kept.push(g);
    }
    c.rungs = c.rungs.filter((r) => !inside(r));
    c.spacings = c.spacings.filter(([s]) => s <= loop.from[0] || s >= loop.to[0]);
    c.spans = [...c.spans.filter((x) => !mine.includes(x)), ...kept];
    c.own = true;
    this.selected = { col: k, i: c.spans.indexOf(f), end: -1, span: true };
    this.hooks.change(this.result(), true);
  }

  /** Abandons a drag (a second finger started a pinch). */
  cancel(): void {
    this.drag = null;
    this.draft = null;
    this.draftCut = false;
    this.sketch = null;
  }

  hoverAt(x: number, y: number, scale: number): boolean {
    const b = this.active ? this.badgeAt(x, y, scale) : null;
    const h = this.active && !b ? this.pick(x, y, scale) : null;
    const changed = JSON.stringify(b) !== JSON.stringify(this.badgeHover) || JSON.stringify(h) !== JSON.stringify(this.hover);
    this.badgeHover = b;
    this.hover = h;
    return changed;
  }

  /** Removes the selected rung or line; false when nothing is selected. */
  deleteSelected(): boolean {
    const s = this.selected;
    if (!s) return false;
    this.selected = null;
    if (this.mode === 'fill') {
      this.fillList(s).splice(s.i, 1);
      this.linesChanged();
    } else if (this.mode === 'points') {
      // The last point stays: rays and swirls need one.
      if (this.points.length < 2) return false;
      this.points.splice(s.i, 1);
      this.hooks.points?.(this.points.map((p) => [p[0], p[1]] as Pt));
    } else if (this.mode === 'guide') {
      this.guides.splice(s.i, 1);
      this.hooks.guides(this.guides.map((g) => g.slice()));
    } else if (s.cut) {
      const c = this.columns[s.col];
      c.cuts = c.cuts.filter((_, i) => i !== s.i);
      this.hooks.change(this.result(), true);
    } else if (s.span) {
      const c = this.columns[s.col];
      c.spans = c.spans.filter((_, i) => i !== s.i);
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
    if (!s || s.cut || s.span || s.col < 0 || this.mode !== 'satin') return undefined;
    const c = this.columns[s.col];
    const at = c.rungs[s.i]?.[0];
    if (at === undefined) return undefined;
    return c.spacings.find(([x]) => Math.abs(x - at) < 0.05)?.[1] ?? null;
  }

  /** Sets the spacing at the selected rung (null: as the column). */
  setSpacingHere(v: number | null): void {
    const s = this.selected;
    if (!s || s.cut || s.span || s.col < 0) return;
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
      c.spans = [];
      c.own = true;
    }
    this.selected = null;
    this.hooks.change(this.result(), true);
  }

  /** Back to the direction of the stitches (no rungs set). */
  follow(): void {
    const out: Rails[][] = [];
    this.columns.forEach((c, k) => (out[this.parts[k]] ??= []).push({ left: c.left, right: c.right, ...(c.cuts.length ? { cuts: c.cuts } : {}), ...(c.rails.chain !== undefined ? { chain: c.rails.chain } : {}) }));
    this.selected = null;
    this.hooks.change(out, true);
  }
}

const sub = (a: Pt, b: Pt): [number, number] => [a[0] - b[0], a[1] - b[1]];
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function segDist(q: Pt, a: Pt, b: Pt): number {
  const v = sub(b, a);
  const l2 = v[0] * v[0] + v[1] * v[1];
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * v[0] + (q[1] - a[1]) * v[1]) / l2)) : 0;
  return Math.hypot(q[0] - a[0] - v[0] * t, q[1] - a[1] - v[1] * t);
}
