import type { Pattern } from '../../model/pattern';
import { forget, remembered } from '../../model/restitch';
import type { Acknowledgement } from '../../validation/acks';
import type { Profile } from '../../validation/profiles';
import { tagShortStitches, TIE } from '../../validation/shortStitches';
import { densityLimits, SHORT_STITCH_COUNT } from '../../validation/thresholds';
import type { Checks, ValidationResult } from '../../validation/validate';
import { REASON_BITS } from '../../validation/zones';
import { hiddenStitches } from '../auto';
import { pullBackFills } from '../pullback';
import { shortenSatinCurves } from '../satinShort';
import { mergeShortStitches, removeZeroLength } from '../shorts';
import { thinSweeps } from '../thin';
import { cellDiff, countingCells, openFor, type FixKind } from './cells';
import { objectsOf } from './units';
import { validateDesign } from './validate';
import { lineGeoOf } from '../../model/geo';

/**
 * The fine stage: stitch work that does not show, on objects whose settings cannot be changed here
 * (stitches from another file, changed by hand). Clean-up of stitches without movement and of
 * chains of tiny stitches, fill ends pulled back from under satin borders, short stitches on the
 * inside of satin curves, and rows thinned where a later object covers them completely. Never a
 * re-spacing: that shows. Each step is kept only when no cell becomes critical that was not
 * (against the design as it was) and fewer cells are open.
 */

/** Thinning aims this far below the limit. */
const MARGIN = 0.9;
/** At most this share of a sweep is removed per round. */
const MAX_NEED = 0.5;
const ROUNDS = 3;
const HIDDEN_SHARE = 0.95;

/** The steps of the fine stage; each one also names it in "Von der Korrektur geändert" (fixText). */
export const FINE_STEPS = ['zeroLength', 'mergeShort', 'pullBack', 'satinShort', 'hiddenRows'] as const;
export type FineStep = (typeof FINE_STEPS)[number];

export interface FineOptions {
  checks: Checks;
  acks?: readonly Acknowledgement[];
  /** Objects (index) whose stitches may change. */
  objects: Set<number>;
}

export interface FineResult {
  pattern: Pattern;
  /** Objects whose stitches changed. */
  objects: number[];
  steps: FineStep[];
}

/** Objects of `p` the fine stage may work on: from elsewhere or changed by hand, not locked. */
export function fineObjects(p: Pattern, skip: Set<number>): Set<number> {
  const out = new Set<number>();
  for (const o of objectsOf(p)) {
    if (skip.has(o.index)) continue;
    const m = remembered(p, o);
    if (m?.lock || m?.free || m?.lettering) continue;
    const here = !!(m?.fill || m?.satin || lineGeoOf(m));
    if (!here || m?.hand) out.add(o.index);
  }
  return out;
}

export function fineFix(p: Pattern, v0: ValidationResult, profile: Profile, kinds: FixKind[], opt: FineOptions): FineResult {
  const steps: FineStep[] = [];
  if (!opt.objects.size) return { pattern: p, objects: [], steps };
  const n0 = objectsOf(p).length;
  const openCount = (x: ValidationResult) => {
    const cnt = countingCells(x, opt.acks);
    let k = 0;
    for (let i = 0; i < x.level.length; i++) if (kinds.some((f) => openFor(x, cnt, i, f))) k++;
    return k;
  };
  let cur = p;
  let v = validateDesign(cur, profile, opt.checks, false);
  let open = openCount(v);
  const changed = new Set<number>();

  /** Records of the objects that may change, as a mask over `q`. */
  const mask = (q: Pattern) => {
    const out = new Uint8Array(q.cmd.length);
    for (const o of objectsOf(q)) if (opt.objects.has(o.index)) out.fill(1, o.first, o.last + 1);
    return out;
  };
  /** Per open cell of `x`: the share by which the stitches there should thin out. */
  const needOf = (x: ValidationResult) => {
    const m = x.measurement;
    const cnt = countingCells(x, opt.acks);
    const need = new Float32Array(x.level.length);
    for (let i = 0; i < need.length; i++) {
      if (!kinds.some((k) => openFor(x, cnt, i, k))) continue;
      let f = 0;
      if (x.reasons[i] & REASON_BITS.density) f = Math.max(f, 1 - (MARGIN * densityLimits(x.thresholds, m.satin[i])[1]) / m.density[i]);
      if (x.reasons[i] & REASON_BITS.perforation && x.thresholds.holes) f = Math.max(f, 1 - (x.thresholds.holes.critical - 1) / m.holes[i]);
      if (x.reasons[i] & REASON_BITS.shortStitches) f = Math.max(f, 1 - (SHORT_STITCH_COUNT - 2) / m.shorts[i]);
      need[i] = Math.min(MAX_NEED, Math.max(0, f));
    }
    return need;
  };
  const cellOf = (q: Pattern, x: ValidationResult, i: number) => {
    const m = x.measurement;
    const cx = Math.floor(q.x[i] / 10 - m.originX);
    const cy = Math.floor(q.y[i] / 10 - m.originY);
    return cx >= 0 && cy >= 0 && cx < m.cols && cy < m.rows ? cy * m.cols + cx : -1;
  };
  /** Record i of `q` lies in an open cell or next to one. */
  const nearOpen = (q: Pattern, x: ValidationResult, need: Float32Array, i: number) => {
    const m = x.measurement;
    const cx = Math.floor(q.x[i] / 10 - m.originX);
    const cy = Math.floor(q.y[i] / 10 - m.originY);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const a = cx + dx;
        const b = cy + dy;
        if (a >= 0 && b >= 0 && a < m.cols && b < m.rows && need[b * m.cols + a] > 0) return true;
      }
    }
    return false;
  };
  const attempt = (name: FineStep, q: Pattern): boolean => {
    if (q === cur || objectsOf(q).length !== n0) return false;
    const vq = validateDesign(q, profile, opt.checks, false);
    if (cellDiff(v0, vq, opt.acks).newCritical) return false;
    const oq = openCount(vq);
    if (oq >= open) return false;
    // Which objects changed: compare their stitch counts and ends.
    const a = objectsOf(cur);
    const b = objectsOf(q);
    for (const k of opt.objects) if (a[k].last - a[k].first !== b[k].last - b[k].first || a[k].threadMm !== b[k].threadMm) changed.add(k);
    cur = q;
    v = vq;
    open = oq;
    steps.push(name);
    return true;
  };

  let need = needOf(v);
  let ok = mask(cur);
  {
    const q = cur;
    attempt('zeroLength', removeZeroLength(q, (i) => ok[i] === 1 && nearOpen(q, v, need, i)).pattern);
  }
  if (kinds.includes('holes')) {
    need = needOf(v);
    ok = mask(cur);
    const q = cur;
    attempt('mergeShort', mergeShortStitches(q, (i) => ok[i] === 1 && nearOpen(q, v, need, i)).pattern);
  }
  need = needOf(v);
  ok = mask(cur);
  {
    const q = cur;
    attempt('pullBack', pullBackFills(q, { wanted: (i) => ok[i] === 1 && nearOpen(q, v, need, i) }).pattern);
  }
  need = needOf(v);
  ok = mask(cur);
  {
    const q = cur;
    attempt('satinShort', shortenSatinCurves(q, { wanted: (i) => ok[i] === 1 && nearOpen(q, v, need, i) }).pattern);
  }
  for (let round = 0; round < ROUNDS && open; round++) {
    need = needOf(v);
    ok = mask(cur);
    const q = cur;
    const hidden = hiddenStitches(q);
    const protect = tagShortStitches(q).map((t) => (t === TIE ? 1 : 0));
    const vq = v;
    const h = thinSweeps(q, {
      needAt: (i) => {
        if (!ok[i] || !hidden[i]) return 0;
        const c = cellOf(q, vq, i);
        return c >= 0 ? need[c] : 0;
      },
      protect,
      minShare: HIDDEN_SHARE,
      strict: true,
    });
    if (!attempt('hiddenRows', h.pattern)) break;
  }
  // What the objects remember (read from stitches, changed by hand) goes with their new stitches.
  const was = objectsOf(p);
  const now = objectsOf(cur);
  for (const k of changed) {
    const m = remembered(p, was[k]);
    if (m) forget(cur, now[k], m);
  }
  return { pattern: cur, objects: [...changed].sort((a, b) => a - b), steps };
}
