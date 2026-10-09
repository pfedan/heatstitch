import { peakCell } from './measure';
import { sample, type Region } from './region';
import { cutParts, inside, partsOf, stripsOfParts, type Parts } from './rungs';
import { areaLoops } from './satinSuggest';
import type { Pt } from './skeleton';
import { bestChain, satinRuns, type Rails, type SatinSettings } from '../model/restitch';

/** Satin denser than this many times its nominal density somewhere piles up (2 / spacing is a column's own). */
export const SATIN_PEAK = 2.4;
/** Cut lines added at most to ease where a satin in sections piles up (see easePiles). */
const EASE_MAX = 3;
/** Directions a cut through a pile is tried in. */
const EASE_DIRECTIONS = 12;
/** Cells this near a cut line of the plan (mm) are where columns overlap on purpose. */
const SEAM_MM = 0.9;
/** Columns this near the pile (mm) are sewn again to measure a cut through it. */
const EASE_NEAR = 5;

/** Distance from q to the segment from a to b. */
function toSegment(q: Pt, a: Pt, b: Pt): number {
  const v: Pt = [b[0] - a[0], b[1] - a[1]];
  const l2 = v[0] * v[0] + v[1] * v[1];
  const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * v[0] + (q[1] - a[1]) * v[1]) / l2)) : 0;
  return Math.hypot(q[0] - a[0] - v[0] * t, q[1] - a[1] - v[1] * t);
}

/**
 * Where a satin in sections piles up (its stitches fanning in round a hole beside a wide place,
 * say), a cut line straight through the densest spot: each side then a column of its own, with
 * stitches that run more alike. Of the cuts tried, in several directions through the spot and
 * beside it, the one that eases it most; again while the spot piles up beyond `limit` (density,
 * see peakDensity; SATIN_PEAK times its own by default) and a cut helps. Cuts no longer than `max`
 * (mm). The plan as it was when none does. `runs`: the satin as sewn from the plan, when known.
 */
export function easePiles(area: Region, plan: { cuts: [Pt, Pt][]; lines: [Pt, Pt][] }, s: SatinSettings, max: number, limit = (SATIN_PEAK * 2) / s.spacing, runs?: Pt[][]): { cuts: [Pt, Pt][]; lines: [Pt, Pt][] } {
  const { outsides, holes } = areaLoops(area);
  const material = (q: Pt) => sample(area, area.sdfBase, q[0], q[1]) < 0;
  // Each outline cut into parts by the cut lines so far, once per round (see partsOf): a cut tried
  // cuts one of those parts further and leaves the rest, and their columns, as they were.
  const partsOfAll = (cuts: [Pt, Pt][]): Parts[] => outsides.map((o) => partsOf(o, cuts, holes.filter((h) => inside(o, h[0]))));
  const columnsOf = new Map<Parts, Rails[] | null>();
  const columns = (p: Parts, chain: number): Rails[] | null => {
    let c = columnsOf.get(p);
    if (c === undefined) {
      const made = stripsOfParts(p, plan.lines);
      c = made.bad >= 0 || made.hole >= 0 ? null : made.strips.map((x) => ({ ...x, chain }));
      columnsOf.set(p, c);
    }
    return c;
  };
  const sew = (base: Parts[], cut?: [Pt, Pt], near?: Pt): Pt[][] | null => {
    const all: Rails[] = [];
    for (let a = 0; a < base.length; a++) {
      const own = columns((cut && cutParts(base[a], cut)) || base[a], a);
      if (!own) return null;
      let chain = own;
      if (near) {
        // Near the spot, in the order the satin is sewn in (see sewSections): the measure it gets there.
        chain = chain.filter((c) => [...c.left, ...c.right].some((q) => Math.hypot(q[0] - near[0], q[1] - near[1]) < EASE_NEAR));
        if (chain.length > 1) chain = bestChain(chain, s);
      }
      all.push(...chain);
    }
    return satinRuns(all, s);
  };
  // Where columns meet at cut lines they overlap on purpose: not counted there (as when the satin
  // is checked), so the spot eased is one that piles up.
  const seam = (cuts: [Pt, Pt][]) => (x: number, y: number) => cuts.some(([a, b]) => toSegment([x, y], a, b) < SEAM_MM);
  let cuts = plan.cuts.slice();
  let base = partsOfAll(cuts);
  const all = runs ?? sew(base);
  if (!all) return plan;
  let peak = peakCell(all, seam(cuts));
  for (let n = 0; n < EASE_MAX && peak.density > limit; n++) {
    // Measured the same way with and without a cut: only the columns near the spot.
    const here = sew(base, undefined, peak.at);
    if (!here) break;
    const now = peakCell(here, seam(cuts));
    let best: { density: number; at: Pt; cut: [Pt, Pt] } | null = null;
    for (const [dx, dy] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
      const c: Pt = [peak.at[0] + dx, peak.at[1] + dy];
      if (!material(c)) continue;
      for (let k = 0; k < EASE_DIRECTIONS; k++) {
        const a = (k * Math.PI) / EASE_DIRECTIONS;
        const u: Pt = [Math.cos(a), Math.sin(a)];
        // From edge to edge through the spot, no longer than a satin stitch may be.
        const reach = (sign: number) => {
          let t = 0;
          while (t <= max && material([c[0] + u[0] * sign * t, c[1] + u[1] * sign * t])) t += 0.05;
          return t;
        };
        const ahead = reach(1);
        const back = reach(-1);
        if (ahead + back > max) continue;
        const cut: [Pt, Pt] = [
          [c[0] - u[0] * (back + 0.3), c[1] - u[1] * (back + 0.3)],
          [c[0] + u[0] * (ahead + 0.3), c[1] + u[1] * (ahead + 0.3)],
        ];
        const near = sew(base, cut, peak.at);
        if (!near) continue;
        const p = peakCell(near, seam([...cuts, cut]));
        if (!best || p.density < best.density) best = { ...p, cut };
      }
    }
    if (!best || best.density >= now.density) break;
    cuts = [...cuts, best.cut];
    base = partsOfAll(cuts);
    // Eased here; whether it piles up elsewhere now is for the satin's own check to tell.
    peak = best;
  }
  return cuts.length === plan.cuts.length ? plan : { cuts, lines: plan.lines };
}
