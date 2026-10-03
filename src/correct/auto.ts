import { patternStats, STITCH, type Pattern } from '../model/pattern';
import { satinMask } from '../validation/satin';
import { measurePattern, type Measurement } from '../validation/measure';
import { recommendedSpacing, type Profile } from '../validation/profiles';
import { tagShortStitches, TIE } from '../validation/shortStitches';
import { densityLimits, SHORT_STITCH_COUNT } from '../validation/thresholds';
import { ALL_CHECKS, CAUTION, classify, CRITICAL, type Checks, type Level, type ValidationResult } from '../validation/validate';
import { settledBy, type Acknowledgement } from '../validation/acks';
import { REASON_BITS, type Zone } from '../validation/zones';
import { walkCovered } from './cover';
import { nudgePenetrations, sameHoleStitches } from './nudge';
import { pullBackFills } from './pullback';
import { respaceFills, respaceSatins } from './respace';
import { shortenSatinCurves } from './satinShort';
import { mergeShortStitches, removeZeroLength } from './shorts';
import { satinColumns, stitchRuns, ZIGZAG_MIN } from './structure';
import { thinSweeps } from './thin';

/**
 * Automatic correction, built on what digitizers do by hand rather than on removing thread
 * wherever a limit is exceeded:
 *
 * 1. Clean-up that changes nothing visible: stitches without movement, chains of tiny stitches.
 * 2. Fills reaching far under a satin border are pulled back to the usual overlap (a quarter to a
 *    third of the border width). The border hides the fill edge either way.
 * 3. Short stitches on the crowded inside of satin curves and corners.
 * 4. Thread focus: fill rows that a later object covers completely are thinned (hidden, so no
 *    stripes show), and fills that are still too dense are rebuilt at an even, wider row spacing,
 *    never wider than the material's recommended range.
 * 5. Penetration focus: stacked holes are pushed apart by at most 0.3 mm.
 *
 * Findings that are normal in practice (small spots, satin joins, short stitches on stable fabric,
 * see validation/practice.ts) are left alone, as are zones the user acknowledged. Each step is kept
 * only if it does not make the result worse anywhere in the region. Nothing is thinned in a way
 * that would show on the fabric.
 */

/** Corrections aim this far below the limit, so a fixed cell does not sit right on it. */
const MARGIN = 0.9;
/** At most this share of a sweep's density is removed per round. */
const MAX_NEED = 0.5;
const ROUNDS = 2;
/** Later thread per area (mm/mm²) from which a stitch counts as hidden: a full fill layer. */
const HIDDEN_COVER = 2.2;
/** Share of a hidden-row removal that must lie under cover. */
const HIDDEN_SHARE = 0.95;
/** Same-hole separation: penetrations within 0.4 mm push apart, by at most 0.3 mm. */
const SAME_HOLE_RADIUS = 4;
const SAME_HOLE_SHIFT = 3;
/** Perforation relief on leather: neighbours within 1 mm push apart, by at most 0.3 mm. */
const PERFORATION_RADIUS = 10;
const PERFORATION_SHIFT = 3;
/** Penetrations only move if both their stitches are at least this long (0.1 mm). */
const NUDGE_MIN_STITCH = 15;

/**
 * 'thread' lowers the thread per area, 'holes' only moves penetrations (no thread is removed
 * beyond clean-up and covered fill ends), 'both' does everything.
 */
export type CorrectionFocus = 'thread' | 'holes' | 'both';

export interface CorrectionOptions {
  /** 'caution' clears Caution and Critical cells, 'critical' only Critical ones. */
  goal: 'caution' | 'critical';
  focus: CorrectionFocus;
  /** Only touch cells inside this rectangle (mm, world coordinates), e.g. one zone. */
  region?: { minX: number; minY: number; maxX: number; maxY: number };
  /**
   * The user's decisions about findings. Zones that are acknowledged or normal in practice (and not
   * reopened) are not corrected, only kept from getting worse.
   */
  acks?: Acknowledgement[];
}

export const DEFAULT_CORRECTION: CorrectionOptions = { goal: 'critical', focus: 'both' };

const FOCI: readonly CorrectionFocus[] = ['thread', 'holes', 'both'];

/** Valid options from stored settings (older versions stored separate switches). */
export function normalizeCorrection(c: Partial<CorrectionOptions> | undefined): Omit<CorrectionOptions, 'region'> {
  return {
    goal: c?.goal === 'caution' ? 'caution' : 'critical',
    focus: FOCI.includes(c?.focus as CorrectionFocus) ? c!.focus! : DEFAULT_CORRECTION.focus,
  };
}

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
  /** Fill row ends pulled back from under satin borders. */
  pulledBack: number;
  /** Satin stitches shortened on the inside of curves. */
  shortened: number;
  /** Covered fill row pairs removed. */
  hiddenRows: number;
  /** Fills and satins rebuilt at a wider even spacing, and the rows or zigzags that saved. */
  respaced: number;
  respacedRows: number;
  /** Penetrations pushed apart. */
  moved: number;
  stitchesBefore: number;
  stitchesAfter: number;
  /** Thread length of real stitches, mm. */
  threadBefore: number;
  threadAfter: number;
  /** Remaining zones that are normal in practice, acknowledged by the user, or still need a look. */
  practice: number;
  acknowledged: number;
  manual: number;
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
 * Per 1 mm cell: the share by which the thread should drop to get MARGIN below the density limit,
 * and which cells are flagged at all (for the goal, inside the region).
 */
interface Field {
  m: Measurement;
  /** Share (0 to 1) by which the stitches should thin out, from the rules the focus covers. */
  need: Float32Array;
  flagged: Uint8Array;
  shorts: Uint8Array;
  perforation: Uint8Array;
  any: boolean;
}

function field(v: ValidationResult, opts: CorrectionOptions): Field {
  const m = v.measurement;
  const th = v.thresholds;
  const n = m.cols * m.rows;
  const need = new Float32Array(n);
  const flagged = new Uint8Array(n);
  const shorts = new Uint8Array(n);
  const perforation = new Uint8Array(n);
  const minLevel = opts.goal === 'caution' ? CAUTION : CRITICAL;
  const r = opts.region;
  // Findings that are normal in practice or acknowledged are left as they are.
  const settled = v.zones.map((z) => !!settledBy(z, opts.acks));
  let any = false;
  for (let i = 0; i < n; i++) {
    if (v.level[i] < minLevel) continue;
    if (r) {
      const cx = m.originX + ((i % m.cols) + 0.5) * m.cellMm;
      const cy = m.originY + (Math.floor(i / m.cols) + 0.5) * m.cellMm;
      if (cx < r.minX || cx > r.maxX || cy < r.minY || cy > r.maxY) continue;
    }
    if (v.zoneOf[i] >= 0 && settled[v.zoneOf[i]]) continue;
    any = true;
    flagged[i] = 1;
    const reasons = v.reasons[i];
    // The focus decides which rules ask for fewer stitches: thread density, or penetrations
    // (perforation and short-stitch clusters).
    let f = 0;
    if (reasons & REASON_BITS.density && opts.focus !== 'holes') {
      const [caution, critical] = densityLimits(th, m.satin[i]);
      const target = MARGIN * (minLevel === CAUTION ? caution : critical);
      f = Math.max(f, 1 - target / m.density[i]);
    }
    if (reasons & REASON_BITS.perforation) {
      perforation[i] = 1;
      if (th.holes && opts.focus !== 'thread') {
        const target = (minLevel === CAUTION ? th.holes.caution : th.holes.critical) - 1;
        f = Math.max(f, 1 - target / m.holes[i]);
      }
    }
    if (reasons & REASON_BITS.shortStitches) {
      shorts[i] = 1;
      if (opts.focus !== 'thread') f = Math.max(f, 1 - (SHORT_STITCH_COUNT - 2) / m.shorts[i]);
    }
    need[i] = Math.min(MAX_NEED, Math.max(0, f));
  }
  return { m, need, flagged, shorts, perforation, any };
}

/** Cell index of record i, or -1. */
function cellOf(p: Pattern, m: Measurement, i: number): number {
  const cx = Math.floor(p.x[i] / 10 - m.originX);
  const cy = Math.floor(p.y[i] / 10 - m.originY);
  return cx >= 0 && cy >= 0 && cx < m.cols && cy < m.rows ? cy * m.cols + cx : -1;
}

/** True if record i lies in a marked cell or next to one. */
function near(p: Pattern, f: Field, cells: Uint8Array, i: number): boolean {
  const { m } = f;
  const cx = Math.floor(p.x[i] / 10 - m.originX);
  const cy = Math.floor(p.y[i] / 10 - m.originY);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < m.cols && y < m.rows && cells[y * m.cols + x]) return true;
    }
  }
  return false;
}

/** Flagged cells weighted by level, inside the region: lower is better. */
function score(v: ValidationResult, opts: CorrectionOptions): number {
  const m = v.measurement;
  const r = opts.region;
  let s = 0;
  for (let i = 0; i < v.level.length; i++) {
    if (!v.level[i]) continue;
    if (r) {
      const cx = m.originX + ((i % m.cols) + 0.5) * m.cellMm;
      const cy = m.originY + (Math.floor(i / m.cols) + 0.5) * m.cellMm;
      if (cx < r.minX || cx > r.maxX || cy < r.minY || cy > r.maxY) continue;
    }
    s += v.level[i] === CRITICAL ? 4 : 1;
  }
  return s;
}

/**
 * Records whose stitches in and out lie completely and well inside at least one full layer of later
 * stitching, checked every 0.1 mm along them. A row that crosses a visible gap between two
 * outlines is not hidden, even if both of its ends are.
 */
function hiddenStitches(p: Pattern): Uint8Array {
  const n = p.cmd.length;
  const covered = new Uint8Array(n); // segment ending at i
  const runs = stitchRuns(p);
  walkCovered(p, runs, satinMask(p), (r, cover) => {
    for (let i = runs[r].start + 1; i <= runs[r].end; i++) {
      const dx = p.x[i] - p.x[i - 1];
      const dy = p.y[i] - p.y[i - 1];
      const k = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
      // Deep inside the cover: also 0.4 mm to every side.
      const deep = (x: number, y: number) =>
        cover.later(x, y) >= HIDDEN_COVER &&
        cover.later(x + 4, y) >= HIDDEN_COVER &&
        cover.later(x - 4, y) >= HIDDEN_COVER &&
        cover.later(x, y + 4) >= HIDDEN_COVER &&
        cover.later(x, y - 4) >= HIDDEN_COVER;
      let ok = true;
      for (let j = 0; j <= k && ok; j++) ok = deep(p.x[i - 1] + (dx * j) / k, p.y[i - 1] + (dy * j) / k);
      if (ok) covered[i] = 1;
    }
  });
  const hidden = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (p.cmd[i] !== STITCH) continue;
    const inOk = i === 0 || p.cmd[i - 1] !== STITCH || covered[i];
    const outOk = i + 1 >= n || p.cmd[i + 1] !== STITCH || covered[i + 1];
    if (inOk && outOk && (covered[i] || covered[i + 1])) hidden[i] = 1;
  }
  return hidden;
}

/** Length (0.1 mm) of the stitch ending at record i, or 0 if there is none. */
const segment = (p: Pattern, i: number): number =>
  i > 0 && i < p.cmd.length && p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH ? Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) : Infinity;

const stitchCount = (p: Pattern) => p.cmd.reduce((a, c) => a + (c === STITCH ? 1 : 0), 0);

/** True if record i lies inside the region (mm), or there is none. */
const inRegion = (p: Pattern, opts: CorrectionOptions, i: number): boolean => {
  const r = opts.region;
  return !r || (p.x[i] >= r.minX * 10 && p.x[i] <= r.maxX * 10 && p.y[i] >= r.minY * 10 && p.y[i] <= r.maxY * 10);
};

/**
 * Corrects a design for a material profile. Only the enabled checks are corrected; see the module
 * comment for the steps.
 */
export function autoCorrect(input: Pattern, profile: Profile, opts: CorrectionOptions, checks: Checks = ALL_CHECKS): CorrectionResult {
  let p = input;
  let m = measurePattern(p);
  let v = classify(m, profile, checks);
  let best = score(v, opts);
  const before = summary(v);
  const report: CorrectionReport = {
    before,
    after: before,
    zeroLength: 0,
    merged: 0,
    pulledBack: 0,
    shortened: 0,
    hiddenRows: 0,
    respaced: 0,
    respacedRows: 0,
    moved: 0,
    stitchesBefore: stitchCount(p),
    stitchesAfter: 0,
    threadBefore: patternStats(p).threadLength,
    threadAfter: 0,
    practice: 0,
    acknowledged: 0,
    manual: 0,
  };
  const thread = opts.focus !== 'holes';
  const holes = opts.focus !== 'thread';

  /** Keeps `q` if it is not worse than the current version; returns whether it was kept. */
  const attempt = (q: Pattern): boolean => {
    if (q === p) return false;
    const qm = measurePattern(q);
    const qv = classify(qm, profile, checks);
    const s = score(qv, opts);
    if (s > best) return false;
    p = q;
    m = qm;
    v = qv;
    best = s;
    return true;
  };

  if (field(v, opts).any) {
    // 1. Clean-up.
    const z = removeZeroLength(p, (i) => inRegion(p, opts, i));
    if (attempt(z.pattern)) report.zeroLength = z.removed;

    let f = field(v, opts);
    if (f.any) {
      const cur = p;
      const r = mergeShortStitches(cur, (i) => {
        const c = cellOf(cur, f.m, i);
        return c >= 0 && f.shorts[c] === 1;
      });
      if (attempt(r.pattern)) report.merged = r.removed;
    }

    // 2. Fills under satin borders.
    f = field(v, opts);
    if (f.any) {
      const cur = p;
      const r = pullBackFills(cur, { wanted: (i) => near(cur, f, f.flagged, i) });
      if (attempt(r.pattern)) report.pulledBack = r.moved;
    }

    // 3. Short stitches in satin curves.
    f = field(v, opts);
    if (f.any) {
      const cur = p;
      const r = shortenSatinCurves(cur, { wanted: (i) => near(cur, f, f.flagged, i) });
      if (attempt(r.pattern)) report.shortened = r.moved;
    }

    // 4. Fewer stitches where the focus asks for it: rows hidden under other objects first (thread
    //    focus), then fills and satins re-spaced evenly within the material's recommended range.
    const maxSpacing = recommendedSpacing(profile)[1] * 10;
    for (let round = 0; round < ROUNDS; round++) {
      f = field(v, opts);
      if (!f.any) break;
      let changed = false;
      const needAt = (q: Pattern) => (i: number) => {
        const c = cellOf(q, f.m, i);
        return c >= 0 ? f.need[c] : 0;
      };
      if (thread) {
        const cur = p;
        const hidden = hiddenStitches(cur);
        const protect = tagShortStitches(cur).map((t) => (t === TIE ? 1 : 0));
        const need = needAt(cur);
        const h = thinSweeps(cur, { needAt: (i) => (hidden[i] ? need(i) : 0), protect, minShare: HIDDEN_SHARE, strict: true });
        if (attempt(h.pattern)) {
          report.hiddenRows += h.cycles;
          changed = true;
          f = field(v, opts);
        }
      }
      let cur = p;
      const fills = respaceFills(cur, { needAt: needAt(cur), maxSpacing });
      if (attempt(fills.pattern)) {
        report.respaced += fills.sweeps;
        report.respacedRows += fills.rows;
        changed = true;
        f = field(v, opts);
      }
      cur = p;
      const satins = respaceSatins(cur, { needAt: needAt(cur), maxSpacing }, satinColumns(cur, undefined, satinMask(cur, ZIGZAG_MIN)));
      if (attempt(satins.pattern)) {
        report.respaced += satins.sweeps;
        report.respacedRows += satins.rows;
        changed = true;
      }
      if (!changed) break;
    }

    // 5. Penetrations: stacked holes (penetration focus only: designs reuse holes on purpose, and
    //    in fine details a 0.3 mm shift changes the look), perforation relief on leather.
    if (holes) {
      f = field(v, opts);
      if (f.any) {
        const tags = tagShortStitches(p);
        const cur = p;
        // Only stitches long enough that a 0.3 mm shift does not change their look.
        const sturdy = (i: number) =>
          tags[i] !== TIE && near(cur, f, f.flagged, i) && segment(cur, i) >= NUDGE_MIN_STITCH && segment(cur, i + 1) >= NUDGE_MIN_STITCH;
        let r = { pattern: cur, moved: 0 };
        if (opts.focus === 'holes') {
          const same = sameHoleStitches(cur);
          r = nudgePenetrations(cur, { movable: (i) => same[i] === 1 && sturdy(i), radius: SAME_HOLE_RADIUS, maxShift: SAME_HOLE_SHIFT });
        }
        let moved = r.moved;
        if (v.thresholds.holes && checks.perforation) {
          const q = r.pattern;
          r = nudgePenetrations(q, {
            movable: (i) => {
              const c = cellOf(q, f.m, i);
              return c >= 0 && f.perforation[c] === 1 && sturdy(i);
            },
            radius: PERFORATION_RADIUS,
            maxShift: PERFORATION_SHIFT,
          });
          moved += r.moved;
        }
        if (attempt(r.pattern)) report.moved = moved;
      }
    }
  }

  // What is left: findings that are normal in practice or acknowledged, and those that need a look.
  const minLevel = opts.goal === 'caution' ? CAUTION : CRITICAL;
  for (const z of v.zones) {
    if (z.level < minLevel) continue;
    if (opts.region && !overlaps(z.bbox, opts.region)) continue;
    const by = settledBy(z, opts.acks);
    if (by === 'practice') report.practice++;
    else if (by === 'manual') report.acknowledged++;
    else report.manual++;
  }
  report.after = summary(v);
  report.stitchesAfter = stitchCount(p);
  report.threadAfter = patternStats(p).threadLength;
  return { pattern: p, measurement: m, report };
}

const overlaps = (a: Zone['bbox'], b: NonNullable<CorrectionOptions['region']>) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
