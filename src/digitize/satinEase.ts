import { flatLines } from '../shape/cdt';
import { core } from '../wasm/core';
import type { Region } from './region';
import type { Cut } from './rungs';
import { flatPts } from './satin';
import type { Pt } from './skeleton';
import type { SatinSettings } from '../model/restitch';

/** Satin denser than this many times its nominal density somewhere piles up (2 / spacing is a column's own). */
export const SATIN_PEAK = 2.4;

/**
 * Where a satin in sections piles up (its stitches fanning in round a hole beside a wide place,
 * say), a cut line straight through the densest spot: each side then a column of its own, with
 * stitches that run more alike. Of the cuts tried, in several directions through the spot and
 * beside it, the one that eases it most; again while the spot piles up beyond `limit` (density,
 * see peakDensity; SATIN_PEAK times its own by default) and a cut helps. Cuts no longer than `max`
 * (mm). The plan as it was when none does. `runs`: the satin as sewn from the plan, when known.
 *
 * Done by the core (core/src/digitize/satin_ease.rs), a whole plan per call.
 */
export function easePiles<C extends Cut>(area: Region, plan: { cuts: C[]; lines: [Pt, Pt][] }, s: SatinSettings, max: number, limit = (SATIN_PEAK * 2) / s.spacing, runs?: Pt[][]): { cuts: (C | [Pt, Pt])[]; lines: [Pt, Pt][] } {
  const c = flatLines(plan.cuts);
  const r = runs && flatLines(runs);
  const added = core().easePiles(area.sdfBase, area.x0, area.y0, area.w, area.h, area.pxMm, c.flat, c.lens, flatPts(plan.lines.flat()), s, max, limit, r?.flat, r?.lens);
  if (!added.length) return plan;
  const more: [Pt, Pt][] = [];
  for (let i = 0; i + 3 < added.length; i += 4) more.push([[added[i], added[i + 1]], [added[i + 2], added[i + 3]]]);
  return { cuts: [...plan.cuts, ...more], lines: plan.lines };
}
