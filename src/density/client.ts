import type { CorrectionOptions, CorrectionResult } from '../correct/auto';
import type { Pattern } from '../model/pattern';
import type { Profile } from '../validation/profiles';
import type { Checks } from '../validation/validate';
import type { Measurement } from '../validation/measure';
import type { DensityGrid, DensityOptions } from './grid';
import type { WorkerRequest, WorkerResponse } from './worker';

/** Request without its id, kept as a union per message type. */
type Unsent<T> = T extends unknown ? Omit<T, 'id'> : never;

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

/** Promise wrapper around one worker; requests are answered in order of completion. */
export class WorkerClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
  }

  private call(req: Unsent<WorkerRequest>): Promise<WorkerResponse> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  async density(pattern: Pattern, options: DensityOptions): Promise<DensityGrid> {
    return (await this.call({ type: 'density', pattern, options })).grid!;
  }

  /** Profile-independent validation measurements; classification happens on the main thread. */
  async measure(pattern: Pattern): Promise<Measurement> {
    return (await this.call({ type: 'measure', pattern })).measurement!;
  }

  /** Automatic correction (measures several times, so it runs off the main thread). */
  async correct(pattern: Pattern, profile: Profile, checks: Checks, options: CorrectionOptions): Promise<CorrectionResult> {
    const r = await this.call({ type: 'correct', pattern, profile, checks, options });
    return { pattern: r.pattern!, measurement: r.measurement!, report: r.report! };
  }
}
