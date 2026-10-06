import { sewObjects } from '../../model/objects';
import type { Pattern } from '../../model/pattern';
import { rememberedIn } from '../../model/restitch';
import type { Profile } from '../../validation/profiles';
import type { AmpelReport } from './ampel';
import { planOrder } from './ampel';
import type { EngineRequest, EngineResponse, EngineSettings } from './worker';

/**
 * Works out the Ampel in a few workers at once: the report first, then each kind's fixes in its own
 * worker (density first), "Alles beheben" last. A new design (an edit) drops what is still running:
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
    const gen = ++this.generation;
    this.dropBusy();
    const t0 = performance.now();
    const memory = rememberedIn(p, sewObjects(p));
    const base = { pattern: p, memory, profile, settings };
    const first = await this.ask({ ...base, id: 0, type: 'report' });
    if (gen !== this.generation || !first.report) return null;
    const report = first.report;
    progress?.(report);
    const kinds = planOrder(report.kinds.map((k) => k.kind));
    const jobs = kinds.map(async (kind) => {
      const r = await this.ask({ ...base, id: 0, type: 'kind', kind });
      if (gen !== this.generation) return;
      const k = report.kinds.find((x) => x.kind === kind)!;
      k.direct = r.direct ?? null;
      k.rest = r.rest ?? null;
      progress?.(report);
    });
    if (kinds.length > 1) {
      jobs.push(
        this.ask({ ...base, id: 0, type: 'all' }).then((r) => {
          if (gen !== this.generation) return;
          report.all = r.all ?? null;
          progress?.(report);
        }),
      );
    }
    await Promise.all(jobs);
    if (gen !== this.generation) return null;
    report.ms = performance.now() - t0;
    return report;
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
