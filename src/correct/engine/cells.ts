import { settledBy, type Acknowledgement } from '../../validation/acks';
import { fabricOf } from '../../validation/profiles';
import { CAUTION, CRITICAL, SAFE, type Level } from '../../validation/thresholds';
import type { ValidationResult } from '../../validation/validate';
import { REASON_BITS, type Reason, type Zone } from '../../validation/zones';

/**
 * Cell bookkeeping shared by the correction engine and its benchmark: which cells count (not normal
 * in practice, not acknowledged), and how two validations of the same design compare cell by cell.
 * Validation grids are aligned to whole millimetres, so cells match by their world position even
 * when an edit changed the design's bounds.
 */

/** The finding kinds the Ampel names, each with a fix of its own. */
export type FixKind = 'density' | 'holes' | 'gap' | 'sparse' | 'long';
export const FIX_KINDS: readonly FixKind[] = ['density', 'holes', 'gap', 'sparse', 'long'];

/** Reasons of each kind. Short stitches and perforation are both "too many penetrations". */
export const KIND_REASONS: Record<FixKind, Reason[]> = {
  density: ['density'],
  holes: ['shortStitches', 'perforation'],
  gap: ['gap'],
  sparse: ['sparse'],
  long: ['long'],
};

/** Kinds that are never critical: their fix clears caution cells (decided 2026-10-06). */
export const CAUTION_KINDS: ReadonlySet<FixKind> = new Set(['gap', 'sparse', 'long']);

export const kindBits = (k: FixKind): number => KIND_REASONS[k].reduce((a, r) => a | REASON_BITS[r], 0);

/** Per cell: 1 when its zone counts towards the verdict. */
export function countingCells(v: ValidationResult, acks?: readonly Acknowledgement[]): Uint8Array {
  const counts = v.zones.map((z) => (settledBy(z, acks) ? 0 : 1));
  const out = new Uint8Array(v.level.length);
  for (let i = 0; i < out.length; i++) if (v.zoneOf[i] >= 0) out[i] = counts[v.zoneOf[i]];
  return out;
}

/**
 * Whether a counting cell is open for kind `k`: critical for the critical kinds, at least caution
 * (and carrying the kind's reason) for the caution kinds.
 */
export function openFor(v: ValidationResult, counting: Uint8Array, i: number, k: FixKind): boolean {
  if (!counting[i] || !(v.reasons[i] & kindBits(k))) return false;
  return CAUTION_KINDS.has(k) ? v.level[i] >= CAUTION : v.level[i] === CRITICAL && criticalBy(v, i, k);
}

/**
 * Whether cell `i` is critical because of kind `k` (a cell can be critical by density and only
 * caution by penetrations). Density and penetration levels are recomputed from the measurement.
 */
function criticalBy(v: ValidationResult, i: number, k: FixKind): boolean {
  const m = v.measurement;
  const th = v.thresholds;
  if (k === 'density') {
    const s = Math.min(1, Math.max(0, m.satin[i]));
    return m.density[i] >= th.critical + s * (th.satinCritical - th.critical);
  }
  if (k === 'holes') return (!!th.holes && m.holes[i] >= th.holes.critical) || (v.reasons[i] & REASON_BITS.shortStitches) !== 0;
  return false;
}

/** World key of cell `i` of a validation: integer millimetres. */
export function cellKey(v: ValidationResult, i: number): number {
  const m = v.measurement;
  const cx = Math.round(m.originX + (i % m.cols));
  const cy = Math.round(m.originY + Math.floor(i / m.cols));
  return (cy + 50000) * 100000 + (cx + 50000);
}

export interface CellDiff {
  /** Counting critical cells before and after. */
  criticalBefore: number;
  criticalAfter: number;
  /** Cells critical after that were not critical before (counting or not: the hard rule). */
  newCritical: number;
  /** Cells at least caution after that were safe before. */
  newCaution: number;
  /** Cells newly flagged as a gap or as too open. */
  newGapSparse: number;
  /** Open cells of each kind before and after. */
  open: Record<FixKind, [number, number]>;
  /** World keys of the new critical cells. */
  newCriticalKeys: number[];
}

/** Compares two validations of one design, cell by cell. */
export function cellDiff(before: ValidationResult, after: ValidationResult, acks?: readonly Acknowledgement[]): CellDiff {
  const cb = countingCells(before, acks);
  const ca = countingCells(after, acks);
  const prev = new Map<number, number>();
  const gapBits = REASON_BITS.gap | REASON_BITS.sparse;
  for (let i = 0; i < before.level.length; i++) if (before.level[i] !== SAFE) prev.set(cellKey(before, i), i);
  const open = Object.fromEntries(FIX_KINDS.map((k) => [k, [0, 0]])) as unknown as Record<FixKind, [number, number]>;
  let criticalBefore = 0;
  let criticalAfter = 0;
  for (let i = 0; i < before.level.length; i++) {
    if (cb[i] && before.level[i] === CRITICAL) criticalBefore++;
    for (const k of FIX_KINDS) if (openFor(before, cb, i, k)) open[k][0]++;
  }
  let newCritical = 0;
  let newCaution = 0;
  let newGapSparse = 0;
  const newCriticalKeys: number[] = [];
  for (let i = 0; i < after.level.length; i++) {
    const l = after.level[i] as Level;
    if (l === SAFE) continue;
    if (ca[i] && l === CRITICAL) criticalAfter++;
    for (const k of FIX_KINDS) if (openFor(after, ca, i, k)) open[k][1]++;
    const key = cellKey(after, i);
    const j = prev.get(key);
    const was = j === undefined ? SAFE : before.level[j];
    if (l === CRITICAL && was !== CRITICAL) {
      newCritical++;
      newCriticalKeys.push(key);
    }
    if (was === SAFE) newCaution++;
    if (after.reasons[i] & gapBits && !(j !== undefined && before.reasons[j] & gapBits)) newGapSparse++;
  }
  return { criticalBefore, criticalAfter, newCritical, newCaution, newGapSparse, open, newCriticalKeys };
}

/** Red from this many mm² of one connected critical spot, by fabric (decided 2026-10-06; starting values). */
export const RED_MM2: Record<string, number> = { woven: 5, cap: 5, knit: 3, terry: 3, light: 3, leather: 5 };

export type AmpelColor = 'green' | 'yellow' | 'red';

/**
 * The Ampel for one fabric: the worst counting spot decides. Red when one connected critical spot
 * reaches the fabric's size, yellow for smaller critical spots or any caution, green otherwise.
 */
export function ampelOf(v: ValidationResult, acks?: readonly Acknowledgement[]): { color: AmpelColor; worst: Zone | null } {
  const red = RED_MM2[fabricOf(v.profile).id] ?? 5;
  // Rank: red spots by critical area, then yellow ones (critical before caution) by area.
  let worst: Zone | null = null;
  let best = -1;
  for (const z of v.zones) {
    if (settledBy(z, acks)) continue;
    const crit = z.level === CRITICAL ? criticalArea(v, z) : 0;
    const rank = crit >= red ? 2e6 + crit : z.level === CRITICAL ? 1e6 + crit : z.areaMm2;
    if (rank > best) {
      best = rank;
      worst = z;
    }
  }
  const color: AmpelColor = !worst ? 'green' : best >= 2e6 ? 'red' : 'yellow';
  return { color, worst };
}

/** Largest 8-connected patch of critical cells inside zone `z` (mm²). */
function criticalArea(v: ValidationResult, z: Zone): number {
  const m = v.measurement;
  const id = v.zones.indexOf(z);
  const seen = new Uint8Array(v.level.length);
  let best = 0;
  for (let s = 0; s < v.level.length; s++) {
    if (seen[s] || v.zoneOf[s] !== id || v.level[s] !== CRITICAL) continue;
    let n = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      const cx = i % m.cols;
      const cy = (i - cx) / m.cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
          const j = y * m.cols + x;
          if (!seen[j] && v.level[j] === CRITICAL) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    best = Math.max(best, n);
  }
  return best * m.cellMm * m.cellMm;
}
