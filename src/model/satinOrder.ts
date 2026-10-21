import type { Pt } from '../digitize/skeleton';
import { reversedRails, satinRuns, sectionPlan, sectionsOf, shownAmong, trimBefore, type Rails, type SatinSettings, type SectionStep, type SewnStep } from './restitch';

/**
 * The order of a satin part, one model for every satin, wherever it came from: a fill cut into
 * strips (its columns in chains, see Rails.chain), a file (columns each sewn as a run of its own),
 * a column with cut lines of its own (its sections in a plan, see Rails.plan). Each piece the part
 * is sewn in is a step, in the order it is sewn, with how it is joined to the one before:
 *
 * - `way`: sewn on without a stop, through the satin (a chain) or straight on (sections, or a run
 *   that starts where the last one ended);
 * - `jump`: a jump without a trim, as a file's columns near each other are joined (see sewDesign);
 * - `trim`: the thread cut, asked for (between chains, a plan's trim) or for a long way.
 *
 * What is stored stays chain and plan (projects of every version read as before); the steps are
 * read from how satinRuns sews them, so they cannot tell anything the stitches do not do. The edits
 * below are the only ones the satin view makes, the same for every kind of part.
 */

/** What joins a step to the one before it. */
export type StepJoin = 'first' | 'way' | 'jump' | 'trim';

export interface PartStep {
  /** The column (index in the part). */
  col: number;
  /** The section's step in its column's plan (see sectionPlan); none for a whole column. */
  step?: number;
  /** Its rails the way its satin goes: it starts at their start. */
  along: [Pt[], Pt[]];
  /** Its satin starts on the other rail (see Rails.mirror). */
  mirror: boolean;
  join: StepJoin;
  /** The way from the step before to this one, as the thread goes (none for the first). */
  way: Pt[];
  /** How much of the way stays in sight (mm): across the fabric or over satin sewn before it, not cut. */
  shows: number;
  /** A click on the join may cut it or sew it through (see cutStep). */
  cuttable: boolean;
}

/** Up to this much of a way may show before the view marks it (mm): a stitch or two at a corner. */
export const SHOWS_MM = 1;

/** The steps of a satin part, as satinRuns sews it and sewDesign joins its runs (`trimMm`: longer jumps are trimmed). */
export function partSteps(part: Rails[], s: SatinSettings, trimMm: number): PartStep[] {
  const sewn: SewnStep[] = [];
  const runs = satinRuns(part, s, sewn);
  if (!sewn.length) return [];
  // Only between columns of a part sewn as whole columns: its columns can be put in chains.
  const chainable = part.every((r) => r.chain !== undefined || sectionsOf(r).length < 2);
  const ends = (a: [Pt[], Pt[]], end: boolean): Pt => {
    const [l, r] = end ? [a[0][a[0].length - 1], a[1][a[1].length - 1]] : [a[0][0], a[1][0]];
    return [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
  };
  const steps: PartStep[] = sewn.map((x, i) => {
    const r = part[x.col];
    const plan = x.step !== undefined ? sectionPlan(r, s) : null;
    const mirror = plan ? !!plan[x.step!]?.mirror : !!r.mirror;
    const base = { col: x.col, ...(x.step !== undefined ? { step: x.step } : {}), along: x.along, mirror };
    if (!i) return { ...base, join: 'first' as const, way: [], shows: 0, cuttable: false };
    const prev = sewn[i - 1];
    let join: StepJoin;
    let way: Pt[];
    if (prev.run === x.run) {
      join = 'way';
      way = x.way ?? [ends(prev.along, true), ends(x.along, false)];
    } else {
      const a = runs[prev.run][runs[prev.run].length - 1];
      const b = runs[x.run][0];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      join = trimBefore.has(runs[x.run]) || d > trimMm ? 'trim' : d <= 1 ? 'way' : 'jump';
      way = [a, b];
    }
    // Sections of one column take a trim between them; between columns the part may become chains.
    const cuttable = prev.col === x.col ? x.step !== undefined : chainable;
    return { ...base, join, way, shows: 0, cuttable };
  });
  // How much of each way shows, all asked at once: hidden under what is still to come of the part
  // (this piece's column and those after it).
  const asked = steps.filter((x, i) => i && x.join !== 'trim');
  const shown = shownAmong(
    part,
    asked.map((x) => ({ way: x.way, later: new Uint8Array(part.length).fill(1, x.col) })),
  );
  asked.forEach((x, k) => (x.shows = shown[k].bare + shown[k].over));
  return steps;
}

/** The part with step `i` turned round: its satin from the other end. */
export function turnStep(part: Rails[], steps: PartStep[], i: number, s: SatinSettings): Rails[] {
  const x = steps[i];
  return withStep(part, x, s, (plan) => (plan[x.step!].flip = !plan[x.step!].flip), (r) => reversedRails(r));
}

/** The part with step `i` mirrored: its satin starts on the other rail. */
export function mirrorStep(part: Rails[], steps: PartStep[], i: number, s: SatinSettings): Rails[] {
  const x = steps[i];
  const flip = <T extends { mirror?: boolean }>(v: T): T => {
    const { mirror, ...rest } = v;
    return (mirror ? rest : { ...rest, mirror: true }) as T;
  };
  return withStep(part, x, s, (plan) => (plan[x.step!] = flip(plan[x.step!])), (r) => flip(r));
}

/**
 * The part with step `from` sewn at the place of step `to`, the steps between moved up one. A
 * section stays among its column's sections (a column's sections are sewn together); dropped on
 * another column's step its whole column moves. The joins stay between the same places in the
 * order (a trim after the second step stays after the second step). Null when nothing moves.
 */
export function moveStep(part: Rails[], steps: PartStep[], from: number, to: number, s: SatinSettings): Rails[] | null {
  const a = steps[from];
  const b = steps[to];
  if (!a || !b || from === to) return null;
  if (a.col === b.col) {
    if (a.step === undefined || b.step === undefined) return null;
    const plan = sectionPlan(part[a.col], s);
    const trims = plan.map((x) => x.trim);
    const moved = moveItem(plan, a.step, b.step).map((x, j) => ({ ...x, trim: trims[j] }));
    const out = part.slice();
    out[a.col] = { ...part[a.col], plan: moved };
    return out;
  }
  const ids = part.map((r) => r.chain);
  const out = moveItem(part, a.col, b.col).map((r, j) => {
    const { chain: _c, split: _s, ...rest } = r;
    return ids[j] === undefined ? (rest as Rails) : { ...rest, chain: ids[j] };
  });
  // The area and its cut lines stay with the part's first column (see Rails.split).
  const split = part.find((r) => r.split)?.split;
  if (split) out[0] = { ...out[0], split };
  return out;
}

/**
 * The part with the join before step `i` cut, or sewn through when it is cut. Between sections of
 * a column: a trim in its plan. Between columns: they are chains (see Rails.chain), a trim between
 * two chains; a part read from a file is put in chains first, each join as it is sewn now (a trim
 * stays a trim, a jump becomes a way through the satin), so it is sewn anew as a whole. Null when
 * the join cannot change (see PartStep.cuttable).
 */
export function cutStep(part: Rails[], steps: PartStep[], i: number, s: SatinSettings): Rails[] | null {
  const x = steps[i];
  if (!x?.cuttable || i === 0) return null;
  const cut = x.join !== 'trim';
  if (x.step !== undefined && steps[i - 1].col === x.col) {
    const plan = sectionPlan(part[x.col], s);
    plan[x.step].trim = cut;
    const out = part.slice();
    out[x.col] = { ...part[x.col], plan };
    return out;
  }
  // A chain number for every column, from the joins as they are now and the one changed: a new
  // number after each trim. Columns no step is sewn for go with the one before.
  const trimmed = new Set(steps.flatMap((y, j) => (j && (j === i ? cut : y.join === 'trim') && steps[j - 1].col !== y.col ? [y.col] : [])));
  let id = 0;
  return part.map((r, k) => {
    if (k && trimmed.has(k)) id++;
    return { ...r, chain: id };
  });
}

/** The part with step `x` changed: in its column's plan (a section) or the column itself. */
function withStep(part: Rails[], x: PartStep, s: SatinSettings, inPlan: (plan: SectionStep[]) => void, whole: (r: Rails) => Rails): Rails[] {
  const out = part.slice();
  if (x.step !== undefined) {
    const plan = sectionPlan(part[x.col], s);
    inPlan(plan);
    out[x.col] = { ...part[x.col], plan };
  } else out[x.col] = whole(part[x.col]);
  return out;
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}
