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

/** The Ampel without its fixes: color, worst spot, kinds with their area. Fast (one validation). */
export function ampelReport(p: Pattern, profile: Profile, opt: Pick<AssessOptions, 'checks' | 'acks'>): AmpelReport {
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
  // The Ampel lists kinds by what is open, the largest first.
  kinds.sort((a, b) => b.areaMm2 - a.areaMm2);
  return { color, worst, kinds, all: null, validation: v, ms: 0 };
}

/**
 * Order the fixes are worked out in: density first (it matters most), then the critical kinds,
 * then the caution ones.
 */
export function planOrder(kinds: FixKind[]): FixKind[] {
  return [...kinds].sort((a, b) => +(a !== 'density') - +(b !== 'density') || +CAUTION_KINDS.has(a) - +CAUTION_KINDS.has(b));
}

const useful = (f: PlannedFix) => f.after < f.before && f.objects.length > 0;

/** The direct fix of one kind: invisible and barely visible changes. Null when it clears nothing. */
export async function directFix(p: Pattern, profile: Profile, kind: FixKind, opt: FixOptions): Promise<PlannedFix | null> {
  const f = await prepareFix(p, profile, kind, { ...opt, visible: false, hand: false });
  return useful(f) ? f : null;
}

/** The proposal for the rest of one kind: visible changes too, objects changed by hand sewn anew. */
export async function restFix(p: Pattern, profile: Profile, kind: FixKind, opt: FixOptions): Promise<PlannedFix | null> {
  const f = await prepareFix(p, profile, kind, { ...opt, visible: true, hand: true });
  return useful(f) ? f : null;
}

/** The rest proposal is shown only when it clears more than the direct fix. */
export const restWorth = (direct: PlannedFix | null, rest: PlannedFix | null): PlannedFix | null => (rest && (!direct || rest.after < direct.after) ? rest : null);

/** The direct fix and the rest proposal of one kind (null where they clear nothing). */
export async function kindFixes(p: Pattern, profile: Profile, kind: FixKind, opt: FixOptions): Promise<{ direct: PlannedFix | null; rest: PlannedFix | null }> {
  const direct = await directFix(p, profile, kind, opt);
  if (opt.stale?.()) return { direct, rest: null };
  return { direct, rest: restWorth(direct, await restFix(p, profile, kind, opt)) };
}

/** "Alles beheben": all kinds together, directly. */
export async function allFix(p: Pattern, profile: Profile, opt: FixOptions): Promise<PlannedFix | null> {
  const all = await prepareFix(p, profile, 'all', { ...opt, visible: false, hand: false });
  return useful(all) ? all : null;
}

/** Works out the Ampel and all its fixes for design `p` on `profile`, one after the other. Changes nothing. */
export async function assess(p: Pattern, profile: Profile, opt: AssessOptions): Promise<AmpelReport> {
  const t0 = performance.now();
  const report = ampelReport(p, profile, opt);
  const base = { ...opt, progress: undefined };
  for (const kind of planOrder(report.kinds.map((k) => k.kind))) {
    if (opt.stale?.()) break;
    Object.assign(report.kinds.find((k) => k.kind === kind)!, await kindFixes(p, profile, kind, base));
    opt.progress?.(report);
  }
  if (report.kinds.length > 1 && !opt.stale?.()) report.all = await allFix(p, profile, base);
  report.ms = performance.now() - t0;
  opt.progress?.(report);
  return report;
}
