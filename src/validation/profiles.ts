/**
 * Material profiles. The density thresholds are calibrated for 40 wt thread on a stable woven
 * fabric; other fabrics and thread weights scale them by the ratio of their recommended stitch
 * spacing to the 0.40 mm reference (thinner thread or sturdier fabric tolerates more thread).
 *
 * Fabric spacing ranges: common digitizing guides (twill/canvas 0.40 to 0.45 mm, caps 0.40 to
 * 0.50, piqué/jersey 0.42 to 0.50, terry 0.55 to 0.70, silk and light fabrics 0.60 to 0.70,
 * leather/vinyl 0.50 to 0.80). Thread factors: Madeira spacing table (60 wt 0.35, 40 wt 0.40,
 * 30 wt 0.50, 12 wt 0.80 mm).
 */

export type FabricId = 'woven' | 'cap' | 'knit' | 'terry' | 'light' | 'leather';
export type ThreadId = '60' | '40' | '30' | '12';

export interface Fabric {
  id: FabricId;
  /** Multiplier for the density thresholds. */
  factor: number;
  /** Recommended fill row / satin spacing in mm for 40 wt thread. */
  spacing: [number, number];
  /** Needle holes can cut the material, so dense penetrations are checked as well. */
  perforation: boolean;
}

export interface Thread {
  id: ThreadId;
  factor: number;
}

export const FABRICS: readonly Fabric[] = [
  { id: 'woven', factor: 1, spacing: [0.4, 0.45], perforation: false },
  { id: 'cap', factor: 0.9, spacing: [0.4, 0.5], perforation: false },
  { id: 'knit', factor: 0.85, spacing: [0.42, 0.5], perforation: false },
  { id: 'terry', factor: 0.65, spacing: [0.55, 0.7], perforation: false },
  { id: 'light', factor: 0.6, spacing: [0.6, 0.7], perforation: false },
  { id: 'leather', factor: 0.7, spacing: [0.5, 0.8], perforation: true },
];

export const THREADS: readonly Thread[] = [
  { id: '60', factor: 1.15 },
  { id: '40', factor: 1 },
  { id: '30', factor: 0.8 },
  { id: '12', factor: 0.5 },
];

export interface Profile {
  fabric: FabricId;
  thread: ThreadId;
}

export const DEFAULT_PROFILE: Profile = { fabric: 'woven', thread: '40' };

export const fabricOf = (p: Profile): Fabric => FABRICS.find((f) => f.id === p.fabric) ?? FABRICS[0];
export const threadOf = (p: Profile): Thread => THREADS.find((t) => t.id === p.thread) ?? THREADS[1];

/** Returns a valid profile, falling back to the defaults for unknown ids. */
export function normalizeProfile(p: Partial<Profile> | undefined): Profile {
  return {
    fabric: FABRICS.some((f) => f.id === p?.fabric) ? p!.fabric! : DEFAULT_PROFILE.fabric,
    thread: THREADS.some((t) => t.id === p?.thread) ? p!.thread! : DEFAULT_PROFILE.thread,
  };
}

/**
 * Visual thread width in mm for the profile's thread weight: 0.4 mm for 40 wt, scaled like the
 * recommended stitch spacing (60 wt 0.35, 30 wt 0.5, 12 wt 0.8 mm). Default for the width slider.
 */
export function threadWidthMm(p: Profile): number {
  return 0.4 / threadOf(p).factor;
}

/** Recommended spacing range in mm for the profile (thicker thread needs wider spacing). */
export function recommendedSpacing(p: Profile): [number, number] {
  const k = threadOf(p).factor;
  const [a, b] = fabricOf(p).spacing;
  return [a / k, b / k];
}
