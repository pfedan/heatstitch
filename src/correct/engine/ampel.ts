import type { Pattern } from '../../model/pattern';
import { settledBy } from '../../validation/acks';
import type { Profile } from '../../validation/profiles';
import type { ValidationResult } from '../../validation/validate';
import type { Zone } from '../../validation/zones';
import { prepareFix, type PlannedFix } from './apply';
import { ampelOf, CAUTION_KINDS, countingCells, FIX_KINDS, KIND_REASONS, openFor, type AmpelColor, type FixKind } from './cells';
import type { FixOptions } from './solve';
import { validateDesign } from './validate';

/**
 * What the Ampel "Klappt das?" shows for one fabric (plans/korrektur-engine-review.md, "Schnittstelle
 * zur Ampel"): the color with the worst spot, the reasons by kind with their area and worst spot,
 * and per kind a direct fix and a proposal for the rest, all worked out ahead and checked. A fix is
 * offered only when it really clears something.
 */

export interface KindReport {
  kind: FixKind;
  /** Open area (mm²): critical cells, or caution cells for the kinds that are never critical. */
  areaMm2: number;
  /** The worst spot of this kind. */
  worst: Zone | null;
  /** Invisible and barely visible changes, applied with one click. Null when it clears nothing. */
  direct: PlannedFix | null;
  /** Visible changes and sewing objects changed by hand anew: a proposal with a preview. Null when it clears no more than the direct fix. */
  rest: PlannedFix | null;
}

export interface AmpelReport {
  color: AmpelColor;
  worst: Zone | null;
  /** Kinds with open area, the largest first. */
  kinds: KindReport[];
  /** All kinds together, directly ("Alles beheben"). Null when it clears nothing. */
  all: PlannedFix | null;
  validation: ValidationResult;
  ms: number;
}

export interface AssessOptions extends Omit<FixOptions, 'visible' | 'hand' | 'log'> {
  /** Called as each part is ready (density first), so buttons can appear one by one. */
  progress?: (r: AmpelReport) => void;
}

/** Works out the Ampel and all its fixes for design `p` on `profile`. Changes nothing. */
export async function assess(p: Pattern, profile: Profile, opt: AssessOptions): Promise<AmpelReport> {
  const t0 = performance.now();
  const v = validateDesign(p, profile, opt.checks);
  const counting = countingCells(v, opt.acks);
  const cell = v.measurement.cellMm * v.measurement.cellMm;
  const { color, worst } = ampelOf(v, opt.acks);
  const kinds: KindReport[] = [];
  for (const kind of FIX_KINDS) {
    let n = 0;
    for (let i = 0; i < v.level.length; i++) if (openFor(v, counting, i, kind)) n++;
    if (!n) continue;
    const reasons = KIND_REASONS[kind];
    const zones = v.zones.filter((z) => !settledBy(z, opt.acks) && z.reasons.some((r) => reasons.includes(r)));
    const zw = zones.reduce<Zone | null>((a, z) => (!a || z.level > a.level || (z.level === a.level && z.areaMm2 > a.areaMm2) ? z : a), null);
    kinds.push({ kind, areaMm2: n * cell, worst: zw, direct: null, rest: null });
  }
  // Density first (it matters most), then the critical kinds, then the caution ones.
  kinds.sort((a, b) => +(a.kind !== 'density') - +(b.kind !== 'density') || +CAUTION_KINDS.has(a.kind) - +CAUTION_KINDS.has(b.kind) || b.areaMm2 - a.areaMm2);
  const report: AmpelReport = { color, worst, kinds, all: null, validation: v, ms: 0 };
  const useful = (f: PlannedFix) => f.after < f.before && f.objects.length > 0;
  const base = { ...opt, progress: undefined };
  for (const k of kinds) {
    if (opt.stale?.()) break;
    const direct = await prepareFix(p, profile, k.kind, base);
    k.direct = useful(direct) ? direct : null;
    opt.progress?.(report);
    if (opt.stale?.()) break;
    const rest = await prepareFix(p, profile, k.kind, { ...base, visible: true, hand: true });
    k.rest = useful(rest) && rest.after < direct.after ? rest : null;
    opt.progress?.(report);
  }
  if (kinds.length > 1 && !opt.stale?.()) {
    const all = await prepareFix(p, profile, 'all', base);
    report.all = useful(all) ? all : null;
  }
  // The Ampel lists kinds by what is open, the largest first.
  kinds.sort((a, b) => b.areaMm2 - a.areaMm2);
  report.ms = performance.now() - t0;
  opt.progress?.(report);
  return report;
}
