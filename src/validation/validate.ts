import type { Pattern } from '../model/pattern';
import { measurePattern, type Measurement } from './measure';
import type { Profile } from './profiles';
import {
  CAUTION,
  classifyDensity,
  classifyHoles,
  CRITICAL,
  SAFE,
  SHORT_STITCH_COUNT,
  thresholdsFor,
  type Level,
  type Thresholds,
} from './thresholds';
import { findZones, REASON_BITS, type Zone } from './zones';

/** Cells with at least this much thread count as stitched area (for the flagged share). */
const STITCHED_MM = 0.5;

export interface ValidationResult {
  profile: Profile;
  thresholds: Thresholds;
  /** The profile-independent measurement this result classifies. */
  measurement: Measurement;
  /** Level per cell (SAFE / CAUTION / CRITICAL). */
  level: Uint8Array;
  /** Reason bits per non-safe cell, see REASON_BITS. */
  reasons: Uint8Array;
  zones: Zone[];
  /** Highest level of any cell. */
  worst: Level;
  maxDensity: number;
  /** Cells carrying thread, and how many of them are Caution / Critical. */
  stitchedCells: number;
  cautionCells: number;
  criticalCells: number;
}

/** Applies a profile's thresholds to a measurement. Cheap, so it runs on the main thread. */
export function classify(m: Measurement, profile: Profile): ValidationResult {
  const th = thresholdsFor(profile);
  const n = m.cols * m.rows;
  const level = new Uint8Array(n);
  const reasons = new Uint8Array(n);
  let maxDensity = 0;
  let stitchedCells = 0;
  let cautionCells = 0;
  let criticalCells = 0;
  for (let i = 0; i < n; i++) {
    const d = m.density[i];
    if (d > maxDensity) maxDensity = d;
    if (d >= STITCHED_MM) stitchedCells++;
    const byDensity = classifyDensity(d, m.satin[i], th);
    const byHoles = classifyHoles(m.holes[i], th);
    const byShorts = m.shorts[i] >= SHORT_STITCH_COUNT ? CRITICAL : SAFE;
    const l = Math.max(byDensity, byHoles, byShorts) as Level;
    level[i] = l;
    if (l === SAFE) continue;
    if (l === CAUTION) cautionCells++;
    else criticalCells++;
    reasons[i] =
      (byDensity ? REASON_BITS.density : 0) |
      (byShorts ? REASON_BITS.shortStitches : 0) |
      (byHoles ? REASON_BITS.perforation : 0);
  }
  const zones = findZones({ ...m, level, reasons });
  return {
    profile,
    thresholds: th,
    measurement: m,
    level,
    reasons,
    zones,
    worst: criticalCells ? CRITICAL : cautionCells ? CAUTION : SAFE,
    maxDensity,
    stitchedCells,
    cautionCells,
    criticalCells,
  };
}

/** Measures and classifies in one go. */
export function validatePattern(p: Pattern, profile: Profile): ValidationResult {
  return classify(measurePattern(p), profile);
}

export { measurePattern, type Measurement } from './measure';
export { CAUTION, CRITICAL, SAFE, type Level, type Thresholds } from './thresholds';
export type { Reason, Zone } from './zones';
