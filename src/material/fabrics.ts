/**
 * Every value that depends on the fabric, in one record per fabric. Validation, stitch defaults,
 * the Ampel and the ready-to-stitch card read from here; a new fabric that misses a value does not
 * compile (concept: plans/voreinstellungen.md in the project files).
 *
 * Spacing ranges: common digitizing guides, checked against Wilcom's auto fabrics and Impressions
 * (plans/voreinstellungen-recherche.md in the project files). Pull compensation: Wilcom's table, more for stretchy and pile fabrics. Texts,
 * stabilizers, needles and their sources: src/areas/ready/recipes.ts.
 */

export type FabricId = 'woven' | 'woven_heavy' | 'cap' | 'knit' | 'fleece' | 'terry' | 'light' | 'sheer' | 'leather';

export interface Fabric {
  id: FabricId;
  /** Multiplier for the density thresholds. */
  factor: number;
  /** Recommended fill row / satin spacing in mm for 40 wt thread. */
  spacing: [number, number];
  /** Needle holes can cut the material, so dense penetrations are checked as well. */
  perforation: boolean;
  /** How far the thread pulls the fabric in: little on stable fabric, more on stretchy or soft fabric. */
  pull: 'low' | 'high';
  /** Pull compensation per side (mm) a fill gets at its reference size; a satin half fixed and half by width. */
  pullMm: number;
  /** Stitches longer than this (mm) can snag: satin is split below it. */
  longMm: number;
  /** Clusters of short stitches are normal here (stable fabric): no bird nests or holes. */
  shortsOk: boolean;
  /** From this size (mm²) one connected critical spot makes the Ampel red (review decision 15, start values). */
  redMinMm2: number;
  /** A dense design is a risk on it (card rule R4). */
  delicate: boolean;
  /** Pile or texture small lettering sinks into (card rule R7). */
  pile: boolean;
  /** Knit or thin: a large design needs more support (card rule R9). */
  stretchyOrThin: boolean;
}

type Values = Omit<Fabric, 'id'>;

const FABRIC_VALUES: Record<FabricId, Values> = {
  woven: { factor: 1, spacing: [0.4, 0.45], perforation: false, pull: 'low', pullMm: 0.2, longMm: 10, shortsOk: true, redMinMm2: 5, delicate: false, pile: false, stretchyOrThin: false },
  // Denim, canvas, twill: like woven, but the firm, thick cloth carries more thread before it
  // puckers (a little more tolerance) and pulls in no more than woven; same spacing (twill/canvas
  // 0.40 to 0.45 mm). The stronger needle (90/14) is in the card.
  // Spacing 0.42 to 0.50: Wilcom's auto fabric Denim, "slightly reduced density"
  // (docs.wilcom.com, Digitizing > properties-9).
  woven_heavy: { factor: 1.1, spacing: [0.42, 0.5], perforation: false, pull: 'low', pullMm: 0.2, longMm: 10, shortsOk: true, redMinMm2: 5, delicate: false, pile: false, stretchyOrThin: false },
  // Spacing 0.40 to 0.45: Wilcom's auto fabric Cap, "tighter density".
  cap: { factor: 0.9, spacing: [0.4, 0.45], perforation: false, pull: 'low', pullMm: 0.2, longMm: 7, shortsOk: true, redMinMm2: 5, delicate: false, pile: false, stretchyOrThin: false },
  knit: { factor: 0.85, spacing: [0.42, 0.5], perforation: false, pull: 'high', pullMm: 0.35, longMm: 7, shortsOk: false, redMinMm2: 3, delicate: true, pile: true, stretchyOrThin: true },
  // Fleece, sweat, hoodie: a knit with pile. Stretches like knit (pull high, long stitches snag
  // from 7 mm), stitches sink into the pile like on terry (compensation like terry), so the
  // tolerance lies between knit and terry and the spacing a little wider than on knit.
  // Spacing 0.42 to 0.50, disputed: Wilcom's auto fabric Fleece says wider spacing, Impressions
  // (difficult fabrics) 10 to 15 % denser for sweatshirts; between both (Daniel, 2026-10-07).
  fleece: { factor: 0.75, spacing: [0.42, 0.5], perforation: false, pull: 'high', pullMm: 0.4, longMm: 7, shortsOk: false, redMinMm2: 3, delicate: false, pile: true, stretchyOrThin: true },
  terry: { factor: 0.65, spacing: [0.55, 0.7], perforation: false, pull: 'high', pullMm: 0.4, longMm: 7, shortsOk: false, redMinMm2: 3, delicate: false, pile: true, stretchyOrThin: false },
  // Spacing 0.50 to 0.60: Impressions (digitizing for thin fabrics), about 75 % of the stitches.
  light: { factor: 0.6, spacing: [0.5, 0.6], perforation: false, pull: 'high', pullMm: 0.15, longMm: 8, shortsOk: false, redMinMm2: 3, delicate: true, pile: false, stretchyOrThin: true },
  // Organza, chiffon, tulle: like light, but thinner still and see-through; dense thread pulls and
  // puckers it soonest of all (lowest tolerance), long stitches show and snag, and compensation
  // stays as small as on light fabric (more would show as a hard edge).
  sheer: { factor: 0.5, spacing: [0.6, 0.75], perforation: false, pull: 'high', pullMm: 0.15, longMm: 7, shortsOk: false, redMinMm2: 3, delicate: true, pile: false, stretchyOrThin: true },
  leather: { factor: 0.7, spacing: [0.5, 0.8], perforation: true, pull: 'low', pullMm: 0.15, longMm: 8, shortsOk: false, redMinMm2: 3, delicate: true, pile: false, stretchyOrThin: false },
};

/** By id. */
export const FABRIC: Readonly<Record<FabricId, Fabric>> = Object.fromEntries(
  (Object.keys(FABRIC_VALUES) as FabricId[]).map((id) => [id, { id, ...FABRIC_VALUES[id] }]),
) as Record<FabricId, Fabric>;

/** In the order the pickers list them. */
export const FABRICS: readonly Fabric[] = Object.values(FABRIC);
