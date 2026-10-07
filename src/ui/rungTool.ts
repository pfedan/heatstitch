import { addRung, checkSections, chordOf, railsFromOutline, stripsOfAreas, cornerCuts, cornerRungs, cumulative, inside, pointAt, project, rungFromLine, rungRange, seedRungs, type Rung } from '../digitize/rungs';
import { pathLength } from '../digitize/fill';
import { simplify } from '../digitize/run';
import type { Pt } from '../digitize/skeleton';
import { bestChain, previewPairs, reversedRails, sectionPlan, sectionsOf, sewnBack, spanSection, sectionLoops, sectionOfRung, type Rails, type SatinSettings, type SectionLoop, type SectionStep, type Split } from '../model/restitch';

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
  /** Its satin starts on the other rail (see Rails.mirror). */
  mirror: boolean;
  /** A column on its own: no place in an order to change. */
  lone?: boolean;
}

export type BadgeHit = { col: number; step?: number; what: 'number' | 'arrow' | 'scissors' | 'mirror' };

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

/** A part that makes no column yet, or a hole no cut line opens: outlined, with what is missing. */
export interface SectionProblem {
  ring: Pt[];
  key: 'stitch.problem.part' | 'stitch.problem.hole';
}

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
  /** Every part or hole that does not work yet, all at once, for as long as it stays so. */
  readonly problems: SectionProblem[];
  /** The problem under the pointer (index in `problems`, -1 none) and where the pointer is. */
  problemHover: number;
  /** Each section as it will be sewn (its stitch pairs); none for a part with a problem. */
  readonly previews: [Pt, Pt][][];
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
  say: (key: 'stitch.direction.miss' | 'stitch.direction.cross' | 'stitch.direction.needCut' | 'stitch.direction.cornersNone' | 'stitch.sections.none' | 'stitch.order.best.none' | 'stitch.draw.openHole' | 'stitch.draw.notStripPart') => void;
}

type Drag = { kind: 'end'; pick: RungPick; loop?: SectionLoop; moved?: boolean } | { kind: 'draw'; cut: boolean } | { kind: 'sketch' } | { kind: 'point'; i: number; moved: boolean } | null;

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
   * The fill a satin part was cut from (see Rails.split): its cut lines are `cutLines`, moved,
   * drawn and removed like on the fill, the part then cut anew.
   */
  private split: (Omit<Split, 'cuts'> & { part: number }) | null = null;
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
  problemHover = -1;
  /** The fill's outsides and holes (lines drawn on a fill), to check the parts its lines make. */
  private shape: { outlines: Pt[][]; holes: Pt[][] } | null = null;
  private checked: { key: string; problems: SectionProblem[]; previews: [Pt, Pt][][] } | null = null;
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

  /** Starts drawing lines across a fill with this outline (`shape`: its areas and holes, to check the parts). */
  openFill(loop: Pt[], shape: { outlines: Pt[][]; holes: Pt[][] } | null = null): void {
    this.active = true;
    this.mode = 'fill';
    this.shape = shape;
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
    this.shape = null;
    this.checked = null;
    this.problemHover = -1;
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
    this.split = null;
    this.cutLines = [];
    columns.forEach((part, k) => {
      const from = part.find((r) => r.split)?.split;
      if (!from || this.split) return;
      this.split = { part: k, outlines: from.outlines, holes: from.holes };
      this.cutLines = from.cuts.map(([a, b]) => [a, b] as [Pt, Pt]);
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
  private fillList(s: RungPick): [Pt, Pt][] {
    return s.cut ? this.cutLines : this.lines;
  }

  /** Shows the part of the fill that made no column. */
  showBad(ring: Pt[]): void {
    this.bad = ring;
    this.hooks.redraw();
  }

  /** Lines across and cut lines put in place of those drawn (see suggestSatin); `bad` the part that makes no column. */
  setFillLines(lines: [Pt, Pt][], cuts: [Pt, Pt][], bad: Pt[] | null = null): void {
    this.lines = lines.map(([a, b]) => [a, b] as [Pt, Pt]);
    this.cutLines = cuts.map(([a, b]) => [a, b] as [Pt, Pt]);
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
    const chained = new Set<number>();
    for (const ks of byPart.values()) {
      if (ks.length < 2) continue;
      ks.forEach((k, i) => {
        chained.add(k);
        const c = this.columns[k];
        const la = c.cl[c.cl.length - 1];
        const lb = c.cr[c.cr.length - 1];
        const at = mid(c.left[c.left.length - 1], c.right[c.right.length - 1]);
        const inward = mid(pointAt(c.left, c.cl, Math.max(0, la - 1)), pointAt(c.right, c.cr, Math.max(0, lb - 1)));
        const d = sub(inward, at);
        const l = Math.hypot(d[0], d[1]) || 1;
        out.push({ col: k, n: i + 1, at, dir: [d[0] / l, d[1] / l], trim: i ? this.columns[ks[i - 1]].rails.chain !== c.rails.chain : null, mirror: !!c.rails.mirror });
      });
    }
    // A column on its own (in one section): where its satin starts, turned round and mirrored there.
    if (this.satin) {
      const res = this.result().flat();
      this.columns.forEach((c, k) => {
        if (chained.has(k) || sectionsOf(res[k]).length > 1) return;
        const back = sewnBack([res[k]], this.satin!);
        const [a, b] = back ? [c.left.slice().reverse(), c.right.slice().reverse()] : [c.left, c.right];
        const at = mid(a[0], b[0]);
        const ca = cumulative(a);
        const cb = cumulative(b);
        const inward = mid(pointAt(a, ca, Math.min(1, ca[ca.length - 1])), pointAt(b, cb, Math.min(1, cb[cb.length - 1])));
        const d = sub(inward, at);
        const l = Math.hypot(d[0], d[1]) || 1;
        out.push({ col: k, n: 1, at, dir: [d[0] / l, d[1] / l], trim: null, mirror: !!c.rails.mirror, lone: true });
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
          out.push({ col: k, step: i, n: i + 1, at, dir: [d[0] / l, d[1] / l], trim: i ? plan[i].trim : null, mirror: !!x.mirror });
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
      if (!b.lone && near(spot(BADGE.number, 0))) return { ...at, what: 'number' };
      if (near(spot(BADGE.number, -BADGE.scissors))) return { ...at, what: 'mirror' };
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
    else if (h.what === 'mirror') {
      if (cols[k].mirror) delete cols[k].mirror;
      else cols[k].mirror = true;
    } else if (h.what === 'number') {
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
    else if (h.what === 'mirror') {
      if (plan[i].mirror) delete plan[i].mirror;
      else plan[i].mirror = true;
    } else if (h.what === 'number') {
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
  private check(): { problems: SectionProblem[]; previews: [Pt, Pt][][] } {
    if (this.mode !== 'satin' && this.mode !== 'fill') return { problems: [], previews: [] };
    const result = this.mode === 'satin' ? this.result() : null;
    const key = JSON.stringify([this.mode, this.lines, this.cutLines, this.bad, this.satin, result]);
    if (this.checked?.key === key) return this.checked;
    const s = this.satin;
    const pairsOf = (rails: Rails[]) => (s ? rails.flatMap((r) => previewPairs(r, s)) : []);
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
      const sp = this.split;
      // As sewn, nothing to say; only cut lines not sewn yet can leave a part without a column.
      const c = sp && this.cutsChanged() ? checkSections(sp.outlines, this.splitLines(), this.cutLines, sp.holes) : null;
      if (c && (c.parts.length || c.holes.length)) {
        // The part cut from the fill as its lines make it now; the stitches stay as they were.
        found(c);
        previews = [...pairsOf(result.filter((_, k) => k !== sp!.part).flat()), ...pairsOf(c.strips)];
      } else previews = pairsOf(result.flat());
    }
    if (!problems.length && this.bad) problems.push({ ring: this.bad, key: 'stitch.problem.part' });
    this.checked = { key, problems, previews };
    return this.checked;
  }

  /** The rungs and free rungs of the part cut from a fill, as lines (see resplit). */
  private splitLines(): [Pt, Pt][] {
    const sp = this.split;
    if (!sp) return [];
    return this.columns.flatMap((c, k) => {
      if (this.parts[k] !== sp.part) return [];
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
      this.cutLines.forEach(([a, b], i) => consider(-1, i, a, b, true));
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
      d.moved = true;
      if (this.mode === 'fill' || col < 0) this.fillList(d.pick)[i][end as 0 | 1] = [x, y];
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
      if (this.mode === 'satin' && d.pick.col < 0) {
        if (d.moved) this.resplit();
      }
      else if (this.mode === 'satin') this.commit();
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
      } else if (d.cut && this.split) {
        // On a satin cut from a fill every cut line cuts the fill anew.
        this.cutLines.push([a, b]);
        this.selected = { col: -1, i: this.cutLines.length - 1, end: -1, cut: true };
        this.resplit();
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
            this.commit();
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
      this.commit();
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
    this.commit();
  }

  /**
   * A change taken over as one undo step. While the cut lines of a satin cut from a fill are not
   * the ones it was cut along (they left a part without a column), the fill is cut anew with it:
   * a rung drawn in such a part makes it fit.
   */
  private commit(): void {
    if (this.cutsChanged()) return this.resplit();
    this.hooks.change(this.result(), true);
  }

  /** Whether the satin is shown in sections of its area (see Rails.split), so its cut lines can be suggested anew. */
  get sectioned(): boolean {
    return this.mode === 'satin' && !!this.split;
  }

  /**
   * Vorschlagen on a satin: its area cut along `cuts` and crossed by `lines` (see suggestSatin) in
   * place of its own, sewn anew as one undo step. Spacings and directions go with the parts as on
   * any cut.
   */
  suggestIn(lines: [Pt, Pt][], cuts: [Pt, Pt][]): void {
    if (!this.sectioned) return;
    this.cutLines = cuts.map(([a, b]) => [a, b] as [Pt, Pt]);
    this.selected = null;
    this.resplit(lines);
  }

  /** Whether the cut lines are not the ones the satin was cut along (they left a part without a column). */
  private cutsChanged(): boolean {
    const stored = this.columns.find((c) => c.rails.split)?.rails.split?.cuts;
    return !!this.split && JSON.stringify(stored) !== JSON.stringify(this.cutLines);
  }

  /**
   * The fill of a satin cut from one (see Rails.split) cut anew along the cut lines as they are now,
   * its rungs kept. With as many parts as before each keeps its place in the order, its direction
   * and the trim before it. A part that makes no column or a hole not opened is shown; the
   * stitches then stay as they were until the lines fit.
   */
  private resplit(lines = this.splitLines()): void {
    const sp = this.split;
    if (!sp) return;
    const ks = this.columns.map((_, k) => k).filter((k) => this.parts[k] === sp.part);
    // Spacings set at rungs stay at the rung, wherever its part ends up.
    const spaced = ks.flatMap((k) => {
      const c = this.columns[k];
      return c.spacings.flatMap(([at, v]) => {
        const r = c.rungs.find(([x]) => Math.abs(x - at) < 0.05);
        return r ? [{ at: this.ends(c, r)[0], v }] : [];
      });
    });
    const made = stripsOfAreas(sp.outlines, lines, this.cutLines, sp.holes);
    if (made.hole >= 0 || made.bad) {
      this.showBad(made.hole >= 0 ? sp.holes[made.hole] : made.bad!);
      return this.hooks.say(made.hole >= 0 ? 'stitch.draw.openHole' : 'stitch.draw.notStripPart');
    }
    const out = this.result();
    const old = out[sp.part];
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
    cols[0].split = { outlines: sp.outlines, holes: sp.holes, cuts: this.cutLines.map(([a, b]) => [a, b] as [Pt, Pt]) };
    out[sp.part] = cols;
    this.setColumns(out);
    this.hooks.change(out, true);
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
    // A problem says what is missing while the pointer is on it (not on a line or control there).
    const was = this.problemHover;
    this.problemHover = this.active && !b && !h ? this.problems.findIndex((p) => inside(p.ring, [x, y])) : -1;
    return changed || was !== this.problemHover;
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
    } else if (s.cut && s.col < 0) {
      this.cutLines.splice(s.i, 1);
      this.resplit();
    } else if (s.cut) {
      const c = this.columns[s.col];
      c.cuts = c.cuts.filter((_, i) => i !== s.i);
      this.commit();
    } else if (s.span) {
      const c = this.columns[s.col];
      c.spans = c.spans.filter((_, i) => i !== s.i);
      this.commit();
    } else {
      const c = this.columns[s.col];
      const at = c.rungs[s.i][0];
      c.rungs = c.rungs.filter((_, i) => i !== s.i);
      c.spacings = c.spacings.filter(([x]) => Math.abs(x - at) >= 0.05);
      c.own = true;
      this.commit();
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

  /**
   * Vorschlagen along the columns as they are, where the area makes no suggestion (a ring, an
   * outline letter): rungs at the bends and cut lines at the sharp corners, as one change. False
   * when there is nothing to add.
   */
  alongRails(): boolean {
    let changed = false;
    for (const c of this.columns) {
      const rungs = cornerRungs(c.left, c.right, c.rungs);
      if (JSON.stringify(rungs) !== JSON.stringify(c.rungs)) {
        c.rungs = rungs;
        c.own = true;
        changed = true;
      }
      const la = c.cl[c.cl.length - 1];
      const lb = c.cr[c.cr.length - 1];
      let cuts = c.cuts;
      for (const r of cornerCuts(c.left, c.right, c.own ? c.rungs : (c.rails.rungs ?? []))) cuts = addRung(cuts, r, la, lb) ?? cuts;
      if (cuts.length !== c.cuts.length) {
        c.cuts = cuts;
        changed = true;
      }
    }
    this.selected = null;
    if (changed) this.hooks.change(this.result(), true);
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
    const out = this.result();
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
