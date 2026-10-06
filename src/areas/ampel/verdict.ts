import type { LoadedFile } from '../../ui/fileList';
import { settledBy } from '../../validation/acks';
import { FABRICS, type FabricId } from '../../validation/profiles';
import { CAUTION, CRITICAL, type Reason, type ValidationResult, type Zone } from '../../validation/validate';
import { REASON_BITS } from '../../validation/zones';
import { FINDING_TYPES, type FabricVerdict, type FindingType, type ReasonSummary, type Spot } from './engine';

/*
 * What the light reads from a validation, without any fix: the colour per fabric by its worst
 * spot, and the reasons by kind with their area and what a fix aims at. Shared by the engine
 * adapter (live.ts).
 */

/**
 * From this size (mm²) one connected critical spot that counts makes the light red. Start values
 * (Entscheidung 15): 5 mm² on stable fabric and caps (heavy woven too), 3 mm² on knit, jersey,
 * fleece and terry; light and sheer fabrics and leather take the stricter value.
 */
export const RED_MIN_MM2 = Object.fromEntries(FABRICS.map((f) => [f.id, f.redMinMm2])) as Record<FabricId, number>;

/** The validation reasons behind each kind of finding. */
export const TYPE_REASONS: Record<FindingType, Reason[]> = {
  density: ['density'],
  penetrations: ['shortStitches', 'perforation'],
  gaps: ['sparse', 'gap'],
  long: ['long'],
};
const bitsOf = (rs: Reason[]) => rs.reduce((b, r) => b | REASON_BITS[r], 0);
const TYPE_BITS: Record<FindingType, number> = {
  density: bitsOf(TYPE_REASONS.density),
  penetrations: bitsOf(TYPE_REASONS.penetrations),
  gaps: bitsOf(TYPE_REASONS.gaps),
  long: bitsOf(TYPE_REASONS.long),
};
/** Density and penetrations: the fix clears the critical spots. Gaps and long stitches are never critical: their fix clears caution. */
export const AIMS_CRITICAL: Record<FindingType, boolean> = { density: true, penetrations: true, gaps: false, long: false };

export const LEVEL = (l: number): Spot['level'] => (l >= CRITICAL ? 'critical' : 'caution');

/** What the light reads from one validation: per cell what counts, per kind its area and target. */
export interface Tally {
  verdict: FabricVerdict;
  reasons: ReasonSummary[];
  /** Target cells per kind, and of all kinds together. */
  target: Record<FindingType | 'all', number>;
  /** Cells that count, critical and caution. */
  critical: number;
  caution: number;
}

/** Reads the light, the reasons and their areas from a validation (cheap: one pass over the cells). */
export function tally(v: ValidationResult, acks: LoadedFile['acks']): Tally {
  const fabric = v.profile.fabric;
  const cellMm2 = v.measurement.cellMm * v.measurement.cellMm;
  const counts = v.zones.map((z) => !settledBy(z, acks));
  const n = v.level.length;
  const target = { density: 0, penetrations: 0, gaps: 0, long: 0, all: 0 };
  const area = { density: 0, penetrations: 0, gaps: 0, long: 0 };
  // Per kind and zone: its cells (the worst spot of a kind is its zone with the most).
  const perZone = new Map<FindingType, Map<number, { cells: number; level: number }>>(FINDING_TYPES.map((t) => [t, new Map()]));
  let critical = 0;
  let caution = 0;
  for (let i = 0; i < n; i++) {
    const zi = v.zoneOf[i];
    if (zi < 0 || !counts[zi]) continue;
    const lvl = v.level[i];
    if (lvl >= CRITICAL) critical++;
    else caution++;
    let any = false;
    for (const t of FINDING_TYPES) {
      if (!(v.reasons[i] & TYPE_BITS[t])) continue;
      area[t]++;
      const hit = !AIMS_CRITICAL[t] || lvl >= CRITICAL;
      if (hit) {
        target[t]++;
        any = true;
      }
      const m = perZone.get(t)!;
      const e = m.get(zi) ?? { cells: 0, level: 0 };
      e.cells++;
      // Gaps and long stitches are never critical, even inside a critical spot.
      e.level = Math.max(e.level, AIMS_CRITICAL[t] ? lvl : Math.min(lvl, CAUTION));
      m.set(zi, e);
    }
    if (any) target.all++;
  }
  const reasons: ReasonSummary[] = [];
  for (const t of FINDING_TYPES) {
    const zs = [...perZone.get(t)!];
    if (!zs.length) continue;
    zs.sort((a, b) => b[1].level - a[1].level || b[1].cells - a[1].cells);
    const [zi, e] = zs[0];
    const level = zs.reduce((l, [, x]) => Math.max(l, x.level), 0);
    reasons.push({
      type: t,
      level: LEVEL(level),
      areaMm2: area[t] * cellMm2,
      targetMm2: target[t] * cellMm2,
      spots: zs.length,
      worst: { bbox: { ...v.zones[zi].bbox }, areaMm2: e.cells * cellMm2, level: LEVEL(e.level) },
    });
  }
  reasons.sort((a, b) => (b.level === 'critical' ? 1 : 0) - (a.level === 'critical' ? 1 : 0) || b.areaMm2 - a.areaMm2);
  return {
    verdict: verdictOf(v, counts, fabric),
    reasons,
    target: Object.fromEntries(Object.entries(target).map(([k, c]) => [k, c * cellMm2])) as Tally['target'],
    critical,
    caution,
  };
}

/** The colour by the worst spot: the largest connected critical spot that counts. */
function verdictOf(v: ValidationResult, counts: boolean[], fabric: FabricId): FabricVerdict {
  const { cols, rows, cellMm, originX, originY } = v.measurement;
  const redMinMm2 = RED_MIN_MM2[fabric];
  const counted = (i: number) => v.zoneOf[i] >= 0 && counts[v.zoneOf[i]];
  const seen = new Uint8Array(v.level.length);
  let best: Spot | null = null;
  const stack: number[] = [];
  for (let s = 0; s < v.level.length; s++) {
    if (seen[s] || v.level[s] < CRITICAL || !counted(s)) continue;
    seen[s] = 1;
    stack.push(s);
    let cells = 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    while (stack.length) {
      const i = stack.pop()!;
      const cx = i % cols;
      const cy = (i - cx) / cols;
      cells++;
      x0 = Math.min(x0, cx);
      x1 = Math.max(x1, cx);
      y0 = Math.min(y0, cy);
      y1 = Math.max(y1, cy);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (!seen[j] && v.level[j] >= CRITICAL && counted(j)) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const areaMm2 = cells * cellMm * cellMm;
    if (!best || areaMm2 > best.areaMm2) {
      best = { bbox: { minX: originX + x0 * cellMm, minY: originY + y0 * cellMm, maxX: originX + (x1 + 1) * cellMm, maxY: originY + (y1 + 1) * cellMm }, areaMm2, level: 'critical' };
    }
  }
  if (best) return { fabric, light: best.areaMm2 > redMinMm2 ? 'red' : 'yellow', worst: best, redMinMm2 };
  // No critical spot: yellow while anything counts, its largest spot the worst.
  let zone: Zone | null = null;
  v.zones.forEach((z, k) => {
    if (counts[k] && (!zone || z.areaMm2 > zone.areaMm2)) zone = z;
  });
  const z = zone as Zone | null;
  return z ? { fabric, light: 'yellow', worst: { bbox: { ...z.bbox }, areaMm2: z.areaMm2, level: LEVEL(z.level) }, redMinMm2 } : { fabric, light: 'green', worst: null, redMinMm2 };
}
