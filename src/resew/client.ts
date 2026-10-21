import type { Pattern } from '../model/pattern';
import type { RestitchResult, Settings } from '../model/restitch';
import type { Mat } from '../shape/path';
import { ship, unship, type SewnFills, type ShippedTransform } from './live';
import { fillPool, shares } from './pool';
import type { CommitResponse, FillsResponse, ResewRequest, ResewResponse, RestitchResponse } from './worker';

/** A scaling sewn anew, for the design it was asked on (to be looked at, see live.ts). */
export interface LiveResult {
  from: Pattern;
  m: Mat;
  pattern: Pattern;
}

/** A move, turn or scaling let go, sewn anew in the worker (see transformShipped). */
export interface Committed {
  from: Pattern;
  pattern: Pattern;
  hand: number;
  restitched: boolean;
  stretched: number;
  moved: number[] | null;
}

/**
 * Scaling sewn anew in a worker while the frame is dragged, and when it is let go. Only the newest
 * map is sewn while dragging: while one is being sewn, a later one waits and replaces the one
 * waiting before it, so the result never lags behind by more than one step, however slow the
 * objects are.
 */
export class LiveResew {
  private worker: Worker | null = null;
  private loaded: Pattern | null = null;
  private busy: { id: number; from: Pattern; m: Mat } | null = null;
  private waiting: { from: Pattern; sel: number[]; m: Mat; trimMm: number } | null = null;
  private seq = 0;
  /** Transforms let go, sewn after what is being sewn; answered in turn. */
  private commits = new Map<number, { from: Pattern; done: (r: Committed | null) => void }>();
  /** Without a worker (it failed to start or stopped) the caller sews on its own. */
  failed = false;

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

  /**
   * The objects `sel` of `p` transformed by `m` as let go, sewn anew with their borders in the
   * worker. Null when that did not work or there is no worker (the caller then sews on its own:
   * `failed` says which).
   */
  commit(p: Pattern, sel: number[], m: Mat, trimMm: number): Promise<Committed | null> {
    const w = this.start();
    if (!w) return Promise.resolve(null);
    this.load(w, p);
    const id = ++this.seq;
    return new Promise((done) => {
      this.commits.set(id, { from: p, done });
      w.postMessage({ type: 'commit', id, sel, m, trimMm } satisfies ResewRequest);
    });
  }

  private start(): Worker | null {
    if (this.worker) return this.worker;
    if (this.failed) return null;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.failed = true;
      return null;
    }
    this.worker.onmessage = (e: MessageEvent<ResewResponse | CommitResponse>) => this.answer(e.data);
    this.worker.onerror = () => {
      // Without the worker the stitches are only stretched while dragging, as before, and letting
      // go sews on the main thread.
      this.worker?.terminate();
      this.worker = null;
      this.loaded = null;
      this.busy = null;
      this.waiting = null;
      this.failed = true;
      for (const c of this.commits.values()) c.done(null);
      this.commits.clear();
    };
    return this.worker;
  }

  private load(w: Worker, p: Pattern): void {
    if (this.loaded === p) return;
    w.postMessage({ type: 'load', design: ship(p) } satisfies ResewRequest);
    this.loaded = p;
  }

  private next(): void {
    const w = this.waiting;
    this.waiting = null;
    if (!w) return;
    const worker = this.start();
    if (!worker) return;
    this.load(worker, w.from);
    const id = ++this.seq;
    this.busy = { id, from: w.from, m: w.m };
    worker.postMessage({ type: 'scale', id, sel: w.sel, m: w.m, trimMm: w.trimMm } satisfies ResewRequest);
  }

  private answer(r: ResewResponse | CommitResponse): void {
    const c = this.commits.get(r.id);
    if (c) {
      this.commits.delete(r.id);
      const d = r.done as ShippedTransform | null;
      c.done(d ? { from: c.from, pattern: unship(d.pattern, c.from), hand: d.hand, restitched: d.restitched, stretched: d.stretched, moved: d.moved } : null);
      return;
    }
    const b = this.busy;
    if (!b || b.id !== r.id) return;
    this.busy = null;
    const done = (r as ResewResponse).done;
    if (done) this.got({ from: b.from, m: b.m, pattern: unship(done, b.from) });
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
  private busy: { id: number; tag: number; from: Pattern; settings: Settings } | null = null;
  private waiting: { from: Pattern; which: number[]; settings: Settings; trimMm: number } | null = null;
  private seq = 0;
  /** This worker's own share of fills sewn on several cores (see pool.ts), by request. */
  private own = new Map<number, (f: SewnFills | null) => void>();
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
    fillPool.cancel(this.busy.tag);
    this.busy = null;
    this.end();
  }

  /** Whether settings are being sewn or wait for it. */
  get pending(): boolean {
    return !!(this.busy || this.waiting);
  }

  private end(): void {
    this.worker?.terminate();
    this.worker = null;
    this.loaded = null;
    for (const done of this.own.values()) done(null);
    this.own.clear();
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
      this.worker.onmessage = (e: MessageEvent<RestitchResponse | FillsResponse>) => this.answer(e.data);
      this.worker.onerror = () => {
        const b = this.busy;
        if (b) fillPool.cancel(b.tag);
        this.end();
        this.busy = null;
        this.waiting = null;
        this.failed = true;
        if (b) this.got({ from: b.from, settings: b.settings, result: null, lost: true });
      };
    }
    const worker = this.worker;
    if (this.loaded !== w.from) {
      worker.postMessage({ type: 'load', design: ship(w.from) } satisfies ResewRequest);
      this.loaded = w.from;
    }
    const id = ++this.seq;
    const tag = fillPool.tag();
    this.busy = { id, tag, from: w.from, settings: w.settings };
    const sew = (fills?: SewnFills) => worker.postMessage({ type: 'restitch', id, which: w.which, settings: w.settings, trimMm: w.trimMm, ...(fills?.length ? { fills } : {}) } satisfies ResewRequest);
    // Many fills: shared over this worker and the pool's, then sewn together here.
    const split = fillPool.size ? shares(w.from, w.which, w.settings, fillPool.size + 1) : null;
    if (!split) return sew();
    const [mine, ...rest] = split;
    const own = new Promise<SewnFills | null>((done) => {
      const fid = ++this.seq;
      this.own.set(fid, done);
      worker.postMessage({ type: 'fills', id: fid, which: w.which, only: mine, settings: w.settings, trimMm: w.trimMm } satisfies ResewRequest);
    });
    void Promise.all([own, ...rest.map((only) => fillPool.sew(tag, w.from, w.which, only, w.settings, w.trimMm))]).then((parts) => {
      // A share that did not come is sewn with the rest.
      if (this.busy?.id === id && this.worker === worker) sew(parts.flatMap((f) => f ?? []));
    });
  }

  private answer(r: RestitchResponse | FillsResponse): void {
    if ('fills' in r) {
      const done = this.own.get(r.id);
      this.own.delete(r.id);
      return done?.(r.fills);
    }
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
