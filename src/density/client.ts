import type { Pattern } from '../model/pattern';
import type { ValidationResult } from '../validation/validate';
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

  async validate(pattern: Pattern): Promise<ValidationResult> {
    return (await this.call({ type: 'validate', pattern })).validation!;
  }
}
