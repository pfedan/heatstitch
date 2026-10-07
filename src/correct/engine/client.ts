import type { Pattern } from '../../model/pattern';
import { rememberedIn } from '../../model/restitch';
import type { Profile } from '../../validation/profiles';
import type { AmpelReport } from './ampel';
import { planOrder, restWorth } from './ampel';
import { objectsOf } from './units';
import type { PlannedFix } from './apply';
import type { FixKind, FixTarget } from './cells';
import type { EngineRequest, EngineResponse, EngineSettings } from './worker';

/**
 * Works out the Ampel in a few workers at once: the report first, then each kind's direct fix
 * (density first), "Alles beheben", and the proposals for the rest, each as its own job. A new design (an edit) drops what is still running:
 * busy workers are stopped and started again, so the newest design never waits behind an old one.
 */

export interface WorkerLike {
  postMessage(req: EngineRequest): void;
  onmessage: ((e: MessageEvent<EngineResponse>) => void) | null;
  terminate(): void;
}

const spawnWorker = (): WorkerLike => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export class EngineClient {
  private workers: { w: WorkerLike; busy: number | null }[] = [];
  private next = 1;
  private waiting = new Map<number, (r: EngineResponse) => void>();
  private generation = 0;

  constructor(
    private readonly size = Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1)),
    private readonly spawn: () => WorkerLike = spawnWorker,
  ) {}

  /**
   * The Ampel of `p` with all fixes; `progress` sees the report each time a part is ready. Resolves
   * null when a newer call took over.
   */
  async assess(p: Pattern, profile: Profile, settings: EngineSettings, progress?: (r: AmpelReport) => void): Promise<AmpelReport | null> {
    const gen = this.cancel();
    const t0 = performance.now();
    const first = await this.ask({ ...this.base(p, profile, settings), id: 0, type: 'report' });
    if (gen !== this.generation || !first.report) return null;
    const report = first.report;
    progress?.(report);
    const kinds = planOrder(report.kinds.map((k) => k.kind));
    // Each kind's direct fix first (the buttons), then "Alles beheben", then the proposals: each
    // is its own job, so a free worker takes the next one and no button waits behind a proposal.
    const rests = new Map<FixKind, PlannedFix | null>();
    const show = (kind: FixKind) => {
      const k = report.kinds.find((x) => x.kind === kind)!;
      k.rest = restWorth(k.direct, rests.get(kind) ?? null);
    };
    const jobs = kinds.map(async (kind) => {
      const f = await this.fix(p, profile, settings, kind, 'direct');
      if (gen !== this.generation) return;
      report.kinds.find((x) => x.kind === kind)!.direct = f;
      if (rests.has(kind)) show(kind);
      progress?.(report);
    });
    if (kinds.length > 1) {
      jobs.push(
        this.fix(p, profile, settings, 'all', 'direct').then((f) => {
          if (gen !== this.generation) return;
          report.all = f;
          progress?.(report);
        }),
      );
    }
    for (const kind of kinds) {
      jobs.push(
        this.fix(p, profile, settings, kind, 'rest').then((f) => {
          if (gen !== this.generation) return;
          rests.set(kind, f);
          show(kind);
          progress?.(report);
        }),
      );
    }
    await Promise.all(jobs);
    if (gen !== this.generation) return null;
    report.ms = performance.now() - t0;
    return report;
  }

  /**
   * One fix of `p`, worked out in the next free worker (in the order asked). Null when it clears
   * nothing, or when cancel() dropped it.
   */
  async fix(p: Pattern, profile: Profile, settings: EngineSettings, target: FixTarget, mode: 'direct' | 'rest'): Promise<PlannedFix | null> {
    const r = await this.ask({ ...this.base(p, profile, settings), id: 0, type: 'fix', target, mode });
    if (r.error) console.error(r.error);
    return r.fix ?? null;
  }

  /** Drops what is running or waiting (for an older design): busy workers are stopped. Returns the new generation. */
  cancel(): number {
    this.dropBusy();
    return ++this.generation;
  }

  /** Jobs running or waiting. */
  get pending(): number {
    return this.waiting.size;
  }

  private base(p: Pattern, profile: Profile, settings: EngineSettings) {
    return { pattern: p, memory: rememberedIn(p, objectsOf(p)), profile, settings };
  }

  dispose(): void {
    for (const x of this.workers) x.w.terminate();
    this.workers = [];
  }

  /** Sends a request to a free worker, or waits for one. */
  private ask(req: EngineRequest): Promise<EngineResponse> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.queue.push({ ...req, id });
      this.pump();
    });
  }

  private queue: EngineRequest[] = [];

  private pump(): void {
    while (this.queue.length) {
      let slot = this.workers.find((x) => x.busy === null);
      if (!slot && this.workers.length < this.size) {
        slot = { w: this.spawn(), busy: null };
        const s = slot;
        s.w.onmessage = (e) => {
          s.busy = null;
          this.waiting.get(e.data.id)?.(e.data);
          this.waiting.delete(e.data.id);
          this.pump();
        };
        this.workers.push(s);
      }
      if (!slot) return;
      const req = this.queue.shift()!;
      slot.busy = req.id;
      slot.w.postMessage(req);
    }
  }

  /** Stops what is running for an older design; its callers get an empty answer. */
  private dropBusy(): void {
    for (const req of this.queue) this.waiting.get(req.id)?.({ id: req.id });
    this.queue = [];
    this.workers = this.workers.filter((x) => {
      if (x.busy === null) return true;
      x.w.terminate();
      this.waiting.get(x.busy)?.({ id: x.busy });
      this.waiting.delete(x.busy);
      return false;
    });
  }
}
