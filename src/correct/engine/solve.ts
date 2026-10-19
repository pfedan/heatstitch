import { analyze, remembered } from '../../model/restitch';
import { sewObjects, type SewObject } from '../../model/objects';
import type { Pattern } from '../../model/pattern';
import { stitchKinds } from '../../model/sequence';
import type { Acknowledgement } from '../../validation/acks';
import { stableFabric } from '../../validation/practice';
import type { Profile } from '../../validation/profiles';
import { CAUTION, thresholdsFor } from '../../validation/thresholds';
import { ALL_CHECKS, type Checks, type ValidationResult } from '../../validation/validate';
import { core } from '../../wasm/core';
import type { Engine } from '../../wasm/pkg/heatstitch_core';
import { CAUTION_KINDS, cellDiff, cellKey, countingCells, kindsOf, openFor, type CellDiff, type FixKind, type FixTarget } from './cells';
import { merged, toolSets, toolsFor, type Tool, type Variant } from './variants';
import { borderTools, designKey, letteringTools, movesOf, objectsOf, predictable, sewUnit, stitchesOf, unitKey, unitOf, type Unit } from './units';
import { fineFix, fineObjects } from './fine';
import type { solveMip } from './mip';
import { validateDesign } from './validate';
import { lineGeoOf } from '../../model/geo';

/**
 * The correction engine (plans/korrektur-engine-review.md). For one kind of finding, or all of
 * them, it finds the settings changes that clear the most open cells, under hard rules:
 *
 * 1. No cell becomes critical that was not (anywhere in the design, cell by cell).
 * 2. Among the best, the least visible: visibility is measured per change (how much of the object
 *    lies on top, times how strongly the change shows), then new caution area, then objects touched.
 *
 * Steps: find the open cells, find which objects carry them (their share of the thread there),
 * sew the variants a digitizer would try on those objects, put the objects that share open cells
 * into groups, search each group on the fast additive measure, then sew the result for real, check
 * the whole design, and forbid what broke a rule until it holds.
 *
 * The field, the carriers, the groups and the search run in the Rust core (core/src/correct/engine/,
 * one Engine per fix); sewing the variants and checking for real stay here, with the model.
 */

/** A change on one object, as the user sees it. */
export interface ObjectFix {
  index: number;
  kind: SewObject['kind'];
  tools: string[];
  changes: Variant['changes'];
  knockout: boolean;
  /** Measured visibility (0: none). */
  visibility: number;
  /** Shown only as a proposal (visible on any account, or above the direct limit). */
  visible: boolean;
  /** Changes by hand the new stitches replace (0: none). */
  hand: number;
}

export interface FixResult {
  kind: FixTarget;
  /** Open cells (counting) before and after. */
  before: number;
  after: number;
  /** Objects changed and the design with the changes. */
  objects: ObjectFix[];
  pattern: Pattern;
  /** Comparison of the real result with the design as it is. */
  diff: CellDiff | null;
  ms: number;
}

export interface FixOptions {
  checks?: Checks;
  acks?: readonly Acknowledgement[];
  trimMm: number;
  /** Visibility up to which a change is applied directly. */
  directMax?: number;
  /** Allow visible changes (the proposals beyond the direct fix). */
  visible?: boolean;
  /** Also sew objects changed by hand anew from their shape (their hand changes are lost: a proposal). */
  hand?: boolean;
  /** Search per group, in milliseconds of the reference machine: spent as work (Field.work), so the result does not depend on the machine. */
  budgetMs?: number;
  /**
   * Search: large neighbourhoods (default), the exact program, or the program before the search. The
   * program needs `exact` (mip.ts, HiGHS): on the benchmark it never beat the search and took longer,
   * so the app does not load it (2026-10-06).
   */
  solver?: 'lns' | 'mip' | 'both';
  exact?: typeof solveMip;
  /** Stop early (a new edit came in). */
  stale?: () => boolean;
  /** Notes on the search, for the benchmark. */
  log?: (s: string) => void;
}

/** Up to this visibility a change is applied directly (calibrated on the benchmark). */
export const DIRECT_MAX = 0.6;
/** An object takes part in a cell when it carries this share of the thread at the cell's peak. */
const SHARE = 0.15;
/** At most this many objects the search re-spaced are tried without it, for the fine stage (see planFix). */
const KEEP_TRIES = 4;
const MAX_ROUNDS = 3;
/** Search time per group (ms of the reference machine), spent as field work in the core (search.rs). */
const BUDGET_MS = 800;
/** Time for the caution kinds (gaps, too open, long stitches), object by object. */
const LOWER_BUDGET_MS = 6000;
/**
 * The caution kinds' tries are counted as work too: each costs about its records plus 0.7 per
 * validation cell (sewing and checking, fitted on the test set), about 38 of them per millisecond.
 */
const LOWER_WORK_PER_MS = 38;

interface Candidate {
  /** Its index in the engine. */
  ci: number;
  o: SewObject;
  unit: Unit;
  variants: Variant[];
  /** Measured visibility per variant. */
  visibility: number[];
  /** Variants forbidden after a real check failed. */
  banned: Set<number>;
  /** The variant chosen, as the engine last reported it. */
  chosen: number;
  /** Moves and trims of its objects as they are now (see apartOf). */
  base: { moves: number; trims: number };
}

/** Bounds of `p` as the core takes them. */
const boundsOf = (p: Pattern) => Float64Array.of(p.bounds.minX, p.bounds.minY, p.bounds.maxX, p.bounds.maxY);

/**
 * Fixes the open cells of `kind` (or of all kinds) in `p`. Nothing in `p` changes: the result
 * carries the design with the fix.
 */
export async function planFix(p: Pattern, profile: Profile, kind: FixTarget, opt: FixOptions): Promise<FixResult> {
  const t0 = performance.now();
  const checks = opt.checks ?? ALL_CHECKS;
  const v = validateDesign(p, profile, checks);
  const counting = countingCells(v, opt.acks);
  const kinds = kindsOf(kind);
  const openCount = (x: ValidationResult) => {
    const cnt = countingCells(x, opt.acks);
    let n = 0;
    for (let i = 0; i < x.level.length; i++) if (kinds.some((k) => openFor(x, cnt, i, k))) n++;
    return n;
  };
  const before = openCount(v);
  const done = (pattern: Pattern, objects: ObjectFix[], diff: CellDiff | null, after: number): FixResult => ({ kind, before, after, objects, pattern, diff, ms: performance.now() - t0 });
  if (!before) return done(p, [], null, 0);

  let pattern = p;
  let objects: ObjectFix[] = [];
  const upper = kinds.filter((k) => !CAUTION_KINDS.has(k));
  if (upper.length) {
    /** The search, then invisible stitch work on the objects it may touch that the search left alone. */
    const both = async (keep?: Set<number>) => {
      const r = await upperFix(p, v, counting, profile, upper, opt, keep);
      opt.log?.(`upper done t=${Math.round(performance.now() - t0)}`);
      const fine = fineFix(r.pattern, v, profile, upper, { checks, acks: opt.acks, objects: fineObjects(r.pattern, new Set(r.objects.map((x) => x.index))) });
      opt.log?.(`fine: ${fine.steps.join(',') || 'nothing'} on ${fine.objects.join(',')} t=${Math.round(performance.now() - t0)}`);
      const objs = objectsOf(fine.pattern);
      const fixes = fine.objects.map((i): ObjectFix => ({ index: i, kind: objs[i].kind, tools: [...new Set(fine.steps)].map((x) => `fine.${x}`), changes: [], knockout: false, visibility: 0, visible: false, hand: 0 }));
      return { pattern: fine.pattern, objects: [...r.objects, ...fixes].sort((a, b) => a.index - b.index), searched: r.objects };
    };
    let best = await both();
    // Where that leaves cells open, the search again without objects it re-spaced that the fine stage
    // may work on, lowest first, each kept out when that leaves fewer cells open: fills stacked several
    // deep are fixed best by taking out what lies hidden under the top ones, which re-spacing them by
    // a little first rules out.
    const fineOk = fineObjects(p, new Set());
    let open = openCount(validateDesign(best.pattern, profile, checks));
    const keep = new Set<number>();
    for (const i of best.searched.map((x) => x.index).filter((i) => fineOk.has(i)).slice(0, KEEP_TRIES)) {
      if (!open || opt.stale?.()) break;
      const alt = await both(new Set([...keep, i]));
      const n = openCount(validateDesign(alt.pattern, profile, checks));
      opt.log?.(`without ${[...keep, i].join(',')}: open ${n} (was ${open})`);
      if (n >= open) continue;
      keep.add(i);
      best = alt;
      open = n;
    }
    pattern = best.pattern;
    objects = best.objects;
  }
  const lower = kinds.filter((k) => CAUTION_KINDS.has(k));
  if (lower.length) {
    const r = lowerFix(pattern, p, v, profile, checks, lower, opt, new Set(objects.map((x) => x.index)));
    pattern = r.pattern;
    objects = [...objects, ...r.objects].sort((a, b) => a.index - b.index);
  }
  opt.log?.(`lower done t=${Math.round(performance.now() - t0)}`);
  if (pattern === p) return done(p, [], null, before);
  const after = validateDesign(pattern, profile, checks);
  return done(pattern, objects, cellDiff(v, after, opt.acks), openCount(after));
}

/** Density and penetrations: search on the additive field, check for real. Objects in `keep` are not searched. */
async function upperFix(p: Pattern, v: ValidationResult, counting: Uint8Array, profile: Profile, kinds: FixKind[], opt: FixOptions, keep?: Set<number>): Promise<{ pattern: Pattern; objects: ObjectFix[]; hidden: number[] }> {
  cacheDesign(p);
  const e = new (core().Engine)(p.x, p.y, p.cmd, boundsOf(p), thresholdsFor(profile), stableFabric(profile));
  try {
    return await search(e, p, v, counting, profile, kinds, opt, keep);
  } finally {
    e.free();
  }
}

async function search(e: Engine, p: Pattern, v: ValidationResult, counting: Uint8Array, profile: Profile, kinds: FixKind[], opt: FixOptions, keep?: Set<number>): Promise<{ pattern: Pattern; objects: ObjectFix[]; hidden: number[] }> {
  const tStart = performance.now();
  const th = thresholdsFor(profile);
  const fc = e.fieldCells(Float64Array.from(v.level, (_, i) => cellKey(v, i)));
  const kindsArr = stitchKinds(p);
  const objs = sewObjects(p, kindsArr);
  // Open cells, on the field.
  const targets: number[] = [];
  for (let i = 0; i < v.level.length; i++) {
    if (fc[i] < 0 || !kinds.some((k) => openFor(v, counting, i, k))) continue;
    targets.push(fc[i]);
  }
  e.setTarget(Uint32Array.from(targets));
  e.addObjects(p.x, p.y, p.cmd, Float64Array.from(objs.flatMap((o) => [o.first, o.last, o.minX, o.minY, o.maxX, o.maxY])));
  const hidden = Array.from(e.hiddenShares());
  // Who carries each open cell.
  const carriers = new Map<number, number[]>();
  const flat = e.carriers(SHARE, kinds.includes('holes'));
  for (let i = 0; i < flat.length; ) {
    const c = flat[i];
    const n = flat[i + 1];
    carriers.set(c, Array.from(flat.subarray(i + 2, i + 2 + n)));
    i += 2 + n;
  }
  // Candidates: the units (sets of settings) that may be changed, with their variants.
  opt.log?.(`field and carriers t=${Math.round(performance.now() - tStart)}`);
  const want = new Set<FixKind>(kinds);
  const cands = new Map<number, Candidate>();
  const unitCand = new Map<string, Candidate>();
  const threads = new Map<string, { top: number; under: number }>();
  for (const idx of new Set([...carriers.values()].flat())) {
    if (opt.stale?.()) break;
    const u = unitOf(p, objs, objs[idx], kindsArr, opt.hand);
    if (!('kind' in u) || u.objects.some((i) => keep?.has(i))) continue;
    const key = unitKey(u);
    const had = unitCand.get(key);
    if (had) {
      cands.set(idx, had);
      continue;
    }
    const owner = objs[u.owner];
    let tools: Tool[];
    if (u.kind === 'lettering') tools = letteringTools(u, want);
    else if (u.kind === 'border') tools = borderTools(u, want, profile);
    else tools = toolsFor(p, objs, owner, u.settings, want, profile, analyze(p, owner, kindsArr).fill?.areaMm2 ?? 0);
    tools = tools.filter((t) => opt.visible || !t.visible);
    if (!tools.length) continue;
    const predictOk = !(want.has('holes') && th.holes);
    const built = buildVariants(p, e, threads, u, tools, opt.trimMm, predictOk);
    if (built.variants.length < 2) continue;
    const { variants, contributions } = built;
    // Visibility: where the unit's objects lie on top.
    const hid = u.objects.reduce((a, i) => a + hidden[i] * objs[i].threadMm, 0) / Math.max(1e-6, u.objects.reduce((a, i) => a + objs[i].threadMm, 0));
    // Sewing over changes by hand shows: a proposal only.
    const hand = u.objects.some((i) => remembered(p, objs[i])?.hand);
    // A trim or a jump a change adds counts like a visible change: a fix does not sew apart what was one.
    const visibility = variants.map((x, k) => (!k ? 0 : x.visible || hand ? 1 : x.strength * (1 - hid) + (x.apart ?? 0)));
    const banned = new Set<number>();
    variants.forEach((_, k) => {
      if (k && !opt.visible && visibility[k] > (opt.directMax ?? DIRECT_MAX)) banned.add(k);
    });
    const ci = e.addCandidate(Uint32Array.from(contributions), Float64Array.from(visibility), Uint8Array.from(variants, (_, k) => (banned.has(k) ? 1 : 0)));
    const c: Candidate = { ci, o: owner, unit: u, variants, visibility, banned, chosen: 0, base: built.base };
    unitCand.set(key, c);
    cands.set(idx, c);
    await Promise.resolve();
  }
  opt.log?.(`targets ${targets.length} carriers ${[...new Set([...carriers.values()].flat())].join(',')} units ${[...unitCand.values()].map((c) => `${unitKey(c.unit)}:${c.variants.length}v`).join(' ')} t=${Math.round(performance.now() - tStart)}`);
  if (!cands.size) return { pattern: p, objects: [], hidden };
  // Groups: units sharing an open cell (formed in the core).
  const objCand = new Int32Array(objs.length).fill(-1);
  for (const [idx, c] of cands) objCand[idx] = c.ci;
  const groups = e.link(objCand);
  const all = [...unitCand.values()];
  const sync = () => {
    const ch = e.chosen();
    for (const c of all) c.chosen = ch[c.ci];
  };
  const ban = (c: Candidate, k: number) => {
    c.banned.add(k);
    e.ban(c.ci, k);
  };

  const solveGroup = async (g: number) => {
    const combos = e.beginGroup(g);
    const mode = opt.solver ?? 'lns';
    if (mode !== 'lns' && opt.exact && combos > 1) {
      const r = await opt.exact(e, g, opt.budgetMs ?? BUDGET_MS);
      if (r) opt.log?.(`mip ${r.status} rows ${r.rows} cols ${r.cols}`);
      if (e.mipResult(g, r ? Uint32Array.from(r.choice) : undefined, mode === 'mip')) return;
    }
    e.searchGroup(g, opt.budgetMs ?? BUDGET_MS);
  };

  let pattern = p;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const ts = performance.now();
    for (let g = 0; g < groups; g++) await solveGroup(g);
    sync();
    opt.log?.(`search ${Math.round(performance.now() - ts)}ms groups ${groups}`);
    if (opt.stale?.()) break;
    // Sew the choice for real and check the whole design.
    const chosen = all.filter((c) => c.chosen).sort((a, b) => a.o.index - b.o.index);
    pattern = applyChoice(p, chosen, opt.trimMm, opt.hand);
    // What was predicted is known now: its real thread replaces the prediction, and how much
    // more it is sewn apart counts from now on (too much for a direct fix: tried again without).
    const apart: Candidate[] = [];
    for (const c of chosen) {
      const x = c.variants[c.chosen];
      if (!x.predicted) continue;
      const st = stitchesOf(pattern, c.unit.objects);
      e.replace(c.ci, st.x, st.y, st.cmd, boundsOf(st));
      x.predicted = false;
      const more = apartOf(st, c.base) - (x.apart ?? 0);
      if (more <= 0 || c.visibility[c.chosen] >= 1) continue;
      x.apart = (x.apart ?? 0) + more;
      c.visibility[c.chosen] += more;
      e.setVisibility(c.ci, c.chosen, c.visibility[c.chosen]);
      if (!opt.visible && c.visibility[c.chosen] > (opt.directMax ?? DIRECT_MAX)) apart.push(c);
    }
    const after = validateDesign(pattern, v.profile, v.checks);
    const diff = cellDiff(v, after, opt.acks);
    const bad = [...new Set([...apart, ...blame(p, pattern, chosen, diff, after)])];
    opt.log?.(`verify t=${Math.round(performance.now() - tStart)}`);
    const [fixed, newCritical, newCaution] = e.tally();
    opt.log?.(`round ${round}: tally ${JSON.stringify({ fixed, newCritical, newCaution })} chosen ${chosen.map((c) => `${c.o.index}:${c.variants[c.chosen].tools.map((t) => t.id).join('+')}`).join(' ')} real new crit ${diff.newCritical} gs ${diff.newGapSparse} crit ${diff.criticalBefore}>${diff.criticalAfter} bad ${bad.map((c) => c.o.index).join(',')}`);
    if (!bad.length) break;
    for (const c of bad) ban(c, c.chosen);
    if (round === MAX_ROUNDS - 1) {
      // Still breaking a rule: leave those objects as they are, until the design checks out (blame
      // goes by the objects' boxes, so the one to blame may come up only once the others are back).
      for (let left = bad; left.length; ) {
        for (const c of left) {
          e.choose(c.ci, 0);
          c.variants.forEach((_, k) => k && ban(c, k));
        }
        sync();
        const still = all.filter((c) => c.chosen).sort((a, b) => a.o.index - b.o.index);
        pattern = applyChoice(p, still, opt.trimMm, opt.hand);
        if (!still.length) break;
        const check = validateDesign(pattern, v.profile, v.checks);
        left = blame(p, pattern, still, cellDiff(v, check, opt.acks), check);
      }
    }
  }
  const objects = all
    .filter((c) => c.chosen)
    .sort((a, b) => a.o.index - b.o.index)
    .map((c) => {
      const x = c.variants[c.chosen];
      return { index: c.o.index, kind: c.o.kind, tools: x.tools.map((t) => t.id), changes: x.changes, knockout: x.knockout, visibility: c.visibility[c.chosen], visible: x.visible || c.visibility[c.chosen] > (opt.directMax ?? DIRECT_MAX), hand: handOf(p, c.unit, objs) };
    });
  return { pattern, objects, hidden };
}

/** Sews the chosen variants into the design, object by object. */
function applyChoice(p: Pattern, chosen: Candidate[], trimMm: number, hand = false): Pattern {
  let cur = p;
  for (const c of chosen) {
    const x = c.variants[c.chosen];
    // Settings of other units are taken from what the object remembers now: unchanged by the others.
    const u = refreshed(cur, c.unit, hand);
    const next = u && sewUnit(cur, u, x.changes, x.knockout, trimMm);
    if (next) cur = next;
  }
  return cur;
}

/** The chosen objects whose stitches reach new critical cells or new gaps / too open cells. */
function blame(p: Pattern, after: Pattern, chosen: Candidate[], diff: CellDiff, va: ValidationResult): Candidate[] {
  if (!diff.newCritical && diff.newGapSparse <= 2) return [];
  const keys = new Set(diff.newCriticalKeys);
  if (diff.newGapSparse > 2) {
    for (let i = 0; i < va.level.length; i++) if (va.reasons[i] & (8 | 16)) keys.add(cellKey(va, i));
  }
  const objs = objectsOf(after);
  const out: Candidate[] = [];
  for (const c of chosen) {
    const os = c.unit.objects.map((i) => objs[i]).filter(Boolean);
    if (!os.length) continue;
    const x0 = Math.floor(Math.min(...os.map((o) => o.minX)) / 10) - 1;
    const x1 = Math.ceil(Math.max(...os.map((o) => o.maxX)) / 10) + 1;
    const y0 = Math.floor(Math.min(...os.map((o) => o.minY)) / 10) - 1;
    const y1 = Math.ceil(Math.max(...os.map((o) => o.maxY)) / 10) + 1;
    let hit = false;
    for (const k of keys) {
      const kx = (k % 100000) - 50000;
      const ky = Math.floor(k / 100000) - 50000;
      if (kx >= x0 && kx <= x1 && ky >= y0 && ky <= y1) {
        hit = true;
        break;
      }
    }
    if (hit) out.push(c);
  }
  void p;
  return out.length ? out : chosen.filter((c) => c.chosen);
}

/**
 * Gaps, fabric showing through and long stitches: not additive, so tried for real, object by
 * object, least visible first. A change is kept when it clears open cells of the kind around the
 * object and no cell becomes critical.
 */
function lowerFix(p: Pattern, orig: Pattern, v0: ValidationResult, profile: Profile, checks: Checks, kinds: FixKind[], opt: FixOptions, taken: Set<number>): { pattern: Pattern; objects: ObjectFix[] } {
  let cur = p;
  const want = new Set<FixKind>(kinds);
  const gaps = want.has('gap');
  let v = validateDesign(cur, profile, checks, gaps);
  const objects: ObjectFix[] = [];
  const kindsArr = stitchKinds(cur);
  const objs = sewObjects(cur, kindsArr);
  const openIn = (x: ValidationResult, o: SewObject) => {
    const cnt = countingCells(x, opt.acks);
    const m = x.measurement;
    let n = 0;
    const c0 = Math.max(0, Math.floor(o.minX / 10 - m.originX) - 1);
    const c1 = Math.min(m.cols - 1, Math.floor(o.maxX / 10 - m.originX) + 1);
    const r0 = Math.max(0, Math.floor(o.minY / 10 - m.originY) - 1);
    const r1 = Math.min(m.rows - 1, Math.floor(o.maxY / 10 - m.originY) + 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (kinds.some((k) => openFor(x, cnt, r * m.cols + c, k))) n++;
    return n;
  };
  // Most open cells first, within a work budget (the same tries on any machine): each try sews and checks the whole design.
  let work = 0;
  const order = objs.map((o) => ({ o, n: taken.has(o.index) ? 0 : openIn(v, o) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  let curObjs = { p: cur, kinds: kindsArr, objs };
  for (const { o: o0 } of order) {
    if (opt.stale?.() || work > LOWER_BUDGET_MS * LOWER_WORK_PER_MS) break;
    if (taken.has(o0.index)) continue;
    if (curObjs.p !== cur) curObjs = { p: cur, kinds: stitchKinds(cur), objs: objectsOf(cur) };
    const { kinds: ka, objs: now } = curObjs;
    const o = now[o0.index];
    const open = openIn(v, o);
    if (!open) continue;
    const u = unitOf(cur, now, o, ka, opt.hand);
    if (!('kind' in u) || u.kind === 'lettering' || taken.has(u.owner)) continue;
    const owner = now[u.owner];
    const hand = handOf(cur, u, now);
    if (hand && !opt.visible) continue;
    const all: Tool[] = u.kind === 'border' ? borderTools(u, want, profile) : toolsFor(cur, now, owner, u.settings, want, profile, analyze(cur, owner, ka).fill?.areaMm2 ?? 0);
    const tools = all.filter((t) => !t.visible && t.kinds.some((k) => want.has(k)));
    for (const t of tools) {
      const vis = t.strength;
      if (vis > (opt.directMax ?? DIRECT_MAX) && !opt.visible) continue;
      const next = sewUnit(cur, u, t.changes, !!t.knockout, opt.trimMm);
      if (!next) continue;
      const vn = validateDesign(next, profile, checks, gaps);
      work += next.cmd.length + 0.7 * vn.level.length;
      const d = cellDiff(v0, vn, opt.acks);
      if (d.newCritical) continue;
      if (openIn(vn, objectsOf(next)[o.index]) >= open) continue;
      cur = next;
      v = vn;
      taken.add(u.owner);
      objects.push({ index: u.owner, kind: owner.kind, tools: [t.id], changes: t.changes, knockout: !!t.knockout, visibility: hand ? 1 : vis, visible: hand > 0, hand });
      break;
    }
  }
  void orig;
  return { pattern: cur, objects };
}

export { CAUTION };

/** Whether object `index` was sewn here (its settings are remembered, not measured from stitches). */
function sewnHere(p: Pattern, index: number): boolean {
  const m = remembered(p, objectsOf(p)[index]);
  return !!(m?.fill || m?.satin || lineGeoOf(m));
}

/**
 * What one more trim, and one more jump without a trim, costs a variant, in visibility: two more
 * trims are more than a change applied directly may show (DIRECT_MAX).
 */
const TRIM_COST = 0.35;
const JUMP_COST = 0.1;

/** How much more stitches `st` are sewn apart than `base` (see TRIM_COST). */
function apartOf(st: Pattern, base: { moves: number; trims: number }): number {
  const m = movesOf(st);
  return Math.max(0, m.trims - base.trims) * TRIM_COST + Math.max(0, m.moves - m.trims - (base.moves - base.trims)) * JUMP_COST;
}

/** Most variants a unit gets (least visible first). */
const MAX_VARIANTS = 36;

/**
 * The variants of unit `u`: changes that have to be sewn to be known (leaving out, satin spacing
 * by width, short stitches, another underlay kind) are sewn; on each of them, looser rows and less
 * underlay are predicted from its thread (top stitches scaled, underlay taken away), since sewing a
 * large fill again for every spacing step costs seconds. Predicted variants are sewn when chosen.
 * Their contributions are ids in engine `e`; `threads` keeps the sewn ones of this engine by key.
 */
function buildVariants(p: Pattern, e: Engine, threads: Map<string, { top: number; under: number }>, u: Unit, tools: Tool[], trimMm: number, predictOk: boolean): { variants: Variant[]; contributions: number[]; base: { moves: number; trims: number } } {
  const pred = predictOk ? tools.filter((t) => predictable(t)) : [];
  const real = tools.filter((t) => !pred.includes(t));
  const realSets: Tool[][] = [[], ...toolSets(real, 6)];
  const scales: (Tool | null)[] = [null, ...pred.filter((t) => predictable(t)!.scale !== undefined)];
  const unders: (Tool | null)[] = [null, ...pred.filter((t) => predictable(t)!.under !== undefined)];
  const variants: Variant[] = [];
  const contributions: number[] = [];
  // Stitches from elsewhere change when sewn here even with the same settings: what is predicted
  // starts from them sewn here, not from the stitches in the file.
  const foreign = u.kind === 'object' && !sewnHere(p, u.owner);
  const uk = `${unitKey(u)}|${trimMm}`;
  const base = movesOf(stitchesOf(p, u.objects));
  /** Top and underlay thread of stitches `st` in the engine, once per key (`file`: all of it is top). */
  const threadOf = (key: string, st: Pattern & { under?: Uint8Array }, file: boolean) => {
    let t = threads.get(key);
    if (!t) {
      const b = boundsOf(st);
      const top = e.contribution(st.x, st.y, st.cmd, b, file ? undefined : st.under!.map((x) => (x ? 0 : 1)));
      const under = e.contribution(st.x, st.y, st.cmd, b, file ? new Uint8Array(st.cmd.length) : st.under!.map((x) => (x ? 1 : 0)));
      threads.set(key, (t = { top, under }));
    }
    return t;
  };
  for (const set of realSets) {
    const knockout = set.some((t) => t.knockout);
    if (!set.length && foreign && !variants.length) {
      // The file's own stitches as they are, then the same sewn here as the base of the predictions.
      const st0 = stitchesOf(p, u.objects);
      variants.push({ tools: [], changes: [], knockout: false, stitches: st0, strength: 0, visible: false });
      contributions.push(threadOf(`${uk}|file`, st0, true).top);
    }
    const key = `${uk}|${set.map((t) => t.id).sort().join('+')}`;
    const sewn = sewnOnce(key, () => {
      const next = set.length || foreign ? sewUnit(p, u, merged(set), knockout, trimMm, true) : p;
      if (!next) return null;
      return { st: stitchesOf(next, u.objects) };
    });
    if (!sewn) {
      if (!set.length && foreign) break;
      continue;
    }
    const { st } = sewn;
    const { top, under } = threadOf(key, st, false);
    for (const sc of scales) {
      for (const un of unders) {
        const all = [...set, ...(sc ? [sc] : []), ...(un ? [un] : [])];
        // Sewn here without a change: kept only as the base of predictions for stitches from elsewhere.
        if (foreign && !all.length) continue;
        const pu = un ? predictable(un)!.under! : 1;
        // 'covered': underlay only where the objects sewn after the unit leave it uncovered.
        const c = e.blend(top, under, sc ? predictable(sc)!.scale! : 1, pu === 'covered' ? 1 : pu, pu === 'covered' ? Math.max(...u.objects) : -1);
        variants.push({ tools: all, changes: merged(all), knockout, stitches: sc || un ? undefined : st, strength: Math.max(0, ...all.map((t) => t.strength)), visible: all.some((t) => t.visible), predicted: !!(sc || un), apart: apartOf(st, base) });
        contributions.push(c);
      }
    }
  }
  // The current one first, then the least visible.
  const order = variants.map((_, k) => k).filter((k) => k > 0).sort((a, b) => variants[a].strength - variants[b].strength || variants[a].tools.length - variants[b].tools.length).slice(0, MAX_VARIANTS - 1);
  return { variants: [variants[0], ...order.map((k) => variants[k])], contributions: [contributions[0], ...order.map((k) => contributions[k])], base };
}

/**
 * The stitches of a unit sewn with a set of tools, kept for the design they were sewn on: the
 * Ampel works out several fixes of one design (each kind, the rest, all together), and they try
 * the same variants. Null: it could not be sewn.
 */
interface Sewn {
  st: Pattern & { under: Uint8Array };
}
const sewnCache = new Map<string, Sewn | null>();
let sewnFor = '';

/** Starts the cache for design `p` (forgets the one before). */
function cacheDesign(p: Pattern): void {
  const k = designKey(p);
  if (k === sewnFor) return;
  sewnFor = k;
  sewnCache.clear();
}

function sewnOnce(key: string, make: () => Sewn | null): Sewn | null {
  if (!sewnCache.has(key)) sewnCache.set(key, make());
  return sewnCache.get(key)!;
}

/** Changes by hand on the objects of unit `u`. */
function handOf(p: Pattern, u: Unit, objs = objectsOf(p)): number {
  return u.objects.reduce((a, i) => a + (remembered(p, objs[i])?.hand ?? 0), 0);
}

/** Unit `u` as found in `p` now (after other units were sewn anew). */
function refreshed(p: Pattern, u: Unit, hand = false): Unit | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const o = objs[u.kind === 'border' ? u.objects[0] : u.owner];
  const r = o && unitOf(p, objs, o, kinds, hand);
  return r && 'kind' in r ? r : null;
}
