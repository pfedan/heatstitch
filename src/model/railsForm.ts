import type { Pt } from '../digitize/skeleton';
import { cumulative, pointAt, project } from '../digitize/rungs';
import { flatten, type Form, type Path } from '../shape/path';
import type { Pattern } from './pattern';
import type { SewObject } from './objects';
import { analyze, forget, keepShape, measureSatin, remember, remembered, restitch, type Rails, type RestitchResult } from './restitch';
import { traceLine } from './line';

/**
 * A satin of a file from elsewhere (or one whose rails are known, but no outline) on the level Form:
 * its rails as lines, two per column (left, right), to be dragged like any outline. The penetrations
 * follow the rails (see reshapeRails), so pairs, rungs and sections stay.
 */

/** Whether the object is satin only (no fill in it), not a lettering and not sewn along a line. */
function satinOnly(p: Pattern, o: SewObject, kinds: Uint8Array): boolean {
  const known = remembered(p, o);
  if (known?.path || known?.asLine || known?.lettering || known?.form) return false;
  const an = analyze(p, o, kinds, known);
  return an.parts.some((pt) => pt.kind === 'satin') && !an.parts.some((pt) => pt.kind === 'fill');
}

/** The rails of a satin object as lines with few nodes (left and right of each column), or null. */
export function railsForm(p: Pattern, o: SewObject, kinds: Uint8Array): Form | null {
  if (!satinOnly(p, o, kinds)) return null;
  const cols = keepShape(p, o, kinds).columns?.flat();
  if (!cols?.length) return null;
  const paths: Path[] = [];
  for (const c of cols) {
    for (const rail of [c.left, c.right]) {
      const line = rail.length >= 2 ? traceLine(rail) : null;
      if (!line) return null;
      paths.push(line.paths[0]);
    }
  }
  return { paths };
}

/** Moves points along one rail as its line was dragged from `from` to `to`. */
class RailMove {
  private a: Pt[];
  private b: Pt[];
  private ca: number[];
  private cb: number[];

  constructor(from: Path, to: Path) {
    this.a = flatten(from, 0.05);
    this.b = flatten(to, 0.05);
    this.ca = cumulative(this.a);
    this.cb = cumulative(this.b);
  }

  /** How far the point at share `f` (0 to 1) of the line's length moved. */
  shift(f: number): Pt {
    const pa = pointAt(this.a, this.ca, f * this.ca[this.ca.length - 1]);
    const pb = pointAt(this.b, this.cb, f * this.cb[this.cb.length - 1]);
    return [pb[0] - pa[0], pb[1] - pa[1]];
  }
}

/** Each point of the rail moved with the share of the rail's length it lies at. */
function moveRail(rail: Pt[], m: RailMove): Pt[] {
  const c = cumulative(rail);
  const len = c[c.length - 1];
  return rail.map((q, i) => {
    const [dx, dy] = m.shift(len > 0 ? c[i] / len : 0);
    return [q[0] + dx, q[1] + dy];
  });
}

/** A point lying across the column (a rung drawn anywhere) moved with the nearer of its rails. */
function moveSpanPoint(q: Pt, c: Rails, ml: RailMove, mr: RailMove): Pt {
  const near = ([c.left, c.right] as const).map((rail, k) => {
    const cum = cumulative(rail);
    const len = cum[cum.length - 1];
    const at = project(rail, cum, q);
    return { d: at.d, f: len > 0 ? at.s / len : 0, m: k ? mr : ml };
  });
  const best = near[0].d <= near[1].d ? near[0] : near[1];
  const [dx, dy] = best.m.shift(best.f);
  return [q[0] + dx, q[1] + dy];
}

const lengthOf = (rail: Pt[]) => {
  const c = cumulative(rail);
  return c[c.length - 1];
};

/**
 * The rails of satin `o` after its lines were changed to `form` (as railsForm gave them, nodes
 * moved, put in or taken out): every penetration keeps its share of its rail's length, distances
 * along the rails (rungs, cuts, spacings) grow and shrink with the rail.
 */
export function movedRails(cols: Rails[][], from: Form, to: Form): Rails[][] | null {
  const n = cols.reduce((a, part) => a + part.length, 0);
  if (from.paths.length !== 2 * n || to.paths.length !== 2 * n) return null;
  let k = 0;
  return cols.map((part) =>
    part.map((c) => {
      const ml = new RailMove(from.paths[2 * k], to.paths[2 * k]);
      const mr = new RailMove(from.paths[2 * k + 1], to.paths[2 * k + 1]);
      k++;
      const left = moveRail(c.left, ml);
      const right = moveRail(c.right, mr);
      const sl = lengthOf(c.left) > 0 ? lengthOf(left) / lengthOf(c.left) : 1;
      const sr = lengthOf(c.right) > 0 ? lengthOf(right) / lengthOf(c.right) : 1;
      return {
        ...c,
        left,
        right,
        ...(c.rungs ? { rungs: c.rungs.map(([a, b]) => [a * sl, b * sr] as [number, number]) } : {}),
        ...(c.cuts ? { cuts: c.cuts.map(([a, b]) => [a * sl, b * sr] as [number, number]) } : {}),
        ...(c.spacings ? { spacings: c.spacings.map(([a, v]) => [a * sl, v] as [number, number]) } : {}),
        ...(c.spans ? { spans: c.spans.map(([a, b]) => [moveSpanPoint(a, c, ml, mr), moveSpanPoint(b, c, ml, mr)] as [Pt, Pt]) } : {}),
      };
    }),
  );
}

/** New stitches for satin `o` along its rails changed to `form`, with its own satin settings; null when they do not fit. */
export function reshapeRails(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, form: Form, trimMm: number): RestitchResult | null {
  const from = railsForm(p, o, kinds);
  const shape = keepShape(p, o, kinds);
  const columns = from && shape.columns && movedRails(shape.columns, from, form);
  if (!columns) return null;
  // The new rails only for this restitch: the old stitches keep what they knew (undo brings it back).
  const before = remembered(p, o);
  remember(p, o, { ...shape, columns, read: false });
  const r = restitch(
    p,
    objs,
    [o.index],
    (_o, an, known) => {
      const part = an.parts.find((pt) => pt.kind === 'satin');
      return part ? { kind: 'satin', s: known?.satin ?? measureSatin(p, part, kinds) } : null;
    },
    kinds,
    trimMm,
  );
  forget(p, o, before);
  return r;
}
