import { patternStats, STITCH, type Pattern } from '../model/pattern';
import { measurePattern, type Measurement } from '../validation/measure';
import type { Profile } from '../validation/profiles';
import { tagShortStitches, TIE } from '../validation/shortStitches';
import { densityLimits, SHORT_STITCH_COUNT } from '../validation/thresholds';
import { ALL_CHECKS, CAUTION, classify, CRITICAL, type Checks, type Level, type ValidationResult } from '../validation/validate';
import { REASON_BITS } from '../validation/zones';
import { nudgePenetrations, sameHoleStitches } from './nudge';
import { mergeShortStitches, removeZeroLength } from './shorts';
import { thinSweeps } from './thin';

/** Corrections aim this far below the limit, so a fixed cell does not sit right on it. */
const MARGIN = 0.9;
/** At most this share of a sweep's cycles is removed per round; later rounds can remove more. */
const MAX_NEED = 0.5;
const ROUNDS = 4;
/** Same-hole separation: penetrations within 0.4 mm push apart, by at most 0.3 mm. */
const SAME_HOLE_RADIUS = 4;
const SAME_HOLE_SHIFT = 3;
/** Perforation relief on leather: neighbours within 1 mm push apart, by at most 0.3 mm. */
const PERFORATION_RADIUS = 10;
const PERFORATION_SHIFT = 3;

export interface CorrectionOptions {
  /** 'caution' clears Caution and Critical cells, 'critical' only Critical ones. */
  goal: 'caution' | 'critical';
  /** Thin rows and zigzags where density, perforation or short-stitch clusters are too high. */
  thin: boolean;
  /** Remove zero-length stitches and merge chains of short stitches in flagged cells. */
  shorts: boolean;
  /** Push stacked penetrations apart (same-hole stitches; perforation on leather). */
  nudge: boolean;
  /** Only touch cells inside this rectangle (mm, world coordinates), e.g. one zone. */
  region?: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Nudging is off by default: real designs reuse holes on purpose (retraced outlines, shared
 * object edges), and moving them rarely helps on woven fabric.
 */
export const DEFAULT_CORRECTION: CorrectionOptions = { goal: 'caution', thin: true, shorts: true, nudge: false };

export interface LevelSummary {
  worst: Level;
  criticalZones: number;
  cautionZones: number;
  criticalCells: number;
  cautionCells: number;
}

export interface CorrectionReport {
  before: LevelSummary;
  after: LevelSummary;
  zeroLength: number;
  merged: number;
  thinned: number;
  /** Row or zigzag pairs removed by thinning. */
  cycles: number;
  moved: number;
  stitchesBefore: number;
  stitchesAfter: number;
  /** Thread length of real stitches, mm. */
  threadBefore: number;
  threadAfter: number;
  rounds: number;
}

export interface CorrectionResult {
  pattern: Pattern;
  measurement: Measurement;
  report: CorrectionReport;
}

function summary(v: ValidationResult): LevelSummary {
  return {
    worst: v.worst,
    criticalZones: v.zones.filter((z) => z.level === CRITICAL).length,
    cautionZones: v.zones.filter((z) => z.level === CAUTION).length,
    criticalCells: v.criticalCells,
    cautionCells: v.cautionCells,
  };
}

/**
 * Per 1 mm cell, the share of cycles that thinning should remove, and which cells the short-stitch
 * and perforation fixes may touch. Density, perforation and short-stitch counts each ask for the
 * reduction that brings them MARGIN below their limit; the largest one wins.
 */
interface NeedField {
  need: Float32Array;
  shorts: Uint8Array;
  perforation: Uint8Array;
  any: boolean;
}

function needField(v: ValidationResult, opts: CorrectionOptions): NeedField {
  const m = v.measurement;
  const th = v.thresholds;
  const n = m.cols * m.rows;
  const need = new Float32Array(n);
  const shorts = new Uint8Array(n);
  const perforation = new Uint8Array(n);
  const minLevel = opts.goal === 'caution' ? CAUTION : CRITICAL;
  const r = opts.region;
  let any = false;
  for (let i = 0; i < n; i++) {
    if (v.level[i] < minLevel) continue;
    if (r) {
      const cx = m.originX + ((i % m.cols) + 0.5) * m.cellMm;
      const cy = m.originY + (Math.floor(i / m.cols) + 0.5) * m.cellMm;
      if (cx < r.minX || cx > r.maxX || cy < r.minY || cy > r.maxY) continue;
    }
    const reasons = v.reasons[i];
    let f = 0;
    if (reasons & REASON_BITS.density) {
      const [caution, critical] = densityLimits(th, m.satin[i]);
      const target = MARGIN * (minLevel === CAUTION ? caution : critical);
      f = Math.max(f, 1 - target / m.density[i]);
    }
    if (reasons & REASON_BITS.perforation && th.holes) {
      const target = (minLevel === CAUTION ? th.holes.caution : th.holes.critical) - 1;
      f = Math.max(f, 1 - target / m.holes[i]);
      perforation[i] = 1;
    }
    if (reasons & REASON_BITS.shortStitches) {
      f = Math.max(f, 1 - (SHORT_STITCH_COUNT - 2) / m.shorts[i]);
      shorts[i] = 1;
    }
    need[i] = Math.min(MAX_NEED, Math.max(0, f));
    if (need[i] > 0 || shorts[i] || perforation[i]) any = true;
  }
  return { need, shorts, perforation, any };
}

/** Cell index of record i in measurement m, or -1. */
function cellOf(p: Pattern, m: Measurement, i: number): number {
  const cx = Math.floor(p.x[i] / 10 - m.originX);
  const cy = Math.floor(p.y[i] / 10 - m.originY);
  return cx >= 0 && cy >= 0 && cx < m.cols && cy < m.rows ? cy * m.cols + cx : -1;
}

/** True if record i lies inside the region (mm), or there is none. */
const inRegion = (p: Pattern, opts: CorrectionOptions, i: number): boolean => {
  const r = opts.region;
  return !r || (p.x[i] >= r.minX * 10 && p.x[i] <= r.maxX * 10 && p.y[i] >= r.minY * 10 && p.y[i] <= r.maxY * 10);
};

const stitchCount = (p: Pattern) => p.cmd.reduce((a, c) => a + (c === STITCH ? 1 : 0), 0);

/**
 * Corrects a design for a material profile: removes zero-length stitches, then in up to ROUNDS
 * rounds merges short-stitch chains and thins sweeps in the flagged cells and re-measures, and
 * finally pushes stacked penetrations apart. Cells that none of these can fix (for example an area
 * where a long fill row only crosses a small dense spot) stay flagged and are left to manual
 * editing. Only the enabled checks are corrected.
 */
export function autoCorrect(
  input: Pattern,
  profile: Profile,
  opts: CorrectionOptions,
  checks: Checks = ALL_CHECKS,
): CorrectionResult {
  let p = input;
  let m = measurePattern(p);
  let v = classify(m, profile, checks);
  const before = summary(v);
  const threadBefore = patternStats(p).threadLength;
  const stitchesBefore = stitchCount(p);
  let zeroLength = 0;
  let merged = 0;
  let thinned = 0;
  let cycles = 0;
  let moved = 0;
  let rounds = 0;
  let changed = false;

  if (opts.shorts) {
    const r = removeZeroLength(p, (i) => inRegion(p, opts, i));
    p = r.pattern;
    zeroLength = r.removed;
    changed = r.removed > 0;
  }
  if (changed) {
    m = measurePattern(p);
    v = classify(m, profile, checks);
  }

  for (; rounds < ROUNDS; rounds++) {
    const field = needField(v, opts);
    if (!field.any) break;
    let roundChanged = false;
    if (opts.shorts) {
      const r = mergeShortStitches(p, (i) => {
        const c = cellOf(p, m, i);
        return c >= 0 && field.shorts[c] === 1;
      });
      if (r.removed) {
        p = r.pattern;
        merged += r.removed;
        roundChanged = true;
      }
    }
    if (opts.thin) {
      // Positions moved by the merge step: look cells up on the current pattern.
      const cur = p;
      const tags = tagShortStitches(cur);
      const protect = tags.map((t) => (t === TIE ? 1 : 0));
      const r = thinSweeps(cur, {
        needAt: (i) => {
          const c = cellOf(cur, m, i);
          return c >= 0 ? field.need[c] : 0;
        },
        protect,
        // Spots left after the first round are often small parts of long rows: allow removals
        // that reach further out of the flagged area.
        minShare: rounds === 0 ? undefined : 0.3,
      });
      if (r.removed) {
        p = r.pattern;
        thinned += r.removed;
        cycles += r.cycles;
        roundChanged = true;
      }
    }
    if (!roundChanged) break;
    m = measurePattern(p);
    v = classify(m, profile, checks);
  }

  if (opts.nudge) {
    const tags = tagShortStitches(p);
    const same = sameHoleStitches(p);
    const start = p;
    let r = nudgePenetrations(p, {
      movable: (i) => same[i] === 1 && tags[i] !== TIE && inRegion(start, opts, i),
      radius: SAME_HOLE_RADIUS,
      maxShift: SAME_HOLE_SHIFT,
    });
    p = r.pattern;
    moved += r.moved;
    if (v.thresholds.holes) {
      const field = needField(v, opts);
      const cur = p;
      r = nudgePenetrations(cur, {
        movable: (i) => {
          const c = cellOf(cur, m, i);
          return c >= 0 && field.perforation[c] === 1 && tags[i] !== TIE;
        },
        radius: PERFORATION_RADIUS,
        maxShift: PERFORATION_SHIFT,
      });
      p = r.pattern;
      moved += r.moved;
    }
    if (moved) {
      m = measurePattern(p);
      v = classify(m, profile, checks);
    }
  }

  return {
    pattern: p,
    measurement: m,
    report: {
      before,
      after: summary(v),
      zeroLength,
      merged,
      thinned,
      cycles,
      moved,
      stitchesBefore,
      stitchesAfter: stitchCount(p),
      threadBefore,
      threadAfter: patternStats(p).threadLength,
      rounds,
    },
  };
}
