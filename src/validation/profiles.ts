/**
 * Material profiles: the fabric and thread weight a design is made for. The density thresholds are
 * calibrated for 40 wt thread on a stable woven fabric; other fabrics and thread weights scale them
 * by the ratio of their recommended stitch spacing to the 0.40 mm reference (thinner thread or
 * sturdier fabric tolerates more thread). The values themselves live in src/material.
 */

import { FABRIC, type Fabric, type FabricId } from '../material/fabrics';
import { THREAD, type Thread, type ThreadId } from '../material/threads';

export { FABRIC, FABRICS, type Fabric, type FabricId } from '../material/fabrics';
export { THREAD, THREADS, type Thread, type ThreadId } from '../material/threads';

export interface Profile {
  fabric: FabricId;
  thread: ThreadId;
}

export const DEFAULT_PROFILE: Profile = { fabric: 'woven', thread: '40' };

export const fabricOf = (p: Profile): Fabric => FABRIC[p.fabric] ?? FABRIC.woven;
export const threadOf = (p: Profile): Thread => THREAD[p.thread] ?? THREAD['40'];

/**
 * Returns a valid profile, falling back to the defaults for unknown ids. FABRICS only grows, so
 * every older project keeps its fabric.
 */
export function normalizeProfile(p: Partial<Profile> | undefined): Profile {
  return {
    fabric: Object.hasOwn(FABRIC, p?.fabric ?? '') ? p!.fabric! : DEFAULT_PROFILE.fabric,
    thread: Object.hasOwn(THREAD, p?.thread ?? '') ? p!.thread! : DEFAULT_PROFILE.thread,
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
