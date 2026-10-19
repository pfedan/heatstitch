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
  /**
   * Values measured on the user's own fabric with a test swatch (see model/swatch.ts), in place of
   * the fabric's. A design keeps a copy with its material (taken from this browser's measured values
   * when it is made or its fabric changes, see withOwn in settings.ts), so it is digitized, checked
   * and tuned the same everywhere. None: the fabric's values.
   */
  own?: OwnValues;
}

/** Spacing (mm) and pull compensation (the fabric's pullMm) picked from a test swatch. */
export interface Own {
  spacing: number;
  pull: number;
}

/** What a test swatch measured, for fills and for satin. */
export interface OwnValues {
  fill?: Own;
  satin?: Own;
}

/** Sensible bounds for measured values: anything outside is not kept. */
const OWN_SPACING: [number, number] = [0.2, 1.5];
const OWN_PULL: [number, number] = [0, 2];

const ownOk = (v: unknown): v is Own => {
  const o = v as Own;
  return !!o && typeof o.spacing === 'number' && typeof o.pull === 'number' && o.spacing >= OWN_SPACING[0] && o.spacing <= OWN_SPACING[1] && o.pull >= OWN_PULL[0] && o.pull <= OWN_PULL[1];
};

/** Valid measured values from anything stored, or undefined when nothing valid is left. */
export function normalizeOwn(v: unknown): OwnValues | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { fill, satin } = v as OwnValues;
  const out: OwnValues = {};
  if (ownOk(fill)) out.fill = { spacing: fill.spacing, pull: fill.pull };
  if (ownOk(satin)) out.satin = { spacing: satin.spacing, pull: satin.pull };
  return out.fill || out.satin ? out : undefined;
}

/** Key of a fabric and thread in the store of measured values. */
export const ownKey = (p: Profile): string => `${p.fabric}/${p.thread}`;

export const DEFAULT_PROFILE: Profile = { fabric: 'woven', thread: '40' };

export const fabricOf = (p: Profile): Fabric => FABRIC[p.fabric] ?? FABRIC.woven;
export const threadOf = (p: Profile): Thread => THREAD[p.thread] ?? THREAD['40'];

/**
 * Returns a valid profile, falling back to the defaults for unknown ids. FABRICS only grows, so
 * every older project keeps its fabric.
 */
export function normalizeProfile(p: Partial<Profile> | undefined): Profile {
  const own = normalizeOwn(p?.own);
  return {
    fabric: Object.hasOwn(FABRIC, p?.fabric ?? '') ? p!.fabric! : DEFAULT_PROFILE.fabric,
    thread: Object.hasOwn(THREAD, p?.thread ?? '') ? p!.thread! : DEFAULT_PROFILE.thread,
    ...(own ? { own } : {}),
  };
}

/**
 * Visual thread width in mm for the profile's thread weight: 0.4 mm for 40 wt, scaled like the
 * recommended stitch spacing (60 wt 0.35, 30 wt 0.5, 12 wt 0.8 mm). Default for the width slider.
 */
export function threadWidthMm(p: Profile): number {
  return 0.4 / threadOf(p).factor;
}

/** The fabric's spacing range for the profile's thread, without measured values (thicker thread needs wider spacing). */
export function fabricSpacing(p: Profile): [number, number] {
  const k = threadOf(p).factor;
  const [a, b] = fabricOf(p).spacing;
  return [a / k, b / k];
}

/**
 * Recommended spacing range in mm for the profile. A spacing measured with a fill test swatch
 * becomes its lower end (the default), the range keeping the fabric's width ratio.
 */
export function recommendedSpacing(p: Profile): [number, number] {
  const [a, b] = fabricSpacing(p);
  const own = p.own?.fill?.spacing;
  return own ? [own, (own * b) / a] : [a, b];
}

/** Pull compensation of the fabric (pullMm) for fills or satin: measured, else the fabric's. */
export const fabricPull = (p: Profile, kind: 'fill' | 'satin'): number => p.own?.[kind]?.pull ?? fabricOf(p).pullMm;

/**
 * Satin spacing for the profile: measured with a satin test swatch, else the lower end of the
 * fabric's range. A fill swatch does not set it: satin and fill cover differently.
 */
export const satinSpacing = (p: Profile): number => p.own?.satin?.spacing ?? fabricSpacing(p)[0];
