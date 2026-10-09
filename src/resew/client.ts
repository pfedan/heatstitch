import type { Pattern } from '../model/pattern';
import type { Mat } from '../shape/path';
import { ship, unship } from './live';
import type { ResewRequest, ResewResponse } from './worker';

/** A scaling sewn anew, for the design it was asked on (to be looked at, see live.ts). */
export interface LiveResult {
  from: Pattern;
  m: Mat;
  pattern: Pattern;
}

/**
 * Scaling sewn anew in a worker while the frame is dragged. Only the newest map is sewn: while one is
 * being sewn, a later one waits and replaces the one waiting before it, so the result never lags
 * behind by more than one step, however slow the objects are.
 */
export class LiveResew {
  private worker: Worker | null = null;
  private loaded: Pattern | null = null;
  private busy: { id: number; from: Pattern; m: Mat } | null = null;
  private waiting: { from: Pattern; sel: number[]; m: Mat; trimMm: number } | null = null;
  private seq = 0;

  constructor(private got: (r: LiveResult) => void) {}

  /** Asks for the objects `sel` of `p` scaled by `m`. */
  ask(p: Pattern, sel: number[], m: Mat, trimMm: number): void {
    this.waiting = { from: p, sel, m, trimMm };
    if (!this.busy) this.next();
  }

  /** Drops what is waiting; what is being sewn still comes back. */
  stop(): void {
    this.waiting = null;
  }

  private next(): void {
    const w = this.waiting;
    this.waiting = null;
    if (!w) return;
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<ResewResponse>) => this.answer(e.data);
      this.worker.onerror = () => {
        // Without the worker the stitches are only stretched while dragging, as before.
        this.worker?.terminate();
        this.worker = null;
        this.loaded = null;
        this.busy = null;
        this.waiting = null;
      };
    }
    if (this.loaded !== w.from) {
      this.worker.postMessage({ type: 'load', design: ship(w.from) } satisfies ResewRequest);
      this.loaded = w.from;
    }
    const id = ++this.seq;
    this.busy = { id, from: w.from, m: w.m };
    this.worker.postMessage({ type: 'scale', id, sel: w.sel, m: w.m, trimMm: w.trimMm } satisfies ResewRequest);
  }

  private answer(r: ResewResponse): void {
    const b = this.busy;
    if (!b || b.id !== r.id) return;
    this.busy = null;
    if (r.done) this.got({ from: b.from, m: b.m, pattern: unship(r.done, b.from) });
    this.next();
  }
}
