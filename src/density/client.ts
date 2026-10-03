import type { Pattern } from '../model/pattern';
import type { DensityGrid, DensityOptions } from './grid';
import type { DensityRequest, DensityResponse } from './worker';

/** Runs density jobs in a worker; only the latest request resolves, older ones are dropped. */
export class DensityClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending?: { id: number; resolve: (g: DensityGrid | null) => void; reject: (e: Error) => void };

  constructor() {
    this.worker.onmessage = (e: MessageEvent<DensityResponse>) => {
      const p = this.pending;
      if (!p || p.id !== e.data.id) return;
      this.pending = undefined;
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.grid ?? null);
    };
  }

  /** Resolves with the grid, or null if superseded by a newer request. */
  compute(pattern: Pattern, options: DensityOptions): Promise<DensityGrid | null> {
    this.pending?.resolve(null);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      this.worker.postMessage({ id, pattern, options } satisfies DensityRequest);
    });
  }
}
