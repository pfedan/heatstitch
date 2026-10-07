import { fabricOf, recommendedSpacing, threadOf, type Profile } from './profiles';

export const SAFE = 0;
export const CAUTION = 1;
export const CRITICAL = 2;
export type Level = typeof SAFE | typeof CAUTION | typeof CRITICAL;

/**
 * Reference thresholds for 40 wt thread on stable woven fabric, in thread length per area
 * (mm/mm²). One fill layer at 0.4 mm row spacing is 2.5 mm/mm², a satin at 0.4 mm spacing
 * (between penetrations on the same side) is 5.0 mm/mm².
 *
 * Calibrated on professional files and lettering (study 2026-10-06, project files
 * analysis/kritisch-schwellen.md): a satin column over one fill, both with underlay, reaches 10 to
 * 15 and is normal digitizing practice ("a single layer of satin stitches over a fully filled area
 * is rarely problematic", E. Campbell). Embrilliance's density map (US 6,732,008) turns red at six
 * layers. The limits sit between layer counts, so neither grid position nor smoothing decides the
 * level. Measured peaks: two full fills with underlay up to 6.4, three fills 7.4 to 7.6, four fills
 * 9.9 to 10.2, five fills from 12.4.
 */
export const BASE = {
  /** Four stacked fill layers. */
  caution: 9.5,
  /** Five full fill layers, one below Embrilliance's red. */
  critical: 12,
  /**
   * Limits for pure satin. Satin floats on top and only penetrates at its edges, so it counts as one
   * top layer: satin over a fill with both underlays stays below Critical. Cells with mixed thread
   * interpolate by their satin share.
   */
  satinCaution: 15,
  satinCritical: 17.5,
} as const;

/**
 * Perforation (leather, vinyl): neighbouring penetrations within 1 mm of a penetration. A row of
 * holes at spacing p has 2 * floor(1 / p): 4 for a satin or fill edge at 0.35 to 0.5 mm, 6 at
 * 0.33 mm, 10 at 0.2 mm. Stacked edges and tight inner curves add up the same way.
 */
export const HOLES_CAUTION = 6;
export const HOLES_CRITICAL = 9;

/** Stitches shorter than this (mm) count towards the short-stitch cluster rule. */
export const SHORT_STITCH_MM = 1.0;
/** This many non-exempt short stitches in one 1 mm cell make it Critical. */
export const SHORT_STITCH_COUNT = 8;

/**
 * Fabric shows through where a single layer is clearly more open than the material's recommended
 * spacing: a fill at spacing s has about 1 / s mm of thread per mm², a satin 2 / s. A cell well
 * inside stitched area below this share of that, at the widest recommended spacing, is Caution.
 */
export const SPARSE_SHARE = 1 / 1.15;
/** Gap pixels (0.01 mm² each) in a 1 mm cell from which it counts as a gap. */
export const GAP_PIXELS = 6;

export interface Thresholds {
  /** Combined fabric x thread factor applied to the density limits. */
  factor: number;
  caution: number;
  critical: number;
  satinCaution: number;
  satinCritical: number;
  /** Neighbour-count limits, or null when the material is not perforation-sensitive. */
  holes: { caution: number; critical: number } | null;
  /** Lowest mean density of one fill layer inside stitched area (mm/mm²), satin twice that. */
  sparse: number;
  /** Which gap measurement applies: pull on stable or on stretchy fabric. */
  pull: 'low' | 'high';
  /** Longest stitch without snagging (0.1 mm). */
  long: number;
}

/** Density limits scale with the fabric and thread factors; perforation limits are geometric. */
export function thresholdsFor(p: Profile): Thresholds {
  const fabric = fabricOf(p);
  const k = fabric.factor * threadOf(p).factor;
  return {
    factor: k,
    caution: BASE.caution * k,
    critical: BASE.critical * k,
    satinCaution: BASE.satinCaution * k,
    satinCritical: BASE.satinCritical * k,
    holes: fabric.perforation ? { caution: HOLES_CAUTION, critical: HOLES_CRITICAL } : null,
    sparse: SPARSE_SHARE / recommendedSpacing(p)[1],
    pull: fabric.pull,
    long: fabric.longMm * 10,
  };
}

/** Caution and Critical limits for a cell whose thread is `satinShare` (0 to 1) satin. */
export function densityLimits(th: Thresholds, satinShare: number): [number, number] {
  const s = Math.min(1, Math.max(0, satinShare));
  return [th.caution + s * (th.satinCaution - th.caution), th.critical + s * (th.satinCritical - th.critical)];
}

export function classifyDensity(density: number, satinShare: number, th: Thresholds): Level {
  const [caution, critical] = densityLimits(th, satinShare);
  if (density >= critical) return CRITICAL;
  if (density >= caution) return CAUTION;
  return SAFE;
}

export function classifyHoles(neighbours: number, th: Thresholds): Level {
  if (!th.holes) return SAFE;
  if (neighbours >= th.holes.critical) return CRITICAL;
  if (neighbours >= th.holes.caution) return CAUTION;
  return SAFE;
}

/** Lowest mean density for a cell whose thread is `satinShare` satin. */
export const sparseLimit = (th: Thresholds, satinShare: number): number => th.sparse * (1 + Math.min(1, Math.max(0, satinShare)));
