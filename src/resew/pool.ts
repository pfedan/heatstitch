import type { Pattern } from '../model/pattern';
import { designObjects, type Settings } from '../model/restitch';
import { ship, type SewnFills } from './live';
import type { FillsResponse, ResewRequest } from './worker';

/**
 * Fills of many objects sewn anew on several cores at once. A fill's stitches depend only on the
 * design, the object and its settings (see Fills in restitch.ts), so each core sews a share of the
 * fills, and the worker that sews the whole design takes them over: the stitches are the same as
 * sewn on one core. A large design is ruled by its largest fill, so a few cores give all there is
 * to gain; each one holds the design and the shape libraries, so there are no more than that.
 */

/** Fills sewn on several cores from this many stitches in all (smaller ones are quick alone). */
const POOL_FROM = 4000;

/** Helper cores besides the worker that sews the design: the rest of the machine, at most 2. */
const helperCount = () => Math.max(0, Math.min(2, (globalThis.navigator?.hardwareConcurrency ?? 2) - 2));

interface Helper {
  w: Worker;
  loaded: Pattern | null;
  /** The request it is sewing a share for, or 0. */
  busy: number;
  done: ((f: SewnFills | null) => void) | null;
}

/** One core's share: the ids of the fills it sews. */
export type Share = number[];

/**
 * How the fills among the objects `which` of `p` are shared over `cores` cores, largest first to the
 * one with the least so far (LPT, within 4/3 of the best split); null when sewing them on one core
 * is as quick (one fill, or few stitches in all).
 */
export function shares(p: Pattern, which: number[], settings: Settings, cores: number): Share[] | null {
  // Only fill settings sew fills (see Fills); a change of kind sews them in its own way.
  if (cores < 2 || settings.kind !== 'fill') return null;
  const { objects } = designObjects(p);
  const set = new Set(which);
  const fills = objects.filter((o) => set.has(o.index) && o.kind === 'fill').map((o) => ({ id: o.id, n: o.last - o.first + 1 }));
  if (fills.length < 2 || fills.reduce((s, f) => s + f.n, 0) < POOL_FROM) return null;
  fills.sort((a, b) => b.n - a.n || a.id - b.id);
  const out = Array.from({ length: Math.min(cores, fills.length) }, () => ({ ids: [] as number[], n: 0 }));
  for (const f of fills) {
    const least = out.reduce((a, b) => (b.n < a.n ? b : a));
    least.ids.push(f.id);
    least.n += f.n;
  }
  return out.map((s) => s.ids);
}

/** The helper workers, shared by everything that sews fills anew. */
class FillPool {
  private helpers: Helper[] = [];
  private failed = false;
  private seq = 0;
  private tags = 0;

  /** A tag of its own for a request whose fills are shared. */
  tag(): number {
    return ++this.tags;
  }

  /** How many helpers there can be. */
  get size(): number {
    return this.failed ? 0 : helperCount();
  }

  /** The fills `only` among `which` of `p` sewn on a helper for request `tag`; null when that did not work. */
  sew(tag: number, p: Pattern, which: number[], only: number[], settings: Settings, trimMm: number): Promise<SewnFills | null> {
    const h = this.free();
    if (!h) return Promise.resolve(null);
    if (h.loaded !== p) {
      h.w.postMessage({ type: 'load', design: ship(p) } satisfies ResewRequest);
      h.loaded = p;
    }
    h.busy = tag;
    return new Promise((done) => {
      h.done = done;
      h.w.postMessage({ type: 'fills', id: ++this.seq, which, only, settings, trimMm } satisfies ResewRequest);
    });
  }

  /** Request `tag` is not wanted any more: its helpers stop at once (they start again when needed). */
  cancel(tag: number): void {
    for (const h of this.helpers.filter((x) => x.busy === tag)) this.drop(h, false);
  }

  private free(): Helper | null {
    const idle = this.helpers.find((h) => !h.busy);
    if (idle) return idle;
    if (this.failed || this.helpers.length >= helperCount()) return null;
    let w: Worker;
    try {
      w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.failed = true;
      return null;
    }
    const h: Helper = { w, loaded: null, busy: 0, done: null };
    w.onmessage = (e: MessageEvent<FillsResponse>) => {
      const done = h.done;
      h.busy = 0;
      h.done = null;
      done?.(e.data.fills);
    };
    w.onerror = () => this.drop(h, true);
    this.helpers.push(h);
    return h;
  }

  private drop(h: Helper, failed: boolean): void {
    h.w.terminate();
    this.helpers = this.helpers.filter((x) => x !== h);
    if (failed) this.failed = true;
    const done = h.done;
    h.done = null;
    done?.(null);
  }
}

export const fillPool = new FillPool();
