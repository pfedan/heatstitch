import type { Pattern } from '../../model/pattern';
import type { Sequence } from '../../app/types';
import type { WorkerClient } from '../../density/client';
import type { FileList, LoadedFile } from '../../ui/fileList';
import type { Measurement } from '../../validation/measure';
import { syncBorders } from '../../model/border';
import { backToVersion, holdMemory, keepVersion, openOnPurpose } from '../../model/restitch';
import { settledBy } from '../../validation/acks';
import { FABRICS, type FabricId, type Profile } from '../../validation/profiles';
import { CAUTION, classify, CRITICAL, type Reason, type ValidationResult, type Zone } from '../../validation/validate';
import { REASON_BITS } from '../../validation/zones';
import { applyProposals, fineZones, planCorrection, type Box, type Plan, type PlanOptions, type Proposal } from '../../correct/plan';
import {
  FINDING_TYPES,
  type AmpelEngine,
  type AmpelReport,
  type AppliedFix,
  type FabricReport,
  type FabricVerdict,
  type FindingType,
  type FixOutcome,
  type MmBox,
  type Pending,
  type ReadyFix,
  type ReasonSummary,
  type RestProposal,
  type RevertEntry,
  type Spot,
  type TypeFixes,
} from './engine';

/*
 * Stand-in for the new correction engine: fills the AmpelReport (engine.ts) from today's
 * validation (src/validation) and correction (src/correct/plan.ts, the fine correction in the
 * worker). One file, so the new engine can replace it whole.
 *
 * Today's planner keeps what objects remember on the main thread, so it cannot run in a worker:
 * the fixes are worked out here lazily, a moment after loading and after every change, in small
 * steps between which the page stays responsive, and dropped as soon as the design changes.
 */

/**
 * From this size (mm²) one connected critical spot that counts makes the light red. Start values
 * (Entscheidung 15): 5 mm² on stable fabric and caps (heavy woven too), 3 mm² on knit, jersey,
 * fleece and terry; light and sheer fabrics and leather take the stricter value.
 */
export const RED_MIN_MM2 = Object.fromEntries(FABRICS.map((f) => [f.id, f.redMinMm2])) as Record<FabricId, number>;

/** Quiet time after a change before fixes are worked out (ms): no search starts while one is still at work. */
const SETTLE_MS = 2000;

/** The validation reasons behind each kind of finding. */
const TYPE_REASONS: Record<FindingType, Reason[]> = {
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
const AIMS_CRITICAL: Record<FindingType, boolean> = { density: true, penetrations: true, gaps: false, long: false };

const LEVEL = (l: number): Spot['level'] => (l >= CRITICAL ? 'critical' : 'caution');

/** What the light reads from one validation: per cell what counts, per kind its area and target. */
interface Tally {
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

/** A validation that holds only the findings of `type` (for planning one kind at a time). */
function onlyType(v: ValidationResult, type: FindingType | 'all'): ValidationResult {
  if (type === 'all') return v;
  const rs = TYPE_REASONS[type];
  const zones = v.zones.filter((z) => z.reasons.some((r) => rs.includes(r))).map((z) => ({ ...z, reasons: z.reasons.filter((r) => rs.includes(r)) }));
  return { ...v, zones };
}

const VIS: Record<Proposal['visibility'], number> = { invisible: 0, slight: 0.3, visible: 1 };

export interface StandInDeps {
  readonly files: FileList;
  readonly seq: (p: Pattern) => Sequence;
  readonly validator: WorkerClient;
  readonly trimMm: () => number;
  /** Stores a fixed design as one undo step (with what its objects remember). */
  readonly commit: (p: Pattern, m: Measurement) => void;
  /** Shows proposals in the correction card, where they can be compared and taken over. */
  readonly offer: (plan: Plan, title: string) => void;
  /** The correction is working out or applying something: wait. */
  readonly busy: () => boolean;
  /**
   * Whether fixes are wanted now. Today's planner runs on the main thread, so it waits until the
   * check view is open instead of slowing down editing; the light itself is always there.
   */
  readonly wanted: () => boolean;
  /** Whether the search waits to be asked for (phone, large design) instead of starting by itself. */
  readonly onRequest: () => boolean;
}

/** One kind's plan, kept so its rest can be offered in the correction card. */
interface Planned {
  plan: Plan;
  rest: Proposal[];
}

export interface StandIn extends AmpelEngine {
  /** Shows the visible rest of a kind in the correction card (stand-in: the card has the preview and the taking over). */
  offerRest(rest: RestProposal, title: string): void;
  /** Whether fixes are being worked out right now. */
  working(): boolean;
}

export function createStandIn(deps: StandInDeps): StandIn {
  const listeners: (() => void)[] = [];
  const notify = () => listeners.forEach((cb) => cb());
  const applied: AppliedFix[] = [];

  /** Verdicts and reasons for every fabric, cached per measurement and decisions. */
  let verdictKey: unknown[] = [];
  let verdicts: Record<FabricId, Tally> | null = null;

  /** Fixes for the active version, and the version they belong to. */
  let fixKey: unknown[] = [];
  let fixes: Partial<Record<FindingType, TypeFixes>> = {};
  let all: Pending<ReadyFix> = { state: 'pending' };
  const planned = new Map<string, Planned>();
  let timer = 0;
  let running = false;
  /** The search was asked for, for the version in `fixKey`. */
  let requested = false;
  /** May the search run now: wanted, and started by itself or asked for. */
  const may = () => deps.wanted() && (requested || !deps.onRequest());

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

  /** The key of what the fixes depend on. */
  const keyOf = (f: LoadedFile, v: ValidationResult) => [f, f.pattern, v, f.acks, v.profile.fabric, v.profile.thread, v.checks, deps.trimMm()];

  function report(): AmpelReport | null {
    const f = deps.files.active;
    const v = f?.validation;
    if (!f?.pattern || !v) return null;
    const ts = tallies(f, v);
    const key = keyOf(f, v);
    if (!same(key, fixKey)) {
      fixKey = key;
      planned.clear();
      const active = ts[v.profile.fabric];
      fixes = {};
      for (const r of active.reasons) {
        const has = active.target[r.type] > 0;
        fixes[r.type] = { direct: has ? { state: 'pending' } : { state: 'none' }, rest: has ? { state: 'pending' } : { state: 'none' } };
      }
      all = active.target.all > 0 && active.reasons.filter((r) => active.target[r.type] > 0).length > 1 ? { state: 'pending' } : { state: 'none' };
      requested = false;
      if (may()) schedule();
    } else if (!running && !timer && waiting() && may()) schedule();
    const fabrics = {} as Record<FabricId, FabricReport>;
    for (const fab of FABRICS) {
      const t = ts[fab.id];
      fabrics[fab.id] = { verdict: t.verdict, reasons: t.reasons, ...(fab.id === v.profile.fabric ? { fixes, all } : {}) };
    }
    return { basis: f.pattern, fabric: v.profile.fabric, fabrics };
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      void run();
    }, SETTLE_MS);
  }

  const waiting = () => FINDING_TYPES.some((t) => fixes[t]?.direct.state === 'pending') || all.state === 'pending';

  /** Works out the fixes of the current version, kind by kind, then all together. */
  async function run(): Promise<void> {
    if (!may()) return;
    if (running || deps.busy()) return schedule();
    const f = deps.files.active;
    const v = f?.validation;
    const p = f?.pattern;
    if (!f || !v || !p) return;
    const key = fixKey;
    const stale = () => key !== fixKey || f.pattern !== p || deps.busy() || !deps.wanted();
    // Worst kind first: its button comes first (the reasons are sorted critical first, then by area).
    const order = tallies(f, v)[v.profile.fabric].reasons.map((r) => r.type);
    const pending = FINDING_TYPES.filter((t) => fixes[t]?.direct.state === 'pending').sort((a, b) => order.indexOf(a) - order.indexOf(b));
    running = true;
    notify();
    try {
      const before = tallies(f, v)[v.profile.fabric];
      for (const t of pending) {
        if (stale()) break;
        const r = await solve(f, p, v, t, before, stale);
        if (stale()) break;
        fixes[t] = r;
        notify();
      }
      if (!stale() && all.state === 'pending') {
        const r = await solve(f, p, v, 'all', before, stale);
        if (!stale()) all = r.direct;
      }
    } catch (err) {
      console.error(err);
      if (!stale()) {
        for (const t of FINDING_TYPES) if (fixes[t]?.direct.state === 'pending') fixes[t] = { direct: { state: 'none' }, rest: { state: 'none' } };
        if (all.state === 'pending') all = { state: 'none' };
      }
    } finally {
      running = false;
      // A change made while trying things out keeps what its objects remember.
      const now = deps.files.active?.pattern;
      if (now) backToVersion(now);
      // Interrupted (the correction was busy) or a newer version waits: once more after a pause.
      if (may() && (key !== fixKey || waiting())) schedule();
      notify();
    }
  }

  /** Measures a design as the app does (objects light on purpose are not checked for showing fabric). */
  async function measured(p: Pattern, v: ValidationResult): Promise<{ m: Measurement; v: ValidationResult }> {
    const m = await deps.validator.measure(p, openOnPurpose(p, deps.seq(p).objects) ?? undefined);
    return { m, v: classify(m, v.profile, v.checks) };
  }

  /** The design with `chosen` taken over and borders following, remembering what its objects know with that version. */
  function sewn(p: Pattern, chosen: Proposal[]): Pattern | null {
    const release = holdMemory();
    try {
      const r = applyProposals(p, chosen, deps.trimMm());
      if (!r) return null;
      const q = syncBorders(r.pattern, deps.trimMm());
      keepVersion(q);
      return q;
    } finally {
      release();
    }
  }

  /** The fine correction on the stitches in `boxes` (worker), for the critical kinds. */
  async function fine(f: LoadedFile, p: Pattern, v: ValidationResult, boxes: Box[], stale: () => boolean): Promise<Pattern> {
    let q = p;
    for (const b of boxes) {
      if (stale()) return p;
      const pad = 1;
      const c = await deps.validator.correct(q, v.profile, v.checks, { goal: 'critical', focus: 'both', region: { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, acks: f.acks });
      q = c.pattern;
    }
    if (q !== p) {
      // The new stitches belong with what the objects of `p` remembered.
      const release = holdMemory();
      try {
        backToVersion(p);
        keepVersion(q);
      } finally {
        release();
      }
    }
    return q;
  }

  /** What `after` does to the target of `type`, against `before`. */
  function outcome(type: FindingType | 'all', before: Tally, after: Tally, objects: number): FixOutcome {
    const of = before.target[type];
    const left = Math.min(of, after.target[type]);
    return { fixedMm2: of - left, ofMm2: of, leftMm2: left, newCautionMm2: Math.max(0, after.caution - before.caution), lightAfter: after.verdict.light, objects };
  }

  /** Revert data: the settings each proposal changed, and the stitches of objects the fine correction touched. */
  function revertOf(p: Pattern, chosen: Proposal[], fineBoxes: Box[]): RevertEntry[] {
    const out: RevertEntry[] = chosen.map((x) => ({ objectKey: x.key, settings: x.changes.map((c) => ({ ...c })), ...(x.knockout ? { knockout: true } : {}) }));
    if (fineBoxes.length) {
      const objs = deps.seq(p).objects;
      for (const o of objs) {
        const ob = { minX: o.minX / 10, minY: o.minY / 10, maxX: o.maxX / 10, maxY: o.maxY / 10 };
        if (!fineBoxes.some((b) => ob.minX <= b.maxX && b.minX <= ob.maxX && ob.minY <= b.maxY && b.minY <= ob.maxY)) continue;
        out.push({ objectKey: `${o.first}:${o.last}`, settings: [], stitchesBefore: { x: p.x.slice(o.first, o.last + 1), y: p.y.slice(o.first, o.last + 1), cmd: p.cmd.slice(o.first, o.last + 1) } });
      }
    }
    return out;
  }

  /** The direct fix and the rest proposal of one kind (or all together), both measured. */
  async function solve(f: LoadedFile, p: Pattern, v: ValidationResult, type: FindingType | 'all', before: Tally, stale: () => boolean): Promise<TypeFixes> {
    const none: TypeFixes = { direct: { state: 'none' }, rest: { state: 'none' } };
    const opt: PlanOptions = {
      goal: 'critical',
      focus: 'both',
      acks: f.acks,
      trimMm: deps.trimMm(),
      stale,
      // Small steps: the page stays responsive while this works.
      progress: () => new Promise((r) => setTimeout(r, 0)),
    };
    const plan = await planCorrection(p, onlyType(v, type), v.profile, v.checks, opt);
    if (stale()) return none;
    const direct = plan.proposals.filter((x) => x.visibility !== 'visible' && !x.hand);
    const rest = plan.proposals.filter((x) => !direct.includes(x));
    const objects = (list: Proposal[]) => new Set(list.map((x) => x.key)).size;
    const critical = type === 'all' || AIMS_CRITICAL[type];

    // Direct: the invisible and slight changes, then the fine correction where no setting helps.
    let q = direct.length ? (sewn(p, direct) ?? p) : p;
    let fineBoxes: Box[] = [];
    if (critical) {
      const mid = q === p ? v : (await measured(q, v)).v;
      if (stale()) return none;
      fineBoxes = [...plan.fine, ...fineZones(p, onlyType(mid, type), direct, opt)];
      if (fineBoxes.length) q = await fine(f, q, v, fineBoxes, stale);
      if (stale()) return none;
    }
    let directFix: Pending<ReadyFix> = { state: 'none' };
    if (q !== p) {
      const { m, v: va } = await measured(q, v);
      if (stale()) return none;
      const after = tally(va, f.acks);
      const out = outcome(type, before, after, objects(direct) + (fineBoxes.length ? 1 : 0));
      // Only when it really fixes something, and nothing gets critical that was not.
      if (out.fixedMm2 > 0 && after.critical <= before.critical) {
        directFix = { state: 'ready', value: { id: `${type}:direct`, type, basis: p, pattern: q, measurement: m, outcome: out, revert: revertOf(p, direct, fineBoxes) } };
      }
    }

    // Rest: the visible changes and those replacing changes by hand, on top of the direct ones.
    let restFix: Pending<RestProposal> = { state: 'none' };
    if (rest.length) {
      const r = sewn(p, [...direct, ...rest]);
      if (r && !stale()) {
        const { v: vr } = await measured(r, v);
        if (stale()) return none;
        const after = tally(vr, f.acks);
        const out = outcome(type, before, after, objects(rest));
        const base = directFix.state === 'ready' ? directFix.value.outcome.leftMm2 : out.ofMm2;
        if (out.leftMm2 < base && after.critical <= before.critical) {
          const box = rest.map((x) => x.box).reduce<MmBox>((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }), { ...rest[0].box });
          restFix = {
            state: 'ready',
            value: {
              id: `${type}:rest`,
              type,
              basis: p,
              outcome: out,
              visibility: Math.max(...rest.map((x) => VIS[x.visibility])),
              preview: { box, before: p, after: r },
              replacesHandEdits: rest.reduce((s, x) => s + x.hand, 0),
            },
          };
          planned.set(`${type}:rest`, { plan, rest });
        }
      }
    }
    return { direct: directFix, rest: restFix };
  }

  return {
    report,
    onChange: (cb) => void listeners.push(cb),
    apply(fix) {
      const f = deps.files.active;
      if (!f || f.pattern !== fix.basis) return null;
      deps.commit(fix.pattern, fix.measurement);
      const done: AppliedFix = { id: `${fix.id}@${Date.now()}`, type: fix.type, at: Date.now(), before: fix.basis, after: fix.pattern, revert: fix.revert };
      applied.push(done);
      return done;
    },
    applied: () => applied,
    onRequest: () => deps.onRequest() && !requested,
    search() {
      if (requested || !waiting()) return;
      requested = true;
      clearTimeout(timer);
      timer = 0;
      void run();
      notify();
    },
    offerRest(rest, title) {
      const f = deps.files.active;
      const pl = planned.get(rest.id);
      if (!f || !pl || f.pattern !== rest.basis) return;
      // The card shows the visible proposals of this kind; the direct ones are the fix button's.
      deps.offer({ ...pl.plan, proposals: pl.rest, fine: [] }, title);
    },
    working: () => running,
  };
}
