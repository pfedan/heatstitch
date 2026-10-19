/**
 * Every value that depends on the fabric, in one record per fabric. Validation, stitch defaults,
 * the Ampel and the ready-to-stitch card read from here; a new fabric that misses a value does not
 * compile (concept: plans/voreinstellungen.md in the project files).
 *
 * Spacing ranges: counted across two rows (see ROW_PAIR in validation/profiles.ts), a fill's rows
 * half of it apart, a satin's penetrations on one side all of it. Since 2026-10-19 (Daniel: 0.4 on
 * woven) the ranges below are the earlier ones, which came from common digitizing guides, Wilcom's
 * auto fabrics and Impressions
 * (plans/voreinstellungen-recherche.md in the project files), times 0.40 / 0.36. Pull compensation: Wilcom's table, more for stretchy and pile fabrics. Texts,
 * stabilizers, needles and their sources: src/areas/ready/recipes.ts.
 */

export type FabricId = 'woven' | 'woven_heavy' | 'cap' | 'knit' | 'fleece' | 'terry' | 'light' | 'sheer' | 'leather';

export interface Fabric {
  id: FabricId;
  /** Multiplier for the density thresholds. */
  factor: number;
  /** Recommended spacing in mm for 40 wt thread, across two fill rows (satin: between penetrations on one side). */
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
  /**
   * Gap rows: fill rows a section sews on into the next where two sections of a tatami fill meet,
   * so the join does not open where the fabric stretches between them (see sectionJoins in
   * digitize/fill.ts). One on knit (jersey), where the fabric gives way most; none on stable fabric,
   * where no gap opens, and none on fleece, light and sheer fabric, whose lower density limits
   * leave no room for the doubled row (two rows reach Caution on knit too), nor on terry (not tried).
   */
  gapRows: number;
}

type Values = Omit<Fabric, 'id'>;

// On stable fabric (woven, heavy woven, cap) the lower end of the spacing range (the default) is
// 10 % denser than the sources below give: a stitch-out at 0.40 mm on woven fabric left the fabric
// showing (Daniel, 2026-10-14), as 40 wt thread lies narrower than 0.4 mm once flattened. Wilcom's
// tatami default is 0.38 mm, and Embrilliance asks for "4 points or even tighter" for full
// coverage. Stretchy, pile and thin fabrics keep theirs: denser, their own defaults would reach
// Caution and Critical in the density check (contour fill on knit), whose factors are not measured.
const FABRIC_VALUES: Record<FabricId, Values> = {
  woven: { factor: 1, spacing: [0.4, 0.5], perforation: false, pull: 'low', pullMm: 0.2, longMm: 10, shortsOk: true, redMinMm2: 5, delicate: false, pile: false, stretchyOrThin: false, gapRows: 0 },
  // Denim, canvas, twill: like woven; same tolerance (2026-10-19, the reference manual: slightly
  // less density on thick, rigid cloth against thread buildup, nothing for more), pulls in no
  // more than woven; same spacing (twill/canvas 0.40 to 0.45 mm). The stronger needle (90/14) is in the card.
  // Spacing 0.42 to 0.50: Wilcom's auto fabric Denim, "slightly reduced density"
  // (docs.wilcom.com, Digitizing > properties-9).
  woven_heavy: { factor: 1, spacing: [0.42, 0.56], perforation: false, pull: 'low', pullMm: 0.2, longMm: 10, shortsOk: true, redMinMm2: 5, delicate: false, pile: false, stretchyOrThin: false, gapRows: 0 },
  // Spacing 0.40 to 0.45: Wilcom's auto fabric Cap, "tighter density"; so at least woven's
  // tolerance (2026-10-19).
  cap: { factor: 1, spacing: [0.4, 0.5], perforation: false, pull: 'low', pullMm: 0.2, longMm: 7, shortsOk: true, redMinMm2: 5, delicate: false, pile: false, stretchyOrThin: false, gapRows: 0 },
  knit: { factor: 0.85, spacing: [0.47, 0.56], perforation: false, pull: 'high', pullMm: 0.35, longMm: 7, shortsOk: false, redMinMm2: 3, delicate: true, pile: true, stretchyOrThin: true, gapRows: 1 },
  // Fleece, sweat, hoodie: a knit with pile. Stretches like knit (pull high, long stitches snag
  // from 7 mm), stitches sink into the pile like on terry (compensation like terry), so the
  // tolerance lies between knit and terry and the spacing a little wider than on knit.
  // Spacing 0.42 to 0.50, disputed: Wilcom's auto fabric Fleece says wider spacing, Impressions
  // (difficult fabrics) 10 to 15 % denser for sweatshirts; between both (Daniel, 2026-10-07).
  fleece: { factor: 0.75, spacing: [0.47, 0.56], perforation: false, pull: 'high', pullMm: 0.4, longMm: 7, shortsOk: false, redMinMm2: 3, delicate: false, pile: true, stretchyOrThin: true, gapRows: 0 },
  // Terry: the reference manual sews it with more thread, not less (edge run and double zigzag
  // underlay, a laydown under the whole design, higher density), so woven's tolerance and spacing
  // (Daniel, 2026-10-19: follow the manual; before 0.61 to 0.78 and 0.65, at which a satin over a
  // fill with that underlay read as Caution).
  terry: { factor: 1, spacing: [0.4, 0.5], perforation: false, pull: 'high', pullMm: 0.4, longMm: 7, shortsOk: false, redMinMm2: 3, delicate: false, pile: true, stretchyOrThin: false, gapRows: 0 },
  // Spacing 0.50 to 0.60: Impressions (digitizing for thin fabrics), about 75 % of the stitches.
  light: { factor: 0.6, spacing: [0.56, 0.67], perforation: false, pull: 'high', pullMm: 0.15, longMm: 8, shortsOk: false, redMinMm2: 3, delicate: true, pile: false, stretchyOrThin: true, gapRows: 0 },
  // Organza, chiffon, tulle: like light, but thinner still and see-through; dense thread pulls and
  // puckers it soonest of all (lowest tolerance), long stitches show and snag, and compensation
  // stays as small as on light fabric (more would show as a hard edge).
  sheer: { factor: 0.5, spacing: [0.67, 0.83], perforation: false, pull: 'high', pullMm: 0.15, longMm: 7, shortsOk: false, redMinMm2: 3, delicate: true, pile: false, stretchyOrThin: true, gapRows: 0 },
  leather: { factor: 0.7, spacing: [0.56, 0.89], perforation: true, pull: 'low', pullMm: 0.15, longMm: 8, shortsOk: false, redMinMm2: 3, delicate: true, pile: false, stretchyOrThin: false, gapRows: 0 },
};

/** By id. */
export const FABRIC: Readonly<Record<FabricId, Fabric>> = Object.fromEntries(
  (Object.keys(FABRIC_VALUES) as FabricId[]).map((id) => [id, { id, ...FABRIC_VALUES[id] }]),
) as Record<FabricId, Fabric>;

/** In the order the pickers list them. */
export const FABRICS: readonly Fabric[] = Object.values(FABRIC);
