import { SAFE, type Level } from './thresholds';

export type Reason = 'density' | 'shortStitches' | 'perforation';

/** Reason bits stored per cell. */
export const REASON_BITS: Record<Reason, number> = { density: 1, shortStitches: 2, perforation: 4 };
const REASONS = Object.keys(REASON_BITS) as Reason[];

export interface Zone {
  /** Highest level of any cell in the zone. */
  level: Level;
  reasons: Reason[];
  cells: number;
  areaMm2: number;
  /** Highest measured thread density in the zone, mm/mm². */
  maxDensity: number;
  /** Most neighbouring penetrations within 1 mm of one penetration in the zone. */
  maxHoles: number;
  /** Most non-exempt short stitches in one cell of the zone. */
  maxShorts: number;
  /** Mean share of satin thread over the zone's cells (0 to 1). */
  satinShare: number;
  /** Bounding box in mm (world coordinates, y down). */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Set when the finding is normal in practice and does not count towards the verdict. */
  practice?: PracticeNote;
}

/**
 * Findings that digitizers accept as they are: small spots at satin ends, joins and turns, the
 * overlap where two satin columns meet, and short-stitch clusters on stable fabric.
 */
export type PracticeNote = 'smallSpot' | 'satinJoin' | 'shortsStable';

export interface ZoneInput {
  level: Uint8Array;
  reasons: Uint8Array;
  density: Float32Array;
  holes: Uint8Array;
  shorts: Uint16Array;
  satin: Float32Array;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  cellMm: number;
}

/**
 * Groups all non-safe cells into 8-connected zones. A zone's level is its worst cell, so a Critical
 * core with a Caution rim counts as one Critical zone. `zoneOf`, when given, receives the index of
 * each cell's zone in the returned list (-1 for safe cells).
 */
export function findZones(g: ZoneInput, zoneOf?: Int32Array): Zone[] {
  const { level, cols, rows, cellMm } = g;
  const seen = new Uint8Array(level.length);
  const id = zoneOf ?? new Int32Array(level.length);
  id.fill(-1);
  const zones: Zone[] = [];
  const stack: number[] = [];
  for (let start = 0; start < level.length; start++) {
    if (level[start] === SAFE || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    let zLevel = 0;
    let cells = 0;
    let bits = 0;
    let maxDensity = 0;
    let maxHoles = 0;
    let maxShorts = 0;
    let satin = 0;
    let minCx = Infinity;
    let minCy = Infinity;
    let maxCx = -Infinity;
    let maxCy = -Infinity;
    while (stack.length) {
      const i = stack.pop()!;
      const cx = i % cols;
      const cy = (i - cx) / cols;
      cells++;
      id[i] = zones.length;
      satin += g.satin[i];
      zLevel = Math.max(zLevel, level[i]);
      bits |= g.reasons[i];
      maxDensity = Math.max(maxDensity, g.density[i]);
      maxHoles = Math.max(maxHoles, g.holes[i]);
      maxShorts = Math.max(maxShorts, g.shorts[i]);
      minCx = Math.min(minCx, cx);
      maxCx = Math.max(maxCx, cx);
      minCy = Math.min(minCy, cy);
      maxCy = Math.max(maxCy, cy);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (level[j] !== SAFE && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    zones.push({
      level: zLevel as Level,
      reasons: REASONS.filter((r) => bits & REASON_BITS[r]),
      cells,
      areaMm2: cells * cellMm * cellMm,
      maxDensity,
      maxHoles,
      maxShorts,
      satinShare: satin / cells,
      bbox: {
        minX: g.originX + minCx * cellMm,
        minY: g.originY + minCy * cellMm,
        maxX: g.originX + (maxCx + 1) * cellMm,
        maxY: g.originY + (maxCy + 1) * cellMm,
      },
    });
  }
  // Worst first, then largest.
  const order = zones.map((_, k) => k).sort((a, b) => zones[b].level - zones[a].level || zones[b].cells - zones[a].cells);
  const rank = new Int32Array(zones.length);
  order.forEach((k, r) => (rank[k] = r));
  for (let i = 0; i < id.length; i++) if (id[i] >= 0) id[i] = rank[id[i]];
  return order.map((k) => zones[k]);
}
