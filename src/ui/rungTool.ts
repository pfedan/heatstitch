import { addRung, checkSections, chordOf, cutAcross, cutLine, cutPieces, midOf, railsFromOutline, stripsOfAreas, cornerCuts, cornerRungs, cumulative, inside, pointAt, project, rungFromLine, rungRange, seedRungs, type Cut, type Rung } from '../digitize/rungs';
import { pathLength } from '../digitize/fill';
import { simplify } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import { bestChain, previewPairs, reversedRails, spanSection, sectionLoops, sectionOfRung, sectionsOf, type Rails, type SatinSettings, type SectionLoop, type SectionStep, type Split } from '../model/restitch';
import { cutStep, mirrorStep, moveStep, partSteps, turnStep, SHOWS_MM, type PartStep } from '../model/satinOrder';

/** Pick radius around the pointer for rung ends, CSS pixels; the line itself a little less. */
const PICK_END_PX = 10;
const PICK_LINE_PX = 6;

/**
 * Where a piece's controls sit, CSS pixels: the arrow just inside where its satin starts (along its
 * direction), the mirror just before it; its number in the middle of the piece and the scissors in
 * the middle of the join before it, each moved aside where it would cover another (see layout).
 */
export const BADGE = { arrow: 9, mirror: -13, r: 8 };

/** A piece of a satin part as the tool shows it (see partSteps): a column, or a section of a column. */
export interface PieceBadge {
  /** The satin part, and the piece's step in the order it is sewn. */
  part: number;
  i: number;
  /** The column (index in `columns`) and, for a section, its step in the column's plan. */
  col: number;
  step?: number;
  /** Place in the order the part is sewn in, from 1. */
  n: number;
  /** Where its satin starts, and the direction it goes from there (unit). */
  at: Pt;
  dir: Pt;
  /** The middle of the piece from end to end, where its number goes. */
  middle: Pt[];
  /** Its satin starts on the other rail (see Rails.mirror). */
  mirror: boolean;
  /** The only piece of its part: no place in an order to change. */
  lone?: boolean;
}

/** The join from one piece of a satin part to the next (see PartStep). */
export interface PieceLink {
  part: number;
  /** The step it leads to. */
  i: number;
  join: 'way' | 'jump' | 'trim';
  /** The way the thread goes. */
  way: Pt[];
  /** It stays in sight (more than SHOWS_MM). */
  shows: boolean;
  /** A click on its scissors cuts it or sews it through. */
  cuttable: boolean;
}

/** Where the number of each piece and the scissors of each join sit at a scale (world points, see layout). */
export interface BadgeLayout {
  numbers: (Pt | null)[];
  scissors: Pt[];
}

export type BadgeHit = { part: number; i: number; what: 'number' | 'arrow' | 'mirror' | 'link' };

/** A number dragged onto another: where the pointer is and the number under it. */
export interface OrderDrag {
  part: number;
  i: number;
  at: Pt;
  over: number | null;
}

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
  /** A point of a bent cut line between its ends (index among its points). */
  node?: number;
}

export type RungMode = 'satin' | 'fill' | 'guide' | 'points';

/** What Vorschlagen sets on one satin part: cut lines and lines across its area, or rungs along its columns. */
export type SuggestPlan = { part: number; lines: [Pt, Pt][]; cuts: Cut[]; edge?: { outlines: Pt[][]; holes: Pt[][] } } | { part: number; rails: true };

/** A part that makes no column yet, or a hole no cut line opens: outlined, with what is missing. */
export interface SectionProblem {
  ring: Pt[];
  key: 'stitch.problem.part' | 'stitch.problem.hole';
}

export interface RungView {
  mode: RungMode;
  columns: RungColumn[];
  /**
   * The satin's edges as drawn: the outline and holes of the part shown in sections of its area
   * (its cut lines are drawn as such), the rails of any other column.
   */
  readonly edges: Pt[][];
  /** Lines drawn across a fill. */
  lines: [Pt, Pt][];
  /** Cut lines drawn across a fill: its parts become columns of their own. Two points, or more where one is bent. */
  cutLines: Cut[];
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
  /** The pieces of each part in the order they are sewn, with their direction and side. */
  readonly badges: PieceBadge[];
  /** The joins between them. */
  readonly links: PieceLink[];
  /** Where their numbers and scissors sit at this scale. */
  layout(scale: number): BadgeLayout;
  /** The control under the pointer. */
  badgeHover: BadgeHit | null;
  /** The join under the pointer (its way, or its scissors). */
  linkHover: { part: number; i: number } | null;
  /** Whether the scissors of a join show and take a click (see RungTool.scissorsOn). */
  scissorsOn(l: PieceLink): boolean;
  /** A number being dragged to another place in the order. */
  readonly orderDrag: OrderDrag | null;
  /** Every part or hole that does not work yet, all at once, for as long as it stays so. */
  readonly problems: SectionProblem[];
  /** The problem under the pointer (index in `problems`, -1 none) and where the pointer is. */
  problemHover: number;
  /** Each section as it will be sewn (its stitch pairs); none for a part with a problem. */
  readonly previews: [Pt, Pt][][];
  /** The section under the pointer (or under the control pointed at), lit while it is: green when it can be sewn, red when not. */
  readonly glow: SectionGlow | null;
}

/** A section lit while it is pointed at (see RungView.glow). */
export interface SectionGlow {
  ring: Pt[];
  /** Its stitch pairs as it will be sewn; none for a part that cannot be sewn. */
  pairs: [Pt, Pt][];
  ok: boolean;
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
  /** Jumps longer than this are trimmed (mm, see sewDesign); 3 when not given. */
  trimMm?: () => number;
  /** Says why something did not work. */
  say: (key: 'stitch.direction.miss' | 'stitch.direction.cross' | 'stitch.direction.needCut' | 'stitch.direction.cornersNone' | 'stitch.sections.none' | 'stitch.order.best.none' | 'stitch.draw.openHole' | 'stitch.draw.notStripPart') => void;
}

type Drag = { kind: 'order'; part: number; i: number; from: Pt; at: Pt; scale: number; moved: boolean; over: number | null } | { kind: 'end'; pick: RungPick; loop?: SectionLoop; moved?: boolean } | { kind: 'bend'; pick: RungPick; from: Pt; still: number; node?: number } | { kind: 'draw'; cut: boolean } | { kind: 'sketch' } | { kind: 'point'; i: number; moved: boolean } | null;

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
  /**
   * The area of each satin part (by part; see Rails.split): its cut lines are among `cutLines`,
   * moved, drawn and removed like on a fill, the part then cut anew.
   */
  private splits = new Map<number, Omit<Split, 'cuts'>>();
  /**
   * After Leeren: the columns each part is sewn with, while the tool shows only its area. Lines
   * drawn on it then are among `lines` and `cutLines`, as on a fill; once they make columns the
   * part is sewn anew along them (see resplit).
   */
  private cleared = new Map<number, Rails[]>();
  /** The part each cut line or line across a satin belongs to (lines drawn later: where they lie, see partAt). */
  private owner = new WeakMap<Pt[], number>();
  lines: [Pt, Pt][] = [];
  cutLines: Cut[] = [];
  /** Cut lines drawn, moved or bent by hand since the tool opened (as they were then): Vorschlagen keeps them. */
  private ownCuts: Cut[] = [];
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
  linkHover: { part: number; i: number } | null = null;
  problemHover = -1;
  glow: SectionGlow | null = null;
  /** The fill's outsides and holes (lines drawn on a fill), to check the parts its lines make. */
  private shape: { outlines: Pt[][]; holes: Pt[][] } | null = null;
  private checked: { key: string; problems: SectionProblem[]; previews: [Pt, Pt][][]; sections: SectionGlow[] } | null = null;
  /** The satin settings of the object (how its sections are sewn when no order is set). */
  satin: SatinSettings | null = null;
  /** Lines drawn across a satin or a fill are cut lines (Shift draws the other kind). */
  cutMode = false;
  private drag: Drag = null;

  private hooks: RungHooks;

  constructor(hooks: RungHooks) {
    // What is given back keeps no area read from the rails only to show them (see Split.read).
    this.hooks = { ...hooks, change: (columns, final) => hooks.change(columns.map((part) => part?.map(givenBack)), final) };
  }

  /** Starts on the satin columns of an object (rails per satin part). */
  openSatin(columns: Rails[][]): void {
    this.active = true;
    this.mode = 'satin';
    this.lines = [];
    this.ownCuts = [];
    this.selected = null;
    this.setColumns(columns);
  }

  /** Starts drawing lines across a fill with this outline (`shape`: its areas and holes, to check the parts). */
  openFill(loop: Pt[], shape: { outlines: Pt[][]; holes: Pt[][] } | null = null): void {
    this.active = true;
    this.mode = 'fill';
    this.shape = shape;
    this.columns = [];
    this.parts = [];
    this.lines = [];
    this.cutLines = [];
    this.ownCuts = [];
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
    this.shape = null;
    this.checked = null;
    this.problemHover = -1;
    this.glow = null;
    this.points = [];
    this.columns = [];
    this.cleared = new Map();
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
    this.splits = new Map();
    this.cutLines = [];
    this.cleared = new Map();
    if (this.mode === 'satin') this.lines = [];
    columns.forEach((part, k) => {
      const from = part.find((r) => r.split)?.split;
      if (!from) return;
      this.splits.set(k, { outlines: from.outlines, holes: from.holes });
      for (const c of from.cuts) this.cutLines.push(this.owned(copyCut(c), k));
    });
    this.bad = null;
    const s = this.selected;
    if (s && s.col >= 0 && (s.col >= this.columns.length || s.i >= this.listOf(this.columns[s.col], s).length)) this.selected = null;
  }

  /** The list a pick is in: the column's cut lines, free rungs or rungs. */
  private listOf(c: RungColumn, s: RungPick): unknown[] {
    return s.cut ? c.cuts : s.span ? c.spans : c.rungs;
  }

  /** The list of lines across a fill a pick is in. */
  private fillList(s: RungPick): Pt[][] {
    return s.cut ? this.cutLines : this.lines;
  }

  /** Shows the part of the fill that made no column. */
  showBad(ring: Pt[]): void {
    this.bad = ring;
    this.hooks.redraw();
  }

  /** Lines across and cut lines put in place of those drawn (see suggestSatin); `bad` the part that makes no column. */
  setFillLines(lines: [Pt, Pt][], cuts: Cut[], bad: Pt[] | null = null): void {
    this.lines = lines.map(([a, b]) => [a, b] as [Pt, Pt]);
    this.cutLines = cuts.map(copyCut);
    this.selected = null;
    this.linesChanged();
    this.bad = bad;
    this.hooks.redraw();
  }

  /** The lines across the fill changed. */
  private linesChanged(): void {
    this.bad = null;
    this.hooks.lines();
  }

  /** How many rungs set the direction (null: the stitches' own, nothing set). */
  get count(): number | null {
    if (!this.columns.some((c) => c.own) && !this.cleared.size) return null;
    return this.columns.reduce((a, c) => a + c.rungs.length + c.spans.length, this.lines.length);
  }

  private stepsMemo: { key: string; steps: PartStep[][] } | null = null;

  /**
   * The steps each satin part is sewn in (see partSteps), worked out again only when something
   * changed; while a line is dragged the last ones stay (sewing every part each frame is slow).
   */
  private steps(): PartStep[][] {
    if (this.mode !== 'satin' || !this.satin) return [];
    const dragging = this.drag?.kind === 'end' || this.drag?.kind === 'bend';
    if (dragging && this.stepsMemo) return this.stepsMemo.steps;
    const res = this.result();
    const trimMm = this.hooks.trimMm?.() ?? 3;
    const key = JSON.stringify([res, this.satin, trimMm]);
    if (this.stepsMemo?.key !== key) {
      const satin = this.satin;
      this.stepsMemo = { key, steps: res.map((part) => (part ? partSteps(part, satin, trimMm) : [])) };
      this.layoutMemo = null;
    }
    return this.stepsMemo.steps;
  }

  /** The columns (index in `columns`) of each part, in its order. */
  private colsOfParts(): number[][] {
    const out: number[][] = [];
    this.parts.forEach((p, k) => (out[p] ??= []).push(k));
    return out;
  }

  /**
   * Every piece of each satin part in the order it is sewn: a column, or a section of a column sewn
   * in sections, whatever the part came from (a fill cut into strips, a file, cut lines of its own).
   */
  get badges(): PieceBadge[] {
    const out: PieceBadge[] = [];
    const cols = this.colsOfParts();
    this.steps().forEach((steps, p) =>
      steps.forEach((x, i) => {
        const [a, b] = x.along;
        const ca = cumulative(a);
        const cb = cumulative(b);
        const [la, lb] = [ca[ca.length - 1], cb[cb.length - 1]];
        const at = mid(a[0], b[0]);
        const d = sub(mid(pointAt(a, ca, Math.min(1, la)), pointAt(b, cb, Math.min(1, lb))), at);
        const l = Math.hypot(d[0], d[1]) || 1;
        const middle = Array.from({ length: 11 }, (_, j) => mid(pointAt(a, ca, (la * j) / 10), pointAt(b, cb, (lb * j) / 10)));
        out.push({ part: p, i, col: cols[p][x.col], ...(x.step !== undefined ? { step: x.step } : {}), n: i + 1, at, dir: [d[0] / l, d[1] / l], middle, mirror: x.mirror, ...(steps.length < 2 ? { lone: true } : {}) });
      }),
    );
    return out;
  }

  get links(): PieceLink[] {
    return this.steps().flatMap((steps, p) => steps.flatMap((x, i) => (i && x.join !== 'first' ? [{ part: p, i, join: x.join, way: x.way, shows: x.shows > SHOWS_MM, cuttable: x.cuttable }] : [])));
  }

  get orderDrag(): OrderDrag | null {
    const d = this.drag;
    return d?.kind === 'order' && d.moved ? { part: d.part, i: d.i, at: d.at, over: d.over } : null;
  }

  private layoutMemo: { scale: number; layout: BadgeLayout } | null = null;

  /**
   * Where the numbers and scissors sit at `scale`: a number in the middle of its piece, the
   * scissors in the middle of its join. One that would cover a control placed before it moves on:
   * a number along its piece, the scissors across the join (along the line between two sections).
   */
  layout(scale: number): BadgeLayout {
    const badges = this.badges;
    this.steps();
    if (this.layoutMemo?.scale === scale) return this.layoutMemo.layout;
    const gap = (2 * BADGE.r + 4) / scale;
    const taken: Pt[] = [];
    const free = (q: Pt) => taken.every((t) => Math.hypot(t[0] - q[0], t[1] - q[1]) >= gap);
    const spot = (b: PieceBadge, along: number): Pt => [b.at[0] + (b.dir[0] * along) / scale, b.at[1] + (b.dir[1] * along) / scale];
    // The arrows and mirrors stay at the start of each piece.
    for (const b of badges) taken.push(spot(b, BADGE.arrow), spot(b, BADGE.mirror));
    const numbers = badges.map((b) => {
      if (b.lone) return null;
      const cum = cumulative(b.middle);
      const len = cum[cum.length - 1];
      const tries = [0.5, 0.65, 0.35, 0.8, 0.2, 0.92, 0.08].map((f) => pointAt(b.middle, cum, len * f));
      // Where the piece is too short for a free spot: around its middle, a ring further out at a time.
      const m = tries[0];
      for (let ring = 1; ring <= 3; ring++)
        for (let k = 0; k < 8; k++) tries.push([m[0] + Math.cos((k * Math.PI) / 4) * ring * gap, m[1] + Math.sin((k * Math.PI) / 4) * ring * gap]);
      const q = tries.find(free) ?? m;
      taken.push(q);
      return q;
    });
    const scissors = this.links.map((k) => {
      const cum = cumulative(k.way);
      const m = pointAt(k.way, cum, cum[cum.length - 1] / 2);
      // Across the next piece where it starts: along the line between two sections.
      const next = badges.find((b) => b.part === k.part && b.i === k.i);
      const n: Pt = next ? [-next.dir[1], next.dir[0]] : [0, 1];
      const tries = [0, 1, -1, 2, -2].map((o): Pt => [m[0] + n[0] * o * gap, m[1] + n[1] * o * gap]);
      const q = tries.find(free) ?? m;
      taken.push(q);
      return q;
    });
    const layout = { numbers, scissors };
    this.layoutMemo = { scale, layout };
    return layout;
  }

  /** The control of a piece or join under the pointer, or null. */
  badgeAt(x: number, y: number, scale: number): BadgeHit | null {
    const r = (BADGE.r + 2) / scale;
    const near = (p: Pt | null) => !!p && Math.hypot(p[0] - x, p[1] - y) <= r;
    const { numbers, scissors } = this.layout(scale);
    const badges = this.badges;
    const spot = (b: PieceBadge, along: number): Pt => [b.at[0] + (b.dir[0] * along) / scale, b.at[1] + (b.dir[1] * along) / scale];
    for (const [k, b] of badges.entries()) if (near(numbers[k])) return { part: b.part, i: b.i, what: 'number' };
    for (const b of badges) {
      if (near(spot(b, BADGE.mirror))) return { part: b.part, i: b.i, what: 'mirror' };
      if (near(spot(b, BADGE.arrow))) return { part: b.part, i: b.i, what: 'arrow' };
    }
    for (const [k, l] of this.links.entries()) if (l.cuttable && this.scissorsOn(l) && near(scissors[k])) return { part: l.part, i: l.i, what: 'link' };
    return null;
  }

  /**
   * Whether the scissors of a join show and take a click: on a trim and on a join in sight
   * always, else only while it is pointed at (its way, or the number before or after it), so a
   * part of many columns is not strewn with them.
   */
  scissorsOn(l: PieceLink): boolean {
    if (l.join === 'trim' || l.shows) return true;
    const at = this.linkHover;
    if (at?.part === l.part && at.i === l.i) return true;
    const h = this.badgeHover;
    return !!h && h.part === l.part && (h.what === 'number' ? h.i === l.i || h.i === l.i - 1 : h.what === 'link' && h.i === l.i);
  }

  /** The join whose way (or scissors) is under the pointer, or null. */
  private linkAt(x: number, y: number, scale: number): { part: number; i: number } | null {
    const q: Pt = [x, y];
    const { scissors } = this.layout(scale);
    let best: { part: number; i: number; d: number } | null = null;
    this.links.forEach((l, k) => {
      let d = Math.hypot(scissors[k][0] - x, scissors[k][1] - y) <= (BADGE.r + 2) / scale ? 0 : Infinity;
      for (let j = 1; j < l.way.length && d > 0; j++) d = Math.min(d, segDist(q, l.way[j - 1], l.way[j]));
      if (d <= PICK_LINE_PX / scale && (!best || d < best.d)) best = { part: l.part, i: l.i, d };
    });
    const b = best as { part: number; i: number } | null;
    return b && { part: b.part, i: b.i };
  }

  /**
   * A control used: the piece turned round, mirrored, sewn one place earlier (a click on its
   * number) or at another place (`to`, its number dropped there), or the join before it cut or
   * sewn through. The same for every part (see satinOrder).
   */
  private useBadge(h: BadgeHit, to?: number): void {
    const steps = this.steps()[h.part];
    const s = this.satin;
    if (!steps?.[h.i] || !s) return;
    const out = this.sewn();
    const part = out[h.part];
    const next =
      h.what === 'arrow' ? turnStep(part, steps, h.i, s)
      : h.what === 'mirror' ? mirrorStep(part, steps, h.i, s)
      : h.what === 'link' ? cutStep(part, steps, h.i, s)
      : moveStep(part, steps, h.i, to ?? h.i - 1, s);
    if (!next) return;
    out[h.part] = next;
    this.selected = null;
    this.setColumns(out);
    this.hooks.change(out, true);
  }

  /** Lines drawn across a satin from now on are cut lines (true) or rungs. */
  setCutMode(on: boolean): void {
    this.cutMode = on;
    this.hooks.redraw();
  }

  get edges(): Pt[][] {
    if (this.mode !== 'satin') return [];
    const ring = (r: Pt[]): Pt[] => (r.length > 2 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) > 1e-9 ? [...r, r[0]] : r);
    // A part is its area: the lines between its columns are its cut lines, no rails. A column too
    // small to have an area of its own (a few stitches) is drawn round as one.
    const areas = [...this.splits.values()].flatMap((sp) => [...sp.outlines, ...sp.holes].map(ring));
    return [...areas, ...this.columns.flatMap((c, k) => (this.splits.has(this.parts[k]) ? [] : [ring([...c.left, ...c.right.slice().reverse()])]))];
  }

  get problems(): SectionProblem[] {
    return this.check().problems;
  }

  get previews(): [Pt, Pt][][] {
    return this.check().previews;
  }

  /**
   * What the lines make now: the parts and holes that do not work, and the stitch pairs of every
   * section that does (as sewn, see previewPairs). Worked out again only when something changed.
   */
  private check(): { problems: SectionProblem[]; previews: [Pt, Pt][][]; sections: SectionGlow[] } {
    if (this.mode !== 'satin' && this.mode !== 'fill') return { problems: [], previews: [], sections: [] };
    const result = this.mode === 'satin' ? this.result() : null;
    const key = JSON.stringify([this.mode, this.lines, this.cutLines, this.bad, this.satin, result]);
    if (this.checked?.key === key) return this.checked;
    const s = this.satin;
    // Each section that works, with its outline, to light it while it is pointed at (see glow).
    const sections: SectionGlow[] = [];
    const pairsOf = (rails: Rails[]) =>
      s
        ? rails.flatMap((r) => {
            const pp = previewPairs(r, s);
            sectionsOf(r).forEach((sec, j) => sections.push({ ring: [...sec.left, ...sec.right.slice().reverse()], pairs: pp[j] ?? [], ok: true }));
            return pp;
          })
        : [];
    const problems: SectionProblem[] = [];
    let previews: [Pt, Pt][][] = [];
    const found = (c: { parts: Pt[][]; holes: Pt[][] }) => {
      problems.push(...c.parts.map((ring) => ({ ring, key: 'stitch.problem.part' as const })));
      problems.push(...c.holes.map((ring) => ({ ring, key: 'stitch.problem.hole' as const })));
    };
    if (this.mode === 'fill') {
      const sh = this.shape;
      // Only once something is drawn: an untouched fill is not wrong, just not started.
      if (sh && (this.lines.length || this.cutLines.length)) {
        if (!this.cutLines.length && !sh.holes.length && sh.outlines.length === 1) {
          // Sewn as one strip along the lines (as sewAlongLines does).
          const rails = railsFromOutline(sh.outlines[0], this.lines);
          if (rails) previews = pairsOf([rails]);
          else found({ parts: [sh.outlines[0]], holes: [] });
        } else {
          const c = checkSections(sh.outlines, this.lines, this.cutLines, sh.holes);
          found(c);
          previews = pairsOf(c.strips);
        }
      }
    } else if (result) {
      // Parts shown as their lines make them now, not as sewn.
      const shown = new Set<number>();
      for (const [k, sp] of this.splits) {
        if (this.cleared.has(k)) {
          // Only its area, after Leeren: as on a fill, not wrong until something is drawn.
          shown.add(k);
          const lines = this.linesOf(k);
          const cuts = this.cutsOf(k);
          if (!lines.length && !cuts.length) continue;
          const c = checkSections(sp.outlines, lines, cuts, sp.holes);
          found(c);
          previews.push(...pairsOf(c.strips));
        } else if (this.cutsChanged(k)) {
          // As sewn, nothing to say; only cut lines not sewn yet can leave a part without a column.
          // Then the part as its lines make it now; the stitches stay as they were.
          const c = checkSections(sp.outlines, this.splitLines(k), this.cutsOf(k), sp.holes);
          if (!c.parts.length && !c.holes.length) continue;
          shown.add(k);
          found(c);
          previews.push(...pairsOf(c.strips));
        }
      }
      previews.push(...pairsOf(result.filter((_, k) => !shown.has(k)).flat()));
    }
    if (!problems.length && this.bad) problems.push({ ring: this.bad, key: 'stitch.problem.part' });
    this.checked = { key, problems, previews, sections };
    return this.checked;
  }

  /** The rungs and free rungs of part `part`, as lines (see resplit). */
  private splitLines(part: number): [Pt, Pt][] {
    if (!this.splits.has(part)) return [];
    if (this.cleared.has(part)) return this.linesOf(part).map(([a, b]) => [a, b] as [Pt, Pt]);
    return this.columns.flatMap((c, k) => {
      if (this.parts[k] !== part) return [];
      // Read from stitches and nothing set yet: the stitches' own pairs, every 1.5 mm or so (they
      // never cross, as suggested rungs at a corner can).
      if (!c.own && !c.rails.rungs && !c.spans.length && c.left.length === c.right.length && c.left.length > 2) {
        const out: [Pt, Pt][] = [];
        let last = -Infinity;
        c.left.forEach((p, i) => {
          if (i > 0 && i < c.left.length - 1 && c.cl[i] - last >= 1.5) {
            out.push([p, c.right[i]]);
            last = c.cl[i];
          }
        });
        if (out.length) return out;
      }
      const lines = [...c.rungs.map((r) => this.ends(c, r)), ...c.spans];
      // A section without rungs (a corner, read from stitches): across its middle, so it stays a part.
      return lines.length ? lines : [this.ends(c, [c.cl[c.cl.length - 1] / 2, c.cr[c.cr.length - 1] / 2])];
    });
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
      if (c.rails.split) base.split = c.rails.split;
      if (c.rails.mirror) base.mirror = true;
      // A plan for as many sections as there are now; with a cut line more or less it is made anew.
      if (c.plan && c.plan.length === c.cuts.length + 1) base.plan = c.plan.map((x) => ({ ...x }));
      (out[this.parts[k]] ??= []).push(base);
    });
    return out;
  }

  /** The columns per satin part to sew: as result, a part cleared (see clear) as it is sewn now. */
  private sewn(): Rails[][] {
    const out = this.result();
    for (const [k, cols] of this.cleared) out[k] ??= cols;
    return out;
  }

  /** A line of part `part`. */
  private owned<L extends Pt[]>(line: L, part: number): L {
    this.owner.set(line, part);
    return line;
  }

  /** The part a line on a satin belongs to: the one it was drawn for, else the area its middle lies in or it crosses. */
  private partOf(line: Pt[]): number | null {
    return this.owner.get(line) ?? this.partAt(line);
  }

  /** The part whose area a line (straight or a bent cut line) lies in (its middle), else one whose edge it crosses. */
  private partAt(line: Pt[]): number | null {
    const m = line.length === 2 ? mid(line[0], line[1]) : midOf(cutLine(line));
    if (!m) return null;
    for (const [k, sp] of this.splits) if (sp.outlines.some((o) => inside(o, m)) && !sp.holes.some((h) => inside(h, m))) return k;
    for (const [k, sp] of this.splits) if (sp.outlines.some((o) => (line.length === 2 ? chordOf(o, line[0], line[1]) : cutAcross(o, line)))) return k;
    return null;
  }

  private cutsOf(part: number): Cut[] {
    return this.cutLines.filter((l) => this.partOf(l) === part);
  }

  private linesOf(part: number): [Pt, Pt][] {
    return this.lines.filter((l) => this.partOf(l) === part);
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
    // A cut line drawn across an area: its ends, the points it bends at, and the curve between.
    const considerCut = (i: number, c: Cut) => {
      c.forEach((p, k) => {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d > reachEnd || (best && d >= best.d)) return;
        if (k === 0 || k === c.length - 1) best = { pick: { col: -1, i, end: k ? 1 : 0, cut: true }, d };
        else best = { pick: { col: -1, i, end: -1, cut: true, node: k }, d };
      });
      if (best && (best.pick.end !== -1 || best.pick.node !== undefined)) return;
      const d = Math.min(...cutPieces(c).map(([a, b]) => segDist(q, a, b)));
      if (d <= reachLine && (!best || d < best.d)) best = { pick: { col: -1, i, end: -1, cut: true }, d };
    };
    if (this.mode === 'satin') {
      this.columns.forEach((c, k) => c.rungs.forEach((r, i) => consider(k, i, ...this.ends(c, r))));
      this.columns.forEach((c, k) => c.spans.forEach(([a, b], i) => consider(k, i, a, b, false, true)));
      this.columns.forEach((c, k) => c.cuts.forEach((r, i) => consider(k, i, ...this.ends(c, r), true)));
      this.lines.forEach(([a, b], i) => consider(-1, i, a, b));
      this.cutLines.forEach((c, i) => considerCut(i, c));
    }
    else if (this.mode === 'fill') {
      this.lines.forEach(([a, b], i) => consider(-1, i, a, b));
      this.cutLines.forEach((c, i) => considerCut(i, c));
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
    if (this.mode !== 'satin') return !this.loop.length || nearLoop(this.loop, x, y);
    // An area without columns (after Leeren): near it, as on a fill.
    for (const k of this.cleared.keys()) if (this.splits.get(k)?.outlines.some((o) => nearLoop(o, x, y))) return true;
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
    if (badge?.what === 'number') {
      // Dragged onto another number it goes to that place; a click sews it one place earlier (see up).
      this.drag = { kind: 'order', part: badge.part, i: badge.i, from: [x, y], at: [x, y], scale, moved: false, over: null };
      this.hooks.redraw();
      return 'move';
    }
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
      // A cut line across an area: a point it bends at is dragged, the curve between bent (see dragTo).
      if (hit.cut && hit.col < 0 && hit.end === -1) this.drag = hit.node !== undefined ? { kind: 'end', pick: hit } : { kind: 'bend', pick: hit, from: [x, y], still: 3 / scale };
      else this.drag = hit.end === -1 || (hit.span && !loop) ? null : { kind: 'end', pick: hit, ...(loop ? { loop } : {}) };
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
    if (d.kind === 'order') {
      d.at = [x, y];
      if (Math.hypot(x - d.from[0], y - d.from[1]) * d.scale >= 4) d.moved = true;
      const h = d.moved ? this.badgeAt(x, y, d.scale) : null;
      d.over = h?.what === 'number' && h.part === d.part && h.i !== d.i ? h.i : null;
    } else if (d.kind === 'point') {
      if (this.inside(x, y)) this.points[d.i] = [x, y];
      d.moved = true;
    } else if (d.kind === 'draw' && this.draft) this.draft[1] = [x, y];
    else if (d.kind === 'bend') {
      const c = this.cutLines[d.pick.i];
      if (!c) return false;
      if (d.node === undefined) {
        // A click stays a click: only once the pointer moves off does the line get a point there.
        if (Math.hypot(x - d.from[0], y - d.from[1]) < d.still) return true;
        d.node = bendIndex(c, d.from);
        c.splice(d.node, 0, [d.from[0], d.from[1]]);
        this.selected = { ...d.pick, node: d.node };
      }
      c[d.node] = [x, y];
    }
    else if (d.kind === 'sketch' && this.sketch) {
      const l = this.sketch[this.sketch.length - 1];
      if (Math.hypot(x - l[0], y - l[1]) >= this.sketchStep) this.sketch.push([x, y]);
    } else if (d.kind === 'end') {
      const { col, i, end } = d.pick;
      d.moved = true;
      if (this.mode === 'fill' || col < 0) {
        const l = this.fillList(d.pick)[i];
        l[d.pick.node ?? (end === 0 ? 0 : l.length - 1)] = [x, y];
      }
      else if (d.pick.span && d.loop) {
        // Slid along the section's outline, wherever it goes.
        const c = this.columns[col];
        const { ring, cum } = d.loop;
        const q = pointAt(ring, cum, project(ring, cum, [x, y]).s);
        c.spans[i] = end === 0 ? [q, c.spans[i][1]] : [c.spans[i][0], q];
        this.hooks.change(this.sewn(), false);
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
        this.hooks.change(this.sewn(), false);
      }
    }
    this.hooks.redraw();
    return true;
  }

  up(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'order') {
      if (!d.moved) this.useBadge({ part: d.part, i: d.i, what: 'number' });
      else if (d.over !== null) this.useBadge({ part: d.part, i: d.i, what: 'number' }, d.over);
    } else if (d.kind === 'point') {
      if (d.moved) this.hooks.points?.(this.points.map((p) => [p[0], p[1]] as Pt));
    } else if (d.kind === 'end') {
      if (d.moved && d.pick.col < 0 && d.pick.cut) this.markOwn(d.pick.i);
      if (this.mode === 'satin' && d.pick.col < 0) {
        if (d.moved) this.resplitOf(this.fillList(d.pick)[d.pick.i]);
      }
      else if (this.mode === 'satin') this.commit(d.pick.col);
      else this.linesChanged();
    } else if (d.kind === 'bend') {
      if (d.node === undefined) return this.hooks.redraw();
      this.markOwn(d.pick.i);
      if (this.mode === 'satin') this.resplitOf(this.cutLines[d.pick.i]);
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
        if (d.cut) this.markOwn(list.length - 1);
        this.selected = { col: -1, i: list.length - 1, end: -1, ...(d.cut ? { cut: true } : {}) };
        this.linesChanged();
      } else if (d.cut && this.splits.size) {
        // On a satin every cut line cuts the area of its part anew.
        const k = this.partAt([a, b]);
        if (k === null) return this.hooks.redraw();
        this.cutLines.push(this.owned([a, b], k));
        this.markOwn(this.cutLines.length - 1);
        this.selected = { col: -1, i: this.cutLines.length - 1, end: -1, cut: true };
        this.resplit(k);
      } else if (!d.cut && this.cleared.has(this.partAt([a, b]) ?? -1)) {
        // On an area alone (after Leeren) a line across as on a fill.
        const k = this.partAt([a, b])!;
        this.lines.push(this.owned([a, b], k));
        this.selected = { col: -1, i: this.lines.length - 1, end: -1 };
        this.resplit(k);
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
            this.commit(k);
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
      this.commit(k);
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
    this.commit(k);
  }

  /**
   * A change taken over as one undo step. While the cut lines of a satin cut from a fill are not
   * the ones it was cut along (they left a part without a column), the fill is cut anew with it:
   * a rung drawn in such a part makes it fit.
   */
  private commit(col?: number): void {
    const part = col === undefined ? undefined : this.parts[col];
    const pending = [...this.splits.keys()].find((k) => (part === undefined || k === part) && (this.cleared.has(k) || this.cutsChanged(k)));
    if (pending !== undefined) {
      this.resplit(pending);
      return;
    }
    this.hooks.change(this.sewn(), true);
  }

  /** The part of a line moved or taken away cut anew. */
  private resplitOf(line: Pt[] | undefined): void {
    const k = line ? this.partOf(line) : null;
    if (k === null) return this.hooks.redraw();
    this.resplit(k);
  }

  /** Whether the satin is shown in sections of its area (see Rails.split), so its cut lines can be suggested anew. */
  get sectioned(): boolean {
    return this.mode === 'satin' && this.splits.size > 0;
  }

  /** The satin parts shown in sections of their area. */
  get sectionParts(): number[] {
    return this.mode === 'satin' ? [...this.splits.keys()] : [];
  }

  /**
   * Vorschlagen on a satin, all its parts as one undo step: each part's area cut along `cuts` and
   * crossed by `lines` (see suggestSatin) in place of its own, or with `rails` rungs at the bends
   * of its columns as they run (see alongRails). Spacings and directions go with the parts as on
   * any cut. With `edge`, the area as it is now in place of the one the part opened with. False
   * when nothing changed.
   */
  suggestParts(plans: SuggestPlan[]): boolean {
    if (!this.sectioned) return false;
    this.selected = null;
    let changed = false;
    for (const p of plans) if ('rails' in p) changed = this.alongRails(new Set([p.part]), false) || changed;
    for (const p of plans) {
      if ('rails' in p) continue;
      const sp = this.splits.get(p.part);
      if (!sp) continue;
      if (p.edge) this.splits.set(p.part, { outlines: p.edge.outlines, holes: p.edge.holes });
      this.cutLines = [...this.cutLines.filter((l) => this.partOf(l) !== p.part), ...p.cuts.map((c) => this.owned(copyCut(c), p.part))];
      changed = this.resplit(p.part, p.lines, false) || changed;
    }
    if (changed) this.hooks.change(this.sewn(), true);
    return changed;
  }

  /** Vorschlagen on a satin of one part (see suggestParts). */
  suggestIn(lines: [Pt, Pt][], cuts: Cut[], edge?: { outlines: Pt[][]; holes: Pt[][] }): void {
    const k = this.sectionParts[0];
    if (k !== undefined) this.suggestParts([{ part: k, lines, cuts, ...(edge ? { edge } : {}) }]);
  }

  /** The columns of satin part `part` (shown in sections), as they are now. */
  sectionRails(part: number): Rails[] | null {
    return this.splits.has(part) ? (this.cleared.get(part) ?? this.result()[part] ?? null) : null;
  }

  private markOwn(i: number): void {
    const c = this.cutLines[i];
    if (c) this.ownCuts.push(copyCut(c));
  }

  /** The cut lines drawn or moved by hand that are still there (on satin part `part` only, when given). */
  handCuts(part?: number): Cut[] {
    const at = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
    this.ownCuts = this.ownCuts.filter((o) => this.cutLines.some((c) => c.length === o.length && c.every((p, k) => at(p, o[k]))));
    const mine = part === undefined ? this.ownCuts : this.ownCuts.filter((o) => this.partAt(o) === part);
    return mine.map(copyCut);
  }

  /**
   * Leeren: every rung and cut line away, to start over (cut lines drawn by hand, then
   * Vorschlagen). A satin cut from an area is its area again, without columns: nothing is sewn
   * until the lines drawn on it make columns (see resplit), the stitches stay as they were till
   * then. Other satins as one undo step, sewn without rungs.
   */
  clear(): void {
    this.selected = null;
    this.ownCuts = [];
    if (this.mode === 'fill') {
      this.lines = [];
      this.cutLines = [];
      this.bad = null;
      this.linesChanged();
      return this.hooks.redraw();
    }
    if (this.mode !== 'satin') return;
    const sectioned = this.splits.size > 0;
    if (sectioned) {
      const now = this.result();
      for (const k of this.splits.keys()) if (!this.cleared.has(k)) this.cleared.set(k, now[k] ?? []);
      const keep = this.columns.map((_, k) => k).filter((k) => !this.splits.has(this.parts[k]));
      this.columns = keep.map((k) => this.columns[k]);
      this.parts = keep.map((k) => this.parts[k]);
    }
    for (const c of this.columns) {
      c.rungs = [];
      c.spacings = [];
      c.spans = [];
      c.own = true;
    }
    this.cutLines = [];
    this.lines = [];
    this.bad = null;
    // Other satin parts go along with the first lines that make columns again.
    if (sectioned) return this.hooks.redraw();
    this.hooks.change(this.sewn(), true);
  }

  /** Whether the cut lines are not the ones the satin was cut along (they left a part without a column). */
  private cutsChanged(part: number): boolean {
    if (!this.splits.has(part)) return false;
    const stored = this.columns.find((c, k) => this.parts[k] === part && c.rails.split)?.rails.split?.cuts;
    return JSON.stringify(stored ?? []) !== JSON.stringify(this.cutsOf(part));
  }

  /**
   * The fill of a satin cut from one (see Rails.split) cut anew along the cut lines as they are now,
   * its rungs kept. With as many parts as before each keeps its place in the order, its direction
   * and the trim before it. A part that makes no column or a hole not opened is shown; the
   * stitches then stay as they were until the lines fit.
   */
  private resplit(part: number, lines = this.splitLines(part), commit = true): boolean {
    const sp = this.splits.get(part);
    if (!sp) return false;
    const cuts = this.cutsOf(part);
    const ks = this.columns.map((_, k) => k).filter((k) => this.parts[k] === part);
    // Spacings set at rungs stay at the rung, wherever its part ends up.
    const spaced = ks.flatMap((k) => {
      const c = this.columns[k];
      return c.spacings.flatMap(([at, v]) => {
        const r = c.rungs.find(([x]) => Math.abs(x - at) < 0.05);
        return r ? [{ at: this.ends(c, r)[0], v }] : [];
      });
    });
    const made = stripsOfAreas(sp.outlines, lines, cuts, sp.holes);
    // The area alone (after Leeren): what is missing is shown as on a fill (see check).
    if ((made.hole >= 0 || made.bad) && this.cleared.has(part)) {
      this.hooks.redraw();
      return false;
    }
    if (made.hole >= 0 || made.bad) {
      this.showBad(made.hole >= 0 ? sp.holes[made.hole] : made.bad!);
      this.hooks.say(made.hole >= 0 ? 'stitch.draw.openHole' : 'stitch.draw.notStripPart');
      return false;
    }
    const out = this.sewn();
    const old = out[part] ?? [];
    // One chain per area, a trim between areas apart.
    let cols: Rails[] = made.areas.flatMap((strips, a) => strips.map((r) => ({ left: r.left, right: r.right, rungs: r.rungs, chain: a })));
    if (cols.length === old.length) cols = keptOrder(old, cols);
    else if (this.satin) {
      // Parts anew: each chain in the order that hides the ways between its parts best, as when
      // first sewn from the fill (else a part may start far from where the last one ended).
      const satin = this.satin;
      const chains = new Map<number, Rails[]>();
      for (const c of cols) chains.set(c.chain ?? 0, [...(chains.get(c.chain ?? 0) ?? []), c]);
      cols = [...chains.values()].flatMap((g) => (g.length > 1 ? bestChain(g, satin) : g));
    }
    for (const c of cols) {
      const cl = cumulative(c.left);
      const spacings = (c.rungs ?? []).flatMap((r) => {
        const at = pointAt(c.left, cl, r[0]);
        const hit = spaced.find((x) => Math.hypot(x.at[0] - at[0], x.at[1] - at[1]) < 0.3);
        return hit ? [[r[0], hit.v] as [number, number]] : [];
      });
      if (spacings.length) c.spacings = spacings;
    }
    cols[0].split = { outlines: sp.outlines, holes: sp.holes, cuts: cuts.map(copyCut) };
    out[part] = cols;
    // The other parts keep what was drawn on them and is not sewn yet.
    const pending = [...this.splits.keys()].filter((k) => k !== part && (this.cleared.has(k) || this.cutsChanged(k)));
    const keep = pending.map((k) => ({ k, cuts: this.cutsOf(k), lines: this.linesOf(k), cleared: this.cleared.get(k) }));
    this.setColumns(out);
    for (const p of keep) {
      this.cutLines = [...this.cutLines.filter((l) => this.partOf(l) !== p.k), ...p.cuts.map((l) => this.owned(l, p.k))];
      this.lines.push(...p.lines.map((l) => this.owned(l, p.k)));
      if (!p.cleared) continue;
      this.cleared.set(p.k, p.cleared);
      const stay = this.columns.map((_, k) => k).filter((k) => this.parts[k] !== p.k);
      this.columns = stay.map((k) => this.columns[k]);
      this.parts = stay.map((k) => this.parts[k]);
    }
    if (commit) this.hooks.change(this.sewn(), true);
    return true;
  }

  /** Abandons a drag (a second finger started a pinch). */
  cancel(): void {
    this.drag = null;
    this.draft = null;
    this.draftCut = false;
    this.sketch = null;
  }

  hoverAt(x: number, y: number, scale: number): boolean {
    const was0 = this.linkHover;
    // The join first: its scissors show while it is pointed at, and only then take a click.
    this.linkHover = this.active && this.mode === 'satin' ? this.linkAt(x, y, scale) : null;
    const b = this.active ? this.badgeAt(x, y, scale) : null;
    const h = this.active && !b ? this.pick(x, y, scale) : null;
    const changed = JSON.stringify(b) !== JSON.stringify(this.badgeHover) || JSON.stringify(h) !== JSON.stringify(this.hover) || JSON.stringify(was0) !== JSON.stringify(this.linkHover);
    this.badgeHover = b;
    this.hover = h;
    // A problem says what is missing while the pointer is on it (not on a line or control there).
    const was = this.problemHover;
    this.problemHover = this.active && !b && !h ? this.problems.findIndex((p) => inside(p.ring, [x, y])) : -1;
    const lit = this.glow;
    this.glow = this.active && !this.linkHover && b?.what !== 'link' ? this.glowAt(b, x, y, scale) : null;
    return changed || was !== this.problemHover || lit?.ring !== this.glow?.ring;
  }

  /**
   * The section to light: the one a number, arrow or mirror belongs to, else the one under the
   * pointer (or next to it, on a handle at its edge); a part that cannot be sewn in red.
   */
  private glowAt(b: BadgeHit | null, x: number, y: number, scale: number): SectionGlow | null {
    const piece = b ? this.badges.find((p) => p.part === b.part && p.i === b.i) : null;
    const at: Pt = piece ? piece.middle[Math.floor(piece.middle.length / 2)] : [x, y];
    const r = 6 / scale;
    const near: Pt[] = [at, ...Array.from({ length: 8 }, (_, k): Pt => [at[0] + Math.cos((k * Math.PI) / 4) * r, at[1] + Math.sin((k * Math.PI) / 4) * r])];
    const { problems, sections } = this.check();
    for (const q of near) {
      const bad = problems.find((p) => inside(p.ring, q));
      if (bad) return { ring: bad.ring, pairs: [], ok: false };
      const sec = sections.find((p) => inside(p.ring, q));
      if (sec) return sec;
    }
    return null;
  }

  /** Removes the selected rung or line; false when nothing is selected. */
  deleteSelected(): boolean {
    const s = this.selected;
    if (!s) return false;
    this.selected = null;
    if (s.cut && s.col < 0 && s.node !== undefined) {
      // A point a cut line bends at: the line goes straight on through its other points.
      const c = this.cutLines[s.i];
      if (!c || s.node <= 0 || s.node >= c.length - 1) return false;
      c.splice(s.node, 1);
      this.selected = { col: -1, i: s.i, end: -1, cut: true };
      this.markOwn(s.i);
      if (this.mode === 'satin') this.resplitOf(c);
      else this.linesChanged();
    } else if (this.mode === 'fill') {
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
    } else if (s.col < 0) {
      const list = s.cut ? this.cutLines : this.lines;
      const k = list[s.i] ? this.partOf(list[s.i]) : null;
      list.splice(s.i, 1);
      if (k !== null) this.resplit(k);
    } else if (s.cut) {
      const c = this.columns[s.col];
      c.cuts = c.cuts.filter((_, i) => i !== s.i);
      this.commit(s.col);
    } else if (s.span) {
      const c = this.columns[s.col];
      c.spans = c.spans.filter((_, i) => i !== s.i);
      this.commit(s.col);
    } else {
      const c = this.columns[s.col];
      const at = c.rungs[s.i][0];
      c.rungs = c.rungs.filter((_, i) => i !== s.i);
      c.spacings = c.spacings.filter(([x]) => Math.abs(x - at) >= 0.05);
      c.own = true;
      this.commit(s.col);
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
    if (changed) this.hooks.change(this.sewn(), true);
    else this.hooks.say('stitch.direction.cornersNone');
  }

  /**
   * Vorschlagen along the columns as they are, where the area makes no suggestion (a ring, an
   * outline letter, an outline read from an image): rungs at the bends, as one change. No cut
   * lines at corners: on curls they made fans and new problems. False when there is nothing to add.
   */
  alongRails(parts?: Set<number>, commit = true): boolean {
    let changed = false;
    for (const [k, c] of this.columns.entries()) {
      if (parts && !parts.has(this.parts[k])) continue;
      const rungs = cornerRungs(c.left, c.right, c.rungs);
      if (JSON.stringify(rungs) === JSON.stringify(c.rungs)) continue;
      c.rungs = rungs;
      c.own = true;
      changed = true;
    }
    this.selected = null;
    if (changed && commit) this.hooks.change(this.sewn(), true);
    return changed;
  }

  /** Cut lines at the sharp corners of each column, those there kept; says so when there are none. */
  /** Whether some chain has more than one column (see bestOrder). */
  get chained(): boolean {
    const n = new Map<string, number>();
    this.columns.forEach((c, k) => c.rails.chain !== undefined && n.set(`${this.parts[k]}.${c.rails.chain}`, (n.get(`${this.parts[k]}.${c.rails.chain}`) ?? 0) + 1));
    return [...n.values()].some((v) => v > 1);
  }

  /**
   * Each chain in the order, directions and sides that hide the way between its columns best
   * (see bestChain); says so when they already are.
   */
  bestOrder(): void {
    if (this.mode !== 'satin' || !this.satin) return;
    const satin = this.satin;
    const out = this.sewn();
    const next = out.map((part) => {
      const groups: Rails[][] = [];
      for (const r of part) {
        const g = groups[groups.length - 1];
        if (g && r.chain !== undefined && g[0].chain === r.chain) g.push(r);
        else groups.push([r]);
      }
      return groups.flatMap((g) => (g.length > 1 && g[0].chain !== undefined ? bestChain(g, satin) : g));
    });
    this.selected = null;
    if (JSON.stringify(next) === JSON.stringify(out)) return this.hooks.say('stitch.order.best.none');
    this.setColumns(next);
    this.hooks.change(next, true);
  }

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
    if (changed) this.hooks.change(this.sewn(), true);
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
    this.hooks.change(this.sewn(), true);
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
    this.hooks.change(this.sewn(), true);
  }

  /** Back to the direction of the stitches (no rungs set). */
  follow(): void {
    const out: Rails[][] = [];
    this.columns.forEach((c, k) => (out[this.parts[k]] ??= []).push({ left: c.left, right: c.right, ...(c.cuts.length ? { cuts: c.cuts } : {}), ...(c.rails.chain !== undefined ? { chain: c.rails.chain } : {}) }));
    this.selected = null;
    this.hooks.change(out, true);
  }
}

/** A column as given back: without an area read from its rails (see Split.read). */
function givenBack(r: Rails): Rails {
  if (!r.split?.read) return r;
  const { split: _s, ...rest } = r;
  return rest;
}

const sub = (a: Pt, b: Pt): [number, number] => [a[0] - b[0], a[1] - b[1]];
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const copyCut = (c: Cut): Cut => c.map((p) => [p[0], p[1]] as Pt);

/** Where a point grabbed on a cut line goes among its points: after the last one before it along the curve. */
function bendIndex(c: Cut, q: Pt): number {
  const line = cutLine(c);
  const cum = cumulative(line);
  const along = (p: Pt) => project(line, cum, p).s;
  const s = along(q);
  let k = 1;
  while (k < c.length - 1 && along(c[k]) < s) k++;
  return k;
}

/** Whether a point lies in the box around a loop, 5 mm round it. */
function nearLoop(loop: Pt[], x: number, y: number): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of loop) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return x >= minX - 5 && x <= maxX + 5 && y >= minY - 5 && y <= maxY + 5;
}

function segDist(q: Pt, a: Pt, b: Pt): number {
  const v = sub(b, a);
  const l2 = v[0] * v[0] + v[1] * v[1];
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * v[0] + (q[1] - a[1]) * v[1]) / l2)) : 0;
  return Math.hypot(q[0] - a[0] - v[0] * t, q[1] - a[1] - v[1] * t);
}

/**
 * Parts cut anew (`made`, as many as `old`) in the order of the old ones they lie on, each turned
 * and mirrored as its old one was and with its chain number (the trims stay between the same places).
 */
function keptOrder(old: Rails[], made: Rails[]): Rails[] {
  const centre = (r: Rails): Pt => {
    const all = [...r.left, ...r.right];
    return [all.reduce((a, p) => a + p[0], 0) / all.length, all.reduce((a, p) => a + p[1], 0) / all.length];
  };
  const start = (r: Rails) => mid(r.left[0], r.right[0]);
  const end = (r: Rails) => mid(r.left[r.left.length - 1], r.right[r.right.length - 1]);
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const left = made.slice();
  return old.map((o) => {
    const c = centre(o);
    let j = 0;
    left.forEach((r, k) => d(centre(r), c) < d(centre(left[j]), c) && (j = k));
    let r = left.splice(j, 1)[0];
    if (d(start(o), end(r)) < d(start(o), start(r))) r = reversedRails(r);
    return { ...r, chain: o.chain, ...(o.mirror ? { mirror: true } : {}) };
  });
}
