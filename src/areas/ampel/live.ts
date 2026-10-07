import type { Sequence } from '../../app/types';
import { applyFix, fixedObjects, revertFix, type PlannedFix } from '../../correct/engine/apply';
import type { FixTarget } from '../../correct/engine/cells';
import { EngineClient } from '../../correct/engine/client';
import { objectsOf } from '../../correct/engine/units';
import type { WorkerClient } from '../../density/client';
import { sewObjects, stitchKey, type SewObject } from '../../model/objects';
import type { Pattern } from '../../model/pattern';
import { holdMemory, openOnPurpose, restoreRemembered } from '../../model/restitch';
import type { FileList, LoadedFile } from '../../ui/fileList';
import type { Measurement } from '../../validation/measure';
import { FABRICS, type FabricId, type Profile } from '../../validation/profiles';
import { classify, type ValidationResult } from '../../validation/validate';
import {
  FINDING_TYPES,
  type AmpelEngine,
  type AmpelReport,
  type AppliedFix,
  type FabricReport,
  type FindingType,
  type FixOutcome,
  type MmBox,
  type Pending,
  type ReadyFix,
  type RestProposal,
  type RevertEntry,
  type TypeFixes,
} from './engine';
import { tally, type Tally } from './verdict';

/*
 * The light on the new correction engine (src/correct/engine): the colour and the reasons come
 * from the validation the app has anyway, the fixes from the engine's workers. After loading and
 * after every change, once the design has been still for a moment, the worst kind first: each
 * kind's direct fix, then "Alles beheben", then the proposals for the rest. Each fix is measured
 * as the app measures before it is offered, and any change drops what is still being worked out.
 */

/** Quiet time after a change before fixes are worked out (ms). */
const SETTLE_MS = 2000;

/** The engine's fix target behind each kind the light names. */
const TARGET: Record<FindingType, FixTarget> = { density: 'density', penetrations: 'holes', gaps: 'gaps', long: 'long' };

export interface LiveDeps {
  readonly files: FileList;
  readonly seq: (p: Pattern) => Sequence;
  readonly validator: WorkerClient;
  readonly trimMm: () => number;
  /** Stores a changed design as one undo step. */
  readonly commit: (p: Pattern, m: Measurement) => void;
  /** Whether the search waits to be asked for (phone, large design) instead of starting by itself. */
  readonly onRequest: () => boolean;
  /** Something else is changing the design right now: wait. */
  readonly busy?: () => boolean;
  /** The engine's workers (tests pass their own). */
  readonly client?: EngineClient;
  readonly settleMs?: number;
}

export function createLive(deps: LiveDeps): AmpelEngine {
  const client = deps.client ?? new EngineClient();
  const settleMs = deps.settleMs ?? SETTLE_MS;
  const listeners: (() => void)[] = [];
  const notify = () => listeners.forEach((cb) => cb());
  const applied: AppliedFix[] = [];
  /** The engine's plan behind each fix offered. */
  const plans = new WeakMap<ReadyFix, PlannedFix>();

  let verdictKey: unknown[] = [];
  let verdicts: Record<FabricId, Tally> | null = null;

  let fixKey: unknown[] = [];
  let fixes: Partial<Record<FindingType, TypeFixes>> = {};
  let all: Pending<ReadyFix> = { state: 'none' };
  let timer = 0;
  /** Fixes being measured on the main side (the workers count their own). */
  let measuring = 0;
  let started = false;
  let requested = false;
  const may = () => requested || !deps.onRequest();
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

  function tallies(f: LoadedFile, v: ValidationResult): Record<FabricId, Tally> {
    const key = [v, f.acks, v.measurement, v.profile.thread, v.checks];
    if (verdicts && same(key, verdictKey)) return verdicts;
    verdictKey = key;
    const out = {} as Record<FabricId, Tally>;
    for (const fab of FABRICS) {
      const profile: Profile = { fabric: fab.id, thread: v.profile.thread };
      out[fab.id] = tally(fab.id === v.profile.fabric ? v : classify(v.measurement, profile, v.checks), f.acks);
    }
    verdicts = out;
    return out;
  }

  const keyOf = (f: LoadedFile, v: ValidationResult) => [f, f.pattern, v, f.acks, v.profile.fabric, v.profile.thread, v.checks, deps.trimMm()];

  function report(): AmpelReport | null {
    const f = deps.files.active;
    const v = f?.validation;
    if (!f?.pattern || !v) return null;
    const ts = tallies(f, v);
    const key = keyOf(f, v);
    if (!same(key, fixKey)) {
      fixKey = key;
      client.cancel();
      clearTimeout(timer);
      timer = 0;
      started = false;
      requested = false;
      const active = ts[v.profile.fabric];
      fixes = {};
      for (const r of active.reasons) {
        const has = active.target[r.type] > 0;
        fixes[r.type] = { direct: has ? { state: 'pending' } : { state: 'none' }, rest: has ? { state: 'pending' } : { state: 'none' } };
      }
      all = active.reasons.filter((r) => active.target[r.type] > 0).length > 1 ? { state: 'pending' } : { state: 'none' };
      if (may()) schedule();
    }
    const fabrics = {} as Record<FabricId, FabricReport>;
    for (const fab of FABRICS) {
      const t = ts[fab.id];
      fabrics[fab.id] = { verdict: t.verdict, reasons: t.reasons, ...(fab.id === v.profile.fabric ? { fixes, all } : {}) };
    }
    return { basis: f.pattern, fabric: v.profile.fabric, fabrics };
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      run();
    }, settleMs) as unknown as number;
  }

  const waiting = () => FINDING_TYPES.some((t) => fixes[t]?.direct.state === 'pending' || fixes[t]?.rest.state === 'pending') || all.state === 'pending';

  /** Asks the workers for every fix of the current version, the worst kind first. */
  function run(): void {
    const f = deps.files.active;
    const v = f?.validation;
    const p = f?.pattern;
    if (!f || !v || !p || started || !may() || !waiting()) return;
    if (deps.busy?.()) return schedule();
    started = true;
    const key = fixKey;
    const stale = () => key !== fixKey;
    const profile = v.profile;
    const settings = { trimMm: deps.trimMm(), checks: v.checks, acks: f.acks };
    const before = tallies(f, v)[profile.fabric];
    // The reasons come sorted worst first: their buttons come first.
    const order = before.reasons.map((r) => r.type).filter((t) => fixes[t]?.direct.state === 'pending');
    const ask = (type: FindingType | 'all', mode: 'direct' | 'rest') => client.fix(p, profile, settings, type === 'all' ? 'all' : TARGET[type], mode);
    const directs = new Map<FindingType, ReadyFix | null>();
    const rests = new Map<FindingType, ReadyFix | null>();
    /** The rest is offered when it clears more than the direct fix, once both are known. */
    const showRest = (t: FindingType) => {
      if (!directs.has(t) || !rests.has(t)) return;
      const d = directs.get(t)!;
      const r = rests.get(t)!;
      const worth = r && (!d || r.outcome.leftMm2 < d.outcome.leftMm2);
      fixes[t] = { ...fixes[t]!, rest: worth ? { state: 'ready', value: restOf(p, r, plans.get(r)!) } : { state: 'none' } };
    };
    for (const t of order) {
      void ask(t, 'direct')
        .then((pf) => offered(f, p, v, t, before, pf, stale))
        .then((x) => {
          if (stale()) return;
          directs.set(t, x);
          fixes[t] = { ...fixes[t]!, direct: x ? { state: 'ready', value: x } : { state: 'none' } };
          showRest(t);
          notify();
        });
    }
    if (all.state === 'pending') {
      void ask('all', 'direct')
        .then((pf) => offered(f, p, v, 'all', before, pf, stale))
        .then((x) => {
          if (stale()) return;
          all = x ? { state: 'ready', value: x } : { state: 'none' };
          notify();
        });
    }
    for (const t of order) {
      void ask(t, 'rest')
        .then((pf) => offered(f, p, v, t, before, pf, stale, 'rest'))
        .then((x) => {
          if (stale()) return;
          rests.set(t, x);
          showRest(t);
          notify();
        });
    }
    notify();
  }

  /**
   * The objects of a fix's design. How new stitches group into objects is part of what the fix
   * remembers, so they are read with that (the engine's per-design cache would keep a grouping
   * without it).
   */
  function objectsIn(p: Pattern, memory: PlannedFix['memory']): SewObject[] {
    const release = holdMemory();
    try {
      restoreRemembered(p, memory);
      return sewObjects(p);
    } finally {
      release();
    }
  }

  /** Measures what `p` looks like to the app (objects open on purpose are not checked for showing fabric). */
  async function measure(p: Pattern, memory: PlannedFix['memory'] = []): Promise<Measurement> {
    const release = holdMemory();
    let skip: Uint8Array | null;
    try {
      restoreRemembered(p, memory);
      skip = openOnPurpose(p, deps.seq(p).objects);
    } finally {
      release();
    }
    return deps.validator.measure(p, skip ?? undefined);
  }

  /** A fix from the engine, measured as the app does, when it really clears something. */
  async function offered(f: LoadedFile, p: Pattern, v: ValidationResult, type: FindingType | 'all', before: Tally, pf: PlannedFix | null, stale: () => boolean, mode: 'direct' | 'rest' = 'direct'): Promise<ReadyFix | null> {
    if (!pf || stale()) return null;
    measuring++;
    try {
      const m = await measure(pf.pattern, pf.memory);
      if (stale()) return null;
      const after = tally(classify(m, v.profile, v.checks), f.acks);
      const out = outcome(type, before, after, pf.objects.length);
      if (out.fixedMm2 <= 0 || after.critical > before.critical) return null;
      const objs = objectsOf(p);
      const revert: RevertEntry[] = pf.objects.map((x) => ({
        objectKey: `${objs[x.index].first}:${objs[x.index].last}`,
        settings: x.changes.map((c) => ({ ...c })),
        ...(x.knockout ? { knockout: true } : {}),
      }));
      const fix: ReadyFix = { id: `${type}:${mode}`, type, basis: p, pattern: pf.pattern, measurement: m, outcome: out, revert, objects: pf.objects.map((x) => x.index) };
      plans.set(fix, pf);
      return fix;
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      measuring--;
    }
  }

  function outcome(type: FindingType | 'all', before: Tally, after: Tally, objects: number): FixOutcome {
    const of = before.target[type];
    const left = Math.min(of, after.target[type]);
    return { fixedMm2: of - left, ofMm2: of, leftMm2: left, newCautionMm2: Math.max(0, after.caution - before.caution), lightAfter: after.verdict.light, objects };
  }

  /** The rest proposal for the preview: where it changes the design, and the fix to take it over. */
  function restOf(p: Pattern, fix: ReadyFix, pf: PlannedFix): RestProposal {
    const objs = objectsIn(fix.pattern, pf.memory);
    const shown = pf.objects.filter((x) => x.visible || x.hand);
    const box = (shown.length ? shown : pf.objects)
      .map((x) => objs[x.index])
      .reduce<MmBox | null>((a, o) => {
        const b = { minX: o.minX / 10, minY: o.minY / 10, maxX: o.maxX / 10, maxY: o.maxY / 10 };
        return a ? { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) } : b;
      }, null)!;
    return {
      id: `${fix.type}:rest`,
      type: fix.type,
      basis: p,
      outcome: fix.outcome,
      visibility: Math.max(0, ...pf.objects.map((x) => (x.visible || x.hand ? 1 : x.visibility))),
      preview: { box, before: p, after: fix.pattern },
      replacesHandEdits: pf.objects.filter((x) => x.hand > 0).length,
      fix,
    };
  }

  /** Takes back the fixes on objects `which` of the active design as one undo step. */
  function revertObjects(which?: number[]): boolean {
    const p = deps.files.active?.pattern;
    if (!p) return false;
    const q = revertFix(p, which ?? fixedObjects(p));
    if (!q) return false;
    void measure(q).then((m) => {
      // Only while nothing else changed the design meanwhile.
      if (deps.files.active?.pattern === p) deps.commit(q, m);
    });
    return true;
  }

  let revertableOf: { p: Pattern; list: number[] } | null = null;

  return {
    report,
    onChange: (cb) => void listeners.push(cb),
    apply(fix) {
      const f = deps.files.active;
      const pf = plans.get(fix);
      if (!f?.pattern || !pf || f.pattern !== fix.basis) return null;
      const q = applyFix(f.pattern, pf);
      if (!q) return null;
      deps.commit(q, fix.measurement);
      const done: AppliedFix = { id: `${fix.id}@${Date.now()}`, type: fix.type, at: Date.now(), before: fix.basis, after: q, revert: fix.revert, objects: fix.objects };
      applied.push(done);
      return done;
    },
    applied: () => applied,
    revert(fix) {
      const p = deps.files.active?.pattern;
      if (!p) return false;
      if (p === fix.after) return revertObjects(fix.objects);
      // Changed elsewhere since: its objects are those with the same stitches as right after the fix.
      // Applied: what its objects remember is in memory now.
      const was = sewObjects(fix.after);
      const keys = new Set(fix.objects.map((i) => was[i]).filter(Boolean).map((o) => stitchKey(fix.after, o.first, o.last)));
      const now = sewObjects(p);
      const which = fixedObjects(p).filter((i) => keys.has(stitchKey(p, now[i].first, now[i].last)));
      return which.length > 0 && revertObjects(which);
    },
    revertable() {
      const p = deps.files.active?.pattern;
      if (!p) return [];
      if (revertableOf?.p !== p) revertableOf = { p, list: fixedObjects(p) };
      return revertableOf.list;
    },
    revertObjects,
    working: () => started && (client.pending > 0 || measuring > 0),
    onRequest: () => deps.onRequest() && !requested,
    search() {
      if (requested || !waiting()) return;
      requested = true;
      clearTimeout(timer);
      timer = 0;
      run();
      notify();
    },
  };
}
