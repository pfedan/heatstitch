import { lineRails } from '../digitize/border';
import { cumulative, type Rung } from '../digitize/rungs';
import type { Pt } from '../digitize/skeleton';
import { flatten, type Form } from '../shape/path';
import { satinOf, type PathStitch } from './along';
import { lineGeoOf } from './geo';
import { resewLine } from './line';
import type { SewObject } from './objects';
import type { Pattern } from './pattern';
import { remembered, reversedRails, sectionPlan, type Rails, type Remembered, type SatinSettings, type SectionStep } from './restitch';

/**
 * A satin line's own order, set by hand in the satin view (key R) over what the line makes by
 * itself (an override): its rungs, its cut lines and the order of its sections, its direction and
 * the rail it starts on. The rails themselves are not kept: they follow the line, made anew from
 * it every time it is sewn (see lineRails), so a new width, a moved node or a mirrored line keeps
 * the order. Places along the rails are kept as shares of their length (0 at the start, 1 at the
 * end), so they stay where they were along the line when it gets longer or shorter. Taken away
 * (Auto), the line is sewn as it makes itself again.
 */
export interface LineOrder {
  /** Rungs across the line, as shares of each rail's length (see Rails.rungs). */
  rungs?: Rung[];
  /** Cut lines across it, as shares (see Rails.cuts): it is sewn in sections. */
  cuts?: Rung[];
  /** Spacing set at places along it: share of the left rail, spacing (mm); see Rails.spacings. */
  spacings?: [number, number][];
  /** The order of its sections (see Rails.plan). */
  plan?: SectionStep[];
  /** Its satin starts on the other rail (see Rails.mirror). */
  mirror?: true;
  /** Sewn from the end of the line to its start. */
  turned?: true;
}

/** The paths of a line form as they are sewn: each with its points, closed loops back at their start. */
export function linePaths(form: Form): { pts: Pt[]; closed: boolean }[] {
  return form.paths
    .map((p) => ({ pts: flatten(p), closed: p.closed }))
    .filter((x) => x.pts.length >= 2)
    .map((x) => ({ ...x, pts: x.closed && x.pts.length > 2 && !samePt(x.pts[0], x.pts[x.pts.length - 1]) ? [...x.pts, x.pts[0]] : x.pts }));
}

/** The rails of a satin line along one of its paths, with its own order on them when it has one. */
export function lineColumn(pts: Pt[], closed: boolean, st: PathStitch, order?: LineOrder | null): Rails {
  return withOrder(lineRails(pts, closed, st.width), order);
}

/** The columns of a satin line, one for each of its paths (see lineColumn). */
export function lineColumns(form: Form, st: PathStitch): Rails[] {
  return linePaths(form).map((x, k) => lineColumn(x.pts, x.closed, st, st.order?.[k]));
}

/** `r` (rails as the line makes them) with `order` set on them. */
export function withOrder(r: Rails, order?: LineOrder | null): Rails {
  if (!order) return r;
  const base = order.turned ? reversedRails(r) : r;
  const [la, lb] = lengths(base);
  const out: Rails = { left: base.left, right: base.right };
  const at = (g: Rung): Rung => [clamp(g[0]) * la, clamp(g[1]) * lb];
  if (order.rungs) out.rungs = order.rungs.map(at);
  if (order.cuts) out.cuts = order.cuts.map(at);
  if (order.spacings) out.spacings = order.spacings.map(([s, v]) => [clamp(s) * la, v]);
  // A plan only holds while the line has as many sections as it has steps (see Rails.plan).
  if (order.plan && order.plan.length === (order.cuts?.length ?? 0) + 1) out.plan = order.plan.map((x) => ({ ...x }));
  if (order.mirror) out.mirror = true;
  return out;
}

/**
 * The order set on `edited`, the rails of a satin line `base` as the satin view gives them back:
 * places as shares of its rails' length. Null when nothing is set: the line as it makes itself.
 */
export function orderOf(base: Rails, edited: Rails, s?: SatinSettings): LineOrder | null {
  // Turned round in the view: its start where the line ends.
  const back = reversedRails(base);
  const turned = dist(edited.left[0], back.left[0]) + dist(edited.right[0], back.right[0]) < dist(edited.left[0], base.left[0]) + dist(edited.right[0], base.right[0]);
  const [la, lb] = lengths(edited);
  const share = (g: Rung): Rung => [g[0] / la, g[1] / lb];
  const out: LineOrder = {};
  if (edited.rungs) out.rungs = edited.rungs.map(share);
  if (edited.cuts?.length) out.cuts = edited.cuts.map(share);
  if (edited.spacings?.length) out.spacings = edited.spacings.map(([s, v]) => [s / la, v]);
  // In sections, the order they are sewn in now is kept with them: the line made wider or longer
  // keeps the order that was seen, instead of one worked out anew for its new shape.
  const plan = edited.plan ?? (edited.cuts?.length && s ? sectionPlan(edited, s) : undefined);
  if (plan) out.plan = plan.map((x) => ({ ...x }));
  if (edited.mirror) out.mirror = true;
  if (turned) out.turned = true;
  return Object.keys(out).length ? out : null;
}

/** The order of every path of a satin line, from the columns the satin view gives back; none when no path has one. */
export function ordersOf(form: Form, st: PathStitch, columns: Rails[]): (LineOrder | null)[] | undefined {
  const paths = linePaths(form);
  const s = satinOf(st, true);
  const out = paths.map((x, k) => (columns[k] ? orderOf(lineRails(x.pts, x.closed, st.width), columns[k], s) : (st.order?.[k] ?? null)));
  return out.some((o) => o) ? out : undefined;
}

/** `o` turned round: sewn from the other end of its path. */
export function turnedOrder(o: LineOrder): LineOrder {
  const { turned, ...rest } = o;
  return turned ? rest : { ...rest, turned: true };
}

/**
 * The orders of a satin line mirrored with it: what was on the left rail is now on the right (the
 * line goes the same way, its sides swapped), so each rung's ends change rails and the satin
 * starts on the other one.
 */
export function mirroredOrders(orders: (LineOrder | null)[]): (LineOrder | null)[] {
  const swap = (g: Rung): Rung => [g[1], g[0]];
  return orders.map((o) => {
    if (!o) return null;
    const out: LineOrder = { ...o };
    if (o.rungs) out.rungs = o.rungs.map(swap);
    if (o.cuts) out.cuts = o.cuts.map(swap);
    // In sections the plan says which rail each starts on, else the column does.
    const flip = <T extends { mirror?: true | boolean }>(x: T): T => {
      const { mirror, ...rest } = x;
      return (mirror ? rest : { ...rest, mirror: true }) as T;
    };
    if (o.plan) out.plan = o.plan.map(flip);
    else return flip(out);
    return out;
  });
}

const lengths = (r: Rails): [number, number] => [Math.max(cumulative(r.left).pop() ?? 0, 1e-6), Math.max(cumulative(r.right).pop() ?? 0, 1e-6)];
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const samePt = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/** A line sewn as satin: what it remembers, its form and how it is sewn (its rails are made from the line). */
export function satinLineOf(p: Pattern, o: SewObject): { known: Remembered; form: Form; st: PathStitch } | null {
  const known = remembered(p, o);
  const form = lineGeoOf(known);
  return known && form && known.line?.type === 'satin' ? { known, form, st: known.line } : null;
}

/** Satin line `o` (see satinLineOf) sewn anew with its own order `order`, or as it makes itself (none: Auto). */
export function sewLineOrder(p: Pattern, o: number, line: NonNullable<ReturnType<typeof satinLineOf>>, order: (LineOrder | null)[] | undefined, trimMm: number) {
  return resewLine(p, o, line.form, lineWithOrder(line.st, order), trimMm);
}

/** How a satin line is sewn with its own order `order` (none: Auto). */
export function lineWithOrder(st: PathStitch, order: (LineOrder | null)[] | undefined): PathStitch {
  const { order: _was, ...rest } = st;
  return order ? { ...rest, order } : rest;
}
