import { SAFE, type Level } from './thresholds';

export type Reason = 'density' | 'shortStitches';

export interface Zone {
  /** Highest level of any cell in the zone. */
  level: Level;
  reasons: Reason[];
  cells: number;
  areaMm2: number;
  maxDensity: number;
  /** Bounding box in mm (world coordinates, y down). */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Groups all non-safe cells into 8-connected zones. A zone's level is its worst cell, so a Critical
 * core with a Caution rim counts as one Critical zone.
 */
export function findZones(
  level: Uint8Array,
  density: Float32Array,
  shortFlag: Uint8Array,
  densityLevel: Uint8Array,
  cols: number,
  rows: number,
  originX: number,
  originY: number,
  cellMm: number,
): Zone[] {
  const seen = new Uint8Array(level.length);
  const zones: Zone[] = [];
  const stack: number[] = [];
  for (let start = 0; start < level.length; start++) {
    if (level[start] === SAFE || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    let zLevel = 0;
    let cells = 0;
    let maxDensity = 0;
    let byDensity = false;
    let byShort = false;
    let minCx = Infinity;
    let minCy = Infinity;
    let maxCx = -Infinity;
    let maxCy = -Infinity;
    while (stack.length) {
      const i = stack.pop()!;
      const cx = i % cols;
      const cy = (i - cx) / cols;
      cells++;
      zLevel = Math.max(zLevel, level[i]);
      maxDensity = Math.max(maxDensity, density[i]);
      minCx = Math.min(minCx, cx);
      maxCx = Math.max(maxCx, cx);
      minCy = Math.min(minCy, cy);
      maxCy = Math.max(maxCy, cy);
      if (shortFlag[i]) byShort = true;
      if (densityLevel[i] !== SAFE) byDensity = true;
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
    const reasons: Reason[] = [];
    if (byDensity) reasons.push('density');
    if (byShort) reasons.push('shortStitches');
    zones.push({
      level: zLevel as Level,
      reasons,
      cells,
      areaMm2: cells * cellMm * cellMm,
      maxDensity,
      bbox: {
        minX: originX + minCx * cellMm,
        minY: originY + minCy * cellMm,
        maxX: originX + (maxCx + 1) * cellMm,
        maxY: originY + (maxCy + 1) * cellMm,
      },
    });
  }
  // Worst first, then largest.
  return zones.sort((a, b) => b.level - a.level || b.cells - a.cells);
}
