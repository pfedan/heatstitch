import type { Pattern } from '../model/pattern';
import type { RestitchResult, Settings } from '../model/restitch';
import type { Mat } from '../shape/path';
import { ship, unship } from './live';
import type { ResewRequest, ResewResponse, RestitchResponse } from './worker';

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

/** Stitch settings sewn anew for a design (to be looked at): the result, or null where it failed. */
export interface PreviewResult {
  from: Pattern;
  settings: Settings;
  result: RestitchResult | null;
  /** The worker stopped working before it answered: nothing was sewn. */
  lost?: true;
  /** The same result once more, as a design of its own (one that was shown has caches of its own). */
  again?: () => RestitchResult | null;
}

/**
 * New stitch settings sewn in a worker while one is pointed at or a slider is dragged, so the page
 * stays live: a large fill takes seconds. Only the newest settings are sewn; while one is sewn, a
 * later one waits and replaces the one waiting before it. Stopping (the pointer left, the settings
 * were taken over) ends the sewing at once: the next one does not wait seconds for an answer nobody
 * wants any more.
 */
export class LivePreview {
  private worker: Worker | null = null;
  private loaded: Pattern | null = null;
  private busy: { id: number; from: Pattern; settings: Settings } | null = null;
  private waiting: { from: Pattern; which: number[]; settings: Settings; trimMm: number } | null = null;
  private seq = 0;
  /** Without a worker (it failed to start) the caller sews on its own. */
  failed = false;

  /**
   * With `newestOnly` a result comes back only when no later settings wait (taking settings over:
   * an older result would be built on and then replaced).
   */
  constructor(
    private got: (r: PreviewResult) => void,
    private newestOnly = false,
  ) {}

  /** Asks for the objects `which` of `p` sewn with `settings`. */
  ask(p: Pattern, which: number[], settings: Settings, trimMm: number): void {
    this.waiting = { from: p, which, settings: structuredClone(settings), trimMm };
    if (!this.busy) this.next();
  }

  /** Nothing is wanted any more: what waits is dropped, what is being sewn is ended. */
  stop(): void {
    this.waiting = null;
    if (!this.busy) return;
    this.busy = null;
    this.worker?.terminate();
    this.worker = null;
    this.loaded = null;
  }

  /** Whether settings are being sewn or wait for it. */
  get pending(): boolean {
    return !!(this.busy || this.waiting);
  }

  private next(): void {
    const w = this.waiting;
    this.waiting = null;
    if (!w) return;
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      } catch {
        this.failed = true;
        return;
      }
      this.worker.onmessage = (e: MessageEvent<RestitchResponse>) => this.answer(e.data);
      this.worker.onerror = () => {
        const b = this.busy;
        this.worker?.terminate();
        this.worker = null;
        this.loaded = null;
        this.busy = null;
        this.waiting = null;
        this.failed = true;
        if (b) this.got({ from: b.from, settings: b.settings, result: null, lost: true });
      };
    }
    if (this.loaded !== w.from) {
      this.worker.postMessage({ type: 'load', design: ship(w.from) } satisfies ResewRequest);
      this.loaded = w.from;
    }
    const id = ++this.seq;
    this.busy = { id, from: w.from, settings: w.settings };
    this.worker.postMessage({ type: 'restitch', id, which: w.which, settings: w.settings, trimMm: w.trimMm } satisfies ResewRequest);
  }

  private answer(r: RestitchResponse): void {
    const b = this.busy;
    if (!b || b.id !== r.id) return;
    this.busy = null;
    // Shown also when later settings wait (a slider still dragged): the newest there is.
    if (this.newestOnly && this.waiting) return this.next();
    const d = r.done;
    const make = (): RestitchResult | null => (d ? { pattern: unship(structuredClone(d.pattern), b.from), starts: d.starts, ends: d.ends, failed: d.failed, regions: [], memory: structuredClone(d.memory) } : null);
    this.got({ from: b.from, settings: b.settings, result: make(), again: make });
    this.next();
  }
}
