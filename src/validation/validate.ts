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
import { practiceNote, stableFabric } from './practice';
import { findZones, REASON_BITS, type Zone } from './zones';

/** Cells with at least this much thread count as stitched area (for the flagged share). */
const STITCHED_MM = 0.5;

/** Which rules take part in the classification. Measurements are always taken. */
export interface Checks {
  density: boolean;
  shortStitches: boolean;
  /** Only applies to perforation-sensitive fabrics. */
  perforation: boolean;
}

export const ALL_CHECKS: Readonly<Checks> = { density: true, shortStitches: true, perforation: true };

/** Returns a valid set of checks, falling back to enabled for missing entries. */
export function normalizeChecks(c: Partial<Checks> | undefined): Checks {
  return {
    density: c?.density !== false,
    shortStitches: c?.shortStitches !== false,
    perforation: c?.perforation !== false,
  };
}

export interface ValidationResult {
  profile: Profile;
  checks: Checks;
  thresholds: Thresholds;
  /** The profile-independent measurement this result classifies. */
  measurement: Measurement;
  /** Level per cell (SAFE / CAUTION / CRITICAL). */
  level: Uint8Array;
  /** Reason bits per non-safe cell, see REASON_BITS. */
  reasons: Uint8Array;
  zones: Zone[];
  /** Index into `zones` per cell, -1 for safe cells. */
  zoneOf: Int32Array;
  /** Highest level of any cell. */
  worst: Level;
  maxDensity: number;
  /** Cells carrying thread, and how many of them are Caution / Critical. */
  stitchedCells: number;
  cautionCells: number;
  criticalCells: number;
}

/**
 * Applies a profile's thresholds and the enabled checks to a measurement. Cheap, so it runs on
 * the main thread.
 */
export function classify(m: Measurement, profile: Profile, checks: Checks = ALL_CHECKS): ValidationResult {
  const th = thresholdsFor(profile);
  const n = m.cols * m.rows;
  const level = new Uint8Array(n);
  const reasons = new Uint8Array(n);
  let maxDensity = 0;
  let stitchedCells = 0;
  let cautionCells = 0;
  let criticalCells = 0;
  // Short-stitch clusters are a caution on stable fabric, where they rarely cause trouble.
  const shortsLevel = stableFabric(profile) ? CAUTION : CRITICAL;
  for (let i = 0; i < n; i++) {
    const d = m.density[i];
    if (d > maxDensity) maxDensity = d;
    if (d >= STITCHED_MM) stitchedCells++;
    const byDensity = checks.density ? classifyDensity(d, m.satin[i], th) : SAFE;
    const byHoles = checks.perforation ? classifyHoles(m.holes[i], th) : SAFE;
    const byShorts = checks.shortStitches && m.shorts[i] >= SHORT_STITCH_COUNT ? shortsLevel : SAFE;
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
  const zoneOf = new Int32Array(n);
  const zones = findZones({ ...m, level, reasons }, zoneOf);
  for (const z of zones) z.practice = practiceNote(z, profile, th);
  return {
    profile,
    checks: { ...checks },
    thresholds: th,
    measurement: m,
    level,
    reasons,
    zones,
    zoneOf,
    worst: criticalCells ? CRITICAL : cautionCells ? CAUTION : SAFE,
    maxDensity,
    stitchedCells,
    cautionCells,
    criticalCells,
  };
}

/** Measures and classifies in one go. */
export function validatePattern(p: Pattern, profile: Profile, checks: Checks = ALL_CHECKS): ValidationResult {
  return classify(measurePattern(p), profile, checks);
}

export { measurePattern, type Measurement } from './measure';
export { CAUTION, CRITICAL, SAFE, type Level, type Thresholds } from './thresholds';
export type { Reason, Zone } from './zones';
