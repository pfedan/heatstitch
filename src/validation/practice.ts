import { fabricOf, type Profile } from './profiles';
import { CAUTION, densityLimits, type Thresholds } from './thresholds';
import type { PracticeNote, Zone } from './zones';

/**
 * What digitizers leave as it is. The thresholds describe large areas; a few places in every real
 * design go over them without causing trouble on the machine or the fabric:
 *
 * - Small spots: satin column ends, object joins and turning points concentrate thread on a few
 *   square millimetres. Up to 3 mm² at caution level, or a single critical cell, is normal.
 * - Satin joins: where two satin columns meet or cross, both run over the same patch. The patch is
 *   compact (about as long as the columns are wide), and the density is that of two satin layers.
 *   Two columns stacked along their length make a long zone instead and stay a finding.
 * - Short stitches on stable fabric: woven fabric and caps carry clusters of short stitches (small
 *   details, fill ends, tie-ins) without bird nests or holes; on knits, light fabrics and leather
 *   they stay a finding.
 *
 * Nothing is accepted where perforation is the reason.
 */

/** Small spots: caution up to this area (mm²), critical up to SMALL_CRITICAL_MM2. */
export const SMALL_CAUTION_MM2 = 3;
export const SMALL_CRITICAL_MM2 = 1;
/** Satin joins: mostly satin thread, compact, at most this area (mm², two 4 mm columns) ... */
const JOIN_SATIN = 0.5;
export const JOIN_MAX_MM2 = 16;
const JOIN_MAX_ASPECT = 2.5;
/** ... and at most this factor above the critical limit (more means a third layer). */
export const JOIN_MAX_EXCESS = 1.3;

/** Fabrics that carry short-stitch clusters without trouble. */
const STABLE = new Set(['woven', 'cap']);

export const stableFabric = (p: Profile): boolean => STABLE.has(fabricOf(p).id);

export function practiceNote(z: Zone, profile: Profile, th: Thresholds): PracticeNote | undefined {
  if (z.reasons.includes('perforation')) return undefined;
  if (z.level === CAUTION ? z.areaMm2 <= SMALL_CAUTION_MM2 : z.areaMm2 <= SMALL_CRITICAL_MM2) return 'smallSpot';
  if (z.reasons.length === 1 && z.reasons[0] === 'shortStitches' && stableFabric(profile)) return 'shortsStable';
  if (
    z.reasons.length === 1 &&
    z.reasons[0] === 'density' &&
    z.satinShare >= JOIN_SATIN &&
    z.areaMm2 <= JOIN_MAX_MM2 &&
    aspect(z) <= JOIN_MAX_ASPECT &&
    z.maxDensity <= densityLimits(th, z.satinShare)[1] * JOIN_MAX_EXCESS
  ) {
    return 'satinJoin';
  }
  return undefined;
}

const aspect = (z: Zone): number => {
  const w = z.bbox.maxX - z.bbox.minX;
  const h = z.bbox.maxY - z.bbox.minY;
  return Math.max(w, h) / Math.min(w, h);
};

/** How far the zone's peak density lies above the critical limit, as a share (0.08 = 8 %). */
export function densityExcess(z: Zone, th: Thresholds): number {
  return z.maxDensity / densityLimits(th, z.satinShare)[1] - 1;
}
