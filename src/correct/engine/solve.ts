import { analyze } from '../../model/restitch';
import { sewObjects, type SewObject } from '../../model/objects';
import type { Pattern } from '../../model/pattern';
import { stitchKinds } from '../../model/sequence';
import type { Acknowledgement } from '../../validation/acks';
import { stableFabric } from '../../validation/practice';
import type { Profile } from '../../validation/profiles';
import { CAUTION, CRITICAL, SAFE, thresholdsFor } from '../../validation/thresholds';
import { ALL_CHECKS, type Checks, type ValidationResult } from '../../validation/validate';
import { CAUTION_KINDS, cellDiff, cellKey, countingCells, openFor, type CellDiff, type FixKind } from './cells';
import { Field, type Contribution } from './field';
import { merged, toolSets, toolsFor, type Tool, type Variant } from './variants';
import { borderTools, letteringTools, predictable, sewUnit, stitchesOf, unitKey, unitOf, type Unit } from './units';
import { validateDesign } from './validate';

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
 * into groups, search each group on the fast additive measure (field.ts), then sew the result for
 * real, check the whole design, and forbid what broke a rule until it holds.
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
}

export interface FixResult {
  kind: FixKind | 'all';
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
  /** Time for the search per group (ms). */
  budgetMs?: number;
  /** Stop early (a new edit came in). */
  stale?: () => boolean;
  /** Notes on the search, for the benchmark. */
  log?: (s: string) => void;
}

/** Up to this visibility a change is applied directly (calibrated on the benchmark). */
export const DIRECT_MAX = 0.6;
/** An object takes part in a cell when it carries this share of the thread at the cell's peak. */
const SHARE = 0.15;
/** Later thread (mm/mm²) from which an object's thread counts as covered. */
const HIDDEN = 2.2;
const MAX_ROUNDS = 3;
/** Groups with at most this many combinations are searched completely. */
const EXHAUSTIVE = 1500;

interface Candidate {
  o: SewObject;
  unit: Unit;
  variants: Variant[];
  contributions: Contribution[];
  /** Measured visibility per variant. */
  visibility: number[];
  /** Variants forbidden after a real check failed. */
  banned: Set<number>;
  chosen: number;
}

/** Field cell of each validation cell (by world key). */
function fieldCells(f: Field, v: ValidationResult): Int32Array {
  const byKey = new Map<number, number>();
  for (let c = 0; c < f.level.length; c++) byKey.set(f.keyOf(c), c);
  const out = new Int32Array(v.level.length).fill(-1);
  for (let i = 0; i < v.level.length; i++) out[i] = byKey.get(cellKey(v, i)) ?? -1;
  return out;
}

/** Sub-cell of the peak of cell `c` and the thread there. */
function peakOf(f: Field, c: number): { sx: number; sy: number; t: number } {
  const cx = c % f.cols;
  const cy = (c - cx) / f.cols;
  let best = { sx: cx * 5, sy: cy * 5, t: -1 };
  for (let y = cy * 5; y < cy * 5 + 5; y++) for (let x = cx * 5; x < cx * 5 + 5; x++) if (f.total[y * f.scols + x] > best.t) best = { sx: x, sy: y, t: f.total[y * f.scols + x] };
  return best;
}

const at = (m: Contribution['map'], sx: number, sy: number): number => {
  const x = sx - m.ox;
  const y = sy - m.oy;
  return x >= 0 && y >= 0 && x < m.cols && y < m.rows ? m.total[y * m.cols + x] : 0;
};

/** Share of each object's thread that later objects cover (by its base map). */
function hiddenShares(f: Field, base: Contribution[]): number[] {
  const later = new Float32Array(f.total.length);
  const out = new Array<number>(base.length).fill(0);
  for (let k = base.length - 1; k >= 0; k--) {
    const m = base[k].map;
    let all = 0;
    let hid = 0;
    for (let y = 0; y < m.rows; y++) {
      const fy = m.oy + y;
      if (fy < 0 || fy >= f.srows) continue;
      for (let x = 0; x < m.cols; x++) {
        const fx = m.ox + x;
        if (fx < 0 || fx >= f.scols) continue;
        const t = m.total[y * m.cols + x];
        all += t;
        if (later[fy * f.scols + fx] >= HIDDEN) hid += t;
      }
    }
    out[k] = all > 0 ? hid / all : 0;
    for (let y = 0; y < m.rows; y++) {
      const fy = m.oy + y;
      if (fy < 0 || fy >= f.srows) continue;
      for (let x = 0; x < m.cols; x++) {
        const fx = m.ox + x;
        if (fx >= 0 && fx < f.scols) later[fy * f.scols + fx] += m.total[y * m.cols + x];
      }
    }
  }
  return out;
}

/** The score of the current choice in a group. Higher is better; null when a hard rule is broken. */
interface Tally {
  fixed: number;
  newCritical: number;
  newCaution: number;
}

/**
 * Fixes the open cells of `kind` (or of all kinds) in `p`. Nothing in `p` changes: the result
 * carries the design with the fix.
 */
export async function planFix(p: Pattern, profile: Profile, kind: FixKind | 'all', opt: FixOptions): Promise<FixResult> {
  const t0 = performance.now();
  const checks = opt.checks ?? ALL_CHECKS;
  const v = validateDesign(p, profile, checks);
  const counting = countingCells(v, opt.acks);
  const kinds: FixKind[] = kind === 'all' ? ['density', 'holes', 'gap', 'sparse', 'long'] : [kind];
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
    const r = await upperFix(p, v, counting, profile, upper, opt);
    pattern = r.pattern;
    objects = r.objects;
  }
  const lower = kinds.filter((k) => CAUTION_KINDS.has(k));
  if (lower.length) {
    const r = lowerFix(pattern, p, v, profile, checks, lower, opt, new Set(objects.map((x) => x.index)));
    pattern = r.pattern;
    objects = [...objects, ...r.objects].sort((a, b) => a.index - b.index);
  }
  if (pattern === p) return done(p, [], null, before);
  const after = validateDesign(pattern, profile, checks);
  return done(pattern, objects, cellDiff(v, after, opt.acks), openCount(after));
}

/** Density and penetrations: search on the additive field, check for real. */
async function upperFix(p: Pattern, v: ValidationResult, counting: Uint8Array, profile: Profile, kinds: FixKind[], opt: FixOptions): Promise<{ pattern: Pattern; objects: ObjectFix[] }> {
  const tStart = performance.now();
  const th = thresholdsFor(profile);
  const f = new Field(p, th, stableFabric(profile));
  const fc = fieldCells(f, v);
  const kindsArr = stitchKinds(p);
  const objs = sewObjects(p, kindsArr);
  // Open cells, on the field.
  const target = new Uint8Array(f.level.length);
  const targets: number[] = [];
  for (let i = 0; i < v.level.length; i++) {
    if (fc[i] < 0 || !kinds.some((k) => openFor(v, counting, i, k))) continue;
    target[fc[i]] = 1;
    targets.push(fc[i]);
  }
  const base = objs.map((o) => f.contribution(sliceOf(p, o)));
  const hidden = hiddenShares(f, base);
  // Who carries each open cell.
  const carriers = new Map<number, number[]>();
  for (const c of targets) {
    const pk = peakOf(f, c);
    const who: number[] = [];
    for (const o of objs) {
      const m = base[o.index].map;
      if (!m.cols) continue;
      const share = pk.t > 0 ? at(m, pk.sx, pk.sy) / pk.t : 0;
      const holes = kinds.includes('holes') && base[o.index].shorts.has(c);
      if (share >= SHARE || holes) who.push(o.index);
    }
    carriers.set(c, who);
  }
  // Candidates: the units (sets of settings) that may be changed, with their variants.
  const want = new Set<FixKind>(kinds);
  const cands = new Map<number, Candidate>();
  const unitCand = new Map<string, Candidate>();
  for (const idx of new Set([...carriers.values()].flat())) {
    if (opt.stale?.()) break;
    const u = unitOf(p, objs, objs[idx], kindsArr);
    if (!('kind' in u)) continue;
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
    const built = buildVariants(p, f, u, tools, opt.trimMm, predictOk, coveredAfter(f, base, Math.max(...u.objects)));
    if (built.variants.length < 2) continue;
    const { variants, contributions } = built;
    // Visibility: where the unit's objects lie on top.
    const hid = u.objects.reduce((a, i) => a + hidden[i] * objs[i].threadMm, 0) / Math.max(1e-6, u.objects.reduce((a, i) => a + objs[i].threadMm, 0));
    const visibility = variants.map((x) => (x.visible ? 1 : x.strength * (1 - hid)));
    const banned = new Set<number>();
    variants.forEach((_, k) => {
      if (k && !opt.visible && visibility[k] > (opt.directMax ?? DIRECT_MAX)) banned.add(k);
    });
    const c: Candidate = { o: owner, unit: u, variants, contributions, visibility, banned, chosen: 0 };
    unitCand.set(key, c);
    cands.set(idx, c);
    await Promise.resolve();
  }
  opt.log?.(`targets ${targets.length} carriers ${[...new Set([...carriers.values()].flat())].join(',')} units ${[...unitCand.values()].map((c) => `${unitKey(c.unit)}:${c.variants.length}v`).join(' ')} t=${Math.round(performance.now() - tStart)}`);
  if (!cands.size) return { pattern: p, objects: [] };
  // Groups: units sharing an open cell.
  const parent = new Map<Candidate, Candidate>([...unitCand.values()].map((c) => [c, c]));
  const find = (x: Candidate): Candidate => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  for (const who of carriers.values()) {
    const c = [...new Set(who.map((x) => cands.get(x)).filter((x): x is Candidate => !!x))];
    for (let k = 1; k < c.length; k++) parent.set(find(c[k]), find(c[0]));
  }
  const groups = new Map<Candidate, Candidate[]>();
  for (const c of unitCand.values()) {
    const g = find(c);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }

  const tally: Tally = { fixed: 0, newCritical: 0, newCaution: 0 };
  const onChange = (c: number, was: number, now: number) => {
    const b = f.base[c];
    if (target[c]) {
      const open = (l: number) => l === CRITICAL;
      if (open(was) && !open(now)) tally.fixed++;
      else if (!open(was) && open(now)) tally.fixed--;
    }
    if (b !== CRITICAL) {
      if (was === CRITICAL) tally.newCritical--;
      if (now === CRITICAL) tally.newCritical++;
    }
    if (b === SAFE) {
      if (was !== SAFE) tally.newCaution--;
      if (now !== SAFE) tally.newCaution++;
    }
  };
  const choose = (c: Candidate, k: number) => {
    if (c.chosen === k) return;
    f.swap(c.contributions[c.chosen], c.contributions[k], onChange);
    c.chosen = k;
  };
  // Lexicographic: open cells fixed, then measured visibility, new caution, objects touched.
  const value = (g: Candidate[]): number => {
    if (tally.newCritical > 0) return -Infinity;
    let vis = 0;
    let touched = 0;
    for (const c of g) {
      vis += c.visibility[c.chosen];
      if (c.chosen) touched++;
    }
    return tally.fixed * 1e6 - vis * 1e3 - tally.newCaution * 20 - touched;
  };

  const solveGroup = (g: Candidate[]) => {
    const allowed = g.map((c) => c.variants.map((_, k) => k).filter((k) => !c.banned.has(k)));
    const combos = allowed.reduce((a, l) => a * l.length, 1);
    let best = value(g);
    let bestChoice = g.map((c) => c.chosen);
    const keep = () => {
      const val = value(g);
      if (val > best) {
        best = val;
        bestChoice = g.map((c) => c.chosen);
      }
    };
    if (combos <= EXHAUSTIVE) {
      const rec = (k: number) => {
        if (k === g.length) return keep();
        for (const x of allowed[k]) {
          choose(g[k], x);
          rec(k + 1);
        }
      };
      rec(0);
    } else {
      // Greedy from the current choice, then large neighbourhoods: a few objects at once, exactly.
      const deadline = performance.now() + (opt.budgetMs ?? 1500);
      let improved = true;
      while (improved && performance.now() < deadline) {
        improved = false;
        for (let k = 0; k < g.length; k++) {
          const was = g[k].chosen;
          let localBest = value(g);
          let pick = was;
          for (const x of allowed[k]) {
            choose(g[k], x);
            const val = value(g);
            if (val > localBest) {
              localBest = val;
              pick = x;
            }
          }
          choose(g[k], pick);
          if (pick !== was) improved = true;
        }
        keep();
      }
      let seed = 1;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      let stale = 0;
      while (performance.now() < deadline && stale < 200) {
        g.forEach((c, k) => choose(c, bestChoice[k]));
        // A neighbourhood: one object and those sharing open cells with it, up to five.
        const pivot = Math.floor(rnd() * g.length);
        const near = neighbours(g, pivot, carriers, cands).slice(0, 5);
        const sub = near.filter((k) => allowed[k].length > 1);
        const before = best;
        const rec = (j: number) => {
          if (j === sub.length) return keep();
          for (const x of allowed[sub[j]]) {
            choose(g[sub[j]], x);
            rec(j + 1);
          }
        };
        if (sub.reduce((a, k) => a * allowed[k].length, 1) <= EXHAUSTIVE) rec(0);
        stale = best > before ? 0 : stale + 1;
      }
    }
    g.forEach((c, k) => choose(c, bestChoice[k]));
  };

  let pattern = p;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const ts = performance.now();
    for (const g of groups.values()) solveGroup(g);
    opt.log?.(`search ${Math.round(performance.now() - ts)}ms groups ${[...groups.values()].map((g) => g.length).join(',')}`);
    if (opt.stale?.()) break;
    // Sew the choice for real and check the whole design.
    const chosen = [...unitCand.values()].filter((c) => c.chosen).sort((a, b) => a.o.index - b.o.index);
    pattern = applyChoice(p, chosen, opt.trimMm);
    // What was predicted is known now: its real thread replaces the prediction.
    for (const c of chosen) {
      const x = c.variants[c.chosen];
      if (!x.predicted) continue;
      const real = f.contribution(stitchesOf(pattern, c.unit.objects));
      f.swap(c.contributions[c.chosen], real, onChange);
      c.contributions[c.chosen] = real;
      x.predicted = false;
    }
    const after = validateDesign(pattern, v.profile, v.checks);
    const diff = cellDiff(v, after, opt.acks);
    const bad = blame(p, pattern, chosen, diff, after);
    opt.log?.(`verify t=${Math.round(performance.now() - tStart)}`);
    opt.log?.(`round ${round}: tally ${JSON.stringify(tally)} chosen ${chosen.map((c) => `${c.o.index}:${c.variants[c.chosen].tools.map((t) => t.id).join('+')}`).join(' ')} real new crit ${diff.newCritical} gs ${diff.newGapSparse} crit ${diff.criticalBefore}>${diff.criticalAfter} bad ${bad.map((c) => c.o.index).join(',')}`);
    if (!bad.length) break;
    for (const c of bad) c.banned.add(c.chosen);
    if (round === MAX_ROUNDS - 1) {
      // Still breaking a rule: leave those objects as they are.
      for (const c of bad) {
        choose(c, 0);
        c.variants.forEach((_, k) => k && c.banned.add(k));
      }
      pattern = applyChoice(p, [...unitCand.values()].filter((c) => c.chosen).sort((a, b) => a.o.index - b.o.index), opt.trimMm);
    }
  }
  const objects = [...unitCand.values()]
    .filter((c) => c.chosen)
    .sort((a, b) => a.o.index - b.o.index)
    .map((c) => {
      const x = c.variants[c.chosen];
      return { index: c.o.index, kind: c.o.kind, tools: x.tools.map((t) => t.id), changes: x.changes, knockout: x.knockout, visibility: c.visibility[c.chosen], visible: x.visible || c.visibility[c.chosen] > (opt.directMax ?? DIRECT_MAX) };
    });
  return { pattern, objects };
}

/** Indices in `g` of the objects sharing open cells with g[k], g[k] first. */
function neighbours(g: Candidate[], k: number, carriers: Map<number, number[]>, cands: Map<number, Candidate>): number[] {
  const near = new Set<Candidate>([g[k]]);
  for (const who of carriers.values()) if (who.some((x) => cands.get(x) === g[k])) who.forEach((x) => cands.get(x) && near.add(cands.get(x)!));
  const out = [k];
  g.forEach((c, j) => {
    if (j !== k && near.has(c)) out.push(j);
  });
  return out;
}

/** Records of object `o` as a pattern of its own. */
function sliceOf(p: Pattern, o: SewObject): Pattern {
  return { name: p.name, format: p.format, x: p.x.slice(o.first, o.last + 1), y: p.y.slice(o.first, o.last + 1), cmd: p.cmd.slice(o.first, o.last + 1), colors: p.colors, bounds: { minX: o.minX, minY: o.minY, maxX: o.maxX, maxY: o.maxY } };
}

/** Sews the chosen variants into the design, object by object. */
function applyChoice(p: Pattern, chosen: Candidate[], trimMm: number): Pattern {
  let cur = p;
  for (const c of chosen) {
    const x = c.variants[c.chosen];
    // Settings of other units are taken from what the object remembers now: unchanged by the others.
    const u = refreshed(cur, c.unit);
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
  const objs = sewObjects(after);
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
  let v = validateDesign(cur, profile, checks);
  const objects: ObjectFix[] = [];
  const kindsArr = stitchKinds(cur);
  const objs = sewObjects(cur, kindsArr);
  const want = new Set<FixKind>(kinds);
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
  for (const o0 of objs) {
    if (opt.stale?.() || taken.has(o0.index)) continue;
    const o = sewObjects(cur)[o0.index];
    const open = openIn(v, o);
    if (!open) continue;
    const ka = stitchKinds(cur);
    const u = unitOf(cur, sewObjects(cur, ka), o, ka);
    if (!('kind' in u) || u.kind === 'lettering' || taken.has(u.owner)) continue;
    const owner = sewObjects(cur, ka)[u.owner];
    const all: Tool[] = u.kind === 'border' ? borderTools(u, want, profile) : toolsFor(cur, sewObjects(cur, ka), owner, u.settings, want, profile, analyze(cur, owner, ka).fill?.areaMm2 ?? 0);
    const tools = all.filter((t) => !t.visible && t.kinds.some((k) => want.has(k)));
    for (const t of tools) {
      const vis = t.strength;
      if (vis > (opt.directMax ?? DIRECT_MAX) && !opt.visible) continue;
      const next = sewUnit(cur, u, t.changes, !!t.knockout, opt.trimMm);
      if (!next) continue;
      const vn = validateDesign(next, profile, checks);
      const d = cellDiff(v0, vn, opt.acks);
      if (d.newCritical) continue;
      if (openIn(vn, sewObjects(next)[o.index]) >= open) continue;
      cur = next;
      v = vn;
      taken.add(u.owner);
      objects.push({ index: u.owner, kind: owner.kind, tools: [t.id], changes: t.changes, knockout: !!t.knockout, visibility: vis, visible: false });
      break;
    }
  }
  void orig;
  return { pattern: cur, objects };
}

export { CAUTION };

/** Sub-cell test: thread of objects sewn after `index` covers it (no underlay needed there). */
function coveredAfter(f: Field, base: Contribution[], index: number): (sx: number, sy: number) => boolean {
  let later: Map<number, number> | null = null;
  return (sx, sy) => {
    if (!later) {
      later = new Map();
      for (let k = index + 1; k < base.length; k++) {
        const m = base[k].map;
        for (let y = 0; y < m.rows; y++) {
          for (let x = 0; x < m.cols; x++) {
            const t = m.total[y * m.cols + x];
            if (!t) continue;
            const key = (m.oy + y) * f.scols + m.ox + x;
            later.set(key, (later.get(key) ?? 0) + t);
          }
        }
      }
    }
    return (later.get(sy * f.scols + sx) ?? 0) < HIDDEN;
  };
}

/** Most variants a unit gets (least visible first). */
const MAX_VARIANTS = 36;

/**
 * The variants of unit `u`: changes that have to be sewn to be known (leaving out, satin spacing
 * by width, short stitches, another underlay kind) are sewn; on each of them, looser rows and less
 * underlay are predicted from its thread (top stitches scaled, underlay taken away), since sewing a
 * large fill again for every spacing step costs seconds. Predicted variants are sewn when chosen.
 */
function buildVariants(p: Pattern, f: Field, u: Unit, tools: Tool[], trimMm: number, predictOk: boolean, uncovered: (sx: number, sy: number) => boolean): { variants: Variant[]; contributions: Contribution[] } {
  const pred = predictOk ? tools.filter((t) => predictable(t)) : [];
  const real = tools.filter((t) => !pred.includes(t));
  const realSets: Tool[][] = [[], ...toolSets(real, 6)];
  const scales: (Tool | null)[] = [null, ...pred.filter((t) => predictable(t)!.scale !== undefined)];
  const unders: (Tool | null)[] = [null, ...pred.filter((t) => predictable(t)!.under !== undefined)];
  const variants: Variant[] = [];
  const contributions: Contribution[] = [];
  for (const set of realSets) {
    const knockout = set.some((t) => t.knockout);
    let next: Pattern | null = p;
    if (set.length) next = sewUnit(p, u, merged(set), knockout, trimMm);
    if (!next) continue;
    const st = stitchesOf(next, u.objects);
    const top = f.contribution(st, (r) => !st.under[r]);
    const under = f.contribution(st, (r) => !!st.under[r]);
    for (const sc of scales) {
      for (const un of unders) {
        const all = [...set, ...(sc ? [sc] : []), ...(un ? [un] : [])];
        const pu = un ? predictable(un)!.under! : 1;
        const c = f.blend(top, under, sc ? predictable(sc)!.scale! : 1, pu === 'covered' ? 1 : pu, pu === 'covered' ? uncovered : undefined);
        variants.push({ tools: all, changes: merged(all), knockout, stitches: sc || un ? undefined : st, strength: Math.max(0, ...all.map((t) => t.strength)), visible: all.some((t) => t.visible), predicted: !!(sc || un) });
        contributions.push(c);
      }
    }
  }
  // The current one first, then the least visible.
  const order = variants.map((_, k) => k).filter((k) => k > 0).sort((a, b) => variants[a].strength - variants[b].strength || variants[a].tools.length - variants[b].tools.length).slice(0, MAX_VARIANTS - 1);
  return { variants: [variants[0], ...order.map((k) => variants[k])], contributions: [contributions[0], ...order.map((k) => contributions[k])] };
}

/** Unit `u` as found in `p` now (after other units were sewn anew). */
function refreshed(p: Pattern, u: Unit): Unit | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const o = objs[u.kind === 'border' ? u.objects[0] : u.owner];
  const r = o && unitOf(p, objs, o, kinds);
  return r && 'kind' in r ? r : null;
}
