import { overlaps, sewObjects, type SewObject } from './objects';
import { moveStats, planCandidates, reorder, type OrderCost, type OrderOptions } from './order';
import { patternStats, type Pattern } from './pattern';
import { remembered, type Remembered } from './restitch';
import { autoReversible, reverseObjects } from './reverse';
import { sewingSeconds, stitchKinds, stitchNumbers, type MachineTimes } from './sequence';

/** What the order card shows: color changes and trims as the statistics count them, travel between objects. */
export function orderStats(p: Pattern): OrderCost {
  const st = patternStats(p);
  return { colorChanges: st.colorChanges, trims: st.trims, travelMm: moveStats(p).travelMm };
}

/** The sewing time the card shows for `p` with `c` its stats. */
export function orderSeconds(p: Pattern, c: OrderCost, m: MachineTimes): number {
  const n = stitchNumbers(p);
  return sewingSeconds(n.length ? n[n.length - 1] : 0, c.trims, c.colorChanges, m);
}

export interface OrderChoice {
  next: Pattern;
  /** Objects sewn anew from the other side: their stitches in `next` and what they remember. */
  reversed: { start: number; end: number; memory: Remembered }[];
}

export interface BestOrderInput {
  objects: SewObject[];
  kinds: Uint8Array;
  over: number[][];
}

export const orderInput = (p: Pattern): BestOrderInput => {
  const kinds = stitchKinds(p);
  const objects = sewObjects(p, kinds);
  // A fill with a satin border in its thread has more satin than fill thread, and stays a fill.
  for (const o of objects) if (o.kind === 'satin' && remembered(p, o)?.borderAt) o.kind = 'fill';
  return { objects, kinds, over: overlaps(p, objects) };
};

/** What the card shows for a pattern: its stats and sewing time. */
interface Shown extends OrderCost {
  seconds: number;
}

const shown = (p: Pattern, m: MachineTimes): Shown => {
  const c = orderStats(p);
  return { ...c, seconds: orderSeconds(p, c, m) };
};

/**
 * Is `b` a better result than `a` as the card shows them: no more color changes, trims or sewing
 * time, and less of one of them or shorter ways. Longer ways only for fewer color changes or
 * trims (a stop of the machine saved is worth more than a longer jump). Time is rounded as the
 * card shows it (whole seconds), ways to a tenth of a millimetre.
 */
export function shownBetter(a: Shown, b: Shown): boolean {
  const sa = Math.round(a.seconds);
  const sb = Math.round(b.seconds);
  const ta = Math.round(a.travelMm * 10);
  const tb = Math.round(b.travelMm * 10);
  if (b.colorChanges > a.colorChanges || b.trims > a.trims || sb > sa) return false;
  const fewerStops = b.colorChanges < a.colorChanges || b.trims < a.trims;
  return fewerStops || (tb <= ta && (sb < sa || tb < ta));
}

/** Of two results that are both better than the pattern, which is the better one: less time, then shorter ways. */
const ahead = (a: Shown, b: Shown) => b.seconds < a.seconds - 0.5 || (Math.abs(b.seconds - a.seconds) <= 0.5 && b.travelMm < a.travelMm - 0.05);

/** How many of the optimizer's orders are sewn and compared (cheapest by its model first). */
const TRIED = 4;

/**
 * The best order for `p` with the options of the card, or null when none is better. The
 * optimizer's model only estimates the sewn result (ties, cuts the file had, the end of the
 * design, new stitches of reversed objects), so its best orders are sewn and compared on what the
 * card shows: a proposal never has more color changes, trims or sewing time than the pattern. With "Reverse
 * direction", satins and fills may also be sewn from the other side.
 */
export function bestOrder(p: Pattern, q: BestOrderInput, o: OrderOptions & { reverse: boolean }, m: MachineTimes): OrderChoice | null {
  const { objects, over, kinds } = q;
  const opts = { combineColors: o.combineColors, shortestWays: o.shortestWays, trimMm: o.trimMm };
  const now = shown(p, m);
  let best: { choice: OrderChoice; shown: Shown } | null = null;
  const offer = (choice: OrderChoice) => {
    if (choice.next === p) return;
    const s = shown(choice.next, m);
    if (shownBetter(now, s) && (!best || ahead(best.shown, s))) best = { choice, shown: s };
  };
  for (const plan of planCandidates(p, objects, over, opts).slice(0, TRIED)) offer({ next: reorder(p, objects, plan.order, o.trimMm), reversed: [] });
  if (!o.reverse) return best && (best as { choice: OrderChoice }).choice;
  const may = objects.map((x) => autoReversible(p, x));
  // Objects that turn out not to be reversible (stitches outside their shape) are planned without.
  const tried = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const plans = planCandidates(p, objects, over, opts, may).filter((x) => x.flip.length && !tried.has(`${x.order}|${x.flip}`));
    if (!plans.length) break;
    let failed = false;
    for (const plan of plans.slice(0, TRIED)) {
      tried.add(`${plan.order}|${plan.flip}`);
      const r = reverseObjects(p, objects, plan.flip, kinds, o.trimMm, plan.order);
      if (r.pattern === p) {
        for (const x of r.failed) may[x] = false;
        failed ||= r.failed.length > 0;
        continue;
      }
      offer({ next: r.pattern, reversed: r.starts.map((start, k) => ({ start, end: r.ends[k], memory: r.memory[k] })) });
    }
    if (!failed) break;
  }
  return best && (best as { choice: OrderChoice }).choice;
}
