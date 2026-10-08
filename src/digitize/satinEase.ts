import { peakCell } from './measure';
import { sample, type Region } from './region';
import { stripsOfAreas } from './rungs';
import { areaLoops } from './satinSuggest';
import type { Pt } from './skeleton';
import { satinRuns, type Rails, type SatinSettings } from '../model/restitch';

/** Satin denser than this many times its nominal density somewhere piles up (2 / spacing is a column's own). */
export const SATIN_PEAK = 2.4;
/** Cut lines added at most to ease where a satin in sections piles up (see easePiles). */
const EASE_MAX = 3;
/** Directions a cut through a pile is tried in. */
const EASE_DIRECTIONS = 12;
/** Columns this near the pile (mm) are sewn again to measure a cut through it. */
const EASE_NEAR = 5;

/**
 * Where a satin in sections piles up (its stitches fanning in round a hole beside a wide place,
 * say), a cut line straight through the densest spot: each side then a column of its own, with
 * stitches that run more alike. Of the cuts tried, in several directions through the spot and
 * beside it, the one that eases it most; again while the satin piles up beyond `limit` (density,
 * see peakDensity; SATIN_PEAK times its own by default) and a cut helps. Cuts no longer than `max`
 * (mm). The plan as it was when none does.
 */
export function easePiles(area: Region, plan: { cuts: [Pt, Pt][]; lines: [Pt, Pt][] }, s: SatinSettings, max: number, limit = (SATIN_PEAK * 2) / s.spacing): { cuts: [Pt, Pt][]; lines: [Pt, Pt][] } {
  const { outsides, holes } = areaLoops(area);
  const material = (q: Pt) => sample(area, area.sdfBase, q[0], q[1]) < 0;
  const sew = (cuts: [Pt, Pt][], near?: Pt): Pt[][] | null => {
    const made = stripsOfAreas(outsides, plan.lines, cuts, holes);
    if (made.bad || made.hole >= 0) return null;
    let columns: Rails[] = made.areas.flatMap((strips, a) => strips.map((x) => ({ ...x, chain: a })));
    if (near) columns = columns.filter((c) => [...c.left, ...c.right].some((q) => Math.hypot(q[0] - near[0], q[1] - near[1]) < EASE_NEAR));
    return satinRuns(columns, s);
  };
  let cuts = plan.cuts.slice();
  const runs = sew(cuts);
  if (!runs) return plan;
  let peak = peakCell(runs);
  for (let n = 0; n < EASE_MAX && peak.density > limit; n++) {
    let best: { density: number; cut: [Pt, Pt] } | null = null;
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
        const near = sew([...cuts, cut], peak.at);
        if (!near) continue;
        const density = peakCell(near).density;
        if (!best || density < best.density) best = { density, cut };
      }
    }
    if (!best || best.density >= peak.density) break;
    const next = sew([...cuts, best.cut]);
    if (!next) break;
    const now = peakCell(next);
    // Eased here, but piling up as much elsewhere: kept, the next round takes that spot.
    if (now.density > peak.density) break;
    cuts = [...cuts, best.cut];
    peak = now;
  }
  return cuts.length === plan.cuts.length ? plan : { cuts, lines: plan.lines };
}
